<template>
  <div v-if="node" class="node-inspector">
    <div class="head">
      <h2>{{ displayTitle }}</h2>
    </div>
    <p class="hint">
      {{ t('graph.gameHtmlGen.inspectorHint') }}
    </p>

    <GraphNodeRunControl
      v-if="hasInPort"
      :status="runStatus"
      :is-running="isGraphRunning"
      :blocked="blocked"
      @toggle="toggleRun"
    />

    <label class="field">
      <span>{{ t('graph.gameHtmlGen.mode') }}</span>
      <select v-model="playMode" @change="persistMode">
        <option value="auto">{{ t('graph.gameHtmlGen.modeAuto') }}</option>
        <option value="2d">{{ t('graph.gameHtmlGen.mode2d') }}</option>
        <option value="3d">{{ t('graph.gameHtmlGen.mode3d') }}</option>
      </select>
    </label>

    <label class="field">
      <span>{{ t('graph.gameHtmlGen.instruction') }}</span>
      <textarea
        v-model="instruction"
        class="instruction"
        rows="4"
        :placeholder="t('graph.gameHtmlGen.instructionPlaceholder')"
        @change="persistInstruction"
      />
    </label>

    <p v-if="projectDir" class="meta" :title="projectDir">
      {{ t('graph.gameHtmlGen.projectDir') }}：{{ projectDir }}
    </p>

    <GraphNodeOutputPreview
      v-if="hostId"
      :node="node"
      :host-id="hostId"
      clearable
      @clear-output="onClearOutput"
    />
  </div>
  <div v-else class="node-inspector empty">
    {{ t('graph.inspector.node.empty') }}
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import GraphNodeRunControl from './GraphNodeRunControl.vue'
import GraphNodeOutputPreview from './GraphNodeOutputPreview.vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useNodeDisplayTitle } from '../composables/useNodeDisplayTitle'
import { useGraphNodeRun } from '../composables/useGraphNodeRun'
import { useEditorKernel } from '../editor/kernel'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'
import { graphRunHosts } from '../features/graph/model/graphRunHosts'

const { t, graphTypeLabel } = useStudioI18n()
const editor = useEditorKernel()

const node = computed(() => {
  void graphEditorHosts.revision.value
  const selection = editor.selection.current.value
  const id = selection.kind === 'graph.node' ? selection.id : null
  if (!id) return null
  const current = graphEditorHosts.getNode(selection.hostId, id)
  return current?.typeId === 'game.htmlGen' ? current : null
})

const hostId = computed(() => {
  const selection = editor.selection.current.value
  return selection.kind === 'graph.node' ? (selection.hostId ?? '') : ''
})

const { hasInPort, runStatus, isGraphRunning, blocked, toggleRun } = useGraphNodeRun(node)
const typeLabel = computed(() => graphTypeLabel('game.htmlGen'))
const displayTitle = useNodeDisplayTitle(node, typeLabel)

const instruction = ref('')
const playMode = ref<'auto' | '2d' | '3d'>('auto')

const projectDir = computed(() => node.value?.params.gamePlayProjectDir?.trim() || '')

watch(
  () => node.value?.params.generateInstruction,
  (stored) => {
    instruction.value = stored ?? ''
  },
  { immediate: true }
)

watch(
  () => node.value?.params.gamePlayMode,
  (stored) => {
    const v = typeof stored === 'string' ? stored.trim().toLowerCase() : ''
    playMode.value = v === '2d' || v === '3d' || v === 'auto' ? v : 'auto'
  },
  { immediate: true }
)

function persistInstruction(): void {
  if (!node.value || !hostId.value) return
  graphEditorHosts.updateNode(hostId.value, node.value.id, {
    generateInstruction: instruction.value
  })
}

function persistMode(): void {
  if (!node.value || !hostId.value) return
  graphEditorHosts.updateNode(hostId.value, node.value.id, {
    gamePlayMode: playMode.value
  })
}

function onClearOutput(): void {
  if (!node.value || !hostId.value) return
  const host = graphRunHosts.get(hostId.value)
  if (host && !host.isRunning.value) {
    delete host.runStates[node.value.id]
  }
  graphEditorHosts.updateNode(hostId.value, node.value.id, {
    generatedTexts: [],
    selectedTextId: '',
    gamePlayHtml: '',
    gamePlayHtmlPath: '',
    gamePlayProjectDir: '',
    text: ''
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

.instruction {
  resize: vertical;
  font-family: inherit;
}

.meta {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.4;
  word-break: break-all;
}
</style>
