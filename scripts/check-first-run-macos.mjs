import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
mkdirSync('.cache/first-run36', { recursive: true });
const source = readFileSync('apps/macos/main.swift', 'utf8');
const consent = source.slice(source.indexOf('final class FirstRunConsent:'), source.indexOf('final class Bridge:'));
const fixture = String.raw`
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let directory = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent(UUID().uuidString)
try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
let terms = try String(contentsOfFile: "TERMS.md", encoding: .utf8)
try terms.write(to: directory.appendingPathComponent("TERMS.md"), atomically: true, encoding: .utf8)
let suite = "top.mcsog.coursewatch.first-run-check." + UUID().uuidString
let defaults = UserDefaults(suiteName: suite)!
defer { defaults.removePersistentDomain(forName: suite); try? FileManager.default.removeItem(at: directory) }
defaults.set(true, forKey: "CourseWatch.UserAgreement.2026-11-15.1")
precondition(!defaults.bool(forKey: FirstRunConsent.acceptanceKey))
var presentations = 0
func response(_ choice: NSApplication.ModalResponse) -> (NSAlert) -> NSApplication.ModalResponse {
    return { alert in
        presentations += 1
        precondition(alert.messageText == "用户协议与免费声明")
        precondition(alert.informativeText.contains("本软件完全免费。"))
        precondition(alert.informativeText.contains("请立即退款并举报该商家"))
        precondition(alert.buttons.map(\.title) == ["同意并继续", "退出软件"])
        let scroll = alert.accessoryView!.subviews.compactMap { $0 as? NSScrollView }.first!
        precondition((scroll.documentView as! NSTextView).string == terms)
        return choice
    }
}
precondition(!FirstRunConsent.requestIfNeeded(defaults: defaults, resources: directory, present: response(.alertSecondButtonReturn)))
precondition(!defaults.bool(forKey: FirstRunConsent.acceptanceKey))
precondition(!FirstRunConsent.requestIfNeeded(defaults: defaults, resources: directory, present: response(.abort)))
precondition(!defaults.bool(forKey: FirstRunConsent.acceptanceKey))
precondition(FirstRunConsent.requestIfNeeded(defaults: defaults, resources: directory, present: response(.alertFirstButtonReturn)))
precondition(defaults.bool(forKey: FirstRunConsent.acceptanceKey))
let reopened = UserDefaults(suiteName: suite)!
precondition(FirstRunConsent.requestIfNeeded(defaults: reopened, resources: nil, present: { _ in fatalError("Repeated dialog") }))
precondition(presentations == 3)
defaults.removeObject(forKey: FirstRunConsent.acceptanceKey)
precondition(!FirstRunConsent.requestIfNeeded(defaults: defaults, resources: nil, present: { alert in
    precondition(alert.messageText == "无法读取用户协议"); return .alertFirstButtonReturn
}))
precondition(!defaults.bool(forKey: FirstRunConsent.acceptanceKey))
for (theme, name) in [("light", NSAppearance.Name.aqua), ("dark", NSAppearance.Name.darkAqua)] {
    for (size, width) in [("desktop", CGFloat(460)), ("compact", CGFloat(320))] {
        app.appearance = NSAppearance(named: name)
        let owner = FirstRunConsent()
        let alert = owner.makeAlert(terms: terms, width: width)
        alert.window.appearance = NSAppearance(named: name)
        alert.layout()
        alert.window.center(); alert.window.orderFront(nil)
        RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        let root = alert.window.contentView!
        root.layoutSubtreeIfNeeded(); root.displayIfNeeded()
        for button in alert.buttons {
            let rect = button.convert(button.bounds, to: root)
            precondition(root.bounds.contains(rect), "Clipped action")
        }
        let scroll = alert.accessoryView!.subviews.compactMap { $0 as? NSScrollView }.first!
        let document = scroll.documentView as! NSTextView
        precondition(document.string == terms && !document.isEditable && document.isSelectable)
        document.scrollToEndOfDocument(nil)
        RunLoop.current.run(until: Date().addingTimeInterval(0.1))
        precondition(scroll.contentView.bounds.minY > 0, "Agreement cannot scroll")
        document.scrollToBeginningOfDocument(nil)
        let bitmap = root.bitmapImageRepForCachingDisplay(in: root.bounds)!
        root.cacheDisplay(in: root.bounds, to: bitmap)
        try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: ".cache/first-run36/\(size)-\(theme).png"))
        print("consent \(size) \(theme) size=\(root.bounds.size), complete terms and actions visible")
        alert.window.orderOut(nil)
    }
}
print("First launch, rejection, window dismissal, accepted restart and missing terms checks passed; isolated defaults only.")
`;
writeFileSync('.cache/first-run36/fixture.swift', 'import AppKit\n' + consent + '\n' + fixture);
execFileSync('xcrun', ['swiftc', '-swift-version', '5', '.cache/first-run36/fixture.swift', '-o', '.cache/first-run36/check'], { stdio: 'inherit' });
execFileSync('.cache/first-run36/check', [], { stdio: 'inherit' });
