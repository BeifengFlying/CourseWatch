// Isolated local fixtures; never reads official sessions or personal courses.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from '../apps/local-service/src/server.ts';
import { AdapterManager } from '../packages/adapters/src/manager.ts';

const dir = mkdtempSync(join(tmpdir(), 'cw-login-qa-'));
const token = 'isolated-login-test-'.repeat(4);
process.env.COURSEWATCH_NATIVE_TOKEN = token;
const server = await createServer({ dir, port: 17329, test: true });
const original = AdapterManager.prototype.finish;
let finishCount = 0, finished = false;
AdapterManager.prototype.finish = async () => {
  finishCount++;
  await new Promise(resolve => setTimeout(resolve, 250));
  finished = true;
  return { ok: true, courses: [
    { key: 'course:10:class:20', name: '测试课程：长名称、同名课程与首次登录选择' },
    { key: 'course:11:class:21', name: '测试课程：长名称、同名课程与首次登录选择' },
  ] };
};
await server.app.listen({ host: '127.0.0.1', port: 17329 });
const browser = await chromium.launch({ headless: true, channel: 'chromium' });
const context = await browser.newContext({ viewport: { width: 660, height: 700 } });
await context.addInitScript(token => {
  localStorage.setItem('coursewatch-client-token', token);
  window.__nativeActions = [];
  window.webkit = { messageHandlers: { coursewatch: { postMessage: m => window.__nativeActions.push(m.action) } } };
}, token);
const page = await context.newPage(), errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.route('**/api/health', async route => {
  const res = await route.fetch(), body = await res.json();
  await route.fulfill({ response: res, json: { ...body, activeLogin: finished ? null : 'chaoxing' } });
});
await page.route('**/api/platforms', async route => {
  const res = await route.fetch(), body = await res.json();
  body.items = body.items.map(p => ({ ...p, activeLogin: p.id === 'chaoxing' && !finished }));
  await route.fulfill({ response: res, json: body });
});
try {
  await page.goto('http://127.0.0.1:17329/?desktop=1&platform=chaoxing');
  const complete = page.getByRole('button', { name: '完成登录', exact: true });
  await complete.waitFor();
  await complete.evaluate(el => { for (let i = 0; i < 20; i++) el.click(); });
  await page.getByRole('button', { name: '正在验证并保存登录…', exact: true }).waitFor();
  await page.locator('.course-manager').waitFor();
  assert.equal(finishCount, 1);
  assert.equal(await page.locator('.course-row').count(), 2);
  assert.equal(await page.locator('.course-row input:checked').count(), 0);
  assert.equal(await page.locator('.course-platform select').count(), 0);
  assert.equal(server.engine.tasks().length, 0);
  assert.equal(await page.getByText('有未保存的修改', { exact: true }).count(), 0);
  const actions = await page.evaluate(() => window.__nativeActions);
  assert.ok(actions.filter(a => a === 'focusWindow').length >= 2);
  assert.ok(actions.includes('refresh'));
  assert.ok(!actions.includes('hide') && !actions.includes('minimize'));
  mkdirSync('docs/screenshots', { recursive: true });
  for (const width of [660, 480]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: width === 480 ? 520 : 700 });
    await page.emulateMedia({ colorScheme: theme });
    await page.locator('.sheet-scroll').evaluate(el => { el.scrollTop = el.scrollHeight; });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const save = page.getByRole('button', { name: '保存设置', exact: true });
    await save.scrollIntoViewIfNeeded();
    assert.ok(await save.isVisible());
    await page.screenshot({ path: `docs/screenshots/login-courses-${width}-${theme}.png` });
  }
  await page.locator('.course-row input').first().check();
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await page.waitForFunction(() => window.__nativeActions.includes('closePlatform'));
  assert.equal(server.engine.courses().filter(c => c.status === 'enabled').length, 1);
  await page.reload();
  await page.locator('.course-row input:checked').waitFor();
  assert.equal(await page.locator('.course-row input:checked').count(), 1);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ finishRequests: finishCount, pendingCourses: 2, defaultSelected: 0, selectionRetained: true, widths: [660, 480], themes: ['light', 'dark'], errors }));
} finally {
  AdapterManager.prototype.finish = original;
  await browser.close();
  await server.app.close();
  rmSync(dir, { recursive: true, force: true });
}
