<script setup lang="ts">
import { computed } from "vue";
const props = defineProps<{ text: string }>();
const emit = defineEmits<{ open: [url: string] }>();
const parts = computed(() => {
  const result: { text: string; url?: string }[] = [];
  let cursor = 0;
  for (const match of props.text.matchAll(/https?:\/\/[^\s<>"'，。；！？、（）【】]+/g)) {
    const start = match.index!;
    const value = match[0].replace(/[.,;!?)\]]+$/, "");
    if (start > cursor) result.push({ text: props.text.slice(cursor, start) });
    try {
      const url = new URL(value);
      result.push({ text: value, ...(!url.username && !url.password ? { url: url.href } : {}) });
    } catch { result.push({ text: value }); }
    cursor = start + value.length;
  }
  if (cursor < props.text.length) result.push({ text: props.text.slice(cursor) });
  return result;
});
</script>

<template>
  <template v-for="(part, index) in parts" :key="index">
    <a v-if="part.url" :href="part.url" target="_blank" rel="noopener noreferrer" @click.prevent="emit('open', part.url)">{{ part.text }}</a><template v-else>{{ part.text }}</template>
  </template>
</template>
