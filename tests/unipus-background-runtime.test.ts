import { expect, it, vi } from 'vitest';
import { chromium, type LaunchOptions, type Page } from 'playwright';
import { StudyConfig, UNIPUS_STUDY_NOTICE_VERSION } from '../packages/contracts/src/study.js';

const fixture = vi.hoisted(()=>({pages:[] as Page[]}));
vi.mock('../packages/adapters/src/vault.js',()=>({Vault:class{async read(){return {cookies:[],origins:[]};}async save(){}}}));
vi.mock('../packages/adapters/src/browser.js',()=>({browserLaunchOptions:async()=>({channel:'chromium'}),browserStartupArgs:()=>[]}));
vi.mock('../packages/study/src/window.js',()=>({showStudyWindow:vi.fn(async()=>{})}));
vi.mock('../packages/study/src/launch.js',()=>({openCourse:async(context:any)=>{
  const page=await context.newPage();fixture.pages.push(page);
  await page.goto('https://ucontent.unipus.cn/course/#/reading');return page;
}}));

it('U校园 worker 仅在 show 指令后请求可见窗口，保持暂停，resume 后回到无界面且停止不重开',async()=>{
  const previousListeners=new Map(['message','SIGTERM','disconnect'].map(event=>[event,new Set(process.listeners(event))]));
  const previousSend=process.send,messages:any[]=[],launches:LaunchOptions[]=[];
  process.send=((message:any)=>{messages.push(structuredClone(message));return true;}) as any;
  const exit=vi.spyOn(process,'exit').mockImplementation((()=>{}) as any);
  const originalLaunch=chromium.launch.bind(chromium);
  const launch=vi.spyOn(chromium,'launch').mockImplementation(async options=>{
    launches.push(options!);
    // Test the actual worker while keeping even explicit show requests offscreen.
    const browser=await originalLaunch({...options,headless:true});
    const originalContext=browser.newContext.bind(browser);
    browser.newContext=async options=>{
      const context=await originalContext(options);
      await context.route('**/*',r=>r.fulfill({contentType:'text/html',body:'<div class="reading-content">阅读内容</div><script>document.addEventListener("mousemove",()=>{window.focus();document.body.dataset.moves=String(Number(document.body.dataset.moves||0)+1)})</script>'}));
      return context;
    };
    return browser;
  });
  const emit=(message:any)=>process.emit('message',message,undefined);
  const lastStatus=()=>messages.filter(m=>m.status).at(-1)?.status;
  try{
    await import('../packages/study/src/unipus-worker.js');
    emit({action:'start',dir:'/fixture',config:StudyConfig.parse({enabled:true,noticeVersion:UNIPUS_STUDY_NOTICE_VERSION}),options:{operation:'keep-open',background:true}});
    await vi.waitFor(()=>expect(lastStatus()?.phase).toBe('running'),{timeout:6000});
    await vi.waitFor(async()=>expect(await fixture.pages[0].locator('body').getAttribute('data-moves')).toBe('1'));
    expect(launches.map(o=>o.headless)).toEqual([true]);
    emit({action:'show',requestId:'show-fixture'});
    await vi.waitFor(()=>expect(messages.some(m=>m.windowRequest==='show-fixture'&&!m.error)).toBe(true),{timeout:6000});
    expect(lastStatus()?.phase).toBe('paused');
    expect(launches.map(o=>o.headless)).toEqual([true,false]);
    emit({action:'resume'});
    await vi.waitFor(()=>expect(lastStatus()?.phase).toBe('running'),{timeout:6000});
    expect(launches.map(o=>o.headless)).toEqual([true,false,true]);
  }finally{
    emit({action:'stop'});
    await vi.waitFor(()=>expect(exit.mock.calls.length).toBeGreaterThanOrEqual(2),{timeout:6000});
    for(const [event,before] of previousListeners)for(const listener of process.listeners(event))if(!before.has(listener))process.removeListener(event,listener);
    process.send=previousSend;exit.mockRestore();launch.mockRestore();
  }
},20000);
