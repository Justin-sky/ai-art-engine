<template>
  <div v-if="node" class="node-inspector">
    <div class="head">
      <span class="type">{{ typeLabel }}</span>
      <h2>{{ displayTitle }}</h2>
    </div>
    <p class="hint">{{ hintText }}</p>

    <GraphNodeRunControl
      v-if="hasInPort"
      :status="runStatus"
      :is-running="isGraphRunning"
      :blocked="blocked"
      @toggle="toggleRun"
    />

    <GraphNodeOutputPreview v-if="node && hostId" :node="node" :host-id="hostId" />

    <label>
      {{ t('graph.inspector.displayName') }}
      <input v-model="localTitle" @change="persistTitle" />
    </label>

    <section v-if="isAnalyze" class="fields">
      <label>
        <span class="field-label">{{ t('graph.inspector.semantic.vocabulary') }}</span>
        <select v-model="vocabulary" @change="persistAnalyze">
          <option v-for="v in vocabularyOptions" :key="v.id" :value="v.id">
            {{ v.title }}
          </option>
        </select>
        <span class="field-hint">{{ t('graph.inspector.semantic.vocabularyHint') }}</span>
      </label>

      <div class="checks">
        <label class="check">
          <input v-model="transcribe" type="checkbox" @change="persistAnalyze" />
          <span>{{ t('graph.inspector.semantic.transcribe') }}</span>
        </label>
        <label class="check">
          <input v-model="separateAudio" type="checkbox" @change="persistAnalyze" />
          <span>{{ t('graph.inspector.semantic.separateAudio') }}</span>
        </label>
        <label class="check">
          <input v-model="detectEntities" type="checkbox" @change="persistAnalyze" />
          <span>{{ t('graph.inspector.semantic.detectEntities') }}</span>
        </label>
        <label class="check">
          <input v-model="useLlm" type="checkbox" @change="persistAnalyze" />
          <span>{{ t('graph.inspector.semantic.llm') }}</span>
        </label>
        <span class="field-hint">{{ t('graph.inspector.semantic.llmHint') }}</span>
      </div>

      <label>
        <span class="field-label">{{ t('graph.inspector.semantic.enrichModel') }}</span>
        <InstructionModelSelect
          v-model="enrichModelKey"
          :options="enrichModelOptions"
          :title="t('graph.inspector.semantic.enrichModel')"
          :empty-label="t('graph.inspector.semantic.modelAuto')"
          @change="persistAnalyze"
        />
        <span class="field-hint">{{ t('graph.inspector.semantic.enrichModelHint') }}</span>
      </label>

      <label>
        <span class="field-label">{{ t('graph.inspector.semantic.transcribeInstance') }}</span>
        <select v-model="transcribeInstanceId" @change="persistAnalyze">
          <option value="">{{ t('graph.inspector.semantic.modelAuto') }}</option>
          <option v-for="p in providerInstances" :key="p.id" :value="p.id">
            {{ p.label || p.providerKind }}
          </option>
        </select>
        <span class="field-hint">{{ t('graph.inspector.semantic.transcribeInstanceHint') }}</span>
      </label>

      <label>
        <span class="field-label">{{ t('graph.inspector.semantic.sourceAssetId') }}</span>
        <input
          v-model="sourceAssetId"
          type="text"
          :placeholder="t('graph.inspector.semantic.sourceAssetIdPlaceholder')"
          @change="persistAnalyze"
        />
        <span class="field-hint">{{ t('graph.inspector.semantic.sourceAssetIdHint') }}</span>
      </label>

      <details class="advanced">
        <summary>{{ t('graph.inspector.semantic.fallbackParams') }}</summary>
        <p class="field-hint">{{ t('graph.inspector.semantic.fallbackParamsHint') }}</p>
        <div class="row">
          <label>
            <span class="field-label">{{ t('graph.inspector.semantic.fps') }}</span>
            <input
              v-model.number="semanticFps"
              type="number"
              min="1"
              max="120"
              step="1"
              @change="persistAnalyze"
            />
          </label>
          <label>
            <span class="field-label">{{ t('graph.inspector.semantic.duration') }}</span>
            <input
              v-model.number="semanticDuration"
              type="number"
              min="0.1"
              max="3600"
              step="0.1"
              @change="persistAnalyze"
            />
          </label>
        </div>
        <label>
          <span class="field-label">{{ t('graph.inspector.semantic.shotsJson') }}</span>
          <ExpandableTextarea
            :key="`shots-${node.id}`"
            v-model="shotsJson"
            :title="t('graph.inspector.semantic.shotsJson')"
            :rows="4"
            :placeholder="t('graph.inspector.semantic.jsonPlaceholder')"
            @change="persistAnalyze"
          />
        </label>
        <label>
          <span class="field-label">{{ t('graph.inspector.semantic.utterancesJson') }}</span>
          <ExpandableTextarea
            :key="`utt-${node.id}`"
            v-model="utterancesJson"
            :title="t('graph.inspector.semantic.utterancesJson')"
            :rows="4"
            :placeholder="t('graph.inspector.semantic.jsonPlaceholder')"
            @change="persistAnalyze"
          />
        </label>
      </details>
    </section>

    <section v-else-if="isTrigger" class="fields">
      <label>
        <span class="field-label">{{ t('graph.inspector.semantic.eventLabel') }}</span>
        <input
          v-model="eventLabel"
          type="text"
          list="semantic-event-labels"
          :placeholder="t('graph.inspector.semantic.eventLabelPlaceholder')"
          @change="persistTrigger"
        />
        <datalist id="semantic-event-labels">
          <option v-for="label in eventLabelOptions" :key="label" :value="label" />
        </datalist>
        <span class="field-hint">{{ t('graph.inspector.semantic.eventLabelHint') }}</span>
      </label>
    </section>

    <section v-else-if="isCompile" class="fields">
      <label>
        <span class="field-label">{{ t('graph.inspector.semantic.sourceRelativePath') }}</span>
        <input
          v-model="sourceRelativePath"
          type="text"
          :placeholder="t('graph.inspector.semantic.sourceRelativePathPlaceholder')"
          @change="persistCompile"
        />
        <span class="field-hint">{{ t('graph.inspector.semantic.sourceRelativePathHint') }}</span>
      </label>
    </section>

    <section v-if="usesRulePacks" class="fields">
      <div class="checks">
        <span class="field-label">{{ t('graph.inspector.semantic.rulePacks') }}</span>
        <label v-for="pack in rulePackOptions" :key="pack.id" class="check">
          <input
            type="checkbox"
            :checked="selectedRulePacks.includes(pack.id)"
            @change="toggleRulePack(pack.id)"
          />
          <span>{{ pack.title }}</span>
        </label>
        <span class="field-hint">{{ t('graph.inspector.semantic.rulePacksHint') }}</span>
      </div>
    </section>

    <section v-if="isPlan" class="fields">
      <template v-if="isVariant">
        <label>
          <span class="field-label">{{ t('graph.inspector.semantic.recipeId') }}</span>
          <select v-model="recipeId" @change="persistPlan">
            <option value="">{{ t('graph.inspector.semantic.recipeNone') }}</option>
            <option v-for="r in recipeOptions" :key="r.recipe.id" :value="r.recipe.id">
              {{ r.recipe.title }}
            </option>
          </select>
          <span class="field-hint">{{ t('graph.inspector.semantic.recipeIdHint') }}</span>
        </label>
        <label v-for="slot in selectedRecipe?.slots ?? []" :key="slot.key">
          <span class="field-label">{{ slot.label || slot.key }}</span>
          <input
            :value="slotText(slot.key)"
            type="text"
            :placeholder="t('graph.inspector.semantic.slotPlaceholder')"
            @change="updateSlot(slot.key, ($event.target as HTMLInputElement).value)"
          />
        </label>
        <span v-if="selectedRecipe?.slots.length" class="field-hint">
          {{ t('graph.inspector.semantic.slotHint') }}
        </span>
      </template>

      <label class="check">
        <input v-model="execute" type="checkbox" @change="persistPlan" />
        <span>{{ t('graph.inspector.semantic.execute') }}</span>
      </label>
      <span class="field-hint">{{ t('graph.inspector.semantic.executeHint') }}</span>

      <label>
        <span class="field-label">{{ t('graph.inspector.semantic.editsJson') }}</span>
        <ExpandableTextarea
          :key="`edits-${node.id}`"
          v-model="editsJson"
          :title="t('graph.inspector.semantic.editsJson')"
          :rows="5"
          :placeholder="t('graph.inspector.semantic.editsJsonPlaceholder')"
          @change="persistPlan"
        />
        <span class="field-hint">{{ t('graph.inspector.semantic.editsJsonHint') }}</span>
      </label>
      <details class="advanced">
        <summary>{{ t('graph.inspector.semantic.advanced') }}</summary>
        <label>
          <span class="field-label">{{ t('graph.inspector.semantic.sourceRelativePath') }}</span>
          <input
            v-model="sourceRelativePath"
            type="text"
            :placeholder="t('graph.inspector.semantic.sourceRelativePathPlaceholder')"
            @change="persistPlan"
          />
          <span class="field-hint">{{ t('graph.inspector.semantic.sourceRelativePathHint') }}</span>
        </label>
        <label>
          <span class="field-label">{{ t('graph.inspector.semantic.shotsJson') }}</span>
          <ExpandableTextarea
            :key="`plan-shots-${node.id}`"
            v-model="shotsJson"
            :title="t('graph.inspector.semantic.shotsJson')"
            :rows="4"
            :placeholder="t('graph.inspector.semantic.jsonPlaceholder')"
            @change="persistPlan"
          />
        </label>
      </details>
    </section>

    <section v-if="showTimelineFallback" class="fields">
      <details class="advanced" :open="isTimelineHost">
        <summary>{{ t('graph.inspector.semantic.timelineJson') }}</summary>
        <ExpandableTextarea
          :key="`tl-${node.id}`"
          v-model="timelineJson"
          :title="t('graph.inspector.semantic.timelineJson')"
          :rows="6"
          :placeholder="t('graph.inspector.semantic.timelineJsonPlaceholder')"
          @change="persistTimelineJson"
        />
        <span class="field-hint">{{ t('graph.inspector.semantic.timelineJsonHint') }}</span>
      </details>
    </section>

    <dl v-if="timelineSummary" class="meta">
      <div>
        <dt>{{ t('graph.inspector.semantic.summaryId') }}</dt>
        <dd>{{ timelineSummary.id }}</dd>
      </div>
      <div>
        <dt>{{ t('graph.inspector.semantic.summaryEvents') }}</dt>
        <dd>{{ timelineSummary.events }}</dd>
      </div>
      <div>
        <dt>{{ t('graph.inspector.semantic.summaryBeats') }}</dt>
        <dd>{{ timelineSummary.beats }}</dd>
      </div>
      <div>
        <dt>{{ t('graph.inspector.semantic.summaryIntents') }}</dt>
        <dd>{{ timelineSummary.intents }}</dd>
      </div>
    </dl>
  </div>
  <div v-else class="node-inspector empty">
    {{ t('graph.inspector.node.empty') }}
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  loadAllProviders,
  loadGenerateModelOptions,
  parseModelKey,
  preferredModelKey,
  type GenerateModelOption
} from '../features/graph/model/generateModelOptions'
import type { ModelProviderInstance } from '@shared/modelProvider'
import {
  collectRulePacks,
  listRecipes,
  listVocabularies,
  type SemanticPack,
  type SemanticTimeline
} from '@shared/semanticTimeline'
import GraphNodeRunControl from './GraphNodeRunControl.vue'
import GraphNodeOutputPreview from './GraphNodeOutputPreview.vue'
import ExpandableTextarea from './ExpandableTextarea.vue'
import InstructionModelSelect from './InstructionModelSelect.vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useNodeDisplayTitle } from '../composables/useNodeDisplayTitle'
import { useGraphNodeRun } from '../composables/useGraphNodeRun'
import { useEditorKernel } from '../editor/kernel'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'
import { graphRunHosts } from '../features/graph/model/graphRunHosts'

const SEMANTIC_TYPE_IDS = new Set([
  'semantic.analyze',
  'semantic.repair',
  'semantic.variant',
  'semantic.timeline',
  'semantic.trigger',
  'semantic.compile'
])

const { t, graphTypeLabel } = useStudioI18n()
const editor = useEditorKernel()

const node = computed(() => {
  void graphEditorHosts.revision.value
  const selection = editor.selection.current.value
  const id = selection.kind === 'graph.node' ? selection.id : null
  if (!id) return null
  const current = graphEditorHosts.getNode(selection.hostId, id)
  if (!current?.typeId || !SEMANTIC_TYPE_IDS.has(current.typeId)) return null
  return current
})

const hostId = computed(() => {
  const selection = editor.selection.current.value
  return selection.kind === 'graph.node' ? (selection.hostId ?? '') : ''
})

const { hasInPort, runStatus, isGraphRunning, blocked, toggleRun } = useGraphNodeRun(node)

const typeId = computed(() => node.value?.typeId ?? '')
const typeLabel = computed(() => (typeId.value ? graphTypeLabel(typeId.value) : ''))
const displayTitle = useNodeDisplayTitle(node, typeLabel)

const isAnalyze = computed(() => typeId.value === 'semantic.analyze')
const isTimelineHost = computed(() => typeId.value === 'semantic.timeline')
const isTrigger = computed(() => typeId.value === 'semantic.trigger')
const isCompile = computed(() => typeId.value === 'semantic.compile')
const isVariant = computed(() => typeId.value === 'semantic.variant')
const isPlan = computed(
  () => typeId.value === 'semantic.repair' || typeId.value === 'semantic.variant'
)
const usesRulePacks = computed(() => isTrigger.value || isCompile.value)
const showTimelineFallback = computed(
  () => isTimelineHost.value || isTrigger.value || isCompile.value || isPlan.value
)

const hintText = computed(() => {
  switch (typeId.value) {
    case 'semantic.analyze':
      return t('graph.inspector.semantic.analyzeHint')
    case 'semantic.timeline':
      return t('graph.inspector.semantic.timelineHint')
    case 'semantic.trigger':
      return t('graph.inspector.semantic.triggerHint')
    case 'semantic.compile':
      return t('graph.inspector.semantic.compileHint')
    case 'semantic.repair':
      return t('graph.inspector.semantic.repairHint')
    case 'semantic.variant':
      return t('graph.inspector.semantic.variantHint')
    default:
      return ''
  }
})

const packs = ref<SemanticPack[]>([])
/** 富化（文本）模型可选项；转写可选实例清单 */
const enrichModelOptions = ref<GenerateModelOption[]>([])
const providerInstances = ref<ModelProviderInstance[]>([])
onMounted(async () => {
  try {
    packs.value = (await window.studio.semanticListPacks()) ?? []
  } catch {
    packs.value = []
  }
  try {
    const loaded = await loadGenerateModelOptions('text')
    enrichModelOptions.value = loaded.options
  } catch {
    enrichModelOptions.value = []
  }
  try {
    providerInstances.value = await loadAllProviders()
  } catch {
    providerInstances.value = []
  }
})

const vocabularyOptions = computed(() => listVocabularies(packs.value))
const rulePackOptions = computed(() =>
  collectRulePacks(packs.value).map((p) => ({ id: p.id, title: p.title || p.id }))
)
const recipeOptions = computed(() => listRecipes(packs.value))

const localTitle = ref('')
const vocabulary = ref('commerce.v1')
const transcribe = ref(true)
const separateAudio = ref(true)
const detectEntities = ref(true)
const useLlm = ref(false)
const semanticFps = ref(30)
const semanticDuration = ref(60)
const sourceAssetId = ref('')
/**
 * 富化（三步 LLM）用哪个模型：`providerInstanceId::model` 的 key，空 = 应用默认文本模型。
 *
 * 这两个参数以前没在节点上声明，`runSkill` 却一直在读 —— 用户只能吃「设置里第一个合格实例」，
 * 撞上未开通的模型就三步全失败（实测踩过）。这里把选择权交给用户。
 */
const enrichModelKey = ref('')
/** 转写用哪个提供商实例：空 = 首个支持转写的已配置实例（老行为） */
const transcribeInstanceId = ref('')
const shotsJson = ref('')
const utterancesJson = ref('')
const timelineJson = ref('')
const editsJson = ref('[]')
const eventLabel = ref('')
const recipeId = ref('')
const recipeSlots = ref<Record<string, unknown>>({})
const execute = ref(true)
const sourceRelativePath = ref('')
const selectedRulePacks = ref<string[]>([])
const loadedNodeId = ref<string | null>(null)
const loadedHostId = ref<string | null>(null)

const selectedRecipe = computed(
  () => recipeOptions.value.find((r) => r.recipe.id === recipeId.value)?.recipe
)

function parseSlots(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'string' || !raw.trim()) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function loadConfig(current: NonNullable<typeof node.value>): void {
  loadedNodeId.value = current.id
  loadedHostId.value = hostId.value
  const p = current.params
  localTitle.value = current.title ?? ''
  vocabulary.value = p.vocabulary?.trim() || 'commerce.v1'
  transcribe.value = p.semanticTranscribe !== false
  separateAudio.value = p.semanticSeparateAudio !== false
  detectEntities.value = p.semanticDetectEntities !== false
  useLlm.value = p.semanticLlm === true
  semanticFps.value = Number(p.semanticFps) > 0 ? Number(p.semanticFps) : 30
  semanticDuration.value = Number(p.semanticDuration) > 0 ? Number(p.semanticDuration) : 60
  sourceAssetId.value = p.sourceAssetId?.trim() || ''
  enrichModelKey.value = preferredModelKey(p.generateProviderInstanceId, p.generateModel)
  transcribeInstanceId.value = p.transcribeProviderInstanceId?.trim() || ''
  shotsJson.value = typeof p.shotsJson === 'string' ? p.shotsJson : ''
  utterancesJson.value = typeof p.utterancesJson === 'string' ? p.utterancesJson : ''
  timelineJson.value = typeof p.timelineJson === 'string' ? p.timelineJson : ''
  editsJson.value = typeof p.editsJson === 'string' && p.editsJson.trim() ? p.editsJson : '[]'
  eventLabel.value = p.eventLabel?.trim() || ''
  recipeId.value = p.recipeId?.trim() || ''
  recipeSlots.value = parseSlots(p.recipeSlotsJson)
  execute.value = p.semanticExecute !== false
  sourceRelativePath.value = p.sourceRelativePath?.trim() || ''
  selectedRulePacks.value = String(p.rulePackIds || '')
    .split(/[,，\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

watch(
  node,
  (current) => {
    if (!current) {
      loadedNodeId.value = null
      loadedHostId.value = null
      return
    }
    const same = current.id === loadedNodeId.value && hostId.value === loadedHostId.value
    if (!same) loadConfig(current)
  },
  { immediate: true }
)

function patch(params: Record<string, unknown>, title?: string): void {
  if (!node.value) return
  const selection = editor.selection.current.value
  graphEditorHosts.updateNode(
    selection.hostId,
    node.value.id,
    params,
    title !== undefined ? title : undefined
  )
}

function persistTitle(): void {
  patch({}, localTitle.value.trim())
}

function persistAnalyze(): void {
  const enrich = parseModelKey(enrichModelKey.value)
  patch({
    vocabulary: vocabulary.value.trim() || 'commerce.v1',
    semanticTranscribe: transcribe.value,
    semanticSeparateAudio: separateAudio.value,
    semanticDetectEntities: detectEntities.value,
    semanticLlm: useLlm.value,
    semanticFps: Math.max(1, Math.round(Number(semanticFps.value) || 30)),
    semanticDuration: Math.max(0.1, Number(semanticDuration.value) || 60),
    sourceAssetId: sourceAssetId.value.trim(),
    shotsJson: shotsJson.value,
    utterancesJson: utterancesJson.value,
    // 富化模型：key 拆成「实例 + 模型」两个参数（与其它加工节点同一套口径）
    generateModel: enrich?.model ?? '',
    generateProviderInstanceId: enrich?.providerInstanceId ?? '',
    transcribeProviderInstanceId: transcribeInstanceId.value.trim()
  })
}

function persistTrigger(): void {
  patch({ eventLabel: eventLabel.value.trim() })
}

function persistCompile(): void {
  patch({ sourceRelativePath: sourceRelativePath.value.trim() })
}

function toggleRulePack(id: string): void {
  const next = selectedRulePacks.value.includes(id)
    ? selectedRulePacks.value.filter((x) => x !== id)
    : [...selectedRulePacks.value, id]
  selectedRulePacks.value = next
  patch({ rulePackIds: next.join(',') })
}

function slotText(key: string): string {
  const v = recipeSlots.value[key]
  return Array.isArray(v) ? v.join(', ') : v === undefined || v === null ? '' : String(v)
}

/** 逗号分隔多值 → 数组（变体按笛卡尔积展开） */
function updateSlot(key: string, text: string): void {
  const values = text
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean)
  const next = { ...recipeSlots.value }
  if (values.length === 0) delete next[key]
  else next[key] = values.length === 1 ? values[0] : values
  recipeSlots.value = next
  persistPlan()
}

function persistPlan(): void {
  patch({
    editsJson: editsJson.value.trim() || '[]',
    shotsJson: shotsJson.value,
    semanticExecute: execute.value,
    sourceRelativePath: sourceRelativePath.value.trim(),
    ...(isVariant.value
      ? {
          recipeId: recipeId.value.trim(),
          recipeSlotsJson: Object.keys(recipeSlots.value).length
            ? JSON.stringify(recipeSlots.value)
            : ''
        }
      : {})
  })
}

function persistTimelineJson(): void {
  patch({ timelineJson: timelineJson.value })
}

const runOutText = computed(() => {
  if (!node.value) return ''
  const out = graphRunHosts.get(hostId.value)?.runStates?.[node.value.id]?.outputs?.out
  return out && out.kind === 'text' ? out.text : ''
})

/** 上游时间线（本节点 in 端口最近一次收到的值，或本节点自己的输出） */
const timelineDoc = computed((): SemanticTimeline | null => {
  for (const raw of [timelineJson.value, runOutText.value]) {
    const text = raw.trim()
    if (!text) continue
    try {
      const doc = JSON.parse(text) as SemanticTimeline
      if (typeof doc.id === 'string' && doc.source) return doc
    } catch {
      /* ignore */
    }
  }
  return null
})

const eventLabelOptions = computed(() => [
  ...new Set((timelineDoc.value?.events ?? []).map((e) => e.label))
])

const timelineSummary = computed(() => {
  const doc = timelineDoc.value
  if (!doc) return null
  return {
    id: doc.id,
    events: Array.isArray(doc.events) ? doc.events.length : 0,
    beats: Array.isArray(doc.beats) ? doc.beats.length : 0,
    intents: Array.isArray(doc.intents) ? doc.intents.length : 0
  }
})
</script>

<style scoped>
.node-inspector {
  display: flex;
  flex-direction: column;
  gap: 12px;
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
  display: block;
  font-size: 11px;
  color: var(--text-muted);
  margin-bottom: 2px;
}

.head h2 {
  margin: 0;
  font-size: 14px;
}

.hint,
.field-hint {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.4;
}

.fields {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.fields label,
.node-inspector > label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
}

.fields label.check {
  flex-direction: row;
  align-items: center;
  gap: 6px;
}

.checks {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-label {
  color: var(--text-muted);
  font-size: 11px;
}

.row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

input,
select {
  font: inherit;
  font-size: 12px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-elevated);
  color: var(--text);
}

input[type='checkbox'] {
  padding: 0;
}

.advanced {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 10px;
}

.advanced summary {
  cursor: pointer;
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: 8px;
}

.advanced label {
  margin-bottom: 8px;
}

.meta {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
}

.meta div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.meta dt {
  color: var(--text-muted);
}

.meta dd {
  margin: 0;
  font-variant-numeric: tabular-nums;
  word-break: break-all;
}
</style>
