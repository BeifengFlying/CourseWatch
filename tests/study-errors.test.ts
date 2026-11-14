import { expect,it } from 'vitest';
import { StudyError,studyFailureMessage } from '../packages/study/src/errors.js';
it('启动失败保留可操作的本地原因，浏览器错误不暴露会话地址',()=>{
 expect(studyFailureMessage(new StudyError('官网章节目录未加载，请重试'),'course')).toContain('官网章节目录未加载');
 const error=new Error('page.goto failed https://example.com/?secret=private');error.name='TimeoutError';
 expect(studyFailureMessage(error,'course')).toContain('加载超时');
 expect(studyFailureMessage(error,'course')).not.toContain('secret');
 expect(studyFailureMessage(new Error('no session'),'session')).toContain('未保存平台登录');
 expect(studyFailureMessage(new Error("Executable doesn't exist"),'browser')).toContain('所选浏览器');
});
it('提交和填写失败按阶段说明，不把已完成的模型输出误报为请求失败',()=>{
 const error=new Error('locator.innerText: Timeout 30000ms exceeded https://example.com/?secret=private');
 expect(studyFailureMessage(error,'submit')).toContain('结果确认未完成');
 expect(studyFailureMessage(error,'submit')).toContain('不会重复提交');
 expect(studyFailureMessage(error,'submit')).not.toMatch(/模型|secret|locator/);
 expect(studyFailureMessage(error,'fill')).toContain('尚未提交');
 expect(studyFailureMessage(error,'model')).toContain('模型请求未完成');
});
