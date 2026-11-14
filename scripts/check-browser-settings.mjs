// Local fixture only: never open platform accounts or start study jobs.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from '../apps/local-service/src/server.ts';
const dir = mkdtempSync(join(tmpdir(), 'cw-browser-settings-'));
const token = 'browser-settings-fixture-'.repeat(4), port = 17349;
process.env.COURSEWATCH_NATIVE_TOKEN = token;
const server = await createServer({ dir, port, test: true });
await server.app.listen({ host: '127.0.0.1', port });
const browser = await chromium.launch({ channel: 'chromium', headless: true });
try {
  const context = await browser.newContext();
  await context.addInitScript(value => localStorage.setItem('coursewatch-client-token', value), token);
  const page = await context.newPage();
  mkdirSync('docs/screenshots', { recursive: true });
  for (const desktop of [true, false]) {
    await page.setViewportSize({ width: 1060, height: 800 });
    await page.goto(`http://127.0.0.1:${port}/${desktop ? '?desktop=1' : ''}`);
    await page.getByRole('button', { name: '设置', exact: true }).click();
    const select = page.getByRole('combobox', { name: '使用的浏览器', exact: true });
    for (const width of [1060, 320]) for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width, height: 800 });
      await page.emulateMedia({ colorScheme: theme });
      await select.scrollIntoViewIfNeeded();
      assert.equal(await select.locator('option').count(), 3);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.ok(await select.evaluate(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.right <= innerWidth; }));
      if (desktop) assert.ok(await select.evaluate(el => el.getBoundingClientRect().height >= 44));
      await page.screenshot({ path: `docs/screenshots/browser-settings-${desktop ? 'desktop' : 'web'}-${width}-${theme}.png` });
    }
    for (const value of ['edge', 'chrome', 'auto']) {
      const saved = page.waitForResponse(r => r.url().endsWith('/api/settings') && r.request().method() === 'PATCH');
      await select.selectOption(value);
      if (!desktop) await page.getByRole('button', { name: '保存设置', exact: true }).click();
      assert.equal((await saved).status(), 200);
      assert.equal(server.engine.settings().browser, value);
    }
  }
  console.log(JSON.stringify({ browserSettings: ['auto', 'chrome', 'edge'], widths: [1060, 320], themes: ['light', 'dark'], desktopAndWeb: true, saved: true }));
} finally {
  await browser.close(); await server.app.close(); rmSync(dir, { recursive: true, force: true });
}
