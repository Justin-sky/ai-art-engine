<template>
  <StudioFloatingWindow
    :open="open"
    :title="windowTitle"
    :z-index="1200"
    :default-width="960"
    :default-height="580"
    :min-width="760"
    :min-height="480"
    body-class="pad-none"
    @close="onClose"
  >
    <div class="editor-root">
    <div class="presets">
      <button
        v-for="preset in presets"
        :key="preset.id"
        type="button"
        class="preset-btn"
        :class="{ active: draft.presetId === preset.id }"
        @click="onPreset(preset.id)"
      >
        {{ t(`graph.multiAngle.presets.${preset.titleKey}`) }}
      </button>
    </div>

    <div class="body">
      <div ref="spherePaneEl" class="sphere-pane">
        <button type="button" class="orbit-btn up" :title="t('graph.multiAngle.pitchUp')" @click="nudgePitch(5)">
          <span class="orbit-chevron">&gt;</span>
        </button>
        <button type="button" class="orbit-btn down" :title="t('graph.multiAngle.pitchDown')" @click="nudgePitch(-5)">
          <span class="orbit-chevron">&gt;</span>
        </button>
        <button type="button" class="orbit-btn left" :title="t('graph.multiAngle.yawLeft')" @click="nudgeYaw(-15)">
          <span class="orbit-chevron">&lt;</span>
        </button>
        <button type="button" class="orbit-btn right" :title="t('graph.multiAngle.yawRight')" @click="nudgeYaw(15)">
          <span class="orbit-chevron">&gt;</span>
        </button>
        <canvas
          ref="canvasEl"
          class="sphere-canvas"
          @pointerdown="onSpherePointerDown"
          @pointermove="onSpherePointerMove"
          @pointerup="onSpherePointerUp"
          @pointercancel="onSpherePointerUp"
        />
      </div>

      <div class="controls">
        <label class="slider-row">
          <span class="slider-label">{{ t('graph.multiAngle.yaw') }}</span>
          <input
            type="range"
            class="slider"
            :min="yawMin"
            :max="yawMax"
            :step="1"
            :value="draft.yaw"
            :style="{ '--range-pct': rangePct(draft.yaw, yawMin, yawMax) }"
            @input="onYawInput"
          />
          <span class="slider-value">{{ draft.yaw }}°</span>
        </label>

        <label class="slider-row">
          <span class="slider-label">{{ t('graph.multiAngle.pitch') }}</span>
          <input
            type="range"
            class="slider"
            :min="pitchMin"
            :max="pitchMax"
            :step="1"
            :value="draft.pitch"
            :style="{ '--range-pct': rangePct(draft.pitch, pitchMin, pitchMax) }"
            @input="onPitchInput"
          />
          <span class="slider-value">{{ draft.pitch }}°</span>
        </label>

        <label class="slider-row">
          <span class="slider-label">{{ t('graph.multiAngle.shotScale') }}</span>
          <input
            type="range"
            class="slider"
            min="0"
            max="1"
            step="0.01"
            :value="draft.shotScale"
            :style="{ '--range-pct': rangePct(draft.shotScale, 0, 1) }"
            @input="onScaleInput"
          />
          <span class="slider-value">{{ scaleLabel }}</span>
        </label>

        <div class="prompt-preview-block">
          <span class="slider-label">{{ t('graph.multiAngle.cameraPrompt') }}</span>
          <p class="prompt-preview">{{ cameraPromptText || t('graph.multiAngle.promptEmpty') }}</p>
        </div>

        <div class="prompt-row">
          <span class="slider-label">{{ t('graph.multiAngle.prompt') }}</span>
          <button
            type="button"
            class="toggle"
            :class="{ on: draft.promptEnabled }"
            role="switch"
            :aria-checked="draft.promptEnabled"
            @click="togglePrompt"
          >
            <span class="toggle-knob" />
          </button>
        </div>

        <label class="panel-prompt">
          <span class="slider-label">{{ t('graph.multiAngle.panelPrompt') }}</span>
          <textarea
            v-model="panelDraft"
            class="panel-textarea"
            rows="3"
            :placeholder="t('graph.multiAngle.panelPromptPlaceholder')"
          />
        </label>

        <div v-if="draft.promptEnabled" class="prompt-preview-block">
          <span class="slider-label">{{ t('graph.multiAngle.outputPrompt') }}</span>
          <p class="prompt-preview">{{ outputPromptText || t('graph.multiAngle.promptEmpty') }}</p>
        </div>
        <p v-else class="prompt-hint">{{ t('graph.multiAngle.promptOffHint') }}</p>
      </div>
    </div>

    <div class="editor-footer">
      <button type="button" class="reset-btn" @click="resetParams">
        {{ t('graph.multiAngle.resetParams') }}
      </button>
    </div>
    </div>
  </StudioFloatingWindow>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import {
  DEFAULT_MULTI_ANGLE_CAMERA,
  MULTI_ANGLE_PITCH_MAX,
  MULTI_ANGLE_PITCH_MIN,
  MULTI_ANGLE_PRESETS,
  MULTI_ANGLE_YAW_MAX,
  MULTI_ANGLE_YAW_MIN,
  applyMultiAnglePreset,
  buildMultiAnglePrompt,
  markMultiAngleCustom,
  multiAngleCameraToNodePatch,
  multiAngleSphericalPoint,
  normalizeMultiAngleCamera,
  resolveMultiAngleOutputPrompt,
  resolveMultiAnglePresetPanelPrompt,
  shotScaleLabel,
  type MultiAngleCameraState,
  type MultiAnglePresetId
} from '@shared/graph'
import { useStudioI18n } from '../composables/useStudioI18n'
import { themePreference } from '../editor/preferences'
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
  title?: string
  previewUrl?: string | null
  camera?: Partial<MultiAngleCameraState> | null
  panelPrompt?: string | null
}>()

const emit = defineEmits<{
  close: []
  save: [
    payload: ReturnType<typeof multiAngleCameraToNodePatch> & {
      text: string
    }
  ]
}>()

const { t } = useStudioI18n()

const windowTitle = computed(() => t('graph.multiAngle.appMark'))

const yawMin = MULTI_ANGLE_YAW_MIN
const yawMax = MULTI_ANGLE_YAW_MAX
const pitchMin = MULTI_ANGLE_PITCH_MIN
const pitchMax = MULTI_ANGLE_PITCH_MAX
const presets = MULTI_ANGLE_PRESETS

const draft = reactive<MultiAngleCameraState>(normalizeMultiAngleCamera())
const panelDraft = ref('')
const canvasEl = ref<HTMLCanvasElement | null>(null)
const spherePaneEl = ref<HTMLElement | null>(null)
const previewImage = ref<HTMLImageElement | null>(null)
let drag: { x: number; y: number; yaw: number; pitch: number } | null = null
let raf = 0
let previewLoadToken = 0
let paneObserver: ResizeObserver | null = null

const scaleLabel = computed(() => shotScaleLabel(draft.shotScale))
const cameraPromptText = computed(() => buildMultiAnglePrompt(draft))
const outputPromptText = computed(() =>
  resolveMultiAngleOutputPrompt(draft, panelDraft.value)
)

const dirty = computed(() => {
  const a = normalizeMultiAngleCamera(props.camera)
  const panelChanged = panelDraft.value !== (props.panelPrompt ?? '')
  return (
    panelChanged ||
    a.presetId !== draft.presetId ||
    a.yaw !== draft.yaw ||
    a.pitch !== draft.pitch ||
    Math.abs(a.shotScale - draft.shotScale) > 0.001 ||
    a.promptEnabled !== draft.promptEnabled
  )
})

watch(
  () => [props.open, props.camera, props.panelPrompt] as const,
  ([open]) => {
    if (!open) return
    Object.assign(draft, normalizeMultiAngleCamera(props.camera))
    panelDraft.value = props.panelPrompt ?? ''
    void nextTick(() => {
      resizeCanvas()
      scheduleDraw()
    })
  },
  { immediate: true, deep: true }
)

watch(
  () => [props.open, props.previewUrl] as const,
  ([open, url]) => {
    previewImage.value = null
    const token = ++previewLoadToken
    if (!open || !url?.trim()) {
      scheduleDraw()
      return
    }
    const img = new Image()
    img.onload = () => {
      if (token !== previewLoadToken) return
      previewImage.value = img
      void nextTick(() => {
        resizeCanvas()
        scheduleDraw()
      })
    }
    img.onerror = () => {
      if (token !== previewLoadToken) return
      previewImage.value = null
      scheduleDraw()
    }
    img.src = url
  },
  { immediate: true }
)

watch(
  () =>
    [
      draft.yaw,
      draft.pitch,
      draft.shotScale,
      draft.presetId,
      draft.promptEnabled
    ] as const,
  () => scheduleDraw()
)

function onPreset(id: MultiAnglePresetId): void {
  const prompt = resolveMultiAnglePresetPanelPrompt(id)
  if (prompt) {
    Object.assign(draft, applyMultiAnglePreset(id, true))
    panelDraft.value = prompt
    draft.promptEnabled = true
    return
  }
  // 无预设面板文案：与截图一致，清空面板并关闭开关
  Object.assign(draft, applyMultiAnglePreset(id, false))
  panelDraft.value = ''
  draft.promptEnabled = false
}

function onYawInput(e: Event): void {
  const value = Number((e.target as HTMLInputElement).value)
  Object.assign(draft, markMultiAngleCustom({ ...draft, yaw: value }))
}

function onPitchInput(e: Event): void {
  const value = Number((e.target as HTMLInputElement).value)
  Object.assign(draft, markMultiAngleCustom({ ...draft, pitch: value }))
}

function onScaleInput(e: Event): void {
  const value = Number((e.target as HTMLInputElement).value)
  Object.assign(draft, markMultiAngleCustom({ ...draft, shotScale: value }))
}

function nudgeYaw(delta: number): void {
  Object.assign(
    draft,
    markMultiAngleCustom(
      normalizeMultiAngleCamera({ ...draft, yaw: draft.yaw + delta, presetId: 'custom' })
    )
  )
}

function nudgePitch(delta: number): void {
  Object.assign(
    draft,
    markMultiAngleCustom(
      normalizeMultiAngleCamera({ ...draft, pitch: draft.pitch + delta, presetId: 'custom' })
    )
  )
}

function togglePrompt(): void {
  draft.promptEnabled = !draft.promptEnabled
}

function resetParams(): void {
  Object.assign(draft, normalizeMultiAngleCamera(DEFAULT_MULTI_ANGLE_CAMERA))
  panelDraft.value = ''
  scheduleDraw()
}

function onSpherePointerDown(e: PointerEvent): void {
  const canvas = canvasEl.value
  if (!canvas) return
  canvas.setPointerCapture(e.pointerId)
  drag = { x: e.clientX, y: e.clientY, yaw: draft.yaw, pitch: draft.pitch }
}

function onSpherePointerMove(e: PointerEvent): void {
  if (!drag) return
  const dx = e.clientX - drag.x
  const dy = e.clientY - drag.y
  Object.assign(
    draft,
    markMultiAngleCustom(
      normalizeMultiAngleCamera({
        ...draft,
        yaw: drag.yaw + dx * 0.45,
        pitch: drag.pitch - dy * 0.35,
        presetId: 'custom'
      })
    )
  )
}

function onSpherePointerUp(e: PointerEvent): void {
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
    drawSphere()
  })
}

const SPHERE_TILT = 0.35

function project(
  x: number,
  y: number,
  z: number,
  cx: number,
  cy: number,
  scale: number
): { x: number; y: number; depth: number } {
  // 轻微俯视一点的等角投影：绕 X 倾斜
  const cosT = Math.cos(SPHERE_TILT)
  const sinT = Math.sin(SPHERE_TILT)
  const y2 = y * cosT - z * sinT
  const z2 = y * sinT + z * cosT
  const persp = 1 / (2.6 - z2)
  return {
    x: cx + x * scale * persp,
    y: cy - y2 * scale * persp,
    depth: z2
  }
}

/** 与 multiAngleSphericalPoint 同构：Rx(-pitch) → Ry(yaw)，使 (0,0,1) 落到机位点 */
function rotateByCamera(
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
  const x1 = x
  const cY = Math.cos(yaw)
  const sY = Math.sin(yaw)
  return {
    x: x1 * cY + z1 * sY,
    y: y1,
    z: -x1 * sY + z1 * cY
  }
}

type SphereStrokePoint = {
  x: number
  y: number
  front: boolean
  /** 投影前相机空间坐标（旋转后、倾斜前） */
  vx: number
  vy: number
  vz: number
  /** 倾斜后的视深，用于正背面分界（与视觉轮廓一致） */
  viewZ: number
}

function projectOriented(
  x: number,
  y: number,
  z: number,
  cx: number,
  cy: number,
  scale: number,
  yawDeg: number,
  pitchDeg: number
): SphereStrokePoint {
  const r = rotateByCamera(x, y, z, yawDeg, pitchDeg)
  const p = project(r.x, r.y, r.z, cx, cy, scale)
  const sinT = Math.sin(SPHERE_TILT)
  const cosT = Math.cos(SPHERE_TILT)
  const viewZ = r.y * sinT + r.z * cosT
  return {
    x: p.x,
    y: p.y,
    front: viewZ >= 0,
    vx: r.x,
    vy: r.y,
    vz: r.z,
    viewZ
  }
}

/** 在视空间 viewZ=0 处 3D 插值并重新投影，避免屏幕空间线性插值缩进 */
function silhouetteJoin(
  a: SphereStrokePoint,
  b: SphereStrokePoint,
  cx: number,
  cy: number,
  scale: number
): { x: number; y: number } {
  const dz = a.viewZ - b.viewZ
  const t = Math.abs(dz) < 1e-8 ? 0.5 : a.viewZ / dz
  const u = Math.min(1, Math.max(0, t))
  let x = a.vx + (b.vx - a.vx) * u
  let y = a.vy + (b.vy - a.vy) * u
  let z = a.vz + (b.vz - a.vz) * u
  const len = Math.hypot(x, y, z)
  if (len > 1e-8) {
    x /= len
    y /= len
    z /= len
  }
  const p = project(x, y, z, cx, cy, scale)
  return { x: p.x, y: p.y }
}

function strokeEntirePolyline(
  ctx: CanvasRenderingContext2D,
  points: SphereStrokePoint[]
): void {
  if (points.length < 2) return
  ctx.beginPath()
  ctx.moveTo(points[0]!.x, points[0]!.y)
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i]!.x, points[i]!.y)
  }
  ctx.stroke()
}

/** 只描正面段；交界用 3D 插值封口 */
function strokeFrontPolyline(
  ctx: CanvasRenderingContext2D,
  points: SphereStrokePoint[],
  cx: number,
  cy: number,
  scale: number
): void {
  if (points.length < 2) return
  let seg: Array<{ x: number; y: number }> = []

  const flush = (): void => {
    if (seg.length < 2) {
      seg = []
      return
    }
    ctx.beginPath()
    ctx.moveTo(seg[0]!.x, seg[0]!.y)
    for (let i = 1; i < seg.length; i++) {
      ctx.lineTo(seg[i]!.x, seg[i]!.y)
    }
    ctx.stroke()
    seg = []
  }

  for (let i = 0; i < points.length; i++) {
    const p = points[i]!
    const prev = i > 0 ? points[i - 1]! : null

    if (p.front) {
      if (seg.length === 0 && prev && !prev.front) {
        seg.push(silhouetteJoin(prev, p, cx, cy, scale))
      }
      seg.push({ x: p.x, y: p.y })
    } else if (seg.length > 0 && prev?.front) {
      seg.push(silhouetteJoin(prev, p, cx, cy, scale))
      flush()
    }
  }
  flush()
}

/** 视平面截线：连续球面轮廓，盖住网格在剪影处的接缝 */
function strokeSphereSilhouette(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  scale: number
): void {
  const sinT = Math.sin(SPHERE_TILT)
  const cosT = Math.cos(SPHERE_TILT)
  const steps = 160
  ctx.beginPath()
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2
    // tilt 后 viewZ=0 平面上的单位圆，反变换到 tilt 前相机空间再投影
    const vx = Math.cos(a)
    const vy = Math.sin(a) * cosT
    const vz = -Math.sin(a) * sinT
    const p = project(vx, vy, vz, cx, cy, scale)
    if (i === 0) ctx.moveTo(p.x, p.y)
    else ctx.lineTo(p.x, p.y)
  }
  ctx.stroke()
}

function drawSphere(): void {
  const canvas = canvasEl.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const w = canvas.width
  const h = canvas.height
  const cx = w / 2
  const cy = h / 2
  // 外圈限制在画布内（给四向按钮留边）
  const outerR = Math.min(w, h) * 0.42
  const radius = outerR / 0.92
  const camYaw = draft.yaw
  const camPitch = draft.pitch

  ctx.clearRect(0, 0, w, h)

  const light = themePreference.value === 'light'
  const disc = cssColor('--bg-elevated', light ? '#e8ebf0' : '#1a1d22')
  const emptyThumb = cssColor('--bg-hover', light ? '#dfe3ea' : '#2a3038')
  const gridDash = light ? 'rgba(60, 80, 110, 0.22)' : 'rgba(160, 180, 200, 0.2)'
  const gridFront = light ? 'rgba(50, 70, 100, 0.55)' : 'rgba(180, 200, 220, 0.55)'
  const gridSoft = light ? 'rgba(50, 70, 100, 0.35)' : 'rgba(180, 200, 220, 0.35)'
  const rim = light ? 'rgba(70, 90, 120, 0.55)' : 'rgba(200, 210, 220, 0.55)'
  const accent = cssColor('--accent', '#5b9dff')

  // 背景
  ctx.fillStyle = disc
  ctx.beginPath()
  ctx.arc(cx, cy, outerR, 0, Math.PI * 2)
  ctx.fill()

  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, outerR, 0, Math.PI * 2)
  ctx.clip()

  // 无预览图时用低精度球网，保证窗口先上屏；图到位后再画满
  const hiRes = !!previewImage.value
  const meridians = hiRes ? 12 : 8
  const parallels = hiRes ? 8 : 5
  const polylines: SphereStrokePoint[][] = []
  const meridianSteps = hiRes ? 96 : 24
  const parallelSteps = hiRes ? 128 : 36

  for (let i = 0; i < meridians; i++) {
    const yaw = (i / meridians) * Math.PI * 2
    const line: SphereStrokePoint[] = []
    for (let j = 0; j <= meridianSteps; j++) {
      const pitch = -Math.PI / 2 + (j / meridianSteps) * Math.PI
      const x = Math.cos(pitch) * Math.sin(yaw)
      const y = Math.sin(pitch)
      const z = Math.cos(pitch) * Math.cos(yaw)
      line.push(projectOriented(x, y, z, cx, cy, radius, camYaw, camPitch))
    }
    polylines.push(line)
  }

  for (let i = 1; i < parallels; i++) {
    const pitch = -Math.PI / 2 + (i / parallels) * Math.PI
    const line: SphereStrokePoint[] = []
    for (let j = 0; j <= parallelSteps; j++) {
      const yaw = (j / parallelSteps) * Math.PI * 2
      const cp = Math.cos(pitch)
      const x = cp * Math.sin(yaw)
      const y = Math.sin(pitch)
      const z = cp * Math.cos(yaw)
      line.push(projectOriented(x, y, z, cx, cy, radius, camYaw, camPitch))
    }
    // 纬线闭合
    if (line[0]) line.push({ ...line[0] })
    polylines.push(line)
  }

  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  // 整条曲线连续浅虚线（不按正背切断），先保证无断线
  ctx.lineWidth = Math.max(1, w / 420)
  ctx.strokeStyle = gridDash
  ctx.setLineDash([Math.max(3, w / 120), Math.max(4, w / 90)])
  for (const line of polylines) strokeEntirePolyline(ctx, line)

  // 正面实线叠在上面，交界按视深插值封口
  ctx.setLineDash([])
  ctx.lineWidth = Math.max(1.2, w / 380)
  ctx.strokeStyle = gridFront
  for (const line of polylines) strokeFrontPolyline(ctx, line, cx, cy, radius)

  // 连续剪影轮廓
  ctx.strokeStyle = gridSoft
  ctx.lineWidth = Math.max(1.1, w / 400)
  strokeSphereSilhouette(ctx, cx, cy, radius)
  // 中心参考图（保持正向，不随网格球旋转）
  const img = previewImage.value
  const thumbScale = 0.55 + draft.shotScale * 0.55
  const thumbR = radius * 0.2 * thumbScale
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, thumbR, 0, Math.PI * 2)
  ctx.clip()
  if (draft.presetId === 'dutch') {
    ctx.translate(cx, cy)
    ctx.rotate((-28 * Math.PI) / 180)
    ctx.translate(-cx, -cy)
  }
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

  // 鱼眼：边缘畸变示意环
  if (draft.presetId === 'fisheye') {
    ctx.strokeStyle = 'rgba(120, 200, 255, 0.45)'
    ctx.lineWidth = Math.max(2, w / 220)
    ctx.beginPath()
    ctx.arc(cx, cy, thumbR * 1.15, 0, Math.PI * 2)
    ctx.stroke()
  }

  // 机位点：三角在球面上随 yaw/pitch 移动，尖端朝向球心
  const pt = multiAngleSphericalPoint(camYaw, camPitch, 1)
  const cam = project(pt.x, pt.y, pt.z, cx, cy, radius)
  const camSize = Math.max(10, w / 42)
  const towardCenter = Math.atan2(cy - cam.y, cx - cam.x)
  ctx.save()
  ctx.translate(cam.x, cam.y)
  ctx.rotate(towardCenter + Math.PI / 2)
  ctx.fillStyle = accent
  ctx.strokeStyle = light ? '#ffffff' : '#dfe9ff'
  ctx.lineWidth = Math.max(1.5, w / 320)
  ctx.beginPath()
  ctx.moveTo(0, -camSize * 0.55)
  ctx.lineTo(camSize * 0.55, camSize * 0.4)
  ctx.lineTo(-camSize * 0.55, camSize * 0.4)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.restore()

  // 连线到中心
  ctx.strokeStyle = light ? 'rgba(47, 107, 255, 0.55)' : 'rgba(91, 157, 255, 0.55)'
  ctx.setLineDash([4, 4])
  ctx.beginPath()
  ctx.moveTo(cx, cy)
  ctx.lineTo(cam.x, cam.y)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.restore()

  // 外轮廓（裁剪外描边，保证不超出边界）
  ctx.strokeStyle = rim
  ctx.lineWidth = Math.max(1.5, w / 280)
  ctx.beginPath()
  ctx.arc(cx, cy, outerR, 0, Math.PI * 2)
  ctx.stroke()
}

function save(): void {
  const patch = multiAngleCameraToNodePatch(
    normalizeMultiAngleCamera(draft),
    panelDraft.value
  )
  emit('save', { ...patch, text: panelDraft.value })
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

watch(
  () => props.open,
  (open) => {
    if (open) {
      window.addEventListener('resize', onWinResize)
      void nextTick(() => {
        startPaneObserver()
        resizeCanvas()
        scheduleDraw()
      })
    } else {
      window.removeEventListener('resize', onWinResize)
      stopPaneObserver()
    }
  }
)

watch(themePreference, () => {
  if (props.open) scheduleDraw()
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onWinResize)
  stopPaneObserver()
  if (raf) cancelAnimationFrame(raf)
})
</script>

<style scoped>
.presets {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 14px;
  flex-shrink: 0;
}

.preset-btn {
  border: 1px solid var(--border, #3a4048);
  background: var(--bg-hover);
  color: var(--text, #e8eaed);
  border-radius: 6px;
  padding: 6px 12px;
  font-size: 12px;
  cursor: pointer;
}

.preset-btn:hover {
  background: var(--bg-hover);
}

.preset-btn.active {
  background: var(--bg-hover);
  border-color: #6a7480;
}

.editor-root {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  height: 100%;
  padding: 8px 12px;
  box-sizing: border-box;
}

.editor-footer {
  display: flex;
  justify-content: flex-end;
  flex-shrink: 0;
  padding-top: 10px;
}

.reset-btn {
  border: 1px solid var(--border, #3a4048);
  background: var(--bg-hover);
  color: var(--text, #e8eaed);
  border-radius: 6px;
  padding: 6px 14px;
  font-size: 12px;
  cursor: pointer;
}

.reset-btn:hover {
  background: var(--bg-hover);
}

.body {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
  gap: 18px;
  align-items: stretch;
}

.sphere-pane {
  position: relative;
  flex: 0 0 auto;
  aspect-ratio: 1 / 1;
  height: 100%;
  width: auto;
  max-width: 100%;
  align-self: stretch;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--graph-preview-bg);
  border: 1px solid var(--border, #333);
  border-radius: 10px;
  overflow: hidden;
  box-sizing: border-box;
}

.sphere-canvas {
  display: block;
  cursor: grab;
  touch-action: none;
}

.sphere-canvas:active {
  cursor: grabbing;
}

.orbit-btn {
  position: absolute;
  z-index: 2;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--text-muted, #9aa3ad);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  display: grid;
  place-items: center;
  padding: 0;
  /* 内球视半径≈外圈 45%，取二者中点：(0.45+1)/2 * 42% ≈ 30.5% */
  --ring: 30.5%;
}

.orbit-chevron {
  display: block;
  font-weight: 300;
  transform-origin: center;
}

.orbit-btn:hover {
  color: var(--text, #e8eaed);
  background: color-mix(in srgb, var(--bg-hover) 80%, transparent);
}

.orbit-btn.up {
  top: calc(50% - var(--ring));
  left: 50%;
  transform: translate(-50%, -50%);
}

.orbit-btn.up .orbit-chevron {
  transform: rotate(-90deg);
}

.orbit-btn.down {
  top: calc(50% + var(--ring));
  left: 50%;
  transform: translate(-50%, -50%);
}

.orbit-btn.down .orbit-chevron {
  transform: rotate(90deg);
}

.orbit-btn.left {
  left: calc(50% - var(--ring));
  top: 50%;
  transform: translate(-50%, -50%);
}

.orbit-btn.right {
  left: calc(50% + var(--ring));
  top: 50%;
  transform: translate(-50%, -50%);
}

.controls {
  display: flex;
  flex-direction: column;
  gap: 18px;
  flex: 1 1 0;
  min-width: 280px;
  overflow: auto;
  padding-top: 4px;
}

.slider-row {
  display: grid;
  grid-template-columns: 72px 1fr 52px;
  align-items: center;
  gap: 10px;
}

.slider-label {
  font-size: 12px;
  color: var(--text-muted, #9aa3ad);
}

.slider {
  width: 100%;
  accent-color: var(--accent);
}

.slider-value {
  font-size: 12px;
  text-align: right;
  color: var(--text, #e8eaed);
  font-variant-numeric: tabular-nums;
}

.prompt-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-top: 4px;
}

.toggle {
  width: 42px;
  height: 24px;
  border-radius: 999px;
  border: 1px solid #3a4048;
  background: var(--bg-hover);
  padding: 2px;
  cursor: pointer;
  position: relative;
}

.toggle.on {
  background: #3d6fe0;
  border-color: #5b8cff;
}

.toggle-knob {
  display: block;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #e8eaed;
  transition: transform 0.15s ease;
  transform: translateX(0);
}

.toggle.on .toggle-knob {
  transform: translateX(18px);
}

.prompt-preview {
  margin: 0;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--bg-elevated);
  border: 1px solid #333;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text, #e8eaed);
  white-space: pre-wrap;
}

.prompt-preview-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.panel-prompt {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.panel-textarea {
  width: 100%;
  resize: vertical;
  min-height: 64px;
  border-radius: 8px;
  border: 1px solid #333;
  background: var(--bg-elevated);
  color: var(--text, #e8eaed);
  font-size: 12px;
  line-height: 1.5;
  padding: 8px 10px;
  box-sizing: border-box;
  font-family: inherit;
}

.prompt-hint {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted, #9aa3ad);
}

@media (max-width: 800px) {
  .body {
    flex-direction: column;
  }

  .sphere-pane {
    width: min(100%, 360px);
    height: auto;
    max-height: none;
    align-self: center;
  }

  .controls {
    min-width: 0;
  }
}
</style>
