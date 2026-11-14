import type { Page } from 'playwright';
import type { CourseLearningProgress, StudyTask } from '../../contracts/src/study.js';
import { officialStudyFrame } from '../../contracts/src/study.js';
import { openChaoxingChapter } from './launch.js';
import { readChapterTasks, readTaskEvidence } from './chapter-tasks.js';
import { selectNativeTab } from './page.js';
import { visibleFrame } from './visible-frame.js';

// Parse JSON data only. Never evaluate scripts from a downloaded cards page.
export function cardAttachments(html: string): {type?: string; isPassed?: boolean}[] | null {
  const match = /\bmArg\s*=\s*(\{)/.exec(html);
  if (!match) return null;
  const start = match.index + match[0].length - 1;
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < html.length; i++) {
    const char = html[i];
    if (quoted) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; continue; }
    if (char === '"') quoted = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) {
      try { const value = JSON.parse(html.slice(start,i+1)); return Array.isArray(value.attachments) ? value.attachments : null; }
      catch { return null; }
    }
  }
  return null;
}

export function attachmentTasks(attachments: {type?:string;isPassed?:boolean}[], tabId: string): StudyTask[] {
  return (['video','quiz'] as const).flatMap(kind => {
    const items = attachments.filter(a => a.type === (kind === 'video' ? 'video' : 'workid'));
    if (!items.length) return [];
    return [{id:`${tabId}:${kind}`,tabId,kind,name:kind === 'video' ? '视频' : '章节检测',current:false,
      complete:items.some(a => a.isPassed === false) ? false : items.every(a => a.isPassed === true) ? true : null}];
  });
}

// workid attachments can omit isPassed. Let the official card render its
// current task/result labels; do not fill answers or click a submit button.
export async function readQuizCardState(source: Page, url: string, timeout = 5000): Promise<boolean | null> {
  if (!officialStudyFrame(url) || !/\/knowledge\/cards$/.test(new URL(url).pathname)) return null;
  const inspection = await source.context().newPage();
  const deadline = Date.now() + timeout;
  try {
    await inspection.goto(url, {waitUntil:'domcontentloaded',timeout});
    do {
      const items = (await readTaskEvidence(inspection)).filter(t => t.kind === 'quiz');
      if (items.some(t => t.complete === false)) return false;
      if (items.length && items.every(t => t.complete === true)) return true;
      const quizzes = await inspection.mainFrame().evaluate(() => {
        const attachments = (window as unknown as {mArg?:{attachments?:{type?:string}[]}}).mArg?.attachments;
        return Array.isArray(attachments) ? attachments.filter(a => a.type === 'workid').length : 0;
      });
      if (quizzes === 1 && items.some(t => t.complete === true)) return true;
      if (Date.now() >= deadline) return null;
      await inspection.waitForTimeout(Math.min(200, deadline - Date.now()));
    } while (true);
  } catch { return null; }
  finally { await inspection.close(); }
}

// The request templates come from the website's own unlocked tabs. Only the
// chapter ID changes, using IDs in this course's native directory. These GETs
// read attachment flags; they do not load players, answer questions or report
// progress. Cookies and authorization stay inside the browser context.
export async function readCatalogTaskStates(home: Page, progress: CourseLearningProgress, budgetMs = 45000) {
  const page = await openChaoxingChapter(home.context(),home);
  const deadline = Date.now() + budgetMs, templates: {tabId:string;url:string}[] = [];
  let tabs: StudyTask[] = [];
  for (let attempt=0; attempt<40 && Date.now()<deadline; attempt++) {
    tabs = await readChapterTasks(page);
    if (tabs.some(t=>t.tabId)) break;
    await page.waitForTimeout(250);
  }
  for (const tab of tabs.filter(t => t.tabId && !t.locked).slice(0,10)) {
    if (!await selectNativeTab(page,tab.tabId!)) continue;
    for (let attempt=0; attempt<20; attempt++) {
      let cards: string | undefined;
      for (const frame of page.frames()) {
        try {
          const url = new URL(frame.url());
          if (officialStudyFrame(url.href) && /\/knowledge\/cards$/.test(url.pathname) && url.searchParams.get('knowledgeid') && await visibleFrame(frame)) { cards = url.href; break; }
        } catch { /* A frame may be detached during native navigation. */ }
      }
      if (cards) { templates.push({tabId:tab.tabId!,url:cards}); break; }
      await page.waitForTimeout(100);
    }
  }
  if (!templates.length) throw new Error('栏目状态未加载');
  const jobs = progress.chapters.filter(c=>c.id && !c.locked).flatMap(chapter=>templates.map(template=>({chapter,template})));
  const observations = new Map<string, StudyTask[]>();
  const successfulJobs = new Set<string>();
  for (let offset=0; offset<jobs.length && Date.now()<deadline; offset+=3) {
    await Promise.allSettled(jobs.slice(offset,offset+3).map(async ({chapter,template})=>{
      const url = new URL(template.url); url.searchParams.set('knowledgeid',chapter.id!);
      const remaining = deadline - Date.now(); if (remaining <= 0) return;
      const response = await page.context().request.get(url.href,{timeout:Math.min(10000,remaining),maxRedirects:0});
      try {
        if (!response.ok()) return;
        const bytes = await response.body(); if(bytes.length>4*1024*1024)return;
        const attachments = cardAttachments(bytes.toString('utf8')); if(!attachments)return;
        const tasks = attachmentTasks(attachments,template.tabId);
        const quiz = tasks.find(t => t.kind === 'quiz' && t.complete === null);
        if (quiz && Date.now() < deadline) quiz.complete = await readQuizCardState(page,url.href,Math.min(5000,deadline-Date.now()));
        observations.set(chapter.id!,[...(observations.get(chapter.id!)||[]),...tasks]);
        successfulJobs.add(JSON.stringify([chapter.id,template.tabId]));
      } finally { await response.dispose(); }
    }));
  }
  if (!observations.size) throw new Error('未读取到任务状态');
  for (const chapter of progress.chapters) {
    const tasks = chapter.id ? observations.get(chapter.id) : undefined;
    if (tasks?.length) chapter.tasks = tasks.sort((a,b)=>templates.findIndex(t=>t.tabId===a.tabId)-templates.findIndex(t=>t.tabId===b.tabId));
  }
  if (successfulJobs.size < jobs.length || templates.length < tabs.filter(t => t.tabId && !t.locked).length || [...observations.values()].some(tasks => tasks.some(t => t.complete === null))) throw new Error('部分栏目状态待确认');
}
