import { expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../apps/local-service/src/server.js';
import { APP_VERSION } from '../packages/contracts/src/version.js';
import { releasePage } from '../packages/contracts/src/updates.js';
it('更新接口需要配对和来源校验，状态查询不联网，关闭自动检查后可手动检查并持久保存', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-update-api-'));
  const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify([
    { tag_name: 'v0.2.99', html_url: releasePage('0.2.99'), body: '模拟更新', draft: false, prerelease: true },
  ])));
  const server = await createServer({ dir, test: true, updateRequest: request });
  const base = { host: '127.0.0.1:17321' };
  try {
    expect((await server.app.inject({ url: '/api/updates', headers: base })).statusCode).toBe(401);
    const pair = await server.app.inject({ method: 'POST', url: '/api/pair', headers: base, payload: { code: server.pairingCode } });
    const headers = { ...base, authorization: `Bearer ${pair.json().token}` };
    expect((await server.app.inject({ method: 'POST', url: '/api/updates/check', headers: { ...headers, origin: 'https://evil.example' } })).statusCode).toBe(403);
    expect((await server.app.inject({ url: '/api/updates', headers })).json()).toMatchObject({ state: 'idle', currentVersion: APP_VERSION });
    expect(request).not.toHaveBeenCalled();
    expect((await server.app.inject({ method: 'PATCH', url: '/api/updates/settings', headers, payload: { automatic: false } })).json().automatic).toBe(false);
    expect((await server.app.inject({ method: 'POST', url: '/api/updates/check', headers })).json()).toMatchObject({ state: 'available', automatic: false, latest: { version: '0.2.99' } });
    const health = await server.app.inject({ url: '/api/health', headers });
    expect(health.json().updates).toMatchObject({ state: 'available', automatic: false });
    expect(request).toHaveBeenCalledTimes(1);
    expect(server.store.all('SELECT * FROM outbox WHERE kind=?', 'update')).toHaveLength(1);
    expect(server.store.all('SELECT * FROM notification_deliveries')).toHaveLength(0);
    expect((await server.app.inject({ method: 'PATCH', url: '/api/updates/settings', headers, payload: { automatic: 'yes' } })).statusCode).toBe(400);
  } finally { await server.app.close(); rmSync(dir, { recursive: true, force: true }); }
});
