// Isolated update metadata; no public requests, downloads, installers or platform tasks.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from '../apps/local-service/src/server.ts';
const dir = mkdtempSync(join(tmpdir(), 'cw-update-ui-')), port = 17354;
const token = 'app-update-ui-fixture-'.repeat(4), output = 'docs/screenshots/app-updates-2026-11-15';
process.env.COURSEWATCH_NATIVE_TOKEN = token;
let checks = 0, browser;
const download = 'https://github.com/BeifengFlying/CourseWatch/releases/tag/v0.2.99-desktop';
const server = await createServer({ dir, port, test: true, updateRequest: async () => {
  checks++;
  return new Response(JSON.stringify([{ tag_name: 'v0.2.99-desktop', html_url: download, draft: false, prerelease: true,
    body: '模拟更新说明\n<img src=x onerror="window.__updateXss=1">\n修复提醒，不代表真实版本。' }]));
} });
const errors = [], outside = [], captures = [];
try {
  await server.app.listen({ host: '127.0.0.1', port });
  browser = await chromium.launch({ channel: 'chromium', headless: true });
  const context = await browser.newContext({ viewport: { width: 1060, height: 800 } });
  await context.addInitScript(value => {
    localStorage.setItem('coursewatch-client-token', value);
    window.__downloads = [];
    window.open = url => { window.__downloads.push(url); return null; };
  }, token);
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin !== `http://127.0.0.1:${port}`) { outside.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  mkdirSync(output, { recursive: true });
  for (const mode of ['desktop', 'web']) {
    await page.setViewportSize({ width: 1060, height: 800 });
    await page.goto(`http://127.0.0.1:${port}/${mode === 'desktop' ? '?desktop=1' : ''}`);
    await page.getByRole('button', { name: '设置', exact: true }).click();
    const section = page.getByRole('region', { name: '应用更新', exact: true });
    const automatic = section.getByRole('checkbox', { name: /自动检查更新/ });
    if (mode === 'desktop') {
      assert.equal(await automatic.isChecked(), true);
      let rejected = false;
      await page.route('**/api/updates/settings', async route => {
        if (!rejected) { rejected = true; return route.fulfill({ status: 409, json: { error: '模拟保存失败' } }); }
        return route.continue();
      });
      await automatic.uncheck();
      await section.getByRole('alert').filter({ hasText: '模拟保存失败' }).waitFor();
      assert.equal(await automatic.isChecked(), true);
      await automatic.uncheck();
      await page.waitForFunction(() => !document.querySelector('#automatic-app-updates')?.disabled);
      assert.equal(await automatic.isChecked(), false);
      assert.equal(server.store.get('appUpdateAutomatic', true), false);
      await section.getByRole('button', { name: '检查更新', exact: true }).click();
    }
    await section.getByText('CourseWatch 0.2.99 可用（测试版）', { exact: true }).waitFor();
    assert.equal(await automatic.isChecked(), false);
    await section.getByText('更新说明', { exact: true }).click();
    assert.ok((await section.locator('pre').innerText()).includes('<img'));
    assert.equal(await page.evaluate(() => window.__updateXss), undefined);
    for (const width of [1060, 390, 320]) for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width, height: 800 });
      await page.emulateMedia({ colorScheme: theme });
      if (mode === 'web') await page.evaluate(value => document.querySelector('.app')?.classList.toggle('dark', value === 'dark'), theme);
      await section.scrollIntoViewIfNeeded();
      const measured = await section.evaluate(node => ({ width: node.clientWidth, content: node.scrollWidth, page: document.documentElement.scrollWidth, viewport: innerWidth }));
      assert.ok(measured.content <= measured.width && measured.page <= measured.viewport, JSON.stringify(measured));
      assert.ok(await section.locator('.update-option strong').evaluate(node => node.getBoundingClientRect().height < 50), '更新标签应保持横向可读');
      captures.push({ mode, theme, width });
      if (width !== 390) await page.screenshot({ path: `${output}/${mode}-${width}-${theme}.png` });
    }
    await section.getByRole('button', { name: '查看更新并下载', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.__downloads), [download]);
  }
  assert.equal(checks, 1);
  assert.equal(server.store.all("SELECT * FROM outbox WHERE kind='update'").length, 1);
  assert.equal(server.store.all('SELECT * FROM notification_deliveries').length, 0);
  assert.deepEqual(errors, []); assert.deepEqual(outside, []);
  console.log(JSON.stringify({ layouts: captures.length, screenshots: 8, mockedChecks: checks, downloadsStarted: 0, externalRequests: 0, captures }, null, 2));
} finally {
  await browser?.close(); await server.app.close(); rmSync(dir, { recursive: true, force: true });
}
