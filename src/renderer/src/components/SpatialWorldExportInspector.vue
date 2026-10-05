<template>
  <div v-if="node" class="node-inspector">
    <header class="node-head">
      <span class="node-title">{{ displayTitle }}</span>
      <span class="node-type">{{ typeLabel }}</span>
    </header>

    <GraphNodeRunControl
      v-if="hasInPort"
      :status="runStatus"
      :disabled="isGraphRunning || blocked"
      @run="toggleRun"
    />

    <section class="export-config">
      <label class="field">
        <span class="field-label">{{ t('graph.spatialWorldExport.mode') }}</span>
        <select :value="mode" @change="onMode">
          <option value="mesh">{{ t('graph.spatialWorldExport.modes.mesh') }}</option>
          <option value="splats">{{ t('graph.spatialWorldExport.modes.splats') }}</option>
        </select>
      </label>

      <label v-if="mode === 'mesh'" class="field">
        <span class="field-label">{{ t('graph.spatialWorldExport.variant') }}</span>
        <select :value="variant" @change="onVariant">
          <option value="textured">{{ t('graph.spatialWorldExport.variants.textured') }}</option>
          <option value="vertex_colored">
            {{ t('graph.spatialWorldExport.variants.vertexColored') }}
          </option>
        </select>
      </label>

      <label v-else class="field">
        <span class="field-label">{{ t('graph.spatialWorldExport.resolution') }}</span>
        <select :value="resolution" @change="onResolution">
          <option value="full_res">{{ t('graph.spatialWorldExport.resolutions.fullRes') }}</option>
          <option value="500k">{{ t('graph.spatialWorldExport.resolutions.k500') }}</option>
          <option value="150k">{{ t('graph.spatialWorldExport.resolutions.k150') }}</option>
          <option value="100k">{{ t('graph.spatialWorldExport.resolutions.k100') }}</option>
        </select>
      </label>
    </section>

    <p class="hint">{{ hint }}</p>

    <p v-if="lastPath" class="hint">
      {{ t('graph.spatialWorldExport.lastOutput') }}
      <code :title="lastPath">{{ lastPath }}</code>
    </p>

    <!--
      产物区两种模式都要显示：mesh 出 GLB、splats 出 PLY（都登记为模型资产），
      只在网格模式下显示会让「导出泼溅」看起来像什么都没发生。
    -->
    <GeneratedModelsGallery
      v-if="hostId"
      :node="node"
      :host-id="hostId"
      :extra-items="worldExtraItems"
    />

    <!--
      能转起来看的 3D 预览窗：导出 HQ 网格 / PLY 泼溅之后，
      用户得能确认「导出的到底是什么」，而不是只看到一行路径。
      复用模型生成节点那套预览（含泼溅的 Spark 渲染），不另造一个。
    -->
    <section v-if="previewPath" class="model-preview-section">
      <div class="section-head">
        <span class="section-title">{{ t('graph.inspector.generate.modelPreview') }}</span>
      </div>
      <ModelPreview :relative-path="previewPath" :show-save-to-library="true" />
    </section>

    <GraphNodeOutputPreview v-if="hostId" :node="node" :host-id="hostId" />
  </div>
  <div v-else class="node-inspector empty">
    {{ t('graph.inspector.node.empty') }}
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import GraphNodeRunControl from './GraphNodeRunControl.vue'
import GraphNodeOutputPreview from './GraphNodeOutputPreview.vue'
import GeneratedModelsGallery from './GeneratedModelsGallery.vue'
import ModelPreview from './ModelPreview.vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useNodeDisplayTitle } from '../composables/useNodeDisplayTitle'
import { useGraphNodeRun } from '../composables/useGraphNodeRun'
import { useEditorKernel } from '../editor/kernel'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'

/**
 * 空间世界导出节点（`spatialWorld.export`）inspector：选资产族与档位。
 *
 * 官方两条路差别很大，必须让用户看得见：
 * - `mesh`（HQ 贴图 / 顶点色网格，GLB）：异步导出，**最长约 1 小时、限速 4 次/小时、单独计费**，
 *   产物是模型资产，可接导演台或下游 3D 加工节点；
 * - `splats`（PLY 泼溅）：官方同步转换，落在上游世界产物旁边（`world.ply`），
 *   登记为模型资产（导演台可直接用；应用内也能用 3D 预览窗看它）。
 */
const { t, graphTypeLabel } = useStudioI18n()
const editor = useEditorKernel()

const node = computed(() => {
  void graphEditorHosts.revision.value
  const selection = editor.selection.current.value
  const id = selection.kind === 'graph.node' ? selection.id : null
  if (!id) return null
  const current = graphEditorHosts.getNode(selection.hostId, id)
  return current?.typeId === 'spatialWorld.export' ? current : null
})

const hostId = computed(() => {
  const selection = editor.selection.current.value
  return selection.kind === 'graph.node' ? (selection.hostId ?? '') : ''
})

const { hasInPort, runStatus, isGraphRunning, blocked, toggleRun } = useGraphNodeRun(node)

const typeLabel = computed(() => graphTypeLabel('spatialWorld.export'))
const displayTitle = useNodeDisplayTitle(node, typeLabel)

const mode = computed((): 'mesh' | 'splats' =>
  node.value?.params.spatialWorldExportMode === 'splats' ? 'splats' : 'mesh'
)
const variant = computed(() =>
  node.value?.params.spatialWorldExportVariant === 'vertex_colored' ? 'vertex_colored' : 'textured'
)
const resolution = computed(() => node.value?.params.spatialWorldExportResolution ?? 'full_res')
const lastPath = computed(() => node.value?.params.spatialWorldExportRelativePath?.trim() ?? '')

/**
 * 预览哪个产物：优先「图库里当前选中的那条」，没有图库时退回上次导出路径。
 * 刚导出完还没写回图库的那一瞬间也要有得看，所以 lastPath 是兜底而不是可选。
 */
const previewPath = computed(() => {
  const current = node.value
  if (!current) return ''
  const models = (current.params.generatedModels ?? []).filter((item) => item.relativePath?.trim())
  if (models.length) {
    const selectedId = current.params.selectedModelId?.trim() ?? ''
    const picked =
      (selectedId ? models.find((item) => item.id?.trim() === selectedId) : undefined) ??
      models[models.length - 1]
    const pickedPath = picked?.relativePath?.trim()
    if (pickedPath) return pickedPath
  }
  return lastPath.value
})

/**
 * 上游世界随世界**免费**返回的附加产物（SPZ 泼溅 / 全景图）。
 *
 * 它们不是本节点 Cook 出来的（不进 `generatedModels`），但正是同一个世界的「另一面」：
 * 导出 HQ 网格的人往往也想看一眼泼溅，不该逼他再跑一次付费的 PLY 导出才知道有没有。
 * 路径记在上游世界生成节点的 `spatialWorldExtras` 上。
 */
const worldExtraItems = computed(() => {
  const current = node.value
  if (!current || !hostId.value) return []
  const sourceIds = [
    ...new Set(
      graphEditorHosts.listIncomingEdges(hostId.value, current.id).map((edge) => edge.sourceNodeId)
    )
  ]
  const items: Array<{ key: string; relativePath: string; label?: string }> = []
  for (const sourceId of sourceIds) {
    const source = graphEditorHosts.getNode(hostId.value, sourceId)
    for (const extra of source?.params.spatialWorldExtras ?? []) {
      const relativePath = extra.relativePath?.trim()
      if (!relativePath) continue
      const key = `world-extra:${extra.kind}:${relativePath}`
      if (items.some((item) => item.key === key)) continue
      items.push({
        key,
        relativePath,
        label: t(`graph.spatialWorldExport.worldExtras.${extra.kind}`)
      })
    }
  }
  return items
})

const hint = computed(() =>
  mode.value === 'mesh'
    ? t('graph.spatialWorldExport.meshHint')
    : t('graph.spatialWorldExport.splatsHint')
)

function patchParams(patch: Record<string, unknown>): void {
  const current = node.value
  const hid = hostId.value
  if (!current || !hid) return
  graphEditorHosts.updateNode(hid, current.id, patch)
}

function onMode(event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  patchParams({ spatialWorldExportMode: value === 'splats' ? 'splats' : 'mesh' })
}

function onVariant(event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  patchParams({
    spatialWorldExportVariant: value === 'vertex_colored' ? 'vertex_colored' : 'textured'
  })
}

function onResolution(event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  patchParams({
    spatialWorldExportResolution:
      value === '500k' || value === '150k' || value === '100k' ? value : 'full_res'
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

.model-preview-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.section-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
}

.node-head {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.node-title {
  font-size: 13px;
  font-weight: 600;
}

.node-type {
  font-size: 11px;
  color: var(--text-muted);
}

.export-config {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.field-label {
  font-size: 12px;
  color: var(--text-muted);
}

select {
  flex: 1;
  min-width: 0;
  max-width: 160px;
  height: 26px;
  padding: 0 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-input);
  color: var(--text);
  font-size: 12px;
}

select:hover,
select:focus {
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
  outline: none;
}

.hint {
  margin: 0;
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-muted);
}

.hint code {
  user-select: text;
}

.node-inspector.empty {
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: var(--text-muted);
  text-align: center;
}
</style>
