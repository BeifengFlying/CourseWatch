import { mkdir, writeFile, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { dataDir } from "../apps/local-service/src/paths.js";
const exec = promisify(execFile);
const mode = process.argv[2];
const node = process.execPath;
const root = resolve(".");
const built = existsSync(resolve("dist/server/apps/local-service/src/main.js"));
const script = resolve(
  built
    ? "dist/server/apps/local-service/src/main.js"
    : "apps/local-service/src/main.ts",
);
if (!["enable", "disable", "status"].includes(mode)) {
  console.log(
    "用法：npm run autostart -- enable | disable | status\n源码实验版：请保持仓库、Node 和依赖所在位置不变。默认未注册自启动。",
  );
  process.exit(0);
}
await mkdir(dataDir, { recursive: true, mode: 0o700 });
if (process.platform === "darwin") {
  const label = "top.mcsog.coursewatch";
  const path = join(homedir(), "Library/LaunchAgents", `${label}.plist`);
  const target = `gui/${process.getuid!()}`;
  const esc = (s: string) =>
    s.replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&apos;",
        })[c]!,
    );
  if (mode === "enable") {
    await mkdir(join(homedir(), "Library/LaunchAgents"), { recursive: true });
    const args = (built ? [node, script] : [node, "--import", "tsx", script])
      .map((a) => `<string>${esc(a)}</string>`)
      .join("");
    await writeFile(
      path,
      `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array>${args}</array><key>WorkingDirectory</key><string>${esc(root)}</string><key>RunAtLoad</key><true/><key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict><key>ThrottleInterval</key><integer>30</integer><key>StandardOutPath</key><string>${esc(join(dataDir, "service.log"))}</string><key>StandardErrorPath</key><string>${esc(join(dataDir, "service.log"))}</string><key>EnvironmentVariables</key><dict><key>COURSEWATCH_DATA_DIR</key><string>${esc(dataDir)}</string></dict></dict></plist>`,
      { mode: 0o600 },
    );
    await exec("launchctl", ["bootstrap", target, path]);
    console.log("已注册当前用户自启动；不要移动仓库或 Node。");
  } else if (mode === "disable") {
    await exec("launchctl", ["bootout", `${target}/${label}`]).catch(() => {});
    await unlink(path).catch(() => {});
    console.log("已取消课哨自启动。");
  } else {
    try {
      const r = await exec("launchctl", ["print", `${target}/${label}`]);
      console.log(
        r.stdout
          .split("\n")
          .filter((l) => /state =|pid =|last exit code/.test(l))
          .join("\n") || "已注册",
      );
    } catch {
      console.log("未注册自启动");
    }
  }
} else if (process.platform === "win32") {
  const name = "CourseWatch";
  const launcher = join(dataDir, "start-coursewatch.cmd");
  if (mode === "enable") {
    // Reject cmd metacharacters rather than interpolate arbitrary paths into a command file.
    if (/[\r\n%&|<>^!]/.test(root + node + script + dataDir))
      throw new Error("路径含 Windows 命令特殊字符，请将仓库移至简单路径");
    await writeFile(
      launcher,
      `@echo off\r\ncd /d "${root}"\r\nset "COURSEWATCH_DATA_DIR=${dataDir}"\r\n"${node}" ${built ? "" : "--import tsx "}"${script}"\r\n`,
    );
    await exec("schtasks", [
      "/Create",
      "/TN",
      name,
      "/TR",
      `"${launcher}"`,
      "/SC",
      "ONLOGON",
      "/RL",
      "LIMITED",
      "/F",
    ]);
    console.log("已创建当前用户登录计划任务；Windows 实机验收仍待进行。");
  } else if (mode === "disable") {
    await exec("schtasks", ["/Delete", "/TN", name, "/F"]).catch(() => {});
    await unlink(launcher).catch(() => {});
    console.log("已移除课哨登录计划任务。");
  } else {
    try {
      console.log((await exec("schtasks", ["/Query", "/TN", name])).stdout);
    } catch {
      console.log("未注册自启动");
    }
  }
} else throw new Error("首版仅提供 macOS / Windows 系统集成脚本");
