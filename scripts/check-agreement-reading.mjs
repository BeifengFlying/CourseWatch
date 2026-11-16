// Isolated agreement UI checks. No real accounts, model calls or study tasks.
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {createServer} from '../apps/local-service/src/server.ts';
import {StudyConfig,studyNoticeVersion} from '../packages/contracts/src/study.ts';
const dir=mkdtempSync(join(tmpdir(),'cw-reading-')),port=17413,token='agreement-reading-fixture-'.repeat(4);
process.env.COURSEWATCH_NATIVE_TOKEN=token;
const server=await createServer({dir,port,test:true});
const output='docs/screenshots/agreement-reading-2026-11-16';mkdirSync(output,{recursive:true});
for(const platform of ['chaoxing','unipus']){
 const saved=server.store.get(`platform:${platform}`,{});
 server.store.set(`platform:${platform}`,{...saved,added:true,loginStatus:'logged_in'});
 const course=server.engine.rememberCourse(platform,saved.accountId,platform==='unipus'?'resource:fixture':'fixture','模拟课程');
 server.engine.selectCourses(platform,saved.accountId,[course.id]);
}
await server.app.listen({host:'127.0.0.1',port});
const browser=await chromium.launch({channel:'chromium',headless:true});
const errors=[],writes=[];let cases=0,keyboard=0,wheel=0,touch=0,short=0;
async function atEnd(content){return content.evaluate(el=>el.scrollTop+el.clientHeight>=el.scrollHeight-2);}
async function readToEnd(page,content,button,checkbox,method){
 const overflowing=await content.evaluate(el=>el.scrollHeight>el.clientHeight+2);
 await checkbox.check();
 if(overflowing){
  assert.equal(await button.isEnabled(),false,'Checking the box cannot bypass reading');
  if(method==='touch'){
   const cdp=await page.context().newCDPSession(page),r=await content.boundingBox();
   for(let i=0;i<40&&!await atEnd(content);i++){
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:r.x+r.width/2,y:r.y+r.height-12}]});
    for(let step=1;step<=6;step++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:r.x+r.width/2,y:r.y+r.height-12-(r.height-24)*step/6}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(60);
   }
   await cdp.detach();touch++;
  }else if(method==='keyboard'){
   await content.focus();await page.keyboard.press('End');keyboard++;
  }else{
   await content.hover();await page.mouse.wheel(0,await content.evaluate(el=>el.scrollHeight));wheel++;
  }
  await page.waitForFunction(el=>el.scrollTop+el.clientHeight>=el.scrollHeight-2,await content.elementHandle());
 }else short++;
 await page.waitForFunction(el=>!el.disabled,await button.elementHandle());
 await checkbox.uncheck();assert.equal(await button.isEnabled(),false,'Reading cannot check the box');await checkbox.check();
 assert.ok(await atEnd(content));
}
try{
 for(const platform of ['chaoxing','unipus'])for(const width of [1060,820,390,320])for(const theme of ['light','dark']){
  const key=platform==='unipus'?'studyConfig:unipus':'studyConfig',name=platform==='unipus'?'U校园':'学习通';
  server.store.set(key,StudyConfig.parse({enabled:false,noticeVersion:studyNoticeVersion(platform)}));
  const context=await browser.newContext({viewport:{width,height:800},colorScheme:theme,hasTouch:true});
  await context.addInitScript(value=>localStorage.setItem('coursewatch-client-token',value),token);
  await context.route('**/*',r=>{
   const u=new URL(r.request().url());if(u.origin!==`http://127.0.0.1:${port}`)throw new Error('Unexpected external request');
   if(r.request().method()==='POST')writes.push(u.pathname);return r.continue();
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/?desktop=1`);
  await page.getByRole('button',{name:'设置',exact:true}).click();
  await page.locator('.settings-navigation').getByRole('button',{name:'自动学习',exact:true}).click();
  const toggle=page.getByRole('switch',{name:`${name}自动学习`,exact:true});await toggle.click();
  const dialog=page.getByRole('dialog',{name:`开启${name}自动学习前`,exact:true});
  const content=dialog.locator('.study-notice-content'),box=dialog.getByRole('checkbox'),enable=dialog.getByRole('button',{name:'确认并开启',exact:true});
  assert.equal(await enable.isEnabled(),false);assert.ok(await dialog.getByText('请滚动至协议底部后再同意',{exact:true}).isVisible());
  await readToEnd(page,content,enable,box,theme==='light'?'keyboard':'wheel');
  await dialog.getByRole('button',{name:'取消',exact:true}).click();await toggle.click();
  assert.equal(await box.isChecked(),false);assert.equal(await enable.isEnabled(),false);assert.equal(await content.evaluate(el=>el.scrollTop),0);
  assert.ok(await dialog.getByRole('button',{name:'取消',exact:true}).isEnabled());
  if([1060,320].includes(width))await page.screenshot({path:`${output}/${platform}-notice-${width}-${theme}.png`});
  await readToEnd(page,content,enable,box,'wheel');await enable.click();await dialog.waitFor({state:'hidden'});
  await page.goto(`http://127.0.0.1:${port}/?desktop=1`);
  await page.getByRole('button',{name:platform==='unipus'?'U校园 AI 版':'超星学习通',exact:true}).click();
  await page.getByRole('button',{name:'模型与设置',exact:true}).click();
  const model=page.getByRole('dialog',{name:`${name}模型与设置`,exact:true});
  const skillToggle=model.getByRole('checkbox',{name:'参考已有本地 Skill（默认关闭，增加输入 token）',exact:true});
  const skillHeight=width<=390?560:800;await page.setViewportSize({width,height:skillHeight});
  await skillToggle.click();
  const skill=page.getByRole('dialog',{name:`开启${name}本地 Skill`,exact:true}),skillContent=skill.locator('.study-notice-content'),skillBox=skill.getByRole('checkbox'),accept=skill.getByRole('button',{name:'开启并返回设置',exact:true});
  assert.equal(await skillBox.isChecked(),false);assert.equal(await accept.isEnabled(),false);
  await readToEnd(page,skillContent,accept,skillBox,'keyboard');
  await skill.getByRole('button',{name:'取消',exact:true}).click();await skillToggle.click();
  assert.equal(await skillBox.isChecked(),false);assert.equal(await skillContent.evaluate(el=>el.scrollTop),0);
  const overflows=await skillContent.evaluate(el=>el.scrollHeight>el.clientHeight+2);
  if(overflows)assert.ok(await skill.getByText('请滚动至协议底部后再同意',{exact:true}).isVisible());
  await readToEnd(page,skillContent,accept,skillBox,width===320&&theme==='dark'?'touch':'wheel');
  if([1060,320].includes(width))await page.screenshot({path:`${output}/${platform}-skill-${width}-${theme}.png`});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const bounds=await skill.boundingBox();assert.ok(bounds.y>=0&&bounds.y+bounds.height<=skillHeight+0.5);
  await accept.click();await skill.waitFor({state:'hidden'});assert.equal(await skillToggle.isChecked(),true);
  await context.close();cases++;
 }
 assert.deepEqual(errors,[]);assert.ok(!writes.some(p=>/start|resume|models|model\/test/.test(p)));
 console.log(JSON.stringify({cases,keyboard,wheel,touch,short,reset:true,checkboxRequired:true,startedTasks:0}));
}finally{await browser.close();await server.app.close();rmSync(dir,{recursive:true,force:true});}
