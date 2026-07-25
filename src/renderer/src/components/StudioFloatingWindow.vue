<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="sfw-mask"
      :class="{ 'sfw-mask-dim': variant === 'editor' }"
      :style="{ zIndex }"
      @mousedown.self="onBackdrop"
    >
      <div
        class="sfw-window"
        :class="{ 'sfw-window-editor': variant === 'editor' }"
        role="dialog"
        aria-modal="true"
        :aria-label="ariaLabel"
        :style="windowStyle"
        @mousedown.stop="onWindowMouseDown"
      >
        <header v-if="showTitlebar" class="sfw-titlebar" @mousedown.prevent="onDragStart">
          <div class="sfw-title">
            <slot name="title">
              <h3>{{ title }}</h3>
            </slot>
          </div>
          <div class="sfw-title-actions" @mousedown.stop>
            <slot name="title-actions" />
            <button
              v-if="showClose"
              type="button"
              class="sfw-close"
              :title="closeTitle"
              @click="emitClose"
            >
              ×
            </button>
          </div>
        </header>

        <div v-if="showTitlebar && ($slots.subtitle || subtitle)" class="sfw-subtitle">
          <slot name="subtitle">
            <p>{{ subtitle }}</p>
          </slot>
        </div>

        <div class="sfw-body" :class="bodyClass">
          <!-- 先上屏窗壳，下一帧再挂内容，避免打开瞬间卡死 -->
          <slot v-if="bodyReady" />
        </div>

        <footer v-if="$slots.footer" class="sfw-footer">
          <slot name="footer" />
        </footer>

        <span
          v-for="handle in resizeHandles"
          :key="handle"
          class="sfw-resize"
          :class="`sfw-resize-${handle}`"
          @mousedown.prevent="onResizeStart(handle, $event)"
        />
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'

type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

const props = withDefaults(
  defineProps<{
    open: boolean
    title?: string
    subtitle?: string
    showClose?: boolean
    showTitlebar?: boolean
    closeTitle?: string
    closeOnBackdrop?: boolean
    closeOnEsc?: boolean
    zIndex?: number
    defaultWidth?: number
    defaultHeight?: number
    minWidth?: number
    minHeight?: number
    bodyClass?: string
    /** editor：深色遮罩 + 大圆角，用于分镜/全景等大编辑窗 */
    variant?: 'default' | 'editor'
  }>(),
  {
    title: '',
    subtitle: '',
    showClose: true,
    showTitlebar: true,
    closeTitle: 'Close',
    closeOnBackdrop: true,
    closeOnEsc: true,
    zIndex: 2100,
    defaultWidth: 480,
    defaultHeight: 420,
    minWidth: 320,
    minHeight: 240,
    bodyClass: '',
    variant: 'default'
  }
)

const emit = defineEmits<{
  close: []
}>()

const resizeHandles: ResizeHandle[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

const left = ref(0)
const top = ref(0)
const width = ref(props.defaultWidth)
const height = ref(props.defaultHeight)
/** 窗壳与重内容分帧：open 当帧只挂遮罩/标题栏 */
const bodyReady = ref(false)
let bodyReadyRaf = 0
let mounted = true

const ariaLabel = computed(() => props.title || 'Dialog')

const windowStyle = computed(() => ({
  left: `${left.value}px`,
  top: `${top.value}px`,
  width: `${width.value}px`,
  height: `${height.value}px`
}))

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

function placeWindow(): void {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const minW = props.minWidth
  const minH = props.minHeight
  width.value = clamp(props.defaultWidth, minW, vw - 24)
  height.value = clamp(props.defaultHeight, minH, vh - 24)
  left.value = Math.round((vw - width.value) / 2)
  top.value = Math.round((vh - height.value) / 2)
}

function onDocKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && props.closeOnEsc) {
    e.preventDefault()
    emitClose()
  }
}

let drag:
  | { kind: 'move'; ox: number; oy: number; sl: number; st: number }
  | {
      kind: 'resize'
      handle: ResizeHandle
      ox: number
      oy: number
      sl: number
      st: number
      sw: number
      sh: number
    }
  | null = null

watch(
  () => props.open,
  (visible, wasVisible) => {
    if (bodyReadyRaf) {
      cancelAnimationFrame(bodyReadyRaf)
      bodyReadyRaf = 0
    }
    if (!visible) {
      bodyReady.value = false
      // immediate 首次（wasVisible === undefined）无需清理
      if (wasVisible) stopPointerOps()
      window.removeEventListener('keydown', onDocKeyDown, true)
      return
    }
    placeWindow()
    bodyReady.value = false
    window.addEventListener('keydown', onDocKeyDown, true)
    // 双 rAF：等窗壳 paint 后再挂 slot 重内容
    bodyReadyRaf = requestAnimationFrame(() => {
      if (!mounted || !props.open) {
        bodyReadyRaf = 0
        return
      }
      bodyReadyRaf = requestAnimationFrame(() => {
        bodyReadyRaf = 0
        if (!mounted || !props.open) return
        bodyReady.value = true
      })
    })
  },
  { immediate: true }
)

function onPointerMove(e: PointerEvent): void {
  if (!drag) return
  const vw = window.innerWidth
  const vh = window.innerHeight
  const dx = e.clientX - drag.ox
  const dy = e.clientY - drag.oy
  const minW = props.minWidth
  const minH = props.minHeight

  if (drag.kind === 'move') {
    left.value = clamp(drag.sl + dx, 0, Math.max(0, vw - width.value))
    top.value = clamp(drag.st + dy, 0, Math.max(0, vh - 40))
    return
  }

  const { handle, sl, st, sw, sh } = drag
  let nextL = sl
  let nextT = st
  let nextW = sw
  let nextH = sh

  if (handle.includes('e')) nextW = sw + dx
  if (handle.includes('s')) nextH = sh + dy
  if (handle.includes('w')) {
    nextW = sw - dx
    nextL = sl + dx
  }
  if (handle.includes('n')) {
    nextH = sh - dy
    nextT = st + dy
  }

  if (nextW < minW) {
    if (handle.includes('w')) nextL = sl + (sw - minW)
    nextW = minW
  }
  if (nextH < minH) {
    if (handle.includes('n')) nextT = st + (sh - minH)
    nextH = minH
  }

  nextW = Math.min(nextW, vw - nextL)
  nextH = Math.min(nextH, vh - nextT)
  nextL = clamp(nextL, 0, vw - minW)
  nextT = clamp(nextT, 0, vh - 40)

  left.value = nextL
  top.value = nextT
  width.value = nextW
  height.value = nextH
}

function onPointerUp(): void {
  stopPointerOps()
}

function stopPointerOps(): void {
  if (!drag) return
  drag = null
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerUp)
}

function onDragStart(e: MouseEvent): void {
  if (e.button !== 0) return
  drag = {
    kind: 'move',
    ox: e.clientX,
    oy: e.clientY,
    sl: left.value,
    st: top.value
  }
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerUp)
}

/** 无外壳标题栏时，允许用内容区 `.titlebar`（排除 `.no-drag`）拖动 */
function onWindowMouseDown(e: MouseEvent): void {
  if (props.showTitlebar) return
  const el = e.target as HTMLElement | null
  if (!el?.closest('.titlebar')) return
  if (el.closest('.no-drag, button, input, select, textarea, a, [role="menu"]')) return
  e.preventDefault()
  onDragStart(e)
}

function onResizeStart(handle: ResizeHandle, e: MouseEvent): void {
  if (e.button !== 0) return
  drag = {
    kind: 'resize',
    handle,
    ox: e.clientX,
    oy: e.clientY,
    sl: left.value,
    st: top.value,
    sw: width.value,
    sh: height.value
  }
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerUp)
}

function emitClose(): void {
  emit('close')
}

function onBackdrop(): void {
  if (props.closeOnBackdrop) emitClose()
}

onBeforeUnmount(() => {
  mounted = false
  if (bodyReadyRaf) {
    cancelAnimationFrame(bodyReadyRaf)
    bodyReadyRaf = 0
  }
  stopPointerOps()
  window.removeEventListener('keydown', onDocKeyDown, true)
})
</script>

<style scoped>
.sfw-mask {
  position: fixed;
  inset: 0;
  background: var(--overlay);
  /* 覆盖主窗口 -webkit-app-region:drag 标题栏，避免拖弹窗时连带拖动 BrowserWindow */
  -webkit-app-region: no-drag;
  app-region: no-drag;
}

.sfw-mask.sfw-mask-dim {
  background: color-mix(in srgb, var(--overlay) 80%, #000 20%);
}

.sfw-window {
  position: fixed;
  z-index: 1;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 4px;
  box-shadow: 0 8px 28px var(--shadow);
  -webkit-app-region: no-drag;
  app-region: no-drag;
}

.sfw-window.sfw-window-editor {
  border-radius: 10px;
  box-shadow: 0 18px 48px var(--shadow);
}

.sfw-titlebar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  min-height: 32px;
  padding: 6px 8px 6px 12px;
  cursor: move;
  user-select: none;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--bg-elevated) 80%, transparent);
}

.sfw-window-editor .sfw-titlebar {
  padding: 8px 12px;
  background: transparent;
}

.sfw-title {
  flex: 1 1 auto;
  min-width: 0;
  pointer-events: none;
}

.sfw-title > :deep(h2),
.sfw-title > :deep(h3) {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sfw-title :deep(.eyebrow) {
  display: block;
  font-size: 10px;
  color: var(--text-muted);
  margin-bottom: 1px;
}

.sfw-title :deep(.app-mark) {
  font-size: 11px;
  color: var(--text-muted);
}

.sfw-title-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  cursor: default;
}

.sfw-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 2px;
  background: transparent;
  color: var(--text-muted);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}

.sfw-close:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.sfw-subtitle {
  flex-shrink: 0;
  padding: 6px 12px 0;
  font-size: 11px;
  line-height: 1.4;
  color: var(--text-muted);
}

.sfw-subtitle :deep(p) {
  margin: 0;
  white-space: pre-wrap;
}

.sfw-body {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 8px 12px;
  overflow: auto;
}

.sfw-body.pad-none {
  padding: 0;
  overflow: hidden;
}

.sfw-body.pad-none > * {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
}

.sfw-footer {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  padding: 8px 12px 10px;
  border-top: 1px solid var(--border);
}

.sfw-window-editor .sfw-footer {
  justify-content: flex-start;
  padding: 6px 12px;
}

.sfw-resize {
  position: absolute;
  z-index: 2;
}

.sfw-resize-n,
.sfw-resize-s {
  left: 8px;
  right: 8px;
  height: 6px;
  cursor: ns-resize;
}

.sfw-resize-e,
.sfw-resize-w {
  top: 8px;
  bottom: 8px;
  width: 6px;
  cursor: ew-resize;
}

.sfw-resize-n {
  top: 0;
}
.sfw-resize-s {
  bottom: 0;
}
.sfw-resize-e {
  right: 0;
}
.sfw-resize-w {
  left: 0;
}

.sfw-resize-ne,
.sfw-resize-nw,
.sfw-resize-se,
.sfw-resize-sw {
  width: 10px;
  height: 10px;
}

.sfw-resize-ne {
  top: 0;
  right: 0;
  cursor: nesw-resize;
}
.sfw-resize-nw {
  top: 0;
  left: 0;
  cursor: nwse-resize;
}
.sfw-resize-se {
  bottom: 0;
  right: 0;
  cursor: nwse-resize;
}
.sfw-resize-sw {
  bottom: 0;
  left: 0;
  cursor: nesw-resize;
}
</style>
