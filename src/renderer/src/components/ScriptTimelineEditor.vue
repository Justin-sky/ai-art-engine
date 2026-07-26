<template>
  <div class="script-timeline">
    <div class="workspace">
      <aside class="panel sources-panel">
        <div class="panel-head">
          <span class="panel-title">{{ t('script.timeline.sources') }}</span>
          <div class="panel-actions">
            <button type="button" class="ghost-btn" :disabled="sourcesBusy" @click="reloadSources">
              {{ sourcesBusy ? '…' : t('script.timeline.refreshSources') }}
            </button>
            <button
              type="button"
              class="ghost-btn"
              :disabled="!sources.length"
              @click="autoPlaceAll"
            >
              {{ t('script.timeline.autoPlace') }}
            </button>
          </div>
        </div>
        <div v-if="!sources.length" class="panel-empty">{{ t('script.timeline.sourcesEmpty') }}</div>
        <div v-else class="source-list">
          <button
            v-for="src in sources"
            :key="src.id"
            type="button"
            class="source-card"
            draggable="true"
            @dragstart="onSourceDragStart($event, src)"
            @dblclick="addSourceToTrack(src, 'video')"
          >
            <span class="source-thumb" aria-hidden="true" />
            <span class="source-meta">
              <span class="source-name">{{ src.title }}</span>
              <span v-if="src.durationSec" class="source-dur">{{ formatTime(src.durationSec) }}</span>
            </span>
          </button>
        </div>
      </aside>

      <section class="panel preview-panel">
        <div class="preview-stage">
          <video
            v-if="previewSrc"
            ref="previewEl"
            class="preview-video"
            :src="previewSrc"
            playsinline
            preload="metadata"
            @ended="onPreviewEnded"
            @timeupdate="onPreviewTimeUpdate"
            @loadedmetadata="onPreviewLoaded"
          />
          <div v-else class="preview-empty">
            <span class="play-glyph" aria-hidden="true" />
            <p>{{ t('script.timeline.emptyPreview') }}</p>
          </div>
          <div class="preview-transport">
            <button type="button" class="ctrl" :title="t('script.timeline.play')" @click="togglePlay">
              <span :class="playing ? 'icon-pause' : 'icon-play'" />
            </button>
            <span class="time">{{ formatTime(playheadSec) }} / {{ formatTime(totalDuration) }}</span>
          </div>
        </div>
      </section>

      <aside class="panel assets-panel">
        <div class="panel-head">
          <span class="panel-title">{{ t('script.timeline.assetsPanel') }}</span>
        </div>
        <div class="assets-embed">
          <AssetBrowser embedded />
        </div>
      </aside>
    </div>

    <section class="timeline-dock" :class="{ collapsed: timelineCollapsed }">
      <header class="timeline-bar">
        <span class="timeline-bar-title">{{ t('script.dialog.timeline') }}</span>
        <div class="timeline-controls" @pointerdown.stop>
          <label class="ctrl-field" :title="t('script.timeline.durationHint')">
            <span>{{ t('script.timeline.duration') }}</span>
            <input
              v-model.number="durationInputSec"
              class="ctrl-input"
              type="number"
              min="1"
              max="3600"
              step="1"
              @change="commitDuration"
            />
            <span class="ctrl-unit">s</span>
          </label>
          <label class="ctrl-field">
            <span>{{ t('script.timeline.rate') }}</span>
            <select v-model.number="playbackRate" class="ctrl-select" @change="onRateChange">
              <option v-for="rate in PLAYBACK_RATE_OPTIONS" :key="rate" :value="rate">
                {{ rate }}x
              </option>
            </select>
          </label>
          <label class="ctrl-check">
            <input v-model="loopPlayback" type="checkbox" @change="scheduleSave" />
            <span>{{ t('script.timeline.loop') }}</span>
          </label>
          <button
            type="button"
            class="ghost-btn"
            :title="t('script.timeline.toStart')"
            @click="seekToStart"
          >
            ⏮
          </button>
          <button
            type="button"
            class="ghost-btn"
            :title="playing ? t('script.timeline.pause') : t('script.timeline.play')"
            @click="togglePlay"
          >
            {{ playing ? '⏸' : '▶' }}
          </button>
          <button
            type="button"
            class="ghost-btn"
            :title="t('script.timeline.zoomFit')"
            @click="zoomFit"
          >
            {{ t('script.timeline.zoomFit') }}
          </button>
          <span class="zoom-readout">{{ Math.round(zoomFactor * 100) }}%</span>
        </div>
        <GraphToolbarCollapseBtn v-model="timelineCollapsed" />
      </header>

      <div
        v-show="!timelineCollapsed"
        ref="timelineBoardEl"
        class="timeline-board"
        :class="{ scrollable: needsHScroll }"
        @wheel.prevent="onTimelineWheel"
      >
        <div class="timeline-inner" :style="{ width: `${TRACK_LABEL_W + laneWidth}px` }">
          <div class="ruler-row">
            <div class="track-label gutter" />
            <div class="ruler" @pointerdown="onRulerPointerDown">
              <span
                v-for="mark in rulerMarks"
                :key="mark.t"
                class="ruler-tick"
                :style="{ left: `${mark.x}px` }"
              />
              <span
                v-for="mark in rulerMarks"
                :key="`lbl-${mark.t}`"
                class="ruler-mark"
                :class="{ start: mark.t === 0, end: mark.isEnd }"
                :style="{ left: `${mark.x}px` }"
              >
                {{ mark.label }}
              </span>
            </div>
          </div>

          <div
            v-for="track in tracks"
            :key="track.kind"
            class="track-row"
            :class="{ droppable: track.kind !== 'subtitle' }"
            @dragover.prevent="onTrackDragOver($event, track.kind)"
            @drop.prevent="onTrackDrop($event, track.kind)"
          >
            <div class="track-label">{{ track.label }}</div>
            <div class="track-lane">
              <template v-if="track.kind === 'video' && !clipsOn(track.kind).length">
                <div class="lane-empty">
                  <span class="play-glyph sm" aria-hidden="true" />
                  <span>{{ t('script.timeline.videoEmpty') }}</span>
                </div>
                <button type="button" class="create-hint" @click="autoPlaceAll">
                  {{ t('script.timeline.createShots') }}
                </button>
              </template>
              <template v-else-if="track.kind === 'voice' && !clipsOn(track.kind).length">
                <div class="lane-muted">
                  <span class="speaker" aria-hidden="true" />
                  <span>{{ t('script.timeline.none') }}</span>
                </div>
              </template>
              <button
                v-for="clip in clipsOn(track.kind)"
                :key="clip.id"
                type="button"
                class="clip"
                :class="{ active: clip.id === activeClipId }"
                :style="clipStyle(clip)"
                draggable="true"
                @dragstart="onClipDragStart($event, clip)"
                @pointerdown.stop="selectClip(clip)"
                @dblclick.stop="seekToClip(clip)"
              >
                <span class="clip-title">{{ clip.title }}</span>
                <span
                  class="clip-remove"
                  :title="t('script.timeline.removeClip')"
                  @click.stop="removeClip(clip.id)"
                >
                  ×
                </span>
              </button>
            </div>
          </div>

          <div
            class="playhead"
            :style="{ left: `${TRACK_LABEL_W + timeToX(playheadSec)}px` }"
            aria-hidden="true"
          >
            <span class="playhead-cap" />
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { isDraftAssetId, type AssetInfo } from '@shared/domain'
import {
  normalizePlaybackRate,
  readScriptTimelineFromGenParams,
  withScriptTimeline,
  type ScriptTimelineClip,
  type ScriptTimelineDocument,
  type ScriptTimelineSource,
  type ScriptTimelineTrackKind
} from '@shared/graph'
import { useStudioI18n } from '../composables/useStudioI18n'
import { persistAssetRecord } from '../composables/useAssetRecord'
import { useDraftStore } from '../stores/drafts'
import { useProjectStore } from '../stores/project'
import { useWorkspaceStore } from '../stores/workspace'
import { collectScriptTimelineSources } from '../features/script/collectScriptTimelineSources'
import { toPlain } from '../utils/toPlain'
import AssetBrowser from './AssetBrowser.vue'
import GraphToolbarCollapseBtn from './GraphToolbarCollapseBtn.vue'

const props = defineProps<{
  scriptAssetId: string
}>()

const { t } = useStudioI18n()
const project = useProjectStore()
const drafts = useDraftStore()
const workspace = useWorkspaceStore()

const DRAFT_MIME = 'application/x-aiart-timeline-source'
const TRACK_LABEL_W = 72
const PX_PER_SEC_MAX = 160
const PX_PER_SEC_MIN = 4
const ZOOM_MIN = 0.25
const ZOOM_MAX = 8
const minLaneSec = 12
const PLAYBACK_RATE_OPTIONS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2]

const sources = ref<ScriptTimelineSource[]>([])
const clips = ref<ScriptTimelineClip[]>([])
const sourcesBusy = ref(false)
const playheadSec = ref(0)
const playing = ref(false)
const activeClipId = ref<string | null>(null)
const previewSrc = ref('')
const previewEl = ref<HTMLVideoElement | null>(null)
const timelineBoardEl = ref<HTMLElement | null>(null)
const timelineCollapsed = ref(false)
const viewportLanePx = ref(0)
/** 相对「铺满可视宽度」的缩放倍率 */
const zoomFactor = ref(1)
const durationSec = ref(minLaneSec)
const durationInputSec = ref(minLaneSec)
const playbackRate = ref(1)
const loopPlayback = ref(false)

let saveTimer: ReturnType<typeof setTimeout> | null = null
let playSeq = 0

const hostId = computed(() => `asset:${props.scriptAssetId}`)

const tracks = computed(() => [
  { kind: 'video' as const, label: t('script.timeline.track.video') },
  { kind: 'voice' as const, label: t('script.timeline.track.voice') },
  { kind: 'subtitle' as const, label: t('script.timeline.track.subtitle') },
  { kind: 'music' as const, label: t('script.timeline.track.music') }
])

const contentEndSec = computed(() => {
  let max = 0
  for (const clip of clips.value) {
    max = Math.max(max, clip.startSec + clip.durationSec)
  }
  return max
})

/** 时间线总时长：用户设置与内容末端取较大 */
const totalDuration = computed(() =>
  Math.max(minLaneSec, durationSec.value, contentEndSec.value + (contentEndSec.value > 0 ? 0.5 : 0))
)

const fitPxPerSec = computed(() => {
  if (viewportLanePx.value <= 0) return 48
  return viewportLanePx.value / totalDuration.value
})

const pxPerSec = computed(() => {
  const raw = fitPxPerSec.value * zoomFactor.value
  return Math.min(PX_PER_SEC_MAX, Math.max(PX_PER_SEC_MIN, raw))
})

const laneWidth = computed(() =>
  Math.max(Math.ceil(totalDuration.value * pxPerSec.value), viewportLanePx.value || 0)
)

const needsHScroll = computed(() => laneWidth.value > viewportLanePx.value + 1)

const rulerMarks = computed(() => {
  const marks: Array<{ t: number; x: number; label: string; isEnd?: boolean }> = []
  const duration = totalDuration.value
  const pps = pxPerSec.value
  const step = pps >= 48 ? 1 : pps >= 24 ? 2 : pps >= 12 ? 5 : pps >= 6 ? 10 : 30
  for (let t = 0; t <= duration + 0.001; t += step) {
    const sec = Math.min(duration, t)
    marks.push({
      t: sec,
      x: timeToX(sec),
      label: formatTime(sec),
      isEnd: Math.abs(sec - duration) < 0.001
    })
    if (sec >= duration) break
  }
  const last = marks[marks.length - 1]
  if (!last || Math.abs(last.t - duration) > 0.05) {
    marks.push({
      t: duration,
      x: timeToX(duration),
      label: formatTime(duration),
      isEnd: true
    })
  } else {
    last.isEnd = true
  }
  return marks
})

function timeToX(sec: number): number {
  return Math.max(0, sec) * pxPerSec.value
}

function xToTime(x: number): number {
  return Math.max(0, x / pxPerSec.value)
}

function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${String(r).padStart(2, '0')}`
}

function clipsOn(kind: ScriptTimelineTrackKind): ScriptTimelineClip[] {
  return clips.value
    .filter((c) => c.track === kind)
    .slice()
    .sort((a, b) => a.startSec - b.startSec)
}

function clipStyle(clip: ScriptTimelineClip): Record<string, string> {
  return {
    left: `${timeToX(clip.startSec)}px`,
    width: `${Math.max(36, timeToX(clip.durationSec))}px`
  }
}

function readGenParams(): Record<string, unknown> {
  if (isDraftAssetId(props.scriptAssetId)) {
    return { ...(drafts.getDraft(props.scriptAssetId)?.genParams ?? {}) }
  }
  const asset = project.assets.find((a) => a.id === props.scriptAssetId)
  return { ...((asset?.genParams as Record<string, unknown> | undefined) ?? {}) }
}

function loadPersisted(): void {
  const doc = readScriptTimelineFromGenParams(readGenParams())
  clips.value = doc.clips.map((c) => ({ ...c }))
  if (doc.sources?.length) sources.value = doc.sources.map((s) => ({ ...s }))
  const settings = doc.settings
  const content = contentEndSec.value
  const nextDuration = Math.max(
    minLaneSec,
    settings?.durationSec ?? Math.max(minLaneSec, content > 0 ? content + 2 : minLaneSec)
  )
  durationSec.value = nextDuration
  durationInputSec.value = Math.round(nextDuration)
  playbackRate.value = normalizePlaybackRate(settings?.playbackRate ?? 1)
  loopPlayback.value = settings?.loop === true
  applyPlaybackRate()
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    void persist()
  }, 280)
}

async function persist(): Promise<void> {
  const doc: ScriptTimelineDocument = {
    clips: toPlain(clips.value) as ScriptTimelineClip[],
    sources: toPlain(sources.value) as ScriptTimelineSource[],
    settings: {
      durationSec: durationSec.value,
      playbackRate: playbackRate.value,
      loop: loopPlayback.value
    }
  }
  const next = withScriptTimeline(readGenParams(), doc)
  if (isDraftAssetId(props.scriptAssetId)) {
    drafts.updateDraft(props.scriptAssetId, { genParams: next })
    return
  }
  await persistAssetRecord(props.scriptAssetId, { genParams: next })
}

function commitDuration(): void {
  const n = Number(durationInputSec.value)
  if (!Number.isFinite(n)) {
    durationInputSec.value = Math.round(durationSec.value)
    return
  }
  durationSec.value = Math.min(3600, Math.max(minLaneSec, Math.max(n, contentEndSec.value)))
  durationInputSec.value = Math.round(durationSec.value)
  scheduleSave()
}

function onRateChange(): void {
  playbackRate.value = normalizePlaybackRate(playbackRate.value)
  applyPlaybackRate()
  scheduleSave()
}

function applyPlaybackRate(): void {
  const el = previewEl.value
  if (el) el.playbackRate = playbackRate.value
}

function seekToStart(): void {
  playheadSec.value = 0
  void syncPreviewToPlayhead()
}

function zoomFit(): void {
  zoomFactor.value = 1
  const board = timelineBoardEl.value
  if (board) board.scrollLeft = 0
}

function onTimelineWheel(e: WheelEvent): void {
  const board = timelineBoardEl.value
  if (!board) return
  const rect = board.getBoundingClientRect()
  const cursorLaneX = e.clientX - rect.left + board.scrollLeft - TRACK_LABEL_W
  const timeAtCursor = Math.max(0, cursorLaneX / pxPerSec.value)
  const direction = e.deltaY < 0 ? 1 : -1
  const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoomFactor.value * (direction > 0 ? 1.12 : 1 / 1.12)))
  if (Math.abs(next - zoomFactor.value) < 0.001) return
  zoomFactor.value = next
  void nextTick(() => {
    const newX = timeAtCursor * pxPerSec.value
    const viewX = e.clientX - rect.left - TRACK_LABEL_W
    board.scrollLeft = Math.max(0, newX - viewX)
  })
}

async function resolveSrc(source: {
  relativePath?: string
  assetId?: string
}): Promise<string> {
  const rel =
    source.relativePath?.trim() ||
    (source.assetId
      ? project.assets.find((a) => a.id === source.assetId)?.relativePath?.trim()
      : '') ||
    ''
  if (!rel) return ''
  try {
    return (await window.studio.getAssetFileUrl(rel)) || ''
  } catch {
    return ''
  }
}

async function probeDuration(src: string): Promise<number> {
  if (!src) return 3
  return new Promise((resolve) => {
    const el = document.createElement('video')
    el.preload = 'metadata'
    el.src = src
    const done = (sec: number) => {
      el.removeAttribute('src')
      el.load()
      resolve(sec > 0 && Number.isFinite(sec) ? sec : 3)
    }
    el.onloadedmetadata = () => done(el.duration)
    el.onerror = () => done(3)
    window.setTimeout(() => done(3), 4000)
  })
}

async function reloadSources(): Promise<void> {
  sourcesBusy.value = true
  try {
    const next = await collectScriptTimelineSources({
      scriptAssetId: props.scriptAssetId,
      hostId: hostId.value
    })
    sources.value = next
    scheduleSave()
  } finally {
    sourcesBusy.value = false
  }
}

function newClipId(): string {
  return `clip:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 7)}`
}

function nextStartOnTrack(kind: ScriptTimelineTrackKind): number {
  const list = clipsOn(kind)
  if (!list.length) return 0
  const last = list[list.length - 1]!
  return last.startSec + last.durationSec
}

async function addSourceToTrack(
  source: ScriptTimelineSource,
  track: ScriptTimelineTrackKind,
  startSec?: number
): Promise<void> {
  const url = await resolveSrc(source)
  const durationSec = source.durationSec && source.durationSec > 0
    ? source.durationSec
    : await probeDuration(url)
  const clip: ScriptTimelineClip = {
    id: newClipId(),
    track,
    sourceId: source.id,
    title: source.title,
    relativePath: source.relativePath,
    assetId: source.assetId,
    startSec: startSec ?? nextStartOnTrack(track),
    durationSec
  }
  clips.value = [...clips.value, clip]
  activeClipId.value = clip.id
  scheduleSave()
  if (track === 'video') void showClipPreview(clip)
}

async function autoPlaceAll(): Promise<void> {
  if (!sources.value.length) await reloadSources()
  if (!sources.value.length) return
  clips.value = clips.value.filter((c) => c.track !== 'video')
  let cursor = 0
  for (const src of sources.value) {
    const url = await resolveSrc(src)
    const durationSec = src.durationSec && src.durationSec > 0
      ? src.durationSec
      : await probeDuration(url)
    clips.value.push({
      id: newClipId(),
      track: 'video',
      sourceId: src.id,
      title: src.title,
      relativePath: src.relativePath,
      assetId: src.assetId,
      startSec: cursor,
      durationSec
    })
    cursor += durationSec
  }
  clips.value = [...clips.value]
  scheduleSave()
  const first = clipsOn('video')[0]
  if (first) {
    activeClipId.value = first.id
    void showClipPreview(first)
  }
}

function removeClip(id: string): void {
  clips.value = clips.value.filter((c) => c.id !== id)
  if (activeClipId.value === id) activeClipId.value = null
  scheduleSave()
}

function selectClip(clip: ScriptTimelineClip): void {
  activeClipId.value = clip.id
  void showClipPreview(clip)
}

function seekToClip(clip: ScriptTimelineClip): void {
  playheadSec.value = clip.startSec
  void showClipPreview(clip)
}

async function showClipPreview(clip: ScriptTimelineClip): Promise<void> {
  previewSrc.value = await resolveSrc(clip)
  await Promise.resolve()
  const el = previewEl.value
  if (!el) return
  applyPlaybackRate()
  try {
    el.currentTime = 0
  } catch {
    /* ignore */
  }
}

function onSourceDragStart(e: DragEvent, source: ScriptTimelineSource): void {
  e.dataTransfer?.setData(DRAFT_MIME, JSON.stringify(source))
  e.dataTransfer!.effectAllowed = 'copy'
}

function onClipDragStart(e: DragEvent, clip: ScriptTimelineClip): void {
  e.dataTransfer?.setData(
    DRAFT_MIME,
    JSON.stringify({
      id: clip.sourceId,
      title: clip.title,
      relativePath: clip.relativePath,
      assetId: clip.assetId,
      durationSec: clip.durationSec,
      _moveClipId: clip.id
    })
  )
  e.dataTransfer!.effectAllowed = 'move'
}

function onTrackDragOver(e: DragEvent, kind: ScriptTimelineTrackKind): void {
  if (kind === 'subtitle') return
  const asset = workspace.resolveDraggedAsset(e)
  if (asset) {
    if (!canDropAssetOnTrack(asset, kind)) return
    e.dataTransfer!.dropEffect = 'copy'
    return
  }
  if (e.dataTransfer?.types.includes(DRAFT_MIME)) {
    e.dataTransfer!.dropEffect = 'copy'
  }
}

function canDropAssetOnTrack(asset: AssetInfo, kind: ScriptTimelineTrackKind): boolean {
  if (kind === 'video') return asset.type === 'video'
  if (kind === 'voice' || kind === 'music') return asset.type === 'voice'
  return false
}

function assetToSource(asset: AssetInfo): ScriptTimelineSource | null {
  if (asset.type !== 'video' && asset.type !== 'voice') return null
  const relativePath = asset.relativePath?.trim()
  if (!relativePath && !asset.id) return null
  return {
    id: asset.id,
    title: asset.name?.trim() || asset.id,
    relativePath: relativePath || undefined,
    assetId: asset.id
  }
}

function dropStartFromEvent(e: DragEvent, kind: ScriptTimelineTrackKind): number {
  const lane = (e.currentTarget as HTMLElement).querySelector('.track-lane') as HTMLElement | null
  const rect = lane?.getBoundingClientRect()
  return rect ? Math.max(0, xToTime(e.clientX - rect.left)) : nextStartOnTrack(kind)
}

async function onTrackDrop(e: DragEvent, kind: ScriptTimelineTrackKind): Promise<void> {
  if (kind === 'subtitle') return
  const dropStart = dropStartFromEvent(e, kind)

  const raw = e.dataTransfer?.getData(DRAFT_MIME)
  if (raw) {
    let payload: ScriptTimelineSource & { _moveClipId?: string; durationSec?: number }
    try {
      payload = JSON.parse(raw)
    } catch {
      return
    }
    if (payload._moveClipId) {
      const idx = clips.value.findIndex((c) => c.id === payload._moveClipId)
      if (idx >= 0) {
        const next = { ...clips.value[idx]!, track: kind, startSec: dropStart }
        clips.value = clips.value.map((c, i) => (i === idx ? next : c))
        scheduleSave()
        return
      }
    }
    await addSourceToTrack(
      {
        id: payload.id,
        title: payload.title,
        relativePath: payload.relativePath,
        assetId: payload.assetId,
        durationSec: payload.durationSec
      },
      kind,
      dropStart
    )
    return
  }

  const asset = workspace.resolveDraggedAsset(e)
  if (!asset || !canDropAssetOnTrack(asset, kind)) return
  const source = assetToSource(asset)
  if (!source) return
  await addSourceToTrack(source, kind, dropStart)
  workspace.setDraggingAsset(null)
}

function onRulerPointerDown(e: PointerEvent): void {
  const el = e.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  playheadSec.value = xToTime(e.clientX - rect.left)
  void syncPreviewToPlayhead()
}

function clipAtPlayhead(): ScriptTimelineClip | null {
  const list = clipsOn('video')
  for (const clip of list) {
    if (playheadSec.value >= clip.startSec && playheadSec.value < clip.startSec + clip.durationSec) {
      return clip
    }
  }
  return list.find((c) => c.startSec >= playheadSec.value) ?? null
}

async function syncPreviewToPlayhead(): Promise<void> {
  const clip = clipAtPlayhead()
  if (!clip) {
    previewSrc.value = ''
    return
  }
  activeClipId.value = clip.id
  const url = await resolveSrc(clip)
  if (previewSrc.value !== url) previewSrc.value = url
  await Promise.resolve()
  const el = previewEl.value
  if (!el) return
  applyPlaybackRate()
  const local = Math.max(0, playheadSec.value - clip.startSec)
  try {
    if (Math.abs(el.currentTime - local) > 0.2) el.currentTime = local
  } catch {
    /* ignore */
  }
}

async function togglePlay(): Promise<void> {
  if (playing.value) {
    playing.value = false
    previewEl.value?.pause()
    playSeq += 1
    return
  }
  playing.value = true
  const seq = ++playSeq
  await runSequence(seq)
}

async function runSequence(seq: number): Promise<void> {
  const list = clipsOn('video')
  if (!list.length) {
    playing.value = false
    return
  }

  const playFrom = async (startIndex: number, localOffset: number): Promise<void> => {
    for (let i = startIndex; i < list.length; i++) {
      if (seq !== playSeq || !playing.value) return
      const clip = list[i]!
      activeClipId.value = clip.id
      const startLocal = i === startIndex ? localOffset : 0
      playheadSec.value = clip.startSec + startLocal
      previewSrc.value = await resolveSrc(clip)
      await Promise.resolve()
      const el = previewEl.value
      if (!el) continue
      try {
        applyPlaybackRate()
        el.currentTime = startLocal
        await el.play()
      } catch {
        continue
      }
      await waitUntilClipEnd(el, clip, seq)
    }
  }

  let index = list.findIndex(
    (c) => playheadSec.value >= c.startSec && playheadSec.value < c.startSec + c.durationSec
  )
  let localOffset = 0
  if (index >= 0) {
    localOffset = Math.max(0, playheadSec.value - list[index]!.startSec)
  } else {
    index = list.findIndex((c) => c.startSec >= playheadSec.value)
    if (index < 0) index = 0
  }

  do {
    if (seq !== playSeq || !playing.value) return
    await playFrom(index, localOffset)
    if (!loopPlayback.value || seq !== playSeq || !playing.value) break
    index = 0
    localOffset = 0
    playheadSec.value = 0
  } while (loopPlayback.value)

  playing.value = false
}

function waitUntilClipEnd(
  el: HTMLVideoElement,
  clip: ScriptTimelineClip,
  seq: number
): Promise<void> {
  return new Promise((resolve) => {
    const tick = () => {
      if (seq !== playSeq || !playing.value) {
        cleanup()
        resolve()
        return
      }
      playheadSec.value = clip.startSec + (el.currentTime || 0)
      if (el.ended || el.currentTime >= clip.durationSec - 0.05) {
        cleanup()
        resolve()
      }
    }
    const cleanup = () => {
      el.removeEventListener('timeupdate', tick)
      el.removeEventListener('ended', tick)
    }
    el.addEventListener('timeupdate', tick)
    el.addEventListener('ended', tick)
  })
}

function onPreviewEnded(): void {
  /* sequence loop handles advance */
}

function onPreviewTimeUpdate(): void {
  const clip = clips.value.find((c) => c.id === activeClipId.value)
  const el = previewEl.value
  if (!clip || !el || !playing.value) return
  playheadSec.value = clip.startSec + (el.currentTime || 0)
}

function onPreviewLoaded(): void {
  applyPlaybackRate()
}

onMounted(async () => {
  loadPersisted()
  await reloadSources()
  const first = clipsOn('video')[0]
  if (first) void showClipPreview(first)
  bindTimelineViewport()
})

watch(
  () => props.scriptAssetId,
  async () => {
    playing.value = false
    playSeq += 1
    loadPersisted()
    await reloadSources()
  }
)

watch(timelineCollapsed, async (collapsed) => {
  if (collapsed) return
  await Promise.resolve()
  bindTimelineViewport()
})

watch(contentEndSec, (end) => {
  if (end <= durationSec.value) return
  durationSec.value = Math.max(durationSec.value, end)
  durationInputSec.value = Math.round(durationSec.value)
})

let timelineViewportRo: ResizeObserver | null = null

function bindTimelineViewport(): void {
  timelineViewportRo?.disconnect()
  const el = timelineBoardEl.value
  if (!el || typeof ResizeObserver === 'undefined') return
  const update = () => {
    viewportLanePx.value = Math.max(0, el.clientWidth - TRACK_LABEL_W)
  }
  update()
  timelineViewportRo = new ResizeObserver(update)
  timelineViewportRo.observe(el)
}

onBeforeUnmount(() => {
  playing.value = false
  playSeq += 1
  timelineViewportRo?.disconnect()
  timelineViewportRo = null
  if (saveTimer) clearTimeout(saveTimer)
  void persist()
})

defineExpose({ flushSave: persist, reloadSources })
</script>

<style scoped>
.script-timeline {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--bg-panel);
}

.workspace {
  flex: 1;
  min-height: 120px;
  display: grid;
  grid-template-columns: minmax(180px, 240px) minmax(280px, 1fr) minmax(220px, 300px);
}

.panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.sources-panel,
.assets-panel {
  background: var(--bg-elevated);
}

.sources-panel {
  border-right: 1px solid var(--border);
}

.assets-panel {
  border-left: 1px solid var(--border);
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.panel-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
}

.panel-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.panel-empty {
  padding: 16px 12px;
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.45;
}

.source-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.source-card {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-panel);
  color: var(--text);
  cursor: grab;
  text-align: left;
}

.source-card:active {
  cursor: grabbing;
}

.source-card:hover {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
}

.source-thumb {
  width: 36px;
  height: 36px;
  border-radius: 6px;
  flex-shrink: 0;
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--accent) 28%, #222), #1a1f26);
}

.source-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.source-name {
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.source-dur {
  font-size: 10px;
  color: var(--text-muted);
}

.preview-panel {
  background: #0b0d10;
}

.preview-stage {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.preview-video {
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #000;
}

.preview-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  color: var(--text-muted);
  font-size: 13px;
  padding: 16px;
  text-align: center;
}

.preview-transport {
  position: absolute;
  left: 10px;
  bottom: 8px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 8px;
  border-radius: 8px;
  background: color-mix(in srgb, #000 55%, transparent);
  color: #fff;
  font-size: 11px;
}

.ctrl {
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 50%;
  background: color-mix(in srgb, var(--accent) 80%, #fff);
  color: #111;
  cursor: pointer;
  display: grid;
  place-items: center;
}

.icon-play {
  width: 0;
  height: 0;
  border-style: solid;
  border-width: 5px 0 5px 8px;
  border-color: transparent transparent transparent currentColor;
  margin-left: 2px;
}

.icon-pause {
  width: 10px;
  height: 10px;
  background:
    linear-gradient(currentColor, currentColor) left/3px 100% no-repeat,
    linear-gradient(currentColor, currentColor) right/3px 100% no-repeat;
}

.play-glyph {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: 2px solid color-mix(in srgb, var(--text-muted) 55%, transparent);
  position: relative;
}

.play-glyph::before {
  content: '';
  position: absolute;
  left: 17px;
  top: 13px;
  border-style: solid;
  border-width: 8px 0 8px 12px;
  border-color: transparent transparent transparent color-mix(in srgb, var(--text-muted) 70%, transparent);
}

.play-glyph.sm {
  width: 22px;
  height: 22px;
  flex-shrink: 0;
}

.play-glyph.sm::before {
  left: 8px;
  top: 5px;
  border-width: 5px 0 5px 8px;
}

.ghost-btn {
  font-size: 11px;
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-panel);
  color: var(--text-muted);
  cursor: pointer;
}

.ghost-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.assets-embed {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.timeline-dock {
  flex: none;
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--border);
  background: var(--bg-panel);
}

.timeline-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 10px;
  min-height: 36px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elevated);
  flex-shrink: 0;
}

.timeline-dock.collapsed .timeline-bar {
  border-bottom: none;
}

.timeline-bar-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
  flex-shrink: 0;
}

.timeline-controls {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.ctrl-field,
.ctrl-check {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-muted);
  white-space: nowrap;
}

.ctrl-input,
.ctrl-select {
  width: 64px;
  height: 24px;
  padding: 0 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-panel);
  color: var(--text);
  font-size: 11px;
}

.ctrl-select {
  width: auto;
  min-width: 64px;
}

.ctrl-unit {
  font-size: 10px;
}

.ctrl-check input {
  margin: 0;
}

.zoom-readout {
  font-size: 11px;
  color: var(--text-muted);
  min-width: 36px;
}

.timeline-board {
  flex: none;
  overflow: hidden;
  background: var(--bg-panel);
}

.timeline-board.scrollable {
  overflow-x: auto;
  overflow-y: hidden;
}

.timeline-inner {
  position: relative;
  height: 236px; /* 标尺 28 + 4 轨 × 52 */
  overflow: hidden;
}

.ruler-row,
.track-row {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  align-items: stretch;
}

.ruler-row {
  height: 28px;
}

.track-row {
  height: 52px;
}

.track-label {
  display: flex;
  align-items: center;
  padding: 0 10px;
  font-size: 12px;
  color: var(--text-muted);
  border-right: 1px solid var(--border);
  background: var(--bg-elevated);
  z-index: 3;
}

.track-label.gutter {
  min-height: 0;
}

.ruler {
  position: relative;
  height: 28px;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--bg-elevated) 80%, #000);
  cursor: ew-resize;
  overflow: hidden;
}

.ruler-tick {
  position: absolute;
  top: 16px;
  bottom: 0;
  width: 0;
  border-left: 1px solid color-mix(in srgb, var(--text-muted) 45%, transparent);
  pointer-events: none;
}

.ruler-mark {
  position: absolute;
  top: 3px;
  font-size: 10px;
  line-height: 1;
  color: var(--text-muted);
  pointer-events: none;
  white-space: nowrap;
  transform: translateX(-50%);
}

.ruler-mark.start {
  transform: translateX(0);
  padding-left: 2px;
}

.ruler-mark.end:not(.start) {
  transform: translateX(-100%);
  padding-right: 2px;
}

.track-lane {
  position: relative;
  height: 52px;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  background: color-mix(in srgb, var(--bg-panel) 92%, #000);
  overflow: hidden;
}

.track-row.droppable .track-lane {
  background: color-mix(in srgb, var(--bg-panel) 85%, #1a1f26);
}

.lane-empty,
.lane-muted {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-muted);
  font-size: 12px;
  pointer-events: none;
}

.create-hint {
  position: absolute;
  left: 50%;
  top: 4px;
  transform: translateX(-50%);
  z-index: 1;
  font-size: 11px;
  padding: 2px 10px;
  border: none;
  border-radius: 6px;
  background: color-mix(in srgb, #000 55%, transparent);
  color: #ddd;
  cursor: pointer;
}

.speaker {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 1.5px solid currentColor;
  opacity: 0.7;
}

.clip {
  position: absolute;
  top: 8px;
  height: 36px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 8px;
  border: 1px solid color-mix(in srgb, var(--accent) 40%, var(--border));
  border-radius: 6px;
  background: color-mix(in srgb, var(--accent) 22%, var(--bg-elevated));
  color: var(--text);
  font-size: 11px;
  cursor: grab;
  overflow: hidden;
  z-index: 1;
}

.clip.active {
  outline: 1px solid var(--accent);
}

.clip-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.clip-remove {
  flex: none;
  opacity: 0.7;
  font-size: 14px;
  line-height: 1;
}

.playhead {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 0;
  border-left: 2px solid #3ddc84;
  pointer-events: none;
  z-index: 2;
}

.playhead-cap {
  position: absolute;
  top: 0;
  left: -6px;
  width: 0;
  height: 0;
  border-style: solid;
  border-width: 8px 6px 0 6px;
  border-color: #3ddc84 transparent transparent transparent;
}
</style>
