import AppKit

// Icon Composer exports an edge-to-edge macOS rendition. Older macOS .icns
// artwork includes the surrounding transparent canvas; preserve Apple's mask
// and lighting. The 824 px display area preserves the reviewed legacy visual
// size; it is not a requirement for the full-bleed Icon Composer source.
let source = CommandLine.arguments[1]
let destination = CommandLine.arguments[2]
guard let image = NSImage(contentsOfFile: source),
      let colorSpace = CGColorSpace(name: CGColorSpace.sRGB),
      let context = CGContext(data: nil, width: 1024, height: 1024, bitsPerComponent: 8,
                              bytesPerRow: 0, space: colorSpace,
                              bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
    fatalError("无法读取 Icon Composer 导出图或创建 sRGB 画布")
}
context.interpolationQuality = .high
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: false)
image.draw(in: NSRect(x: 100, y: 100, width: 824, height: 824),
           from: .zero, operation: .copy, fraction: 1)
NSGraphicsContext.restoreGraphicsState()
guard let cgImage = context.makeImage(),
      let png = NSBitmapImageRep(cgImage: cgImage).representation(using: .png, properties: [:]) else {
    fatalError("无法导出兼容图标")
}
try png.write(to: URL(fileURLWithPath: destination))
