import {it,expect} from 'vitest';
import {parseYnjyExams} from '../packages/adapters/src/ynjy.js';
const source={url:'https://jsjks.ynjy.cn/classrooms/test-class/exercise',course:'课程',type:'exam' as const};
it('考试列表响应保留稳定ID和标题，不将状态码或答题时长当成完成状态或截止时间',()=>{
 const r=parseYnjyExams({status:0,total_count:1,exercises:[{id:123,exercise_name:'考试样例',created_at:'2026-11-02T11:56:18.000+08:00',time:40,current_status:1,exercise_status:3}]},source);
 expect(r.items).toHaveLength(1);expect(r.items[0]).toMatchObject({sourceId:'123',namespace:'classroom:test-class:exercise',type:'exam',sourceStatus:'unknown',deadline:{kind:'unknown'},startTime:{kind:'unknown'},publishTime:{kind:'known'}});
 expect(r.paginationComplete).toBe(true);
});
it('空数组不掩盖平台失败或尚未读取的考试分页',()=>{
 expect(()=>parseYnjyExams({status:401,total_count:0,exercises:[]},source)).toThrow();
 expect(parseYnjyExams({status:0,total_count:20,exercises:[]},source)).toMatchObject({emptyConfirmed:false,paginationComplete:false});
 expect(parseYnjyExams({status:0,total_count:0,exercises:[]},source)).toMatchObject({emptyConfirmed:true,paginationComplete:true});
});
