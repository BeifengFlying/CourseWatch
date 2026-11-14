import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { PlatformState } from "./index.js";
import { discoversCourses, type PlatformId, type ScanResult } from "../../contracts/src/index.js";
// Browser and HTML libraries live only in a short-lived collector process.
export class AdapterManager {
  private worker?: ChildProcess;
  private loginPlatform: PlatformId | null = null;
  private busy = false;
  private sequence = 0;
  constructor(private dir: string, private browser?: () => string) {}
  get activeLogin() {
    return this.loginPlatform;
  }
  private ensureWorker() {
    if (this.worker?.connected) return this.worker;
    const path = fileURLToPath(
      new URL(
        import.meta.url.endsWith(".ts") ? "./worker.ts" : "./worker.js",
        import.meta.url,
      ),
    );
    const worker = fork(path, [], {
      execArgv: path.endsWith(".ts") ? ["--import", "tsx"] : [],
      env: { ...process.env, COURSEWATCH_WORKER_DIR: this.dir, ...(this.browser ? { COURSEWATCH_BROWSER: this.browser() } : {}) },
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      windowsHide: true,
    });
    worker.on("exit", () => {
      if (this.worker === worker) {
        this.worker = undefined;
        this.loginPlatform = null;
      }
    });
    this.worker = worker;
    worker.on("message", (message: any) => {
      if (message.event === "loginClosed") {
        this.loginPlatform = null;
        if (!this.busy) void this.release();
      }
    });
    return worker;
  }
  private call(
    action: string,
    payload: Record<string, unknown> = {},
    timeout = 40000,
  ): Promise<any> {
    const worker = this.ensureWorker();
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        worker.off("message", message);
        worker.off("exit", exit);
      };
      const message = (result: any) => {
        if (result.id !== id) return;
        cleanup();
        result.error ? reject(new Error(result.error)) : resolve(result.result);
      };
      const exit = () => {
        cleanup();
        reject(new Error("采集进程已退出，旧任务保留"));
      };
      const timer = setTimeout(() => {
        cleanup();
        worker.kill("SIGTERM");
        reject(new Error("采集超过时间上限，旧任务保留"));
      }, timeout);
      worker.on("message", message);
      worker.once("exit", exit);
      worker.send({ id, action, ...payload }, (error) => {
        if (error) {
          cleanup();
          reject(new Error("无法启动采集进程"));
        }
      });
    });
  }
  private async release() {
    const worker = this.worker;
    this.worker = undefined;
    this.loginPlatform = null;
    if (!worker) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        worker.kill("SIGTERM");
        resolve();
      }, 3000);
      worker.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      if (worker.connected) worker.disconnect();
      else {
        clearTimeout(timer);
        resolve();
      }
    });
  }
  async login(platform: PlatformId) {
    if (this.busy || this.worker)
      throw new Error("已有登录或采集窗口，请先完成或取消");
    this.busy = true;
    try {
      const result = await this.call("login", { platform });
      this.loginPlatform = platform;
      return result;
    } catch (e) {
      await this.release();
      throw e;
    } finally {
      this.busy = false;
    }
  }
  async finish(platform: PlatformId) {
    if (this.busy) throw new Error("正在处理登录，请稍后重试");
    if (this.loginPlatform !== platform)
      throw new Error("请先打开该平台登录窗口");
    this.busy = true;
    try {
      const result = await this.call("finish", { platform });
      await this.release();
      return result;
    } finally {
      this.busy = false;
    }
  }
  async cancel() {
    try {
      if (this.worker && !this.busy) await this.call("cancel", {}, 10000);
    } finally {
      await this.release();
    }
  }
  async scan(state: PlatformState): Promise<ScanResult> {
    const failure = (message: string): ScanResult => ({
      platform: state.id,
      accountId: state.accountId,
      outcome: "failed",
      discoveryComplete: false,
      partitions: [],
      issues: [message],
    });
    if (this.busy || this.worker)
      return failure("浏览器正在登录或采集，本轮已延后");
    if (!state.sources.length && !discoversCourses(state.id)) return failure("请先添加监控列表页");
    this.busy = true;
    try {
      return await this.call("scan", { state }, 130000);
    } catch {
      return failure("采集进程异常或超时，旧任务保留");
    } finally {
      await this.release();
      this.busy = false;
    }
  }
}
