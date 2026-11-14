// Synthetic settings and local API only; no platform or model requests.
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {createServer} from '../apps/local-service/src/server.ts';
const dir=mkdtempSync(join(tmpdir(),'cw-main-settings-')),port=17348,token='settings-fixture-'.repeat(6);
process.env.COURSEWATCH_NATIVE_TOKEN=token;
const server=await createServer({dir,port,test:true});await server.app.listen({host:'127.0.0.1',port});
const browser=await chromium.launch({channel:'chromium',headless:true});
try {
 const context=await browser.newContext({viewport:{width:1060,height:720}});await context.addInitScript(value=>localStorage.setItem('coursewatch-client-token',value),token);
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${port}/?desktop=1`);await page.getByRole('button',{name:'设置',exact:true}).click();
 const sheet=page.getByRole('dialog',{name:'设置',exact:true}),nav=sheet.getByRole('navigation',{name:'设置分类'});
 await sheet.getByRole('heading',{name:'外观',exact:true}).waitFor();
 const sections=['通用','提醒','手机通知','自动学习','数据'];mkdirSync('docs/screenshots',{recursive:true});
 for (const width of [1060,820,390,320]) for(const theme of ['light','dark']) {
  await page.setViewportSize({width,height:width===820?600:720});await page.emulateMedia({colorScheme:theme});
  for(const [index,name] of sections.entries()) {
   await nav.getByRole('button',{name,exact:true}).click();assert.equal(await nav.getByRole('button',{name,exact:true}).getAttribute('aria-pressed'),'true');
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   assert.ok(await sheet.evaluate(el=>el.scrollWidth<=el.clientWidth));
   assert.ok(await sheet.locator('.sheet-scroll').evaluate(el=>el.scrollWidth<=el.clientWidth));
   assert.ok(await sheet.getByRole('button',{name:'完成',exact:true}).evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight}));
   await page.screenshot({path:`docs/screenshots/main-settings-${index}-${width}-${theme}.png`});
  }
 }
 await nav.getByRole('button',{name:'通用',exact:true}).click();
 let rejected=false;await page.route('**/api/settings',async r=>{if(r.request().method()==='PATCH'&&!rejected){rejected=true;await r.fulfill({status:500,json:{error:'模拟保存失败'}});}else await r.continue();});
 await sheet.getByRole('combobox',{name:'检查频率',exact:true}).selectOption('30');await sheet.getByText('模拟保存失败',{exact:true}).waitFor();
 assert.equal(await sheet.getByRole('combobox',{name:'检查频率',exact:true}).inputValue(),'30');
 await sheet.getByRole('button',{name:'重新保存',exact:true}).click();await sheet.getByRole('button',{name:'重新保存',exact:true}).waitFor({state:'hidden'});
 await nav.getByRole('button',{name:'提醒',exact:true}).click();await nav.getByRole('button',{name:'通用',exact:true}).click();assert.equal(await sheet.getByRole('combobox',{name:'检查频率',exact:true}).inputValue(),'30');
 await page.emulateMedia({reducedMotion:'reduce',contrast:'more'});await nav.getByRole('button',{name:'自动学习',exact:true}).focus();assert.equal(await nav.getByRole('button',{name:'自动学习',exact:true}).evaluate(el=>el===document.activeElement),true);
 await page.keyboard.press('Enter');await sheet.getByRole('heading',{name:'自动学习',exact:true}).waitFor();
 assert.deepEqual(errors,[]);console.log(JSON.stringify({categories:sections,widths:[1060,820,390,320],themes:['light','dark'],saveRetry:true,footerVisible:true,keyboard:true,errors}));
}finally{await browser.close();await server.app.close();rmSync(dir,{recursive:true,force:true});}
