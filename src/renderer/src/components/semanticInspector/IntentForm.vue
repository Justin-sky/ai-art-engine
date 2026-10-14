<template>
  <div class="si-form">
    <label class="si-field">
      <span>{{ t('graph.semanticInspector.intentGoal') }}</span>
      <input :value="intent.goal" @change="commit({ goal: inputValue($event) })" />
    </label>
    <label class="si-field">
      <span>{{ t('graph.semanticInspector.intentTrigger') }}</span>
      <select :value="triggerValue" @change="commit({ trigger: inputValue($event) })">
        <option v-if="!triggerIsEventId" :value="intent.trigger" disabled>
          {{ intent.trigger }}
        </option>
        <option v-for="ev in timeline.events" :key="ev.id" :value="ev.id">
          {{ ev.label }} · {{ fmtSec(ev.timeRange.start) }}–{{ fmtSec(ev.timeRange.end) }}s
        </option>
      </select>
    </label>

    <fieldset class="si-fieldset">
      <legend>{{ t('graph.semanticInspector.intentTechniques') }}</legend>
      <div
        v-for="(row, i) in rows"
        :key="row.key"
        class="si-row"
        :class="{ picture: isPicture(row.track) }"
      >
        <label class="si-field">
          <span class="si-sr">{{ t('graph.semanticInspector.techniqueTrack') }}</span>
          <select :value="row.track" @change="setRow(i, { track: inputValue($event) })">
            <option v-for="track in trackOptions" :key="track" :value="track">
              {{ trackLabel(track) }}
            </option>
          </select>
        </label>
        <label class="si-field grow">
          <span class="si-sr">{{ t('graph.semanticInspector.techniqueAction') }}</span>
          <input
            :value="row.action"
            :placeholder="t('graph.semanticInspector.techniqueAction')"
            @change="setRow(i, { action: inputValue($event) })"
          />
        </label>
        <button
          type="button"
          class="si-icon-btn"
          :title="t('graph.semanticInspector.removeTechnique')"
          :aria-label="t('graph.semanticInspector.removeTechnique')"
          @click="removeRow(i)"
        >
          ×
        </button>
      </div>
      <button type="button" class="si-link" @click="addRow">
        {{ t('graph.semanticInspector.addTechnique') }}
      </button>
      <p class="si-note">{{ t('graph.semanticInspector.pictureTrackHint') }}</p>
    </fieldset>

    <label class="si-field">
      <span>{{ t('graph.semanticInspector.intentReason') }}</span>
      <textarea :value="intent.reason" rows="2" @change="commit({ reason: inputValue($event) })" />
    </label>

    <DeleteConfirm
      :label="t('graph.semanticInspector.deleteIntent')"
      :details="[t('graph.semanticInspector.deleteImpact')]"
      :armed="armDelete"
      @confirm="emit('edit', { op: 'intent.remove', target: intent.id })"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  PICTURE_TRACK_KINDS,
  SEMANTIC_TRACK_KINDS,
  type DirectorIntent,
  type IntentTechnique,
  type SemanticEditInput,
  type SemanticTimeline
} from '@shared/semanticTimeline'
import { useStudioI18n } from '../../composables/useStudioI18n'
import { trackLabelKey } from '../../features/graph/model/semanticTimelineView'
import DeleteConfirm from './DeleteConfirm.vue'
import { fmtSec, inputValue } from './formUtils'

/**
 * 导演意图：目标 / 触发事件 / 手法列表 / 理由。
 *
 * 手法行在本地起草：新加的一行动作还空着时不提交（空动作会被校验拒绝），
 * 填上动作、改轨道、删行时才把**整份**手法列表提交成一次修改。
 */
const props = defineProps<{
  intent: DirectorIntent
  timeline: SemanticTimeline
  armDelete?: number
}>()
const emit = defineEmits<{ edit: [input: SemanticEditInput] }>()
const { t } = useStudioI18n()

/** 轨道下拉：语义轨道 + 规则包里的画面轨（light） */
const trackOptions = [
  ...SEMANTIC_TRACK_KINDS,
  ...PICTURE_TRACK_KINDS.filter((k) => !(SEMANTIC_TRACK_KINDS as readonly string[]).includes(k))
]

function trackLabel(track: string): string {
  const key = trackLabelKey(track)
  return key ? t(`graph.semanticTimeline.${key}`) : track
}

function isPicture(track: string): boolean {
  return PICTURE_TRACK_KINDS.includes(track)
}

const triggerIsEventId = computed(() =>
  props.timeline.events.some((e) => e.id === props.intent.trigger)
)
/** 按 label 触发的旧意图：下拉里选中同名事件（改一次就规范成按 id 触发） */
const triggerValue = computed(() => {
  if (triggerIsEventId.value) return props.intent.trigger
  return (
    props.timeline.events.find((e) => e.label === props.intent.trigger)?.id ?? props.intent.trigger
  )
})

interface Row {
  key: number
  track: string
  action: string
  params?: Record<string, unknown>
}

let seq = 0
const rows = ref<Row[]>([])
watch(
  () => props.intent.techniques,
  (techniques) => {
    rows.value = (techniques ?? []).map((tech) => ({
      key: ++seq,
      track: String(tech.track),
      action: tech.action,
      ...(tech.params ? { params: tech.params } : {})
    }))
  },
  { immediate: true }
)

function commit(patch: Record<string, unknown>): void {
  emit('edit', { op: 'intent.update', target: props.intent.id, patch })
}

function commitRows(): void {
  const techniques: IntentTechnique[] = rows.value
    .filter((row) => row.action.trim())
    .map((row) => ({
      track: row.track as IntentTechnique['track'],
      action: row.action.trim(),
      ...(row.params ? { params: row.params } : {})
    }))
  commit({ techniques })
}

function setRow(index: number, patch: Partial<Row>): void {
  rows.value = rows.value.map((row, i) => (i === index ? { ...row, ...patch } : row))
  if (rows.value[index]?.action.trim()) commitRows()
}

function removeRow(index: number): void {
  const removed = rows.value[index]
  rows.value = rows.value.filter((_, i) => i !== index)
  // 删掉的是还没提交的空行：只改本地草稿
  if (removed?.action.trim()) commitRows()
}

function addRow(): void {
  rows.value = [...rows.value, { key: ++seq, track: 'camera', action: '' }]
}
</script>
