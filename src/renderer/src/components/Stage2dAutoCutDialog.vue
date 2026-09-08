<template>
  <StudioFloatingWindow
    :open="open"
    :title="t('stage2d.autoCutEditTitle')"
    :subtitle="t('stage2d.autoCutEditSubtitle')"
    :z-index="1290"
    :default-width="1180"
    :default-height="720"
    :min-width="940"
    :min-height="560"
    body-class="pad-none"
    @close="emitClose"
  >
    <div
      v-if="busy"
      class="ac-status"
    >
      {{ t('stage2d.autoCutEditPreparing') }}
    </div>
    <div
      v-else-if="!session"
      class="ac-status ac-status-fail"
    >
      <p>{{ t('stage2d.autoCutFail') }}</p>
      <p class="ac-status-hint">{{ t('stage2d.autoCutEditFailHint') }}</p>
      <button
        type="button"
        class="ac-btn ac-btn-primary"
        @click="emitClose"
      >
        {{ t('stage2d.autoCutEditCancel') }}
      </button>
    </div>

    <template v-else>
      <div class="ac-root">
        <aside class="ac-side">
          <div class="ac-block">
            <div class="ac-block-title">{{ t('stage2d.autoCutEditTools') }}</div>
            <div class="ac-tools">
              <button
                type="button"
                class="ac-tool"
                :class="{ active: tool === 'pan' }"
                :title="t('stage2d.autoCutEditToolPan')"
                @click="tool = 'pan'"
              >
                ✋
              </button>
              <button
                type="button"
                class="ac-tool"
                :class="{ active: tool === 'assign' }"
                :title="t('stage2d.autoCutEditToolAssign')"
                @click="tool = 'assign'"
              >
                ▭
              </button>
              <button
                type="button"
                class="ac-tool ac-tool-erase"
                :class="{ active: tool === 'erase' }"
                :title="t('stage2d.autoCutEditToolErase')"
                @click="tool = 'erase'"
              >
                🩹
              </button>
            </div>
            <div class="ac-toolhint">
              {{
                tool === 'pan'
                  ? t('stage2d.autoCutEditToolPanHint')
                  : tool === 'assign'
                    ? t('stage2d.autoCutEditToolAssignHint')
                    : t('stage2d.autoCutEditToolEraseHint')
              }}
            </div>
          </div>

          <div class="ac-block">
            <div class="ac-block-title">
              {{ t('stage2d.autoCutEditParts', { count: String(partCount) }) }}
            </div>
            <ul class="ac-slots">
              <li
                v-for="(slot, slotIndex) in session.slots"
                :key="slot.id"
                class="ac-slot"
                :class="{
                  active: slotIndex === editSlotIndex,
                  empty: (counts[slotIndex] ?? 0) <= 0
                }"
                @click="selectSlot(slotIndex)"
              >
                <span
                  class="ac-chip"
                  :style="{ background: slotColor(slotIndex) }"
                />
                <span class="ac-thumb checker">
                  <img
                    v-if="thumbs[slotIndex]"
                    :src="thumbs[slotIndex]"
                    alt=""
                  >
                </span>
                <span class="ac-slot-meta">
                  <input
                    class="ac-name"
                    :value="slot.name"
                    :title="t('stage2d.autoCutEditRenameTip')"
                    @click.stop
                    @change="onRenameSlot(slotIndex, $event)"
                  >
                  <span class="ac-count">{{ counts[slotIndex] ?? 0 }} px</span>
                </span>
                <button
                  type="button"
                  class="ac-mini"
                  :disabled="(counts[slotIndex] ?? 0) <= 0"
                  :title="t('stage2d.autoCutEditEraseSlot')"
                  @click.stop="eraseSlot(slotIndex)"
                >
                  ✕
                </button>
              </li>
            </ul>
            <p
              v-if="tool === 'assign' && editSlotIndex < 0"
              class="ac-warn"
            >
              {{ t('stage2d.autoCutEditPickSlot') }}
            </p>
          </div>

          <div class="ac-block ac-ops">
            <button
              type="button"
              class="ac-btn"
              :disabled="!undoStack.length"
              @click="undo"
            >
              ↩ {{ t('stage2d.autoCutEditUndo') }}
            </button>
            <button
              type="button"
              class="ac-btn"
              :disabled="!edited"
              @click="resetParts"
            >
              ↺ {{ t('stage2d.autoCutEditReset') }}
            </button>
          </div>
        </aside>

        <section
          class="ac-stage checker"
          @wheel="onWheel"
        >
          <canvas
            ref="canvasEl"
            class="ac-canvas"
            :class="tool === 'pan' ? 'ac-cursor-grab' : 'ac-cursor-cross'"
            @pointerdown="onPointerDown"
            @pointermove="onPointerMove"
            @pointerup="onPointerUp"
            @pointercancel="onPointerUp"
            @pointerleave="onPointerUp"
          />
        </section>
      </div>
    </template>

    <template #footer>
      <span class="ac-footer-hint">{{ t('stage2d.autoCutEditFooterHint') }}</span>
      <button
        type="button"
        class="ac-btn"
        @click="emitClose"
      >
        {{ t('stage2d.autoCutEditCancel') }}
      </button>
      <button
        type="button"
        class="ac-btn ac-btn-primary"
        :disabled="!session || busy"
        @click="applyParts"
      >
        {{ t('stage2d.autoCutEditApply') }}
      </button>
    </template>
  </StudioFloatingWindow>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  assignStage2dAutoPartRegion,
  DEFAULT_STAGE2D_RIG,
  eraseStage2dAutoPartSlot,
  recomputeStage2dAutoPieces,
  type Stage2dRig,
  type Stage2dSceneState
} from '@shared/gameAssets'
import {
  buildAutoPartDataUrl,
  commitStage2dAutoCutSession,
  prepareStage2dAutoCutSession,
  type Stage2dAutoCutResult,
  type Stage2dAutoCutSession
} from '../features/graph/model/composeStage2dAutoCut'
import { useStudioI18n } from '../composables/useStudioI18n'
import StudioFloatingWindow from './StudioFloatingWindow.vue'

type Tool = 'pan' | 'assign' | 'erase'

const props = defineProps<{
  open: boolean
  scene: Stage2dSceneState | null
  rig: Stage2dRig | null
  frameLayerId: string
  resolveLayerUrl: (sourceUrl: string) => Promise<string>
}>()

const emit = defineEmits<{
  close: []
  applied: [result: Stage2dAutoCutResult]
}>()

const { t } = useStudioI18n()

const PALETTE = [
  '#f43f5e',
  '#fb923c',
  '#eab308',
  '#4ade80',
  '#2dd4bf',
  '#38bdf8',
  '#818cf8',
  '#e879f9',
  '#34d399',
  '#fb7185',
  '#facc15',
  '#7dd3fc'
]

const busy = ref(false)
const session = ref<Stage2dAutoCutSession | null>(null)
const tool = ref<Tool>('assign')
const editSlotIndex = ref(-1)
const assignment = ref<Int32Array | null>(null)
/** 初始自动分区副本，供「重置」 */
let pristine: Int32Array | null = null
const undoStack = ref<Int32Array[]>([])
const edited = ref(false)
/** 每槽像素数与部件缩略图（下标 = 槽下标） */
const counts = ref<Record<number, number>>({})
const thumbs = ref<Record<number, string>>({})
const partCount = computed(() => {
  let n = 0
  for (const key of Object.keys(counts.value)) {
    if ((counts.value[Number(key)] ?? 0) > 0) n += 1
  }
  return n
})

/** 主视口 */
const canvasEl = ref<HTMLCanvasElement | null>(null)
let srcCanvas: HTMLCanvasElement | null = null
let maskCanvas: HTMLCanvasElement | null = null
interface View {
  scale: number
  tx: number
  ty: number
}
const view = ref<View>({ scale: 1, tx: 0, ty: 0 })
let baseFit = 1
let needsFit = true
let ro: ResizeObserver | null = null
let mounted = true

/** 指针交互 */
type Drag = { kind: 'pan'; sx: number; sy: number; tx: number; ty: number }
type RectDrag = { kind: 'rect'; x0: number; y0: number; x1: number; y1: number }
let drag: (Drag | RectDrag) | null = null

function slotColor(index: number): string {
  return PALETTE[index % PALETTE.length] ?? '#f43f5e'
}

function resetSessionState(): void {
  busy.value = false
  session.value = null
  assignment.value = null
  pristine = null
  undoStack.value = []
  edited.value = false
  counts.value = {}
  thumbs.value = {}
  editSlotIndex.value = -1
  tool.value = 'assign'
  drag = null
  srcCanvas = null
  maskCanvas = null
  needsFit = true
}

watch(
  () => props.open,
  (opening) => {
    if (!opening) {
      resetSessionState()
      return
    }
    resetSessionState()
    busy.value = true
    void (async () => {
      const s = await prepareStage2dAutoCutSession({
        state: props.scene ?? { layers: [], canvasWidth: 0, canvasHeight: 0, anchor: 'ground', groundRatio: 0.06 },
        rig: props.rig ?? DEFAULT_STAGE2D_RIG,
        frameLayerId: props.frameLayerId,
        resolveLayerUrl: props.resolveLayerUrl
      })
      if (!mounted) return
      busy.value = false
      if (!s) {
        session.value = null
        return
      }
      session.value = s
      assignment.value = s.assignment
      pristine = s.assignment.slice()
      undoStack.value = []
      edited.value = false
      refreshVisuals()
      needsFit = true
      void nextPaint()
    })()
  },
  { immediate: true }
)

function refreshVisuals(): void {
  const s = session.value
  const as = assignment.value
  if (!s || !as) return
  rebuildMask(as)
  const { pieces } = recomputeStage2dAutoPieces({
    width: s.contentWidth,
    height: s.contentHeight,
    assignment: as,
    slots: s.slots
  })
  const nextCounts: Record<number, number> = {}
  const nextThumbs: Record<number, string> = {}
  for (let i = 0; i < s.slots.length; i += 1) nextCounts[i] = 0
  for (const piece of pieces) {
    nextCounts[piece.slotIndex] = piece.pixelCount
    nextThumbs[piece.slotIndex] = buildAutoPartDataUrl(
      s.contentRgba,
      s.contentWidth,
      as,
      piece.slotIndex,
      piece.crop
    )
  }
  counts.value = nextCounts
  thumbs.value = nextThumbs
  requestRedraw()
}

function rebuildMask(as: Int32Array): void {
  const s = session.value
  if (!s) return
  if (!maskCanvas) {
    maskCanvas = document.createElement('canvas')
    maskCanvas.width = s.contentWidth
    maskCanvas.height = s.contentHeight
  }
  const ctx = maskCanvas.getContext('2d')
  if (!ctx) return
  const img = ctx.createImageData(s.contentWidth, s.contentHeight)
  const out = img.data
  for (let i = 0; i < s.contentWidth * s.contentHeight; i += 1) {
    const slot = as[i]
    if (slot >= 0) {
      const hex = slotColor(slot).slice(1)
      out[i * 4] = parseInt(hex.slice(0, 2), 16)
      out[i * 4 + 1] = parseInt(hex.slice(2, 4), 16)
      out[i * 4 + 2] = parseInt(hex.slice(4, 6), 16)
      out[i * 4 + 3] = 130
    } else {
      out[i * 4 + 3] = 0
    }
  }
  ctx.putImageData(img, 0, 0)
}

function syncCanvasSize(): void {
  const el = canvasEl.value
  if (!el) return
  const dpr = window.devicePixelRatio || 1
  const cssW = el.clientWidth
  const cssH = el.clientHeight
  const wantW = Math.max(1, Math.round(cssW * dpr))
  const wantH = Math.max(1, Math.round(cssH * dpr))
  if (el.width !== wantW || el.height !== wantH) {
    el.width = wantW
    el.height = wantH
  }
}

function fitView(): void {
  const el = canvasEl.value
  const s = session.value
  if (!el || !s) return
  const vw = Math.max(1, el.clientWidth)
  const vh = Math.max(1, el.clientHeight)
  const cw = Math.max(1, s.contentWidth)
  const ch = Math.max(1, s.contentHeight)
  baseFit = Math.min(vw / cw, vh / ch) * 0.9
  view.value.scale = baseFit
  view.value.tx = (vw - cw * view.value.scale) / 2
  view.value.ty = (vh - ch * view.value.scale) / 2
}

function ensureSrcCanvas(): void {
  const s = session.value
  if (!s || srcCanvas) return
  srcCanvas = document.createElement('canvas')
  srcCanvas.width = s.contentWidth
  srcCanvas.height = s.contentHeight
  const ctx = srcCanvas.getContext('2d')
  if (ctx) ctx.putImageData(new ImageData(new Uint8ClampedArray(s.contentRgba), s.contentWidth, s.contentHeight), 0, 0)
}

function requestRedraw(): void {
  void nextPaint()
}

let rafId = 0

function nextPaint(): Promise<void> {
  if (rafId) return Promise.resolve()
  return new Promise((resolve) => {
    rafId = requestAnimationFrame(() => {
      rafId = 0
      if (mounted) draw()
      resolve()
    })
  })
}

function draw(): void {
  const el = canvasEl.value
  const s = session.value
  if (!el || !s) return
  syncCanvasSize()
  if (needsFit) {
    needsFit = false
    fitView()
  }
  ensureSrcCanvas()
  const dpr = window.devicePixelRatio || 1
  const ctx = el.getContext('2d')
  if (!ctx) return
  const cssW = el.clientWidth
  const cssH = el.clientHeight
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, cssW, cssH)
  if (!srcCanvas) return

  ctx.save()
  ctx.translate(view.value.tx, view.value.ty)
  ctx.scale(view.value.scale, view.value.scale)
  ctx.drawImage(srcCanvas, 0, 0)
  if (maskCanvas) ctx.drawImage(maskCanvas, 0, 0)

  // 槽骨架参考折线（首点挂点关节）
  ctx.lineCap = 'round'
  s.slots.forEach((slot, slotIndex) => {
    const isTarget = slotIndex === editSlotIndex.value
    ctx.beginPath()
    slot.polyline.forEach((pt, i) => {
      if (i === 0) ctx.moveTo(pt.x, pt.y)
      else ctx.lineTo(pt.x, pt.y)
    })
    if (isTarget) {
      ctx.strokeStyle = 'rgba(255,255,255,0.95)'
      ctx.lineWidth = 3.2 / view.value.scale
      ctx.stroke()
      ctx.strokeStyle = slotColor(slotIndex)
      ctx.lineWidth = 1.6 / view.value.scale
      ctx.stroke()
    } else {
      ctx.strokeStyle = 'rgba(255,255,255,0.75)'
      ctx.lineWidth = 2 / view.value.scale
      ctx.stroke()
      ctx.strokeStyle = 'rgba(20,24,32,0.5)'
      ctx.lineWidth = 0.8 / view.value.scale
      ctx.stroke()
    }
  })
  ctx.restore()

  // 拖拽矩形（CSS 坐标绘制，线宽恒定）
  if (drag && drag.kind === 'rect') {
    const x0 = Math.min(drag.x0, drag.x1)
    const y0 = Math.min(drag.y0, drag.y1)
    const x1 = Math.max(drag.x0, drag.x1)
    const y1 = Math.max(drag.y0, drag.y1)
    const fill = tool.value === 'erase' ? 'rgba(239,68,68,0.16)' : 'rgba(56,189,248,0.16)'
    const stroke = tool.value === 'erase' ? 'rgba(239,68,68,0.95)' : 'rgba(56,189,248,0.95)'
    const c = (x: number) => x * view.value.scale + view.value.tx
    ctx.fillStyle = fill
    ctx.fillRect(c(x0), c(y0), (x1 - x0) * view.value.scale, (y1 - y0) * view.value.scale)
    ctx.strokeStyle = stroke
    ctx.lineWidth = 1.5
    ctx.strokeRect(c(x0), c(y0), (x1 - x0) * view.value.scale, (y1 - y0) * view.value.scale)
  }
}

function contentFromCss(px: number, py: number): { x: number; y: number } {
  return {
    x: (px - view.value.tx) / view.value.scale,
    y: (py - view.value.ty) / view.value.scale
  }
}

function onWheel(e: WheelEvent): void {
  e.preventDefault()
  const el = canvasEl.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const px = e.clientX - rect.left
  const py = e.clientY - rect.top
  const before = contentFromCss(px, py)
  const factor = Math.exp(-e.deltaY * 0.0016)
  const zoom = Math.min(Math.max((view.value.scale / baseFit) * factor, 0.06), 64)
  view.value.scale = baseFit * zoom
  view.value.tx = px - before.x * view.value.scale
  view.value.ty = py - before.y * view.value.scale
  requestRedraw()
}

function onPointerDown(e: PointerEvent): void {
  if (e.button !== 0) return
  const el = canvasEl.value
  if (!el) return
  el.setPointerCapture(e.pointerId)
  const rect = el.getBoundingClientRect()
  const px = e.clientX - rect.left
  const py = e.clientY - rect.top
  if (tool.value === 'pan') {
    drag = { kind: 'pan', sx: px, sy: py, tx: view.value.tx, ty: view.value.ty }
    return
  }
  const pt = contentFromCss(px, py)
  drag = { kind: 'rect', x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y }
}

function onPointerMove(e: PointerEvent): void {
  if (!drag) return
  const el = canvasEl.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const px = e.clientX - rect.left
  const py = e.clientY - rect.top
  if (drag.kind === 'pan') {
    view.value.tx = drag.tx + (px - drag.sx)
    view.value.ty = drag.ty + (py - drag.sy)
  } else {
    const pt = contentFromCss(px, py)
    drag.x1 = pt.x
    drag.y1 = pt.y
  }
  requestRedraw()
}

function onPointerUp(): void {
  if (!drag) return
  if (drag.kind === 'pan') {
    drag = null
    requestRedraw()
    return
  }
  const rect = drag
  drag = null
  const x0 = Math.min(rect.x0, rect.x1)
  const y0 = Math.min(rect.y0, rect.y1)
  const width = Math.abs(rect.x1 - rect.x0)
  const height = Math.abs(rect.y1 - rect.y0)
  // 过小矩形视为误点（防止误擦 / 误归并）
  const cssW = Math.max(1, canvasEl.value?.clientWidth ?? 1)
  const cssH = Math.max(1, canvasEl.value?.clientHeight ?? 1)
  const thrW = (4 / cssW) * (session.value?.contentWidth ?? 1)
  const thrH = (4 / cssH) * (session.value?.contentHeight ?? 1)
  if (width < thrW && height < thrH) {
    requestRedraw()
    return
  }
  const s = session.value
  const as = assignment.value
  if (!s || !as) return
  const to = tool.value === 'erase' ? -1 : editSlotIndex.value
  const next = assignStage2dAutoPartRegion({
    assignment: as,
    width: s.contentWidth,
    region: { x: x0, y: y0, width, height },
    to
  })
  commitEdit(next)
}

function commitEdit(next: Int32Array): void {
  const as = assignment.value
  if (!as) return
  undoStack.value.push(as)
  if (undoStack.value.length > 8) undoStack.value.shift()
  assignment.value = next
  edited.value = true
  refreshVisuals()
}

function selectSlot(index: number): void {
  editSlotIndex.value = index
  requestRedraw()
}

function onRenameSlot(index: number, e: Event): void {
  const s = session.value
  if (!s) return
  const value = (e.target as HTMLInputElement).value.trim()
  if (!value || value === s.slots[index]?.name) return
  const slots = s.slots.map((slot, i) => (i === index ? { ...slot, name: value } : slot))
  s.slots = slots
  refreshVisuals()
}

function eraseSlot(index: number): void {
  const s = session.value
  const as = assignment.value
  if (!s || !as) return
  commitEdit(eraseStage2dAutoPartSlot({ assignment: as, slot: index }))
}

function undo(): void {
  const prev = undoStack.value.pop()
  if (!prev) return
  assignment.value = prev
  refreshVisuals()
  if (!undoStack.value.length) edited.value = false
}

function resetParts(): void {
  if (!pristine) return
  undoStack.value = []
  assignment.value = pristine.slice()
  edited.value = false
  refreshVisuals()
}

function applyParts(): void {
  const s = session.value
  const as = assignment.value
  if (!s || !as || busy.value) return
  busy.value = true
  try {
    const result = commitStage2dAutoCutSession(s, as)
    emit('applied', result)
  } finally {
    busy.value = false
  }
}

function emitClose(): void {
  emit('close')
}

onBeforeUnmount(() => {
  mounted = false
  ro?.disconnect()
  ro = null
  if (rafId) cancelAnimationFrame(rafId)
  rafId = 0
})

watch(
  () => props.open,
  (opening) => {
    if (!opening || !canvasEl.value) return
    void nextTickFit()
  },
  { immediate: false }
)
</script>

<script lang="ts">
function nextTickFit(): Promise<void> {
  return import('vue').then(({ nextTick }) => nextTick())
}
</script>

<style scoped>
.ac-status {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px;
  color: var(--text-muted);
  font-size: 12px;
}

.ac-status-fail {
  color: var(--text);
}

.ac-status-hint {
  color: var(--text-muted);
  margin: 0;
}

.ac-root {
  display: flex;
  gap: 10px;
  height: 100%;
  min-height: 0;
  min-width: 0;
  padding: 10px;
  box-sizing: border-box;
  background: var(--bg-panel);
}

.ac-side {
  flex: 0 0 300px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow: auto;
}

.ac-block {
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 8px;
}

.ac-block-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  margin-bottom: 6px;
}

.ac-tools {
  display: flex;
  gap: 6px;
}

.ac-tool {
  flex: 1 1 auto;
  height: 32px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-panel);
  color: var(--text);
  font-size: 15px;
  cursor: pointer;
}

.ac-tool.active {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 18%, var(--bg-panel));
}

.ac-toolhint {
  margin-top: 6px;
  font-size: 11px;
  line-height: 1.45;
  color: var(--text-muted);
}

.ac-warn {
  margin: 6px 0 0;
  font-size: 11px;
  color: var(--warn);
}

.ac-slots {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ac-slot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 6px;
  border: 1px solid transparent;
  border-radius: 4px;
  cursor: pointer;
  user-select: none;
}

.ac-slot:hover {
  background: var(--bg-hover);
}

.ac-slot.active {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 14%, var(--bg-panel));
}

.ac-slot.empty {
  opacity: 0.45;
}

.ac-chip {
  flex: 0 0 auto;
  width: 12px;
  height: 12px;
  border-radius: 3px;
}

.ac-thumb {
  flex: 0 0 46px;
  width: 46px;
  height: 46px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 3px;
}

.ac-thumb img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.ac-slot-meta {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ac-name {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text);
  font-size: 12px;
  padding: 1px 2px;
}

.ac-name:hover,
.ac-name:focus {
  border-color: var(--border);
  background: var(--bg-panel);
  outline: none;
}

.ac-count {
  font-size: 10px;
  color: var(--text-muted);
}

.ac-mini {
  flex: 0 0 auto;
  width: 20px;
  height: 20px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  border-radius: 3px;
  font-size: 11px;
}

.ac-mini:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--danger);
}

.ac-mini:disabled {
  cursor: default;
  opacity: 0.3;
}

.ac-ops {
  display: flex;
  gap: 6px;
}

.ac-btn {
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-panel);
  color: var(--text);
  font-size: 12px;
  padding: 5px 10px;
  cursor: pointer;
}

.ac-btn:hover:not(:disabled) {
  background: var(--bg-hover);
}

.ac-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.ac-btn-primary {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--bg-panel);
}

.ac-btn-primary:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent) 88%, black);
}

.ac-stage {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  position: relative;
  border: 1px solid var(--border);
  border-radius: 4px;
  overflow: hidden;
  display: flex;
  touch-action: none;
}

.ac-canvas {
  width: 100%;
  height: 100%;
  display: block;
  touch-action: none;
}

.ac-cursor-grab {
  cursor: grab;
}

.ac-cursor-cross {
  cursor: crosshair;
}

.ac-footer-hint {
  flex: 1 1 auto;
  font-size: 11px;
  color: var(--text-muted);
  white-space: pre-wrap;
}

.checker {
  background-color: var(--bg-input);
  background-image:
    linear-gradient(
      45deg,
      var(--wash-16) 25%,
      transparent 25%,
      transparent 75%,
      var(--wash-16) 75%
    ),
    linear-gradient(
      45deg,
      var(--wash-16) 25%,
      transparent 25%,
      transparent 75%,
      var(--wash-16) 75%
    );
  background-size: 16px 16px;
  background-position: 0 0, 8px 8px;
}
</style>
