<template>
  <div v-if="node" class="node-inspector">
    <div class="head">
      <span class="type">{{ typeLabel }}</span>
      <h2>{{ displayTitle }}</h2>
    </div>
    <p class="hint">
      {{ t('graph.inspector.decisions.hint') }}
    </p>

    <GraphNodeRunControl
      v-if="hasInPort"
      :status="runStatus"
      :is-running="isGraphRunning"
      :blocked="blocked"
      @toggle="toggleRun"
    />

    <label>
      {{ t('graph.inspector.displayName') }}
      <input v-model="localTitle" @change="persistTitle" />
    </label>

    <section class="gen-config">
      <div class="field-block">
        <span class="field-label">{{ t('graph.inspector.decisions.questions') }}</span>
        <DecisionQuestionsEditor
          :model-value="questions"
          :host-id="hostId"
          :node-id="node.id"
          :model-id="currentModelId"
          @update:model-value="questions = $event"
          @change="persistQuestions"
        />
      </div>

      <div class="thresholds">
        <label>
          {{ t('graph.inspector.decisions.noulThreshold') }}
          <input
            v-model.number="noulThreshold"
            type="number"
            min="0"
            max="1"
            step="0.05"
            @change="persistThresholds"
          />
        </label>
        <label>
          {{ t('graph.inspector.decisions.choiceConfidence') }}
          <input
            v-model.number="choiceConfidence"
            type="number"
            min="0"
            max="1"
            step="0.05"
            @change="persistThresholds"
          />
        </label>
        <label>
          {{ t('graph.inspector.decisions.scoreMin') }}
          <input v-model.number="scoreMin" type="number" step="0.5" @change="persistThresholds" />
        </label>
      </div>

      <label>
        {{ t('graph.inspector.decisions.model') }}
        <InstructionModelSelect
          v-model="selectedModelKey"
          :options="modelOptions"
          :title="t('graph.inspector.decisions.model')"
          :empty-label="t('graph.inspector.decisions.noModel')"
          @change="persistModel"
        />
      </label>
      <p v-if="modelOptions.length === 0" class="hint hint-warn">
        {{ emptyHint }}
      </p>
    </section>

    <section v-if="verdicts.length" class="verdicts">
      <h3>{{ t('graph.inspector.decisions.lastVerdicts') }}</h3>
      <ul>
        <li v-for="verdict in verdicts" :key="verdict.question">
          <div class="verdict-head">
            <span class="q">{{ verdict.question }}</span>
            <span class="v" :class="{ 'v-warn': !verdictPassed(verdict) }">{{
              verdictText(verdict)
            }}</span>
          </div>
          <!--
            概率条：决策模型的价值就在分布，纯数字看不出「差多少」。
            选中项 / 「是」用强调色，其余灰；宽度即概率。
          -->
          <div v-if="bars(verdict).length" class="bars">
            <div v-for="bar in bars(verdict)" :key="bar.label" class="bar-row">
              <span class="bar-label" :title="bar.label">{{ bar.label }}</span>
              <span class="bar-track">
                <span
                  class="bar-fill"
                  :class="{ 'bar-fill-on': bar.selected }"
                  :style="{ width: `${bar.percent}%` }"
                />
              </span>
              <span class="bar-value">{{ bar.percent }}%</span>
            </div>
          </div>
        </li>
      </ul>
      <p v-if="modelUsed" class="hint">
        {{ t('graph.inspector.decisions.servedBy', { model: modelUsed }) }}
      </p>
    </section>

    <GraphNodeOutputPreview v-if="node && hostId" :node="node" :host-id="hostId" />
  </div>
  <div v-else class="node-inspector empty">
    {{ t('graph.inspector.node.empty') }}
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { DecisionVerdict } from '@shared/modelProvider'
import type { GraphNodeParams } from '@shared/graph'
import DecisionQuestionsEditor from './DecisionQuestionsEditor.vue'
import GraphNodeRunControl from './GraphNodeRunControl.vue'
import GraphNodeOutputPreview from './GraphNodeOutputPreview.vue'
import InstructionModelSelect from './InstructionModelSelect.vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useGraphNodeRun } from '../composables/useGraphNodeRun'
import { useEditorKernel } from '../editor/kernel'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'
import { resolveGraphNodeDisplayTitle } from '../features/graph/model/graphNodeDisplayTitle'
import {
  invalidateGenerateModelSettingsCache,
  loadGenerateModelOptions,
  parseModelKey,
  preferredModelKey,
  type EmptyModelOptionsReason,
  type GenerateModelOption
} from '../features/graph/model/generateModelOptions'
import { useProjectStore } from '../stores/project'

const { t, graphTypeLabel } = useStudioI18n()
const editor = useEditorKernel()
const project = useProjectStore()

const node = computed(() => {
  void graphEditorHosts.revision.value
  const selection = editor.selection.current.value
  const id = selection.kind === 'graph.node' ? selection.id : null
  if (!id) return null
  const current = graphEditorHosts.getNode(selection.hostId, id)
  if (current?.typeId !== 'decisions.judge') return null
  return current
})

const hostId = computed(() => {
  const selection = editor.selection.current.value
  return selection.kind === 'graph.node' ? (selection.hostId ?? '') : ''
})

const { hasInPort, runStatus, isGraphRunning, blocked, toggleRun } = useGraphNodeRun(node)

const typeLabel = computed(() => graphTypeLabel('decisions.judge'))

const displayTitle = computed(() => {
  const current = node.value
  if (!current) return typeLabel.value
  return resolveGraphNodeDisplayTitle(current, { scope: undefined, t, graphTypeLabel })
})

const localTitle = ref('')
const questions = ref('')
const noulThreshold = ref<number | undefined>(undefined)
const choiceConfidence = ref<number | undefined>(undefined)
const scoreMin = ref<number | undefined>(undefined)
const modelOptions = ref<GenerateModelOption[]>([])
const selectedModelKey = ref('')
const loadedNodeId = ref<string | null>(null)
const loadedHostId = ref<string | null>(null)

const verdicts = computed<DecisionVerdict[]>(() => node.value?.params.decisionVerdicts ?? [])
const modelUsed = computed(() => node.value?.params.decisionModelUsed ?? '')
const emptyReason = ref<EmptyModelOptionsReason | null>(null)

/** 表单预览里展示的模型 id：优先节点已保存的选择，其次当前下拉值 */
const currentModelId = computed(
  () =>
    node.value?.params.generateModel?.trim() || parseModelKey(selectedModelKey.value)?.model || ''
)

/** 列表为空时说明成因（未添加提供商 / 提供商被停用 / 缺 Key / 该模态没勾模型） */
const emptyHint = computed(() => {
  const reason = emptyReason.value
  if (!reason || reason === 'unknown') {
    return t('graph.inspector.decisions.modelHint')
  }
  return t(`graph.inspector.decisions.modelEmpty.${reason}`)
})

/** 结论摘要：noul 是/否 + 概率、choice 选中项 + 置信度、score 位置 */
function verdictText(verdict: DecisionVerdict): string {
  if (verdict.type === 'noul') {
    const label = verdict.verdict
      ? t('graph.inspector.decisions.yes')
      : t('graph.inspector.decisions.no')
    return `${label} · ${verdict.probability.toFixed(2)}`
  }
  if (verdict.type === 'choice') {
    return `${verdict.choice} · ${verdict.confidence.toFixed(2)}`
  }
  const legend = verdict.legend?.[String(Math.round(verdict.score))]
  return legend ? `${verdict.score.toFixed(2)} · ${legend}` : verdict.score.toFixed(2)
}

/** 该结论是否「通过」阈值，用于把没过的结果标黄 */
function verdictPassed(verdict: DecisionVerdict): boolean {
  if (verdict.type === 'noul') return verdict.verdict
  if (verdict.type === 'choice') return verdict.confident
  return verdict.aboveThreshold
}

interface VerdictBar {
  label: string
  percent: number
  selected: boolean
}

/**
 * 结论 → 概率条数据。
 * - choice：每个选项一条，选中项高亮
 * - score：每个档位一条（key 是档位序号），最近档位高亮；没有 probabilities 时退回位置刻度
 * - noul：是 / 否两条，按概率拆分
 */
function bars(verdict: DecisionVerdict): VerdictBar[] {
  const toPercent = (value: number): number => Math.round(Math.max(0, Math.min(1, value)) * 100)
  if (verdict.type === 'noul') {
    const yes = toPercent(verdict.probability)
    return [
      { label: t('graph.inspector.decisions.yes'), percent: yes, selected: verdict.verdict },
      { label: t('graph.inspector.decisions.no'), percent: 100 - yes, selected: !verdict.verdict }
    ]
  }
  if (verdict.type === 'choice') {
    const entries = Object.entries(verdict.probabilities ?? {})
    if (!entries.length) return []
    return entries.map(([label, value]) => ({
      label,
      percent: toPercent(value),
      selected: label === verdict.choice
    }))
  }
  const entries = Object.entries(verdict.probabilities ?? {})
  if (!entries.length) return []
  const chosen = String(Math.round(verdict.score))
  return entries.map(([index, value]) => ({
    label: verdict.legend?.[index] ?? index,
    percent: toPercent(value),
    selected: index === chosen
  }))
}

async function loadModels(preferredKey?: string): Promise<void> {
  // 选择节点时重读设置：15s 短缓存可能还停在上次「提供商停用 / 没勾模型」的快照上，
  // 那样会一直显示「请先在设置里拉取」，而其实已经配好了
  invalidateGenerateModelSettingsCache()
  const {
    options,
    selectedKey,
    emptyReason: reason
  } = await loadGenerateModelOptions('decisions', preferredKey, selectedModelKey.value)
  modelOptions.value = options
  selectedModelKey.value = selectedKey
  emptyReason.value = reason
}

function loadNode(current: NonNullable<typeof node.value>): void {
  loadedNodeId.value = current.id
  loadedHostId.value = hostId.value
  questions.value = current.params.decisionQuestions ?? ''
  noulThreshold.value = current.params.decisionNoulYesThreshold
  choiceConfidence.value = current.params.decisionChoiceMinConfidence
  scoreMin.value = current.params.decisionScoreMin
  void loadModels(
    preferredModelKey(current.params.generateProviderInstanceId, current.params.generateModel)
  )
}

watch(
  node,
  (current) => {
    if (!current) {
      localTitle.value = ''
      questions.value = ''
      modelOptions.value = []
      selectedModelKey.value = ''
      loadedNodeId.value = null
      loadedHostId.value = null
      return
    }
    localTitle.value = current.title ?? typeLabel.value
    if (current.id !== loadedNodeId.value || hostId.value !== loadedHostId.value) loadNode(current)
  },
  { immediate: true }
)

watch(
  () => project.sessionEpoch,
  () => {
    loadedNodeId.value = null
    loadedHostId.value = null
  }
)

function patchParams(params: Partial<GraphNodeParams>): void {
  if (!node.value) return
  const selection = editor.selection.current.value
  graphEditorHosts.updateNode(selection.hostId, node.value.id, params)
}

function persistTitle(): void {
  if (!node.value) return
  const selection = editor.selection.current.value
  graphEditorHosts.updateNode(selection.hostId, node.value.id, {}, localTitle.value.trim())
}

function persistQuestions(): void {
  patchParams({ decisionQuestions: questions.value })
}

function persistThresholds(): void {
  patchParams({
    decisionNoulYesThreshold: noulThreshold.value,
    decisionChoiceMinConfidence: choiceConfidence.value,
    decisionScoreMin: scoreMin.value
  })
}

function persistModel(): void {
  const parsed = parseModelKey(selectedModelKey.value)
  patchParams({
    generateProviderInstanceId: parsed?.providerInstanceId ?? '',
    generateModel: parsed?.model ?? ''
  })
}
</script>

<style scoped>
.node-inspector {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  height: 100%;
  overflow: auto;
}

.node-inspector.empty {
  color: var(--text-muted);
  align-items: center;
  justify-content: center;
}

.head .type {
  font-size: 11px;
  color: var(--text-muted);
}

.head h2 {
  margin: 6px 0 0;
  font-size: 14px;
}

.hint {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.4;
}

/* 列表为空时的成因提示：用告警色，避免被当成普通说明忽略 */
.hint-warn {
  color: #d9a441;
}

label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--text-muted);
}

select,
input,
textarea,
:deep(textarea) {
  font-size: 12px;
}

.gen-config,
.verdicts {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 4px;
  border-top: 1px solid var(--border);
  margin-top: 4px;
}

.field-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.field-label {
  font-size: 12px;
  color: var(--text-muted);
}

.thresholds {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.verdicts h3 {
  margin: 0;
  font-size: 12px;
}

.verdicts ul {
  margin: 0;
  padding-left: 0;
  list-style: none;
  font-size: 12px;
  line-height: 1.6;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.verdict-head {
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.verdicts .q {
  color: var(--text-muted);
}

.v-warn {
  color: #d9a441;
}

.bars {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 3px;
}

.bar-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
}

.bar-label {
  flex: none;
  width: 72px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-muted);
}

.bar-track {
  flex: 1;
  min-width: 0;
  height: 6px;
  border-radius: 3px;
  background: var(--bg-hover);
  overflow: hidden;
}

.bar-fill {
  display: block;
  height: 100%;
  border-radius: 3px;
  background: var(--border);
}

.bar-fill-on {
  background: var(--accent);
}

.bar-value {
  flex: none;
  width: 32px;
  text-align: right;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}
</style>
