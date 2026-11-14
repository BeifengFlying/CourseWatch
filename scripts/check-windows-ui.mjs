// Isolated UI review: fictional courses, a temporary database and native bridge.
// Does not log in, run coursework, contact a model or change startup registration.
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {createServer} from '../apps/local-service/src/server.ts';
import {studyNoticeVersion} from '../packages/contracts/src/study.ts';

const dir=mkdtempSync(join(tmpdir(),'cw-windows-ui-')),port=17355;
const token='windows-ui-fixture-'.repeat(5),output='.cache/windows-ui30-r2';
process.env.COURSEWATCH_NATIVE_TOKEN=token;
const server=await createServer({dir,port,test:true});
for(const id of ['ynjy','renwei','yuketang','chaoxing','unipus']) {
 const saved=server.store.get(`platform:${id}`,{});
 server.store.set(`platform:${id}`,{...saved,added:true,loginStatus:'logged_in'});
 if(!['chaoxing','unipus'].includes(id))continue;
 for(let i=0;i<(id==='chaoxing'?18:3);i++)server.engine.rememberCourse(id,saved.accountId,id==='chaoxing'?`course:${i}:class:${i+100}`:`resource:${i}`,
   i<2?'[模拟] 同名课程：数据结构与算法':`[模拟] ${id==='chaoxing'?'实验课程':'大学英语综合教程'} ${i+1}`);
 server.engine.selectCourses(id,saved.accountId,server.engine.courses().filter(c=>c.platform===id).map(c=>c.id));
 server.store.set(id==='chaoxing'?'studyConfig':'studyConfig:unipus',{enabled:true,noticeVersion:studyNoticeVersion(id)});
 const chapters=Array.from({length:18},(_,i)=>({id:`chapter-${i}`,name:`${i+1}. ${['课程介绍','基本概念与练习','课后阅读与检测'][i%3]}`,
   complete:i<2?true:i%3===0?null:false,locked:i>14,tasks:[{id:`video-${i}`,kind:'video',name:'视频',complete:i<2?true:false},{id:`quiz-${i}`,kind:'quiz',name:'章节检测',complete:i===0?true:null}]}));
 server.store.set(`courseProgress:${id}`,server.engine.courses().filter(c=>c.platform===id).map(c=>({courseId:c.id,name:c.name,completed:2,total:18,percent:11.1,chapters,observedAt:Date.now(),deadline:'2026-12-31'})));
}
await server.app.listen({host:'127.0.0.1',port});
mkdirSync(output,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'chromium'});
const results=[],errors=[];
const within=async locator=>locator.evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;});
async function clean(page) {
 await page.waitForFunction(()=>!document.querySelector('.page-enter-active,.page-leave-active,.material-enter-active,.material-leave-active')&&(document.querySelector('.platform-window')||document.querySelector('.desktop-content')));
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight),'root overflow');
 const toolbar=await page.locator('.window-toolbar').evaluateAll(els=>els.map(el=>({heading:el.querySelector('.toolbar-heading').getBoundingClientRect().toJSON(),actions:el.querySelector('.toolbar-end').getBoundingClientRect().toJSON()})));
 for(const {heading,actions} of toolbar)assert.ok(heading.right<=actions.left+1||heading.bottom<=actions.top+1,'toolbar overlap');
 const clippedText=await page.locator('button').evaluateAll(buttons=>buttons.flatMap(button=>{
  const bounds=button.getBoundingClientRect(),style=getComputedStyle(button);
  if(!bounds.width||!bounds.height||style.visibility==='hidden')return [];
  const walker=document.createTreeWalker(button,NodeFilter.SHOW_TEXT);
  for(let node=walker.nextNode();node;node=walker.nextNode())if(node.textContent.trim()){
   const range=document.createRange();range.selectNodeContents(node);
   for(const text of range.getClientRects())if(text.left<bounds.left-1||text.right>bounds.right+1||text.top<bounds.top-1||text.bottom>bounds.bottom+1)return [button.getAttribute('aria-label')||button.textContent.trim()];
  }
  return [];
 }));
 assert.deepEqual(clippedText,[],'button text extends outside its control');
 for(const selector of ['.glass-sheet','.sheet-scroll','.study-launch','.study-directory','.study-model']) {
  for(const el of await page.locator(selector).all())if(await el.isVisible())assert.ok(await el.evaluate(e=>e.scrollWidth<=e.clientWidth+1),`${selector} overflow`);
 }
}
function bridge({host,token}) {
 localStorage.setItem('coursewatch-client-token',token);
 window.__coursewatchPlatform=host;window.__nativeActions=[];
 window.__preferences={setupCompleted:true,backgroundEnabled:true,launchAtLogin:false,closeBehavior:'ask'};
 const send=(name,detail)=>setTimeout(()=>window.dispatchEvent(new CustomEvent(name,{detail})),0);
 const postMessage=m=>{
  window.__nativeActions.push(m);
  if(m.action==='preferences')send('coursewatch:preferences',window.__preferences);
  if(m.action==='saveStartupPreferences'||m.action==='saveCloseBehavior'){
   window.__preferences={...window.__preferences,...(m.action==='saveStartupPreferences'?{setupCompleted:true,backgroundEnabled:m.backgroundEnabled,launchAtLogin:m.launchAtLogin}:{closeBehavior:m.behavior})};
   send('coursewatch:lifecycleResult',{kind:m.action==='saveStartupPreferences'?'startup':'settings',ok:true,preferences:window.__preferences});
  }
  if(m.action==='close')send('coursewatch:closeRequested');
 };
 if(host==='windows')window.chrome={webview:{postMessage}};
 else window.webkit={messageHandlers:{coursewatch:{postMessage}}};
 document.addEventListener('DOMContentLoaded',()=>Object.assign(document.documentElement.dataset,{native:'true',platform:host,backdrop:'true'}));
}
try {
 for(const host of ['windows','macos'])for(const theme of ['light','dark']) {
  const context=await browser.newContext({viewport:{width:1060,height:720},colorScheme:theme,reducedMotion:'reduce'});
  await context.addInitScript(bridge,{host,token});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/?desktop=1`);
  await page.getByRole('button',{name:'管理课程',exact:true}).waitFor();
  for(const width of host==='windows'?[1060,820,390,320]:[1060]) {
   const height=width===820?600:720;
   await page.setViewportSize({width,height});
   await page.getByRole('button',{name:'全部任务',exact:true}).click();
   await page.locator('.study-platform').waitFor({state:'hidden'});
   await clean(page);
   if(host==='windows'){
    const buttons=await page.locator('.windows-window-controls button').evaluateAll(els=>els.map(e=>e.getBoundingClientRect().toJSON()));
    assert.equal(buttons.length,2);assert.equal(buttons[0].right,buttons[1].left);
    for(const name of ['设置','通知'])assert.ok(await within(page.getByRole('button',{name,exact:true})));
   }
   const capture=async name=>{await clean(page);await page.screenshot({path:`${output}/${host}-${theme}-${width}-${name}.png`});};
   await capture('tasks');
   await page.getByRole('button',{name:'云南省高等学校计算机等级考试系统',exact:true}).click();
   await page.getByRole('heading',{name:'云南省高等学校计算机等级考试系统',exact:true}).waitFor();
   await capture('long-title');
   await page.getByRole('button',{name:'全部任务',exact:true}).click();
   await page.getByRole('button',{name:'管理课程',exact:true}).click();
   await page.getByRole('combobox',{name:'课程平台',exact:true}).selectOption('chaoxing');
   await page.locator('.course-row').last().waitFor();
   const save=page.getByRole('button',{name:'保存课程选择',exact:true});
   assert.ok(await within(save));
   await page.locator('.sheet-scroll').evaluate(el=>el.scrollTop=el.scrollHeight);
   assert.ok(await within(save));await capture('courses');
   await page.getByRole('button',{name:'关闭面板',exact:true}).click();
   await page.getByRole('button',{name:'设置',exact:true}).click();
   const settings=page.getByRole('dialog',{name:'设置',exact:true}),nav=settings.getByRole('navigation',{name:'设置分类'});
   const settingsBounds=await settings.boundingBox();
   for(const name of ['通用','提醒','手机通知','自动学习','数据']){
    await nav.getByRole('button',{name,exact:true}).click();
    if(host==='windows'){
     const bounds=await settings.boundingBox();
     assert.equal(bounds.width,settingsBounds.width,'settings width changed between tabs');
     assert.equal(bounds.height,settingsBounds.height,'settings height changed between tabs');
     assert.equal(await page.locator('.windows-resize-handle').count(),0,'fixed window has resize handles');
    }
    assert.ok(await within(settings.getByRole('button',{name:'完成',exact:true})));
    await capture(`settings-${name}`);
   }
   await nav.getByRole('button',{name:'通用',exact:true}).click();
   if(host==='windows'){
    const appearance=settings.getByRole('combobox',{name:'主题',exact:true});
    for(const mode of ['dark','light','system']) {
     await page.evaluate(()=>window.__nativeActions=[]);
     await appearance.selectOption(mode);
     await page.waitForFunction(mode=>window.__nativeActions.some(m=>m.action==='appearance'&&m.mode===mode),mode);
     await page.waitForFunction(()=>!document.querySelector('select[aria-label=主题]').disabled);
     const resolved=mode==='system'?theme:mode;
     await page.waitForFunction(value=>document.documentElement.dataset.appearance===value,resolved);
     assert.equal(await page.evaluate(()=>document.documentElement.style.colorScheme),resolved);
     assert.ok(await page.evaluate(value=>window.__nativeActions.some(m=>m.action==='appearance'&&m.dark===(value==='dark')),resolved));
     if(width===1060&&theme==='light'&&mode!=='system')await capture(`manual-theme-${mode}`);
    }
    await settings.getByRole('button',{name:'修改设置',exact:true}).click();
    const startup=page.getByRole('dialog',{name:'启动与后台',exact:true});await startup.waitFor();
    assert.ok(await settings.evaluate(el=>el.closest('.glass-scrim').inert));
    assert.ok(await within(startup));await capture('startup');
    await startup.getByRole('button',{name:'取消',exact:true}).click();
    assert.ok(!await settings.evaluate(el=>el.closest('.glass-scrim').inert));
   }
   await settings.getByRole('button',{name:'完成',exact:true}).click();
   for(const [name,id] of [['超星学习通','chaoxing'],['U校园 AI 版','unipus']]){
    await page.getByRole('button',{name,exact:true}).click();
    const study=page.getByRole('region',{name:id==='chaoxing'?'学习通自动学习':'U校园自动学习',exact:true});
    await study.locator('.study-launch').waitFor();
    await study.locator('.study-directory .chapter-row').first().waitFor();
    const alignment=await study.locator('.study-operations').evaluate(el=>({
     legend:el.querySelector('legend').getBoundingClientRect().toJSON(),
     choices:el.querySelector('.study-operation-choices').getBoundingClientRect().toJSON(),
     labels:[...el.querySelectorAll('label')].map(label=>label.getBoundingClientRect().toJSON()),
    }));
    assert.ok(alignment.choices.top-alignment.legend.bottom>=7,'study legend touches its controls');
    assert.ok(alignment.labels.every(label=>Math.abs(label.top-alignment.labels[0].top)<1&&Math.abs(label.height-alignment.labels[0].height)<1),'study option labels are misaligned');
    await study.locator('.study-heading').scrollIntoViewIfNeeded();await capture(id);
    if(width===1060){
     const bounds=await page.locator('.study-launch,.study-directory').evaluateAll(els=>els.map(e=>e.getBoundingClientRect().toJSON()));
     assert.equal(bounds.length,2);assert.ok(Math.abs(bounds[0].top-bounds[1].top)<2);
     assert.ok(Math.abs(bounds[0].bottom-bounds[1].bottom)<2);
    }
    await study.getByRole('button',{name:'模型与设置',exact:true}).click();
    const model=page.locator('.study-model[open]');await model.waitFor();
    assert.ok(await within(model.getByRole('button',{name:'保存模型设置',exact:true})));
    await capture(`${id}-model`);
    await model.getByRole('button',{name:'关闭模型设置',exact:true}).click();
   }
   results.push({host,theme,width,height});
  }
  await context.close();
 }
 for(const theme of ['light','dark']) {
  const context=await browser.newContext({colorScheme:theme,reducedMotion:'reduce'});
  await context.addInitScript(bridge,{host:'windows',token});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/?desktop=1&platform=chaoxing`);
  await page.locator('.course-row').last().waitFor();
  for(const width of [660,480,390,320]) {
   const height=width===660?700:520;
   await page.setViewportSize({width,height});
   const save=page.getByRole('button',{name:'保存设置',exact:true});
   for(const bottom of [false,true]){
    await page.locator('.sheet-scroll').evaluate((el,bottom)=>el.scrollTop=bottom?el.scrollHeight:0,bottom);
    await clean(page);assert.ok(await within(save));
   }
   await page.screenshot({path:`${output}/windows-${theme}-${width}-platform.png`});
   results.push({host:'windows',theme,width,height,platform:'chaoxing'});
  }
  await context.close();
 }
 assert.deepEqual(errors,[]);
 writeFileSync(`${output}/results.json`,JSON.stringify({cases:results,errors},null,2));
 console.log(`${results.length} Windows/macOS layout cases passed: settings, courses, learning panels, model dialogs and native preferences`);
} finally {
 await browser.close();await server.app.close();rmSync(dir,{recursive:true,force:true});
}
