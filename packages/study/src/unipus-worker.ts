import { unipusBrowserState, trackUnipusSession } from "./unipus-session.js";
import { skipCompletedChapter } from "./completed-chapter.js";
import { type Browser, type Page } from "playwright";
import { createHash } from "node:crypto";
import { Vault } from "../../adapters/src/vault.js";
import { browserLaunchOptions } from "../../adapters/src/browser.js";
import { initialStudyStatus, StudyConfig, UNIPUS_STUDY_NOTICE_VERSION, type StudyAnswer } from "../../contracts/src/study.js";
import { openCourse } from "./launch.js";
import { showStudyWindow } from "./window.js";
import { UnipusWindow } from "./unipus-window.js";
import { watchStudyBrowser, reportStudyFailure } from "./diagnostics.js";
import { readStudyNavigation, switchStudyItem, jumpToStudyChapter } from "./navigation.js";
let navigating = false;
const skippedChecks = new Set<string>();
let iterationDone: Promise<void> | undefined;
import { studyFailureMessage, type StudyFailureStage } from "./errors.js";
let startupStage: StudyFailureStage = "settings";
import { keepUnipusActive, releaseUnipusActivity } from "./unipus-activity.js";
import { keepPageOpen } from "./keep-open.js";
import { answerWithSkills, StudySkills } from "./skills.js";
import { readStudyChapters } from './chapter-directory.js';
import { skipStudyCheck } from "./skip-check.js";
import { StudyTiming } from "./timing.js";
import { unipusFrames, unipusQuestionMode, readUnipusQuestions, pauseUnipusMedia, playUnipusMedia, applyUnipusAnswers, submitUnipusPractice, nextUnipusItem, readUnipusProgress } from "./unipus-page.js";
let sessionTracker: ReturnType<typeof trackUnipusSession> | undefined;
let windowSession: UnipusWindow | undefined, backgroundRun = false, switchingWindow = false, sessionDir = '';
let controlRevision = 0;
let windowChange = new AbortController();
let browser: Browser | undefined, stopping = false, paused = false, starting = false;
let pending = new AbortController(), status = initialStudyStatus(), targetMinutes = 0;
const timing = new StudyTiming();
const send = () => { status.timing = timing.snapshot(targetMinutes); process.send?.({ status }); };
const log = (message: string) => { status.message = message; status.logs = [...status.logs, { at: Date.now(), message }].slice(-100); send(); };
const currentPage = () => browser?.contexts()[0]?.pages().filter(p => !p.isClosed()).at(-1);
async function pauseAll() { for (const c of browser?.contexts() || []) for (const p of c.pages()) { await releaseUnipusActivity(p); await pauseUnipusMedia(p); } }
async function pause(message: string) { paused = true; pending.abort(); timing.reset(); status.phase = "paused"; log(message); await pauseAll(); }
async function stop() { stopping = true; controlRevision++; pending.abort(); windowChange.abort(); timing.reset(); await sessionTracker?.stop().catch(() => {}); await browser?.close().catch(() => {}); process.exit(0); }
async function switchWindow(background: boolean) {
  if (!windowSession || switchingWindow || navigating || status.phase === 'starting' || stopping) throw new Error('正在启动、停止或切换页面，请稍后重试');
  switchingWindow = true; windowChange = new AbortController();
  try {
    await pause(background ? '正在转回后台运行' : '已暂停自动操作，正在打开官网页面');
    await iterationDone;
    windowChange.signal.throwIfAborted();
    await sessionTracker?.stop();
    const oldContext = windowSession.context;
    // Compare a refresh in the replacement page with the last saved session,
    // rather than treating the newly refreshed token as the original baseline.
    const sessionBaseline = await oldContext!.storageState({indexedDB:true});
    try { await windowSession.switchMode(background, windowChange.signal); }
    finally {
      browser = windowSession.browser;
      if (!stopping && windowSession.context) {
        sessionTracker = trackUnipusSession(windowSession.context, new Vault(sessionDir), sessionBaseline);
        if (windowSession.context !== oldContext) watchStudyBrowser(windowSession.context);
      }
    }
    windowChange.signal.throwIfAborted();
    await pauseAll();
    log(background ? '已转回后台页面' : '已打开官网页面，自动操作保持暂停；继续后转回后台运行');
  } finally { switchingWindow = false; }
}
async function decorateProgress(progress: typeof status.progress, page: Page) {
  if (!progress) return;
  const chapters = await readStudyChapters(page, 'unipus'), selected = chapters.filter(c => c.current);
  if (chapters.length) progress.chapters = chapters.map(({id,name,complete,locked,path}) => ({id,name,complete,locked,...(path ? {path} : {})}));
  if (selected.length === 1) { progress.chapterId = selected[0].id; progress.chapter = selected[0].name; progress.chapterComplete = selected[0].complete ?? progress.chapterComplete; }
}
async function refreshProgress() { const p = currentPage(); status.progress = p ? (await readUnipusProgress(p)).progress : null; if(p)await decorateProgress(status.progress,p); status.navigation=p&&status.operation!=="keep-open"?await readStudyNavigation(p,"unipus"):{previous:false,next:false}; if(status.progress&&!status.progress.course)status.progress.course=status.courseName||""; send(); }
process.on("SIGTERM", () => void stop());
process.on("disconnect", () => void stop());
process.on("message", async (message: any) => {
  if (message.action === "show") {
    try {
      if (switchingWindow) throw new Error('正在切换窗口');
      controlRevision++;
      if (windowSession?.background) await switchWindow(false);
      await showStudyWindow(browser); process.send?.({ windowRequest: message.requestId });
    }
    catch { process.send?.({ windowRequest: message.requestId, error: "无法打开运行窗口，任务保持暂停；请稍后重试或停止后重新开始" }); }
    return;
  }
  if (message.action === "previous" || message.action === "next" || message.action === "chapter") {
    const page=browser?.contexts()[0]?.pages().filter(p=>!p.isClosed()).at(-1);
    if (!page || navigating || switchingWindow || status.operation === "keep-open") { process.send?.({navigationRequest:message.requestId,error:"当前不能切换章节"}); return; }
    controlRevision++;navigating=true;const wasPaused=paused;paused=true;pending.abort();
    try {
      let waitTimer: ReturnType<typeof setTimeout> | undefined;
      try { await Promise.race([iterationDone, new Promise((_, reject) => { waitTimer = setTimeout(() => reject(new Error("当前操作尚未停止")), 5000); })]); }
      finally { clearTimeout(waitTimer); }
      await pauseUnipusMedia(page); timing.reset();
      const changed=message.action === "chapter" ? await jumpToStudyChapter(page,"unipus",message.chapterId) : await switchStudyItem(page,"unipus",message.action);
      if(changed)skippedChecks.clear();
      if(!changed)throw new Error("章节未切换，可能已到目录边界或入口不可用");
      await page.waitForLoadState("domcontentloaded", {timeout: 5000});
      if (wasPaused) await pauseAll();
      pending=new AbortController();paused=wasPaused;status.phase=wasPaused?"paused":"running";
      await refreshProgress().catch(()=>{status.progress=null;status.navigation={previous:false,next:false};});
      log(message.action === "chapter" ? "已切换到所选章节" : message.action === "next" ? "已切换到下一节" : "已切换到上一节");
      process.send?.({navigationRequest:message.requestId});
    } catch {
      status.phase="paused";paused=true;log("未确认章节切换结果，已暂停，请检查官方页面后继续");
      process.send?.({navigationRequest:message.requestId,error:status.message});
    } finally {navigating=false;}
    return;
  }
  if (message.action === "progress") {
    try { await refreshProgress(); process.send?.({ progressRequest: message.requestId, status }); }
    catch { process.send?.({ progressRequest: message.requestId, error: true }); }
    return;
  }
  if (message.action === "stop") return void stop();
  if (message.action === "pause") { controlRevision++; windowChange.abort(); return void pause("已暂停，浏览器保留供手动处理"); }
  if (message.action === "resume" && browser) {
    if (switchingWindow || navigating || stopping) { send(); return; }
    const revision = ++controlRevision;
    try {
      if (backgroundRun && !windowSession?.background) await switchWindow(true);
      if (stopping || revision !== controlRevision) return;
      for (const context of browser.contexts()) for (const page of context.pages()) for (const frame of page.frames()) { const allowed = frame.url().startsWith("https://ucontent.unipus.cn/"); if (allowed) await frame.locator("video,audio").evaluateAll(nodes => nodes.forEach(n => delete (n as HTMLElement).dataset.coursewatchPlayed)).catch(() => {}); }
      if (stopping || revision !== controlRevision) return;
      timing.reset(); pending = new AbortController(); paused = false; status.phase = "running"; log("继续检查当前 U校园页面");
    } catch { if (!stopping) await pause('未能转回后台，自动操作保持暂停；请重试或停止后重新开始'); }
  }
  if (message.action === "start" && !starting) {
    starting = true;
    void run(message).catch(async (error) => { await reportStudyFailure(error, startupStage, browser?.contexts()[0]?.pages().at(-1)); status.phase = "failed"; log(studyFailureMessage(error, startupStage)); await sessionTracker?.stop().catch(() => {}); await browser?.close().catch(() => {}); process.exit(1); });
  }
});
async function run(message: any) {
  const config = StudyConfig.parse(message.config);
  if (!config.enabled || config.noticeVersion !== UNIPUS_STUDY_NOTICE_VERSION || config.answerExercises && (typeof message.key !== "string" || !message.key || !config.model)) throw new Error("not configured");
  targetMinutes = config.targetMinutes;
  startupStage = "session";
  const session = await new Vault(message.dir).read("unipus");
  if (!session) throw new Error("no session");
  startupStage = "browser";
  backgroundRun = message.options?.background === true; sessionDir = message.dir;
  windowSession = new UnipusWindow(await browserLaunchOptions(), backgroundRun);
  await windowSession.start(unipusBrowserState(session));
  browser = windowSession.browser!;
  const context = windowSession.context!;
  sessionTracker = trackUnipusSession(context,new Vault(message.dir),session);
  watchStudyBrowser(context);
  startupStage = "course";
  let launchIssue = "";
  try { await openCourse(context, "unipus", message.options?.course, false, message.options?.chapterId ? {chapterId:message.options.chapterId} : message.options?.position); }
  catch (error) {
    await reportStudyFailure(error, startupStage, context.pages().at(-1));
    if (!context.pages().length) throw error;
    paused = true; launchIssue = studyFailureMessage(error, startupStage);
  }
  await sessionTracker.flush().catch(() => {});
  startupStage = "running";
  status = { ...initialStudyStatus(), phase: launchIssue ? "paused" : "running", startedAt: Date.now(), operation: message.options?.operation || "play", courseName: message.options?.course?.name || "" };
  log(launchIssue || (message.options?.course ? "已打开所选教程，正在读取当前学习页" : "请在官方窗口选择教程和学习页"));
  if (launchIssue) log(launchIssue);
  if (message.options?.operation === "keep-open") {
    await keepPageOpen(() => windowSession!.context!, "unipus", status, send, () => stopping, () => pending.signal, work => { iterationDone = work; });
    await stop(); return;
  }
  const skills = new StudySkills(message.dir, "unipus");
  const cache = new Map<string, StudyAnswer>(), attempted = new Set<string>(), submitted = new Set<string>(), reviewed = new Set<string>(), advanced = new Set<string>();
  let lastActivity = performance.now(), previousObservation = "", pageIdentity = "";
  studyLoop: while (!stopping && browser.isConnected()) {
    await new Promise(resolve => setTimeout(resolve, 2500));
    if (paused || navigating) { lastActivity = performance.now(); continue; }
    const page = currentPage();
    if (!page) break;
    const signal = pending.signal;
    let finishIteration!: () => void;
    iterationDone = new Promise(resolve => { finishIteration = resolve; });
    try {
      await keepUnipusActive(page, signal);
      const frames = await unipusFrames(page);
      const identity = JSON.stringify([page.url(), frames.map(f => f.url())]);
      if (identity !== pageIdentity) { timing.reset(); lastActivity = performance.now(); pageIdentity = identity; }
      if (!frames.length) {
        status.progress = null; send(); timing.reset();
        if (performance.now() - lastActivity > 120000) throw new Error("未读到支持的教程内容，请打开学习任务后继续");
        continue;
      }
      const snapshot = await readUnipusProgress(page);
      status.progress = snapshot.progress;
      await decorateProgress(status.progress,page);
      status.navigation = await readStudyNavigation(page,"unipus");
      if(status.progress&&!status.progress.course)status.progress.course=status.courseName||"";
      timing.observe(performance.now(), snapshot.activity);
      const observation = JSON.stringify([snapshot.progress?.chapter, snapshot.progress?.chapterComplete, snapshot.progress?.media.map(m => [Math.floor(m.current), m.ended])]);
      if (observation !== previousObservation || snapshot.activity.reading) { lastActivity = performance.now(); previousObservation = observation; }
      send();
      signal.throwIfAborted();
      if (timing.reached(targetMinutes)) { await pauseAll(); status.phase = "completed"; log("已达到本轮本机计时目标，请到官网核对学习记录"); break; }
      const completed = await skipCompletedChapter(page, 'unipus', signal);
      if (completed === 'end') { status.phase = 'completed'; log('当前章节已完成，未找到可进入的下一节，本轮结束'); break; }
      if (completed === 'skipped') { timing.reset(); lastActivity = performance.now(); log('平台标记当前章节已完成，已跳过'); continue; }
      let foundQuestions = false, confirmedSubmission = false;
      for (const frame of frames) {
        signal.throwIfAborted();
        const questions = await readUnipusQuestions(frame);
        if (!questions.length) continue;
        foundQuestions = true;
        await pauseAll(); timing.reset();
        if (!config.answerExercises) {
          if (await unipusQuestionMode(page.mainFrame()) === "homework" || await unipusQuestionMode(frame) === "homework") throw new Error("当前是课程作业，未配置模型，请手动处理");
          const check = JSON.stringify([page.url(), frame.url(), questions]);
          if (skippedChecks.has(check)) throw new Error("检测页面未切换，已暂停；请检查下一节是否开放");
          skippedChecks.add(check);
          if (!await skipStudyCheck(page, "unipus", signal)) throw new Error("未配置模型，检测未作答；没有可用的下一节，请在官网处理");
          timing.reset(); lastActivity = performance.now();
          log("未配置模型，已跳过当前检测；该检测保留未完成状态"); continue studyLoop;
        }
        if (questions.length > 100 || new Set(questions.map(q => q.id)).size !== questions.length || questions.some(q => !q.stem || q.stem.length >= 16000 || !q.slots || q.slots > 30 || q.options.length > 100 || q.options.some(o => !o) || ["single", "multiple", "judge"].includes(q.type) && q.options.length < 2)) throw new Error("题干、选项或输入框识别不完整，请手动处理");
        const expectedURL = page.url(), expectedFrameURL = frame.url(), mode = await unipusQuestionMode(page.mainFrame()) === "homework" ? "homework" : await unipusQuestionMode(frame);
        const signature = createHash("sha256").update(JSON.stringify([expectedURL, frame.url(), mode, questions])).digest("hex");
        if (attempted.has(signature) && !submitted.has(signature)) throw new Error("该练习的提交结果待核实，程序不会重复提交，请在官网确认");
        if (submitted.has(signature)) { confirmedSubmission = true; continue; }
        if (reviewed.has(signature)) throw new Error("答案已生成，请在 CourseWatch 查看并在官网手动处理；当前题目不会重复请求模型");
        const answers: string[][] = [];
        for (const [i, question] of questions.entries()) {
          signal.throwIfAborted();
          const key = `${signature}:${question.id}`;
          let answer = cache.get(key);
          if (!answer) {
            if (status.requests >= config.questionLimit) throw new Error("已达到本轮模型请求上限，请停止后调整设置");
            status.requests++; log(`正在生成第 ${i + 1}／${questions.length} 题答案`);
            let image: string | undefined;
            if (config.images) {
              const png = await frame.locator(`[data-coursewatch-unipus-question="${i}"]`).screenshot({ timeout: 10000 });
              if (png.length > 3 * 1024 * 1024) throw new Error("题目截图超过大小上限，请手动处理");
              image = `data:image/png;base64,${png.toString("base64")}`;
            }
            status.modelActivity = {question:i + 1,total:questions.length,phase:'requesting',reasoning:'',answer:'',updatedAt:Date.now()}; send();
            const output = await answerWithSkills(config, message.key, question, signal, image, skills, log, fetch, update => {
              if (signal.aborted) return;
              status.modelActivity = {question:i + 1,total:questions.length,phase:update.answer ? 'answering' : 'thinking',...update,updatedAt:Date.now()}; send();
            }, () => {
              if (status.requests >= config.questionLimit) throw new Error("已达到本轮模型请求上限，请停止后调整设置");
              status.requests++;
            });
            if (status.modelActivity) status.modelActivity.phase = 'completed';
            signal.throwIfAborted();
            status.inputTokens += output.inputTokens; status.outputTokens += output.outputTokens;
            answer = { id: key, stem: question.stem, answers: output.answers, explanation: output.explanation, mode, options: question.options };
            cache.set(key, answer); status.answers = [...status.answers, answer].slice(-100); send();
          }
          answers.push(answer.answers);
        }
        signal.throwIfAborted();
        if (mode === "homework" || !config.autoSubmitPractice) { reviewed.add(signature); throw new Error("答案已生成，请在 CourseWatch 核对并在官网手动填入、提交"); }
        await applyUnipusAnswers(page, frame, questions, answers, expectedURL, signal, expectedFrameURL);
        attempted.add(signature); // A click with an ambiguous result must never be retried.
        await submitUnipusPractice(page, frame, questions, expectedURL, signal, expectedFrameURL);
        submitted.add(signature); confirmedSubmission = true; lastActivity = performance.now();
        log("官方页面已显示练习提交成功，请自行核对答案与成绩");
      }
      signal.throwIfAborted();
      const media = !foundQuestions && config.playMedia ? await playUnipusMedia(page) : "none";
      signal.throwIfAborted();
      const advanceIdentity = JSON.stringify([identity, observation, snapshot.activity.media.map(m => m.id)]);
      const ready = confirmedSubmission || snapshot.progress?.chapterComplete === true || media === "ended";
      if (ready && media !== "playing" && !advanced.has(advanceIdentity)) {
        advanced.add(advanceIdentity);
        if (await nextUnipusItem(page, snapshot.progress?.chapterComplete === true)) { timing.reset(); lastActivity = performance.now(); log("已通过页面可用的下一项按钮继续，完成记录以官网为准"); }
        else { status.phase = "completed"; log("当前任务处理结束，未找到可用的下一项入口，请核对官网记录"); break; }
      }
      if (performance.now() - lastActivity > 120000) throw new Error("两分钟未观察到播放、阅读或任务变化，请检查官方窗口后继续");
    } catch (error) {
      if (signal.aborted) continue;
      if (stopping) break;
      if (status.modelActivity && status.modelActivity.phase !== "completed") status.modelActivity.phase = "interrupted";
      await reportStudyFailure(error, "running", page);
      if (!paused) await pause(error instanceof Error && !/fetch failed|TimeoutError|page\.|browser\.|locator\.|Target|AbortError/.test(error.message) ? error.message.slice(0, 250) : (config.answerExercises ? "页面操作或模型请求未完成，请检查官方窗口后继续" : "页面操作未完成，请检查官方窗口后继续"));
    } finally { finishIteration(); iterationDone = undefined; }
  }
  await sessionTracker?.stop().catch(() => {});
  await browser.close().catch(() => {});
  if (status.phase !== "completed") { status.phase = "stopped"; log("U校园窗口已关闭，自动学习已停止"); }
  process.exit(0);
}
