import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { initialStudyStatus, type StudyConfig, type StudyStart, type StudyStatus, type StudyPlatform, type StudyProgress, type StudyPosition, studyPlatformNames } from "../../contracts/src/study.js";
import { DiagnosticLog } from '../../core/src/diagnostics.js';
export class StudyManager {
  private worker?: ChildProcess;
  private state = initialStudyStatus();
  private closeTimer?: ReturnType<typeof setTimeout>;
  private deadline: number | null = null;
  private generation = 0;
  constructor(readonly platform: StudyPlatform = "chaoxing", private diagnostics?: DiagnosticLog, private notify?: (platform: StudyPlatform, status: StudyStatus) => void, private remember?: (courseKey: string, progress: StudyProgress) => void, private browser?: () => string) {}
  private attention() {
    try { this.notify?.(this.platform, this.status()); }
    catch { this.diagnostics?.record(this.platform, 'study-notice-failed'); }
  }
  get active() { return !!this.worker; }
  status(): StudyStatus { return structuredClone({ ...this.state, closeAt: this.deadline }); }
  start(dir: string, config: StudyConfig, key: string, options?: StudyStart & { course?: { key: string; name: string }; position?: StudyPosition }) {
    if (this.worker) throw new Error("已有自动学习任务，请先停止");
    const file = this.platform === "unipus" ? "unipus-worker" : "worker";
    const path = fileURLToPath(new URL(`./${file}.${import.meta.url.endsWith(".ts") ? "ts" : "js"}`, import.meta.url));
    const child = fork(path, [], { execArgv: path.endsWith(".ts") ? ["--import", "tsx"] : [], env: { ...process.env, ...(this.browser ? { COURSEWATCH_BROWSER: this.browser() } : {}) }, stdio: ["ignore", "ignore", "pipe", "ipc"], windowsHide: true });
    const generation = ++this.generation;
    this.worker = child; this.state = { ...initialStudyStatus(), phase: "starting", message: `正在启动${studyPlatformNames[this.platform]}${options?.background ? "后台页面" : "学习窗口"}`, startedAt: Date.now(), courseName: options?.course?.name || "" };
    let stderrRecorded = false;
    child.stderr?.on('data', () => {
      if (!stderrRecorded) this.diagnostics?.record(this.platform, 'worker-stderr', { stage: this.state.phase });
      stderrRecorded = true; // Never persist raw stderr: it may contain session URLs.
    });
    const startup = setTimeout(() => { if (this.worker === child && this.state.phase === "starting") { this.state.phase = "failed"; this.state.message = "自动学习启动超时，请检查登录或浏览器后重试"; this.diagnostics?.record(this.platform, 'startup-timeout'); this.attention(); child.kill("SIGTERM"); } }, 120000);
    this.diagnostics?.record(this.platform, 'study-start', { facts: { background: options?.background === true, operation: options?.operation ?? 'play' } });
    child.on("message", (message: any) => {
      if (this.worker !== child) return;
      if (message.diagnostic) this.diagnostics?.record(this.platform, message.diagnostic.event, message.diagnostic);
      if (message.status && this.state.phase !== "stopping") {
        const needsAttention = this.state.phase !== message.status.phase && ["paused", "failed"].includes(message.status.phase);
        if (this.state.phase !== message.status.phase) this.diagnostics?.record(this.platform, 'study-phase', { stage: message.status.phase });
        this.state = { ...message.status, courseName: message.status.courseName || options?.course?.name || "", operation: options?.operation ?? "play", heartbeatAt: Date.now() }; if (this.state.phase !== "starting") clearTimeout(startup);
        const progress = this.state.progress;
        if (options?.course && options.operation !== 'keep-open' && progress?.chapterId && (progress.courseKey === options.course.key || this.platform === 'unipus' && progress.course === options.course.name)) { try { this.remember?.(options.course.key, progress); } catch { this.diagnostics?.record(this.platform, 'study-position-failed'); } }
        if (needsAttention) this.attention();
      }
    });
    child.on("error", () => { if (this.worker !== child) return; this.diagnostics?.record(this.platform, 'worker-error'); this.state.phase = "failed"; this.state.message = "无法启动自动学习进程"; this.attention(); });
    child.on("exit", (code, signal) => {
      this.diagnostics?.record(this.platform, 'study-exit', { facts: { code, signal } });
      clearTimeout(startup);
      if (this.worker !== child) return;
      clearTimeout(this.closeTimer);
      this.worker = undefined; this.deadline = null;
      if (!["completed", "failed", "stopped"].includes(this.state.phase)) {
        const failed = code !== 0 && this.state.phase !== 'stopping';
        this.state.phase = failed ? 'failed' : 'stopped';
        this.state.message = failed ? '学习进程异常退出，请导出系统日志查看诊断' : '自动学习进程已退出';
        if (failed) this.attention();
      }
    });
    this.deadline = options?.closeAfterMinutes ? Date.now() + options.closeAfterMinutes * 60000 : null;
    if (this.deadline) this.closeTimer = setTimeout(() => { void this.stop().then(() => { if (this.worker || this.generation !== generation) return; this.state.phase = "completed"; this.state.message = "已到设定时间，学习页面已关闭；平台记录请到官网核对"; }); }, Math.max(0, this.deadline - Date.now()));
    child.send({ action: "start", dir, config, key, options }, error => { if (error && this.worker === child) { this.state.phase = "failed"; this.state.message = "无法初始化自动学习进程"; this.attention(); child.kill(); } });
    return this.status();
  }
  async showWindow() {
    const child = this.worker;
    if (!child?.connected || this.state.phase === 'stopping') throw new Error('当前没有可打开的运行窗口');
    const requestId = crypto.randomUUID();
    return new Promise<{ ok: true }>((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); child.off('message', receive); child.off('exit', exited); };
      const receive = (message: any) => {
        if (message.windowRequest !== requestId) return;
        cleanup();
        if (message.error) reject(new Error(message.error)); else resolve({ ok: true });
      };
      const exited = () => { cleanup(); reject(new Error('运行窗口已关闭')); };
      const timer = setTimeout(() => { cleanup(); reject(new Error('运行窗口未响应，请稍后重试')); }, this.platform === 'unipus' ? 45000 : 8000);
      child.on('message', receive); child.once('exit', exited);
      child.send({ action: 'show', requestId }, error => { if (error) { cleanup(); reject(new Error('无法连接学习进程')); } });
    });
  }
  async progress() {
    const child = this.worker;
    if (!child?.connected || ["starting", "stopping"].includes(this.state.phase)) return this.status();
    const requestId = crypto.randomUUID();
    return new Promise<StudyStatus>((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); child.off("message", receive); child.off("exit", exited); };
      const receive = (message: any) => {
        if (message.progressRequest !== requestId) return;
        cleanup();
        if (message.error) reject(new Error("无法读取当前章节，请检查官方窗口后重试"));
        else { if (this.worker === child && message.status) this.state.progress = message.status.progress; resolve(this.status()); }
      };
      const exited = () => { cleanup(); resolve(this.status()); };
      const timer = setTimeout(() => { cleanup(); reject(new Error("进度查询超时，请检查官方窗口后重试")); }, 10000);
      child.on("message", receive); child.once("exit", exited);
      child.send({ action: "progress", requestId }, error => { if (error) { cleanup(); reject(new Error("无法连接学习进程，请停止后重试")); } });
    });
  }
  private navigating = false;
  private updatingTests = false;
  async setChapterTests(enabled: boolean) {
    const child = this.worker;
    if (!child) return;
    if (!child.connected || this.navigating || this.updatingTests || ['starting','stopping'].includes(this.state.phase)) throw new Error('正在启动、停止或切换章节，请稍后修改章节测试');
    const requestId = crypto.randomUUID();
    this.updatingTests = true;
    try { await new Promise<void>((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); child.off('message', receive); child.off('exit', exited); };
      const receive = (message: any) => { if (message.settingsRequest !== requestId) return; cleanup(); message.error ? reject(new Error(message.error)) : resolve(); };
      const exited = () => { cleanup(); reject(new Error('学习进程已退出，章节测试设置未保存')); };
      const timer = setTimeout(() => { cleanup(); reject(new Error('章节测试设置尚未确认，请稍后重试')); }, 20000);
      child.on('message', receive); child.once('exit', exited);
      child.send({ action: 'chapter-tests', enabled, requestId }, error => { if (error) { cleanup(); reject(new Error('无法连接学习进程')); } });
    }); } finally { this.updatingTests = false; }
  }
  async navigate(direction: "previous" | "next" | "chapter", chapterId?: string, task?: "video" | "quiz") {
    if (this.updatingTests) throw new Error('正在修改章节测试设置，请稍后切换章节');
    const child=this.worker;
    if (!child?.connected || !["running","paused"].includes(this.state.phase) || this.state.operation === "keep-open") throw new Error("当前不能切换章节");
    if (this.navigating) throw new Error("正在切换章节，请稍后操作");
    if (direction === 'chapter') { const chapter = this.state.progress?.chapters.find(c => c.id === chapterId); if (!chapter || chapter.locked) throw new Error('章节未加载或尚未开放，请查询进度后选择'); }
    else if (!this.state.navigation?.[direction]) throw new Error(direction === "next" ? "没有可用的下一节" : "没有可用的上一节");
    this.navigating=true;
    const requestId=crypto.randomUUID();
    try { return await new Promise<StudyStatus>((resolve,reject)=>{
      const cleanup=()=>{clearTimeout(timer);child.off("message",receive);child.off("exit",exited);};
      const receive=(message:any)=>{if(message.navigationRequest!==requestId)return;cleanup();message.error?reject(new Error(message.error)):resolve(this.status());};
      const exited=()=>{cleanup();reject(new Error("学习进程已退出，未确认切换结果"));};
      const timer=setTimeout(()=>{cleanup();this.state.phase="stopping";this.state.message="章节切换超时，正在关闭学习页面";child.kill("SIGTERM");reject(new Error("章节切换未确认，已请求关闭学习页面，请重新启动"));},30000);
      child.on("message",receive);child.once("exit",exited);
      child.send({action:direction,requestId,...(direction === 'chapter' ? {chapterId, ...(task ? {task} : {})} : {})},error=>{if(error){cleanup();reject(new Error("无法连接学习进程"));}});
    }); } finally {this.navigating=false;}
  }
  command(action: "pause" | "resume") {
    if (this.updatingTests && action === 'resume') throw new Error('正在修改章节测试设置，请稍后继续');
    if (this.navigating) throw new Error("正在切换章节，请稍后操作");
    if (!this.worker?.connected) throw new Error("当前没有自动学习任务");
    if (this.state.phase === "starting" || this.state.phase === "stopping") throw new Error("任务正在启动或停止，请稍后操作");
    this.worker.send({ action }); this.state.phase = action === "pause" ? "paused" : "running";
    this.state.message = action === "pause" ? "正在暂停" : "正在继续";
    return this.status();
  }
  async stop() {
    const child = this.worker;
    clearTimeout(this.closeTimer); this.deadline = null;
    if (!child) return this.status();
    this.state.phase = "stopping"; this.state.message = "正在停止并关闭浏览器";
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => child.kill("SIGTERM"), 5000);
      const force = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 9000);
      child.once("exit", () => { clearTimeout(timer); clearTimeout(force); resolve(); });
      if (child.connected) child.send({ action: "stop" }, () => {}); else child.kill("SIGTERM");
    });
    if (this.worker && this.worker !== child) return this.status();
    if (this.worker === child) this.worker = undefined;
    this.state.phase = "stopped"; this.state.message = "自动学习已停止";
    return this.status();
  }
}
