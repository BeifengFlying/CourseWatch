import type { ModelProgress } from "./model-stream.js";
import { mkdir, readFile, rename, stat, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { StudyConfig, StudyPlatform, StudyQuestion } from '../../contracts/src/study.js';
import { answerQuestion, EmptyStudyAnswerError, SkillDraft } from './model.js';
import { saveModelFailure } from './model-failure-log.js';

const Skill = SkillDraft.extend({ type: z.enum(['single', 'multiple', 'judge', 'blank', 'text']), observations: z.number().int().positive(), updatedAt: z.number() });
const File = z.object({ version: z.literal(1), items: z.array(Skill).max(40) });
type Entry = z.infer<typeof Skill>;

// Model-authored reference text only. Never execute it or treat it as a verified answer.
export class StudySkills {
  readonly path: string;
  constructor(readonly dir: string, readonly platform: StudyPlatform) { this.path = join(dir, 'study-skills', `${platform}.json`); }
  private async read(): Promise<Entry[]> {
    try {
      if ((await stat(this.path)).size > 256 * 1024) throw new Error('本地 Skill 文件超过大小上限');
      return File.parse(JSON.parse(await readFile(this.path, 'utf8'))).items;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  }
  async related(question: StudyQuestion) {
    const text = `${question.stem} ${question.options.join(' ')}`.toLowerCase();
    return (await this.read()).filter(item => item.type === question.type)
      .map(item => ({ item, score: item.keywords.filter(word => text.includes(word.toLowerCase())).length }))
      .filter(row => row.score > 0).sort((a, b) => b.score - a.score || b.item.updatedAt - a.item.updatedAt)
      .slice(0, 3).map(({ item }) => ({ topic: item.topic, keywords: item.keywords, method: item.method }));
  }
  async remember(question: StudyQuestion, draft: z.infer<typeof SkillDraft>, signal: AbortSignal) {
    const value = SkillDraft.parse(draft), items = await this.read();
    const old = items.find(item => item.type === question.type && item.topic === value.topic);
    const updated = { ...value, type: question.type, observations: (old?.observations || 0) + 1, updatedAt: Date.now() };
    const data = File.parse({ version: 1, items: [...items.filter(item => item !== old), updated].slice(-40) });
    signal.throwIfAborted();
    await mkdir(join(this.dir, 'study-skills'), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(data, null, 2), { mode: 0o600 });
      signal.throwIfAborted(); await rename(temporary, this.path);
    } finally { await unlink(temporary).catch(() => {}); }
  }
}

export async function answerWithSkills(config: StudyConfig, key: string, question: StudyQuestion, signal: AbortSignal, image: string | undefined, skills: StudySkills, log: (message: string) => void, request = fetch, onProgress?: ModelProgress, onRetry?: () => void) {
  let references: z.infer<typeof SkillDraft>[] = [];
  if (config.localSkills) {
    try { references = await skills.related(question); if (references.length) log(`已读取 ${references.length} 条同类题 Skill，供模型参考`); }
    catch { log('本地 Skill 读取失败，本题仅按题目请求模型'); }
  }
  const output = await answerQuestion(config, key, question, signal, image, request, config.localSkills ? references : undefined, onProgress, attempt => {
    onRetry?.();
    log(attempt === 2 ? '模型首次返回空答案，正在重新作答（第 2 次）' : '模型连续两次返回空答案，正在联网搜索后重新作答（第 3 次）');
  }, results => {
    log(`联网搜索取得 ${results.length} 条网页摘要，正在核对题干和选项`);
    for (const result of results) log(`检索来源：${result.title} ${result.url}`);
  }).catch(async error => {
    if (error instanceof EmptyStudyAnswerError) {
      log(`第三次空答案原因：${error.reason ?? '模型未返回原因'}`);
      log(`第三次模型原始回复：${error.rawResponse.slice(0, 24000)}${error.rawResponse.length > 24000 ? '（运行记录仅展示前 24000 字符，完整回复见本地失败日志）' : ''}`);
      try {
        const name = await saveModelFailure(skills.dir, skills.platform, config.model, question, error);
        log(`本地失败日志已保存：study-model-logs/${name}`);
      } catch {
        log('本地失败日志写入失败，原因及原始回复保留在本轮运行记录');
      }
    }
    throw error;
  });
  signal.throwIfAborted();
  return output;
}
