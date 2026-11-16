using System.Diagnostics;
using System.Runtime.InteropServices;
using Microsoft.Win32;

namespace CourseWatch;

internal sealed class FirstRunConsent : Form
{
    private const string ProjectAddress = "https://github.com/BeifengFlying/CourseWatch";
    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(nint window, int attribute, ref int value, int size);
    [StructLayout(LayoutKind.Sequential)]
    private struct ScrollInfo
    {
        internal uint Size, Mask;
        internal int Min, Max;
        internal uint Page;
        internal int Position, TrackPosition;
    }
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetScrollInfo(nint window, int bar, ref ScrollInfo info);
    private readonly bool darkAppearance;

    private static bool SystemUsesDarkMode()
    {
        try { return Registry.GetValue(@"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize", "AppsUseLightTheme", 1) is int value && value == 0; }
        catch (Exception error) when (error is System.Security.SecurityException or UnauthorizedAccessException or IOException) { return false; }
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        var dark = darkAppearance ? 1 : 0;
        DwmSetWindowAttribute(Handle, 20, ref dark, sizeof(int));
        var corners = 2;
        DwmSetWindowAttribute(Handle, 33, ref corners, sizeof(int));
    }

    protected override void OnLoad(EventArgs e)
    {
        base.OnLoad(e);
        var area = Screen.FromControl(this).WorkingArea;
        var inset = (int)Math.Round(16 * DeviceDpi / 96f);
        Size = new Size(Math.Min(Width, Math.Max(1, area.Width - inset * 2)),
            Math.Min(Height, Math.Max(1, area.Height - inset * 2)));
        Location = new Point(area.Left + (area.Width - Width) / 2, area.Top + (area.Height - Height) / 2);
    }

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

    internal FirstRunConsent(string terms, AgreementAcceptance acceptance, bool? darkMode = null)
    {
        darkAppearance = !SystemInformation.HighContrast && (darkMode ?? SystemUsesDarkMode());
        var surface = SystemInformation.HighContrast ? SystemColors.Window : darkAppearance ? Color.FromArgb(32, 35, 40) : Color.FromArgb(245, 246, 248);
        var card = SystemInformation.HighContrast ? SystemColors.Window : darkAppearance ? Color.FromArgb(39, 43, 49) : Color.White;
        var ink = SystemInformation.HighContrast ? SystemColors.WindowText : darkAppearance ? Color.FromArgb(233, 236, 241) : Color.FromArgb(36, 41, 49);
        var accent = SystemInformation.HighContrast ? SystemColors.Highlight : darkAppearance ? Color.FromArgb(215, 172, 130) : Color.FromArgb(186, 129, 80);
        Text = "用户协议与免费声明";
        AutoScaleDimensions = new SizeF(96, 96);
        AutoScaleMode = AutoScaleMode.Dpi;
        Font = new Font(SystemFonts.MessageBoxFont?.FontFamily ?? FontFamily.GenericSansSerif, 11);
        BackColor = surface;
        ForeColor = ink;
        ClientSize = new Size(580, 580);
        FormBorderStyle = FormBorderStyle.FixedDialog;
        StartPosition = FormStartPosition.CenterScreen;
        MaximizeBox = false;
        MinimizeBox = false;
        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(20), ColumnCount = 1, RowCount = 6, BackColor = surface, ForeColor = ink };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        var free = new Label { Text = "本软件完全免费。", AutoSize = true, Dock = DockStyle.Fill, Font = new Font(Font.FontFamily, 14, FontStyle.Bold), Margin = new Padding(0, 0, 0, 12), UseMnemonic = false };
        var notice = new Label { Text = "如果你是在其他付费渠道获取此软件，请立即退款并举报该商家。", AutoSize = true, Dock = DockStyle.Fill, Margin = new Padding(0, 0, 0, 12) };
        var project = new LinkLabel { Text = "项目源码地址：" + ProjectAddress, AutoSize = true, Dock = DockStyle.Fill, Margin = new Padding(0, 0, 0, 12), LinkColor = SystemInformation.HighContrast ? SystemColors.HotTrack : darkAppearance ? Color.FromArgb(156, 195, 247) : Color.FromArgb(32, 92, 165), UseMnemonic = false };
        project.ActiveLinkColor = project.LinkColor;
        project.VisitedLinkColor = project.LinkColor;
        project.LinkArea = new LinkArea("项目源码地址：".Length, ProjectAddress.Length);
        project.LinkClicked += (_, _) =>
        {
            try { Process.Start(new ProcessStartInfo(ProjectAddress) { UseShellExecute = true }); }
            catch { MessageBox.Show("无法打开项目地址，请在浏览器中访问：" + ProjectAddress, "CourseWatch"); }
        };
        var heading = new Label { Text = "使用前请阅读下方《用户协议》，确认同意后继续使用。", AutoSize = true, Dock = DockStyle.Fill, Margin = new Padding(0, 0, 0, 8) };
        var document = new RichTextBox { Text = terms, ReadOnly = true, Dock = DockStyle.Fill, DetectUrls = false, WordWrap = true, ScrollBars = RichTextBoxScrollBars.Vertical, BackColor = card, ForeColor = ink, BorderStyle = BorderStyle.FixedSingle, AccessibleName = "用户协议全文", Margin = new Padding(0, 0, 0, 12), TabIndex = 0 };
        var buttons = new FlowLayoutPanel { Dock = DockStyle.Fill, AutoSize = true, FlowDirection = FlowDirection.RightToLeft, WrapContents = false, Margin = Padding.Empty, Padding = Padding.Empty };
        var agree = new Button { Text = "同意并继续", Enabled = false, AutoSize = true, MinimumSize = new Size(112, 44), Margin = new Padding(8, 0, 0, 0), TabIndex = 2 };
        var quit = new Button { Text = "退出软件", AutoSize = true, MinimumSize = new Size(100, 44), Margin = Padding.Empty, DialogResult = DialogResult.Cancel, TabIndex = 1 };
        var hint = new Label { Text = "请滚动至协议底部后再同意", AutoSize = true, Dock = DockStyle.Fill, Margin = new Padding(0, 0, 0, 8), ForeColor = ink };
        var reachedEnd = false;
        void CheckReadingPosition()
        {
            if (!document.IsHandleCreated || document.ClientSize.Height <= 0) return;
            var info = new ScrollInfo { Size = (uint)Marshal.SizeOf<ScrollInfo>(), Mask = 7 };
            var hasScrollInfo = GetScrollInfo(document.Handle, 1, ref info);
            var atEnd = hasScrollInfo ? (long)info.Position + info.Page >= info.Max
                : document.TextLength == 0 || document.GetCharIndexFromPosition(new Point(document.ClientSize.Width - 1, document.ClientSize.Height - 1)) >= document.TextLength - 1;
            if (atEnd) reachedEnd = true;
            agree.Enabled = reachedEnd;
            hint.Text = reachedEnd ? "已阅读至协议底部" : "请滚动至协议底部后再同意";
        }
        void ScheduleReadingCheck() { if (IsHandleCreated && !IsDisposed) BeginInvoke((Action)CheckReadingPosition); }
        document.VScroll += (_, _) => ScheduleReadingCheck();
        document.Resize += (_, _) => ScheduleReadingCheck();
        document.KeyUp += (_, _) => ScheduleReadingCheck();
        document.MouseWheel += (_, _) => ScheduleReadingCheck();
        document.ContentsResized += (_, _) => ScheduleReadingCheck();
        foreach (var button in new[] { agree, quit })
        {
            button.FlatStyle = FlatStyle.Flat;
            button.FlatAppearance.BorderSize = 1;
            button.FlatAppearance.BorderColor = SystemInformation.HighContrast ? SystemColors.WindowText : darkAppearance ? Color.FromArgb(65, 71, 80) : Color.FromArgb(208, 214, 222);
            button.UseVisualStyleBackColor = false;
            button.BackColor = card;
            button.ForeColor = ink;
            button.Padding = new Padding(8, 0, 8, 0);
        }
        agree.BackColor = accent;
        agree.ForeColor = SystemInformation.HighContrast ? SystemColors.HighlightText : darkAppearance ? Color.FromArgb(32, 35, 40) : Color.White;
        agree.FlatAppearance.BorderColor = accent;
        agree.Click += (_, _) =>
        {
            if (!reachedEnd) return;
            try { acceptance.Accept(); DialogResult = DialogResult.OK; Close(); }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException)
            {
                MessageBox.Show(this, "无法保存协议确认。请检查当前用户资料目录是否可写后重试。", "CourseWatch", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        };
        buttons.Controls.Add(agree); buttons.Controls.Add(quit);
        var footer = new TableLayoutPanel { Dock = DockStyle.Fill, AutoSize = true, ColumnCount = 1, RowCount = 2, Margin = Padding.Empty, Padding = Padding.Empty };
        footer.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        footer.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        footer.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        footer.Controls.Add(hint, 0, 0); footer.Controls.Add(buttons, 0, 1);
        layout.Controls.Add(free, 0, 0); layout.Controls.Add(notice, 0, 1); layout.Controls.Add(project, 0, 2);
        layout.Controls.Add(heading, 0, 3); layout.Controls.Add(document, 0, 4); layout.Controls.Add(footer, 0, 5);
        Controls.Add(layout);
        CancelButton = quit;
        // Enter does not imply agreement; focus begins on the readable document.
        Shown += (_, _) => { reachedEnd = false; agree.Enabled = false; document.Select(0, 0); document.ScrollToCaret(); document.Focus(); ScheduleReadingCheck(); };
    }
}
