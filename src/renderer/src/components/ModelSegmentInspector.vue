<template>
  <div v-if="node" class="node-inspector">
    <div class="head">
      <span class="type">{{ typeLabel }}</span>
      <h2>{{ displayTitle }}</h2>
    </div>
    <p class="hint">
      {{ t('graph.inspector.modelSegment.hint') }}
    </p>

    <GraphNodeRunControl
      v-if="hasInPort"
      :status="runStatus"
      :is-running="isGraphRunning"
      :blocked="blocked"
      @toggle="toggleRun"
    />

    <div v-if="modelPreviewPath" class="preview-slot">
      <ModelPreview :relative-path="modelPreviewPath" :show-save-to-library="true" />
    </div>
    <p v-else class="section-hint preview-missing">
      {{ t('graph.inspector.modelSegment.previewEmpty') }}
    </p>

    <section class="parts-panel">
      <h4>{{ t('graph.inspector.modelSegment.partsTitle', { n: parts.length }) }}</h4>
      <ul v-if="parts.length" class="parts-list">
        <li v-for="part in parts" :key="part" class="parts-item">{{ part }}</li>
      </ul>
      <p v-else class="section-hint">{{ t('graph.inspector.modelSegment.partsEmpty') }}</p>
      <p v-if="parts.length" class="section-hint">
        {{ t('graph.inspector.modelSegment.partsHint') }}
      </p>
    </section>

    <section v-if="description" class="meta-panel">
      <h4>{{ t('graph.inspector.modelSegment.description') }}</h4>
      <p class="meta-text">{{ description }}</p>
    </section>

    <section v-if="maskUrl" class="meta-panel">
      <h4>{{ t('graph.inspector.modelSegment.mask') }}</h4>
      <img class="mask-image" :src="maskUrl" :alt="t('graph.inspector.modelSegment.mask')" />
      <p class="section-hint">{{ t('graph.inspector.modelSegment.maskHint') }}</p>
    </section>

    <GeneratedModelsGallery v-if="hostId" :node="node" :host-id="hostId" />
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
import { graphRunHosts } from '../features/graph/model/graphRunHosts'

/**
 * 3D 模型拆分节点（`model.segment`）inspector：
 * 预览上游模型 + 列出 Cook 解析出的部件名（= 拆分后 GLB 的 node 名），
 * 智能分割额外展示 Tripo 的部件描述与 mask 图。
 */
const { t, graphTypeLabel } = useStudioI18n()
const editor = useEditorKernel()

const node = computed(() => {
  void graphEditorHosts.revision.value
  const selection = editor.selection.current.value
  const id = selection.kind === 'graph.node' ? selection.id : null
  if (!id) return null
  const current = graphEditorHosts.getNode(selection.hostId, id)
  return current?.typeId === 'model.segment' ? current : null
})

const hostId = computed(() => {
  const selection = editor.selection.current.value
  return selection.kind === 'graph.node' ? (selection.hostId ?? '') : ''
})

const { hasInPort, runStatus, isGraphRunning, blocked, toggleRun } = useGraphNodeRun(node)

const typeLabel = computed(() => graphTypeLabel('model.segment'))
const displayTitle = useNodeDisplayTitle(node, typeLabel)

/** 预览源：Cook 输出 → runStates → 上游模型入边（拆分不重写源文件，预览的是源模型） */
const modelPreviewPath = computed((): string | null => {
  const current = node.value
  const hid = hostId.value
  if (!current) return null
  const fromParams = current.params.segmentModelRelativePath?.trim()
  if (fromParams) return fromParams
  const runOut = graphRunHosts.get(hid)?.runStates?.[current.id]?.outputs?.out
  if (runOut && runOut.kind === 'asset' && runOut.relativePath?.trim()) {
    return runOut.relativePath.trim()
  }
  const incoming = graphEditorHosts.listIncomingEdges(hid, current.id, 'in-model')
  const sourceId = incoming[0]?.sourceNodeId
  if (!sourceId) return null
  const source = graphEditorHosts.getNode(hid, sourceId)
  if (!source) return null
  const gallerySelected = source.params.selectedModelId?.trim()
  if (gallerySelected && source.params.generatedModels?.length) {
    const hit = source.params.generatedModels.find((item) => item.id === gallerySelected)
    if (hit?.relativePath?.trim()) return hit.relativePath.trim()
  }
  const upstream =
    source.params.segmentModelRelativePath?.trim() ||
    source.params.rigModelRelativePath?.trim() ||
    source.params.poseModelRelativePath?.trim() ||
    source.params.generatedModels?.[0]?.relativePath?.trim()
  return upstream || null
})

const parts = computed(() => node.value?.params.segmentParts ?? [])
const description = computed(() => node.value?.params.segmentDescription?.trim() ?? '')
const maskUrl = computed(() => node.value?.params.segmentMaskUrl?.trim() ?? '')
</script>

<style scoped>
/* 与其他 inspector 同口径的容器：12px 内边距 + 12px 行距，否则内容贴边 */
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

.preview-slot {
  flex: 0 0 auto;
  width: 100%;
  min-height: 200px;
  height: 200px;
}

.preview-slot :deep(.model-preview) {
  height: 100%;
  min-height: 200px;
}

.parts-panel,
.meta-panel {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.parts-panel h4,
.meta-panel h4 {
  margin: 0;
  font-size: 12px;
}

.section-hint {
  margin: 0;
  padding: 12px;
  border: 1px dashed color-mix(in srgb, var(--border) 80%, transparent);
  border-radius: 6px;
  font-size: 11px;
  color: var(--text-muted);
  text-align: center;
}

.parts-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.parts-item {
  padding: 2px 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--panel) 88%, transparent);
  border: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
  font-size: 11px;
}

.meta-text {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
}

.mask-image {
  width: 100%;
  border-radius: 8px;
  border: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
}

.preview-missing {
  margin: 0;
}
</style>
