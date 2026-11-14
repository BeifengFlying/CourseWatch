using CourseWatch;
using System.Text.Json;

var directory = Path.Combine(Path.GetTempPath(), "CourseWatch-preferences-checks-" + Guid.NewGuid().ToString("N"));
var executable = @"C:\应用 测试\CourseWatch.exe";
var registration = new FakeStartup();
var checks = 0;
void Check(bool valid, string message) { if (!valid) throw new Exception(message); checks++; }
try
{
    var store = new DesktopPreferencesStore(directory, executable, registration);
    Check(!store.Value.SetupCompleted && !store.Value.LaunchAtLogin && store.Value.CloseBehavior == "ask", "Fresh settings must ask before closing.");
    Check(registration.Writes == 0 && !Directory.Exists(directory), "Opening preferences must not register startup or create files.");
    store.SaveStartup(true, false);
    Check(store.Value.SetupCompleted && store.Value.CloseBehavior == "ask", "Finishing setup must still offer the first close choice.");
    Check(registration.Writes == 0, "Startup must remain unregistered when disabled.");
    store.SaveStartup(true, true);
    Check(registration.Command == "\"" + executable + "\" --background", "Background startup must quote the actual executable path.");
    var reopened = new DesktopPreferencesStore(directory, executable, registration);
    Check(reopened.Value == store.Value, "Setup and startup settings must survive reopening.");
    store.SaveCloseBehavior("quit");
    Check(!store.Value.BackgroundEnabled && store.Value.CloseBehavior == "quit" && registration.Command == "\"" + executable + "\"", "Quitting must disable background startup while preserving login startup.");
    store.SaveCloseBehavior("tray");
    Check(store.Value.BackgroundEnabled && registration.Command!.EndsWith(" --background"), "Remembering tray close must allow background startup.");
    store.SaveCloseBehavior("ask");
    Check(store.Value.CloseBehavior == "ask" && store.Value.BackgroundEnabled, "Ask mode must preserve the chosen background preference.");
    var before = store.Value;
    registration.FailWrite = true;
    try { store.SaveStartup(false, false); throw new Exception("Expected registry failure."); }
    catch (IOException) { }
    Check(store.Value == before && new DesktopPreferencesStore(directory, executable, registration).Value == before, "A startup registration failure must preserve the previous settings.");
    Check(!File.Exists(Path.Combine(directory, "desktop-preferences.json.tmp")), "A failed save must not leave temporary settings.");
    registration.FailWrite = false;
    store.SaveStartup(false, false);
    Check(registration.Command is null && !store.Value.BackgroundEnabled, "Disabling startup must remove only this app's registration.");
    var file = Path.Combine(directory, "desktop-preferences.json");
    File.WriteAllText(file, "{ invalid json");
    Check(!new DesktopPreferencesStore(directory, executable, registration).Value.SetupCompleted, "Corrupt settings must return to explicit setup.");
    File.WriteAllText(file, JsonSerializer.Serialize(new { setupCompleted = true, closeBehavior = "invalid" }));
    Check(new DesktopPreferencesStore(directory, executable, registration).Value.CloseBehavior == "ask", "Unknown close choices must not exit without asking.");
    registration.Command = @"C:\old\CourseWatch.exe";
    var writes = registration.Writes;
    Check(!new DesktopPreferencesStore(directory, executable, registration).Value.LaunchAtLogin && registration.Writes == writes, "Reading a moved app must not silently rewrite startup.");
    var blocked = Path.Combine(directory, "blocked-save");
    Directory.CreateDirectory(Path.Combine(blocked, "desktop-preferences.json"));
    registration.Command = null;
    var blockedStore = new DesktopPreferencesStore(blocked, executable, registration);
    try { blockedStore.SaveStartup(true, true); throw new Exception("Expected file commit failure."); }
    catch (Exception error) when (error is IOException or UnauthorizedAccessException) { }
    Check(registration.Command is null && !blockedStore.Value.SetupCompleted, "A file commit failure must roll back the startup registration.");
    Console.WriteLine($"{checks} Windows preference checks passed; no real startup registration was changed.");
}
finally { if (Directory.Exists(directory)) Directory.Delete(directory, recursive: true); }

sealed class FakeStartup : IStartupRegistration
{
    internal string? Command;
    internal int Writes;
    internal bool FailWrite;
    public string? Read() => Command;
    public void Write(string? command)
    {
        if (FailWrite) throw new IOException("Simulated registry write failure.");
        Writes++; Command = command;
    }
}
