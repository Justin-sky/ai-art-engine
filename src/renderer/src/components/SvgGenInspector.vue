<template>
  <div
    v-if="node"
    class="node-inspector"
  >
    <div class="head">
      <h2>{{ displayTitle }}</h2>
    </div>
    <p class="hint">
      {{ t('graph.svgGen.inspectorHint') }}
    </p>

    <GraphNodeRunControl
      v-if="hasInPort"
      :status="runStatus"
      :is-running="isGraphRunning"
      :blocked="blocked"
      @toggle="toggleRun"
    />

    <div class="config-row">
      <label class="field">
        <span>{{ t('graph.svgGen.width') }}</span>
        <input
          type="number"
          :min="String(SVG_GEN_SIZE_MIN)"
          :max="String(SVG_GEN_SIZE_MAX)"
          step="1"
          :value="state.width"
          @change="onWidthChange"
        >
      </label>
      <label class="field">
        <span>{{ t('graph.svgGen.height') }}</span>
        <input
          type="number"
          :min="String(SVG_GEN_SIZE_MIN)"
          :max="String(SVG_GEN_SIZE_MAX)"
          step="1"
          :value="state.height"
          @change="onHeightChange"
        >
      </label>
    </div>

    <label class="field">
      <span>{{ t('graph.svgGen.background') }}</span>
      <select
        :value="state.background"
        @change="onBackgroundChange"
      >
        <option value="">
          {{ t('graph.svgGen.bgNone') }}
        </option>
        <option value="white">
          {{ t('graph.svgGen.bgWhite') }}
        </option>
        <option value="black">
          {{ t('graph.svgGen.bgBlack') }}
        </option>
      </select>
    </label>

    <label class="field">
      <span>{{ t('graph.svgGen.instruction') }}</span>
      <textarea
        v-model="instruction"
        class="instruction"
        rows="4"
        :placeholder="t('graph.svgGen.instructionPlaceholder')"
        @change="persistInstruction"
      />
    </label>

    <label class="field">
      <span>{{ t('graph.svgGen.systemPrompt') }}</span>
      <textarea
        v-model="systemPrompt"
        class="instruction"
        rows="6"
        :placeholder="t('graph.svgGen.systemPromptPlaceholder')"
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
  SVG_GEN_SIZE_MAX,
  SVG_GEN_SIZE_MIN,
  readSvgGenFromNode,
  resolveSvgGenSystemPrompt
} from '@shared/graph'
import GraphNodeRunControl from './GraphNodeRunControl.vue'
import GraphNodeOutputPreview from './GraphNodeOutputPreview.vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useNodeDisplayTitle } from '../composables/useNodeDisplayTitle'
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
  return current?.typeId === 'svg.gen' ? current : null
})

const hostId = computed(() => {
  const selection = editor.selection.current.value
  return selection.kind === 'graph.node' ? selection.hostId ?? '' : ''
})

const { hasInPort, runStatus, isGraphRunning, blocked, toggleRun } = useGraphNodeRun(node)
const typeLabel = computed(() => graphTypeLabel('svg.gen'))
const displayTitle = useNodeDisplayTitle(node, typeLabel)

const state = computed(() =>
  node.value
    ? readSvgGenFromNode(node.value.params)
    : { width: 512, height: 512, background: '' as const }
)
const instruction = ref('')
const systemPrompt = ref('')

watch(
  () => node.value?.params.generateInstruction,
  (stored) => {
    instruction.value = stored ?? ''
  },
  { immediate: true }
)

watch(
  () => [node.value?.params.generateSystemPrompt, locale.value] as const,
  ([stored]) => {
    systemPrompt.value = resolveSvgGenSystemPrompt(stored, String(locale.value))
  },
  { immediate: true }
)

function patchParams(patch: Record<string, unknown>): void {
  if (!node.value || !hostId.value) return
  graphEditorHosts.updateNode(hostId.value, node.value.id, patch)
}

function onWidthChange(e: Event): void {
  const n = Number((e.target as HTMLInputElement).value)
  if (!Number.isFinite(n)) return
  patchParams({ svgGenWidth: n })
}

function onHeightChange(e: Event): void {
  const n = Number((e.target as HTMLInputElement).value)
  if (!Number.isFinite(n)) return
  patchParams({ svgGenHeight: n })
}

function onBackgroundChange(e: Event): void {
  const value = (e.target as HTMLSelectElement).value
  patchParams({ svgGenBackground: value === 'white' || value === 'black' ? value : '' })
}

function persistInstruction(): void {
  patchParams({ generateInstruction: instruction.value })
}

function persistSystemPrompt(): void {
  patchParams({ generateSystemPrompt: systemPrompt.value })
}

/** 删除已生成的输出：清空运行态与输出参数，便于重新生成 */
function onClearOutput(): void {
  if (!node.value || !hostId.value) return
  const host = graphRunHosts.get(hostId.value)
  if (host && !host.isRunning.value) {
    delete host.runStates[node.value.id]
  }
  graphEditorHosts.updateNode(hostId.value, node.value.id, {
    generatedSvgs: [],
    selectedSvgId: '',
    previewDataUrl: undefined,
    previewRelativePath: ''
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
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.5;
}

.config-row {
  display: flex;
  gap: 8px;
}

.config-row .field {
  flex: 1;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
}

.field :is(input, select, textarea) {
  width: 100%;
  box-sizing: border-box;
}

.field-note {
  color: var(--text-muted);
}

.instruction {
  resize: vertical;
  font-family: inherit;
}
</style>
