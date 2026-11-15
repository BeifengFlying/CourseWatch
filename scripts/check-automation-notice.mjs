// Local mock data only. No platform login, model call or automation task is started.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from '../apps/local-service/src/server.ts';
import { studyNoticeVersion, STUDY_ACCEPTANCE_TEXT } from '../packages/contracts/src/study.ts';

const dir = mkdtempSync(join(tmpdir(), 'cw-automation-notice-'));
const port = 17353, token = 'automation-notice-local-fixture-'.repeat(4);
const output = 'docs/screenshots/automation-notice-2026-11-15';
process.env.COURSEWATCH_NATIVE_TOKEN = token;
const server = await createServer({ dir, port, test: true });
let browser;
const errors = [], unexpected = [], requests = [], layouts = [];
try {
  for (const platform of ['chaoxing', 'unipus']) {
    server.store.set(platform === 'chaoxing' ? 'studyConfig' : 'studyConfig:unipus', {
      enabled: true, noticeVersion: platform === 'chaoxing' ? '2026-11-13.3' : '2026-11-13.u2', model: 'fixture-saved-model',
    });
  }
  await server.app.listen({ host: '127.0.0.1', port });
  browser = await chromium.launch({ channel: 'chromium', headless: true });
  const context = await browser.newContext({ viewport: { width: 1060, height: 800 } });
  await context.addInitScript(value => localStorage.setItem('coursewatch-client-token', value), token);
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== `http://127.0.0.1:${port}`) { unexpected.push(url.origin); return route.abort(); }
    if (route.request().method() === 'POST') requests.push(url.pathname);
    return route.continue();
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${port}/?desktop=1`);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.locator('.settings-navigation').getByRole('button', { name: '自动学习', exact: true }).click();
  mkdirSync(output, { recursive: true });
  for (const platform of ['chaoxing', 'unipus']) {
    const name = platform === 'chaoxing' ? '学习通' : 'U校园';
    const region = page.getByRole('region', { name: `${name}自动学习`, exact: true });
    const toggle = region.getByRole('switch', { name: `${name}自动学习`, exact: true });
    assert.equal(await toggle.getAttribute('aria-checked'), 'false');
    await toggle.click();
    const dialog = page.getByRole('dialog', { name: `开启${name}自动学习前`, exact: true });
    const checkbox = dialog.getByRole('checkbox'), enable = dialog.getByRole('button', { name: '确认并开启', exact: true });
    assert.equal(await checkbox.isChecked(), false);
    assert.equal(await enable.isEnabled(), false);
    const text = await dialog.innerText();
    for (const phrase of ['仅用于技术实现验证与参考，不得用于其他目的', '不受', 'cn.bing.com', 'study-model-logs', '不能免除', '本机时钟']) assert.ok(text.includes(phrase), phrase);
    for (const width of [1060, 390, 320]) for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width, height: 800 });
      await page.emulateMedia({ colorScheme: theme });
      const measurements = await dialog.evaluate(node => {
        const content = node.querySelector('.study-notice-content');
        const actions = node.querySelector('.study-actions').getBoundingClientRect();
        const label = node.querySelector(':scope > .study-checkbox').getBoundingClientRect();
        const rect = node.getBoundingClientRect();
        return {
          width: innerWidth, dialogWidth: rect.width, contentHeight: content.clientHeight,
          contentScroll: content.scrollHeight, dialogOverflow: node.scrollWidth > node.clientWidth,
          pageOverflow: document.documentElement.scrollWidth > innerWidth,
          labelTop: label.top, labelBottom: label.bottom, actionsTop: actions.top, actionsBottom: actions.bottom,
          top: rect.top, bottom: rect.bottom, height: innerHeight,
        };
      });
      assert.ok(!measurements.dialogOverflow && !measurements.pageOverflow, JSON.stringify(measurements));
      assert.ok(measurements.contentHeight > 60, JSON.stringify(measurements));
      assert.ok(measurements.contentScroll > measurements.contentHeight);
      assert.ok(measurements.top >= 0 && measurements.bottom <= measurements.height + 1);
      assert.ok(measurements.labelBottom <= measurements.actionsTop + 1 && measurements.actionsBottom <= measurements.height);
      layouts.push({ platform, theme, ...measurements });
      await dialog.locator('.study-notice-content').evaluate(node => { node.scrollTop = 0; });
      if (width !== 390) await page.screenshot({ path: `${output}/${platform}-${width}-${theme}.png` });
      await dialog.locator('.study-notice-content').evaluate(node => { node.scrollTop = node.scrollHeight; });
      assert.ok(await dialog.locator('.study-notice-content').evaluate(node => node.scrollTop + node.clientHeight >= node.scrollHeight - 1));
    }
    await checkbox.check();
    await enable.click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(await toggle.getAttribute('aria-checked'), 'true');
    const key = platform === 'chaoxing' ? 'studyConfig' : 'studyConfig:unipus';
    assert.equal(server.store.get(key, {}).model, 'fixture-saved-model');
    const record = server.store.get(`studyAcceptance:${platform}:${studyNoticeVersion(platform)}`, null);
    assert.equal(record.acknowledgement, STUDY_ACCEPTANCE_TEXT);
    assert.ok(Number.isSafeInteger(record.acceptedAt));
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(unexpected, []);
  assert.deepEqual(requests.sort(), ['/api/study/accept', '/api/study/unipus/accept']);
  console.log(JSON.stringify({ scenarios: layouts.length, screenshots: 8, externalRequests: 0, startedTasks: 0, layouts }, null, 2));
} finally {
  await browser?.close();
  await server.app.close();
  rmSync(dir, { recursive: true, force: true });
}
