<template>
  <div
    ref="rootRef"
    class="shot-table"
    :class="{ 'resizing-col': !!resizingCol, 'resizing-row': !!resizingRow }"
  >
    <div class="table-toolbar">
      <span class="label">{{ t('shot.table.title', { n: visibleShots.length }) }}</span>
      <button type="button" @click="onAdd">{{ t('shot.table.new') }}</button>
    </div>
    <p v-if="error" class="table-error">{{ error }}</p>
    <div class="table-scroll">
      <table>
        <colgroup>
          <col v-for="col in columns" :key="col.id" :style="colStyle(col.id)" />
        </colgroup>
        <thead>
          <tr>
            <th v-for="col in columns" :key="col.id" :style="colStyle(col.id)">
              <span class="col-label">{{ col.label }}</span>
              <span
                class="col-resize"
                :title="t('shot.table.resizeCol')"
                @mousedown.prevent="onColResizeDown(col.id, $event)"
              />
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(shot, index) in visibleShots"
            :key="shot.id"
            :class="{ active: shot.id === project.activeShotId, 'has-custom-height': hasRowHeight(shot.id) }"
            :style="rowStyle(shot.id)"
            @click="selectShot(shot.id)"
          >
            <td :style="colStyle('idx')" class="col-idx row-head">
              <span class="row-idx">{{ index + 1 }}</span>
              <span
                class="row-resize"
                :title="t('shot.table.resizeRow')"
                @mousedown.prevent="onRowResizeDown(shot.id, $event)"
              />
            </td>
            <td :style="colStyle('title')" @click.stop>
              <input
                :value="shot.title"
                @change="onTitleChange(shot, ($event.target as HTMLInputElement).value)"
              />
            </td>
            <td :style="colStyle('duration')" @click.stop>
              <input
                type="number"
                min="1"
                max="60"
                :value="shot.camera.durationSec"
                @change="onDurationChange(shot, Number(($event.target as HTMLInputElement).value))"
              />
            </td>
            <td :style="colStyle('visual')" @click.stop>
              <textarea
                rows="2"
                :value="storyboardOf(shot).visualDescription"
                :placeholder="t('shot.table.placeholder.visual')"
                @change="onStoryboardChange(shot, 'visualDescription', ($event.target as HTMLTextAreaElement).value)"
              />
            </td>
            <td :style="colStyle('shotSize')" @click.stop>
              <select
                :value="storyboardOf(shot).shotSize"
                @change="onStoryboardChange(shot, 'shotSize', ($event.target as HTMLSelectElement).value)"
              >
                <option value="">—</option>
                <option v-for="opt in SHOT_SIZE_OPTIONS" :key="opt" :value="opt">{{ shotSizeLabel(opt) }}</option>
              </select>
            </td>
            <td :style="colStyle('lighting')" @click.stop>
              <input
                :value="storyboardOf(shot).lighting"
                :placeholder="t('shot.table.placeholder.lighting')"
                @change="onStoryboardChange(shot, 'lighting', ($event.target as HTMLInputElement).value)"
              />
            </td>
            <td :style="colStyle('dialogue')" @click.stop>
              <textarea
                rows="2"
                :value="storyboardOf(shot).dialogue"
                :placeholder="t('shot.table.placeholder.dialogue')"
                @change="onStoryboardChange(shot, 'dialogue', ($event.target as HTMLTextAreaElement).value)"
              />
            </td>
            <td :style="colStyle('sfx')" @click.stop>
              <input
                :value="storyboardOf(shot).soundFx"
                :placeholder="t('shot.table.placeholder.soundFx')"
                @change="onStoryboardChange(shot, 'soundFx', ($event.target as HTMLInputElement).value)"
              />
            </td>
            <td :style="colStyle('camera')" @click.stop>
              <input
                :value="storyboardOf(shot).cameraMove"
                :placeholder="t('shot.table.placeholder.cameraMove')"
                @change="onStoryboardChange(shot, 'cameraMove', ($event.target as HTMLInputElement).value)"
              />
            </td>
            <td :style="colStyle('status')" @click.stop>
              <select
                class="review-status"
                :data-status="reviewStatusOf(shot)"
                :value="reviewStatusOf(shot)"
                @change="onReviewStatusChange(shot, ($event.target as HTMLSelectElement).value)"
              >
                <option v-for="opt in SHOT_REVIEW_STATUS_OPTIONS" :key="opt" :value="opt">
                  {{ opt }}
                </option>
              </select>
            </td>
            <td :style="colStyle('actions')" @click.stop>
              <button
                type="button"
                class="del"
                :title="t('common.delete')"
                :disabled="visibleShots.length <= 1"
                @click="onDelete(shot.id)"
              >
                ×
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import {
  DEFAULT_SHOT_REVIEW_STATUS,
  SHOT_REVIEW_STATUS_OPTIONS,
  SHOT_SIZE_OPTIONS,
  buildShotGenerationPrompt,
  isDraftAssetId,
  normalizeShotReviewStatus,
  normalizeStoryboard,
  shotScriptAssetId,
  type Shot,
  type ShotReviewStatus,
  type ShotStoryboard
} from '@shared/domain'
import { useDraftStore } from '../stores/drafts'
import { useProjectStore } from '../stores/project'
import { useWorkspaceStore } from '../stores/workspace'
import { useStudioI18n } from '../composables/useStudioI18n'

type ColId =
  | 'idx'
  | 'title'
  | 'duration'
  | 'visual'
  | 'shotSize'
  | 'lighting'
  | 'dialogue'
  | 'sfx'
  | 'camera'
  | 'status'
  | 'actions'

const COL_WIDTH_KEY = 'studio.script.shotTableColWidths'
const DEFAULT_ROW_HEIGHT = 48
const MIN_ROW_HEIGHT = 32
const MAX_ROW_HEIGHT = 480

const DEFAULT_COL_WIDTHS: Record<ColId, number> = {
  idx: 36,
  title: 100,
  duration: 64,
  visual: 200,
  shotSize: 96,
  lighting: 120,
  dialogue: 160,
  sfx: 120,
  camera: 120,
  status: 88,
  actions: 36
}

const MIN_COL_WIDTHS: Record<ColId, number> = {
  idx: 28,
  title: 56,
  duration: 48,
  visual: 80,
  shotSize: 72,
  lighting: 72,
  dialogue: 80,
  sfx: 72,
  camera: 72,
  status: 72,
  actions: 32
}

const props = defineProps<{
  scriptAssetId: string
}>()

const project = useProjectStore()
const workspace = useWorkspaceStore()
const draftStore = useDraftStore()
const { t, shotSizeLabel } = useStudioI18n()
const columns = computed<{ id: ColId; label: string }[]>(() => [
  { id: 'idx', label: '#' },
  { id: 'title', label: t('shot.table.column.name') },
  { id: 'duration', label: t('shot.table.column.duration') },
  { id: 'visual', label: t('shot.table.column.visual') },
  { id: 'shotSize', label: t('shot.table.column.shotSize') },
  { id: 'lighting', label: t('shot.table.column.lighting') },
  { id: 'dialogue', label: t('shot.table.column.dialogue') },
  { id: 'sfx', label: t('shot.table.column.soundFx') },
  { id: 'camera', label: t('shot.table.column.cameraMove') },
  { id: 'status', label: t('shot.table.column.status') },
  { id: 'actions', label: '' }
])
const { drafts } = storeToRefs(draftStore)
const rootRef = ref<HTMLElement | null>(null)
const error = ref('')
const resizingCol = ref<ColId | null>(null)
const resizingRow = ref<string | null>(null)
const colWidths = ref<Record<ColId, number>>(loadColWidths())
const rowHeights = ref<Record<string, number>>(loadRowHeights())

let resizeCleanup: (() => void) | null = null
const pendingWrites = new Set<Promise<unknown>>()

function trackWrite<T>(promise: Promise<T>): Promise<T> {
  pendingWrites.add(promise)
  void promise.finally(() => pendingWrites.delete(promise))
  return promise
}

function rowHeightsKey(): string {
  return `studio.script.shotTableRowHeights.${props.scriptAssetId}`
}

const visibleShots = computed(() => {
  if (isDraftAssetId(props.scriptAssetId)) {
    const draft = drafts.value.find((d) => d.id === props.scriptAssetId)
    return draft?.shots ?? []
  }
  return project.shots.filter((s) => shotScriptAssetId(s) === props.scriptAssetId)
})

function loadColWidths(): Record<ColId, number> {
  const next = { ...DEFAULT_COL_WIDTHS }
  try {
    const raw = localStorage.getItem(COL_WIDTH_KEY)
    if (!raw) return next
    const parsed = JSON.parse(raw) as Partial<Record<ColId, number>>
    for (const id of Object.keys(DEFAULT_COL_WIDTHS) as ColId[]) {
      const w = parsed[id]
      if (typeof w === 'number' && Number.isFinite(w)) {
        next[id] = Math.max(MIN_COL_WIDTHS[id], Math.round(w))
      }
    }
  } catch {
    // ignore
  }
  return next
}

function persistColWidths(): void {
  try {
    localStorage.setItem(COL_WIDTH_KEY, JSON.stringify(colWidths.value))
  } catch {
    // ignore
  }
}

function loadRowHeights(): Record<string, number> {
  try {
    const raw = localStorage.getItem(rowHeightsKey())
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const next: Record<string, number> = {}
    for (const [id, h] of Object.entries(parsed)) {
      if (typeof h === 'number' && Number.isFinite(h)) {
        next[id] = Math.min(MAX_ROW_HEIGHT, Math.max(MIN_ROW_HEIGHT, Math.round(h)))
      }
    }
    return next
  } catch {
    return {}
  }
}

function persistRowHeights(): void {
  try {
    localStorage.setItem(rowHeightsKey(), JSON.stringify(rowHeights.value))
  } catch {
    // ignore
  }
}

function hasRowHeight(shotId: string): boolean {
  return typeof rowHeights.value[shotId] === 'number'
}

function rowStyle(shotId: string): { height?: string } {
  const h = rowHeights.value[shotId]
  if (!h) return {}
  return { height: `${h}px` }
}

function onRowResizeDown(shotId: string, e: MouseEvent): void {
  resizeCleanup?.()
  resizingRow.value = shotId
  const row = (e.currentTarget as HTMLElement).closest('tr')
  const startY = e.clientY
  const startH = rowHeights.value[shotId] ?? row?.offsetHeight ?? DEFAULT_ROW_HEIGHT

  const onMove = (ev: MouseEvent): void => {
    rowHeights.value = {
      ...rowHeights.value,
      [shotId]: Math.min(
        MAX_ROW_HEIGHT,
        Math.max(MIN_ROW_HEIGHT, startH + (ev.clientY - startY))
      )
    }
  }

  const onUp = (): void => {
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    resizingRow.value = null
    resizeCleanup = null
    persistRowHeights()
  }

  document.body.style.cursor = 'row-resize'
  document.body.style.userSelect = 'none'
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
  resizeCleanup = onUp
}

function colStyle(id: ColId): { width: string; minWidth: string; maxWidth: string } {
  const w = colWidths.value[id]
  const px = `${w}px`
  return { width: px, minWidth: px, maxWidth: px }
}

function onColResizeDown(id: ColId, e: MouseEvent): void {
  resizeCleanup?.()
  resizingCol.value = id
  const startX = e.clientX
  const startW = colWidths.value[id]

  const onMove = (ev: MouseEvent): void => {
    colWidths.value = {
      ...colWidths.value,
      [id]: Math.max(MIN_COL_WIDTHS[id], startW + (ev.clientX - startX))
    }
  }

  const onUp = (): void => {
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    resizingCol.value = null
    resizeCleanup = null
    persistColWidths()
  }

  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
  resizeCleanup = onUp
}

function storyboardOf(shot: Shot): ShotStoryboard {
  return normalizeStoryboard(shot)
}

function reviewStatusOf(shot: Shot): ShotReviewStatus {
  return normalizeShotReviewStatus(shot.reviewStatus)
}

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

async function persistShotUpdate(
  shot: Shot,
  patch: Partial<Pick<Shot, 'title' | 'prompt' | 'storyboard' | 'camera' | 'reviewStatus'>>
): Promise<void> {
  const latest =
    visibleShots.value.find((s) => s.id === shot.id) ??
    project.shots.find((s) => s.id === shot.id) ??
    shot
  const next: Shot = {
    ...latest,
    ...patch,
    camera: patch.camera ?? latest.camera,
    storyboard: patch.storyboard ?? latest.storyboard,
    reviewStatus:
      patch.reviewStatus ??
      normalizeShotReviewStatus(latest.reviewStatus) ??
      DEFAULT_SHOT_REVIEW_STATUS
  }
  await trackWrite(project.persistShotCommand(next, 'Edit shot table'))
}

async function onReviewStatusChange(shot: Shot, value: string): Promise<void> {
  const next = normalizeShotReviewStatus(value)
  if (next === reviewStatusOf(shot)) return
  await persistShotUpdate(shot, { reviewStatus: next })
}

async function onTitleChange(shot: Shot, title: string): Promise<void> {
  const trimmed = title.trim()
  if (!trimmed || trimmed === shot.title) return
  await persistShotUpdate(shot, { title: trimmed })
}

async function onDurationChange(shot: Shot, durationSec: number): Promise<void> {
  const sec = Number.isFinite(durationSec)
    ? Math.min(60, Math.max(1, Math.round(durationSec)))
    : shot.camera.durationSec
  if (sec === shot.camera.durationSec) return
  await persistShotUpdate(shot, {
    camera: { ...shot.camera, durationSec: sec }
  })
}

async function onStoryboardChange(
  shot: Shot,
  field: keyof ShotStoryboard,
  value: string
): Promise<void> {
  const storyboard: ShotStoryboard = { ...normalizeStoryboard(shot), [field]: value }
  const prompt = buildShotGenerationPrompt(storyboard, {
    stylePreset: project.config?.stylePreset
  })
  await persistShotUpdate(shot, { storyboard, prompt })
}

async function onAdd(): Promise<void> {
  error.value = ''
  try {
    if (isDraftAssetId(props.scriptAssetId)) {
      const resolution = project.config?.resolution ?? { w: 1280, h: 720 }
      const shot = draftStore.addDraftShot(props.scriptAssetId, resolution)
      if (!shot) {
        error.value = t('shot.error.draftMissing')
        return
      }
      await trackWrite(project.persistShot(shot))
      await selectShot(shot.id)
      return
    }
    const shot = await trackWrite(
      window.studio.createShot({ scriptAssetId: props.scriptAssetId })
    )
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
    if (isDraftAssetId(props.scriptAssetId)) {
      draftStore.deleteDraftShot(props.scriptAssetId, id)
      project.shots = project.shots.filter((s) => s.id !== id)
      if (project.activeShotId === id) {
        await selectShot(visibleShots.value[0]?.id ?? '')
      }
      return
    }
    await trackWrite(window.studio.deleteShot(id))
    await project.refreshShots()
    if (project.activeShotId === id) {
      await selectShot(visibleShots.value[0]?.id ?? '')
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

/** 关闭前：失焦触发 @change，并等在途写入完成 */
async function flushSave(): Promise<void> {
  const active = document.activeElement
  if (active instanceof HTMLElement && rootRef.value?.contains(active)) {
    active.blur()
  }
  await nextTick()
  if (pendingWrites.size) {
    await Promise.all([...pendingWrites])
  }
}

onBeforeUnmount(() => {
  resizeCleanup?.()
})

watch(
  () => props.scriptAssetId,
  () => {
    rowHeights.value = loadRowHeights()
  }
)

defineExpose({ flushSave })
</script>

<style scoped>
.shot-table {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--bg-panel);
}

.shot-table.resizing-col {
  cursor: col-resize;
}

.shot-table.resizing-row {
  cursor: row-resize;
}

.table-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.label {
  font-size: 12px;
  color: var(--text-muted);
}

.table-error {
  margin: 0;
  padding: 4px 10px;
  color: var(--danger);
  font-size: 11px;
  flex-shrink: 0;
}

.table-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

table {
  width: max-content;
  min-width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
  font-size: 12px;
}

thead th {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--bg-elevated);
  border-bottom: 1px solid var(--border);
  padding: 0;
  text-align: left;
  font-weight: 600;
  color: var(--text-muted);
  overflow: hidden;
}

.col-label {
  display: block;
  padding: 6px 10px 6px 8px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
}

.col-resize {
  position: absolute;
  top: 0;
  right: 0;
  width: 8px;
  height: 100%;
  cursor: col-resize;
  touch-action: none;
  z-index: 3;
}

.col-resize:hover,
.shot-table.resizing-col .col-resize {
  background: rgba(61, 139, 253, 0.35);
}

tbody td {
  border-bottom: 1px solid var(--border);
  padding: 4px 6px;
  vertical-align: top;
  overflow: hidden;
}

tbody tr.has-custom-height td {
  height: 0;
}

tbody tr.has-custom-height textarea,
tbody tr.has-custom-height input:not([type='number']) {
  height: 100%;
  min-height: 0;
  resize: none;
}

tbody tr.has-custom-height select {
  width: 100%;
}

tbody tr {
  cursor: pointer;
}

tbody tr:hover {
  background: rgba(255, 255, 255, 0.02);
}

tbody tr.active {
  background: rgba(61, 139, 253, 0.1);
}

.col-idx {
  text-align: center;
  color: var(--text-muted);
}

.row-head {
  position: relative;
  padding: 0;
}

.row-idx {
  display: block;
  padding: 4px 6px;
  pointer-events: none;
}

.row-resize {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 6px;
  cursor: row-resize;
  touch-action: none;
  z-index: 1;
}

.row-resize:hover,
.shot-table.resizing-row .row-resize {
  background: rgba(61, 139, 253, 0.35);
}

input,
textarea,
select {
  width: 100%;
  font-size: 12px;
  padding: 4px 6px;
  box-sizing: border-box;
}

textarea {
  min-height: 44px;
  resize: vertical;
}

textarea::-webkit-resizer {
  background-color: var(--bg-input);
  background-image: linear-gradient(
    135deg,
    transparent 55%,
    color-mix(in srgb, var(--text-muted) 45%, transparent) 55%,
    color-mix(in srgb, var(--text-muted) 45%, transparent) 62%,
    transparent 62%,
    transparent 72%,
    color-mix(in srgb, var(--text-muted) 60%, transparent) 72%,
    color-mix(in srgb, var(--text-muted) 60%, transparent) 79%,
    transparent 79%,
    transparent 88%,
    color-mix(in srgb, var(--text-muted) 75%, transparent) 88%,
    color-mix(in srgb, var(--text-muted) 75%, transparent) 100%
  );
  border: none;
}

.review-status {
  width: 100%;
  font-size: 11px;
  color: var(--text-muted);
}

.review-status[data-status='已审核'] {
  color: var(--success);
}

.del {
  padding: 0 6px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  opacity: 0.7;
}

.del:hover:not(:disabled) {
  color: var(--danger);
  opacity: 1;
}

.del:disabled {
  opacity: 0.25;
}
</style>
