<template>
  <StudioFloatingWindow
    :open="open"
    :title="windowTitle"
    :z-index="1200"
    :default-width="1180"
    :default-height="760"
    :min-width="900"
    :min-height="600"
    body-class="pad-none"
    @close="onClose"
  >
    <div class="portrait-root">
      <!-- 左：工具轨 -->
      <aside class="tool-rail">
        <button
          v-for="group in TOOL_GROUPS"
          :key="group.id"
          type="button"
          class="rail-item"
          :class="{ active: activeGroup === group.id, disabled: !groupEnabled(group) }"
          :title="groupTitle(group)"
          @click="selectGroup(group.id)"
        >
          <span class="rail-ico" aria-hidden="true">{{ group.icon }}</span>
          <span class="rail-label">{{ t(`graph.portrait.groups.${group.labelKey}`) }}</span>
        </button>
      </aside>

      <!-- 中：画布 -->
      <section ref="stageEl" class="stage">
        <div v-if="sourceLoading" class="stage-empty">{{ t('graph.editor.loadingSource') }}</div>
        <div v-else-if="!sourceUrl" class="stage-empty">{{ t('graph.portrait.noSource') }}</div>
        <div v-else class="canvas-wrap" :style="canvasWrapStyle">
          <div class="canvas-stack">
            <img
              ref="imageEl"
              class="stage-img"
              :src="visibleUrl"
              alt=""
              draggable="false"
              @pointerdown="onPointerDown"
              @pointermove="onPointerMove"
              @pointerup="onPointerUp"
              @pointercancel="onPointerUp"
              @pointerleave="onPointerUp"
              @contextmenu.prevent
            />
            <img
              v-if="compareMode === 'split' && sourceUrl"
              class="stage-img split-original"
              :src="sourceUrl"
              :style="splitClipStyle"
              alt=""
              draggable="false"
            />
            <canvas ref="overlayEl" class="overlay" />
            <svg
              v-if="anchorMode"
              class="anchor-layer"
              viewBox="0 0 1 1"
              preserveAspectRatio="none"
            >
              <g v-for="(point, index) in anchorPoints" :key="index">
                <circle :cx="point.x" :cy="point.y" r="0.012" class="anchor-dot" />
                <text :x="point.x + 0.02" :y="point.y - 0.02" class="anchor-text">
                  {{ index + 1 }}
                </text>
              </g>
            </svg>
            <div
              v-if="compareMode === 'split'"
              class="split-handle"
              :style="{ left: `${splitRatio * 100}%` }"
              @pointerdown.stop="onSplitDown"
            >
              <span class="split-grip" aria-hidden="true">⇔</span>
            </div>
            <span v-if="compareMode === 'split'" class="split-tag left">{{
              t('graph.portrait.before')
            }}</span>
            <span v-if="compareMode === 'split'" class="split-tag right">{{
              t('graph.portrait.after')
            }}</span>
          </div>
          <span v-if="previewBusy" class="stage-badge">{{
            t('graph.portrait.previewUpdating')
          }}</span>
          <span v-if="previewError" class="stage-badge error">{{ previewError }}</span>
        </div>

        <div class="stage-bar">
          <button
            type="button"
            class="bar-btn"
            :class="{ active: compareMode === 'hold' }"
            @click="toggleHold"
          >
            {{ t('graph.portrait.compareHold') }}
          </button>
          <button
            type="button"
            class="bar-btn"
            :class="{ active: compareMode === 'split' }"
            @click="toggleSplit"
          >
            {{ t('graph.portrait.compareSplit') }}
          </button>
          <span class="bar-sep" />
          <button
            type="button"
            class="bar-btn"
            :class="{ active: anchorMode || !!face }"
            :disabled="!sourceUrl"
            @click="toggleAnchorMode"
          >
            {{ t('graph.portrait.anchorStart') }}
          </button>
          <button v-if="anchorMode" type="button" class="bar-btn" @click="undoAnchor">
            {{ t('graph.portrait.anchorUndo') }}
          </button>
          <button v-if="anchorMode" type="button" class="bar-btn" @click="clearAnchors">
            {{ t('graph.portrait.anchorClear') }}
          </button>
          <span v-if="anchorMode" class="bar-info accent">
            {{ t('graph.portrait.anchorProgress', { done: anchorPoints.length, total: 5 }) }}
          </span>
          <span class="bar-sep" />
          <span class="bar-info">{{ changedCount }}</span>
        </div>
      </section>

      <!-- 右：参数面板 -->
      <aside class="panel">
        <div class="panel-head">
          <span class="panel-title">{{ t(`graph.portrait.groups.${activeGroupLabelKey}`) }}</span>
          <button type="button" class="ghost-btn" @click="resetGroup">
            {{ t('graph.portrait.resetGroup') }}
          </button>
          <button type="button" class="ghost-btn" @click="resetAll">
            {{ t('graph.portrait.reset') }}
          </button>
        </div>

        <div class="panel-body">
          <!-- 笔刷设置（该组有笔刷工具时） -->
          <div v-if="activeGroupMeta?.brush" class="brush-box">
            <label class="row">
              <span class="row-label">{{ t('graph.portrait.brushSize') }}</span>
              <input v-model.number="brush.size" type="range" min="2" max="60" step="1" />
              <span class="row-value">{{ brush.size }}</span>
            </label>
            <label class="row">
              <span class="row-label">{{ t('graph.portrait.brushHardness') }}</span>
              <input v-model.number="brush.hardness" type="range" min="0" max="100" step="1" />
              <span class="row-value">{{ brush.hardness }}</span>
            </label>
            <label class="row">
              <span class="row-label">{{ t('graph.portrait.brushStrength') }}</span>
              <input v-model.number="brush.strength" type="range" min="0" max="100" step="1" />
              <span class="row-value">{{ brush.strength }}</span>
            </label>
            <label v-if="activeGroup === 'liquify'" class="row">
              <span class="row-label">{{ t('graph.portrait.liquifyMode') }}</span>
              <select v-model="brush.liquifyMode">
                <option v-for="mode in LIQUIFY_MODES" :key="mode" :value="mode">
                  {{ t(`graph.portrait.liquifyModes.${mode}`) }}
                </option>
              </select>
            </label>
            <div class="brush-actions">
              <span class="brush-count">{{ strokeCount }}</span>
              <button type="button" class="ghost-btn" @click="clearStrokes">
                {{ t('graph.portrait.brushClear') }}
              </button>
            </div>
          </div>

          <!-- 预设 -->
          <p v-if="!face && activeGroupMeta?.needs?.includes('face')" class="hint warn">
            {{ t('graph.portrait.faceMissing') }} · {{ t('graph.portrait.anchorStart') }}
          </p>
          <template v-if="activeGroup === 'preset'">
            <div class="preset-grid">
              <button
                v-for="preset in PORTRAIT_PRESETS"
                :key="preset.id"
                type="button"
                class="preset-btn"
                @click="applyPreset(preset.id)"
              >
                {{ t(`graph.portrait.presets.${preset.labelKey}`) }}
              </button>
            </div>
            <div class="preset-io">
              <button type="button" class="ghost-btn" @click="exportPreset">
                {{ t('graph.portrait.exportPreset') }}
              </button>
              <button type="button" class="ghost-btn" @click="pickPresetFile">
                {{ t('graph.portrait.importPreset') }}
              </button>
              <input
                ref="presetFileEl"
                class="hidden-input"
                type="file"
                accept="application/json,.json"
                @change="onPresetFile"
              />
            </div>
            <p v-if="presetMessage" class="hint">{{ presetMessage }}</p>
          </template>

          <!-- AI 增强 -->
          <template v-else-if="activeGroup === 'aiErase'">
            <p class="hint">{{ t('graph.portrait.aiHint') }}</p>
            <p class="hint">{{ t('graph.portrait.aiEraseMaskHint') }}</p>
            <textarea
              v-model="aiPrompt"
              class="ai-prompt"
              rows="2"
              :placeholder="t('graph.portrait.aiPromptPlaceholder')"
            />
            <div class="ai-actions">
              <button
                v-for="tool in AI_TOOLS"
                :key="tool.id"
                type="button"
                class="ghost-btn"
                :disabled="aiRunning || !sourceUrl"
                @click="runAi(tool.id)"
              >
                {{ t(`graph.portrait.${tool.labelKey}`) }}
              </button>
            </div>
            <p v-if="aiRunning" class="hint accent">{{ t('graph.portrait.aiRunning') }}</p>
            <p v-if="aiError" class="hint error">{{ aiError }}</p>
            <div v-if="layers.length" class="ai-history">
              <span class="row-label">{{ t('graph.portrait.aiHistory') }}</span>
              <button
                type="button"
                class="version-btn"
                :class="{ active: !baseLayerId }"
                @click="emit('ai-version', '')"
              >
                {{ t('graph.portrait.aiBaseOriginal') }}
              </button>
              <button
                v-for="layer in layers"
                :key="layer.id"
                type="button"
                class="version-btn"
                :class="{ active: baseLayerId === layer.id }"
                :title="layer.prompt"
                @click="emit('ai-version', layer.id)"
              >
                {{ t(`graph.portrait.${AI_TOOL_LABEL_KEYS[layer.tool] ?? 'aiUpscale'}`) }}
              </button>
            </div>
          </template>

          <!-- 证照 / 参数 -->
          <template v-else>
            <label v-for="spec in groupSpecs" :key="spec.key" class="row">
              <span class="row-label">{{ t(`graph.portrait.fields.${spec.labelKey}`) }}</span>
              <template v-if="spec.kind === 'number'">
                <input
                  v-model.number="numericDraft[spec.key]"
                  type="range"
                  :min="spec.min"
                  :max="spec.max"
                  :step="spec.step"
                  @change="pushHistory()"
                />
                <span class="row-value">{{ numericDraft[spec.key] }}</span>
              </template>
              <template v-else-if="spec.kind === 'enum'">
                <select :value="stringDraft[spec.key]" @change="onEnumChange(spec.key, $event)">
                  <option v-for="option in spec.options" :key="option.id" :value="option.id">
                    {{ t(`graph.portrait.options.${option.labelKey}`) }}
                  </option>
                </select>
              </template>
              <template v-else-if="spec.kind === 'color'">
                <input
                  :value="stringDraft[spec.key]"
                  type="color"
                  @input="onColorInput(spec.key, $event)"
                  @change="pushHistory()"
                />
              </template>
              <template v-else>
                <input
                  :checked="booleanDraft[spec.key]"
                  type="checkbox"
                  @change="onBoolChange(spec.key, $event)"
                />
              </template>
            </label>
            <p v-if="activeGroup === 'export'" class="hint">{{ t('graph.portrait.exportHint') }}</p>
          </template>
        </div>
      </aside>
    </div>
  </StudioFloatingWindow>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  PORTRAIT_LIQUIFY_MODES,
  PORTRAIT_PRESETS,
  PORTRAIT_TOOL_GROUPS,
  applyPortraitPreset,
  changedPortraitParamCount,
  defaultPortraitRetouch,
  exportPortraitPreset,
  importPortraitPreset,
  normalizePortraitRetouch,
  normalizePortraitStrokes,
  portraitSpecsForGroup,
  PORTRAIT_FACES_VERSION,
  PORTRAIT_MANUAL_HASH,
  manual5ToCanonical68,
  portraitFaceBoxFromLandmarks,
  type PortraitAiLayer,
  type PortraitAiTool,
  type PortraitBrushStroke,
  type PortraitFaceAnalysis,
  type PortraitFacesPayload,
  type PortraitLiquifyMode,
  type PortraitParamSpec,
  type PortraitRetouchState,
  type PortraitToolGroup,
  type PortraitToolGroupId
} from '@shared/graph'
import { strokeMask } from '@shared/media/portrait/mask'
import { bakePortraitRetouch } from '../features/graph/model/portraitBake'
import { diveEditorHistory } from '../features/graph/ui/diveEditorHistory'
import { useStudioI18n } from '../composables/useStudioI18n'
import StudioFloatingWindow from './StudioFloatingWindow.vue'

const props = withDefaults(
  defineProps<{
    open: boolean
    hostId?: string
    nodeId?: string
    setup?: Partial<PortraitRetouchState> | null
    strokes?: PortraitBrushStroke[]
    face?: PortraitFaceAnalysis | null
    layers?: PortraitAiLayer[]
    baseLayerId?: string
    sourceUrl?: string
    sourceLoading?: boolean
    generateModel?: string
    generateProviderInstanceId?: string
    aiRunning?: boolean
    aiError?: string
  }>(),
  {
    hostId: '',
    nodeId: '',
    setup: null,
    strokes: () => [],
    face: null,
    layers: () => [],
    baseLayerId: '',
    sourceUrl: '',
    sourceLoading: false,
    generateModel: '',
    generateProviderInstanceId: '',
    aiRunning: false,
    aiError: ''
  }
)

/** 编辑器写回宿主的载荷：精修参数 + 笔画 +（手动标定人脸时）关键点分析 */
interface PortraitEditorPayload {
  portraitRetouch: PortraitRetouchState
  portraitStrokes: PortraitBrushStroke[]
  portraitFaces?: PortraitFacesPayload
}

const emit = defineEmits<{
  close: []
  update: [payload: PortraitEditorPayload]
  save: [payload: PortraitEditorPayload]
  ai: [
    payload: {
      tool: PortraitAiTool
      prompt: string
      model: string
      providerInstanceId: string
      sourceDataUrl: string
      maskDataUrl?: string
    }
  ]
  'ai-version': [layerId: string]
}>()

const { t } = useStudioI18n()

const TOOL_GROUPS = PORTRAIT_TOOL_GROUPS
const LIQUIFY_MODES = PORTRAIT_LIQUIFY_MODES
const PREVIEW_MAX_EDGE = 1280
const HISTORY_LIMIT = 40

const AI_TOOLS: Array<{ id: PortraitAiTool; labelKey: string }> = [
  { id: 'erase', labelKey: 'aiErase' },
  { id: 'background', labelKey: 'aiBackground' },
  { id: 'makeup', labelKey: 'aiMakeup' },
  { id: 'upscale', labelKey: 'aiUpscale' }
]
const AI_TOOL_LABEL_KEYS: Record<string, string> = {
  erase: 'aiErase',
  background: 'aiBackground',
  makeup: 'aiMakeup',
  upscale: 'aiUpscale',
  expand: 'aiUpscale',
  skinTexture: 'aiMakeup'
}

const windowTitle = computed(() => t('graph.portrait.appMark'))

// ── 草稿状态 ───────────────────────────────────────────────────
const draft = reactive<PortraitRetouchState>(normalizePortraitRetouch())
const draftStrokes = ref<PortraitBrushStroke[]>([])
const activeGroup = ref<PortraitToolGroupId>('skin')
const presetFileEl = ref<HTMLInputElement | null>(null)
const presetMessage = ref('')
const aiPrompt = ref('')

const imageEl = ref<HTMLImageElement | null>(null)
const overlayEl = ref<HTMLCanvasElement | null>(null)
const stageEl = ref<HTMLElement | null>(null)
const previewUrl = ref('')
const previewBusy = ref(false)
const previewError = ref('')
const compareMode = ref<'off' | 'hold' | 'split'>('off')
const splitRatio = ref(0.5)
/** 手动 5 点锚点：没有关键点模型 / 未检出人脸时，用户自己标一次即可用全部五官与妆容工具 */
const anchorMode = ref(false)
const anchorPoints = ref<Array<{ x: number; y: number }>>([])

const brush = reactive({
  size: 18,
  hardness: 60,
  strength: 50,
  liquifyMode: 'push' as PortraitLiquifyMode
})

let previewTimer: ReturnType<typeof setTimeout> | null = null
let previewToken = 0
let hydrating = false
let painting = false
let currentStroke: PortraitBrushStroke | null = null
let lastPoint: { x: number; y: number } | null = null
let unregisterHistory: (() => void) | null = null
let previewObjectUrlToRevoke: string | null = null

const history = ref<Array<{ state: PortraitRetouchState; strokes: PortraitBrushStroke[] }>>([])
const historyIndex = ref(-1)

const activeGroupMeta = computed<PortraitToolGroup | undefined>(() =>
  TOOL_GROUPS.find((group) => group.id === activeGroup.value)
)
const activeGroupLabelKey = computed(() => activeGroupMeta.value?.labelKey ?? 'skin')
const groupSpecs = computed<PortraitParamSpec[]>(() => portraitSpecsForGroup(activeGroup.value))
const numericDraft = draft as unknown as Record<string, number>
const stringDraft = draft as unknown as Record<string, string>
const booleanDraft = draft as unknown as Record<string, boolean>
const changedCount = computed(() => changedPortraitParamCount(draft))
const strokeCount = computed(() => draftStrokes.value.length)
const layers = computed(() => props.layers ?? [])
const aiRunning = computed(() => props.aiRunning === true)
const aiError = computed(() => props.aiError ?? '')

/** 对比模式下的可见图：hold 时显示原图，split 时用裁剪遮罩分区 */
const visibleUrl = computed(() => {
  if (compareMode.value === 'hold' && holdingOriginal.value) return props.sourceUrl || ''
  return previewUrl.value || props.sourceUrl || ''
})
const holdingOriginal = ref(false)

const canvasWrapStyle = computed(() => ({ '--split': `${splitRatio.value * 100}%` }))
const splitClipStyle = computed(() => ({
  clipPath: `inset(0 ${Math.round((1 - splitRatio.value) * 100)}% 0 0)`
}))

const dirty = computed(() => {
  const before = normalizePortraitRetouch(props.setup)
  const after = normalizePortraitRetouch(draft)
  if (JSON.stringify(before) !== JSON.stringify(after)) return true
  return (
    JSON.stringify(normalizePortraitStrokes(props.strokes)) !== JSON.stringify(draftStrokes.value)
  )
})

// ── 预览 ───────────────────────────────────────────────────────

function schedulePreview(delay = 120): void {
  if (!props.open || hydrating) return
  if (previewTimer) clearTimeout(previewTimer)
  previewTimer = setTimeout(() => {
    previewTimer = null
    void renderPreview()
  }, delay)
}

async function renderPreview(): Promise<void> {
  const source = props.sourceUrl?.trim()
  if (!source) {
    previewUrl.value = ''
    return
  }
  const token = ++previewToken
  previewBusy.value = true
  previewError.value = ''
  try {
    const result = await bakePortraitRetouch({
      sourceDataUrl: source,
      state: normalizePortraitRetouch(draft),
      strokes: draftStrokes.value,
      face: props.face,
      seed: 1,
      maxEdge: PREVIEW_MAX_EDGE
    })
    if (token !== previewToken || !props.open) return
    if (previewObjectUrlToRevoke) URL.revokeObjectURL(previewObjectUrlToRevoke)
    previewObjectUrlToRevoke = null
    previewUrl.value = result.dataUrl
  } catch (err) {
    if (token !== previewToken) return
    previewError.value = err instanceof Error ? err.message : String(err)
  } finally {
    if (token === previewToken) previewBusy.value = false
  }
}

// ── 撤销 / 重做（草稿级，关窗即弃；整段编辑在关闭时折叠成主图一条命令） ──

function snapshot(): { state: PortraitRetouchState; strokes: PortraitBrushStroke[] } {
  return {
    state: { ...normalizePortraitRetouch(draft) },
    strokes: draftStrokes.value.map((stroke) => ({ ...stroke, points: [...stroke.points] }))
  }
}

function pushHistory(): void {
  if (hydrating) return
  const entry = snapshot()
  const current = history.value[historyIndex.value]
  if (current && JSON.stringify(current) === JSON.stringify(entry)) return
  history.value = [...history.value.slice(0, historyIndex.value + 1), entry].slice(-HISTORY_LIMIT)
  historyIndex.value = history.value.length - 1
  emitPreview()
}

function applySnapshot(entry: {
  state: PortraitRetouchState
  strokes: PortraitBrushStroke[]
}): void {
  hydrating = true
  Object.assign(draft, normalizePortraitRetouch(entry.state))
  draftStrokes.value = entry.strokes.map((stroke) => ({ ...stroke, points: [...stroke.points] }))
  void nextTick(() => {
    hydrating = false
    schedulePreview(0)
    emitPreview()
  })
}

function undo(): void {
  if (historyIndex.value <= 0) return
  historyIndex.value -= 1
  applySnapshot(history.value[historyIndex.value]!)
}

function redo(): void {
  if (historyIndex.value >= history.value.length - 1) return
  historyIndex.value += 1
  applySnapshot(history.value[historyIndex.value]!)
}

// ── 参数编辑 ───────────────────────────────────────────────────

function onEnumChange(key: string, event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  ;(draft as unknown as Record<string, string>)[key] = value
  pushHistory()
}

function onColorInput(key: string, event: Event): void {
  ;(draft as unknown as Record<string, string>)[key] = (event.target as HTMLInputElement).value
  schedulePreview()
}

function onBoolChange(key: string, event: Event): void {
  ;(draft as unknown as Record<string, boolean>)[key] = (event.target as HTMLInputElement).checked
  pushHistory()
}

function resetGroup(): void {
  const defaults = defaultPortraitRetouch()
  for (const spec of groupSpecs.value) {
    ;(draft as unknown as Record<string, unknown>)[spec.key] = (
      defaults as unknown as Record<string, unknown>
    )[spec.key]
  }
  pushHistory()
}

function resetAll(): void {
  Object.assign(draft, defaultPortraitRetouch())
  draftStrokes.value = []
  pushHistory()
}

function applyPreset(presetId: string): void {
  Object.assign(draft, applyPortraitPreset(presetId, draft))
  pushHistory()
}

function groupEnabled(group: PortraitToolGroup): boolean {
  if (!group.needs?.length) return true
  if (group.needs.includes('face') && !props.face) return false
  return true
}

function groupTitle(group: PortraitToolGroup): string {
  const label = t(`graph.portrait.groups.${group.labelKey}`)
  return groupEnabled(group) ? label : `${label} · ${t('graph.portrait.faceMissing')}`
}

function selectGroup(id: PortraitToolGroupId): void {
  activeGroup.value = id
  presetMessage.value = ''
}

// ── 笔刷 ───────────────────────────────────────────────────────

function activeBrushTool(): PortraitBrushStroke['tool'] | null {
  switch (activeGroup.value) {
    case 'heal':
      return 'heal'
    case 'liquify':
      return 'liquify'
    case 'skin':
      return 'smooth'
    case 'background':
      return 'bgMask'
    default:
      return null
  }
}

function normalizedPoint(event: PointerEvent): { x: number; y: number } | null {
  const el = imageEl.value
  if (!el) return null
  const rect = el.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null
  return {
    x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
    y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))
  }
}

function onPointerDown(event: PointerEvent): void {
  if (anchorMode.value) {
    const point = normalizedPoint(event)
    if (point) {
      anchorPoints.value = [...anchorPoints.value, point]
      if (anchorPoints.value.length >= 5) commitAnchors()
    }
    return
  }
  const tool = activeBrushTool()
  if (!tool || !groupEnabled(activeGroupMeta.value ?? TOOL_GROUPS[0]!)) return
  const point = normalizedPoint(event)
  if (!point) return
  ;(event.target as HTMLElement).setPointerCapture?.(event.pointerId)
  painting = true
  lastPoint = point
  currentStroke = {
    id: `stroke-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    tool,
    ...(tool === 'liquify' ? { mode: brush.liquifyMode } : {}),
    size: brush.size / 100,
    hardness: brush.hardness,
    strength: brush.strength,
    points: [{ x: point.x, y: point.y, ...(tool === 'liquify' ? { dx: 0, dy: 0 } : {}) }]
  }
  drawOverlay()
}

function onPointerMove(event: PointerEvent): void {
  if (!painting || !currentStroke) {
    drawCursor(event)
    return
  }
  const point = normalizedPoint(event)
  if (!point || !lastPoint) return
  const dx = currentStroke.tool === 'liquify' ? point.x - lastPoint.x : undefined
  const dy = currentStroke.tool === 'liquify' ? point.y - lastPoint.y : undefined
  currentStroke.points.push({
    x: point.x,
    y: point.y,
    ...(dx !== undefined && dy !== undefined ? { dx, dy } : {})
  })
  lastPoint = point
  drawOverlay()
}

function onPointerUp(): void {
  if (!painting) return
  painting = false
  lastPoint = null
  const stroke = currentStroke
  currentStroke = null
  if (!stroke) return
  draftStrokes.value = normalizePortraitStrokes([...draftStrokes.value, stroke])
  pushHistory()
  schedulePreview(0)
}

function clearStrokes(): void {
  draftStrokes.value = []
  pushHistory()
  schedulePreview(0)
}

/** 叠加层：把笔画（修复 / 局部磨皮 / 背景蒙版）与液化位移画出来，让用户看得见改了什么 */
function drawOverlay(): void {
  const canvas = overlayEl.value
  const img = imageEl.value
  if (!canvas || !img) return
  const rect = img.getBoundingClientRect()
  canvas.width = Math.max(1, Math.round(rect.width))
  canvas.height = Math.max(1, Math.round(rect.height))
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  const strokes = currentStroke ? [...draftStrokes.value, currentStroke] : draftStrokes.value
  for (const stroke of strokes) {
    const radius = Math.max(2, (stroke.size * Math.min(canvas.width, canvas.height)) / 2)
    const color =
      stroke.tool === 'liquify'
        ? 'rgba(96, 165, 250, 0.55)'
        : stroke.tool === 'bgMask'
          ? 'rgba(244, 114, 182, 0.45)'
          : stroke.tool === 'smooth'
            ? 'rgba(52, 211, 153, 0.45)'
            : 'rgba(251, 191, 36, 0.5)'
    ctx.strokeStyle = color
    ctx.fillStyle = color
    ctx.lineWidth = Math.max(2, radius * 2)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    if (stroke.points.length === 1) {
      const point = stroke.points[0]!
      ctx.beginPath()
      ctx.arc(point.x * canvas.width, point.y * canvas.height, Math.max(1, radius), 0, Math.PI * 2)
      ctx.fill()
      continue
    }
    ctx.beginPath()
    stroke.points.forEach((point, index) => {
      const x = point.x * canvas.width
      const y = point.y * canvas.height
      if (index === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.stroke()
  }
}

function drawCursor(event: PointerEvent): void {
  const point = normalizedPoint(event)
  if (!point || !activeBrushTool()) return
  // 只在悬停时画光标：与笔画共用同一块画布，重绘成本可忽略（预览分辨率）
  drawOverlay()
  const canvas = overlayEl.value
  const ctx = canvas?.getContext('2d')
  if (!canvas || !ctx) return
  const radius = Math.max(2, (brush.size / 100) * Math.min(canvas.width, canvas.height) * 0.5)
  ctx.beginPath()
  ctx.strokeStyle = 'rgba(255,255,255,0.75)'
  ctx.lineWidth = 1
  ctx.arc(point.x * canvas.width, point.y * canvas.height, radius, 0, Math.PI * 2)
  ctx.stroke()
}

// ── 对比 ───────────────────────────────────────────────────────

function toggleHold(): void {
  compareMode.value = compareMode.value === 'hold' ? 'off' : 'hold'
  holdingOriginal.value = compareMode.value === 'hold'
}

function toggleSplit(): void {
  compareMode.value = compareMode.value === 'split' ? 'off' : 'split'
  splitRatio.value = 0.5
}

function onSplitDown(event: PointerEvent): void {
  const move = (ev: PointerEvent): void => {
    const wrap = imageEl.value?.getBoundingClientRect()
    if (!wrap || wrap.width <= 0) return
    splitRatio.value = Math.min(0.98, Math.max(0.02, (ev.clientX - wrap.left) / wrap.width))
  }
  const up = (): void => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  move(event)
}

// ── 预设导入导出 ───────────────────────────────────────────────

function exportPreset(): void {
  const text = exportPortraitPreset(
    `${t('graph.portrait.appMark')}-${new Date().toISOString().slice(0, 10)}`,
    normalizePortraitRetouch(draft),
    draftStrokes.value
  )
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'portrait-preset.json'
  link.click()
  URL.revokeObjectURL(url)
}

function pickPresetFile(): void {
  presetFileEl.value?.click()
}

async function onPresetFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  const text = await file.text()
  const parsed = importPortraitPreset(text)
  if (!parsed.ok) {
    presetMessage.value =
      parsed.reason === 'invalid-json'
        ? t('graph.portrait.presetImportInvalid')
        : parsed.reason === 'not-preset'
          ? t('graph.portrait.presetImportNotPreset')
          : t('graph.portrait.presetImportVersion')
    return
  }
  Object.assign(draft, parsed.state)
  draftStrokes.value = parsed.strokes
  presetMessage.value = t('graph.portrait.presetImported', { name: parsed.name })
  pushHistory()
}

// ── AI 增强 ────────────────────────────────────────────────────

/** 用「修复」组的笔画烧出黑白蒙版（智能消除的输入） */
function buildMaskDataUrl(): string | undefined {
  const strokes = draftStrokes.value.filter((stroke) => stroke.tool === 'heal')
  if (!strokes.length) return undefined
  const img = imageEl.value
  const width = img?.naturalWidth || 1024
  const height = img?.naturalHeight || 1024
  const mask = strokeMask(width, height, strokes)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return undefined
  const imageData = ctx.createImageData(width, height)
  for (let i = 0; i < mask.length; i++) {
    const value = mask[i]
    imageData.data[i * 4] = value
    imageData.data[i * 4 + 1] = value
    imageData.data[i * 4 + 2] = value
    imageData.data[i * 4 + 3] = 255
  }
  ctx.putImageData(imageData, 0, 0)
  return canvas.toDataURL('image/png')
}

function runAi(tool: PortraitAiTool): void {
  if (aiRunning.value) return
  const source = previewUrl.value || props.sourceUrl || ''
  emit('ai', {
    tool,
    prompt: aiPrompt.value.trim(),
    model: props.generateModel ?? '',
    providerInstanceId: props.generateProviderInstanceId ?? '',
    sourceDataUrl: source,
    ...(tool === 'erase' ? { maskDataUrl: buildMaskDataUrl() } : {})
  })
}

// ── 手动 5 点锚点 ──────────────────────────────────────────────
// 顺序固定：左眼中心 → 右眼中心 → 鼻尖 → 左嘴角 → 右嘴角。
// 有了这 5 点就能拟合出 canonical-68，五官 / 妆容 / 牙齿 / 证件照全部可用，
// 因此在「没有关键点模型」或「模型没检出脸」时这是保住功能的兜底路径。

const face = computed(() => props.face ?? null)

function toggleAnchorMode(): void {
  anchorMode.value = !anchorMode.value
  if (anchorMode.value) anchorPoints.value = []
}

function undoAnchor(): void {
  anchorPoints.value = anchorPoints.value.slice(0, -1)
}

function clearAnchors(): void {
  anchorPoints.value = []
}

function commitAnchors(): void {
  const [leftEye, rightEye, noseTip, leftMouth, rightMouth] = anchorPoints.value
  if (!leftEye || !rightEye || !noseTip || !leftMouth || !rightMouth) return
  const landmarks = manual5ToCanonical68({
    leftEye: [leftEye.x, leftEye.y],
    rightEye: [rightEye.x, rightEye.y],
    noseTip: [noseTip.x, noseTip.y],
    leftMouth: [leftMouth.x, leftMouth.y],
    rightMouth: [rightMouth.x, rightMouth.y]
  })
  if (!landmarks) {
    anchorPoints.value = []
    return
  }
  const analysis: PortraitFaceAnalysis = {
    schema: 'manual5',
    landmarks,
    box: portraitFaceBoxFromLandmarks(landmarks),
    score: 1,
    modelId: 'manual'
  }
  const payload: PortraitFacesPayload = {
    v: PORTRAIT_FACES_VERSION,
    sourceHash: PORTRAIT_MANUAL_HASH,
    faces: [analysis],
    picked: 0,
    at: new Date().toISOString()
  }
  anchorMode.value = false
  anchorPoints.value = []
  emit('update', { ...buildPayload(), portraitFaces: payload })
}

// 组装给宿主的写回载荷（预览与保存共用）
function buildPayload(): PortraitEditorPayload {
  return {
    portraitRetouch: normalizePortraitRetouch(draft),
    portraitStrokes: draftStrokes.value
  }
}

function emitPreview(): void {
  if (!props.open || hydrating) return
  emit('update', buildPayload())
}

function onClose(): void {
  if (dirty.value) emit('save', buildPayload())
  emit('close')
}

// ── 生命周期 ───────────────────────────────────────────────────

watch(
  () => [props.open, props.nodeId],
  () => {
    if (!props.open) return
    hydrating = true
    Object.assign(draft, normalizePortraitRetouch(props.setup))
    draftStrokes.value = normalizePortraitStrokes(props.strokes)
    history.value = [snapshot()]
    historyIndex.value = 0
    previewError.value = ''
    void nextTick(() => {
      hydrating = false
      schedulePreview(0)
    })
  },
  { immediate: true }
)

watch(
  draft,
  () => {
    if (hydrating) return
    schedulePreview()
  },
  { deep: true }
)

watch(
  () => props.sourceUrl,
  () => schedulePreview(0)
)

onMounted(() => {
  unregisterHistory = diveEditorHistory.register({
    canUndo: () => historyIndex.value > 0,
    canRedo: () => historyIndex.value < history.value.length - 1,
    undo,
    redo
  })
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
})

onBeforeUnmount(() => {
  unregisterHistory?.()
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
  if (previewObjectUrlToRevoke) URL.revokeObjectURL(previewObjectUrlToRevoke)
  if (previewTimer) clearTimeout(previewTimer)
})

function onKeyDown(event: KeyboardEvent): void {
  if (event.code === 'Space' && compareMode.value === 'hold') holdingOriginal.value = true
}

function onKeyUp(event: KeyboardEvent): void {
  if (event.code === 'Space') holdingOriginal.value = false
}
</script>

<style scoped>
.portrait-root {
  display: grid;
  grid-template-columns: 84px minmax(0, 1fr) 320px;
  height: 100%;
  min-height: 0;
  background: var(--bg-panel);
  color: var(--text);
}

.tool-rail {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 4px;
  overflow-y: auto;
  border-right: 1px solid var(--border);
  background: var(--bg-elevated);
}

.rail-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 6px 2px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
  cursor: pointer;
}

.rail-item:hover {
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  color: var(--text);
}

.rail-item.active {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  color: var(--accent);
}

.rail-item.disabled {
  opacity: 0.45;
}

.rail-ico {
  font-size: 16px;
  line-height: 1;
}

.stage {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: #14161a;
}

.stage-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  font-size: 13px;
}

.canvas-wrap {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.canvas-stack {
  position: relative;
  display: inline-flex;
  max-width: 100%;
  max-height: 100%;
}

.canvas-stack .stage-img {
  display: block;
}

.split-original {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.stage-img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  touch-action: none;
  user-select: none;
}

.overlay {
  position: absolute;
  pointer-events: none;
}

.anchor-layer {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.anchor-dot {
  fill: rgba(250, 204, 21, 0.9);
  stroke: rgba(0, 0, 0, 0.6);
  stroke-width: 0.002;
}

.anchor-text {
  fill: #fff;
  font-size: 0.03px;
}

.split-handle {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--accent);
  cursor: ew-resize;
}

.split-grip {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  padding: 2px 6px;
  border-radius: 10px;
  background: var(--accent);
  color: #fff;
  font-size: 11px;
}

.split-tag {
  position: absolute;
  top: 8px;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 11px;
}

.split-tag.left {
  left: 8px;
}

.split-tag.right {
  right: 8px;
}

.stage-badge {
  position: absolute;
  bottom: 10px;
  left: 10px;
  padding: 3px 8px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: 11px;
}

.stage-badge.error {
  background: rgba(190, 40, 40, 0.8);
}

.stage-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-top: 1px solid var(--border);
  background: var(--bg-elevated);
  font-size: 11px;
  color: var(--text-muted);
}

.bar-btn {
  padding: 3px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
  cursor: pointer;
}

.bar-btn.active {
  border-color: var(--accent);
  color: var(--accent);
}

.bar-sep {
  width: 1px;
  height: 14px;
  background: var(--border);
}

.bar-info {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-left: 1px solid var(--border);
  background: var(--bg-elevated);
}

.panel-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
}

.panel-title {
  flex: 1;
  font-size: 12px;
  font-weight: 600;
}

.panel-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px 10px 16px;
}

.ghost-btn {
  padding: 3px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
  cursor: pointer;
}

.ghost-btn:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
}

.ghost-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.row {
  display: grid;
  grid-template-columns: 88px minmax(0, 1fr) 34px;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  font-size: 11px;
}

.row-label {
  color: var(--text-muted);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.row-value {
  text-align: right;
  color: var(--text-muted);
}

.row input[type='range'] {
  width: 100%;
}

.row select,
.ai-prompt {
  width: 100%;
  padding: 3px 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-panel);
  color: var(--text);
  font-size: 11px;
}

.brush-box {
  margin-bottom: 10px;
  padding-bottom: 8px;
  border-bottom: 1px dashed var(--border);
}

.brush-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.brush-count {
  flex: 1;
  color: var(--text-muted);
  font-size: 11px;
}

.preset-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
  margin-bottom: 10px;
}

.preset-btn {
  padding: 6px 4px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-panel);
  color: var(--text);
  font-size: 11px;
  cursor: pointer;
}

.preset-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.preset-io {
  display: flex;
  gap: 6px;
}

.hidden-input {
  display: none;
}

.hint {
  margin: 8px 0 0;
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.5;
}

.hint.accent {
  color: var(--accent);
}

.hint.error {
  color: #e57373;
}

.ai-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
  margin-top: 8px;
}

.ai-prompt {
  margin-top: 8px;
  resize: vertical;
}

.ai-history {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
}

.version-btn {
  padding: 2px 6px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
  cursor: pointer;
}

.version-btn.active {
  border-color: var(--accent);
  color: var(--accent);
}
</style>
