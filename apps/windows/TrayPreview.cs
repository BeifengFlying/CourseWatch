using System.Text.Json;

namespace CourseWatch;

internal sealed class TrayPreview : Form
{
    private readonly DesktopContext desktop;
    private readonly FlowLayoutPanel list = new() { Dock = DockStyle.Fill, FlowDirection = FlowDirection.TopDown, WrapContents = false, Padding = new Padding(12), AutoScroll = true };
    private readonly Label heading = new() { Text = "待办事项", Height = 36, Width = 330, Font = new Font("Microsoft YaHei UI", 12, FontStyle.Bold) };
    private readonly System.Windows.Forms.Timer dismiss = new() { Interval = 600 };
    internal bool Pinned;
    private Point anchor;
    private string? lastSummary;
    private long lastMinute;

    internal TrayPreview(DesktopContext desktop)
    {
        this.desktop = desktop;
        Text = "CourseWatch 待办"; FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false; TopMost = true; AutoScaleMode = AutoScaleMode.Dpi;
        ClientSize = new Size(368, 400); BackColor = SystemColors.Window;
        var footer = new FlowLayoutPanel { Dock = DockStyle.Bottom, Height = 48, Padding = new Padding(10, 4, 10, 8), FlowDirection = FlowDirection.LeftToRight };
        var open = Button("打开任务中心", 132); open.Click += (_, _) => desktop.ShowMain();
        var check = Button("立即检查", 94); check.Click += async (_, _) => await desktop.CheckAsync();
        var settings = Button("设置", 66); settings.Click += (_, _) => desktop.ShowSettings();
        footer.Controls.AddRange([open, check, settings]);
        Controls.Add(list); Controls.Add(footer);
        dismiss.Tick += (_, _) =>
        {
            var nearIcon = Math.Abs(Cursor.Position.X - anchor.X) <= 12 && Math.Abs(Cursor.Position.Y - anchor.Y) <= 12;
            if (!Pinned && !nearIcon && !Bounds.Contains(Cursor.Position)) { dismiss.Stop(); Hide(); }
        };
        Deactivate += (_, _) => { Pinned = false; Hide(); };
        VisibleChanged += (_, _) => { if (Visible) dismiss.Start(); else dismiss.Stop(); };
        SetUnavailable();
    }

    private static Button Button(string text, int width) => new() { Text = text, Width = width, Height = 32, FlatStyle = FlatStyle.Flat, TextAlign = ContentAlignment.MiddleCenter };

    private void ClearItems()
    {
        list.Controls.Remove(heading);
        foreach (Control item in list.Controls.Cast<Control>().ToArray()) item.Dispose();
        list.Controls.Clear(); list.Controls.Add(heading);
    }

    internal void SetUnavailable()
    {
        if (lastSummary == "unavailable") return;
        lastSummary = "unavailable";
        ClearItems();
        heading.Text = "待办事项";
        list.Controls.Add(new Label { Text = "后台连接中，请打开任务中心查看状态。", Width = 328, Height = 60 });
        ClientSize = new Size(368, 170);
    }

    internal void SetItems(JsonElement summary)
    {
        var content = summary.GetRawText();
        var minute = DateTimeOffset.UtcNow.ToUnixTimeSeconds() / 60;
        if (lastSummary == content && lastMinute == minute) return;
        lastSummary = content; lastMinute = minute;
        ClearItems();
        var total = summary.GetProperty("total").GetInt32();
        heading.Text = $"待办事项 · {total} 项";
        var count = 0;
        foreach (var item in summary.GetProperty("items").EnumerateArray())
        {
            count++;
            var id = item.GetProperty("id").GetString()!;
            var title = item.GetProperty("title").GetString() ?? "事项";
            var time = "时间待确认";
            if (item.GetProperty("dueAt").ValueKind == JsonValueKind.Number)
            {
                var due = DateTimeOffset.FromUnixTimeMilliseconds(item.GetProperty("dueAt").GetInt64());
                var remaining = due - DateTimeOffset.Now;
                time = remaining.TotalSeconds < 0 ? "已到时间" : remaining.TotalHours < 1 ? $"{Math.Ceiling(remaining.TotalMinutes)} 分钟后" : remaining.TotalDays < 1 ? $"{Math.Ceiling(remaining.TotalHours)} 小时后" : $"{Math.Ceiling(remaining.TotalDays)} 天后";
            }
            var button = Button(title + "\n" + time, 328);
            button.Height = 60; button.TextAlign = ContentAlignment.MiddleLeft; button.Padding = new Padding(8, 4, 8, 4);
            button.AccessibleName = title + "，" + time;
            button.Click += (_, _) => desktop.ShowMain(id);
            list.Controls.Add(button);
        }
        if (count == 0) list.Controls.Add(new Label { Text = "暂无待办事项", Width = 328, Height = 60 });
        ClientSize = new Size(368, 108 + Math.Max(1, count) * 66);
    }

    internal void ShowAtCursor()
    {
        var point = Cursor.Position;
        anchor = point;
        var area = Screen.FromPoint(point).WorkingArea;
        Location = new Point(Math.Clamp(point.X - Width / 2, area.Left, Math.Max(area.Left, area.Right - Width)), Math.Clamp(point.Y - Height - 12, area.Top, Math.Max(area.Top, area.Bottom - Height)));
        if (!Visible) Show();
        if (Pinned) Activate();
    }

    protected override bool ShowWithoutActivation => !Pinned;
    protected override void Dispose(bool disposing) { if (disposing) dismiss.Dispose(); base.Dispose(disposing); }
}
