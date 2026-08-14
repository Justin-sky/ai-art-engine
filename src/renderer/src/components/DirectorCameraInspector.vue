<template>
  <div
    v-if="node"
    class="camera-inspector"
  >
    <div class="head">
      <span class="type">{{ t('graph.types.asset.motion') }}</span>
      <h2>{{ node.title || t('graph.types.asset.motion') }}</h2>
    </div>

    <button
      type="button"
      class="link-btn"
      @click="openStage"
    >
      {{ t('graph.inspector.camera.openStage') }}
    </button>
    <p class="subhint">
      {{ t('director.stage.editInStage') }}
    </p>

    <label>
      {{ t('graph.inspector.displayName') }}
      <input
        v-model="localTitle"
        @change="persist"
      >
    </label>

    <section
      class="out-images"
      :aria-label="t('graph.inspector.camera.outImages')"
    >
      <div class="section-head">
        <span class="section-title">{{ t('graph.inspector.camera.outImages') }}</span>
        <span
          v-if="outImages.length"
          class="section-count"
        >
          {{ t('graph.inspector.camera.outImagesCount', { n: outImages.length }) }}
        </span>
      </div>
      <p class="section-hint">
        {{ t('graph.inspector.camera.outImagesHint') }}
      </p>
      <div
        v-if="!outImages.length"
        class="empty-shots"
      >
        {{ t('graph.inspector.camera.outImagesEmpty') }}
      </div>
      <div
        v-else
        class="shot-grid"
      >
        <button
          v-for="(shot, index) in outImages"
          :key="shot.id || `index:${index}`"
          type="button"
          class="shot-card"
          :title="t('graph.selectImage.previewHint')"
          @dblclick="openShotPreview(shot)"
        >
          <img
            :src="shotBlobSrc[shot.id || `index:${index}`] || shot.dataUrl"
            alt=""
            loading="lazy"
            decoding="async"
          >
          <span class="shot-index">{{ index + 1 }}</span>
        </button>
      </div>
    </section>

    <section
      class="out-images"
      :aria-label="t('graph.inspector.camera.outActions')"
    >
      <div class="section-head">
        <span class="section-title">{{ t('graph.inspector.camera.outActions') }}</span>
        <span
          v-if="outActions.length"
          class="section-count"
        >
          {{ t('graph.inspector.camera.outActionsCount', { n: outActions.length }) }}
        </span>
      </div>
      <p class="section-hint">
        {{ t('graph.inspector.camera.outActionsHint') }}
      </p>
      <div
        v-if="!outActions.length"
        class="empty-shots"
      >
        {{ t('graph.inspector.camera.outActionsEmpty') }}
      </div>
      <div
        v-else
        class="shot-grid"
      >
        <button
          v-for="(clip, index) in outActions"
          :key="clip.id || `action:${index}`"
          type="button"
          class="shot-card"
          :title="t('graph.inspector.camera.outActionsHint')"
          @dblclick="openActionPreview(clip)"
        >
          <video
            v-if="actionSrc[clip.id || `action:${index}`]"
            :src="actionSrc[clip.id || `action:${index}`]"
            muted
            playsinline
            preload="metadata"
          />
          <span class="shot-index">{{ index + 1 }}</span>
        </button>
      </div>
    </section>
  </div>
  <div
    v-else
    class="camera-inspector empty"
  >
    {{ t('graph.inspector.camera.empty') }}
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { resolveNodeType, type GraphImageItem, type GraphVideoItem } from '@shared/graph'
import { parseGraphHostContext } from '@shared/editorGlobals'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'
import { graphRunHosts } from '../features/graph/model/graphRunHosts'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useEditorKernel } from '../editor/kernel'
import { openFullImagePreview } from '../features/media/openFullImagePreview'
import { useWorkspaceStore } from '../stores/workspace'

const { t } = useStudioI18n()
const editor = useEditorKernel()
const workspace = useWorkspaceStore()

const localTitle = ref('')
const shotBlobCache = new Map<string, { dataUrl: string; blobUrl: string }>()
const shotBlobSrc = ref<Record<string, string>>({})
const actionSrc = ref<Record<string, string>>({})

const graphSelection = computed(() => {
  const selection = editor.selection.current.value
  return selection.kind === 'graph.node' ? selection : null
})

const node = computed(() => {
  const selection = graphSelection.value
  const id = selection?.id
  if (!id) return null
  const n = graphEditorHosts.getNode(selection.hostId, id)
  if (!n || resolveNodeType(n)?.inspector !== 'camera') return null
  return n
})

/** 输出端口 out-shots：优先运行态，其次节点上的站位图 / 预览图 */
const outImages = computed<GraphImageItem[]>(() => {
  const current = node.value
  const selection = graphSelection.value
  if (!current || !selection) return []

  const runOut =
    graphRunHosts.get(selection.hostId)?.runStates[current.id]?.outputs?.['out-shots'] ??
    graphRunHosts.get(selection.hostId)?.runStates[current.id]?.outputs?.['out-all']
  if (runOut?.kind === 'images') {
    const live = runOut.items.filter(
      (item) => item.dataUrl?.trim() || item.relativePath?.trim()
    )
    if (live.length) return live
  }

  const shots = (current.params.cameraShots ?? [])
    .filter((shot) => shot.dataUrl?.trim() || shot.relativePath?.trim())
    .map((shot) => ({
      id: shot.id,
      dataUrl: shot.dataUrl || '',
      createdAt: shot.createdAt,
      relativePath: shot.relativePath
    }))
  if (shots.length) return shots

  const previewUrl = current.params.previewDataUrl?.trim()
  const previewRel = current.params.previewRelativePath?.trim()
  if (previewUrl || previewRel) {
    return [{ dataUrl: previewUrl || '', relativePath: previewRel }]
  }
  return []
})

/** 输出端口 out-actions：运行态或节点 cameraVideos */
const outActions = computed<GraphVideoItem[]>(() => {
  const current = node.value
  const selection = graphSelection.value
  if (!current || !selection) return []

  const runOut =
    graphRunHosts.get(selection.hostId)?.runStates[current.id]?.outputs?.['out-actions']
  if (runOut?.kind === 'videos') {
    const live = runOut.items.filter(
      (item) => item.dataUrl?.trim() || item.relativePath?.trim()
    )
    if (live.length) return live
  }

  return (current.params.cameraVideos ?? [])
    .filter((video) => video.dataUrl?.trim() || video.relativePath?.trim())
    .map((video) => ({
      id: video.id,
      dataUrl: video.dataUrl || '',
      createdAt: video.createdAt,
      relativePath: video.relativePath
    }))
})

watch(
  node,
  (n) => {
    if (!n) return
    localTitle.value = n.title ?? ''
  },
  { immediate: true }
)

function dataUrlToBlobUrl(dataUrl: string): string {
  const comma = dataUrl.indexOf(',')
  if (comma < 0) return dataUrl
  const header = dataUrl.slice(0, comma)
  const payload = dataUrl.slice(comma + 1)
  const mime = /data:(.*?);/i.exec(header)?.[1] ?? 'image/jpeg'
  const binary = atob(payload)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return URL.createObjectURL(new Blob([bytes], { type: mime }))
}

function shotKey(shot: GraphImageItem, index: number): string {
  return shot.id || `index:${index}`
}

async function syncShotBlobUrls(): Promise<void> {
  const shots = outImages.value
  const alive = new Set(shots.map((shot, index) => shotKey(shot, index)))
  for (const [id, entry] of shotBlobCache) {
    if (alive.has(id)) continue
    URL.revokeObjectURL(entry.blobUrl)
    shotBlobCache.delete(id)
  }
  const next: Record<string, string> = {}
  await Promise.all(
    shots.map(async (shot, index) => {
      const id = shotKey(shot, index)
      const relativePath = shot.relativePath?.trim()
      if (relativePath) {
        try {
          next[id] = await window.studio.getAssetPreviewUrl(relativePath)
          return
        } catch {
          /* fall through */
        }
      }
      const dataUrl = shot.dataUrl?.trim()
      if (!dataUrl) return
      const cached = shotBlobCache.get(id)
      if (cached?.dataUrl === dataUrl) {
        next[id] = cached.blobUrl
        return
      }
      if (cached) URL.revokeObjectURL(cached.blobUrl)
      const blobUrl = dataUrlToBlobUrl(dataUrl)
      shotBlobCache.set(id, { dataUrl, blobUrl })
      next[id] = blobUrl
    })
  )
  shotBlobSrc.value = next
}

async function syncActionSrc(): Promise<void> {
  const clips = outActions.value
  const next: Record<string, string> = {}
  await Promise.all(
    clips.map(async (clip, index) => {
      const id = clip.id || `action:${index}`
      const relativePath = clip.relativePath?.trim()
      if (relativePath) {
        try {
          next[id] = await window.studio.getAssetFileUrl(relativePath)
          return
        } catch {
          /* fall through */
        }
      }
      if (clip.dataUrl?.trim()) next[id] = clip.dataUrl
    })
  )
  actionSrc.value = next
}

watch(outImages, () => void syncShotBlobUrls(), { immediate: true, deep: true })
watch(outActions, () => void syncActionSrc(), { immediate: true, deep: true })

onBeforeUnmount(() => {
  for (const entry of shotBlobCache.values()) URL.revokeObjectURL(entry.blobUrl)
  shotBlobCache.clear()
  shotBlobSrc.value = {}
  actionSrc.value = {}
})

function persist(): void {
  const selection = graphSelection.value
  const id = selection?.id
  if (!id) return
  graphEditorHosts.updateNode(selection.hostId, id, {}, localTitle.value.trim() || undefined)
}

function openStage(): void {
  const selection = graphSelection.value
  const current = node.value
  const rootKey = workspace.activeDiveRootKey?.trim()
  const directorAssetId = selection ? parseGraphHostContext(selection.hostId).id?.trim() : ''
  if (!rootKey || !directorAssetId || !current) return
  workspace.diveIntoView(
    rootKey,
    {
      viewId: 'director.stage',
      directorAssetId,
      processingNodeId: current.id
    },
    current.title?.trim() || t('graph.types.asset.motion')
  )
}

function openShotPreview(shot: GraphImageItem): void {
  void openFullImagePreview({
    dataUrl: shot.dataUrl,
    relativePath: shot.relativePath
  })
}

function openActionPreview(clip: GraphVideoItem): void {
  void openFullImagePreview({
    dataUrl: clip.dataUrl,
    relativePath: clip.relativePath
  })
}
</script>

<style scoped>
.camera-inspector {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  height: 100%;
  overflow: auto;
}

.camera-inspector.empty {
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

label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
}

.link-btn {
  align-self: flex-start;
  background: none;
  border: none;
  color: var(--accent);
  cursor: pointer;
  font-size: 12px;
  padding: 0;
}

.subhint {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
}

.out-images {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 4px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
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

.section-count {
  font-size: 11px;
  color: var(--text-muted);
}

.section-hint {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
}

.empty-shots {
  padding: 16px 8px;
  text-align: center;
  font-size: 12px;
  color: var(--text-muted);
  border: 1px dashed var(--border);
  border-radius: 8px;
  background: var(--bg-elevated);
}

.shot-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.shot-card {
  position: relative;
  display: block;
  padding: 0;
  margin: 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--graph-preview-bg);
  cursor: zoom-in;
}

.shot-card:hover {
  border-color: var(--accent);
}

.shot-card img,
.shot-card video {
  display: block;
  width: 100%;
  aspect-ratio: 16 / 9;
  object-fit: contain;
  background: var(--graph-preview-bg);
  pointer-events: none;
}

.shot-index {
  position: absolute;
  left: 6px;
  bottom: 6px;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 10px;
  line-height: 18px;
  text-align: center;
}
</style>
