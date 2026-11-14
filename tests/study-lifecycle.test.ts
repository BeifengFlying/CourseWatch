import { EventEmitter } from 'node:events';
import { it, expect, vi, afterEach } from 'vitest';
const created=vi.hoisted(()=>({child:null as any}));
vi.mock('node:child_process',async importOriginal=>({...await importOriginal<typeof import('node:child_process')>(),fork:vi.fn(()=>{
 const child=new EventEmitter() as any;child.connected=true;
 child.send=vi.fn((m:any,callback?:Function)=>{callback?.();if(m.action==='stop')queueMicrotask(()=>{child.connected=false;child.emit('exit',0);});});
 child.kill=vi.fn(()=>child.emit('exit',0));created.child=child;return child;
})}));
import { StudyManager } from '../packages/study/src/manager.js';
import { initialStudyStatus, StudyConfig } from '../packages/contracts/src/study.js';
afterEach(()=>vi.useRealTimers());
it('运行中章节测试设置等待 worker 确认，失败不写入设置', async () => {
 const {createServer}=await import('../apps/local-service/src/server.js');
 const {mkdtempSync,writeFileSync,rmSync}=await import('node:fs');const {join}=await import('node:path');const {tmpdir}=await import('node:os');
 const {STUDY_NOTICE_VERSION}=await import('../packages/contracts/src/study.js');
 const dir=mkdtempSync(join(tmpdir(),'cw-study-tests-'));const server=await createServer({dir,test:true});
 try{
  const pair=await server.app.inject({method:'POST',url:'/api/pair',headers:{host:'127.0.0.1:17321'},payload:{code:server.pairingCode}});
  const headers={host:'127.0.0.1:17321',authorization:`Bearer ${pair.json().token}`};
  await server.app.inject({method:'POST',url:'/api/study/accept',headers,payload:{accepted:true,noticeVersion:STUDY_NOTICE_VERSION}});
  writeFileSync(join(dir,'chaoxing.encrypted'),'fixture');
  await server.app.inject({method:'POST',url:'/api/study/start',headers,payload:{operation:'play'}});
  created.child.emit('message',{status:{...initialStudyStatus(),phase:'running'}});
  const initial=(await server.app.inject({url:'/api/study/settings',headers})).json();const {hasKey,active,...config}=initial;
  expect(config.chapterTests).toBe(true);
  const patch=()=>server.app.inject({method:'PATCH',url:'/api/study/settings',headers,payload:{...config,chapterTests:false}}).then(r=>r);
  const first=patch();await new Promise(r=>setTimeout(r,10));
  const message=created.child.send.mock.calls.at(-1)[0];expect(message).toMatchObject({action:'chapter-tests',enabled:false});
  expect(server.store.get<any>('studyConfig',{}).chapterTests).toBe(true);
  created.child.emit('message',{settingsRequest:message.requestId,error:'提交结果仍待核实'});
  expect((await first).statusCode).toBe(409);expect(server.store.get<any>('studyConfig',{}).chapterTests).toBe(true);
  const second=patch();await new Promise(r=>setTimeout(r,10));const confirm=created.child.send.mock.calls.at(-1)[0];
  created.child.emit('message',{settingsRequest:confirm.requestId});expect((await second).json().chapterTests).toBe(false);
  expect(server.store.get<any>('studyConfig',{}).chapterTests).toBe(false);
  expect(created.child.send.mock.calls.filter(([m]:any[])=>m.action==='start')).toHaveLength(1);
 }finally{await server.app.close();rmSync(dir,{recursive:true,force:true});}
});
it('异常暂停和失败进入通知回调，重复状态及手动暂停不重复通知', async () => {
 const notify=vi.fn(), manager=new StudyManager('chaoxing',undefined,notify);
 manager.start('/fixture',StudyConfig.parse({}),'');
 const child=created.child;
 child.emit('message',{status:{...initialStudyStatus(),phase:'running'}});
 child.emit('message',{status:{...initialStudyStatus(),phase:'paused',message:'模型服务限流'}});
 child.emit('message',{status:{...initialStudyStatus(),phase:'paused',message:'模型服务限流'}});
 expect(notify).toHaveBeenCalledTimes(1);expect(notify.mock.calls[0][1].message).toBe('模型服务限流');
 manager.command('resume'); manager.command('pause');
 child.emit('message',{status:{...initialStudyStatus(),phase:'paused',message:'已暂停'}});
 expect(notify).toHaveBeenCalledTimes(1);
 manager.command('resume'); child.emit('exit',1);
 expect(notify).toHaveBeenCalledTimes(2);expect(notify.mock.calls[1][1].phase).toBe('failed');
});
it('学习异常写入应用通知队列，重复进度不会重复入队', async () => {
 const {createServer}=await import('../apps/local-service/src/server.js');
 const {mkdtempSync,writeFileSync,rmSync}=await import('node:fs');
 const {join}=await import('node:path');const {tmpdir}=await import('node:os');
 const {STUDY_NOTICE_VERSION}=await import('../packages/contracts/src/study.js');
 const dir=mkdtempSync(join(tmpdir(),'cw-study-notice-'));const server=await createServer({dir,test:true});
 try{
  const pair=await server.app.inject({method:'POST',url:'/api/pair',headers:{host:'127.0.0.1:17321'},payload:{code:server.pairingCode}});
  const headers={host:'127.0.0.1:17321',authorization:`Bearer ${pair.json().token}`};
  await server.app.inject({method:'POST',url:'/api/study/accept',headers,payload:{accepted:true,noticeVersion:STUDY_NOTICE_VERSION}});
  writeFileSync(join(dir,'chaoxing.encrypted'),'fixture');
  expect((await server.app.inject({method:'POST',url:'/api/study/start',headers})).statusCode).toBe(200);
  const state={...initialStudyStatus(),phase:'paused',courseName:'模拟课程',message:'下一节尚未开放，请手动处理'};
  created.child.emit('message',{status:state});created.child.emit('message',{status:state});
  const items=(await server.app.inject({url:'/api/notifications',headers})).json().items.filter((item:any)=>item.kind==='study');
  expect(items).toHaveLength(1);expect(items[0]).toMatchObject({title:'学习通 · 学习已暂停'});expect(items[0].body).toContain('下一节尚未开放');
 }finally{await server.app.close();rmSync(dir,{recursive:true,force:true});}
});
it('打开运行窗口使用当前 worker 并等待确认，窗口退出后拒绝打开', async () => {
 const manager = new StudyManager();
 manager.start('/fixture', StudyConfig.parse({}), '', {operation:'play',background:true,closeAfterMinutes:0});
 const child = created.child;
 const count = child.listenerCount('message');
 const showing = manager.showWindow();
 const message = child.send.mock.calls.at(-1)[0];
 expect(message.action).toBe('show');
 child.emit('message', {windowRequest:message.requestId});
 expect(await showing).toEqual({ok:true});
 expect(child.listenerCount('message')).toBe(count);
 expect(manager.status().phase).toBe('starting');
 await manager.stop(); await expect(manager.showWindow()).rejects.toThrow('没有可打开');
});
it('即使暂停，定时关闭也会关闭页面，清理定时器并标记本轮结束',async()=>{
 vi.useFakeTimers();const manager=new StudyManager('unipus');manager.start('/fixture',StudyConfig.parse({}),'',{operation:'keep-open',background:true,closeAfterMinutes:1});
 created.child.emit('message',{status:{...initialStudyStatus(),phase:'paused',message:'验证待处理'}});
 expect(manager.status().closeAt).toBe(Date.now()+60000);expect(manager.status().heartbeatAt).toBe(Date.now());
 await vi.advanceTimersByTimeAsync(60000);expect(manager.active).toBe(false);expect(manager.status()).toMatchObject({phase:'completed',closeAt:null});expect(created.child.send).toHaveBeenCalledWith({action:'stop'},expect.any(Function));expect(vi.getTimerCount()).toBe(0);
});
it('手动停止取消关闭倒计时，之后不会改变新任务的状态',async()=>{
 vi.useFakeTimers();const manager=new StudyManager();manager.start('/fixture',StudyConfig.parse({}),'',{operation:'play',background:false,closeAfterMinutes:1});await manager.stop();
 manager.start('/fixture',StudyConfig.parse({}),'',{operation:'play',background:false,closeAfterMinutes:0});created.child.emit('message',{status:{...initialStudyStatus(),phase:'running'}});
 await vi.advanceTimersByTimeAsync(60000);expect(manager.status().phase).toBe('running');await manager.stop();expect(vi.getTimerCount()).toBe(0);
});
it('切换等待 worker 确认，重复操作及并发暂停被阻止，保留课程名',async()=>{
 vi.useFakeTimers();const manager=new StudyManager();manager.start('/fixture',StudyConfig.parse({}),'',{operation:'play',background:true,closeAfterMinutes:0,course:{key:'course:1:class:2',name:'模拟课程'}});
 created.child.emit('message',{status:{...initialStudyStatus(),phase:'paused',navigation:{previous:false,next:true}}});
 expect(manager.status().courseName).toBe('模拟课程');await expect(manager.navigate('previous')).rejects.toThrow('没有可用');
 const pending=manager.navigate('next');const message=created.child.send.mock.calls.at(-1)[0];
 await expect(manager.navigate('next')).rejects.toThrow('正在切换');expect(()=>manager.command('resume')).toThrow('正在切换');
 created.child.emit('message',{status:{...initialStudyStatus(),phase:'paused',navigation:{previous:true,next:false}}});created.child.emit('message',{navigationRequest:message.requestId});
 expect(await pending).toMatchObject({phase:'paused',courseName:'模拟课程',navigation:{previous:true,next:false}});await manager.stop();expect(vi.getTimerCount()).toBe(0);
});
it('导航无响应超时和 worker 退出都会结束请求，不遗留监听器',async()=>{
 vi.useFakeTimers();const manager=new StudyManager();manager.start('/fixture',StudyConfig.parse({}),'',{operation:'play',background:true,closeAfterMinutes:0});
 created.child.emit('message',{status:{...initialStudyStatus(),phase:'running',navigation:{previous:false,next:true}}});
 const count=created.child.listenerCount('message');const pending=expect(manager.navigate('next')).rejects.toThrow('未确认');await vi.advanceTimersByTimeAsync(30000);await pending;expect(created.child.listenerCount('message')).toBe(count);
 manager.start('/fixture',StudyConfig.parse({}),'',{operation:'play',background:true,closeAfterMinutes:0});created.child.emit('message',{status:{...initialStudyStatus(),phase:'running',navigation:{previous:false,next:true}}});
 const exiting=expect(manager.navigate('next')).rejects.toThrow('进程已退出');await manager.stop();await exiting;expect(vi.getTimerCount()).toBe(0);
});
it('位置仅记入所选课程，重启读取上次章节，显式选择覆盖记忆且移除课程后不可读取',async()=>{
 const {createServer}=await import('../apps/local-service/src/server.js');
 const {mkdtempSync,writeFileSync,rmSync}=await import('node:fs');
 const {join}=await import('node:path');const {tmpdir}=await import('node:os');
 const {STUDY_NOTICE_VERSION}=await import('../packages/contracts/src/study.js');
 const dir=mkdtempSync(join(tmpdir(),'cw-study-position-'));const server=await createServer({dir,test:true});
 try{
  const pair=await server.app.inject({method:'POST',url:'/api/pair',headers:{host:'127.0.0.1:17321'},payload:{code:server.pairingCode}});
  const headers={host:'127.0.0.1:17321',authorization:`Bearer ${pair.json().token}`};
  await server.app.inject({method:'POST',url:'/api/study/accept',headers,payload:{accepted:true,noticeVersion:STUDY_NOTICE_VERSION}});
  writeFileSync(join(dir,'chaoxing.encrypted'),'fixture');
  const platform=server.store.get<any>('platform:chaoxing',{});
  server.engine.rememberCourse('chaoxing',platform.accountId,'course:1:class:2','模拟课程');
  const course=server.engine.courses().find(c=>c.platform==='chaoxing')!;server.engine.selectCourses('chaoxing',platform.accountId,[course.id]);
  const url='/api/study/position?courseId='+course.id;
  expect((await server.app.inject({url,headers})).json().position).toBeNull();
  await server.app.inject({method:'POST',url:'/api/study/start',headers,payload:{courseId:course.id}});
  const progress={course:course.name,chapter:'第二章',chapterId:'2',tabId:'dct2',courseKey:'course:wrong:class:2',chapterComplete:null,media:[],documents:[],chapters:[{id:'2',name:'第二章',complete:null,locked:false},{id:'3',name:'第三章',complete:null,locked:true}],observedAt:12345};
  created.child.emit('message',{status:{...initialStudyStatus(),phase:'paused',progress}});
  expect((await server.app.inject({url,headers})).json().position).toBeNull();
  created.child.emit('message',{status:{...initialStudyStatus(),phase:'paused',progress:{...progress,courseKey:course.key}}});
  expect((await server.app.inject({url,headers})).json().position).toEqual({chapter:'第二章',chapterId:'2',tabId:'dct2',observedAt:12345});
  expect((await server.app.inject({method:'POST',url:'/api/study/chapter',headers,payload:{chapterId:'3'}})).statusCode).toBe(409);
  const switching=server.app.inject({method:'POST',url:'/api/study/chapter',headers,payload:{chapterId:'2'}});
  const response=switching.then(r=>r);await new Promise(r=>setTimeout(r,10));
  const command=created.child.send.mock.calls.at(-1)[0];expect(command).toMatchObject({action:'chapter',chapterId:'2'});
  created.child.emit('message',{navigationRequest:command.requestId});expect((await response).statusCode).toBe(200);
  await server.app.inject({method:'POST',url:'/api/study/stop',headers});
  await server.app.inject({method:'POST',url:'/api/study/start',headers,payload:{courseId:course.id}});
  expect(created.child.send.mock.calls[0][0].options.position).toMatchObject({chapterId:'2',tabId:'dct2'});
  await server.app.inject({method:'POST',url:'/api/study/stop',headers});
  await server.app.inject({method:'POST',url:'/api/study/start',headers,payload:{courseId:course.id,chapterId:'1'}});
  expect(created.child.send.mock.calls[0][0].options).toMatchObject({chapterId:'1'});expect(created.child.send.mock.calls[0][0].options.position).toBeUndefined();
  await server.app.inject({method:'POST',url:'/api/study/stop',headers});
  server.engine.selectCourses('chaoxing',platform.accountId,[]);expect((await server.app.inject({url,headers})).statusCode).toBe(400);
 }finally{await server.app.close();rmSync(dir,{recursive:true,force:true});}
});



it('每次启动学习窗口读取当前浏览器选择，不修改运行中的窗口', async () => {
 const {fork}=await import('node:child_process'); let selected='edge';
 const manager=new StudyManager('chaoxing',undefined,undefined,undefined,()=>selected);
 manager.start('/fixture',StudyConfig.parse({}),'');
 expect(vi.mocked(fork).mock.calls.at(-1)?.[2]?.env?.COURSEWATCH_BROWSER).toBe('edge');
 created.child.emit('exit',0); selected='chrome';
 manager.start('/fixture',StudyConfig.parse({}),'');
 expect(vi.mocked(fork).mock.calls.at(-1)?.[2]?.env?.COURSEWATCH_BROWSER).toBe('chrome');
 created.child.emit('exit',0);
});
