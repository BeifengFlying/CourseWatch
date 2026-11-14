import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createServer } from "node:net";

const [appRoot] = process.argv.slice(2);
assert.equal(process.platform, "win32");
for (const shutdown of ["command", "eof"]) {
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = reservation.address().port;
  await new Promise((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
  const dir = await mkdtemp(join(tmpdir(), "CourseWatch lifecycle "));
  const token = "windows-lifecycle-check-".repeat(3);
  const child = spawn(process.execPath, [join(appRoot, "dist/server/apps/local-service/src/main.js")], {
    cwd: appRoot,
    windowsHide: true,
    stdio: ["pipe", "ignore", "ignore"],
    env: { ...process.env, COURSEWATCH_DATA_DIR: dir, COURSEWATCH_SERVICE_PORT: String(port), COURSEWATCH_NATIVE_TOKEN: token, COURSEWATCH_NATIVE_NOTIFICATIONS: "1", COURSEWATCH_MANAGED_STDIN: "1" },
  });
  const exit = once(child, "exit");
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null) throw new Error("打包后台提前退出");
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/health`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(500) });
        if (response.ok) { ready = true; break; }
      } catch { }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, "打包后台启动超时");
    if (shutdown === "command") child.stdin.write("shutdown\n");
    else child.stdin.end();
    const deadline = AbortSignal.timeout(12000);
    const code = await Promise.race([exit.then(([code]) => code), new Promise((_, reject) => deadline.addEventListener("abort", () => reject(new Error("打包后台退出超时")), { once: true }))]);
    assert.equal(code, 0);
    console.log(`Windows 后台生命周期：${shutdown} 正常退出 OK（中文及空格数据路径）`);
  } finally {
    if (child.exitCode === null) child.kill();
    await exit;
    await rm(dir, { recursive: true, force: true });
  }
}
