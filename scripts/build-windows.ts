import { cp, mkdir, readFile, writeFile, rm, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyDistributionDocs, copyUiLicenses } from "./distribution-docs.js";
import { validateDesktopVersion, windowsArtifactBase } from "./desktop-version.js";

if (process.platform !== "win32" || process.arch !== "x64")
  throw new Error("Windows 包需要 Windows x64；在 Mac 上请使用 Windows GitHub Actions 工作流");
if (process.argv.slice(2).some((arg) => !["--skip-installer"].includes(arg)))
  throw new Error("支持 --skip-installer（只生成便携包）；安装包不附带浏览器");
const root = resolve(".");
execFileSync(process.execPath, [join(root, "scripts/verify-upstreams.mjs")], { cwd: root, stdio: "inherit" });
// 严禁删除：即使直接调用打包脚本，也必须验证受保护的学习逻辑。
execFileSync(process.execPath, [join(root, "scripts/verify-study-protection.mjs")], { cwd: root, stdio: "inherit" });
const pkg = JSON.parse(await readFile("package.json", "utf8"));
validateDesktopVersion(pkg.version, pkg.desktopBuild);
const artifactBase = windowsArtifactBase(pkg.version, pkg.desktopBuild, pkg.windowsRevision ?? 0);
for (const suffix of ['.zip', '-setup.exe']) {
  const output = join(root, 'dist', artifactBase + suffix);
  if (existsSync(output) || existsSync(output + '.sha256')) throw new Error('该版本的安装包或校验文件已存在，请递增补丁版本号');
}
if (!Number.isInteger(pkg.desktopBuild) || pkg.desktopBuild < 1) throw new Error("缺少有效的 desktopBuild");
const build = join(root, "build/windows/x64");
const app = join(build, "CourseWatch");
const resources = join(app, "resources");
const appRoot = join(resources, "app");
const cache = join(root, ".cache/windows");
const run = (file: string, args: string[], cwd = root) => {
  const powershell = file === "powershell.exe";
  const systemModules = join(process.env.SystemRoot ?? "C:/Windows", "System32/WindowsPowerShell/v1.0/Modules");
  return execFileSync(powershell ? join(process.env.SystemRoot ?? "C:/Windows", "System32/WindowsPowerShell/v1.0/powershell.exe") : file, args, {
    cwd, stdio: "inherit",
    // A pwsh parent exports its .NET modules; Windows PowerShell 5.1 must load
    // its own Security module when checking the Microsoft signature.
    env: powershell ? { ...process.env, PSModulePath: systemModules } : process.env,
  });
};
await mkdir(cache, { recursive: true });
await mkdir("dist", { recursive: true });
await rm(build, { recursive: true, force: true });
await mkdir(appRoot, { recursive: true });

async function download(url: string, destination: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(240000) });
  if (!response.ok) throw new Error(`下载失败：HTTP ${response.status} ${url}`);
  await writeFile(destination, Buffer.from(await response.arrayBuffer()));
}
const nodeVersion = "24.22.1";
const nodeFolder = `node-v${nodeVersion}-win-x64`;
const archiveName = `${nodeFolder}.zip`;
const nodeBase = `https://nodejs.org/dist/v${nodeVersion}/`;
const sumsPath = join(cache, "SHASUMS256.txt");
await download(nodeBase + "SHASUMS256.txt", sumsPath);
const checksum = (await readFile(sumsPath, "utf8")).split(/\r?\n/).map(line => line.trim().split(/\s+/)).find(row => row[1] === archiveName)?.[0];
if (!checksum || !/^[a-f0-9]{64}$/.test(checksum)) throw new Error("Node 官方清单未提供 Windows x64 校验值");
const archive = join(cache, archiveName);
if (!existsSync(archive) || createHash("sha256").update(await readFile(archive)).digest("hex") !== checksum)
  await download(nodeBase + archiveName, archive);
if (createHash("sha256").update(await readFile(archive)).digest("hex") !== checksum) throw new Error("Windows Node SHA256 校验失败");
// Pass paths through the environment instead of interpolating PowerShell source.
process.env.CW_ARCHIVE = archive; process.env.CW_CACHE = cache;
run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "Expand-Archive -LiteralPath $env:CW_ARCHIVE -DestinationPath $env:CW_CACHE -Force"]);
await cp(join(cache, nodeFolder, "node.exe"), join(resources, "node.exe"));
await cp(join(cache, nodeFolder, "LICENSE"), join(resources, "NODE-LICENSE.txt"));

run("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", "scripts/build-windows-icon.ps1", "-Source", "apps/extension/public/coursewatch.png", "-Destination", "apps/windows/CourseWatch.ico"]);
run("dotnet", ["publish", "apps/windows/CourseWatch.csproj", "-c", "Release", "-r", "win-x64", "--self-contained", "true", "-p:PublishSingleFile=false", "-p:Version=" + pkg.version, "-o", app]);
await cp("apps/windows/CourseWatch.ico", join(app, "CourseWatch.ico"));
await cp("dist/server", join(appRoot, "dist/server"), { recursive: true });
await cp("third_party", join(appRoot, "third_party"), { recursive: true });
await cp("dist/web", join(appRoot, "dist/web"), { recursive: true });
await writeFile(join(appRoot, "package.json"), JSON.stringify({ name: pkg.name, version: pkg.version, private: true, type: "module", license: pkg.license }, null, 2));

// Copy only the backend closure; never reuse macOS native modules in this package.
const roots = ["@fastify/rate-limit", "@fastify/static", "better-sqlite3", "cheerio", "fastify", "playwright", "nodemailer", "web-push", "qrcode", "zod"];
const copied = new Set<string>();
const notices: string[] = [];
function locate(name: string, from: string): string | undefined {
  for (let current = from;; current = dirname(current)) {
    const candidate = join(current, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) return candidate;
    if (dirname(current) === current) return;
  }
}
async function copyDependency(name: string, from: string, optional = false) {
  const source = locate(name, from);
  if (!source) { if (optional) return; throw new Error(`缺少依赖 ${name}`); }
  if (copied.has(source)) return;
  copied.add(source);
  const meta = JSON.parse(await readFile(join(source, "package.json"), "utf8"));
  notices.push(`${meta.name}@${meta.version} | ${JSON.stringify(meta.license ?? "See package license")}`);
  const destination = join(appRoot, relative(root, source));
  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true, filter: path => {
    const rel = relative(source, path), parts = rel.split(sep);
    if (parts[0] === "node_modules") return false;
    if (parts.some(part => ["test", "tests", "__tests__", "examples", "example", "benchmarks", "benchmark", ".github"].includes(part))) return false;
    if (/\.(?:map|d\.(?:ts|cts|mts))$/.test(rel)) return false;
    if (name === "zod" && parts[0] === "src") return false;
    if (name === "playwright" && (parts[0] === "lib" || parts[0] === "types" || parts[0] === "cli.js" || /^test\./.test(parts[0]!))) return false;
    if (name === "better-sqlite3") {
      if (["src", "deps"].includes(parts[0]!)) return false;
      if (parts[0] === "prebuilds" && parts.length > 1) return parts[1] === "win32-x64.node";
    }
    return true;
  } });
  for (const dep of Object.keys(meta.dependencies ?? {})) await copyDependency(dep, source);
  for (const dep of Object.keys(meta.optionalDependencies ?? {})) await copyDependency(dep, source, true);
}
for (const name of roots) await copyDependency(name, root);
await copyDistributionDocs(root, resources);
await cp("apps/windows/installer", join(resources, "INSTALLER-LICENSES"), { recursive: true });
const licenses = await copyUiLicenses(root, resources);
if (licenses.missing.length) console.warn("界面依赖许可仍需核对：" + licenses.missing.join("、"));
await writeFile(join(resources, "DEPENDENCIES.txt"), notices.sort().join("\n") + "\n\nNode 许可见 NODE-LICENSE.txt；此包不分发浏览器；.NET 与 NuGet 许可见 DOTNET-LICENSES。\n");
const dotnetLicenses = join(resources, "DOTNET-LICENSES");
await mkdir(dotnetLicenses, { recursive: true });
const assets = JSON.parse(await readFile("apps/windows/obj/project.assets.json", "utf8"));
const nugetPackages = new Map<string, string>();
for (const [name, meta] of Object.entries(assets.libraries) as [string, { type: string }][]) {
  if (meta.type === "package") { const at = name.lastIndexOf("/"); nugetPackages.set(name.slice(0, at).toLowerCase(), name.slice(at + 1)); }
}
for (const framework of Object.values(assets.project.frameworks) as { downloadDependencies?: { name: string; version: string }[] }[]) {
  for (const item of framework.downloadDependencies ?? []) nugetPackages.set(item.name.toLowerCase(), item.version.replace(/^\[/, "").split(",")[0]!.trim());
}
const dotnetIndex: string[] = [];
for (const [folder, version] of nugetPackages) {
  const source = join(assets.project.restore.packagesPath, folder, version);
  const target = join(dotnetLicenses, `${folder}-${version}`);
  await mkdir(target, { recursive: true });
  if (!existsSync(source)) { dotnetIndex.push(`${folder}@${version} | 未在 NuGet 缓存找到，请核查 SDK 安装目录`); continue; }
  const files = (await readdir(source)).filter(file => /license|notice|copyright|\.nuspec$/i.test(file));
  for (const file of files) await cp(join(source, file), join(target, file), { recursive: true });
  dotnetIndex.push(`${folder}@${version} | ${files.join(", ")}`);
  await writeFile(join(target, "SOURCE.txt"), `https://www.nuget.org/packages/${folder}/${version}\n`);
}
await writeFile(join(dotnetLicenses, "INDEX.txt"), "NuGet 依赖及 SDK 下载依赖，包含可能未进入产物的构建组件。\n" + dotnetIndex.sort().join("\n") + "\n");
// Framework runtime notices are included by the self-contained .NET publish.
for (const file of await readdir(app)) if (/license|thirdpartynotices/i.test(file)) await cp(join(app, file), join(dotnetLicenses, file));
await writeFile(join(resources, "build-info.json"), JSON.stringify({ version: pkg.version, platform: "win32", arch: "x64", nodeVersion, browserMode: "system", build: pkg.desktopBuild, windowsRevision: pkg.windowsRevision ?? 0, signed: false }, null, 2));

const assertPE = async (path: string) => {
  const bytes = await readFile(path);
  if (bytes.toString("ascii", 0, 2) !== "MZ") throw new Error(`不是 Windows 可执行文件：${path}`);
  const pe = bytes.readUInt32LE(0x3c);
  if (bytes.readUInt32LE(pe) !== 0x00004550 || bytes.readUInt16LE(pe + 4) !== 0x8664) throw new Error(`不是 Windows x64：${path}`);
};
for (const path of [join(app, "CourseWatch.exe"), join(resources, "node.exe"), join(appRoot, "node_modules/better-sqlite3/prebuilds/win32-x64.node")]) await assertPE(path);
run(join(resources, "node.exe"), [join(root, "scripts/check-desktop-bundle.mjs"), appRoot, "x64", pkg.version, "system"], appRoot);
run(join(resources, "node.exe"), [join(root, "scripts/check-windows-lifecycle.mjs"), appRoot], appRoot);

const zip = join(root, "dist", artifactBase + '.zip');
process.env.CW_ZIP_SOURCE = app; process.env.CW_ZIP_DESTINATION = zip;
run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "$ErrorActionPreference='Stop'; Compress-Archive -LiteralPath $env:CW_ZIP_SOURCE -DestinationPath $env:CW_ZIP_DESTINATION -Force"]);
const outputs = [zip];
if (!process.argv.includes("--skip-installer")) {
  const bootstrapper = join(cache, "MicrosoftEdgeWebview2Setup.exe");
  await download("https://go.microsoft.com/fwlink/p/?LinkId=2124703", bootstrapper);
  process.env.CW_WEBVIEW_BOOTSTRAPPER = bootstrapper;
  run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "$ErrorActionPreference='Stop'; $signature=Get-AuthenticodeSignature -LiteralPath $env:CW_WEBVIEW_BOOTSTRAPPER; if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') { throw 'WebView2 bootstrapper signature invalid' }"]);
  const compiler = process.env.COURSEWATCH_ISCC ?? join(process.env["ProgramFiles(x86)"] ?? "C:/Program Files (x86)", "Inno Setup 6/ISCC.exe");
  if (!existsSync(compiler)) throw new Error("未找到 Inno Setup 6；设置 COURSEWATCH_ISCC 或使用 --skip-installer");
  run(compiler, ["/DAppVersion=" + pkg.version, "/DAppBuild=" + pkg.desktopBuild, "/DArtifactBase=" + artifactBase, "/DSourceDir=" + app, "/DOutputDir=" + join(root, "dist"), "/DBootstrapper=" + bootstrapper, join(root, "apps/windows/installer.iss")]);
  outputs.push(join(root, "dist", artifactBase + '-setup.exe'));
}
for (const path of outputs) {
  const digest = createHash("sha256").update(await readFile(path)).digest("hex");
  await writeFile(path + ".sha256", `${digest}  ${basename(path)}\n`);
  console.log("已生成 " + path);
}
