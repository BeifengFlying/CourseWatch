import { it, expect, vi } from 'vitest';
import { unipusBrowserState, saveUnipusSession, trackUnipusSession } from '../packages/adapters/src/unipus-session.js';
import { unipusPageKind } from '../packages/contracts/src/study.js';
const token={jwt:'official-fixture-token',rt:'official-fixture-refresh',jwtExpire:2000000000,rtExpire:2000000100};
const state=()=>({cookies:[{name:'jwt',value:token.jwt,domain:'.unipus.cn',path:'/',expires:-1,httpOnly:false,secure:true,sameSite:'None' as const}],origins:[{origin:'https://uai.unipus.cn',localStorage:[{name:'PORTAL_STATE_PERSISTENT',value:JSON.stringify({tokenInfo:token})}]}]});
it('新版门户的同一官方会话恢复到课程应用读取字段，不修改原始会话或Cookie',()=>{
 const original=state(),restored=unipusBrowserState(original);
 expect(restored.origins[0].localStorage.find(v=>v.name==='__token')?.value).toBe(JSON.stringify(token));
 expect(restored.origins.some(o=>o.origin==='https://ucontent.unipus.cn')).toBe(false);
 expect(original.origins[0].localStorage).toHaveLength(1);expect(restored.cookies).toEqual(original.cookies);
});
it('仅门户域Cookie不能扩展到内容域',()=>{
 const original=state();original.cookies[0].domain='uai.unipus.cn';
 expect(unipusBrowserState(original).origins.some(o=>o.origin==='https://ucontent.unipus.cn')).toBe(false);
});
it('无Cookie、令牌不匹配、损坏数据及其他域不创建课程登录凭据',()=>{
 const cases=[state(),state(),state(),state()];cases[0].cookies=[];cases[1].cookies[0].value='other-account';cases[2].origins[0].localStorage[0].value='bad';cases[3].origins[0].origin='https://other.example';
 for(const original of cases)expect(unipusBrowserState(original)).toEqual(original);
});
it('lesson 学习路由不能因包含 sso 被误判登录，真实登录与考试仍拦截',()=>{
 for(const url of ['https://ucontent.unipus.cn/course/#/lesson/1','https://ucontent.unipus.cn/lesson/reading?lesson=2']) expect(unipusPageKind(url)).toBe('study');
 for(const url of ['https://ucontent.unipus.cn/#/login','https://ucontent.unipus.cn/sso/callback','https://sso.unipus.cn/sso/login']) expect(unipusPageKind(url)).toBe('login');
 expect(unipusPageKind('https://ucontent.unipus.cn/#/lesson/exam')).toBe('exam');
});
it('保存官网刷新的会话，旧任务不能覆盖新登录或恢复已删除的会话',async()=>{
 const baseline=state(),candidate=state();candidate.cookies[0].value='refreshed';candidate.origins[0].localStorage[0].value=JSON.stringify({tokenInfo:{...token,jwt:'refreshed'}});
 const vault={read:vi.fn().mockResolvedValue(baseline),save:vi.fn().mockResolvedValue(undefined)};
 await saveUnipusSession(vault,baseline,candidate);expect(vault.save).toHaveBeenCalledWith('unipus',candidate);
 vault.save.mockClear();const newer=state();newer.origins[0].localStorage[0].value=JSON.stringify({tokenInfo:{...token,jwt:'new-login'}});vault.read.mockResolvedValue(newer);
 expect(await saveUnipusSession(vault,baseline,candidate)).toEqual(newer);expect(vault.save).not.toHaveBeenCalled();
 vault.read.mockResolvedValue(undefined as any);await saveUnipusSession(vault,baseline,candidate);expect(vault.save).not.toHaveBeenCalled();
});
it('学习期间定期保存及停止前保存，停止后不再读浏览器状态',async()=>{
 vi.useFakeTimers();
 try {
  let stored=state();const candidate=state();candidate.origins[0].localStorage[0].value=JSON.stringify({tokenInfo:{...token,jwt:'refreshed'}});
  const vault={read:vi.fn(async()=>stored),save:vi.fn(async(_id:string,value:any)=>{stored=value;})};
  const context={storageState:vi.fn(async()=>candidate)};
  const tracker=trackUnipusSession(context as any,vault,state());await vi.advanceTimersByTimeAsync(60000);
  expect(vault.save).toHaveBeenCalledTimes(1);await tracker.stop();const calls=context.storageState.mock.calls.length;
  await vi.advanceTimersByTimeAsync(120000);expect(context.storageState).toHaveBeenCalledTimes(calls);expect(vi.getTimerCount()).toBe(0);
 }finally{vi.useRealTimers();}
});
