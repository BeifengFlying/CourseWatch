using System.IO.Pipes;
using System.Security.Principal;
using Microsoft.Toolkit.Uwp.Notifications;

namespace CourseWatch;

internal static class Program
{
    internal static readonly string UserKey = "CourseWatch-" + WindowsIdentity.GetCurrent().User!.Value;
    private static volatile DesktopContext? desktop;
    private static volatile string? pendingEntry;

    [STAThread]
    private static void Main(string[] args)
    {
        ApplicationConfiguration.Initialize();
        if (args is ["--unregister-notifications"])
        {
            ToastNotificationManagerCompat.Uninstall();
            new WindowsStartupRegistration().Write(null);
            return;
        }
        using var mutex = new Mutex(true, @"Local\" + UserKey, out var first);
        if (args is ["--quit"])
        {
            if (!first)
            {
                if (!SendToRunning("", quit: true)) { Environment.ExitCode = 1; return; }
                try
                {
                    if (mutex.WaitOne(TimeSpan.FromSeconds(15))) mutex.ReleaseMutex();
                    else Environment.ExitCode = 1;
                }
                catch (AbandonedMutexException) { mutex.ReleaseMutex(); }
            }
            else mutex.ReleaseMutex();
            return;
        }
        using var activated = new ManualResetEventSlim();
        ToastNotificationManagerCompat.OnActivated += args =>
        {
            var values = ToastArguments.Parse(args.Argument);
            var entry = values.TryGetValue("entryId", out var value) ? value : "";
            if (entry.Length > 200) entry = "";
            if (!first) SendToRunning(entry);
            else if (desktop is { } context) context.Post(() => context.ShowMain(entry));
            else pendingEntry = entry;
            activated.Set();
        };
        if (!first)
        {
            if (ToastNotificationManagerCompat.WasCurrentProcessToastActivated()) activated.Wait(TimeSpan.FromSeconds(10));
            else if (args is not ["--background"]) SendToRunning("");
            return;
        }
        try
        {
            if (!FirstRunConsent.RequestIfNeeded()) return;
            desktop = new DesktopContext(pendingEntry, args is ["--background"]);
            if (pendingEntry is { } entry) desktop.ShowMain(entry);
            Application.Run(desktop);
        }
        catch
        {
            MessageBox.Show("无法启动 CourseWatch。请确认安装文件完整，且已安装 Microsoft Edge WebView2 Runtime。", "CourseWatch", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        finally
        {
            desktop?.Dispose();
            desktop = null;
            mutex.ReleaseMutex();
        }
    }

    private static bool SendToRunning(string entry, bool quit = false)
    {
        try
        {
            using var pipe = new NamedPipeClientStream(".", UserKey, PipeDirection.Out, PipeOptions.CurrentUserOnly);
            pipe.Connect(5000);
            using var writer = new StreamWriter(pipe) { AutoFlush = true };
            writer.WriteLine(quit ? "quit" : "show:" + entry);
            return true;
        }
        catch
        {
            if (!quit) MessageBox.Show("CourseWatch 已在运行，但窗口尚未响应。请稍后从托盘打开。", "CourseWatch");
            return false;
        }
    }
}
