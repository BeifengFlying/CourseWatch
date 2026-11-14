import { it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { AdapterManager } from "../packages/adapters/src/manager.js";
it.each(["renwei", "yuketang", "chaoxing", "unipus"] as const)("%s 独立采集进程返回未登录，退出后主后台无采集子进程", async (id) => {
  const dir = mkdtempSync(join(tmpdir(), "cw-worker-"));
  const manager = new AdapterManager(dir);
  try {
    const result = await manager.scan({
      id,
      accountId: randomUUID(),
      enabled: true,
      sources: id === "renwei" ? [
        {
          url: "https://tk.ipmph.com/exam/a/exam/examTask",
          course: "test",
          type: "homework",
        },
      ] : [],
      loginStatus: "unknown",
      lastScanAt: null,
      lastSuccessAt: null,
      nextScanAt: 0,
      failures: 0,
      lastOutcome: "not_scanned",
      message: "",
    });
    expect(result.outcome).toBe("auth_required");
    expect(manager.activeLogin).toBe(null);
  } finally {
    await manager.cancel();
    rmSync(dir, { recursive: true, force: true });
  }
});
