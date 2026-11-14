using System.Diagnostics;
using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace CourseWatch;

internal sealed class DesktopWindow : Form
{
    private static readonly JsonSerializerOptions BridgeJson = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
    internal static readonly Dictionary<string, string> PlatformNames = new()
    {
        ["ynjy"] = "云南省高等学校计算机等级考试系统",
        ["renwei"] = "人卫", ["yuketang"] = "雨课堂", ["chaoxing"] = "超星", ["unipus"] = "U校园",
    };
    private static readonly HashSet<string> OfficialHosts = new(StringComparer.OrdinalIgnoreCase)
    {
        "jsjks.ynjy.cn", "tk.ipmph.com", "www.yuketang.cn", "yuketang.cn", "sso.yuketang.cn",
        "passport2.chaoxing.com", "i.chaoxing.com", "i.mooc.chaoxing.com", "mooc2-ans.chaoxing.com", "mooc1-api.chaoxing.com", "mooc1.chaoxing.com", "uai.unipus.cn", "sso.unipus.cn", "itest.unipus.cn",
    };
    private readonly DesktopContext desktop;
    private readonly LocalService service;
    private readonly string? platform;
    private WebView2? web;
    private readonly Label status;
    private readonly FlowLayoutPanel fallback;
    private string? snapshot;
    private readonly record struct WindowPane(float X, float Y, float Width, float Height, float Radius);
    private WindowPane[]? windowPanes;
    private bool attaching, suspending, forceClose, closing, closePromptOpen;
    private readonly System.Windows.Forms.Timer idleTimer = new() { Interval = 1000 };
    internal bool PageReady { get; private set; }
    internal event Action<string?>? ClosedToTray;

    protected override CreateParams CreateParams
    {
        get
        {
            var value = base.CreateParams;
            // WinForms can add WS_CAPTION for a non-empty Text even on a
            // borderless form. Keep the system menu, but let the
            // shared desktop page draw the only pair of window controls.
            value.Style = (value.Style & ~0x00C00000 & ~0x00010000 & ~0x00040000)
                | 0x00020000 | 0x00080000;
            return value;
        }
    }

    protected override void OnLoad(EventArgs e)
    {
        base.OnLoad(e);
        FitWindowToScreen();
    }

    protected override void OnDpiChanged(DpiChangedEventArgs e)
    {
        // Unlock the old pixel bounds before WinForms scales for the new monitor.
        MinimumSize = Size.Empty;
        MaximumSize = Size.Empty;
        base.OnDpiChanged(e);
        FitWindowToScreen();
    }

    private void FitWindowToScreen()
    {
        var area = Screen.FromControl(this).WorkingArea;
        var inset = (int)(16 * DeviceDpi / 96f);
        var available = new Size(Math.Max(1, area.Width - inset * 2), Math.Max(1, area.Height - inset * 2));
        var logical = platform is null ? new Size(1060, 720) : new Size(660, 700);
        var fixedSize = new Size(Math.Min((int)Math.Round(logical.Width * DeviceDpi / 96f), available.Width),
            Math.Min((int)Math.Round(logical.Height * DeviceDpi / 96f), available.Height));
        MinimumSize = Size.Empty;
        MaximumSize = Size.Empty;
        Size = fixedSize;
        MinimumSize = MaximumSize = fixedSize;
        Location = new Point(Math.Clamp(Left, area.Left, area.Right - Width), Math.Clamp(Top, area.Top, area.Bottom - Height));
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        NativeWindow.RoundCorners(Handle);
        NativeWindow.DisableBackdrop(Handle);
        UpdateWindowRegion();
    }

    protected override void OnClientSizeChanged(EventArgs e)
    {
        base.OnClientSizeChanged(e);
        if (IsHandleCreated) UpdateWindowRegion();
    }

    private void UpdateWindowRegion()
    {
        if (ClientSize.Width <= 0 || ClientSize.Height <= 0) return;
        var panes = windowPanes ?? [new WindowPane(0, 0, 1, 1, 18f / Math.Max(1, ClientSize.Width))];
        using var outline = new GraphicsPath();
        foreach (var pane in panes)
        {
            var bounds = new RectangleF(pane.X * ClientSize.Width, pane.Y * ClientSize.Height,
                pane.Width * ClientSize.Width, pane.Height * ClientSize.Height);
            var diameter = Math.Min(pane.Radius * ClientSize.Width * 2, Math.Min(bounds.Width, bounds.Height));
            if (diameter < 1) { outline.AddRectangle(bounds); continue; }
            outline.StartFigure();
            outline.AddArc(bounds.Left, bounds.Top, diameter, diameter, 180, 90);
            outline.AddArc(bounds.Right - diameter, bounds.Top, diameter, diameter, 270, 90);
            outline.AddArc(bounds.Right - diameter, bounds.Bottom - diameter, diameter, diameter, 0, 90);
            outline.AddArc(bounds.Left, bounds.Bottom - diameter, diameter, diameter, 90, 90);
            outline.CloseFigure();
        }
        var previous = Region;
        Region = new Region(outline);
        previous?.Dispose();
    }

    private void SetWindowShape(JsonElement message)
    {
        static bool Number(JsonElement value, string key, out float number)
        {
            number = 0;
            return value.TryGetProperty(key, out var item) && item.ValueKind == JsonValueKind.Number
                && item.TryGetSingle(out number) && float.IsFinite(number);
        }
        if (!Number(message, "viewportWidth", out var width) || !Number(message, "viewportHeight", out var height)
            || width < 1 || height < 1 || width > 100000 || height > 100000
            || !message.TryGetProperty("panes", out var items) || items.ValueKind != JsonValueKind.Array
            || items.GetArrayLength() != (platform is null ? 2 : 1)) return;
        var panes = new List<WindowPane>();
        foreach (var item in items.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object || !Number(item, "x", out var x) || !Number(item, "y", out var y)
                || !Number(item, "width", out var w) || !Number(item, "height", out var h) || !Number(item, "radius", out var radius)
                || x < 0 || y < 0 || w < 1 || h < 1 || x + w > width + .1f || y + h > height + .1f || radius < 0 || radius > 100) return;
            panes.Add(new(x / width, y / height, w / width, h / height, radius / width));
        }
        windowPanes = panes.ToArray();
        UpdateWindowRegion();
    }

    private void ApplyAppearance(string mode, bool systemDark)
    {
        var preferred = mode switch
        {
            "dark" => CoreWebView2PreferredColorScheme.Dark,
            "light" => CoreWebView2PreferredColorScheme.Light,
            _ => CoreWebView2PreferredColorScheme.Auto,
        };
        if (web?.CoreWebView2 is { } core && core.Profile.PreferredColorScheme != preferred)
            core.Profile.PreferredColorScheme = preferred;
        var dark = mode == "dark" || (mode != "light" && systemDark);
        NativeWindow.SetDarkMode(Handle, dark);
        BackColor = SystemInformation.HighContrast ? SystemColors.Window
            : dark ? Color.FromArgb(32, 35, 40) : Color.FromArgb(245, 246, 248);
        if (web is not null) web.DefaultBackgroundColor = BackColor;
    }

    internal DesktopWindow(DesktopContext desktop, LocalService service, string? platform, string? snapshot = null)
    {
        this.desktop = desktop; this.service = service; this.platform = platform; this.snapshot = snapshot;
        SuspendLayout();
        Text = platform is null ? "CourseWatch" : PlatformNames[platform] + "设置";
        FormBorderStyle = FormBorderStyle.None;
        MaximizeBox = false;
        AutoScaleDimensions = new SizeF(96F, 96F);
        AutoScaleMode = AutoScaleMode.Dpi;
        ClientSize = platform is null ? new Size(1060, 720) : new Size(660, 700);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = SystemColors.Window;
        var iconPath = Path.Combine(AppContext.BaseDirectory, "CourseWatch.ico");
        if (File.Exists(iconPath)) Icon = new Icon(iconPath);
        status = new Label { Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleCenter, Text = "正在启动 CourseWatch…", Font = new Font("Microsoft YaHei UI", 12), Padding = new Padding(32), BackColor = SystemColors.Window, ForeColor = SystemColors.WindowText };
        Controls.Add(status);
        fallback = new FlowLayoutPanel { Dock = DockStyle.Top, FlowDirection = FlowDirection.RightToLeft, Height = 32, Padding = Padding.Empty, Margin = Padding.Empty, BackColor = SystemColors.Window };
        var close = CaptionButton("\uE8BB", "关闭窗口", true);
        var minimize = CaptionButton("\uE921", "最小化窗口", false);
        close.Click += (_, _) => Close(); minimize.Click += (_, _) => WindowState = FormWindowState.Minimized;
        fallback.Controls.AddRange([close, minimize]);
        Controls.Add(fallback); fallback.BringToFront();
        Activated += async (_, _) => { idleTimer.Stop(); SetLowMemory(false); if (platform is null) desktop.RestorePlatformWindows(); await DispatchAsync("coursewatch:visibility", true); await EnsureBrowserAsync(); };
        Deactivate += async (_, _) => { await DispatchAsync("coursewatch:visibility", false); idleTimer.Start(); };
        Resize += async (_, _) =>
        {
            if (WindowState == FormWindowState.Minimized) await SuspendAsync();
            else if (Visible) await EnsureBrowserAsync();
        };
        VisibleChanged += async (_, _) => { if (!Visible) await SuspendAsync(); };
        idleTimer.Tick += async (_, _) => { idleTimer.Stop(); await SuspendAsync(); };
        FormClosing += OnClosing;
        FormClosed += (_, _) => { idleTimer.Dispose(); DisposeRenderer(); Icon?.Dispose(); };
        ResumeLayout(true);
    }

    private static Button CaptionButton(string glyph, string name, bool close)
    {
        var font = new Font("Segoe MDL2 Assets", 10);
        var button = new Button { Text = glyph, Width = 32, Height = 32, FlatStyle = FlatStyle.Flat, AccessibleName = name, Font = font, Margin = Padding.Empty, Padding = Padding.Empty, TabStop = true };
        button.FlatAppearance.BorderSize = 0;
        button.FlatAppearance.MouseOverBackColor = close ? Color.FromArgb(196, 43, 28) : SystemColors.ControlLight;
        button.MouseEnter += (_, _) => { if (close) button.ForeColor = Color.White; };
        button.MouseLeave += (_, _) => button.ForeColor = SystemColors.ControlText;
        button.Disposed += (_, _) => font.Dispose();
        return button;
    }

    private void SetLowMemory(bool low)
    {
        // Supported by recent WebView2 runtimes; older runtimes keep working.
        try { if (web?.CoreWebView2 is { } core) core.MemoryUsageTargetLevel = low ? CoreWebView2MemoryUsageTargetLevel.Low : CoreWebView2MemoryUsageTargetLevel.Normal; }
        catch (NotImplementedException) { }
        catch (COMException) { }
    }

    internal void ShowError(string text)
    {
        windowPanes = null;
        UpdateWindowRegion();
        PageReady = false;
        status.Text = text;
        status.Visible = true;
        status.BringToFront();
        if (web is not null) web.Visible = false;
        fallback.Visible = true;
        fallback.BringToFront();
    }

    internal async Task EnsureBrowserAsync()
    {
        if (!desktop.Ready || IsDisposed || closing || !Visible || WindowState == FormWindowState.Minimized || attaching || web is not null) return;
        attaching = true;
        var candidate = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = BackColor };
        web = candidate;
        Controls.Add(candidate); candidate.BringToFront();
        try
        {
            var environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(LocalService.DataDirectory, "webview2"));
            if (candidate.IsDisposed || closing) return;
            await candidate.EnsureCoreWebView2Async(environment);
            var core = candidate.CoreWebView2;
            core.Settings.AreHostObjectsAllowed = false;
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsZoomControlEnabled = false;
            core.Settings.IsPinchZoomEnabled = false;
            core.PermissionRequested += (_, e) => e.State = CoreWebView2PermissionState.Deny;
            core.DownloadStarting += (_, e) => e.Cancel = true;
            core.NavigationStarting += (_, e) =>
            {
                if (IsLocal(e.Uri)) return;
                e.Cancel = true;
                if (e.IsUserInitiated) OpenExternal(e.Uri, true);
            };
            core.NewWindowRequested += (_, e) => { e.Handled = true; if (e.IsUserInitiated) OpenExternal(e.Uri, true); };
            core.WebMessageReceived += async (_, e) =>
            {
                if (!IsLocal(e.Source)) return;
                try
                {
                    using var json = JsonDocument.Parse(e.WebMessageAsJson);
                    if (json.RootElement.ValueKind != JsonValueKind.Object) return;
                    await HandleMessageAsync(json.RootElement.Clone());
                }
                catch { /* Malformed or stale page messages have no native effect. */ }
            };
            core.ProcessFailed += (_, _) => ShowError("界面进程已退出，请关闭窗口后从托盘重新打开。");
            core.NavigationCompleted += async (_, e) =>
            {
                if (!e.IsSuccess || !IsLocal(core.Source)) { ShowError("无法加载界面，请退出 CourseWatch 后重试。"); return; }
                status.Visible = false;
                fallback.Visible = false;
                PageReady = true;
                await DispatchAsync("coursewatch:visibility", ContainsFocus);
                if (platform is null) await ReportRendererAsync("active");
                await desktop.NotificationStatusAsync(this);
                if (platform is null) await desktop.SendPreferencesAsync(this);
                if (closePromptOpen) await DispatchAsync("coursewatch:closeRequested");
                await desktop.FocusPendingAsync();
                if (!ContainsFocus) idleTimer.Start();
            };
            var state = snapshot ?? "null";
            await core.AddScriptToExecuteOnDocumentCreatedAsync($$"""
                if(window===window.top && location.origin==='{{LocalService.Origin}}') {
                  localStorage.setItem('coursewatch-client-token',{{JsonSerializer.Serialize(service.Token)}});
                  window.__coursewatchPlatform='windows';
                  window.__coursewatchInitialState={{state}};
                  const mark=()=>{document.documentElement.dataset.native='true';document.documentElement.dataset.platform='windows';};
                  if(document.documentElement) mark(); else document.addEventListener('DOMContentLoaded',mark,{once:true});
                }
                """);
            core.Navigate(LocalService.Origin + "/?desktop=1" + (platform is null ? "" : "&platform=" + platform));
        }
        catch
        {
            DisposeRenderer();
            ShowError("无法启动界面，请安装 Microsoft Edge WebView2 Runtime 后重新打开 CourseWatch。");
        }
        finally { attaching = false; }
    }

    internal async Task SuspendAsync()
    {
        if (web is not { CoreWebView2: not null } current || !PageReady || ContainsFocus || suspending || closing) return;
        SetLowMemory(true);
        // Keep a visible inactive page so switching apps does not recreate it.
        // Hidden/minimized windows still release the renderer and retain drafts.
        if (Visible && WindowState != FormWindowState.Minimized) return;
        suspending = true;
        try
        {
            var value = await current.CoreWebView2.ExecuteScriptAsync("window.__coursewatchSnapshot?.() ?? null");
            if (IsDisposed || web != current || ContainsFocus || current.IsDisposed) return;
            using var json = JsonDocument.Parse(value);
            if (json.RootElement.ValueKind != JsonValueKind.Object || json.RootElement.GetProperty("busy").GetBoolean()) return;
            snapshot = value;
            DisposeRenderer();
            if (platform is null) await ReportRendererAsync("suspended");
        }
        catch { /* Keep a live page if its current edits cannot be captured. */ }
        finally { suspending = false; }
    }

    private async void OnClosing(object? sender, FormClosingEventArgs e)
    {
        if (e.CloseReason is CloseReason.WindowsShutDown or CloseReason.TaskManagerClosing)
        {
            forceClose = true;
            desktop.Post(async () => await desktop.QuitAsync());
            return;
        }
        if (forceClose || platform is not null) return;
        e.Cancel = true;
        if (closing || closePromptOpen) return;
        var behavior = desktop.Preferences.Value.CloseBehavior;
        if (behavior == "ask")
        {
            closePromptOpen = true;
            if (PageReady) await DispatchAsync("coursewatch:closeRequested");
            else
            {
                // The same choices remain available if WebView2 cannot load.
                var tray = new TaskDialogButton("隐藏到系统托盘");
                var quit = new TaskDialogButton("退出 CourseWatch");
                var remember = new TaskDialogVerificationCheckBox("记住我的选择") { Checked = true };
                var page = new TaskDialogPage
                {
                    Caption = "CourseWatch", Heading = "关闭 CourseWatch？",
                    Text = "隐藏到系统托盘后继续检查任务和发送提醒。退出 CourseWatch 会停止后台和提醒。",
                    Buttons = { tray, quit, TaskDialogButton.Cancel }, Verification = remember,
                    AllowCancel = true,
                };
                var chosen = TaskDialog.ShowDialog(this, page);
                if (chosen == tray || chosen == quit) await CompleteCloseAsync(chosen == tray ? "tray" : "quit", remember.Checked);
                else closePromptOpen = false;
            }
        }
        else await CompleteCloseAsync(behavior, false);
    }

    private async Task CompleteCloseAsync(string behavior, bool remember)
    {
        if (platform is not null || closing || behavior is not ("tray" or "quit")) return;
        if (remember)
        {
            try { desktop.Preferences.SaveCloseBehavior(behavior); }
            catch
            {
                if (PageReady) await LifecycleResultAsync("close", false, "无法保存关闭方式，请确认 CourseWatch 的数据目录可写后重试。");
                else { closePromptOpen = false; MessageBox.Show(this, "无法保存关闭方式，请重试或取消记住选择。", "CourseWatch"); }
                return;
            }
        }
        closing = true;
        closePromptOpen = false;
        if (PageReady) await LifecycleResultAsync("close", true);
        if (behavior == "quit") { await desktop.QuitAsync(); return; }
        if (web is { CoreWebView2: not null })
        {
            try
            {
                var value = await web.CoreWebView2.ExecuteScriptAsync("window.__coursewatchSnapshot?.() ?? null");
                using var json = JsonDocument.Parse(value);
                if (json.RootElement.ValueKind == JsonValueKind.Object) snapshot = value;
            }
            catch { }
        }
        Hide(); DisposeRenderer();
        await ReportRendererAsync("closed");
        ClosedToTray?.Invoke(snapshot);
        forceClose = true;
        Close();
    }

    private Task LifecycleResultAsync(string kind, bool ok, string? error = null) =>
        DispatchAsync("coursewatch:lifecycleResult", new { kind, ok, error, preferences = desktop.Preferences.Value });

    internal void ForceClose() { if (IsDisposed) return; forceClose = true; Close(); Dispose(); }

    private void DisposeRenderer()
    {
        PageReady = false;
        web?.Dispose(); web = null;
    }

    internal async Task DispatchAsync(string name, object? detail = null)
    {
        if (!PageReady || web?.CoreWebView2 is null) return;
        try { await web.CoreWebView2.ExecuteScriptAsync($"window.dispatchEvent(new CustomEvent({JsonSerializer.Serialize(name)},{{detail:{JsonSerializer.Serialize(detail, BridgeJson)}}}))"); }
        catch { }
    }

    private async Task ReportRendererAsync(string state)
    {
        try { await service.RequestAsync("native/renderer", HttpMethod.Post, new { state }); }
        catch { }
    }

    private async Task HandleMessageAsync(JsonElement message)
    {
        if (!message.TryGetProperty("action", out var action) || action.ValueKind != JsonValueKind.String) return;
        string? Text(string key) => message.TryGetProperty(key, out var item) && item.ValueKind == JsonValueKind.String ? item.GetString() : null;
        switch (action.GetString())
        {
            case "windowShape": SetWindowShape(message); break;
            case "close": Close(); break;
            case "minimize": if (platform is null) desktop.MinimizeMain(); else WindowState = FormWindowState.Minimized; break;
            case "hide": desktop.HideToTray(); break;
            case "drag": BeginInvoke(() => NativeWindow.StartDrag(Handle)); break;
            case "preferences": if (platform is null) await desktop.SendPreferencesAsync(this); break;
            case "cancelClose": closePromptOpen = false; break;
            case "closeChoice":
                if (Text("behavior") is { } choice)
                    await CompleteCloseAsync(choice, message.TryGetProperty("remember", out var remember) && remember.ValueKind == JsonValueKind.True);
                break;
            case "saveStartupPreferences":
                if (platform is not null) break;
                if (!message.TryGetProperty("backgroundEnabled", out var background) || background.ValueKind is not (JsonValueKind.True or JsonValueKind.False)
                    || !message.TryGetProperty("launchAtLogin", out var launch) || launch.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) break;
                try
                {
                    desktop.Preferences.SaveStartup(background.GetBoolean(), launch.GetBoolean());
                    await LifecycleResultAsync("startup", true);
                }
                catch { await LifecycleResultAsync("startup", false, "无法保存启动设置，请确认 CourseWatch 的数据目录和当前用户的启动设置可写后重试。"); }
                break;
            case "saveCloseBehavior":
                if (platform is not null || Text("behavior") is not { } changed || !DesktopPreferencesStore.ValidBehavior(changed)) break;
                try { desktop.Preferences.SaveCloseBehavior(changed); await LifecycleResultAsync("settings", true); }
                catch { await LifecycleResultAsync("settings", false, "无法保存关闭方式，请确认 CourseWatch 的数据目录可写后重试。"); }
                break;
            case "openPlatform": if (Text("platform") is { } open) desktop.OpenPlatform(open); break;
            case "closePlatform": if (platform is not null) Close(); break;
            case "dismissPlatform": if (Text("platform") is { } dismiss) desktop.DismissPlatform(dismiss); break;
            case "openExternal": if (Text("url") is { } url) OpenExternal(url, false); break;
            case "refresh": await desktop.RefreshAsync(this); break;
            case "settled": if (!ContainsFocus) await SuspendAsync(); break;
            case "notifications": await desktop.DeliverAsync(); break;
            case "notificationStatus": await desktop.NotificationStatusAsync(this); break;
            case "authorizeNotifications": await desktop.NotificationStatusAsync(this); break;
            case "configureNotifications":
                await desktop.NotificationStatusAsync(this);
                MessageBox.Show(this, "请在 Windows 设置 → 系统 → 通知中允许 CourseWatch 发送通知。请勿打扰可能阻止横幅显示。", "系统通知");
                break;
            case "notificationSettings": Process.Start(new ProcessStartInfo("ms-settings:notifications") { UseShellExecute = true }); break;
            case "appearance":
                ApplyAppearance(Text("mode") ?? "system", message.TryGetProperty("dark", out var dark) && dark.ValueKind == JsonValueKind.True);
                break;
            case "export": await ExportAsync(); break;
            case "exportDiagnostics": await ExportAsync("diagnostics/export", "coursewatch-system-logs.json"); break;
        }
    }

    private async Task ExportAsync(string endpoint = "export", string filename = "coursewatch-tasks.json")
    {
        try
        {
            var data = await service.RequestAsync(endpoint);
            using var dialog = new SaveFileDialog { FileName = filename, Filter = "JSON 文件 (*.json)|*.json", AddExtension = true };
            if (dialog.ShowDialog(this) != DialogResult.OK) return;
            await File.WriteAllTextAsync(dialog.FileName, JsonSerializer.Serialize(data, new JsonSerializerOptions { WriteIndented = true }));
        }
        catch { MessageBox.Show(this, "导出未完成，请确认文件可写后重试。", "CourseWatch"); }
    }

    internal static bool IsLocal(string? value) => Uri.TryCreate(value, UriKind.Absolute, out var uri) && uri.Scheme == "http" && uri.Host == "127.0.0.1" && uri.Port == 17321 && uri.UserInfo.Length == 0;

    private static void OpenExternal(string value, bool officialOnly)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) || uri.Scheme != "https" || uri.UserInfo.Length != 0 || !uri.IsDefaultPort || (officialOnly && !OfficialHosts.Contains(uri.Host))) return;
        try { Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true }); }
        catch { MessageBox.Show("无法打开链接，请检查默认浏览器设置。", "CourseWatch"); }
    }

    protected override void WndProc(ref Message m)
    {
        // Fixed size: ignore resizing/maximizing from the system menu or caption.
        if (m.Msg == 0x83) { m.Result = 0; return; }
        if (m.Msg == 0xA3 || (m.Msg == 0x112 && ((long)m.WParam & 0xfff0) is 0xf000 or 0xf030)) return;
        if (m.Msg == 0x84)
        {
            m.Result = 1; // HTCLIENT: no resize border.
            return;
        }
        base.WndProc(ref m);
    }
}

internal static class NativeWindow
{
    [StructLayout(LayoutKind.Sequential)] private struct Margins { public int Left, Right, Top, Bottom; }
    [DllImport("user32.dll")] private static extern bool ReleaseCapture();
    [DllImport("user32.dll")] private static extern nint SendMessage(nint window, uint message, nint wParam, nint lParam);
    [DllImport("dwmapi.dll")] private static extern int DwmSetWindowAttribute(nint window, int attribute, ref int value, int size);
    [DllImport("dwmapi.dll")] private static extern int DwmExtendFrameIntoClientArea(nint window, ref Margins margins);
    internal static void StartDrag(nint window) { ReleaseCapture(); SendMessage(window, 0xA1, 2, 0); }
    internal static void RoundCorners(nint window)
    {
        var preference = 2; // DWMWCP_ROUND
        DwmSetWindowAttribute(window, 33, ref preference, sizeof(int));
        var border = unchecked((int)0xfffffffe); // DWMWA_COLOR_NONE
        DwmSetWindowAttribute(window, 34, ref border, sizeof(int));
        var rendering = 1; // DWMNCRP_DISABLED: no rectangular frame or shadow.
        DwmSetWindowAttribute(window, 2, ref rendering, sizeof(int));
    }
    internal static void SetDarkMode(nint window, bool dark)
    {
        var value = dark ? 1 : 0;
        DwmSetWindowAttribute(window, 20, ref value, sizeof(int));
    }
    internal static void DisableBackdrop(nint window)
    {
        // Keep the WinForms/WebView2 surface bounded. Extending the whole native
        // frame behind a transparent child can leave a separate light surface.
        var backdrop = 1; // DWMSBT_NONE
        DwmSetWindowAttribute(window, 38, ref backdrop, sizeof(int));
        var margins = new Margins();
        DwmExtendFrameIntoClientArea(window, ref margins);
    }
}
