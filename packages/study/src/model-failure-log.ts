import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { StudyPlatform, StudyQuestion } from '../../contracts/src/study.js';
import type { EmptyStudyAnswerError } from './model.js';

// Keep model failure content locally, separate from the redacted system journal.
// Do not serialize request headers, platform sessions or the model request body.
export async function saveModelFailure(dir: string, platform: StudyPlatform, model: string, question: StudyQuestion, error: EmptyStudyAnswerError) {
  const at = Date.now(), name = `${at}-${platform}-${randomUUID()}.json`;
  const folder = join(dir, 'study-model-logs'), path = join(folder, name), temporary = `${path}.tmp`;
  await mkdir(folder, { recursive: true, mode: 0o700 });
  try {
    await writeFile(temporary, JSON.stringify({
      version: 1, at, platform, model, attempt: 3, question,
      reason: error.reason, reasonMissing: error.reason === null,
      rawResponse: error.rawResponse, searchResults: error.searchResults,
      inputTokens: error.inputTokens, outputTokens: error.outputTokens,
    }, null, 2), { mode: 0o600, flag: 'wx' });
    await rename(temporary, path);
  } finally { await unlink(temporary).catch(() => {}); }
  return name;
}
