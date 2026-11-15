import { z } from 'zod';
import type { Store } from '../../storage/src/index.js';
import { APP_VERSION } from '../../contracts/src/version.js';
import { UPDATE_API_URL, UPDATE_INTERVAL_MS, UPDATE_REPOSITORY, isNewerVersion, versionParts, safeReleasePage, type AppRelease, type AppUpdateStatus } from '../../contracts/src/updates.js';

const Release = z.object({
  tag_name: z.string().max(80), draft: z.boolean(), prerelease: z.boolean(),
  body: z.string().nullable(), html_url: z.string(),
});
// Only project release metadata is fetched; remote text is never executed or rendered as HTML.
export function newestRelease(value: unknown): AppRelease | null {
  if (!Array.isArray(value) || value.length > 20) throw new Error('更新列表格式无效');
  let latest: AppRelease | null = null;
  for (const item of value) {
    const result = Release.safeParse(item);
    if (!result.success || result.data.draft) continue;
    const release = result.data;
    if (!/^v/.test(release.tag_name)) continue;
    const version = release.tag_name.slice(1).replace(/-desktop$/, '');
    if (!versionParts(version)) continue;
    const url = `https://github.com/${UPDATE_REPOSITORY}/releases/tag/${release.tag_name}`;
    if (release.html_url !== url || !safeReleasePage(url)) continue;
    if (!latest || isNewerVersion(version, latest.version) || version === latest.version && url.endsWith('-desktop') && !latest.url.endsWith('-desktop')) latest = {
      version, url, notes: (release.body ?? '').slice(0, 8000), prerelease: release.prerelease,
    };
  }
  return latest;
}

interface UpdateCache { checkedAt: number | null; latest: AppRelease | null; error: string | null; }
export class AppUpdates {
  private pending: Promise<AppUpdateStatus> | undefined;
  private controller: AbortController | undefined;
  private stopped = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(private store: Store, private notify: (release: AppRelease) => void,
    private request: typeof fetch = fetch, private currentVersion = APP_VERSION, private now = Date.now) {
    for (const row of store.all<{ id: number; dedupe: string }>("SELECT id,dedupe FROM outbox WHERE kind='update' AND delivered_at IS NULL")) {
      const version = row.dedupe.replace(/^app-update:/, '');
      if (versionParts(version) && !isNewerVersion(version, currentVersion)) store.run(
        "UPDATE outbox SET delivered_at=?,read_at=COALESCE(read_at,?),error='对应或更高版本已安装，更新记录保留' WHERE id=?",
        now(), now(), row.id,
      );
    }
  }
  status(): AppUpdateStatus {
    const cache = this.store.get<UpdateCache>('appUpdateCache', { checkedAt: null, latest: null, error: null });
    const available = !!cache.latest && isNewerVersion(cache.latest.version, this.currentVersion);
    return { currentVersion: this.currentVersion, automatic: this.store.get('appUpdateAutomatic', true),
      state: this.pending ? 'checking' : cache.error ? 'error' : available ? 'available' : cache.checkedAt === null ? 'idle' : 'current',
      checkedAt: cache.checkedAt, latest: available ? cache.latest : null, error: cache.error };
  }
  setAutomatic(enabled: boolean) {
    this.store.set('appUpdateAutomatic', enabled);
    return this.status();
  }
  check(automatic = false): Promise<AppUpdateStatus> {
    if (this.stopped || automatic && !this.status().automatic) return Promise.resolve(this.status());
    if (this.pending) return this.pending;
    const attempted = this.store.get<number | null>('appUpdateAttemptedAt', null), now = this.now();
    const interval = automatic ? UPDATE_INTERVAL_MS : 60 * 1000;
    if (attempted !== null && now >= attempted && now - attempted < interval) return Promise.resolve(this.status());
    this.store.set('appUpdateAttemptedAt', now);
    this.controller = new AbortController();
    this.pending = this.fetchRelease(this.controller.signal).finally(() => { this.pending = undefined; this.controller = undefined; });
    return this.pending;
  }
  private async fetchRelease(signal: AbortSignal): Promise<AppUpdateStatus> {
    try {
      const response = await this.request(UPDATE_API_URL, {
        method: 'GET', redirect: 'error', credentials: 'omit',
        signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'CourseWatch', 'X-GitHub-Api-Version': '2022-11-28' },
      });
      if (!response.ok) { await response.body?.cancel(); throw new Error('更新服务暂不可用'); }
      const reader = response.body?.getReader();
      if (!reader) throw new Error('更新响应为空');
      const chunks: Uint8Array[] = []; let length = 0;
      try {
        while (true) {
          const chunk = await reader.read(); if (chunk.done) break;
          length += chunk.value.byteLength;
          if (length > 1024 * 1024) throw new Error('更新响应过大');
          chunks.push(chunk.value);
        }
      } finally { await reader.cancel().catch(() => {}); }
      signal.throwIfAborted();
      const latest = newestRelease(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      if (!latest) throw new Error('没有可识别的公开版本');
      this.store.set('appUpdateCache', { checkedAt: this.now(), latest, error: null });
      if (isNewerVersion(latest.version, this.currentVersion)) this.notify(latest);
    } catch {
      if (!this.stopped) {
        const previous = this.store.get<UpdateCache>('appUpdateCache', { checkedAt: null, latest: null, error: null });
        this.store.set('appUpdateCache', { ...previous, error: '未能检查更新，请稍后重试，或前往 GitHub Releases 查看。' });
      }
    }
    // pending is still set until the caller's finally; return the completed state.
    const status = this.status();
    return { ...status, state: status.error ? 'error' : status.latest ? 'available' : status.checkedAt === null ? 'idle' : 'current' };
  }
  start() {
    const tick = async () => {
      try { await this.check(true); } finally {
        if (!this.stopped) this.timer = setTimeout(tick, 60 * 1000);
      }
    };
    if (!this.stopped && !this.timer) this.timer = setTimeout(tick, 30000);
  }
  async close() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.controller?.abort();
    await this.pending;
  }
}
