<template>
  <section v-if="asset" class="host-iface-panel">
    <p class="hint">{{ t('graph.hostInterface.assetInspectorHint') }}</p>
    <GraphPortSchemaEditor
      :title="t('graph.hostInterface.inputs')"
      direction="in"
      :default-collapsed="false"
      v-model="inputs"
    />
    <GraphPortSchemaEditor
      :title="t('graph.hostInterface.outputs')"
      direction="out"
      :default-collapsed="false"
      v-model="outputs"
    />
    <button type="button" class="apply-btn" :disabled="saving || !dirty" @click="applyInterface">
      {{ saving ? t('graph.hostInterface.saving') : t('graph.hostInterface.apply') }}
    </button>
    <p v-if="error" class="err">{{ error }}</p>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import {
  cloneHostInterface,
  ensureBoundaryProxyNodes,
  pruneEdgesForHostInterface,
  readHostInterfaceFromGenParams,
  readHostSchemaVersion,
  sanitizeHostInterface,
  type GraphDocument,
  type HostBoundaryPort,
  type HostInterfaceDocument
} from '@shared/graph'
import type { AssetInfo } from '@shared/domain'
import GraphPortSchemaEditor from './GraphPortSchemaEditor.vue'
import { persistAssetRecord } from '../composables/useAssetRecord'
import { useStudioI18n } from '../composables/useStudioI18n'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'
import { useProjectStore } from '../stores/project'
import { toPlain } from '../utils/toPlain'

const props = defineProps<{
  asset: AssetInfo
}>()

const { t } = useStudioI18n()
const project = useProjectStore()

const inputs = ref<HostBoundaryPort[]>([])
const outputs = ref<HostBoundaryPort[]>([])
const baseline = ref('')
const saving = ref(false)
const error = ref('')
const hydrating = ref(false)

const dirty = computed(() => {
  const draft = JSON.stringify(buildDraftInterface())
  return draft !== baseline.value
})

function buildDraftInterface(): HostInterfaceDocument {
  return sanitizeHostInterface({
    version: 1,
    inputs: inputs.value,
    outputs: outputs.value
  })
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

function hydrateFromAsset(asset: AssetInfo): void {
  hydrating.value = true
  const iface = readHostInterfaceFromGenParams(asset.genParams, asset.type)
  inputs.value = iface.inputs.map((p) => ({ ...p }))
  outputs.value = iface.outputs.map((p) => ({ ...p }))
  baseline.value = JSON.stringify(
    sanitizeHostInterface({ version: 1, inputs: inputs.value, outputs: outputs.value })
  )
  error.value = ''
  void nextTick(() => {
    hydrating.value = false
  })
}

watch(
  () => props.asset,
  (asset) => {
    if (asset) hydrateFromAsset(asset)
  },
  { immediate: true }
)

async function applyInterface(): Promise<void> {
  const asset = props.asset
  if (!asset || saving.value) return
  saving.value = true
  error.value = ''
  try {
    const iface = buildDraftInterface()
    const prevGen = asset.genParams ?? {}
    const nextSchemaVersion = readHostSchemaVersion(prevGen) + 1
    const liveInner = graphEditorHosts.getLiveAssetDocument(asset.id)
    const storedInner = prevGen.graphJson as GraphDocument | undefined
    const baseInner = liveInner ?? storedInner
    const nextInner = baseInner
      ? ensureBoundaryProxyNodes(cloneGraphDocument(baseInner), iface)
      : ensureBoundaryProxyNodes(
          { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
          iface
        )
    await persistAssetRecord(asset.id, {
      genParams: toPlain({
        ...prevGen,
        graphJson: nextInner,
        hostInterface: cloneHostInterface(iface),
        schemaVersion: nextSchemaVersion
      })
    })
    await project.refreshAssets()

    if (graphEditorHosts.getDocument(`asset:${asset.id}`)) {
      graphEditorHosts.applyExternalGraph(`asset:${asset.id}`, nextInner)
    }
    for (const entry of graphEditorHosts.listLiveEntries()) {
      const doc = entry.document
      let next = cloneGraphDocument(doc)
      let changed = false
      for (const n of next.nodes) {
        if (n.assetId !== asset.id) continue
        n.params = {
          ...n.params,
          hostInterfaceSnapshot: cloneHostInterface(iface),
          hostSchemaVersion: nextSchemaVersion
        }
        next = pruneEdgesForHostInterface(next, n.id, iface)
        changed = true
      }
      if (changed) graphEditorHosts.applyExternalGraph(entry.hostId, next)
    }

    baseline.value = JSON.stringify(iface)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.host-iface-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 4px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
}
.hint {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
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
  margin: 0;
  font-size: 12px;
  color: var(--danger, #c44);
}
</style>
