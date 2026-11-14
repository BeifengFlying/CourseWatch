import type { BrowserContext, Page } from 'playwright';
import { studyPageKind, unipusPageKind, type StudyPlatform, type StudyStatus } from '../../contracts/src/study.js';
import { assertPageAllowed } from './page.js';
import { keepUnipusActive, releaseUnipusActivity } from './unipus-activity.js';
import { unipusContentReady } from './unipus-launch.js';
import { unipusFrames } from './unipus-page.js';
// A passive local status check. It sends no heartbeat, mouse/keyboard event,
// completion report or answer to the website, and never resumes paused media.
export async function inspectKeptPage(page: Page, platform: StudyPlatform, allowIdleConfirmation = false) {
  const kind=platform==='unipus'?unipusPageKind(page.url()):studyPageKind(page.url());
  if(kind==='login')throw new Error('登录已失效，请停止后在官方窗口登录');
  if(kind==='exam')throw new Error('考试或测评不在页面保留范围内');
  if(platform==='unipus') {
    if (!(await unipusFrames(page,allowIdleConfirmation)).length || !await unipusContentReady(page)) throw new Error('尚未进入 U校园学习内容页，请打开教程后继续');
  } else await assertPageAllowed(page);
}
export async function keepPageOpen(context:BrowserContext|(()=>BrowserContext),platform:StudyPlatform,status:StudyStatus,send:()=>void,stopped:()=>boolean, signal?:()=>AbortSignal, onIteration?:(pending:Promise<void>|undefined)=>void) {
  let nextCheck=0;
  while(!stopped()) {
    const page=(typeof context === 'function' ? context() : context).pages().filter(p=>!p.isClosed()).at(-1);if(!page)break;
    if (status.phase === 'paused') { await releaseUnipusActivity(page); await new Promise(resolve=>setTimeout(resolve,1000)); continue; }
    if(Date.now()>=nextCheck){
      let finish!:()=>void;
      onIteration?.(new Promise<void>(resolve=>{finish=resolve;}));
      try{
        if(platform==='unipus'){await inspectKeptPage(page,platform,true);await keepUnipusActive(page,signal?.());status.message='U校园自动保活中；实际学时以官网记录为准';}
        else{await inspectKeptPage(page,platform);status.message='页面已保留；按设定时间关闭，本机状态检查不会改变平台学时';}
      }
      catch(e){if(!stopped() && !signal?.().aborted){status.phase='paused';status.message=(e as Error).message;}await releaseUnipusActivity(page);}
      finally { finish?.(); onIteration?.(undefined); }
      status.heartbeatAt=Date.now();send();nextCheck=Date.now()+5000;
    }
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
}
