<template>
  <div class="director-editor">
    <div v-if="!embedded && !diving" class="toolbar">
      <span>{{ t('director.title') }}</span>
      <span class="spacer" />
      <span class="hint">{{ t('director.hint.graph') }}</span>
      <GraphToolbarCollapseBtn v-model="toolbarCollapsed" />
    </div>
    <NodeGraphEditor
      v-show="!diving"
      class="director-graph"
      :asset-id="directorAssetId"
      :hide-toolbar="!embedded && toolbarCollapsed"
    />
    <EditorDiveChildHost :frame="diving ? diveTop : null" />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, provide, ref } from 'vue'
import {
  createDefaultDirectorViewer,
  type DirectorViewerState
} from '@shared/domain'
import { isDirectorProcessingNode } from '@shared/graph'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useEditorDiveHost } from '../composables/useEditorDiveHost'
import { useAssetRecord } from '../composables/useAssetRecord'
import { useProjectStore } from '../stores/project'
import { resolveDirectorStageForNode } from '../features/director/directorStageBinding'
import { directorPreviewKey } from '../features/director/directorPreview'
import NodeGraphEditor from './NodeGraphEditor.vue'
import GraphToolbarCollapseBtn from './GraphToolbarCollapseBtn.vue'
import EditorDiveChildHost from './EditorDiveChildHost.vue'

const props = defineProps<{
  directorAssetId: string
  embedded?: boolean
}>()

const { t } = useStudioI18n()
const project = useProjectStore()
const { asset: directorAsset } = useAssetRecord(props.directorAssetId)
const previewUrl = ref('')
const stageWindowOpen = ref(false)
const toolbarCollapsed = ref(false)

const rootTitle = computed(
  () => directorAsset.value?.name?.trim() || t('studio.dive.root')
)
const { diving, diveTop } = useEditorDiveHost({
  kind: 'director',
  assetId: () => props.directorAssetId,
  rootTitle,
  enabled: () => !props.embedded
})

let stopPreviewListener: (() => void) | null = null
let stopClosedListener: (() => void) | null = null

function graphHostId(): string {
  return `asset:${props.directorAssetId}`
}

function directorProcessingNode(nodeId?: string | null) {
  if (nodeId) {
    return graphEditorHosts.findNode(
      graphHostId(),
      (node) => node.id === nodeId && isDirectorProcessingNode(node)
    )
  }
  return graphEditorHosts.findNode(graphHostId(), isDirectorProcessingNode)
}

function readViewerFromGraph(): DirectorViewerState {
  return directorProcessingNode()?.params.viewer ?? createDefaultDirectorViewer()
}

function setViewer(viewer: DirectorViewerState): void {
  const node = directorProcessingNode()
  if (node) graphEditorHosts.updateNode(graphHostId(), node.id, { viewer })
}

async function openStageView(processingNodeId?: string | null): Promise<void> {
  const node = directorProcessingNode(processingNodeId) ?? directorProcessingNode()
  await window.studio.openStageWindow(props.directorAssetId, node?.id)
  stageWindowOpen.value = true
}

onMounted(() => {
  stopPreviewListener = window.studio.onStagePreview((payload) => {
    if (payload.directorAssetId !== props.directorAssetId) return
    const node =
      directorProcessingNode(payload.processingNodeId) ??
      (payload.processingNodeId ? null : directorProcessingNode())
    if (node && payload.previewUrl) {
      graphEditorHosts.updateNode(graphHostId(), node.id, {
        previewDataUrl: payload.previewUrl
      })
    }
    previewUrl.value = payload.previewUrl
  })
  stopClosedListener = window.studio.onStageClosed((payload) => {
    if (payload.directorAssetId !== props.directorAssetId) return
    stageWindowOpen.value = false
    void (async () => {
      await project.refreshAssets()
      const asset = project.assets.find((item) => item.id === props.directorAssetId)
      const nodeId = payload.processingNodeId ?? null
      const node = directorProcessingNode(nodeId) ?? directorProcessingNode()
      if (!node || !asset) return
      const stage = resolveDirectorStageForNode(asset.genParams, asset.genParams?.graphJson, node.id)
      const graphNode =
        (asset.genParams?.graphJson as { nodes?: Array<{ id: string; params?: Record<string, unknown> }> } | undefined)
          ?.nodes?.find((item) => item.id === node.id) ?? null
      const shots = [...(stage.cameraShots ?? [])]
      const fromGraph =
        (typeof graphNode?.params?.previewDataUrl === 'string' && graphNode.params.previewDataUrl) ||
        (Array.isArray(graphNode?.params?.cameraShots) &&
          (graphNode.params.cameraShots as Array<{ dataUrl?: string }>)[0]?.dataUrl) ||
        ''
      const preview =
        shots[0]?.dataUrl ||
        fromGraph ||
        node.params.previewDataUrl ||
        ''
      graphEditorHosts.updateNode(graphHostId(), node.id, {
        cameraShots: shots.length ? shots : node.params.cameraShots,
        previewDataUrl: preview || node.params.previewDataUrl
      })
      if (preview) previewUrl.value = preview
    })()
  })
})

onBeforeUnmount(() => {
  stopPreviewListener?.()
  stopClosedListener?.()
  stopPreviewListener = null
  stopClosedListener = null
})

provide(directorPreviewKey, {
  previewUrl,
  getViewer: readViewerFromGraph,
  setViewer,
  openStageView
})
</script>

<style scoped>
.director-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  position: relative;
  background: var(--bg-panel);
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
  color: var(--text-muted);
  flex-shrink: 0;
}

.spacer {
  flex: 1;
}

.hint {
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.director-graph {
  flex: 1;
  min-height: 0;
  min-width: 0;
}
</style>
