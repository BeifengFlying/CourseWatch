import { mkdtempSync, rmSync, existsSync, readFileSync, statSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { StudyConfig, type StudyQuestion } from '../packages/contracts/src/study.js';
import { StudySkills, answerWithSkills } from '../packages/study/src/skills.js';
let dir: string;
const question: StudyQuestion = { id: 'q1', type: 'single', stem: '选择现在完成时的句子', options: ['have finished', 'finished'], slots: 1 };
const draft = { topic: '现在完成时', keywords: ['现在完成时', 'have'], method: '先核对时间状语，再检查 have/has 与过去分词。' };
const signal = () => new AbortController().signal;
const response = (skill: unknown = draft, answers = ['1']) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ answers, explanation: '模拟解析', skill }) }, finish_reason: 'stop' }], usage: { prompt_tokens: 30, completion_tokens: 20 } }));
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cw-skills-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

it('默认关闭时不读取、不总结、不保存，即使模型返回 Skill', async () => {
  const skills = new StudySkills(dir, 'chaoxing'), related = vi.spyOn(skills, 'related');
  const request = vi.fn().mockResolvedValue(response());
  await answerWithSkills(StudyConfig.parse({ model: 'fixture' }), 'fixture-key', question, signal(), undefined, skills, vi.fn(), request);
  expect(related).not.toHaveBeenCalled(); expect(existsSync(skills.path)).toBe(false);
  expect(request.mock.calls[0][1].body).not.toContain('referenceSkills');
});
it('明确开启后只参考已有摘要，答案不附带新摘要，不增加模型请求；平台隔离', async () => {
  const skills = new StudySkills(dir, 'chaoxing'), config = StudyConfig.parse({ model: 'fixture', localSkills: true });
  await skills.remember(question,draft,signal());
  const request = vi.fn().mockImplementation(async () => response());
  const first = await answerWithSkills(config, 'fixture-key', question, signal(), undefined, skills, vi.fn(), request);
  expect(first).toMatchObject({ inputTokens: 30, outputTokens: 20 }); expect(request).toHaveBeenCalledTimes(1);
  const second = new StudySkills(dir, 'chaoxing');
  await answerWithSkills(config, 'fixture-key', { ...question, id: 'another-task' }, signal(), undefined, second, vi.fn(), request);
  const content = JSON.parse(request.mock.calls[1][1].body).messages.at(-1).content;
  expect(JSON.parse(content).referenceSkills).toEqual([draft]);
  expect(JSON.parse(request.mock.calls[0][1].body).messages[0].content).toContain('不要输出摘要、skill 字段');
  expect(JSON.parse(readFileSync(skills.path, 'utf8')).items[0].observations).toBe(1);
  expect(await second.related({ ...question, type: 'blank' })).toEqual([]);
  expect(await second.related({ ...question, stem: '计算积分', options: ['零', '一'] })).toEqual([]);
  expect(await new StudySkills(dir, 'unipus').related(question)).toEqual([]);
  expect(readFileSync(skills.path, 'utf8')).not.toContain('fixture-key');
  if (process.platform !== 'win32') expect(statSync(skills.path).mode & 0o777).toBe(0o600);
});
it('不保存无法校验的摘要、无效答案或已取消请求', async () => {
  const skills = new StudySkills(dir, 'chaoxing'), config = StudyConfig.parse({ localSkills: true });
  await answerWithSkills(config, 'fixture', question, signal(), undefined, skills, vi.fn(), vi.fn().mockResolvedValue(response({ method: 'incomplete' })));
  expect(existsSync(skills.path)).toBe(false);
  await expect(answerWithSkills(config, 'fixture', question, signal(), undefined, skills, vi.fn(), vi.fn().mockResolvedValue(response(draft, ['9'])))).rejects.toThrow();
  const abort = new AbortController(); abort.abort();
  await expect(skills.remember(question, draft, abort.signal)).rejects.toThrow(); expect(existsSync(skills.path)).toBe(false);
});
it('首次空答案记录重做，第二次成功才返回答案；请求上限阻止额外调用', async () => {
  const skills = new StudySkills(dir, 'chaoxing'), config = StudyConfig.parse({ model: 'fixture' });
  const request = vi.fn().mockResolvedValueOnce(response(undefined, [])).mockResolvedValueOnce(response());
  const log = vi.fn(), retry = vi.fn();
  await expect(answerWithSkills(config, 'key', question, signal(), undefined, skills, log, request, undefined, retry))
    .resolves.toMatchObject({ answers: ['1'], inputTokens: 60, outputTokens: 40 });
  expect(log).toHaveBeenCalledWith('模型首次返回空答案，正在重新作答（第 2 次）');
  expect(retry).toHaveBeenCalledTimes(1); expect(request).toHaveBeenCalledTimes(2);
  const limited = vi.fn().mockResolvedValueOnce(response(undefined, []));
  await expect(answerWithSkills(config, 'key', question, signal(), undefined, skills, log, limited, undefined, () => {
    throw new Error('已达到本轮模型请求上限');
  })).rejects.toThrow('已达到本轮模型请求上限');
  expect(limited).toHaveBeenCalledTimes(1);
});
it('两次空答案后记录第三次联网作答和实际来源，第三次计入请求回调', async () => {
  const skills = new StudySkills(dir, 'chaoxing'), log = vi.fn(), retry = vi.fn();
  const request = vi.fn().mockResolvedValueOnce(response(undefined, [])).mockResolvedValueOnce(response(undefined, []))
    .mockResolvedValueOnce(new Response('<li class="b_algo"><h2><a href="https://reference.example/grammar">语法资料</a></h2><div class="b_caption"><p>现在完成时使用 have/has</p></div></li>'))
    .mockResolvedValueOnce(response());
  await expect(answerWithSkills(StudyConfig.parse({ model: 'fixture' }), 'key', question, signal(), undefined, skills, log, request, undefined, retry))
    .resolves.toMatchObject({ answers: ['1'], inputTokens: 90, outputTokens: 60 });
  expect(retry).toHaveBeenCalledTimes(2);
  expect(log).toHaveBeenCalledWith('模型连续两次返回空答案，正在联网搜索后重新作答（第 3 次）');
  expect(log).toHaveBeenCalledWith('检索来源：语法资料 https://reference.example/grammar');
});

function emptyThirdRequest(reason?: string) {
  const raw = JSON.stringify({ answers: [], ...(reason ? { reason } : {}) });
  const request = vi.fn().mockResolvedValueOnce(response(undefined, [])).mockResolvedValueOnce(response(undefined, []))
    .mockResolvedValueOnce(new Response('<li class="b_algo"><h2><a href="https://reference.example/grammar">语法资料</a></h2><div class="b_caption"><p>现在完成时使用 have/has</p></div></li>'))
    .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: raw }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } })));
  return { request, raw };
}

it('第三次空答案先保存原因和完整原始回复到独立本地日志，再抛出暂停错误', async () => {
  const skills = new StudySkills(dir, 'unipus'), log = vi.fn();
  const reason = '检索摘要缺少时间状语，无法区分两个选项。';
  const { request, raw } = emptyThirdRequest(reason);
  await expect(answerWithSkills(StudyConfig.parse({ model: 'fixture' }), 'private-key', question, signal(), undefined, skills, log, request))
    .rejects.toThrow('模型第三次经联网检索后仍返回空答案');
  expect(log).toHaveBeenCalledWith(`第三次空答案原因：${reason}`);
  expect(log).toHaveBeenCalledWith(`第三次模型原始回复：${raw}`);
  const folder = join(dir, 'study-model-logs'), files = readdirSync(folder);
  expect(files).toHaveLength(1); expect(files[0]).toMatch(/-unipus-.*\.json$/);
  const path = join(folder, files[0]), stored = readFileSync(path, 'utf8');
  expect(JSON.parse(stored)).toMatchObject({ version: 1, platform: 'unipus', model: 'fixture', attempt: 3, question,
    reason, reasonMissing: false, rawResponse: raw, inputTokens: 70, outputTokens: 45,
    searchResults: [{ title: '语法资料', url: 'https://reference.example/grammar', snippet: '现在完成时使用 have/has' }] });
  expect(stored).not.toContain('private-key');
  expect(log).toHaveBeenCalledWith(`本地失败日志已保存：study-model-logs/${files[0]}`);
  if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600);
  expect(request).toHaveBeenCalledTimes(4);
});

it('模型漏填原因时记录未返回原因，多次失败分别保留日志文件', async () => {
  const skills = new StudySkills(dir, 'chaoxing'), log = vi.fn();
  for (let i = 0; i < 2; i++) {
    const { request, raw } = emptyThirdRequest();
    await expect(answerWithSkills(StudyConfig.parse({ model: 'fixture' }), 'key', question, signal(), undefined, skills, log, request)).rejects.toThrow('仍返回空答案');
    expect(log).toHaveBeenCalledWith(`第三次模型原始回复：${raw}`);
    expect(request).toHaveBeenCalledTimes(4);
  }
  expect(log).toHaveBeenCalledWith('第三次空答案原因：模型未返回原因');
  const folder = join(dir, 'study-model-logs'), files = readdirSync(folder);
  expect(files).toHaveLength(2);
  for (const name of files) expect(JSON.parse(readFileSync(join(folder, name), 'utf8'))).toMatchObject({ reason: null, reasonMissing: true });
});

it('日志目录不可写时保留本轮记录及原暂停原因，不重试模型或误报保存成功', async () => {
  const blocked = join(dir, 'file'); writeFileSync(blocked, 'fixture');
  const skills = new StudySkills(blocked, 'chaoxing'), log = vi.fn(), { request } = emptyThirdRequest('检索资料相互冲突。');
  await expect(answerWithSkills(StudyConfig.parse({ model: 'fixture' }), 'key', question, signal(), undefined, skills, log, request)).rejects.toThrow('模型第三次经联网检索后仍返回空答案');
  expect(log).toHaveBeenCalledWith('第三次空答案原因：检索资料相互冲突。');
  expect(log).toHaveBeenCalledWith('本地失败日志写入失败，原因及原始回复保留在本轮运行记录');
  expect(log.mock.calls.some(([text]) => text.startsWith('本地失败日志已保存'))).toBe(false);
  expect(request).toHaveBeenCalledTimes(4);
});
