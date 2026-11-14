<script setup lang="ts">
import { ref } from "vue";
import { Plus, X } from "lucide-vue-next";
import { reminderLabel } from "../../../packages/contracts/src/agenda";
const props = defineProps<{ modelValue: number[]; disabled?: boolean }>();
const emit = defineEmits<{ "update:modelValue": [value: number[]] }>();
const amount = ref<number | null>(30),
  unit = ref(1 / 60),
  error = ref("");
function add() {
  const hours = Number(amount.value) * Number(unit.value);
  if (!Number.isFinite(hours) || hours < 1 / 60 || hours > 8760) {
    error.value = "请输入 1 分钟至 365 天之间的时间";
    return;
  }
  if (props.modelValue.length >= 12) {
    error.value = "最多设置 12 次提醒";
    return;
  }
  error.value = "";
  emit(
    "update:modelValue",
    [...new Set([...props.modelValue, Math.round(hours * 60) / 60])].sort(
      (a, b) => b - a,
    ),
  );
}
</script>
<template>
  <div class="reminder-editor">
    <div class="reminder-chips" aria-label="已设置的提前提醒">
      <span v-for="h in modelValue" :key="h" class="reminder-chip">
        提前 {{ reminderLabel([h]) }}
        <button
          type="button"
          :disabled="disabled"
          :aria-label="`移除提前 ${reminderLabel([h])} 提醒`"
          @click="
            emit(
              'update:modelValue',
              modelValue.filter((v) => v !== h),
            )
          "
        >
          <X :size="14" />
        </button>
      </span>
      <span v-if="!modelValue.length" class="reminder-hint"
        >仅在到点时提醒</span
      >
    </div>
    <div class="reminder-add">
      <span>剩余</span
      ><input
        v-model.number="amount"
        type="number"
        min="1"
        max="525600"
        step="1"
        :disabled="disabled"
        aria-label="提前提醒数值"
        @keydown.enter.prevent="add"
      />
      <select
        v-model.number="unit"
        :disabled="disabled"
        aria-label="提前提醒单位"
      >
        <option :value="1 / 60">分钟</option>
        <option :value="1">小时</option>
        <option :value="24">天</option>
      </select>
      <button
        type="button"
        class="glass-secondary"
        :disabled="disabled"
        @click="add"
      >
        <Plus :size="16" />添加提醒
      </button>
    </div>
    <p v-if="error" class="reminder-validation" role="alert">{{ error }}</p>
    <small class="reminder-hint"
      >可添加多个时间；到点时也会提醒。电脑休眠期间的提醒会在唤醒后合并补发。</small
    >
  </div>
</template>
