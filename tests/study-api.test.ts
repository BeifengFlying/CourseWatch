import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { STUDY_NOTICE_VERSION, UNIPUS_STUDY_NOTICE_VERSION, STUDY_ACCEPTANCE_TEXT } from "../packages/contracts/src/study.js";
const secrets = vi.hoisted(() => new Map<string, unknown>());
vi.mock("../packages/adapters/src/vault.js", () => ({ Vault: class { async save(id: string, value: unknown) { secrets.set(id, value); } async read(id: string) { return secrets.get(id); } } }));
import { createServer } from "../apps/local-service/src/server.js";
let server: Awaited<ReturnType<typeof createServer>>, dir: string, headers: Record<string, string>;
beforeEach(async () => {
  secrets.clear(); dir = mkdtempSync(join(tmpdir(), "cw-study-test-")); server = await createServer({ dir, test: true });
  const pair = await server.app.inject({ method: "POST", url: "/api/pair", headers: { host: "127.0.0.1:17321" }, payload: { code: server.pairingCode } });
  headers = { host: "127.0.0.1:17321", authorization: `Bearer ${pair.json().token}` };
});
afterEach(async () => { await server.app.close(); rmSync(dir, { recursive: true, force: true }); });
it('播放模式读取已配置的 API；运行中可保存新设置，当前任务仍使用启动配置', async () => {
 const { StudyManager } = await import('../packages/study/src/manager.js');
 const { writeFileSync, mkdirSync, existsSync } = await import('node:fs');
 await server.app.inject({ method:'POST',url:'/api/study/accept',headers,payload:{accepted:true,noticeVersion:STUDY_NOTICE_VERSION} });
 writeFileSync(join(dir,'chaoxing.encrypted'),'fixture');
 const current=(await server.app.inject({url:'/api/study/settings',headers})).json();
 const {hasKey,active,...config}=current;
 expect(config.localSkills).toBe(false);
 expect((await server.app.inject({method:'PATCH',url:'/api/study/settings',headers,payload:{...config,model:'fixture-model',apiKey:'fixture-key'}})).statusCode).toBe(200);
 const start=vi.spyOn(StudyManager.prototype,'start').mockReturnValue({phase:'starting'} as any);
 const activeGetter=vi.spyOn(StudyManager.prototype,'active','get').mockReturnValue(true);
 try {
  expect((await server.app.inject({method:'POST',url:'/api/study/start',headers,payload:{operation:'play'}})).statusCode).toBe(200);
  expect(start).toHaveBeenCalledWith(dir,expect.objectContaining({answerExercises:true,playMedia:true,localSkills:false}),'fixture-key',expect.anything());
  const unconfirmed=await server.app.inject({method:'PATCH',url:'/api/study/settings',headers,payload:{...config,model:'next-model',localSkills:true}});expect(unconfirmed.statusCode).toBe(409);
  const saved=await server.app.inject({method:'PATCH',url:'/api/study/settings',headers,payload:{...config,model:'next-model',localSkills:true,localSkillsAccepted:true}});
  expect(saved.statusCode).toBe(200);expect(saved.json()).toMatchObject({model:'next-model',localSkills:true,active:true});
  expect((await server.app.inject({method:'POST',url:'/api/study/skills/delete',headers})).statusCode).toBe(409);
  activeGetter.mockReturnValue(false);mkdirSync(join(dir,'study-skills'));writeFileSync(join(dir,'study-skills','chaoxing.json'),'{}');
  expect((await server.app.inject({method:'POST',url:'/api/study/skills/delete',headers})).statusCode).toBe(200);
  expect(existsSync(join(dir,'study-skills','chaoxing.json'))).toBe(false);
 }finally{start.mockRestore();activeGetter.mockRestore();}
});
it("默认关闭，未确认免责声明不能启用或启动", async () => {
  const current = (await server.app.inject({ url: "/api/study/settings", headers })).json();
  expect(current.enabled).toBe(false); expect(current.hasKey).toBe(false);
  expect((await server.app.inject({ method: "PATCH", url: "/api/study/settings", headers, payload: { enabled: true } })).statusCode).toBe(409);
  expect((await server.app.inject({ method: "POST", url: "/api/study/start", headers })).statusCode).toBe(409);
  expect((await server.app.inject({ method: "POST", url: "/api/study/accept", headers, payload: { accepted: true, noticeVersion: "old" } })).statusCode).toBe(400);
});
it.each([
  ['chaoxing', '/api/study', STUDY_NOTICE_VERSION],
  ['unipus', '/api/study/unipus', UNIPUS_STUDY_NOTICE_VERSION],
] as const)('%s 仅在有效确认后记录本机时间与文字，关闭后保留且不加入任务导出', async (platform, path, version) => {
  const recordKey = `studyAcceptance:${platform}:${version}`;
  const before = Date.now();
  for (const payload of [{ accepted: false, noticeVersion: version }, { accepted: true, noticeVersion: 'old' }]) {
    expect((await server.app.inject({ method: 'POST', url: `${path}/accept`, headers, payload })).statusCode).toBe(400);
    expect(server.store.get(recordKey, null)).toBeNull();
    expect((await server.app.inject({ url: `${path}/settings`, headers })).json().enabled).toBe(false);
  }
  const response = await server.app.inject({ method: 'POST', url: `${path}/accept`, headers, payload: { accepted: true, noticeVersion: version } });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({ enabled: true, noticeVersion: version, model: '' });
  const record = server.store.get<any>(recordKey, null);
  expect(record).toEqual({ platform, noticeVersion: version, acceptedAt: expect.any(Number), acknowledgement: STUDY_ACCEPTANCE_TEXT });
  expect(record.acceptedAt).toBeGreaterThanOrEqual(before);
  expect(record.acceptedAt).toBeLessThanOrEqual(Date.now());
  const other = platform === 'chaoxing' ? 'unipus' : 'chaoxing';
  const otherVersion = platform === 'chaoxing' ? UNIPUS_STUDY_NOTICE_VERSION : STUDY_NOTICE_VERSION;
  expect(server.store.get(`studyAcceptance:${other}:${otherVersion}`, null)).toBeNull();
  await server.app.inject({ method: 'POST', url: `${path}/disable`, headers });
  expect(server.store.get(recordKey, null)).toEqual(record);
  const exported = await server.app.inject({ url: '/api/export', headers });
  expect(exported.statusCode).toBe(200);
  expect(exported.body).not.toContain('acknowledgement');
  expect(exported.body).not.toContain(STUDY_ACCEPTANCE_TEXT);
});
it('确认保存失败时回滚确认记录与开启状态', async () => {
  const set = server.store.set.bind(server.store);
  const write = vi.spyOn(server.store, 'set').mockImplementation((key, value) => {
    if (key === 'studyConfig') throw new Error('fixture write failure');
    set(key, value);
  });
  try {
    expect((await server.app.inject({ method: 'POST', url: '/api/study/accept', headers, payload: { accepted: true, noticeVersion: STUDY_NOTICE_VERSION } })).statusCode).toBe(500);
    expect(server.store.get(`studyAcceptance:chaoxing:${STUDY_NOTICE_VERSION}`, null)).toBeNull();
    expect((await server.app.inject({ url: '/api/study/settings', headers })).json().enabled).toBe(false);
  } finally { write.mockRestore(); }
});
it("确认、凭据保存和地址绑定；GET 不回显 Key，关闭保持可停止", async () => {
  const enabled = await server.app.inject({ method: "POST", url: "/api/study/accept", headers, payload: { accepted: true, noticeVersion: STUDY_NOTICE_VERSION } });
  expect(enabled.json().enabled).toBe(true);
  const save = await server.app.inject({ method: "PATCH", url: "/api/study/settings", headers, payload: { ...enabled.json<any>(), hasKey: undefined, active: undefined, apiKey: "secret-fixture", model: "fixture" } });
  expect(save.statusCode).toBe(200); expect(save.body).not.toContain("secret-fixture"); expect(secrets.get("study-model")).toEqual({ baseURL: "https://api.deepseek.com", key: "secret-fixture" });
  const { hasKey, active, ...config } = save.json();
  expect((await server.app.inject({ method: "PATCH", url: "/api/study/settings", headers, payload: { ...config, baseURL: "https://other.example/v1" } })).statusCode).toBe(400);
  const disabled = await server.app.inject({ method: "POST", url: "/api/study/disable", headers });
  expect(disabled.json().enabled).toBe(false);
  expect(server.store.get<any>("studyConfig", {}).apiKey).toBeUndefined();
  expect((await server.app.inject({ url: "/api/export", headers })).body).not.toContain("secret-fixture");
});
it("自动学习 API 沿用配对及来源限制", async () => {
  expect((await server.app.inject({ url: "/api/study/settings", headers: { host: "127.0.0.1:17321" } })).statusCode).toBe(401);
  expect((await server.app.inject({ method: "POST", url: "/api/study/accept", headers: { ...headers, origin: "https://i.chaoxing.com" }, payload: { accepted: true, noticeVersion: STUDY_NOTICE_VERSION } })).statusCode).toBe(403);
});
it("重新确认新版说明前保持关闭，保留原模型配置", async () => {
  server.store.set("studyConfig", { enabled: true, noticeVersion: "2026-11-13.1", model: "saved-model" });
  const current = (await server.app.inject({ url: "/api/study/settings", headers })).json();
  expect(current.enabled).toBe(false); expect(current.noticeVersion).toBeNull(); expect(current.model).toBe("saved-model");
  expect((await server.app.inject({ method: "POST", url: "/api/study/start", headers })).statusCode).toBe(409);
  expect((await server.app.inject({ method: "POST", url: "/api/study/accept", headers, payload: { accepted: true, noticeVersion: STUDY_NOTICE_VERSION } })).json().enabled).toBe(true);
});
it("未运行时查询如实返回无进度，查询接口仍需配对", async () => {
  const response = await server.app.inject({ method: "POST", url: "/api/study/progress", headers });
  expect(response.statusCode).toBe(200); expect(response.json()).toMatchObject({ phase: "idle", progress: null });
  expect((await server.app.inject({ method: "POST", url: "/api/study/progress", headers: { host: headers.host } })).statusCode).toBe(401);
});
it("U校园独立确认、设置、Key 与状态，不继承学习通授权", async () => {
  const { UNIPUS_STUDY_NOTICE_VERSION } = await import('../packages/contracts/src/study.js');
  await server.app.inject({ method: 'POST', url: '/api/study/accept', headers, payload: { accepted: true, noticeVersion: STUDY_NOTICE_VERSION } });
  expect((await server.app.inject({ url: '/api/study/unipus/settings', headers })).json().enabled).toBe(false);
  expect((await server.app.inject({ method: 'POST', url: '/api/study/unipus/accept', headers, payload: { accepted: true, noticeVersion: STUDY_NOTICE_VERSION } })).statusCode).toBe(400);
  const enabled = await server.app.inject({ method: 'POST', url: '/api/study/unipus/accept', headers, payload: { accepted: true, noticeVersion: UNIPUS_STUDY_NOTICE_VERSION } });
  const { hasKey, active, ...config } = enabled.json();
  const saved = await server.app.inject({ method: 'PATCH', url: '/api/study/unipus/settings', headers, payload: { ...config, model: 'u-model', apiKey: 'u-fixture-secret', targetMinutes: 30 } });
  expect(saved.statusCode).toBe(200); expect(saved.body).not.toContain('u-fixture-secret');
  expect(secrets.get('study-unipus-model')).toEqual({ baseURL: 'https://api.deepseek.com', key: 'u-fixture-secret' });
  expect(secrets.get('study-model')).toBeUndefined();
  expect((await server.app.inject({ url: '/api/study/settings', headers })).json()).toMatchObject({ enabled: true, hasKey: false, targetMinutes: 0 });
  await server.app.inject({ method: 'POST', url: '/api/study/unipus/disable', headers });
  expect((await server.app.inject({ url: '/api/study/settings', headers })).json().enabled).toBe(true);
  expect((await server.app.inject({ method: 'POST', url: '/api/study/unipus/progress', headers })).json()).toMatchObject({ phase: 'idle', progress: null });
});
it("U校园播放模式不要求模型凭据，练习模式仍检查模型和独立登录", async () => {
  const { UNIPUS_STUDY_NOTICE_VERSION, StudyConfig } = await import('../packages/contracts/src/study.js');
  const { writeFileSync } = await import('node:fs');
  const { StudyManager } = await import('../packages/study/src/manager.js');
  server.store.set('studyConfig:unipus', StudyConfig.parse({ enabled: true, noticeVersion: UNIPUS_STUDY_NOTICE_VERSION, answerExercises: false }));
  expect((await server.app.inject({ method: 'POST', url: '/api/study/unipus/start', headers })).statusCode).toBe(409);
  writeFileSync(join(dir, 'unipus.encrypted'), 'fixture-only');
  const start = vi.spyOn(StudyManager.prototype, 'start').mockReturnValue({ phase: 'starting' } as any);
  try {
    expect((await server.app.inject({ method: 'POST', url: '/api/study/unipus/start', headers })).statusCode).toBe(200);
    expect(start).toHaveBeenCalledWith(dir, expect.objectContaining({ answerExercises: false }), '', expect.objectContaining({ operation: 'play' }));
    server.store.set('studyConfig:unipus', StudyConfig.parse({ enabled: true, noticeVersion: UNIPUS_STUDY_NOTICE_VERSION }));
    expect((await server.app.inject({ method: 'POST', url: '/api/study/unipus/start', headers, payload: { operation: 'answers' } })).statusCode).toBe(400);
  } finally { start.mockRestore(); }
});
it('学习通播放和页面保留不要求模型；后台启动校验当前账号的已选课程', async()=>{
 const { writeFileSync }=await import('node:fs');const { StudyManager }=await import('../packages/study/src/manager.js');
 await server.app.inject({method:'POST',url:'/api/study/accept',headers,payload:{accepted:true,noticeVersion:STUDY_NOTICE_VERSION}});
 writeFileSync(join(dir,'chaoxing.encrypted'),'fixture');
 const platform=(await server.app.inject({url:'/api/platforms',headers})).json().items.find((p:any)=>p.id==='chaoxing');
 server.engine.rememberCourse('chaoxing',platform.accountId,'course:1:class:2','模拟课程');
 const course=server.engine.courses().find(c=>c.platform==='chaoxing')!;server.engine.selectCourses('chaoxing',platform.accountId,[course.id]);
 const start=vi.spyOn(StudyManager.prototype,'start').mockReturnValue({phase:'starting'} as any);
 try {
  expect((await server.app.inject({method:'POST',url:'/api/study/start',headers,payload:{operation:'play',courseId:course.id,background:true}})).statusCode).toBe(200);
  expect(start).toHaveBeenLastCalledWith(dir,expect.objectContaining({answerExercises:false,playMedia:true}),'',expect.objectContaining({background:true,course:{key:'course:1:class:2',name:'模拟课程'}}));
  expect((await server.app.inject({method:'POST',url:'/api/study/start',headers,payload:{operation:'answers'}})).statusCode).toBe(400);
  expect((await server.app.inject({method:'POST',url:'/api/study/start',headers,payload:{operation:'keep-open',closeAfterMinutes:20,courseId:course.id,background:true}})).statusCode).toBe(200);
  expect(start).toHaveBeenLastCalledWith(dir,expect.objectContaining({answerExercises:false,playMedia:false}),'',expect.objectContaining({operation:'keep-open',closeAfterMinutes:20}));
  expect((await server.app.inject({method:'POST',url:'/api/study/start',headers,payload:{background:true}})).statusCode).toBe(400);
  server.engine.selectCourses('chaoxing',platform.accountId,[]);
  expect((await server.app.inject({method:'POST',url:'/api/study/start',headers,payload:{courseId:course.id,background:true}})).statusCode).toBe(400);
 }finally{start.mockRestore();}
});
it('平台设置一次保存课程选择与监控状态，无效课程不会部分保存',async()=>{
 const platform=(await server.app.inject({url:'/api/platforms',headers})).json().items.find((p:any)=>p.id==='chaoxing');
 server.engine.rememberCourse('chaoxing',platform.accountId,'course:1:class:2','模拟课程');const course=server.engine.courses().find(c=>c.platform==='chaoxing')!;
 const invalid=await server.app.inject({method:'PATCH',url:'/api/platforms/chaoxing',headers,payload:{enabled:!platform.enabled,courseIds:['invalid']}});
 expect(invalid.statusCode).toBe(400);expect(server.engine.courses().find(c=>c.id===course.id)?.status).toBe('pending');
 expect((await server.app.inject({url:'/api/platforms',headers})).json().items.find((p:any)=>p.id==='chaoxing').enabled).toBe(platform.enabled);
 const result=await server.app.inject({method:'PATCH',url:'/api/platforms/chaoxing',headers,payload:{enabled:true,courseIds:[course.id]}});expect(result.statusCode).toBe(200);expect(server.engine.courses().find(c=>c.id===course.id)?.status).toBe('enabled');expect(server.store.get<any>('platform:chaoxing',{}).courseIds).toBeUndefined();
});
it('官网进度缓存按账号和已选课程隔离，查询失败保留上次读数',async()=>{
 const { CourseCatalogManager }=await import('../packages/study/src/catalog-manager.js');
 const platform=(await server.app.inject({url:'/api/platforms',headers})).json().items.find((p:any)=>p.id==='chaoxing');
 server.engine.rememberCourse('chaoxing',platform.accountId,'course:1:class:2','模拟课程');const course=server.engine.courses().find(c=>c.platform==='chaoxing')!;server.engine.selectCourses('chaoxing',platform.accountId,[course.id]);
 const sample={courseId:course.id,name:course.name,completed:3,total:70,percent:null,chapters:[],observedAt:100};
 const read=vi.spyOn(CourseCatalogManager.prototype,'read').mockResolvedValue({items:[sample],issues:[]});
 try {
  expect((await server.app.inject({method:'POST',url:'/api/study/catalog',headers,payload:{courseId:course.id}})).json().items).toEqual([sample]);
  read.mockRejectedValue(new Error('读取失败'));
  expect((await server.app.inject({method:'POST',url:'/api/study/catalog',headers,payload:{courseId:course.id}})).statusCode).toBe(409);
  expect((await server.app.inject({url:'/api/study/catalog',headers})).json().items).toEqual([sample]);
  server.store.set('platform:chaoxing',{...platform,accountId:'other-account'});
  expect((await server.app.inject({url:'/api/study/catalog',headers})).json().items).toEqual([]);
 }finally{read.mockRestore();}
});

it('单科查询只交给读取进程一门课，只返回该科结果且不改其他课程缓存',async()=>{
 const {CourseCatalogManager}=await import('../packages/study/src/catalog-manager.js');
 const platform=(await server.app.inject({url:'/api/platforms',headers})).json().items.find((p:any)=>p.id==='chaoxing');
 for(let i=1;i<=2;i++)server.engine.rememberCourse('chaoxing',platform.accountId,`course:${i}:class:${i}`,`模拟课程${i}`);
 const courses=server.engine.courses().filter(c=>c.platform==='chaoxing');server.engine.selectCourses('chaoxing',platform.accountId,courses.map(c=>c.id));
 const samples=courses.map(c=>({courseId:c.id,name:c.name,completed:1,total:10,percent:null,chapters:[],observedAt:100}));
 server.store.set('courseProgress:chaoxing',samples);
 const updated={...samples[0],completed:2,observedAt:200};
 const read=vi.spyOn(CourseCatalogManager.prototype,'read').mockResolvedValue({items:[updated,{...samples[1],completed:9}],issues:[]});
 try{
  const response=await server.app.inject({method:'POST',url:'/api/study/catalog',headers,payload:{courseId:courses[0].id}});
  expect(response.statusCode).toBe(200);expect(response.json().items).toEqual([updated]);
  expect(read.mock.calls[0][2].map(c=>c.id)).toEqual([courses[0].id]);
  const cached=(await server.app.inject({url:'/api/study/catalog',headers})).json().items;
  expect(cached.find((c:any)=>c.courseId===courses[1].id)).toEqual(samples[1]);
 }finally{read.mockRestore();}
});
it('模型列表使用当前地址绑定的Key，临时输入不保存，拒绝跨地址复用', async()=>{
 secrets.set('study-model',{baseURL:'https://model.fixture/v1',key:'saved-secret'});
 const request=vi.spyOn(globalThis,'fetch').mockImplementation(async()=>new Response('{"data":[{"id":"actual-model"}]}'));
 try {
  const listed=await server.app.inject({method:'POST',url:'/api/study/models',headers,payload:{baseURL:'https://model.fixture/v1'}});
  expect(listed.statusCode).toBe(200);expect(listed.json()).toEqual({models:['actual-model']});expect(listed.body).not.toContain('saved-secret');
  expect(request.mock.calls[0][1]?.headers).toMatchObject({Authorization:'Bearer saved-secret'});
  const rejected=await server.app.inject({method:'POST',url:'/api/study/models',headers,payload:{baseURL:'https://another.fixture/v1'}});
  expect(rejected.statusCode).toBe(400);expect(request).toHaveBeenCalledTimes(1);
  const temporary=await server.app.inject({method:'POST',url:'/api/study/unipus/models',headers,payload:{baseURL:'https://another.fixture/v1/chat/completions',apiKey:'temporary-secret'}});
  expect(temporary.statusCode).toBe(200);expect(request.mock.calls[1][0]).toBe('https://another.fixture/v1/models');
  expect(secrets.has('study-unipus-model')).toBe(false);
  expect((await server.app.inject({url:'/api/study/unipus/settings',headers})).json().hasKey).toBe(false);
 }finally{request.mockRestore();}
});
it('U校园后台保活无需模型，不答题；保留后台启动选项',async()=>{
 const { UNIPUS_STUDY_NOTICE_VERSION }=await import('../packages/contracts/src/study.js');
 const { StudyManager }=await import('../packages/study/src/manager.js');
 const { writeFileSync }=await import('node:fs');
 await server.app.inject({method:'POST',url:'/api/study/unipus/accept',headers,payload:{accepted:true,noticeVersion:UNIPUS_STUDY_NOTICE_VERSION}});
 writeFileSync(join(dir,'unipus.encrypted'),'fixture');
 const platform=server.store.get<any>('platform:unipus',{});
 server.engine.rememberCourse('unipus',platform.accountId,'resource:keepalive','保活测试教程');
 const course=server.engine.courses().find(c=>c.platform==='unipus')!;
 server.engine.selectCourses('unipus',platform.accountId,[course.id]);
 const start=vi.spyOn(StudyManager.prototype,'start').mockReturnValue({phase:'starting'} as any);
 try {
  const result=await server.app.inject({method:'POST',url:'/api/study/unipus/start',headers,payload:{operation:'keep-open',closeAfterMinutes:20,background:true,courseId:course.id}});
  expect(result.statusCode).toBe(200);
  expect(start).toHaveBeenCalledWith(dir,expect.objectContaining({answerExercises:false,playMedia:false}),'',expect.objectContaining({background:true,operation:'keep-open',course:{key:'resource:keepalive',name:'保活测试教程'}}));
 }finally{start.mockRestore();}
});

it('旧思考档位不再出现在设置中，两平台均保留其他模型设置',async()=>{
 for(const platform of ['chaoxing','unipus']){
  const prefix=platform==='chaoxing'?'/api/study':'/api/study/unipus';
  server.store.set(platform==='chaoxing'?'studyConfig':'studyConfig:unipus',{enabled:true,noticeVersion:platform==='chaoxing'?STUDY_NOTICE_VERSION:UNIPUS_STUDY_NOTICE_VERSION,model:'fixture-model',autoSubmitPractice:true,reasoningEffort:'xhigh'});
  const saved=(await server.app.inject({url:prefix+'/settings',headers})).json();
  expect(saved).toMatchObject({model:'fixture-model',autoSubmitPractice:true});expect(saved).not.toHaveProperty('reasoningEffort');
 }
});


it('运行中刷新目录分别保留视频和检测状态；未知不清空，官网未完成可覆盖旧完成',async()=>{
 const {CourseCatalogManager}=await import('../packages/study/src/catalog-manager.js');
 const {StudyManager}=await import('../packages/study/src/manager.js');
 const {initialStudyStatus}=await import('../packages/contracts/src/study.js');
 const platform=server.store.get<any>('platform:chaoxing',{});
 server.engine.rememberCourse('chaoxing',platform.accountId,'course:1:class:2','状态测试课程');
 const course=server.engine.courses().find(c=>c.platform==='chaoxing')!;
 server.engine.selectCourses('chaoxing',platform.accountId,[course.id]);
 const task=(kind:'video'|'quiz',complete:boolean|null)=>({id:kind,tabId:kind==='video'?'dct1':'dct2',kind,name:kind,complete,current:false});
 const chapters=[{id:'one',name:'第一节',complete:false,locked:false,tasks:[task('video',true),task('quiz',false)]},{id:'two',name:'第二节',complete:null,locked:false}];
 const status=vi.spyOn(StudyManager.prototype,'status').mockReturnValue({...initialStudyStatus(),phase:'running',progress:{course:course.name,courseKey:course.key,chapter:'第二节',chapterId:'two',chapterComplete:null,media:[],documents:[],chapters:chapters.map(c=>({...c,tasks:undefined})),observedAt:200}});
 const active=vi.spyOn(StudyManager.prototype,'active','get').mockReturnValue(true);
 const read=vi.spyOn(CourseCatalogManager.prototype,'read').mockResolvedValue({items:[{courseId:course.id,name:course.name,chapters,completed:1,total:4,percent:null,observedAt:200}],issues:[]});
 try{
  expect((await server.app.inject({method:'POST',url:'/api/study/catalog',headers,payload:{courseId:course.id}})).statusCode).toBe(200);
  const position=()=>server.app.inject({url:'/api/study/position?courseId='+course.id,headers});
  expect((await position()).json().chapters[0].tasks.map((t:any)=>t.complete)).toEqual([true,false]);
  expect((await server.app.inject({url:'/api/study/status',headers})).json().progress.chapters[0].tasks.map((t:any)=>t.complete)).toEqual([true,false]);
  chapters[0].tasks=[task('video',null),task('quiz',true)];
  await server.app.inject({method:'POST',url:'/api/study/catalog',headers,payload:{courseId:course.id}});
  expect((await position()).json().chapters[0].tasks.map((t:any)=>t.complete)).toEqual([true,true]);
  chapters[0].tasks=[task('video',false),task('quiz',null)];
  await server.app.inject({method:'POST',url:'/api/study/catalog',headers,payload:{courseId:course.id}});
  expect((await position()).json().chapters[0].tasks.map((t:any)=>t.complete)).toEqual([false,true]);
  server.store.set('courseProgress:chaoxing',[{courseId:course.id,name:course.name,chapters:[{id:'uncached',name:'第三节',complete:null,locked:false,tasks:[task('video',true)]}],observedAt:200}]);
  expect((await position()).json().chapters[0].tasks[0].complete).toBe(true);
 }finally{read.mockRestore();status.mockRestore();active.mockRestore();}
});
