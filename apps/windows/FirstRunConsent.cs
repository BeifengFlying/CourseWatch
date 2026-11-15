using System.Diagnostics;

namespace CourseWatch;

internal sealed class FirstRunConsent : Form
{
    private const string ProjectAddress = "https://github.com/BeifengFlying/CourseWatch";

    internal static bool RequestIfNeeded()
    {
        var acceptance = new AgreementAcceptance(LocalService.DataDirectory);
        if (acceptance.IsAccepted) return true;
        string terms;
        try
        {
            terms = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "resources", "TERMS.md"));
            if (string.IsNullOrWhiteSpace(terms)) throw new IOException();
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            MessageBox.Show("无法读取用户协议。请重新下载完整安装包后再打开 CourseWatch。", "CourseWatch", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return false;
        }
        using var dialog = new FirstRunConsent(terms, acceptance);
        return dialog.ShowDialog() == DialogResult.OK;
    }

    internal FirstRunConsent(string terms, AgreementAcceptance acceptance)
    {
        Text = "用户协议与免费声明";
        AutoScaleMode = AutoScaleMode.Dpi;
        Font = new Font(SystemFonts.MessageBoxFont?.FontFamily ?? FontFamily.GenericSansSerif, 11);
        ClientSize = new Size(580, 580);
        MinimumSize = new Size(360, 480);
        StartPosition = FormStartPosition.CenterScreen;
        MaximizeBox = false;
        MinimizeBox = false;
        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(20), ColumnCount = 1, RowCount = 6 };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        var free = new Label { Text = "本软件完全免费。", AutoSize = true, Dock = DockStyle.Fill, Font = new Font(Font.FontFamily, 14, FontStyle.Bold), Margin = new Padding(0, 0, 0, 12) };
        var notice = new Label { Text = "如果你是在其他付费渠道获取此软件，请立即退款并举报该商家。", AutoSize = true, Dock = DockStyle.Fill, Margin = new Padding(0, 0, 0, 12) };
        var project = new LinkLabel { Text = "项目源码地址：" + ProjectAddress, AutoSize = true, Dock = DockStyle.Fill, Margin = new Padding(0, 0, 0, 12) };
        project.LinkArea = new LinkArea("项目源码地址：".Length, ProjectAddress.Length);
        project.LinkClicked += (_, _) =>
        {
            try { Process.Start(new ProcessStartInfo(ProjectAddress) { UseShellExecute = true }); }
            catch { MessageBox.Show("无法打开项目地址，请在浏览器中访问：" + ProjectAddress, "CourseWatch"); }
        };
        var heading = new Label { Text = "使用前请阅读下方《用户协议》，确认同意后继续使用。", AutoSize = true, Dock = DockStyle.Fill, Margin = new Padding(0, 0, 0, 8) };
        var document = new RichTextBox { Text = terms, ReadOnly = true, Dock = DockStyle.Fill, DetectUrls = false, WordWrap = true, ScrollBars = RichTextBoxScrollBars.Vertical, BackColor = SystemColors.Window, ForeColor = SystemColors.WindowText, AccessibleName = "用户协议全文", Margin = new Padding(0, 0, 0, 12) };
        var buttons = new FlowLayoutPanel { Dock = DockStyle.Fill, AutoSize = true, FlowDirection = FlowDirection.RightToLeft, WrapContents = true, Margin = Padding.Empty };
        var agree = new Button { Text = "同意并继续", AutoSize = true, MinimumSize = new Size(112, 44) };
        var quit = new Button { Text = "退出软件", AutoSize = true, MinimumSize = new Size(100, 44), DialogResult = DialogResult.Cancel };
        agree.Click += (_, _) =>
        {
            try { acceptance.Accept(); DialogResult = DialogResult.OK; Close(); }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException)
            {
                MessageBox.Show(this, "无法保存协议确认。请检查当前用户资料目录是否可写后重试。", "CourseWatch", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        };
        buttons.Controls.Add(agree); buttons.Controls.Add(quit);
        layout.Controls.Add(free, 0, 0); layout.Controls.Add(notice, 0, 1); layout.Controls.Add(project, 0, 2);
        layout.Controls.Add(heading, 0, 3); layout.Controls.Add(document, 0, 4); layout.Controls.Add(buttons, 0, 5);
        Controls.Add(layout);
        CancelButton = quit;
        // Enter does not imply agreement; focus begins on the readable document.
        Shown += (_, _) => { document.Select(0, 0); document.Focus(); };
    }
}
