import type { Page } from 'playwright';
import type { StudyPlatform } from '../../contracts/src/study.js';
import { assertPageAllowed, nextNativeTab, pauseMedia } from './page.js';
import { pauseUnipusMedia, unipusFrames } from './unipus-page.js';
import { switchStudyItem } from './navigation.js';

// Only navigate through unlocked official controls. Skipping never marks a task complete.
export async function skipStudyCheck(page: Page, platform: StudyPlatform, signal: AbortSignal) {
  signal.throwIfAborted();
  if (platform === 'chaoxing') {
    if (!await assertPageAllowed(page, true)) return false;
    await pauseMedia(page); signal.throwIfAborted();
    if (await nextNativeTab(page, signal)) return true;
  } else {
    await unipusFrames(page); await pauseUnipusMedia(page); signal.throwIfAborted();
  }
  return switchStudyItem(page, platform, 'next', signal);
}
