import type { Page } from 'playwright';
import type { StudyPlatform } from '../../contracts/src/study.js';
import { readStudyChapters } from './chapter-directory.js';
import { readStudyNavigation, switchStudyItem } from './navigation.js';

// Read the selected chapter before touching players, documents or answers.
// Unknown status, multiple selections and locks never qualify as completed.
export async function skipCompletedChapter(page: Page, platform: StudyPlatform, signal: AbortSignal): Promise<'pending' | 'skipped' | 'end'> {
  signal.throwIfAborted();
  const selected = (await readStudyChapters(page, platform)).filter(c => c.current);
  if (selected.length !== 1 || selected[0].complete !== true || selected[0].locked) return 'pending';
  if (!(await readStudyNavigation(page, platform)).next) return 'end';
  if (!await switchStudyItem(page, platform, 'next', signal)) throw new Error('已完成章节的下一节尚未加载，请检查官方窗口后继续');
  return 'skipped';
}
