import { expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { StudyConfig, STUDY_NOTICE_VERSION } from '../packages/contracts/src/study.js';

const fixture = vi.hoisted(() => ({ page: null as any }));
vi.mock('../packages/adapters/src/vault.js', () => ({ Vault: class { async read() { return { cookies: [], origins: [] }; } } }));
vi.mock('../packages/adapters/src/browser.js', () => ({ browserLaunchOptions: async () => ({ channel: 'chromium' }), browserStartupArgs: () => [] }));
vi.mock('../packages/study/src/window.js', () => ({ studyWindowOptions: () => ({ headless: true }), setStudyWindow: async () => {}, showStudyWindow: async () => {} }));
vi.mock('../packages/study/src/launch.js', () => ({ openCourse: async (context: any) => {
  const page = await context.newPage(); fixture.page = page;
  await page.route('**/*', (route: any) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `
    <ul id="prev_tab"><li id="dct1" class="active" data-completed="false">章节检测</li></ul>
    <div class="TiMu" id="q1"><h3>单选题：第一题</h3><label><input type="radio" name="q1">甲</label><label><input type="radio" name="q1">乙</label></div>
    <div class="TiMu" id="q2"><h3>单选题：第二题</h3><label><input type="radio" name="q2">甲</label><label><input type="radio" name="q2">乙</label></div>
    <button onclick="document.body.dataset.submitted='yes'">提交</button>` }));
  await page.goto('https://mooc1.chaoxing.com/mycourse/studentstudy?chapterId=1'); return page;
} }));

it('运行任务首次空答案重做，后续题第三次联网作答仍空时暂停且不填入提交', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-empty-answer-'));
  const previousListeners = new Map(['message', 'SIGTERM', 'disconnect'].map(event => [event, new Set(process.listeners(event))]));
  const previousSend = process.send, messages: any[] = [];
  process.send = ((message: any) => { messages.push(structuredClone(message)); return true; }) as any;
  const exit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
  const response = (answers: string[]) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ answers }) }, finish_reason: 'stop' }] }));
  const fetcher = vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(response([])).mockResolvedValueOnce(response(['2']))
    .mockResolvedValueOnce(response([])).mockResolvedValueOnce(response([]))
    .mockResolvedValueOnce(new Response('<li class="b_algo"><h2><a href="https://reference.example/lesson">资料</a></h2><div class="b_caption"><p>可用摘要</p></div></li>'))
    .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '{"answers":[],"reason":"检索摘要未说明选项对应关系。"}' }, finish_reason: 'stop' }] })));
  try {
    await import('../packages/study/src/worker.js');
    process.emit('message', { action: 'start', dir, config: StudyConfig.parse({
      enabled: true, noticeVersion: STUDY_NOTICE_VERSION, model: 'fixture-model', answerExercises: true, autoSubmitPractice: true,
    }), key: 'fixture-key', options: { operation: 'answers' } }, undefined);
    await vi.waitFor(() => expect(messages.some(m => m.status?.phase === 'paused')).toBe(true), { timeout: 10000 });
    const status = messages.findLast(m => m.status?.phase === 'paused').status;
    expect(status.message).toBe('模型第三次经联网检索后仍返回空答案，已暂停；未填入或提交');
    expect(status.requests).toBe(5); expect(fetcher).toHaveBeenCalledTimes(6);
    expect(status.answers).toHaveLength(1); expect(status.answers[0].answers).toEqual(['2']);
    expect(status.modelActivity).toMatchObject({ question: 2, total: 2, phase: 'interrupted' });
    expect(messages.some(m => m.status?.phase === 'running' && m.status?.message.includes('首次返回空答案'))).toBe(true);
    expect(messages.some(m => m.status?.message.includes('第 3 次'))).toBe(true);
    expect(status.logs.some((entry: any) => entry.message.includes('https://reference.example/lesson'))).toBe(true);
    expect(status.logs.some((entry: any) => entry.message === '第三次空答案原因：检索摘要未说明选项对应关系。')).toBe(true);
    expect(status.modelActivity.answer).toBe('{"answers":[],"reason":"检索摘要未说明选项对应关系。"}');
    const folder = join(dir, 'study-model-logs'), files = readdirSync(folder);
    expect(files).toHaveLength(1);
    expect(JSON.parse(readFileSync(join(folder, files[0]), 'utf8'))).toMatchObject({ reason: '检索摘要未说明选项对应关系。', question: { id: 'q2' }, attempt: 3 });
    expect(await fixture.page.locator('input:checked').count()).toBe(0);
    expect(await fixture.page.locator('body').getAttribute('data-submitted')).toBeNull();
  } finally {
    process.emit('message', { action: 'stop' }, undefined);
    await vi.waitFor(() => expect(exit.mock.calls.length).toBeGreaterThanOrEqual(2), { timeout: 6000 });
    for (const [event, before] of previousListeners) for (const listener of process.listeners(event)) if (!before.has(listener)) process.removeListener(event, listener);
    process.send = previousSend; exit.mockRestore(); fetcher.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  }
});
