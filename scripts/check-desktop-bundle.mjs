import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const [appRoot, arch, version, browserMode = "system"] = process.argv.slice(2);
assert.equal(process.arch, arch);
process.env.COURSEWATCH_NATIVE_TOKEN = "bundle-check-".repeat(6);
process.env.COURSEWATCH_NATIVE_NOTIFICATIONS = "1";
process.env.COURSEWATCH_BROWSER_MODE = browserMode;
const moduleAt = (path) =>
  import(pathToFileURL(join(appRoot, "dist/server", path)).href);
const { createServer } = await moduleAt("apps/local-service/src/server.js");
const { AdapterManager } = await moduleAt("packages/adapters/src/manager.js");
const dir = await mkdtemp(join(tmpdir(), `cw-bundle-${arch}-`));
const headers = {
  host: "127.0.0.1:17321",
  origin: "http://127.0.0.1:17321",
  authorization: `Bearer ${process.env.COURSEWATCH_NATIVE_TOKEN}`,
};
let server;
const manager = new AdapterManager(dir);
// Exercise update metadata only; package verification must not contact GitHub.
const updateRequest = async () => new Response(JSON.stringify([{
  tag_name: "v9.9.99", draft: false, prerelease: true,
  html_url: "https://github.com/BeifengFlying/CourseWatch/releases/tag/v9.9.99",
  body: "安装包模拟更新检查",
}]));
try {
  server = await createServer({ dir, test: true, updateRequest });
  const api = async (url, payload) => {
    const response = await server.app.inject({
      method: payload ? "POST" : "GET",
      url,
      headers,
      ...(payload ? { payload } : {}),
    });
    assert.equal(response.statusCode, 200, `${url}: ${response.body}`);
    return response.json();
  };
  assert.equal((await api("/api/health")).version, version);
  for (const file of ["worker.js", "unipus-worker.js", "unipus-page.js", "timing.js", "catalog-worker.js", "upstream-catalog.js", "launch.js", "keep-open.js"]) {
    assert.ok(existsSync(join(appRoot, "dist/server/packages/study/src", file)), `包内缺少学习运行文件 ${file}`);
  }
  for (const prefix of ["/api/study", "/api/study/unipus"]) {
    assert.equal((await api(`${prefix}/settings`)).enabled, false);
    assert.equal((await api(`${prefix}/settings`)).hasKey, false);
    assert.equal((await api(`${prefix}/status`)).phase, "idle");
    assert.equal((await api(`${prefix}/progress`, {})).progress, null);
  }
  const host = { host: headers.host };
  for (const prefix of ["/api", "/%61pi", "/a%70i", "/%61%70%69"]) {
    for (const authorization of [undefined, "Bearer invalid"]) {
      const deniedHeaders = { ...host, ...(authorization ? { authorization } : {}) };
      for (const request of [
        { method: "GET", url: `${prefix}/schedules` },
        { method: "POST", url: `${prefix}/schedules`, payload: { title: "拒绝写入测试", dueAt: Date.now() + 3600000 } },
        { method: "POST", url: `${prefix}/native/renderer`, payload: { state: "closed" } },
      ]) {
        const response = await server.app.inject({ ...request, headers: deniedHeaders });
        assert.equal(response.statusCode, 401, `${request.method} ${request.url}`);
      }
    }
  }
  assert.equal(server.engine.schedules().length, 0);
  assert.equal(server.store.get("nativeRenderer", null), null);
  const pair = await server.app.inject({
    method: "POST", url: "/%61pi/pair", headers: host,
    payload: { code: server.pairingCode },
  });
  assert.equal(pair.statusCode, 200);
  const pairedHeaders = { ...host, authorization: `Bearer ${pair.json().token}` };
  assert.equal((await server.app.inject({ url: "/%61pi/schedules", headers: pairedHeaders })).statusCode, 200);
  for (const url of ["/api/%6eative/pending", "/%61pi/native/summary"]) {
    assert.equal((await server.app.inject({ url, headers: pairedHeaders })).statusCode, 403);
  }
  const unsafeSource = await server.app.inject({
    method: "PATCH", url: "/api/platforms/ynjy", headers,
    payload: { sources: [{ url: "https://jsjks.ynjy.cn/classrooms/1/%73ubmit", course: "测试", type: "homework" }] },
  });
  assert.equal(unsafeSource.statusCode, 400);
  await server.app.close();
  delete process.env.COURSEWATCH_NATIVE_TOKEN;
  server = await createServer({ dir, test: true, updateRequest });
  assert.equal((await server.app.inject({ url: "/api/schedules", headers })).statusCode, 401);
  assert.equal((await server.app.inject({ url: "/api/schedules", headers: pairedHeaders })).statusCode, 200);
  process.env.COURSEWATCH_NATIVE_TOKEN = headers.authorization.slice(7);
  await server.app.close();
  server = await createServer({ dir, test: true, updateRequest });
  assert.match(
    (await server.app.inject({ url: "/", headers })).body,
    /CourseWatch/,
  );
  await api("/api/experiment", { scenario: "baseline" });
  assert.equal(server.engine.tasks().length, 2);
  await api("/api/experiment", { scenario: "new" });
  assert.equal(server.engine.tasks().length, 3);
  await api("/api/experiment/clear", {});
  assert.equal(server.engine.tasks().length, 0);
  await api("/api/notifications/test", {});
  assert.equal((await api("/api/native/pending")).items.length, 1);
  assert.equal((await api("/api/updates")).currentVersion, version);
  const update = await api("/api/updates/check", {});
  assert.equal(update.state, "available");
  assert.equal(update.latest.version, "9.9.99");
  assert.equal(server.store.all("SELECT * FROM outbox WHERE kind=?", "update").length, 1);
  assert.equal(server.store.all("SELECT * FROM notification_deliveries").length, 0);
  console.log(`更新检查：${arch} 包内模块、模拟新版本、应用提醒入队及手机渠道隔离 OK`);
  const result = await manager.scan({
    id: "renwei",
    accountId: "bundle-test",
    enabled: true,
    sources: [
      {
        url: "https://tk.ipmph.com/exam/a/exam/examTask",
        course: "test",
        type: "homework",
      },
    ],
    loginStatus: "unknown",
    lastScanAt: null,
    lastSuccessAt: null,
    nextScanAt: 0,
    failures: 0,
    lastOutcome: "not_scanned",
    message: "",
  });
  assert.equal(result.outcome, "auth_required");
  const browsers = join(dirname(appRoot), "browsers");
  assert.equal(browserMode, "system", "新安装包只能使用本机浏览器");
  assert.equal(existsSync(browsers), false, "安装包不得包含浏览器");
  {
    const { chromium } = createRequire(join(appRoot, "package.json"))("playwright");
    const { browserLaunchOptions } = await moduleAt("packages/adapters/src/browser.js");
    const options = await browserLaunchOptions();
    assert.ok(options.executablePath, "精简版必须选择本机浏览器");
    assert.equal(options.channel, undefined);
    for (const headless of [true, false]) {
      const context = await chromium.launchPersistentContext(join(dir, `browser-${headless}`), { ...options, headless });
      try {
        const page = await context.newPage();
        await page.setContent("<title>CourseWatch slim bundle check</title><p>system-browser-check</p>");
        assert.equal(await page.textContent("p"), "system-browser-check");
      } finally {
        await context.close();
      }
    }
    console.log(`精简版：${arch} 包内 Playwright + 本机浏览器，独立临时资料目录，有窗口／无头启动、渲染、关闭检查 OK`);
  }
  if (process.platform === "win32") {
    const { Vault } = await moduleAt("packages/adapters/src/vault.js");
    const vault = new Vault(dir);
    await vault.save("bundle-check", { source: "synthetic", value: "DPAPI round trip" });
    assert.deepEqual(await vault.read("bundle-check"), { source: "synthetic", value: "DPAPI round trip" });
    console.log("Windows 当前用户 DPAPI：虚构会话保存、解密检查 OK");
  }
  console.log(
    `安装包集成检查：${arch} 认证边界、令牌撤销、来源过滤、API、SQLite、网页、实验、通知队列、采集子进程 OK`,
  );
} finally {
  await manager.cancel();
  await server?.app.close();
  await rm(dir, { recursive: true, force: true });
}
