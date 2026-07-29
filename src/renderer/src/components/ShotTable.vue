<template>
  <div
    ref="rootRef"
    class="shot-table"
    :class="{ 'resizing-col': !!resizingCol, 'resizing-row': !!resizingRow }"
    @pointerdown="onRootPointerDown"
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
            :class="{
              'has-custom-height': hasRowHeight(shot.id),
              'row-even': index % 2 === 1
            }"
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
            <td
              v-for="field in REF_FIELDS"
              :key="field"
              :style="colStyle(field)"
              class="col-refs"
              @click.stop
            >
              <div class="ref-list">
                <div
                  v-for="(refItem, index) in storyboardOf(shot)[field]"
                  :key="`${shot.id}-${field}-${index}`"
                  class="ref-chip"
                >
                  <img
                    v-if="chipThumb(refItem)"
                    class="ref-thumb"
                    :src="chipThumb(refItem)"
                    :alt="refItem.name"
                  />
                  <input
                    class="ref-name"
                    :value="refItem.name"
                    @change="
                      onRefNameChange(
                        shot,
                        field,
                        index,
                        ($event.target as HTMLInputElement).value
                      )
                    "
                  />
                  <button
                    type="button"
                    class="ref-bind"
                    :title="t('shot.table.bind.action')"
                    @click="openBind(shot.id, field, index)"
                  >
                    {{ t('shot.table.bind.action') }}
                  </button>
                  <button
                    type="button"
                    class="ref-remove"
                    :title="t('common.delete')"
                    @click="removeRef(shot, field, index)"
                  >
                    ×
                  </button>
                </div>
                <button
                  type="button"
                  class="ref-add"
                  :title="t('shot.table.bind.add')"
                  @click="addRef(shot, field)"
                >
                  +
                </button>
              </div>
            </td>
            <td :style="colStyle('visual')" @click.stop>
              <div class="field-stack">
                <textarea
                  rows="1"
                  :value="storyboardOf(shot).visualDescription"
                  :placeholder="t('shot.table.placeholder.visual')"
                  @input="onTextareaInput"
                  @change="
                    onStoryboardChange(
                      shot,
                      'visualDescription',
                      ($event.target as HTMLTextAreaElement).value
                    )
                  "
                />
                <ShotStagingPresetPicker
                  variant="cards"
                  :storyboard="storyboardOf(shot)"
                  @apply="(next) => onStagingStoryboardApply(shot, next)"
                />
              </div>
            </td>
            <td :style="colStyle('shotSize')" @click.stop>
              <select
                :value="storyboardOf(shot).shotSize"
                @change="
                  onStoryboardChange(shot, 'shotSize', ($event.target as HTMLSelectElement).value)
                "
              >
                <option value="">—</option>
                <option v-for="opt in SHOT_SIZE_OPTIONS" :key="opt" :value="opt">
                  {{ shotSizeLabel(opt) }}
                </option>
              </select>
            </td>
            <td :style="colStyle('lighting')" @click.stop>
              <div class="field-stack">
                <textarea
                  rows="1"
                  :value="storyboardOf(shot).lighting"
                  :placeholder="t('shot.table.placeholder.lighting')"
                  @input="onTextareaInput"
                  @change="
                    onStoryboardChange(
                      shot,
                      'lighting',
                      ($event.target as HTMLTextAreaElement).value
                    )
                  "
                />
                <ShotStagingPresetPicker
                  variant="cards"
                  field="lighting"
                  :storyboard="storyboardOf(shot)"
                  @apply="(next) => onStagingStoryboardApply(shot, next)"
                />
              </div>
            </td>
            <td :style="colStyle('dialogue')" @click.stop>
              <textarea
                rows="1"
                :value="storyboardOf(shot).dialogue"
                :placeholder="t('shot.table.placeholder.dialogue')"
                @input="onTextareaInput"
                @change="
                  onStoryboardChange(shot, 'dialogue', ($event.target as HTMLTextAreaElement).value)
                "
              />
            </td>
            <td :style="colStyle('sfx')" @click.stop>
              <input
                :value="storyboardOf(shot).soundFx"
                :placeholder="t('shot.table.placeholder.soundFx')"
                @change="
                  onStoryboardChange(shot, 'soundFx', ($event.target as HTMLInputElement).value)
                "
              />
            </td>
            <td :style="colStyle('camera')" @click.stop>
              <div class="field-stack">
                <textarea
                  rows="1"
                  :value="storyboardOf(shot).cameraMove"
                  :placeholder="t('shot.table.placeholder.cameraMove')"
                  @input="onTextareaInput"
                  @change="
                    onStoryboardChange(
                      shot,
                      'cameraMove',
                      ($event.target as HTMLTextAreaElement).value
                    )
                  "
                />
                <ShotStagingPresetPicker
                  variant="cards"
                  field="cameraMove"
                  :storyboard="storyboardOf(shot)"
                  @apply="(next) => onStagingStoryboardApply(shot, next)"
                />
              </div>
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

    <NarrativeWorldBindPicker
      v-if="bindTarget"
      :items="worldElementOutputs"
      :focus-type="bindFocusType"
      @select="onBindSelect"
      @close="bindTarget = null"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
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
  type ShotStoryboard,
  type WorldEntityKindLabel,
  type WorldEntityRef
} from '@shared/domain'
import type { WorldElementGenResult } from '@shared/graph'
import { useDraftStore } from '../stores/drafts'
import { useProjectStore } from '../stores/project'
import { useWorkspaceStore } from '../stores/workspace'
import { useStudioI18n } from '../composables/useStudioI18n'
import { resolveAssetPreviewUrl } from '../features/media/assetUrlCache'
import NarrativeWorldBindPicker from './NarrativeWorldBindPicker.vue'
import ShotStagingPresetPicker from './ShotStagingPresetPicker.vue'

type ColId =
  | 'idx'
  | 'title'
  | 'duration'
  | 'characters'
  | 'scenes'
  | 'props'
  | 'weapons'
  | 'visual'
  | 'shotSize'
  | 'lighting'
  | 'dialogue'
  | 'sfx'
  | 'camera'
  | 'status'
  | 'actions'

const REF_FIELDS = ['characters', 'scenes', 'props', 'weapons'] as const
type RefField = (typeof REF_FIELDS)[number]

const FIELD_TYPE: Record<RefField, WorldEntityKindLabel> = {
  characters: '角色',
  scenes: '场景',
  props: '道具',
  weapons: '武器'
}

const COL_WIDTH_KEY = 'studio.script.shotTableColWidths'
const DEFAULT_ROW_HEIGHT = 48
const MIN_ROW_HEIGHT = 32
const MAX_ROW_HEIGHT = 480
/** 约四行正文（14px × 1.8 行高）加上下内边距 */
const MIN_TEXTAREA_HEIGHT = 122
const MAX_TEXTAREA_HEIGHT = MAX_ROW_HEIGHT

const DEFAULT_COL_WIDTHS: Record<ColId, number> = {
  idx: 36,
  title: 100,
  duration: 64,
  characters: 148,
  scenes: 148,
  props: 148,
  weapons: 148,
  visual: 260,
  shotSize: 96,
  lighting: 200,
  dialogue: 160,
  sfx: 120,
  camera: 200,
  status: 88,
  actions: 36
}

const MIN_COL_WIDTHS: Record<ColId, number> = {
  idx: 28,
  title: 56,
  duration: 48,
  characters: 120,
  scenes: 120,
  props: 120,
  weapons: 120,
  visual: 120,
  shotSize: 72,
  lighting: 110,
  dialogue: 80,
  sfx: 72,
  camera: 110,
  status: 72,
  actions: 32
}

const props = withDefaults(
  defineProps<{
    scriptAssetId: string
    worldElementOutputs?: WorldElementGenResult[]
  }>(),
  {
    worldElementOutputs: () => []
  }
)

const project = useProjectStore()
const workspace = useWorkspaceStore()
const draftStore = useDraftStore()
const { t, shotSizeLabel } = useStudioI18n()
const columns = computed<{ id: ColId; label: string }[]>(() => [
  { id: 'idx', label: '#' },
  { id: 'title', label: t('shot.table.column.name') },
  { id: 'duration', label: t('shot.table.column.duration') },
  { id: 'characters', label: t('shot.table.column.characters') },
  { id: 'scenes', label: t('shot.table.column.scenes') },
  { id: 'props', label: t('shot.table.column.props') },
  { id: 'weapons', label: t('shot.table.column.weapons') },
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
const bindTarget = ref<{ shotId: string; field: RefField; index: number } | null>(null)
const chipThumbs = ref<Record<string, string>>({})
let chipToken = 0
const bindFocusType = computed(() =>
  bindTarget.value ? FIELD_TYPE[bindTarget.value.field] : undefined
)
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
      [shotId]: Math.min(MAX_ROW_HEIGHT, Math.max(MIN_ROW_HEIGHT, startH + (ev.clientY - startY)))
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

function colStyle(id: ColId): {
  width: string
  minWidth: string
  maxWidth: string
} {
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

function autosizeTextarea(el: HTMLTextAreaElement): void {
  const row = el.closest('tr')
  if (row?.classList.contains('has-custom-height')) {
    el.style.height = ''
    return
  }
  if (el.dataset.manualResize === 'true') return
  el.style.height = '0px'
  const next = Math.min(
    MAX_TEXTAREA_HEIGHT,
    Math.max(MIN_TEXTAREA_HEIGHT, el.scrollHeight)
  )
  el.style.height = `${next}px`
}

function autosizeAllTextareas(): void {
  const root = rootRef.value
  if (!root) return
  root.querySelectorAll('textarea').forEach((node) => {
    autosizeTextarea(node as HTMLTextAreaElement)
  })
}

function scheduleAutosize(): void {
  void nextTick(() => {
    autosizeAllTextareas()
  })
}

function onTextareaInput(event: Event): void {
  const el = event.target
  if (el instanceof HTMLTextAreaElement) autosizeTextarea(el)
}

function onRootPointerDown(event: PointerEvent): void {
  const el = event.target
  if (!(el instanceof HTMLTextAreaElement)) return
  const rect = el.getBoundingClientRect()
  const onResizeHandle = event.clientX >= rect.right - 20 && event.clientY >= rect.bottom - 20
  if (!onResizeHandle) return

  const startHeight = el.offsetHeight
  const onPointerUp = (): void => {
    window.removeEventListener('pointerup', onPointerUp)
    if (Math.abs(el.offsetHeight - startHeight) > 1) {
      el.dataset.manualResize = 'true'
    }
  }
  window.addEventListener('pointerup', onPointerUp)
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


function refKey(refItem: WorldEntityRef, fallback = ''): string {
  return `${refItem.name}|${refItem.imageUrl ?? ''}|${fallback}`
}

function chipThumb(refItem: WorldEntityRef): string {
  const url = refItem.imageUrl?.trim() || ''
  if (!url) return ''
  if (url.startsWith('data:') || url.startsWith('blob:') || /^https?:/i.test(url)) return url
  return chipThumbs.value[refKey(refItem)] || ''
}

async function refreshChipThumbs(): Promise<void> {
  const token = ++chipToken
  const next: Record<string, string> = {}
  const pending: Array<Promise<void>> = []
  for (const shot of visibleShots.value) {
    const sb = normalizeStoryboard(shot)
    for (const field of REF_FIELDS) {
      sb[field].forEach((refItem, index) => {
        const url = refItem.imageUrl?.trim() || ''
        if (!url || url.startsWith('data:') || url.startsWith('blob:') || /^https?:/i.test(url)) {
          return
        }
        pending.push(
          (async () => {
            try {
              const resolved = await resolveAssetPreviewUrl(url)
              if (token !== chipToken) return
              next[refKey(refItem, `${shot.id}:${field}:${index}`)] = resolved
              next[refKey(refItem)] = resolved
            } catch {
              /* ignore */
            }
          })()
        )
      })
    }
  }
  await Promise.all(pending)
  if (token === chipToken) chipThumbs.value = next
}

watch(
  visibleShots,
  () => {
    void refreshChipThumbs()
  },
  { deep: true }
)

async function persistStoryboard(shot: Shot, storyboard: ShotStoryboard): Promise<void> {
  const prompt = buildShotGenerationPrompt(storyboard, {
    stylePreset: project.config?.stylePreset
  })
  await persistShotUpdate(shot, { storyboard, prompt })
}

async function onRefNameChange(
  shot: Shot,
  field: RefField,
  index: number,
  value: string
): Promise<void> {
  const storyboard = normalizeStoryboard(shot)
  const trimmed = value.trim()
  const current = storyboard[field][index]
  if (!current || trimmed === current.name) return
  if (!trimmed) storyboard[field].splice(index, 1)
  else storyboard[field][index] = { ...current, name: trimmed }
  await persistStoryboard(shot, storyboard)
}

async function addRef(shot: Shot, field: RefField): Promise<void> {
  const storyboard = normalizeStoryboard(shot)
  const index = storyboard[field].length
  storyboard[field].push({ name: '', type: FIELD_TYPE[field] })
  // 先落盘再开面板，取消绑定时留下空行供手输名称
  await persistStoryboard(shot, storyboard)
  openBind(shot.id, field, index)
}

async function removeRef(shot: Shot, field: RefField, index: number): Promise<void> {
  const storyboard = normalizeStoryboard(shot)
  storyboard[field].splice(index, 1)
  await persistStoryboard(shot, storyboard)
}

function openBind(shotId: string, field: RefField, index: number): void {
  bindTarget.value = { shotId, field, index }
}

async function onBindSelect(selected: WorldEntityRef): Promise<void> {
  const target = bindTarget.value
  bindTarget.value = null
  if (!target) return
  const shot = visibleShots.value.find((item) => item.id === target.shotId)
  if (!shot) return
  const storyboard = normalizeStoryboard(shot)
  const list = storyboard[target.field]
  const next = {
    name: selected.name,
    imageUrl: selected.imageUrl,
    type: selected.type ?? FIELD_TYPE[target.field]
  }
  // 目标行可能因写入未同步而缺失，此时按新增处理，避免静默丢弃选择
  if (target.index >= 0 && target.index < list.length) list[target.index] = next
  else list.push(next)
  await persistStoryboard(shot, storyboard)
}

async function onStoryboardChange(
  shot: Shot,
  field: keyof ShotStoryboard,
  value: string
): Promise<void> {
  const storyboard: ShotStoryboard = {
    ...normalizeStoryboard(shot),
    [field]: value
  }
  const prompt = buildShotGenerationPrompt(storyboard, {
    stylePreset: project.config?.stylePreset
  })
  await persistShotUpdate(shot, { storyboard, prompt })
  scheduleAutosize()
}

async function onStagingStoryboardApply(shot: Shot, storyboard: ShotStoryboard): Promise<void> {
  const prompt = buildShotGenerationPrompt(storyboard, {
    stylePreset: project.config?.stylePreset
  })
  await persistShotUpdate(shot, { storyboard, prompt })
  scheduleAutosize()
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
    const shot = await trackWrite(window.studio.createShot({ scriptAssetId: props.scriptAssetId }))
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

onMounted(() => {
  scheduleAutosize()
})

onBeforeUnmount(() => {
  resizeCleanup?.()
})

watch(
  () => props.scriptAssetId,
  () => {
    rowHeights.value = loadRowHeights()
    scheduleAutosize()
  }
)

watch(
  visibleShots,
  () => {
    scheduleAutosize()
  },
  { deep: true }
)

watch(
  colWidths,
  () => {
    scheduleAutosize()
  },
  { deep: true }
)

watch(
  rowHeights,
  () => {
    scheduleAutosize()
  },
  { deep: true }
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
  --shot-row-odd: var(--bg-panel);
  --shot-row-even: var(--bg-elevated);
  --shot-card-odd: var(--bg-input);
  --shot-card-even: var(--bg-hover);
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
  background: var(--accent-28);
}

tbody td {
  border-bottom: 1px solid var(--border);
  padding: 6px 8px;
  vertical-align: top;
  overflow: hidden;
  transition: background-color 120ms ease;
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

tbody tr.has-custom-height .field-stack {
  height: 100%;
}

tbody tr.has-custom-height .field-stack textarea {
  flex: 1;
  min-height: 0;
}

tbody tr.has-custom-height select {
  width: 100%;
}

tbody tr {
  cursor: pointer;
}

tbody tr > td {
  background-color: var(--shot-row-odd);
}

tbody tr.row-even > td {
  background-color: var(--shot-row-even);
}

tbody tr:hover > td {
  background-color: color-mix(in srgb, var(--shot-row-odd) 78%, var(--accent));
}

tbody tr.row-even:hover > td {
  background-color: color-mix(in srgb, var(--shot-row-even) 78%, var(--accent));
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
  background: var(--accent-28);
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
  --textarea-bg: var(--shot-card-odd);
  min-height: 122px;
  max-height: 480px;
  padding: 10px 11px;
  overflow: auto;
  resize: vertical;
  field-sizing: content;
  border: 1px solid color-mix(in srgb, var(--border) 82%, var(--text-muted));
  border-radius: 7px;
  background: linear-gradient(
    145deg,
    color-mix(in srgb, var(--shot-card-odd) 92%, white),
    var(--shot-card-odd)
  );
  color: var(--text);
  font-family: inherit;
  font-size: 14px;
  font-weight: 400;
  line-height: 1.8;
  letter-spacing: 0.015em;
  text-rendering: optimizeLegibility;
  box-shadow:
    0 1px 2px rgba(0, 0, 0, 0.16),
    inset 0 1px 0 color-mix(in srgb, white 4%, transparent);
  transition:
    border-color 140ms ease,
    box-shadow 140ms ease,
    background-color 140ms ease;
}

textarea:hover {
  border-color: color-mix(in srgb, var(--border) 55%, var(--text-muted));
}

textarea:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow:
    0 0 0 2px color-mix(in srgb, var(--accent) 22%, transparent),
    0 3px 10px rgba(0, 0, 0, 0.18);
}

textarea::placeholder {
  color: var(--text-muted);
  line-height: inherit;
  opacity: 0.72;
}

textarea::-webkit-resizer {
  border: none;
  background-color: var(--textarea-bg);
  background-image: var(--resizer-grip);
}

input,
select {
  background-color: var(--shot-card-odd);
}

tbody tr.row-even > td input,
tbody tr.row-even > td select {
  background-color: var(--shot-card-even);
}

tbody tr.row-even > td textarea {
  --textarea-bg: var(--shot-card-even);
  background: linear-gradient(
    145deg,
    color-mix(in srgb, var(--shot-card-even) 88%, white),
    var(--shot-card-even)
  );
  border-color: color-mix(in srgb, var(--border) 50%, var(--text-muted));
}

.field-stack {
  display: flex;
  flex-direction: column;
  gap: 4px;
  height: 100%;
  min-height: 0;
}

.field-stack :deep(.staging-cards-anchor) {
  flex-shrink: 0;
  align-self: flex-start;
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

.ref-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ref-chip {
  display: flex;
  align-items: center;
  gap: 4px;
}

.ref-thumb {
  width: 22px;
  height: 22px;
  border-radius: 3px;
  object-fit: cover;
  flex-shrink: 0;
  background: var(--bg);
}

.ref-name {
  flex: 1;
  min-width: 0;
  padding: 3px 4px;
}

.ref-bind {
  font-size: 11px;
  padding: 2px 4px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-elevated);
  color: var(--text-muted);
  cursor: pointer;
  flex-shrink: 0;
}

.ref-add,
.ref-remove {
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  flex-shrink: 0;
}

.ref-add {
  align-self: flex-start;
  font-size: 14px;
  line-height: 1;
  padding: 2px 6px;
  border: 1px dashed var(--border);
  border-radius: 4px;
}

.ref-remove {
  font-size: 16px;
}
</style>
