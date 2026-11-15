import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DiagnosticLog, diagnosticReason } from '../packages/core/src/diagnostics.js';
import { nextCourseScanAt, courseScanSlot } from '../packages/core/src/course-scan-clock.js';
import { createServer } from '../apps/local-service/src/server.js';
import { AdapterManager } from '../packages/adapters/src/manager.js';
let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cw-diagnostics-')); });
afterEach(() => { vi.restoreAllMocks(); rmSync(dir, { recursive: true, force: true }); });

it('北京时间整点及半点对齐，跨日和休眠后只取当前轮次', () => {
  for (const [now, expected] of [
    ['2026-11-13T20:59:59+08:00', '2026-11-13T21:00:00+08:00'],
    ['2026-11-13T21:00:00+08:00', '2026-11-13T21:30:00+08:00'],
    ['2026-11-13T23:59:59+08:00', '2026-11-14T00:00:00+08:00'],
  ]) expect(nextCourseScanAt(Date.parse(now))).toBe(Date.parse(expected));
});
it('诊断轮转且重启可读取，原始错误中的凭据不进入错误分类', () => {
  const log = new DiagnosticLog(dir, 160);
  for (let i = 0; i < 8; i++) log.record('unipus', 'operation-failed', { reason: diagnosticReason(new Error('locator.click: Timeout 30000ms exceeded https://secret.test/?token=fixture-secret')) });
  const stored = new DiagnosticLog(dir).read();
  expect(stored.entries.length).toBeGreaterThan(0);
  expect(stored.entries.at(-1)?.reason).toBe('timeout');
  expect(JSON.stringify(stored)).not.toContain('fixture-secret');
  expect(statSync(join(dir, 'diagnostics.jsonl')).size).toBeLessThan(320);
});
it('系统日志导出要求认证和来源授权，不包含设置、会话、账号及课程内容', async () => {
  const server = await createServer({ dir, test: true });
  try {
    server.store.set('studyConfig', { apiKey: 'secret-key', model: 'private-model' });
    server.store.set('platform:unipus', { ...server.store.get('platform:unipus', {}), accountId: 'private-account' });
    const host = { host: '127.0.0.1:17321' };
    expect((await server.app.inject({ url: '/api/diagnostics/export', headers: host })).statusCode).toBe(401);
    const pair = await server.app.inject({ method: 'POST', url: '/api/pair', headers: host, payload: { code: server.pairingCode } });
    const headers = { ...host, authorization: `Bearer ${pair.json().token}` };
    const response = await server.app.inject({ url: '/api/diagnostics/export', headers });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ schemaVersion: 1, timezone: 'Asia/Shanghai', system: { platform: process.platform } });
    for (const secret of ['secret-key', 'private-model', 'private-account', pair.json().token]) expect(response.body).not.toContain(secret);
    expect((await server.app.inject({ url: '/api/diagnostics/export', headers: { ...headers, origin: 'https://evil.test' } })).statusCode).toBe(403);
  } finally { await server.app.close(); }
});
it('登录校验失败记录平台及错误类别，不写入课程或凭据', async () => {
  const server = await createServer({ dir, test: true });
  vi.spyOn(AdapterManager.prototype, 'finish').mockRejectedValue(new Error('学习通登录校验未完成：课程响应结构无法识别，请稍后重试；登录窗口已保留'));
  try {
    const host = { host: '127.0.0.1:17321' };
    const pair = await server.app.inject({ method: 'POST', url: '/api/pair', headers: host, payload: { code: server.pairingCode } });
    const headers = { ...host, authorization: `Bearer ${pair.json().token}` };
    const response = await server.app.inject({ method: 'POST', url: '/api/platforms/chaoxing/login/finish', headers, payload: {} });
    expect(response.statusCode).toBe(409);
    const exported = await server.app.inject({ url: '/api/diagnostics/export', headers });
    expect(exported.json().journal.entries).toContainEqual(expect.objectContaining({ source: 'chaoxing', event: 'login-confirmation-failed', reason: 'response-format' }));
    expect(server.store.get<any>('platform:chaoxing', {}).loginStatus).not.toBe('logged_in');
    expect(server.engine.courses()).toHaveLength(0);
  } finally { await server.app.close(); }
});
it('课程时钟绕过普通间隔但保持监控、登录保护，忙碌延后，新课程默认待选择', async () => {
  let now = Date.parse('2026-11-13T21:00:00+08:00');
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const server = await createServer({ dir, test: true });
  const current = server.store.get<any>('platform:unipus', {});
  server.store.set('platform:unipus', { ...current, added: true, enabled: true, loginStatus: 'logged_in', nextScanAt: now + 86400000 });
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const scan = vi.spyOn(AdapterManager.prototype, 'scan').mockImplementation(async state => {
    await barrier;
    return { platform: state.id, accountId: state.accountId, outcome: 'partial', discoveryComplete: true, items: [], partitions: [], issues: [], courses: [{ key: 'resource:new', name: '模拟新增教程' }] };
  });
  try {
    const pending = server.scanScheduledCourses();
    await server.scanScheduledCourses(); expect(scan).toHaveBeenCalledTimes(1);
    release(); await pending;
    expect(server.engine.courses().find(c => c.key === 'resource:new')?.status).toBe('pending');
    expect(server.store.get('courseScanSlot:unipus', -1)).toBe(courseScanSlot(now));
    await server.scanScheduledCourses(); expect(scan).toHaveBeenCalledTimes(1);
    now += 1800000; await server.scanScheduledCourses(); expect(scan).toHaveBeenCalledTimes(2);
    server.store.set('monitoring', false); now += 1800000; await server.scanScheduledCourses(); expect(scan).toHaveBeenCalledTimes(2);
    server.store.set('monitoring', true);
    server.store.set('platform:unipus', { ...server.store.get<any>('platform:unipus', {}), loginStatus: 'verification_required' });
    await server.scanScheduledCourses(); expect(scan).toHaveBeenCalledTimes(2);
    server.store.set('platform:unipus', { ...server.store.get<any>('platform:unipus', {}), loginStatus: 'logged_in' });
    now += 4 * 1800000; await server.scanScheduledCourses(); expect(scan).toHaveBeenCalledTimes(3);
  } finally { await server.app.close(); }
});
