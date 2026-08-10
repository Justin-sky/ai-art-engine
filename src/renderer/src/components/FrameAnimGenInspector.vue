<template>
  <div class="node-inspector" v-if="node">
    <div class="head">
      <h2>{{ node.title || typeLabel }}</h2>
    </div>
    <p class="hint">{{ t('graph.anim2d.genInspectorHint') }}</p>

    <GraphNodeRunControl
      v-if="hasInPort"
      :status="runStatus"
      :is-running="isGraphRunning"
      :blocked="blocked"
      @toggle="toggleRun"
    />

    <div class="config-row">
      <label class="field">
        <span>{{ t('graph.anim2d.rows') }}</span>
        <input
          type="number"
          min="1"
          :max="String(ANIM2D_MAX_DIM)"
          step="1"
          :value="state.rows"
          @change="onRowsChange"
        />
      </label>
      <label class="field">
        <span>{{ t('graph.anim2d.cols') }}</span>
        <input
          type="number"
          min="1"
          :max="String(ANIM2D_MAX_DIM)"
          step="1"
          :value="state.cols"
          @change="onColsChange"
        />
      </label>
    </div>

    <label class="field">
      <span>{{ t('graph.anim2d.systemPrompt') }}</span>
      <textarea
        class="instruction"
        v-model="systemPrompt"
        rows="6"
        :placeholder="t('graph.anim2d.systemPromptPlaceholder')"
        @change="persistSystemPrompt"
      />
    </label>

    <GraphNodeOutputPreview
      v-if="hostId"
      :node="node"
      :host-id="hostId"
      clearable
      @clear-output="onClearOutput"
    />
  </div>
  <div v-else class="node-inspector empty">{{ t('graph.inspector.node.empty') }}</div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  ANIM2D_MAX_DIM,
  readAnim2dFromNode,
  resolveFrameAnimGenSystemPrompt
} from '@shared/graph'
import GraphNodeRunControl from './GraphNodeRunControl.vue'
import GraphNodeOutputPreview from './GraphNodeOutputPreview.vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useGraphNodeRun } from '../composables/useGraphNodeRun'
import { useEditorKernel } from '../editor/kernel'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'
import { graphRunHosts } from '../features/graph/model/graphRunHosts'

const { t, locale, graphTypeLabel } = useStudioI18n()
const editor = useEditorKernel()

const node = computed(() => {
  void graphEditorHosts.revision.value
  const selection = editor.selection.current.value
  const id = selection.kind === 'graph.node' ? selection.id : null
  if (!id) return null
  const current = graphEditorHosts.getNode(selection.hostId, id)
  return current?.typeId === 'frame.animGen' ? current : null
})

const hostId = computed(() => {
  const selection = editor.selection.current.value
  return selection.kind === 'graph.node' ? selection.hostId ?? '' : ''
})

const { hasInPort, runStatus, isGraphRunning, blocked, toggleRun } = useGraphNodeRun(node)
const typeLabel = computed(() => graphTypeLabel('frame.animGen'))

const state = computed(() =>
  node.value ? readAnim2dFromNode(node.value.params) : { rows: 1, cols: 4 }
)
const systemPrompt = ref('')

watch(
  () => [node.value?.params.generateSystemPrompt, locale.value] as const,
  ([stored]) => {
    systemPrompt.value = resolveFrameAnimGenSystemPrompt(stored, String(locale.value))
  },
  { immediate: true }
)

function clampDim(n: number): number {
  return Math.min(ANIM2D_MAX_DIM, Math.max(1, Math.floor(n) || 1))
}

function patchParams(patch: Record<string, unknown>): void {
  if (!node.value || !hostId.value) return
  graphEditorHosts.updateNode(hostId.value, node.value.id, patch)
}

function onRowsChange(e: Event): void {
  const n = Number((e.target as HTMLInputElement).value)
  if (!Number.isFinite(n)) return
  patchParams({ animRows: clampDim(n) })
}

function onColsChange(e: Event): void {
  const n = Number((e.target as HTMLInputElement).value)
  if (!Number.isFinite(n)) return
  patchParams({ animCols: clampDim(n) })
}

function persistSystemPrompt(): void {
  patchParams({ generateSystemPrompt: systemPrompt.value })
}

/** 删除已生成的输出：清空运行态与该节点的输出参数，便于重新生成 */
function onClearOutput(): void {
  if (!node.value || !hostId.value) return
  const host = graphRunHosts.get(hostId.value)
  if (host && !host.isRunning.value) {
    delete host.runStates[node.value.id]
  }
  graphEditorHosts.updateNode(hostId.value, node.value.id, {
    generatedImages: [],
    selectedImageId: '',
    previewDataUrl: undefined,
    previewRelativePath: '',
    animGridImage: undefined
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

.head h2 {
  margin: 0;
  font-size: 14px;
}

.hint {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.4;
}

.config-row {
  display: flex;
  gap: 12px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--text-muted);
}

.field select,
.field input {
  height: 30px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-input);
  color: var(--text);
  font-size: 13px;
}

.field input {
  width: 76px;
}

.field textarea {
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-input);
  color: var(--text);
  font-size: 13px;
  resize: vertical;
  font-family: inherit;
  line-height: 1.45;
}
</style>
