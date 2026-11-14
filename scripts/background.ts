import { spawn } from "node:child_process";
import { open, mkdir, readFile, stat, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { dataDir } from "../apps/local-service/src/paths.js";
await mkdir(dataDir, { recursive: true, mode: 0o700 });
const command = process.argv[2];
const pidPath = join(dataDir, "service.pid");
if (command === "stop") {
  try {
    const pid = Number(await readFile(pidPath, "utf8"));
    const lockPid = Number(
      await readFile(join(dataDir, "service.lock"), "utf8"),
    );
    if (!Number.isSafeInteger(pid) || pid < 2 || lockPid !== pid)
      throw new Error("pid mismatch");
    process.kill(pid, "SIGTERM");
    console.log(
      "已请求停止课哨后台。启用自启动时，请先运行 npm run autostart -- disable。",
    );
  } catch {
    console.log("没有找到可停止的课哨后台。");
  }
} else {
  try {
    const pid = Number(await readFile(join(dataDir, "service.lock"), "utf8"));
    if (pid > 1) {
      process.kill(pid, 0);
      console.log(
        `后台已运行。任务中心：http://127.0.0.1:17321\n配对信息：${join(dataDir, "pairing-code.txt")}`,
      );
      process.exit(0);
    }
  } catch {}
  const logPath = join(dataDir, "service.log");
  try {
    if ((await stat(logPath)).size > 2 * 1024 * 1024)
      await rename(logPath, join(dataDir, "service.previous.log"));
  } catch {}
  const log = await open(logPath, "a", 0o600);
  const child = spawn(
    process.execPath,
    existsSync(resolve("dist/server/apps/local-service/src/main.js"))
      ? [resolve("dist/server/apps/local-service/src/main.js")]
      : ["--import", "tsx", resolve("apps/local-service/src/main.ts")],
    {
      cwd: resolve("."),
      detached: true,
      stdio: ["ignore", log.fd, log.fd],
      env: process.env,
      windowsHide: true,
    },
  );
  await log.close();
  child.unref();
  let started = false;
  for (let i = 0; i < 50; i++) {
    try {
      const pid = Number(await readFile(pidPath, "utf8"));
      if (pid === child.pid) {
        started = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!started) {
    console.error(`后台未确认启动，请查看 ${logPath}`);
    process.exitCode = 1;
  } else
    console.log(
      `课哨后台已启动（PID ${child.pid}）\n任务中心：http://127.0.0.1:17321\n${await readFile(join(dataDir, "pairing-code.txt"), "utf8")}\n关闭终端与浏览器后后台仍运行。\n停止：npm run stop`,
    );
}
