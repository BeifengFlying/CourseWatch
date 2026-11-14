import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
// @ts-expect-error Node build gate is a standalone JavaScript module.
import { verifyStudyProtection } from '../scripts/verify-study-protection.mjs';
const read = (path: string) => readFileSync(path,'utf8');
it('保护清单通过，删除、意外修改及移除调用入口均阻止构建',()=>{
 expect(verifyStudyProtection()).toMatchObject({protectedFiles:5});
 expect(()=>verifyStudyProtection((path:string)=>{if(path.endsWith('video-quiz.ts'))throw new Error('missing');return read(path);})).toThrow('缺失');
 expect(()=>verifyStudyProtection((path:string)=>read(path)+(path.endsWith('unipus-activity.ts')?'\n// changed':''))).toThrow('发生变化');
 expect(()=>verifyStudyProtection((path:string)=>path.endsWith('/worker.ts')?read(path).replace('await solveVideoQuizzes','await disabledVideoQuizzes'):read(path))).toThrow('入口缺失');
});
