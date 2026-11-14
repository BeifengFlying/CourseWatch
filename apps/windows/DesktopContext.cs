using System.Diagnostics;
using System.IO.Pipes;
using System.Text.Json;
using Microsoft.Toolkit.Uwp.Notifications;
using Windows.UI.Notifications;

namespace CourseWatch;

internal sealed class DesktopContext : ApplicationContext
{
    private readonly Control dispatcher = new();
    private readonly LocalService service = new();
    private readonly CancellationTokenSource lifetime = new();
    private readonly NotifyIcon tray;
    private readonly ToolStripMenuItem stateItem = new("后台连接中…") { Enabled = false };
    private readonly ToolStripMenuItem pauseItem;
    private readonly System.Windows.Forms.Timer pollTimer = new() { Interval = 15000 };
    private readonly Dictionary<string, DesktopWindow> platforms = new();
    private readonly System.Windows.Forms.Timer hoverTimer = new() { Interval = 450 };
    private readonly TrayPreview preview;
    private DesktopWindow? main;
    private bool ready, polling, quitting, disposed, monitoring = true, checking;
    private string? pendingEntry;
    private bool pendingSettings;
    private string? mainSnapshot;
    private string? startupError;
    internal readonly DesktopPreferencesStore Preferences = new(LocalService.DataDirectory, Environment.ProcessPath!, new WindowsStartupRegistration());

    internal DesktopContext(string? entry, bool launchInBackground = false)
    {
        dispatcher.CreateControl();
        pendingEntry = entry;
        var menu = new ContextMenuStrip();
        menu.Items.Add("打开任务中心", null, (_, _) => ShowMain());
        menu.Items.Add(stateItem);
        menu.Items.Add("立即检查", null, async (_, _) => await CheckAsync());
        menu.Items.Add("设置", null, (_, _) => ShowSettings());
        pauseItem = new ToolStripMenuItem("暂停监控", null, async (_, _) => await ToggleAsync());
        menu.Items.Add(pauseItem);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("退出 CourseWatch", null, async (_, _) => await QuitAsync());
        var iconPath = Path.Combine(AppContext.BaseDirectory, "CourseWatch.ico");
        tray = new NotifyIcon
        {
            Icon = File.Exists(iconPath) ? new Icon(iconPath) : Icon.ExtractAssociatedIcon(Environment.ProcessPath!) ?? SystemIcons.Application,
            Text = "CourseWatch · 后台连接中",
            ContextMenuStrip = menu,
            Visible = true,
        };
        preview = new TrayPreview(this);
        tray.MouseMove += (_, _) => { if (!preview.Visible && !hoverTimer.Enabled) hoverTimer.Start(); };
        tray.MouseClick += async (_, e) =>
        {
            hoverTimer.Stop();
            if (e.Button == MouseButtons.Left)
            {
                if (preview.Visible && preview.Pinned) preview.Hide();
                else await ShowPreviewAsync(true);
            }
            else preview.Hide();
        };
        tray.MouseDoubleClick += (_, e) => { if (e.Button == MouseButtons.Left) ShowMain(); };
        hoverTimer.Tick += async (_, _) => { hoverTimer.Stop(); await ShowPreviewAsync(false); };
        pollTimer.Tick += async (_, _) => await PollAsync();
        service.Exited += () => Post(() =>
        {
            ready = false;
            startupError = "后台已退出，请退出 CourseWatch 后重新打开。";
            stateItem.Text = startupError;
            main?.ShowError(startupError);
        });
        Microsoft.Win32.SystemEvents.PowerModeChanged += PowerChanged;
        Microsoft.Win32.SystemEvents.SessionEnding += SessionEnding;
        _ = ListenAsync();
        if (!launchInBackground || !Preferences.Value.SetupCompleted || !Preferences.Value.BackgroundEnabled || entry is not null) ShowMain();
        _ = StartAsync();
    }

    internal void Post(Action action)
    {
        if (!quitting && !dispatcher.IsDisposed) dispatcher.BeginInvoke(action);
    }

    private async Task StartAsync()
    {
        try
        {
            await service.StartAsync();
            if (quitting) return;
            ready = true;
            if (main is { Visible: true }) await main.EnsureBrowserAsync();
            pollTimer.Start();
            await PollAsync();
        }
        catch
        {
            startupError = "无法启动后台。请先退出其他 CourseWatch 后台，再重新打开应用。";
            stateItem.Text = startupError;
            main?.ShowError(startupError);
        }
    }

    internal void ShowMain(string? entry = null)
    {
        preview.Hide();
        if (!string.IsNullOrEmpty(entry)) pendingEntry = entry;
        if (main is null || main.IsDisposed)
        {
            main = new DesktopWindow(this, service, null, mainSnapshot);
            main.ClosedToTray += snapshot =>
            {
                mainSnapshot = snapshot;
                foreach (var window in platforms.Values.ToArray()) window.Close();
                platforms.Clear();
                main = null;
            };
        }
        main.Show();
        if (main.WindowState == FormWindowState.Minimized) main.WindowState = FormWindowState.Normal;
        main.Activate();
        if (startupError is not null) main.ShowError(startupError);
        else if (ready) _ = main.EnsureBrowserAsync();
        foreach (var window in platforms.Values) window.Show();
        _ = FocusPendingAsync();
    }

    internal bool Ready => ready;
    internal Task SendPreferencesAsync(DesktopWindow window) => window.DispatchAsync("coursewatch:preferences", Preferences.Value);
    internal void ShowSettings() { pendingSettings = true; ShowMain(); }

    internal async Task FocusPendingAsync()
    {
        if (main is not { PageReady: true }) return;
        if (pendingEntry is { } entry)
        {
            pendingEntry = null;
            await main.DispatchAsync("coursewatch:task", entry);
        }
        if (pendingSettings)
        {
            pendingSettings = false;
            await main.DispatchAsync("coursewatch:settings");
        }
    }

    internal void OpenPlatform(string platform)
    {
        if (!ready || !DesktopWindow.PlatformNames.ContainsKey(platform)) return;
        if (!platforms.TryGetValue(platform, out var window) || window.IsDisposed)
        {
            window = new DesktopWindow(this, service, platform);
            platforms[platform] = window;
            window.FormClosed += (_, _) => platforms.Remove(platform);
        }
        window.Show();
        if (window.WindowState == FormWindowState.Minimized) window.WindowState = FormWindowState.Normal;
        window.Activate();
        _ = window.EnsureBrowserAsync();
    }

    internal void DismissPlatform(string platform)
    {
        if (platforms.TryGetValue(platform, out var window)) window.Close();
    }

    internal void HideToTray()
    {
        foreach (var window in platforms.Values) window.Hide();
        main?.Hide();
        if (main is not null) _ = main.SuspendAsync();
    }

    internal void MinimizeMain()
    {
        foreach (var window in platforms.Values) window.Hide();
        if (main is not null) main.WindowState = FormWindowState.Minimized;
    }

    internal void RestorePlatformWindows()
    {
        foreach (var window in platforms.Values) if (!window.Visible) window.Show();
    }

    internal async Task RefreshAsync(DesktopWindow? sender = null)
    {
        foreach (var window in AllWindows())
            if (window != sender) await window.DispatchAsync("coursewatch:refresh");
        await PollAsync();
    }

    private IEnumerable<DesktopWindow> AllWindows() => platforms.Values.Concat(main is null ? [] : new[] { main }).ToArray();

    private async Task PollAsync()
    {
        if (!ready || polling || quitting) return;
        polling = true;
        try
        {
            var health = await service.RequestAsync("health");
            monitoring = health.GetProperty("monitoring").GetBoolean();
            var count = health.GetProperty("enabledPlatforms").GetInt32();
            var state = !monitoring ? "监控已暂停" : count == 0 ? "未开启监控对象" : health.GetProperty("status").GetString() == "degraded" ? "平台需要检查" : $"正在监控 {count} 个对象";
            stateItem.Text = checking ? "正在检查…" : state;
            pauseItem.Text = monitoring ? "暂停监控" : "继续监控";
            tray.Text = "CourseWatch · " + state;
            if (health.GetProperty("nativePending").GetBoolean()) await DeliverAsync();
            if (preview.Visible) await UpdatePreviewAsync();
        }
        catch { stateItem.Text = "后台连接中断"; tray.Text = "CourseWatch · 后台连接中断"; }
        finally { polling = false; }
    }

    internal async Task DeliverAsync()
    {
        if (!ready || quitting || delivering) return;
        delivering = true;
        try
        {
            var pending = await service.RequestAsync("native/pending");
            foreach (var item in pending.GetProperty("items").EnumerateArray())
            {
                string? error = null;
                try
                {
                    if (ToastNotificationManagerCompat.CreateToastNotifier().Setting != NotificationSetting.Enabled)
                        error = "Windows 通知已关闭；记录保留在应用通知中心";
                    else
                    {
                        var entry = item.GetProperty("task_id").ValueKind == JsonValueKind.String ? item.GetProperty("task_id").GetString() : "";
                        new ToastContentBuilder()
                            .AddArgument("entryId", entry ?? "")
                            .AddText(item.GetProperty("title").GetString() ?? "CourseWatch")
                            .AddText(item.GetProperty("body").GetString() ?? "")
                            .Show(toast => { toast.Tag = item.GetProperty("id").GetInt64().ToString(); toast.Group = "CourseWatch"; });
                    }
                }
                catch { error = "Windows 通知接口未确认接收，请检查系统通知设置"; }
                var acknowledgement = new Dictionary<string, object> { ["id"] = item.GetProperty("id").GetInt64() };
                if (error is not null) acknowledgement["error"] = error;
                await service.RequestAsync("native/delivered", HttpMethod.Post, acknowledgement);
            }
        }
        catch { stateItem.Text = "通知暂未送达，下一轮重试"; }
        finally { delivering = false; }
    }
    private bool delivering;

    internal async Task NotificationStatusAsync(DesktopWindow window)
    {
        var message = "Windows 通知状态暂时无法读取";
        try { message = ToastNotificationManagerCompat.CreateToastNotifier().Setting == NotificationSetting.Enabled ? "Windows 已允许 CourseWatch 发送通知" : "Windows 通知已关闭，请在系统通知设置中允许 CourseWatch 发送通知"; }
        catch { }
        await window.DispatchAsync("coursewatch:notificationStatus", message);
    }

    internal async Task CheckAsync()
    {
        if (!ready || checking) return;
        checking = true;
        stateItem.Text = "正在检查…";
        try { await service.RequestAsync("monitor/check", HttpMethod.Post, new { }, 300); await RefreshAsync(); }
        catch { MessageBox.Show("检查未完成，请打开主窗口查看平台状态和检查日志。", "CourseWatch"); }
        finally { checking = false; await PollAsync(); }
    }

    private async Task ToggleAsync()
    {
        try { await service.RequestAsync(monitoring ? "monitor/stop" : "monitor/start", HttpMethod.Post, new { }); await RefreshAsync(); }
        catch { MessageBox.Show("无法连接后台，请重新打开 CourseWatch。", "CourseWatch"); }
    }

    private async Task ShowPreviewAsync(bool pinned)
    {
        if (quitting) return;
        try { await UpdatePreviewAsync(); }
        catch { preview.SetUnavailable(); }
        preview.Pinned = pinned;
        preview.ShowAtCursor();
    }

    private async Task UpdatePreviewAsync()
    {
        if (!ready) { preview.SetUnavailable(); return; }
        preview.SetItems(await service.RequestAsync("native/summary"));
    }

    private async Task ListenAsync()
    {
        while (!lifetime.IsCancellationRequested)
        {
            try
            {
                await using var pipe = new NamedPipeServerStream(Program.UserKey, PipeDirection.In, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
                await pipe.WaitForConnectionAsync(lifetime.Token);
                using var reader = new StreamReader(pipe);
                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token);
                timeout.CancelAfter(TimeSpan.FromSeconds(5));
                // A bounded read avoids keeping an unlimited local activation payload.
                var chars = new char[207];
                var count = 0;
                while (count < chars.Length)
                {
                    var read = await reader.ReadAsync(chars.AsMemory(count), timeout.Token);
                    if (read == 0) break;
                    count += read;
                    if (Array.IndexOf(chars, '\n', 0, count) >= 0) break;
                }
                if (count <= 206)
                {
                    var command = new string(chars, 0, count).TrimEnd('\r', '\n');
                    if (command == "quit") Post(async () => await QuitAsync());
                    else if (command.StartsWith("show:", StringComparison.Ordinal)) Post(() => ShowMain(command[5..]));
                }
            }
            catch (OperationCanceledException) { }
            catch (IOException) { if (!lifetime.IsCancellationRequested) await Task.Delay(500); }
        }
    }

    private void PowerChanged(object sender, Microsoft.Win32.PowerModeChangedEventArgs e)
    {
        if (e.Mode == Microsoft.Win32.PowerModes.Resume) Post(async () => { await RefreshAsync(); });
    }

    private void SessionEnding(object sender, Microsoft.Win32.SessionEndingEventArgs e) => Post(async () => await QuitAsync());

    internal async Task QuitAsync()
    {
        if (quitting) return;
        quitting = true;
        pollTimer.Stop(); hoverTimer.Stop(); lifetime.Cancel();
        tray.Visible = false;
        foreach (var window in AllWindows()) window.ForceClose();
        await service.StopAsync();
        ExitThread();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing && !disposed)
        {
            disposed = true;
            quitting = true;
            Microsoft.Win32.SystemEvents.PowerModeChanged -= PowerChanged;
            Microsoft.Win32.SystemEvents.SessionEnding -= SessionEnding;
            lifetime.Cancel();
            pollTimer.Dispose(); hoverTimer.Dispose(); preview.Dispose();
            tray.Visible = false;
            tray.ContextMenuStrip?.Dispose(); tray.Icon?.Dispose(); tray.Dispose();
            foreach (var window in AllWindows()) window.ForceClose();
            service.Dispose(); dispatcher.Dispose(); lifetime.Dispose();
        }
        base.Dispose(disposing);
    }
}
