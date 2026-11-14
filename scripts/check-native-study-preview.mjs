// Render the production AppKit preview with fictional state; no service or account access.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
mkdirSync('.cache',{recursive:true});mkdirSync('docs/screenshots',{recursive:true});
let source=readFileSync('apps/macos/main.swift','utf8');source=source.slice(0,source.lastIndexOf('let application = NSApplication.shared'));
source=readFileSync('apps/macos/CalendarSync.swift','utf8')+'\n'+source;
source=source.replace('    private func updateStudyCards()',`    func renderFixture(_ studies: [[String: Any]]) -> NSView {
        ready = true; previewLoaded = true; previewStudies = studies; previewTotal = 8
        previewItems = [["title":"模拟：数据结构课程作业", "dueAt":Date().addingTimeInterval(3600).timeIntervalSince1970 * 1000], ["title":"模拟：下周实验报告", "dueAt":Date().addingTimeInterval(172800).timeIntervalSince1970 * 1000]]
        renderPreview()
        let root = preview.contentViewController!.view
        root.setFrameSize(preview.contentSize)
        return root
    }
    private func updateStudyCards()`);
source+=String.raw`
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let owner = AppDelegate()
let state: [String: Any] = ["platform":"chaoxing", "phase":"running", "courseName":"模拟数据结构：线性结构与算法", "operation":"play", "navigation":["previous":false,"next":true], "progress":["chapter":"第二章 · 线性表的顺序存储结构与操作", "media":[["current":132.0,"duration":600.0,"paused":false,"ended":false]], "documents":[]]]
var paused = state; paused["platform"] = "unipus"; paused["phase"] = "paused"; paused["courseName"] = "模拟大学英语读写教程"; paused["message"] = "已暂停，可继续或选择相邻章节"
func buttons(_ view: NSView) -> [NSButton] { (view as? NSButton).map { [$0] } ?? view.subviews.flatMap(buttons) }
for (theme, appearance) in [("light",NSAppearance.Name.aqua),("dark",NSAppearance.Name.darkAqua)] {
    for count in [1,2] {
        let root = owner.renderFixture(count == 1 ? [state] : [state,paused])
        let window = NSWindow(contentRect: root.bounds, styleMask: [.borderless], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: appearance); window.contentView = root; window.orderFront(nil)
        root.layoutSubtreeIfNeeded(); root.displayIfNeeded()
        RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        precondition(root.bounds.width == 390 && root.bounds.height < 780, "popup bounds")
        for button in buttons(root) { let r = button.convert(button.bounds, to: root); precondition(r.minX >= 0 && r.maxX <= 391 && r.minY >= 0 && r.maxY <= root.bounds.height + 1, "button bounds") }
        let bitmap = root.bitmapImageRepForCachingDisplay(in: root.bounds)!
        root.cacheDisplay(in: root.bounds, to: bitmap)
        try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: "docs/screenshots/native-study-\(count)-\(theme).png"))
        print("preview \(theme) cards=\(count) size=\(root.bounds.size)")
        window.orderOut(nil)
    }
}
let card = StudyPreviewCard(frame: NSRect(x:0,y:0,width:354,height:250)); var actions: [String] = []; card.action = { actions.append($0) }; card.update(state)
let controls = buttons(card); precondition(controls.count == 4 && !controls[0].isEnabled && controls[2].isEnabled)
controls[1].performClick(nil); controls[2].performClick(nil); precondition(actions == ["pause","next"])
card.update(paused); precondition(buttons(card)[1] === controls[1]); controls[1].performClick(nil); precondition(actions.last == "resume")
controls[3].performClick(nil); precondition(actions.last == "show")
card.update(paused,busy:true); precondition(controls.allSatisfy { !$0.isEnabled })
print("native callbacks, busy controls and stable view identity passed")
`;
writeFileSync('.cache/native-study-fixture.swift',source);
execFileSync('xcrun',['swiftc','.cache/native-study-fixture.swift','-o','.cache/native-study-fixture'],{stdio:'inherit'});
execFileSync('.cache/native-study-fixture',[],{stdio:'inherit'});
