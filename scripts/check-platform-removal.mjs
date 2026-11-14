// Synthetic local fixtures only; no platform requests or real account data.
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright';
import {createServer} from '../apps/local-service/src/server.ts';
import {platforms} from '../packages/contracts/src/index.ts';
const dir=mkdtempSync(join(tmpdir(),'cw-platform-removal-')), token='removal-ui-fixture-'.repeat(5), port=17336;
process.env.COURSEWATCH_NATIVE_TOKEN=token;
const server=await createServer({dir,port,test:true});
for (const id of Object.keys(platforms)) server.store.set(`platform:${id}`,{...server.store.get(`platform:${id}`,{}),added:true,loginStatus:'logged_in'});
const p=server.store.get('platform:ynjy',{}), now=Date.now();
server.engine.apply({platform:'ynjy',accountId:p.accountId,outcome:'partial',discoveryComplete:false,partitions:[{key:'fixture',outcome:'partial',paginationComplete:false,emptyConfirmed:false,issues:[],items:[{sourceId:'fixture',namespace:'fixture',course:'模拟课程',title:'模拟作业',type:'homework',sourceStatus:'pending',deadline:{kind:'known',value:now+86400000,raw:'fixture',timezone:'Asia/Shanghai'},startTime:{kind:'unknown'},publishTime:{kind:'unknown'}}]}],issues:[]});
await server.app.listen({host:'127.0.0.1',port});
const browser=await chromium.launch({headless:true,channel:'chromium'}),context=await browser.newContext({viewport:{width:1060,height:720}});
await context.addInitScript(token=>localStorage.setItem('coursewatch-client-token',token),token);
const page=await context.newPage(), errors=[];page.on('pageerror',e=>errors.push(e.message));
mkdirSync('docs/screenshots',{recursive:true});
try {
 await page.goto(`http://127.0.0.1:${port}/?desktop=1`);
 await page.getByRole('tab',{name:/作业/}).click();
 await page.getByRole('button',{name:'全部',exact:true}).click();
 await page.getByText('模拟作业',{exact:true}).waitFor();
 for(const width of [1060,820,390,320])for(const theme of ['light','dark']){
  await page.setViewportSize({width,height:720});await page.emulateMedia({colorScheme:theme});
  assert.ok(!(await page.locator('body').innerText()).includes('到梦空间'));
  assert.equal(await page.getByRole('button',{name:'到梦空间',exact:true}).count(),0);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:`docs/screenshots/platform-removal-${width}-${theme}.png`});
 }
 await page.setViewportSize({width:1060,height:720});
 await page.getByRole('button',{name:'添加平台',exact:true}).click();
 assert.equal(await page.getByRole('button',{name:'到梦空间',exact:false}).count(),0);
 assert.equal(await page.locator('.platform-picker button').count(),5);
 assert.deepEqual(errors,[]);
 console.log('平台移除界面通过：五个平台、正常任务、添加平台、1060/820/390/320px 两主题，无横向溢出或页面错误。');
}finally{await browser.close();await server.app.close();rmSync(dir,{recursive:true,force:true});}
