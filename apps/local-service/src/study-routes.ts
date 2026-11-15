import type { FastifyInstance } from "fastify";
import { unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { Store } from "../../../packages/storage/src/index.js";
import { Vault } from "../../../packages/adapters/src/vault.js";
import { CourseCatalogManager } from "../../../packages/study/src/catalog-manager.js";
import { Settings, type CourseRecord } from "../../../packages/contracts/src/index.js";
import { StudyManager } from "../../../packages/study/src/manager.js";
import { StudyConfig, StudyConfigInput, StudyStart, STUDY_ACCEPTANCE_TEXT, type CourseLearningProgress, type StudyPosition, type StudyProgress, studyNoticeVersion, studyPlatformNames, type StudyPlatform } from "../../../packages/contracts/src/study.js";
import type { DiagnosticLog } from '../../../packages/core/src/diagnostics.js';
import { inspectModelService } from '../../../packages/study/src/model-service.js';
import { ModelEndpoint } from '../../../packages/contracts/src/study.js';
export function registerStudyRoutes(app: FastifyInstance, store: Store, dir: string, loginActive: () => boolean, courses: () => CourseRecord[] = () => [], diagnostics?: DiagnosticLog, notify?: (platform: StudyPlatform, status: import('../../../packages/contracts/src/study.js').StudyStatus) => void) {
  const mergeTasks = (fresh: NonNullable<StudyProgress['tasks']>, previous: NonNullable<StudyProgress['tasks']>) => fresh.map(task=>({...task,complete:task.complete ?? previous.find(old=>(old.tabId || old.id)===(task.tabId || task.id) && old.kind===task.kind)?.complete ?? null}));
  const remember = (platform: StudyPlatform) => (courseKey: string, progress: StudyProgress) => {
    const course = courses().find(c => c.platform === platform && c.key === courseKey && c.status === 'enabled');
    if (!course || !progress.chapterId) return;
    const key = `studyPosition:${course.id}`, old = store.get<StudyPosition | null>(key, null);
    if (progress.tasks?.length) {
      const taskKey = `studyTasks:${course.id}:${progress.chapterId}`;
      const previous = store.get<{tasks?:StudyProgress['tasks']}>(taskKey,{});
      const tasks=mergeTasks(progress.tasks,previous.tasks || []);
      if (JSON.stringify(previous.tasks) !== JSON.stringify(tasks)) store.set(taskKey, {tasks,observedAt:progress.observedAt});
    }
    if (old?.chapterId === progress.chapterId && old.tabId === progress.tabId) return;
    store.set(key, {chapterId:progress.chapterId,chapter:progress.chapter,tabId:progress.tabId,observedAt:progress.observedAt});
  };
  const browser = () => Settings.shape.browser.parse(store.get<Record<string, unknown>>('settings', {}).browser);
  const managers = { chaoxing: new StudyManager("chaoxing", diagnostics, notify, remember('chaoxing'), browser), unipus: new StudyManager("unipus", diagnostics, notify, remember('unipus'), browser) };
  const vault = new Vault(dir);
  const catalog = new CourseCatalogManager(diagnostics, browser);
  app.addHook("onClose", () => catalog.stop());
  for (const platform of ["chaoxing", "unipus"] as const) {
  const manager = managers[platform];
  const version = studyNoticeVersion(platform), name = studyPlatformNames[platform];
  const path = platform === "chaoxing" ? "/api/study" : "/api/study/unipus";
  const configKey = platform === "chaoxing" ? "studyConfig" : "studyConfig:unipus";
  const keyFlag = platform === "chaoxing" ? "studyHasKey" : "studyHasKey:unipus";
  const secretId = platform === "chaoxing" ? "study-model" : "study-unipus-model";
  const config = () => {
    const saved = store.get<Record<string, unknown>>(configKey, {});
    return StudyConfig.parse({ ...saved, ...(saved.noticeVersion !== version ? { enabled: false, noticeVersion: null } : {}) });
  };
  const view = () => ({ ...config(), hasKey: store.get(keyFlag, false), active: manager.active });
  app.get(`${path}/settings`, () => view());
  for (const action of ['models', 'model/test'] as const) app.post(`${path}/${action}`, async (req, reply) => {
    const input = z.object({ baseURL: ModelEndpoint, apiKey: StudyConfigInput.shape.apiKey, model: z.string().trim().min(1).max(200).optional() }).strict().parse(req.body);
    const secret = input.apiKey ? null : await vault.read(secretId);
    const key = input.apiKey || (secret?.baseURL === input.baseURL ? secret.key : undefined);
    if (!key) return reply.code(400).send({error:'请为当前 API 地址输入 Key，或先保存对应 Key'});
    if (action === 'model/test' && !input.model) return reply.code(400).send({error:'请填写或选择模型名称'});
    try { return await inspectModelService(input.baseURL, key, action === 'model/test' ? input.model : undefined); }
    catch (error) { return reply.code(400).send({error:(error as Error).message}); }
  });
  app.post(`${path}/accept`, async req => {
    z.object({ noticeVersion: z.literal(version), accepted: z.literal(true) }).strict().parse(req.body);
    store.db.transaction(() => {
      store.set(`studyAcceptance:${platform}:${version}`, {
        platform, noticeVersion: version, acceptedAt: Date.now(), acknowledgement: STUDY_ACCEPTANCE_TEXT,
      });
      store.set(configKey, { ...config(), enabled: true, noticeVersion: version });
    })();
    return view();
  });
  app.patch(`${path}/settings`, async (req, reply) => {
    const input = StudyConfigInput.strict().parse(req.body), previous = config();
    if (input.enabled && previous.noticeVersion !== version) return reply.code(409).send({ error: "请先阅读并确认试验性功能说明" });
    if (input.localSkills && !previous.localSkills && !input.localSkillsAccepted) return reply.code(409).send({ error: "请先确认本地 Skill 的额外 token 费用、数据发送与摘要风险" });
    if (!input.enabled) await manager.stop();
    if (previous.baseURL !== input.baseURL && !input.apiKey && store.get(keyFlag, false)) return reply.code(400).send({ error: "API 地址已变化，请重新输入对应地址的 Key" });
    if (platform === 'chaoxing' && input.enabled && previous.chapterTests !== input.chapterTests) {
      try { await manager.setChapterTests(input.chapterTests); }
      catch (error) { return reply.code(409).send({error:(error as Error).message}); }
    }
    if (input.apiKey) { await vault.save(secretId, { baseURL: input.baseURL, key: input.apiKey }); store.set(keyFlag, true); }
    const { apiKey, localSkillsAccepted, ...saved } = input;
    saved.noticeVersion = previous.noticeVersion;
    store.set(configKey, saved);
    return view();
  });
  app.post(`${path}/key/delete`, async (_, reply) => {
    if (manager.active) return reply.code(409).send({ error: "请先停止自动学习" });
    await unlink(join(dir, `${secretId}.encrypted`)).catch(e => { if (e.code !== "ENOENT") throw e; });
    store.set(keyFlag, false); return view();
  });
  app.post(`${path}/skills/delete`, async (_, reply) => {
    if (manager.active) return reply.code(409).send({ error: "请先停止学习，再清除本地 Skill" });
    await unlink(join(dir, 'study-skills', `${platform}.json`)).catch(e => { if (e.code !== 'ENOENT') throw e; });
    return { ok: true };
  });
  app.post(`${path}/disable`, async () => {
    await manager.stop(); store.set(configKey, { ...config(), enabled: false }); return view();
  });
  const available = () => courses().filter(c => c.platform === platform && c.status === "enabled");
  const statusView = (status=manager.status()) => {
    const course=available().find(c=>c.key===status.progress?.courseKey);
    if (!course || !status.progress) return status;
    return {...status,progress:{...status.progress,chapters:status.progress.chapters.map(chapter=>{
      const saved=chapter.id ? store.get<{tasks?:StudyProgress['tasks']}>(`studyTasks:${course.id}:${chapter.id}`,{}).tasks : undefined;
      return {...chapter,tasks:chapter.id===status.progress?.chapterId && chapter.tasks?.length ? mergeTasks(chapter.tasks,saved || []) : saved || chapter.tasks};
    })}};
  };
  const catalogView = () => ({ items: store.get<CourseLearningProgress[]>(`courseProgress:${platform}`, []).filter(c => available().some(a => a.id === c.courseId)) });
  app.get(`${path}/catalog`, () => catalogView());
  app.get(`${path}/position`, (req, reply) => {
    const {courseId} = z.object({courseId:z.string().min(1).max(100)}).parse(req.query);
    const course = available().find(c => c.id === courseId);
    if (!course) return reply.code(400).send({error:'课程未选择或已移除'});
    return {position:store.get<StudyPosition | null>(`studyPosition:${courseId}`,null),chapters:(catalogView().items.find(c=>c.courseId===courseId)?.chapters || []).map(chapter => ({...chapter,...(chapter.id ? {tasks:store.get<{tasks?:StudyProgress['tasks']}>(`studyTasks:${courseId}:${chapter.id}`,{}).tasks || chapter.tasks} : {})}))};
  });
  app.post(`${path}/catalog`, async (req, reply) => {
    const { courseId } = z.object({ courseId: z.string().max(100).optional() }).strict().parse(req.body ?? {});
    if (loginActive()) return reply.code(409).send({ error: "请先完成登录，再查询课程目录" });
    let list = available().filter(c => platform !== "unipus" || c.key.startsWith("resource:"));
    if (courseId) list = list.filter(c => c.id === courseId);
    if (!list.length) return reply.code(400).send({ error: "请先选择需要同步的课程" });
    try {
      const result = await catalog.read(dir, platform, list);
      const currentIds = new Set(available().map(c => c.id));
      const requestedIds = new Set(list.map(c => c.id));
      for (const item of result.items.filter(c=>currentIds.has(c.courseId) && requestedIds.has(c.courseId))) for (const chapter of item.chapters) {
        if (!chapter.id || !chapter.tasks?.length) continue;
        const key=`studyTasks:${item.courseId}:${chapter.id}`, previous=store.get<{tasks?:StudyProgress['tasks']}>(key,{}).tasks || [];
        chapter.tasks=mergeTasks(chapter.tasks,previous);
        store.set(key,{tasks:chapter.tasks,observedAt:item.observedAt});
      }
      const old = catalogView().items;
      const items = [...new Map([...old, ...result.items.filter(c => currentIds.has(c.courseId) && requestedIds.has(c.courseId))].map(c => [c.courseId, c])).values()];
      store.set(`courseProgress:${platform}`, items);
      return { items: courseId ? items.filter(item => item.courseId === courseId) : items, issues: result.issues };
    } catch (e) { return reply.code(409).send({ error: (e as Error).message }); }
  });
  app.get(`${path}/status`, () => statusView());
  app.post(`${path}/show`, async (_, reply) => {
    try { return await manager.showWindow(); } catch (e) { return reply.code(409).send({ error: (e as Error).message }); }
  });
  app.post(`${path}/progress`, async (_, reply) => {
    try { return statusView(await manager.progress()); } catch (e) { return reply.code(409).send({ error: (e as Error).message }); }
  });
  app.post(`${path}/start`, async (req, reply) => {
    const options = StudyStart.parse(req.body ?? {});
    if (options.task && platform !== 'chaoxing') return reply.code(400).send({error:'当前平台不支持章节任务入口'});
    if (options.task === 'quiz' && options.operation !== 'answers') return reply.code(400).send({error:'请使用章节检测方式启动'});
    if (options.task === 'video' && options.operation !== 'play') return reply.code(400).send({error:'请使用播放方式启动视频'});
    const saved = config();
    const course = options.courseId ? available().find(c => c.id === options.courseId && (platform !== "unipus" || c.key.startsWith("resource:"))) : undefined;
    if (options.courseId && !course) return reply.code(400).send({ error: "课程未选择或已移除，请刷新课程列表" });
    if (options.background && !course) return reply.code(400).send({ error: "后台运行需要先选择课程" });
    if (options.chapterId && !course) return reply.code(400).send({error:'请先选择课程，再选择章节'});
    const position = course && options.operation !== 'keep-open' && !options.chapterId ? store.get<StudyPosition | null>(`studyPosition:${course.id}`,null) : null;
    if (catalog.active) return reply.code(409).send({ error: "正在读取课程进度，请稍后启动" });
    if (!saved.enabled || saved.noticeVersion !== version) return reply.code(409).send({ error: "请先开启并确认试验性功能说明" });
    if (loginActive()) return reply.code(409).send({ error: "请先完成或取消平台登录" });
    if (!existsSync(join(dir, `${platform}.encrypted`))) return reply.code(409).send({ error: `请先在${name}平台设置中完成登录` });
    const needsModel = options.operation === "answers";
    if (needsModel && !saved.model) return reply.code(400).send({ error: "请先填写并保存模型名称" });
    const secret = options.operation !== "keep-open" && saved.model ? await vault.read(secretId) : null;
    if (needsModel && (!secret?.key || secret.baseURL !== saved.baseURL)) return reply.code(400).send({ error: "请先为当前 API 地址保存 Key" });
    const canAnswer = !!(secret?.key && secret.baseURL === saved.baseURL && saved.model);
    try { return manager.start(dir, { ...saved, playMedia: options.operation === "play", answerExercises: canAnswer, targetMinutes: 0 }, canAnswer ? secret.key : "", { ...options, ...(position ? {position} : {}), ...(course ? { course: { key: course.key, name: course.name } } : {}) }); } catch (e) { return reply.code(409).send({ error: (e as Error).message }); }
  });
  for (const action of ["pause", "resume"] as const) app.post(`${path}/${action}`, (_, reply) => {
    try { return manager.command(action); } catch (e) { return reply.code(409).send({ error: (e as Error).message }); }
  });
  for (const direction of ["previous", "next"] as const) app.post(`${path}/${direction}`, async (_, reply) => {
    try { return await manager.navigate(direction); } catch(e) { return reply.code(409).send({ error:(e as Error).message }); }
  });
  app.post(`${path}/stop`, () => manager.stop());
  app.post(`${path}/chapter`, async (req, reply) => {
    const {chapterId, task} = z.object({chapterId:z.string().min(1).max(200),task:z.enum(["video","quiz"]).optional()}).strict().parse(req.body);
    try { return await manager.navigate('chapter',chapterId,task); } catch (e) { return reply.code(409).send({error:(e as Error).message}); }
  });
  app.addHook("onClose", async () => { await manager.stop(); });
  }
  return { summaries() {
    return Object.entries(managers).flatMap(([platform,manager])=>{
      const saved=store.get<any>(platform==='chaoxing'?'studyConfig':'studyConfig:unipus',{}), status=manager.status();
      if (!saved.enabled || saved.noticeVersion!==studyNoticeVersion(platform as StudyPlatform) || status.phase==='idle')return [];
      const {phase,message,courseName,operation,closeAt,navigation}=status;
      const progress=status.progress?{...status.progress,chapters:[]}:null;
      return [{platform,phase,message,courseName,operation,closeAt,navigation,progress}];
    });
  }, get active() { return catalog.active || Object.values(managers).some(manager => manager.active); }, activeFor(platform: string) { return catalog.active || Object.hasOwn(managers, platform) && managers[platform as StudyPlatform].active; } };
}
