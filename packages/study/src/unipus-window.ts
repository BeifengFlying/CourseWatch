import { chromium, type Browser, type BrowserContext, type LaunchOptions } from 'playwright';
import { browserStartupArgs } from '../../adapters/src/browser.js';
import { safePlatformUrl } from '../../contracts/src/index.js';
import { unipusPageKind } from '../../contracts/src/study.js';
import { studyBrowserArgs } from './unipus-activity.js';

export function unipusWindowOptions(background: boolean): LaunchOptions {
  // Minimized headed windows can be restored by page scripts, popups or input.
  // A background run must have no onscreen window, including during launch.
  return { headless: background, args: [...browserStartupArgs(), ...studyBrowserArgs] };
}

type State = Awaited<ReturnType<BrowserContext['storageState']>>;
type Launcher = (options: LaunchOptions) => Promise<Browser>;
const officialPage = (url: string) => safePlatformUrl('unipus', url) || unipusPageKind(url) !== 'other';

export class UnipusWindow {
  browser?: Browser;
  context?: BrowserContext;
  background: boolean;
  constructor(private options: LaunchOptions, background: boolean, private launch: Launcher = options => chromium.launch(options)) {
    this.background = background;
  }
  private async create(state: State, background: boolean) {
    const browser = await this.launch({ ...this.options, ...unipusWindowOptions(background) });
    try {
      const context = await browser.newContext({ storageState: state, acceptDownloads: false, viewport: { width: 1220, height: 850 } });
      return { browser, context };
    } catch (error) { await browser.close(); throw error; }
  }
  async start(state: State) {
    const created = await this.create(state, this.background);
    this.browser = created.browser; this.context = created.context;
  }
  // Only the worker's explicit show/resume commands can transfer the session.
  // The caller pauses and drains automation first. This opens the official URL
  // afresh; cookies, localStorage, IndexedDB and per-origin sessionStorage survive,
  // but unsaved DOM controls do not. Submission-attempt guards stay in the worker.
  async switchMode(background: boolean, signal: AbortSignal) {
    signal.throwIfAborted();
    if (background === this.background) return;
    const source = this.context?.pages().filter(p => !p.isClosed()).at(-1);
    if (!source || !this.context || !this.browser) throw new Error('当前没有可打开的学习页面');
    const url = source.url();
    if (!officialPage(url)) throw new Error('当前页面不是 U校园官方页面，请停止后重新开始');
    const state = await this.context.storageState({ indexedDB: true });
    const sessions: Record<string, Record<string, string>> = {};
    for (const frame of source.frames()) {
      if (!officialPage(frame.url())) continue;
      const saved = await frame.evaluate(() => ({ origin: location.origin, values: Object.fromEntries(Object.entries(sessionStorage)) }));
      sessions[saved.origin] = saved.values;
    }
    signal.throwIfAborted();
    const replacement = await this.create(state, background);
    const cancel = () => { void replacement.browser.close().catch(() => {}); };
    signal.addEventListener('abort', cancel, { once: true });
    try {
      signal.throwIfAborted();
      await replacement.context.addInitScript(values => {
        for (const [key, value] of Object.entries(values[location.origin] || {})) if (sessionStorage.getItem(key) === null) sessionStorage.setItem(key, value);
      }, sessions);
      const page = await replacement.context.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      signal.throwIfAborted();
      const previous = this.browser;
      this.browser = replacement.browser; this.context = replacement.context; this.background = background;
      await previous.close();
    } catch (error) { await replacement.browser.close().catch(() => {}); throw error; }
    finally { signal.removeEventListener('abort', cancel); }
  }
}
