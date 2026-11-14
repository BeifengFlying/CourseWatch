using System.Diagnostics;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;

namespace CourseWatch;

internal sealed class LocalService : IDisposable
{
    internal const string Origin = "http://127.0.0.1:17321";
    internal static readonly string DataDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CourseWatch");
    internal readonly string Token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
    private readonly HttpClient http = new() { BaseAddress = new Uri(Origin + "/api/"), Timeout = Timeout.InfiniteTimeSpan };
    private Process? child;
    private bool stopping;
    internal event Action? Exited;

    internal LocalService()
    {
        http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token);
        http.DefaultRequestHeaders.Add("Origin", Origin);
    }

    internal async Task StartAsync()
    {
        Directory.CreateDirectory(DataDirectory);
        var root = Path.Combine(AppContext.BaseDirectory, "resources");
        var info = new ProcessStartInfo(Path.Combine(root, "node.exe"))
        {
            WorkingDirectory = Path.Combine(root, "app"),
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        info.ArgumentList.Add("dist/server/apps/local-service/src/main.js");
        info.Environment.Remove("NODE_OPTIONS");
        info.Environment.Remove("NODE_PATH");
        info.Environment["COURSEWATCH_DATA_DIR"] = DataDirectory;
        info.Environment["COURSEWATCH_SERVICE_PORT"] = "17321";
        info.Environment["COURSEWATCH_NATIVE_TOKEN"] = Token;
        info.Environment["COURSEWATCH_NATIVE_NOTIFICATIONS"] = "1";
        info.Environment["COURSEWATCH_MANAGED_STDIN"] = "1";
        info.Environment["COURSEWATCH_BROWSER_MODE"] = "system";
        info.Environment.Remove("PLAYWRIGHT_BROWSERS_PATH");
        child = new Process { StartInfo = info, EnableRaisingEvents = true };
        child.Exited += (_, _) => { if (!stopping) Exited?.Invoke(); };
        child.Start();
        // Consume output without recording pairing codes, session data or tokens.
        child.BeginOutputReadLine();
        child.BeginErrorReadLine();
        for (var attempt = 0; attempt < 60; attempt++)
        {
            if (child.HasExited) throw new IOException("后台启动失败；请先退出其他 CourseWatch 后台，再重新打开应用。");
            try { await RequestAsync("health", timeoutSeconds: 1); return; }
            catch (HttpRequestException) { }
            catch (TaskCanceledException) { }
            await Task.Delay(300);
        }
        throw new IOException("后台启动超时，请退出 CourseWatch 后重试。");
    }

    internal async Task<JsonElement> RequestAsync(string path, HttpMethod? method = null, object? body = null, int timeoutSeconds = 12)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(timeoutSeconds));
        using var request = new HttpRequestMessage(method ?? HttpMethod.Get, path);
        if (body is not null) request.Content = JsonContent.Create(body);
        using var response = await http.SendAsync(request, timeout.Token);
        response.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(timeout.Token));
        return json.RootElement.Clone();
    }

    internal async Task StopAsync()
    {
        if (stopping) return;
        stopping = true;
        if (child is null || child.HasExited) return;
        try
        {
            await child.StandardInput.WriteLineAsync("shutdown");
            await child.StandardInput.FlushAsync();
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(8));
            await child.WaitForExitAsync(timeout.Token);
        }
        catch { if (!child.HasExited) child.Kill(entireProcessTree: true); }
    }

    public void Dispose()
    {
        if (child is { HasExited: false }) { try { child.Kill(entireProcessTree: true); } catch { } }
        child?.Dispose();
        http.Dispose();
    }
}
