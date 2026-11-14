import AppKit
import ScreenCaptureKit
import ImageIO
import UniformTypeIdentifiers

// Capture only the isolated README application and its wallpaper window.
// Usage: capture-readme-desktop OUTPUT.png [--preview]
guard CommandLine.arguments.count >= 2 else {
    fputs("用法：capture-readme-desktop OUTPUT.png [--preview]\n", stderr)
    exit(1)
}
let capturePreview = CommandLine.arguments.contains("--preview")
Task {
    do {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        guard let app = content.applications.first(where: { $0.bundleIdentifier == "top.mcsog.coursewatch.readme" }),
              let backdrop = content.windows.first(where: { $0.owningApplication?.processID == app.processID && $0.title == "README 截图背景" }),
              let display = content.displays.first(where: { $0.frame.intersects(backdrop.frame) }) else {
            throw NSError(domain: "ReadmeCapture", code: 1, userInfo: [NSLocalizedDescriptionKey: "隔离演示应用及壁纸背景必须显示在当前桌面"])
        }
        let ownWindows = content.windows.filter { $0.owningApplication?.processID == app.processID }
        let excluded = capturePreview ? ownWindows.filter { $0.title == "CourseWatch" || $0.title == "CourseWatchMenuBar" } : []
        let filter = SCContentFilter(display: display, including: [app], exceptingWindows: excluded)
        let config = SCStreamConfiguration()
        if capturePreview {
            guard let preview = ownWindows.first(where: { ($0.title ?? "").isEmpty && $0.frame.width > 300 && $0.frame.height > 300 }) else {
                throw NSError(domain: "ReadmeCapture", code: 2, userInfo: [NSLocalizedDescriptionKey: "请先打开演示应用的原生菜单栏预览"])
            }
            config.sourceRect = preview.frame.insetBy(dx: -42, dy: -15).offsetBy(dx: -display.frame.minX, dy: -display.frame.minY)
        } else {
            config.sourceRect = CGRect(x: 56, y: 48, width: 1400, height: 910)
        }
        config.width = Int(config.sourceRect.width * 2)
        config.height = Int(config.sourceRect.height * 2)
        config.showsCursor = false
        let screenshot = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
        let url = URL(fileURLWithPath: CommandLine.arguments[1])
        guard let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else {
            throw NSError(domain: "ReadmeCapture", code: 3, userInfo: [NSLocalizedDescriptionKey: "无法创建输出图片"])
        }
        CGImageDestinationAddImage(destination, screenshot, nil)
        guard CGImageDestinationFinalize(destination) else {
            throw NSError(domain: "ReadmeCapture", code: 4, userInfo: [NSLocalizedDescriptionKey: "截图写入失败"])
        }
        print(url.path)
        exit(0)
    } catch {
        fputs("\(error.localizedDescription)\n", stderr)
        exit(1)
    }
}
RunLoop.main.run()
