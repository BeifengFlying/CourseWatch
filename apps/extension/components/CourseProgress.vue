<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { Check } from 'lucide-vue-next';
import { api } from '../lib/api';
import type { CourseRecord } from '../../../packages/contracts/src/index';
import type { CourseLearningProgress, StudyPlatform } from '../../../packages/contracts/src/study';
const props=defineProps<{platform:StudyPlatform;courses:CourseRecord[]}>();
const prefix=props.platform==='unipus'?'study/unipus':'study';
const items=ref<CourseLearningProgress[]>([]),querying=ref<string|null>(null),message=ref('');
const rowMessages=ref<Record<string,string>>({});
const busy=computed(()=>querying.value!==null);
let queryVersion=0;
const books=computed(()=>props.courses.filter(c=>c.platform===props.platform&&c.status==='enabled'&&(props.platform!=='unipus'||c.key.startsWith('resource:'))));
const progress=(id:string)=>items.value.find(c=>c.courseId===id);
async function query(courseId?:string){
 if(busy.value)return;
 querying.value=courseId??'all';
 queryVersion++;message.value='';
 if(courseId)rowMessages.value[courseId]='';else{message.value='';rowMessages.value={};}
 const report=(text:string)=>{if(courseId)rowMessages.value[courseId]=text;else message.value=text;};
 try{
  const result=await api(`${prefix}/catalog`,'POST',courseId?{courseId}:{},100000);
  const updates=(result.items as CourseLearningProgress[]).filter(item=>!courseId||item.courseId===courseId);
  items.value=[...new Map([...items.value,...updates].map(item=>[item.courseId,item])).values()];
  report(result.issues?.join('；')||(courseId?'本课程进度已读取':'本轮课程进度已读取'));
 }catch(e){report((e as Error).message);}finally{querying.value=null;}
}
onMounted(async()=>{const version=queryVersion;try{const saved=await api(`${prefix}/catalog`);if(version===queryVersion)items.value=saved.items;}catch(e){if(version===queryVersion)message.value=(e as Error).message;}});
</script>
<template>
 <div class="course-progress" aria-label="课程与官方进度">
  <div class="course-progress-head"><span>{{ books.length }} {{ platform === 'unipus' ? '本教程' : '门课程' }}</span><button class="glass-secondary" type="button" :disabled="busy || !books.length" @click="query()">{{ querying === 'all' ? '正在查询全部…' : '查询全部课程进度' }}</button></div>
  <p v-if="!books.length">尚未选择课程。请登录平台并在“管理课程”中选择。</p>
  <p v-if="message" role="status">{{ message }}</p>
  <div class="course-progress-list">
   <article v-for="book in books" :key="book.id" :aria-busy="querying === book.id || querying === 'all'">
    <div><strong>{{ book.name }}</strong><small v-if="progress(book.id)?.group">课程：{{ progress(book.id)?.group }}<template v-if="progress(book.id)?.className"> · 班级：{{ progress(book.id)?.className }}</template></small>
     <p v-if="platform === 'chaoxing' && progress(book.id)?.total === 0">官网任务点：0 / 0。请查看下方章节状态。</p>
     <p v-else-if="progress(book.id)">{{ platform === 'unipus' ? '已学任务' : '已完成任务点' }}：{{ progress(book.id)?.completed ?? '待确认' }} / {{ progress(book.id)?.total ?? '待确认' }}<template v-if="progress(book.id)?.percent != null"> · 学习进度 {{ progress(book.id)?.percent }}%</template></p><p v-else>官方进度尚未查询</p>
     <progress v-if="progress(book.id)?.percent != null" :value="progress(book.id)?.percent ?? 0" max="100" aria-label="官方学习进度" />
     <small class="course-deadline">{{ progress(book.id)?.deadline ? `${progress(book.id)?.deadlineLabel || '学习截止'}：${progress(book.id)?.deadline}` : progress(book.id) ? '截止日期未提供' : '截止日期尚未查询' }}</small>
     <p v-if="rowMessages[book.id]" role="status">{{ rowMessages[book.id] }}</p>
    </div><button class="glass-secondary" type="button" :disabled="busy" :aria-label="'查询' + book.name + '的进度'" @click="query(book.id)">{{ querying === book.id ? '正在查询…' : '查询' }}</button>
    <details v-if="progress(book.id)?.chapters.length"><summary>章节目录（{{ progress(book.id)?.chapters.length }}）</summary><ul><li v-for="(chapter,index) in progress(book.id)?.chapters" :key="index"><Check v-if="chapter.complete === true" class="study-complete-icon" :size="15" aria-hidden="true" />{{ chapter.name }} · {{ chapter.complete === true ? '已完成' : chapter.complete === false ? '未完成' : '待确认' }}<template v-if="chapter.pending != null"> · {{ chapter.pending }} 个任务点未完成</template></li></ul></details>
   </article>
  </div>
 </div>
</template>
<style scoped>
.course-progress li .study-complete-icon{display:inline-block;vertical-align:-2px;margin-right:5px}
.course-progress{display:grid;gap:12px;min-width:0}.course-progress-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.course-progress-list{display:grid;gap:10px;max-height:340px;overflow:auto;overscroll-behavior:auto}.course-progress article{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;padding:16px;border:1px solid var(--d-border,var(--line,#8884));border-radius:12px;background:var(--d-card,var(--panel,#fff))}.course-progress article>div{flex:1;min-width:0}.course-progress p{margin:6px 0;font-size:13px}.course-progress strong,.course-progress small{display:block;overflow-wrap:anywhere}.course-progress small{color:var(--d-muted,var(--muted));font-size:12px;line-height:1.6}.course-progress details{flex-basis:100%;font-size:13px}.course-progress ul{padding-left:18px;line-height:1.8}.course-progress progress{width:100%;height:6px;accent-color:var(--d-accent,#477bd7)}.course-progress button{min-height:44px}@media(max-width:560px){.course-progress article>div{flex-basis:100%}.course-progress article>button{margin-left:auto}}
</style>
