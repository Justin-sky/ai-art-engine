<template>
  <div
    v-if="node"
    class="node-inspector"
  >
    <div class="head">
      <span class="type">{{ typeLabel }}</span>
      <h2>{{ node.title || typeLabel }}</h2>
    </div>
    <p class="hint">
      {{ t('graph.inspector.worldGen.hint') }}
    </p>

    <GraphNodeRunControl
      v-if="hasInPort"
      :status="runStatus"
      :is-running="isGraphRunning"
      :blocked="blocked"
      @toggle="toggleRun"
    />

    <section
      class="grouped-preview"
      :aria-label="t('graph.inspector.worldGen.groupedPreview')"
    >
      <div class="section-head">
        <span class="section-title">{{ t('graph.inspector.worldGen.groupedPreview') }}</span>
        <span
          v-if="totalImageCount"
          class="section-count"
        >
          {{ t('graph.inspector.outputPreviewCount', { n: totalImageCount }) }}
        </span>
      </div>
      <p class="section-hint">
        {{ t('graph.inspector.worldGen.groupedPreviewHint') }}
      </p>

      <section
        v-for="group in outputGroups"
        :key="group.id"
        class="group-section"
        :aria-label="group.label"
      >
        <div class="group-head">
          <span class="group-title">{{ group.label }}</span>
          <span class="group-count">
            {{ t('graph.inspector.worldGen.groupCount', { n: group.items.length }) }}
          </span>
        </div>
        <div
          v-if="!group.items.length"
          class="empty"
        >
          {{ t('graph.inspector.worldGen.groupEmpty') }}
        </div>
        <div
          v-else
          class="media-grid"
        >
          <button
            v-for="item in group.items"
            :key="item.key"
            type="button"
            class="media-card"
            :title="item.name"
            @dblclick="openImagePreview(item)"
          >
            <img
              v-if="displaySrc(item.key)"
              :src="displaySrc(item.key)"
              :alt="item.name"
              loading="lazy"
              decoding="async"
            >
            <span
              v-else
              class="media-placeholder"
            >…</span>
            <span class="item-label">{{ item.name }}</span>
          </button>
        </div>
      </section>
    </section>

    <label>
      {{ t('graph.inspector.displayName') }}
      <input
        v-model="localTitle"
        @change="persistTitle"
      >
    </label>
  </div>
  <div
    v-else
    class="node-inspector empty"
  >
    {{ t('graph.inspector.node.empty') }}
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { parseGraphHostContext } from '@shared/editorGlobals'
import {
  LEGACY_WORLD_GEN_NODE_ID,
  WORLD_ELEMENT_KINDS,
  WORLD_GEN_IMAGE_OUT_PORTS,
  worldElementOutputsFromParams,
  type WorldElementGenResult
} from '@shared/graph'
import GraphNodeRunControl from './GraphNodeRunControl.vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useGraphNodeRun } from '../composables/useGraphNodeRun'
import { useEditorKernel } from '../editor/kernel'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'
import { graphRunHosts } from '../features/graph/model/graphRunHosts'
import { previewWorldElementOutputsFromSubgraphs } from '../features/world/worldElementPipeline'
import { resolveAssetPreviewUrl } from '../features/media/assetUrlCache'
import { openFullImagePreview } from '../features/media/openFullImagePreview'

type PreviewItem = {
  key: string
  name: string
  imageUrl: string
}

type OutputGroup = {
  id: string
  kind: (typeof WORLD_GEN_IMAGE_OUT_PORTS)[number]['kind']
  label: string
  items: PreviewItem[]
}

const { t, graphTypeLabel } = useStudioI18n()
const editor = useEditorKernel()

const node = computed(() => {
  void graphEditorHosts.revision.value
  const selection = editor.selection.current.value
  const id = selection.kind === 'graph.node' ? selection.id : null
  if (!id) return null
  const current = graphEditorHosts.getNode(selection.hostId, id)
  if (!current || current.typeId !== 'world.gen') return null
  return current
})

const graphHostId = computed(() => {
  const selection = editor.selection.current.value
  return selection.kind === 'graph.node' ? selection.hostId ?? '' : ''
})

const worldAssetId = computed(() => parseGraphHostContext(graphHostId.value).id?.trim() || '')

function mergeWorldElementOutputs(
  primary: WorldElementGenResult[],
  secondary: WorldElementGenResult[]
): WorldElementGenResult[] {
  const key = (item: WorldElementGenResult) => `${item.type}:${item.name}`
  const merged = new Map<string, WorldElementGenResult>()
  for (const item of secondary) {
    if (item.imageUrl?.trim()) merged.set(key(item), item)
  }
  for (const item of primary) {
    if (item.imageUrl?.trim()) merged.set(key(item), item)
  }
  return Array.from(merged.values())
}

const previewItems = computed((): WorldElementGenResult[] => {
  void graphEditorHosts.revision.value
  const worldId = worldAssetId.value
  const nodeId = node.value?.id?.trim() || ''
  const hostIdFor = (kind: string): string =>
    nodeId && nodeId !== LEGACY_WORLD_GEN_NODE_ID
      ? `asset:${worldId}:element:${kind}:${nodeId}`
      : `asset:${worldId}:element:${kind}`
  for (const kind of WORLD_ELEMENT_KINDS) {
    if (!worldId) break
    void graphRunHosts.get(hostIdFor(kind))?.runStates
  }
  const fromParams = worldElementOutputsFromParams(node.value?.params)
  if (!worldId) return fromParams
  const fromSubgraphs = previewWorldElementOutputsFromSubgraphs({
    worldAssetId: worldId,
    nodeId
  })
  return mergeWorldElementOutputs(fromSubgraphs, fromParams)
})

const { hasInPort, runStatus, isGraphRunning, blocked, toggleRun } = useGraphNodeRun(node)

const typeLabel = computed(() =>
  node.value?.typeId ? graphTypeLabel(node.value.typeId) : t('graph.inspector.node.title')
)

const localTitle = ref('')
const resolvedSrc = ref<Record<string, string>>({})
let resolveToken = 0

function groupLabel(kind: OutputGroup['kind']): string {
  return t(`world.tab.${kind}`)
}

function toPreviewItem(item: WorldElementGenResult, index: number): PreviewItem | null {
  const imageUrl = item.imageUrl?.trim() || ''
  const name = item.name?.trim() || ''
  if (!imageUrl || !name) return null
  return {
    key: `${item.type}:${name}:${index}`,
    name,
    imageUrl
  }
}

const outputGroups = computed((): OutputGroup[] => {
  const items = previewItems.value
  return WORLD_GEN_IMAGE_OUT_PORTS.map((port) => ({
    id: port.id,
    kind: port.kind,
    label: groupLabel(port.kind),
    items: items
      .map((item, index) => (item.type === port.type ? toPreviewItem(item, index) : null))
      .filter((item): item is PreviewItem => !!item)
  }))
})

const totalImageCount = computed(() =>
  outputGroups.value.reduce((sum, group) => sum + group.items.length, 0)
)

watch(
  node,
  (current) => {
    localTitle.value = current?.title || typeLabel.value
  },
  { immediate: true }
)

function persistTitle(): void {
  if (!node.value) return
  const selection = editor.selection.current.value
  graphEditorHosts.updateNode(selection.hostId, node.value.id, {}, localTitle.value.trim())
}

async function resolveImageUrl(imageUrl: string): Promise<string> {
  const url = imageUrl.trim()
  if (!url) return ''
  if (url.startsWith('data:') || /^https?:\/\//i.test(url)) return url
  try {
    return await resolveAssetPreviewUrl(url)
  } catch {
    return ''
  }
}

async function resolvePreviewUrls(): Promise<void> {
  const token = ++resolveToken
  const next: Record<string, string> = {}
  const pending = outputGroups.value.flatMap((group) => group.items)
  await Promise.all(
    pending.map(async (item) => {
      const url = await resolveImageUrl(item.imageUrl)
      if (url) next[item.key] = url
    })
  )
  if (token !== resolveToken) return
  for (const item of pending) {
    const raw = item.imageUrl.trim()
    if (raw.startsWith('data:') || /^https?:\/\//i.test(raw)) {
      next[item.key] = raw
    }
  }
  resolvedSrc.value = next
}

watch(outputGroups, () => void resolvePreviewUrls(), { immediate: true, deep: true })

onBeforeUnmount(() => {
  resolveToken += 1
})

function displaySrc(key: string): string {
  return resolvedSrc.value[key] || ''
}

async function openImagePreview(item: PreviewItem): Promise<void> {
  const url = item.imageUrl.trim()
  if (!url) return
  if (url.startsWith('data:') || /^https?:\/\//i.test(url)) {
    await openFullImagePreview({ dataUrl: url })
    return
  }
  await openFullImagePreview({ relativePath: url })
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

.node-inspector.empty {
  color: var(--text-muted);
  align-items: center;
  justify-content: center;
}

.head {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.head .type {
  font-size: 11px;
  color: var(--text-muted);
}

.head h2 {
  margin: 0;
  font-size: 14px;
}

.hint,
.section-hint,
.empty {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.4;
}

label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--text-muted);
}

label > input:not([type='checkbox']) {
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
  font-size: 13px;
}

.grouped-preview,
.group-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.section-head,
.group-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.section-title,
.group-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
}

.section-count,
.group-count {
  font-size: 11px;
  color: var(--text-muted);
}

.group-section + .group-section {
  padding-top: 4px;
  border-top: 1px solid color-mix(in srgb, var(--border) 55%, transparent);
}

.media-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: 8px;
}

.media-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  padding: 0;
  border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  border-radius: 8px;
  overflow: hidden;
  background: var(--graph-preview-bg, var(--bg-elevated));
  cursor: zoom-in;
  text-align: left;
}

.media-card:hover {
  border-color: color-mix(in srgb, var(--accent, #6a8) 45%, var(--border));
}

.media-card img {
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  display: block;
  background: var(--graph-preview-bg, var(--bg-elevated));
}

.media-placeholder {
  display: grid;
  place-items: center;
  width: 100%;
  aspect-ratio: 1;
  color: var(--text-muted);
  background: var(--graph-preview-bg, var(--bg-elevated));
}

.item-label {
  padding: 6px 8px;
  font-size: 11px;
  line-height: 1.3;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
