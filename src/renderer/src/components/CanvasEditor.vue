<template>
  <div class="canvas-wrap">
    <div class="canvas-toolbar">
      <span v-if="scopedActiveShot" class="shot-label">
        #{{ activeShotIndex + 1 }} · {{ scopedActiveShot.title }}
        <span class="resolution">{{ artboardW }}×{{ artboardH }}</span>
      </span>
      <span v-else class="shot-label muted">{{ t('canvas.noShot') }}</span>

      <span class="zoom-label">{{ zoomPercent }}%</span>

      <label class="grid-control">
        <input v-model="gridVisible" type="checkbox" />
        {{ t('canvas.toolbar.grid') }}
      </label>
      <label class="grid-control" :class="{ disabled: !gridVisible }">
        {{ t('canvas.toolbar.spacing') }}
        <input
          v-model.number="gridSize"
          type="range"
          min="10"
          max="200"
          step="5"
          :disabled="!gridVisible"
        />
        <span class="grid-value">{{ gridSize }}px</span>
      </label>

      <button
        type="button"
        class="layer-toggle"
        :class="{ active: layerPanelOpen }"
        @click="layerPanelOpen = !layerPanelOpen"
      >
        {{ t('canvas.toolbar.layers') }}
      </button>

      <div class="spacer" />
      <button type="button" @click="focusCenter" :disabled="!fabricCanvas">{{ t('canvas.focus') }}</button>
      <button type="button" @click="deleteSelected" :disabled="!fabricCanvas">{{ t('canvas.deleteSelected') }}</button>
      <span v-if="dropError" class="drop-error">{{ dropError }}</span>
    </div>

    <div ref="canvasBodyEl" class="canvas-body">
      <div
        ref="viewportEl"
        class="viewport"
        :class="{ panning: isPanning, 'drop-ready': isAssetDragOver }"
      >
        <canvas ref="gridEl" class="grid-layer" />
        <canvas ref="canvasEl" />
        <div v-if="!scopedActiveShot" class="overlay">{{ t('canvas.selectShot') }}</div>
      </div>

      <aside v-if="layerPanelOpen" class="layer-panel">
        <div class="layer-head">
          <span>{{ t('canvas.toolbar.layers') }}</span>
          <span class="layer-count">{{ layers.length }}</span>
        </div>
        <div v-if="!layers.length" class="layer-empty">{{ t('canvas.layersEmpty') }}</div>
        <ul v-else class="layer-list">
          <li
            v-for="(layer, index) in layers"
            :key="layer.key"
            class="layer-row"
            :class="{ active: layer.selected }"
            @click="selectLayerByIndex(index)"
          >
            <button
              type="button"
              class="icon-btn"
              :title="layer.visible ? t('canvas.layer.hide') : t('canvas.layer.show')"
              @click.stop="toggleLayerVisibleByIndex(index)"
            >
              {{ layer.visible ? '👁' : '—' }}
            </button>
            <button
              type="button"
              class="icon-btn"
              :class="{ on: layer.locked }"
              :title="layer.locked ? t('canvas.layer.unlock') : t('canvas.layer.lock')"
              @click.stop="toggleLayerLockByIndex(index)"
            >
              {{ layer.locked ? '🔒' : '🔓' }}
            </button>
            <span class="layer-name">{{ layer.label }}</span>
            <div class="layer-actions">
              <button
                type="button"
                class="icon-btn"
                :title="t('canvas.layer.up')"
                :disabled="index >= layers.length - 1"
                @click.stop="moveLayerByIndex(index, 1)"
              >
                ↑
              </button>
              <button
                type="button"
                class="icon-btn"
                :title="t('canvas.layer.down')"
                :disabled="index <= 0"
                @click.stop="moveLayerByIndex(index, -1)"
              >
                ↓
              </button>
              <button
                type="button"
                class="icon-btn danger"
                :title="t('canvas.layer.delete')"
                @click.stop="removeLayerByIndex(index)"
              >
                ×
              </button>
            </div>
          </li>
        </ul>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch, type ComputedRef } from 'vue'
import { Canvas, FabricImage, Point, Rect, type FabricObject } from 'fabric'
import type { AssetInfo, Shot } from '@shared/domain'
import { useScopedScriptShots } from '../composables/useScopedScriptShots'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useProjectStore } from '../stores/project'
import { useWorkspaceStore, STUDIO_ASSET_DRAG_MIME, STUDIO_ASSET_ID_DRAG_MIME } from '../stores/workspace'

const GRID_SIZE_KEY = 'studio.canvas.gridSize'
const GRID_VISIBLE_KEY = 'studio.canvas.gridVisible'
const ASSET_DROP_MIME = STUDIO_ASSET_DRAG_MIME
const ASSET_ID_DROP_MIME = STUDIO_ASSET_ID_DRAG_MIME

type StudioObject = FabricObject & {
  studioRole?: string
  studioAssetId?: string
  studioLocked?: boolean
}

interface LayerRow {
  key: string
  label: string
  visible: boolean
  locked: boolean
  selected: boolean
  object: unknown
}

const project = useProjectStore()
const workspace = useWorkspaceStore()
const { t } = useStudioI18n()
const scriptAssetIdRef = inject<ComputedRef<string | undefined>>(
  'scriptAssetId',
  computed(() => undefined)
)
const { visibleShots, activeShotIndex } = useScopedScriptShots(scriptAssetIdRef)

function shotInScope(shot: Shot | null | undefined): boolean {
  if (!shot) return false
  const scriptAssetId = scriptAssetIdRef?.value
  const owner = shot.scriptAssetId
  if (scriptAssetId) return owner === scriptAssetId
  return !owner
}

const scopedActiveShot = computed(() => {
  const shot = project.activeShot
  return shotInScope(shot) ? shot : null
})

const canvasEl = ref<HTMLCanvasElement | null>(null)
const gridEl = ref<HTMLCanvasElement | null>(null)
const viewportEl = ref<HTMLDivElement | null>(null)
const canvasBodyEl = ref<HTMLDivElement | null>(null)
const isPanning = ref(false)
const gridVisible = ref(localStorage.getItem(GRID_VISIBLE_KEY) !== '0')
const gridSize = ref(clampGridSize(Number(localStorage.getItem(GRID_SIZE_KEY) || 40)))
const layerPanelOpen = ref(true)
const zoomPercent = ref(100)
const layers = ref<LayerRow[]>([])
const dropError = ref('')
const isAssetDragOver = ref(false)

let fabricCanvas: Canvas | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null
let thumbTimer: ReturnType<typeof setTimeout> | null = null
let loadingShot = false
let frameRect: Rect | null = null
let spacePressed = false
let isDragging = false
let lastPosX = 0
let lastPosY = 0
let resizeObserver: ResizeObserver | null = null
let layerKeySeq = 0
const objectLayerKeys = new WeakMap<FabricObject, string>()
let dropListeners: Array<{
  el: HTMLElement
  onDragOver: (e: DragEvent) => void
  onDragEnter: (e: DragEvent) => void
  onDragLeave: (e: DragEvent) => void
  onDrop: (e: DragEvent) => void
}> = []
let lastAssetDropKey = ''
let artboardW = 1280
let artboardH = 720

const MIN_ZOOM = 0.05
const MAX_ZOOM = 8
const MIN_GRID_SCREEN = 6

function clampGridSize(n: number): number {
  if (!Number.isFinite(n)) return 40
  return Math.min(200, Math.max(10, Math.round(n / 5) * 5))
}

function isArtboard(obj: FabricObject): boolean {
  return (obj as StudioObject).studioRole === 'artboard'
}

function getUserObjects(): StudioObject[] {
  if (!fabricCanvas) return []
  return fabricCanvas.getObjects().filter((o) => !isArtboard(o)) as StudioObject[]
}

function layerKeyFor(obj: FabricObject): string {
  let key = objectLayerKeys.get(obj)
  if (!key) {
    key = `layer-${++layerKeySeq}`
    objectLayerKeys.set(obj, key)
  }
  return key
}

function asStudioObject(obj: FabricObject): StudioObject {
  return obj as StudioObject
}

function layerLabel(obj: FabricObject, index: number): string {
  const studio = asStudioObject(obj)
  if (obj.type === 'image' || obj instanceof FabricImage) {
    const assetId = studio.studioAssetId
    if (assetId) {
      const asset = project.assets.find((a) => a.id === assetId)
      if (asset?.name) return asset.name
    }
    return t('canvas.layer.image')
  }
  return t('canvas.layer.named', { n: index + 1 })
}

function refreshLayers(): void {
  if (!fabricCanvas) {
    layers.value = []
    return
  }
  const active = new Set(fabricCanvas.getActiveObjects())
  const objs = getUserObjects()
  layers.value = objs
    .slice()
    .reverse()
    .map((obj, index) => ({
      key: layerKeyFor(obj),
      label: layerLabel(obj, objs.length - 1 - index),
      visible: obj.visible !== false,
      locked: !!asStudioObject(obj).studioLocked,
      selected: active.has(obj),
      object: obj
    }))
}

function syncZoomPercent(): void {
  if (!fabricCanvas) {
    zoomPercent.value = 100
    return
  }
  zoomPercent.value = Math.round(fabricCanvas.getZoom() * 100)
}

function applyLayerLock(obj: FabricObject, locked: boolean): void {
  const studio = asStudioObject(obj)
  studio.studioLocked = locked
  obj.set({
    selectable: !locked,
    evented: !locked,
    hasControls: !locked,
    lockMovementX: locked,
    lockMovementY: locked,
    lockScalingX: locked,
    lockScalingY: locked,
    lockRotation: locked
  })
  fabricCanvas?.requestRenderAll()
}

function layerObjectByPanelIndex(panelIndex: number): FabricObject | null {
  const row = layers.value[panelIndex]
  if (!row?.object) return null
  return row.object as FabricObject
}

function selectLayerByIndex(panelIndex: number): void {
  const obj = layerObjectByPanelIndex(panelIndex)
  if (obj) selectLayer(obj)
}

function toggleLayerVisibleByIndex(panelIndex: number): void {
  const obj = layerObjectByPanelIndex(panelIndex)
  if (obj) toggleLayerVisible(obj)
}

function toggleLayerLockByIndex(panelIndex: number): void {
  const obj = layerObjectByPanelIndex(panelIndex)
  if (obj) toggleLayerLock(obj)
}

function moveLayerByIndex(panelIndex: number, direction: 1 | -1): void {
  const obj = layerObjectByPanelIndex(panelIndex)
  if (obj) moveLayer(obj, direction)
}

function removeLayerByIndex(panelIndex: number): void {
  const obj = layerObjectByPanelIndex(panelIndex)
  if (obj) removeLayer(obj)
}

function selectLayer(obj: FabricObject): void {
  if (!fabricCanvas || asStudioObject(obj).studioLocked) return
  fabricCanvas.setActiveObject(obj)
  fabricCanvas.requestRenderAll()
  refreshLayers()
}

function toggleLayerVisible(obj: FabricObject): void {
  obj.set('visible', obj.visible === false)
  fabricCanvas?.requestRenderAll()
  refreshLayers()
  scheduleSave()
}

function toggleLayerLock(obj: FabricObject): void {
  applyLayerLock(obj, !asStudioObject(obj).studioLocked)
  refreshLayers()
  scheduleSave()
}

function moveLayer(obj: FabricObject, direction: 1 | -1): void {
  if (!fabricCanvas) return
  const objs = getUserObjects()
  const index = objs.indexOf(obj)
  if (index < 0) return
  const targetIndex = index + direction
  if (targetIndex < 0 || targetIndex >= objs.length) return
  if (direction > 0) fabricCanvas.bringObjectForward(obj)
  else fabricCanvas.sendObjectBackwards(obj)
  ensureArtboard()
  fabricCanvas.requestRenderAll()
  refreshLayers()
  scheduleSave()
}

function removeLayer(obj: FabricObject): void {
  if (!fabricCanvas || isArtboard(obj)) return
  fabricCanvas.remove(obj)
  fabricCanvas.discardActiveObject()
  fabricCanvas.requestRenderAll()
  refreshLayers()
  scheduleSave()
}

async function navigateShot(delta: -1 | 1): Promise<void> {
  const shots = visibleShots.value
  if (shots.length < 2 || !scopedActiveShot.value) return
  const idx = shots.findIndex((s) => s.id === scopedActiveShot.value!.id)
  if (idx < 0) return
  const next = shots[idx + delta]
  if (!next) return
  await flushSave()
  await project.selectShot(next.id)
  workspace.focusShot()
}

onMounted(async () => {
  await nextTick()
  if (!canvasEl.value || !viewportEl.value) return

  artboardW = project.config?.resolution.w ?? 1280
  artboardH = project.config?.resolution.h ?? 720

  const { clientWidth, clientHeight } = viewportEl.value
  fabricCanvas = new Canvas(canvasEl.value, {
    width: clientWidth,
    height: clientHeight,
    backgroundColor: '#141618',
    preserveObjectStacking: true,
    selection: true,
    fireRightClick: true,
    stopContextMenu: true
  })

  ensureArtboard()
  bindCanvasInteractions()
  bindExternalDrop()
  focusCenter()
  redrawGrid()
  refreshLayers()

  resizeObserver = new ResizeObserver(() => {
    resizeToViewport()
  })
  resizeObserver.observe(viewportEl.value)

  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)

  if (scopedActiveShot.value) {
    await loadShotCanvas(scopedActiveShot.value.id)
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
  resizeObserver?.disconnect()
  resizeObserver = null
  if (saveTimer) clearTimeout(saveTimer)
  if (thumbTimer) clearTimeout(thumbTimer)
  void flushSave()
  unbindExternalDrop()
  fabricCanvas?.dispose()
  fabricCanvas = null
})

watch(
  () => scopedActiveShot.value?.id,
  async (id, prev) => {
    if (!id || id === prev) return
    await flushSave()
    await loadShotCanvas(id)
  }
)

watch(gridSize, (size) => {
  const next = clampGridSize(size)
  if (next !== size) {
    gridSize.value = next
    return
  }
  localStorage.setItem(GRID_SIZE_KEY, String(next))
  redrawGrid()
})

watch(gridVisible, (visible) => {
  localStorage.setItem(GRID_VISIBLE_KEY, visible ? '1' : '0')
  redrawGrid()
})

function getArtboardSize(): { w: number; h: number } {
  return {
    w: scopedActiveShot.value?.canvas.width || project.config?.resolution.w || 1280,
    h: scopedActiveShot.value?.canvas.height || project.config?.resolution.h || 720
  }
}

function ensureArtboard(): void {
  if (!fabricCanvas) return
  const { w, h } = getArtboardSize()
  artboardW = w
  artboardH = h

  const existing = fabricCanvas.getObjects().find((o) => {
    const role = (o as StudioObject).studioRole
    if (role === 'artboard') return true
    return (
      o.type === 'rect' &&
      !o.selectable &&
      !o.evented &&
      Math.abs((o.width ?? 0) - w) < 1 &&
      Math.abs((o.height ?? 0) - h) < 1
    )
  }) as Rect | undefined

  if (existing) {
    frameRect = existing
    ;(frameRect as StudioObject).studioRole = 'artboard'
    frameRect.set({
      left: 0,
      top: 0,
      width: w,
      height: h,
      fill: '#0b0c0d',
      stroke: '#3d8bfd88',
      strokeWidth: 2,
      selectable: false,
      evented: false
    })
    fabricCanvas.sendObjectToBack(frameRect)
    return
  }

  frameRect = new Rect({
    left: 0,
    top: 0,
    width: w,
    height: h,
    fill: '#0b0c0d',
    stroke: '#3d8bfd88',
    strokeWidth: 2,
    selectable: false,
    evented: false,
    hoverCursor: 'default'
  })
  ;(frameRect as StudioObject).studioRole = 'artboard'
  fabricCanvas.add(frameRect)
  fabricCanvas.sendObjectToBack(frameRect)
}

function resizeToViewport(): void {
  if (!fabricCanvas || !viewportEl.value) return
  const { clientWidth, clientHeight } = viewportEl.value
  if (clientWidth <= 0 || clientHeight <= 0) return
  fabricCanvas.setDimensions({ width: clientWidth, height: clientHeight })
  fabricCanvas.requestRenderAll()
  redrawGrid()
}

function focusCenter(): void {
  if (!fabricCanvas) return
  const vw = fabricCanvas.getWidth()
  const vh = fabricCanvas.getHeight()
  if (vw <= 0 || vh <= 0) return

  const zoom = Math.min(vw / artboardW, vh / artboardH, 1) * 0.9
  const panX = (vw - artboardW * zoom) / 2
  const panY = (vh - artboardH * zoom) / 2
  fabricCanvas.setViewportTransform([zoom, 0, 0, zoom, panX, panY])
  fabricCanvas.requestRenderAll()
  syncZoomPercent()
  redrawGrid()
}

function redrawGrid(): void {
  const layer = gridEl.value
  if (!layer || !fabricCanvas) return

  const width = fabricCanvas.getWidth()
  const height = fabricCanvas.getHeight()
  const dpr = window.devicePixelRatio || 1

  layer.width = Math.max(1, Math.floor(width * dpr))
  layer.height = Math.max(1, Math.floor(height * dpr))
  layer.style.width = `${width}px`
  layer.style.height = `${height}px`

  const ctx = layer.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)

  if (!gridVisible.value) return

  const zoom = fabricCanvas.getZoom()
  const vpt = fabricCanvas.viewportTransform
  if (!vpt) return

  let stepScene = gridSize.value
  let stepScreen = stepScene * zoom
  while (stepScreen < MIN_GRID_SCREEN) {
    stepScene *= 2
    stepScreen = stepScene * zoom
  }

  const majorStepScreen = stepScreen * 5
  const offsetX = ((vpt[4] % stepScreen) + stepScreen) % stepScreen
  const offsetY = ((vpt[5] % stepScreen) + stepScreen) % stepScreen
  const majorOffsetX = ((vpt[4] % majorStepScreen) + majorStepScreen) % majorStepScreen
  const majorOffsetY = ((vpt[5] % majorStepScreen) + majorStepScreen) % majorStepScreen

  const drawLines = (step: number, startX: number, startY: number, color: string): void => {
    ctx.beginPath()
    ctx.strokeStyle = color
    ctx.lineWidth = 1
    for (let x = startX; x <= width; x += step) {
      ctx.moveTo(x + 0.5, 0)
      ctx.lineTo(x + 0.5, height)
    }
    for (let y = startY; y <= height; y += step) {
      ctx.moveTo(0, y + 0.5)
      ctx.lineTo(width, y + 0.5)
    }
    ctx.stroke()
  }

  drawLines(stepScreen, offsetX, offsetY, 'rgba(255, 255, 255, 0.05)')
  drawLines(majorStepScreen, majorOffsetX, majorOffsetY, 'rgba(255, 255, 255, 0.12)')
}

function hasAssetDropData(e: DragEvent): boolean {
  if (workspace.draggingAsset) return true
  const types = e.dataTransfer ? Array.from(e.dataTransfer.types) : []
  return types.includes(ASSET_DROP_MIME) || types.includes(ASSET_ID_DROP_MIME)
}

function resolveDroppedAsset(e: DragEvent): AssetInfo | null {
  return workspace.resolveDraggedAsset(e)
}

function bindExternalDrop(): void {
  if (!fabricCanvas || !viewportEl.value) return
  unbindExternalDrop()

  const onDragOver = (e: DragEvent): void => {
    if (!hasAssetDropData(e)) return
    e.preventDefault()
    e.stopPropagation()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  }

  const onDragEnter = (e: DragEvent): void => {
    if (!hasAssetDropData(e)) return
    isAssetDragOver.value = true
  }

  const onDragLeave = (e: DragEvent): void => {
    if (!hasAssetDropData(e)) return
    const related = e.relatedTarget as Node | null
    if (related && viewportEl.value?.contains(related)) return
    isAssetDragOver.value = false
  }

  const onDrop = (e: DragEvent): void => {
    if (!hasAssetDropData(e)) return
    e.preventDefault()
    e.stopPropagation()
    isAssetDragOver.value = false
    void onDropAsset(e)
  }

  const elements = [
    canvasBodyEl.value,
    viewportEl.value,
    fabricCanvas.wrapperEl,
    fabricCanvas.lowerCanvasEl,
    fabricCanvas.upperCanvasEl
  ].filter(Boolean) as HTMLElement[]

  for (const el of elements) {
    el.addEventListener('dragover', onDragOver, true)
    el.addEventListener('dragenter', onDragEnter, true)
    el.addEventListener('dragleave', onDragLeave, true)
    el.addEventListener('drop', onDrop, true)
    dropListeners.push({ el, onDragOver, onDragEnter, onDragLeave, onDrop })
  }

  fabricCanvas.on('drop', (opt) => {
    const e = opt.e as DragEvent
    if (!hasAssetDropData(e)) return
    void onDropAsset(e)
  })
}

function unbindExternalDrop(): void {
  for (const { el, onDragOver, onDragEnter, onDragLeave, onDrop } of dropListeners) {
    el.removeEventListener('dragover', onDragOver, true)
    el.removeEventListener('dragenter', onDragEnter, true)
    el.removeEventListener('dragleave', onDragLeave, true)
    el.removeEventListener('drop', onDrop, true)
  }
  dropListeners = []
  isAssetDragOver.value = false
}

function bindCanvasInteractions(): void {
  if (!fabricCanvas) return

  fabricCanvas.on('mouse:wheel', (opt) => {
    const e = opt.e
    e.preventDefault()
    e.stopPropagation()
    let zoom = fabricCanvas!.getZoom() * 0.999 ** e.deltaY
    zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
    fabricCanvas!.zoomToPoint(new Point(e.offsetX, e.offsetY), zoom)
    syncZoomPercent()
    redrawGrid()
  })

  fabricCanvas.on('mouse:down', (opt) => {
    const e = opt.e as MouseEvent
    const shouldPan = e.button === 1 || (e.button === 0 && spacePressed)
    if (!shouldPan) return
    isDragging = true
    isPanning.value = true
    fabricCanvas!.selection = false
    fabricCanvas!.discardActiveObject()
    lastPosX = e.clientX
    lastPosY = e.clientY
  })

  fabricCanvas.on('mouse:move', (opt) => {
    if (!isDragging || !fabricCanvas) return
    const e = opt.e as MouseEvent
    const vpt = fabricCanvas.viewportTransform
    if (!vpt) return
    vpt[4] += e.clientX - lastPosX
    vpt[5] += e.clientY - lastPosY
    fabricCanvas.requestRenderAll()
    lastPosX = e.clientX
    lastPosY = e.clientY
    redrawGrid()
  })

  fabricCanvas.on('mouse:up', () => {
    if (!fabricCanvas) return
    if (isDragging) {
      fabricCanvas.setViewportTransform(fabricCanvas.viewportTransform!)
      redrawGrid()
    }
    isDragging = false
    isPanning.value = spacePressed
    fabricCanvas.selection = !spacePressed
  })

  fabricCanvas.on('object:modified', scheduleSave)
  fabricCanvas.on('object:added', () => {
    scheduleSave()
    refreshLayers()
  })
  fabricCanvas.on('object:removed', () => {
    scheduleSave()
    refreshLayers()
  })
  fabricCanvas.on('selection:created', refreshLayers)
  fabricCanvas.on('selection:updated', refreshLayers)
  fabricCanvas.on('selection:cleared', refreshLayers)
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

function onKeyDown(e: KeyboardEvent): void {
  if (isTypingTarget(e.target)) return

  if (e.code === 'Space' && !e.repeat) {
    e.preventDefault()
    spacePressed = true
    isPanning.value = true
    if (fabricCanvas) {
      fabricCanvas.selection = false
      fabricCanvas.defaultCursor = 'grab'
      fabricCanvas.setCursor('grab')
    }
  }

  if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault()
    focusCenter()
  }

  if (e.key === '[' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault()
    void navigateShot(-1)
  }

  if (e.key === ']' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault()
    void navigateShot(1)
  }

  if ((e.key === 'Delete' || e.key === 'Backspace') && fabricCanvas?.getActiveObjects().length) {
    e.preventDefault()
    deleteSelected()
  }
}

function onKeyUp(e: KeyboardEvent): void {
  if (e.code !== 'Space') return
  spacePressed = false
  if (!isDragging) {
    isPanning.value = false
    if (fabricCanvas) {
      fabricCanvas.selection = true
      fabricCanvas.defaultCursor = 'default'
      fabricCanvas.setCursor('default')
    }
  }
}

function scheduleSave(): void {
  if (loadingShot) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    void flushSave()
  }, 800)
}

function scheduleThumbnail(): void {
  if (loadingShot) return
  if (thumbTimer) clearTimeout(thumbTimer)
  thumbTimer = setTimeout(() => {
    void saveThumbnail()
  }, 1200)
}

async function flushSave(): Promise<void> {
  if (!fabricCanvas || !scopedActiveShot.value || loadingShot) return
  const json = (
    fabricCanvas as unknown as { toJSON: (propertiesToInclude?: string[]) => Record<string, unknown> }
  ).toJSON(['studioRole', 'studioAssetId', 'studioLocked'])
  const shot = { ...scopedActiveShot.value }
  shot.canvas = {
    fabricJson: json,
    width: artboardW,
    height: artboardH
  }
  shot.updatedAt = new Date().toISOString()
  await project.persistShot(shot)
  scheduleThumbnail()
}

async function saveThumbnail(): Promise<void> {
  if (!scopedActiveShot.value || !project.isOpen) return
  const dataUrl = await exportPng()
  if (!dataUrl) return
  try {
    const rel = await window.studio.saveCanvasPng(scopedActiveShot.value.id, dataUrl)
    const shot = project.shots.find((s) => s.id === scopedActiveShot.value!.id) ?? scopedActiveShot.value
    if (!shot) return
    const next = {
      ...shot,
      thumbnailPath: rel,
      updatedAt: new Date().toISOString()
    }
    await project.persistShot(next)
  } catch {
    /* 工程未打开或草稿暂存时忽略 */
  }
}

async function loadShotCanvas(shotId: string): Promise<void> {
  if (!fabricCanvas) return
  loadingShot = true
  try {
    const shot = project.shots.find((s) => s.id === shotId) ?? (await window.studio.getShot(shotId))
    if (!shot) return

    artboardW = shot.canvas.width || project.config?.resolution.w || 1280
    artboardH = shot.canvas.height || project.config?.resolution.h || 720
    resizeToViewport()

    if (shot.canvas.fabricJson) {
      await fabricCanvas.loadFromJSON(shot.canvas.fabricJson)
      ensureArtboard()
      getUserObjects().forEach((obj) => {
        if (obj.studioLocked) applyLayerLock(obj, true)
      })
    } else {
      fabricCanvas.clear()
      fabricCanvas.backgroundColor = '#141618'
      frameRect = null
      ensureArtboard()
    }
    fabricCanvas.requestRenderAll()
    focusCenter()
    refreshLayers()
  } finally {
    loadingShot = false
  }
}

async function onDropAsset(e: DragEvent): Promise<void> {
  const dropKey = `${e.timeStamp}:${e.clientX}:${e.clientY}`
  if (dropKey === lastAssetDropKey) return
  lastAssetDropKey = dropKey

  dropError.value = ''
  try {
    if (!fabricCanvas) {
      dropError.value = t('canvas.error.notReady')
      return
    }
    if (!scopedActiveShot.value) {
      dropError.value = t('canvas.error.needShot')
      return
    }
    const asset = resolveDroppedAsset(e)
    if (!asset) {
      dropError.value = t('canvas.error.dropFailed')
      return
    }
    if (asset.type !== 'image') {
      dropError.value = t('canvas.error.imageOnly')
      return
    }
    if (!asset.relativePath) {
      dropError.value = t('canvas.error.noFile')
      return
    }

    const url = await window.studio.getAssetFileUrl(asset.relativePath)
    const img = await FabricImage.fromURL(url, { crossOrigin: 'anonymous' })
    const maxW = artboardW * 0.6
    if (img.width && img.width > maxW) {
      img.scale(maxW / img.width)
    }

    const point = fabricCanvas.getScenePoint(e)
    img.set({
      left: point.x,
      top: point.y,
      originX: 'center',
      originY: 'center'
    })
    ;(img as StudioObject).studioAssetId = asset.id
    fabricCanvas.add(img)
    fabricCanvas.setActiveObject(img)
    fabricCanvas.requestRenderAll()
    refreshLayers()
    scheduleSave()
    workspace.setDraggingAsset(null)
  } catch (err) {
    dropError.value = err instanceof Error ? err.message : String(err)
  }
}

function deleteSelected(): void {
  if (!fabricCanvas) return
  const active = fabricCanvas.getActiveObjects()
  if (!active.length) return
  active.forEach((obj) => {
    if (isArtboard(obj)) return
    fabricCanvas!.remove(obj)
  })
  fabricCanvas.discardActiveObject()
  fabricCanvas.requestRenderAll()
  refreshLayers()
  scheduleSave()
}

async function exportPng(): Promise<string | null> {
  if (!fabricCanvas) return null
  const vpt = [...fabricCanvas.viewportTransform!] as [number, number, number, number, number, number]
  fabricCanvas.setViewportTransform([1, 0, 0, 1, 0, 0])
  const dataUrl = fabricCanvas.toDataURL({
    format: 'png',
    left: 0,
    top: 0,
    width: artboardW,
    height: artboardH,
    multiplier: 1,
    enableRetinaScaling: false
  })
  fabricCanvas.setViewportTransform(vpt)
  syncZoomPercent()
  redrawGrid()
  return dataUrl
}

defineExpose({ exportPng, flushSave, focusCenter })
</script>

<style scoped>
.canvas-wrap {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: #0e1012;
}

.canvas-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-panel);
  color: var(--text-muted);
  flex-shrink: 0;
  flex-wrap: wrap;
}

.shot-label {
  font-size: 12px;
  color: var(--text);
  font-weight: 600;
  white-space: nowrap;
}

.shot-label.muted {
  font-weight: 400;
  color: var(--text-muted);
}

.resolution {
  margin-left: 6px;
  font-family: var(--mono);
  font-size: 11px;
  font-weight: 400;
  color: var(--text-muted);
}

.zoom-label {
  min-width: 42px;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--text);
}

.grid-control {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  white-space: nowrap;
}

.grid-control.disabled {
  opacity: 0.45;
}

.grid-control input[type='range'] {
  width: 90px;
  accent-color: var(--accent);
}

.grid-value {
  min-width: 38px;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--text);
}

.layer-toggle.active {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.spacer {
  flex: 1;
}

.canvas-body {
  flex: 1;
  display: flex;
  min-height: 0;
}

.viewport {
  flex: 1;
  position: relative;
  overflow: hidden;
  min-width: 0;
  background:
    linear-gradient(45deg, #121416 25%, transparent 25%) -8px 0 / 16px 16px,
    linear-gradient(-45deg, #121416 25%, transparent 25%) -8px 0 / 16px 16px,
    linear-gradient(45deg, transparent 75%, #121416 75%) 0 0 / 16px 16px,
    linear-gradient(-45deg, transparent 75%, #121416 75%) 0 0 / 16px 16px,
    #181a1d;
}

.viewport.panning {
  cursor: grab;
}

.viewport.panning:active {
  cursor: grabbing;
}

.viewport.drop-ready {
  outline: 2px dashed var(--accent);
  outline-offset: -2px;
}

.grid-layer {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 3;
}

.viewport :deep(.canvas-container) {
  position: absolute !important;
  inset: 0;
  z-index: 2;
}

.overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  pointer-events: none;
  z-index: 4;
}

.layer-panel {
  width: 220px;
  flex-shrink: 0;
  border-left: 1px solid var(--border);
  background: var(--bg-panel);
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.layer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  font-size: 12px;
  color: var(--text-muted);
  border-bottom: 1px solid var(--border);
}

.layer-count {
  font-family: var(--mono);
  font-size: 11px;
}

.layer-empty {
  padding: 12px 10px;
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.5;
}

.layer-list {
  list-style: none;
  margin: 0;
  padding: 4px 0;
  overflow-y: auto;
  flex: 1;
}

.layer-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 6px 4px 8px;
  font-size: 11px;
  cursor: pointer;
  border-left: 2px solid transparent;
}

.layer-row:hover {
  background: var(--bg-elevated);
}

.layer-row.active {
  background: rgba(61, 139, 253, 0.12);
  border-left-color: var(--accent);
}

.layer-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
}

.layer-actions {
  display: flex;
  gap: 1px;
  opacity: 0;
}

.layer-row:hover .layer-actions,
.layer-row.active .layer-actions {
  opacity: 1;
}

.icon-btn {
  padding: 0 4px;
  min-width: 22px;
  height: 22px;
  border: none;
  background: transparent;
  font-size: 11px;
  line-height: 1;
  cursor: pointer;
  border-radius: 3px;
}

.icon-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.08);
}

.icon-btn:disabled {
  opacity: 0.35;
  cursor: default;
}

.icon-btn.on {
  color: var(--warning);
}

.icon-btn.danger:hover:not(:disabled) {
  color: var(--danger);
}

.drop-error {
  font-size: 11px;
  color: var(--danger);
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
