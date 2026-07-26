<template>
  <div class="shots-panel" role="dialog" :aria-label="t('director.stage.tabShots')">
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
    <div class="shots-list">
      <div v-if="!shotList.length" class="empty">{{ t('director.stage.shotsEmpty') }}</div>
      <div v-for="shot in shotList" :key="shot.id" class="shot">
        <img
          :src="shotBlobSrc[shot.id] || shot.dataUrl"
          alt=""
          loading="lazy"
          decoding="async"
          @dblclick="openShotPreview(shot.dataUrl)"
        />
        <button type="button" class="remove" @click="scene.removeCameraShot(shot.id)">×</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref, watch } from 'vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { directorStageSceneKey } from '../features/director/stageSceneKey'

const emit = defineEmits<{
  close: []
}>()

const { t } = useStudioI18n()
const scene = inject(directorStageSceneKey)!
const shotBlobCache = new Map<string, { dataUrl: string; blobUrl: string }>()
const shotBlobSrc = ref<Record<string, string>>({})

const shotList = computed(() => [...(scene.stage.value.cameraShots ?? [])].reverse())

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
    const cached = shotBlobCache.get(shot.id)
    if (cached?.dataUrl === shot.dataUrl) {
      next[shot.id] = cached.blobUrl
      continue
    }
    if (cached) URL.revokeObjectURL(cached.blobUrl)
    const blobUrl = dataUrlToBlobUrl(shot.dataUrl)
    shotBlobCache.set(shot.id, { dataUrl: shot.dataUrl, blobUrl })
    next[shot.id] = blobUrl
  }
  shotBlobSrc.value = next
}

function openShotPreview(url: string): void {
  void window.studio.openShotPreviewWindow(url)
}

watch(
  () => scene.stage.value.cameraShots,
  () => syncShotBlobUrls(),
  { immediate: true, deep: true }
)

onBeforeUnmount(() => {
  for (const entry of shotBlobCache.values()) URL.revokeObjectURL(entry.blobUrl)
  shotBlobCache.clear()
  shotBlobSrc.value = {}
})
</script>

<style scoped>
.shots-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 280px;
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

.shot img {
  display: block;
  width: 100%;
  height: auto;
  aspect-ratio: 16 / 9;
  object-fit: contain;
  background: var(--media-letterbox);
  cursor: zoom-in;
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
