<template>
  <div class="si-form">
    <label class="si-field">
      <span>{{ t('graph.semanticInspector.beatType') }}</span>
      <select :value="beat.type" @change="commit({ type: inputValue($event) })">
        <option v-for="opt in typeOptions" :key="opt.type" :value="opt.type">
          {{ opt.label }}
        </option>
      </select>
    </label>
    <label class="si-field">
      <span>{{ t('graph.semanticInspector.beatDescription') }}</span>
      <textarea
        :value="beat.description"
        rows="3"
        @change="commit({ description: inputValue($event) })"
      />
    </label>
    <label class="si-field">
      <span>{{ t('graph.semanticInspector.emotionLabel') }}</span>
      <input
        :value="beat.emotion?.label ?? ''"
        @change="commit({ emotionLabel: inputValue($event) })"
      />
    </label>
    <label class="si-field">
      <span>
        {{ t('graph.semanticInspector.emotionIntensity') }}
        <output class="si-value">{{ (beat.emotion?.intensity ?? 0).toFixed(2) }}</output>
      </span>
      <input
        type="range"
        min="0"
        max="1"
        step="0.05"
        :value="beat.emotion?.intensity ?? 0"
        @change="commit({ emotionIntensity: numberValue($event) })"
      />
    </label>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { SemanticEditInput, StoryBeat } from '@shared/semanticTimeline'
import { useStudioI18n } from '../../composables/useStudioI18n'
import { inputValue, numberValue } from './formUtils'

/** 节拍：类型（来自词表）/ 描述 / 情绪；类型与情绪标签会让导演规则改判 */
const props = defineProps<{
  beat: StoryBeat
  /** 当前词表的节拍类型（已本地化） */
  beatTypes: Array<{ type: string; label: string }>
}>()
const emit = defineEmits<{ edit: [input: SemanticEditInput] }>()
const { t } = useStudioI18n()

/** 当前类型不在词表里（市场包换过 / 手写）时也要列出来，否则下拉会显示成别的值 */
const typeOptions = computed(() =>
  props.beatTypes.some((b) => b.type === props.beat.type)
    ? props.beatTypes
    : [{ type: props.beat.type, label: props.beat.type }, ...props.beatTypes]
)

function commit(patch: Record<string, unknown>): void {
  emit('edit', { op: 'beat.update', target: props.beat.id, patch })
}
</script>
