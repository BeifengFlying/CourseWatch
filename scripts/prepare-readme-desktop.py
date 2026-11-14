#!/usr/bin/env python3
"""Compile an isolated native app for real desktop screenshots; does not launch it.
Requires build:web and local node dependencies. No production data is accessed.
"""
import json
import pathlib
import plistlib
import shutil
import subprocess
import sys
import tempfile

if sys.platform != 'darwin':
    raise SystemExit('此截图入口仅支持 macOS')
root = pathlib.Path(__file__).resolve().parent.parent
cache = root / '.cache/readme-desktop'
cache.mkdir(parents=True, exist_ok=True)
wallpaper = cache / 'macos27-golden-gate.png'
if not wallpaper.is_file():
    raise SystemExit('请先将展示壁纸保存为 .cache/readme-desktop/macos27-golden-gate.png；来源见截图记录。')
app = cache / 'CourseWatch Demo.app'
resources = app / 'Contents/Resources'
(resources / 'app').mkdir(parents=True, exist_ok=True)
(app / 'Contents/MacOS').mkdir(parents=True, exist_ok=True)
data = pathlib.Path(tempfile.mkdtemp(prefix='coursewatch-readme-'))
source = (root / 'apps/macos/main.swift').read_text().replace('17321', '17402')
source = source.replace('FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("CourseWatch")', f'URL(fileURLWithPath: {json.dumps(str(data))})')
source = source.replace('child.arguments = ["dist/server/apps/local-service/src/main.js"]', f'child.arguments = ["--import", {json.dumps(str(root / "node_modules/tsx/dist/loader.mjs"))}, {json.dumps(str(root / "scripts/preview-readme-desktop.mjs"))}]')
source = source.replace('env["COURSEWATCH_NATIVE_NOTIFICATIONS"] = "1"', 'env["COURSEWATCH_NATIVE_NOTIFICATIONS"] = "1"\n            env["COURSEWATCH_README_PREVIEW"] = "1"')
source = source.replace('width: 1060, height: 720), styleMask:', 'width: 1200, height: 820), styleMask:', 1)
if wallpaper.exists():
    source = source.replace('    private func installMenus() {', '''    private var readmeBackdrop: NSWindow?
    private func showReadmeBackdrop() {
        guard let screen = NSScreen.main, let image = NSImage(contentsOfFile: WALLPAPER_PATH) else { return }
        let background = NSWindow(contentRect: screen.frame, styleMask: .borderless, backing: .buffered, defer: false)
        background.level = NSWindow.Level(rawValue: NSWindow.Level.normal.rawValue - 1)
        background.collectionBehavior = [.stationary, .ignoresCycle]
        background.isReleasedWhenClosed = false
        background.title = "README 截图背景"
        let imageView = NSImageView(frame: NSRect(origin: .zero, size: screen.frame.size))
        imageView.image = image
        imageView.imageScaling = .scaleAxesIndependently
        background.contentView = imageView
        background.orderFront(nil)
        readmeBackdrop = background
    }

    private func installMenus() {'''.replace('WALLPAPER_PATH', json.dumps(str(wallpaper))), 1)
    source = source.replace('        showWindow()\n', '        showReadmeBackdrop()\n        showWindow()\n', 1)
(cache / 'main.swift').write_text(source)
plist = plistlib.loads((root / 'apps/macos/Info.plist').read_bytes())
plist.update(CFBundleIdentifier='top.mcsog.coursewatch.readme', CFBundleName='CourseWatch Demo', CFBundleDisplayName='CourseWatch Demo')
(app / 'Contents/Info.plist').write_bytes(plistlib.dumps(plist))
for name, target in [('node', pathlib.Path(shutil.which('node'))), ('app/dist', root / 'dist')]:
    link = resources / name
    if link.is_symlink():
        link.unlink()
    link.symlink_to(target, target_is_directory=target.is_dir())
for name in ['MenuBarIcon.svg', 'AppIcon.icns']:
    original = pathlib.Path('/Applications/CourseWatch.app/Contents/Resources') / name
    if original.exists():
        shutil.copy2(original, resources / name)
subprocess.run(['xcrun', 'swiftc', '-swift-version', '5', '-O', '-framework', 'AppKit', '-framework', 'WebKit', '-framework', 'UserNotifications', '-framework', 'EventKit', str(cache / 'main.swift'), str(root / 'apps/macos/CalendarSync.swift'), '-o', str(app / 'Contents/MacOS/CourseWatch')], check=True)
subprocess.run(['codesign', '--force', '--deep', '--sign', '-', str(app)], check=True)
subprocess.run(['xcrun', 'swiftc', str(root / 'scripts/capture-readme-desktop.swift'), '-o', str(cache / 'capture-readme-desktop')], check=True)
print(f'隔离应用：{app}\n临时数据：{data}\n退出截图应用后可移除该临时数据目录。')
