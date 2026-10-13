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

      <!-- 文本模型 / 用模型写提示词 / 规则包 / 编译要求都在指令面板里（双击节点）；这里只显示 -->
      <div class="readonly-field">
        <span class="field-label">{{ t('graph.inspector.semantic.compilePanelSummary') }}</span>
        <span class="readonly-value">{{ compileSettingsLabel }}</span>
        <span class="field-hint">{{ t('graph.inspector.semantic.compileInPanelHint') }}</span>
      </div>

      <dl v-if="compileSummary" class="meta">
        <div>
          <dt>{{ t('graph.inspector.semantic.rebuildReportGenerate') }}</dt>
          <dd>{{ compileSummary.regenerate }}</dd>
        </div>
        <div>
          <dt>{{ t('graph.inspector.semantic.rebuildReportPassthrough') }}</dt>
          <dd>{{ compileSummary.passthrough }}</dd>
        </div>
        <div>
          <dt>{{ t('graph.inspector.semantic.rebuildReportRemoved') }}</dt>
          <dd>{{ compileSummary.removed }}</dd>
        </div>
        <div>
          <dt>{{ t('graph.inspector.semantic.rebuildReportDubs') }}</dt>
          <dd>{{ compileSummary.dubs }}</dd>
        </div>
      </dl>
      <span class="field-hint">{{ t('graph.inspector.semantic.compileEditPointer') }}</span>
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

      <!-- 视频模型 / 画面参数在指令面板里选（双击节点）；这里只显示当前选择 -->
      <div class="readonly-field">
        <span class="field-label">{{ t('graph.inspector.semantic.rebuildModel') }}</span>
        <span class="readonly-value">{{ rebuildModelLabel }}</span>
        <span class="field-hint">{{ t('graph.inspector.semantic.rebuildModelInPanelHint') }}</span>
      </div>

      <label class="check">
        <input v-model="rebuildRegenerateAll" type="checkbox" @change="persistRebuild" />
        <span>{{ t('graph.inspector.semantic.rebuildRegenerateAll') }}</span>
      </label>
      <span class="field-hint">{{ t('graph.inspector.semantic.rebuildRegenerateAllHint') }}</span>

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
        <span class="field-label">{{ t('graph.inspector.semantic.rebuildDuration') }}</span>
        <input
          v-model="rebuildDuration"
          type="text"
          :placeholder="t('graph.inspector.semantic.rebuildDurationPlaceholder')"
          @change="persistRebuild"
        />
      </label>

      <p class="field-hint">{{ t('graph.inspector.semantic.rebuildPromptPointer') }}</p>

      <!-- 成片预览 + 重建清单（节点没有文本输出口；清单来自 rebuildLastReport） -->
      <div class="rebuild-result">
        <span class="field-label">{{ t('graph.inspector.semantic.rebuildPreview') }}</span>
        <MediaPreviewPlayer v-if="rebuildPreviewUrl" kind="video" :src="rebuildPreviewUrl" />
        <span v-else class="field-hint">{{
          t('graph.inspector.semantic.rebuildPreviewEmpty')
        }}</span>
        <dl v-if="rebuildReport" class="meta">
          <div>
            <dt>{{ t('graph.inspector.semantic.rebuildReportGenerate') }}</dt>
            <dd>{{ rebuildReport.generate }}</dd>
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
  listVocabularies,
  type SemanticPack,
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

const SEMANTIC_TYPE_IDS = new Set(['semantic.analyze', 'semantic.compile', 'semantic.rebuild'])

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
const isCompile = computed(() => typeId.value === 'semantic.compile')
const showTimelineFallback = computed(() => isCompile.value)

const hintText = computed(() => {
  switch (typeId.value) {
    case 'semantic.analyze':
      return t('graph.inspector.semantic.analyzeHint')
    case 'semantic.compile':
      return t('graph.inspector.semantic.compileHint')
    case 'semantic.rebuild':
      return t('graph.inspector.semantic.rebuildHint')
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
const sourceRelativePath = ref('')
const loadedNodeId = ref<string | null>(null)
const loadedHostId = ref<string | null>(null)

/**
 * 语义重建：模式 / 模型 / 上限 / 音轨字幕 / 时长与画面参数。
 *
 * 必须声明在下面那个 `watch(..., { immediate: true })` **之前**：该 watch 会在 setup
 * 期间同步调用 `loadConfig` → `syncRebuildFromNode`，而 `const` 不提升 —— 声明在后面
 * 就是 TDZ，选中语义节点时整个检查器直接抛
 * `Cannot access 'rebuildMode' before initialization`（面板只剩一句渲染失败）。
 */
const isRebuild = computed(() => typeId.value === 'semantic.rebuild')
/** 视频模型清单只用来把当前选择显示成可读名字（选择本身在指令面板里） */
const rebuildModelOptions = ref<GenerateModelOption[]>([])
const rebuildModelKey = ref('')
const rebuildMode = ref<'shots' | 'full'>('shots')
const rebuildExecute = ref(true)
const rebuildRegenerateAll = ref(false)
const rebuildMaxShots = ref(12)
const rebuildKeepAudio = ref(true)
const rebuildBurnSubtitles = ref(true)
const rebuildDuration = ref('')
/** 重新配音：开关 / TTS 模型 / 音色 / 用原人声克隆 */
const rebuildDub = ref(true)
const rebuildDubClone = ref(true)
const dubModelOptions = ref<GenerateModelOption[]>([])
const dubModelKey = ref('')
const dubVoice = ref('')

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

function syncRebuildFromNode(): void {
  const p = node.value?.params
  rebuildMode.value = p?.rebuildMode === 'full' ? 'full' : 'shots'
  rebuildExecute.value = p?.semanticExecute !== false
  rebuildRegenerateAll.value = p?.rebuildRegenerateAll === true
  rebuildMaxShots.value = Number(p?.rebuildMaxShots) || 12
  rebuildKeepAudio.value = p?.rebuildKeepAudio !== false
  rebuildBurnSubtitles.value = p?.rebuildBurnSubtitles !== false
  rebuildDuration.value = Number(p?.rebuildDurationSec) ? String(p?.rebuildDurationSec) : ''
  rebuildModelKey.value = preferredModelKey(p?.generateProviderInstanceId, p?.generateModel)
  rebuildDub.value = p?.rebuildDub !== false
  rebuildDubClone.value = p?.rebuildDubClone !== false
  dubModelKey.value = preferredModelKey(p?.dubProviderInstanceId, p?.dubModel)
  dubVoice.value = String(p?.dubVoice ?? '')
}

/**
 * 写回重建参数。视频模型 / 分辨率 / 画幅由指令面板写（`generate*`），这里不碰，
 * 免得两处同时写互相覆盖。
 */
function persistRebuild(): void {
  const dub = parseModelKey(dubModelKey.value)
  patch({
    rebuildMode: rebuildMode.value,
    semanticExecute: rebuildExecute.value,
    rebuildRegenerateAll: rebuildRegenerateAll.value,
    rebuildMaxShots: Math.max(1, Number(rebuildMaxShots.value) || 12),
    rebuildKeepAudio: rebuildKeepAudio.value,
    rebuildBurnSubtitles: rebuildBurnSubtitles.value,
    rebuildDurationSec: Number(rebuildDuration.value) || 0,
    rebuildDub: rebuildDub.value,
    rebuildDubClone: rebuildDubClone.value,
    dubModel: dub?.model ?? '',
    dubProviderInstanceId: dub?.providerInstanceId ?? '',
    dubVoice: dubVoice.value.trim()
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

/** 上次成片：本次运行的视频输出优先，否则节点参数里记的上次成片 */
const rebuildOutputRel = computed(() => {
  if (!isRebuild.value || !node.value) return ''
  const out = graphRunHosts.get(hostId.value)?.runStates?.[node.value.id]?.outputs?.['out-video']
  if (out && out.kind === 'video' && out.relativePath?.trim()) return out.relativePath.trim()
  return String(node.value.params?.rebuildLastOutput ?? '').trim()
})

const rebuildPreviewUrl = ref('')
watch(
  rebuildOutputRel,
  async (rel) => {
    rebuildPreviewUrl.value = ''
    if (!rel) return
    try {
      const url = (await window.studio.getAssetFileUrl(rel)) ?? ''
      if (rel === rebuildOutputRel.value) rebuildPreviewUrl.value = url
    } catch {
      rebuildPreviewUrl.value = ''
    }
  },
  { immediate: true }
)

const rebuildReportText = computed(() =>
  isRebuild.value ? String(node.value?.params?.rebuildLastReport ?? '').trim() : ''
)

/** 清单摘要：生成几镜 / 直通几镜 / 删几镜 / 配音几句 */
const rebuildReport = computed(() => {
  const text = rebuildReportText.value
  if (!text) return null
  try {
    const r = JSON.parse(text) as {
      generate?: unknown[]
      passthrough?: unknown[]
      removed?: unknown[]
      dubs?: unknown[]
    }
    const n = (v: unknown[] | undefined): number => (Array.isArray(v) ? v.length : 0)
    return {
      generate: n(r.generate),
      passthrough: n(r.passthrough),
      removed: n(r.removed),
      dubs: n(r.dubs)
    }
  } catch {
    return null
  }
})

/**
 * 编译节点在检查器里只写原视频路径；文本模型 / 用模型写提示词 / 规则包 / 编译要求
 * 都由指令面板写（两处同时写会互相覆盖）。
 */
function persistCompile(): void {
  patch({ sourceRelativePath: sourceRelativePath.value.trim() })
}

/** 指令面板里的设置摘要：文本模型 · 是否用模型写 · 规则包 · 有无编译要求 */
const compileSettingsLabel = computed(() => {
  void graphEditorHosts.revision.value
  const p = node.value?.params
  if (!p || !isCompile.value) return ''
  const key = preferredModelKey(p.generateProviderInstanceId, p.generateModel)
  const model = key
    ? (enrichModelOptions.value.find((o) => o.key === key)?.label ?? key)
    : t('graph.inspector.semantic.modelAuto')
  const packIds = String(p.rulePackIds || '')
    .split(/[,，\s]+/)
    .filter(Boolean)
  const titles = packIds.map(
    (id) => rulePackOptions.value.find((pack) => pack.id === id)?.title ?? id
  )
  return [
    model,
    p.semanticLlm === true
      ? t('graph.inspector.semantic.promptsWithModel')
      : t('graph.inspector.semantic.promptsByRules'),
    titles.length ? titles.join('、') : t('graph.inspector.semantic.rulePacksAll'),
    String(p.generateInstruction ?? '').trim()
      ? t('graph.inspector.semantic.compileHasInstruction')
      : ''
  ]
    .filter(Boolean)
    .join(' · ')
})

/** 编译结果摘要（来自运行输出的提示词计划）：重新生成 / 直通 / 删除 / 配音 */
const compileSummary = computed(() => {
  if (!isCompile.value || !node.value) return null
  const out = graphRunHosts.get(hostId.value)?.runStates?.[node.value.id]?.outputs?.out
  const plan = out && out.kind === 'videoPrompts' ? out.plan : null
  if (!plan) return null
  return {
    regenerate: plan.shots.filter((s) => s.strategy !== 'passthrough').length,
    passthrough: plan.shots.filter((s) => s.strategy === 'passthrough').length,
    removed: plan.removedShotIds?.length ?? 0,
    dubs: plan.dubs?.length ?? 0
  }
})

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
 * 编译节点的入边是整份时间线文档，所以「本节点 JSON / 本节点输出 / 上游」三处都要找：
 * 否则用户在编译节点上直接改 `timelineJson` 时看不到任何摘要。这里按入边逐个尝试：
 * 上游的运行输出 → 上游的 `timelineJson` → 上游的 `semanticTimelineId` 读盘。
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
</style>
