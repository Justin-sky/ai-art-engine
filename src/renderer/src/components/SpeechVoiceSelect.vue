<template>
  <label class="voice-select" data-no-focus-steal>
    <svg
      class="voice-icon"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="currentColor"
        d="M8 1.5a2.5 2.5 0 0 0-2.5 2.5v4a2.5 2.5 0 0 0 5 0V4A2.5 2.5 0 0 0 8 1.5ZM3.5 7.5a.75.75 0 0 1 1.5 0v.5a3 3 0 0 0 6 0v-.5a.75.75 0 0 1 1.5 0v.5a4.5 4.5 0 0 1-3.75 4.44V14h1.75a.75.75 0 0 1 0 1.5h-5a.75.75 0 0 1 0-1.5h1.75v-1.56A4.5 4.5 0 0 1 3.5 8v-.5Z"
      />
    </svg>
    <!--
      与模型下拉（InstructionModelSelect）同一种控件：原生 select。
      不用 input + datalist 的原因不是样式偏好 —— datalist 的候选浮层是浏览器原生的
      白色浮层，不受应用主题控制（`appearance: none` 也关不掉它），
      而且鼠标悬停长音色名会弹系统 tooltip。
    -->
    <select
      :value="modelValue ?? ''"
      :class="{ 'has-value': !!modelValue }"
      :aria-label="voiceTitle"
      @change="onChange"
      @pointerdown.stop
    >
      <!-- 只有多个音色时才给「默认」项：候选里没这一项就等于没有可选项 -->
      <option v-if="showDefaultOption" value="">{{ defaultLabel }}</option>
      <option v-for="voice in options" :key="voice" :value="voice">{{ voice }}</option>
    </select>
  </label>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    modelValue?: string
    options: string[]
    /** 无障碍名（不用同名 title：长音色名会弹系统 tooltip，与主题脱节） */
    voiceTitle: string
    /** 未选任何音色时的首项文案 */
    defaultLabel: string
  }>(),
  { modelValue: '' }
)

const emit = defineEmits<{ change: [value: string] }>()

/** 只有一个候选时不给「默认」项，否则等于一个只有占位符的下拉 */
const showDefaultOption = computed(() => props.options.length > 1)

function onChange(event: Event): void {
  emit('change', (event.target as HTMLSelectElement).value)
}
</script>

<style scoped>
/*
 * 尺寸与内边距刻意与 InstructionModelSelect 的 select 逐项对齐
 * （同一个 footer 里并排的两个下拉）：高度 24 / 字号 11 / max-width 90 /
 * padding 0 4px / 圆角 6 / 同样的 hover 与 has-value 态。
 * 箭头交给浏览器原生绘制 —— 本代码库所有下拉框都这样。
 */
.voice-select {
  display: inline-flex;
  flex-direction: row;
  align-items: center;
  gap: 5px;
  flex: none;
  max-width: 110px;
  margin: 0;
  cursor: default;
}

.voice-icon {
  flex: none;
  color: var(--text-muted);
  display: block;
  pointer-events: none;
}

select {
  flex: 1;
  min-width: 0;
  max-width: 90px;
  height: 24px;
  padding: 0 4px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-input);
  color: var(--text);
  font-size: 11px;
  line-height: 22px;
}

select:hover,
select:focus {
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
  outline: none;
}

/* 已选音色时与模型下拉的 has-value 态一致（蓝字蓝框），一眼看出"这节点设了音色" */
select.has-value {
  color: var(--accent);
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
}

select option:checked {
  color: var(--accent);
  font-weight: 600;
  background: color-mix(in srgb, var(--accent) 16%, transparent);
}
</style>
