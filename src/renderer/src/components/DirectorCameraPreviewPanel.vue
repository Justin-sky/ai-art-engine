<template>
  <div
    v-show="visible"
    ref="panelEl"
    class="camera-preview-panel"
    :style="panelStyle"
  >
    <div class="preview-head" @pointerdown="onHeadPointerDown">
      <span class="preview-title">{{ t('director.stage.cameraPreview') }}</span>
      <span v-if="cameras.length" class="preview-count">{{ cameras.length }}</span>
      <button
        type="button"
        class="preview-detach"
        :title="t('director.stage.cameraPreviewPopout')"
        :aria-label="t('director.stage.cameraPreviewPopout')"
        @pointerdown.stop
        @click.stop="detachToWindow"
      >
        ⤢
      </button>
      <button
        type="button"
        class="preview-close"
        :title="t('director.stage.cameraPreviewClose')"
        :aria-label="t('director.stage.cameraPreviewClose')"
        @pointerdown.stop
        @click.stop="scene.setCameraPreviewOpen(false)"
      >
        ×
      </button>
    </div>
    <div class="preview-body" :style="gridStyle">
      <template v-if="cameras.length">
        <div
          v-for="cam in cameras"
          :key="cam.id"
          class="preview-cell"
        >
          <canvas
            class="preview-canvas"
            :width="canvasW"
            :height="canvasH"
            :ref="(el) => bindCanvas(cam.id, el)"
          />
          <span class="preview-label">{{ cam.name }}</span>
        </div>
      </template>
      <p v-else class="preview-empty">{{ t('director.stage.cameraPreviewEmpty') }}</p>
    </div>
    <div
      class="resize-handle"
      :title="t('director.stage.cameraPreviewResize')"
      @pointerdown.stop="onResizePointerDown"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref, watch } from 'vue'
import { directorAspectRatioValue } from '@shared/domain'
import { useStudioI18n } from '../composables/useStudioI18n'
import { directorStageSceneKey } from '../features/director/stageSceneKey'

const POPOUT_WINDOW_NAME = `aiart-camera-preview-${Math.random().toString(36).slice(2)}`
const POPOUT_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  html,body { margin:0; height:100%; background:#141516; color:#e8eaed; font-family:system-ui,"Segoe UI",sans-serif; }
  #root { display:flex; flex-direction:column; height:100%; box-sizing:border-box; }
  #titlebar { -webkit-app-region:drag; app-region:drag; display:flex; align-items:center; justify-content:space-between; min-height:40px; padding:0 12px; padding-right:140px; box-sizing:border-box; border-bottom:1px solid #333; user-select:none; flex-shrink:0; }
  #title { font-size:13px; font-weight:600; }
  #dock-btn { -webkit-app-region:no-drag; app-region:no-drag; border:1px solid #444; background:#1c1e21; color:#e8eaed; font-size:12px; padding:4px 10px; border-radius:5px; cursor:pointer; }
  #dock-btn:hover { border-color:#5b9bd5; background:#232527; }
  #body { flex:1; min-height:0; display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:10px; padding:12px; overflow:auto; align-content:start; }
  .cell { position:relative; min-width:0; border-radius:8px; overflow:hidden; border:1px solid #333; background:#000; aspect-ratio:16/9; }
  canvas { display:block; width:100%; height:100%; background:#000; }
  .label { position:absolute; left:0; right:0; bottom:0; padding:3px 8px; font-size:12px; color:#fff; background:rgba(0,0,0,.55); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .empty { margin:0; padding:24px 12px; font-size:13px; color:#99a2ad; text-align:center; }
</style>
</head>
<body>
<div id="root">
  <div id="titlebar">
    <span id="title"></span>
    <button id="dock-btn" type="button"></button>
  </div>
  <div id="body"></div>
</div>
</body>
</html>`

const { t } = useStudioI18n()
const scene = inject(directorStageSceneKey)!

const panelEl = ref<HTMLDivElement | null>(null)
const pos = ref({ x: -1, y: -1 })
const size = ref({ w: 0, h: 0 })

const cameras = computed(() =>
  scene.cameraPreviewIds.value
    .map((id) => {
      const row = scene.hierarchyRows.value.find((r) => r.id === id)
      return { id, name: row?.name ?? id }
    })
    .filter((cam) => cam.name)
)

const previewAspect = computed(() => {
  const ratio = scene.aspectRatio.value
  if (ratio === 'auto') return 16 / 9
  return directorAspectRatioValue(ratio, 16, 9)
})

const canvasW = 320
const canvasH = computed(() => Math.max(1, Math.round(canvasW / Math.max(0.01, previewAspect.value))))

/** 主窗口内固定尺寸（240×160），内容超出在面板内滚动 */
const PANEL_WIDTH = 240
const PANEL_HEIGHT = 160

/** 多相机时按数量定列数，全部缩放到面板内，不滚动 */
const gridColumns = computed(() => {
  const count = cameras.value.length
  if (count <= 1) return 1
  if (count <= 4) return 2
  if (count <= 9) return 3
  return Math.ceil(Math.sqrt(count))
})

const gridStyle = computed(() => ({
  gridTemplateColumns: `repeat(${gridColumns.value}, minmax(0, 1fr))`
}))

const visible = computed(
  () => scene.cameraPreviewOpen.value && !scene.cameraPreviewDetached.value
)

const panelStyle = computed(() => {
  const style: Record<string, string> = {
    width: `${size.value.w > 0 ? size.value.w : PANEL_WIDTH}px`,
    height: `${size.value.h > 0 ? size.value.h : PANEL_HEIGHT}px`
  }
  if (pos.value.x < 0 || pos.value.y < 0) {
    style.left = '12px'
    style.top = '12px'
  } else {
    style.left = `${pos.value.x}px`
    style.top = `${pos.value.y}px`
  }
  return style
})

const registered = new Map<string, HTMLCanvasElement>()
const popupCells = new Map<string, { canvas: HTMLCanvasElement; label: HTMLElement }>()
let popupWindow: Window | null = null
let popupPollTimer: ReturnType<typeof setInterval> | null = null
let framePumpTimer: ReturnType<typeof setInterval> | null = null
let popupSyncTimer: ReturnType<typeof setTimeout> | null = null

function bindCanvas(cameraId: string, el: unknown): void {
  const prev = registered.get(cameraId)
  if (prev) {
    scene.unregisterCameraPreviewCanvas(cameraId, prev)
    registered.delete(cameraId)
  }
  if (el instanceof HTMLCanvasElement) {
    registered.set(cameraId, el)
    scene.registerCameraPreviewCanvas(cameraId, el)
  }
}

function detachToWindow(): void {
  if (popupWindow && !popupWindow.closed) {
    popupWindow.focus()
    return
  }
  // about:blank 继承本窗口同源：由主窗口直接构建弹窗 DOM，并逐帧把预览画到弹窗 canvas 上
  const popup = window.open('about:blank', POPOUT_WINDOW_NAME, 'width=760,height=560')
  if (!popup) return
  popupWindow = popup
  buildPopupDocument(popup)
  scene.setCameraPreviewDetached(true)
  scene.setCameraPreviewOpen(false)
  startPopupWatch()
  startFramePump()
  syncPopupContent()
}

function buildPopupDocument(popup: Window): void {
  const doc = popup.document
  doc.open()
  doc.write(POPOUT_HTML)
  doc.close()
  doc.title = t('director.stage.cameraPreview')
  const titleEl = doc.getElementById('title')
  if (titleEl) titleEl.textContent = t('director.stage.cameraPreview')
  const dockBtn = doc.getElementById('dock-btn')
  if (dockBtn) {
    dockBtn.textContent = t('director.stage.cameraPreviewDockBack')
    dockBtn.onclick = () => {
      if (popupWindow && !popupWindow.closed) popupWindow.close()
      popupWindow = null
      stopPopupWatch()
      stopFramePump()
      popupCells.clear()
      reattachFromPopout()
    }
  }
  popup.addEventListener('load', () => syncPopupContent())
}

function syncPopupContent(): void {
  const popup = popupWindow
  if (!popup || popup.closed) return
  const doc = popup.document
  const bodyEl = doc.getElementById('body')
  if (!bodyEl) {
    if (!popupSyncTimer) {
      popupSyncTimer = setTimeout(() => {
        popupSyncTimer = null
        syncPopupContent()
      }, 80)
    }
    return
  }

  const wanted = new Set<string>()
  for (const cam of cameras.value) {
    wanted.add(cam.id)
    let cell = popupCells.get(cam.id)
    if (!cell || !cell.canvas.isConnected) {
      const el = doc.createElement('div')
      el.className = 'cell'
      el.style.aspectRatio = `${previewAspect.value} / 1`
      const canvas = doc.createElement('canvas')
      canvas.id = `preview-${cam.id}`
      canvas.width = canvasW
      canvas.height = canvasH.value
      const label = doc.createElement('span')
      label.className = 'label'
      el.appendChild(canvas)
      el.appendChild(label)
      bodyEl.appendChild(el)
      cell = { canvas, label }
      popupCells.set(cam.id, cell)
    }
    cell.label.textContent = cam.name
    paintPopupCell(cam.id)
  }

  for (const [id, cell] of [...popupCells]) {
    if (wanted.has(id)) continue
    cell.canvas.parentElement?.remove()
    popupCells.delete(id)
  }

  const empty = doc.getElementById('empty-hint')
  if (!wanted.size) {
    if (!empty) {
      const hint = doc.createElement('p')
      hint.id = 'empty-hint'
      hint.className = 'empty'
      hint.textContent = t('director.stage.cameraPreviewEmpty')
      bodyEl.appendChild(hint)
    }
  } else if (empty) {
    empty.remove()
  }
}

/** 把主窗口预览画布内容直接画到弹窗 canvas（同源跨文档 drawImage，确定性最高） */
function paintPopupCell(cameraId: string): void {
  const src = registered.get(cameraId)
  const cell = popupCells.get(cameraId)
  if (!src || !cell || !cell.canvas.isConnected) return
  const ctx = cell.canvas.getContext('2d')
  if (!ctx) return
  if (src.width > 0 && src.height > 0) {
    ctx.drawImage(src, 0, 0, cell.canvas.width, cell.canvas.height)
  }
}

function startFramePump(): void {
  if (framePumpTimer) return
  framePumpTimer = setInterval(() => {
    const popup = popupWindow
    if (!popup || popup.closed) return
    for (const cam of cameras.value) {
      paintPopupCell(cam.id)
    }
  }, 80)
}

function stopFramePump(): void {
  if (framePumpTimer) {
    clearInterval(framePumpTimer)
    framePumpTimer = null
  }
}

function startPopupWatch(): void {
  if (popupPollTimer) return
  popupPollTimer = setInterval(() => {
    if (!popupWindow || !popupWindow.closed) return
    popupWindow = null
    stopPopupWatch()
    reattachFromPopout()
  }, 400)
}

function stopPopupWatch(): void {
  if (popupPollTimer) {
    clearInterval(popupPollTimer)
    popupPollTimer = null
  }
}

function reattachFromPopout(): void {
  scene.setCameraPreviewDetached(false)
  scene.setCameraPreviewOpen(true)
  stopFramePump()
  if (popupSyncTimer) {
    clearTimeout(popupSyncTimer)
    popupSyncTimer = null
  }
}

watch(
  () => scene.cameraPreviewIds.value.join('\0'),
  () => {
    if (scene.cameraPreviewDetached.value && popupWindow && !popupWindow.closed) {
      syncPopupContent()
    }
  },
  { flush: 'post' }
)

let dragStart: { x: number; y: number; left: number; top: number } | null = null

function onHeadPointerDown(event: PointerEvent): void {
  const panel = panelEl.value
  if (!panel) return
  const target = event.target as HTMLElement | null
  if (target?.closest('.preview-detach, .preview-close')) return
  const rect = panel.getBoundingClientRect()
  dragStart = {
    x: event.clientX,
    y: event.clientY,
    left: rect.left,
    top: rect.top
  }
  panel.setPointerCapture(event.pointerId)
  const onMove = (ev: PointerEvent): void => {
    if (!dragStart) return
    if (isOutsideWindow(ev)) {
      dragStart = null
      panel.removeEventListener('pointermove', onMove)
      panel.removeEventListener('pointerup', onUp)
      panel.removeEventListener('pointercancel', onUp)
      detachToWindow()
      return
    }
    const parent = panel.parentElement
    const maxX = parent ? parent.clientWidth - panel.offsetWidth : 0
    const maxY = parent ? parent.clientHeight - panel.offsetHeight : 0
    const parentRect = parent?.getBoundingClientRect()
    pos.value = {
      x: Math.max(
        0,
        Math.min(maxX, dragStart.left - (parentRect?.left ?? 0) + (ev.clientX - dragStart.x))
      ),
      y: Math.max(
        0,
        Math.min(maxY, dragStart.top - (parentRect?.top ?? 0) + (ev.clientY - dragStart.y))
      )
    }
  }
  const onUp = (ev: PointerEvent): void => {
    dragStart = null
    panel.removeEventListener('pointermove', onMove)
    panel.removeEventListener('pointerup', onUp)
    panel.removeEventListener('pointercancel', onUp)
    if (isOutsideWindow(ev)) {
      detachToWindow()
    }
  }
  panel.addEventListener('pointermove', onMove)
  panel.addEventListener('pointerup', onUp)
  panel.addEventListener('pointercancel', onUp)
}

function isOutsideWindow(ev: PointerEvent): boolean {
  return (
    ev.clientX <= 0 ||
    ev.clientY <= 0 ||
    ev.clientX >= window.innerWidth - 1 ||
    ev.clientY >= window.innerHeight - 1
  )
}

function onResizePointerDown(event: PointerEvent): void {
  const panel = panelEl.value
  if (!panel) return
  const rect = panel.getBoundingClientRect()
  const start = {
    x: event.clientX,
    y: event.clientY,
    w: rect.width,
    h: rect.height
  }
  panel.setPointerCapture(event.pointerId)
  const onMove = (ev: PointerEvent): void => {
    const parent = panel.parentElement
    const maxW = parent ? parent.clientWidth - 24 : 640
    const maxH = parent ? parent.clientHeight - 48 : 480
    size.value = {
      w: Math.max(PANEL_WIDTH, Math.min(maxW, start.w + (ev.clientX - start.x))),
      h: Math.max(PANEL_HEIGHT, Math.min(maxH, start.h + (ev.clientY - start.y)))
    }
  }
  const onUp = (): void => {
    panel.removeEventListener('pointermove', onMove)
    panel.removeEventListener('pointerup', onUp)
    panel.removeEventListener('pointercancel', onUp)
  }
  panel.addEventListener('pointermove', onMove)
  panel.addEventListener('pointerup', onUp)
  panel.addEventListener('pointercancel', onUp)
}

onBeforeUnmount(() => {
  stopPopupWatch()
  stopFramePump()
  if (popupSyncTimer) {
    clearTimeout(popupSyncTimer)
    popupSyncTimer = null
  }
  if (popupWindow && !popupWindow.closed) {
    popupWindow.close()
  }
  popupWindow = null
  popupCells.clear()
  for (const [id, canvas] of registered) {
    scene.unregisterCameraPreviewCanvas(id, canvas)
  }
  registered.clear()
})
</script>

<style scoped>
.camera-preview-panel {
  position: absolute;
  z-index: 30;
  display: flex;
  flex-direction: column;
  max-height: calc(100% - 24px);
  background: color-mix(in srgb, var(--bg-panel) 96%, transparent);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(8px);
  user-select: none;
  overflow: hidden;
}

.preview-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  cursor: move;
  touch-action: none;
  flex-shrink: 0;
}

.preview-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
}

.preview-count {
  font-size: 11px;
  color: var(--text-muted);
  background: var(--bg-hover);
  border-radius: 10px;
  padding: 1px 7px;
}

.preview-detach,
.preview-close {
  margin-left: auto;
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
}

.preview-detach {
  margin-left: auto;
}

.preview-close {
  margin-left: 0;
}

.preview-detach:hover,
.preview-close:hover {
  color: var(--text);
  background: var(--bg-hover);
}

.preview-close:hover {
  color: var(--danger);
}

.preview-body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-auto-rows: 1fr;
  gap: 8px;
  padding: 10px;
  overflow: hidden;
}

.preview-cell {
  position: relative;
  min-width: 0;
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid var(--border);
  background: #000;
}

.preview-canvas {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.preview-label {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 2px 6px;
  font-size: 11px;
  color: #fff;
  background: rgba(0, 0, 0, 0.55);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.preview-empty {
  margin: 0;
  padding: 14px 10px;
  font-size: 12px;
  color: var(--text-muted);
  text-align: center;
}

.resize-handle {
  position: absolute;
  right: 2px;
  bottom: 2px;
  width: 14px;
  height: 14px;
  cursor: nwse-resize;
  touch-action: none;
  z-index: 2;
  opacity: 0.55;
}

.resize-handle::after {
  content: '';
  position: absolute;
  right: 2px;
  bottom: 2px;
  width: 8px;
  height: 8px;
  border-right: 2px solid var(--text-muted);
  border-bottom: 2px solid var(--text-muted);
  border-radius: 0 0 3px 0;
}

.resize-handle:hover {
  opacity: 1;
}
</style>
