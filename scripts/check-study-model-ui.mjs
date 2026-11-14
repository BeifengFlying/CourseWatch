// Isolated fixtures: never contact a model service or an official course.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from '../apps/local-service/src/server.ts';
import { StudyConfig, studyNoticeVersion } from '../packages/contracts/src/study.ts';
const dir = mkdtempSync(join(tmpdir(), 'cw-model-ui-')), port = 17342, token = 'model-ui-fixture-'.repeat(6);
process.env.COURSEWATCH_NATIVE_TOKEN = token;
const server = await createServer({ dir, port, test: true });
const configs = {};
for (const platform of ['chaoxing', 'unipus']) {
 const key = platform === 'chaoxing' ? 'studyConfig' : 'studyConfig:unipus';
 configs[platform] = { ...StudyConfig.parse({ enabled:true, noticeVersion:studyNoticeVersion(platform) }), hasKey:false, active:true };
 server.store.set(key, configs[platform]);
}
for (const platform of ['chaoxing','unipus']) {
 const saved=server.store.get(`platform:${platform}`,{});server.store.set(`platform:${platform}`,{...saved,added:true,loginStatus:'logged_in'});
}
await server.app.listen({ host:'127.0.0.1', port });
const browser = await chromium.launch({ channel:'chromium', headless:true });
try {
 const context = await browser.newContext({ viewport:{width:1060,height:720} });
 await context.addInitScript(value => localStorage.setItem('coursewatch-client-token', value), token);
 const page = await context.newPage(), errors = [];
 page.on('pageerror', error => errors.push(error.message));
 for (const platform of ['chaoxing','unipus']) {
  const prefix = platform === 'chaoxing' ? 'study' : 'study/unipus';
  await page.route(`**/api/${prefix}/settings`, async route => {
   if (route.request().method() === 'PATCH') {
    const { apiKey, localSkillsAccepted, ...input } = route.request().postDataJSON();
    configs[platform] = { ...input, active:true, hasKey:!!apiKey || configs[platform].hasKey };
   }
   await route.fulfill({json:configs[platform]});
  });
 }
 await page.goto(`http://127.0.0.1:${port}/?desktop=1`);
 await page.getByRole('button',{name:'设置',exact:true}).click();
 assert.equal(await page.getByLabel('API 基础地址',{exact:true}).count(),0);
 await page.locator('.glass-scrim').click({position:{x:1,y:1}});
 assert.equal(await page.locator('.glass-sheet').isVisible(),true);
 await page.getByRole('button',{name:'关闭面板',exact:true}).click();
 mkdirSync('docs/screenshots',{recursive:true});
 for (const platform of ['chaoxing','unipus']) {
  const name = platform === 'chaoxing' ? '学习通' : 'U校园';
  await page.getByRole('button',{name:platform === 'chaoxing'?'超星学习通':'U校园 AI 版',exact:true}).click();
  await page.getByRole('region',{name:`${name}自动学习`,exact:true}).waitFor();
  await page.getByRole('button',{name:'模型与设置',exact:true}).click();
  const section = page.getByRole('region',{name:`${name}自动学习`,exact:true});
  const base = section.getByLabel('API 基础地址',{exact:true}), model = section.getByLabel('模型名称',{exact:true});
  await base.waitFor(); assert.ok(await model.isEnabled());
  await base.fill('https://model.fixture.example/v1'); await model.fill('fixture-model');
  await section.getByLabel('API Key',{exact:true}).fill('fixture-key');
  await page.mouse.click(2,2);assert.equal(await model.inputValue(),'fixture-model');
  await page.getByRole('button',{name:'关闭模型设置',exact:true}).click();
  const otherPlatform=platform === 'chaoxing'?'U校园 AI 版':'超星学习通',otherName=platform === 'chaoxing'?'U校园':'学习通';
  await page.getByRole('button',{name:otherPlatform,exact:true}).click();
  await page.getByRole('region',{name:otherName+'自动学习',exact:true}).waitFor();
  await page.getByRole('button',{name:platform === 'chaoxing'?'超星学习通':'U校园 AI 版',exact:true}).click();
  await page.getByRole('region',{name:name+'自动学习',exact:true}).waitFor();
  await page.getByRole('button',{name:'模型与设置',exact:true}).click();
  assert.equal(await model.inputValue(),'fixture-model');assert.equal(await section.getByLabel('API Key',{exact:true}).inputValue(),'fixture-key');
  await page.route(`**/api/${platform === 'chaoxing' ? 'study' : 'study/unipus'}/models`,r=>r.fulfill({json:{models:['fixture-model','other-model']}}));
  await section.getByRole('button',{name:'读取模型列表',exact:true}).click();
  await section.getByRole('combobox',{name:'服务商模型列表'}).selectOption('fixture-model');
  await page.route(`**/api/${platform === 'chaoxing' ? 'study' : 'study/unipus'}/model/test`,r=>r.fulfill({status:400,json:{error:'模型 Key 无效或没有访问权限，请检查 Key 和服务商'}}));
  await section.getByRole('button',{name:'测试连接',exact:true}).click();
  await section.getByRole('alert').filter({hasText:'模型 Key 无效'}).waitFor();
  assert.equal(await section.getByLabel('API Key',{exact:true}).inputValue(),'fixture-key');
  const skill = section.getByRole('checkbox',{name:/参考已有本地 Skill/});
  assert.ok(!await skill.isChecked()); await skill.click();
  const dialog = page.getByRole('dialog',{name:`开启${name}本地 Skill`,exact:true});
  await dialog.waitFor(); assert.ok(await dialog.getByRole('button',{name:'开启并返回设置'}).isDisabled());
  await dialog.getByRole('button',{name:'取消',exact:true}).click(); assert.ok(!await skill.isChecked());
  await skill.click(); await dialog.getByRole('checkbox').check();
  for (const width of [1060,820,390,320]) for (const theme of ['light','dark']) {
   await page.setViewportSize({width,height:720}); await page.emulateMedia({colorScheme:theme});
   assert.ok(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth));
   assert.ok(await dialog.getByRole('button',{name:'开启并返回设置'}).evaluate(el => {const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;}));
   await page.screenshot({path:`docs/screenshots/model-skill-${platform}-${width}-${theme}.png`});
  }
  await dialog.getByRole('button',{name:'开启并返回设置'}).click(); assert.ok(await skill.isChecked());
  await section.getByRole('button',{name:'保存模型设置',exact:true}).click();
  await section.getByText('模型设置已保存，停止并重新启动学习后生效',{exact:true}).waitFor();
  assert.equal(configs[platform].localSkills,true); assert.equal(configs[platform].model,'fixture-model');
  assert.ok(!('apiKey' in configs[platform]));
  for (const width of [1060,820,390,320]) for (const theme of ['light','dark']) {
   await page.setViewportSize({width,height:720}); await page.emulateMedia({colorScheme:theme});
   await section.getByRole('button',{name:'保存模型设置',exact:true}).scrollIntoViewIfNeeded();
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   assert.ok(await section.evaluate(el=>el.scrollWidth<=el.clientWidth));
   assert.ok(await page.getByRole('dialog',{name:name+'模型与设置',exact:true}).evaluate(el=>el.scrollWidth<=el.clientWidth));
   assert.ok(await page.locator('.study-model[open]>header').evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&r.height>60;}));
   await page.screenshot({path:`docs/screenshots/model-panel-${platform}-${width}-${theme}.png`});
  }
  await skill.uncheck();
  const savedResponse = page.waitForResponse(response => response.url().endsWith('/settings') && response.request().method() === 'PATCH');
  await section.getByRole('button',{name:'保存模型设置',exact:true}).click(); await savedResponse;
  assert.equal(configs[platform].localSkills,false);
  await page.getByRole('button',{name:'关闭模型设置',exact:true}).click();
 }
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({activeModelEditing:true,save:true,skillDefaultOff:true,cancel:true,explicitConsent:true,disable:true,platforms:['chaoxing','unipus'],widths:[1060,820,390,320],themes:['light','dark']}));
} finally { await browser.close(); await server.app.close(); rmSync(dir,{recursive:true,force:true}); }
