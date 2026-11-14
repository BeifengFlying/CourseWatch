import { APP_VERSION } from "../../../packages/contracts/src/version.js";
import { mkdir, open, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { dataDir } from "./paths.js";
import { createServer } from "./server.js";
import { createInterface } from "node:readline";
await mkdir(dataDir, { recursive: true, mode: 0o700 });
const lock = join(dataDir, "service.lock");
const port = Number(process.env.COURSEWATCH_SERVICE_PORT ?? 17321);
let ownsLock = false;
try {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("后台端口须为 1 到 65535 的整数");
  try {
    const h = await open(lock, "wx", 0o600);
    await h.writeFile(String(process.pid));
    await h.close();
    ownsLock = true;
  } catch {
    const pid = Number(await readFile(lock, "utf8"));
    let alive = false;
    try {
      process.kill(pid, 0);
      alive = true;
    } catch {}
    if (alive) throw new Error(`后台已经运行，请打开 http://127.0.0.1:${port}`);
    await unlink(lock);
    const h = await open(lock, "wx", 0o600);
    await h.writeFile(String(process.pid));
    await h.close();
    ownsLock = true;
  }
  const { app, pairingCode } = await createServer({ dir: dataDir, port });
  let exiting = false;
  const stop = async () => {
    if (exiting) return;
    exiting = true;
    await app.close();
    if (ownsLock) await unlink(lock).catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  // A packaged Windows host owns this private pipe. EOF also closes the
  // backend after a host crash; no HTTP shutdown endpoint is exposed.
  if (process.env.COURSEWATCH_MANAGED_STDIN === "1" &&
      (process.env.COURSEWATCH_NATIVE_TOKEN?.length ?? 0) >= 40) {
    const commands = createInterface({ input: process.stdin });
    commands.on("line", (command) => { if (command === "shutdown") void stop(); });
    commands.on("close", () => { void stop(); });
  }
  await app.listen({ host: "127.0.0.1", port });
  await writeFile(join(dataDir, "service.pid"), String(process.pid), {
    mode: 0o600,
  });
  console.log(
    `CourseWatch ${APP_VERSION} 实验版\n任务中心：http://127.0.0.1:${port}\n一次性配对码：${pairingCode}（10 分钟内有效）\n本机数据：${dataDir}\n关闭浏览器后，后台仍继续运行。`,
  );
} catch (e) {
  if (ownsLock) await unlink(lock).catch(() => {});
  console.error((e as Error).message);
  process.exit(1);
}
