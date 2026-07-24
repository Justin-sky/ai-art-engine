<template>
  <div class="shot-strip">
    <div class="strip-toolbar">
      <span>{{ t('shot.strip.title') }}</span>
      <span class="strip-hint">{{ t('shot.strip.switchHint') }}</span>
      <button type="button" @click="onAdd">{{ t('shot.strip.new') }}</button>
    </div>
    <p v-if="error" class="strip-error">{{ error }}</p>
    <div class="strip">
      <div
        v-for="(shot, index) in visibleShots"
        :key="shot.id"
        class="shot-card"
        :class="{ active: shot.id === project.activeShotId }"
        role="button"
        tabindex="0"
        draggable="true"
        @click="selectShot(shot.id)"
        @keydown.enter="selectShot(shot.id)"
        @dragstart="onShotDragStart($event, shot)"
      >
        <div class="thumb">
          <img
            v-if="thumbUrls[shot.id]"
            :src="thumbUrls[shot.id]"
            :alt="shot.title"
            loading="lazy"
          />
          <span v-else class="thumb-placeholder">{{ index + 1 }}</span>
        </div>
        <div class="meta">
          <div class="title">#{{ index + 1 }} {{ shot.title }}</div>
          <div class="status" :data-status="shot.status">{{ statusLabel(shot.status) }}</div>
        </div>
        <button class="del" @click.stop="onDelete(shot.id)" :title="t('common.delete')">×</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, toRef, watch } from 'vue'
import { isDraftAssetId } from '@shared/domain'
import { useScopedScriptShots } from '../composables/useScopedScriptShots'
import { useDraftStore } from '../stores/drafts'
import { useProjectStore } from '../stores/project'
import { useWorkspaceStore, STUDIO_SHOT_DRAG_MIME, STUDIO_SHOT_ID_DRAG_MIME } from '../stores/workspace'
import { useStudioI18n } from '../composables/useStudioI18n'
import type { Shot } from '@shared/domain'

const props = defineProps<{
  scriptAssetId?: string
}>()

const project = useProjectStore()
const workspace = useWorkspaceStore()
const draftStore = useDraftStore()
const { t, shotStatusLabel: statusLabel } = useStudioI18n()
const error = ref('')
const thumbUrls = ref<Record<string, string>>({})

const { visibleShots } = useScopedScriptShots(toRef(props, 'scriptAssetId'))

function onShotDragStart(e: DragEvent, shot: Shot): void {
  if (!e.dataTransfer) return
  e.dataTransfer.effectAllowed = 'copy'
  e.dataTransfer.setData(STUDIO_SHOT_ID_DRAG_MIME, shot.id)
  e.dataTransfer.setData(
    STUDIO_SHOT_DRAG_MIME,
    JSON.stringify({ id: shot.id, title: shot.title, scriptAssetId: shot.scriptAssetId })
  )
}

async function loadThumbForShot(shotId: string, path: string, updatedAt: string): Promise<void> {
  try {
    const base = await window.studio.getAssetPreviewUrl(path)
    thumbUrls.value = { ...thumbUrls.value, [shotId]: `${base}?t=${encodeURIComponent(updatedAt)}` }
  } catch {
    const next = { ...thumbUrls.value }
    delete next[shotId]
    thumbUrls.value = next
  }
}

watch(
  visibleShots,
  (shots) => {
    for (const shot of shots) {
      if (!shot.thumbnailPath) continue
      const current = thumbUrls.value[shot.id]
      if (current?.includes(encodeURIComponent(shot.updatedAt))) continue
      void loadThumbForShot(shot.id, shot.thumbnailPath, shot.updatedAt)
    }
  },
  { immediate: true, deep: true }
)

async function selectShot(id: string): Promise<void> {
  if (!id) return
  if (id === project.activeShotId) {
    workspace.focusShot()
    return
  }
  const shot = visibleShots.value.find((s) => s.id === id)
  if (shot && !project.shots.some((s) => s.id === id)) {
    await project.persistShot(shot)
  }
  await project.selectShot(id)
  workspace.focusShot()
}

async function onAdd(): Promise<void> {
  error.value = ''
  try {
    if (props.scriptAssetId && isDraftAssetId(props.scriptAssetId)) {
      const resolution = project.config?.resolution ?? { w: 1280, h: 720 }
      const shot = draftStore.addDraftShot(props.scriptAssetId, resolution)
      if (!shot) {
        error.value = t('shot.error.draftMissing')
        return
      }
      await project.persistShot(shot)
      await selectShot(shot.id)
      return
    }
    const shot = await window.studio.createShot({
      scriptAssetId: props.scriptAssetId
    })
    await project.refreshShots()
    await selectShot(shot.id)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function onDelete(id: string): Promise<void> {
  if (visibleShots.value.length <= 1) return
  error.value = ''
  try {
    if (props.scriptAssetId && isDraftAssetId(props.scriptAssetId)) {
      draftStore.deleteDraftShot(props.scriptAssetId, id)
      project.shots = project.shots.filter((s) => s.id !== id)
      if (project.activeShotId === id) {
        await selectShot(visibleShots.value[0]?.id ?? '')
      }
      return
    }
    await window.studio.deleteShot(id)
    await project.refreshShots()
    if (project.activeShotId === id) {
      await selectShot(visibleShots.value[0]?.id ?? '')
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}
</script>

<style scoped>
.shot-strip {
  background: var(--bg-panel);
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.strip-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
  color: var(--text-muted);
  font-size: 12px;
}

.strip-toolbar .spacer,
.strip-toolbar button {
  margin-left: auto;
}

.strip-toolbar button {
  margin-left: auto;
}

.strip-hint {
  font-size: 10px;
  color: var(--text-muted);
  opacity: 0.75;
}

.strip-error {
  margin: 0;
  padding: 0 10px 4px;
  color: var(--danger);
  font-size: 11px;
}

.strip {
  display: flex;
  gap: 8px;
  padding: 4px 10px 10px;
  overflow-x: auto;
  flex: 1;
  align-items: stretch;
}

.shot-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 108px;
  max-width: 108px;
  padding: 6px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  text-align: left;
  border-radius: var(--radius);
  cursor: grab;
}

.shot-card:active {
  cursor: grabbing;
}

.shot-card.active {
  border-color: var(--accent);
  box-shadow: inset 0 0 0 1px var(--accent);
}

.thumb {
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: 4px;
  overflow: hidden;
  background: var(--graph-preview-bg);
  display: flex;
  align-items: center;
  justify-content: center;
}

.thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.thumb-placeholder {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-muted);
  font-family: var(--mono);
}

.meta {
  min-width: 0;
}

.title {
  font-weight: 600;
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status {
  font-size: 10px;
  color: var(--text-muted);
  margin-top: 2px;
}

.status[data-status='generating'] {
  color: var(--warning);
}

.status[data-status='done'] {
  color: var(--success);
}

.status[data-status='failed'] {
  color: var(--danger);
}

.del {
  position: absolute;
  top: 2px;
  right: 2px;
  padding: 0 4px;
  opacity: 0;
  border: none;
  background: rgba(0, 0, 0, 0.55);
  border-radius: 3px;
  color: #fff;
}

.shot-card:hover .del {
  opacity: 0.9;
}
</style>
