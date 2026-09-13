<template>
  <div v-if="node" class="node-inspector">
    <div class="head">
      <h2>{{ displayTitle }}</h2>
    </div>
    <p class="hint">
      {{ t('graph.inspector.iconPack.hint') }}
    </p>

    <GraphNodeRunControl
      v-if="hasInPort"
      :status="runStatus"
      :is-running="isGraphRunning"
      :blocked="blocked"
      @toggle="toggleRun"
    />

    <GraphNodeOutputPreview v-if="node && hostId" :node="node" :host-id="hostId" />

    <dl class="meta">
      <div>
        <dt>{{ t('graph.iconPack.gridLabel') }}</dt>
        <dd>{{ gridLabel }}</dd>
      </div>
      <div>
        <dt>{{ t('graph.iconPack.keyColorLabel') }}</dt>
        <dd>{{ keyColorLabel }}</dd>
      </div>
      <div>
        <dt>{{ t('graph.iconPack.keyingRangeLabel') }}</dt>
        <dd>{{ keyingRangeLabel }}</dd>
      </div>
      <div>
        <dt>{{ t('graph.iconPack.edgeLabel') }}</dt>
        <dd>{{ edgeLabel }}</dd>
      </div>
      <div>
        <dt>{{ t('graph.iconPack.canvasLabel') }}</dt>
        <dd>{{ canvasLabel }}</dd>
      </div>
      <div>
        <dt>{{ t('graph.iconPack.outputDirLabel') }}</dt>
        <dd>{{ outputDirLabel }}</dd>
      </div>
      <div v-if="manifestLabel">
        <dt>{{ t('graph.iconPack.manifestLabel') }}</dt>
        <dd>{{ manifestLabel }}</dd>
      </div>
    </dl>
  </div>
  <div v-else class="node-inspector empty">
    {{ t('graph.inspector.node.empty') }}
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { readIconPackFromNode } from '@shared/graph'
import GraphNodeRunControl from './GraphNodeRunControl.vue'
import GraphNodeOutputPreview from './GraphNodeOutputPreview.vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useNodeDisplayTitle } from '../composables/useNodeDisplayTitle'
import { useGraphNodeRun } from '../composables/useGraphNodeRun'
import { useEditorKernel } from '../editor/kernel'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'

const { t, graphTypeLabel } = useStudioI18n()
const editor = useEditorKernel()

const node = computed(() => {
  void graphEditorHosts.revision.value
  const selection = editor.selection.current.value
  const id = selection.kind === 'graph.node' ? selection.id : null
  if (!id) return null
  const current = graphEditorHosts.getNode(selection.hostId, id)
  return current?.typeId === 'image.iconPack' ? current : null
})

const hostId = computed(() => {
  const selection = editor.selection.current.value
  return selection.kind === 'graph.node' ? (selection.hostId ?? '') : ''
})

const { hasInPort, runStatus, isGraphRunning, blocked, toggleRun } = useGraphNodeRun(node)
const typeLabel = computed(() => graphTypeLabel('image.iconPack'))
const displayTitle = useNodeDisplayTitle(node, typeLabel)

const state = computed(() => (node.value ? readIconPackFromNode(node.value.params) : null))

const params = computed(() => node.value?.params ?? {})

const gridLabel = computed(() => {
  const s = state.value
  if (!s) return '—'
  return `${s.rows}×${s.cols}`
})

const keyColorLabel = computed(() => {
  const mode = state.value?.keyColor
  if (!mode) return '—'
  return t(`graph.iconPack.keyColorMode.${mode}`)
})

const keyingRangeLabel = computed(() => {
  const s = state.value
  if (!s) return '—'
  return `${s.distance} · ${s.feather}`
})

const edgeLabel = computed(() => {
  const edge = state.value?.edgeInset
  if (edge === 'auto') return t('graph.iconPack.edgeInsetAuto')
  if (typeof edge === 'number') return `${edge}px`
  return '—'
})

const canvasLabel = computed(() => {
  const size = state.value?.canvasSize
  if (!size) return t('graph.iconPack.canvasAuto')
  return `${size}px`
})

const outputDirLabel = computed(() => {
  const dir = (params.value.mediaOutputDir as string | undefined)?.trim()
  return dir || '—'
})

const manifestLabel = computed(() => {
  const path = (params.value.iconPackManifestRelativePath as string | undefined)?.trim()
  return path || ''
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

.meta {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
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
  color: var(--text);
  text-align: right;
  word-break: break-all;
}
</style>
