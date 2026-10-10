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

const selectedId = ref<string | null>(null)

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
  return null
})

function left(start: number): string {
  return `${Math.max(0, start) * px.value}px`
}
function width(start: number, end: number): string {
  return `${Math.max(4, (end - start) * px.value)}px`
}

function selectBeat(b: StoryBeat): void {
  selectedId.value = b.id
  emit('selectBeat', b.id)
  emit('seek', b.timeRange.start)
}
function selectEvent(e: SemanticEvent): void {
  selectedId.value = e.id
  emit('selectEvent', e.id)
  emit('seek', e.timeRange.start)
}
function selectEntity(e: Entity): void {
  selectedId.value = e.id
  emit('selectEntity', e.id)
  const first = e.appearances[0]
  if (first) emit('seek', first.range.start)
}

function intentsForTrack(track: string): DirectorIntent[] {
  return intents.value.filter((i) => i.techniques.some((t) => t.track === track))
}
</script>

<template>
  <div class="stl-editor">
    <div ref="scrollRef" class="stl-scroll" @wheel="onWheel">
      <div class="stl-zoombar">
        <button
          type="button"
          class="stl-zoombar-btn"
          title="Zoom out"
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
          title="Zoom (Ctrl + wheel)"
          aria-label="Zoom"
          @input="onZoomInput"
        />
        <button type="button" class="stl-zoombar-btn" title="Zoom in" @click="zoomBy(ZOOM_STEP)">
          +
        </button>
        <span class="stl-zoom-readout">{{ Math.round(px) }} px/s</span>
        <button type="button" class="stl-zoombar-btn" title="Reset zoom" @click="resetZoom">
          ⟲
        </button>
      </div>

      <div class="stl-ruler" :style="{ width: widthPx + 'px' }">
        <span
          v-for="t in Math.ceil(duration) + 1"
          :key="t"
          class="stl-tick"
          :style="{ left: (t - 1) * px + 'px' }"
          >{{ t - 1 }}s</span
        >
      </div>

      <section class="stl-layer">
        <header>Story</header>
        <div class="stl-track" :style="{ width: widthPx + 'px' }">
          <button
            v-for="b in beats"
            :key="b.id"
            type="button"
            class="stl-block beat"
            :class="{ selected: selectedId === b.id }"
            :style="{
              left: left(b.timeRange.start),
              width: width(b.timeRange.start, b.timeRange.end)
            }"
            :title="b.description"
            @click="selectBeat(b)"
          >
            {{ b.type }}
          </button>
        </div>
      </section>

      <section class="stl-layer">
        <header>Character / Entity</header>
        <div
          v-for="ent in entities"
          :key="ent.id"
          class="stl-track entity-row"
          :style="{ width: widthPx + 'px' }"
        >
          <span class="stl-ent-label">{{ ent.name }}</span>
          <button
            v-for="(ap, i) in ent.appearances"
            :key="ent.id + i"
            type="button"
            class="stl-block entity"
            :class="{ selected: selectedId === ent.id, soft: !ent.pixelEditable }"
            :style="{ left: left(ap.range.start), width: width(ap.range.start, ap.range.end) }"
            @click="selectEntity(ent)"
          />
        </div>
        <div v-if="!entities.length" class="stl-empty">No entities</div>
      </section>

      <section class="stl-layer">
        <header>Production</header>
        <div
          v-for="track in ['camera', 'audio', 'text', 'vfx']"
          :key="track"
          class="stl-track"
          :style="{ width: widthPx + 'px' }"
        >
          <span class="stl-ent-label">{{ track }}</span>
          <button
            v-for="intent in intentsForTrack(track)"
            :key="intent.id + track"
            type="button"
            class="stl-block intent"
            :style="{
              left: left(
                events.find((e) => e.id === intent.trigger || e.label === intent.trigger)?.timeRange
                  .start ?? 0
              ),
              width: width(
                events.find((e) => e.id === intent.trigger || e.label === intent.trigger)?.timeRange
                  .start ?? 0,
                events.find((e) => e.id === intent.trigger || e.label === intent.trigger)?.timeRange
                  .end ?? 1
              )
            }"
            :title="intent.reason"
          >
            {{ intent.techniques.find((t) => t.track === track)?.action }}
          </button>
        </div>
        <div class="stl-track" :style="{ width: widthPx + 'px' }">
          <span class="stl-ent-label">events</span>
          <button
            v-for="ev in events"
            :key="ev.id"
            type="button"
            class="stl-block event"
            :class="{ selected: selectedId === ev.id }"
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
      </section>
    </div>

    <aside v-if="selectedEvidence" class="stl-inspector">
      <h4>Evidence</h4>
      <template v-if="selectedEvidence.kind === 'event'">
        <p>
          <strong>{{ selectedEvidence.item.label }}</strong>
        </p>
        <p>{{ selectedEvidence.item.description }}</p>
        <p class="muted">evidence: {{ selectedEvidence.item.evidence.join(', ') || '—' }}</p>
        <p class="muted">
          {{ selectedEvidence.item.timeRange.start.toFixed(2) }}s –
          {{ selectedEvidence.item.timeRange.end.toFixed(2) }}s
        </p>
      </template>
      <template v-else-if="selectedEvidence.kind === 'beat'">
        <p>
          <strong>{{ selectedEvidence.item.type }}</strong>
        </p>
        <p>{{ selectedEvidence.item.description }}</p>
        <p class="muted">events: {{ selectedEvidence.item.events.join(', ') || '—' }}</p>
      </template>
      <template v-else>
        <p>
          <strong>{{ selectedEvidence.item.name }}</strong> ({{ selectedEvidence.item.kind }})
        </p>
        <p class="muted">pixelEditable: {{ selectedEvidence.item.pixelEditable ? 'yes' : 'no' }}</p>
      </template>
    </aside>
  </div>
</template>

<style scoped>
.stl-editor {
  display: flex;
  gap: 12px;
  min-height: 280px;
  background: var(--bg-panel);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}
.stl-scroll {
  flex: 1;
  overflow: auto;
  padding: 8px 12px 16px;
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
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 50%;
  background: var(--bg-elevated);
  color: var(--text);
  font-size: 12px;
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
}
.stl-layer > header {
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
  margin-bottom: 5px;
}
.stl-track {
  position: relative;
  height: 40px;
  margin-bottom: 6px;
  background: var(--bg-elevated);
  border-radius: 5px;
}
.stl-ent-label {
  position: absolute;
  left: 6px;
  top: 50%;
  transform: translateY(-50%);
  z-index: 2;
  padding: 1px 5px;
  border-radius: 3px;
  /* 标签压在块上（块从 0s 开始时必然重叠）：给层底片，字号加大后仍读得清 */
  background: color-mix(in srgb, var(--bg-panel) 72%, transparent);
  font-size: 13px;
  color: var(--text-muted);
  pointer-events: none;
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
  font-size: 12px;
  color: var(--text-muted);
  padding: 6px;
}
.stl-inspector {
  width: 240px;
  flex-shrink: 0;
  border-left: 1px solid var(--border);
  padding: 12px;
  font-size: 13px;
  overflow: auto;
}
.stl-inspector h4 {
  margin: 0 0 8px;
  font-size: 13px;
}
.stl-inspector .muted {
  color: var(--text-muted);
  font-size: 12px;
}
</style>
