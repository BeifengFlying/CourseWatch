import type { Page, Locator } from 'playwright';
import { studyPageKind, type StudyPlatform } from '../../contracts/src/study.js';
import { assertPageAllowed } from './page.js';
import { unipusFrames } from './unipus-page.js';
import { clickChapter, directoryFrames, frameChapters, readStudyChapters } from './chapter-directory.js';
export type StudyDirection = 'previous' | 'next';
async function allowed(page: Page, platform: StudyPlatform) {
  if (platform === 'chaoxing') return studyPageKind(page.url()) === 'chapter' && await assertPageAllowed(page, true);
  await unipusFrames(page); return true;
}
async function adjacent(page: Page, platform: StudyPlatform, direction: StudyDirection) {
  const chapters = await readStudyChapters(page, platform), current = chapters.filter(c => c.current);
  if (current.length !== 1) return { known: chapters.length > 0, chapter: null };
  const index = chapters.indexOf(current[0]) + (direction === 'next' ? 1 : -1), next = chapters[index];
  return { known: true, chapter: next && !next.locked ? next : null };
}
async function nativeButton(page: Page, platform: StudyPlatform, direction: StudyDirection): Promise<Locator | null> {
  const names = direction === 'next' ? /^(下一节|下一章|下一课|下一项|Next lesson|Next activity)$/i : /^(上一节|上一章|上一课|上一项|Previous lesson|Previous activity)$/i;
  for (const frame of await directoryFrames(page, platform)) for (const role of ['button', 'link'] as const) {
    const entry = frame.getByRole(role, { name: names }).filter({ visible: true });
    if (await entry.count() === 1 && await entry.isEnabled() && !await entry.evaluate(n => !!n.closest('[disabled],[aria-disabled=true],.disabled,.locked,[data-locked=true]'))) return entry;
  }
  return null;
}
export async function readStudyNavigation(page: Page, platform: StudyPlatform) {
  if (!await allowed(page, platform)) return { previous: false, next: false };
  const previous = await adjacent(page, platform, 'previous'), next = await adjacent(page, platform, 'next');
  return { previous: previous.known ? !!previous.chapter : !!await nativeButton(page, platform, 'previous'), next: next.known ? !!next.chapter : !!await nativeButton(page, platform, 'next') };
}
export async function jumpToStudyChapter(page: Page, platform: StudyPlatform, chapterId: string, signal?: AbortSignal) {
  signal?.throwIfAborted(); if (!await allowed(page, platform)) return false;
  for (const frame of await directoryFrames(page, platform)) {
    const chapters = await frameChapters(frame, platform), matches = chapters.filter(c => c.id === chapterId);
    if (matches.length !== 1) continue;
    const target = matches[0]; if (target.locked) return false; if (target.current) return true;
    await clickChapter(frame, platform, target, signal);
    for (let i = 0; i < 60; i++) {
      signal?.throwIfAborted(); await page.waitForTimeout(250);
      try {
        if (!await allowed(page, platform)) return false;
        const selected = (await readStudyChapters(page, platform)).filter(c => c.current);
        if (selected.length === 1 && selected[0].id === chapterId) return true;
      } catch (error) {
        if (page.isClosed() || !/context was destroyed|Frame was detached|Execution context|navigation/i.test((error as Error).message)) throw error;
      }
    }
    return false;
  }
  return false;
}
export async function switchStudyItem(page: Page, platform: StudyPlatform, direction: StudyDirection, signal?: AbortSignal) {
  signal?.throwIfAborted(); if (!await allowed(page, platform)) return false;
  const next = await adjacent(page, platform, direction);
  if (next.known) return next.chapter ? jumpToStudyChapter(page, platform, next.chapter.id, signal) : false;
  const button = await nativeButton(page, platform, direction); if (!button) return false;
  const before = page.url(); signal?.throwIfAborted(); await button.click({ timeout: 5000 });
  for (let i = 0; i < 60; i++) { signal?.throwIfAborted(); await page.waitForTimeout(250); if (page.url() !== before) return true; }
  return false;
}
