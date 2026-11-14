// Temporary, local-only preview. No real account, session, API Key or learning data.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../apps/local-service/src/server.ts';
import { STUDY_NOTICE_VERSION, UNIPUS_STUDY_NOTICE_VERSION } from '../packages/contracts/src/study.ts';
const dir = mkdtempSync(join(tmpdir(), 'cw-study-preview-'));
const token = 'coursewatch-local-preview-'.repeat(4);
process.env.COURSEWATCH_NATIVE_TOKEN = token;
const server = await createServer({ dir, port: 17331, test: true });
for (const id of ['chaoxing','unipus','yuketang']) server.store.set(`platform:${id}`, { ...server.store.get(`platform:${id}`, {}), added: true, loginStatus: id === 'yuketang' ? 'unknown' : 'logged_in' });
for (let i = 1; i <= 24; i++) server.engine.rememberCourse('chaoxing', server.store.get('platform:chaoxing', {}).accountId, `course:${i}:class:${100+i}`, `模拟课程 ${i}（仅用于界面预览）`);
for (let i = 1; i <= 2; i++) server.engine.rememberCourse('unipus', server.store.get('platform:unipus', {}).accountId, `resource:${i}`, `模拟${i === 1 ? '读写' : '视听说'}教程 2`);
for (const id of ['chaoxing','unipus']) {
  const courses = server.engine.courses().filter(c => c.platform === id);
  server.engine.selectCourses(id, server.store.get(`platform:${id}`, {}).accountId, courses.slice(0,2).map(c=>c.id));
  server.store.set(`courseProgress:${id}`, courses.slice(0,2).map((c,i)=>({courseId:c.id,name:c.name,group:'模拟大学英语课程',className:'模拟班级',completed:i?12:0,total:id==='unipus'?(i?270:276):70,percent:id==='unipus'?(i?4.5:0):null,chapters:[{name:'模拟第一章',complete:false,pending:2}],observedAt:Date.now()})));
}
server.store.set('studyConfig:unipus', { enabled: true, noticeVersion: UNIPUS_STUDY_NOTICE_VERSION, answerExercises: false, autoSubmitPractice: false });
server.store.set('studyConfig', { enabled: true, noticeVersion: STUDY_NOTICE_VERSION, answerExercises: false, autoSubmitPractice: false });
server.app.get('/preview', (_, reply) => reply.type('text/html').send('<!doctype html><meta charset="utf-8"><title>CourseWatch 本地预览</title><p>正在打开临时预览…</p><script src="/preview-auth.js"></script>'));
server.app.get('/preview-auth.js', (_, reply) => reply.type('application/javascript').send(`localStorage.setItem('coursewatch-client-token', ${JSON.stringify(token)}); location.replace('/?desktop=1');`));
await server.app.listen({ host: '127.0.0.1', port: 17331 });
console.log('临时界面预览：http://127.0.0.1:17331/preview\n全部课程为模拟数据，无真实登录会话或模型 Key。按 Ctrl+C 停止并清理临时数据。');
let closing = false;
async function close() { if (closing) return; closing = true; await server.app.close(); rmSync(dir, { recursive: true, force: true }); process.exit(0); }
process.on('SIGINT', close); process.on('SIGTERM', close);
