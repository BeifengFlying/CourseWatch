import type { BrowserContext } from "playwright";
import { mkdir, chmod } from "node:fs/promises";
import { join } from "node:path";
import {
  platforms,
  type PlatformId,
  type SourceConfig,
  type ScanResult,
  safePlatformUrl,
  safeMonitorUrl,
  discoversCourses,
} from "../../contracts/src/index.js";
import { Vault } from "./vault.js";
import { canRestoreUnipusSession, restoreUnipusSession, saveUnipusSession } from "./unipus-session.js";
import { browserLaunchOptions, BrowserUnavailableError } from "./browser.js";
import { confirmLogin } from "./session.js";
import { getPlatformPage } from "./http.js";
import { CollectionError } from "./course-http.js";
import { DiagnosticLog, diagnosticErrorFacts, diagnosticReason, type DiagnosticFacts } from '../../core/src/diagnostics.js';
import { watchBrowserDiagnostics, reportBrowserFailure } from './browser-diagnostics.js';
export interface PlatformState {
  id: PlatformId;
  accountId: string;
  enabled: boolean;
  added?: boolean;
  sources: SourceConfig[];
  selectedCourseKeys?: string[];
  loginStatus: string;
  lastScanAt: number | null;
  lastSuccessAt: number | null;
  nextScanAt: number;
  failures: number;
  lastOutcome: string;
  message: string;
}
export class Adapters {
  private active?: { platform: PlatformId; context: BrowserContext };
  private busy = false;
  private vault: Vault;
  private diagnostics: DiagnosticLog;
  constructor(
    private dir: string,
    private loginClosed?: () => void,
  ) {
    this.vault = new Vault(dir);
    this.diagnostics = new DiagnosticLog(dir);
  }
  get activeLogin() {
    return this.active?.platform ?? null;
  }
  private async launch(id: PlatformId, headless: boolean) {
    const { chromium } = await import("playwright");
    const browser = await browserLaunchOptions();
    const profile = browser.executablePath
      ? `${id}-system-${browser.executablePath.includes("Microsoft Edge") ? "edge" : "chrome"}`
      : id;
    const path = join(this.dir, "profiles", profile);
    await mkdir(path, { recursive: true, mode: 0o700 });
    await chmod(path, 0o700);
    return chromium.launchPersistentContext(path, {
      ...browser,
      headless,
      viewport: { width: 1280, height: 900 },
      acceptDownloads: false,
    });
  }
  async login(id: PlatformId) {
    if (this.busy || this.active)
      throw new Error("已有登录或采集窗口，请完成或取消后再试");
    this.busy = true;
    try {
      const context = await this.launch(id, false);
      this.active = { platform: id, context };
      watchBrowserDiagnostics(context, (event,stage,reason,facts) => this.diagnostics.record(id,event,{stage,reason,facts}));
      context.on("close", () => {
        if (this.active?.context === context) {
          this.active = undefined;
          this.loginClosed?.();
        }
      });
      const page = context.pages()[0] ?? (await context.newPage());
      try {
      await page.goto(platforms[id].loginUrl, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      } catch (error) {
        await reportBrowserFailure(error, 'login-navigation', page, (event,stage,reason,facts) => this.diagnostics.record(id,event,{stage,reason,facts}));
        if (this.active?.context !== context || page.isClosed()) throw new Error("登录窗口已关闭");
        // A redirect or slow network must not destroy an open official login window.
        return { ok: true, message: "登录窗口已打开；页面加载未完成，请在窗口中刷新后继续登录" };
      }
      if (this.active?.context !== context) throw new Error("登录窗口已关闭");
      return { ok: true };
    } catch (error) {
      this.diagnostics.record(id,'operation-failed',{stage:'login-open',reason:diagnosticReason(error),facts:diagnosticErrorFacts(error)});
      await this.cancel();
      if (error instanceof BrowserUnavailableError) throw error;
      throw new Error(
        process.env.COURSEWATCH_BROWSER_MODE === "system"
          ? "无法打开登录窗口，请检查 Chrome／Edge 是否可以正常打开，以及网络连接"
          : "无法打开登录窗口，请检查浏览器运行时和网络连接",
      );
    } finally {
      this.busy = false;
    }
  }
  async finish(id: PlatformId) {
    if (this.active?.platform !== id) throw new Error("请先打开该平台登录窗口");
    const { context } = this.active;
    let courses: { key: string; name: string }[] | undefined;
    const started = Date.now();
    this.diagnostics.record(id,'login-confirm-start');
    try {
      await confirmLogin(context, id, items => { courses = items; });
      await this.vault.save(id, await context.storageState({ indexedDB: true }));
    } catch (error) {
      await reportBrowserFailure(error, 'login-confirm', context.pages().at(-1), (event,stage,reason,facts) => this.diagnostics.record(id,event,{stage,reason,facts}));
      throw error;
    }
    this.diagnostics.record(id,'login-confirmed',{facts:{durationMs:Date.now()-started}});
    await context.close();
    this.active = undefined;
    return { ok: true, ...(courses ? { courses } : {}) };
  }
  async cancel() {
    const c = this.active?.context;
    this.active = undefined;
    await c?.close();
  }
  async scan(p: PlatformState): Promise<ScanResult> {
    const base = {
      platform: p.id,
      accountId: p.accountId,
      outcome: "failed",
      discoveryComplete: false,
      partitions: [],
      issues: [],
    } as ScanResult;
    if (!platforms[p.id].adapted)
      return {
        ...base,
        issues: ["暂未适配：当前仅提供官方登录入口，尚未接入任务同步"],
      };
    if (!p.sources.length && !discoversCourses(p.id))
      return {
        ...base,
        outcome: "failed",
        issues: ["请配置需要监控的作业／考试列表地址"],
      };
    // Recheck persisted configurations too, including ones accepted by older versions.
    if (p.sources.some((source) => !safeMonitorUrl(p.id, source.url)))
      return { ...base, issues: ["监控来源地址无效，请使用官方任务列表页"] };
    if (this.busy || this.active)
      return {
        ...base,
        outcome: "failed",
        issues: ["浏览器正在登录或采集，本轮已延后"],
      };
    this.busy = true;
    let context: BrowserContext | undefined;
    try {
      const { parsePage } = await import("./parser.js");
      const { collectYnjyPage } = await import("./ynjy.js");
      let state = await this.vault.read(p.id);
      if (!state)
        return {
          ...base,
          outcome: "auth_required",
          issues: ["请先在官方页面登录并保存本机会话"],
        };
      if (discoversCourses(p.id)) {
        const { request } = await import("playwright");
        const { courseReader } = await import("./course-http.js");
        const createHTTP = (session: typeof state) => request.newContext({
          storageState: session, timeout: 15000, ignoreHTTPSErrors: false,
          userAgent: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
          extraHTTPHeaders: { "Accept-Language": "zh-CN,zh;q=0.9", ...(p.id === "chaoxing" ? { Referer: "https://i.chaoxing.com/" } : {}) },
        });
        let http = await createHTTP(state);
        const observeRead = (facts: DiagnosticFacts) => {
          const rejected = typeof facts.applicationCode === 'number' &&
            (p.id === 'unipus' ? facts.applicationCode !== 1 : p.id === 'yuketang' ? facts.applicationCode !== 0 : false);
          if (facts.requestFailed || rejected) this.diagnostics.record(p.id, 'platform-read-failed', {stage:'scan-read',facts});
        };
        try {
          const read = courseReader(http, p.id, observeRead);
          const result = p.id === "yuketang"
            ? await (async () => {
                const { collectRain, rainOrigin } = await import("./yuketang.js");
                const origin = rainOrigin(p.sources);
                const csrf = (await http.storageState()).cookies.find(c => c.name === "csrftoken" && (new URL(origin).hostname === c.domain.replace(/^\./, "") || new URL(origin).hostname.endsWith(`.${c.domain.replace(/^\./, "")}`)))?.value;
                return collectRain(read, p.accountId, origin, { xtbz: "ykt", Referer: `${origin}/v2/web/index`, ...(csrf ? { "X-CSRFToken": csrf } : {}) }, p.selectedCourseKeys);
              })()
            : p.id === "unipus"
              ? await (async () => {
                  const { collectUnipus, unipusHeaders } = await import("./unipus.js");
                  let result = await collectUnipus(read, p.accountId, unipusHeaders(state), p.selectedCourseKeys);
                  if (result.outcome === 'auth_required' && canRestoreUnipusSession(state)) {
                    try {
                      const refreshed = await restoreUnipusSession(state);
                      state = await saveUnipusSession(this.vault,state,refreshed);
                      await http.dispose(); http = await createHTTP(state);
                      result = await collectUnipus(courseReader(http,p.id,observeRead),p.accountId,unipusHeaders(state),p.selectedCourseKeys);
                    } catch (error) {
                      this.diagnostics.record(p.id,'session-restore-failed',{stage:'session-restore',reason:diagnosticReason(error),facts:diagnosticErrorFacts(error)});
                    }
                  }
                  return result;
                })()
              : await (await import("./chaoxing.js")).collectChaoxing(read, p.accountId, p.selectedCourseKeys);
          if (!["auth_required", "verification_required"].includes(result.outcome)) {
            const updated = await http.storageState();
            if (p.id === 'unipus') await saveUnipusSession(this.vault,state,updated);
            else await this.vault.save(p.id,updated);
          }
          return result;
        } finally { await http.dispose(); }
      }
      if (p.id === "ynjy") {
        context = await this.launch(p.id, true);
        // A change from system Chrome to the independent runtime must not
        // discard a session already saved by CourseWatch.
        await context.addCookies(state.cookies);
        await context.addInitScript((origins) => {
          for (const origin of origins) {
            if (location.origin !== origin.origin) continue;
            for (const { name, value } of origin.localStorage)
              localStorage.setItem(name, value);
          }
        }, state.origins);
      }
      const roundStarted = Date.now();
      const http =
        p.id === "renwei"
          ? await (
              await import("playwright")
            ).request.newContext({
              storageState: state,
              timeout: 20000,
              ignoreHTTPSErrors: false,
              maxRedirects: 5,
            })
          : undefined;
      try {
        for (const source of p.sources) {
          if (Date.now() - roundStarted > 90000) {
            base.issues.push("本轮达到 90 秒上限，未检查页面保留为未覆盖");
            break;
          }
          try {
            let html = "";
            let rendered: ReturnType<typeof parsePage> | undefined;
            if (context) {
              const page = await context.newPage();
              try {
                rendered = await collectYnjyPage(page, source);
                if (!safePlatformUrl(p.id, page.url()))
                  throw new Error("unexpected redirect");
              } finally {
                await page.close();
              }
            } else {
              const response = await getPlatformPage(http!, p.id, source.url);
              if (response.status() === 429) {
                base.issues.push("平台限流，已停止本轮请求");
                break;
              }
              if (!response.ok() || !safePlatformUrl(p.id, response.url()))
                throw new Error("invalid response");
              const length = Number(response.headers()["content-length"] || 0);
              if (length > 4 * 1024 * 1024)
                throw new Error("response too large");
              html = await response.text();
              if (html.length > 4 * 1024 * 1024)
                throw new Error("response too large");
            }
            const parsed = rendered ?? parsePage(p.id, html, source);
            if (parsed.auth || parsed.verification)
              return {
                ...base,
                partitions: [],
                outcome: parsed.auth
                  ? "auth_required"
                  : "verification_required",
                issues: parsed.issues,
              };
            base.partitions.push({
              key: source.url,
              outcome: parsed.items.length || parsed.emptyConfirmed ? "partial" : "failed",
              paginationComplete: parsed.paginationComplete,
              emptyConfirmed: parsed.emptyConfirmed,
              items: parsed.items,
              issues: parsed.issues,
            });
          } catch (error) {
            this.diagnostics.record(p.id,'operation-failed',{stage:'scan-page',reason:diagnosticReason(error),facts:diagnosticErrorFacts(error)});
            base.partitions.push({
              key: source.url,
              outcome: "failed",
              paginationComplete: false,
              emptyConfirmed: false,
              items: [],
              issues: [
                "页面请求超时、网络失败或页面结构无法识别；旧数据已保留",
              ],
            });
          }
        }
        if (http) await this.vault.save(p.id, await http.storageState());
        if (context)
          await this.vault.save(
            p.id,
            await context.storageState({ indexedDB: true }),
          );
      } finally {
        await http?.dispose();
      }
      const useful = base.partitions.some((p) => p.items.length || p.emptyConfirmed);
      return {
        ...base,
        outcome: useful ? "partial" : "failed",
        issues: [
          ...base.issues,
          ...base.partitions.filter((p) => p.outcome === "failed").flatMap((p) => p.issues),
          "仅覆盖配置页面；未验证分页，不代表完整账号快照",
        ].slice(0, 30),
      };
    } catch (error) {
      this.diagnostics.record(p.id,'operation-failed',{stage:'scan',reason:diagnosticReason(error),facts:diagnosticErrorFacts(error)});
      return {
        ...base,
        partitions: [],
        outcome: error instanceof CollectionError ? error.outcome : "failed",
        issues: [
          error instanceof CollectionError ? error.message : error instanceof BrowserUnavailableError
            ? error.message
            : "采集未完成：请检查浏览器安装、本机会话解密和网络",
        ],
      };
    } finally {
      try {
        await context?.close();
      } finally {
        this.busy = false;
      }
    }
  }
}
