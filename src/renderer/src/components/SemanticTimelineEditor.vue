<script setup lang="ts">
/**
 * Semantic Timeline 三层只读视图（Story / Entity / Production）。
 * 编辑操作入口预留；首期展示证据与意图。
 */
import { computed, nextTick, ref, watch } from 'vue'
import type {
  DirectorIntent,
  Entity,
  SemanticEvent,
  SemanticTimeline,
  StoryBeat
} from '@shared/semanticTimeline'
import {
  MAX_PX_PER_SEC,
  MIN_PX_PER_SEC,
  ZOOM_STEP,
  anchoredScrollLeft,
  clampPxPerSec,
  nextPxPerSec,
  timeAtPointer
} from '../features/graph/model/semanticTimelineZoom'
import { useStudioI18n } from '../composables/useStudioI18n'
import {
  appearanceSeekSeconds,
  clampSeekSeconds,
  clampSidePaneWidth,
  entityKindKey,
  resolveEvidenceRef,
  resolveTriggerRange,
  sidePaneWidthFromPointer,
  sourceAspectRatio,
  trackLabelKey,
  type ResolvedEvidenceRef
} from '../features/graph/model/semanticTimelineView'
import { useProjectStore } from '../stores/project'

const { t, te } = useStudioI18n()
const project = useProjectStore()

const props = defineProps<{
  timeline: SemanticTimeline
  /** 秒 → 像素（初始缩放；用户滚轮/滑块调整后以内部状态为准） */
  pxPerSec?: number
}>()

const emit = defineEmits<{
  seek: [sec: number]
  selectEvent: [id: string]
  selectBeat: [id: string]
  selectEntity: [id: string]
  selectIntent: [id: string]
}>()

const scrollRef = ref<HTMLElement | null>(null)
/** 当前缩放（秒 → 像素）。滚轮（Ctrl/⌘ + 滚）与滑块都改它 */
const pxPerSecValue = ref(clampPxPerSec(props.pxPerSec ?? 40))
watch(
  () => props.pxPerSec,
  (value) => {
    if (value != null) pxPerSecValue.value = clampPxPerSec(value)
  }
)

const px = computed(() => pxPerSecValue.value)
const duration = computed(() => Math.max(0.1, props.timeline.source.duration))
const widthPx = computed(() => duration.value * px.value)
/** 滑块填充比例（给滑轨上色用） */
const zoomFill = computed(
  () => `${((px.value - MIN_PX_PER_SEC) / (MAX_PX_PER_SEC - MIN_PX_PER_SEC)) * 100}%`
)

/**
 * 滚轮缩放：**Ctrl/⌘ + 滚**才缩放，普通滚轮保持滚动。
 *
 * 为什么不学 DirectorAnimationPanel 的裸滚轮缩放：那边轨道区不靠滚轮滚动，
 * 这里实体行多、纵向滚动是刚需，裸滚轮会让人翻不动列表。
 * 缩放同时把「光标下的时刻」固定在光标下，否则放大时画面会整体甩走。
 */
function onWheel(e: WheelEvent): void {
  if (!e.ctrlKey && !e.metaKey) return
  e.preventDefault()
  const el = scrollRef.value
  const next = nextPxPerSec(px.value, e.deltaY)
  if (next === px.value) return
  const rect = el?.getBoundingClientRect()
  const pointerX = rect ? e.clientX - rect.left : 0
  const anchorSec = el
    ? timeAtPointer({ scrollLeft: el.scrollLeft, pointerX, pxPerSec: px.value })
    : 0
  pxPerSecValue.value = next
  void nextTick(() => {
    if (el)
      el.scrollLeft = anchoredScrollLeft({ timeAtPointer: anchorSec, pointerX, pxPerSec: next })
  })
}

function onZoomInput(e: Event): void {
  const value = Number((e.target as HTMLInputElement).value)
  if (Number.isFinite(value)) pxPerSecValue.value = clampPxPerSec(value)
}

/** 按钮缩放：以视口中心为锚点，避免只看得到最左边 */
function zoomBy(step: number): void {
  const el = scrollRef.value
  const current = px.value
  const next = clampPxPerSec(current * step)
  if (next === current) return
  const pointerX = el ? el.clientWidth / 2 : 0
  const anchorSec = el
    ? timeAtPointer({ scrollLeft: el.scrollLeft, pointerX, pxPerSec: current })
    : 0
  pxPerSecValue.value = next
  void nextTick(() => {
    if (el)
      el.scrollLeft = anchoredScrollLeft({ timeAtPointer: anchorSec, pointerX, pxPerSec: next })
  })
}

function resetZoom(): void {
  pxPerSecValue.value = clampPxPerSec(props.pxPerSec ?? 40)
  void nextTick(() => {
    if (scrollRef.value) scrollRef.value.scrollLeft = 0
  })
}

/**
 * 证据面板按**实体/节拍/事件/意图**选中（`selectedId`）；
 * 高亮要按**片段**算 —— 一个实体有多次出现、一个意图会横跨多条制作轨道，
 * 只比 id 会「点一个片段，整行 / 整条轨道全亮」（用户反馈）。
 */
const selectedId = ref<string | null>(null)
const selectedClip = ref<string | null>(null)

/** 片段键：实体＝id#出现序号，制作层＝id#轨道，其余＝id */
function clipKey(id: string, suffix?: string | number): string {
  return suffix == null ? id : `${id}#${suffix}`
}

const beats = computed(() => props.timeline.beats)
const entities = computed(() => props.timeline.entities)
const events = computed(() => props.timeline.events)
const intents = computed(() => props.timeline.intents)

const selectedEvidence = computed(() => {
  const id = selectedId.value
  if (!id) return null
  const ev = events.value.find((e) => e.id === id)
  if (ev) return { kind: 'event' as const, item: ev }
  const beat = beats.value.find((b) => b.id === id)
  if (beat) return { kind: 'beat' as const, item: beat }
  const ent = entities.value.find((e) => e.id === id)
  if (ent) return { kind: 'entity' as const, item: ent }
  const intent = intents.value.find((i) => i.id === id)
  if (intent) return { kind: 'intent' as const, item: intent }
  return null
})

function left(start: number): string {
  return `${Math.max(0, start) * px.value}px`
}
function width(start: number, end: number): string {
  return `${Math.max(4, (end - start) * px.value)}px`
}

/**
 * 证据 id 的**可读化**：`ev.c732c3a6d0` → 「事件 · 价格公布 · 19.32–22.50s」。
 *
 * 事件/节拍/意图/实体 在时间线文档里能查到名字；镜头/话语只能从 id 与证据文件解析
 * （`evidence/utterances.json`、`evidence/shots.json`，best-effort 读取）。
 * 原始 id 保留在 tooltip 里，排查时仍能看到。
 */
const utteranceIndex = ref(new Map<string, { text?: string; start?: number; end?: number }>())
const shotIndex = ref(new Map<string, { start?: number; end?: number }>())

async function loadEvidenceIndex(): Promise<void> {
  const id = props.timeline.id?.trim()
  const utterancesRel = props.timeline.evidence?.utterancesPath?.trim()
  const shotsRel = props.timeline.evidence?.shotsPath?.trim()
  if (!id || (!utterancesRel && !shotsRel)) return
  const readJson = async (rel: string): Promise<unknown> => {
    try {
      const text = await window.studio.readProjectFile(`Semantic/${id}/${rel}`)
      return text?.trim() ? JSON.parse(text) : null
    } catch {
      return null
    }
  }
  if (utterancesRel) {
    const doc = (await readJson(utterancesRel)) as {
      utterances?: Array<{
        id?: string
        text?: string
        timeRange?: { start?: number; end?: number }
      }>
    } | null
    const map = new Map<string, { text?: string; start?: number; end?: number }>()
    for (const u of doc?.utterances ?? []) {
      if (u?.id) map.set(u.id, { text: u.text, start: u.timeRange?.start, end: u.timeRange?.end })
    }
    utteranceIndex.value = map
  }
  if (shotsRel) {
    const doc = (await readJson(shotsRel)) as {
      shots?: Array<{ id?: string; timeRange?: { start?: number; end?: number } }>
    } | null
    const map = new Map<string, { start?: number; end?: number }>()
    for (const s of doc?.shots ?? []) {
      if (s?.id) map.set(s.id, { start: s.timeRange?.start, end: s.timeRange?.end })
    }
    shotIndex.value = map
  }
}

const REF_KIND_KEY: Record<string, string> = {
  event: 'refEvent',
  beat: 'refBeat',
  intent: 'refIntent',
  entity: 'refEntity',
  shot: 'refShot',
  utterance: 'refUtterance',
  ocr: 'refOcr'
}

function resolveRefs(refs: readonly string[]): ResolvedEvidenceRef[] {
  return (refs ?? []).map((raw) =>
    resolveEvidenceRef(raw, {
      events: events.value,
      beats: beats.value,
      intents: intents.value,
      entities: entities.value,
      utterances: utteranceIndex.value,
      shots: shotIndex.value,
      fps: props.timeline.source?.fps
    })
  )
}

function refKindLabel(kind: ResolvedEvidenceRef['kind']): string {
  const key = REF_KIND_KEY[kind]
  return key ? t(`graph.semanticTimeline.${key}`) : ''
}

/** 「19.32–22.50s」；未知时间给空串（那就只是个不可点的标签） */
function refTimeLabel(ref: ResolvedEvidenceRef): string {
  if (ref.startSec == null) return ''
  const start = ref.startSec.toFixed(2)
  if (ref.endSec == null) return `${start}s`
  return `${start}–${ref.endSec.toFixed(2)}s`
}

function seekToRef(ref: ResolvedEvidenceRef): void {
  if (ref.startSec == null) return
  emit('seek', ref.startSec)
  seekVideo(ref.startSec)
}

function selectBeat(b: StoryBeat): void {
  selectedId.value = b.id
  selectedClip.value = clipKey(b.id)
  emit('selectBeat', b.id)
  emit('seek', b.timeRange.start)
  seekVideo(b.timeRange.start)
}
function selectEvent(e: SemanticEvent): void {
  selectedId.value = e.id
  selectedClip.value = clipKey(e.id)
  emit('selectEvent', e.id)
  emit('seek', e.timeRange.start)
  seekVideo(e.timeRange.start)
}
/**
 * 点实体片段：跳到**被点的这次出现**，且只高亮**这一个片段**。
 *
 * 旧版两个问题都在这里：
 * 1. 无论点哪个片段都跳 `appearances[0]`（点第二个 / 第三个却回到第一处）；
 * 2. 高亮只比实体 id，而该 id 被同一实体的所有出现共用 → 点一个，整行都亮。
 */
function selectEntity(e: Entity, index?: number): void {
  selectedId.value = e.id
  selectedClip.value = clipKey(e.id, index ?? 0)
  emit('selectEntity', e.id)
  const start = appearanceSeekSeconds(e.appearances, index)
  if (start == null) return
  emit('seek', start)
  seekVideo(start)
}

/**
 * 点选 clip → 播放条跳到该 clip 起点。
 *
 * 原视频地址由 `timeline.source.assetId` 自己解析（不依赖宿主传参）：
 * 双击分析节点打开时宿主只给 timelineId，拿不到 sourceRelativePath —— 那样面板上就没有画面。
 * `SemanticTimelineSource` 里没有 relativePath，所以要按 assetId 找资产；
 * 无资产（按路径分析的视频）时 id 形如 `path:<工程相对路径>`，直接取后缀。
 */
const videoRef = ref<HTMLVideoElement | null>(null)
const sourceVideoUrl = ref('')

function sourceRelativePath(): string {
  const assetId = props.timeline.source?.assetId?.trim() ?? ''
  if (assetId.startsWith('path:')) return assetId.slice('path:'.length).trim()
  return project.assets.find((a) => a.id === assetId)?.relativePath?.trim() ?? ''
}

/** 元数据到位前先按时间线记的宽高占位，避免视频盒子从 0 高跳一下 */
const sourceAspect = computed(() => sourceAspectRatio(props.timeline.source ?? {}))

async function resolveSourceVideoUrl(): Promise<void> {
  const rel = sourceRelativePath()
  if (!rel) {
    sourceVideoUrl.value = ''
    return
  }
  try {
    sourceVideoUrl.value = (await window.studio.getAssetFileUrl(rel)) ?? ''
  } catch {
    sourceVideoUrl.value = ''
  }
}

watch(
  () => [props.timeline.source?.assetId, project.assets.length],
  () => {
    void resolveSourceVideoUrl()
  },
  { immediate: true }
)

// 证据文件只用于**把 id 显示成人话**（原句 / 镜头时间）；读不到也不影响其它功能
watch(
  () => [
    props.timeline.id,
    props.timeline.evidence?.utterancesPath,
    props.timeline.evidence?.shotsPath
  ],
  () => {
    void loadEvidenceIndex()
  },
  { immediate: true }
)

function seekVideo(sec: number): void {
  const video = videoRef.value
  if (!video) return
  const duration = Number.isFinite(video.duration) ? video.duration : props.timeline.source.duration
  video.currentTime = clampSeekSeconds(sec, duration)
}

function intentsForTrack(track: string): DirectorIntent[] {
  return intents.value.filter((i) => i.techniques.some((t) => t.track === track))
}

/**
 * 轨道 id / 实体 kind → 显示名。
 *
 * 手法列表里以前直接显示 `tech.track`，中文界面就露出 `camera`、`character`（用户反馈）。
 * 不认识的 id 原样显示 —— 宁可露出英文，也不要显示空白。
 */
function trackLabel(track: string): string {
  const key = trackLabelKey(track)
  return key ? t(`graph.semanticTimeline.${key}`) : track
}
function entityKindLabel(kind: string): string {
  const key = entityKindKey(kind)
  return key ? t(`graph.semanticTimeline.${key}`) : kind
}

/** 制作层四个轨道（id 用于匹配 intent.techniques[].track，label 是界面文案） */
const productionTracks = computed(() => [
  { id: 'camera', label: trackLabel('camera') },
  { id: 'audio', label: trackLabel('audio') },
  { id: 'text', label: trackLabel('text') },
  { id: 'vfx', label: trackLabel('vfx') }
])

/** 制作层片段的落点：由 intent.trigger 指向的事件决定（找不到给 0–1 兜底） */
function intentRange(intent: DirectorIntent): { start: number; end: number } {
  return resolveTriggerRange(events.value, intent.trigger)
}

/**
 * 两栏拖动手柄。
 *
 * 与 AssetBrowser 的分栏同一套写法（mousedown + window 监听 + 松手持久化）：
 * 宽度默认由 CSS `clamp(420px, 44%, 720px)` 决定，一旦拖动就改成固定像素（内联 flex-basis）。
 */
const editorRef = ref<HTMLElement | null>(null)
const SIDE_WIDTH_STORAGE_KEY = 'aiartengine.semanticTimeline.sidePaneWidth'
const sidePaneWidth = ref<number | null>(readStoredSideWidth())
const isSplitterDragging = ref(false)

function readStoredSideWidth(): number | null {
  try {
    const raw = window.localStorage.getItem(SIDE_WIDTH_STORAGE_KEY)
    if (!raw) return null
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? clampSidePaneWidth(parsed) : null
  } catch {
    return null
  }
}

function persistSideWidth(): void {
  try {
    if (sidePaneWidth.value == null) return
    window.localStorage.setItem(SIDE_WIDTH_STORAGE_KEY, String(Math.round(sidePaneWidth.value)))
  } catch {
    /* 存储不可用时忽略：宽度仍对本次会话生效 */
  }
}

function currentSideWidth(rect: DOMRect | undefined): number {
  return (
    sidePaneWidth.value ??
    clampSidePaneWidth(Math.round((rect?.width ?? 0) * 0.44) || 420, rect?.width)
  )
}

function onSplitterDown(e: MouseEvent): void {
  if (e.button !== 0) return
  isSplitterDragging.value = true
  const onMove = (ev: MouseEvent): void => {
    const rect = editorRef.value?.getBoundingClientRect()
    sidePaneWidth.value = sidePaneWidthFromPointer({
      clientX: ev.clientX,
      editorRight: rect?.right ?? ev.clientX,
      editorWidth: rect?.width
    })
  }
  const onUp = (): void => {
    isSplitterDragging.value = false
    persistSideWidth()
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

/** 键盘也能调（手柄可聚焦）：每次 24px，方向与拖动一致（左箭头＝右栏更宽） */
function onSplitterKeydown(e: KeyboardEvent): void {
  const direction = e.key === 'ArrowLeft' ? 1 : e.key === 'ArrowRight' ? -1 : 0
  if (direction === 0) return
  e.preventDefault()
  const rect = editorRef.value?.getBoundingClientRect()
  sidePaneWidth.value = clampSidePaneWidth(currentSideWidth(rect) + direction * 24, rect?.width)
  persistSideWidth()
}

/**
 * 点选制作层片段（机位/声音/字幕/特效）——**与其它片段一致**：选中高亮 + 播放条跳到对应时刻。
 *
 * 这里以前**根本没有 @click**（节拍/实体/事件都有），所以机位、声音上的片段点了没反应。
 */
/**
 * 点选制作层片段（机位/声音/字幕/特效）——**与其它片段一致**：选中高亮 + 播放条跳到对应时刻。
 *
 * 这里以前**根本没有 @click**（节拍/实体/事件都有），所以机位、声音上的片段点了没反应。
 * 同一意图会横跨多条轨道，高亮要带上轨道（否则点机位那条，声音那条也一起亮）。
 */
function selectIntent(intent: DirectorIntent, track?: string): void {
  selectedId.value = intent.id
  selectedClip.value = clipKey(intent.id, track)
  emit('selectIntent', intent.id)
  const start = intentRange(intent).start
  emit('seek', start)
  seekVideo(start)
}

/**
 * 节拍类型 → 显示名。
 *
 * 内置词表（commerce / drama）的类型在两套文案里都有对应 key；**市场包自定义类型**
 * 回退为原始 id（词表 schema 只有单语 `label`，要做到自定义类型也本地化得先扩 schema）。
 */
function beatLabel(type: string): string {
  const key = `graph.semanticTimeline.beat.${type}`
  return te(key) ? t(key) : type
}
</script>

<template>
  <div ref="editorRef" class="stl-editor">
    <div ref="scrollRef" class="stl-scroll" @wheel="onWheel">
      <div class="stl-zoombar">
        <button
          type="button"
          class="stl-zoombar-btn"
          :title="t('graph.semanticTimeline.zoomOut')"
          :aria-label="t('graph.semanticTimeline.zoomOut')"
          @click="zoomBy(1 / ZOOM_STEP)"
        >
          −
        </button>
        <input
          class="stl-zoom-slider"
          type="range"
          :min="MIN_PX_PER_SEC"
          :max="MAX_PX_PER_SEC"
          step="1"
          :value="px"
          :style="{ '--zoom-fill': zoomFill }"
          :title="t('graph.semanticTimeline.zoomHint')"
          :aria-label="t('graph.semanticTimeline.zoomHint')"
          @input="onZoomInput"
        />
        <button
          type="button"
          class="stl-zoombar-btn"
          :title="t('graph.semanticTimeline.zoomIn')"
          :aria-label="t('graph.semanticTimeline.zoomIn')"
          @click="zoomBy(ZOOM_STEP)"
        >
          +
        </button>
        <span class="stl-zoom-readout">{{ Math.round(px) }} px/s</span>
        <button
          type="button"
          class="stl-zoombar-btn"
          :title="t('graph.semanticTimeline.zoomReset')"
          :aria-label="t('graph.semanticTimeline.zoomReset')"
          @click="resetZoom"
        >
          ⟲
        </button>
      </div>

      <div class="stl-ruler" :style="{ width: widthPx + 'px' }">
        <span
          v-for="tick in Math.ceil(duration) + 1"
          :key="tick"
          class="stl-tick"
          :style="{ left: (tick - 1) * px + 'px' }"
          >{{ tick - 1 }}s</span
        >
      </div>

      <section class="stl-layer stl-layer--story">
        <header class="stl-layer-head">
          <span class="stl-layer-title">{{ t('graph.semanticTimeline.layerStory') }}</span>
        </header>
        <div class="stl-row">
          <span class="stl-row-label" aria-hidden="true"></span>
          <div class="stl-track" :style="{ width: widthPx + 'px' }">
            <button
              v-for="b in beats"
              :key="b.id"
              type="button"
              class="stl-block beat"
              :class="{ selected: selectedClip === clipKey(b.id) }"
              :style="{
                left: left(b.timeRange.start),
                width: width(b.timeRange.start, b.timeRange.end)
              }"
              :title="b.description"
              @click="selectBeat(b)"
            >
              {{ beatLabel(b.type) }}
            </button>
          </div>
        </div>
      </section>

      <section class="stl-layer stl-layer--entity">
        <header class="stl-layer-head">
          <span class="stl-layer-title">{{ t('graph.semanticTimeline.layerEntity') }}</span>
        </header>
        <div v-for="ent in entities" :key="ent.id" class="stl-row">
          <span class="stl-row-label" :title="ent.name">{{ ent.name }}</span>
          <div class="stl-track" :style="{ width: widthPx + 'px' }">
            <button
              v-for="(ap, i) in ent.appearances"
              :key="ent.id + i"
              type="button"
              class="stl-block entity"
              :class="{ selected: selectedClip === clipKey(ent.id, i), soft: !ent.pixelEditable }"
              :style="{ left: left(ap.range.start), width: width(ap.range.start, ap.range.end) }"
              :title="`${ent.name} · ${ap.range.start.toFixed(2)}–${ap.range.end.toFixed(2)}s`"
              @click="selectEntity(ent, i)"
            >
              {{ ent.name }}
            </button>
          </div>
        </div>
        <div v-if="!entities.length" class="stl-empty">
          {{ t('graph.semanticTimeline.noEntities') }}
        </div>
      </section>

      <section class="stl-layer stl-layer--production">
        <header class="stl-layer-head">
          <span class="stl-layer-title">{{ t('graph.semanticTimeline.layerProduction') }}</span>
        </header>
        <div v-for="track in productionTracks" :key="track.id" class="stl-row">
          <span class="stl-row-label">{{ track.label }}</span>
          <div class="stl-track" :style="{ width: widthPx + 'px' }">
            <button
              v-for="intent in intentsForTrack(track.id)"
              :key="intent.id + track.id"
              type="button"
              class="stl-block intent"
              :class="{ selected: selectedClip === clipKey(intent.id, track.id) }"
              :style="{
                left: left(intentRange(intent).start),
                width: width(intentRange(intent).start, intentRange(intent).end)
              }"
              :title="intent.reason"
              @click="selectIntent(intent, track.id)"
            >
              {{ intent.techniques.find((t) => t.track === track.id)?.action }}
            </button>
          </div>
        </div>
        <div class="stl-row">
          <span class="stl-row-label">{{ t('graph.semanticTimeline.trackEvents') }}</span>
          <div class="stl-track" :style="{ width: widthPx + 'px' }">
            <button
              v-for="ev in events"
              :key="ev.id"
              type="button"
              class="stl-block event"
              :class="{ selected: selectedClip === clipKey(ev.id) }"
              :style="{
                left: left(ev.timeRange.start),
                width: width(ev.timeRange.start, ev.timeRange.end)
              }"
              :title="ev.description"
              @click="selectEvent(ev)"
            >
              {{ ev.label }}
            </button>
          </div>
        </div>
      </section>
    </div>

    <!-- 两栏拖动手柄：拖动改右栏宽（键盘 ←/→ 也可） -->
    <div
      class="stl-splitter"
      :class="{ dragging: isSplitterDragging }"
      role="separator"
      aria-orientation="vertical"
      tabindex="0"
      :title="t('graph.semanticTimeline.resizePanes')"
      :aria-label="t('graph.semanticTimeline.resizePanes')"
      @mousedown.prevent="onSplitterDown"
      @keydown="onSplitterKeydown"
    />

    <aside
      class="stl-inspector"
      :style="sidePaneWidth != null ? { flexBasis: sidePaneWidth + 'px' } : undefined"
    >
      <div v-if="sourceVideoUrl" class="stl-source">
        <video
          ref="videoRef"
          class="stl-source-video"
          :src="sourceVideoUrl"
          :style="sourceAspect ? { aspectRatio: sourceAspect } : undefined"
          controls
          playsinline
          preload="metadata"
        />
      </div>

      <template>
        <h4>{{ t('graph.semanticTimeline.evidence') }}</h4>
        <p v-if="!selectedEvidence" class="muted">
          {{ t('graph.semanticTimeline.selectHint') }}
        </p>
        <template v-else-if="selectedEvidence.kind === 'event'">
          <p>
            <strong>{{ selectedEvidence.item.label }}</strong>
          </p>
          <p>{{ selectedEvidence.item.description }}</p>
          <div class="stl-refs">
            <button
              v-for="ref in resolveRefs(selectedEvidence.item.evidence)"
              :key="ref.raw"
              type="button"
              class="stl-ref"
              :class="`kind-${ref.kind}`"
              :title="refTimeLabel(ref) ? `${ref.raw} · ${refTimeLabel(ref)}` : ref.raw"
              :disabled="ref.startSec == null"
              @click="seekToRef(ref)"
            >
              <span class="stl-ref-kind">{{ refKindLabel(ref.kind) }}</span
              >{{ ref.detail }}
              <span v-if="refTimeLabel(ref)" class="stl-ref-time">{{ refTimeLabel(ref) }}</span>
            </button>
          </div>
          <p class="muted">
            {{ selectedEvidence.item.timeRange.start.toFixed(2) }}s –
            {{ selectedEvidence.item.timeRange.end.toFixed(2) }}s
          </p>
        </template>
        <template v-else-if="selectedEvidence.kind === 'beat'">
          <p>
            <strong>{{ beatLabel(selectedEvidence.item.type) }}</strong>
          </p>
          <p>{{ selectedEvidence.item.description }}</p>
          <div class="stl-refs">
            <button
              v-for="ref in resolveRefs(selectedEvidence.item.events)"
              :key="ref.raw"
              type="button"
              class="stl-ref"
              :class="`kind-${ref.kind}`"
              :title="refTimeLabel(ref) ? `${ref.raw} · ${refTimeLabel(ref)}` : ref.raw"
              :disabled="ref.startSec == null"
              @click="seekToRef(ref)"
            >
              <span class="stl-ref-kind">{{ refKindLabel(ref.kind) }}</span
              >{{ ref.detail }}
              <span v-if="refTimeLabel(ref)" class="stl-ref-time">{{ refTimeLabel(ref) }}</span>
            </button>
          </div>
        </template>
        <template v-else-if="selectedEvidence.kind === 'intent'">
          <p>
            <strong>{{ selectedEvidence.item.goal }}</strong>
          </p>
          <p class="muted">{{ t('graph.semanticTimeline.techniques') }}</p>
          <p>
            <span v-for="tech in selectedEvidence.item.techniques" :key="tech.track + tech.action">
              {{ trackLabel(tech.track) }} · {{ tech.action }}<br />
            </span>
          </p>
          <p v-if="selectedEvidence.item.reason" class="muted">
            {{ t('graph.semanticTimeline.reason') }}: {{ selectedEvidence.item.reason }}
          </p>
          <p class="muted">
            {{ intentRange(selectedEvidence.item).start.toFixed(2) }}s –
            {{ intentRange(selectedEvidence.item).end.toFixed(2) }}s
          </p>
        </template>
        <template v-else>
          <p>
            <strong>{{ selectedEvidence.item.name }}</strong> ({{
              entityKindLabel(selectedEvidence.item.kind)
            }})
          </p>
          <p class="muted">
            {{ t('graph.semanticTimeline.pixelEditable') }}:
            {{
              selectedEvidence.item.pixelEditable
                ? t('graph.semanticTimeline.yes')
                : t('graph.semanticTimeline.no')
            }}
          </p>
        </template>
      </template>
    </aside>
  </div>
</template>

<style scoped>
.stl-editor {
  display: flex;
  --stl-gutter: 104px;
  /* 吃掉 dive 里的可用高度：轨道多时**由 .stl-scroll 自己滚**，
     横向滚动条才会落在可见区底部（否则编辑器随内容长高，滚动条被推到内容最下面） */
  flex: 1 1 auto;
  min-height: 240px;
  min-width: 0;
  gap: 12px;
  background: var(--bg-panel);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}
.stl-scroll {
  flex: 1;
  /* flex 子项默认 min-*:auto 会撑开而不滚，必须显式归零 */
  min-width: 0;
  min-height: 0;
  overflow: auto;
  /* 左边不留内边距：否则横向滚动时轨道内容会从标签栏左侧那一条缝里露出来
     （sticky 标签只能盖住内容盒，盖不住 padding 区）。留白改由下面各元素自己加 */
  padding: 8px 12px 16px 0;
}
/* 缩放条：粘在滚动区顶部，横向滚动时也看得见 */
.stl-zoombar {
  position: sticky;
  top: 0;
  left: 0;
  z-index: 3;
  display: flex;
  align-items: center;
  gap: 6px;
  width: fit-content;
  margin-left: 12px;
  margin-bottom: 8px;
  padding: 3px 8px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: color-mix(in srgb, var(--bg-panel) 92%, transparent);
  backdrop-filter: blur(6px);
  font-size: 10px;
  color: var(--text-muted);
}
.stl-zoombar-btn {
  /* 符号要**正中心**：按钮默认带浏览器内边距（1px 6px）且不是 flex，
     不重置就会让 − / + / ⟲ 偏（实测踩到） */
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  flex: 0 0 auto;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 50%;
  background: var(--bg-elevated);
  color: var(--text);
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
}
.stl-zoombar-btn:hover {
  background: color-mix(in srgb, var(--accent) 30%, var(--bg-elevated));
}
.stl-zoom-slider {
  width: 96px;
  height: 14px;
  margin: 0;
  appearance: none;
  background: transparent;
  cursor: pointer;
}
.stl-zoom-slider::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: 2px;
  background: linear-gradient(
    to right,
    var(--accent) var(--zoom-fill, 50%),
    var(--bg-elevated) var(--zoom-fill, 50%)
  );
}
.stl-zoom-slider::-webkit-slider-thumb {
  appearance: none;
  width: 10px;
  height: 10px;
  margin-top: -3px;
  border-radius: 50%;
  background: var(--text);
}
.stl-zoom-readout {
  min-width: 46px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.stl-ruler {
  position: relative;
  height: 26px;
  margin-bottom: 8px;
  /* 与轨道对齐：空出左侧标签栏的位置（刻度 0s 正对轨道起点） */
  margin-left: var(--stl-gutter);
  border-bottom: 1px solid var(--border);
}
.stl-tick {
  position: absolute;
  top: 0;
  font-size: 12px;
  color: var(--text-muted);
  transform: translateX(-50%);
}
.stl-layer {
  margin-bottom: 14px;
  /* 每层的主题色与层内块色一致：剧情=节拍蓝 / 角色=实体青 / 制作=意图橙 */
  --layer-accent: var(--text-muted);
}
.stl-layer--story {
  --layer-accent: #5b6cff;
}
.stl-layer--entity {
  --layer-accent: #2a9d8f;
}
.stl-layer--production {
  --layer-accent: #e76f51;
}
/**
 * 层标题栏：与轨道名**刻意拉开层次**。
 *
 * 轨道名是「弱标签」（灰、常规字重、无底），层标题是「章节」：
 * 全宽背景条 + 上下分割线 + 左侧主题色竖条 + 加粗提亮。
 * 条子铺满时间轴宽度（横向滚动时像分隔带掠过），里面的文字 sticky 钉在左边不跑。
 */
.stl-layer-head {
  display: flex;
  align-items: center;
  margin-bottom: 6px;
  padding: 3px 0;
  border-top: 1px solid var(--border);
  border-bottom: 1px solid color-mix(in srgb, var(--border) 55%, transparent);
  background: color-mix(in srgb, var(--layer-accent) 9%, var(--bg-panel));
}
.stl-layer-title {
  /* 必须 `width: fit-content`——块级元素撑满内容宽度时没有可滑动的余量，sticky 不会生效。
     底色与标题栏一致：滚动时文字与条子无缝、轨道从下面穿过也透不出来 */
  position: sticky;
  left: 0;
  z-index: 2;
  width: fit-content;
  max-width: 100%;
  padding: 0 12px 0 10px;
  background: color-mix(in srgb, var(--layer-accent) 9%, var(--bg-panel));
  box-shadow: inset 3px 0 0 var(--layer-accent);
  font-size: 13px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text);
}
/* 一行 = 左侧固定标签栏 + 右侧时间轴轨道 */
.stl-row {
  display: flex;
  align-items: center;
  margin-bottom: 6px;
}
.stl-row-label {
  /* 固定在最左边：横向滚动时粘住不动，且**在流内**占位 ——
     块从标签栏右侧才开始，绝不会压在名字上（旧做法是绝对定位在块上面） */
  position: sticky;
  left: 0;
  z-index: 2;
  flex: 0 0 var(--stl-gutter);
  align-self: stretch;
  display: flex;
  align-items: center;
  padding: 0 8px 0 2px;
  box-sizing: border-box;
  /* 不透明：滚动时下面的轨道从标签栏底下穿过而不透出来 */
  background: var(--bg-panel);
  font-size: 13px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
}
.stl-track {
  position: relative;
  flex: 0 0 auto;
  height: 40px;
  background: var(--bg-elevated);
  border-radius: 5px;
}
.stl-block {
  position: absolute;
  top: 5px;
  height: 30px;
  border: none;
  border-radius: 5px;
  font-size: 13px;
  color: #fff;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 0 8px;
  text-align: left;
}
.stl-block.beat {
  background: #5b6cff;
}
.stl-block.entity {
  background: #2a9d8f;
  min-width: 10px;
}
.stl-block.entity.soft {
  background: #6c757d;
  opacity: 0.7;
}
.stl-block.intent {
  background: #e76f51;
}
.stl-block.event {
  background: #9b5de5;
}
.stl-block.selected {
  outline: 2px solid var(--text);
}
.stl-empty {
  /* 空态同样钉在左边（理由与层标题一致：撑满宽度时 sticky 无效） */
  position: sticky;
  left: 0;
  z-index: 2;
  width: fit-content;
  max-width: 100%;
  background: var(--bg-panel);
  font-size: 12px;
  color: var(--text-muted);
  padding: 6px 10px 6px 12px;
}
/* 两栏拖动手柄：视觉上是一条竖线，命中区 8px（够好抓） */
.stl-splitter {
  flex: 0 0 8px;
  align-self: stretch;
  position: relative;
  cursor: col-resize;
  background: transparent;
}
.stl-splitter::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 3px;
  width: 2px;
  border-radius: 1px;
  background: var(--border);
  transition: background 0.12s ease;
}
.stl-splitter:hover::before,
.stl-splitter:focus-visible::before,
.stl-splitter.dragging::before {
  background: var(--accent);
  width: 3px;
  left: 2.5px;
}
.stl-splitter:focus-visible {
  outline: none;
}
.stl-splitter.dragging {
  /* 拖动中别让文本被选中 */
  user-select: none;
}
.stl-inspector {
  /* 右侧栏（视频 + 证据）。两栏布局：左轨道 flex:1、右栏按比例固定 ——
     宽度要够放 720 高的竖屏画面（9:16 → 需要 405 宽），窄屏保底 420 */
  flex: 0 0 clamp(420px, 44%, 720px);
  /* 高度**撑满**：与 dive（进而与窗口）等高 —— 不要写 flex-start，
     那会把面板压成内容高度、左边框到证据文字下面就断掉 */
  align-self: stretch;
  max-height: 100%;
  border-left: 1px solid var(--border);
  padding: 12px;
  font-size: 13px;
  /* 面板自身成为滚动容器：视频 720 高 + 证据放不下时在里面滚，边框始终占满整高 */
  overflow: auto;
}
.stl-inspector h4 {
  margin: 0 0 8px;
  font-size: 13px;
}
/* 原视频：放在证据面板上方，点选 clip 时播放条自动跳过去 */
.stl-source {
  /* 出血到面板两边（抵消 12px 内边距）→ 视频宽度吃满整栏 */
  margin: -12px -12px 10px;
  background: var(--bg-panel);
}
.stl-source-video {
  display: block;
  width: 100%;
  /* 按**素材实际比例**自适应：宽度吃满右栏，高度由视频自身宽高比决定
     （竖屏 9:16 → 高约为宽的 1.78 倍；横屏 16:9 → 约 0.56 倍）。
     不设 height / max-height：不做高度限制，画面该多高就多高，多出的部分由面板滚动。
     `aspect-ratio` 由内联样式给（时间线里记的 source 宽高），避免元数据到位前跳版。 */
  height: auto;
  object-fit: contain;
  background: #000;
}
/* 证据引用：可读标签（点击跳播放条），原始 id 在 tooltip 里 */
.stl-refs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 6px 0;
}
.stl-ref {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 100%;
  padding: 3px 8px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg-elevated);
  color: var(--text);
  font-size: 12px;
  line-height: 1.5;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.stl-ref:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
}
.stl-ref:disabled {
  cursor: default;
  opacity: 0.75;
}
.stl-ref-kind {
  flex: 0 0 auto;
  padding: 0 5px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 18%, transparent);
  color: var(--text-muted);
  font-size: 11px;
}
.stl-ref-time {
  flex: 0 0 auto;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}
.stl-inspector .muted {
  color: var(--text-muted);
  font-size: 12px;
}
</style>
