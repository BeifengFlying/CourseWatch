import { it, expect } from 'vitest';
import { courseDeadline } from '../packages/contracts/src/course-deadline.js';
import { parseChaoxingCourses } from '../packages/adapters/src/chaoxing.js';
it('保留官方日期精度，不用查询时间或默认午夜代替截止',()=>{
 expect(courseDeadline('2026/12/21')).toBe('2026-12-21');expect(courseDeadline('2026-12-21 23:59')).toBe('2026-12-21 23:59');expect(courseDeadline('2028-2-29 09:05:00')).toBe('2028-02-29 09:05:00');
 for(const date of [null,undefined,'','2026-02-29','2026-12-21 24:00','2026-12-21 23:60','2026-12-21 23:59:60',1760000000000])expect(courseDeadline(date)).toBeNull();
});
it('相同课程不同班级截止日期独立，缺失或无效截止不会阻断课程列表',()=>{
 const list=parseChaoxingCourses(JSON.stringify({result:1,channelList:[{content:{id:1,course:{data:[{id:8,name:'同名课程'}]},endDate:'2026/12/21 23:59'}},{content:{id:2,course:{data:[{id:8,name:'同名课程'}]},endDate:null}},{content:{id:3,course:{data:[{id:9,name:'另一课程'}]},endDate:'未提供'}}]}));
 expect(list).toEqual([{courseId:'8',classId:'1',name:'同名课程',deadline:'2026-12-21 23:59'},{courseId:'8',classId:'2',name:'同名课程'},{courseId:'9',classId:'3',name:'另一课程'}]);
});
