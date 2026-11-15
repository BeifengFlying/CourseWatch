import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../packages/storage/src/index.js';
import { Engine } from '../packages/core/src/index.js';
import { AppUpdates, newestRelease } from '../packages/core/src/updates.js';
import { UPDATE_API_URL, UPDATE_INTERVAL_MS, isNewerVersion, releasePage, safeReleasePage } from '../packages/contracts/src/updates.js';
import { defaultMobileNotifications } from '../packages/contracts/src/mobile-notifications.js';
let dir: string, store: Store, engine: Engine, now: number, updates: AppUpdates;
const release = (version = '0.2.34', extra = {}) => ({ tag_name: `v${version}`, draft: false, prerelease: true,
  html_url: releasePage(version), body: '修复任务提醒\n<script>no execution</script>', ...extra });
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cw-updates-')); store = new Store(join(dir, 'data.db')); engine = new Engine(store); now = 100000; });
afterEach(async () => { await updates?.close(); store.close(); rmSync(dir, { recursive: true, force: true }); });
function checker(request: typeof fetch, current = '0.2.32') {
  return new AppUpdates(store, value => engine.enqueue(`app-update:${value.version}`, '新版本', value.url, null, 'update'), request, current, () => now);
}
it('按数字比较补丁及主次版本，拒绝非版本和非项目下载地址', () => {
  expect(isNewerVersion('0.2.100', '0.2.99')).toBe(true);
  expect(isNewerVersion('0.10.0', '0.9.99')).toBe(true);
  expect(isNewerVersion('1.0.0', '0.99.99')).toBe(true);
  for (const candidate of ['0.2.31', '0.2.32', '0.2.33-build33', '01.2.33', '0.2.999999999999999999999', '0.2.x']) expect(isNewerVersion(candidate, '0.2.32')).toBe(false);
  expect(safeReleasePage(releasePage('0.2.34'))).toBe(true);
  expect(safeReleasePage(`${releasePage('0.2.34')}-desktop`)).toBe(true);
  for (const url of ['https://github.com.evil.example/BeifengFlying/CourseWatch/releases/tag/v0.2.34', 'javascript:alert(1)', `${releasePage('0.2.34')}?redirect=evil`, releasePage('0.2.34').replace('CourseWatch', 'other'), releasePage('0.2.34').replace('https://', 'http://')]) expect(safeReleasePage(url)).toBe(false);
});
it('选择最高公开版本，包含测试版，忽略草稿、无效元数据和伪造链接', () => {
  expect(newestRelease([release('0.2.34'), release('0.3.0', { draft: true }), release('0.2.35'), release('0.4.0', { html_url: 'https://evil.example' }), release('0.2.36', { tag_name: 'not-a-version' })])).toMatchObject({ version: '0.2.35', prerelease: true });
  expect(newestRelease([])).toBeNull();
  expect(() => newestRelease({ message: 'rate limited' })).toThrow();
  expect(newestRelease([release('0.2.34'), release('0.2.34', { tag_name: 'v0.2.34-desktop', html_url: `${releasePage('0.2.34')}-desktop` })])).toMatchObject({ version: '0.2.34', url: `${releasePage('0.2.34')}-desktop` });
});
it('只请求固定 GitHub 元数据且不携带用户凭据；每日检查、同版本去重，不加入邮件或网页推送', async () => {
  store.set('mobileNotifications', { ...defaultMobileNotifications, email: { ...defaultMobileNotifications.email, enabled: true } });
  const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify([release()])));
  updates = checker(request);
  expect(updates.status()).toMatchObject({ state: 'idle', automatic: true, currentVersion: '0.2.32' });
  expect(await updates.check(true)).toMatchObject({ state: 'available', latest: { version: '0.2.34' }, checkedAt: now });
  const [url, options] = request.mock.calls[0];
  expect(url).toBe(UPDATE_API_URL);
  expect(options).toMatchObject({ redirect: 'error', credentials: 'omit', method: 'GET' });
  expect(options?.body).toBeUndefined();
  expect(options?.headers).not.toHaveProperty('Authorization');
  expect(options?.headers).not.toHaveProperty('Cookie');
  await updates.check(true); expect(request).toHaveBeenCalledTimes(1);
  now += UPDATE_INTERVAL_MS;
  request.mockResolvedValueOnce(new Response(JSON.stringify([release()])));
  await updates.check(true);
  expect(request).toHaveBeenCalledTimes(2);
  expect(store.all('SELECT * FROM outbox WHERE kind=?', 'update')).toHaveLength(1);
  expect(store.all('SELECT * FROM notification_deliveries')).toHaveLength(0);
});
it('关闭自动检查仍可手动检查；并发请求复用，重启后保留检查间隔及设置', async () => {
  let resolve!: (response: Response) => void;
  const request = vi.fn<typeof fetch>().mockImplementation(() => new Promise(value => { resolve = value; }));
  updates = checker(request); updates.setAutomatic(false);
  await updates.check(true); expect(request).not.toHaveBeenCalled();
  const first = updates.check(), concurrent = updates.check();
  expect(first).toBe(concurrent);
  expect(updates.status().state).toBe('checking');
  resolve(new Response(JSON.stringify([release()]))); await first;
  await updates.close(); updates = checker(request);
  expect(updates.status()).toMatchObject({ automatic: false, state: 'available' });
  await updates.check(); expect(request).toHaveBeenCalledTimes(1);
});
it('升级后不再把相同或更低版本显示为更新', async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify([release()])));
  updates = checker(request); await updates.check(); await updates.close();
  updates = checker(request, '0.2.34');
  expect(updates.status()).toMatchObject({ state: 'current', latest: null });
  expect(store.all<any>("SELECT * FROM outbox WHERE kind='update'")[0]).toMatchObject({ delivered_at: now, read_at: now });
});
it.each(['rate-limit', 'invalid-json', 'empty', 'oversized'] as const)('%s 检查失败不误报最新，保留上次成功版本及时间', async failure => {
  const request = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify([release()])));
  updates = checker(request); await updates.check();
  const checkedAt = now; now += UPDATE_INTERVAL_MS;
  const response = failure === 'rate-limit' ? new Response('{}', { status: 403 })
    : failure === 'invalid-json' ? new Response('not-json')
    : failure === 'empty' ? new Response('[]') : new Response('x'.repeat(1024 * 1024 + 1));
  request.mockResolvedValueOnce(response);
  expect(await updates.check()).toMatchObject({ state: 'error', latest: { version: '0.2.34' }, checkedAt, error: expect.stringContaining('未能检查更新') });
  expect(store.all('SELECT * FROM outbox WHERE kind=?', 'update')).toHaveLength(1);
});
it('退出中止进行中的检查，不保存关闭引起的错误', async () => {
  const request = vi.fn<typeof fetch>().mockImplementation((_, options) => new Promise((_, reject) => {
    options?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }));
  updates = checker(request); const checking = updates.check();
  await updates.close(); await checking;
  expect(updates.status()).toMatchObject({ state: 'idle', error: null, checkedAt: null });
});
