<script setup lang="ts">
/**
 * Semantic Timeline 编辑器：左边轨道（镜头 / 复刻批次 / 台词 / 包装层 / 角色实体），右边原片 + 检查器。
 *
 * 轨道上点中什么，右侧检查器就编辑什么；修改以 `edit` 事件上抛（`SemanticEditInput`），
 * 由 dive 视图应用并落盘 —— 本组件不持有文档副本，只持有选中状态。
 */
import { computed, nextTick, ref, watch } from 'vue'
import {
  PRODUCTION_LABEL_META,
  diffAgainstBaseline,
  type DialogueLine,
  type Entity,
  type SemanticEditInput,
  type SemanticShot,
  type SemanticTimeline
} from '@shared/semanticTimeline'
import SemanticSelectionInspector from './semanticInspector/SemanticSelectionInspector.vue'
import type { ReferenceCandidate } from '../features/graph/model/semanticReferenceCandidates'
import {
  keepSelection,
  resolveSelection,
  selectionClipKey,
  shotLabel,
  type SemanticSelection
} from '../features/graph/model/semanticSelection'
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
  sidePaneWidthFromPointer,
  sourceAspectRatio
} from '../features/graph/model/semanticTimelineView'
import { useProjectStore } from '../stores/project'

const { t, locale } = useStudioI18n()
const isEn = computed(() => locale.value.toLowerCase().startsWith('en'))
const project = useProjectStore()

const props = defineProps<{
  timeline: SemanticTimeline
  /** 秒 → 像素（初始缩放；用户滚轮/滑块调整后以内部状态为准） */
  pxPerSec?: number
  /** shotId → 按当前内容会生成的提示词（镜头表单的只读参照） */
  promptByShot?: Record<string, string>
  /** 实体替换的参考图候选 */
  referenceCandidates?: ReferenceCandidate[]
}>()

const emit = defineEmits<{
  seek: [sec: number]
  selectEntity: [id: string]
  edit: [input: SemanticEditInput]
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
 * 唯一的选中状态（类型 + id + 片段）。右侧检查器据它编辑，轨道据它高亮。
 * 高亮按**片段**算（实体＝id#出现序号，其余＝id）。
 */
const selection = ref<SemanticSelection | null>(null)
const selectedClip = computed(() => selectionClipKey(selection.value))

function clipKey(id: string, suffix?: string | number): string {
  return suffix == null ? id : `${id}#${suffix}`
}

const entities = computed(() => props.timeline.entities)
const shots = computed(() => props.timeline.shots ?? [])
const dialogue = computed(() => props.timeline.dialogue ?? [])

interface UnitTrackBlock {
  key: string
  unitId: string
  kind: 'ai' | 'local'
  firstShotId: string
  start: number
  end: number
  label: string
  title: string
}

/** 复刻合批轨道块（G1..Gk AI 合批单元 + K1..Kk 本地零成本动效段） */
const unitBlocks = computed((): UnitTrackBlock[] => {
  const plan = props.timeline.breakdown?.productionPlan
  if (!plan) return []
  const shotList = shots.value
  const shotIdxById = new Map(shotList.map((s, idx) => [s.id, idx]))
  const out: UnitTrackBlock[] = []

  for (const u of plan.units ?? []) {
    const valid = u.shotIds
      .map((id) => ({ shot: shotList.find((s) => s.id === id), idx: shotIdxById.get(id) ?? -1 }))
      .filter((x): x is { shot: SemanticShot; idx: number } => Boolean(x.shot && !x.shot.removed))
      .sort((a, b) => a.idx - b.idx)
    if (!valid.length) continue

    // Group contiguous shots so bridged units (e.g. shot.1 + shot.3 across K1 shot.2) never overlap K1
    const runs: Array<Array<{ shot: SemanticShot; idx: number }>> = []
    for (const item of valid) {
      const prevRun = runs[runs.length - 1]
      const prevItem = prevRun?.[prevRun.length - 1]
      if (prevRun && prevItem && item.idx === prevItem.idx + 1) {
        prevRun.push(item)
      } else {
        runs.push([item])
      }
    }
    runs.forEach((run, rIdx) => {
      const first = run[0]!.shot
      const last = run[run.length - 1]!.shot
      const partSuffix = runs.length > 1 ? ` (${rIdx + 1}/${runs.length})` : ''
      out.push({
        key: `${u.id}-${rIdx}`,
        unitId: u.id,
        kind: 'ai',
        firstShotId: first.id,
        start: first.range.start,
        end: last.range.end,
        label: `${u.id}${partSuffix} · ${u.conditioningMode}`,
        title: `${u.id} · ${u.sceneHeader} (${u.shotIds.join(', ')})`
      })
    })
  }

  for (const k of plan.localUnits ?? []) {
    const shot = shotList.find((s) => s.id === k.shotId && !s.removed)
    if (!shot) continue
    out.push({
      key: k.id,
      unitId: k.id,
      kind: 'local',
      firstShotId: shot.id,
      start: shot.range.start,
      end: shot.range.end,
      label: `${k.id} · ${k.mode}`,
      title: `${k.id} (${k.shotId}) · ${k.mode}`
    })
  }

  return out.sort((a, b) => a.start - b.start)
})

const overlayBlocks = computed(() => {
  const out: Array<{
    id: string
    shotId: string
    start: number
    end: number
    label: string
    title: string
  }> = []
  for (const s of shots.value) {
    if (s.removed) continue
    for (const l of s.layers ?? []) {
      if (l.kind === 'scene_text') continue
      const text = l.text?.trim() || l.kind
      out.push({
        id: `${s.id}:${l.id}`,
        shotId: s.id,
        start: l.start,
        end: l.end,
        label: text,
        title: `[${l.kind}] ${text} · ${l.start.toFixed(2)}–${l.end.toFixed(2)}s`
      })
    }
  }
  if (out.length === 0) {
    for (const r of props.timeline.textLayers ?? []) {
      out.push({
        id: r.id,
        shotId: r.shotId ?? '',
        start: r.range.start,
        end: r.range.end,
        label: r.text,
        title: `[${r.kind}] ${r.text} · ${r.range.start.toFixed(2)}–${r.range.end.toFixed(2)}s`
      })
    }
  }
  return out
})

function shotProdColor(shot: SemanticShot): string | undefined {
  const lbl = shot.base?.label
  return lbl ? PRODUCTION_LABEL_META[lbl]?.color : undefined
}

function shotProdBadge(shot: SemanticShot): string {
  const lbl = shot.base?.label
  if (!lbl) return ''
  const meta = PRODUCTION_LABEL_META[lbl]
  if (!meta) return ''
  const shortText = isEn.value ? meta.shortEn : meta.shortZh
  return shot.base?.disputed ? `${shortText}!` : shortText
}

function selectOverlayBlock(item: { shotId: string; start: number }): void {
  if (item.shotId) selectShotById(item.shotId)
  seekToSeconds(item.start)
}

function selectUnitBlock(block: UnitTrackBlock): void {
  selectShotById(block.firstShotId)
  seekToSeconds(block.start)
}

/** 当前修改状态：镜头块 / 台词块上标出「将重新生成 / 重新配音 / 已删除」 */
const diff = computed(() => diffAgainstBaseline(props.timeline))

const resolvedSelection = computed(() => resolveSelection(props.timeline, selection.value))
watch(
  () => props.timeline,
  (doc) => {
    selection.value = keepSelection(doc, selection.value)
  }
)

const selectedEntity = computed(() => {
  const s = resolvedSelection.value
  return s?.kind === 'entity' ? s : null
})

function onEdit(input: SemanticEditInput): void {
  emit('edit', input)
}

/**
 * 键盘：Esc 取消选中；Delete 在镜头删除 / 恢复间切换。
 * 焦点在输入控件里时不拦截（否则在文本框里按 Delete 会删掉整个对象）。
 */
function onKeydown(e: KeyboardEvent): void {
  const target = e.target as HTMLElement | null
  if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
  const s = resolvedSelection.value
  if (e.key === 'Escape' && selection.value) {
    e.preventDefault()
    selection.value = null
    return
  }
  if (e.key !== 'Delete' || !s) return
  if (s.kind === 'shot') {
    e.preventDefault()
    emit('edit', { op: s.item.removed ? 'shot.restore' : 'shot.remove', target: s.item.id })
  }
}

function left(start: number): string {
  return `${Math.max(0, start) * px.value}px`
}
function width(start: number, end: number): string {
  return `${Math.max(4, (end - start) * px.value)}px`
}

function seekToSeconds(sec: number): void {
  emit('seek', sec)
  seekVideo(sec)
}

function selectShot(shot: SemanticShot): void {
  selection.value = { kind: 'shot', id: shot.id }
  emit('seek', shot.range.start)
  seekVideo(shot.range.start)
}
function selectShotById(shotId: string): void {
  const shot = shots.value.find((s) => s.id === shotId)
  if (shot) selectShot(shot)
}
function selectDialogue(line: DialogueLine): void {
  selection.value = { kind: 'dialogue', id: line.id }
  emit('seek', line.range.start)
  seekVideo(line.range.start)
}

/** 点实体片段：跳到被点的这次出现，且只高亮这一个片段 */
function selectEntity(e: Entity, index?: number): void {
  selection.value = { kind: 'entity', id: e.id, clip: index ?? 0 }
  emit('selectEntity', e.id)
  const start = appearanceSeekSeconds(e.appearances, index)
  if (start == null) return
  emit('seek', start)
  seekVideo(start)
}

const videoRef = ref<HTMLVideoElement | null>(null)
const sourceVideoUrl = ref('')
const playheadSec = ref(0)

function onVideoTimeUpdate(): void {
  if (videoRef.value) playheadSec.value = videoRef.value.currentTime
}

defineExpose({
  seekTo: seekToSeconds
})

function sourceRelativePath(): string {
  const assetId = props.timeline.source?.assetId?.trim() ?? ''
  if (assetId.startsWith('path:')) return assetId.slice('path:'.length).trim()
  return project.assets.find((a) => a.id === assetId)?.relativePath?.trim() ?? ''
}

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

function seekVideo(sec: number): void {
  const video = videoRef.value
  const dur =
    video && Number.isFinite(video.duration) ? video.duration : props.timeline.source.duration
  const clamped = clampSeekSeconds(sec, dur)
  playheadSec.value = clamped
  if (video) video.currentTime = clamped
}

function entityKindLabel(kind: string): string {
  const key = entityKindKey(kind)
  return key ? t(`graph.semanticTimeline.${key}`) : kind
}

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
    /* ignore */
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

function onSplitterKeydown(e: KeyboardEvent): void {
  const direction = e.key === 'ArrowLeft' ? 1 : e.key === 'ArrowRight' ? -1 : 0
  if (direction === 0) return
  e.preventDefault()
  const rect = editorRef.value?.getBoundingClientRect()
  sidePaneWidth.value = clampSidePaneWidth(currentSideWidth(rect) + direction * 24, rect?.width)
  persistSideWidth()
}
</script>

<template>
  <div ref="editorRef" class="stl-editor" @keydown="onKeydown">
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

      <section
        v-if="shots.length || dialogue.length || overlayBlocks.length || unitBlocks.length"
        class="stl-layer stl-layer--footage"
      >
        <header class="stl-layer-head">
          <span class="stl-layer-title">{{ t('graph.semanticTimeline.layerFootage') }}</span>
        </header>
        <div class="stl-row">
          <span class="stl-row-label">{{ t('graph.semanticTimeline.trackShots') }}</span>
          <div class="stl-track" :style="{ width: widthPx + 'px' }">
            <button
              v-for="shot in shots"
              :key="shot.id"
              type="button"
              class="stl-block shot"
              :class="{
                selected: selectedClip === clipKey(shot.id),
                dirty: diff.dirtyShots.has(shot.id),
                removed: diff.removedShots.has(shot.id)
              }"
              :style="{
                left: left(shot.range.start),
                width: width(shot.range.start, shot.range.end),
                ...(shotProdColor(shot) ? { backgroundColor: shotProdColor(shot) } : {})
              }"
              :title="`${shotLabel(timeline, shot.id)}${shotProdBadge(shot) ? ` [${shotProdBadge(shot)}]` : ''} · ${shot.range.start.toFixed(2)}–${shot.range.end.toFixed(2)}s`"
              @click="selectShot(shot)"
            >
              <span v-if="shotProdBadge(shot)" class="stl-shot-tag">{{ shotProdBadge(shot) }}</span>
              {{ shotLabel(timeline, shot.id) }}
            </button>
          </div>
        </div>
        <div v-if="unitBlocks.length" class="stl-row">
          <span class="stl-row-label">{{ t('graph.semanticTimeline.trackUnits') }}</span>
          <div class="stl-track" :style="{ width: widthPx + 'px' }">
            <button
              v-for="ub in unitBlocks"
              :key="ub.key"
              type="button"
              class="stl-block"
              :class="ub.kind === 'ai' ? 'unit-ai' : 'unit-local'"
              :style="{
                left: left(ub.start),
                width: width(ub.start, ub.end)
              }"
              :title="ub.title"
              @click="selectUnitBlock(ub)"
            >
              {{ ub.label }}
            </button>
          </div>
        </div>
        <div class="stl-row">
          <span class="stl-row-label">{{ t('graph.semanticTimeline.trackDialogue') }}</span>
          <div class="stl-track" :style="{ width: widthPx + 'px' }">
            <button
              v-for="line in dialogue"
              :key="line.id"
              type="button"
              class="stl-block dialogue"
              :class="{
                selected: selectedClip === clipKey(line.id),
                dirty: diff.dirtyDialogue.has(line.id)
              }"
              :style="{
                left: left(line.range.start),
                width: width(line.range.start, line.range.end)
              }"
              :title="line.text"
              @click="selectDialogue(line)"
            >
              {{ line.text }}
            </button>
          </div>
        </div>
        <div v-if="overlayBlocks.length" class="stl-row">
          <span class="stl-row-label">{{ t('graph.semanticTimeline.trackOverlays') }}</span>
          <div class="stl-track" :style="{ width: widthPx + 'px' }">
            <button
              v-for="ov in overlayBlocks"
              :key="ov.id"
              type="button"
              class="stl-block overlay"
              :style="{
                left: left(ov.start),
                width: width(ov.start, ov.end)
              }"
              :title="ov.title"
              @click="selectOverlayBlock(ov)"
            >
              {{ ov.label }}
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
    </div>

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
          @timeupdate="onVideoTimeUpdate"
        />
      </div>

      <p v-if="!resolvedSelection" class="muted">
        {{ t('graph.semanticTimeline.selectHint') }}
      </p>
      <SemanticSelectionInspector
        v-else
        :timeline="timeline"
        :selection="resolvedSelection"
        :prompt-by-shot="promptByShot"
        :reference-candidates="referenceCandidates"
        :playhead-sec="playheadSec"
        @edit="onEdit"
        @seek="seekToSeconds"
        @select-shot="selectShotById"
      >
        <template v-if="selectedEntity" #evidence>
          <p class="muted">
            {{ entityKindLabel(selectedEntity.item.kind) }} ·
            {{ t('graph.semanticTimeline.pixelEditable') }}:
            {{
              selectedEntity.item.pixelEditable
                ? t('graph.semanticTimeline.yes')
                : t('graph.semanticTimeline.no')
            }}
          </p>
        </template>
      </SemanticSelectionInspector>
      <p class="muted stl-shortcuts">{{ t('graph.semanticInspector.shortcutsHint') }}</p>
    </aside>
  </div>
</template>

<style scoped>
.stl-editor {
  display: flex;
  --stl-gutter: 104px;
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
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding: 8px 12px 16px 0;
}
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
  --layer-accent: var(--text-muted);
}
.stl-layer--footage {
  --layer-accent: #457b9d;
}
.stl-layer--entity {
  --layer-accent: #2a9d8f;
}
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
.stl-row {
  display: flex;
  align-items: center;
  margin-bottom: 6px;
}
.stl-row-label {
  position: sticky;
  left: 0;
  z-index: 2;
  flex: 0 0 var(--stl-gutter);
  align-self: stretch;
  display: flex;
  align-items: center;
  padding: 0 8px 0 2px;
  box-sizing: border-box;
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
.stl-block.entity {
  background: #2a9d8f;
  min-width: 10px;
}
.stl-block.entity.soft {
  background: #6c757d;
  opacity: 0.7;
}
.stl-block.shot {
  background: #457b9d;
}
.stl-block.unit-ai {
  background: #7c3aed;
}
.stl-block.unit-local {
  background: #0d9488;
}
.stl-block.dialogue {
  background: #b5838d;
}
.stl-block.overlay {
  background: #6d597a;
}
.stl-shot-tag {
  display: inline-block;
  margin-right: 4px;
  padding: 0 4px;
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.28);
  font-size: 10px;
  font-weight: 600;
}
.stl-block.dirty {
  box-shadow: inset 0 -3px 0 var(--accent);
}
.stl-block.removed {
  opacity: 0.45;
  background-image: repeating-linear-gradient(
    135deg,
    transparent 0 6px,
    color-mix(in srgb, var(--bg-panel) 60%, transparent) 6px 12px
  );
  text-decoration: line-through;
}
.stl-block.selected {
  outline: 2px solid var(--text);
}
.stl-block:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.stl-empty {
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
  user-select: none;
}
.stl-inspector {
  flex: 0 0 clamp(420px, 44%, 720px);
  align-self: stretch;
  max-height: 100%;
  border-left: 1px solid var(--border);
  padding: 12px;
  font-size: 13px;
  overflow: auto;
}
.stl-inspector h4 {
  margin: 0 0 8px;
  font-size: 13px;
}
.stl-source {
  margin: -12px -12px 10px;
  background: var(--bg-panel);
}
.stl-source-video {
  display: block;
  width: 100%;
  height: auto;
  object-fit: contain;
  background: #000;
}
.stl-inspector .muted {
  color: var(--text-muted);
  font-size: 12px;
}
.stl-shortcuts {
  margin-top: 12px;
}
</style>
