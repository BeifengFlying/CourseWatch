import AppKit
import WebKit
import UserNotifications

private let serviceURL = URL(string: "http://127.0.0.1:17321")!
private let officialHosts: Set<String> = ["jsjks.ynjy.cn", "tk.ipmph.com", "www.yuketang.cn", "yuketang.cn", "sso.yuketang.cn", "passport2.chaoxing.com", "i.chaoxing.com", "i.mooc.chaoxing.com", "mooc2-ans.chaoxing.com", "mooc1-api.chaoxing.com", "mooc1.chaoxing.com", "uai.unipus.cn", "sso.unipus.cn", "itest.unipus.cn"]

final class WindowControlsView: NSView {
    var toolbarDragEnabled = true
    var toolbarActionsLeft: CGFloat?
    override var mouseDownCanMoveWindow: Bool { true }
    override func hitTest(_ point: NSPoint) -> NSView? {
        // Leave toolbar actions and the gap between surfaces to WebKit.
        if (point.x >= 104 && point.x < 114) || point.x >= (toolbarActionsLeft ?? bounds.width - 380) || (!toolbarDragEnabled && point.x >= 114) { return nil }
        return super.hitTest(point)
    }
    override func mouseDown(with event: NSEvent) { window?.performDrag(with: event) }
}

// Factory titlebar controls lose their shared rollover after being relocated.
final class WindowControlButton: NSButton {
    var isClose = false
    var hovered = false { didSet { needsDisplay = true } }
    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        for area in trackingAreas { removeTrackingArea(area) }
        addTrackingArea(NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self, userInfo: nil))
    }
    override func mouseEntered(with event: NSEvent) { setGroupHover(true) }
    override func mouseExited(with event: NSEvent) { setGroupHover(false) }
    private func setGroupHover(_ value: Bool) {
        superview?.subviews.compactMap { $0 as? WindowControlButton }.forEach { $0.hovered = value }
    }
    override func draw(_ dirtyRect: NSRect) {
        let circle = NSBezierPath(ovalIn: bounds.insetBy(dx: 0.5, dy: 0.5))
        (isClose ? NSColor(srgbRed: 1, green: 0.37, blue: 0.34, alpha: 1) : NSColor(srgbRed: 1, green: 0.74, blue: 0.18, alpha: 1)).setFill()
        circle.fill()
        NSColor.black.withAlphaComponent(0.12).setStroke(); circle.lineWidth = 0.6; circle.stroke()
        guard hovered else { return }
        let glyph = NSBezierPath(); glyph.lineWidth = 1.2; glyph.lineCapStyle = .round
        if isClose {
            glyph.move(to: NSPoint(x: 4.5, y: 4.5)); glyph.line(to: NSPoint(x: 9.5, y: 9.5))
            glyph.move(to: NSPoint(x: 9.5, y: 4.5)); glyph.line(to: NSPoint(x: 4.5, y: 9.5))
        } else { glyph.move(to: NSPoint(x: 3.5, y: 7)); glyph.line(to: NSPoint(x: 10.5, y: 7)) }
        NSColor.black.withAlphaComponent(0.72).setStroke(); glyph.stroke()
    }
}

final class HoverPreviewView: NSView {
    var entered: (() -> Void)?
    var exited: (() -> Void)?
    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        for area in trackingAreas { removeTrackingArea(area) }
        addTrackingArea(NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self, userInfo: nil))
    }
    override func mouseEntered(with event: NSEvent) { entered?() }
    override func mouseExited(with event: NSEvent) { exited?() }
}
final class AgendaButton: NSButton { var entryId = "" }

final class StudyProgressBar: NSView {
    var doubleValue: Double = 0 { didSet { needsDisplay = true; setAccessibilityValue(doubleValue) } }
    override var intrinsicContentSize: NSSize { NSSize(width: NSView.noIntrinsicMetric, height: 5) }
    override func draw(_ dirtyRect: NSRect) {
        NSColor.separatorColor.setFill(); NSBezierPath(roundedRect: bounds, xRadius: 2.5, yRadius: 2.5).fill()
        NSColor.controlAccentColor.setFill()
        let fill = NSRect(x: 0, y: 0, width: bounds.width * CGFloat(max(0, min(100, doubleValue))) / 100, height: bounds.height)
        NSBezierPath(roundedRect: fill, xRadius: 2.5, yRadius: 2.5).fill()
    }
}

// The same observed media position as the main window; the bar is not a seek control.
final class StudyPreviewCard: NSView {
    var action: ((String) -> Void)?
    private let heading = NSTextField(labelWithString: "")
    private let course = NSTextField(wrappingLabelWithString: "")
    private let chapter = NSTextField(wrappingLabelWithString: "")
    private let position = NSTextField(labelWithString: "")
    private let note = NSTextField(wrappingLabelWithString: "")
    private let bar = StudyProgressBar()
    private let previous = NSButton(), playback = NSButton(), next = NSButton(), showRunning = NSButton()
    private var state: [String: Any] = [:]
    private var busy = false
    private var issue: String?
    override init(frame: NSRect) {
        super.init(frame: frame)
        let stack = NSStackView(); stack.orientation = .vertical; stack.alignment = .leading; stack.spacing = 8
        stack.translatesAutoresizingMaskIntoConstraints = false; addSubview(stack)
        NSLayoutConstraint.activate([stack.leadingAnchor.constraint(equalTo: leadingAnchor), stack.trailingAnchor.constraint(equalTo: trailingAnchor), stack.topAnchor.constraint(equalTo: topAnchor), stack.bottomAnchor.constraint(equalTo: bottomAnchor)])
        heading.font = .systemFont(ofSize: 12, weight: .medium); heading.textColor = .secondaryLabelColor
        course.font = .systemFont(ofSize: 16, weight: .semibold); course.maximumNumberOfLines = 2
        chapter.font = .systemFont(ofSize: 13); chapter.maximumNumberOfLines = 2
        position.font = .monospacedDigitSystemFont(ofSize: 12, weight: .regular); position.textColor = .secondaryLabelColor
        note.font = .systemFont(ofSize: 12); note.textColor = .secondaryLabelColor; note.maximumNumberOfLines = 2
        for field in [heading, course, chapter, position, note] { field.lineBreakMode = .byTruncatingTail; field.widthAnchor.constraint(equalToConstant: 354).isActive = true; field.setContentCompressionResistancePriority(.defaultLow, for: .horizontal) }
        bar.setAccessibilityElement(true); bar.setAccessibilityRole(.progressIndicator)
        bar.widthAnchor.constraint(equalToConstant: 354).isActive = true; bar.setAccessibilityLabel("当前媒体播放位置")
        for view in [heading, course, chapter, bar, position] { stack.addArrangedSubview(view) }
        let controls = NSStackView(); controls.orientation = .horizontal; controls.alignment = .centerY; controls.spacing = 12
        for (button, title, symbol, selector) in [(previous, "上一节", "backward.end.fill", #selector(goPrevious)), (playback, "暂停", "pause.fill", #selector(togglePlayback)), (next, "下一节", "forward.end.fill", #selector(goNext))] {
            button.title = title; button.image = NSImage(systemSymbolName: symbol, accessibilityDescription: nil); button.imagePosition = .imageAbove
            button.bezelStyle = .inline; button.font = .systemFont(ofSize: 11); button.target = self; button.action = selector
            button.isBordered = false
            button.contentTintColor = .labelColor
            button.symbolConfiguration = NSImage.SymbolConfiguration(pointSize: button === playback ? 19 : 16, weight: .semibold)
            button.setAccessibilityLabel(title); button.toolTip = title; button.heightAnchor.constraint(equalToConstant: 44).isActive = true
            button.widthAnchor.constraint(equalToConstant: 56).isActive = true
            controls.addArrangedSubview(button)
        }
        let centered = NSStackView(views: [controls]); centered.orientation = .vertical; centered.alignment = .centerX
        centered.widthAnchor.constraint(equalToConstant: 354).isActive = true; stack.addArrangedSubview(centered); stack.addArrangedSubview(note)
        showRunning.title = "运行窗口"; showRunning.setAccessibilityLabel("打开运行窗口"); showRunning.toolTip = "打开运行窗口"; showRunning.image = NSImage(systemSymbolName: "arrow.up.forward.square", accessibilityDescription: nil); showRunning.imagePosition = .imageAbove
        showRunning.isBordered = false; showRunning.contentTintColor = .labelColor; showRunning.symbolConfiguration = NSImage.SymbolConfiguration(pointSize: 16, weight: .semibold); showRunning.bezelStyle = .inline; showRunning.font = .systemFont(ofSize: 11); showRunning.target = self; showRunning.action = #selector(showRunningWindow)
        showRunning.heightAnchor.constraint(equalToConstant: 44).isActive = true; showRunning.widthAnchor.constraint(equalToConstant: 66).isActive = true; controls.addArrangedSubview(showRunning)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    func update(_ value: [String: Any], busy: Bool = false, issue: String? = nil) {
        state = value; self.busy = busy; self.issue = issue
        let phase = value["phase"] as? String ?? "idle"
        let labels = ["starting":"正在启动", "running":"运行中", "paused":"已暂停", "stopping":"正在停止", "stopped":"已停止", "failed":"运行失败", "completed":"本轮结束"]
        heading.stringValue = (value["platform"] as? String == "unipus" ? "U校园" : "学习通") + " · " + (labels[phase] ?? "未启动")
        let progress = value["progress"] as? [String: Any] ?? [:]
        course.stringValue = value["courseName"] as? String ?? progress["course"] as? String ?? "正在读取课程"
        if course.stringValue.isEmpty { course.stringValue = progress["course"] as? String ?? "课程名称未读取" }
        chapter.stringValue = progress["chapter"] as? String ?? "章节名称尚未读取"
        course.toolTip = course.stringValue; chapter.toolTip = chapter.stringValue
        let media = progress["media"] as? [[String: Any]] ?? []
        if let item = media.first(where: { $0["paused"] as? Bool == false && $0["ended"] as? Bool != true }) ?? media.first {
            let current = item["current"] as? Double ?? 0, duration = item["duration"] as? Double
            bar.isHidden = duration.map { $0 > 0 } != true
            bar.doubleValue = duration.map { $0 > 0 ? max(0, min(100, current / $0 * 100)) : 0 } ?? 0
            let playing = item["ended"] as? Bool == true ? "播放结束" : phase == "paused" || item["paused"] as? Bool == true ? "已暂停" : "播放中"
            position.stringValue = "\(clock(current)) / \(duration.map(clock) ?? "总时长未知") · \(playing)"
        } else {
            bar.isHidden = true
            if let doc = (progress["documents"] as? [[String: Any]])?.first {
                position.stringValue = "文档 · 第 \((doc["current"] as? Int).map(String.init) ?? "未知") / \((doc["total"] as? Int).map(String.init) ?? "未知") 页"
            } else { position.stringValue = "尚未读取到媒体播放位置" }
        }
        if value["operation"] as? String == "keep-open" {
            bar.isHidden = true
            position.stringValue = value["platform"] as? String == "unipus" ? "保活计时 · 保持官网内容页可见" : "定时保留页面"
            if let closeAt = value["closeAt"] as? Double {
                let formatter = DateFormatter(); formatter.timeZone = TimeZone(identifier: "Asia/Shanghai"); formatter.dateFormat = "HH:mm"
                position.stringValue += " · " + formatter.string(from: Date(timeIntervalSince1970: closeAt / 1000)) + " 关闭"
            }
        }
        let enabled = !busy && ["running", "paused"].contains(phase)
        let navigation = value["navigation"] as? [String: Bool] ?? [:]
        previous.isEnabled = enabled && navigation["previous"] == true && value["operation"] as? String != "keep-open"
        next.isEnabled = enabled && navigation["next"] == true && value["operation"] as? String != "keep-open"
        playback.isEnabled = enabled
        let playbackTitle = phase == "paused" ? "继续" : "暂停"
        playback.image = NSImage(systemSymbolName: phase == "paused" ? "play.fill" : "pause.fill", accessibilityDescription: nil)
        playback.title = playbackTitle; playback.setAccessibilityLabel(playbackTitle); playback.toolTip = playbackTitle
        showRunning.isEnabled = !busy && ["starting", "running", "paused"].contains(phase)
        note.stringValue = issue ?? (busy ? "正在执行操作…" : ["stopped", "completed", "failed"].contains(phase) ? "最后读取的进度 · " + (value["message"] as? String ?? "") : phase == "paused" ? value["message"] as? String ?? "已暂停" : "播放位置来自当前页面，完成记录以官网为准。")
        note.isHidden = issue == nil && !busy && !["paused", "failed"].contains(phase)
        note.toolTip = note.stringValue; note.textColor = issue == nil ? .secondaryLabelColor : .systemOrange
    }
    private func clock(_ seconds: Double) -> String { let n = seconds.isFinite ? max(0, Int(seconds)) : 0; return String(format: "%d:%02d", n / 60, n % 60) }
    @objc private func goPrevious() { if previous.isEnabled { action?("previous") } }
    @objc private func goNext() { if next.isEnabled { action?("next") } }
    @objc private func togglePlayback() { if playback.isEnabled { action?(state["phase"] as? String == "paused" ? "resume" : "pause") } }
    @objc private func showRunningWindow() { if showRunning.isEnabled { action?("show") } }
}

// Acceptance precedes the local service, notifications and course operations.
final class FirstRunConsent: NSObject {
    static let revision = "2026-11-15"
    static let acceptanceKey = "CourseWatch.UserAgreement." + revision
    static let projectURL = URL(string: "https://github.com/BeifengFlying/CourseWatch")!

    static func requestIfNeeded(defaults: UserDefaults = .standard,
                                resources: URL? = Bundle.main.resourceURL,
                                present: (NSAlert) -> NSApplication.ModalResponse = { $0.runModal() }) -> Bool {
        if defaults.bool(forKey: acceptanceKey) { return true }
        guard let resources = resources,
              let terms = try? String(contentsOf: resources.appendingPathComponent("TERMS.md"), encoding: .utf8),
              !terms.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            let error = NSAlert()
            error.messageText = "无法读取用户协议"
            error.informativeText = "请重新下载完整安装包后再打开 CourseWatch。"
            error.addButton(withTitle: "退出软件")
            _ = present(error)
            return false
        }
        let owner = FirstRunConsent()
        let alert = owner.makeAlert(terms: terms)
        NSApp.activate(ignoringOtherApps: true)
        guard present(alert) == .alertFirstButtonReturn else { return false }
        defaults.set(true, forKey: acceptanceKey)
        guard defaults.synchronize() else {
            defaults.removeObject(forKey: acceptanceKey)
            let error = NSAlert()
            error.messageText = "无法保存协议确认"
            error.informativeText = "请检查当前用户资料目录是否可写，再重新打开 CourseWatch。"
            error.addButton(withTitle: "退出软件")
            _ = present(error)
            return false
        }
        return true
    }

    func makeAlert(terms: String, width: CGFloat = 460) -> NSAlert {
        let alert = NSAlert()
        alert.messageText = "用户协议与免费声明"
        alert.informativeText = "本软件完全免费。\n\n如果你是在其他付费渠道获取此软件，请立即退款并举报该商家。\n\n使用前请阅读下方《用户协议》，确认同意后继续使用。"
        alert.addButton(withTitle: "同意并继续")
        alert.addButton(withTitle: "退出软件").keyEquivalent = "\u{1b}"
        let container = NSView(frame: NSRect(x: 0, y: 0, width: width, height: 290))
        let link = NSTextField(labelWithString: "")
        let address = NSAttributedString(string: "项目源码地址：" + Self.projectURL.absoluteString,
            attributes: [.link: Self.projectURL, .font: NSFont.systemFont(ofSize: 12)])
        link.attributedStringValue = address
        link.allowsEditingTextAttributes = true
        link.isSelectable = true
        link.maximumNumberOfLines = 2
        link.lineBreakMode = .byCharWrapping
        link.frame = NSRect(x: 0, y: 254, width: width, height: 36)
        container.addSubview(link)
        let heading = NSTextField(labelWithString: "用户协议全文")
        heading.frame = NSRect(x: 0, y: 226, width: width, height: 22)
        heading.font = .systemFont(ofSize: 13, weight: .semibold)
        container.addSubview(heading)
        let scroll = NSScrollView(frame: NSRect(x: 0, y: 0, width: width, height: 222))
        scroll.hasVerticalScroller = true
        scroll.borderType = .bezelBorder
        let text = NSTextView(frame: scroll.contentView.bounds)
        text.isEditable = false
        text.isSelectable = true
        text.font = .systemFont(ofSize: 13)
        text.textColor = .textColor
        text.backgroundColor = .textBackgroundColor
        text.textContainerInset = NSSize(width: 10, height: 10)
        text.isVerticallyResizable = true
        text.isHorizontallyResizable = false
        text.autoresizingMask = [.width]
        text.textContainer?.widthTracksTextView = true
        text.string = terms
        text.setAccessibilityLabel("用户协议全文")
        scroll.documentView = text
        container.addSubview(scroll)
        alert.accessoryView = container
        return alert
    }
}

final class Bridge: NSObject, WKScriptMessageHandler {
    weak var owner: AppDelegate?
    init(_ owner: AppDelegate) { self.owner = owner }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, message.frameInfo.securityOrigin.host == "127.0.0.1",
              message.frameInfo.securityOrigin.port == 17321,
              let body = message.body as? [String: Any], let action = body["action"] as? String else { return }
        switch action {
        case "hide": owner?.hideToMenuBar()
        case "openPlatform":
            if let platform = body["platform"] as? String { owner?.openPlatformWindow(platform) }
        case "closePlatform":
            if let web = message.webView, web.window !== owner?.window { web.window?.close() }
        case "dismissPlatform":
            if let platform = body["platform"] as? String { owner?.dismissPlatformWindow(platform) }
        case "sidebarGlass": owner?.setSidebarGlass(body["enabled"] as? Bool == true)
        case "appearance":
            if let mode = body["mode"] as? String, ["system", "light", "dark"].contains(mode) {
                NSApp.appearance = mode == "system" ? nil : NSAppearance(named: mode == "dark" ? .darkAqua : .aqua)
            }
        case "modalState":
            if message.webView?.window === owner?.window { owner?.setModalOpen(body["open"] as? Bool == true) }
        case "refresh": owner?.refreshInterface(excluding: message.webView)
        case "settled": owner?.suspendIdlePages()
        case "focusWindow":
            if let window = message.webView?.window { owner?.focusLoginWindow(window) }
        case "toolbarBounds":
            if message.webView?.window === owner?.window, let left = body["actionsLeft"] as? Double { owner?.setToolbarActionsLeft(left) }
        case "notifications": owner?.deliverNotifications()
        case "configureCalendar": owner?.configureCalendar()
        case "syncCalendar": owner?.syncCalendar(force: true)
        case "export": owner?.exportTasks()
        case "exportDiagnostics": owner?.exportJSON("diagnostics/export", filename: "coursewatch-system-logs.json")
        case "openExternal":
            if let value = body["url"] as? String, let url = URL(string: value),
               ["http", "https"].contains(url.scheme?.lowercased() ?? ""), url.host != nil,
               url.user == nil, url.password == nil { NSWorkspace.shared.open(url) }
        case "notificationStatus": owner?.notificationStatus()
        case "authorizeNotifications": owner?.authorizeNotifications()
        case "configureNotifications": owner?.authorizeNotifications(showGuide: true)
        case "notificationSettings":
            if let url = URL(string: "x-apple.systempreferences:com.apple.Notifications-Settings.extension") { NSWorkspace.shared.open(url) }
        default: break
        }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSPopoverDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, UNUserNotificationCenterDelegate {
    private lazy var calendarSync = CourseWatchCalendarSync()
    private var calendarPolling = false
    var window: NSWindow?
    private var webView: WKWebView?
    private var platformWindows: [String: NSWindow] = [:]
    private var platformWebViews: [String: WKWebView] = [:]
    private var platformStates: [String: [String: Any]] = [:]
    private var hiddenPlatformWindows: Set<String> = []
    private var sidebarMaterial: NSVisualEffectView?
    private var statusItem: NSStatusItem!
    private var stateItem: NSMenuItem!
    private var pauseItem: NSMenuItem!
    private var checkItem: NSMenuItem!
    private var statusMenu: NSMenu!
    private let preview = NSPopover()
    private var previewItems: [[String: Any]] = []
    private var previewStudies: [[String: Any]] = []
    private var studyCards: [String: StudyPreviewCard] = [:]
    private var studyBusy: Set<String> = []
    private var studyIssues: [String: String] = [:]
    private var previewTimer: Timer?
    private var previewLoading = false
    private var previewSignature = ""
    private var previewTotal = 0
    private var previewLoaded = false
    private var previewIssue: String?
    private var hoverOpen: DispatchWorkItem?
    private var hoverClose: DispatchWorkItem?
    private var previewPinned = false
    private var pendingEntry: String?
    private var process: Process?
    private var timer: Timer?
    private var token = UUID().uuidString + UUID().uuidString
    private var ready = false
    private var monitoring = true
    private var polling = false
    private var notifying = false
    private var quitting = false
    private var startupAttempts = 0
    private var backendIssue: String?
    private var savedInterface: [String: Any]?
    private var snapshotView: NSImageView?
    private var windowControls: WindowControlsView?
    private var pendingSettings = false
    private var checking = false
    private var session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 12
        config.urlCache = nil
        return URLSession(configuration: config)
    }()

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSWindow.allowsAutomaticWindowTabbing = false
        NSApp.setActivationPolicy(.accessory)
        guard FirstRunConsent.requestIfNeeded() else { NSApp.terminate(nil); return }
        installMenus()
        UNUserNotificationCenter.current().delegate = self
        startBackend()
        showWindow()
        timer = Timer.scheduledTimer(withTimeInterval: 15, repeats: true) { [weak self] _ in self?.poll() }
        timer?.tolerance = 3
        poll()
    }

    private func installMenus() {
        let appMenu = NSMenu()
        let root = NSMenuItem()
        let menu = NSMenu()
        menu.addItem(withTitle: "关于 CourseWatch", action: #selector(about), keyEquivalent: "")
        menu.addItem(.separator())
        menu.addItem(withTitle: "设置…", action: #selector(showSettings), keyEquivalent: ",")
        menu.addItem(.separator())
        let hideItem = menu.addItem(withTitle: "隐藏 CourseWatch", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        hideItem.target = NSApp
        let hideOthers = menu.addItem(withTitle: "隐藏其他", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        hideOthers.keyEquivalentModifierMask = [.option, .command]
        hideOthers.target = NSApp
        let showAll = menu.addItem(withTitle: "全部显示", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
        showAll.target = NSApp
        menu.addItem(.separator())
        menu.addItem(withTitle: "关闭窗口", action: #selector(closeWindow), keyEquivalent: "w")
        menu.addItem(withTitle: "退出 CourseWatch", action: #selector(quit), keyEquivalent: "q")
        for item in menu.items where item.target == nil { item.target = self }
        root.submenu = menu
        appMenu.addItem(root)
        let editRoot = NSMenuItem(title: "编辑", action: nil, keyEquivalent: "")
        let edit = NSMenu(title: "编辑")
        edit.addItem(withTitle: "撤销", action: Selector(("undo:")), keyEquivalent: "z")
        edit.addItem(withTitle: "剪切", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "复制", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "粘贴", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "全选", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editRoot.submenu = edit
        appMenu.addItem(editRoot)
        NSApp.mainMenu = appMenu
        // Start near the right edge on crowded/notched menu bars. Registering
        // a default preserves any position the user later chooses by dragging.
        UserDefaults.standard.register(defaults: ["NSStatusItem Preferred Position CourseWatchMenuBar": 0])
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        statusItem.autosaveName = "CourseWatchMenuBar"
        statusItem.behavior = []
        statusItem.isVisible = true
        let icon = Bundle.main.url(forResource: "MenuBarIcon", withExtension: "svg")
            .flatMap { NSImage(contentsOf: $0) } ?? NSImage(systemSymbolName: "calendar", accessibilityDescription: "CourseWatch")
        icon?.size = NSSize(width: 18, height: 18)
        icon?.isTemplate = true
        icon?.accessibilityDescription = "CourseWatch"
        statusItem.button?.image = icon
        statusItem.button?.toolTip = "CourseWatch"
        statusItem.button?.setAccessibilityLabel("CourseWatch 菜单栏")
        statusMenu = NSMenu()
        stateItem = NSMenuItem(title: "正在启动…", action: nil, keyEquivalent: "")
        statusMenu.addItem(stateItem)
        statusMenu.addItem(.separator())
        statusMenu.addItem(withTitle: "打开 CourseWatch", action: #selector(showWindow), keyEquivalent: "")
        checkItem = statusMenu.addItem(withTitle: "立即检查", action: #selector(checkNow), keyEquivalent: "")
        pauseItem = statusMenu.addItem(withTitle: "暂停监控", action: #selector(toggleMonitor), keyEquivalent: "")
        statusMenu.addItem(.separator())
        statusMenu.addItem(withTitle: "退出 CourseWatch", action: #selector(quit), keyEquivalent: "q")
        for item in statusMenu.items where item.action != nil { item.target = self }
        if let button = statusItem.button {
            button.target = self
            button.action = #selector(statusClicked(_:))
            button.sendAction(on: [.leftMouseUp, .rightMouseUp])
            button.addTrackingArea(NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self, userInfo: nil))
        }
        preview.behavior = .transient
        preview.animates = false
        updateMenu("正在启动…")
    }

    @objc func mouseEntered(with event: NSEvent) {
        hoverClose?.cancel()
        hoverOpen?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.showPreview() }
        hoverOpen = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25, execute: work)
    }
    @objc func mouseExited(with event: NSEvent) { hoverOpen?.cancel(); schedulePreviewClose() }
    private func schedulePreviewClose() {
        hoverClose?.cancel()
        guard !previewPinned else { return }
        let work = DispatchWorkItem { [weak self] in self?.preview.performClose(nil) }
        hoverClose = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4, execute: work)
    }
    @objc private func statusClicked(_ sender: NSStatusBarButton) {
        hoverOpen?.cancel(); hoverClose?.cancel()
        if NSApp.currentEvent?.type == .rightMouseUp {
            preview.performClose(nil)
            statusItem.menu = statusMenu
            sender.performClick(nil)
            statusItem.menu = nil
        } else if preview.isShown && previewPinned {
            previewPinned = false; preview.performClose(nil)
        } else { previewPinned = true; showPreview(pinned: true) }
    }
    private func showPreview(pinned: Bool = false) {
        guard let button = statusItem.button else { return }
        if !preview.isShown { previewPinned = pinned; renderPreview(); preview.show(relativeTo: button.bounds, of: button, preferredEdge: .minY) }
        preview.delegate = self
        if previewTimer == nil {
            previewTimer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
                guard let self = self, self.preview.isShown else { return }
                self.refreshPreview()
            }
            previewTimer?.tolerance = 0.2
        }
        refreshPreview()
    }
    func popoverDidClose(_ notification: Notification) { previewTimer?.invalidate(); previewTimer = nil; previewPinned = false }
    private func refreshPreview() {
        guard ready, !previewLoading else { return }
        previewLoading = true
        request("native/summary") { [weak self] result in
            guard let self = self else { return }
            self.previewLoading = false
            switch result {
            case .success(let data):
                self.previewStudies = data["studies"] as? [[String: Any]] ?? []
                self.previewItems = data["items"] as? [[String: Any]] ?? []
                self.previewTotal = data["total"] as? Int ?? 0
                self.previewLoaded = true
                self.previewIssue = nil
            case .failure: self.previewIssue = "暂时无法读取任务，请打开主窗口重试"
            }
            if self.preview.isShown {
                let structure: [String: Any] = ["items": self.previewItems, "total": self.previewTotal, "loaded": self.previewLoaded, "issue": self.previewIssue ?? "", "platforms": self.previewStudies.compactMap { $0["platform"] as? String }]
                let signature = (try? JSONSerialization.data(withJSONObject: structure, options: [.sortedKeys])).map { String(decoding: $0, as: UTF8.self) } ?? ""
                if signature != self.previewSignature { self.previewSignature = signature; self.renderPreview() }
                else { self.updateStudyCards() }
            }
            let titles = self.previewItems.prefix(4).map { "• " + ($0["title"] as? String ?? "") + " · " + self.previewTime($0) }.joined(separator: "\n")
            self.statusItem.button?.toolTip = "CourseWatch · \(self.previewTotal) 项待处理\n" + titles
        }
    }
    private func previewTime(_ item: [String: Any]) -> String {
        guard let due = item["dueAt"] as? Double else { return "时间待确认" }
        let d = Date(timeIntervalSince1970: due / 1000)
        let formatter = DateFormatter(); formatter.locale = Locale(identifier: "zh_CN"); formatter.timeZone = TimeZone(identifier: "Asia/Shanghai"); formatter.dateFormat = "M/d HH:mm"
        let remaining = d.timeIntervalSinceNow
        if remaining < 0 { return "已过期 · " + formatter.string(from: d) }
        if remaining < 3600 { return "剩余 \(Int(ceil(remaining / 60))) 分钟" }
        if remaining < 86400 { return "剩余 \(Int(ceil(remaining / 3600))) 小时" }
        return formatter.string(from: d)
    }
    private func renderPreview() {
        let controller = NSViewController()
        let root = HoverPreviewView(frame: NSRect(x: 0, y: 0, width: 390, height: 200))
        root.entered = { [weak self] in self?.hoverClose?.cancel() }
        root.exited = { [weak self] in self?.schedulePreviewClose() }
        let glass = NSVisualEffectView(frame: root.bounds)
        glass.autoresizingMask = [.width, .height]
        glass.material = .popover
        glass.blendingMode = .behindWindow
        glass.state = .active
        root.addSubview(glass)
        let stack = NSStackView(); stack.orientation = .vertical; stack.alignment = .leading; stack.spacing = 10; stack.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(stack)
        NSLayoutConstraint.activate([stack.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: 18), stack.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -18), stack.topAnchor.constraint(equalTo: root.topAnchor, constant: 18), stack.bottomAnchor.constraint(equalTo: root.bottomAnchor, constant: -18)])
        func label(_ text: String, size: CGFloat, color: NSColor = .labelColor) -> NSTextField {
            let field = NSTextField(wrappingLabelWithString: text); field.font = .systemFont(ofSize: size); field.textColor = color; field.preferredMaxLayoutWidth = 354; return field
        }
        studyCards.removeAll()
        for study in previewStudies {
            guard let platform = study["platform"] as? String else { continue }
            let card = StudyPreviewCard(frame: .zero)
            card.action = { [weak self] action in self?.studyCommand(platform, action: action) }
            card.widthAnchor.constraint(equalToConstant: 354).isActive = true
            stack.addArrangedSubview(card); studyCards[platform] = card
            let divider = NSBox(); divider.boxType = .separator; divider.widthAnchor.constraint(equalToConstant: 354).isActive = true; stack.addArrangedSubview(divider)
        }
        updateStudyCards()
        let heading = label("待办事项", size: 15); heading.font = .systemFont(ofSize: 15, weight: .semibold); stack.addArrangedSubview(heading)
        stack.addArrangedSubview(label(ready ? "\(previewTotal) 项待处理" : "正在连接后台…", size: 12, color: .secondaryLabelColor))
        if let issue = previewIssue { stack.addArrangedSubview(label(issue, size: 14, color: .systemOrange)) }
        else if previewItems.isEmpty { stack.addArrangedSubview(label(!previewLoaded ? "正在读取任务…" : "暂无待办事项。可添加日程或同步课程任务。", size: 14, color: .secondaryLabelColor)) }
        for item in previewItems.prefix(previewStudies.isEmpty ? 5 : 2) {
            let row = NSStackView(); row.orientation = .vertical; row.alignment = .leading; row.spacing = 3
            let button = AgendaButton(title: item["title"] as? String ?? "事项", target: self, action: #selector(openPreviewEntry(_:)))
            button.entryId = item["id"] as? String ?? ""
            button.bezelStyle = .recessed; button.isBordered = false; button.alignment = .left; button.lineBreakMode = .byTruncatingTail; button.font = .systemFont(ofSize: 15, weight: .medium)
            button.image = NSImage(systemSymbolName: item["important"] as? Bool == true ? "star.fill" : item["local"] as? Bool == true ? "calendar" : "circle", accessibilityDescription: nil)
            button.imagePosition = .imageLeading; button.contentTintColor = .labelColor
            button.toolTip = item["title"] as? String
            row.addArrangedSubview(button)
            button.widthAnchor.constraint(equalToConstant: 354).isActive = true
            let hours = (item["dueAt"] as? Double).map { ($0 / 1000 - Date().timeIntervalSince1970) / 3600 }
            let approaching = hours.map { $0 >= 0 && $0 <= 24 } ?? false
            if hours.map({ $0 < 0 }) == true { button.contentTintColor = .secondaryLabelColor }
            let time = label(previewTime(item), size: 13)
            time.textColor = approaching ? NSColor(name: nil, dynamicProvider: { appearance in
                let dark = appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
                let rgb: (CGFloat, CGFloat, CGFloat)
                if (hours ?? 25) <= 3 { rgb = dark ? (1, 0.64, 0.67) : (0.69, 0.17, 0.19) }
                else if (hours ?? 25) <= 12 { rgb = dark ? (1, 0.71, 0.49) : (0.60, 0.26, 0.04) }
                else { rgb = dark ? (0.94, 0.81, 0.44) : (0.47, 0.33, 0) }
                return NSColor(srgbRed: rgb.0, green: rgb.1, blue: rgb.2, alpha: 1)
            }) : .secondaryLabelColor
            if approaching { button.font = .systemFont(ofSize: 15, weight: .bold); time.font = .systemFont(ofSize: 13, weight: .bold) }
            row.addArrangedSubview(time)
            stack.addArrangedSubview(row)
        }
        let divider = NSBox(); divider.boxType = .separator; divider.widthAnchor.constraint(equalToConstant: 354).isActive = true; stack.addArrangedSubview(divider)
        let actions = NSStackView(); actions.orientation = .horizontal; actions.spacing = 12
        for (title, action) in [("打开任务中心", #selector(openFromPreview)), ("立即检查", #selector(checkNow)), ("设置", #selector(showSettings))] {
            let button = NSButton(title: title, target: self, action: action); button.bezelStyle = .rounded; button.font = .systemFont(ofSize: 13); actions.addArrangedSubview(button)
        }
        stack.addArrangedSubview(actions)
        controller.view = root
        let height = stack.fittingSize.height + 36
        let available = max(280, (statusItem?.button?.window?.screen ?? NSScreen.main)?.visibleFrame.height ?? 720) - 40
        let visibleHeight = min(height, available)
        root.setFrameSize(NSSize(width: 390, height: height))
        if height > visibleHeight {
            let scroll = NSScrollView(frame: NSRect(x: 0, y: 0, width: 390, height: visibleHeight))
            scroll.hasVerticalScroller = true; scroll.autohidesScrollers = true; scroll.drawsBackground = false; scroll.documentView = root
            scroll.contentView.scroll(to: NSPoint(x: 0, y: height - visibleHeight))
            controller.view = scroll
        }
        controller.preferredContentSize = NSSize(width: 390, height: visibleHeight)
        preview.contentViewController = controller
        preview.contentSize = NSSize(width: 390, height: visibleHeight)
    }
    private func updateStudyCards() {
        for study in previewStudies {
            guard let platform = study["platform"] as? String else { continue }
            studyCards[platform]?.update(study, busy: studyBusy.contains(platform) || previewIssue != nil, issue: studyIssues[platform] ?? (previewIssue == nil ? nil : "后台暂时无法连接，显示最后读取的进度"))
        }
    }
    private func studyCommand(_ platform: String, action: String) {
        guard ["chaoxing", "unipus"].contains(platform), ["previous", "next", "pause", "resume", "show"].contains(action), !studyBusy.contains(platform) else { return }
        previewPinned = true; hoverClose?.cancel()
        studyBusy.insert(platform); studyIssues.removeValue(forKey: platform); updateStudyCards()
        let prefix = platform == "unipus" ? "study/unipus/" : "study/"
        request(prefix + action, method: "POST", body: [:], timeout: 35) { [weak self] result in
            guard let self = self else { return }
            self.studyBusy.remove(platform)
            switch result {
            case .success(let state):
                if action != "show", let index = self.previewStudies.firstIndex(where: { $0["platform"] as? String == platform }) { var value = state; value["platform"] = platform; self.previewStudies[index] = value }
            case .failure(let error): self.studyIssues[platform] = error.localizedDescription
            }
            self.updateStudyCards(); self.refreshPreview()
        }
    }
    @objc private func openFromPreview() { preview.performClose(nil); showWindow() }
    @objc private func openPreviewEntry(_ sender: AgendaButton) {
        pendingEntry = sender.entryId
        preview.performClose(nil)
        showWindow()
        focusPendingEntry()
    }
    private func focusPendingEntry() {
        guard let id = pendingEntry, let web = webView, !web.isLoading else { return }
        guard let data = try? JSONSerialization.data(withJSONObject: [id]), let json = String(data: data, encoding: .utf8) else { return }
        web.evaluateJavaScript("window.dispatchEvent(new CustomEvent('coursewatch:task',{detail:\(json)[0]}))")
        pendingEntry = nil
    }
    func notificationStatus() {
        UNUserNotificationCenter.current().getNotificationSettings { [weak self] settings in
            let status: String
            switch settings.authorizationStatus {
            case .authorized, .provisional, .ephemeral:
                switch settings.alertStyle {
                case .alert: status = "macOS 通知已授权 · 提醒会保留到关闭"
                case .banner: status = "macOS 通知已授权 · 当前为横幅，会自动隐藏；常驻请选择“提醒”"
                case .none: status = "macOS 通知已授权 · 当前不弹出通知；常驻请选择“提醒”"
                @unknown default: status = "macOS 通知已授权 · 请检查通知样式"
                }
            case .denied: status = "macOS 通知权限已关闭，请在系统设置中开启 CourseWatch"
            case .notDetermined: status = "尚未授权 macOS 通知"
            @unknown default: status = "请检查 macOS 通知设置"
            }
            DispatchQueue.main.async {
                guard let data = try? JSONSerialization.data(withJSONObject: [status]), let json = String(data: data, encoding: .utf8) else { return }
                self?.webView?.evaluateJavaScript("window.dispatchEvent(new CustomEvent('coursewatch:notificationStatus',{detail:\(json)[0]}))")
            }
        }
    }
    func authorizeNotifications(showGuide: Bool = false) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { [weak self] _, _ in
            DispatchQueue.main.async {
                self?.notificationStatus()
                self?.poll()
                if showGuide {
                    let alert = NSAlert()
                    alert.messageText = "设置常驻通知"
                    alert.informativeText = "在系统设置的“通知”中选择本应用（CourseWatch）：\n\n1. 开启“允许通知”。\n2. 通知样式选择“提醒”，通知会保留到你点击或关闭。\n3. “通知分组”选择“关闭”，每条通知可单独关闭。\n\n“横幅”会自动隐藏；专注模式可能延迟通知。"
                    alert.addButton(withTitle: "打开系统通知设置")
                    alert.addButton(withTitle: "稍后设置")
                    NSApp.activate(ignoringOtherApps: true)
                    if alert.runModal() == .alertFirstButtonReturn,
                       let url = URL(string: "x-apple.systempreferences:com.apple.Notifications-Settings.extension") {
                        NSWorkspace.shared.open(url)
                    }
                }
            }
        }
    }

    private func startBackend() {
        guard let resources = Bundle.main.resourceURL else { return }
        let data = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("CourseWatch")
        do {
            try FileManager.default.createDirectory(at: data, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            let logURL = data.appendingPathComponent("desktop-service.log")
            if let attrs = try? FileManager.default.attributesOfItem(atPath: logURL.path), let size = attrs[.size] as? NSNumber, size.intValue > 2_097_152 {
                let previous = data.appendingPathComponent("desktop-service.previous.log")
                try? FileManager.default.removeItem(at: previous)
                try? FileManager.default.moveItem(at: logURL, to: previous)
            }
            if !FileManager.default.fileExists(atPath: logURL.path) { FileManager.default.createFile(atPath: logURL.path, contents: nil, attributes: [.posixPermissions: 0o600]) }
            let log = try FileHandle(forWritingTo: logURL)
            try log.seekToEnd()
            let child = Process()
            child.executableURL = resources.appendingPathComponent("node")
            child.arguments = ["dist/server/apps/local-service/src/main.js"]
            child.currentDirectoryURL = resources.appendingPathComponent("app")
            var env = ProcessInfo.processInfo.environment
            // Do not inherit Node injection flags from the launching terminal.
            env.removeValue(forKey: "NODE_OPTIONS")
            env["COURSEWATCH_NATIVE_TOKEN"] = token
            env["COURSEWATCH_NATIVE_NOTIFICATIONS"] = "1"
            env["COURSEWATCH_DATA_DIR"] = data.path
            env["COURSEWATCH_BROWSER_MODE"] = "system"
            env.removeValue(forKey: "PLAYWRIGHT_BROWSERS_PATH")
            child.environment = env
            child.standardOutput = log
            child.standardError = log
            child.standardInput = FileHandle.nullDevice
            child.terminationHandler = { [weak self] _ in
                DispatchQueue.main.async {
                    guard let self = self, !self.quitting else { return }
                    self.ready = false
                    self.backendIssue = "后台已退出。请退出并重新打开 CourseWatch；若命令行后台仍在运行，请先停止它。"
                    self.updateMenu("后台已退出")
                    self.showStartupPage()
                }
            }
            process = child
            try child.run()
            try? log.close()
        } catch {
            backendIssue = "无法启动后台：\(error.localizedDescription)"
        }
    }

    @objc func showWindow() {
        if let existing = window {
            if existing.isMiniaturized { existing.deminiaturize(nil) }
            existing.makeKeyAndOrderFront(nil)
            restorePlatformWindows()
            NSApp.activate(ignoringOtherApps: true)
            attachRenderer()
            return
        }
        let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1060, height: 720), styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView], backing: .buffered, defer: false)
        w.title = "CourseWatch"
        w.titleVisibility = .hidden
        w.titlebarAppearsTransparent = true
        w.isMovableByWindowBackground = true
        w.collectionBehavior = [.fullScreenNone]
        w.tabbingMode = .disallowed
        w.standardWindowButton(.zoomButton)?.isEnabled = false
        w.standardWindowButton(.zoomButton)?.isHidden = true
        w.isReleasedWhenClosed = false
        w.animationBehavior = .documentWindow
        w.minSize = NSSize(width: 820, height: 600)
        w.backgroundColor = .clear
        w.isOpaque = false
        w.setFrameAutosaveName("CourseWatchMain")
        w.delegate = self
        let content = NSView()
        w.contentView = content
        // The rail defaults to opaque charcoal; glass is an explicit preference.
        let railGlass = NSVisualEffectView()
        let mainGlass = NSView()
        railGlass.material = .hudWindow
        railGlass.appearance = NSAppearance(named: .darkAqua)
        railGlass.blendingMode = .behindWindow
        sidebarMaterial = railGlass
        railGlass.state = .inactive
        railGlass.wantsLayer = true
        railGlass.layer?.backgroundColor = NSColor(srgbRed: 0.16, green: 0.17, blue: 0.19, alpha: 1).cgColor
        for surface in [railGlass as NSView, mainGlass] {
            surface.wantsLayer = true
            surface.layer?.cornerRadius = 18
            surface.layer?.masksToBounds = true
            surface.translatesAutoresizingMaskIntoConstraints = false
            content.addSubview(surface)
        }
        let toolbarGlass = NSVisualEffectView()
        toolbarGlass.material = .popover
        toolbarGlass.blendingMode = .behindWindow
        toolbarGlass.state = .active
        toolbarGlass.translatesAutoresizingMaskIntoConstraints = false
        mainGlass.addSubview(toolbarGlass)
        NSLayoutConstraint.activate([
            toolbarGlass.leadingAnchor.constraint(equalTo: mainGlass.leadingAnchor), toolbarGlass.trailingAnchor.constraint(equalTo: mainGlass.trailingAnchor),
            toolbarGlass.topAnchor.constraint(equalTo: mainGlass.topAnchor), toolbarGlass.heightAnchor.constraint(equalToConstant: 64),
            railGlass.leadingAnchor.constraint(equalTo: content.leadingAnchor), railGlass.widthAnchor.constraint(equalToConstant: 104),
            railGlass.topAnchor.constraint(equalTo: content.topAnchor), railGlass.bottomAnchor.constraint(equalTo: content.bottomAnchor),
            mainGlass.leadingAnchor.constraint(equalTo: railGlass.trailingAnchor, constant: 10), mainGlass.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            mainGlass.topAnchor.constraint(equalTo: content.topAnchor), mainGlass.bottomAnchor.constraint(equalTo: content.bottomAnchor)
        ])
        window = w
        attachRenderer()
        // Keep the two window controls above the full-size WebKit surface.
        let controls = WindowControlsView()
        windowControls = controls
        controls.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(controls)
        NSLayoutConstraint.activate([
            controls.leadingAnchor.constraint(equalTo: content.leadingAnchor), controls.topAnchor.constraint(equalTo: content.topAnchor),
            controls.trailingAnchor.constraint(equalTo: content.trailingAnchor), controls.heightAnchor.constraint(equalToConstant: 64)
        ])
        let buttonTypes: [NSWindow.ButtonType] = [.closeButton, .miniaturizeButton]
        let buttonActions: [Selector] = [#selector(closeWindow), #selector(minimizeWindow)]
        let buttonSize: CGFloat = 14
        let buttonGap: CGFloat = 8
        let buttonGroupWidth = CGFloat(buttonTypes.count) * buttonSize + CGFloat(buttonTypes.count - 1) * buttonGap
        let buttonOriginX = (104 - buttonGroupWidth) / 2
        let buttonOriginY = (64 - buttonSize) / 2
        for (index, type) in buttonTypes.enumerated() {
            w.standardWindowButton(type)?.isHidden = true
            do {
                let button = WindowControlButton()
                button.isClose = type == .closeButton
                button.isBordered = false
                button.title = ""
                button.setAccessibilityLabel(button.isClose ? "关闭窗口" : "最小化窗口")
                button.toolTip = button.isClose ? "关闭窗口" : "最小化窗口"
                button.translatesAutoresizingMaskIntoConstraints = true
                button.isHidden = false
                button.alphaValue = 1
                button.target = self
                button.action = buttonActions[index]
                controls.addSubview(button)
                button.frame = NSRect(x: buttonOriginX + CGFloat(index) * (buttonSize + buttonGap), y: buttonOriginY, width: buttonSize, height: buttonSize)
            }
        }
        if !w.setFrameUsingName("CourseWatchMain") { w.center() }
        w.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func setModalOpen(_ open: Bool) { windowControls?.toolbarDragEnabled = !open }
    func setToolbarActionsLeft(_ left: Double) { windowControls?.toolbarActionsLeft = max(114, CGFloat(left)) }

    func refreshInterface(excluding sender: WKWebView? = nil) {
        poll()
        for web in [webView].compactMap({ $0 }) + Array(platformWebViews.values) {
            if web !== sender { web.evaluateJavaScript("window.dispatchEvent(new Event('coursewatch:refresh'))") }
        }
    }

    func setSidebarGlass(_ enabled: Bool) {
        let glass = enabled && !NSWorkspace.shared.accessibilityDisplayShouldReduceTransparency
        sidebarMaterial?.state = glass ? .active : .inactive
        sidebarMaterial?.layer?.backgroundColor = glass ? NSColor.clear.cgColor : NSColor(srgbRed: 0.16, green: 0.17, blue: 0.19, alpha: 1).cgColor
    }

    func openPlatformWindow(_ platform: String) {
        let platformNames = ["ynjy": "云南省高等学校计算机等级考试系统", "renwei": "人卫", "yuketang": "雨课堂", "chaoxing": "超星", "unipus": "U校园"]
        guard let platformName = platformNames[platform], ready else { return }
        if let existing = platformWindows[platform] {
            if existing.isMiniaturized { existing.deminiaturize(nil) }
            existing.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            attachPlatformRenderer(platform, to: existing)
            return
        }
        let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 660, height: 700), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        w.title = platformName + "设置"
        w.minSize = NSSize(width: 480, height: 520)
        w.isReleasedWhenClosed = false
        w.collectionBehavior = [.fullScreenNone]
        w.tabbingMode = .disallowed
        w.standardWindowButton(.zoomButton)?.isEnabled = false
        w.standardWindowButton(.zoomButton)?.isHidden = true
        w.delegate = self
        w.setFrameAutosaveName("CourseWatch-" + platform)
        platformWindows[platform] = w
        attachPlatformRenderer(platform, to: w)
        if !w.setFrameUsingName("CourseWatch-" + platform) {
            w.center()
            if platform == "renwei" { w.setFrameOrigin(NSPoint(x: w.frame.origin.x + 36, y: w.frame.origin.y - 36)) }
        }
        w.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func attachPlatformRenderer(_ platform: String, to w: NSWindow) {
        guard platformWebViews[platform] == nil else { return }
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.userContentController.add(Bridge(self), name: "coursewatch")
        let script = "if(location.origin==='http://127.0.0.1:17321'){localStorage.setItem('coursewatch-client-token','\(token)');const mark=()=>document.documentElement.dataset.native='true';if(document.documentElement)mark();else document.addEventListener('DOMContentLoaded',mark,{once:true});}"
        config.userContentController.addUserScript(WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        if let state = platformStates[platform], let data = try? JSONSerialization.data(withJSONObject: state), let json = String(data: data, encoding: .utf8) {
            config.userContentController.addUserScript(WKUserScript(source: "window.__coursewatchInitialState=\(json);", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        let web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self
        web.uiDelegate = self
        web.autoresizingMask = [.width, .height]
        w.contentView = web
        platformWebViews[platform] = web
        web.load(URLRequest(url: serviceURL.appendingPathComponent("/").appending(queryItems: [URLQueryItem(name: "desktop", value: "1"), URLQueryItem(name: "platform", value: platform)])))
    }

    private func platformRenderingAllowed(_ platform: String) -> Bool {
        !NSApp.isHidden && platformWindows[platform]?.isVisible == true && platformWindows[platform]?.isMiniaturized == false
    }
    private func suspendPlatformRenderer(_ platform: String, web: WKWebView) {
        web.evaluateJavaScript("window.__coursewatchSnapshot?.()") { [weak self, weak web] state, _ in
            guard let self = self, let web = web, self.platformWebViews[platform] === web, !self.platformRenderingAllowed(platform), let window = self.platformWindows[platform] else { return }
            // Keep the live page if it is still loading and cannot yet preserve edits.
            guard let state = state as? [String: Any], state["busy"] as? Bool != true else { return }
            self.platformStates[platform] = state
            let detach: (NSImage?) -> Void = { [weak self, weak web] image in
                guard let self = self, let web = web, self.platformWebViews[platform] === web, !self.platformRenderingAllowed(platform) else { return }
                web.stopLoading()
                web.configuration.userContentController.removeScriptMessageHandler(forName: "coursewatch")
                web.navigationDelegate = nil; web.uiDelegate = nil
                let still = NSImageView(frame: web.bounds)
                still.image = image; still.imageScaling = .scaleAxesIndependently; still.autoresizingMask = [.width, .height]
                window.contentView = still
                self.platformWebViews.removeValue(forKey: platform)
            }
            if window.isVisible && !window.isMiniaturized && !NSApp.isHidden {
                web.takeSnapshot(with: nil) { image, _ in detach(image) }
            } else { detach(nil) }
        }
    }

    private func attachRenderer() {
        guard webView == nil, let content = window?.contentView else { return }
        snapshotView?.removeFromSuperview()
        snapshotView = nil
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.processPool = WKProcessPool()
        config.userContentController.add(Bridge(self), name: "coursewatch")
        let script = "if(location.origin==='http://127.0.0.1:17321'){localStorage.setItem('coursewatch-client-token','\(token)');const mark=()=>document.documentElement.dataset.native='true';if(document.documentElement)mark();else document.addEventListener('DOMContentLoaded',mark,{once:true});}"
        config.userContentController.addUserScript(WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        if let saved = savedInterface, let data = try? JSONSerialization.data(withJSONObject: saved), let json = String(data: data, encoding: .utf8) {
            config.userContentController.addUserScript(WKUserScript(source: "window.__coursewatchInitialState=\(json);", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        let web = WKWebView(frame: .zero, configuration: config)
        web.setValue(false, forKey: "drawsBackground")
        web.underPageBackgroundColor = .clear
        web.navigationDelegate = self
        web.uiDelegate = self
        web.allowsBackForwardNavigationGestures = false
        web.translatesAutoresizingMaskIntoConstraints = false
        if let controls = windowControls {
            content.addSubview(web, positioned: .below, relativeTo: controls)
        } else {
            content.addSubview(web)
        }
        NSLayoutConstraint.activate([web.leadingAnchor.constraint(equalTo: content.leadingAnchor), web.trailingAnchor.constraint(equalTo: content.trailingAnchor), web.topAnchor.constraint(equalTo: content.topAnchor), web.bottomAnchor.constraint(equalTo: content.bottomAnchor)])
        webView = web
        if ready { loadInterface() } else { showStartupPage() }
    }

    private var renderingAllowed: Bool { !NSApp.isHidden && window?.isVisible == true && window?.isMiniaturized == false }
    private func detachRenderer(_ web: WKWebView, state: String = "suspended") {
        web.stopLoading()
        web.configuration.userContentController.removeScriptMessageHandler(forName: "coursewatch")
        web.navigationDelegate = nil
        web.uiDelegate = nil
        web.removeFromSuperview()
        if webView === web { webView = nil }
        if ready { request("native/renderer", method: "POST", body: ["state": state]) { _ in } }
    }
    private func suspendRenderer() {
        if NSApp.isHidden || window?.isMiniaturized == true {
            snapshotView?.removeFromSuperview()
            snapshotView = nil
        }
        guard !renderingAllowed, let web = webView else { return }
        setPageVisibility(web)
        web.evaluateJavaScript("window.__coursewatchSnapshot?.()") { [weak self, weak web] result, _ in
            guard let self = self, let web = web, self.webView === web, !self.renderingAllowed else { return }
            // A page still loading has no snapshot yet; didFinish retries suspension.
            guard let state = result as? [String: Any], state["busy"] as? Bool != true else { return }
            self.savedInterface = state
            if NSApp.isHidden || self.window?.isMiniaturized == true || self.window?.isVisible != true {
                self.detachRenderer(web)
                return
            }
            web.takeSnapshot(with: nil) { [weak self, weak web] image, _ in
                guard let self = self, let web = web, self.webView === web, !self.renderingAllowed else { return }
                if let image = image, !NSApp.isHidden, self.window?.isMiniaturized == false, let content = self.window?.contentView {
                    let still = NSImageView(frame: content.bounds)
                    still.image = image
                    still.imageScaling = .scaleAxesIndependently
                    still.autoresizingMask = [.width, .height]
                    if let controls = self.windowControls {
                        content.addSubview(still, positioned: .below, relativeTo: controls)
                    } else {
                        content.addSubview(still)
                    }
                    self.snapshotView = still
                }
                self.detachRenderer(web)
            }
        }
    }
    private func setPageVisibility(_ web: WKWebView) {
        let visible = NSApp.isActive && web.window?.isVisible == true && web.window?.isMiniaturized == false
        web.evaluateJavaScript("window.dispatchEvent(new CustomEvent('coursewatch:visibility',{detail:\(visible ? "true" : "false")}))")
    }
    private func updatePlatformVisibility() {
        for (id, window) in platformWindows {
            if platformRenderingAllowed(id) {
                attachPlatformRenderer(id, to: window)
                if let web = platformWebViews[id] { setPageVisibility(web) }
            }
            else if let web = platformWebViews[id] { setPageVisibility(web); suspendPlatformRenderer(id, web: web) }
        }
    }
    func focusLoginWindow(_ target: NSWindow) {
        guard target === window || platformWindows.values.contains(where: { $0 === target }) else { return }
        if target.isMiniaturized { target.deminiaturize(nil) }
        target.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }
    func suspendIdlePages() { suspendRenderer(); updatePlatformVisibility() }
    func applicationDidResignActive(_ notification: Notification) {
        // Visible inactive windows must remain interactive while the official
        // login browser has focus. Pause polling without replacing the page.
        if let web = webView { setPageVisibility(web) }
        updatePlatformVisibility()
    }
    func applicationDidHide(_ notification: Notification) { suspendRenderer(); updatePlatformVisibility() }
    func applicationDidBecomeActive(_ notification: Notification) {
        if window?.isVisible == true && window?.isMiniaturized == false { attachRenderer() }
        if let web = webView { setPageVisibility(web) }
        updatePlatformVisibility()
    }
    func windowWillMiniaturize(_ notification: Notification) {
        if notification.object as? NSWindow === window { hidePlatformWindows() }
    }
    func windowDidMiniaturize(_ notification: Notification) { suspendRenderer(); updatePlatformVisibility() }
    func windowDidDeminiaturize(_ notification: Notification) {
        if notification.object as? NSWindow === window { restorePlatformWindows(); attachRenderer() }
        updatePlatformVisibility()
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        setPageVisibility(webView)
        if let id = platformWebViews.first(where: { $0.value === webView })?.key {
            if !platformRenderingAllowed(id) { suspendPlatformRenderer(id, web: webView) }
            return
        }
        guard webView === self.webView else { return }
        if !renderingAllowed { suspendRenderer(); return }
        if ready { request("native/renderer", method: "POST", body: ["state": "active"]) { _ in } }
        focusPendingEntry()
        notificationStatus()
        if pendingSettings { pendingSettings = false; webView.evaluateJavaScript("window.dispatchEvent(new Event('coursewatch:settings'))") }
    }

    private func showStartupPage() {
        let text = backendIssue ?? "正在启动…"
        let escaped = text.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
        webView?.loadHTMLString("<html><body style='font:13px -apple-system;color:#68737e;display:grid;place-items:center;height:95vh;background:transparent'><div style='max-width:440px;line-height:1.9'><h2 style='font-size:19px;font-weight:500'>CourseWatch</h2>\(escaped)</div></body></html>", baseURL: nil)
    }
    private func loadInterface() { webView?.load(URLRequest(url: serviceURL.appendingPathComponent("/").appending(queryItems: [URLQueryItem(name: "desktop", value: "1")]))) }
    func windowWillClose(_ notification: Notification) {
        if let closing = notification.object as? NSWindow, let id = platformWindows.first(where: { $0.value === closing })?.key {
            if let web = platformWebViews.removeValue(forKey: id) {
                web.stopLoading()
                web.configuration.userContentController.removeScriptMessageHandler(forName: "coursewatch")
                web.navigationDelegate = nil
                web.uiDelegate = nil
            }
            closing.contentView = nil
            platformWindows.removeValue(forKey: id)
            platformStates.removeValue(forKey: id)
            hiddenPlatformWindows.remove(id)
            return
        }
        guard notification.object as? NSWindow === window else { return }
        for platformWindow in Array(platformWindows.values) { platformWindow.close() }
        hiddenPlatformWindows.removeAll()
        if let web = webView {
            web.evaluateJavaScript("window.__coursewatchSnapshot?.()") { [weak self] state, _ in if let state = state as? [String: Any] { self?.savedInterface = state } }
            detachRenderer(web, state: "closed")
        }
        window?.contentView = nil
        snapshotView = nil
        windowControls = nil
        sidebarMaterial = nil
        window = nil
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { showWindow(); return true }
    @objc private func closeWindow() { NSApp.keyWindow?.close() }
    @objc private func minimizeWindow() {
        hideToMenuBar()
    }
    func hideToMenuBar() {
        preview.performClose(nil)
        statusItem.isVisible = true
        hidePlatformWindows()
        // Let AppKit use the user's Dock minimize effect and accessibility settings.
        window?.miniaturize(nil)
    }
    func dismissPlatformWindow(_ platform: String) { platformWindows[platform]?.close() }
    private func hidePlatformWindows() {
        for (id, platformWindow) in platformWindows where platformWindow.isVisible || platformWindow.isMiniaturized {
            hiddenPlatformWindows.insert(id)
            if platformWindow.isMiniaturized { platformWindow.deminiaturize(nil) }
            platformWindow.orderOut(nil)
        }
        updatePlatformVisibility()
    }
    private func restorePlatformWindows() {
        for id in hiddenPlatformWindows { platformWindows[id]?.orderFront(nil) }
        hiddenPlatformWindows.removeAll()
    }
    @objc private func showSettings() {
        pendingSettings = true
        showWindow()
        webView?.evaluateJavaScript("typeof window.__coursewatchSnapshot==='function' && window.dispatchEvent(new Event('coursewatch:settings'))") { [weak self] result, _ in
            if result as? Bool == true { self?.pendingSettings = false }
        }
    }

    private func request(_ path: String, method: String = "GET", body: [String: Any]? = nil, timeout: TimeInterval = 12, completion: @escaping (Result<[String: Any], Error>) -> Void) {
        var req = URLRequest(url: serviceURL.appendingPathComponent("api/" + path))
        req.httpMethod = method
        req.timeoutInterval = timeout
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue(serviceURL.absoluteString, forHTTPHeaderField: "Origin")
        if let body = body { req.httpBody = try? JSONSerialization.data(withJSONObject: body); req.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        session.dataTask(with: req) { data, response, error in
            let result: Result<[String: Any], Error>
            if let error = error { result = .failure(error) }
            else if let data = data, let response = response as? HTTPURLResponse, (200..<300).contains(response.statusCode), let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] { result = .success(object) }
            else {
                let object = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
                let message = (object?["error"] as? String).map { String($0.prefix(180)) } ?? "后台未响应或认证失败"
                result = .failure(NSError(domain: "CourseWatch", code: 1, userInfo: [NSLocalizedDescriptionKey: message]))
            }
            DispatchQueue.main.async { completion(result) }
        }.resume()
    }

    func poll() {
        guard !polling, !quitting, process?.isRunning == true else { return }
        polling = true
        request("health") { [weak self] result in
            guard let self = self else { return }
            self.polling = false
            switch result {
            case .success(let health):
                let wasReady = self.ready
                self.ready = true
                self.backendIssue = nil
                self.monitoring = health["monitoring"] as? Bool ?? false
                if !wasReady { self.loadInterface() }
                let count = health["enabledPlatforms"] as? Int ?? 0
                self.updateMenu(!self.monitoring ? "监控已暂停" : count == 0 ? "未开启监控对象" : health["status"] as? String == "degraded" ? "平台需要检查" : "正在监控 \(count) 个对象")
                if self.preview.isShown { self.refreshPreview() }
                if health["nativePending"] as? Bool == true { self.deliverNotifications() }
                self.syncCalendar()
            case .failure:
                self.updateMenu("后台连接中断")
                if !self.ready {
                    self.startupAttempts += 1
                    if self.startupAttempts < 20 { DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { self.poll() } }
                    else { self.backendIssue = "后台启动超时，请退出后重试。"; self.showStartupPage() }
                }
            }
        }
    }
    private func updateMenu(_ state: String) {
        stateItem.title = checking ? "正在检查…" : state
        pauseItem.title = monitoring ? "暂停监控" : "继续监控"
        pauseItem.isEnabled = ready
        checkItem.isEnabled = ready && !checking
        statusItem.button?.toolTip = "CourseWatch · \(state)"
    }
    @objc private func checkNow() {
        guard !checking else { return }
        checking = true
        updateMenu("正在检查…")
        request("monitor/check", method: "POST", body: [:], timeout: 300) { [weak self] result in
            self?.checking = false
            if case .failure = result { self?.alert("检查未完成", "请打开主窗口查看平台状态和检查日志。") }
            self?.poll()
        }
    }
    @objc private func toggleMonitor() { request("monitor/\(monitoring ? "stop" : "start")", method: "POST", body: [:]) { [weak self] _ in self?.poll(); self?.webView?.reload() } }

    func configureCalendar() {
        calendarSync.authorize { [weak self] _ in self?.syncCalendar(force: true) }
    }
    func syncCalendar(force: Bool = false) {
        guard ready, !calendarPolling, !quitting else { return }
        calendarPolling = true
        request("native/calendar") { [weak self] result in
            guard let self = self else { return }
            self.calendarPolling = false
            guard case .success(let snapshot) = result, let revision = snapshot["revision"] as? String else { return }
            self.calendarSync.apply(snapshot, force: force) { ok, message in
                self.request("native/calendar/status", method: "POST", body: ["revision": revision, "ok": ok, "message": message]) { _ in }
            }
        }
    }

    func deliverNotifications() {
        guard ready, !notifying, !quitting else { return }
        notifying = true
        request("native/pending") { [weak self] result in
            guard let self = self else { return }
            guard case .success(let data) = result, let items = data["items"] as? [[String: Any]], !items.isEmpty else { self.notifying = false; return }
            let center = UNUserNotificationCenter.current()
            center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
                DispatchQueue.main.async {
                    self.sendNotifications(items, index: 0, allowed: granted && error == nil)
                }
            }
        }
    }
    private func sendNotifications(_ items: [[String: Any]], index: Int, allowed: Bool) {
        guard index < items.count else { notifying = false; return }
        guard let id = items[index]["id"] as? Int else { sendNotifications(items, index: index + 1, allowed: allowed); return }
        let ack: (String?) -> Void = { [weak self] error in
            guard let self = self else { return }
            var payload: [String: Any] = ["id": id]
            if let error = error { payload["error"] = error }
            self.request("native/delivered", method: "POST", body: payload) { _ in self.sendNotifications(items, index: index + 1, allowed: allowed) }
        }
        guard allowed else { ack("系统通知未授权；记录保留在应用通知中心"); return }
        let content = UNMutableNotificationContent()
        content.title = items[index]["title"] as? String ?? "CourseWatch"
        content.body = items[index]["body"] as? String ?? ""
        content.sound = .default
        if let id = items[index]["task_id"] as? String { content.userInfo = ["entryId": id] }
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "coursewatch-\(id)", content: content, trigger: nil)) { error in
            DispatchQueue.main.async { ack(error == nil ? nil : "系统通知投递失败") }
        }
    }
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) { completionHandler([.banner, .list, .sound]) }
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) { DispatchQueue.main.async { self.pendingEntry = response.notification.request.content.userInfo["entryId"] as? String; self.showWindow(); self.focusPendingEntry() }; completionHandler() }

    func exportTasks() {
        exportJSON("export", filename: "coursewatch-tasks.json")
    }
    func exportJSON(_ endpoint: String, filename: String) {
        request(endpoint) { [weak self] result in
            guard let self = self else { return }
            guard case .success(let data) = result else { self.alert("导出未完成", "请稍后重试。"); return }
            let panel = NSSavePanel()
            panel.nameFieldStringValue = filename
            panel.canCreateDirectories = true
            panel.begin { response in
                guard response == .OK, let url = panel.url else { return }
                do { try JSONSerialization.data(withJSONObject: data, options: [.prettyPrinted, .sortedKeys]).write(to: url, options: .atomic) }
                catch { self.alert("无法保存", error.localizedDescription) }
            }
        }
    }
    private func openOfficial(_ url: URL?) {
        guard let url = url, url.scheme == "https", let host = url.host, officialHosts.contains(host), url.user == nil, url.password == nil, url.port == nil else { return }
        NSWorkspace.shared.open(url)
    }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let url = action.request.url, url.scheme == "http", url.host == "127.0.0.1", url.port == 17321 { decisionHandler(.allow) }
        else if action.request.url?.absoluteString == "about:blank" { decisionHandler(.allow) }
        else { if action.navigationType == .linkActivated { openOfficial(action.request.url) }; decisionHandler(.cancel) }
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? { openOfficial(action.request.url); return nil }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { if ready { webView.reload() } }
    @objc private func about() { NSApp.orderFrontStandardAboutPanel(options: [.applicationName: "CourseWatch", .applicationVersion: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "", .credits: NSAttributedString(string: "CourseWatch · macOS 测试版")]) }
    private func alert(_ title: String, _ message: String) { let alert = NSAlert(); alert.messageText = title; alert.informativeText = message; NSApp.activate(ignoringOtherApps: true); alert.runModal() }
    @objc private func quit() { NSApp.terminate(nil) }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if quitting { return .terminateNow }
        quitting = true
        timer?.invalidate(); previewTimer?.invalidate()
        hoverOpen?.cancel(); hoverClose?.cancel(); preview.performClose(nil)
        for platformWindow in Array(platformWindows.values) { platformWindow.close() }
        window?.close()
        guard let child = process, child.isRunning else { return .terminateNow }
        child.terminationHandler = { _ in DispatchQueue.main.async { NSApp.reply(toApplicationShouldTerminate: true) } }
        child.terminate()
        DispatchQueue.main.asyncAfter(deadline: .now() + 8) { if child.isRunning { kill(child.processIdentifier, SIGKILL); NSApp.reply(toApplicationShouldTerminate: true) } }
        return .terminateLater
    }
}

let application = NSApplication.shared
let delegate = AppDelegate()
application.delegate = delegate
application.run()
