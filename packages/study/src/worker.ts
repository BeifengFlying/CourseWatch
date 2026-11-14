import { canRequestChapterAnswers, enterChapterTask, readChapterTasks, skipCompletedTask } from "./chapter-tasks.js";
import { skipCompletedChapter } from "./completed-chapter.js";
import { chromium, type Browser, type Page } from "playwright";
import { createHash } from "node:crypto";
import { Vault } from "../../adapters/src/vault.js";
import { browserLaunchOptions } from "../../adapters/src/browser.js";
import { initialStudyStatus, officialStudyFrame, studyPageKind, StudyConfig, type StudyStatus, type StudyAnswer } from "../../contracts/src/study.js";
import { openCourse } from "./launch.js";
import { studyWindowOptions, setStudyWindow, showStudyWindow } from "./window.js";
import { watchStudyBrowser, reportStudyFailure } from "./diagnostics.js";
import { readStudyNavigation, switchStudyItem, jumpToStudyChapter } from "./navigation.js";
let navigating = false;
const skippedChecks = new Set<string>();
const prepared = new Set<string>();
let iterationDone: Promise<void> | undefined;
let chapterTests = true, changingTests = false;
import { studyFailureMessage, type StudyFailureStage } from "./errors.js";
let startupStage: StudyFailureStage = "settings";
import { keepPageOpen } from "./keep-open.js";
import { readStudyProgress } from "./progress.js";
import { solveVideoQuizzes, type VideoQuizAttempts } from "./video-quiz.js";
import { answerWithSkills, StudySkills } from "./skills.js";
import { skipStudyCheck } from "./skip-check.js";
import { readQuestions, assertPageAllowed, applyAnswers, submitChapter, mediaTick, pauseMedia, documentStep, documentProgress, nextNativePage, nextNativeTab, selectNativeTab, chapterConfirmedComplete, chapterQuizComplete } from "./page.js";
let browser: Browser | undefined, stopping = false, paused = false, pending = new AbortController();
let status = initialStudyStatus();
const send = () => process.send?.({ status });
function log(message: string) { status.message = message; status.logs = [...status.logs, { at: Date.now(), message }].slice(-100); send(); }
async function stop() { stopping = true; pending.abort(); await browser?.close().catch(() => {}); process.exit(0); }
process.on("SIGTERM", () => void stop());
process.on("disconnect", () => void stop());
process.on("message", async (message: any) => {
  if (message.action === 'chapter-tests') {
    if (changingTests || navigating || typeof message.enabled !== 'boolean') { process.send?.({settingsRequest:message.requestId,error:'正在切换学习设置，请稍后重试'}); return; }
    changingTests = true;
    // Let a submission finish observing its result; cancelling it could hide
    // whether the platform accepted it. Other work can stop before any write.
    if (startupStage !== 'submit') pending.abort();
    try {
      await iterationDone;
      chapterTests = message.enabled;
      if (status.modelActivity && status.modelActivity.phase !== 'completed') status.modelActivity.phase = 'interrupted';
      if (!paused && !stopping) pending = new AbortController();
      process.send?.({settingsRequest:message.requestId});
    } finally { changingTests = false; }
    return;
  }
  if (message.action === "show") {
    try { await showStudyWindow(browser); process.send?.({ windowRequest: message.requestId }); }
    catch { process.send?.({ windowRequest: message.requestId, error: "无法打开运行窗口，窗口可能已关闭" }); }
    return;
  }
  if (message.action === "previous" || message.action === "next" || message.action === "chapter") {
    const page=browser?.contexts()[0]?.pages().filter(p=>!p.isClosed()).at(-1);
    if (!page || navigating || changingTests || status.operation === "keep-open") { process.send?.({navigationRequest:message.requestId,error:"当前不能切换章节"}); return; }
    navigating=true;const wasPaused=paused;paused=true;pending.abort();
    try {
      let waitTimer: ReturnType<typeof setTimeout> | undefined;
      try { await Promise.race([iterationDone, new Promise((_, reject) => { waitTimer = setTimeout(() => reject(new Error("当前操作尚未停止")), 5000); })]); }
      finally { clearTimeout(waitTimer); }
      await pauseMedia(page);
      const changed=message.action === "chapter" ? await jumpToStudyChapter(page,"chaoxing",message.chapterId) : await switchStudyItem(page,"chaoxing",message.action);
      if(changed && message.task && !await enterChapterTask(page, message.task)) throw new Error("未找到所选任务入口");
      if(changed && message.task) prepared.add(message.chapterId);
      if(changed)skippedChecks.clear();
      if(!changed)throw new Error("章节未切换，可能已到目录边界或入口不可用");
      await page.waitForLoadState("domcontentloaded", {timeout: 5000});
      if (wasPaused) await pauseMedia(page);
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
  if (message.action === "pause") {
    paused = true; pending.abort(); if (status.modelActivity && status.modelActivity.phase !== "completed") status.modelActivity.phase = "interrupted"; status.phase = "paused"; log("已暂停，浏览器保留供手动处理");
    for (const context of browser?.contexts() || []) for (const page of context.pages()) await pauseMedia(page);
  }
  if (message.action === "resume") { for (const context of browser?.contexts() || []) for (const page of context.pages()) for (const frame of page.frames()) { const allowed = officialStudyFrame(frame.url()); if (allowed) await frame.locator("video,audio").evaluateAll(nodes => nodes.forEach(n => delete (n as HTMLElement).dataset.coursewatchPlayed)).catch(() => {}); } paused = false; pending = new AbortController(); status.phase = "running"; log("继续检查当前页面"); }
  if (message.action === "start" && !browser) void run(message).catch(async (error) => {
    await reportStudyFailure(error, startupStage, browser?.contexts()[0]?.pages().at(-1)); status.phase = "failed"; log(studyFailureMessage(error, startupStage));
    await browser?.close().catch(() => {}); process.exit(1);
  });
});
async function refreshProgress() {
  const page = browser?.contexts()[0]?.pages().filter(p => !p.isClosed()).at(-1);
  status.progress = page ? await readStudyProgress(page) : null;
  status.navigation = page && status.operation !== "keep-open" ? await readStudyNavigation(page, "chaoxing") : {previous:false,next:false};
  if(status.progress && !status.progress.course)status.progress.course=status.courseName || "";
  send();
}
async function run(message: any) {
  const config = StudyConfig.parse(message.config);
  chapterTests = config.chapterTests;
  if (!config.enabled || !config.noticeVersion || config.answerExercises && (typeof message.key !== "string" || !message.key || !config.model)) throw new Error("not configured");
  startupStage = "session";
  const vault = new Vault(message.dir), session = await vault.read("chaoxing");
  if (!session) throw new Error("no session");
  startupStage = "browser";
  browser = await chromium.launch({ ...await browserLaunchOptions(), ...studyWindowOptions(message.options?.background === true) });
  const context = await browser.newContext({ storageState: session, acceptDownloads: false, viewport: { width: 1220, height: 850 } });
  watchStudyBrowser(context);
  startupStage = "course";
  let launchIssue = "";
  try { await openCourse(context, "chaoxing", message.options?.course, message.options?.operation === "keep-open", message.options?.chapterId ? {chapterId:message.options.chapterId} : message.options?.position); }
  catch (error) {
    await reportStudyFailure(error, startupStage, context.pages().at(-1));
    if (!context.pages().length) throw error;
    paused = true; launchIssue = studyFailureMessage(error, startupStage);
  }
  if (message.options?.background) for (const page of context.pages()) await setStudyWindow(page, true).catch(() => {});
  startupStage = "running";
  status = { ...initialStudyStatus(), phase: launchIssue ? "paused" : "running", startedAt: Date.now(), operation: message.options?.operation || "play", courseName: message.options?.course?.name || "" };
  log(launchIssue || (message.options?.course ? "已打开所选课程，正在读取当前章节" : "请在官方窗口选择课程并打开章节"));
  if (launchIssue) log(launchIssue);
  if (message.options?.operation === "keep-open") {
    await keepPageOpen(context, "chaoxing", status, send, () => stopping);
    await stop(); return;
  }
  const skills = new StudySkills(message.dir, "chaoxing");
  const cache = new Map<string, StudyAnswer>();
  const submitted = new Set<string>(), attempted = new Set<string>();
  const pendingSubmissions = new Set<string>();
  const videoAttempts: VideoQuizAttempts = new Map();
  const solveCurrentVideoQuiz = async (page: Page, signal: AbortSignal) => await solveVideoQuizzes(page, videoAttempts, signal, log);
  let explicitTask = message.options?.task as "video" | "quiz" | undefined;
  let progressAt = Date.now(), lastDocumentStep = 0, lastProgressRead = 0;
  const observations = new Map<string, string>();
  const pause = async (text: string, page?: Page) => { paused = true; pending.abort(); if (status.modelActivity && status.modelActivity.phase !== "completed") status.modelActivity.phase = "interrupted"; status.phase = "paused"; log(text); if (page) await pauseMedia(page); };
  const progress = (key: string, value = "seen") => { if (observations.get(key) !== value) { observations.set(key, value); progressAt = Date.now(); if (observations.size > 1000) observations.delete(observations.keys().next().value!); } };
  studyLoop: while (!stopping && browser.isConnected()) {
    await new Promise(resolve => setTimeout(resolve, 1500));
    if (Date.now() - lastProgressRead >= 2000) {
      try { await refreshProgress(); } catch { status.progress = null; send(); }
      lastProgressRead = Date.now();
    }
    if (paused || navigating || changingTests) { progressAt = Date.now(); continue; }
    const pages = context.pages().filter(p => !p.isClosed());
    const page = pages.at(-1);
    if (!page) break;
    const signal = pending.signal;
    let finishIteration!: () => void;
    iterationDone = new Promise(resolve => { finishIteration = resolve; });
    try {
      startupStage = "running";
      const kind = studyPageKind(page.url());
      if (kind === "exam" || kind === "login") { await assertPageAllowed(page); continue; }
      if (!await assertPageAllowed(page, config.playMedia)) { progressAt = Date.now(); continue; }
      const chapter = (await readStudyProgress(page))?.chapterId;
      if (kind === 'chapter' && chapter && !prepared.has(chapter)) {
        if (explicitTask || status.operation === 'answers') {
          if (!await enterChapterTask(page, explicitTask || 'quiz', signal)) {
            if (explicitTask) throw new Error('未找到所选任务入口，请在官方窗口核对栏目');
            if (await switchStudyItem(page, 'chaoxing', 'next', signal)) continue;
            status.phase = 'completed'; log('目录中未找到可进入的章节检测，本轮结束'); break;
          }
        } else {
          const first = (await readChapterTasks(page)).find(t => !t.locked && t.complete !== true && (chapterTests || t.kind !== 'quiz'));
          if (first?.tabId && !first.current) await selectNativeTab(page, first.tabId, signal);
        }
        prepared.add(chapter); explicitTask = undefined;
      }
      const completed = await skipCompletedChapter(page, 'chaoxing', signal);
      if (completed === 'end') { status.phase = 'completed'; log('当前章节已完成，未找到可进入的下一节，本轮结束'); break; }
      if (completed === 'skipped') { progressAt = Date.now(); log('平台标记当前章节已完成，已跳过'); continue; }
      if (kind === 'chapter' && await skipCompletedTask(page, signal)) { progressAt = Date.now(); log('当前任务已完成，已进入后续未完成任务'); continue; }
      const taskSnapshot = kind === 'chapter' ? await readChapterTasks(page) : [];
      if (status.operation === 'play' && !chapterTests) for (const frame of page.frames()) {
        if (pendingSubmissions.has(JSON.stringify([page.url(),frame.url()])) && !await chapterQuizComplete(frame)) throw new Error('当前章节曾尝试提交但结果待核实，请在平台确认后继续');
      }
      if (status.operation === 'play' && !chapterTests && taskSnapshot.some(t => t.current && t.kind === 'quiz')) {
        if (await skipStudyCheck(page, 'chaoxing', signal)) { log('章节测试已关闭，已跳过当前测试；测试仍为未完成'); progressAt = Date.now(); continue; }
        status.phase = 'completed'; log('章节测试已关闭，未找到可进入的后续内容，本轮结束'); break;
      }
      const currentTaskComplete = taskSnapshot.some(t => t.current && t.complete === true);
      if (currentTaskComplete) {
        const at = taskSnapshot.findIndex(t => t.current);
        if (taskSnapshot.slice(at+1).some(t => t.complete !== true && t.locked)) throw new Error('后续任务尚未开放，请在官网核对');
        if (await nextNativePage(page, signal)) { progressAt = Date.now(); continue; }
        status.phase = 'completed'; log('当前任务已完成，未找到可进入的后续任务，本轮结束'); break;
      }
      if (config.playMedia && await solveCurrentVideoQuiz(page, signal)) { progress("video-quiz", String(Date.now())); continue; }
      const expectedURL = page.url(); progress("page", expectedURL);
      const frames = page.frames().filter(f => officialStudyFrame(f.url()));
      let foundQuestions = false, working = false, pageReady = false;
      const answersReady = kind !== 'chapter' || await canRequestChapterAnswers(page,taskSnapshot);
      for (const frame of answersReady ? frames : []) {
        startupStage = "questions";
        // Without a model, only detect the quiz so the existing native skip
        // path remains available even when its replacement font is unreadable.
        const answerEnabled = config.answerExercises && (status.operation !== 'play' || chapterTests);
        const questions = await readQuestions(frame, answerEnabled);
        if (!questions.length) continue;
        foundQuestions = true;
        if (!answerEnabled) {
          // A video popup can appear after the first check in this iteration.
          if (config.playMedia && await solveCurrentVideoQuiz(page, signal)) { working = true; break; }
          if (kind === "homework") throw new Error("当前是课程作业，未配置模型，请手动处理");
          const check = JSON.stringify([page.url(), frame.url(), questions]);
          if (skippedChecks.has(check)) throw new Error("检测页面未切换，已暂停；请检查下一节是否开放");
          skippedChecks.add(check);
          if (!await skipStudyCheck(page, "chaoxing", signal)) throw new Error("未配置模型，检测未作答；没有可用的下一节，请在官网处理");
          log(chapterTests ? "未配置模型，已跳过当前检测；该检测保留未完成状态" : "章节测试已关闭，已跳过当前测试；测试仍为未完成");
          progressAt = Date.now(); continue studyLoop;
        }
        if (questions.length > 100 || new Set(questions.map(q => q.id)).size !== questions.length || questions.some(q => !q.stem || q.stem.length >= 16000 || !q.slots || (["single", "multiple", "judge"].includes(q.type) && (q.options.length < 2 || q.options.some(o => !o))))) throw new Error("题目、选项或输入框无法完整识别，已暂停；请手动处理");
        const signature = createHash("sha256").update(JSON.stringify([expectedURL, frame.url(), questions])).digest("hex");
        progress(signature);
        if (attempted.has(signature) && !submitted.has(signature)) throw new Error("当前章节曾尝试提交但结果待核实，请在平台确认，程序不会重复提交");
        if (submitted.has(signature)) { pageReady = kind !== "homework"; continue; }
        const answerList: string[][] = [];
        for (const [index, question] of questions.entries()) {
          if (paused || stopping || signal.aborted) break;
          const key = `${signature}:${question.id}`;
          let result = cache.get(key);
          if (!result) {
            if (kind === 'chapter' && !await canRequestChapterAnswers(page)) continue studyLoop;
            if (status.requests >= config.questionLimit) throw new Error("已达到本轮模型请求上限；请停止后调整上限或开始新任务");
            status.requests++; log(`正在分析第 ${index + 1}／${questions.length} 题（${kind === "homework" ? "课程作业，仅生成答案" : "章节测验"}）`);
            let image: string | undefined;
            if (config.images) {
              const png = await frame.locator(`[data-coursewatch-question="${index}"]`).screenshot({ timeout: 10000 });
              if (png.length > 3 * 1024 * 1024) throw new Error("题目截图超过大小上限，请手动处理");
              image = `data:image/png;base64,${png.toString("base64")}`;
            }
            startupStage = "model";
            status.modelActivity = {question:index + 1,total:questions.length,phase:'requesting',reasoning:'',answer:'',updatedAt:Date.now()}; send();
            const output = await answerWithSkills(config, message.key, question, signal, image, skills, log, fetch, update => {
              if (signal.aborted) return;
              status.modelActivity = {question:index + 1,total:questions.length,phase:update.answer ? 'answering' : 'thinking',...update,updatedAt:Date.now()}; send();
            }, () => {
              if (status.requests >= config.questionLimit) throw new Error("已达到本轮模型请求上限；请停止后调整上限或开始新任务");
              status.requests++;
            });
            if (status.modelActivity) status.modelActivity.phase = 'completed';
            if (paused || stopping || signal.aborted) break;
            status.inputTokens += output.inputTokens; status.outputTokens += output.outputTokens;
            result = { id: key, stem: question.stem, answers: output.answers, explanation: output.explanation, mode: kind === "homework" ? "homework" : "chapter", options: ["single", "multiple", "judge"].includes(question.type) ? question.options : [] };
            cache.set(key, result); status.answers = [...status.answers, result].slice(-100); send();
          }
          answerList.push(result.answers);
        }
        if (paused || stopping || signal.aborted) break;
        if (page.url() !== expectedURL || JSON.stringify(await readQuestions(frame)) !== JSON.stringify(questions)) throw new Error("模型返回期间题目发生变化，未填入或提交");
        if (kind === "homework") { submitted.add(signature); log("课程作业答案已生成，请在 CourseWatch 查看并手动填入、提交"); continue; }
        if (!config.autoSubmitPractice) { submitted.add(signature); throw new Error("答案已生成，请在 CourseWatch 查看并在官网手动填入、提交"); }
        startupStage = "fill";
        await applyAnswers(page, frame, questions, answerList, expectedURL, signal);
        if (paused || stopping || signal.aborted) break;
        // Mark before attempting: a timeout after clicking must never cause a duplicate submission.
        attempted.add(signature);
        const submissionKey = JSON.stringify([expectedURL,frame.url()]);
        pendingSubmissions.add(submissionKey);
        startupStage = "submit";
        await submitChapter(page, frame, expectedURL, questions, signal);
        pendingSubmissions.delete(submissionKey);
        submitted.add(signature);
        pageReady = true; log("平台已显示章节测验提交结果"); progress(`${signature}:submitted`);
      }
      if (paused || stopping || signal.aborted || kind === "homework") continue;
      for (const frame of frames) {
        if (paused || stopping || signal.aborted) break;
        if (await chapterQuizComplete(frame)) pageReady = true;
        const media = config.playMedia ? await mediaTick(frame) : { kind: "none" };
        if (media.kind === "error") throw new Error("播放器报告错误，请在官方窗口处理后继续");
        if (media.kind === "playing") { working = true; progress(`media:${frame.url()}`, String(Math.floor(media.progress || 0))); }
        if (media.kind === "ended") pageReady = true;
        if (config.playMedia) {
          const advance = Date.now() - lastDocumentStep >= config.pageSeconds * 1000;
          const document = await documentStep(frame, advance);
          if (document === "next") { working = true; if (advance) { progress(`document:${frame.url()}`, await documentProgress(frame)); lastDocumentStep = Date.now(); } }
          if (document === "last") pageReady = true;
          if (document === "unknown") throw new Error("文档阅读器尚未适配，不能确认末页，请手动处理后继续");
        }
      }
      if (paused || stopping || signal.aborted) continue;
      if (!working && pageReady && await nextNativeTab(page, signal)) { log("当前页面处理结束，已通过原生栏目进入下一页；完成状态仍以平台为准"); progress("tab", await page.locator("#prev_tab .active,#prev_tab [aria-selected=true]").first().getAttribute("id") || "unknown"); continue; }
      if (await chapterConfirmedComplete(page)) {
        if (await nextNativePage(page, signal)) { log("当前章节平台状态为已完成，已通过原生入口翻页或进入下一章"); progress("navigation", page.url()); }
        else { status.phase = "completed"; log("当前章节已完成，未找到可进入的下一章；本轮结束，请核对课程目录"); break; }
      } else if (!working && !foundQuestions && Date.now() - progressAt > 45000 || Date.now() - progressAt > 120000) {
        throw new Error("当前任务进度或平台完成状态尚未确认，已暂停；请在官方窗口处理后继续");
      }
    } catch (error) {
      if (signal.aborted) continue;
      if (stopping) break;
      if (status.modelActivity && status.modelActivity.phase !== "completed") status.modelActivity.phase = "interrupted";
      await reportStudyFailure(error, startupStage, page);
      if (!paused) await pause(error instanceof Error && !/fetch failed|TimeoutError|page\.|frame\.|browser\.|locator\.|Target/.test(error.message) ? error.message.slice(0, 250) : studyFailureMessage(error, startupStage), page);
    } finally { finishIteration(); iterationDone = undefined; }
  }
  await browser.close().catch(() => {});
  if (status.phase !== "completed") { status.phase = "stopped"; log("浏览器已关闭，自动学习已停止"); }
  process.exit(0);
}
