using CourseWatch;
var directory = Path.Combine(Path.GetTempPath(), "CourseWatch-agreement-" + Guid.NewGuid().ToString("N"));
try
{
    var store = new AgreementAcceptance(directory);
    if (store.IsAccepted || Directory.Exists(directory)) throw new Exception("Reading must not accept or create state.");
    store.Accept();
    if (!new AgreementAcceptance(directory).IsAccepted) throw new Exception("Accepted revision must survive reopening.");
    var file = Path.Combine(directory, "user-agreement.json");
    File.WriteAllText(file, "{ invalid json");
    if (store.IsAccepted) throw new Exception("Corrupt state must require consent.");
    File.WriteAllText(file, "{\"Revision\":\"older-terms\",\"AcceptedAt\":\"2026-01-01T00:00:00Z\"}");
    if (store.IsAccepted) throw new Exception("An unrelated revision cannot accept current terms.");
    File.Delete(file); Directory.CreateDirectory(file);
    try { store.Accept(); throw new Exception("Expected save failure."); }
    catch (Exception error) when (error is IOException or UnauthorizedAccessException) { }
    if (store.IsAccepted || File.Exists(file + ".tmp")) throw new Exception("Failed commit must not accept or leave a temporary receipt.");
    Console.WriteLine("Agreement receipt: fresh state, accepted restart, corruption, revision and failed commit checks passed.");
}
finally { if (Directory.Exists(directory)) Directory.Delete(directory, recursive: true); }
