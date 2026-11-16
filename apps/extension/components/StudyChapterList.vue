<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Check, ChevronDown, ChevronRight, Lock, Play } from 'lucide-vue-next';
import type { StudyChapterEntry } from '../../../packages/contracts/src/study';
const props = defineProps<{ chapters: StudyChapterEntry[]; selected?:string; current?:string; disabled?:boolean; showTasks?:boolean; showRequired?:boolean; active?:boolean }>();
const emit = defineEmits<{ select:[id:string]; task:[id:string,kind:"video"|"quiz"] }>();
const search = ref(''), collapsed = ref(new Set<string>());
interface Node { key:string; name:string; entry?:StudyChapterEntry; children:Node[]; }
const tree = computed(() => {
  const root:Node[] = [];
  props.chapters.forEach((chapter,index) => {
    let siblings = root, prefix = '';
    for (const part of [...(chapter.path || []),{id:chapter.id || `row:${index}`,name:chapter.name}]) {
      const key = JSON.stringify([prefix,part.id]);
      let node = siblings.find(n => n.key === key);
      if (!node) { node = {key,name:part.name,children:[]}; siblings.push(node); }
      if (part.id === (chapter.id || `row:${index}`)) node.entry = chapter;
      prefix = key; siblings = node.children;
    }
  });
  return root;
});
function contains(node:Node,id?:string):boolean { return !!id && (node.entry?.id === id || node.children.some(n => contains(n,id))); }
watch(() => [props.current,props.selected], () => {
  function reveal(nodes:Node[]) { for (const n of nodes) { if (contains(n,props.current) || contains(n,props.selected)) collapsed.value.delete(n.key); reveal(n.children); } }
  reveal(tree.value);
});
function toggle(key:string) { if (collapsed.value.has(key)) collapsed.value.delete(key); else collapsed.value.add(key); }
function descendants(node:Node):StudyChapterEntry[] { return [...(node.entry ? [node.entry] : []),...node.children.flatMap(descendants)]; }
const rows = computed(() => {
  const query = search.value.trim().toLowerCase();
  const matches = (n:Node):boolean => n.name.toLowerCase().includes(query) || (!!props.showRequired && !!n.entry && (n.entry.required === true ? '必修' : n.entry.required === false ? '非必修' : '必修属性待确认').includes(query)) || n.children.some(matches);
  const result:{node:Node;depth:number;open:boolean;count:number;completed:number}[] = [];
  function visit(nodes:Node[],depth:number,parentMatch=false) {
    for (const node of nodes) {
      if (query && !parentMatch && !matches(node)) continue;
      const entries = descendants(node), open = !!query || !collapsed.value.has(node.key);
      result.push({node,depth,open,count:entries.length,completed:entries.filter(c => c.complete === true).length});
      if (open) visit(node.children,depth+1,parentMatch || (!!query && node.name.toLowerCase().includes(query)));
    }
  }
  visit(tree.value,0);return result;
});
function taskStatus(entry: StudyChapterEntry, kind: 'video'|'quiz') {
  const tasks = entry.tasks?.filter(t => t.kind === kind) || [];
  return !tasks.length ? '待识别' : tasks.some(t => t.complete === false) ? '未完成' : tasks.every(t => t.complete === true) ? '已完成' : '待确认';
}
</script>
<template>
  <div class="chapter-list">
    <input v-if="chapters.length > 12" v-model="search" type="search" placeholder="搜索章节或小节" aria-label="搜索章节" />
    <ol aria-label="章节目录">
      <li v-for="{node,depth,open,count,completed} in rows" :key="node.key" :style="{paddingInlineStart:`${Math.min(depth,4)*16}px`}">
        <div class="chapter-row">
          <button v-if="node.children.length && node.entry" class="chapter-toggle" type="button" :aria-expanded="open" :aria-label="`${open ? '收起' : '展开'}${node.name}的小节`" @click="toggle(node.key)"><ChevronDown v-if="open" :size="16" /><ChevronRight v-else :size="16" /></button>
          <button v-if="!node.entry" class="chapter-item chapter-group" type="button" :aria-expanded="open" @click="toggle(node.key)">
            <span class="chapter-symbol"><ChevronDown v-if="open" :size="16" /><ChevronRight v-else :size="16" /></span>
            <span class="chapter-label">{{ node.name }}<small>{{ count }} 小节 · {{ completed }} 节已完成</small></span>
          </button>
          <button v-else class="chapter-item" type="button" :disabled="disabled || node.entry.locked || !node.entry.id" :aria-pressed="!!node.entry.id && selected === node.entry.id" :aria-current="current === node.entry.id && node.entry.id ? 'step' : undefined" @click="node.entry.id && emit('select',node.entry.id)">
            <span class="chapter-symbol"><Check v-if="node.entry.complete === true" class="study-complete-icon" :size="16" aria-hidden="true" /><Lock v-else-if="node.entry.locked" :size="15" /><Play v-else :size="14" /></span>
            <span class="chapter-label">{{ node.name }}<small v-if="showRequired" class="chapter-requirement">{{ node.entry.required === true ? '必修' : node.entry.required === false ? '非必修' : '必修属性待确认' }}</small><small>{{ node.entry.locked ? '未开放' : node.entry.complete === true ? '已完成' : node.entry.complete === false ? '未完成' : '状态待确认' }}<template v-if="current === node.entry.id && node.entry.id"> · 当前位置</template><template v-if="selected === node.entry.id && node.entry.id && selected !== current"> · 从这里开始</template></small></span>
          </button>
        </div>
        <div v-if="showTasks && node.entry" class="chapter-tasks">
          <small class="chapter-task-status"><span>视频：<Check v-if="taskStatus(node.entry,'video') === '已完成'" class="study-complete-icon" :size="14" aria-hidden="true" />{{ taskStatus(node.entry,'video') }}</span> · <span>章节检测：<Check v-if="taskStatus(node.entry,'quiz') === '已完成'" class="study-complete-icon" :size="14" aria-hidden="true" />{{ taskStatus(node.entry,'quiz') }}</span></small>
          <button v-if="node.entry.id" type="button" :disabled="disabled || node.entry.locked" :aria-label="`${active ? '进入' : '做'}章节检测：${node.name}`" @click="emit('task',node.entry.id,'quiz')">{{ active ? '进入章节检测' : '做章节检测' }}</button>
        </div>
      </li>
    </ol>
    <p v-if="!rows.length">{{ chapters.length ? '没有匹配的章节或小节' : '尚未读取目录，点击“读取目录”查看章节与完成状态。' }}</p>
  </div>
</template>
<style scoped>
.chapter-list { min-width:0; }
.chapter-list input { box-sizing:border-box;width:100%;height:44px;padding:0 12px;border:1px solid var(--d-border,#8884);border-radius:9px;background:var(--d-control,var(--panel,#fff));color:inherit;font:inherit;margin-bottom:10px; }
ol { list-style:none;margin:0;padding:0;max-height:360px;overflow:auto;overscroll-behavior:auto; }
li+li { border-top:1px solid var(--d-border,#8883); }
.chapter-row { display:flex;align-items:center;min-width:0; }
.chapter-list button { display:flex;align-items:center;justify-content:flex-start;gap:12px;min-height:60px;padding:12px!important;background:transparent!important;border:0!important;border-radius:8px!important;text-align:left;color:inherit;font:inherit; }
.chapter-tasks { display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px 10px;padding:0 12px 10px 48px; }
.chapter-task-status { display:flex;align-items:center;flex-wrap:wrap;gap:4px; }
.chapter-task-status>span { display:inline-flex;align-items:center;gap:3px; }
.chapter-list .chapter-tasks button { min-height:36px;font-size:12px;padding:6px 8px!important;color:var(--d-accent,#477bd7); }
.chapter-item { flex:1;min-width:0; }
.chapter-list .chapter-toggle { flex:0 0 44px;justify-content:center;padding:0!important; }
.chapter-group .chapter-label { font-weight:600; }
.chapter-list button:not(:disabled) { cursor:pointer; }
.chapter-list button:hover:not(:disabled),.chapter-list button[aria-pressed=true],.chapter-list button[aria-current=step] { background:var(--d-selected,rgba(71,123,215,.1))!important; }
.chapter-list button:disabled { opacity:.65; }
.chapter-symbol { display:grid;place-items:center;flex-shrink:0;width:24px;color:var(--d-muted,#687281);font-size:12px; }
.chapter-label { min-width:0;overflow-wrap:anywhere;font-size:14px;line-height:1.5; }
small { display:block;margin-top:3px;font-size:12px;color:var(--d-muted,#687281);font-weight:400; }
p { margin:12px 0;font-size:13px;line-height:1.65;color:var(--d-muted,#687281); }
button:focus-visible,input:focus-visible { outline:3px solid var(--d-accent,#477bd7);outline-offset:-3px; }
</style>
