import type { Page, Frame, Dialog } from "playwright";
import { unipusPageKind, unipusStudyFrame, validateStudyAnswer, type StudyQuestion, type StudyProgress } from "../../contracts/src/study.js";
import type { ActivitySample } from "./timing.js";
import { unipusChoiceSelector, unipusQuestionSelector, unipusQuestionSnapshot } from './unipus-questions.js';
import { unipusDirectorySnapshot } from './unipus-directory.js';
import { visibleFrame } from './visible-frame.js';
const examWords = /考试|测评|期中|期末|\bexam\b|assessment/i;
export async function dismissUnipusLearningNotice(frame: Frame) {
  if (!unipusStudyFrame(frame.url())) return;
  const notice = frame.locator('.system-info-cloud-modal').filter({visible:true});
  if (await notice.count() !== 1) return;
  const content = (await notice.innerText()).replace(/\s+/g,'').replace(/^[!！]/,'');
  // This native informational dialog states the unit's time/required strategy.
  // Agreements, identity prompts and unrecognized messages remain manual.
  if (!/^本单元学习时间[:：](?:无限制|[\d年月日至开始截止:：/—–\-.]+)是否必修[:：](?:必修|非必修)我知道了$/.test(content)) return;
  const button = notice.locator('button.system-info-cloud-ok-button').filter({hasText:/^我知道了$/});
  if (await button.count() === 1 && await button.isEnabled()) {
    await button.click({timeout:3000});
    await notice.waitFor({state:'hidden',timeout:3000});
  }
}
export async function unipusFrames(page: Page, allowIdleConfirmation = false): Promise<Frame[]> {
  if (page.isClosed()) throw new Error("U校园窗口已关闭");
  const top = new URL(page.url()), kind = unipusPageKind(page.url());
  if (kind === "exam") throw new Error("考试或测评页面不在自动学习范围内");
  if (kind === "login") throw new Error("U校园登录已失效，请在官方窗口处理");
  if (top.protocol !== "https:" || top.username || top.password || top.port || !['uai.unipus.cn', 'ucontent.unipus.cn'].includes(top.hostname)) return [];
  for (const frame of page.frames()) {
    const frameKind = unipusPageKind(frame.url());
    if (frameKind === 'exam' || frameKind === 'login') throw new Error("页面包含考试、测评或登录窗口，请手动处理");
  }
  const frames = page.frames().filter(f => unipusStudyFrame(f.url())).slice(0, 30);
  for (const frame of [page.mainFrame(), ...frames.filter(f => f !== page.mainFrame())]) {
    const blocked = await frame.locator('.geetest_panel,.yidun_popup,.captcha-container,[data-captcha],.face-recognition,[data-face-verification]').filter({ visible: true }).count();
    if (blocked) throw new Error("平台要求人工验证，请在官方窗口处理后继续");
    await dismissUnipusLearningNotice(frame);
    const dialogs = await frame.locator('[role="dialog"]:visible,.el-dialog:visible,.modal:visible,.ant-modal:visible').allTextContents();
    if (dialogs.some(text => /人脸|验证码|验证身份|身份验证|安全验证|本人|认证|captcha/i.test(text) || !allowIdleConfirmation && /长时间未操作|继续学习|长时间未学习|学习超时|学习已暂停/.test(text))) throw new Error("平台要求本人确认或验证，请手动处理后继续");
    const headings = await frame.locator('h1:visible,h2:visible,.page-title:visible,.paper-title:visible,.task-type:visible').allTextContents();
    if (headings.some(text => examWords.test(text))) throw new Error("考试或测评页面不在自动学习范围内");
  }
  if (examWords.test(await page.title())) throw new Error("考试或测评页面不在自动学习范围内");
  return frames;
}
export async function unipusQuestionMode(frame: Frame): Promise<'practice' | 'homework'> {
  const route = decodeURIComponent(new URL(frame.url()).pathname + new URL(frame.url()).search + new URL(frame.url()).hash);
  const labels = await frame.locator('h1:visible,h2:visible,.page-title:visible,.task-type:visible').allTextContents();
  return /homework|assignment/i.test(route) || labels.some(t => /作业|\bhomework\b|\bassignment\b/i.test(t)) ? 'homework' : 'practice';
}
export async function readUnipusQuestions(frame: Frame): Promise<StudyQuestion[]> {
  if (!unipusStudyFrame(frame.url()) || !await visibleFrame(frame)) return [];
  return frame.evaluate(unipusQuestionSnapshot,{questionSelector:unipusQuestionSelector,choiceSelector:unipusChoiceSelector});
}
export async function pauseUnipusMedia(page: Page) {
  for (const frame of page.frames().filter(f => unipusStudyFrame(f.url()))) await frame.locator('video,audio').evaluateAll(nodes => nodes.forEach(n => (n as HTMLMediaElement).pause())).catch(() => {});
}
export async function playUnipusMedia(page: Page): Promise<'none' | 'playing' | 'ended'> {
  const frames = await unipusFrames(page);
  let result: 'none' | 'playing' | 'ended' = 'none';
  for (const frame of frames) {
    const media = frame.locator('video:visible,audio:visible');
    if (!await media.count()) continue;
    const pending = await media.evaluateAll(nodes => nodes.some(n => !(n as HTMLMediaElement).ended));
    if (!pending) { if (result === 'none') result = 'ended'; continue; }
    // Embedded video questions and uploads are manual; never click them to keep playback alive.
    if ((await readUnipusQuestions(frame)).length) throw new Error("媒体页面出现练习，请手动处理后继续播放");
    for (const player of await media.all()) {
      const state = await player.evaluate(n => { const m = n as HTMLMediaElement; return { ended: m.ended, error: !!m.error, paused: m.paused }; });
      if (state.ended) continue;
      if (state.error) throw new Error("U校园播放器报告错误，请在官方窗口处理");
      await player.evaluate(async n => { const m = n as HTMLMediaElement; m.playbackRate = 1; m.muted = true; if (m.paused) {
        if (m.dataset.coursewatchPlayed === 'true') throw new Error('播放器已暂停，请在官方窗口处理后继续');
        m.dataset.coursewatchPlayed = 'true'; await m.play();
      }
      m.dataset.coursewatchPlayed = 'true'; });
      result = 'playing';
      return 'playing'; // one active player across the whole page
    }
  }
  return result;
}
export async function applyUnipusAnswers(page: Page, frame: Frame, questions: StudyQuestion[], answers: string[][], expectedURL: string, signal: AbortSignal, expectedFrameURL = frame.url()) {
  signal.throwIfAborted();
  if (page.url() !== expectedURL || frame.url() !== expectedFrameURL || !(await unipusFrames(page)).includes(frame) || (await unipusQuestionMode(frame) !== 'practice' || await unipusQuestionMode(page.mainFrame()) !== 'practice')) throw new Error("页面或任务范围已变化，未填入或提交");
  if (JSON.stringify(await readUnipusQuestions(frame)) !== JSON.stringify(questions) || answers.length !== questions.length) throw new Error("练习内容发生变化，未填入或提交");
  for (const [index, question] of questions.entries()) {
    signal.throwIfAborted(); await unipusFrames(page);
    validateStudyAnswer(question, { answers: answers[index] });
    if (page.url() !== expectedURL || frame.url() !== expectedFrameURL || await unipusQuestionMode(frame) !== 'practice' || await unipusQuestionMode(page.mainFrame()) !== 'practice') throw new Error("页面发生变化，已暂停");
    const root = frame.locator(`[data-coursewatch-unipus-question="${index}"]`);
    if (question.options.length) {
      const native = root.locator('input[type="radio"]:enabled,input[type="checkbox"]:enabled');
      const controls = await native.count() ? native : root.locator(unipusChoiceSelector).filter({visible:true});
      if (await controls.count() !== question.options.length) throw new Error("练习选项不完整，未提交");
      for (let i = 0; i < question.options.length; i++) {
        signal.throwIfAborted();
        if (page.url() !== expectedURL || frame.url() !== expectedFrameURL) throw new Error("页面发生变化，已暂停");
        const control = controls.nth(i), wanted = answers[index].includes(String(i + 1));
        const isNative = await control.evaluate(node => node instanceof HTMLInputElement);
        const checked = isNative ? await control.isChecked() : await control.evaluate(node => node.getAttribute('aria-checked') === 'true' || node.getAttribute('aria-pressed') === 'true' || node.classList.contains('selected'));
        if (wanted !== checked && (wanted || question.type === 'multiple')) {
          if (isNative) await control.setChecked(wanted, { timeout: 5000 }); else await control.click({ timeout: 5000 });
        }
      }
      for (let i = 0; i < question.options.length; i++) {
        const control = controls.nth(i);
        const checked = await control.evaluate(node => node instanceof HTMLInputElement ? node.checked : node.getAttribute('aria-checked') === 'true' || node.getAttribute('aria-pressed') === 'true' || node.classList.contains('selected'));
        if (checked !== answers[index].includes(String(i + 1))) throw new Error("练习选项回读不一致，未提交");
      }
    } else {
      const fields = root.locator('textarea:visible:enabled:not([readonly]),input[type="text"]:visible:enabled:not([readonly]),input:not([type]):visible:enabled:not([readonly])');
      if (await fields.count() !== question.slots || answers[index].length !== question.slots) throw new Error("练习输入框数量变化，未提交");
      for (let i = 0; i < question.slots; i++) {
        signal.throwIfAborted();
        if (page.url() !== expectedURL || frame.url() !== expectedFrameURL) throw new Error("页面发生变化，已暂停");
        await fields.nth(i).fill(answers[index][i], { timeout: 5000 });
        if ((await fields.nth(i).inputValue()).trim() !== answers[index][i].trim()) throw new Error("练习答案回读不一致，未提交");
      }
    }
  }
}
export async function submitUnipusPractice(page: Page, frame: Frame, questions: StudyQuestion[], expectedURL: string, signal: AbortSignal, expectedFrameURL = frame.url()) {
  signal.throwIfAborted();
  if (page.url() !== expectedURL || frame.url() !== expectedFrameURL || !(await unipusFrames(page)).includes(frame) || (await unipusQuestionMode(frame) !== 'practice' || await unipusQuestionMode(page.mainFrame()) !== 'practice') || JSON.stringify(await readUnipusQuestions(frame)) !== JSON.stringify(questions)) throw new Error("提交前任务已变化，已暂停");
  const button = frame.getByRole('button', { name: /^(提交|提交答案|提交练习|Submit|Submit answers)$/i }).filter({ visible: true });
  if (await frame.getByText(/^(提交成功|已提交|练习已完成|答案已提交|Submitted|Answers submitted)$/i).filter({ visible: true }).count()) throw new Error("页面已有提交结果，请核实，不重复提交");
  if (await button.count() !== 1 || !await button.isEnabled() || await button.getAttribute('aria-disabled') === 'true') throw new Error("未识别到唯一可用的练习提交按钮，请手动处理");
  const confirm = (dialog: Dialog) => { void (dialog.type() === 'confirm' && /提交|submit/i.test(dialog.message()) && !/验证|未答|未完成|考试|exam/i.test(dialog.message()) && !signal.aborted && page.url() === expectedURL ? dialog.accept() : dialog.dismiss()).catch(() => {}); };
  page.on('dialog', confirm);
  try {
    signal.throwIfAborted(); await button.click({ timeout: 5000 });
    for (let i = 0; i < 12; i++) {
      signal.throwIfAborted();
      if (page.url() !== expectedURL || frame.url() !== expectedFrameURL || frame.isDetached()) throw new Error("提交后页面变化，结果待核实，程序不会重复提交");
      await unipusFrames(page);
      const result = frame.getByText(/^(提交成功|已提交|练习已完成|答案已提交|Submitted|Answers submitted)$/i).filter({ visible: true });
      if (await result.count()) return;
      await page.waitForTimeout(500);
    }
    throw new Error("提交结果未确认，请在官方页面核实，程序不会重复提交");
  } finally { page.off('dialog', confirm); }
}
export async function nextUnipusItem(page: Page, allowDirectory = false) {
  for (const frame of await unipusFrames(page)) {
    const next = frame.getByRole('button', { name: /^(下一题|下一项|下一节|下一课|下一页|Next|Next activity|Next lesson)$/i }).filter({ visible: true });
    if (await next.count() === 1 && await next.isEnabled() && await next.getAttribute('aria-disabled') !== 'true' && !await next.evaluate(n => !!n.closest('.disabled,.locked,[data-locked="true"]'))) { await next.click({ timeout: 5000 }); return true; }
  }
  if (allowDirectory) {
    const { switchStudyItem } = await import('./navigation.js');
    return switchStudyItem(page, 'unipus', 'next');
  }
  return false;
}
export async function readUnipusProgress(page: Page): Promise<{ progress: StudyProgress | null; activity: ActivitySample }> {
  const frames = await unipusFrames(page);
  if (!frames.length) return { progress: null, activity: { media: [], reading: false } };
  const progress: StudyProgress = { observedAt: Date.now(), course: '', chapter: '', chapterComplete: null, chapters: [], media: [], documents: [] };
  const activity: ActivitySample = { media: [], reading: false };
  for (const [frameIndex, frame] of frames.entries()) {
    if (!await visibleFrame(frame)) continue;
    const snapshot = await frame.evaluate(() => {
      const visible = (n: Element) => !!n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden';
      const text = (selector: string) => [...document.querySelectorAll(selector)].filter(visible).map(n => n.textContent?.replace(/\s+/g, ' ').trim()).find(Boolean)?.slice(0, 200) || '';
      const players = [...document.querySelectorAll<HTMLMediaElement>('video,audio')].filter(visible).slice(0, 20);
      const completeText = text('.task-status,.study-status,.learning-status');
      const complete = /^(已完成|Completed|Finished)$/i.test(completeText) ? true : /^(未完成|Incomplete|Not completed)$/i.test(completeText) ? false : null;
      const media = players.map(m => ({ kind: m.tagName === 'VIDEO' ? 'video' as const : 'audio' as const, current: Number.isFinite(m.currentTime) ? Math.max(0, m.currentTime) : 0, duration: Number.isFinite(m.duration) && m.duration > 0 ? m.duration : null, paused: m.paused, ended: m.ended }));
      const samples = players.map((m, i) => ({ id: `${i}:${m.currentSrc}`, current: m.currentTime, playing: !m.paused && !m.ended && !m.error && m.readyState >= 2, seeking: m.seeking, rate: m.playbackRate }));
      const reading = document.visibilityState === 'visible' && document.hasFocus() && [...document.querySelectorAll('.reading-content,.reading-material,.article-content')].some(n => visible(n) && !!n.textContent?.trim());

      return { course: text('.course-name,.book-name,.pc-header-breadcrumb .ant-breadcrumb-link:first-child'), chapter: text('.unit-title,.current-chapter,.chapter-title,.pc-header-breadcrumb .ant-breadcrumb-link:last-child,.ant-breadcrumb li:last-child,h1,h2'), complete, media, samples, reading };
    });
    const directory = await frame.locator('.pc-slider-content-menu .pc-slider-menu-micro,.pc-slider-content-menu .pc-slider-menu-node').evaluateAll(unipusDirectorySnapshot);
    if (directory.length) {
      progress.chapters = directory.map(({index,current,...chapter}) => chapter);
      const selected = directory.filter(chapter => chapter.current);
      if (selected.length === 1) {
        progress.chapterId = selected[0].id;
        progress.chapter = selected[0].name;
        progress.chapterComplete = selected[0].complete;
      }
    }
    progress.course ||= snapshot.course; progress.chapter ||= snapshot.chapter;
    if (progress.chapterComplete === null && snapshot.complete !== null) progress.chapterComplete = snapshot.complete;
    progress.media.push(...snapshot.media);
    activity.media.push(...snapshot.samples.map(m => ({ ...m, id: `${frameIndex}:${frame.url()}:${m.id}` })));
    activity.reading ||= snapshot.reading;
  }
  // CurrentSrc/URL are internal sample identities and never returned in status.
  return { progress, activity };
}
