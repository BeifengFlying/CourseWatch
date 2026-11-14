import { readChapterTasks, observedChapterTasks } from "./chapter-tasks.js";
import { readStudyChapters } from "./chapter-directory.js";
import { visibleFrame } from "./visible-frame.js";
import type { Page } from "playwright";
import { officialStudyFrame, studyPageKind, type StudyProgress } from "../../contracts/src/study.js";

// Read the open official chapter only; never navigate, play, submit or mark complete.
export async function readStudyProgress(page: Page): Promise<StudyProgress | null> {
  if (page.isClosed() || studyPageKind(page.url()) !== "chapter") return null;
  const chapter = await page.evaluate(() => {
    const visible = (e: Element) => !!e.getClientRects().length && getComputedStyle(e).visibility !== "hidden";
    const text = (selector: string) => [...document.querySelectorAll(selector)].filter(visible).map(n => n.textContent?.replace(/\s+/g, " ").trim()).find(Boolean)?.slice(0, 200) || "";
    const chapterId = new URL(location.href).searchParams.get("chapterId") || (document.querySelector<HTMLInputElement>('#chapterId,#curChapterId'))?.value;
    const selected = (chapterId ? document.getElementById(`cur${chapterId}`) : null) || [...document.querySelectorAll('.posCatalog_active')].find(visible);
    const complete = (row?: Element | null): boolean | null => {
      if (!row || !visible(row)) return null;
      if (row.getAttribute('data-completed') === 'true' || [...row.querySelectorAll('.icon_Completed,.icon-complete,.icon_yiwanc,.icon_yiwancheng,.icon_yiwancheng,[data-completed="true"]')].some(visible)) return true;
      if (row.getAttribute('data-completed') === 'false' || [...row.querySelectorAll('.icon_Uncompleted,[data-completed="false"]')].some(visible)) return false;
      const label = [...row.querySelectorAll('.catalog_points,.task-status')].filter(visible).map(n => n.textContent?.trim()).find(Boolean);
      return /^(已完成|任务点已完成)$/.test(label || '') ? true : /^(未完成|任务点未完成)$/.test(label || '') ? false : null;
    };
    const chapters = [...document.querySelectorAll('.posCatalog_select[id^="cur"],h4[id^="cur"]')].filter(visible).slice(0, 300).map(row => ({ name: row.querySelector('.posCatalog_name')?.textContent?.replace(/\s+/g, " ").trim().slice(0, 200) || "未识别章节名称", complete: complete(row) }));
    return { course: text('.courseName,.course-name,.courseTitle'), chapter: selected?.querySelector('.posCatalog_name')?.textContent?.replace(/\s+/g, " ").trim().slice(0, 200) || "", chapterComplete: complete(selected), chapters };
  });
  const chapters = await readStudyChapters(page, "chaoxing");
  const selected = chapters.find(c => c.current);
  const selectedTab = page.locator('#prev_tab .active[id],#prev_tab [aria-selected=true][id]');
  const tabId = await selectedTab.count() === 1 ? await selectedTab.getAttribute('id', {timeout:1000}) : null;
  const url = new URL(page.url());
  const course = url.searchParams.get('courseId') || url.searchParams.get('courseid');
  const clazz = url.searchParams.get('clazzid') || url.searchParams.get('classid');
  const result: StudyProgress = { ...chapter, ...(chapters.length ? { chapters: chapters.map(({id,name,complete,locked,path}) => ({id,name,complete,locked,...(path ? {path} : {})})), chapter: selected?.name || chapter.chapter, chapterComplete: selected?.complete ?? chapter.chapterComplete } : {}), ...(selected ? { chapterId: selected.id } : {}), ...(tabId ? { tabId } : {}), ...(course && clazz ? {courseKey:`course:${course}:class:${clazz}`} : {}), observedAt: Date.now(), media: [], documents: [] };
  for (const frame of page.frames().filter(f => officialStudyFrame(f.url())).slice(0, 30)) {
    if (!await visibleFrame(frame)) continue;
    const snapshot = await frame.evaluate(() => {
      const visible = (e: Element) => !!e.getClientRects().length && getComputedStyle(e).visibility !== "hidden";
      const media = [...document.querySelectorAll<HTMLMediaElement>("video,audio")].filter(visible).slice(0, 20).map(m => ({ kind: m.tagName === "VIDEO" ? "video" as const : "audio" as const, current: Number.isFinite(m.currentTime) ? Math.max(0, m.currentTime) : 0, duration: Number.isFinite(m.duration) && m.duration > 0 ? m.duration : null, paused: m.paused, ended: m.ended }));
      const reader = [...document.querySelectorAll('#viewerContainer,.pdfViewer,.pdf-viewer')].find(visible);
      const positive = (s?: string | null) => { const n = Number(s?.replace(/^\s*\/\s*/, "").trim()); return Number.isSafeInteger(n) && n > 0 && n < 100000 ? n : null; };
      const input = document.querySelector<HTMLInputElement>('#pageNumber');
      const current = input && visible(input) ? positive(input.value) : null;
      const totalNode = document.querySelector('#numPages');
      const total = totalNode && visible(totalNode) ? positive(totalNode.textContent) : null;
      return { media, documents: reader || current || total ? [{ current: total && current && current > total ? null : current, total }] : [] };
    });
    result.media.push(...snapshot.media); result.documents.push(...snapshot.documents);
  }
  result.tasks = await readChapterTasks(page);
  for (const chapter of result.chapters) {
    const tasks = chapter.id ? observedChapterTasks(page,chapter.id) : undefined;
    if (tasks?.length) chapter.tasks = tasks;
  }
  result.observedAt = Date.now();
  return result;
}
