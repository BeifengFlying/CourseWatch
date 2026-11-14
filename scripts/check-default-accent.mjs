// Isolated settings and local UI only; no account or platform requests.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from '../apps/local-service/src/server.ts';

const dir = mkdtempSync(join(tmpdir(), 'cw-orange-')), port = 17349, token = 'orange-fixture-'.repeat(6);
process.env.COURSEWATCH_NATIVE_TOKEN = token;
const server = await createServer({ dir, port, test: true });
// Existing settings without an accent must also receive the default.
server.store.set('settings', { intervalMinutes: 15, nativeNotifications: false, reminderHours: [24] });
await server.app.listen({ host: '127.0.0.1', port });
const browser = await chromium.launch({ channel: 'chromium', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1060, height: 720 } });
  await context.addInitScript(value => localStorage.setItem('coursewatch-client-token', value), token);
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${port}/?desktop=1`);
  const shell = page.locator('.desktop-shell');
  await shell.locator('.window-toolbar h1').waitFor();
  mkdirSync('docs/screenshots', { recursive: true });
  for (const width of [1060, 320]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: 720 });
    await page.emulateMedia({ colorScheme: theme });
    assert.equal(await shell.getAttribute('data-accent'), 'orange');
    await page.waitForFunction(value => document.documentElement.dataset.appearance === value, theme);
    const colors = await shell.evaluate(el => {
      const style = getComputedStyle(el);
      return { accent: style.getPropertyValue('--d-accent').trim(), surface: style.getPropertyValue('--d-surface').trim(), scheme: style.colorScheme };
    });
    assert.deepEqual(colors, theme === 'dark'
      ? { accent: '#d7ac82', surface: '#202328', scheme: 'dark' }
      : { accent: '#ba8150', surface: '#f5f6f8', scheme: 'light' });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ animations: 'disabled', path: `docs/screenshots/default-accent-main-${width}-${theme}.png` });
    await page.getByRole('button', { name: '设置', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: '设置', exact: true });
    await sheet.getByRole('heading', { name: '外观', exact: true }).waitFor();
    assert.equal(await sheet.getByRole('button', { name: '橙色', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.ok(await sheet.evaluate(el => el.scrollWidth <= el.clientWidth));
    assert.ok(await sheet.getByRole('button', { name: '完成', exact: true }).evaluate(el => el.getBoundingClientRect().bottom <= innerHeight));
    await page.screenshot({ animations: 'disabled', path: `docs/screenshots/default-accent-settings-${width}-${theme}.png` });
    await sheet.getByRole('button', { name: '完成', exact: true }).click();
    await sheet.waitFor({ state: 'hidden' });
  }
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: '设置', exact: true });
  const saved = page.waitForResponse(response => response.url().endsWith('/api/settings') && response.request().method() === 'PATCH');
  await sheet.getByRole('button', { name: '蓝色', exact: true }).click();
  assert.equal((await saved).status(), 200);
  await page.reload();
  await page.waitForFunction(() => document.querySelector('.desktop-shell')?.getAttribute('data-accent') === 'blue');
  assert.equal(await shell.getAttribute('data-accent'), 'blue');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const orangeSaved = page.waitForResponse(response => response.url().endsWith('/api/settings') && response.request().method() === 'PATCH');
  await page.getByRole('button', { name: '橙色', exact: true }).click();
  assert.equal((await orangeSaved).status(), 200);
  const appearance = page.getByRole('combobox', { name: '主题', exact: true });
  const selectTheme = async mode => {
    const saved = page.waitForResponse(response => response.url().endsWith('/api/settings') && response.request().method() === 'PATCH');
    await appearance.selectOption(mode);
    assert.equal((await saved).status(), 200);
  };
  for (const width of [1060, 320]) for (const mode of ['light', 'dark']) {
    await page.setViewportSize({ width, height: 720 });
    await page.emulateMedia({ colorScheme: mode === 'dark' ? 'light' : 'dark' });
    await selectTheme(mode);
    await page.waitForFunction(value => document.documentElement.dataset.appearance === value, mode);
    assert.equal(await shell.evaluate(el => getComputedStyle(el).colorScheme), mode);
    assert.equal(await shell.evaluate(el => getComputedStyle(el).getPropertyValue('--d-surface').trim()), mode === 'dark' ? '#202328' : '#f5f6f8');
    assert.equal(await page.locator('.study-complete-icon').count(), 0);
    const complete = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--study-complete').trim());
    assert.equal(complete, mode === 'dark' ? '#70d58b' : '#237a3b');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ animations: 'disabled', path: `docs/screenshots/manual-theme-${width}-${mode}.png` });
  }
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.appearance === 'dark');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  assert.equal(await appearance.inputValue(), 'dark');
  await selectTheme('system');
  for (const colorScheme of ['light', 'dark', 'light']) {
    await page.emulateMedia({ colorScheme });
    await page.waitForFunction(value => document.documentElement.dataset.appearance === value, colorScheme);
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ defaultAccent: 'orange', existingSelectionPreserved: true, oldSettingsWithoutAccent: true, widths: [1060, 320], themes: ['system', 'light', 'dark'], manualOverridesSystem: true, reloadPreservesTheme: true, liveSystemChanges: true, overflow: false, errors }));
} finally {
  await browser.close(); await server.app.close(); rmSync(dir, { recursive: true, force: true });
}
