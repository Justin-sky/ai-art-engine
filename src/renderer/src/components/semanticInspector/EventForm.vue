<template>
  <div class="si-form">
    <label class="si-field">
      <span>{{ t('graph.semanticInspector.eventLabel') }}</span>
      <input :value="event.label" @change="commit({ label: inputValue($event) })" />
    </label>
    <label class="si-field">
      <span>{{ t('graph.semanticInspector.eventType') }}</span>
      <select :value="event.type" @change="commit({ type: inputValue($event) })">
        <option v-for="type in SEMANTIC_EVENT_TYPES" :key="type" :value="type">
          {{ t(`graph.semanticInspector.eventType_${type}`) }}
        </option>
      </select>
    </label>
    <label class="si-field">
      <span>{{ t('graph.semanticInspector.eventDescription') }}</span>
      <textarea
        :value="event.description"
        rows="3"
        @change="commit({ description: inputValue($event) })"
      />
    </label>
    <label class="si-field">
      <span>
        {{ t('graph.semanticInspector.importance') }}
        <output class="si-value">{{ event.importance.toFixed(2) }}</output>
      </span>
      <input
        type="range"
        min="0"
        max="1"
        step="0.05"
        :value="event.importance"
        @change="commit({ importance: numberValue($event) })"
      />
    </label>
    <div class="si-row">
      <label class="si-field grow">
        <span>{{ t('graph.semanticInspector.start') }}</span>
        <input
          type="number"
          min="0"
          :max="duration"
          step="0.01"
          :value="fmtSec(event.timeRange.start)"
          @change="commit({ start: numberValue($event) })"
        />
      </label>
      <label class="si-field grow">
        <span>{{ t('graph.semanticInspector.end') }}</span>
        <input
          type="number"
          min="0"
          :max="duration"
          step="0.01"
          :value="fmtSec(event.timeRange.end)"
          @change="commit({ end: numberValue($event) })"
        />
      </label>
    </div>
    <DeleteConfirm
      :label="t('graph.semanticInspector.deleteEvent')"
      :details="deleteDetails"
      :armed="armDelete"
      @confirm="emit('edit', { op: 'event.remove', target: event.id })"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  SEMANTIC_EVENT_TYPES,
  intentsRemovedWithEvent,
  type SemanticEditInput,
  type SemanticEvent,
  type SemanticTimeline
} from '@shared/semanticTimeline'
import { useStudioI18n } from '../../composables/useStudioI18n'
import DeleteConfirm from './DeleteConfirm.vue'
import { fmtSec, inputValue, numberValue } from './formUtils'

/** 事件：标签 / 类型 / 描述 / 重要度 / 起止时间；删除时级联删掉以它为触发的意图 */
const props = defineProps<{
  event: SemanticEvent
  timeline: SemanticTimeline
  armDelete?: number
}>()
const emit = defineEmits<{ edit: [input: SemanticEditInput] }>()
const { t } = useStudioI18n()

const duration = computed(() => props.timeline.source?.duration ?? undefined)

function commit(patch: Record<string, unknown>): void {
  emit('edit', { op: 'event.update', target: props.event.id, patch })
}

const deleteDetails = computed(() => {
  const cascade = intentsRemovedWithEvent(props.timeline, props.event.id)
  return [
    ...(cascade.length
      ? [
          t('graph.semanticInspector.deleteEventCascade', {
            n: cascade.length,
            names: cascade.map((i) => i.goal).join(' / ')
          })
        ]
      : []),
    t('graph.semanticInspector.deleteImpact')
  ]
})
</script>
