import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "../apps/local-service/src/server.js";
import { Store } from "../packages/storage/src/index.js";
import { PlatformId, ScheduleInput } from "../packages/contracts/src/index.js";
const token = "retired-fixture-".repeat(5);
const headers = { host: "127.0.0.1:17321", origin: "http://127.0.0.1:17321", authorization: `Bearer ${token}` };
let dir: string | undefined;
afterEach(() => { if (dir) rmSync(dir, {recursive: true, force: true}); vi.unstubAllEnvs(); });
it("停用平台保留原始记录和配置，重启后退出列表、修改入口和通知队列", async () => {
  vi.stubEnv("COURSEWATCH_NATIVE_TOKEN", token);
  vi.stubEnv("COURSEWATCH_NATIVE_NOTIFICATIONS", "1");
  dir = mkdtempSync(join(tmpdir(), "cw-retired-"));
  const store = new Store(join(dir, "coursewatch.db"));
  const legacy = {id: "old-task", platform: "dream", accountId: "old-account", title: "旧活动", course: "旧分组", namespace: "mine", sourceId: "one", personalDone: false};
  const course = {id: "old-course", platform: "dream", status: "enabled"};
  const schedule = {id: "old-schedule", title: "旧提醒", dueAt: Date.now()+3600000, activity: {platform: "dream", event: "start", url: ""}};
  const config = {id: "dream", accountId: "old-account", enabled: true, added: true};
  store.run("INSERT INTO tasks VALUES(?,?,?,?,?)", legacy.id, legacy.platform, legacy.accountId, "one", JSON.stringify(legacy));
  store.run("INSERT INTO courses VALUES(?,?)", course.id, JSON.stringify(course));
  store.run("INSERT INTO schedules VALUES(?,?)", schedule.id, JSON.stringify(schedule));
  store.set("platform:dream", config);
  store.set("dream:old-account", {mine: [legacy]});
  for (const id of [legacy.id, schedule.id]) {
    store.run("INSERT INTO reminders VALUES(?,?,?,?,?)", `reminder:${id}`, id, Date.now()-1, 1, 0);
    store.run("INSERT INTO outbox(dedupe,at,title,body,task_id,kind) VALUES(?,?,?,?,?,?)", `notice:${id}`, Date.now(), "旧提醒", "旧内容", id, "deadline");
  }
  store.run("INSERT INTO outbox(dedupe,at,title,body,kind) VALUES(?,?,?,?,?)", "auth:dream:old-account:1", Date.now(), "旧登录提示", "旧内容", "auth");
  store.close();
  const server = await createServer({dir, test: true});
  try {
    const get = async (url: string) => (await server.app.inject({url, headers})).json();
    expect((await get("/api/platforms")).items.map((p: any) => p.id)).not.toContain("dream");
    expect(server.engine.tasks()).toEqual([]);
    expect(server.engine.courses()).toEqual([]);
    expect(server.engine.schedules()).toEqual([]);
    expect((await get("/api/tasks")).items).toEqual([]);
    expect((await get("/api/native/summary")).items).toEqual([]);
    expect((await get("/api/notifications")).items).toEqual([]);
    expect((await get("/api/native/pending")).items).toEqual([]);
    server.engine.reminders(Date.now()+7200000);
    expect(server.store.all("SELECT * FROM reminders")).toEqual([]);
    expect(server.store.all("SELECT * FROM outbox WHERE delivered_at IS NULL")).toEqual([]);
    expect((await server.app.inject({url: "/api/platforms/dream", method: "PATCH", headers, payload: {added: true}})).statusCode).toBe(400);
    expect((await server.app.inject({url: "/api/tasks/old-task", method: "PATCH", headers, payload: {personalDone: true}})).statusCode).toBe(404);
    expect((await server.app.inject({url: "/api/schedules/old-schedule", method: "PATCH", headers, payload: {done: true}})).statusCode).toBe(404);
    expect((await server.app.inject({url: "/api/dream", headers})).statusCode).toBe(404);
    for (const [table, record] of [["tasks", legacy], ["courses", course], ["schedules", schedule]] as const)
      expect(server.store.all<{data: string}>(`SELECT data FROM ${table}`)[0].data).toBe(JSON.stringify(record));
    expect(server.store.get("platform:dream", null)).toEqual(config);
    expect(server.store.get("dream:old-account", null)).toEqual({mine: [legacy]});
    expect(PlatformId.safeParse("dream").success).toBe(false);
    expect(ScheduleInput.safeParse(schedule).success).toBe(false);
  } finally { await server.app.close(); }
});
