<template>
  <div
    v-if="node"
    class="node-inspector"
  >
    <div class="head">
      <span class="type">{{ typeLabel }}</span>
      <h2>{{ displayTitle }}</h2>
    </div>
    <p class="hint">
      {{ t('graph.inspector.mediaRework.hint') }}
    </p>

    <GraphNodeRunControl
      v-if="hasInPort"
      :status="runStatus"
      :is-running="isGraphRunning"
      :blocked="blocked"
      @toggle="toggleRun"
    />

    <GraphNodeOutputPreview
      v-if="node && hostId"
      :node="node"
      :host-id="hostId"
    />

    <label>
      {{ t('graph.inspector.displayName') }}
      <input
        v-model="localTitle"
        @change="persistTitle"
      >
    </label>

    <section class="gen-config">
      <label>
        {{ t('graph.inspector.mediaRework.instruction') }}
        <ExpandableTextarea
          :key="`instr-${node.id}`"
          v-model="instruction"
          :title="t('graph.inspector.mediaRework.instruction')"
          :rows="4"
          :placeholder="t('graph.inspector.mediaRework.instructionPlaceholder')"
          @change="persistInstruction"
        />
      </label>

      <label>
        {{ t('graph.inspector.generate.systemPrompt') }}
        <ExpandableTextarea
          :key="`sys-${node.id}`"
          v-model="systemPrompt"
          :title="t('graph.inspector.generate.systemPrompt')"
          :rows="4"
          :placeholder="t('graph.inspector.generate.systemPromptPlaceholder')"
          @change="persistSystemPrompt"
        />
      </label>

      <label class="model-field">
        <span class="field-label">{{ t('graph.inspector.mediaRework.imageModel') }}</span>
        <select
          v-model="selectedModelKey"
          @change="persistModel"
        >
          <option
            v-for="opt in modelSelectOptions"
            :key="opt.key || 'empty'"
            :value="opt.key"
          >
            {{ opt.label }}
          </option>
        </select>
      </label>

      <details class="fallback-field">
        <summary>{{ t('graph.inspector.mediaRework.imageModelFallbacks') }}</summary>
        <span class="field-hint">{{ t('graph.inspector.mediaRework.modelFallbacksHint') }}</span>
        <div class="fallback-options">
          <label
            v-for="opt in fallbackImageOptions"
            :key="opt.key"
            class="fallback-option"
          >
            <input
              type="checkbox"
              :checked="opt.checked"
              @change="toggleImageFallback(opt.key)"
            >
            <span>{{ opt.label }}</span>
          </label>
          <span
            v-if="!fallbackImageOptions.length"
            class="field-hint"
          >{{ t('graph.inspector.generate.noModels') }}</span>
        </div>
      </details>

      <label class="model-field">
        <span class="field-label">{{ t('graph.inspector.mediaRework.reviewModel') }}</span>
        <select
          v-model="selectedReviewModelKey"
          @change="persistReviewModel"
        >
          <option
            v-for="opt in reviewModelSelectOptions"
            :key="opt.key || 'empty'"
            :value="opt.key"
          >
            {{ opt.label }}
          </option>
        </select>
        <span class="field-hint">{{ t('graph.inspector.mediaRework.reviewModelHint') }}</span>
        <span
          v-if="!hasDedicatedReviewModel"
          class="field-warn"
        >{{ t('graph.inspector.mediaRework.reviewModelFallback') }}</span>
      </label>

      <details class="fallback-field">
        <summary>{{ t('graph.inspector.mediaRework.reviewModelFallbacks') }}</summary>
        <span class="field-hint">{{ t('graph.inspector.mediaRework.modelFallbacksHint') }}</span>
        <div class="fallback-options">
          <label
            v-for="opt in fallbackReviewOptions"
            :key="opt.key"
            class="fallback-option"
          >
            <input
              type="checkbox"
              :checked="opt.checked"
              @change="toggleReviewFallback(opt.key)"
            >
            <span>{{ opt.label }}</span>
          </label>
          <span
            v-if="!fallbackReviewOptions.length"
            class="field-hint"
          >{{ t('graph.inspector.generate.noModels') }}</span>
        </div>
      </details>

      <label class="attempts-field">
        <span class="field-label">{{ t('graph.inspector.mediaRework.maxAttempts') }}</span>
        <input
          type="number"
          min="1"
          :max="MEDIA_REWORK_MAX_ATTEMPTS_HARD_LIMIT"
          :value="maxAttempts"
          @change="persistMaxAttempts"
        >
      </label>

      <label class="model-field">
        <span class="field-label">{{ t('graph.inspector.mediaRework.strategy') }}</span>
        <select
          v-model="strategy"
          @change="persistStrategy"
        >
          <option value="auto">{{ t('graph.inspector.mediaRework.strategyAuto') }}</option>
          <option value="guidance">{{ t('graph.inspector.mediaRework.strategyGuidance') }}</option>
          <option value="reseed">{{ t('graph.inspector.mediaRework.strategyReseed') }}</option>
          <option value="stronger">{{ t('graph.inspector.mediaRework.strategyStronger') }}</option>
        </select>
      </label>

      <label class="switch-field">
        <input
          type="checkbox"
          :checked="confirmFirst"
          @change="persistConfirmFirst"
        >
        <span>{{ t('graph.inspector.mediaRework.confirmFirst') }}</span>
      </label>
      <span class="field-hint">{{ t('graph.inspector.mediaRework.confirmFirstHint') }}</span>

      <div
        v-if="awaitingConfirm"
        class="confirm-block"
      >
        <span class="field-label">{{ t('graph.inspector.mediaRework.awaitingConfirm') }}</span>
        <span class="field-hint">{{ t('graph.inspector.mediaRework.awaitingConfirmHint') }}</span>
        <div class="confirm-actions">
          <button
            type="button"
            @click="continueRework"
          >
            {{ t('graph.inspector.mediaRework.continueRework') }}
          </button>
          <button
            type="button"
            @click="acceptCurrent"
          >
            {{ t('graph.inspector.mediaRework.acceptCurrent') }}
          </button>
        </div>
      </div>

      <div class="status-block">
        <span class="field-label">{{ t('graph.inspector.mediaRework.status') }}</span>
        <div class="status-row">
          <span
            class="status-badge"
            :class="reworkStatusClass"
          >{{ reworkStatusLabel }}</span>
          <span
            v-if="reviewStatusLabel"
            class="status-badge"
            :class="reviewStatusClass"
          >{{ reviewStatusLabel }}</span>
          <span
            v-if="lastReason"
            class="status-reason"
          >{{ lastReason }}</span>
        </div>
      </div>

      <div
        v-if="scoreText"
        class="status-block"
      >
        <span class="field-label">{{ t('graph.inspector.mediaRework.score') }}</span>
        <span class="status-reason">{{ scoreText }}</span>
      </div>

      <div
        v-if="roundsText"
        class="status-block"
      >
        <span class="field-label">{{ t('graph.inspector.mediaRework.rounds') }}</span>
        <span class="status-reason">{{ roundsText }}</span>
      </div>

      <div
        v-if="costText"
        class="status-block"
      >
        <span class="field-label">{{ t('graph.inspector.mediaRework.cost') }}</span>
        <span class="status-reason">{{ costText }}</span>
      </div>
    </section>
  </div>
  <div
    v-else
    class="node-inspector empty"
  >
    {{ t('graph.inspector.node.empty') }}
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  clampMediaReworkMaxAttempts,
  mediaReworkLogLines,
  parseMediaReworkState,
  parseMediaReviewScoresParam,
  MEDIA_REWORK_DEFAULT_MAX_ATTEMPTS,
  MEDIA_REWORK_MAX_ATTEMPTS_HARD_LIMIT
} from '@shared/graph'
import GraphNodeRunControl from './GraphNodeRunControl.vue'
import GraphNodeOutputPreview from './GraphNodeOutputPreview.vue'
import ExpandableTextarea from './ExpandableTextarea.vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useNodeDisplayTitle } from '../composables/useNodeDisplayTitle'
import { useGraphNodeRun } from '../composables/useGraphNodeRun'
import { useEditorKernel } from '../editor/kernel'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'
import {
  loadGenerateModelOptions,
  parseModelKey,
  preferredModelKey,
  type GenerateModelOption
} from '../features/graph/model/generateModelOptions'

const { t, graphTypeLabel } = useStudioI18n()
const editor = useEditorKernel()

const node = computed(() => {
  void graphEditorHosts.revision.value
  const selection = editor.selection.current.value
  const id = selection.kind === 'graph.node' ? selection.id : null
  if (!id) return null
  const current = graphEditorHosts.getNode(selection.hostId, id)
  return current?.typeId === 'media.rework' ? current : null
})

const hostId = computed(() => {
  const selection = editor.selection.current.value
  return selection.kind === 'graph.node' ? selection.hostId ?? '' : ''
})

const { hasInPort, runStatus, isGraphRunning, blocked, toggleRun } = useGraphNodeRun(node)

const typeLabel = computed(() => graphTypeLabel('media.rework'))
const displayTitle = useNodeDisplayTitle(node, typeLabel)

const localTitle = ref('')
const instruction = ref('')
const systemPrompt = ref('')
const maxAttempts = ref<number>(MEDIA_REWORK_DEFAULT_MAX_ATTEMPTS)
const strategy = ref<'auto' | 'guidance' | 'reseed' | 'stronger'>('auto')
const confirmFirst = ref(false)
const modelOptions = ref<GenerateModelOption[]>([])
const selectedModelKey = ref('')
const reviewModelOptions = ref<GenerateModelOption[]>([])
const selectedReviewModelKey = ref('')
const fallbackImageKeys = ref<string[]>([])
const fallbackReviewKeys = ref<string[]>([])
const loadedNodeId = ref<string | null>(null)
const loadedHostId = ref<string | null>(null)

/** 未配置专用质检模型时执行器会回退到生图模型——那是盲评，必须显式告警 */
const hasDedicatedReviewModel = computed(() => Boolean(node.value?.params.reviewModel?.trim()))

const awaitingConfirm = computed(() => node.value?.params.mediaReworkAwaitingConfirm === true)

const scoreText = computed(() => {
  const scores = parseMediaReviewScoresParam(node.value?.params.mediaReviewScores)
  if (!scores?.items.length) return ''
  const parts = scores.items.map((item) => `${item.name} ${item.score}`)
  return `${parts.join(' / ')} — ${scores.average}`
})

const roundsText = computed(() => {
  const state = parseMediaReworkState(node.value?.params.mediaReworkState)
  if (!state?.iterations.length) return ''
  return mediaReworkLogLines(state).join(' | ')
})

const costText = computed(() => {
  const raw = node.value?.params.mediaReworkCost?.trim()
  if (!raw) return ''
  try {
    const parsed = JSON.parse(raw) as Array<{
      imageCalls?: number
      reviewCalls?: number
    }>
    if (!Array.isArray(parsed) || !parsed.length) return ''
    const images = parsed.reduce((sum, entry) => sum + (entry.imageCalls ?? 0), 0)
    const reviews = parsed.reduce((sum, entry) => sum + (entry.reviewCalls ?? 0), 0)
    return `image ${images} / review ${reviews}`
  } catch {
    return ''
  }
})

const modelSelectOptions = computed(() => {
  if (modelOptions.value.length === 0) {
    return [{ key: '', label: t('graph.inspector.generate.noModels') }]
  }
  return modelOptions.value.map((opt) => ({ key: opt.key, label: opt.label }))
})

const reviewModelSelectOptions = computed(() => {
  if (reviewModelOptions.value.length === 0) {
    return [{ key: '', label: t('graph.inspector.generate.noModels') }]
  }
  return reviewModelOptions.value.map((opt) => ({ key: opt.key, label: opt.label }))
})

/** 备选模型可选项：剔除当前首选（首选已在链首，重复勾选无意义） */
function fallbackOptionsFrom(
  options: ReadonlyArray<{ key: string; label: string }>,
  selected: string,
  checkedKeys: readonly string[]
): Array<{ key: string; label: string; checked: boolean }> {
  return options
    .filter((opt) => opt.key && opt.key !== selected)
    .map((opt) => ({ ...opt, checked: checkedKeys.includes(opt.key) }))
}

const fallbackImageOptions = computed(() =>
  fallbackOptionsFrom(modelSelectOptions.value, selectedModelKey.value, fallbackImageKeys.value)
)

const fallbackReviewOptions = computed(() =>
  fallbackOptionsFrom(
    reviewModelSelectOptions.value,
    selectedReviewModelKey.value,
    fallbackReviewKeys.value
  )
)

/** params 里存的是 string[]，读时做一次防御性归一 */
function normalizeModelKeyList(raw: unknown): string[] {
  return Array.isArray(raw)
    ? raw.filter((item): item is string => typeof item === 'string' && !!item.trim())
    : []
}

const reworkStatus = computed(() => node.value?.params.mediaReworkStatus)

const reworkStatusLabel = computed(() => {
  switch (reworkStatus.value) {
    case 'running':
      return t('graph.inspector.mediaRework.running')
    case 'passed':
      return t('graph.inspector.mediaRework.passed')
    case 'exhausted':
      return t('graph.inspector.mediaRework.exhausted')
    default:
      return t('graph.inspector.mediaRework.running')
  }
})

const reworkStatusClass = computed(() => {
  switch (reworkStatus.value) {
    case 'passed':
      return 'pass'
    case 'exhausted':
      return 'fail'
    default:
      return 'pending'
  }
})

const reviewStatusLabel = computed(() => {
  const status = node.value?.params.mediaReviewStatus
  const pending = node.value?.params.mediaReviewPending !== false
  if (pending) return ''
  if (status === 'PASS') return t('graph.inspector.mediaReview.pass')
  if (status === 'FAIL') return t('graph.inspector.mediaReview.fail')
  return ''
})

const reviewStatusClass = computed(() => {
  const status = node.value?.params.mediaReviewStatus
  return status === 'PASS' ? 'pass' : 'fail'
})

const lastReason = computed(() => node.value?.params.mediaReviewReason?.trim() || '')

async function loadModels(preferredKey?: string): Promise<void> {
  const { options, selectedKey } = await loadGenerateModelOptions(
    'image',
    preferredKey,
    selectedModelKey.value
  )
  modelOptions.value = options
  selectedModelKey.value = selectedKey
}

/** 质检模型走文本模态：必须是能读图的视觉模型，与生图模型分开配置 */
async function loadReviewModels(preferredKey?: string): Promise<void> {
  const { options, selectedKey } = await loadGenerateModelOptions(
    'text',
    preferredKey,
    selectedReviewModelKey.value
  )
  reviewModelOptions.value = options
  selectedReviewModelKey.value = selectedKey
}

function loadConfig(current: NonNullable<typeof node.value>): void {
  loadedNodeId.value = current.id
  loadedHostId.value = hostId.value
  localTitle.value = current.title ?? ''
  instruction.value = current.params.generateInstruction ?? ''
  systemPrompt.value = current.params.generateSystemPrompt ?? ''
  maxAttempts.value = clampMediaReworkMaxAttempts(current.params.mediaReworkMaxAttempts)
  strategy.value = current.params.mediaReworkStrategy ?? 'auto'
  confirmFirst.value = current.params.mediaReworkConfirmFirst === true
  fallbackImageKeys.value = normalizeModelKeyList(current.params.generateModelFallbacks)
  fallbackReviewKeys.value = normalizeModelKeyList(current.params.reviewModelFallbacks)
  const preferred = preferredModelKey(
    current.params.generateProviderInstanceId,
    current.params.generateModel
  )
  void loadModels(preferred)
  // 未配置专用质检模型时回退到生图模型的选择，保证旧图不丢配置
  const reviewPreferred = preferredModelKey(
    current.params.reviewProviderInstanceId || current.params.generateProviderInstanceId,
    current.params.reviewModel || current.params.generateModel
  )
  void loadReviewModels(reviewPreferred)
}

watch(
  node,
  (current) => {
    if (!current) {
      localTitle.value = ''
      instruction.value = ''
      systemPrompt.value = ''
      maxAttempts.value = MEDIA_REWORK_DEFAULT_MAX_ATTEMPTS
      strategy.value = 'auto'
      confirmFirst.value = false
      modelOptions.value = []
      selectedModelKey.value = ''
      reviewModelOptions.value = []
      selectedReviewModelKey.value = ''
      fallbackImageKeys.value = []
      fallbackReviewKeys.value = []
      loadedNodeId.value = null
      loadedHostId.value = null
      return
    }
    const sameNode = current.id === loadedNodeId.value && hostId.value === loadedHostId.value
    if (!sameNode) loadConfig(current)
  },
  { immediate: true }
)

function persistTitle(): void {
  if (!node.value) return
  const selection = editor.selection.current.value
  graphEditorHosts.updateNode(selection.hostId, node.value.id, {}, localTitle.value.trim())
}

function persistInstruction(): void {
  if (!node.value) return
  const selection = editor.selection.current.value
  graphEditorHosts.updateNode(selection.hostId, node.value.id, {
    generateInstruction: instruction.value
  })
}

function persistSystemPrompt(): void {
  if (!node.value) return
  const selection = editor.selection.current.value
  graphEditorHosts.updateNode(selection.hostId, node.value.id, {
    generateSystemPrompt: systemPrompt.value
  })
}

function persistModel(): void {
  if (!node.value) return
  const parsed = parseModelKey(selectedModelKey.value)
  const selection = editor.selection.current.value
  graphEditorHosts.updateNode(selection.hostId, node.value.id, {
    generateModel: parsed?.model ?? '',
    generateProviderInstanceId: parsed?.providerInstanceId ?? ''
  })
}

function persistMaxAttempts(event: Event): void {
  if (!node.value) return
  const raw = (event.target as HTMLInputElement).value
  const value = clampMediaReworkMaxAttempts(raw.trim() === '' ? undefined : Number(raw))
  maxAttempts.value = value
  const selection = editor.selection.current.value
  graphEditorHosts.updateNode(selection.hostId, node.value.id, {
    mediaReworkMaxAttempts: value
  })
}

function persistReviewModel(): void {
  if (!node.value) return
  const parsed = parseModelKey(selectedReviewModelKey.value)
  const selection = editor.selection.current.value
  graphEditorHosts.updateNode(selection.hostId, node.value.id, {
    reviewModel: parsed?.model ?? '',
    reviewProviderInstanceId: parsed?.providerInstanceId ?? ''
  })
}

/** 勾选顺序即尝试顺序——备选链的语义是「首选挂掉后先试谁」，顺序由用户决定 */
function toggleImageFallback(key: string): void {
  if (!node.value) return
  const list = [...fallbackImageKeys.value]
  const idx = list.indexOf(key)
  if (idx >= 0) list.splice(idx, 1)
  else list.push(key)
  fallbackImageKeys.value = list
  graphEditorHosts.updateNode(editor.selection.current.value.hostId, node.value.id, {
    generateModelFallbacks: list
  })
}

function toggleReviewFallback(key: string): void {
  if (!node.value) return
  const list = [...fallbackReviewKeys.value]
  const idx = list.indexOf(key)
  if (idx >= 0) list.splice(idx, 1)
  else list.push(key)
  fallbackReviewKeys.value = list
  graphEditorHosts.updateNode(editor.selection.current.value.hostId, node.value.id, {
    reviewModelFallbacks: list
  })
}

function persistStrategy(): void {
  if (!node.value) return
  const selection = editor.selection.current.value
  graphEditorHosts.updateNode(selection.hostId, node.value.id, {
    mediaReworkStrategy: strategy.value
  })
}

function persistConfirmFirst(event: Event): void {
  if (!node.value) return
  const checked = (event.target as HTMLInputElement).checked
  confirmFirst.value = checked
  const selection = editor.selection.current.value
  graphEditorHosts.updateNode(selection.hostId, node.value.id, {
    mediaReworkConfirmFirst: checked
  })
}

/** 继续返工：解除暂停并重新运行本节点，接着消耗剩余次数 */
function continueRework(): void {
  if (!node.value) return
  const selection = editor.selection.current.value
  graphEditorHosts.updateNode(selection.hostId, node.value.id, {
    mediaReworkAwaitingConfirm: false
  })
  void toggleRun()
}

/** 采用当前结果：人工验收通过，后续运行直接复用图库不再重跑 */
function acceptCurrent(): void {
  if (!node.value) return
  const selection = editor.selection.current.value
  graphEditorHosts.updateNode(selection.hostId, node.value.id, {
    mediaReworkAwaitingConfirm: false,
    mediaReviewPending: false,
    mediaReworkStatus: 'passed',
    mediaReviewStatus: 'PASS'
  })
}
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
  font-size: 11px;
  color: var(--text-muted);
}

.head h2 {
  margin: 4px 0 0;
  font-size: 14px;
}

.hint {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.4;
}

label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--text-muted);
}

.gen-config {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 4px;
  border-top: 1px solid var(--border);
  margin-top: 4px;
}

.model-field,
.attempts-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-label {
  font-size: 12px;
  color: var(--text-muted);
}

.field-hint {
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.4;
}

.field-warn {
  font-size: 11px;
  line-height: 1.4;
  color: var(--warn, #d9a441);
}

.fallback-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 8px;
  border: 1px solid var(--border, rgba(255, 255, 255, 0.08));
  border-radius: 4px;
}

.fallback-field > summary {
  font-size: 12px;
  color: var(--text-secondary, var(--text-muted));
  cursor: pointer;
}

.fallback-options {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 160px;
  overflow-y: auto;
}

.fallback-option {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--text-secondary, var(--text-muted));
  cursor: pointer;
}

.switch-field {
  flex-direction: row;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.switch-field input {
  width: auto;
  margin: 0;
}

.confirm-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  border: 1px solid color-mix(in srgb, var(--warn, #d9a441) 45%, transparent);
  border-radius: 8px;
}

.confirm-actions {
  display: flex;
  gap: 8px;
}

.confirm-actions button {
  flex: 1;
  padding: 6px 10px;
  font-size: 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elevated);
  color: var(--text);
  cursor: pointer;
}

.confirm-actions button:hover {
  border-color: var(--text-muted);
}

select,
input {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elevated);
  color: var(--text);
  padding: 8px 10px;
  font-size: 12px;
}

.status-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.status-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.status-badge {
  display: inline-flex;
  align-items: center;
  padding: 3px 8px;
  border-radius: 6px;
  font-size: 11px;
  line-height: 1.4;
  border: 1px solid var(--border);
  color: var(--text-muted);
}

.status-badge.pass {
  color: var(--ok, #3fb27f);
  border-color: color-mix(in srgb, var(--ok, #3fb27f) 55%, transparent);
}

.status-badge.fail {
  color: var(--danger, #e05a5a);
  border-color: color-mix(in srgb, var(--danger, #e05a5a) 55%, transparent);
}

.status-reason {
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.4;
  word-break: break-word;
}
</style>
