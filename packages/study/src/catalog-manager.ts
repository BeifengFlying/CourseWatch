import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { CourseRecord } from '../../contracts/src/index.js';
import type { CourseLearningProgress, StudyPlatform } from '../../contracts/src/study.js';
import type { DiagnosticLog } from '../../core/src/diagnostics.js';
type CatalogResult = { items: CourseLearningProgress[]; issues: string[] };
export class CourseCatalogManager {
  constructor(private diagnostics?: DiagnosticLog, private browser?: () => string) {}
  private running = false;
  private child?: ChildProcess;
  private releases = new WeakMap<ChildProcess, Promise<void>>();
  get active() { return this.running; }
  async stop() { if (this.child) await this.release(this.child); }
  private async release(child: ChildProcess) {
    let released = this.releases.get(child);
    if (!released) {
      released = child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : new Promise<void>(resolve => {
        const terminate = setTimeout(() => child.kill('SIGTERM'), 3000);
        const force = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 6000);
        child.once('exit', () => { clearTimeout(terminate); clearTimeout(force); resolve(); });
        if (child.connected) child.disconnect(); else child.kill('SIGTERM');
      });
      this.releases.set(child, released);
    }
    await released;
    if (this.child === child) this.child = undefined;
  }
  async read(dir: string, platform: StudyPlatform, courses: CourseRecord[]): Promise<CatalogResult> {
    if (this.running) throw new Error('正在读取课程进度，请稍后重试');
    this.running = true;
    let child: ChildProcess | undefined;
    try {
      const path = fileURLToPath(new URL(`./catalog-worker.${import.meta.url.endsWith('.ts') ? 'ts' : 'js'}`, import.meta.url));
      child = fork(path, [], { execArgv: path.endsWith('.ts') ? ['--import', 'tsx'] : [], env: { ...process.env, ...(this.browser ? { COURSEWATCH_BROWSER: this.browser() } : {}) }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true });
      this.child = child;
      const worker = child;
      return await new Promise<CatalogResult>((resolve, reject) => {
        const done = (error?: string, result?: CatalogResult) => {
          clearTimeout(timer); worker.off('message', message); worker.off('error', failed); worker.off('exit', exited);
          error ? reject(new Error(error)) : resolve(result!);
        };
        let partial: CatalogResult | undefined;
        const message = (value: any) => {
          if (value.diagnostic) { this.diagnostics?.record(platform, value.diagnostic.event, value.diagnostic); return; }
          if (value.partial) partial = value.partial; else done(value.error, value.result);
        };
        const failed = () => done('无法启动进度读取');
        const exited = () => done('进度读取进程已退出，旧进度已保留');
        const timer = setTimeout(() => partial?.items.length ? done(undefined, { items: partial.items, issues: [...partial.issues, '部分课程读取超时，已保留本轮读取结果；其余课程可单独查询'] }) : done('课程进度读取超时，旧进度已保留'), 90000);
        worker.on('message', message); worker.once('error', failed); worker.once('exit', exited);
        worker.send({ dir, platform, courses }, error => { if (error) failed(); });
      });
    } finally {
      if (child) await this.release(child);
      this.running = false;
    }
  }
}
