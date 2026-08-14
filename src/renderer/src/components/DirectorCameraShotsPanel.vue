<template>
  <div
    class="shots-panel"
    role="dialog"
    :aria-label="t('director.stage.tabShots')"
  >
    <header class="panel-head">
      <span class="panel-title">{{ t('director.stage.tabShots') }}</span>
      <button
        type="button"
        class="panel-close"
        :aria-label="t('director.stageDialog.close')"
        @click="emit('close')"
      >
        ×
      </button>
    </header>

    <div
      class="tabs"
      role="tablist"
    >
      <button
        type="button"
        class="tab"
        role="tab"
        :class="{ active: activeTab === 'shots' }"
        :aria-selected="activeTab === 'shots'"
        @click="activeTab = 'shots'"
      >
        {{ t('director.stage.tabShotsOnly') }}
        <span
          v-if="shotList.length"
          class="tab-count"
        >{{ shotList.length }}</span>
      </button>
      <button
        type="button"
        class="tab"
        role="tab"
        :class="{ active: activeTab === 'actions' }"
        :aria-selected="activeTab === 'actions'"
        @click="activeTab = 'actions'"
      >
        {{ t('director.stage.tabActionsOnly') }}
        <span
          v-if="videoList.length"
          class="tab-count"
        >{{ videoList.length }}</span>
      </button>
    </div>

    <div
      v-show="activeTab === 'shots'"
      class="shots-list"
    >
      <div
        v-if="!shotList.length"
        class="empty"
      >
        {{ t('director.stage.shotsEmpty') }}
      </div>
      <div
        v-for="shot in shotList"
        :key="shot.id"
        class="shot"
      >
        <img
          :src="shotBlobSrc[shot.id] || shot.dataUrl"
          alt=""
          loading="lazy"
          decoding="async"
          @dblclick="openShotPreview(shot)"
        >
        <button
          type="button"
          class="remove"
          @click="scene.removeCameraShot(shot.id)"
        >
          ×
        </button>
      </div>
    </div>

    <div
      v-show="activeTab === 'actions'"
      class="shots-list"
    >
      <div
        v-if="!videoList.length"
        class="empty"
      >
        {{ t('director.stage.actionsEmpty') }}
      </div>
      <div
        v-for="video in videoList"
        :key="video.id"
        class="shot video"
      >
        <video
          v-if="videoSrc[video.id]"
          :src="videoSrc[video.id]"
          muted
          playsinline
          preload="metadata"
          @dblclick="openVideoPreview(video)"
        />
        <div
          v-else
          class="video-placeholder"
        >
          {{ t('director.stage.actionLoading') }}
        </div>
        <button
          type="button"
          class="remove"
          @click="scene.removeCameraVideo(video.id)"
        >
          ×
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref, watch } from 'vue'
import type { DirectorCameraShot, DirectorCameraVideo } from '@shared/domain'
import { useStudioI18n } from '../composables/useStudioI18n'
import { directorStageSceneKey } from '../features/director/stageSceneKey'
import type { DirectorMediaGalleryTab } from '../features/director/useDirectorStageScene'
import { openFullImagePreview } from '../features/media/openFullImagePreview'

const props = defineProps<{
  initialTab?: DirectorMediaGalleryTab
}>()

const emit = defineEmits<{
  close: []
}>()

const { t } = useStudioI18n()
const scene = inject(directorStageSceneKey)!
const shotBlobCache = new Map<string, { dataUrl: string; blobUrl: string }>()
const shotBlobSrc = ref<Record<string, string>>({})
const videoSrc = ref<Record<string, string>>({})
const activeTab = ref<DirectorMediaGalleryTab>(props.initialTab ?? 'shots')

const shotList = computed(() => [...(scene.stage.value.cameraShots ?? [])].reverse())
const videoList = computed(() => [...(scene.stage.value.cameraVideos ?? [])].reverse())

watch(
  () => props.initialTab,
  (tab) => {
    if (tab) activeTab.value = tab
  }
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

function syncShotBlobUrls(): void {
  const shots = scene.stage.value.cameraShots ?? []
  const alive = new Set(shots.map((shot) => shot.id))
  for (const [id, entry] of shotBlobCache) {
    if (alive.has(id)) continue
    URL.revokeObjectURL(entry.blobUrl)
    shotBlobCache.delete(id)
  }
  const next: Record<string, string> = {}
  for (const shot of shots) {
    if (shot.relativePath?.trim()) continue
    const cached = shotBlobCache.get(shot.id)
    if (cached?.dataUrl === shot.dataUrl) {
      next[shot.id] = cached.blobUrl
      continue
    }
    if (cached) URL.revokeObjectURL(cached.blobUrl)
    if (!shot.dataUrl) continue
    const blobUrl = dataUrlToBlobUrl(shot.dataUrl)
    shotBlobCache.set(shot.id, { dataUrl: shot.dataUrl, blobUrl })
    next[shot.id] = blobUrl
  }
  shotBlobSrc.value = next
  void loadShotPreviewUrls(shots)
}

async function loadShotPreviewUrls(shots: DirectorCameraShot[]): Promise<void> {
  const next = { ...shotBlobSrc.value }
  await Promise.all(
    shots.map(async (shot) => {
      const rel = shot.relativePath?.trim()
      if (!rel) return
      try {
        next[shot.id] = await window.studio.getAssetPreviewUrl(rel)
      } catch {
        /* keep dataUrl fallback */
      }
    })
  )
  shotBlobSrc.value = next
}

async function syncVideoSrc(): Promise<void> {
  const videos = scene.stage.value.cameraVideos ?? []
  const next: Record<string, string> = {}
  await Promise.all(
    videos.map(async (video) => {
      const rel = video.relativePath?.trim()
      if (rel) {
        try {
          next[video.id] = await window.studio.getAssetFileUrl(rel)
          return
        } catch {
          /* fall through */
        }
      }
      if (video.dataUrl?.trim()) next[video.id] = video.dataUrl
    })
  )
  videoSrc.value = next
}

async function openShotPreview(shot: DirectorCameraShot): Promise<void> {
  await openFullImagePreview({
    dataUrl: shot.dataUrl || undefined,
    relativePath: shot.relativePath
  })
}

async function openVideoPreview(video: DirectorCameraVideo): Promise<void> {
  await openFullImagePreview({
    dataUrl: video.dataUrl,
    relativePath: video.relativePath
  })
}

watch(
  () => scene.stage.value.cameraShots,
  () => syncShotBlobUrls(),
  { immediate: true, deep: true }
)

watch(
  () => scene.stage.value.cameraVideos,
  () => void syncVideoSrc(),
  { immediate: true, deep: true }
)

onBeforeUnmount(() => {
  for (const entry of shotBlobCache.values()) URL.revokeObjectURL(entry.blobUrl)
  shotBlobCache.clear()
  shotBlobSrc.value = {}
  videoSrc.value = {}
})
</script>

<style scoped>
.shots-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 300px;
  max-height: min(70vh, 560px);
  padding: 10px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--bg-panel);
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5);
  box-sizing: border-box;
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-shrink: 0;
}

.panel-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}

.panel-close {
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}

.panel-close:hover {
  background: var(--wash-08);
  color: var(--text);
}

.tabs {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
  padding: 2px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-elevated) 80%, var(--border));
}

.tab {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
}

.tab.active {
  background: var(--bg-panel);
  color: var(--text);
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.18);
}

.tab-count {
  min-width: 16px;
  padding: 0 5px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 22%, transparent);
  color: var(--accent);
  font-size: 10px;
  font-weight: 700;
  line-height: 16px;
  text-align: center;
}

.shots-list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-right: 2px;
  scrollbar-gutter: stable;
}

.empty {
  color: var(--text-muted);
  font-size: 12px;
  text-align: center;
  margin: 24px 0;
}

.shot {
  position: relative;
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid var(--border);
  background: var(--media-letterbox);
  flex-shrink: 0;
}

.shot img,
.shot video {
  display: block;
  width: 100%;
  height: auto;
  aspect-ratio: 16 / 9;
  object-fit: contain;
  background: var(--media-letterbox);
  cursor: zoom-in;
}

.video-placeholder {
  display: grid;
  place-items: center;
  aspect-ratio: 16 / 9;
  color: var(--text-muted);
  font-size: 12px;
}

.shot .remove {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.65);
  color: #fff;
  cursor: pointer;
}
</style>
