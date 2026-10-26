<template>
  <div
    ref="rootEl"
    class="media-preview"
    :class="{ 'is-image': mediaKind === 'image' }"
    tabindex="0"
    @wheel.prevent="onWheel"
    @keydown="onKeydown"
  >
    <div class="viewport" :class="{ text: mediaKind === 'text' }" @click="onBackdropClick">
      <textarea
        v-if="mediaKind === 'text'"
        class="text-view"
        readonly
        spellcheck="false"
        :value="textContent"
        @click.stop
      />
      <p v-else-if="mediaError || !resolvedUrl" class="empty">
        {{ mediaError ? mediaErrorText : emptyText }}
      </p>
      <div
        v-else-if="mediaKind === 'image' && tile3x3Mode"
        class="tile-grid-3x3"
        :class="{ grabbing: panning }"
        :style="imageStyle"
        @pointerdown="onPanStart"
        @pointermove="onPanMove"
        @pointerup="onPanEnd"
        @pointercancel="onPanEnd"
        @click.stop
      >
        <img
          v-for="idx in 9"
          :key="idx"
          :src="resolvedUrl"
          alt=""
          class="tile-cell-img"
          draggable="false"
        />
      </div>
      <div
        v-else-if="mediaKind === 'image'"
        class="image-stage"
        :style="imageStyle"
        @pointerdown="onPanStart"
        @pointermove="onStagePointerMove"
        @pointerup="onPanEnd"
        @pointercancel="onPanEnd"
        @click.stop
      >
        <img
          :src="resolvedUrl"
          alt=""
          class="image"
          :class="{ grabbing: panning }"
          draggable="false"
        />
        <canvas
          v-show="normalLightMode"
          ref="lightCanvasEl"
          class="overlay-light-canvas"
          aria-hidden="true"
        />
        <div v-if="nineSliceOverlay" class="overlay-9slice" aria-hidden="true">
          <span class="guide-h top" :style="{ top: `${nineSliceGuides.topPct}%` }" />
          <span class="guide-h bottom" :style="{ bottom: `${nineSliceGuides.bottomPct}%` }" />
          <span class="guide-v left" :style="{ left: `${nineSliceGuides.leftPct}%` }" />
          <span class="guide-v right" :style="{ right: `${nineSliceGuides.rightPct}%` }" />
          <span class="overlay-badge">{{ nineSliceGuides.label }}</span>
        </div>
        <svg
          v-if="collisionOverlay"
          class="overlay-collision-svg"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <polygon
            v-if="collisionSvg.hullPoints"
            :points="collisionSvg.hullPoints"
            class="svg-hull"
          />
          <rect
            :x="collisionSvg.hurt.x"
            :y="collisionSvg.hurt.y"
            :width="collisionSvg.hurt.w"
            :height="collisionSvg.hurt.h"
            class="svg-hurt"
          />
          <rect
            :x="collisionSvg.hit.x"
            :y="collisionSvg.hit.y"
            :width="collisionSvg.hit.w"
            :height="collisionSvg.hit.h"
            class="svg-hit"
          />
          <rect
            :x="collisionSvg.ground.x"
            :y="collisionSvg.ground.y"
            :width="collisionSvg.ground.w"
            :height="collisionSvg.ground.h"
            class="svg-ground"
          />
          <circle :cx="collisionSvg.pivot.x" :cy="collisionSvg.pivot.y" r="1.8" class="svg-pivot" />
        </svg>
      </div>
      <video
        v-else-if="mediaKind === 'video'"
        :src="resolvedUrl"
        class="av-player"
        controls
        playsinline
        preload="metadata"
        @error="onMediaError"
        @click.stop
      />
      <audio
        v-else
        :src="resolvedUrl"
        class="av-player audio"
        controls
        preload="metadata"
        @error="onMediaError"
        @click.stop
      />
    </div>

    <!--
      图片工具条：旋转 / 复位。
      刻意放在 .viewport 之外并 @click.stop —— viewport 的点击是「复位视图」，
      工具条落在里面就会点一下旋转、顺手把刚转的角度又复位掉。
    -->
    <div v-if="isImageReady" class="image-bar" @click.stop>
      <button
        type="button"
        class="bar-btn"
        :title="t('graph.preview.rotateCcw')"
        :aria-label="t('graph.preview.rotateCcw')"
        @click="rotateBy(-90)"
      >
        ↺
      </button>
      <button
        type="button"
        class="bar-btn"
        :title="t('graph.preview.rotateCw')"
        :aria-label="t('graph.preview.rotateCw')"
        @click="rotateBy(90)"
      >
        ↻
      </button>
      <button
        type="button"
        class="bar-btn angle"
        :title="t('graph.preview.rotateReset')"
        :disabled="rotationDeg === 0"
        @click="resetRotation"
      >
        {{ rotationLabel }}
      </button>
      <button
        type="button"
        class="bar-btn"
        :class="{ active: tile3x3Mode }"
        :title="t('gameToolbox.preview.tile3x3Title')"
        @click="tile3x3Mode = !tile3x3Mode"
      >
        3×3
      </button>
      <button
        type="button"
        class="bar-btn"
        :class="{ active: nineSliceOverlay }"
        :title="t('gameToolbox.preview.nineSliceTitle')"
        @click="nineSliceOverlay = !nineSliceOverlay"
      >
        9-Slice
      </button>
      <button
        type="button"
        class="bar-btn"
        :class="{ active: collisionOverlay }"
        :title="t('gameToolbox.preview.collisionTitle')"
        @click="collisionOverlay = !collisionOverlay"
      >
        Box
      </button>
      <button
        type="button"
        class="bar-btn"
        :class="{ active: normalLightMode }"
        :title="t('gameToolbox.preview.normalLightTitle')"
        @click="normalLightMode = !normalLightMode"
      >
        {{ t('gameToolbox.preview.normalLightBtn') }}
      </button>
      <span class="bar-hint">{{ t('graph.preview.imageHint') }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  deriveCombatBoxesFromAlpha,
  derivePbrMapsFromRgba,
  detectNineSliceBorders,
  extractSpriteCollisionHull
} from '@shared/gameAssets'
import { useStudioI18n } from '../../composables/useStudioI18n'

const props = defineProps<{
  frameKey: string
  mediaKind: 'image' | 'video' | 'audio' | 'text'
  url: string
  relativePath?: string
  title?: string
  text?: string
}>()

const { t } = useStudioI18n()
const rootEl = ref<HTMLElement | null>(null)
const lightCanvasEl = ref<HTMLCanvasElement | null>(null)
const resolvedUrl = ref('')
const mediaError = ref(false)
const scale = ref(1)
const offsetX = ref(0)
const offsetY = ref(0)
/** 视角旋转（度）。只对图片有意义，且与缩放 / 平移叠加 */
const rotationDeg = ref(0)
const tile3x3Mode = ref(false)
const nineSliceOverlay = ref(false)
const collisionOverlay = ref(false)
const normalLightMode = ref(false)
const panning = ref(false)
let didPan = false
let panPointerId: number | null = null
let panStart = { x: 0, y: 0, ox: 0, oy: 0 }

const nineSliceGuides = ref({
  topPct: 22,
  bottomPct: 22,
  leftPct: 22,
  rightPct: 22,
  label: '22% / 22% / 22% / 22%'
})

const collisionSvg = ref({
  hullPoints: '20,15 80,15 85,90 15,90',
  hurt: { x: 24, y: 16, w: 50, h: 76 },
  hit: { x: 55, y: 28, w: 37, h: 42 },
  ground: { x: 30, y: 88, w: 40, h: 6 },
  pivot: { x: 50, y: 94 }
})

let cachedPixelsUrl = ''
let cachedRgba: Uint8ClampedArray | null = null
let cachedNormalMap: Uint8ClampedArray | null = null
let cachedWidth = 0
let cachedHeight = 0
let lightNormX = 0.35
let lightNormY = 0.25

async function ensureDecodedImageAnalysis(): Promise<void> {
  const url = resolvedUrl.value
  if (!url || props.mediaKind !== 'image') return
  if (cachedPixelsUrl !== url || !cachedRgba) {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    await new Promise<void>((resolve) => {
      img.onload = () => resolve()
      img.onerror = () => resolve()
      img.src = url
    })
    const w = img.naturalWidth || img.width
    const h = img.naturalHeight || img.height
    if (!w || !h) return
    const off = document.createElement('canvas')
    off.width = w
    off.height = h
    const ctx = off.getContext('2d')
    if (!ctx) return
    ctx.drawImage(img, 0, 0)
    cachedRgba = new Uint8ClampedArray(ctx.getImageData(0, 0, w, h).data)
    cachedWidth = w
    cachedHeight = h
    cachedPixelsUrl = url
    cachedNormalMap = null

    const nine = detectNineSliceBorders(cachedRgba, w, h)
    nineSliceGuides.value = {
      topPct: Number(((nine.borders.top / h) * 100).toFixed(1)),
      bottomPct: Number(((nine.borders.bottom / h) * 100).toFixed(1)),
      leftPct: Number(((nine.borders.left / w) * 100).toFixed(1)),
      rightPct: Number(((nine.borders.right / w) * 100).toFixed(1)),
      label: `L:${nine.borders.left} R:${nine.borders.right} T:${nine.borders.top} B:${nine.borders.bottom}px`
    }

    const hull = extractSpriteCollisionHull(cachedRgba, w, h, { maxVertices: 8 })
    const boxes = deriveCombatBoxesFromAlpha(cachedRgba, w, h)
    collisionSvg.value = {
      hullPoints: hull.verticesNormalized
        .map((pt) => `${(pt.x * 100).toFixed(1)},${(pt.y * 100).toFixed(1)}`)
        .join(' '),
      hurt: {
        x: (boxes.hurtbox.x / w) * 100,
        y: (boxes.hurtbox.y / h) * 100,
        w: (boxes.hurtbox.width / w) * 100,
        h: (boxes.hurtbox.height / h) * 100
      },
      hit: {
        x: (boxes.hitbox.x / w) * 100,
        y: (boxes.hitbox.y / h) * 100,
        w: (boxes.hitbox.width / w) * 100,
        h: (boxes.hitbox.height / h) * 100
      },
      ground: {
        x: (boxes.groundSensor.x / w) * 100,
        y: (boxes.groundSensor.y / h) * 100,
        w: (boxes.groundSensor.width / w) * 100,
        h: (boxes.groundSensor.height / h) * 100
      },
      pivot: {
        x: (hull.pivot.x / w) * 100,
        y: (hull.pivot.y / h) * 100
      }
    }
  }

  if (normalLightMode.value) {
    if (!cachedNormalMap && cachedRgba && cachedWidth > 0 && cachedHeight > 0) {
      const pbr = derivePbrMapsFromRgba(cachedRgba, cachedWidth, cachedHeight, {
        normalFormat: 'opengl',
        normalStrength: 3.0
      })
      cachedNormalMap = pbr.normal
    }
    renderNormalLightCanvas()
  }
}

function renderNormalLightCanvas(): void {
  const canvas = lightCanvasEl.value
  if (!canvas || !cachedRgba || !cachedNormalMap || !cachedWidth || !cachedHeight) return
  if (canvas.width !== cachedWidth || canvas.height !== cachedHeight) {
    canvas.width = cachedWidth
    canvas.height = cachedHeight
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const out = ctx.createImageData(cachedWidth, cachedHeight)
  const dst = out.data
  const src = cachedRgba
  const nrm = cachedNormalMap
  const lx = lightNormX * cachedWidth
  const ly = lightNormY * cachedHeight
  const lz = Math.max(cachedWidth, cachedHeight) * 0.35

  for (let y = 0; y < cachedHeight; y++) {
    for (let x = 0; x < cachedWidth; x++) {
      const idx = (y * cachedWidth + x) * 4
      const a = src[idx + 3]
      if (a < 8) {
        dst[idx + 3] = 0
        continue
      }
      const nx = (nrm[idx] / 255) * 2 - 1
      const ny = -((nrm[idx + 1] / 255) * 2 - 1)
      const nz = (nrm[idx + 2] / 255) * 2 - 1
      const dx = lx - x
      const dy = ly - y
      const invLen = 1 / (Math.hypot(dx, dy, lz) || 1)
      const ldx = dx * invLen
      const ldy = dy * invLen
      const ldz = lz * invLen
      const ndotl = Math.max(0, nx * ldx + ny * ldy + nz * ldz)
      const hz = ldz + 1
      const hInv = 1 / (Math.hypot(ldx, ldy, hz) || 1)
      const ndoth = Math.max(0, nx * ldx * hInv + ny * ldy * hInv + nz * hz * hInv)
      const spec = Math.pow(ndoth, 20) * 95
      const shade = 0.25 + ndotl * 1.15
      dst[idx] = Math.min(255, Math.round(src[idx] * shade + spec * 1.05))
      dst[idx + 1] = Math.min(255, Math.round(src[idx + 1] * shade + spec * 0.96))
      dst[idx + 2] = Math.min(255, Math.round(src[idx + 2] * shade + spec * 0.82))
      dst[idx + 3] = a
    }
  }
  ctx.putImageData(out, 0, 0)
}

watch(
  () => [resolvedUrl.value, nineSliceOverlay.value, collisionOverlay.value, normalLightMode.value],
  () => {
    if (nineSliceOverlay.value || collisionOverlay.value || normalLightMode.value) {
      void ensureDecodedImageAnalysis()
    }
  }
)

const isImageReady = computed(
  () => props.mediaKind === 'image' && !!resolvedUrl.value && !mediaError.value
)
const rotationLabel = computed(() => `${Math.round(rotationDeg.value)}°`)

const imageStyle = computed(() => ({
  transform: `translate(${offsetX.value}px, ${offsetY.value}px) scale(${scale.value}) rotate(${rotationDeg.value}deg)`
}))

const textContent = computed(() => props.text ?? props.url ?? '')

const emptyText = computed(() => {
  if (props.mediaKind === 'video') return t('director.stage.shotPreviewEmptyVideo')
  if (props.mediaKind === 'audio') return t('director.stage.shotPreviewEmptyVoice')
  if (props.mediaKind === 'text') return t('graph.notepad.emptyReadonly')
  return t('director.stage.shotPreviewEmpty')
})

const mediaErrorText = computed(() => {
  if (props.mediaKind === 'audio') return t('graph.preview.audioError')
  if (props.mediaKind === 'video') return t('graph.preview.videoError')
  return emptyText.value
})

function onMediaError(): void {
  // 切 src / 清空时浏览器也会抛 error，勿把空态标成「编码不受支持」
  if (!resolvedUrl.value) return
  mediaError.value = true
}

async function resolveUrl(): Promise<void> {
  mediaError.value = false
  const relativePath = props.relativePath?.trim()
  if (relativePath) {
    try {
      const url = await window.studio.getAssetFileUrl(relativePath)
      if (url) {
        // 相对路径字符串不能当 <video src>；IPC 失败时宁可空态也不塞假 URL
        resolvedUrl.value = url
        return
      }
    } catch {
      /* fall through */
    }
  }
  const fallback = props.url?.trim() || ''
  // studio-media / http(s) / data / blob / file 才可播；裸相对路径放弃
  resolvedUrl.value =
    /^(studio-media:|https?:|data:|blob:|file:)/i.test(fallback) || fallback.startsWith('/')
      ? fallback
      : ''
}

watch(
  () => [props.url, props.relativePath, props.mediaKind] as const,
  () => {
    // 换图不继承上一张的缩放 / 平移 / 旋转：弹窗是复用的，转过的角度会让人以为图本身是歪的
    resetView()
    void resolveUrl()
  },
  { immediate: true }
)

onMounted(() => {
  rootEl.value?.focus()
})

/** 细调步长（Shift+滚轮）；按钮与 [ / ] 走 90° 整步 */
const ROTATE_STEP = 15

function onWheel(e: WheelEvent): void {
  if (!isImageReady.value) return
  // Shift + 滚轮 = 细调角度（与精修面板同一套手势）
  if (e.shiftKey) {
    rotateBy(e.deltaY > 0 ? ROTATE_STEP : -ROTATE_STEP)
    return
  }
  const next = scale.value * (e.deltaY < 0 ? 1.1 : 0.9)
  scale.value = Math.min(8, Math.max(0.2, next))
}

/** 旋转角归一化到 [0, 360)：连点也不会堆出 720 / -90 这类值 */
function rotateBy(deg: number): void {
  rotationDeg.value = (rotationDeg.value + deg + 360) % 360
}

function resetRotation(): void {
  rotationDeg.value = 0
}

/** 复位视图：缩放 / 平移 / 旋转一起回到初始（点空白处与「0」键） */
function resetView(): void {
  scale.value = 1
  offsetX.value = 0
  offsetY.value = 0
  rotationDeg.value = 0
}

/**
 * 键盘：[ / ] 转 90°，0 复位。
 * 预览是浮在画布之上的窗，且画布 / 精修面板都挂了 window 级快捷键，
 * 所以这里必须 stopPropagation，免得转一下把底下的画布或参数也一起转了。
 */
function onKeydown(event: KeyboardEvent): void {
  if (!isImageReady.value) return
  if (event.key === '[') rotateBy(-90)
  else if (event.key === ']') rotateBy(90)
  else if (event.key === '0') resetView()
  else return
  event.preventDefault()
  event.stopPropagation()
}

function onPanStart(e: PointerEvent): void {
  if (e.button !== 0) return
  panning.value = true
  didPan = false
  panPointerId = e.pointerId
  ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
  panStart = { x: e.clientX, y: e.clientY, ox: offsetX.value, oy: offsetY.value }
}

function onPanMove(e: PointerEvent): void {
  if (!panning.value || panPointerId !== e.pointerId) return
  const dx = e.clientX - panStart.x
  const dy = e.clientY - panStart.y
  if (Math.abs(dx) > 2 || Math.abs(dy) > 2) didPan = true
  offsetX.value = panStart.ox + dx
  offsetY.value = panStart.oy + dy
}

function onStagePointerMove(e: PointerEvent): void {
  onPanMove(e)
  if (normalLightMode.value && !panning.value) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) {
      lightNormX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
      lightNormY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))
      renderNormalLightCanvas()
    }
  }
}

function onPanEnd(e: PointerEvent): void {
  if (panPointerId !== e.pointerId) return
  panning.value = false
  panPointerId = null
}

function onBackdropClick(): void {
  if (didPan) {
    didPan = false
    return
  }
  resetView()
}
</script>

<style scoped>
.media-preview {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  /* 工具条浮在画面之上 */
  position: relative;
  outline: none;
  background: var(--graph-preview-bg);
}
.media-preview.is-image {
  background: var(--image-checker-bg);
}
.viewport {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.empty {
  color: var(--text-muted);
  font-size: 13px;
}
.image {
  max-width: none;
  max-height: none;
  transform-origin: center center;
  cursor: grab;
  user-select: none;
  background: var(--image-checker-bg);
}
.image.grabbing {
  cursor: grabbing;
}

/* 图片工具条：浮在画面下沿居中，压在深色画布上（本窗固定深底，不跟主题） */
.image-bar {
  position: absolute;
  left: 50%;
  bottom: 12px;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: calc(100% - 24px);
  padding: 4px 8px;
  transform: translateX(-50%);
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.62);
  color: #fff;
  font-size: 11px;
}

.bar-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 22px;
  padding: 0 6px;
  border: 1px solid rgba(0, 0, 0, 0.35);
  border-radius: 999px;
  background: transparent;
  color: #fff;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
}

.bar-btn:hover:not(:disabled) {
  background: rgba(0, 0, 0, 0.35);
}

.bar-btn.active {
  background: rgba(56, 189, 248, 0.35);
  border-color: rgba(56, 189, 248, 0.8);
}

.image-stage {
  position: relative;
  display: inline-flex;
  transform-origin: center center;
}

.tile-grid-3x3 {
  display: grid;
  grid-template-columns: repeat(3, 160px);
  grid-template-rows: repeat(3, 160px);
  gap: 0;
  border: 1px solid rgba(56, 189, 248, 0.5);
  transform-origin: center center;
  cursor: grab;
}

.tile-cell-img {
  width: 160px;
  height: 160px;
  object-fit: fill;
  display: block;
}

.overlay-9slice,
.overlay-collision-svg,
.overlay-light-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.overlay-9slice .guide-h {
  position: absolute;
  left: 0;
  right: 0;
  border-top: 1.5px dashed #22c55e;
}

.overlay-9slice .guide-v {
  position: absolute;
  top: 0;
  bottom: 0;
  border-left: 1.5px dashed #22c55e;
}

.overlay-badge {
  position: absolute;
  top: 6px;
  left: 6px;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.72);
  color: #4ade80;
  font-size: 10px;
  font-family: monospace;
}

.svg-hull {
  fill: rgba(168, 85, 247, 0.14);
  stroke: #a855f7;
  stroke-width: 0.6;
  stroke-dasharray: 1.5 1;
}

.svg-hurt {
  fill: rgba(56, 189, 248, 0.12);
  stroke: #38bdf8;
  stroke-width: 0.6;
}

.svg-hit {
  fill: rgba(244, 63, 94, 0.15);
  stroke: #f43f5e;
  stroke-width: 0.6;
}

.svg-ground {
  fill: rgba(34, 197, 94, 0.18);
  stroke: #22c55e;
  stroke-width: 0.5;
}

.svg-pivot {
  fill: #facc15;
  stroke: #000;
  stroke-width: 0.4;
}

.bar-btn:disabled {
  opacity: 0.45;
  cursor: default;
}

.bar-btn.angle {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.bar-hint {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: rgba(255, 255, 255, 0.75);
}

/* 窄窗先收提示文案，按钮始终在 */
@media (max-width: 560px) {
  .bar-hint {
    display: none;
  }
}
.av-player {
  max-width: 100%;
  max-height: 100%;
}
.av-player.audio {
  width: min(480px, 90%);
}
.viewport.text {
  align-items: stretch;
  justify-content: stretch;
  padding: 12px;
}
.text-view {
  flex: 1;
  width: 100%;
  min-height: 0;
  resize: none;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 12px;
  background: var(--bg-panel);
  color: var(--text);
  font: inherit;
  line-height: 1.5;
}
</style>
