using System.Text.Json;
using Microsoft.Win32;

namespace CourseWatch;

internal sealed record DesktopPreferences(bool SetupCompleted = false, bool BackgroundEnabled = true,
    bool LaunchAtLogin = false, string CloseBehavior = "ask");

internal interface IStartupRegistration
{
    string? Read();
    void Write(string? command);
}

internal sealed class WindowsStartupRegistration : IStartupRegistration
{
    private const string Key = @"Software\Microsoft\Windows\CurrentVersion\Run";
    public string? Read()
    {
        using var key = Registry.CurrentUser.OpenSubKey(Key);
        return key?.GetValue("CourseWatch") as string;
    }
    public void Write(string? command)
    {
        if (command is null)
        {
            using var key = Registry.CurrentUser.OpenSubKey(Key, writable: true);
            key?.DeleteValue("CourseWatch", throwOnMissingValue: false);
        }
        else
        {
            using var key = Registry.CurrentUser.CreateSubKey(Key);
            key.SetValue("CourseWatch", command, RegistryValueKind.String);
        }
    }
}

internal sealed class DesktopPreferencesStore
{
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, WriteIndented = true };
    private readonly string path, executable;
    private readonly IStartupRegistration startup;
    internal DesktopPreferences Value { get; private set; }

    internal DesktopPreferencesStore(string directory, string executable, IStartupRegistration startup)
    {
        path = Path.Combine(directory, "desktop-preferences.json");
        this.executable = executable;
        this.startup = startup;
        Value = new();
        try
        {
            var saved = JsonSerializer.Deserialize<DesktopPreferences>(File.ReadAllText(path), JsonOptions);
            if (saved is not null && ValidBehavior(saved.CloseBehavior)) Value = saved;
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException) { }
        // Reading settings never registers startup or rewrites an old path.
        Value = Value with { LaunchAtLogin = startup.Read() == StartupCommand(Value.BackgroundEnabled) };
    }

    internal static bool ValidBehavior(string value) => value is "ask" or "tray" or "quit";
    internal string StartupCommand(bool background) => "\"" + executable + "\"" + (background ? " --background" : "");
    internal void SaveStartup(bool background, bool launchAtLogin) => Save(Value with
    {
        SetupCompleted = true, BackgroundEnabled = background, LaunchAtLogin = launchAtLogin,
        CloseBehavior = Value.CloseBehavior == "ask" ? "ask" : background ? "tray" : "quit",
    });
    internal void SaveCloseBehavior(string behavior)
    {
        if (!ValidBehavior(behavior)) throw new ArgumentException("Unknown close behavior.");
        Save(Value with { CloseBehavior = behavior, BackgroundEnabled = behavior == "ask" ? Value.BackgroundEnabled : behavior == "tray" });
    }

    private void Save(DesktopPreferences next)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var temporary = path + ".tmp";
        var before = startup.Read();
        var command = next.LaunchAtLogin ? StartupCommand(next.BackgroundEnabled) : null;
        var changed = before != command;
        try
        {
            File.WriteAllText(temporary, JsonSerializer.Serialize(next, JsonOptions));
            if (changed) startup.Write(command);
            try { File.Move(temporary, path, overwrite: true); }
            catch { if (changed) startup.Write(before); throw; }
            Value = next;
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }
}
