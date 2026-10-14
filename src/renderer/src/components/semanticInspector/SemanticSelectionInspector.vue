<template>
  <section class="si" :aria-label="kindLabel">
    <header class="si-head">
      <span class="si-kind" :class="`kind-${selection.kind}`">{{ kindLabel }}</span>
      <strong class="si-title" :title="title">{{ title }}</strong>
      <button
        v-if="span"
        type="button"
        class="si-time"
        :title="t('graph.semanticInspector.seekTo')"
        @click="emit('seek', span.start)"
      >
        {{ fmtSec(span.start) }}–{{ fmtSec(span.end) }}s
      </button>
    </header>

    <ShotForm
      v-if="selection.kind === 'shot'"
      :key="selection.item.id"
      :shot="selection.item"
      :prompt="promptByShot?.[selection.item.id]"
      @edit="forward"
    />
    <DialogueForm
      v-else-if="selection.kind === 'dialogue'"
      :key="selection.item.id"
      :line="selection.item"
      @edit="forward"
    />
    <EventForm
      v-else-if="selection.kind === 'event'"
      :key="selection.item.id"
      :event="selection.item"
      :timeline="timeline"
      :arm-delete="armDelete"
      @edit="forward"
    />
    <BeatForm
      v-else-if="selection.kind === 'beat'"
      :key="selection.item.id"
      :beat="selection.item"
      :beat-types="beatTypes"
      @edit="forward"
    />
    <IntentForm
      v-else-if="selection.kind === 'intent'"
      :key="selection.item.id"
      :intent="selection.item"
      :timeline="timeline"
      :arm-delete="armDelete"
      @edit="forward"
    />
    <EntityForm
      v-else
      :key="selection.item.id"
      :entity="selection.item"
      :timeline="timeline"
      :appearance="selection.appearance"
      :candidates="referenceCandidates ?? []"
      @edit="forward"
    />

    <section v-if="selection.kind !== 'dialogue'" class="si-impact">
      <h5>{{ t('graph.semanticInspector.impactTitle') }}</h5>
      <p v-if="!impact.length" class="si-note">{{ t('graph.semanticInspector.impactNone') }}</p>
      <ul v-else class="si-chips">
        <li v-for="shot in impact" :key="shot.shotId">
          <button
            type="button"
            class="si-chip"
            :class="shot.status"
            :title="t(`graph.semanticInspector.status_${shot.status}`)"
            @click="emit('selectShot', shot.shotId)"
          >
            {{ shot.label }}
            <span class="si-chip-status">{{
              t(`graph.semanticInspector.status_${shot.status}`)
            }}</span>
          </button>
        </li>
      </ul>
      <p class="si-note">{{ t('graph.semanticInspector.impactHint') }}</p>
    </section>
    <p v-else-if="dialogueDirty" class="si-note on">{{ t('graph.semanticEdit.willRedub') }}</p>

    <details v-if="$slots.evidence" class="si-evidence">
      <summary>{{ t('graph.semanticTimeline.evidence') }}</summary>
      <slot name="evidence" />
    </details>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  diffAgainstBaseline,
  type SemanticEditInput,
  type SemanticTimeline
} from '@shared/semanticTimeline'
import { useStudioI18n } from '../../composables/useStudioI18n'
import {
  selectionImpact,
  selectionSpan,
  shotLabel,
  type ResolvedSelection
} from '../../features/graph/model/semanticSelection'
import type { ReferenceCandidate } from '../../features/graph/model/semanticReferenceCandidates'
import BeatForm from './BeatForm.vue'
import DialogueForm from './DialogueForm.vue'
import EntityForm from './EntityForm.vue'
import EventForm from './EventForm.vue'
import IntentForm from './IntentForm.vue'
import ShotForm from './ShotForm.vue'
import { fmtSec } from './formUtils'

/**
 * 语义 dive 的右侧检查器：轨道上选中什么，这里就编辑什么。
 *
 * 只负责**分发与呈现**：各表单 emit `SemanticEditInput`，这里原样上抛，
 * 由 dive 视图应用（`applySemanticEdit`）并落盘 —— 文档仍是唯一事实来源。
 */
const props = defineProps<{
  timeline: SemanticTimeline
  selection: ResolvedSelection
  promptByShot?: Record<string, string>
  beatTypes: Array<{ type: string; label: string }>
  /** 递增即请求删除确认（Delete 快捷键） */
  armDelete?: number
  /** 节拍类型 → 显示名（与轨道同一口径） */
  beatLabel: (type: string) => string
  /** 实体替换的参考图候选（只来自分析节点「参考图」端口的上游） */
  referenceCandidates?: ReferenceCandidate[]
}>()
const emit = defineEmits<{
  edit: [input: SemanticEditInput]
  seek: [sec: number]
  selectShot: [shotId: string]
}>()
const { t } = useStudioI18n()

const kindLabel = computed(() => t(`graph.semanticInspector.kind_${props.selection.kind}`))

const title = computed(() => {
  const s = props.selection
  switch (s.kind) {
    case 'shot':
      return shotLabel(props.timeline, s.item.id)
    case 'dialogue':
      return s.item.text
    case 'event':
      return s.item.label
    case 'beat':
      return props.beatLabel(s.item.type)
    case 'intent':
      return s.item.goal
    case 'entity':
      return s.item.name
  }
  return ''
})

const span = computed(() => selectionSpan(props.timeline, props.selection))
const impact = computed(() => selectionImpact(props.timeline, props.selection))
const dialogueDirty = computed(
  () =>
    props.selection.kind === 'dialogue' &&
    diffAgainstBaseline(props.timeline).dirtyDialogue.has(props.selection.item.id)
)

function forward(input: SemanticEditInput): void {
  emit('edit', input)
}
</script>

<style>
/*
 * 检查器与各表单共用的样式（不加 scoped：表单是子组件，scoped 选择器够不到它们的根以下）。
 * 全部挂在 `.si` 下，不外溢到其它界面。
 */
.si {
  display: flex;
  flex-direction: column;
  gap: 10px;
  font-size: 13px;
}
.si-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.si-kind {
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 11px;
  color: #fff;
  background: var(--text-muted);
}
.si-kind.kind-shot {
  background: #457b9d;
}
.si-kind.kind-dialogue {
  background: #b5838d;
}
.si-kind.kind-beat {
  background: #5b6cff;
}
.si-kind.kind-entity {
  background: #2a9d8f;
}
.si-kind.kind-intent {
  background: #e76f51;
}
.si-kind.kind-event {
  background: #9b5de5;
}
.si-title {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.si-time {
  padding: 1px 8px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg-elevated);
  color: var(--text-muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
}
.si-time:hover {
  color: var(--text);
}
.si-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.si-row {
  display: flex;
  align-items: flex-end;
  gap: 6px;
}
.si-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}
.si-field {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  font-size: 12px;
  color: var(--text-muted);
}
.si-field.grow {
  flex: 1 1 auto;
}
.si-field input:not([type='range']),
.si-field textarea,
.si-field select {
  min-width: 0;
  padding: 4px 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-input, var(--bg-panel));
  color: var(--text);
  font: inherit;
  font-size: 13px;
}
.si-field textarea {
  resize: vertical;
}
.si-field input:disabled,
.si-field textarea:disabled {
  opacity: 0.6;
}
.si-value {
  margin-left: 6px;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.si-fieldset {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 6px 8px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
}
.si-fieldset legend {
  padding: 0 4px;
  font-size: 12px;
  color: var(--text-muted);
}
/* 进画面的手法行：左侧一道强调色，和"只有画面轨会重生成"的说明呼应 */
.si-fieldset .si-row.picture {
  box-shadow: inset 2px 0 0 var(--accent);
  padding-left: 6px;
}
/* 只给读屏用的标签（手法行空间紧，视觉上靠列表头说明） */
.si-sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
.si-meta {
  display: flex;
  gap: 12px;
  font-size: 12px;
  color: var(--text-muted);
}
.si-note {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-muted);
}
.si-note.on {
  color: var(--text);
}
.si-prompt {
  margin: 0;
  padding: 6px 8px;
  border-radius: 6px;
  background: var(--bg-elevated);
  font-size: 12px;
  line-height: 1.5;
  word-break: break-word;
}
.si-prompt-label {
  margin-right: 6px;
  color: var(--text-muted);
  font-size: 11px;
}
.si-actions {
  display: flex;
  justify-content: flex-end;
}
.si-confirm {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
  padding: 8px;
  border: 1px solid color-mix(in srgb, #e0a458 55%, var(--border));
  border-radius: 6px;
  background: color-mix(in srgb, #e0a458 10%, transparent);
}
.si-confirm-row {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}
.si-btn {
  padding: 3px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
}
.si-btn.danger {
  border-color: color-mix(in srgb, #e5484d 55%, var(--border));
  color: #e5484d;
}
.si-btn:hover {
  background: var(--bg-elevated);
}
.si-icon-btn {
  flex: 0 0 auto;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
}
.si-icon-btn:hover {
  color: var(--text);
}
.si-link {
  align-self: flex-start;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  text-decoration: underline;
  cursor: pointer;
}
.si-link:hover {
  color: var(--text);
}
.si-impact h5 {
  margin: 0 0 6px;
  font-size: 12px;
}
.si-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0 0 6px;
  padding: 0;
  list-style: none;
}
.si-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg-elevated);
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
}
.si-chip-status {
  color: var(--text-muted);
  font-size: 11px;
}
.si-chip.regenerate {
  border-color: color-mix(in srgb, var(--accent) 60%, var(--border));
  background: color-mix(in srgb, var(--accent) 16%, var(--bg-elevated));
}
.si-chip.removed {
  opacity: 0.6;
  text-decoration: line-through;
}
/* 参考图标签（@n + 缩略图 + 名字） */
.si-ref {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 220px;
  padding: 2px 8px 2px 2px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg-elevated);
  color: var(--text);
  font-size: 12px;
}
button.si-ref {
  cursor: pointer;
}
.si-ref img {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  object-fit: cover;
}
.si-ref-index {
  padding: 0 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 22%, transparent);
  font-variant-numeric: tabular-nums;
}
.si-ref-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.si-candidates {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
/* 关键帧点选 */
.si-picker {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.si-picker-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.si-picker-clear {
  margin-left: auto;
}
.si-picker-stage {
  position: relative;
  width: 100%;
  max-height: 420px;
  overflow: hidden;
  border-radius: 6px;
  background: var(--bg-elevated);
  cursor: crosshair;
  touch-action: none;
  user-select: none;
}
.si-picker-stage.busy {
  cursor: progress;
}
.si-picker-stage img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  pointer-events: none;
}
/* 已选目标：用掩码本身做遮罩，把强调色只铺在目标上 */
.si-picker-mask {
  position: absolute;
  inset: 0;
  background: color-mix(in srgb, var(--accent) 55%, transparent);
  mask-size: 100% 100%;
  -webkit-mask-size: 100% 100%;
  mask-mode: luminance;
  pointer-events: none;
}
.si-picker-drag {
  position: absolute;
  border: 2px dashed var(--accent);
  background: color-mix(in srgb, var(--accent) 15%, transparent);
  pointer-events: none;
}
.si-picker-stage:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.si-evidence summary {
  font-size: 12px;
  color: var(--text-muted);
  cursor: pointer;
}
.si-field input:focus-visible,
.si-field textarea:focus-visible,
.si-field select:focus-visible,
.si-btn:focus-visible,
.si-icon-btn:focus-visible,
.si-chip:focus-visible,
.si-time:focus-visible,
.si-link:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
</style>
