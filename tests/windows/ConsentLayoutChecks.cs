using System.Text.Json;

namespace CourseWatch;

// This host only opens consent forms with temporary receipts. No service,
// startup registration or production user directory is accessed.
internal static class LocalService
{
    internal static string DataDirectory => throw new InvalidOperationException("Production data is unavailable in layout checks.");
}

internal static class ConsentLayoutChecks
{
    private static int checks;
    private static void Check(bool value, string message)
    {
        if (!value) throw new InvalidOperationException(message);
        checks++;
    }

    [STAThread]
    private static int Main(string[] args)
    {
        Application.SetHighDpiMode(args.Contains("--dpi96") ? HighDpiMode.DpiUnaware : HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        var directory = Path.Combine(Path.GetTempPath(), "cw-consent-layout-" + Guid.NewGuid().ToString("N"));
        var output = Path.GetFullPath(".cache/windows-consent34");
        Directory.CreateDirectory(output);
        var dpi = 0;
        try
        {
            var terms = File.ReadAllText("TERMS.md");
            foreach (var dark in new[] { false, true })
            foreach (var logical in new[] { new Size(580, 580), new Size(360, 480) })
            {
                var receipt = new AgreementAcceptance(Path.Combine(directory, $"{dark}-{logical.Width}"));
                using var dialog = new FirstRunConsent(terms, receipt, dark);
                dialog.Show();
                dpi = dialog.DeviceDpi;
                var scale = dpi / 96f;
                dialog.ClientSize = new Size((int)(logical.Width * scale), (int)(logical.Height * scale));
                Application.DoEvents();
                Check(dialog.FormBorderStyle == FormBorderStyle.FixedDialog && !dialog.MaximizeBox && !dialog.MinimizeBox, "Consent window must have fixed borders.");
                var layout = (TableLayoutPanel)dialog.Controls[0];
                var rows = layout.Controls.Cast<Control>().OrderBy(c => layout.GetRow(c)).ToArray();
                var document = rows.OfType<RichTextBox>().Single();
                Check(document.ReadOnly && document.Text.Replace("\r\n", "\n") == terms.Replace("\r\n", "\n") && document.ScrollBars == RichTextBoxScrollBars.Vertical, "Full terms must remain readable and scrollable.");
                Check(document.Height >= 100 * scale, "Terms area is too short.");
                var previousBottom = layout.Padding.Top;
                foreach (var row in rows)
                {
                    Check(row.Left >= layout.Padding.Left && row.Right <= layout.ClientSize.Width - layout.Padding.Right, "Content extends beyond the form width.");
                    Check(row.Top >= previousBottom && row.Bottom <= layout.ClientSize.Height - layout.Padding.Bottom, "Content rows overlap or extend below the form.");
                    previousBottom = row.Bottom;
                    if (row is Label label)
                    {
                        var measured = TextRenderer.MeasureText(label.Text, label.Font, new Size(label.Width, int.MaxValue), TextFormatFlags.WordBreak | TextFormatFlags.NoPrefix);
                        Check(label.Height >= measured.Height - 2, "Consent text is clipped: " + label.Text);
                    }
                }
                var buttons = rows.Last().Controls.OfType<FlowLayoutPanel>().Single().Controls.OfType<Button>().ToArray();
                Check(buttons.Length == 2, "Both explicit choices must be offered.");
                foreach (var button in buttons)
                {
                    Check(button.Parent!.ClientRectangle.Contains(button.Bounds), "Consent button is clipped.");
                    var text = TextRenderer.MeasureText(button.Text, button.Font);
                    Check(button.Width >= text.Width && button.Height >= text.Height, "Consent button text is clipped.");
                }
                Check(!buttons[0].Bounds.IntersectsWith(buttons[1].Bounds), "Consent buttons overlap.");
                Check(dialog.AcceptButton is null && dialog.CancelButton is Button { Text: "退出软件" }, "Enter must not imply acceptance; Escape must quit.");
                Check(dialog.ActiveControl == document, "Focus should begin on the terms.");
                Check(!receipt.IsAccepted, "Opening the form must not accept terms.");
                Check(dark ? document.BackColor.R < 64 && document.ForeColor.R > 200 : document.BackColor.R > 200 && document.ForeColor.R < 64, "Terms colors do not follow the selected palette.");
                using (var bitmap = new Bitmap(dialog.Width, dialog.Height))
                {
                    dialog.DrawToBitmap(bitmap, new Rectangle(Point.Empty, bitmap.Size));
                    bitmap.Save(Path.Combine(output, $"{dpi}-{(dark ? "dark" : "light")}-{logical.Width}.png"));
                }
                var agree = buttons.Single(b => b.Text == "同意并继续");
                Check(!agree.Enabled, "Agreement must require scrolling to the bottom.");
                agree.PerformClick();
                Check(!receipt.IsAccepted, "A disabled agreement cannot save a receipt.");
                document.Select(document.TextLength / 2, 0); document.ScrollToCaret(); Application.DoEvents();
                Check(!agree.Enabled, "Partial reading cannot accept terms.");
                document.Select(document.TextLength, 0); document.ScrollToCaret(); Application.DoEvents(); Application.DoEvents();
                Check(agree.Enabled, "Reading to the bottom must enable agreement.");
                if (logical.Width == 580)
                {
                    buttons.Single(b => b.Text == "同意并继续").PerformClick();
                    Check(receipt.IsAccepted && dialog.DialogResult == DialogResult.OK, "Explicit agreement must save a receipt.");
                }
                else
                {
                    buttons.Single(b => b.Text == "退出软件").PerformClick();
                    Check(!receipt.IsAccepted && dialog.DialogResult == DialogResult.Cancel, "Quit must not save agreement.");
                }
                dialog.Close();
            }
            File.WriteAllText(Path.Combine(output, $"checks-{dpi}.json"), JsonSerializer.Serialize(new { checks, dpi, cases = 4, success = true }));
            return 0;
        }
        catch (Exception error)
        {
            File.WriteAllText(Path.Combine(output, $"checks-{dpi}.json"), JsonSerializer.Serialize(new { checks, dpi, success = false, error = error.ToString() }));
            return 1;
        }
        finally { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
    }
}
