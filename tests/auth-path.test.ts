import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../apps/local-service/src/server.js";

let dir: string, server: Awaited<ReturnType<typeof createServer>>;
const host = { host: "127.0.0.1:17321" };
const nativeToken = "n".repeat(64);
const nativeHeaders = { ...host, authorization: `Bearer ${nativeToken}` };
const apiPrefixes = ["/api", "/%61pi", "/a%70i", "/%61%70%69"];

beforeEach(async () => {
  vi.stubEnv("COURSEWATCH_NATIVE_TOKEN", nativeToken);
  vi.stubEnv("COURSEWATCH_NATIVE_NOTIFICATIONS", "1");
  dir = mkdtempSync(join(tmpdir(), "cw-auth-path-"));
  server = await createServer({ dir, test: true });
});

afterEach(async () => {
  await server.app.close();
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

async function pair(url = "/api/pair") {
  const response = await server.app.inject({
    method: "POST",
    url,
    headers: host,
    payload: { code: server.pairingCode },
  });
  expect(response.statusCode).toBe(200);
  return { ...host, authorization: `Bearer ${response.json().token}` };
}

async function seedSchedule() {
  const response = await server.app.inject({
    method: "POST",
    url: "/api/schedules",
    headers: nativeHeaders,
    payload: { title: "权限回归测试", dueAt: Date.now() + 3600000 },
  });
  expect(response.statusCode).toBe(200);
  return response.json().item;
}

it.each(apiPrefixes)("%s 的日程读取和写入均要求有效令牌", async (prefix) => {
  const schedule = await seedSchedule();
  const requests = [
    { method: "GET" as const, url: `${prefix}/schedules` },
    { method: "HEAD" as const, url: `${prefix}/schedules` },
    {
      method: "GET" as const,
      url: `${prefix}/%73chedules?path=/api/pair`,
    },
    {
      method: "POST" as const,
      url: `${prefix}/schedules`,
      payload: { title: "未授权新增", dueAt: Date.now() + 3600000 },
    },
    {
      method: "PATCH" as const,
      url: `${prefix}/schedules/${schedule.id}`,
      payload: { title: "未授权修改", done: true },
    },
    {
      method: "POST" as const,
      url: `${prefix}/schedules/${schedule.id}/delete`,
      payload: {},
    },
  ];
  for (const headers of [host, { ...host, authorization: "Bearer invalid" }]) {
    for (const request of requests) {
      const response = await server.app.inject({ ...request, headers });
      expect(response.statusCode, `${request.method} ${request.url}`).toBe(401);
      expect(server.engine.schedules()).toEqual([schedule]);
    }
  }
  const headers = await pair();
  const response = await server.app.inject({
    url: `${prefix}/%73chedules`,
    headers,
  });
  expect(response.statusCode).toBe(200);
  expect(response.json().items).toEqual([schedule]);
});

it.each(apiPrefixes)(
  "%s 的原生接口拒绝无令牌和普通配对令牌",
  async (prefix) => {
    const pairedHeaders = await pair();
    server.engine.enqueue("auth-path", "通知", "投递权限测试", null, "test");
    const pending = server.store.all<{
      id: number;
      delivered_at: number | null;
    }>("SELECT id,delivered_at FROM outbox");
    expect(pending).toHaveLength(1);
    for (const native of ["native", "%6eative", "na%74ive"]) {
      const requests = [
        { method: "GET" as const, url: `${prefix}/${native}/summary` },
        { method: "GET" as const, url: `${prefix}/${native}/pending` },
        {
          method: "POST" as const,
          url: `${prefix}/${native}/renderer`,
          payload: { state: "closed" },
        },
        {
          method: "POST" as const,
          url: `${prefix}/${native}/delivered`,
          payload: { id: pending[0].id },
        },
      ];
      for (const [headers, status] of [
        [host, 401],
        [{ ...host, authorization: "Bearer invalid" }, 401],
        [pairedHeaders, 403],
      ] as const) {
        for (const request of requests) {
          const response = await server.app.inject({ ...request, headers });
          expect(response.statusCode, `${request.method} ${request.url}`).toBe(
            status,
          );
          expect(server.store.get("nativeRenderer", null)).toBeNull();
          expect(
            server.store.all("SELECT id,delivered_at FROM outbox"),
          ).toEqual(pending);
        }
      }
      for (const request of requests) {
        const response = await server.app.inject({
          ...request,
          headers: nativeHeaders,
        });
        expect(response.statusCode, `${request.method} ${request.url}`).toBe(
          200,
        );
      }
      // Reset state so each spelling checks both reads and writes against untouched data.
      server.store.run("DELETE FROM settings WHERE key=?", "nativeRenderer");
      server.store.run("UPDATE outbox SET delivered_at=NULL");
    }
  },
);

it("已配对客户端可通过编码路径增删改日程，仍受 Host 和 Origin 限制", async () => {
  const headers = await pair();
  const created = await server.app.inject({
    method: "POST",
    url: "/%61pi/%73chedules",
    headers,
    payload: { title: "编码路径日程", dueAt: Date.now() + 3600000 },
  });
  expect(created.statusCode).toBe(200);
  const id = created.json().item.id;
  const updated = await server.app.inject({
    method: "PATCH",
    url: `/a%70i/schedules/${id}`,
    headers,
    payload: { done: true },
  });
  expect(updated.statusCode).toBe(200);
  expect(server.engine.schedules()[0].done).toBe(true);
  for (const [untrustedHeaders, status] of [
    [{ ...headers, host: "evil.example" }, 403],
    [{ ...headers, origin: "https://evil.example" }, 403],
    [{ ...headers, origin: `chrome-extension://${"a".repeat(32)}` }, 401],
  ] as const) {
    const response = await server.app.inject({
      url: "/%61pi/schedules",
      headers: untrustedHeaders,
    });
    expect(response.statusCode).toBe(status);
  }
  const deleted = await server.app.inject({
    method: "POST",
    url: `/%61%70%69/schedules/${id}/%64elete`,
    headers,
    payload: {},
  });
  expect(deleted.statusCode).toBe(200);
  expect(server.engine.schedules()).toEqual([]);
});

it("编码的配对路径仍验证一次性配对码，页面与预检可正常访问", async () => {
  const invalid = await server.app.inject({
    method: "POST",
    url: "/%61pi/%70air",
    headers: host,
    payload: { code: "invalid" },
  });
  expect(invalid.statusCode).toBe(403);
  const headers = await pair("/%61pi/%70air");
  expect(
    (await server.app.inject({ url: "/api/health", headers })).statusCode,
  ).toBe(200);
  const reused = await server.app.inject({
    method: "POST",
    url: "/%61pi/%70air",
    headers: host,
    payload: { code: server.pairingCode },
  });
  expect(reused.statusCode).toBe(403);
  expect(
    (await server.app.inject({ url: "/", headers: host })).statusCode,
  ).toBe(200);
  const preflight = await server.app.inject({
    method: "OPTIONS",
    url: "/%61pi/schedules",
    headers: { ...host, origin: "http://127.0.0.1:17321" },
  });
  expect(preflight.statusCode).toBe(204);
  expect(server.engine.schedules()).toEqual([]);
});
