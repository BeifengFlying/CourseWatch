import { load } from 'cheerio';
import type { StudyQuestion } from '../../contracts/src/study.js';

export interface StudySearchResult { title: string; url: string; snippet: string; }

// Search only public result summaries. Never send the model Key, platform session,
// screenshots or local reference material to the search service.
export async function searchStudyQuestion(question: StudyQuestion, signal: AbortSignal, request = fetch): Promise<StudySearchResult[]> {
  signal.throwIfAborted();
  const clean = (text: string) => text.replace(/\s+/g, ' ').trim();
  const stem = clean(question.stem).replace(/^\s*\d*[.、．\s]*[【\[]?(?:单选题|多选题|判断题|填空题|简答题)[】\]:：\s]*/, '');
  if (!stem) throw new Error('题干为空，无法联网搜索；未填入或提交');
  const query = clean([stem.slice(0, 500), ...question.options.slice(0, 8).map(option => clean(option).slice(0, 80))].join(' ')).slice(0, 1000);
  const url = new URL('https://cn.bing.com/search');
  url.searchParams.set('q', query);
  const timeout = AbortSignal.any([signal, AbortSignal.timeout(20000)]);
  let html: string;
  try {
    const response = await request(url.href, {
      method: 'GET', redirect: 'error', credentials: 'omit', signal: timeout,
      headers: { Accept: 'text/html', 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.7' },
    });
    if (!response.ok) { await response.body?.cancel(); throw new Error(); }
    const reader = response.body?.getReader();
    if (!reader) throw new Error();
    const chunks: Uint8Array[] = []; let length = 0;
    try {
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        length += chunk.value.byteLength;
        if (length > 2 * 1024 * 1024) throw new Error();
        chunks.push(chunk.value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    html = Buffer.concat(chunks).toString('utf8');
  } catch {
    signal.throwIfAborted();
    throw new Error('联网搜索失败，已暂停；请检查网络后继续，未填入或提交');
  }
  signal.throwIfAborted();
  const $ = load(html), results: StudySearchResult[] = [], seen = new Set<string>();
  $('.b_algo').each((_, row) => {
    const title = clean($(row).find('h2').text()).slice(0, 240);
    const snippet = clean($(row).find('.b_caption p').text()).slice(0, 1200);
    try {
      let source = new URL($(row).find('h2 a').attr('href') || '');
      if (/^(?:www|cn)\.bing\.com$/.test(source.hostname) && source.pathname === '/ck/a') {
        const encoded = source.searchParams.get('u');
        if (!encoded?.startsWith('a1')) return;
        source = new URL(Buffer.from(encoded.slice(2), 'base64url').toString('utf8'));
      }
      if (!/^https?:$/.test(source.protocol) || source.username || source.password || seen.has(source.href) || !title || !snippet || results.length >= 5) return;
      seen.add(source.href); results.push({ title, url: source.href, snippet });
    } catch { /* Ignore malformed search links. Source pages are not fetched. */ }
  });
  if (!results.length) throw new Error('联网搜索未取得可用资料，已暂停；未填入或提交');
  return results;
}
