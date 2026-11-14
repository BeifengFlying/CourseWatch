import type { StudyConfig, StudyPlatform } from '../../../packages/contracts/src/study';
// Unsaved credentials stay in memory only, including when changing pages.
export const studyDrafts = new Map<StudyPlatform, { config: StudyConfig; key: string; skillsAccepted: boolean }>();
