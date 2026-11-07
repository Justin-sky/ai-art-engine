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

    <section v-if="isRebuild" class="fields">
      <label>
        <span class="field-label">{{ t('graph.inspector.semantic.remakeStrategy') }}</span>
        <select v-model="remakeStrategy" @change="persistRebuild">
          <option value="fidelity">
            {{ t('graph.inspector.semantic.remakeStrategyFidelity') }}
          </option>
          <option value="adapt">{{ t('graph.inspector.semantic.remakeStrategyAdapt') }}</option>
          <option value="edit">{{ t('graph.inspector.semantic.remakeStrategyEdit') }}</option>
        </select>
        <span class="field-hint">{{ remakeStrategyHintText }}</span>
      </label>

      <!-- 视频模型 / 画面参数在指令面板里选（双击节点）；这里只显示当前选择 -->
      <div class="readonly-field">
        <span class="field-label">{{ t('graph.inspector.semantic.rebuildModel') }}</span>
        <span class="readonly-value">{{ rebuildModelLabel }}</span>
        <span class="field-hint">{{ t('graph.inspector.semantic.rebuildModelInPanelHint') }}</span>
      </div>

      <dl v-if="remakeLiveEstimate" class="meta estimate-box">
        <div>
          <dt>{{ t('graph.inspector.semantic.remakeEstimateUnits') }}</dt>
          <dd>{{ remakeLiveEstimate.units }} ({{ remakeLiveEstimate.generatedShots }})</dd>
        </div>
        <div v-if="remakeLiveEstimate.localClips > 0">
          <dt>{{ t('graph.inspector.semantic.rebuildReportLocal') }}</dt>
          <dd>{{ remakeLiveEstimate.localClips }}</dd>
        </div>
        <div>
          <dt>{{ t('graph.inspector.semantic.rebuildReportPassthrough') }}</dt>
          <dd>{{ remakeLiveEstimate.passthroughShots }}</dd>
        </div>
        <div v-if="remakeLiveEstimate.dubs > 0">
          <dt>{{ t('graph.inspector.semantic.rebuildReportDubs') }}</dt>
          <dd>{{ remakeLiveEstimate.dubs }}</dd>
        </div>
      </dl>

      <label class="check">
        <input v-model="rebuildGenerateAnchors" type="checkbox" @change="persistRebuild" />
        <span>{{ t('graph.inspector.semantic.rebuildGenerateAnchors') }}</span>
      </label>
      <span class="field-hint">{{ t('graph.inspector.semantic.rebuildGenerateAnchorsHint') }}</span>

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
      <label class="check">
        <input v-model="rebuildCleanOverlays" type="checkbox" @change="persistRebuild" />
        <span>{{ t('graph.inspector.semantic.rebuildCleanOverlays') }}</span>
      </label>
      <label class="check">
        <input v-model="rebuildUseCache" type="checkbox" @change="persistRebuild" />
        <span>{{ t('graph.inspector.semantic.rebuildUseCache') }}</span>
      </label>
      <label class="check">
        <input v-model="rebuildRenderCompare" type="checkbox" @change="persistRebuild" />
        <span>{{ t('graph.inspector.semantic.rebuildRenderCompare') }}</span>
      </label>

      <label class="check">
        <input v-model="rebuildDub" type="checkbox" @change="persistRebuild" />
        <span>{{ t('graph.inspector.semantic.rebuildDub') }}</span>
      </label>
      <span class="field-hint">{{ t('graph.inspector.semantic.rebuildDubHint') }}</span>
      <template v-if="rebuildDub">
        <label>
          <span class="field-label">{{ t('graph.inspector.semantic.rebuildDubModel') }}</span>
          <select v-model="dubModelKey" @change="persistRebuild">
            <option value="">{{ t('graph.inspector.semantic.modelAuto') }}</option>
            <option v-for="opt in dubModelOptions" :key="opt.key" :value="opt.key">
              {{ opt.label }}
            </option>
          </select>
        </label>
        <label>
          <span class="field-label">{{ t('graph.inspector.semantic.rebuildDubVoice') }}</span>
          <input
            v-model="dubVoice"
            type="text"
            :placeholder="t('graph.inspector.semantic.rebuildDubVoicePlaceholder')"
            @change="persistRebuild"
          />
        </label>
        <label class="check">
          <input v-model="rebuildDubClone" type="checkbox" @change="persistRebuild" />
          <span>{{ t('graph.inspector.semantic.rebuildDubClone') }}</span>
        </label>
      </template>

      <label>
        <span class="field-label">{{ t('graph.inspector.semantic.replaceImageModel') }}</span>
        <select v-model="replaceImageModelKey" @change="persistRebuild">
          <option value="">{{ t('graph.inspector.semantic.modelAuto') }}</option>
          <option v-for="opt in imageModelOptions" :key="opt.key" :value="opt.key">
            {{ opt.label }}
          </option>
        </select>
        <span class="field-hint">{{ t('graph.inspector.semantic.replaceImageModelHint') }}</span>
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

      <details class="advanced batch-variants-box">
        <summary>
          {{ t('graph.inspector.semantic.batchVariantsTitle') }}
          <span v-if="parsedBatchVariants.length" class="variant-badge">
            {{
              t('graph.inspector.semantic.batchVariantsCount', { n: parsedBatchVariants.length })
            }}
          </span>
        </summary>
        <p class="field-hint">
          {{ t('graph.inspector.semantic.batchVariantsHint') }}
        </p>
        <div class="variant-preset-bar">
          <button
            v-for="tpl in batchVariantTemplates"
            :key="tpl.id"
            type="button"
            class="variant-preset-btn"
            @click="applyBatchVariantTemplate(tpl.id)"
          >
            + {{ isEn ? tpl.titleEn : tpl.titleZh }}
          </button>
          <button
            v-if="rebuildVariantsJson.trim()"
            type="button"
            class="variant-preset-btn danger"
            @click="clearBatchVariants"
          >
            {{ t('graph.inspector.semantic.batchVariantsClear') }}
          </button>
        </div>
        <ExpandableTextarea
          :key="`variants-${node.id}`"
          v-model="rebuildVariantsJson"
          :title="t('graph.inspector.semantic.batchVariantsJsonTitle')"
          :rows="5"
          :placeholder="t('graph.inspector.semantic.batchVariantsPlaceholder')"
          @change="persistRebuild"
        />
      </details>

      <p class="field-hint">{{ t('graph.inspector.semantic.rebuildPromptPointer') }}</p>

      <div class="rebuild-result">
        <span class="field-label">{{ t('graph.inspector.semantic.rebuildPreview') }}</span>
        <div
          v-if="rebuildCompareRel && !rebuildReport?.variants?.length"
          class="variant-output-tabs"
        >
          <button
            type="button"
            class="variant-tab-btn"
            :class="{ active: activePreviewRel === rebuildOutputRel }"
            :disabled="!rebuildOutputRel"
            @click="selectedVariantRel = ''"
          >
            {{ t('graph.inspector.semantic.rebuildPreviewOutput') }}
          </button>
          <button
            type="button"
            class="variant-tab-btn"
            :class="{ active: activePreviewRel === rebuildCompareRel }"
            @click="selectedVariantRel = rebuildCompareRel"
          >
            {{ t('graph.inspector.semantic.rebuildPreviewCompare') }}
          </button>
        </div>
        <div v-if="rebuildReport?.variants?.length" class="variant-output-tabs">
          <button
            v-for="v in rebuildReport.variants"
            :key="v.id"
            type="button"
            class="variant-tab-btn"
            :class="{ active: activePreviewRel === v.outputRelativePath }"
            :disabled="!v.outputRelativePath"
            @click="selectedVariantRel = v.outputRelativePath || ''"
          >
            {{ v.label || v.id }}
          </button>
        </div>
        <MediaPreviewPlayer v-if="rebuildPreviewUrl" kind="video" :src="rebuildPreviewUrl" />
        <span v-else class="field-hint">{{
          t('graph.inspector.semantic.rebuildPreviewEmpty')
        }}</span>
        <dl v-if="rebuildReport" class="meta">
          <div>
            <dt>{{ t('graph.inspector.semantic.rebuildReportGenerate') }}</dt>
            <dd>{{ rebuildReport.generate }}</dd>
          </div>
          <div v-if="rebuildReport.localRendered > 0">
            <dt>{{ t('graph.inspector.semantic.rebuildReportLocal') }}</dt>
            <dd>{{ rebuildReport.localRendered }}</dd>
          </div>
          <div>
            <dt>{{ t('graph.inspector.semantic.rebuildReportPassthrough') }}</dt>
            <dd>{{ rebuildReport.passthrough }}</dd>
          </div>
          <div>
            <dt>{{ t('graph.inspector.semantic.rebuildReportRemoved') }}</dt>
            <dd>{{ rebuildReport.removed }}</dd>
          </div>
          <div>
            <dt>{{ t('graph.inspector.semantic.rebuildReportDubs') }}</dt>
            <dd>{{ rebuildReport.dubs }}</dd>
          </div>
          <div v-if="rebuildReport.variants.length">
            <dt>{{ t('graph.inspector.semantic.rebuildReportVariants') }}</dt>
            <dd>{{ rebuildReport.variants.length }}</dd>
          </div>
        </dl>
        <details v-if="rebuildReportText" class="advanced">
          <summary>{{ t('graph.inspector.semantic.rebuildReportJson') }}</summary>
          <pre class="report-json">{{ rebuildReportText }}</pre>
        </details>
      </div>
    </section>

    <section v-if="showTimelineFallback" class="fields">
      <details class="advanced">
        <summary>{{ t('graph.inspector.semantic.timelineJson') }}</summary>
        <label>
          <span class="field-label">{{ t('graph.inspector.semantic.sourceRelativePath') }}</span>
          <input
            v-model="sourceRelativePath"
            type="text"
            :placeholder="t('graph.inspector.semantic.sourceRelativePathPlaceholder')"
            @change="persistRebuild"
          />
          <span class="field-hint">{{ t('graph.inspector.semantic.sourceRelativePathHint') }}</span>
        </label>
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
      <div v-if="timelineSummary.verdict">
        <dt>{{ t('graph.inspector.semantic.summaryVerdict') }}</dt>
        <dd>{{ timelineSummary.verdict }}</dd>
      </div>
      <div v-if="timelineSummary.confidencePct != null">
        <dt>{{ t('graph.inspector.semantic.summaryConfidence') }}</dt>
        <dd>{{ timelineSummary.confidencePct }}%</dd>
      </div>
      <div>
        <dt>{{ t('graph.inspector.semantic.summaryShots') }}</dt>
        <dd>{{ timelineSummary.shots }}</dd>
      </div>
      <div>
        <dt>{{ t('graph.inspector.semantic.summaryUnits') }}</dt>
        <dd>{{ timelineSummary.units }} + {{ timelineSummary.localUnits }}</dd>
      </div>
      <div>
        <dt>{{ t('graph.inspector.semantic.summaryEntities') }}</dt>
        <dd>{{ timelineSummary.entities }}</dd>
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
import {
  supportsVisionTextModel,
  visionGroundingScore,
  type ModelProviderInstance
} from '@shared/modelProvider'
import {
  BUILTIN_BATCH_VARIANT_TEMPLATES,
  parseBatchVariantSpecs,
  planRemakeExecution,
  type RemakeStrategy,
  type SemanticTimeline
} from '@shared/semanticTimeline'
import GraphNodeRunControl from './GraphNodeRunControl.vue'
import GraphNodeOutputPreview from './GraphNodeOutputPreview.vue'
import ExpandableTextarea from './ExpandableTextarea.vue'
import MediaPreviewPlayer from './MediaPreviewPlayer.vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useNodeDisplayTitle } from '../composables/useNodeDisplayTitle'
import { useGraphNodeRun } from '../composables/useGraphNodeRun'
import { useEditorKernel } from '../editor/kernel'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'
import { graphRunHosts } from '../features/graph/model/graphRunHosts'

const SEMANTIC_TYPE_IDS = new Set(['semantic.analyze', 'semantic.rebuild'])

const { t, locale, graphTypeLabel } = useStudioI18n()
const isEn = computed(() => locale.value.toLowerCase().startsWith('en'))
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
const isRebuild = computed(() => typeId.value === 'semantic.rebuild')
const showTimelineFallback = computed(() => isRebuild.value)

const hintText = computed(() => {
  switch (typeId.value) {
    case 'semantic.analyze':
      return t('graph.inspector.semantic.analyzeHint')
    case 'semantic.rebuild':
      return t('graph.inspector.semantic.rebuildHint')
    default:
      return ''
  }
})

/** 富化（视觉/文本）模型可选项；转写可选实例清单 */
const enrichModelOptions = ref<GenerateModelOption[]>([])
const providerInstances = ref<ModelProviderInstance[]>([])
onMounted(async () => {
  let providers: ModelProviderInstance[] = []
  try {
    providers = await loadAllProviders()
    providerInstances.value = providers
  } catch {
    providerInstances.value = []
  }
  try {
    const loaded = await loadGenerateModelOptions('text')
    const byId = new Map(providers.map((p) => [p.id, p]))
    const isMultimodal = (opt: GenerateModelOption): number => {
      if (visionGroundingScore(opt.model) > 0) return 1
      const inst = byId.get(opt.providerInstanceId)
      return inst && supportsVisionTextModel(inst, opt.model) ? 1 : 0
    }
    enrichModelOptions.value = [...loaded.options].sort((a, b) => isMultimodal(b) - isMultimodal(a))
  } catch {
    enrichModelOptions.value = []
  }
  await loadRebuildModels()
})

const localTitle = ref('')
const transcribe = ref(true)
const separateAudio = ref(true)
const detectEntities = ref(true)
const useLlm = ref(false)
const semanticFps = ref(30)
const semanticDuration = ref(60)
const sourceAssetId = ref('')
const enrichModelKey = ref('')
const transcribeInstanceId = ref('')
const shotsJson = ref('')
const utterancesJson = ref('')
const timelineJson = ref('')
const sourceRelativePath = ref('')
const loadedNodeId = ref<string | null>(null)
const loadedHostId = ref<string | null>(null)

/**
 * 语义重建状态：必须声明在下面 `watch(..., { immediate: true })` 之前，防止同步回填 TDZ。
 */
const rebuildModelOptions = ref<GenerateModelOption[]>([])
const rebuildModelKey = ref('')
const remakeStrategy = ref<RemakeStrategy>('fidelity')
const rebuildGenerateAnchors = ref(false)
const rebuildExecute = ref(true)
const rebuildMaxShots = ref(24)
const rebuildKeepAudio = ref(true)
const rebuildBurnSubtitles = ref(true)
const rebuildCleanOverlays = ref(true)
const rebuildUseCache = ref(true)
const rebuildRenderCompare = ref(true)
const rebuildDuration = ref('')
const rebuildDub = ref(true)
const rebuildDubClone = ref(true)
const dubModelOptions = ref<GenerateModelOption[]>([])
const dubModelKey = ref('')
const imageModelOptions = ref<GenerateModelOption[]>([])
const replaceImageModelKey = ref('')
const dubVoice = ref('')
const rebuildVariantsJson = ref('')
const selectedVariantRel = ref('')
const batchVariantTemplates = BUILTIN_BATCH_VARIANT_TEMPLATES
const parsedBatchVariants = computed(() => parseBatchVariantSpecs(rebuildVariantsJson.value))

const remakeStrategyHintText = computed(() => {
  switch (remakeStrategy.value) {
    case 'edit':
      return t('graph.inspector.semantic.remakeStrategyEditHint')
    case 'adapt':
      return t('graph.inspector.semantic.remakeStrategyAdaptHint')
    default:
      return t('graph.inspector.semantic.remakeStrategyFidelityHint')
  }
})

function applyBatchVariantTemplate(templateId: string): void {
  const tpl = BUILTIN_BATCH_VARIANT_TEMPLATES.find((t) => t.id === templateId)
  if (!tpl) return
  rebuildVariantsJson.value = JSON.stringify(tpl.specs, null, 2)
  persistRebuild()
}

function clearBatchVariants(): void {
  rebuildVariantsJson.value = ''
  persistRebuild()
}

function loadConfig(current: NonNullable<typeof node.value>): void {
  loadedNodeId.value = current.id
  loadedHostId.value = hostId.value
  const p = current.params
  localTitle.value = current.title ?? ''
  transcribe.value = p.semanticTranscribe !== false
  separateAudio.value = p.semanticSeparateAudio !== false
  detectEntities.value = p.semanticDetectEntities !== false
  useLlm.value = p.semanticLlm !== false
  semanticFps.value = Number(p.semanticFps) > 0 ? Number(p.semanticFps) : 30
  semanticDuration.value = Number(p.semanticDuration) > 0 ? Number(p.semanticDuration) : 60
  sourceAssetId.value = p.sourceAssetId?.trim() || ''
  enrichModelKey.value = preferredModelKey(p.generateProviderInstanceId, p.generateModel)
  transcribeInstanceId.value = p.transcribeProviderInstanceId?.trim() || ''
  shotsJson.value = typeof p.shotsJson === 'string' ? p.shotsJson : ''
  utterancesJson.value = typeof p.utterancesJson === 'string' ? p.utterancesJson : ''
  timelineJson.value = typeof p.timelineJson === 'string' ? p.timelineJson : ''
  sourceRelativePath.value = p.sourceRelativePath?.trim() || ''
  syncRebuildFromNode()
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
    semanticTranscribe: transcribe.value,
    semanticSeparateAudio: separateAudio.value,
    semanticDetectEntities: detectEntities.value,
    semanticLlm: useLlm.value,
    semanticFps: Math.max(1, Math.round(Number(semanticFps.value) || 30)),
    semanticDuration: Math.max(0.1, Number(semanticDuration.value) || 60),
    sourceAssetId: sourceAssetId.value.trim(),
    shotsJson: shotsJson.value,
    utterancesJson: utterancesJson.value,
    generateModel: enrich?.model ?? '',
    generateProviderInstanceId: enrich?.providerInstanceId ?? '',
    transcribeProviderInstanceId: transcribeInstanceId.value.trim()
  })
}

function syncRebuildFromNode(): void {
  const p = node.value?.params
  remakeStrategy.value =
    p?.remakeStrategy === 'edit' || p?.remakeStrategy === 'adapt' ? p.remakeStrategy : 'fidelity'
  rebuildGenerateAnchors.value = p?.rebuildGenerateAnchors === true
  rebuildExecute.value = p?.semanticExecute !== false
  rebuildMaxShots.value = Number(p?.rebuildMaxShots) || 24
  rebuildKeepAudio.value = p?.rebuildKeepAudio !== false
  rebuildBurnSubtitles.value = p?.rebuildBurnSubtitles !== false
  rebuildCleanOverlays.value = p?.rebuildCleanOverlays !== false
  rebuildUseCache.value = p?.rebuildUseCache !== false
  rebuildRenderCompare.value = p?.rebuildRenderCompare !== false
  rebuildDuration.value = Number(p?.rebuildDurationSec) ? String(p?.rebuildDurationSec) : ''
  rebuildModelKey.value = preferredModelKey(p?.generateProviderInstanceId, p?.generateModel)
  rebuildDub.value = p?.rebuildDub !== false
  rebuildDubClone.value = p?.rebuildDubClone !== false
  dubModelKey.value = preferredModelKey(p?.dubProviderInstanceId, p?.dubModel)
  replaceImageModelKey.value = preferredModelKey(
    p?.replaceImageProviderInstanceId,
    p?.replaceImageModel
  )
  dubVoice.value = String(p?.dubVoice ?? '')
  rebuildVariantsJson.value = String(p?.rebuildVariantsJson ?? '')
  selectedVariantRel.value = ''
}

/**
 * 写回重建参数。视频模型 / 分辨率 / 画幅由指令面板写（`generate*`），这里不碰，
 * 免得两处同时写互相覆盖。
 */
function persistRebuild(): void {
  const dub = parseModelKey(dubModelKey.value)
  const replaceImage = parseModelKey(replaceImageModelKey.value)
  patch({
    remakeStrategy: remakeStrategy.value,
    rebuildGenerateAnchors: rebuildGenerateAnchors.value,
    semanticExecute: rebuildExecute.value,
    rebuildMaxShots: Math.max(1, Number(rebuildMaxShots.value) || 24),
    rebuildKeepAudio: rebuildKeepAudio.value,
    rebuildBurnSubtitles: rebuildBurnSubtitles.value,
    rebuildCleanOverlays: rebuildCleanOverlays.value,
    rebuildUseCache: rebuildUseCache.value,
    rebuildRenderCompare: rebuildRenderCompare.value,
    rebuildDurationSec: Number(rebuildDuration.value) || 0,
    rebuildDub: rebuildDub.value,
    rebuildDubClone: rebuildDubClone.value,
    dubModel: dub?.model ?? '',
    dubProviderInstanceId: dub?.providerInstanceId ?? '',
    dubVoice: dubVoice.value.trim(),
    replaceImageModel: replaceImage?.model ?? '',
    replaceImageProviderInstanceId: replaceImage?.providerInstanceId ?? '',
    rebuildVariantsJson: rebuildVariantsJson.value.trim(),
    sourceRelativePath: sourceRelativePath.value.trim()
  })
}

async function loadRebuildModels(): Promise<void> {
  try {
    const loaded = await loadGenerateModelOptions('video')
    rebuildModelOptions.value = loaded.options
  } catch {
    rebuildModelOptions.value = []
  }
  try {
    const loaded = await loadGenerateModelOptions('image')
    imageModelOptions.value = loaded.options
  } catch {
    imageModelOptions.value = []
  }
  try {
    const loaded = await loadGenerateModelOptions('audio')
    dubModelOptions.value = loaded.options
  } catch {
    dubModelOptions.value = []
  }
}

/** 当前视频模型的可读名（未选 = 跟随设置默认） */
const rebuildModelLabel = computed(() => {
  void graphEditorHosts.revision.value
  const key = preferredModelKey(
    node.value?.params?.generateProviderInstanceId,
    node.value?.params?.generateModel
  )
  if (!key) return t('graph.inspector.semantic.modelAuto')
  return rebuildModelOptions.value.find((o) => o.key === key)?.label ?? key
})

const rebuildOutputRel = computed(() => {
  if (!isRebuild.value || !node.value) return ''
  const out = graphRunHosts.get(hostId.value)?.runStates?.[node.value.id]?.outputs?.['out-video']
  if (out && out.kind === 'video' && out.relativePath?.trim()) return out.relativePath.trim()
  return String(node.value.params?.rebuildLastOutput ?? '').trim()
})

const rebuildCompareRel = computed(() => {
  if (!isRebuild.value || !node.value) return ''
  return String(node.value.params?.rebuildLastCompare ?? '').trim()
})

const activePreviewRel = computed(() => selectedVariantRel.value || rebuildOutputRel.value)

const rebuildPreviewUrl = ref('')
watch(
  activePreviewRel,
  async (rel) => {
    rebuildPreviewUrl.value = ''
    if (!rel) return
    try {
      const url = (await window.studio.getAssetFileUrl(rel)) ?? ''
      if (rel === activePreviewRel.value) rebuildPreviewUrl.value = url
    } catch {
      rebuildPreviewUrl.value = ''
    }
  },
  { immediate: true }
)

const rebuildReportText = computed(() =>
  isRebuild.value ? String(node.value?.params?.rebuildLastReport ?? '').trim() : ''
)

const rebuildReport = computed(() => {
  const text = rebuildReportText.value
  if (!text) return null
  try {
    const r = JSON.parse(text) as {
      generate?: unknown[]
      localRendered?: unknown[]
      passthrough?: unknown[]
      removed?: unknown[]
      dubs?: unknown[]
      variants?: Array<{
        id: string
        label: string
        outputRelativePath: string | null
        assetId: string | null
      }>
    }
    const n = (v: unknown[] | undefined): number => (Array.isArray(v) ? v.length : 0)
    return {
      generate: n(r.generate),
      localRendered: n(r.localRendered),
      passthrough: n(r.passthrough),
      removed: n(r.removed),
      dubs: n(r.dubs),
      variants: Array.isArray(r.variants) ? r.variants : []
    }
  } catch {
    return null
  }
})

function persistTimelineJson(): void {
  patch({ timelineJson: timelineJson.value })
}

const runOutText = computed(() => {
  if (!node.value) return ''
  const out = graphRunHosts.get(hostId.value)?.runStates?.[node.value.id]?.outputs?.out
  return out && (out.kind === 'text' || out.kind === 'semanticTimeline') ? out.text : ''
})

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
        /* continue */
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

const remakeLiveEstimate = computed(() => {
  if (!isRebuild.value || !timelineDoc.value) return null
  try {
    const plan = planRemakeExecution(timelineDoc.value, {
      strategy: remakeStrategy.value,
      instruction: String(node.value?.params?.generateInstruction ?? '').trim(),
      maxUnits: Math.max(1, Number(rebuildMaxShots.value) || 24),
      lang: isEn.value ? 'en' : 'zh'
    })
    return {
      units: plan.units.length,
      generatedShots: plan.generatedShots,
      localClips: plan.localClips.length,
      passthroughShots: plan.passthroughShots,
      dubs: plan.dubs.length
    }
  } catch {
    return null
  }
})

const timelineSummary = computed(() => {
  const doc = timelineDoc.value
  if (!doc) return null
  const s = doc.breakdown?.summary
  const plan = doc.breakdown?.productionPlan
  return {
    id: doc.id,
    verdict: s ? (isEn.value ? s.verdictEn : s.verdict) : '',
    confidencePct: s ? Math.round(s.confidence * 100) : null,
    shots: Array.isArray(doc.shots) ? doc.shots.length : 0,
    units: plan?.units?.length ?? 0,
    localUnits: plan?.localUnits?.length ?? 0,
    entities: Array.isArray(doc.entities) ? doc.entities.length : 0
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

.estimate-box {
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
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

.readonly-field,
.rebuild-result {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
}

.readonly-value {
  padding: 6px 8px;
  border: 1px dashed var(--border);
  border-radius: 6px;
  word-break: break-all;
}

.rebuild-result :deep(.media-preview-player) {
  width: 100%;
  border-radius: 6px;
  overflow: hidden;
}

.report-json {
  margin: 0;
  max-height: 240px;
  overflow: auto;
  font-size: 11px;
  white-space: pre-wrap;
  word-break: break-all;
}

.variant-badge {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(56, 189, 248, 0.16);
  color: #38bdf8;
  font-size: 10px;
  font-weight: 600;
}

.variant-preset-bar,
.variant-output-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 6px 0;
}

.variant-preset-btn,
.variant-tab-btn {
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text);
  font-size: 11px;
  cursor: pointer;
}

.variant-preset-btn:hover,
.variant-tab-btn:hover:not(:disabled) {
  border-color: #38bdf8;
  color: #38bdf8;
}

.variant-preset-btn.danger {
  color: #f87171;
}

.variant-tab-btn.active {
  background: rgba(56, 189, 248, 0.18);
  border-color: #38bdf8;
  color: #38bdf8;
  font-weight: 600;
}
</style>
