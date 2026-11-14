import { beforeEach, afterEach, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../apps/local-service/src/server.js";
let dir: string, s: Awaited<ReturnType<typeof createServer>>;
const host = { host: "127.0.0.1:17321" };
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "cw-api-"));
  s = await createServer({ dir, test: true });
});
afterEach(async () => {
  await s.app.close();
  rmSync(dir, { recursive: true, force: true });
});
async function pair(origin = "http://127.0.0.1:17321") {
  const r = await s.app.inject({
    method: "POST",
    url: "/api/pair",
    headers: { ...host, origin },
    payload: { code: s.pairingCode },
  });
  return r.json().token as string;
}
it("显示模式默认跟随系统，保存后重新打开后台仍保留选择", async () => {
  let token = await pair();
  const read = () => s.app.inject({ url: "/api/settings", headers: { ...host, authorization: `Bearer ${token}` } });
  expect((await read()).json().theme).toBe("system");
  for (const theme of ["light", "dark", "system", "dark"]) {
    const settings = (await read()).json();
    const saved = await s.app.inject({ method: "PATCH", url: "/api/settings",
      headers: { ...host, authorization: `Bearer ${token}` }, payload: { ...settings, theme } });
    expect(saved.statusCode).toBe(200);
    expect((await read()).json().theme).toBe(theme);
  }
  const invalid = await s.app.inject({ method: "PATCH", url: "/api/settings",
    headers: { ...host, authorization: `Bearer ${token}` }, payload: { ...(await read()).json<Record<string, unknown>>(), theme: "invalid" } });
  expect(invalid.statusCode).toBe(400);
  await s.app.close();
  s = await createServer({ dir, test: true });
  token = await pair();
  expect((await read()).json().theme).toBe("dark");
});
it("旧 Windows 显示模式迁移至主题字段，已有主题选择优先", async () => {
  const token = await pair();
  const read = () => s.app.inject({ url: "/api/settings", headers: { ...host, authorization: `Bearer ${token}` } });
  s.store.set("settings", { appearance: "dark" });
  let settings = (await read()).json();
  expect(settings.theme).toBe("dark");
  expect(settings).not.toHaveProperty("appearance");
  s.store.set("settings", { appearance: "dark", theme: "light" });
  settings = (await read()).json();
  expect(settings.theme).toBe("light");
  s.store.set("settings", { appearance: "invalid" });
  expect((await read()).json().theme).toBe("system");
});
it("受保护 API 拒绝无令牌、错误 Host 和网页来源", async () => {
  expect(
    (await s.app.inject({ url: "/api/tasks", headers: host })).statusCode,
  ).toBe(401);
  const token = await pair();
  for (const headers of [
    {
      ...host,
      authorization: `Bearer ${token}`,
      origin: "https://evil.example",
    },
    { host: "evil.example", authorization: `Bearer ${token}` },
    { ...host, authorization: `Bearer ${token}`, origin: "null" },
  ])
    expect(
      (await s.app.inject({ url: "/api/tasks", headers })).statusCode,
    ).toBe(403);
  expect(
    (
      await s.app.inject({
        url: "/api/tasks",
        headers: { ...host, authorization: `Bearer ${token}` },
      })
    ).statusCode,
  ).toBe(200);
});
it("配对码仅使用一次，扩展令牌被绑定到原始扩展来源", async () => {
  const source = `chrome-extension://${"a".repeat(32)}`;
  const token = await pair(source);
  const again = await s.app.inject({
    method: "POST",
    url: "/api/pair",
    headers: host,
    payload: { code: s.pairingCode },
  });
  expect(again.statusCode).toBe(403);
  expect(
    (
      await s.app.inject({
        url: "/api/tasks",
        headers: {
          ...host,
          authorization: `Bearer ${token}`,
          origin: `chrome-extension://${"b".repeat(32)}`,
        },
      })
    ).statusCode,
  ).toBe(401);
});
it("禁止非官方页面及业务写入路径作为监控来源", async () => {
  const token = await pair();
  const headers = { ...host, authorization: `Bearer ${token}` };
  for (const url of [
    "https://evil.example/",
    "file:///etc/passwd",
    "https://jsjks.ynjy.cn/classrooms/1/submit",
    "https://jsjks.ynjy.cn/classrooms/1/%73ubmit",
    "https://jsjks.ynjy.cn/classrooms/1/%2573ubmit",
    "https://jsjks.ynjy.cn/classrooms/1/#/submit",
    "https://jsjks.ynjy.cn/classrooms/1/%6cogout",
    "https://jsjks.ynjy.cn/classrooms/1/%ZZ",
    "https://jsjks.ynjy.cn.evil.example/list",
  ]) {
    const r = await s.app.inject({
      method: "PATCH",
      url: "/api/platforms/ynjy",
      headers,
      payload: { sources: [{ url, course: "test", type: "homework" }] },
    });
    expect(r.statusCode).toBe(400);
  }
});
it("模拟实验持久化任务，失败和空快照不删除；导出无会话", async () => {
  const token = await pair();
  const headers = { ...host, authorization: `Bearer ${token}` };
  for (const scenario of ["baseline", "new", "change", "failure", "empty"])
    expect(
      (
        await s.app.inject({
          method: "POST",
          url: "/api/experiment",
          headers,
          payload: { scenario },
        })
      ).statusCode,
    ).toBe(200);
  const r = (await s.app.inject({ url: "/api/export", headers })).json();
  expect(r.tasks).toHaveLength(3);
  expect(r.tasks.every((t: any) => t.needsReview)).toBe(true);
  expect(r).not.toHaveProperty("token");
  expect(r).not.toHaveProperty("sessions");
});
it("清理模拟任务不影响真实账号任务", async () => {
  const token = await pair();
  const headers = { ...host, authorization: `Bearer ${token}` };
  await s.app.inject({
    method: "POST",
    url: "/api/experiment",
    headers,
    payload: { scenario: "baseline" },
  });
  s.engine.apply({
    platform: "ynjy",
    accountId: "123e4567-e89b-42d3-a456-426614174000",
    outcome: "complete",
    discoveryComplete: true,
    partitions: [
      {
        key: "real-fixture",
        outcome: "complete",
        paginationComplete: true,
        emptyConfirmed: false,
        issues: [],
        items: [
          {
            sourceId: "fixture-real-id",
            namespace: "real-fixture",
            title: "非模拟账号测试条目",
            course: "test",
            type: "homework",
            sourceStatus: "unknown",
            deadline: { kind: "unknown" },
            startTime: { kind: "unknown" },
            publishTime: { kind: "unknown" },
          },
        ],
      },
    ],
    issues: [],
  });
  expect(
    (
      await s.app.inject({
        method: "POST",
        url: "/api/experiment/clear",
        headers,
        payload: {},
      })
    ).statusCode,
  ).toBe(200);
  expect(s.engine.tasks()).toHaveLength(1);
  expect(s.engine.tasks()[0].namespace).toBe("real-fixture");
});
