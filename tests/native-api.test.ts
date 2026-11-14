import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../apps/local-service/src/server.js";
let dir: string, server: Awaited<ReturnType<typeof createServer>>;
const token = "a".repeat(64);
const host = { host: "127.0.0.1:17321" };
const headers = {
  ...host,
  authorization: `Bearer ${token}`,
  origin: "http://127.0.0.1:17321",
};
beforeEach(async () => {
  vi.stubEnv("COURSEWATCH_NATIVE_TOKEN", token);
  vi.stubEnv("COURSEWATCH_NATIVE_NOTIFICATIONS", "1");
  dir = mkdtempSync(join(tmpdir(), "cw-native-"));
  server = await createServer({ dir, test: true });
});
afterEach(async () => {
  await server.app.close();
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});
it('课程接口需要配对，选课隔离平台账号，移除可恢复且保留空课程', async () => {
  const p = (await server.app.inject({url:'/api/platforms',headers})).json().items.find((p:any)=>p.id==='yuketang');
  server.engine.apply({platform:'yuketang',accountId:p.accountId,outcome:'partial',discoveryComplete:false,partitions:[],issues:[],courses:[{key:'classroom:one',name:'课程'},{key:'classroom:empty',name:'空课程'}]});
  expect((await server.app.inject({url:'/api/courses',headers:host})).statusCode).toBe(401);
  const courses = (await server.app.inject({url:'/api/courses',headers})).json().items;
  expect(courses).toHaveLength(2);
  expect(courses.every((c:any)=>c.status==='pending')).toBe(true);
  expect((await server.app.inject({method:'POST',url:'/api/platforms/chaoxing/courses/selection',headers,payload:{ids:[courses[0].id]}})).statusCode).toBe(400);
  expect((await server.app.inject({method:'POST',url:'/api/platforms/yuketang/courses/selection',headers,payload:{ids:[courses[0].id]}})).statusCode).toBe(200);
  await server.app.inject({method:'PATCH',url:`/api/courses/${courses[0].id}`,headers,payload:{enabled:false}});
  expect(server.engine.courses().every(c=>c.status==='removed')).toBe(true);
  await server.app.inject({method:'PATCH',url:`/api/courses/${courses[0].id}`,headers,payload:{enabled:true}});
  expect(server.engine.courses().find(c=>c.id===courses[0].id)?.status).toBe('enabled');
});
it("普通配对客户端不能确认原生通知投递", async () => {
  const pair = await server.app.inject({
    method: "POST",
    url: "/api/pair",
    headers: host,
    payload: { code: server.pairingCode },
  });
  const response = await server.app.inject({
    url: "/api/native/pending",
    headers: { ...host, authorization: `Bearer ${pair.json().token}` },
  });
  expect(response.statusCode).toBe(403);
  expect(
    (await server.app.inject({ url: "/api/native/pending", headers }))
      .statusCode,
  ).toBe(200);
});
it("通知关闭时测试通知仍可送达，确认后不重复返回", async () => {
  server.engine.enqueue("normal", "作业", "普通通知", null, "new");
  await server.app.inject({
    method: "POST",
    url: "/api/notifications/test",
    headers,
    payload: {},
  });
  const pending = (
    await server.app.inject({ url: "/api/native/pending", headers })
  ).json().items;
  expect(pending).toHaveLength(1);
  expect(pending[0].body).toBe("测试通知");
  await server.app.inject({
    method: "POST",
    url: "/api/native/delivered",
    headers,
    payload: { id: pending[0].id, error: "系统未授权" },
  });
  expect(
    (await server.app.inject({ url: "/api/native/pending", headers })).json()
      .items,
  ).toHaveLength(0);
  expect(
    server.store.all<{ error: string }>(
      "SELECT error FROM outbox WHERE id=?",
      pending[0].id,
    )[0].error,
  ).toBe("系统未授权");
});
it("应用重启轮换原生令牌，旧令牌不能继续读取", async () => {
  await server.app.close();
  const next = "b".repeat(64);
  vi.stubEnv("COURSEWATCH_NATIVE_TOKEN", next);
  server = await createServer({ dir, test: true });
  expect(
    (await server.app.inject({ url: "/api/health", headers })).statusCode,
  ).toBe(401);
  expect(
    (
      await server.app.inject({
        url: "/api/health",
        headers: { ...headers, authorization: `Bearer ${next}` },
      })
    ).statusCode,
  ).toBe(200);
});
it.each([undefined, "short-token"])("无有效原生令牌启动时撤销旧原生客户端：%s", async (next) => {
  const paired = await server.app.inject({
    method: "POST", url: "/api/pair", headers: host,
    payload: { code: server.pairingCode },
  });
  await server.app.close();
  vi.stubEnv("COURSEWATCH_NATIVE_TOKEN", next);
  server = await createServer({ dir, test: true });
  expect((await server.app.inject({ url: "/api/schedules", headers })).statusCode).toBe(401);
  expect(server.store.get("nativeClient", null)).toBeNull();
  const pairedHeaders = { ...host, authorization: `Bearer ${paired.json().token}` };
  expect((await server.app.inject({ url: "/api/schedules", headers: pairedHeaders })).statusCode).toBe(200);
  expect((await server.app.inject({ url: "/api/native/pending", headers: pairedHeaders })).statusCode).toBe(403);
});
it("点缀色可持久化且拒绝未知值", async () => {
  const settings = (
    await server.app.inject({ url: "/api/settings", headers })
  ).json();
  expect(settings.accent).toBe("orange");
  expect(
    (
      await server.app.inject({
        url: "/api/settings",
        method: "PATCH",
        headers,
        payload: { ...settings, accent: "purple" },
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (await server.app.inject({ url: "/api/settings", headers })).json().accent,
  ).toBe("purple");
  expect(
    (
      await server.app.inject({
        url: "/api/settings",
        method: "PATCH",
        headers,
        payload: { ...settings, accent: "invalid" },
      })
    ).statusCode,
  ).toBe(400);
});
it('主题默认跟随系统，三种模式重启后保留，拒绝未知主题', async () => {
  const settings = (await server.app.inject({ url: '/api/settings', headers })).json();
  expect(settings.theme).toBe('system');
  for (const theme of ['light', 'dark', 'system']) {
    expect((await server.app.inject({ url: '/api/settings', method: 'PATCH', headers, payload: { ...settings, theme } })).statusCode).toBe(200);
    await server.app.close();
    server = await createServer({ dir, test: true });
    expect((await server.app.inject({ url: '/api/settings', headers })).json().theme).toBe(theme);
  }
  expect((await server.app.inject({ url: '/api/settings', method: 'PATCH', headers, payload: { ...settings, theme: 'unknown' } })).statusCode).toBe(400);
  expect((await server.app.inject({ url: '/api/settings', headers })).json().theme).toBe('system');
});
it("旧设置默认关闭侧栏磨砂玻璃，保存后重启仍保留", async () => {
  server.store.set("settings", {
    accent: "purple",
    intervalMinutes: 30,
    nativeNotifications: false,
    reminderHours: [24, 1],
  });
  const previous = (
    await server.app.inject({ url: "/api/settings", headers })
  ).json();
  expect(previous.sidebarGlass).toBe(false);
  const saved = await server.app.inject({
    url: "/api/settings",
    method: "PATCH",
    headers,
    payload: { ...previous, sidebarGlass: true },
  });
  expect(saved.statusCode).toBe(200);
  await server.app.close();
  server = await createServer({ dir, test: true });
  const next = (
    await server.app.inject({ url: "/api/settings", headers })
  ).json();
  expect(next).toMatchObject({
    sidebarGlass: true,
    accent: "purple",
    intervalMinutes: 30,
  });
});
it("日程 CRUD、分钟提醒和菜单栏摘要一致，部分更新不清空其他字段", async () => {
  const request = (
    url: string,
    method: "GET" | "POST" | "PATCH" = "GET",
    payload?: any,
  ) =>
    server.app.inject({
      url,
      method,
      headers,
      ...(payload ? { payload } : {}),
    });
  const future = Date.now() + 4 * 3600000;
  const response = await request("/api/schedules", "POST", {
    title: "课程汇报",
    note: "带电脑",
    dueAt: future,
    important: true,
    reminderHours: [10 / 60, 2],
  });
  expect(response.statusCode).toBe(200);
  const id = response.json().item.id;
  await request(`/api/schedules/${id}`, "PATCH", { done: true });
  expect((await request("/api/schedules")).json().items[0]).toMatchObject({
    note: "带电脑",
    important: true,
    reminderHours: [10 / 60, 2],
    done: true,
  });
  expect((await request("/api/native/summary")).json().total).toBe(0);
  await request(`/api/schedules/${id}`, "PATCH", { done: false });
  expect((await request("/api/native/summary")).json().items[0]).toMatchObject({
    id,
    local: true,
    title: "课程汇报",
  });
  expect((await request("/api/export")).json().schedules).toHaveLength(1);
  expect(
    (
      await request("/api/schedules", "POST", {
        title: "过期",
        dueAt: Date.now() - 1000,
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (await request(`/api/schedules/${id}`, "PATCH", { reminderHours: [0] }))
      .statusCode,
  ).toBe(400);
  await request(`/api/schedules/${id}/delete`, "POST", {});
  expect((await request("/api/native/summary")).json().total).toBe(0);
  expect(
    (await request(`/api/schedules/${id}`, "PATCH", { done: true })).statusCode,
  ).toBe(404);
});
it("默认提醒支持分钟和天，保留日程的独立提醒规则", async () => {
  server.engine.saveSchedule({
    id: "schedule",
    title: "独立",
    note: "",
    dueAt: Date.now() + 86400000,
    important: false,
    reminderHours: [10 / 60],
    done: false,
    version: 1,
    updatedAt: Date.now(),
  });
  const settings = server.engine.settings();
  const result = await server.app.inject({
    url: "/api/settings",
    method: "PATCH",
    headers,
    payload: { ...settings, reminderHours: [5 / 60, 0.5, 48] },
  });
  expect(result.statusCode).toBe(200);
  expect(server.engine.settings().reminderHours).toEqual([5 / 60, 0.5, 48]);
  expect(
    server.store
      .all<{ rule_hours: number }>(
        "SELECT rule_hours FROM reminders WHERE task_id='schedule'",
      )
      .map((r) => r.rule_hours)
      .sort(),
  ).toEqual([0, 10 / 60]);
});
it("六个平台入口可用，支持课程的平台可无列表开启自动发现", async () => {
  const result = (await server.app.inject({ url: "/api/platforms", headers })).json();
  expect(result.items.map((p: any) => p.id)).toEqual(["ynjy", "renwei", "yuketang", "chaoxing", "unipus"]);
  for (const id of ["yuketang", "chaoxing", "unipus"]) {
    expect(result.items.find((p: any) => p.id === id)).toMatchObject({
      added: false, adapted: true, enabled: false, discoversCourses: true, sources: [],
    });
    const updated = await server.app.inject({ method: "PATCH", url: `/api/platforms/${id}`, headers, payload: { added: true, enabled: true } });
    expect(updated.statusCode).toBe(200);
    const saved = (await server.app.inject({ url: "/api/platforms", headers })).json().items.find((p: any) => p.id === id);
    expect(saved).toMatchObject({ added: true, enabled: true, sources: [] });
  }
});
it.each(["yuketang", "chaoxing", "unipus"])("%s 完成登录后开启监控，无需填入列表", async id => {
  const { AdapterManager } = await import("../packages/adapters/src/manager.js");
  const finish = vi.spyOn(AdapterManager.prototype, "finish").mockResolvedValue({ ok: true });
  try {
    const response = await server.app.inject({ method: "POST", url: `/api/platforms/${id}/login/finish`, headers, payload: {} });
    expect(response.statusCode).toBe(200);
    expect((await server.app.inject({ url: "/api/platforms", headers })).json().items.find((p: any) => p.id === id)).toMatchObject({ added: true, enabled: true, loginStatus: "logged_in", sources: [] });
  } finally { finish.mockRestore(); }
});
it("学习通完成登录立即保存待选择课程，重新登录保留选择和移除状态", async () => {
  const { AdapterManager } = await import("../packages/adapters/src/manager.js");
  const finish = vi.spyOn(AdapterManager.prototype, "finish").mockResolvedValue({ ok: true, courses: [
    { key: "course:1:class:2", name: "同名课程" },
    { key: "course:3:class:4", name: "同名课程" },
  ] });
  try {
    const complete = () => server.app.inject({method:"POST",url:"/api/platforms/chaoxing/login/finish",headers,payload:{}});
    const first = await complete();
    expect(first.statusCode).toBe(200);
    expect(first.json().message).toContain("2 门课程");
    const courses = () => server.engine.courses().filter(c => c.platform === "chaoxing");
    expect(courses().map(c => c.status)).toEqual(["pending", "pending"]);
    expect(server.engine.tasks()).toHaveLength(0);
    await server.app.inject({method:"POST",url:"/api/platforms/chaoxing/courses/selection",headers,payload:{ids:[courses()[0].id]}});
    await server.app.inject({method:"PATCH",url:`/api/courses/${courses()[1].id}`,headers,payload:{enabled:false}});
    const before = courses().map(c => [c.id,c.status]);
    expect((await complete()).statusCode).toBe(200);
    expect(courses().map(c => [c.id,c.status])).toEqual(before);
    expect(courses().map(c => c.status).sort()).toEqual(["enabled", "removed"]);
  } finally { finish.mockRestore(); }
});
it("移除平台停止监控，重新添加保留账号和监控列表", async () => {
  const sources = [{course:'课程',type:'homework',url:'https://jsjks.ynjy.cn/classrooms/demo/program_homework'}];
  await server.app.inject({method:'PATCH',url:'/api/platforms/ynjy',headers,payload:{enabled:true,sources}});
  const platforms = async () => (await server.app.inject({url:'/api/platforms',headers})).json().items;
  const before=(await platforms()).find((p:any)=>p.id==='ynjy');
  const removed=await server.app.inject({method:'PATCH',url:'/api/platforms/ynjy',headers,payload:{added:false,enabled:true}});
  expect(removed.statusCode).toBe(200);
  expect((await platforms()).find((p:any)=>p.id==='ynjy')).toMatchObject({added:false,enabled:false,accountId:before.accountId,sources});
  await server.app.inject({method:'PATCH',url:'/api/platforms/ynjy',headers,payload:{added:true}});
  expect((await platforms()).find((p:any)=>p.id==='ynjy')).toMatchObject({added:true,enabled:false,accountId:before.accountId,sources});
});
it("状态摘要包含未读和待投递标记，关闭提醒时仅测试通知可投递", async () => {
  const health = async () => (await server.app.inject({url:'/api/health',headers})).json();
  expect(await health()).toMatchObject({enabledPlatforms:0,unreadCount:0,nativePending:false});
  server.engine.enqueue('new-check','发现新任务','课程作业',null,'new');
  expect(await health()).toMatchObject({unreadCount:1,nativePending:false});
  await server.app.inject({method:'POST',url:'/api/notifications/test',headers,payload:{}});
  expect(await health()).toMatchObject({unreadCount:2,nativePending:true});
  const pending=(await server.app.inject({url:'/api/native/pending',headers})).json().items;
  await server.app.inject({method:'POST',url:'/api/native/delivered',headers,payload:{id:pending[0].id}});
  expect(await health()).toMatchObject({nativePending:false});
  await server.app.inject({method:'POST',url:'/api/notifications/read',headers,payload:{}});
  expect(await health()).toMatchObject({unreadCount:0});
});

it('升级时为旧人卫作业配置补充考试列表，之后尊重用户移除', async()=>{
 const existing=server.store.get<any>('platform:renwei',{});
 const homework={url:'https://tk.ipmph.com/exam/a/exam/examTask/myExamTaskList',course:'我的课程',type:'homework'};
 server.store.set('platform:renwei',{...existing,enabled:true,sources:[homework]});
 server.store.run('DELETE FROM settings WHERE key=?','renweiListsV2');
 await server.app.close();server=await createServer({dir,test:true});
 const get=async()=>(await server.app.inject({url:'/api/platforms',headers})).json().items.find((p:any)=>p.id==='renwei');
 expect((await get()).sources).toEqual([homework,{url:'https://tk.ipmph.com/exam/a/exam/exam/myExamList',course:'我的考试',type:'exam'}]);
 await server.app.inject({url:'/api/platforms/renwei',method:'PATCH',headers,payload:{sources:[homework]}});
 await server.app.close();server=await createServer({dir,test:true});
 expect((await get()).sources).toEqual([homework]);
});
it('手动检查失败返回实际失败原因，不提示检查成功',async()=>{
 const response=await server.app.inject({url:'/api/monitor/check',method:'POST',headers,payload:{platform:'ynjy'}});
 expect(response.statusCode).toBe(200);expect(response.json().results[0].outcome).toBe('failed');expect(response.json().message).toContain('请先添加监控列表页');
 expect(response.json().message).not.toContain('检查完成');
});

it('模拟新作业与截止通知标注模拟且不创建课程任务或提醒',async()=>{
 for(const scenario of ['new','deadline']){
  const result=await server.app.inject({url:'/api/notifications/test',method:'POST',headers,payload:{scenario}});
  expect(result.statusCode).toBe(200);const row=server.store.all<any>('SELECT * FROM outbox WHERE id=?',result.json().id)[0];
  expect(row.title).toBe(`【模拟】${scenario==='new'?'新作业':'截止通知'} · 通知测试课程`);
  expect(row.body).toContain('名称：模拟作业');expect(row.body).toMatch(/开始：20\d{2}-\d{2}-\d{2}/);expect(row.body).toMatch(/截止：20\d{2}-\d{2}-\d{2}/);expect(row.kind).toBe('test');
 }
 expect(server.engine.tasks()).toHaveLength(0);expect(server.engine.schedules()).toHaveLength(0);
});
it('菜单栏摘要只包含已开启平台的状态与媒体进度，排除答案和日志；控制沿用认证',async()=>{
 const {STUDY_NOTICE_VERSION}=await import('../packages/contracts/src/study.js');
 const {StudyManager}=await import('../packages/study/src/manager.js');const {initialStudyStatus}=await import('../packages/contracts/src/study.js');
 const status=vi.spyOn(StudyManager.prototype,'status').mockReturnValue({...initialStudyStatus(),phase:'running',courseName:'模拟课程',navigation:{previous:false,next:true},answers:[{stem:'private-answer'} as any],logs:[{at:1,message:'private-log'}],progress:{course:'模拟课程',chapter:'第二节',chapterComplete:null,media:[{kind:'video',current:42,duration:120,paused:false,ended:false}],documents:[],chapters:[{name:'目录详情',complete:null}],observedAt:100}});
 const nav=vi.spyOn(StudyManager.prototype,'navigate').mockResolvedValue({...initialStudyStatus(),phase:'paused'});
 try{
  expect((await server.app.inject({url:'/api/native/summary',headers})).json().studies).toEqual([]);
  await server.app.inject({method:'POST',url:'/api/study/accept',headers,payload:{accepted:true,noticeVersion:STUDY_NOTICE_VERSION}});
  const response=await server.app.inject({url:'/api/native/summary',headers});expect(response.json().studies).toHaveLength(1);expect(response.json().studies[0]).toMatchObject({platform:'chaoxing',courseName:'模拟课程',progress:{chapters:[],media:[{current:42}]}});expect(response.body).not.toMatch(/private-answer|private-log|目录详情/);
  expect((await server.app.inject({method:'POST',url:'/api/study/next',headers})).statusCode).toBe(200);expect(nav).toHaveBeenCalledWith('next');
  expect((await server.app.inject({method:'POST',url:'/api/study/previous',headers:{host:headers.host}})).statusCode).toBe(401);
  expect((await server.app.inject({method:'POST',url:'/api/study/next',headers:{...headers,origin:'https://example.com'}})).statusCode).toBe(403);
 }finally{status.mockRestore();nav.mockRestore();}
});

it('浏览器选择保存后重启仍保留，旧设置默认自动选择，非法值拒绝保存', async () => {
 expect(server.engine.settings().browser).toBe('auto');
 const settings={...server.engine.settings(),browser:'edge'};
 expect((await server.app.inject({method:'PATCH',url:'/api/settings',headers,payload:settings})).statusCode).toBe(200);
 expect((await server.app.inject({url:'/api/settings',headers})).json().browser).toBe('edge');
 expect((await server.app.inject({method:'PATCH',url:'/api/settings',headers,payload:{...settings,browser:'arbitrary-path'}})).statusCode).toBe(400);
 await server.app.close(); server=await createServer({dir,test:true});
 expect(server.engine.settings().browser).toBe('edge');
});
