<template>
  <div v-if="node" class="node-inspector">
    <div class="head">
      <span class="type">{{ typeLabel }}</span>
      <h2>{{ displayTitle }}</h2>
    </div>

    <p class="hint">{{ t('graph.portrait.hint') }}</p>

    <div class="stat">
      <span class="stat-label">{{ t('graph.portrait.inspectorChanged') }}</span>
      <span class="stat-value">{{ changedCount }}</span>
    </div>
    <div v-if="strokeCount" class="stat">
      <span class="stat-label">{{ t('graph.portrait.inspectorStrokes') }}</span>
      <span class="stat-value">{{ strokeCount }}</span>
    </div>
    <div v-if="idPhotoSpec" class="stat">
      <span class="stat-label">{{ t('graph.portrait.fields.idPhotoSpecId') }}</span>
      <span class="stat-value">{{ t(`graph.portrait.options.${idPhotoSpec}`) }}</span>
    </div>
    <div v-if="bakedPath" class="stat">
      <span class="stat-label">{{ t('graph.portrait.inspectorBaked') }}</span>
      <span class="stat-value path" :title="bakedPath">{{ bakedPath }}</span>
    </div>

    <div class="actions">
      <button type="button" class="primary" @click="openEditor">
        {{ t('graph.portrait.inspectorOpen') }}
      </button>
      <button type="button" class="ghost" :disabled="changedCount === 0" @click="resetParams">
        {{ t('graph.portrait.reset') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject } from 'vue'
import { changedPortraitParamCount, normalizePortraitRetouch } from '@shared/graph'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useNodeDisplayTitle } from '../composables/useNodeDisplayTitle'
import { useEditorKernel } from '../editor/kernel'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'
import { editorDiveKey } from '../features/graph/model/editorDive'
import { graphEditorNodeTools } from '../features/graph/ui/graphEditorNodeTools'

const { t, graphTypeLabel } = useStudioI18n()
const editor = useEditorKernel()
const editorDive = inject(editorDiveKey, null)

const node = computed(() => {
  void graphEditorHosts.revision.value
  const selection = editor.selection.current.value
  const id = selection.kind === 'graph.node' ? selection.id : null
  if (!id) return null
  const current = graphEditorHosts.getNode(selection.hostId, id)
  return current?.typeId === 'image.portrait' ? current : null
})

const hostId = computed(() => {
  const selection = editor.selection.current.value
  return selection.kind === 'graph.node' ? (selection.hostId ?? '') : ''
})

const typeLabel = computed(() => graphTypeLabel('image.portrait'))
const displayTitle = useNodeDisplayTitle(node, typeLabel)

const changedCount = computed(() => {
  const current = node.value
  if (!current) return 0
  return changedPortraitParamCount(normalizePortraitRetouch(current.params.portraitRetouch))
})

const strokeCount = computed(() => node.value?.params.portraitStrokes?.length ?? 0)
const idPhotoSpec = computed(() => {
  const value = node.value?.params.portraitRetouch?.idPhotoSpecId
  return value && value !== 'none' ? value : ''
})
const bakedPath = computed(() => node.value?.params.portraitBakedRelativePath?.trim() ?? '')

async function openEditor(): Promise<void> {
  const current = node.value
  if (!current || !hostId.value) return
  try {
    await graphEditorHosts.flush(hostId.value)
  } catch (err) {
    console.error('[PortraitInspector] flush before dive failed', err)
  }
  await graphEditorNodeTools.open(hostId.value, 'node.portrait', current.id)
  await editorDive?.diveView(
    { viewId: 'node.portrait', hostId: hostId.value, nodeId: current.id },
    current.title || typeLabel.value
  )
}

function resetParams(): void {
  const current = node.value
  if (!current || !hostId.value) return
  graphEditorHosts.updateNode(hostId.value, current.id, {
    portraitRetouch: normalizePortraitRetouch(),
    portraitStrokes: []
  })
}
</script>

<style scoped>
.node-inspector {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  height: 100%;
  overflow: auto;
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
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.6;
}

.stat {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
}

.stat-label {
  color: var(--text-muted);
}

.stat-value {
  color: var(--text);
}

.stat-value.path {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}

.primary {
  flex: 1;
  padding: 6px 10px;
  border: 1px solid var(--accent);
  border-radius: 4px;
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  color: var(--accent);
  font-size: 12px;
  cursor: pointer;
}

.ghost {
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
}

.ghost:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
