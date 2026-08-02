<template>
  <StudioFloatingWindow
    :open="open"
    :title="windowTitle"
    :z-index="1200"
    :default-width="1080"
    :default-height="620"
    :min-width="880"
    :min-height="520"
    body-class="pad-none"
    @close="onClose"
  >
    <div class="editor-root">
      <div class="body">
        <div class="preview-col">
          <div class="view-tabs">
            <button
              type="button"
              class="view-tab"
              :class="{ active: draft.viewMode === 'perspective' }"
              @click="setViewMode('perspective')"
            >
              {{ t('graph.lighting.perspective') }}
            </button>
            <button
              type="button"
              class="view-tab"
              :class="{ active: draft.viewMode === 'frontal' }"
              @click="setViewMode('frontal')"
            >
              {{ t('graph.lighting.frontal') }}
            </button>
          </div>
          <div ref="spherePaneEl" class="sphere-pane">
            <canvas
              ref="canvasEl"
              class="sphere-canvas"
              @pointerdown="onPointerDown"
              @pointermove="onPointerMove"
              @pointerup="onPointerUp"
              @pointercancel="onPointerUp"
            />
          </div>
        </div>

        <div class="mid-col">
          <div class="section-head">
            <span>{{ t('graph.lighting.global') }}</span>
            <button
              type="button"
              class="toggle"
              :class="{ on: draft.smartMode }"
              role="switch"
              :aria-checked="draft.smartMode"
              :title="t('graph.lighting.smartMode')"
              @click="toggleSmart"
            >
              <span class="toggle-knob" />
            </button>
          </div>

          <label class="slider-row">
            <span class="slider-label">{{ t('graph.lighting.brightness') }}</span>
            <input
              type="range"
              class="slider"
              min="0"
              max="100"
              step="1"
              :value="draft.brightness"
              :style="{ '--range-pct': rangePct(draft.brightness, 0, 100) }"
              @input="onBrightnessInput"
            />
            <span class="slider-value">{{ draft.brightness }}%</span>
          </label>

          <label class="color-row">
            <span class="slider-label">{{ t('graph.lighting.color') }}</span>
            <input
              type="color"
              class="color-input"
              :value="draft.color"
              @input="onColorInput"
            />
          </label>

          <div class="section-head spaced">
            <span>{{ t('graph.lighting.mainLight') }}</span>
          </div>
          <div class="dir-grid">
            <button
              v-for="dir in directions"
              :key="dir"
              type="button"
              class="dir-btn"
              :class="{ active: draft.mainDirection === dir }"
              @click="onDirection(dir)"
            >
              {{ t(`graph.lighting.directions.${dir}`) }}
            </button>
          </div>

          <div class="section-head spaced">
            <span>{{ t('graph.lighting.rimLight') }}</span>
            <button
              type="button"
              class="toggle"
              :class="{ on: draft.rimLight }"
              role="switch"
              :aria-checked="draft.rimLight"
              @click="toggleRim"
            >
              <span class="toggle-knob" />
            </button>
          </div>
        </div>

        <div class="right-col">
          <div class="section-head">
            <span>{{ t('graph.lighting.smartMode') }}</span>
          </div>
          <textarea
            v-model="draft.smartPrompt"
            class="smart-textarea"
            rows="3"
            :disabled="!draft.smartMode"
            :placeholder="t('graph.lighting.smartPromptPlaceholder')"
            @input="markCustom"
          />

          <div class="section-head spaced">
            <span>{{ t('graph.lighting.presetsTitle') }}</span>
          </div>
          <div class="presets">
            <button
              v-for="preset in presets"
              :key="preset.id"
              type="button"
              class="preset-btn"
              :class="{ active: draft.presetId === preset.id }"
              @click="onPreset(preset.id)"
            >
              {{ t(`graph.lighting.presets.${preset.titleKey}`) }}
            </button>
          </div>

          <div class="output-block">
            <span class="slider-label">{{ t('graph.lighting.outputPrompt') }}</span>
            <p class="prompt-preview">{{ outputPromptText || t('graph.lighting.promptEmpty') }}</p>
          </div>
        </div>
      </div>

      <div class="editor-footer">
        <ImageGenerateModelField
          ref="modelFieldEl"
          :open="open"
          :generate-model="generateModel"
          :generate-provider-instance-id="generateProviderInstanceId"
          @change="onModelChange"
        />
        <button type="button" class="reset-btn" @click="resetParams">
          {{ t('graph.lighting.resetParams') }}
        </button>
      </div>
    </div>
  </StudioFloatingWindow>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import {
  DEFAULT_LIGHTING_SETUP,
  LIGHTING_DIRECTIONS,
  LIGHTING_PRESETS,
  applyLightingDirection,
  applyLightingPreset,
  lightingSetupToNodePatch,
  lightingSphericalPoint,
  markLightingCustom,
  nearestLightingDirection,
  normalizeLightingSetup,
  resolveLightingOutputPrompt,
  type LightingDirection,
  type LightingPresetId,
  type LightingSetupState,
  type LightingViewMode
} from '@shared/graph'
import { useStudioI18n } from '../composables/useStudioI18n'
import { themePreference } from '../editor/preferences'
import ImageGenerateModelField from './ImageGenerateModelField.vue'
import StudioFloatingWindow from './StudioFloatingWindow.vue'

function cssColor(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

function rangePct(value: number, min: number, max: number): string {
  const span = max - min
  if (!(span > 0)) return '0%'
  const t = (value - min) / span
  return `${Math.min(100, Math.max(0, t * 100))}%`
}

const props = defineProps<{
  open: boolean
  previewUrl?: string | null
  setup?: Partial<LightingSetupState> | null
  generateModel?: string
  generateProviderInstanceId?: string
}>()

export type LightingEditorSavePayload = ReturnType<typeof lightingSetupToNodePatch> & {
  generateModel: string
  generateProviderInstanceId: string
}

const emit = defineEmits<{
  close: []
  update: [payload: LightingEditorSavePayload]
  save: [payload: LightingEditorSavePayload]
}>()

const { t } = useStudioI18n()
const windowTitle = computed(() => t('graph.lighting.appMark'))
const directions = LIGHTING_DIRECTIONS
const presets = LIGHTING_PRESETS.filter((p) => p.id !== 'custom')

const draft = reactive<LightingSetupState>(normalizeLightingSetup())
const canvasEl = ref<HTMLCanvasElement | null>(null)
const spherePaneEl = ref<HTMLElement | null>(null)
const previewImage = ref<HTMLImageElement | null>(null)
const modelFieldEl = ref<{
  currentSelection: () => { generateModel: string; generateProviderInstanceId: string }
} | null>(null)
const modelDraft = reactive({
  generateModel: '',
  generateProviderInstanceId: ''
})
let drag: { x: number; y: number; yaw: number; pitch: number } | null = null
let raf = 0
let previewLoadToken = 0
let paneObserver: ResizeObserver | null = null

const outputPromptText = computed(() => resolveLightingOutputPrompt(draft))

const dirty = computed(() => {
  const a = normalizeLightingSetup(props.setup)
  const b = normalizeLightingSetup(draft)
  const setupDirty = JSON.stringify(a) !== JSON.stringify(b)
  const modelDirty =
    modelDraft.generateModel !== (props.generateModel ?? '') ||
    modelDraft.generateProviderInstanceId !== (props.generateProviderInstanceId ?? '')
  return setupDirty || modelDirty
})

function onModelChange(payload: {
  generateModel: string
  generateProviderInstanceId: string
}): void {
  modelDraft.generateModel = payload.generateModel
  modelDraft.generateProviderInstanceId = payload.generateProviderInstanceId
}

/** StudioFloatingWindow 延迟两帧挂 body，等内容挂上后再初始化 canvas */
function afterFloatingBodyReady(run: () => void): void {
  void nextTick(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        void nextTick(run)
      })
    })
  })
}

function startPaneObserver(): void {
  stopPaneObserver()
  const pane = spherePaneEl.value
  if (!pane || typeof ResizeObserver === 'undefined') return
  paneObserver = new ResizeObserver(() => {
    resizeCanvas()
    scheduleDraw()
  })
  paneObserver.observe(pane)
}

function initPreviewSurface(): void {
  if (!props.open || !canvasEl.value) return
  startPaneObserver()
  resizeCanvas()
  scheduleDraw()
}

const hydrating = ref(false)
let previewTimer: ReturnType<typeof setTimeout> | null = null

function buildSavePayload(): LightingEditorSavePayload {
  const model = modelFieldEl.value?.currentSelection() ?? { ...modelDraft }
  return {
    ...lightingSetupToNodePatch(normalizeLightingSetup(draft)),
    generateModel: model.generateModel,
    generateProviderInstanceId: model.generateProviderInstanceId
  }
}

function emitPreview(): void {
  if (!props.open || hydrating.value) return
  if (previewTimer) clearTimeout(previewTimer)
  previewTimer = setTimeout(() => {
    previewTimer = null
    if (!props.open || hydrating.value) return
    emit('update', buildSavePayload())
  }, 48)
}

watch(
  () => props.open,
  (open) => {
    if (!open) return
    hydrating.value = true
    Object.assign(draft, normalizeLightingSetup(props.setup))
    modelDraft.generateModel = props.generateModel ?? ''
    modelDraft.generateProviderInstanceId = props.generateProviderInstanceId ?? ''
    afterFloatingBodyReady(initPreviewSurface)
    void nextTick(() => {
      hydrating.value = false
      emitPreview()
    })
  },
  { immediate: true }
)

watch(draft, () => emitPreview(), { deep: true })
watch(modelDraft, () => emitPreview(), { deep: true })

watch(
  () => [props.open, props.previewUrl] as const,
  ([open, url]) => {
    previewImage.value = null
    const token = ++previewLoadToken
    if (!open || !url?.trim()) {
      afterFloatingBodyReady(initPreviewSurface)
      return
    }
    const img = new Image()
    img.onload = () => {
      if (token !== previewLoadToken) return
      previewImage.value = img
      afterFloatingBodyReady(initPreviewSurface)
    }
    img.onerror = () => {
      if (token !== previewLoadToken) return
      previewImage.value = null
      afterFloatingBodyReady(initPreviewSurface)
    }
    img.src = url
  },
  { immediate: true }
)

watch(canvasEl, (el) => {
  if (el && props.open) initPreviewSurface()
})

watch(
  () =>
    [
      draft.yaw,
      draft.pitch,
      draft.brightness,
      draft.color,
      draft.rimLight,
      draft.viewMode,
      draft.mainDirection
    ] as const,
  () => scheduleDraw()
)

function setViewMode(mode: LightingViewMode): void {
  draft.viewMode = mode
  scheduleDraw()
}

function toggleSmart(): void {
  draft.smartMode = !draft.smartMode
  markCustom()
}

function toggleRim(): void {
  draft.rimLight = !draft.rimLight
  markCustom()
}

function markCustom(): void {
  Object.assign(draft, markLightingCustom(draft))
}

function onBrightnessInput(e: Event): void {
  Object.assign(
    draft,
    markLightingCustom({
      ...draft,
      brightness: Number((e.target as HTMLInputElement).value)
    })
  )
}

function onColorInput(e: Event): void {
  Object.assign(
    draft,
    markLightingCustom({
      ...draft,
      color: (e.target as HTMLInputElement).value
    })
  )
}

function onDirection(dir: LightingDirection): void {
  Object.assign(draft, applyLightingDirection(draft, dir))
}

function onPreset(id: LightingPresetId): void {
  const next = applyLightingPreset(id)
  Object.assign(draft, { ...next, viewMode: draft.viewMode, smartMode: draft.smartMode })
}

function resetParams(): void {
  Object.assign(draft, normalizeLightingSetup(DEFAULT_LIGHTING_SETUP))
  scheduleDraw()
}

function onPointerDown(e: PointerEvent): void {
  const canvas = canvasEl.value
  if (!canvas) return
  canvas.setPointerCapture(e.pointerId)
  drag = { x: e.clientX, y: e.clientY, yaw: draft.yaw, pitch: draft.pitch }
}

function onPointerMove(e: PointerEvent): void {
  if (!drag) return
  e.preventDefault()
  const dx = e.clientX - drag.x
  const dy = e.clientY - drag.y
  const yaw = drag.yaw + dx * 0.45
  const pitch = drag.pitch - dy * 0.35
  Object.assign(
    draft,
    markLightingCustom(
      normalizeLightingSetup({
        ...draft,
        yaw,
        pitch,
        mainDirection: nearestLightingDirection(yaw, pitch),
        presetId: 'custom'
      })
    )
  )
}

function onPointerUp(e: PointerEvent): void {
  const canvas = canvasEl.value
  if (canvas?.hasPointerCapture(e.pointerId)) {
    canvas.releasePointerCapture(e.pointerId)
  }
  drag = null
}

function resizeCanvas(): void {
  const canvas = canvasEl.value
  if (!canvas) return
  const parent = canvas.parentElement
  if (!parent) return
  const size = Math.min(parent.clientWidth, parent.clientHeight)
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  canvas.width = Math.max(1, Math.floor(size * dpr))
  canvas.height = Math.max(1, Math.floor(size * dpr))
  canvas.style.width = `${size}px`
  canvas.style.height = `${size}px`
}

function scheduleDraw(): void {
  if (raf) cancelAnimationFrame(raf)
  raf = requestAnimationFrame(() => {
    raf = 0
    drawPreview()
  })
}

function project(
  x: number,
  y: number,
  z: number,
  cx: number,
  cy: number,
  scale: number,
  frontal: boolean
): { x: number; y: number } {
  if (frontal) {
    return { x: cx + x * scale * 0.42, y: cy - y * scale * 0.42 }
  }
  const tilt = 0.35
  const cosT = Math.cos(tilt)
  const sinT = Math.sin(tilt)
  const y2 = y * cosT - z * sinT
  const z2 = y * sinT + z * cosT
  const persp = 1 / (2.6 - z2)
  return {
    x: cx + x * scale * persp,
    y: cy - y2 * scale * persp
  }
}

/** 与多角度预览同构：Rx(-pitch) → Ry(yaw)，使透视球随鼠标旋转 */
function rotateByView(
  x: number,
  y: number,
  z: number,
  yawDeg: number,
  pitchDeg: number
): { x: number; y: number; z: number } {
  const yaw = (yawDeg * Math.PI) / 180
  const pitch = (pitchDeg * Math.PI) / 180
  const cP = Math.cos(-pitch)
  const sP = Math.sin(-pitch)
  const y1 = y * cP - z * sP
  const z1 = y * sP + z * cP
  const cY = Math.cos(yaw)
  const sY = Math.sin(yaw)
  return {
    x: x * cY + z1 * sY,
    y: y1,
    z: -x * sY + z1 * cY
  }
}

function projectWorld(
  x: number,
  y: number,
  z: number,
  cx: number,
  cy: number,
  scale: number,
  frontal: boolean,
  yawDeg: number,
  pitchDeg: number
): { x: number; y: number; viewZ: number } {
  if (frontal) {
    const p = project(x, y, z, cx, cy, scale, true)
    return { ...p, viewZ: z }
  }
  const r = rotateByView(x, y, z, yawDeg, pitchDeg)
  const p = project(r.x, r.y, r.z, cx, cy, scale, false)
  const tilt = 0.35
  const viewZ = r.y * Math.sin(tilt) + r.z * Math.cos(tilt)
  return { ...p, viewZ }
}

type GridPoint = ReturnType<typeof projectWorld>

/** 按视深拆线，在球体轮廓处插值衔接正背面。 */
function strokeGridSide(
  ctx: CanvasRenderingContext2D,
  points: GridPoint[],
  front: boolean
): void {
  if (points.length < 2) return
  ctx.beginPath()
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!
    const b = points[i]!
    const aFront = a.viewZ >= 0
    const bFront = b.viewZ >= 0
    if (aFront === bFront) {
      if (aFront === front) {
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
      }
      continue
    }

    const t = a.viewZ / (a.viewZ - b.viewZ)
    const joinX = a.x + (b.x - a.x) * t
    const joinY = a.y + (b.y - a.y) * t
    if (aFront === front) {
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(joinX, joinY)
    } else {
      ctx.moveTo(joinX, joinY)
      ctx.lineTo(b.x, b.y)
    }
  }
  ctx.stroke()
}

function drawPreview(): void {
  const canvas = canvasEl.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const w = canvas.width
  const h = canvas.height
  const cx = w / 2
  const cy = h / 2
  const outerR = Math.min(w, h) * 0.42
  const radius = outerR / 0.55
  const frontal = draft.viewMode === 'frontal'
  const viewYaw = draft.yaw
  const viewPitch = draft.pitch

  const lightTheme = themePreference.value === 'light'
  const disc = cssColor('--bg-elevated', lightTheme ? '#e8ebf0' : '#1a1d22')
  const emptyThumb = cssColor('--bg-hover', lightTheme ? '#dfe3ea' : '#2a3038')
  const gridBack = lightTheme ? 'rgba(60, 80, 110, 0.2)' : 'rgba(160, 180, 200, 0.18)'
  const gridFront = lightTheme ? 'rgba(50, 70, 100, 0.52)' : 'rgba(180, 200, 220, 0.5)'
  const rimStroke = lightTheme ? 'rgba(70, 90, 120, 0.5)' : 'rgba(200, 210, 220, 0.5)'
  const bulbCore = cssColor('--bg', lightTheme ? '#ffffff' : '#111111')

  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = disc
  ctx.beginPath()
  ctx.arc(cx, cy, outerR, 0, Math.PI * 2)
  ctx.fill()

  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, outerR, 0, Math.PI * 2)
  ctx.clip()

  const toScreen = (x: number, y: number, z: number) =>
    projectWorld(x, y, z, cx, cy, radius, frontal, viewYaw, viewPitch)

  const gridLines: GridPoint[][] = []
  const meridians = 16
  const parallels = 10
  const meridianSteps = 72
  const parallelSteps = 96

  for (let i = 0; i < meridians; i++) {
    const yaw = (i / meridians) * Math.PI * 2
    const line: GridPoint[] = []
    for (let j = 0; j <= meridianSteps; j++) {
      const pitch = -Math.PI / 2 + (j / meridianSteps) * Math.PI
      const x = Math.cos(pitch) * Math.sin(yaw)
      const y = Math.sin(pitch)
      const z = Math.cos(pitch) * Math.cos(yaw)
      line.push(toScreen(x, y, z))
    }
    gridLines.push(line)
  }

  for (let i = 1; i < parallels; i++) {
    const pitch = -Math.PI / 2 + (i / parallels) * Math.PI
    const cp = Math.cos(pitch)
    const y = Math.sin(pitch)
    const line: GridPoint[] = []
    for (let j = 0; j <= parallelSteps; j++) {
      const yaw = (j / parallelSteps) * Math.PI * 2
      line.push(toScreen(cp * Math.sin(yaw), y, cp * Math.cos(yaw)))
    }
    gridLines.push(line)
  }

  // 背面低透明虚线先画，正面实线覆盖其上。
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.lineWidth = Math.max(1, w / 440)
  ctx.strokeStyle = gridBack
  ctx.setLineDash([Math.max(3, w / 130), Math.max(4, w / 100)])
  for (const line of gridLines) strokeGridSide(ctx, line, false)

  ctx.setLineDash([])
  ctx.lineWidth = Math.max(1.15, w / 390)
  ctx.strokeStyle = gridFront
  for (const line of gridLines) strokeGridSide(ctx, line, true)

  // 中心参考图
  const img = previewImage.value
  const thumbR = Math.min(w, h) * 0.14
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, thumbR, 0, Math.PI * 2)
  ctx.clip()
  ctx.fillStyle = emptyThumb
  ctx.fillRect(cx - thumbR, cy - thumbR, thumbR * 2, thumbR * 2)
  if (img) {
    const aspect = img.width / Math.max(1, img.height)
    let dw = thumbR * 2
    let dh = dw / aspect
    if (dh < thumbR * 2) {
      dh = thumbR * 2
      dw = dh * aspect
    }
    ctx.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh)
  }
  ctx.restore()

  // 主光位置 + 锥光（与球体同一视角旋转，灯光相对画面保持在瞄准方向）
  const light = lightingSphericalPoint(draft.yaw, draft.pitch, 1)
  const lp = toScreen(light.x, light.y, light.z)
  const intensity = 0.35 + (draft.brightness / 100) * 0.65

  ctx.strokeStyle = hexToRgba(draft.color, 0.35 * intensity)
  ctx.fillStyle = hexToRgba(draft.color, 0.18 * intensity)
  ctx.lineWidth = Math.max(1.2, w / 280)
  ctx.beginPath()
  ctx.moveTo(cx, cy)
  const ax = lp.x - cx
  const ay = lp.y - cy
  const len = Math.hypot(ax, ay) || 1
  const ox = (-ay / len) * (outerR * 0.12)
  const oy = (ax / len) * (outerR * 0.12)
  ctx.lineTo(lp.x + ox, lp.y + oy)
  ctx.lineTo(lp.x - ox, lp.y - oy)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()

  const bulbR = Math.max(6, w / 55)
  ctx.fillStyle = bulbCore
  ctx.beginPath()
  ctx.arc(lp.x, lp.y, bulbR, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = hexToRgba(draft.color, 0.9)
  ctx.lineWidth = Math.max(2, w / 220)
  ctx.stroke()

  if (draft.rimLight) {
    const rim = lightingSphericalPoint(draft.yaw + 180, Math.max(-20, draft.pitch * 0.3), 1)
    const rp = toScreen(rim.x, rim.y, rim.z)
    ctx.strokeStyle = lightTheme ? 'rgba(70, 100, 160, 0.55)' : 'rgba(200, 220, 255, 0.55)'
    ctx.lineWidth = Math.max(1.5, w / 260)
    ctx.beginPath()
    ctx.arc(rp.x, rp.y, bulbR * 0.7, 0, Math.PI * 2)
    ctx.stroke()
  }

  ctx.restore()

  ctx.strokeStyle = rimStroke
  ctx.lineWidth = Math.max(1.5, w / 280)
  ctx.beginPath()
  ctx.arc(cx, cy, outerR, 0, Math.PI * 2)
  ctx.stroke()
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function save(): void {
  emit('save', buildSavePayload())
}

function onClose(): void {
  if (dirty.value) save()
  emit('close')
}

function onWinResize(): void {
  if (!props.open) return
  resizeCanvas()
  scheduleDraw()
}

function stopPaneObserver(): void {
  paneObserver?.disconnect()
  paneObserver = null
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      window.addEventListener('resize', onWinResize)
      afterFloatingBodyReady(initPreviewSurface)
    } else {
      window.removeEventListener('resize', onWinResize)
      stopPaneObserver()
    }
  },
  { immediate: true }
)

watch(themePreference, () => {
  if (props.open) scheduleDraw()
})

onBeforeUnmount(() => {
  stopPaneObserver()
  window.removeEventListener('resize', onWinResize)
  if (raf) cancelAnimationFrame(raf)
})
</script>

<style scoped>
.editor-root {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  height: 100%;
  padding: 10px 12px;
  box-sizing: border-box;
}

.body {
  display: grid;
  grid-template-columns: minmax(240px, 1fr) minmax(220px, 0.9fr) minmax(260px, 1.1fr);
  gap: 14px;
  flex: 1 1 auto;
  min-height: 0;
}

.preview-col,
.mid-col,
.right-col {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
}

.preview-col {
  align-items: stretch;
  justify-content: flex-start;
}

.view-tabs {
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
}

.view-tab {
  border: 1px solid var(--border);
  background: var(--bg-hover);
  color: var(--text-muted);
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
}

.view-tab.active {
  color: var(--text);
  background: var(--bg-hover);
  border-color: #6a7480;
}

.sphere-pane {
  position: relative;
  flex: 0 1 auto;
  align-self: flex-start;
  width: 100%;
  min-height: 220px;
  aspect-ratio: 1 / 1;
  max-height: 100%;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  background: var(--graph-preview-bg);
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
}

.sphere-canvas {
  display: block;
  cursor: grab;
  touch-action: none;
}

.sphere-canvas:active {
  cursor: grabbing;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: 8px;
}

.section-head.spaced {
  margin-top: 16px;
}

.slider-row,
.color-row {
  display: grid;
  grid-template-columns: 52px 1fr auto;
  gap: 8px;
  align-items: center;
  margin-bottom: 10px;
  font-size: 12px;
  color: var(--text-muted);
}

.color-row {
  grid-template-columns: 52px auto;
}

.slider {
  width: 100%;
}

.color-input {
  width: 36px;
  height: 28px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
}

.dir-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.dir-btn,
.preset-btn,
.reset-btn {
  border: 1px solid var(--border);
  background: var(--bg-hover);
  color: var(--text);
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 12px;
  cursor: pointer;
}

.dir-btn.active,
.preset-btn.active {
  background: var(--bg-hover);
  border-color: #6a7480;
}

.dir-btn:hover,
.preset-btn:hover,
.reset-btn:hover {
  background: var(--bg-hover);
}

.toggle {
  width: 40px;
  height: 22px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg-hover);
  position: relative;
  cursor: pointer;
  padding: 0;
}

.toggle.on {
  background: #3d6df2;
  border-color: #5b84f5;
}

.toggle-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  transition: left 0.15s ease;
}

.toggle.on .toggle-knob {
  left: 20px;
}

.smart-textarea {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  min-height: 72px;
  border: 1px solid var(--border);
  border-radius: 8px;
  --textarea-bg: var(--bg-elevated);
  background: var(--textarea-bg);
  color: var(--text);
  padding: 8px 10px;
  font-size: 12px;
  font-family: inherit;
  line-height: 1.45;
}

.smart-textarea:disabled {
  opacity: 0.45;
}

.presets {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  overflow: auto;
  flex: 0 1 auto;
  max-height: 42%;
}

.output-block {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 0;
  flex: 1 1 auto;
}

.slider-label {
  font-size: 12px;
  color: var(--text-muted);
}

.prompt-preview {
  margin: 0;
  flex: 1 1 auto;
  min-height: 72px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elevated);
  color: var(--text);
  padding: 8px 10px;
  font-size: 12px;
  line-height: 1.45;
  white-space: pre-wrap;
}

.editor-footer {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  flex-shrink: 0;
  padding-top: 10px;
}

@media (max-width: 960px) {
  .body {
    grid-template-columns: 1fr;
    overflow: auto;
  }
}
</style>
