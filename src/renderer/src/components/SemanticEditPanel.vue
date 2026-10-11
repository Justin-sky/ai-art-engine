<template>
  <div class="sep">
    <!-- ① 从"当前选中的时间线对象"直接添加操作（不用去 JSON 里抄 id） -->
    <div v-if="selection" class="sep-target">
      <span class="sep-chip">{{ selectionKindLabel }}</span>
      <span class="sep-target-name" :title="selection.id">{{ selection.label }}</span>
    </div>
    <div class="sep-actions">
      <button
        v-for="op in availableOps"
        :key="op.kind"
        type="button"
        class="sep-op"
        :title="op.hint"
        @click="addOp(op.kind)"
      >
        {{ op.label }}
      </button>
      <span v-if="!availableOps.length" class="sep-hint">{{
        t('graph.semanticEdit.selectTargetHint')
      }}</span>
    </div>

    <!-- ② 编辑列表：一行一项，写回节点参数 -->
    <h4 class="sep-title">
      {{ t('graph.semanticEdit.edits') }}
      <span v-if="drafts.length" class="sep-count">{{ drafts.length }}</span>
    </h4>
    <p v-if="!drafts.length" class="sep-hint">{{ t('graph.semanticEdit.empty') }}</p>
    <div v-for="(draft, index) in drafts" :key="`d-${index}`" class="sep-row">
      <span class="sep-kind">{{ draftKind(draft) }}</span>
      <select
        class="sep-input"
        :value="draftKind(draft)"
        @change="setField(index, 'kind', ($event.target as HTMLSelectElement).value)"
      >
        <option v-for="kind in kinds" :key="kind" :value="kind">{{ kind }}</option>
      </select>
      <!-- 目标：按类型给可选项（真实 id 来自时间线） -->
      <select
        v-if="targetField(draft) === 'beatId'"
        class="sep-input"
        :value="String(draft.beatId ?? '')"
        @change="setField(index, 'beatId', ($event.target as HTMLSelectElement).value)"
      >
        <option value="">{{ t('graph.semanticEdit.pickBeat') }}</option>
        <option v-for="beat in beatOptions" :key="beat.id" :value="beat.id">
          {{ beat.title }}
        </option>
      </select>
      <select
        v-else-if="targetField(draft) === 'entityId'"
        class="sep-input"
        :value="String(draft.entityId ?? '')"
        @change="setField(index, 'entityId', ($event.target as HTMLSelectElement).value)"
      >
        <option value="">{{ t('graph.semanticEdit.pickEntity') }}</option>
        <option v-for="entity in entityOptions" :key="entity.id" :value="entity.id">
          {{ entity.name }}
        </option>
      </select>
      <input
        v-else-if="targetField(draft) === 'newText'"
        class="sep-input"
        :value="String(draft.newText ?? '')"
        type="text"
        :placeholder="t('graph.semanticEdit.newText')"
        @change="setField(index, 'newText', ($event.target as HTMLInputElement).value)"
      />
      <input
        v-if="draftKind(draft) === 'replaceEntity'"
        class="sep-input"
        :value="String(draft.newAssetId ?? '')"
        type="text"
        :placeholder="t('graph.semanticEdit.newAsset')"
        @change="setField(index, 'newAssetId', ($event.target as HTMLInputElement).value)"
      />
      <button type="button" class="sep-remove" @click="remove(index)">
        {{ t('graph.semanticEdit.remove') }}
      </button>
    </div>
    <p v-for="issue in issues" :key="issue" class="sep-issue">
      {{ t('graph.semanticEdit.dropped') }} {{ issue }}
    </p>

    <!-- ③ 高级：原始 JSON（agent / 生成类编辑的入口） -->
    <details class="sep-advanced">
      <summary>{{ t('graph.semanticEdit.rawJson') }}</summary>
      <textarea
        class="sep-json"
        :value="editsJson"
        rows="8"
        spellcheck="false"
        @change="commitRaw(($event.target as HTMLTextAreaElement).value)"
      />
      <p class="sep-hint">{{ t('graph.semanticEdit.rawJsonHint') }}</p>
    </details>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  addEditDraft,
  readEditDrafts,
  removeEditDraft,
  summarizeSemanticEdits,
  updateEditDraft,
  STRUCTURED_EDIT_KINDS,
  type SemanticTimeline
} from '@shared/semanticTimeline'
import { useStudioI18n } from '../composables/useStudioI18n'

/**
 * 语义编辑的操作面板（放在 **dive** 里，不放 inspector）。
 *
 * 设计要点：
 * 1. **从当前选中的时间线对象出发**：在时间线上点中节拍 / 实体 / 事件后，
 *    这里只列出"对这种对象有意义"的操作，目标 id 自动填好 —— 不必去 JSON 里抄 id；
 * 2. 编辑列表就是节点参数的编辑列表：每一行的改动**立即写回节点**（`update:editsJson`），
 *    所以运行/构建仍然走画布上的节点，dive 只是"编辑台"；
 * 3. 表单只改它认识的字段，其余字段原样保留（agent / 手写的生成类编辑不会被吃掉）；
 * 4. 原始 JSON 收在「高级」里，给生成类编辑与 agent 产物留入口。
 */
const props = defineProps<{
  timeline: SemanticTimeline
  editsJson: string
  /** 时间线上当前选中的对象（决定"可用操作"与自动填的 id） */
  selection?: { kind: 'beat' | 'entity' | 'event' | 'intent'; id: string; label: string } | null
}>()

const emit = defineEmits<{ 'update:editsJson': [value: string] }>()

const { t } = useStudioI18n()

const kinds = STRUCTURED_EDIT_KINDS
const drafts = computed(() => readEditDrafts(props.editsJson))
const issues = computed(() => summarizeSemanticEdits(props.editsJson).issues)

function draftKind(draft: Record<string, unknown>): string {
  return typeof draft.kind === 'string' ? draft.kind : 'grade'
}

/** 该行要选的目标字段（由 kind 决定） */
function targetField(draft: Record<string, unknown>): string {
  const kind = draftKind(draft)
  if (kind === 'dropBeat' || kind === 'reorderBeats' || kind === 'retimeBeat') return 'beatId'
  if (kind === 'replaceEntity' || kind === 'removeEntity') return 'entityId'
  if (kind === 'editText' || kind === 'rewriteUtterance') return 'newText'
  return ''
}

const beatOptions = computed(() =>
  (props.timeline.beats ?? []).map((beat) => ({
    id: beat.id,
    title: beat.description?.trim() || beat.type || beat.id
  }))
)
const entityOptions = computed(() =>
  (props.timeline.entities ?? []).map((entity) => ({ id: entity.id, name: entity.name }))
)

const selectionKindLabel = computed(() => {
  const kind = props.selection?.kind
  if (!kind) return ''
  return t(`graph.semanticEdit.target.${kind}`)
})

/** 当前选择支持哪些操作（这就是"从时间线添加操作"的入口） */
const OPERATIONS = {
  beat: [
    { kind: 'dropBeat', labelKey: 'opDropBeat', hintKey: 'opDropBeatHint' },
    { kind: 'retimeBeat', labelKey: 'opRetimeBeat', hintKey: 'opRetimeBeatHint' },
    { kind: 'reorderBeats', labelKey: 'opReorderBeats', hintKey: 'opReorderBeatsHint' }
  ],
  entity: [
    { kind: 'replaceEntity', labelKey: 'opReplaceEntity', hintKey: 'opReplaceEntityHint' },
    { kind: 'removeEntity', labelKey: 'opRemoveEntity', hintKey: 'opRemoveEntityHint' }
  ],
  event: [{ kind: 'grade', labelKey: 'opGrade', hintKey: 'opGradeHint' }],
  intent: [{ kind: 'grade', labelKey: 'opGrade', hintKey: 'opGradeHint' }]
} as const

const availableOps = computed(() => {
  const kind = props.selection?.kind
  const list = kind ? OPERATIONS[kind] : []
  return list.map((op) => ({
    kind: op.kind,
    label: t(`graph.semanticEdit.${op.labelKey}`),
    hint: t(`graph.semanticEdit.${op.hintKey}`)
  }))
})

function commit(value: string): void {
  emit('update:editsJson', value)
}

/** 按当前选择补好目标 id，再追加一行 */
function addOp(kind: string): void {
  const sel = props.selection
  const patch: Record<string, unknown> = { kind }
  if (kind === 'dropBeat' || kind === 'reorderBeats' || kind === 'retimeBeat') {
    patch.beatId = sel?.kind === 'beat' ? sel.id : (beatOptions.value[0]?.id ?? '')
  }
  if (kind === 'replaceEntity' || kind === 'removeEntity') {
    patch.entityId = sel?.kind === 'entity' ? sel.id : (entityOptions.value[0]?.id ?? '')
  }
  if (kind === 'replaceEntity') patch.newAssetId = ''
  if (kind === 'editText') {
    patch.regionId = ''
    patch.newText = ''
  }
  if (kind === 'grade') patch.params = { brightness: 1.05 }
  commit(addEditDraft(props.editsJson, patch))
}

function setField(index: number, key: string, value: string): void {
  commit(updateEditDraft(props.editsJson, index, { [key]: value }))
}

function remove(index: number): void {
  commit(removeEditDraft(props.editsJson, index))
}

function commitRaw(value: string): void {
  commit(value)
}
</script>

<style scoped>
.sep {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
}
.sep-target {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.sep-chip {
  flex: 0 0 auto;
  padding: 1px 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 18%, transparent);
  color: var(--text-muted);
  font-size: 11px;
}
.sep-target-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}
.sep-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.sep-op {
  padding: 3px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-panel);
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
}
.sep-op:hover {
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
}
.sep-title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 4px 0 0;
  font-size: 12px;
}
.sep-count {
  padding: 0 6px;
  border-radius: 999px;
  background: var(--bg-panel);
  color: var(--text-muted);
  font-size: 11px;
}
.sep-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-panel);
}
.sep-kind {
  flex: 0 0 auto;
  color: var(--text-muted);
  font-size: 11px;
}
.sep-input {
  min-width: 0;
  flex: 1 1 110px;
  font-size: 12px;
}
.sep-remove {
  flex: 0 0 auto;
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
  cursor: pointer;
}
.sep-hint,
.sep-issue {
  margin: 0;
  color: var(--text-muted);
  font-size: 12px;
}
.sep-issue {
  color: var(--text-warn, #e0a458);
}
.sep-advanced summary {
  cursor: pointer;
  color: var(--text-muted);
  font-size: 12px;
}
.sep-json {
  width: 100%;
  margin-top: 4px;
  font-family: var(--font-mono, monospace);
  font-size: 11px;
}
</style>
