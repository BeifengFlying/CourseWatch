import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
const created=vi.hoisted(()=>({child:null as any}));
vi.mock('node:child_process',()=>({fork:vi.fn(()=>{
 const child=new EventEmitter() as any;
 child.connected=true;child.exitCode=null;child.signalCode=null;
 child.send=vi.fn((_message:any,callback?:Function)=>callback?.());
 child.disconnect=vi.fn(()=>{child.connected=false;child.exitCode=0;child.emit('exit',0);});
 child.kill=vi.fn(()=>{child.signalCode='SIGTERM';child.emit('exit',null);});
 created.child=child;return child;
})}));
import { CourseCatalogManager } from '../packages/study/src/catalog-manager.js';
afterEach(()=>vi.useRealTimers());
it('部分课程超时时返回已读取结果，并释放查询进程',async()=>{
 vi.useFakeTimers();const manager=new CourseCatalogManager();
 const request=manager.read('/fixture','chaoxing',[]);
 created.child.emit('message',{diagnostic:{event:'http-error',stage:'browser',facts:{status:503}}});
 expect(manager.active).toBe(true);
 const sample={courseId:'one',name:'模拟课程',completed:0,total:70,percent:null,chapters:[],observedAt:100};
 created.child.emit('message',{partial:{items:[sample],issues:[]}});
 expect(manager.active).toBe(true);
 await vi.advanceTimersByTimeAsync(90000);
 const result=await request;expect(result.items).toEqual([sample]);expect(result.issues[0]).toContain('部分课程读取超时');
 expect(created.child.disconnect).toHaveBeenCalledOnce();expect(manager.active).toBe(false);expect(vi.getTimerCount()).toBe(0);
});
it('尚无成功结果时超时仍报错，不返回空成功',async()=>{
 vi.useFakeTimers();const manager=new CourseCatalogManager();const request=manager.read('/fixture','chaoxing',[]);
 const rejected=expect(request).rejects.toThrow('课程进度读取超时');
 created.child.emit('message',{partial:{items:[],issues:['模拟课程：读取失败']}});
 await vi.advanceTimersByTimeAsync(90000);await rejected;
 expect(manager.active).toBe(false);expect(vi.getTimerCount()).toBe(0);
});
