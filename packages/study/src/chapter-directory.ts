import type { Page, Frame } from 'playwright';
import { officialStudyFrame, type StudyChapterPath, type StudyPlatform } from '../../contracts/src/study.js';
import { visibleFrame } from './visible-frame.js';
import { unipusFrames } from './unipus-page.js';
import { unipusDirectorySnapshot } from './unipus-directory.js';
export const chapterSelector = (platform: StudyPlatform) => platform === 'chaoxing'
  ? '.posCatalog_select[id^="cur"],h4[id^="cur"],.chapter_item[id^="cur"]'
  : '.pc-slider-content-menu .pc-slider-menu-micro,.pc-slider-content-menu .pc-slider-menu-node';
export interface StudyChapter { id: string; name: string; complete: boolean | null; locked: boolean; current: boolean; index: number; path?: StudyChapterPath[]; required?: boolean | null; }
export async function directoryFrames(page: Page, platform: StudyPlatform): Promise<Frame[]> {
  return platform === 'chaoxing' ? page.frames().filter(f => officialStudyFrame(f.url())) : unipusFrames(page);
}
export async function frameChapters(frame: Frame, platform: StudyPlatform): Promise<StudyChapter[]> {
  if (platform === 'unipus') return frame.locator(chapterSelector(platform)).evaluateAll(unipusDirectorySnapshot);
  return frame.locator(chapterSelector(platform)).evaluateAll(nodes => {
    // Object methods remain self-contained when tsx preserves function names;
    // inferred arrow names can otherwise reference its unavailable __name helper.
    const {clean} = {clean(s?: string | null) { return (s || '').replace(/\s+/g, ' ').trim(); }};
    let loadedId = '';
    // AJAX navigation leaves the outer URL unchanged. The loaded cards document
    // identifies the actual chapter; a highlighted row alone is not load proof.
    const cards = document.querySelector<HTMLIFrameElement>('#mainid #iframe');
    try {
      const url = new URL(cards?.contentDocument?.URL || 'about:blank');
      if (/\/knowledge\/cards$/.test(url.pathname) && url.origin === location.origin) loadedId = url.searchParams.get('knowledgeid') || url.searchParams.get('chapterId') || '';
    } catch { /* No cross-origin access: fall back to native selection. */ }
    const active = nodes.filter(n => n.classList.contains('posCatalog_active') || n.classList.contains('active') || n.classList.contains('current') || n.getAttribute('aria-current') === 'page' || n.getAttribute('aria-selected') === 'true');
    const declared = new URL(location.href).searchParams.get('chapterId') || (document.querySelector<HTMLInputElement>('#chapterId,#curChapterId'))?.value;
    const current = cards ? (loadedId ? `cur${loadedId}` : '') : active.length === 1 ? active[0].id : declared ? `cur${declared}` : '';
    return nodes.flatMap((row, index) => {
      const label = row.querySelector('.posCatalog_name,.catalog_name,a[title],a.clicktitle');
      if (!label) return [];
      const name = clean(label.textContent || label.getAttribute('title')).slice(0, 300);
      if (!name) return [];
      const id = row.id.replace(/^cur/, '');
      // Keep only hierarchy shown by the official DOM. Numbering or indentation
      // alone does not establish a parent/child relationship.
      const path: {id:string;name:string}[] = [];
      for (let li = row.closest('li')?.parentElement?.closest('li'); li; li = li.parentElement?.closest('li') || null) {
        const parent = li.querySelector(':scope > .posCatalog_select,:scope > h4[id^="cur"],:scope > .chapter_item');
        const label = parent?.querySelector('.posCatalog_title,.posCatalog_name,.catalog_name');
        const name = clean(label?.textContent || label?.getAttribute('title')).slice(0,300);
        if (parent?.id && name) path.unshift({id:parent.id.replace(/^cur/, ''),name});
      }
      const locked = !!row.closest('[disabled],[aria-disabled=true],.disabled,.locked,.chapter_locked,[data-locked=true]') || !!row.querySelector('.lock,.icon-lock,.icon_lock,.icon-locked,.chapter-lock,[data-locked=true]');
      const state = clean(row.querySelector('.catalog_points,.task-status,.catalog_task')?.textContent);
      const {indicator} = {indicator(selector: string) { return [...row.querySelectorAll(selector)].some(node => {
        // A folded directory is still readable; hidden status templates inside
        // a row are not evidence of completion.
        for (let n: Element | null = node; n && n !== row; n = n.parentElement) {
          const style = getComputedStyle(n);
          if (n.hasAttribute('hidden') || style.display === 'none' || style.visibility === 'hidden') return false;
        }
        return true;
      }); }};
      const finished = row.getAttribute('data-completed') === 'true' || indicator('.icon_Completed,.icon-complete,.icon_yiwanc,.icon_yiwancheng') || /^(已完成|任务点已完成)$/.test(state);
      const pending = clean(row.querySelector('.bntHoverTips')?.textContent).match(/(\d+)\s*个待完成任务点/);
      const unfinished = row.getAttribute('data-completed') === 'false' || indicator('.icon_Uncompleted') || /^(未完成|任务点未完成)$/.test(state) || !!pending && Number(pending[1]) > 0;
      const complete = finished && !unfinished ? true : unfinished && !finished ? false : null;
      return [{ id, name, locked, complete, ...(path.length ? {path} : {}), current: row.id === current, index }];
    });
  });
}
export async function readStudyChapters(page: Page, platform: StudyPlatform): Promise<StudyChapter[]> {
  for (const frame of await directoryFrames(page, platform)) {
    if (!await visibleFrame(frame)) continue;
    const chapters = await frameChapters(frame, platform);
    if (chapters.length) return chapters;
  }
  return [];
}

// The chapter can be inside a folded directory. Use the site's own click
// handlers after checking locks; never edit styles, URLs or access state.
export async function clickChapter(frame: Frame, platform: StudyPlatform, chapter: StudyChapter, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const row = frame.locator(chapterSelector(platform)).nth(chapter.index);
  const current = (await frameChapters(frame, platform)).find(item => item.id === chapter.id);
  if (!current || current.locked || current.index !== chapter.index) throw new Error('章节入口已变化或尚未开放，请刷新目录');
  const label = platform === 'chaoxing' ? row.locator('.posCatalog_name,.catalog_name,a[title],a.clicktitle').first() : row;
  const onScreen = await label.evaluate(node => {
    const r = node.getBoundingClientRect();
    if (!r.width || !r.height || r.right <= 0 || r.left >= innerWidth || r.bottom <= 0 || r.top >= innerHeight || getComputedStyle(node).visibility === 'hidden') return false;
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
      if (/(hidden|clip|auto|scroll)/.test(style.overflowX) && (r.right <= bounds.left || r.left >= bounds.right)) return false;
      if (/(hidden|clip|auto|scroll)/.test(style.overflowY) && (r.bottom <= bounds.top || r.top >= bounds.bottom)) return false;
    }
    return true;
  });
  if (await label.isVisible() && onScreen) { signal?.throwIfAborted(); await label.click({ timeout: 5000 }); }
  else {
    // DOM click delegates to the exact same official handler when only the
    // navigation sidebar is collapsed. It does not override locked chapters.
    signal?.throwIfAborted(); await label.evaluate(node => (node as HTMLElement).click());
  }
}
