import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { Frame } from 'playwright';
// Host bridge only. The upstream module is loaded whole, byte-for-byte; no
// upstream startup, UI, navigation, player, model or submission function runs.
let source: Promise<string> | undefined;
async function originalModule() {
  return source ??= (async () => {
    const root = new URL(import.meta.url.endsWith('.ts') ? '../../../third_party/' : '../../../../../third_party/', import.meta.url);
    const manifest = JSON.parse(await readFile(new URL('UPSTREAM-MANIFEST.json', root), 'utf8'));
    const entry = manifest.find((item: any) => item.directory === 'chaoxing-ai-assistant');
    const bytes = await readFile(new URL('chaoxing-ai-assistant/course_catalog.js', root));
    if (createHash('sha256').update(bytes).digest('hex') !== entry?.files['course_catalog.js']) throw new Error('上游目录模块校验失败，请恢复原始文件');
    return bytes.toString('utf8');
  })();
}
export async function readUpstreamCatalog(frame: Frame): Promise<{name: string;complete: boolean|null;pending?: number}[]> {
  const raw = await originalModule();
  // Supply only the host contracts required by the read function. Score storage
  // is local to this call; read-only progress queries never persist scores.
  const wrapper = `(() => {
    const clean = value => String(value ?? '').replace(/\\s+/g, ' ').trim();
    const isCourseHomeURL = () => false;
    const isCourseStudyURL = value => !!value && /\\/(?:mooc-ans\\/)?mycourse\\/studentstudy\\/?$/.test(value.pathname);
    const memory = new Map();
    const get = (key, fallback) => memory.has(key) ? memory.get(key) : fallback;
    const set = (key, value) => memory.set(key, value);
    ${raw}
    const catalog = readCourseCatalog(document);
    return (catalog?.entries || []).filter(entry => !entry.isGroup).slice(0, 400).map(entry => ({
      name: [entry.number, entry.title].filter(Boolean).join(' ').slice(0,300),
      complete: entry.completed === true ? true : entry.pending > 0 ? false : null,
      ...(entry.pending !== null ? {pending: entry.pending} : {})
    }));
  })()`;
  return await frame.evaluate(wrapper) as Awaited<ReturnType<typeof readUpstreamCatalog>>;
}
