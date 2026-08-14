<template>
  <div
    v-if="open && embedded"
    class="sfw-embedded"
    :class="{ 'sfw-window-editor': variant === 'editor' }"
    :aria-label="ariaLabel"
  >
    <header
      v-if="showTitlebar"
      class="sfw-titlebar sfw-titlebar-embedded"
    >
      <div class="sfw-title">
        <slot name="title">
          <h3>{{ title }}</h3>
        </slot>
      </div>
      <div class="sfw-title-actions">
        <slot name="title-actions" />
      </div>
    </header>

    <div
      v-if="showTitlebar && ($slots.subtitle || subtitle)"
      class="sfw-subtitle"
    >
      <slot name="subtitle">
        <p>{{ subtitle }}</p>
      </slot>
    </div>

    <div
      class="sfw-body"
      :class="bodyClass"
    >
      <slot v-if="bodyReady" />
    </div>

    <footer
      v-if="$slots.footer"
      class="sfw-footer"
    >
      <slot name="footer" />
    </footer>
  </div>

  <Teleport
    v-else-if="open"
    :to="teleportTarget"
  >
    <div
      class="sfw-mask"
      :class="{ 'sfw-mask-dim': variant === 'editor', 'sfw-mask-detached': detached }"
      :style="maskStyle"
      @mousedown.self="onBackdrop"
    >
      <div
        class="sfw-window"
        :class="{
          'sfw-window-editor': variant === 'editor',
          'sfw-window-detached': detached,
          'sfw-window-detached-mac': detached && isMac
        }"
        role="dialog"
        :aria-modal="detached ? 'false' : 'true'"
        :aria-label="ariaLabel"
        :style="windowStyle"
        @mousedown.stop="onWindowMouseDown"
      >
        <!-- 无窗壳标题栏的弹窗：补一条系统拖动条，避开原生窗口按钮叠加区 -->
        <div
          v-if="detached && !showTitlebar"
          class="sfw-detached-strip"
        >
          <span class="sfw-detached-strip-title">{{ title }}</span>
          <button
            type="button"
            class="sfw-detach"
            :title="dockTitle"
            :aria-label="dockTitle"
            @click="dockBack"
          >
            ⤡
          </button>
        </div>

        <header
          v-if="showTitlebar"
          class="sfw-titlebar"
          @mousedown.prevent="onDragStart"
        >
          <div class="sfw-title">
            <slot name="title">
              <h3>{{ title }}</h3>
            </slot>
          </div>
          <div
            class="sfw-title-actions"
            @mousedown.stop
          >
            <slot name="title-actions" />
            <button
              v-if="canDetach && !detached"
              type="button"
              class="sfw-detach"
              :title="detachTitle"
              :aria-label="detachTitle"
              @click="detachToWindow()"
            >
              ⤢
            </button>
            <button
              v-if="detached"
              type="button"
              class="sfw-detach"
              :title="dockTitle"
              :aria-label="dockTitle"
              @click="dockBack"
            >
              ⤡
            </button>
            <button
              v-if="showClose && !detached"
              type="button"
              class="sfw-close"
              :title="closeTitle"
              @click="emitClose"
            >
              ×
            </button>
          </div>
        </header>

        <div
          v-if="showTitlebar && ($slots.subtitle || subtitle)"
          class="sfw-subtitle"
        >
          <slot name="subtitle">
            <p>{{ subtitle }}</p>
          </slot>
        </div>

        <div
          class="sfw-body"
          :class="bodyClass"
        >
          <!-- 先上屏窗壳，下一帧再挂内容，避免打开瞬间卡死 -->
          <slot v-if="bodyReady" />
        </div>

        <footer
          v-if="$slots.footer"
          class="sfw-footer"
        >
          <slot name="footer" />
        </footer>

        <span
          v-for="handle in visibleResizeHandles"
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
import { computed, inject, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { editorDiveEmbeddedKey } from '../features/graph/ui/editorDiveEmbeddedKey'
import { useStudioI18n } from '../composables/useStudioI18n'
import { openDetachedWindow, type DetachedWindowHandle } from '../utils/detachedWindow'

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
    /** Dive 内嵌铺满；未传时也可由 editorDiveEmbeddedKey 注入 */
    embedded?: boolean
    /** 允许拖出主窗口 / 弹成独立系统窗口 */
    detachable?: boolean
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
    variant: 'default',
    embedded: undefined,
    detachable: true
  }
)

const emit = defineEmits<{
  close: []
}>()

const { t } = useStudioI18n()

const diveEmbedded = inject(editorDiveEmbeddedKey, false)
const embedded = computed(() => props.embedded ?? diveEmbedded)

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

/** 独立系统窗口宿主：内容用 Teleport 挂过去，组件实例与状态不重建 */
const detachedContainer = ref<HTMLElement | null>(null)
let detachedHandle: DetachedWindowHandle | null = null

const detached = computed(() => detachedContainer.value != null)
const canDetach = computed(() => props.detachable && !embedded.value)
const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent)

const detachTitle = computed(() => t('studio.window.detach'))
const dockTitle = computed(() => t('studio.window.dock'))

const teleportTarget = computed<HTMLElement | string>(() => detachedContainer.value ?? 'body')
const visibleResizeHandles = computed<ResizeHandle[]>(() => (detached.value ? [] : resizeHandles))

const maskStyle = computed(() => (detached.value ? {} : { zIndex: props.zIndex }))

const windowStyle = computed(() =>
  detached.value
    ? {}
    : {
        left: `${left.value}px`,
        top: `${top.value}px`,
        width: `${width.value}px`,
        height: `${height.value}px`
      }
)

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
  if (detached.value) return
  if (e.key === 'Escape' && props.closeOnEsc) {
    e.preventDefault()
    emitClose()
  }
}

type DragOrigin = { screenX: number; screenY: number; grabX: number; grabY: number }

/** origin：拖拽分离时的指针屏幕坐标，让新窗口落在鼠标处 */
function detachToWindow(origin?: DragOrigin): void {
  if (!canDetach.value || detached.value) return
  const handle = openDetachedWindow({
    title: props.title || 'AIArtEngine',
    // 独立窗口自带 40px 原生标题栏叠加区，补足高度避免内容被压缩
    width: Math.round(width.value),
    height: Math.round(height.value) + 40,
    screenX: origin ? origin.screenX - origin.grabX : window.screenX + left.value,
    screenY: origin ? origin.screenY - origin.grabY : window.screenY + top.value,
    onClose: () => {
      void dockBack()
    }
  })
  if (!handle) return
  detachedHandle = handle
  detachedContainer.value = handle.container
}

async function dockBack(): Promise<void> {
  if (!detached.value) return
  const handle = detachedHandle
  detachedHandle = null
  // 先让 Teleport 把内容搬回主窗口，再关弹窗，避免节点随文档一起销毁
  detachedContainer.value = null
  await nextTick()
  handle?.close()
  if (props.open && !embedded.value) placeWindow()
}

function closeDetachedWindow(): void {
  const handle = detachedHandle
  detachedHandle = null
  detachedContainer.value = null
  handle?.close()
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
      closeDetachedWindow()
      window.removeEventListener('keydown', onDocKeyDown, true)
      return
    }
    if (embedded.value || detached.value) {
      bodyReady.value = true
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
    // 拖出主窗口边界即分离为独立系统窗口（与 3D 导演台一致）
    if (canDetach.value && isOutsideWindow(e)) {
      const origin = dragOrigin(e)
      stopPointerOps()
      detachToWindow(origin)
      return
    }
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

function onPointerUp(e: PointerEvent): void {
  const wasMoving = drag?.kind === 'move'
  const origin = dragOrigin(e)
  stopPointerOps()
  if (wasMoving && canDetach.value && isOutsideWindow(e)) detachToWindow(origin)
}

function dragOrigin(e: PointerEvent): DragOrigin {
  return {
    screenX: e.screenX,
    screenY: e.screenY,
    grabX: clamp(e.clientX - left.value, 0, width.value),
    grabY: clamp(e.clientY - top.value, 0, height.value)
  }
}

function isOutsideWindow(e: PointerEvent): boolean {
  return (
    e.clientX <= 0 ||
    e.clientY <= 0 ||
    e.clientX >= window.innerWidth - 1 ||
    e.clientY >= window.innerHeight - 1
  )
}

function stopPointerOps(): void {
  if (!drag) return
  drag = null
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerUp)
}

function onDragStart(e: MouseEvent): void {
  if (e.button !== 0 || detached.value) return
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
  if (e.button !== 0 || detached.value) return
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
  if (detached.value) return
  if (props.closeOnBackdrop) emitClose()
}

onBeforeUnmount(() => {
  mounted = false
  if (bodyReadyRaf) {
    cancelAnimationFrame(bodyReadyRaf)
    bodyReadyRaf = 0
  }
  stopPointerOps()
  closeDetachedWindow()
  window.removeEventListener('keydown', onDocKeyDown, true)
})
</script>

<style scoped>
.sfw-embedded {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  height: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-panel);
}

.sfw-titlebar-embedded {
  cursor: default;
}

.sfw-mask {
  position: fixed;
  inset: 0;
  background: var(--overlay);
  /* 覆盖主窗口 -webkit-app-region:drag 标题栏，避免拖弹窗时连带拖动 BrowserWindow */
  -webkit-app-region: no-drag;
  app-region: no-drag;
}

.sfw-mask.sfw-mask-dim {
  background: var(--overlay);
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

/* 独立系统窗口：铺满弹窗，标题栏交给系统拖动 */
.sfw-mask.sfw-mask-detached {
  position: static;
  inset: auto;
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  background: transparent;
}

.sfw-window.sfw-window-detached {
  position: static;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  border: none;
  border-radius: 0;
  box-shadow: none;
}

.sfw-window-detached .sfw-titlebar {
  min-height: 40px;
  padding-right: 148px;
  cursor: default;
  -webkit-app-region: drag;
  app-region: drag;
}

.sfw-window-detached.sfw-window-detached-mac .sfw-titlebar {
  padding-right: 8px;
  padding-left: 82px;
}

.sfw-window-detached .sfw-title-actions,
.sfw-window-detached .sfw-body,
.sfw-window-detached .sfw-footer {
  -webkit-app-region: no-drag;
  app-region: no-drag;
}

.sfw-detached-strip {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  min-height: 40px;
  padding: 0 148px 0 12px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
  border-bottom: 1px solid var(--border);
  user-select: none;
  -webkit-app-region: drag;
  app-region: drag;
}

.sfw-window-detached-mac .sfw-detached-strip {
  padding: 0 12px 0 82px;
}

.sfw-detached-strip-title {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sfw-detached-strip .sfw-detach {
  -webkit-app-region: no-drag;
  app-region: no-drag;
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

.sfw-detach,
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

.sfw-detach {
  font-size: 13px;
}

.sfw-detach:hover,
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
