import { APP_VERSION } from "../../../packages/contracts/src/version.js";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import rateLimit from "@fastify/rate-limit";
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { z } from "zod";
import { Store } from "../../../packages/storage/src/index.js";
import { Engine } from "../../../packages/core/src/index.js";
import { taskNotice } from "../../../packages/core/src/task-notice.js";
import type { PlatformState } from "../../../packages/adapters/src/index.js";
import { AdapterManager } from "../../../packages/adapters/src/manager.js";
import { browserLaunchOptions } from "../../../packages/adapters/src/browser.js";
import {
  PlatformId,
  SourceConfig,
  Settings,
  platforms,
  discoversCourses,
  safeMonitorUrl,
  ReminderHours,
  ScheduleInput,
} from "../../../packages/contracts/src/index.js";
import {
  drain,
  sendNative,
} from "../../../packages/notifications/src/index.js";
import {
  agendaEntries,
  sortAgenda,
} from "../../../packages/contracts/src/agenda.js";
import { runExperiment } from "./experiment.js";
import { registerStudyRoutes } from "./study-routes.js";
import { registerNotificationRoutes } from './notification-routes.js';
import type { SecretStorage } from '../../../packages/notifications/src/mobile.js';
import { DiagnosticLog, diagnosticReason } from '../../../packages/core/src/diagnostics.js';
import { courseScanSlot, nextCourseScanAt } from '../../../packages/core/src/course-scan-clock.js';
import { release, freemem, totalmem, uptime } from 'node:os';
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
export async function createServer(options: {
  dir: string;
  port?: number;
  test?: boolean;
  notificationSecrets?: SecretStorage;
}) {
  const port = options.port ?? 17321;
  const origin = `http://127.0.0.1:${port}`;
  const store = new Store(join(options.dir, "coursewatch.db"));
  const engine = new Engine(store);
  const adapters = new AdapterManager(options.dir, () => engine.settings().browser);
  const diagnostics = new DiagnosticLog(options.dir);
  diagnostics.record('service', 'started', { facts: { platform: process.platform, arch: process.arch, node: process.versions.node } });
  let browserProbe: Promise<boolean> | undefined;
  let browserProbeAt = 0;
  function browserAvailable() {
    if (!browserProbe || Date.now() - browserProbeAt > 60000) {
      browserProbeAt = Date.now();
      browserProbe = browserLaunchOptions({ selection: engine.settings().browser }).then(() => true, () => false);
    }
    return browserProbe;
  }
  const app = Fastify({
    logger: false,
    bodyLimit: 64 * 1024,
    requestTimeout: 30000,
  });
  // Renderer assets must remain loadable even when an API bucket is exhausted.
  // Each API route has its own bucket; polling cannot consume mutation capacity.
  app.addHook("onRoute", route => {
    if (route.url.startsWith("/api/") && route.config?.rateLimit === undefined) {
      route.config = { ...route.config, rateLimit: {
        max: [route.method].flat().every(method => method === "GET" || method === "HEAD") ? 600 : 120,
        timeWindow: "1 minute",
      } };
    }
  });
  await app.register(rateLimit, { global: false, max: 120, timeWindow: "1 minute" });
  const mobileNotifications = registerNotificationRoutes(app, engine, options.dir, options.notificationSecrets);
  const nativeToken = process.env.COURSEWATCH_NATIVE_TOKEN;
  const previous = store.get<string | null>("nativeClient", null);
  if (previous) store.run("DELETE FROM clients WHERE hash=?", previous);
  store.run("DELETE FROM settings WHERE key=?", "nativeClient");
  if (nativeToken && nativeToken.length >= 40) {
    const hash = sha(nativeToken);
    store.run(
      "INSERT OR REPLACE INTO clients VALUES(?,?,?)",
      hash,
      origin,
      Date.now(),
    );
    store.set("nativeClient", hash);
  }
  let code = randomBytes(5).toString("hex").toUpperCase();
  let codeExpires = Date.now() + 10 * 60000;
  let pairAttempts = 0;
  await writeFile(
    join(options.dir, "pairing-code.txt"),
    `${code}\n有效至 ${new Date(codeExpires).toISOString()}\n`,
    { mode: 0o600 },
  );
  const state = (): PlatformState[] =>
    Object.keys(platforms).map((id) =>
      store.get<PlatformState>(`platform:${id}`, {
        id: id as PlatformId,
        accountId: randomUUID(),
        enabled: false,
        added: !discoversCourses(id as PlatformId),
        sources: [],
        loginStatus: "unknown",
        lastScanAt: null,
        lastSuccessAt: null,
        nextScanAt: Date.now(),
        failures: 0,
        lastOutcome: "not_scanned",
        message: discoversCourses(id as PlatformId)
          ? "登录后自动读取课程、作业和考试；真实账号覆盖尚待验证"
          : platforms[id as PlatformId].adapted
          ? "请先登录并配置任务列表；尚未验证完整覆盖"
          : "暂未适配：当前仅提供官方登录入口",
      }),
    );
  for (const p of state())
    if (!store.get(`platform:${p.id}`, null)) store.set(`platform:${p.id}`, p);
  const save = (p: PlatformState) => store.set(`platform:${p.id}`, p);
  const defaultRenweiSources: z.infer<typeof SourceConfig>[] = [
    { url: "https://tk.ipmph.com/exam/a/exam/examTask/myExamTaskList", course: "我的作业", type: "homework" },
    { url: "https://tk.ipmph.com/exam/a/exam/exam/myExamList", course: "我的考试", type: "exam" },
  ];
  // Upgrade the former homework-only setup once. Later user removals are kept.
  if (!store.get("renweiListsV2", false)) {
    const p = state().find((p) => p.id === "renwei")!;
    if (p.sources.some((s) => defaultRenweiSources.some((d) => d.url === s.url))) {
      p.sources = [...p.sources, ...defaultRenweiSources.filter((d) => !p.sources.some((s) => s.url === d.url))].slice(0, 12);
      p.nextScanAt = Date.now();
      save(p);
    }
    store.set("renweiListsV2", true);
  }
  // Refresh the former entry-only state without silently enabling monitoring.
  if (!store.get("courseAdaptersV1", false)) {
    for (const p of state().filter(p => discoversCourses(p.id))) {
      p.message = "登录后自动读取课程、作业和考试；真实账号覆盖尚待验证";
      p.nextScanAt = Date.now();
      save(p);
    }
    store.set("courseAdaptersV1", true);
  }
  const allowedOrigin = (s: string) =>
    s === origin || /^chrome-extension:\/\/[a-p]{32}$/.test(s);
  app.addHook("onRequest", async (req, reply) => {
    if (req.headers.host !== `127.0.0.1:${port}`) {
      reply.code(403);
      return reply.send({ error: "拒绝未知 Host" });
    }
    const incoming = req.headers.origin;
    if (incoming && !allowedOrigin(incoming)) {
      reply.code(403);
      return reply.send({ error: "来源未授权" });
    }
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Cache-Control", "no-store");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' http://127.0.0.1:17321; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    if (incoming) {
      reply.header("Access-Control-Allow-Origin", incoming);
      reply.header("Vary", "Origin");
      reply.header(
        "Access-Control-Allow-Headers",
        "Authorization, Content-Type",
      );
      reply.header("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
    }
    if (req.method === "OPTIONS") return reply.code(204).send();
    // Use the matched route: Fastify decodes paths before routing, so the raw
    // URL can spell /api/ or /native/ differently and bypass prefix checks.
    const path = req.routeOptions.url ?? "";
    if (!path.startsWith("/api/") || path === "/api/pair") return;
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    const client = token
      ? store.all<{ origin: string }>(
          "SELECT origin FROM clients WHERE hash=?",
          sha(token),
        )[0]
      : undefined;
    if (!client || (incoming && incoming !== client.origin)) {
      reply.code(401);
      return reply.send({ error: "未配对或认证已失效，请重新输入本机配对码" });
    }
    if (
      path.startsWith("/api/native/") &&
      (!nativeToken ||
        !timingSafeEqual(
          Buffer.from(sha(token)),
          Buffer.from(sha(nativeToken)),
        ))
    ) {
      return reply.code(403).send({ error: "此接口仅供原生应用使用" });
    }
  });
  const study = registerStudyRoutes(app, store, options.dir, () => !!adapters.activeLogin, () => engine.courses().filter(c => state().some(p => p.id === c.platform && p.accountId === c.accountId)), diagnostics, (platform, status) => {
    engine.enqueue(`study:${platform}:${randomUUID()}`, `${platform === "unipus" ? "U校园" : "学习通"} · ${status.phase === "failed" ? "学习运行失败" : "学习已暂停"}`, [status.courseName, status.message, "打开 CourseWatch 查看运行窗口，处理后继续。"].filter(Boolean).join("\n"), null, "study");
  });
  app.setErrorHandler((err, req, reply) => {
    const e = err as any;
    diagnostics.record('api', 'request-error', { stage: req.routeOptions.url ?? 'unknown', reason: diagnosticReason(err), facts: { method: req.method, status: e instanceof z.ZodError ? 400 : e.statusCode ?? 500 } });
    if (e instanceof z.ZodError)
      return reply.code(400).send({ error: "参数无效，请检查输入格式" });
    return reply.code(e.statusCode ?? 500).send({
      error:
        e.statusCode === 429
          ? "请求过于频繁，请稍后重试"
          : "操作未完成，请检查平台状态或重试",
    });
  });
  app.post(
    "/api/pair",
    { config: { rateLimit: { max: 6, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const parsed = z.object({ code: z.string().max(30) }).parse(req.body);
      pairAttempts++;
      const a = Buffer.from(parsed.code.toUpperCase()),
        b = Buffer.from(code);
      if (
        pairAttempts > 12 ||
        Date.now() > codeExpires ||
        a.length !== b.length ||
        !timingSafeEqual(a, b)
      )
        return reply
          .code(403)
          .send({ error: "配对码无效、已使用或过期；重启后台可生成新码" });
      const token = randomBytes(32).toString("base64url");
      store.run(
        "INSERT INTO clients VALUES(?,?,?)",
        sha(token),
        req.headers.origin ?? origin,
        Date.now(),
      );
      code = "";
      codeExpires = 0;
      await writeFile(
        join(options.dir, "pairing-code.txt"),
        "配对码已使用，重启后台可生成新码。\n",
        { mode: 0o600 },
      );
      return { token };
    },
  );
  app.get("/api/health", async () => {
    const currentPlatforms = state();
    return {
    browserMode:
      "system",
    browserAvailable: await browserAvailable(),
    nativeRenderer:
      process.env.COURSEWATCH_NATIVE_NOTIFICATIONS === "1"
        ? store.get("nativeRenderer", null)
        : undefined,
    version: APP_VERSION,
    status: currentPlatforms.some(
      (p) =>
        p.enabled &&
        ["failed", "auth_required", "verification_required"].includes(
          p.lastOutcome,
        ),
    )
      ? "degraded"
      : "running",
    monitoring: store.get("monitoring", true),
    activeLogin: adapters.activeLogin,
    enabledPlatforms: currentPlatforms.filter((p) => p.enabled).length,
    unreadCount: store.all<{ n: number }>("SELECT count(*) AS n FROM outbox WHERE read_at IS NULL AND COALESCE(error,'')!='平台已停用'")[0].n,
    nativePending: process.env.COURSEWATCH_NATIVE_NOTIFICATIONS === "1" && store.all(
      "SELECT 1 FROM outbox WHERE delivered_at IS NULL AND (? OR kind='test') LIMIT 1",
      engine.settings().nativeNotifications ? 1 : 0,
    ).length > 0,
    memory: { rss: process.memoryUsage.rss() },
    uptime: process.uptime(),
    experimental: true,
    };
  });
  app.get("/api/tasks", (req) => {
    const q = z
      .object({
        limit: z.coerce.number().int().min(1).max(500).default(200),
        offset: z.coerce.number().int().nonnegative().default(0),
      })
      .parse(req.query);
    const tasks = engine
      .visibleTasks()
      .sort(
        (a, b) =>
          (a.deadline.kind === "known" ? a.deadline.value : Infinity) -
          (b.deadline.kind === "known" ? b.deadline.value : Infinity),
      );
    return {
      items: tasks.slice(q.offset, q.offset + q.limit),
      total: tasks.length,
    };
  });
  app.patch<{ Params: { id: string } }>(
    "/api/tasks/:id",
    async (req, reply) => {
      const patch = z
        .object({
          personalDone: z.boolean().optional(),
          important: z.boolean().optional(),
          reminderHours: ReminderHours.nullable().optional(),
        })
        .strict()
        .parse(req.body);
      return engine.updateTask(req.params.id, patch)
        ? { ok: true }
        : reply.code(404).send({ error: "任务不存在" });
    },
  );
  app.get("/api/schedules", () => ({ items: engine.schedules() }));
  app.post("/api/schedules", (req, reply) => {
    const input = ScheduleInput.parse(req.body);
    if (input.dueAt <= Date.now())
      return reply.code(400).send({ error: "请选择未来的日程时间" });
    if (engine.schedules().length >= 2000)
      return reply
        .code(400)
        .send({ error: "日程已达上限，请先清理已完成日程" });
    const item = {
      ...input,
      id: randomUUID(),
      done: false,
      version: 1,
      updatedAt: Date.now(),
    };
    engine.saveSchedule(item);
    return { ok: true, item };
  });
  app.patch<{ Params: { id: string } }>("/api/schedules/:id", (req, reply) => {
    const patch = z
      .object({
        title: ScheduleInput.shape.title.optional(),
        note: z.string().trim().max(500).optional(),
        dueAt: z.number().int().positive().optional(),
        important: z.boolean().optional(),
        reminderHours: ReminderHours.nullable().optional(),
        done: z.boolean().optional(),
      })
      .strict()
      .parse(req.body);
    const previous = engine.schedules().find((s) => s.id === req.params.id);
    if (!previous) return reply.code(404).send({ error: "日程不存在" });
    const changed =
      (patch.dueAt !== undefined && patch.dueAt !== previous.dueAt) ||
      (patch.done === false && previous.done);
    const item = {
      ...previous,
      ...patch,
      version: previous.version + (changed ? 1 : 0),
      updatedAt: Date.now(),
    };
    engine.saveSchedule(item);
    return { ok: true, item };
  });
  app.post<{ Params: { id: string } }>(
    "/api/schedules/:id/delete",
    (req, reply) =>
      engine.deleteSchedule(req.params.id)
        ? { ok: true }
        : reply.code(404).send({ error: "日程不存在" }),
  );
  app.get("/api/native/summary", () => {
    const items = sortAgenda(
      agendaEntries(engine.visibleTasks(), engine.schedules()),
    ).filter((t) => !t.done);
    return {
      total: items.length,
      studies: study.summaries(),
      items: items.slice(0, 6).map(({ task, schedule, ...item }) => item),
    };
  });
  app.get("/api/platforms", () => ({
    items: state().map((p) => ({
      ...p,
      name: platforms[p.id].name,
      adapted: platforms[p.id].adapted,
      activeLogin: adapters.activeLogin === p.id,
      discoversCourses: discoversCourses(p.id),
      adapterVersion: `${APP_VERSION}-experimental`,
      collection: !platforms[p.id].adapted
        ? "暂未适配"
        : discoversCourses(p.id)
          ? "HTTP 读取课程及任务 · 覆盖待验证"
          : p.id === "renwei"
          ? "HTTP 优先 · 页面解析待验证"
          : "按需浏览器 · 扫描后回收",
    })),
  }));
  app.get("/api/courses", () => ({ items: engine.courses().filter(c => state().some(p => p.id === c.platform && p.accountId === c.accountId)) }));
  app.post<{ Params: { id: string } }>("/api/platforms/:id/courses/selection", (req, reply) => {
    const platform = PlatformId.parse(req.params.id);
    const { ids } = z.object({ ids: z.array(z.string().max(100)).max(2000) }).strict().parse(req.body);
    const p = state().find(p => p.id === platform)!;
    if (!engine.selectCourses(platform, p.accountId, ids)) return reply.code(400).send({ error: "课程不存在，请刷新课程列表" });
    p.nextScanAt = Date.now(); save(p);
    return { ok: true, message: "课程选择已保存" };
  });
  app.patch<{ Params: { id: string } }>("/api/courses/:id", (req, reply) => {
    const { enabled } = z.object({ enabled: z.boolean() }).strict().parse(req.body);
    const c = engine.courses().find(c => c.id === req.params.id && state().some(p => p.id === c.platform && p.accountId === c.accountId));
    if (!c) return reply.code(404).send({ error: "课程不存在" });
    engine.selectCourses(c.platform, c.accountId, enabled ? [c.id] : [], Date.now(), [c.id]);
    const p = state().find(p => p.id === c.platform)!;
    p.nextScanAt = Date.now(); save(p);
    return { ok: true, message: enabled ? "课程已添加" : "课程已移除，可重新添加" };
  });
  app.patch<{ Params: { id: string } }>("/api/platforms/:id", async (req, reply) => {
    const id = PlatformId.parse(req.params.id);
    const body = z
      .object({
        enabled: z.boolean().optional(),
        added: z.boolean().optional(),
        sources: z.array(SourceConfig).max(12).optional(),
        courseIds: z.array(z.string().max(100)).max(2000).optional(),
      })
      .parse(req.body);
    if (!platforms[id].adapted && (body.enabled || body.sources?.length))
      return reply
        .code(400)
        .send({ error: "暂未适配：当前仅提供官方登录入口" });
    if (body.sources?.some((s) => !safeMonitorUrl(id, s.url)))
      throw new z.ZodError([]);
    const p = state().find((p) => p.id === id)!;
    if (
      body.sources &&
      new Set(body.sources.map((s) => s.url)).size !== body.sources.length
    )
      throw new z.ZodError([]);
    const { courseIds, ...changes } = body;
    if (courseIds && !engine.courses().some(c => c.platform === id && c.accountId === p.accountId) && courseIds.length)
      return reply.code(400).send({ error: "课程不存在，请刷新课程列表" });
    if (courseIds && courseIds.some(courseId => !engine.courses().some(c => c.id === courseId && c.platform === id && c.accountId === p.accountId)))
      return reply.code(400).send({ error: "课程不存在，请刷新课程列表" });
    store.db.transaction(() => {
      if (courseIds) engine.selectCourses(id, p.accountId, courseIds);
      Object.assign(p, changes);
      save(p);
    })();
    if (p.added === false) p.enabled = false;
    if (body.added === false && adapters.activeLogin === id) await adapters.cancel();
    p.nextScanAt = Date.now();
    save(p);
    return { ok: true };
  });
  app.post<{ Params: { id: string } }>(
    "/api/platforms/:id/login",
    async (req, reply) => {
      const id = PlatformId.parse(req.params.id);
      if (study.activeFor(id)) return reply.code(409).send({ error: "请先停止该平台的自动学习，再重新登录" });
      try {
        const result = await adapters.login(id);
        browserProbe = Promise.resolve(true);
        browserProbeAt = Date.now();
        return result ?? { ok: true };
      } catch (e) {
        return reply.code(409).send({ error: (e as Error).message });
      }
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/platforms/:id/login/finish",
    async (req, reply) => {
      const id = PlatformId.parse(req.params.id);
      try {
        const result = await adapters.finish(id);
        const p = state().find((p) => p.id === id)!;
        if (id === "chaoxing" && Array.isArray(result?.courses)) {
          // Reuse the protected course response already checked during login.
          // Course discovery does not select courses or claim task coverage.
          engine.apply({ platform: id, accountId: p.accountId, courses: result.courses,
            outcome: "partial", discoveryComplete: false, partitions: [],
            issues: ["登录时已读取课程列表；任务与分页覆盖尚未核对"] });
        }
        p.loginStatus = "logged_in";
        p.message = "本机会话已保存；请通过扫描验证实际任务读取";
        p.nextScanAt = Date.now();
        p.failures = 0;
        if (discoversCourses(id)) {
          p.added = true;
          p.enabled = true;
        }
        if (id === "renwei" && !p.sources.length) {
          p.sources = defaultRenweiSources;
          p.enabled = true;
        }
        save(p);
        return { ok: true, ...(id === "chaoxing" && Array.isArray(result?.courses) ? {
          message: `登录已保存，已读取 ${result.courses.length} 门课程；请选择需要同步的课程`,
        } : {}) };
      } catch (e) {
        return reply.code(409).send({ error: (e as Error).message });
      }
    },
  );
  app.post("/api/login/cancel", async () => {
    await adapters.cancel();
    return { ok: true };
  });
  app.get("/api/settings", () => engine.settings());
  app.patch("/api/settings", (req) => {
    const settings = Settings.parse(req.body);
    store.db.transaction(() => {
      store.set("settings", settings);
      for (const t of engine.tasks()) {
        engine.cancelPendingDeadlines(t.id, "提醒设置已更新");
        engine.plan(t);
      }
      for (const s of engine.schedules()) {
        engine.cancelPendingDeadlines(s.id, "提醒设置已更新");
        engine.planSchedule(s);
      }
    })();
    browserProbe = undefined;
    return { ok: true };
  });
  app.get("/api/notifications", () => ({
    items: store.all("SELECT * FROM outbox WHERE COALESCE(error,'')!='平台已停用' ORDER BY id DESC LIMIT 200"),
  }));
  app.post("/api/notifications/read", () => {
    store.run("UPDATE outbox SET read_at=? WHERE read_at IS NULL AND COALESCE(error,'')!='平台已停用'", Date.now());
    return { ok: true };
  });
  app.get("/api/history", () => ({
    items: store
      .all(
        "SELECT h.*,json_extract(t.data,'$.title') AS title FROM history h LEFT JOIN tasks t ON t.id=h.task_id ORDER BY h.id DESC LIMIT 200",
      )
      .filter((r: any) => PlatformId.safeParse(r.platform).success)
      .map((r: any) => ({ ...r, data: JSON.parse(r.data) })),
  }));
  app.get("/api/logs", () => ({
    items: store
      .all("SELECT * FROM scans ORDER BY id DESC LIMIT 100")
      .filter((r: any) => PlatformId.safeParse(r.platform).success)
      .map((r: any) => ({ ...r, data: JSON.parse(r.data) })),
  }));
  app.get('/api/diagnostics/export', () => ({
    version: APP_VERSION, schemaVersion: 1, exportedAt: Date.now(), timezone: 'Asia/Shanghai',
    system: { platform: process.platform, arch: process.arch, release: release(), node: process.versions.node,
      uptimeSeconds: Math.floor(uptime()), serviceUptimeSeconds: Math.floor(process.uptime()),
      freeMemoryBytes: freemem(), totalMemoryBytes: totalmem(), processMemory: process.memoryUsage(),
      browserMode: 'system' },
    monitoring: store.get('monitoring', true), nextCourseScanAt: nextCourseScanAt(),
    platforms: state().filter(p => p.added).map(p => ({ platform: p.id, enabled: p.enabled,
      loginStatus: p.loginStatus, lastOutcome: p.lastOutcome, lastScanAt: p.lastScanAt, nextScanAt: p.nextScanAt, failures: p.failures })),
    scans: store.all<{platform: string; outcome: string; at: number}>('SELECT platform,outcome,at FROM scans ORDER BY id DESC LIMIT 100'),
    journal: diagnostics.read(),
    content: '系统版本、运行状态、错误阶段、请求状态和页面控件数量；不含账号、课程内容、登录凭据、模型 Key 或原始页面。',
  }));
  app.get("/api/export", () => ({
    version: APP_VERSION,
    exportedAt: Date.now(),
    tasks: engine.tasks(),
    schedules: engine.schedules(),
    history: store.all("SELECT * FROM history ORDER BY id"),
  }));
  app.post("/api/backup", async () => {
    const path = join(
      options.dir,
      `backup-${new Date().toISOString().replace(/[:.]/g, "-")}.db`,
    );
    await store.backup(path);
    return {
      ok: true,
      message: "一致性备份已保存到本机数据目录；不包含浏览器会话",
    };
  });
  app.post("/api/notifications/test", async (req, reply) => {
    const { scenario } = z.object({ scenario: z.enum(["new", "deadline"]).optional() }).parse(req.body ?? {});
    const now = Date.now();
    const time = (value: number) => ({kind: "known" as const, value, raw: "模拟通知时间", timezone: "Asia/Shanghai" as const});
    const notice = scenario ? taskNotice({ title: "模拟作业", course: "通知测试课程", type: "homework",
      startTime: time(scenario === "new" ? now : now - 86400000),
      deadline: time(scenario === "new" ? now + 86400000 : now),
    }, scenario, true) : {title: "CourseWatch", body: "测试通知"};
    if (process.env.COURSEWATCH_NATIVE_NOTIFICATIONS === "1") {
      engine.enqueue(
        `test:${randomUUID()}`,
        notice.title,
        notice.body,
        null,
        "test",
      );
      return { ok: true, id: store.all<{id: number}>("SELECT id FROM outbox ORDER BY id DESC LIMIT 1")[0].id,
        message: "测试通知已排队，等待 macOS 投递确认" };
    }
    try {
      await sendNative(
        notice.title,
        notice.body,
      );
      return {
        ok: true,
        message: "通知接口已接收；请在系统通知中心核对是否显示",
      };
    } catch {
      return reply.code(503).send({
        error: "系统通知接口未确认接收，请检查系统权限；通知中心仍可正常使用",
      });
    }
  });
  app.get("/api/native/pending", () => ({
    items:
      process.env.COURSEWATCH_NATIVE_NOTIFICATIONS === "1"
        ? store.all(
            "SELECT id,title,body,task_id FROM outbox WHERE delivered_at IS NULL AND (? OR kind='test') ORDER BY id LIMIT 5",
            engine.settings().nativeNotifications ? 1 : 0,
          )
        : [],
  }));
  app.post("/api/native/renderer", (req) => {
    const { state } = z
      .object({ state: z.enum(["active", "suspended", "closed"]) })
      .parse(req.body);
    store.set("nativeRenderer", { state, at: Date.now() });
    return { ok: true };
  });
  app.post("/api/native/delivered", (req) => {
    const body = z
      .object({
        id: z.number().int().positive(),
        error: z.string().max(200).optional(),
      })
      .parse(req.body);
    store.run(
      "UPDATE outbox SET delivered_at=?,error=? WHERE id=?",
      Date.now(),
      body.error ?? null,
      body.id,
    );
    return { ok: true };
  });
  app.post("/api/experiment", (req) => {
    const { scenario } = z
      .object({
        scenario: z.enum(["baseline", "change", "new", "failure", "empty"]),
      })
      .parse(req.body);
    return runExperiment(engine, scenario);
  });
  app.post("/api/experiment/clear", () => {
    store.db.transaction(() => {
      const accountId = store.get<string | null>("experimentAccount", null);
      if (accountId) {
        const ids = engine
          .tasks()
          .filter(
            (t) =>
              t.accountId === accountId && t.namespace === "local-experiment",
          )
          .map((t) => t.id);
        for (const id of ids) {
          store.run("DELETE FROM history WHERE task_id=?", id);
          store.run("DELETE FROM reminders WHERE task_id=?", id);
          store.run("DELETE FROM outbox WHERE task_id=?", id);
          store.run("DELETE FROM tasks WHERE id=?", id);
        }
        store.run(
          "DELETE FROM outbox WHERE dedupe=?",
          `baseline-summary:ynjy:${accountId}`,
        );
        store.run(
          "DELETE FROM settings WHERE key=?",
          `baseline:ynjy:${accountId}`,
        );
      }
      for (const key of [
        "experimentAccount",
        "experimentEpoch",
        "experimentChanged",
        "experimentAdded",
      ])
        store.run("DELETE FROM settings WHERE key=?", key);
    })();
    return { ok: true };
  });
  let scanning = false;
  let tickRunning = false;
  let stopping = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastTick = Date.now();
  async function scanOne(p: PlatformState) {
    const now = Date.now();
    const selectedCourseKeys = engine.courses().filter(c => c.platform === p.id && c.accountId === p.accountId && c.status === "enabled").map(c => c.key);
    const result = await adapters.scan({ ...p, ...(discoversCourses(p.id) ? { selectedCourseKeys } : {}) });
    engine.apply(result);
    if (discoversCourses(p.id)) store.set(`courseScanSlot:${p.id}`, courseScanSlot(now));
    diagnostics.record(p.id, 'scan-result', { stage: result.outcome, facts: { durationMs: Date.now() - now, courses: result.courses?.length ?? 0, issues: result.issues.length } });
    p.lastScanAt = Date.now();
    p.lastOutcome = result.outcome;
    p.message = result.issues[0] ?? "检查完成";
    if (["complete", "partial"].includes(result.outcome)) {
      p.lastSuccessAt = Date.now();
      p.failures = 0;
      p.loginStatus = "logged_in";
    } else p.failures++;
    if (["auth_required", "verification_required"].includes(result.outcome))
      p.loginStatus = result.outcome;
    p.nextScanAt =
      Date.now() +
      Math.max(
        engine.settings().intervalMinutes * 60000,
        Math.min(3600000, 60000 * 2 ** Math.min(p.failures, 6)),
      ) +
      Math.floor(Math.random() * 10000);
    const current = state().find((item) => item.id === p.id)!;
    save({ ...p, enabled: current.enabled, sources: current.sources });
    return {
      platform: p.id,
      outcome: result.outcome,
      message: p.message,
      duration: Date.now() - now,
    };
  }
  async function scan(ids?: PlatformId[]) {
    if (scanning) return { busy: true };
    scanning = true;
    try {
      const results = [];
      for (const p of state()) {
        if (stopping) break;
        if (
          ids
            ? !ids.includes(p.id)
            : !p.enabled ||
              p.nextScanAt > Date.now() ||
              ["auth_required", "verification_required"].includes(p.loginStatus)
        )
          continue;
        results.push(await scanOne(p));
      }
      return { results };
    } finally {
      scanning = false;
    }
  }
  app.post("/api/monitor/check", async (req) => {
    const { platform } = z
      .object({ platform: PlatformId.optional() })
      .parse(req.body ?? {});
    const result = await scan(
      platform
        ? [platform]
        : state()
            .filter((p) => p.enabled)
            .map((p) => p.id),
    );
    if (result.busy) return { ...result, message: "正在检查，请稍后查看结果" };
    const failed = result.results?.filter((r) => !["complete", "partial"].includes(r.outcome)) ?? [];
    return { ...result, message: failed.length
      ? failed.map((r) => `${platforms[r.platform].short}：${r.message}`).join("；")
      : result.results?.length ? "检查完成，任务已更新；覆盖范围见检查日志" : "未开启平台监控，请先在平台设置中开启" };
  });
  app.post("/api/monitor/start", () => {
    store.set("monitoring", true);
    return { ok: true };
  });
  app.post("/api/monitor/stop", () => {
    store.set("monitoring", false);
    return { ok: true };
  });
  async function tick() {
    if (stopping) return;
    tickRunning = true;
    try {
      const now = Date.now();
      if (now - lastTick > 90000 || now < lastTick) {
        for (const [i, p] of state().entries()) {
          p.nextScanAt = now + i * 15000;
          save(p);
        }
      }
      lastTick = now;
      if (store.get("monitoring", true)) await scan();
    } catch (error) {
      diagnostics.record('service', 'scan-tick-error', { reason: diagnosticReason(error) });
      /* Persist safe operational diagnostics without raw responses. */ store.set(
        "lastServiceIssue",
        { at: Date.now(), message: "后台轮次异常；已有数据保留，下一轮继续" },
      );
    } finally {
      tickRunning = false;
      if (!stopping) timer = setTimeout(tick, 30000);
    }
  }
  async function scanScheduledCourses() {
    if (stopping || !store.get('monitoring', true) || adapters.activeLogin || scanning) return;
    const slot = courseScanSlot();
    const ids = state().filter(p => p.added && p.enabled && discoversCourses(p.id)
      && !['auth_required', 'verification_required'].includes(p.loginStatus)
      && store.get<number>(`courseScanSlot:${p.id}`, -1) !== slot).map(p => p.id);
    if (ids.length) await scan(ids);
  }
  let courseTimer: ReturnType<typeof setTimeout> | undefined;
  async function courseClockTick() {
    try { await scanScheduledCourses(); }
    catch (error) { diagnostics.record('service', 'scheduled-course-scan-error', { reason: diagnosticReason(error) }); }
    finally {
      // Retry a deferred boundary after login or a busy collector, and coalesce
      // missed boundaries after sleep into one scan of the current slot.
      if (!stopping) courseTimer = setTimeout(courseClockTick, Math.min(30000, nextCourseScanAt() - Date.now()));
    }
  }
  let reminderRunning = false;
  let mobileWork: Promise<void> | undefined;
  async function reminderTick() {
    if (stopping || reminderRunning) return;
    reminderRunning = true;
    try {
      engine.reminders();
      // Slow mail/push services must not block local reminder planning or native notifications.
      if (!mobileWork) mobileWork = mobileNotifications.drain(engine)
        .catch(() => diagnostics.record('notifications', 'delivery-round-error', { reason: '通知投递轮次未完成' }))
        .finally(() => { mobileWork = undefined; });
      if (process.env.COURSEWATCH_NATIVE_NOTIFICATIONS !== "1")
        await drain(engine);
      else if (!engine.settings().nativeNotifications)
        store.run(
          "UPDATE outbox SET delivered_at=?,error='系统通知关闭，记录保留在通知中心' WHERE delivered_at IS NULL AND kind!='test'",
          Date.now(),
        );
    } catch {
      store.set("lastReminderIssue", {
        at: Date.now(),
        message: "提醒轮次异常，下一轮重试",
      });
    } finally {
      reminderRunning = false;
    }
  }
  const reminderTimer = options.test
    ? undefined
    : setInterval(reminderTick, 15000);
  if (!options.test) void reminderTick();
  const root = resolve("dist/web");
  if (existsSync(root)) await app.register(fastifyStatic, { root });
  else
    app.get("/", (_, reply) =>
      reply
        .type("text/plain")
        .send("请先运行 npm run build:web，然后重启后台。"),
    );
  app.addHook("onClose", async () => {
    stopping = true;
    if (timer) clearTimeout(timer);
    if (reminderTimer) clearInterval(reminderTimer);
    if (courseTimer) clearTimeout(courseTimer);
    await adapters.cancel();
    while (scanning || tickRunning || reminderRunning)
      await new Promise((r) => setTimeout(r, 50));
    await mobileWork;
    store.close();
  });
  if (!options.test) timer = setTimeout(tick, 1500);
  if (!options.test) courseTimer = setTimeout(courseClockTick, Math.min(3000, nextCourseScanAt() - Date.now()));
  return { app, store, engine, pairingCode: code, scan, scanScheduledCourses, mobileNotifications };
}
