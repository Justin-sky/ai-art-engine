<template>
  <div class="node-inspector" v-if="node">
    <div class="head">
      <h2>{{ node.title || typeLabel }}</h2>
    </div>
    <p class="hint">{{ t('graph.hostInterface.inspectorHint') }}</p>

    <label>
      {{ t('graph.inspector.displayName') }}
      <input v-model="displayName" type="text" @change="persistTitle" />
    </label>

    <GraphNodeRunControl
      v-if="hasInPort"
      :status="runStatus"
      :is-running="isGraphRunning"
      :blocked="blocked"
      @toggle="toggleRun"
    />

    <GraphPortSchemaEditor
      :title="t('graph.hostInterface.inputs')"
      direction="in"
      v-model="inputs"
    />
    <GraphPortSchemaEditor
      :title="t('graph.hostInterface.outputs')"
      direction="out"
      v-model="outputs"
    />

    <button type="button" class="apply-btn" :disabled="saving" @click="applyInterface">
      {{ saving ? t('graph.hostInterface.saving') : t('graph.hostInterface.apply') }}
    </button>
    <p v-if="error" class="err">{{ error }}</p>

    <section class="output-section">
      <h3>{{ t('graph.inspector.outputPreview') }}</h3>
      <GraphNodeOutputPreview v-if="hostId" :node="node" :host-id="hostId" />
    </section>
  </div>
  <div v-else class="node-inspector empty">{{ t('graph.inspector.node.empty') }}</div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import {
  cloneHostInterface,
  ensureBoundaryProxyNodes,
  isAssetRefInputHostType,
  pruneEdgesForHostInterface,
  readHostSchemaVersion,
  resolveNodeHostInterface,
  sanitizeHostInterface,
  type GraphDocument,
  type GraphNode,
  type HostBoundaryPort,
  type HostInterfaceDocument
} from '@shared/graph'
import GraphNodeRunControl from './GraphNodeRunControl.vue'
import GraphNodeOutputPreview from './GraphNodeOutputPreview.vue'
import GraphPortSchemaEditor from './GraphPortSchemaEditor.vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useGraphNodeRun } from '../composables/useGraphNodeRun'
import { useEditorKernel } from '../editor/kernel'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'
import { useProjectStore } from '../stores/project'
import { persistAssetRecord } from '../composables/useAssetRecord'

const { t, graphTypeLabel } = useStudioI18n()
const editor = useEditorKernel()
const project = useProjectStore()

const node = computed((): GraphNode | null => {
  void graphEditorHosts.revision.value
  const selection = editor.selection.current.value
  const id = selection.kind === 'graph.node' ? selection.id : null
  if (!id) return null
  const current = graphEditorHosts.getNode(selection.hostId, id)
  if (!current) return null
  if (current.params?.assetHost !== true) return null
  if (!isAssetRefInputHostType(current.assetType)) return null
  return current
})

const hostId = computed(() => {
  const selection = editor.selection.current.value
  return selection.kind === 'graph.node' ? selection.hostId ?? '' : ''
})

const { hasInPort, runStatus, isGraphRunning, blocked, toggleRun } = useGraphNodeRun(node)

const typeLabel = computed(() =>
  node.value?.typeId ? graphTypeLabel(node.value.typeId) : ''
)

const displayName = ref('')
const inputs = ref<HostBoundaryPort[]>([])
const outputs = ref<HostBoundaryPort[]>([])
const saving = ref(false)
const error = ref('')
const hydrating = ref(false)

function buildDraftInterface(): HostInterfaceDocument {
  return sanitizeHostInterface({
    version: 1,
    inputs: inputs.value,
    outputs: outputs.value
  })
}

function hostPortIdsRemoved(
  previous: HostInterfaceDocument,
  next: HostInterfaceDocument
): boolean {
  const nextIn = new Set(next.inputs.map((p) => p.id))
  const nextOut = new Set(next.outputs.map((p) => p.id))
  if (previous.inputs.some((p) => !nextIn.has(p.id))) return true
  if (previous.outputs.some((p) => !nextOut.has(p.id))) return true
  return false
}

function cloneGraphDocument(doc: GraphDocument): GraphDocument {
  return {
    ...doc,
    nodes: doc.nodes.map((n) => ({ ...n, params: { ...n.params } })),
    edges: [...doc.edges],
    groups: doc.groups?.map((g) => ({ ...g })),
    viewport: doc.viewport ? { ...doc.viewport } : { x: 0, y: 0, zoom: 1 }
  }
}

/**
 * 将接口写入资产定义：同步内图 boundary（含删除多余端口）、落盘，
 * 并更新所有打开图中该宿主实例的快照与外层边。
 */
async function commitHostInterface(iface: HostInterfaceDocument): Promise<void> {
  const current = node.value
  const hid = hostId.value
  if (!current?.assetId || !hid) return
  saving.value = true
  error.value = ''
  try {
    const asset = project.assets.find((a) => a.id === current.assetId)
    const prevGen = asset?.genParams ?? {}
    const nextSchemaVersion = readHostSchemaVersion(prevGen) + 1
    const liveInner = graphEditorHosts.getLiveAssetDocument(current.assetId)
    const storedInner = prevGen.graphJson as GraphDocument | undefined
    const baseInner = liveInner ?? storedInner
    const nextInner = baseInner
      ? ensureBoundaryProxyNodes(cloneGraphDocument(baseInner), iface)
      : ensureBoundaryProxyNodes(
          { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
          iface
        )
    await persistAssetRecord(current.assetId, {
      genParams: {
        ...prevGen,
        graphJson: nextInner,
        hostInterface: cloneHostInterface(iface),
        schemaVersion: nextSchemaVersion
      }
    })
    await project.refreshAssets()

    // 定义内图若正在 dive/独立编辑，先同步 boundary，避免其后续自动保存覆盖刚写入的接口。
    if (graphEditorHosts.getDocument(`asset:${current.assetId}`)) {
      graphEditorHosts.applyExternalGraph(`asset:${current.assetId}`, nextInner)
    }

    let updatedCurrent = false
    for (const entry of graphEditorHosts.listLiveEntries()) {
      const doc = entry.document
      let next = cloneGraphDocument(doc)
      let changed = false
      for (const n of next.nodes) {
        if (n.assetId !== current.assetId) continue
        n.params = {
          ...n.params,
          hostInterfaceSnapshot: cloneHostInterface(iface),
          hostSchemaVersion: nextSchemaVersion
        }
        next = pruneEdgesForHostInterface(next, n.id, iface)
        changed = true
      }
      if (!changed) continue
      graphEditorHosts.applyExternalGraph(entry.hostId, next)
      if (entry.hostId === hid) updatedCurrent = true
    }
    if (!updatedCurrent) {
      graphEditorHosts.updateNode(hid, current.id, {
        hostInterfaceSnapshot: cloneHostInterface(iface),
        hostSchemaVersion: nextSchemaVersion
      })
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    saving.value = false
  }
}

/** 编辑中即时写入实例快照；删除端口时同步去掉内图对应 boundary */
function syncLiveSnapshot(): void {
  const current = node.value
  const hid = hostId.value
  if (!current || !hid || hydrating.value || saving.value) return
  const iface = buildDraftInterface()
  const prev = resolveNodeHostInterface(current)
  if (JSON.stringify(prev) === JSON.stringify(iface)) return
  graphEditorHosts.updateNode(hid, current.id, {
    hostInterfaceSnapshot: cloneHostInterface(iface)
  })
  if (hostPortIdsRemoved(prev, iface)) {
    void commitHostInterface(iface)
  }
}

watch(
  node,
  async (current) => {
    if (!current) return
    hydrating.value = true
    const assetName = current.assetId
      ? project.assets.find((a) => a.id === current.assetId)?.name?.trim() || ''
      : ''
    displayName.value = current.title?.trim() || assetName
    const iface = resolveNodeHostInterface(current)
    inputs.value = iface.inputs.map((p) => ({ ...p }))
    outputs.value = iface.outputs.map((p) => ({ ...p }))
    error.value = ''
    await nextTick()
    hydrating.value = false
  },
  { immediate: true }
)

watch([inputs, outputs], () => syncLiveSnapshot(), { deep: true })

function persistTitle(): void {
  const current = node.value
  const hid = hostId.value
  if (!current || !hid) return
  const trimmed = displayName.value.trim()
  const assetName = current.assetId
    ? project.assets.find((a) => a.id === current.assetId)?.name?.trim() || ''
    : ''
  const prev = current.title?.trim() || assetName
  if (trimmed === prev) {
    displayName.value = prev
    return
  }
  // 仅改画布节点显示名，不改资产库原名；清空则回退显示资产名
  graphEditorHosts.updateNode(
    hid,
    current.id,
    {},
    !trimmed || trimmed === assetName ? '' : trimmed
  )
  displayName.value = trimmed || assetName
}

async function applyInterface(): Promise<void> {
  await commitHostInterface(buildDraftInterface())
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
.head h2 {
  margin: 0;
  font-size: 15px;
}
.hint {
  margin: 0;
  font-size: 12px;
  opacity: 0.75;
}
.apply-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border));
  border-radius: 8px;
  background: var(--bg-elevated);
  color: var(--accent);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.apply-btn:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent) 14%, var(--bg-elevated));
}
.apply-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.err {
  color: #c44;
  font-size: 12px;
  margin: 0;
}
.output-section h3 {
  margin: 0 0 6px;
  font-size: 13px;
}
.empty {
  padding: 12px;
  opacity: 0.7;
}
</style>
