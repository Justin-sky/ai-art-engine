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
        <span class="field-label">{{ t('graph.inspector.semantic.understandModel') }}</span>
        <select v-model="enrichModelKey" @change="persistAnalyze">
          <option value="">{{ t('graph.inspector.semantic.modelAuto') }}</option>
          <option v-for="opt in enrichModelOptions" :key="opt.key" :value="opt.key">
            {{ opt.label }}
          </option>
        </select>
        <span class="field-hint">{{ t('graph.inspector.semantic.understandModelHint') }}</span>
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

    <section v-else-if="isSemanticEvent" class="fields">
      <label>
        <span class="field-label">{{ t('graph.inspector.semantic.eventLabel') }}</span>
        <!--
          纯文本框（**不挂 datalist**）：挂了浏览器会在右侧画一个下拉箭头，
          看起来像"选择控件"，而真正的选择已经是下面的多选列表 —— 用户反馈过这个箭头。
        -->
        <input
          v-model="eventLabel"
          type="text"
          :placeholder="t('graph.inspector.semantic.eventLabelPlaceholder')"
          @change="persistTrigger"
        />
        <!-- 多选：勾选写回成逗号分隔（参数仍是单值字段，零迁移） -->
        <div v-if="eventLabelOptions.length" class="event-label-list">
          <span class="field-label">{{ t('graph.inspector.semantic.eventLabelPickMany') }}</span>
          <label
            v-for="label in eventLabelOptions"
            :key="`pick-${label}`"
            class="event-label-item check"
          >
            <input
              type="checkbox"
              :checked="pickedEventLabels.includes(label)"
              @change="toggleEventLabel(label)"
            />
            <span>{{ label }}</span>
          </label>
          <span class="field-hint">
            {{
              t('graph.inspector.semantic.eventLabelPicked', { count: pickedEventLabels.length })
            }}
          </span>
        </div>
        <span v-if="!eventLabelOptions.length" class="field-hint">
          {{ t('graph.inspector.semantic.eventLabelNoOptions') }}
        </span>
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

      <label class="check">
        <input v-model="useLlmForPrompts" type="checkbox" @change="persistCompile" />
        <span>{{ t('graph.inspector.semantic.promptsWithModel') }}</span>
      </label>
      <span class="field-hint">{{ t('graph.inspector.semantic.promptsWithModelHint') }}</span>

      <label>
        <span class="field-label">{{ t('graph.inspector.semantic.promptOverrides') }}</span>
        <textarea
          v-model="promptOverridesJson"
          class="prompt-overrides"
          rows="5"
          spellcheck="false"
          :placeholder="t('graph.inspector.semantic.promptOverridesPlaceholder')"
          @change="persistCompile"
        />
        <span class="field-hint">{{ t('graph.inspector.semantic.promptOverridesHint') }}</span>
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

    <section v-if="isRebuild" class="fields">
      <label>
        <span class="field-label">{{ t('graph.inspector.semantic.rebuildMode') }}</span>
        <select v-model="rebuildMode" @change="persistRebuild">
          <option value="shots">{{ t('graph.inspector.semantic.rebuildModeShots') }}</option>
          <option value="full">{{ t('graph.inspector.semantic.rebuildModeFull') }}</option>
        </select>
        <span class="field-hint">{{ t('graph.inspector.semantic.rebuildModeHint') }}</span>
      </label>

      <label>
        <span class="field-label">{{ t('graph.inspector.semantic.rebuildModel') }}</span>
        <select v-model="rebuildModelKey" @change="persistRebuild">
          <option value="">{{ t('graph.inspector.semantic.modelAuto') }}</option>
          <option v-for="opt in rebuildModelOptions" :key="opt.key" :value="opt.key">
            {{ opt.label }}
          </option>
        </select>
        <span class="field-hint">{{ t('graph.inspector.semantic.rebuildModelHint') }}</span>
      </label>

      <label class="check">
        <input v-model="rebuildExecute" type="checkbox" @change="persistRebuild" />
        <span>{{ t('graph.inspector.semantic.execute') }}</span>
      </label>
      <span class="field-hint">{{ t('graph.inspector.semantic.rebuildExecuteHint') }}</span>

      <label>
        <span class="field-label">{{ t('graph.inspector.semantic.rebuildMaxShots') }}</span>
        <input
          v-model.number="rebuildMaxShots"
          type="number"
          min="1"
          max="60"
          @change="persistRebuild"
        />
        <span class="field-hint">{{ t('graph.inspector.semantic.rebuildMaxShotsHint') }}</span>
      </label>

      <label class="check">
        <input v-model="rebuildKeepAudio" type="checkbox" @change="persistRebuild" />
        <span>{{ t('graph.inspector.semantic.rebuildKeepAudio') }}</span>
      </label>
      <label class="check">
        <input v-model="rebuildBurnSubtitles" type="checkbox" @change="persistRebuild" />
        <span>{{ t('graph.inspector.semantic.rebuildBurnSubtitles') }}</span>
      </label>

      <label>
        <span class="field-label">{{ t('graph.inspector.semantic.rebuildDuration') }}</span>
        <input
          v-model="rebuildDuration"
          type="text"
          :placeholder="t('graph.inspector.semantic.rebuildDurationPlaceholder')"
          @change="persistRebuild"
        />
      </label>
      <label>
        <span class="field-label">{{ t('graph.inspector.semantic.rebuildResolution') }}</span>
        <input
          v-model="rebuildResolution"
          type="text"
          placeholder="1080p"
          @change="persistRebuild"
        />
      </label>
      <label>
        <span class="field-label">{{ t('graph.inspector.semantic.rebuildAspectRatio') }}</span>
        <input
          v-model="rebuildAspectRatio"
          type="text"
          placeholder="9:16"
          @change="persistRebuild"
        />
      </label>

      <p class="field-hint">{{ t('graph.inspector.semantic.rebuildPromptPointer') }}</p>
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

      <!--
        编辑**不在 inspector 里做**：编辑要"看着时间线点目标"，操作台放在双击打开的
        编辑器（dive）右栏「编辑」页签。这里只保留指路 + 只读的计划预览。
      -->
      <p class="field-hint">{{ t('graph.inspector.semantic.editsMovedHint') }}</p>
      <!-- 计划预览：**不构建**就能看到将付出什么代价（读证据 → 本地跑 planInvalidation） -->
      <div v-if="planSummary || planError" class="plan-preview">
        <span class="field-label">{{ t('graph.inspector.semantic.planPreview') }}</span>
        <p v-if="planError" class="edits-issue">
          {{ t('graph.inspector.semantic.planPreviewFailed') }} {{ planError }}
        </p>
        <p v-if="planSummary" class="plan-line">
          <span class="plan-chip">
            {{ t('graph.inspector.semantic.planLevel', { level: planSummary.targetLevel }) }}
          </span>
          <span class="plan-chip">{{
            t('graph.inspector.semantic.planKeep', { count: planSummary.kept })
          }}</span>
          <span class="plan-chip">{{
            t('graph.inspector.semantic.planReplace', { count: planSummary.replaced })
          }}</span>
          <span class="plan-chip">{{
            t('graph.inspector.semantic.planRecompute', { count: planSummary.recompute })
          }}</span>
          <span v-if="planSummary.paidSeconds > 0" class="plan-chip plan-paid">
            {{
              t('graph.inspector.semantic.planPaid', {
                seconds: planSummary.paidSeconds.toFixed(1)
              })
            }}
          </span>
        </p>
        <p v-if="planSummary?.note" class="field-hint">{{ planSummary?.note }}</p>
        <p v-if="planNeedsEvidence" class="field-hint">
          {{ t('graph.inspector.semantic.planNoEvidence') }}
        </p>
      </div>
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
import { useStudioI18n } from '../composables/useStudioI18n'
import { useNodeDisplayTitle } from '../composables/useNodeDisplayTitle'
import { useGraphNodeRun } from '../composables/useGraphNodeRun'
import { useEditorKernel } from '../editor/kernel'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'
import { graphRunHosts } from '../features/graph/model/graphRunHosts'
import { eventLabelChoices } from '../features/graph/model/semanticTimelineView'
import {
  parseEventLabels,
  planInvalidation,
  buildEntityShotIndex,
  normalizeSemanticEdits,
  summarizeInvalidationPlan,
  type PlanSummary,
  type ShotEvidence
} from '@shared/semanticTimeline'

const SEMANTIC_TYPE_IDS = new Set([
  'semantic.analyze',
  'semantic.edit',
  'semantic.variant',
  'semantic.timeline',
  'semantic.event',
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
const isSemanticEvent = computed(() => typeId.value === 'semantic.event')
const isCompile = computed(() => typeId.value === 'semantic.compile')
const isVariant = computed(() => typeId.value === 'semantic.variant')
const isPlan = computed(
  () => typeId.value === 'semantic.edit' || typeId.value === 'semantic.variant'
)
const usesRulePacks = computed(() => isSemanticEvent.value || isCompile.value)
const showTimelineFallback = computed(
  () => isTimelineHost.value || isSemanticEvent.value || isCompile.value || isPlan.value
)

const hintText = computed(() => {
  switch (typeId.value) {
    case 'semantic.analyze':
      return t('graph.inspector.semantic.analyzeHint')
    case 'semantic.timeline':
      return t('graph.inspector.semantic.timelineHint')
    case 'semantic.event':
      return t('graph.inspector.semantic.eventHint')
    case 'semantic.compile':
      return t('graph.inspector.semantic.compileHint')
    case 'semantic.edit':
      return t('graph.inspector.semantic.editHint')
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
  await loadRebuildModels()
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
/** 语义编译：用模型写提示词（与分析的富化同一套开关语义） */
const useLlmForPrompts = ref(false)
/** 语义编译：人工改过的提示词（按 shotId 覆盖规则拼装结果） */
const promptOverridesJson = ref('')
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
  useLlmForPrompts.value = p.semanticLlm === true
  promptOverridesJson.value = typeof p.promptOverridesJson === 'string' ? p.promptOverridesJson : ''
  syncRebuildFromNode()
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

// 计划预览（planShots / loadPlanShots / planPreviewResult / planSummary / planError /
// planNeedsEvidence）依赖 timelineDoc —— 实现放在 timelineDoc 声明之后。

/** 语义重建：模式 / 模型 / 上限 / 音轨字幕 / 时长与画面参数 */
const isRebuild = computed(() => typeId.value === 'semantic.rebuild')
const rebuildModelOptions = ref<GenerateModelOption[]>([])
const rebuildModelKey = ref('')
const rebuildMode = ref<'shots' | 'full'>('shots')
const rebuildExecute = ref(true)
const rebuildMaxShots = ref(12)
const rebuildKeepAudio = ref(true)
const rebuildBurnSubtitles = ref(true)
const rebuildDuration = ref('')
const rebuildResolution = ref('')
const rebuildAspectRatio = ref('')

function syncRebuildFromNode(): void {
  const p = node.value?.params
  rebuildMode.value = p?.rebuildMode === 'full' ? 'full' : 'shots'
  rebuildExecute.value = p?.semanticExecute !== false
  rebuildMaxShots.value = Number(p?.rebuildMaxShots) || 12
  rebuildKeepAudio.value = p?.rebuildKeepAudio !== false
  rebuildBurnSubtitles.value = p?.rebuildBurnSubtitles !== false
  rebuildDuration.value = Number(p?.rebuildDurationSec) ? String(p?.rebuildDurationSec) : ''
  rebuildResolution.value = String(p?.rebuildResolution ?? '')
  rebuildAspectRatio.value = String(p?.rebuildAspectRatio ?? '')
  rebuildModelKey.value = preferredModelKey(p?.generateProviderInstanceId, p?.generateModel)
}

function persistRebuild(): void {
  const parsed = parseModelKey(rebuildModelKey.value)
  patch({
    rebuildMode: rebuildMode.value,
    semanticExecute: rebuildExecute.value,
    rebuildMaxShots: Math.max(1, Number(rebuildMaxShots.value) || 12),
    rebuildKeepAudio: rebuildKeepAudio.value,
    rebuildBurnSubtitles: rebuildBurnSubtitles.value,
    rebuildDurationSec: Number(rebuildDuration.value) || 0,
    rebuildResolution: rebuildResolution.value.trim(),
    rebuildAspectRatio: rebuildAspectRatio.value.trim(),
    generateModel: parsed?.model ?? '',
    generateProviderInstanceId: parsed?.providerInstanceId ?? ''
  })
}

async function loadRebuildModels(): Promise<void> {
  try {
    const loaded = await loadGenerateModelOptions('video')
    rebuildModelOptions.value = loaded.options
  } catch {
    rebuildModelOptions.value = []
  }
}

function persistTrigger(): void {
  patch({ eventLabel: eventLabel.value.trim() })
}

/** 已勾选的事件标签（输入框里的值按逗号拆开；手填的 id/type 也在这里保留） */
const pickedEventLabels = computed(() => parseEventLabels(eventLabel.value))

/** 勾选/取消一个标签：重写成逗号分隔并落盘（多值走同一字段，向后兼容） */
function toggleEventLabel(label: string): void {
  const picked = pickedEventLabels.value
  const next = picked.includes(label) ? picked.filter((l) => l !== label) : [...picked, label]
  eventLabel.value = next.join(', ')
  persistTrigger()
}

function persistCompile(): void {
  patch({
    sourceRelativePath: sourceRelativePath.value.trim(),
    semanticLlm: useLlmForPrompts.value,
    promptOverridesJson: promptOverridesJson.value
  })
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

/**
 * 上游时间线文档（原始 JSON 文本）。
 *
 * 触发节点自己的输出**不是时间线文档**（`{eventLabel, events, commands}`），
 * 所以「事件标签过滤」的候选项必须能往上游找；否则下拉永远是空的 —— 用户看到的就是
 * 一个没法选的输入框。这里按入边逐个尝试：上游的运行输出 → 上游的 `timelineJson`
 * → 上游的 `semanticTimelineId` 读盘。
 */
const upstreamTimelineJson = ref('')

async function loadUpstreamTimeline(): Promise<void> {
  upstreamTimelineJson.value = ''
  const host = hostId.value
  const current = node.value
  if (!host || !current) return
  for (const edge of graphEditorHosts.listIncomingEdges(host, current.id)) {
    const source = graphEditorHosts.getNode(host, edge.sourceNodeId)
    if (!source) continue
    const out = graphRunHosts.get(host)?.runStates?.[source.id]?.outputs?.out
    const outText = out && (out.kind === 'text' || out.kind === 'semanticTimeline') ? out.text : ''
    if (outText.trim()) {
      upstreamTimelineJson.value = outText
      return
    }
    const own = String(source.params?.timelineJson ?? '').trim()
    if (own) {
      upstreamTimelineJson.value = own
      return
    }
    const stlId = String(source.params?.semanticTimelineId ?? '').trim()
    if (stlId.startsWith('stl.')) {
      try {
        const text = await window.studio.readProjectFile(`Semantic/${stlId}/timeline.json`)
        if (text?.trim()) {
          upstreamTimelineJson.value = text
          return
        }
      } catch {
        /* 读不到就继续找其它入边 */
      }
    }
  }
}

watch(
  [() => node.value?.id, hostId, () => node.value?.params?.timelineJson],
  () => {
    void loadUpstreamTimeline()
  },
  { immediate: true }
)

/** 时间线文档：本节点 JSON / 本节点输出 / 上游（三者取第一个能解析成文档的） */
const timelineDoc = computed((): SemanticTimeline | null => {
  for (const raw of [timelineJson.value, runOutText.value, upstreamTimelineJson.value]) {
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

const eventLabelOptions = computed(() => eventLabelChoices(timelineDoc.value))

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

// ── 以下实现都依赖 timelineDoc，必须放在它的声明之后（否则 TDZ，整个检查器不渲染） ──

/**
 * 失效计划的**本地预览**：读一次镜头证据，纯函数算计划 —— 不进构建、不花钱。
 *
 * 目的：修复节点以前只有点运行才知道"要重做几个镜头、要不要付费重生成"。
 */
const planShots = ref<ShotEvidence[] | null>(null)

async function loadPlanShots(): Promise<void> {
  planShots.value = null
  const id = timelineDoc.value?.id?.trim()
  if (!id?.startsWith('stl.')) return
  try {
    const evidence = await window.studio.semanticLoadEvidence(id)
    planShots.value = evidence?.shots ?? []
  } catch {
    planShots.value = null
  }
}

watch(
  [() => timelineDoc.value?.id, () => node.value?.typeId],
  () => {
    void loadPlanShots()
  },
  { immediate: true }
)

/**
 * 计划预览：**任何异常都不能让面板变空白**。
 *
 * Vue 的 computed 一旦抛错，整个组件就不渲染 —— 表现就是"检查器一片空白"（实测踩到：
 * 字段不全的时间线文档让 `buildEntityShotIndex` / `planInvalidation` 抛
 * `undefined is not iterable`）。所以这里一手包住，并把错误**显示出来**而不是吞掉。
 */
const planPreviewResult = computed<{ plan: PlanSummary | null; error: string }>(() => {
  if (!isPlan.value) return { plan: null, error: '' }
  const timeline = timelineDoc.value
  if (!timeline) return { plan: null, error: '' }
  try {
    const edits = normalizeSemanticEdits(editsJson.value, 'user').edits
    return {
      plan: summarizeInvalidationPlan(
        planInvalidation({
          timeline,
          shots: planShots.value ?? [],
          edits,
          entityShotIndex: buildEntityShotIndex(timeline)
        })
      ),
      error: ''
    }
  } catch (e) {
    return { plan: null, error: e instanceof Error ? e.message : String(e) }
  }
})

const planSummary = computed(() => planPreviewResult.value.plan)
const planError = computed(() => planPreviewResult.value.error)
/** 读不到镜头证据时要说清楚（否则"直拷 0 镜"会误导） */
const planNeedsEvidence = computed(
  () => isPlan.value && !!timelineDoc.value && (planShots.value?.length ?? 0) === 0
)
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

/* 编辑摘要：计数 + 类型标签 + 会被丢弃的条目 + 插入示例 */
.edits-summary {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-elevated);
}
.edits-kinds {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0;
  font-size: 12px;
}
.edits-kind {
  padding: 1px 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  color: var(--text-muted);
  font-size: 11px;
}
.edits-issue {
  margin: 0;
  color: var(--text-warn, #e0a458);
  font-size: 12px;
}
.edits-sample {
  align-self: flex-start;
  padding: 3px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-panel);
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
}
.edits-sample:hover {
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
}

/* 计划预览：不进构建就能看到代价 */
.plan-preview {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 8px;
  border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border));
  border-radius: 6px;
  background: color-mix(in srgb, var(--accent) 7%, var(--bg-elevated));
}
.plan-line {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0;
  font-size: 12px;
}
.plan-chip {
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--bg-panel);
  color: var(--text-muted);
  font-size: 11px;
}
.plan-chip.plan-paid {
  background: color-mix(in srgb, #e0a458 22%, var(--bg-panel));
}

/* 结构化编辑：一行一项（kind 选择 + 该类型的字段） */
.edits-struct {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.edits-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-panel);
}
.edits-row-kind {
  flex: 0 0 auto;
  font-size: 12px;
}
.edits-row input,
.edits-row select {
  min-width: 0;
  flex: 1 1 120px;
  font-size: 12px;
}
.edits-row-remove {
  flex: 0 0 auto;
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
  cursor: pointer;
}
.edits-row-remove:hover {
  color: var(--text);
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
}
.edits-row-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

/* 事件标签多选：紧凑两列，长标签省略 */
.event-label-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 2px 10px;
  margin-top: 6px;
}
.event-label-list > .field-label,
.event-label-list > .field-hint {
  grid-column: 1 / -1;
}
/*
 * 复选框与标签**同一行**。必须带 `.fields` 前缀提高权重 ——
 * 上面的 `.fields label { flex-direction: column }`（0,1,1）会压过 `.event-label-item`（0,1,0），
 * 结果复选框和文字被排成上下两行（用户反馈）。
 */
.fields .event-label-item {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  min-width: 0;
}
.fields .event-label-item > input {
  flex: 0 0 auto;
  margin: 0;
}
.fields .event-label-item > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
