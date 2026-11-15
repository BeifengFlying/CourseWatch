import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../apps/local-service/src/server.js";
import { collectUnipus, parseUnipusCourses, parseUnipusTasks, unipusHeaders, unipusOrigin, unipusUrls } from "../packages/adapters/src/unipus.js";
import { confirmLogin } from "../packages/adapters/src/session.js";
import { ScanResult, discoversCourses, ScheduleInput } from "../packages/contracts/src/index.js";
import type { BrowserContext } from "playwright";
const json = (data: unknown) => JSON.stringify({code: 1, ...data as object});
const shelf = json({value:{groups:{CLASS_COURSE:[{resourceId:7,name:"英语"}], PERSONAL:[{resourceId:7,name:"英语"},{resourceId:8,name:"英语"}]}}});
const homework = json({data:{homework:{total:4,items:[{assignmentId:"a",platform:"UAI",title:"阅读",classes:[{className:"英语一班"}],endTime:"2026-11-20 12:00:00",detailSsoUrl:`${unipusOrigin}/sso?ticket=secret`}]}}});
const exams = json({data:{totalCount:1,items:[{examId:9,examName:"期末考试",examStatus:2,examEndTime:1795147200,examUrl:"https://itest.unipus.cn/?token=secret"}]}});
it("U校园教程同名按实际 ID 保留，不推断任务的教程和完成状态，也不保存 SSO 凭证链接", () => {
  expect(parseUnipusCourses(shelf).map(c=>c.key)).toEqual(["resource:7","resource:8"]);
  const hw = parseUnipusTasks(homework,"homework");
  expect(hw.items[0]).toMatchObject({courseKey:`class:${encodeURIComponent("英语一班")}`, sourceStatus:"unknown",deadline:{kind:"known",value:Date.parse("2026-11-20T12:00:00+08:00")},url:`${unipusOrigin}/`});
  expect(hw.issues.join()).toContain("部分任务");
  expect(JSON.stringify(hw)).not.toContain("secret");
  const exam = parseUnipusTasks(exams,"exam");
  expect(exam.items[0]).toMatchObject({courseKey:"unassigned:exam",sourceStatus:"in_progress",deadline:{kind:"known",value:1795147200000},url:`${unipusOrigin}/`});
  expect(parseUnipusTasks(exams.replace('"examStatus":2','"examStatus":99'),"exam").items[0].sourceStatus).toBe("unknown");
});
it("U校园首次发现分组，选择后只保存相应任务，汇总永远不宣称完整覆盖", async () => {
  const read = vi.fn(async (url:string)=>url===unipusUrls.courses?shelf:url===unipusUrls.homework?homework:exams);
  const initial = ScanResult.parse(await collectUnipus(read, randomUUID(), {}, []));
  expect(initial.courses).toHaveLength(4);
  expect(initial.partitions.flatMap(p=>p.items)).toHaveLength(0);
  const selected = ScanResult.parse(await collectUnipus(read, randomUUID(), {}, ["unassigned:exam"]));
  expect(selected).toMatchObject({outcome:"partial",discoveryComplete:false});
  expect(selected.partitions.flatMap(p=>p.items)).toHaveLength(1);
  expect(selected.partitions.every(p=>!p.paginationComplete&&!p.emptyConfirmed)).toBe(true);
});
it("U校园拒绝未知空结构，合法空汇总不据此撤销旧任务，作业失败仍保留考试结果", async () => {
  expect(()=>parseUnipusCourses(json({value:{}}))).toThrow();
  expect(()=>parseUnipusTasks(json({data:[]}),"homework")).toThrow();
  const empty = await collectUnipus(async url=>url===unipusUrls.courses?shelf:url===unipusUrls.homework?json({data:{homework:{total:0,items:[]}}}):json({data:{totalCount:0,items:[]}}),randomUUID(),{},[]);
  expect(empty.partitions.every(p=>!p.emptyConfirmed)).toBe(true);
  const partial = await collectUnipus(async url=>url===unipusUrls.courses?shelf:url===unipusUrls.homework?'{}':exams,randomUUID(),{},["unassigned:exam"]);
  expect(partial.partitions[0].outcome).toBe("failed");
  expect(partial.partitions[1].items).toHaveLength(1);
});
it.each([[3008,"auth_required"],[6001,"verification_required"]])("U校园返回 %s 时不提交任务", async (code,outcome) => {
  const result = await collectUnipus(async()=>JSON.stringify({code}),randomUUID(),{},[]);
  expect(result).toMatchObject({outcome,partitions:[]});
});
it("U校园只从正确来源提取会话，并以受保护书架接口确认登录", async () => {
  const token=`header.${Buffer.from(JSON.stringify({openId:"open-id"})).toString("base64url")}.signature`;
  const origins=[{origin:unipusOrigin,localStorage:[{name:"PORTAL_STATE_PERSISTENT",value:JSON.stringify({tokenInfo:{jwt:token},schId:123})}]}];
  expect(unipusHeaders({origins})).toMatchObject({Authorization:token,"u-school":"123","u-openid":"open-id"});
  expect(()=>unipusHeaders({origins:[{...origins[0],origin:"https://example.com"}]})).toThrow();
  const get=vi.fn(async(url:string)=>({url:()=>url,status:()=>200,ok:()=>true,headers:()=>({}),text:async()=>shelf,dispose:async()=>{}}));
  const ctx={storageState:async()=>({cookies:[],origins}),request:{get}} as unknown as BrowserContext;
  await expect(confirmLogin(ctx,"unipus")).resolves.toBeUndefined();
  expect(get.mock.calls[0][0]).toBe(unipusUrls.courses);
});
let dir:string, server:Awaited<ReturnType<typeof createServer>>;
const token="n".repeat(64), host={host:"127.0.0.1:17321"}, headers={...host,authorization:`Bearer ${token}`,origin:"http://127.0.0.1:17321"};
beforeEach(async context=> {
  if(!context.task.name.startsWith("本地")) return;
  vi.stubEnv("COURSEWATCH_NATIVE_TOKEN",token);
  dir=mkdtempSync(join(tmpdir(),"cw-new-platforms-")); server=await createServer({dir,test:true});
});
afterEach(async context=> {
  if(!context.task.name.startsWith("本地")) return;
  await server.app.close();rmSync(dir,{recursive:true,force:true});vi.unstubAllEnvs();
});
it("本地页面和轮询不耗尽平台添加额度，超过三个后仍可添加全部五个平台",async()=> {
  for(let i=0;i<140;i++) {
    expect((await server.app.inject({url:"/",headers:host})).statusCode).toBe(200);
    expect((await server.app.inject({url:"/api/platforms",headers})).statusCode).toBe(200);
  }
  for(const id of ["ynjy","renwei","chaoxing","yuketang","unipus"]) {
    expect((await server.app.inject({url:`/api/platforms/${id}`,method:"PATCH",headers,payload:{added:true}})).statusCode).toBe(200);
  }
  expect((await server.app.inject({url:"/api/platforms",headers})).json().items.filter((p:any)=>p.added)).toHaveLength(5);
  // Exhaust the mutation bucket without preventing reload, reads, or pairing limits.
  for(let i=0;i<119;i++) await server.app.inject({url:"/api/platforms/unipus",method:"PATCH",headers,payload:{added:true}});
  expect((await server.app.inject({url:"/api/platforms/unipus",method:"PATCH",headers,payload:{added:true}})).statusCode).toBe(429);
  expect((await server.app.inject({url:"/",headers:host})).statusCode).toBe(200);
  expect((await server.app.inject({url:"/api/platforms",headers})).statusCode).toBe(200);
  for(let i=0;i<6;i++) await server.app.inject({url:"/api/pair",method:"POST",headers:host,payload:{code:"bad"}});
  expect((await server.app.inject({url:"/api/pair",method:"POST",headers:host,payload:{code:"bad"}})).statusCode).toBe(429);
});
it("U校园长班级名称仍产生有效且稳定的任务标识",async()=> {
  const long = homework.replaceAll("英语一班","大学英语".repeat(60));
  const read=async(url:string)=>url===unipusUrls.courses?shelf:url===unipusUrls.homework?long:exams;
  const initial=await collectUnipus(read,randomUUID(),{},[]);
  const key=initial.courses!.find(c=>c.key.startsWith('class:'))!.key;
  const chosen=ScanResult.parse(await collectUnipus(read,randomUUID(),{},[key]));
  expect(chosen.partitions[0].items).toHaveLength(1);
});
it("U校园会话缺少令牌时返回需要登录，并回收 HTTP 上下文",async()=> {
  const { request }=await import("playwright");
  const { Vault }=await import("../packages/adapters/src/vault.js");
  const { Adapters }=await import("../packages/adapters/src/index.js");
  const read=vi.spyOn(Vault.prototype,"read").mockResolvedValue({cookies:[],origins:[]});
  const dispose=vi.fn(async()=>{});
  const client=vi.spyOn(request,"newContext").mockResolvedValue({dispose} as any);
  try {
    const result=await new Adapters('unused').scan({id:'unipus',accountId:randomUUID(),enabled:true,sources:[],loginStatus:'unknown',lastScanAt:null,lastSuccessAt:null,nextScanAt:0,failures:0,lastOutcome:'not_scanned',message:''});
    expect(result.outcome).toBe('auth_required');expect(dispose).toHaveBeenCalledTimes(1);
  } finally {read.mockRestore();client.mockRestore();}
});
it('U校园后台遇到令牌失效时只恢复一次官网会话，重新读取并保存刷新结果',async()=>{
 const {request}=await import('playwright');const {Vault}=await import('../packages/adapters/src/vault.js');const {Adapters}=await import('../packages/adapters/src/index.js');
 const sessions=await import('../packages/adapters/src/unipus-session.js');
 const makeState=(jwt:string)=>({cookies:[],origins:[{origin:unipusOrigin,localStorage:[{name:'PORTAL_STATE_PERSISTENT',value:JSON.stringify({tokenInfo:{jwt,rt:'official-refresh-fixture'}})}]}]});
 const original=makeState('expired-fixture'),refreshed=makeState('refreshed-fixture');let saved=original;
 const read=vi.spyOn(Vault.prototype,'read').mockImplementation(async()=>saved),save=vi.spyOn(Vault.prototype,'save').mockImplementation(async(_id,value)=>{saved=value as typeof saved;});
 const restore=vi.spyOn(sessions,'restoreUnipusSession').mockResolvedValue(refreshed);
 const response=(body:string)=>({url:()=>unipusUrls.courses,status:()=>200,ok:()=>true,headers:()=>({}),text:async()=>body,dispose:async()=>{}});
 const first={get:vi.fn(async()=>response(JSON.stringify({code:3008}))),dispose:vi.fn(async()=>{}),storageState:async()=>original};
 const second={get:vi.fn(async(url:string,_options?:unknown)=>response(url===unipusUrls.courses?shelf:url===unipusUrls.homework?json({data:{homework:{total:0,items:[]}}}):json({data:{totalCount:0,items:[]}}))),dispose:vi.fn(async()=>{}),storageState:async()=>refreshed};
 const client=vi.spyOn(request,'newContext').mockResolvedValueOnce(first as any).mockResolvedValueOnce(second as any);
 try {
  const result=await new Adapters('unused-refresh-test').scan({id:'unipus',accountId:randomUUID(),enabled:true,sources:[],loginStatus:'logged_in',lastScanAt:null,lastSuccessAt:null,nextScanAt:0,failures:0,lastOutcome:'not_scanned',message:''});
  expect(result.outcome).toBe('partial');expect(restore).toHaveBeenCalledTimes(1);expect(client).toHaveBeenCalledTimes(2);
  expect(saved).toEqual(refreshed);expect(first.dispose).toHaveBeenCalledTimes(1);expect(second.dispose).toHaveBeenCalledTimes(1);
  expect(second.get.mock.calls[0][1]).toMatchObject({headers:{Authorization:'refreshed-fixture'}});
 }finally{read.mockRestore();save.mockRestore();restore.mockRestore();client.mockRestore();}
});
