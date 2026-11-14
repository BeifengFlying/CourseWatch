import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(".");
const candidates = [
  process.env.COURSEWATCH_ICTOOL,
  "/Applications/Icon Composer.app/Contents/Executables/ictool",
  "/Applications/Xcode.app/Contents/Applications/Icon Composer.app/Contents/Executables/ictool",
  join(root, ".cache/apple-icon-tools/Icon Composer.app/Contents/Executables/ictool"),
];
const ictool = candidates.find((path): path is string => !!path && existsSync(path));
if (!ictool) throw new Error("未找到 Apple ictool；安装 Icon Composer 或设置 COURSEWATCH_ICTOOL");
const exports = join(root, "design/icon/exports");
await mkdir(exports, { recursive: true });
for (const [name, rendition] of [
  ["default", "Default"],
  ["dark", "Dark"],
  ["tinted-light", "TintedLight"],
  ["tinted-dark", "TintedDark"],
] as const) {
  const rendered = join(exports, `macos-${name}-1024.png`);
  execFileSync(ictool, [
    "apps/macos/AppIcon.icon", "--export-image", "--output-file", rendered,
    "--platform", "macOS", "--rendition", rendition,
    "--width", "1024", "--height", "1024", "--scale", "1",
  ], { stdio: "inherit" });
  execFileSync("xcrun", ["swift", "apps/macos/prepare-icon.swift", rendered,
    join(exports, `legacy-${name}-1024.png`)], { stdio: "inherit" });
}
const png = await readFile(join(exports, "legacy-default-1024.png"));
await writeFile("apps/extension/public/coursewatch.png", png);
// Preserve the existing web asset URL. This is a generated raster wrapper,
// not the editable source; the outlined layers live in AppIcon.icon/Assets.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><title>CourseWatch</title><image width="1024" height="1024" href="data:image/png;base64,${png.toString("base64")}"/></svg>\n`;
await writeFile("apps/extension/public/coursewatch.svg", svg);
await writeFile("design/icon/coursewatch.svg", svg);
await writeFile("design/icon/coursewatch.png", png);
// Keep the README artwork in sync with the application icon.
execFileSync("sips", ["-z", "256", "256", "design/icon/coursewatch.png",
  "--out", "docs/images/coursewatch-icon.png"], { stdio: "inherit" });
console.log("已导出 Apple 渲染预览及 macOS 14/15 兼容图标");
