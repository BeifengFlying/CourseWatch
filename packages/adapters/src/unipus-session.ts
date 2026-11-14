import type { BrowserContext } from 'playwright';
import type { Vault } from './vault.js';
type BrowserState = Awaited<ReturnType<BrowserContext['storageState']>>;

// Portal 5.0 stores its SSO session in PORTAL_STATE_PERSISTENT; the course app
// still reads __token. Restore that issued token only
// when it matches the saved official jwt cookie. Never create or extend tokens.
export function unipusBrowserState(state: BrowserState): BrowserState {
  const restored = structuredClone(state);
  const origin = restored.origins.find(o => o.origin === 'https://uai.unipus.cn');
  if (!origin) return restored;
  try {
    const token = JSON.parse(origin.localStorage.find(v => v.name === 'PORTAL_STATE_PERSISTENT')?.value || '{}').tokenInfo;
    const cookie = restored.cookies.find(c => c.name === 'jwt' && ['.unipus.cn','uai.unipus.cn'].includes(c.domain) && c.path === '/' && (c.expires === -1 || c.expires * 1000 > Date.now()));
    if (!cookie || !token || typeof token.jwt !== 'string' || !token.jwt || token.jwt !== cookie.value || typeof token.rt !== 'string' || !Number.isFinite(token.jwtExpire) || !Number.isFinite(token.rtExpire)) return restored;
    const entry = origin.localStorage.find(v => v.name === '__token');
    if (entry) entry.value = JSON.stringify(token);
    else origin.localStorage.push({name:'__token',value:JSON.stringify(token)});
  } catch { /* Incomplete saved sessions continue through the official login flow. */ }
  return restored;
}

function portalToken(state: BrowserState | undefined) {
  try { return JSON.parse(state?.origins.find(o => o.origin === 'https://uai.unipus.cn')?.localStorage.find(v => v.name === 'PORTAL_STATE_PERSISTENT')?.value || '{}').tokenInfo; }
  catch { return undefined; }
}
export function canRestoreUnipusSession(state: BrowserState) {
  const token = portalToken(state);
  return typeof token?.jwt === 'string' && !!token.jwt && typeof token.rt === 'string' && !!token.rt;
}

// An older scan or worker must not replace a session saved by a newer login.
export async function saveUnipusSession(vault: Pick<Vault,'read'|'save'>, baseline: BrowserState, candidate: BrowserState): Promise<BrowserState> {
  const current = await vault.read('unipus') as BrowserState | undefined;
  const before = portalToken(baseline), next = portalToken(candidate), latest = portalToken(current);
  if (!current || !before?.jwt || !next?.jwt || !latest?.jwt || latest.jwt !== before.jwt && latest.jwt !== next.jwt) return current || baseline;
  if (JSON.stringify(current) !== JSON.stringify(candidate)) await vault.save('unipus', candidate);
  return candidate;
}

export function trackUnipusSession(context: BrowserContext, vault: Pick<Vault,'read'|'save'>, initial: BrowserState) {
  let baseline = initial, pending = Promise.resolve(), stopped = false;
  const flush = () => {
    pending = pending.catch(() => {}).then(async () => {
      if (!portalToken(baseline)?.jwt) return;
      const state = await context.storageState({indexedDB:true});
      if (!portalToken(state)?.jwt) return;
      const saved = await saveUnipusSession(vault,baseline,state);
      // Do not adopt a different session: this browser still belongs to baseline.
      if (portalToken(saved)?.jwt === portalToken(state)?.jwt) baseline = state;
    });
    return pending;
  };
  const timer = setInterval(() => { if (!stopped) void flush().catch(() => {}); }, 60000);
  timer.unref();
  return { flush, async stop() { stopped = true; clearInterval(timer); await flush(); } };
}

// Let the official portal use its own saved refresh token. No token endpoint,
// expiry or credential is constructed by CourseWatch.
export async function restoreUnipusSession(state: BrowserState): Promise<BrowserState> {
  const { chromium } = await import('playwright');
  const { browserLaunchOptions } = await import('./browser.js');
  const { courseReader } = await import('./course-http.js');
  const { parseUnipusCourses, unipusHeaders, unipusUrls } = await import('./unipus.js');
  const browser = await chromium.launch({...await browserLaunchOptions(),headless:true});
  try {
    const context = await browser.newContext({storageState:unipusBrowserState(state),acceptDownloads:false});
    const page = await context.newPage();
    await page.goto('https://uai.unipus.cn/home',{waitUntil:'domcontentloaded',timeout:20000});
    await page.getByText('我的课程',{exact:true}).filter({visible:true}).first().waitFor({timeout:12000});
    await page.locator('#root-loading').waitFor({state:'hidden',timeout:5000});
    const refreshed = await context.storageState({indexedDB:true});
    parseUnipusCourses(await courseReader(context.request,'unipus')(unipusUrls.courses,unipusHeaders(refreshed)));
    return refreshed;
  } finally { await browser.close(); }
}
