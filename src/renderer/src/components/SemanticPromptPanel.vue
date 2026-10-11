<template>
  <div class="spp">
    <p v-if="error" class="spp-err">{{ t('graph.semanticPrompt.loadFailed') }}{{ error }}</p>
    <p v-else-if="loading" class="spp-hint">{{ t('graph.semanticPrompt.loading') }}</p>

    <!-- 一句必须看见的提示：改的是参数，不是已经跑出来的结果 -->
    <p class="spp-hint spp-rerun">{{ t('graph.semanticPrompt.rerunHint') }}</p>

    <p v-if="!rows.length" class="spp-hint">{{ emptyHint }}</p>

    <div v-for="row in rows" :key="row.shotId" class="spp-row">
      <div class="spp-row-head">
        <span class="spp-shot">{{ row.shotId }}</span>
        <span class="spp-time">{{
          t('graph.semanticPrompt.timeRange', { start: fmt(row.startSec), end: fmt(row.endSec) })
        }}</span>
        <span class="spp-chip" :class="{ 'spp-chip-on': row.hasFirstFrame }">
          {{
            row.hasFirstFrame
              ? t('graph.semanticPrompt.firstFrame')
              : t('graph.semanticPrompt.noFirstFrame')
          }}
        </span>
        <span v-if="row.modelAuthored" class="spp-chip">
          {{ t('graph.semanticPrompt.modelAuthored') }}
        </span>
        <span v-if="row.overridden" class="spp-chip spp-chip-override">
          {{ t('graph.semanticPrompt.overridden') }}
        </span>
        <button
          v-if="row.overridden"
          type="button"
          class="spp-restore"
          :title="t('graph.semanticPrompt.restoreHint')"
          @click="restore(row.shotId)"
        >
          {{ t('graph.semanticPrompt.restore') }}
        </button>
      </div>
      <textarea
        class="spp-prompt"
        :value="row.prompt"
        rows="3"
        spellcheck="false"
        :placeholder="t('graph.semanticPrompt.promptPlaceholder')"
        @change="commit(row.shotId, ($event.target as HTMLTextAreaElement).value)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { VideoPromptPlan } from '@shared/semanticTimeline'
import { useStudioI18n } from '../composables/useStudioI18n'
import {
  promptOverrideRows,
  removePromptOverride,
  setPromptOverride
} from '../features/graph/model/promptOverrides'

/**
 * 逐镜提示词面板（放在 dive 右栏，不放 inspector）。
 *
 * 设计要点：
 * 1. 一行一镜（shotId / 起止秒 / 有没有首帧），提示词**就地改**；
 * 2. 改动写回**编译节点参数** `promptOverridesJson`（节点仍是唯一事实来源），
 *    所以面板只 emit，不自己存状态；
 * 3. 清空文本 = 撤销这条覆盖（回到规则/模型拼装结果），不是写一条空提示词；
 * 4. 顶上一句「改动要重跑编译节点才生效」—— 参数与已跑出来的结果不是一回事，
 *    不说清楚用户会以为改完就生效。
 */
const props = defineProps<{
  plan: VideoPromptPlan | null
  overridesJson: string
  loading?: boolean
  error?: string
  /** 没有计划时的原因（已翻译），由调用方给出（它知道是没时间线还是没镜头证据） */
  emptyHint?: string
}>()

const emit = defineEmits<{ 'update:overridesJson': [value: string] }>()

const { t } = useStudioI18n()

const rows = computed(() => promptOverrideRows(props.plan, props.overridesJson))
const emptyHint = computed(() => props.emptyHint || t('graph.semanticPrompt.empty'))

function fmt(sec: number): string {
  return Number.isFinite(sec) ? sec.toFixed(2) : '0.00'
}

function commit(shotId: string, value: string): void {
  emit('update:overridesJson', setPromptOverride(props.overridesJson, shotId, value))
}

function restore(shotId: string): void {
  emit('update:overridesJson', removePromptOverride(props.overridesJson, shotId))
}
</script>

<style scoped>
.spp {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
}
.spp-err {
  margin: 0;
  color: #f88;
  font-size: 12px;
}
.spp-hint {
  margin: 0;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.5;
}
.spp-rerun {
  color: var(--text);
  padding: 4px 6px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}
.spp-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-panel);
}
.spp-row-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.spp-shot {
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  color: var(--text-muted);
}
.spp-time {
  font-size: 11px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}
.spp-chip {
  padding: 0 6px;
  border-radius: 999px;
  background: var(--bg-elevated);
  color: var(--text-muted);
  font-size: 11px;
}
.spp-chip-on {
  background: color-mix(in srgb, var(--accent) 18%, transparent);
}
.spp-chip-override {
  background: color-mix(in srgb, #e0a458 22%, var(--bg-elevated));
}
.spp-restore {
  margin-left: auto;
  padding: 1px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
  cursor: pointer;
}
.spp-restore:hover {
  color: var(--text);
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
}
.spp-prompt {
  width: 100%;
  font-size: 12px;
  line-height: 1.5;
  resize: vertical;
}
</style>
