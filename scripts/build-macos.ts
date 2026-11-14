import {
  cp,
  mkdir,
  readFile,
  writeFile,
  rm,
  readdir,
  chmod,
  symlink,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, relative, resolve, basename } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { macRuntime, type MacArch } from "./macos-runtime.js";
import { copyDistributionDocs, copyUiLicenses } from "./distribution-docs.js";
import { validateDesktopVersion } from "./desktop-version.js";

if (process.platform !== "darwin")
  throw new Error("此构建脚本需要 macOS 与 Xcode Command Line Tools");
const args = process.argv.slice(2);
if (
  args.some(
    (arg) => !["--arch=arm64", "--arch=x64", "--slim"].includes(arg),
  )
)
  throw new Error("支持 --arch=arm64、--arch=x64、--slim；安装包不附带浏览器");
const arch = (args.find((arg) => arg.startsWith("--arch="))?.split("=")[1] ??
  process.arch) as MacArch;
if (!["arm64", "x64"].includes(arch)) throw new Error("不支持的 Mac 架构");
// All new packages use installed Chrome/Edge. Never copy browser runtimes.
const root = resolve(".");
execFileSync(process.execPath, [join(root, "scripts/verify-upstreams.mjs")], { cwd: root, stdio: "inherit" });
// 严禁删除：即使直接调用打包脚本，也必须验证受保护的学习逻辑。
execFileSync(process.execPath, [join(root, "scripts/verify-study-protection.mjs")], { cwd: root, stdio: "inherit" });
const pkg = JSON.parse(await readFile("package.json", "utf8"));
validateDesktopVersion(pkg.version, pkg.desktopBuild);
const variant = `${arch}${args.includes("--slim") ? "-slim" : ""}`;
const dmg = join(root, "dist", `CourseWatch-${pkg.version}-build${pkg.desktopBuild}-mac-${variant}.dmg`);
if (existsSync(dmg) || existsSync(dmg + '.sha256')) throw new Error('该构建的安装包或校验文件已存在，请递增版本号和构建号');
const build = join(root, "build/macos", `${variant}-build${pkg.desktopBuild}`);
const app = join(build, "CourseWatch.app");
const resources = join(app, "Contents/Resources");
const appRoot = join(resources, "app");
const run = (file: string, args: string[]) =>
  execFileSync(file, args, { cwd: root, stdio: "inherit" });
if (!Number.isInteger(pkg.desktopBuild) || pkg.desktopBuild < 1) throw new Error("缺少有效的 desktopBuild");
const bundleVersion = (await readFile("apps/macos/Info.plist", "utf8")).match(/<key>CFBundleVersion<\/key>\s*<string>(\d+)<\/string>/)?.[1];
if (bundleVersion !== String(pkg.desktopBuild)) throw new Error("macOS 构建号与 desktopBuild 不符");
const bundleShortVersion = (await readFile("apps/macos/Info.plist", "utf8")).match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/)?.[1];
if (bundleShortVersion !== pkg.version) throw new Error('macOS 版本号与 package.json 不符');
const runtime = await macRuntime(arch);
const cpu = arch === "x64" ? "x86_64" : "arm64";
const assertArchitecture = (path: string) => {
  const architectures = execFileSync("lipo", ["-archs", path], {
    encoding: "utf8",
  })
    .trim()
    .split(/\s+/);
  if (!architectures.includes(cpu)) throw new Error(`${path} 不包含 ${cpu}`);
};
assertArchitecture(runtime.executable);
await rm(build, { recursive: true, force: true });
await mkdir(join(app, "Contents/MacOS"), { recursive: true });
await mkdir(appRoot, { recursive: true });
await cp("apps/macos/Info.plist", join(app, "Contents/Info.plist"));
run("xcrun", [
  "swiftc",
  "-swift-version",
  "5",
  "-O",
  "-target",
  `${cpu}-apple-macosx14.0`,
  "-framework",
  "AppKit",
  "-framework",
  "WebKit",
  "-framework",
  "UserNotifications",
  "-framework",
  "EventKit",
  "apps/macos/main.swift",
  "apps/macos/CalendarSync.swift",
  "-o",
  join(app, "Contents/MacOS/CourseWatch"),
]);
run("xcrun", [
  "swift",
  "apps/macos/icon.swift",
  join(build, "AppIcon.iconset"),
  join(root, "apps/extension/public/coursewatch.png"),
]);
run("iconutil", [
  "-c",
  "icns",
  join(build, "AppIcon.iconset"),
  "-o",
  join(resources, "AppIcon.icns"),
]);
await cp("apps/extension/public/coursewatch-mark.svg", join(resources, "MenuBarIcon.svg"));
await cp(runtime.executable, join(resources, "node"));
await chmod(join(resources, "node"), 0o755);
await cp("dist/server", join(appRoot, "dist/server"), { recursive: true });
await cp("third_party", join(appRoot, "third_party"), { recursive: true });
await cp("dist/web", join(appRoot, "dist/web"), { recursive: true });
await writeFile(
  join(appRoot, "package.json"),
  JSON.stringify(
    { name: pkg.name, version: pkg.version, license: pkg.license, private: true, type: "module" },
    null,
    2,
  ),
);

// Copy the installed server dependency closure, including native prebuilds.
// Keep the same node_modules layout so nested dependency resolutions stay intact.
const roots = [
  "@fastify/rate-limit",
  "@fastify/static",
  "better-sqlite3",
  "cheerio",
  "fastify",
  "playwright",
  "nodemailer",
  "web-push",
  "qrcode",
  "zod",
];
const copied = new Set<string>();
const notices: string[] = [];
function locate(name: string, from: string): string | undefined {
  let current = from;
  while (true) {
    const candidate = join(current, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) return candidate;
    const next = dirname(current);
    if (next === current) return;
    current = next;
  }
}
async function copyDependency(name: string, from: string, optional = false) {
  const source = locate(name, from);
  if (!source) {
    if (optional) return;
    throw new Error(`缺少依赖 ${name}`);
  }
  if (copied.has(source)) return;
  copied.add(source);
  const meta = JSON.parse(await readFile(join(source, "package.json"), "utf8"));
  notices.push(
    `${meta.name} ${meta.version} — ${typeof meta.license === "string" ? meta.license : JSON.stringify(meta.license ?? "See package license")}`,
  );
  const destination = join(appRoot, relative(root, source));
  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination, {
    recursive: true,
    verbatimSymlinks: true,
    filter: (path) => {
      const rel = relative(source, path);
      const parts = rel.split("/");
      if (parts[0] === "node_modules") return false;
      // Remove development assets, while retaining runtime code and licenses.
      if (
        parts.some((part) =>
          [
            "test",
            "tests",
            "__tests__",
            "examples",
            "example",
            "benchmarks",
            "benchmark",
            ".github",
          ].includes(part),
        )
      )
        return false;
      if (rel.endsWith(".map")) return false;
      // Type declarations and Zod's original TypeScript sources are not read
      // by the packaged JavaScript runtime. Preserve JS/CJS and license files.
      if (/\.d\.(?:ts|cts|mts)$/.test(rel)) return false;
      if (name === "zod" && parts[0] === "src") return false;
      // The app uses Playwright's browser API, whose root entry re-exports
      // playwright-core. Its test runner and test CLI are never invoked.
      if (name === "playwright" && (parts[0] === "lib" || parts[0] === "types" || parts[0] === "cli.js" || /^test\./.test(parts[0]!))) return false;
      if (name === "better-sqlite3") {
        if (["src", "deps"].includes(parts[0]!)) return false;
        if (parts[0] === "prebuilds" && parts.length > 1)
          return rel === `prebuilds/darwin-${arch}.node`;
      }
      return true;
    },
  });
  for (const dep of Object.keys(meta.dependencies ?? {}))
    await copyDependency(dep, source);
  for (const dep of Object.keys(meta.optionalDependencies ?? {}))
    await copyDependency(dep, source, true);
}
for (const name of roots) await copyDependency(name, root);

const nodeLicense = runtime.license;
if (!existsSync(nodeLicense)) throw new Error("找不到内嵌 Node.js 的 LICENSE");
await cp(nodeLicense, join(resources, "NODE-LICENSE.txt"));
await copyDistributionDocs(root, resources);
const uiLicenses = await copyUiLicenses(root, resources);
if (uiLicenses.missing.length)
  console.warn(`分发前需补齐界面依赖许可：${uiLicenses.missing.join("、")}；见 UI-LICENSES/INDEX.txt`);
await writeFile(
  join(resources, "DEPENDENCIES.txt"),
  notices.sort().join("\n") +
    "\n\n各软件包的许可文件保留在 app/node_modules。\n" +
    "安装包不分发浏览器二进制，使用本机 Chrome／Edge。\n",
);

await writeFile(
  join(resources, "安装说明.txt"),
  `将 CourseWatch 拖入 Applications 后打开。需要 macOS 14 或更新版本。\n此包不含浏览器。平台登录与学习使用本机 Google Chrome 或 Microsoft Edge，请安装到 /Applications 或当前用户的 Applications。在设置的通用中切换浏览器。使用独立登录目录，不读取日常浏览器资料，不自动下载浏览器。\n本测试包使用本地临时签名，尚未完成 Apple 公证。\n条款、隐私及许可说明见本目录中的 TERMS.md、DISCLAIMER.md、PRIVACY.md、LICENSE、NOTICE 和第三方许可说明。\n关闭主窗口后仍在菜单栏运行，使用菜单栏退出停止后台。\n`,
);

async function signNative(directory: string) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) await signNative(path);
    else if (entry.name.endsWith(".node") || entry.name.endsWith(".dylib")) {
      const kind = execFileSync("file", ["-b", path], { encoding: "utf8" });
      if (
        kind.includes("Mach-O") &&
        (kind.includes(cpu) || kind.includes("universal"))
      )
        run("codesign", ["--force", "--sign", "-", path]);
    }
  }
}
await signNative(join(appRoot, "node_modules"));
for (const path of [
  join(app, "Contents/MacOS/CourseWatch"),
  join(resources, "node"),
  join(appRoot, `node_modules/better-sqlite3/prebuilds/darwin-${arch}.node`),
])
  assertArchitecture(path);
// Exercise the exact runtime + native SQLite module that will ship. A cross
// build on Apple Silicon requires Rosetta to run the Intel smoke check.
execFileSync(
  join(resources, "node"),
  [
    "--input-type=module",
    "-e",
    "import Database from 'better-sqlite3'; const db = new Database(':memory:'); if(db.prepare('SELECT 42 AS value').get().value!==42)process.exit(1);db.close();console.log('运行时及 SQLite：'+process.arch+' OK');",
  ],
  { cwd: appRoot, stdio: "inherit" },
);
execFileSync(
  join(resources, "node"),
  [join(root, "scripts/check-desktop-bundle.mjs"), appRoot, arch, pkg.version, "system"],
  { cwd: appRoot, stdio: "inherit" },
);
run("codesign", ["--force", "--sign", "-", join(resources, "node")]);
run("codesign", ["--force", "--deep", "--sign", "-", app]);
run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", app]);
const imageRoot = join(build, "dmg");
await mkdir(imageRoot, { recursive: true });
// Installation volume exposes only the app and Applications shortcut.
// Terms, license notices and documentation remain inside the app resources.
// Stage the verified bundle next to the Applications installation shortcut.
await symlink("/Applications", join(imageRoot, "Applications"));
await cp(app, join(imageRoot, "CourseWatch.app"), {
  recursive: true,
  verbatimSymlinks: true,
});
const imageArgs = [
  "create",
  "-volname",
  "CourseWatch",
  "-srcfolder",
  imageRoot,
  "-format",
  // LZMA images are supported from macOS 10.15; this app requires macOS 14.
  "ULMO",
  dmg,
];
for (let attempt = 0; ; attempt++) {
  try {
    execFileSync("hdiutil", imageArgs, { cwd: root, stdio: ["ignore", "inherit", "pipe"] });
    break;
  } catch (error) {
    const detail = (error as { stderr?: Buffer }).stderr?.toString() ?? "";
    if (!/Resource busy/i.test(detail) || attempt >= 2) throw error;
    console.warn("hdiutil 资源暂时占用，稍后重试生成 DMG");
    await new Promise(resolve => setTimeout(resolve, 1500 * (attempt + 1)));
  }
}
run("hdiutil", ["verify", dmg]);
const sha = createHash("sha256")
  .update(await readFile(dmg))
  .digest("hex");
await writeFile(dmg + ".sha256", `${sha}  ${basename(dmg)}\n`);
console.log(`\n应用：${app}\n安装包：${dmg}\nSHA256：${sha}`);
