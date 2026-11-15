using System.Text.Json;

namespace CourseWatch;

internal sealed class AgreementAcceptance(string directory)
{
    internal const string Revision = "2026-11-15";
    private string PathName => Path.Combine(directory, "user-agreement.json");
    private sealed record Receipt(string Revision, DateTimeOffset AcceptedAt);

    internal bool IsAccepted
    {
        get
        {
            try
            {
                var receipt = JsonSerializer.Deserialize<Receipt>(File.ReadAllText(PathName));
                return receipt?.Revision == Revision && receipt.AcceptedAt != default;
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException) { return false; }
        }
    }

    internal void Accept()
    {
        Directory.CreateDirectory(directory);
        var temporary = PathName + ".tmp";
        try
        {
            File.WriteAllText(temporary, JsonSerializer.Serialize(new Receipt(Revision, DateTimeOffset.UtcNow)));
            File.Move(temporary, PathName, overwrite: true);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }
}
