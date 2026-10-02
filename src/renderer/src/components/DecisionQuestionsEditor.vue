<template>
  <div class="dq-editor">
    <div class="dq-modes">
      <button type="button" :class="{ active: mode === 'form' }" @click="setMode('form')">
        {{ t('graph.inspector.decisions.editor.formMode') }}
      </button>
      <button type="button" :class="{ active: mode === 'text' }" @click="setMode('text')">
        {{ t('graph.inspector.decisions.editor.textMode') }}
      </button>
      <span v-if="failedLines.length" class="dq-badge dq-badge-error">
        {{ t('graph.inspector.decisions.editor.failedLines', { lines: failedLines.join(', ') }) }}
      </span>
      <span v-else-if="droppedKeys.length" class="dq-badge dq-badge-error">
        {{ t('graph.inspector.decisions.editor.droppedCount', { n: droppedKeys.length }) }}
      </span>
      <span class="dq-spacer" />
    </div>

    <!--
      两个模式共用同一个指令编辑器，因此**共用它工具栏里自带的那个「预览最终提示词」**，
      而不是另造一个预览按钮：
      - 文本模式：它就是输入框本体；
      - 表单模式：只保留工具栏（靠 .dq-form-mode 把输入区收掉），
        但喂给它的内容改成「表单序列化后的 DSL」，所以预览图标点开看到的
        仍是展开 @ 引用后的最终内容，且与文本模式逐字节一致。
      @ 引用条与拖排序也因此在表单模式下同样可用。
      这里刻意不传 presetKind —— 决策判定没有指令预设（「加一条」按钮已起模板作用）。
    -->
    <GraphInstructionMentionEditor
      v-show="mode === 'text'"
      :model-value="text"
      :host-id="hostId"
      :node-id="nodeId"
      :rows="5"
      :placeholder="t('graph.inspector.decisions.editor.questionsPlaceholder')"
      @update:model-value="onTextInput"
      @change="commitText"
    />
    <p v-if="mode === 'text'" class="dq-hint">
      {{ t('graph.inspector.decisions.editor.textHint') }}
    </p>
    <!--
      表单模式：同一份工具栏（预览按钮就在其中），输入区由 CSS 收起。
      用独立的实例而不是复用一个，是因为两个模式的内容来源不同（原文 vs 序列化产物），
      各自持有才不会有同步歧义。
    -->
    <GraphInstructionMentionEditor
      v-show="mode === 'form'"
      class="dq-form-toolbar"
      :model-value="formInstruction"
      :host-id="hostId"
      :node-id="nodeId"
      :rows="1"
      :placeholder="t('graph.inspector.decisions.editor.questionsPlaceholder')"
      @update:model-value="onFormToolbarInput"
    />

    <!-- 表单模式：一格一意，不需要记分隔符 -->
    <template v-if="mode === 'form'">
      <p v-if="!drafts.length" class="dq-hint dq-empty">
        {{ t('graph.inspector.decisions.editor.empty') }}
      </p>

      <article v-for="(draft, index) in drafts" :key="`${index}-${draft.key}`" class="dq-row">
        <header class="dq-row-head">
          <select
            :value="draft.type"
            class="dq-type"
            :aria-label="t('graph.inspector.decisions.editor.type')"
            @change="onTypeChange(index, $event)"
          >
            <option value="noul">{{ t('graph.inspector.decisions.editor.typeNoul') }}</option>
            <option value="choice">{{ t('graph.inspector.decisions.editor.typeChoice') }}</option>
            <option value="score">{{ t('graph.inspector.decisions.editor.typeScore') }}</option>
          </select>
          <input
            :value="draft.key"
            class="dq-key"
            :placeholder="t('graph.inspector.decisions.editor.keyPlaceholder')"
            :aria-label="t('graph.inspector.decisions.editor.key')"
            spellcheck="false"
            @input="onKeyInput(index, $event)"
          />
          <span class="dq-spacer" />
          <button
            type="button"
            class="dq-icon"
            :disabled="index === 0"
            :title="t('graph.inspector.decisions.editor.moveUp')"
            @click="move(index, -1)"
          >
            ↑
          </button>
          <button
            type="button"
            class="dq-icon"
            :disabled="index === drafts.length - 1"
            :title="t('graph.inspector.decisions.editor.moveDown')"
            @click="move(index, 1)"
          >
            ↓
          </button>
          <button
            type="button"
            class="dq-icon dq-danger"
            :title="t('graph.inspector.decisions.editor.remove')"
            @click="remove(index)"
          >
            ×
          </button>
        </header>

        <input
          :value="draft.instructions"
          class="dq-question"
          :placeholder="t('graph.inspector.decisions.editor.questionPlaceholder')"
          :aria-label="t('graph.inspector.decisions.editor.question')"
          @input="onInstructionsInput(index, $event)"
        />

        <!-- noul：是 / 否 两种情形的说明 -->
        <div v-if="draft.type === 'noul'" class="dq-criteria">
          <label class="dq-field">
            <span>{{ t('graph.inspector.decisions.editor.yesWhen') }}</span>
            <input
              :value="draft.yes"
              :placeholder="t('graph.inspector.decisions.editor.yesPlaceholder')"
              @input="onNoulInput(index, 'yes', $event)"
            />
          </label>
          <label class="dq-field">
            <span>{{ t('graph.inspector.decisions.editor.noWhen') }}</span>
            <input
              :value="draft.no"
              :placeholder="t('graph.inspector.decisions.editor.noPlaceholder')"
              @input="onNoulInput(index, 'no', $event)"
            />
          </label>
        </div>

        <!-- choice：选项列表，value 就是结果里的选项名 -->
        <div v-else-if="draft.type === 'choice'" class="dq-items">
          <div v-for="(option, oi) in draft.options" :key="`o-${oi}`" class="dq-item">
            <input
              :value="option.value"
              class="dq-item-key"
              :placeholder="t('graph.inspector.decisions.editor.optionValue')"
              :aria-label="t('graph.inspector.decisions.editor.optionValue')"
              spellcheck="false"
              @input="onOptionInput(index, oi, 'value', $event)"
            />
            <input
              :value="option.description"
              class="dq-item-desc"
              :placeholder="t('graph.inspector.decisions.editor.optionDescription')"
              :aria-label="t('graph.inspector.decisions.editor.optionDescription')"
              @input="onOptionInput(index, oi, 'description', $event)"
            />
            <button
              type="button"
              class="dq-icon dq-danger"
              :title="t('graph.inspector.decisions.editor.remove')"
              @click="removeOption(index, oi)"
            >
              ×
            </button>
          </div>
          <button type="button" class="dq-add" @click="addOption(index)">
            + {{ t('graph.inspector.decisions.editor.addOption') }}
          </button>
        </div>

        <!-- score：有序量表，序号即结果里的档位 -->
        <div v-else class="dq-items">
          <div v-for="(level, li) in draft.levels" :key="`l-${li}`" class="dq-item">
            <span class="dq-index">{{ li + 1 }}</span>
            <input
              :value="level.label"
              class="dq-item-key"
              :placeholder="t('graph.inspector.decisions.editor.levelLabel')"
              :aria-label="t('graph.inspector.decisions.editor.levelLabel')"
              @input="onLevelInput(index, li, 'label', $event)"
            />
            <input
              :value="level.description"
              class="dq-item-desc"
              :placeholder="t('graph.inspector.decisions.editor.levelDescription')"
              :aria-label="t('graph.inspector.decisions.editor.levelDescription')"
              @input="onLevelInput(index, li, 'description', $event)"
            />
            <button
              type="button"
              class="dq-icon dq-danger"
              :title="t('graph.inspector.decisions.editor.remove')"
              @click="removeLevel(index, li)"
            >
              ×
            </button>
          </div>
          <button type="button" class="dq-add" @click="addLevel(index)">
            + {{ t('graph.inspector.decisions.editor.addLevel') }}
          </button>
          <p class="dq-hint">{{ t('graph.inspector.decisions.editor.levelOrderHint') }}</p>
        </div>
      </article>

      <div class="dq-add-row">
        <button type="button" class="dq-add" @click="append('noul')">
          + {{ t('graph.inspector.decisions.editor.addNoul') }}
        </button>
        <button type="button" class="dq-add" @click="append('choice')">
          + {{ t('graph.inspector.decisions.editor.addChoice') }}
        </button>
        <button type="button" class="dq-add" @click="append('score')">
          + {{ t('graph.inspector.decisions.editor.addScore') }}
        </button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import GraphInstructionMentionEditor from './GraphInstructionMentionEditor.vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import {
  buildDecisionRequestPreview,
  createDecisionQuestionDraft,
  parseDecisionQuestionsDetailed,
  stringifyDecisionQuestions,
  withDecisionQuestionType,
  type DecisionQuestionDraft
} from '@shared/decisionQuestionSchema'
import type { DecisionQuestionType } from '@shared/modelProvider'

/**
 * 判定问题编辑器：默认表单，文本为高级视图。
 *
 * 存储格式仍是 `decisionQuestions` 文本（DSL），所以：
 * - 不需要改设置结构 / 迁移老节点；
 * - agent 与高级用户继续直接写文本；
 * - 表单每次改动重写整段文本，产物能被执行路径原样读回。
 *
 * 两个模式共用 `GraphInstructionMentionEditor`，因此**共用它工具栏里自带的那套东西**：
 * `@` 引用条（可拖排序 / 断开连线）、放大、以及「预览最终提示词」。
 * 表单模式只把它的输入区用 CSS 收掉，并把内容换成「表单序列化后的 DSL」，
 * 所以预览看到的仍是展开 `@` 引用后的最终内容，与文本模式一致。
 *
 * 解析失败的行不会静默消失：顶部点名行号，切到「文本」可修。
 */
const props = defineProps<{
  /** DSL 原文（存储格式） */
  modelValue: string
  /** 文本模式要用：@ 引用条 / 预览都依赖宿主与节点 id */
  hostId: string
  nodeId: string
  /** 表单预览里展示的模型 id（可空：未选模型时不展示该字段） */
  modelId?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  change: []
}>()

const { t } = useStudioI18n()

const mode = ref<'form' | 'text'>('form')
const text = ref(props.modelValue)
const failedLines = ref<number[]>([])
const drafts = ref<DecisionQuestionDraft[]>([])

/** 表单里会被执行路径丢掉的问题名（缺问题名 / 缺选项 / 缺档位） */
const droppedKeys = computed(
  () =>
    buildDecisionRequestPreview(drafts.value, {
      model: props.modelId,
      omittedNote: '',
      emptyText: ''
    }).droppedKeys
)

/**
 * 喂给「表单模式那份工具栏」的内容 = 当前表单序列化出的 DSL。
 * 这样工具栏里的预览图标（编辑器自带）点开后，看到的就是展开 @ 引用后的最终内容，
 * 与文本模式逐字节一致 —— 不需要在模式栏另造预览。
 */
const formInstruction = computed(() => stringifyDecisionQuestions(drafts.value))

/** 表单模式只借工具栏（输入区被 CSS 收起），输入事件不回流，避免与表单抢数据 */
function onFormToolbarInput(): void {
  /* 表单模式的内容由表单本身决定，忽略工具栏输入 */
}

/** 文本 → 表单（外部改文本后同步；表单自己写入文本时不回流，避免光标跳动） */
watch(
  () => props.modelValue,
  (next) => {
    if (next === text.value) return
    const result = parseDecisionQuestionsDetailed(next)
    text.value = next
    drafts.value = result.questions
    failedLines.value = result.failedLines
  },
  { immediate: true }
)

/** 文本模式是「直写」通道：交给父级持久化，避免这里再做一层受控同步 */
function emitText(next: string): void {
  text.value = next
  emit('update:modelValue', next)
}

/** 任何表单改动都重写整段文本；解析失败的行会在此处被剔除（已在 UI 上点名过） */
function commitDrafts(next: DecisionQuestionDraft[]): void {
  drafts.value = next
  failedLines.value = []
  emitText(stringifyDecisionQuestions(next))
  emit('change')
}

function setMode(next: 'form' | 'text'): void {
  if (next === 'form') {
    // 从文本切回表单：以文本为准重新解析
    const result = parseDecisionQuestionsDetailed(text.value)
    drafts.value = result.questions
    failedLines.value = result.failedLines
  }
  mode.value = next
}

function onTextInput(value: string): void {
  text.value = value
  emitText(value)
}

function commitText(): void {
  const result = parseDecisionQuestionsDetailed(text.value)
  drafts.value = result.questions
  failedLines.value = result.failedLines
  emitText(text.value)
  emit('change')
}

function append(type: DecisionQuestionType): void {
  commitDrafts([
    ...drafts.value,
    createDecisionQuestionDraft(
      type,
      drafts.value.map((draft) => draft.key)
    )
  ])
}

function remove(index: number): void {
  commitDrafts(drafts.value.filter((_, i) => i !== index))
}

function move(index: number, delta: number): void {
  const target = index + delta
  if (target < 0 || target >= drafts.value.length) return
  const next = [...drafts.value]
  const [item] = next.splice(index, 1)
  next.splice(target, 0, item!)
  commitDrafts(next)
}

function patchDraft(index: number, patch: Partial<DecisionQuestionDraft>): void {
  commitDrafts(drafts.value.map((draft, i) => (i === index ? { ...draft, ...patch } : draft)))
}

function onTypeChange(index: number, event: Event): void {
  const type = (event.target as HTMLSelectElement).value as DecisionQuestionType
  patchDraft(index, withDecisionQuestionType(drafts.value[index]!, type))
}

function onKeyInput(index: number, event: Event): void {
  patchDraft(index, { key: (event.target as HTMLInputElement).value })
}

function onInstructionsInput(index: number, event: Event): void {
  patchDraft(index, { instructions: (event.target as HTMLInputElement).value })
}

function onNoulInput(index: number, side: 'yes' | 'no', event: Event): void {
  patchDraft(index, { [side]: (event.target as HTMLInputElement).value })
}

function onOptionInput(
  index: number,
  optionIndex: number,
  field: 'value' | 'description',
  event: Event
): void {
  const options = drafts.value[index]!.options.map((option, i) =>
    i === optionIndex ? { ...option, [field]: (event.target as HTMLInputElement).value } : option
  )
  patchDraft(index, { options })
}

function addOption(index: number): void {
  patchDraft(index, {
    options: [...drafts.value[index]!.options, { value: '', description: '' }]
  })
}

function removeOption(index: number, optionIndex: number): void {
  patchDraft(index, {
    options: drafts.value[index]!.options.filter((_, i) => i !== optionIndex)
  })
}

function onLevelInput(
  index: number,
  levelIndex: number,
  field: 'label' | 'description',
  event: Event
): void {
  const levels = drafts.value[index]!.levels.map((level, i) =>
    i === levelIndex ? { ...level, [field]: (event.target as HTMLInputElement).value } : level
  )
  patchDraft(index, { levels })
}

function addLevel(index: number): void {
  patchDraft(index, {
    levels: [...drafts.value[index]!.levels, { label: '', description: '' }]
  })
}

function removeLevel(index: number, levelIndex: number): void {
  patchDraft(index, {
    levels: drafts.value[index]!.levels.filter((_, i) => i !== levelIndex)
  })
}
</script>

<style scoped>
.dq-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.dq-modes {
  display: flex;
  align-items: center;
  gap: 4px;
}

.dq-modes .dq-spacer {
  flex: 1;
}

/*
 * 表单模式：只借 GraphInstructionMentionEditor 的工具栏（预览 / @ 引用条 / 放大），
 * 把它的输入区收掉，因为内容由上面的表单负责。
 * 这些类名属于那个组件，需要用 :deep 穿透 scoped。
 */
.dq-form-toolbar :deep(.editor-area) {
  display: none;
}

.dq-modes button {
  padding: 2px 8px;
  font-size: 11px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-input);
  color: var(--text-muted);
  cursor: pointer;
}

.dq-modes button.active {
  border-color: var(--accent);
  color: var(--accent);
}

.dq-badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 6px;
}

.dq-badge-error {
  color: #d9a441;
  border: 1px solid #d9a441;
}

.dq-hint {
  margin: 0;
  font-size: 10px;
  line-height: 1.4;
  color: var(--text-muted);
}

.dq-empty {
  padding: 6px 0;
}

.dq-row {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-input);
}

.dq-row-head {
  display: flex;
  align-items: center;
  gap: 4px;
}

.dq-type {
  flex: none;
  width: 88px;
  font-size: 11px;
}

.dq-key {
  flex: none;
  width: 84px;
  font-size: 11px;
}

.dq-spacer {
  flex: 1;
}

.dq-icon {
  flex: none;
  width: 20px;
  height: 20px;
  padding: 0;
  font-size: 12px;
  line-height: 1;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--bg-elevated);
  color: var(--text-muted);
  cursor: pointer;
}

.dq-icon:disabled {
  opacity: 0.35;
  cursor: default;
}

.dq-danger:hover:not(:disabled) {
  color: #c45c5c;
  border-color: #c45c5c;
}

.dq-question,
.dq-field input,
.dq-item input {
  width: 100%;
  font-size: 11px;
}

.dq-criteria,
.dq-items {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.dq-field {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 10px;
  color: var(--text-muted);
}

.dq-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.dq-item-key {
  flex: none;
  width: 78px;
}

.dq-item-desc {
  flex: 1;
  min-width: 0;
}

.dq-index {
  flex: none;
  width: 14px;
  font-size: 10px;
  text-align: right;
  color: var(--text-muted);
}

.dq-add,
.dq-add-row button {
  align-self: flex-start;
  padding: 2px 8px;
  font-size: 11px;
  border: 1px dashed var(--border);
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.dq-add:hover {
  color: var(--accent);
  border-color: var(--accent);
}

.dq-add-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
</style>
