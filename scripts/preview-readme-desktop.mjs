// Local screenshot fixture. Uses a fresh database, no accounts or external requests.
// Launched only by prepare-readme-desktop.py in an isolated AppKit bundle.
import { createServer } from '../apps/local-service/src/server.ts';
import { StudyConfig, initialStudyStatus, studyNoticeVersion } from '../packages/contracts/src/study.ts';

if (!process.env.COURSEWATCH_README_PREVIEW || !process.env.COURSEWATCH_DATA_DIR)
  throw new Error('请通过 python3 scripts/prepare-readme-desktop.py 创建隔离应用');
const server = await createServer({ dir: process.env.COURSEWATCH_DATA_DIR, port: 17402, test: true });
const { store, engine, app } = server;
const now = Date.now(), hour = 3600000;
store.set('settings', { ...engine.settings(), theme: 'light', nativeNotifications: false });
store.set('monitoring', true);
const examples = {
  chaoxing: ['模拟 · 数据结构与算法', '模拟 · 计算机网络', '模拟 · 数据库原理', '模拟 · 软件工程'],
  unipus: ['模拟 · 大学英语读写', '模拟 · 大学英语视听说'],
  yuketang: ['模拟 · 高等数学', '模拟 · 线性代数'],
};
const records = {};
for (const platform of ['ynjy', 'renwei'])
  store.set(`platform:${platform}`, { ...store.get(`platform:${platform}`, {}), added:false, enabled:false });
for (const [platform, names] of Object.entries(examples)) {
  const saved = store.get(`platform:${platform}`, {});
  store.set(`platform:${platform}`, { ...saved, added: true, enabled: true, loginStatus: 'logged_in', lastCheckAt: now, lastOutcome: 'complete' });
  records[platform] = names.map((name, i) => engine.rememberCourse(platform, saved.accountId, `demo:${platform}:${i + 1}`, name));
  engine.selectCourses(platform, saved.accountId, records[platform].slice(0, platform === 'chaoxing' ? 3 : 2).map(c => c.id));
  const titles = platform === 'chaoxing' ? ['线性表与链表练习', '网络协议实验报告', '关系代数作业']
    : platform === 'unipus' ? ['Unit 3 · Reading practice', 'Unit 2 · Listening practice'] : ['导数与微分练习', '矩阵运算测验'];
  engine.apply({ platform, accountId: saved.accountId, outcome: 'complete', discoveryComplete: true,
    partitions: [{ key: `demo:${platform}`, outcome: 'complete', paginationComplete: true, emptyConfirmed: false,
      items: titles.map((title, i) => ({ sourceId: `demo-${i}`, namespace: `demo:${platform}`, courseKey: records[platform][i].key,
        course: names[i], title: `模拟 · ${title}`, type: i === 1 && platform === 'yuketang' ? 'exam' : 'homework', sourceStatus: 'pending',
        deadline: { kind: 'known', value: now + [8, 32, 56][i] * hour, raw: '模拟截止时间', timezone: 'Asia/Shanghai' }, startTime: {kind:'unknown'}, publishTime: {kind:'unknown'} })), issues: [] }], issues: [] });
}
for (const [i, title] of ['模拟 · 小组讨论：课程项目选题', '模拟 · 图书馆归还参考书', '模拟 · 整理本周学习笔记'].entries())
  engine.saveSchedule({ id: `readme-demo-${i}`, title, note: '仅用于 README 展示，无真实课程或个人信息。', dueAt: now + [5, 26, 74][i] * hour, important: i === 0, reminderHours: [24, 3, 1], done: false, version: 1, updatedAt: now });
const firstTask = engine.tasks()[0];
if (firstTask) store.run('UPDATE tasks SET data=? WHERE id=?', JSON.stringify({...firstTask, important:true}), firstTask.id);
// Retain example notifications in the app without delivering OS notifications.
store.run('UPDATE outbox SET delivered_at=?', now);

const fixtures = {};
for (const platform of ['chaoxing', 'unipus']) {
  const course = records[platform][0];
  const names = platform === 'chaoxing' ? ['1.1 线性表的顺序存储', '1.2 顺序表的插入与删除', '1.3 链表与指针', '2.1 栈与队列', '2.2 循环队列']
    : ['1.1 Reading · Campus life', '1.2 Listening · Study plans', '1.3 Speaking · Daily routines'];
  const tasks = [{ id:'video', tabId:'video', name:'视频', kind:'video', complete:true, current:false }, { id:'quiz', tabId:'quiz', name:'章节检测', kind:'quiz', complete:false, current:true }];
  const chapters = names.map((name,i) => ({ id:String(i+1), name, complete:i===0, locked:false,
    path:[{id:i<3?'unit-1':'unit-2',name:i<3?(platform==='chaoxing'?'第一章 · 线性表':'Unit 1 · Campus life'):'第二章 · 栈与队列'}],
    tasks:i===1?tasks:[{...tasks[0], complete:i===0}, {...tasks[1], complete:i===0, current:false}] }));
  const state = { ...initialStudyStatus(), phase:'paused', message:'模拟学习任务已暂停', courseName:course.name, operation:platform==='chaoxing'?'answers':'play',
    navigation:{previous:true,next:true}, progress:{observedAt:now,course:course.name,courseKey:course.key,chapter:names[1],chapterId:'2',chapterComplete:false,chapters,tasks,
      media:platform==='unipus'?[{kind:'video',current:154,duration:360,paused:true,ended:false}]:[],documents:[]},
    ...(platform==='chaoxing'?{modelActivity:{question:2,total:4,phase:'completed',reasoning:'模拟输出：逐项检查顺序表插入操作的边界条件。',answer:'模拟答案：插入位置之后的元素需要依次向后移动。',updatedAt:now}}:{timing:{mediaSeconds:154,readingSeconds:300,targetSeconds:1800}}) };
  fixtures[platform] = {state, chapters, config:{...StudyConfig.parse({enabled:true,noticeVersion:studyNoticeVersion(platform),model:'demo-model',baseURL:'https://api.example.com'}),hasKey:platform==='chaoxing',active:true}};
  store.set(`courseProgress:${platform}`, records[platform].map((c,i)=>({courseId:c.id,name:c.name,group:'模拟课程组',className:'演示班级',completed:i?2:1,total:chapters.length,percent:Math.round((i?2:1)/chapters.length*100),chapters,observedAt:now})));
}
// Mock only study and outbound actions. All renderer assets and ordinary APIs are production code.
app.addHook('onRequest', async (req, reply) => {
  const path = req.url.split('?')[0];
  const match = path.match(/^\/api\/study(?:\/(unipus))?\/(settings|status|position|start|pause|resume|stop|chapter|progress)$/);
  if (match) {
    const fixture = fixtures[match[1] || 'chaoxing'];
    if (match[2] === 'settings') return reply.send(fixture.config);
    if (match[2] === 'position') return reply.send({position:{chapterId:'2',chapter:fixture.chapters[1].name,observedAt:now},chapters:fixture.chapters});
    return reply.send(fixture.state);
  }
  if (path === '/api/native/summary') return reply.send({ total:engine.visibleTasks().length + engine.schedules().length,
    studies:Object.entries(fixtures).map(([platform,f])=>({...f.state,platform})),
    items:engine.schedules().slice(0,2).map(s=>({title:s.title,dueAt:s.dueAt})) });
  if (req.method !== 'GET' && /\/api\/(?:monitor|notifications\/test|platforms\/.*\/(?:login|courses\/scan)|study\/.*(?:models|test)|mobile.*(?:test|pair)|icloud)/.test(path))
    return reply.code(409).send({error:'截图预览不连接真实平台、模型或通知服务'});
});
await app.listen({host:'127.0.0.1',port:17402});
console.log('README 桌面预览：全部内容为模拟数据，端口 17402');
process.on('SIGTERM', async () => { await app.close(); process.exit(0); });
