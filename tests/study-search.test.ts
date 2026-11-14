import { expect, it, vi } from 'vitest';
import { searchStudyQuestion } from '../packages/study/src/search.js';

const question = { id: '1', stem: '1.【单选题】DNA 的化学本质', type: 'single' as const, options: ['甲', '乙'], slots: 1 };
const row = (url: string, text = '公开资料摘要') => `<li class="b_algo"><h2><a href="${url}">资料标题</a></h2><div class="b_caption"><p>${text}</p></div></li>`;

it('读取真实结果结构，过滤无效链接及重复项，最多五项并解码必应跳转链接', async () => {
  const encoded = 'https://www.bing.com/ck/a?u=a1' + Buffer.from('https://source.example/one').toString('base64url');
  const html = row('javascript:alert(1)') + row('https://key@source.example/secret') + row(encoded, '甲 &amp; 乙') + row('https://source.example/one')
    + Array.from({ length: 8 }, (_, i) => row(`https://source.example/${i}`)).join('');
  const request = vi.fn().mockResolvedValue(new Response(html));
  const results = await searchStudyQuestion(question, new AbortController().signal, request);
  expect(results).toHaveLength(5);
  expect(results[0]).toEqual({ title: '资料标题', url: 'https://source.example/one', snippet: '甲 & 乙' });
  expect(request).toHaveBeenCalledOnce();
  const [url, options] = request.mock.calls[0];
  expect(new URL(url).searchParams.get('q')).toBe('DNA 的化学本质 甲 乙');
  expect(options).toMatchObject({ method: 'GET', redirect: 'error', credentials: 'omit' });
});

it('搜索超时、错误、验证页面及响应过大时明确报错且不跟随来源网页', async () => {
  for (const reply of [new Response('unavailable', { status: 429 }), new Response('<html>验证</html>'), new Response('x'.repeat(2 * 1024 * 1024 + 1))]) {
    const request = vi.fn().mockResolvedValue(reply);
    await expect(searchStudyQuestion(question, new AbortController().signal, request)).rejects.toThrow(/联网搜索/);
    expect(request).toHaveBeenCalledOnce();
  }
  const request = vi.fn().mockRejectedValue(new DOMException('timeout', 'TimeoutError'));
  await expect(searchStudyQuestion(question, new AbortController().signal, request)).rejects.toThrow('联网搜索失败');
});

it('空题干或已取消不发起搜索，查询及每条摘要均有大小限制', async () => {
  const controller = new AbortController(); controller.abort();
  const request = vi.fn();
  await expect(searchStudyQuestion(question, controller.signal, request)).rejects.toThrow();
  await expect(searchStudyQuestion({ ...question, stem: '' }, new AbortController().signal, request)).rejects.toThrow('题干为空');
  expect(request).not.toHaveBeenCalled();
  request.mockResolvedValue(new Response(row('https://source.example/one', '字'.repeat(5000))));
  const results = await searchStudyQuestion({ ...question, stem: '题'.repeat(10000), options: Array(30).fill('选项'.repeat(1000)) }, new AbortController().signal, request);
  expect(new URL(request.mock.calls[0][0]).searchParams.get('q')!.length).toBeLessThanOrEqual(1000);
  expect(results[0].snippet).toHaveLength(1200);
});
