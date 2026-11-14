import type { Page } from 'playwright';
import { officialStudyFrame, studyPageKind, type StudyTask } from '../../contracts/src/study.js';
import { visibleFrame } from './visible-frame.js';
import { readStudyChapters } from './chapter-directory.js';
import { selectNativeTab, chapterQuizComplete } from './page.js';

const taskHistory = new WeakMap<Page, Map<string, StudyTask[]>>();
function historyKey(page:Page, chapterId:string) { const url = new URL(page.url()); return url.origin + url.pathname + ':' + (url.searchParams.get('courseId') || url.searchParams.get('courseid') || '') + ':' + (url.searchParams.get('clazzid') || url.searchParams.get('classid') || '') + ':' + chapterId; }
export function observedChapterTasks(page:Page, chapterId:string) { return taskHistory.get(page)?.get(historyKey(page,chapterId)); }

// Shared by live progress and read-only catalog inspection of official cards.
export async function readTaskEvidence(page: Page) {
  const evidence: {kind: StudyTask['kind']; complete:boolean|null; metadata?:boolean}[] = [];
  for (const frame of page.frames().filter(f => officialStudyFrame(f.url())).slice(0, 30)) {
    if (!await visibleFrame(frame)) continue;
    const quizComplete = await chapterQuizComplete(frame);
    evidence.push(...await frame.evaluate((quizComplete) => {
      const visible = (n: Element) => !!n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden';
      const args = (window as unknown as {mArg?:{attachments?:{type?:string;isPassed?:boolean}[]}}).mArg;
      const attachments = Array.isArray(args?.attachments) ? args.attachments.slice(0,1000) : [];
      const items: {kind:'video'|'quiz';complete:boolean|null;metadata?:boolean}[] = attachments.flatMap(a => a.type === 'video' || a.type === 'workid' ? [{kind:a.type === 'video' ? 'video' as const : 'quiz' as const,complete:typeof a.isPassed === 'boolean' ? a.isPassed : null,metadata:true}] : []);
      if (!items.some(t => t.kind === 'video') && [...document.querySelectorAll('video')].some(visible)) items.push({kind:'video',complete:null});
      // A unique native task marker can update after playback while mArg
      // still contains its initial false value. Never map a mixed marker set.
      const markers = [...document.querySelectorAll('.ans-job-icon')].filter(visible);
      const finished = markers.length === 1 && (markers[0].getAttribute('aria-label') === '任务点已完成' || !!markers[0].closest('.ans-job-finished'));
      const unfinished = markers.length === 1 && markers[0].getAttribute('aria-label') === '任务点未完成';
      const legacyFinished = !markers.length && [...document.querySelectorAll('.ans-job-finished')].filter(visible).length === 1;
      if (items.length === 1 && (finished || legacyFinished)) { items[0].complete = true; items[0].metadata = true; }
      else if (items.length === 1 && unfinished) { items[0].complete = false; items[0].metadata = true; }
      const result = quizComplete;
      const questions = [...document.querySelectorAll('.singleQuesId,.TiMu,.question-item[data-question-id],[data-questionid]')].some(n => visible(n) && !n.closest('.ans-videoquiz,.tkTopic,.video-question,.quiz-overlay,[data-video-quiz-root]'));
      if (result) { for (const item of items.filter(t => t.kind === 'quiz')) item.complete = true; }
      if (!items.some(t => t.kind === 'quiz') && (result || questions)) items.push({kind:'quiz',complete:result ? true : null,metadata:result});
      return items;
    }, quizComplete));
  }
  return evidence;
}

// Read official task flags. Played time, a model answer and a visited tab are
// never evidence of completion. Unopened tabs remain unknown.
export async function readChapterTasks(page: Page): Promise<StudyTask[]> {
  if (studyPageKind(page.url()) !== 'chapter') return [];
  const tabs: StudyTask[] = await page.locator('#prev_tab li[id^="dct"],#prev_tab [data-course-tab]').evaluateAll(nodes => {
    const visible = (n: Element) => !!n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden';
    if (new Set(nodes.map(n => n.id)).size !== nodes.length) return [];
    return nodes.filter(n => /^dct\d+$/.test(n.id) && (visible(n) || nodes.length === 1)).map(n => {
      const name = (n.textContent || '').replace(/\s+/g, ' ').trim();
      const kind = /测验|检测|测试|练习/.test(name) ? 'quiz' as const : /视频/.test(name) ? 'video' as const : /文档|课件/.test(name) ? 'document' as const : 'other' as const;
      const flag = n.getAttribute('data-completed');
      const finished = flag === 'true' || [...n.querySelectorAll('.icon_Completed,.icon-complete')].some(visible);
      const unfinished = flag === 'false' || [...n.querySelectorAll('.icon_Uncompleted')].some(visible);
      const complete = finished && !unfinished ? true : unfinished && !finished ? false : null;
      return {id:n.id,tabId:n.id,name:name || '栏目',kind,complete,current:n.classList.contains('active') || n.getAttribute('aria-selected') === 'true',locked:n.matches('.disabled,.locked,[aria-disabled=true]')};
    });
  });
  const evidence = await readTaskEvidence(page);
  const active = tabs.filter(t => t.current);
  if (active.length === 1) {
    const task = active[0], kinds = [...new Set(evidence.map(e => e.kind))];
    if (task.kind === 'other' && kinds.length === 1) task.kind = kinds[0];
    const all = evidence.filter(e => e.kind === task.kind), matching = all.some(e => e.metadata) ? all.filter(e => e.metadata) : all;
    if (matching.length) task.complete = matching.some(e => e.complete === false) ? false : matching.every(e => e.complete === true) ? true : task.complete;
  }
  if (tabs.length) {
    const chapters = await readStudyChapters(page, 'chaoxing'), currentChapter = chapters.filter(c => c.current);
    if (currentChapter.length === 1) {
      const key = historyKey(page,currentChapter[0].id);
      let history = taskHistory.get(page); if (!history) taskHistory.set(page, history = new Map());
      const previous = history.get(key) || [];
      for (const task of tabs.filter(t => !t.current)) {
        const old = previous.find(p => p.id === task.id && p.name === task.name);
        if (task.kind === 'other' && old) task.kind = old.kind;
        if (task.complete === null) task.complete = old?.complete ?? null;
      }
      history.set(key, structuredClone(tabs));
      if (history.size > 400) history.delete(history.keys().next().value!);
    }
    return tabs;
  }
  return [...new Set(evidence.map(e => e.kind))].map(kind => {
    const all = evidence.filter(e => e.kind === kind), items = all.some(e => e.metadata) ? all.filter(e => e.metadata) : all;
    return {id:`content:${kind}`,kind,name:kind === 'video' ? '视频' : '章节检测',current:true,complete:items.some(e => e.complete === false) ? false : items.every(e => e.complete === true) ? true : null};
  });
}

export async function enterChapterTask(page: Page, kind: 'video'|'quiz', signal?: AbortSignal) {
  signal?.throwIfAborted();
  const tasks = await readChapterTasks(page), matching = tasks.filter(t => t.kind === kind && !t.locked);
  const task = matching.find(t => t.complete !== true) || matching[0];
  if (!task) {
    // Unnamed native tabs need to be opened once to identify their content.
    for (const candidate of tasks.filter(t => t.kind === 'other' && !t.locked && t.tabId)) {
      signal?.throwIfAborted();
      if (!candidate.current && !await selectNativeTab(page,candidate.tabId!,signal)) continue;
      if ((await readChapterTasks(page)).some(t => t.current && t.kind === kind)) return true;
    }
    return false;
  }
  return task.current || !!task.tabId && await selectNativeTab(page, task.tabId, signal);
}

// A preloaded exercise must not start a model request during video playback.
// An ended video still needs the native switch into the quiz tab first.
export async function canRequestChapterAnswers(page: Page, tasks?: StudyTask[]) {
  if (studyPageKind(page.url()) !== 'chapter') return false;
  const current = (tasks || await readChapterTasks(page)).filter(t => t.current);
  if (current.length > 1 || current.length === 1 && current[0].kind !== 'quiz') return false;
  for (const frame of page.frames().filter(f => officialStudyFrame(f.url()))) {
    if (!await visibleFrame(frame)) continue;
    const blocked = await frame.locator('video').evaluateAll((nodes, hasQuizTab) => nodes.some(n => {
      const video = n as HTMLVideoElement;
      return !!n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden' && (!hasQuizTab || !video.paused && !video.ended);
    }), current.length === 1);
    if (blocked) return false;
  }
  return true;
}

// Called before playback/answering. Move through native tabs in their order;
// stop on an unknown flag so it can be read rather than guessed as complete.
export async function skipCompletedTask(page: Page, signal: AbortSignal) {
  const tasks = await readChapterTasks(page), current = tasks.filter(t => t.current);
  if (current.length !== 1 || current[0].complete !== true) return false;
  const index = tasks.indexOf(current[0]);
  const next = tasks.slice(index + 1).find(t => t.complete !== true);
  if (!next?.tabId || next.locked) return false;
  return selectNativeTab(page, next.tabId, signal);
}
