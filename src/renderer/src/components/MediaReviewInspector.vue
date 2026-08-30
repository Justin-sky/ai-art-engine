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
      {{ t('graph.inspector.mediaReview.hint') }}
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
        {{ t('graph.inspector.mediaReview.instruction') }}
        <ExpandableTextarea
          :key="`instr-${node.id}`"
          v-model="instruction"
          :title="t('graph.inspector.mediaReview.instruction')"
          :rows="4"
          :placeholder="t('graph.inspector.mediaReview.instructionPlaceholder')"
          @change="persistInstruction"
        />
      </label>

      <label class="model-field">
        <span class="field-label">{{ t('graph.inspector.mediaReview.reviewModel') }}</span>
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
        <span class="field-hint">{{ t('graph.inspector.mediaReview.reviewModelHint') }}</span>
        <span
          v-if="!hasDedicatedReviewModel"
          class="field-warn"
        >{{ t('graph.inspector.mediaReview.reviewModelFallback') }}</span>
      </label>

      <label class="attempts-field">
        <span class="field-label">{{ t('graph.inspector.mediaReview.referenceCount') }}</span>
        <input
          type="number"
          min="0"
          :value="referenceCount"
          :placeholder="t('graph.inspector.mediaReview.referenceCountHint')"
          @change="persistReferenceCount"
        >
      </label>

      <div class="status-block">
        <span class="field-label">{{ t('graph.inspector.mediaReview.status') }}</span>
        <div class="status-row">
          <span
            class="status-badge"
            :class="statusClass"
          >{{ statusLabel }}</span>
          <span
            v-if="reviewReason"
            class="status-reason"
          >{{ reviewReason }}</span>
        </div>
      </div>

      <div
        v-if="scoreText"
        class="status-block"
      >
        <span class="field-label">{{ t('graph.inspector.mediaReview.score') }}</span>
        <span class="status-reason">{{ scoreText }}</span>
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
import { parseMediaReviewScoresParam } from '@shared/graph'
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
  return current?.typeId === 'media.review' ? current : null
})

const hostId = computed(() => {
  const selection = editor.selection.current.value
  return selection.kind === 'graph.node' ? selection.hostId ?? '' : ''
})

const { hasInPort, runStatus, isGraphRunning, blocked, toggleRun } = useGraphNodeRun(node)

const typeLabel = computed(() => graphTypeLabel('media.review'))
const displayTitle = useNodeDisplayTitle(node, typeLabel)

const localTitle = ref('')
const instruction = ref('')
const referenceCount = ref('')
const modelOptions = ref<GenerateModelOption[]>([])
const selectedModelKey = ref('')
const loadedNodeId = ref<string | null>(null)
const loadedHostId = ref<string | null>(null)

/** 未配置专用质检模型时，执行器会回退到生成模型——此时结论不可信，必须显式提示 */
const hasDedicatedReviewModel = computed(() => Boolean(node.value?.params.reviewModel?.trim()))

const scoreText = computed(() => {
  const scores = parseMediaReviewScoresParam(node.value?.params.mediaReviewScores)
  if (!scores?.items.length) return ''
  const parts = scores.items.map((item) => `${item.name} ${item.score}`)
  return `${parts.join(' / ')} — ${scores.average}`
})

const modelSelectOptions = computed(() => {
  if (modelOptions.value.length === 0) {
    return [{ key: '', label: t('graph.inspector.generate.noModels') }]
  }
  return modelOptions.value.map((opt) => ({ key: opt.key, label: opt.label }))
})

const statusLabel = computed(() => {
  const pending = node.value?.params.mediaReviewPending !== false
  if (pending) return t('graph.inspector.mediaReview.pending')
  if (node.value?.params.mediaReviewStatus === 'PASS') return t('graph.inspector.mediaReview.pass')
  if (node.value?.params.mediaReviewStatus === 'FAIL') return t('graph.inspector.mediaReview.fail')
  return t('graph.inspector.mediaReview.pending')
})

const statusClass = computed(() => {
  const status = node.value?.params.mediaReviewStatus
  const pending = node.value?.params.mediaReviewPending !== false
  if (pending) return 'pending'
  return status === 'PASS' ? 'pass' : 'fail'
})

const reviewReason = computed(() => node.value?.params.mediaReviewReason?.trim() || '')

async function loadModels(preferredKey?: string): Promise<void> {
  const { options, selectedKey } = await loadGenerateModelOptions(
    'text',
    preferredKey,
    selectedModelKey.value
  )
  modelOptions.value = options
  selectedModelKey.value = selectedKey
}

function loadConfig(current: NonNullable<typeof node.value>): void {
  loadedNodeId.value = current.id
  loadedHostId.value = hostId.value
  localTitle.value = current.title ?? ''
  instruction.value = current.params.generateInstruction ?? ''
  referenceCount.value =
    typeof current.params.mediaReviewReferenceCount === 'number'
      ? String(current.params.mediaReviewReferenceCount)
      : ''
  // 未配置专用质检模型时回退到生成模型，保证旧图仍能选中已有配置
  const preferred = preferredModelKey(
    current.params.reviewProviderInstanceId || current.params.generateProviderInstanceId,
    current.params.reviewModel || current.params.generateModel
  )
  void loadModels(preferred)
}

watch(
  node,
  (current) => {
    if (!current) {
      localTitle.value = ''
      instruction.value = ''
      referenceCount.value = ''
      modelOptions.value = []
      selectedModelKey.value = ''
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

function persistModel(): void {
  if (!node.value) return
  const parsed = parseModelKey(selectedModelKey.value)
  const selection = editor.selection.current.value
  graphEditorHosts.updateNode(selection.hostId, node.value.id, {
    reviewModel: parsed?.model ?? '',
    reviewProviderInstanceId: parsed?.providerInstanceId ?? ''
  })
}

function persistReferenceCount(event: Event): void {
  if (!node.value) return
  const selection = editor.selection.current.value
  const raw = (event.target as HTMLInputElement).value.trim()
  if (!raw) {
    referenceCount.value = ''
    graphEditorHosts.updateNode(selection.hostId, node.value.id, {
      mediaReviewReferenceCount: undefined
    })
    return
  }
  const value = Math.max(0, Math.round(Number(raw) || 0))
  referenceCount.value = String(value)
  graphEditorHosts.updateNode(selection.hostId, node.value.id, {
    mediaReviewReferenceCount: value
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
