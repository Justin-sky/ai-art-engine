<template>
  <div
    ref="barEl"
    class="layout-float"
    :class="{ collapsed: !expanded }"
    :style="{ left: `${pos.x}px`, top: `${pos.y}px` }"
    @mousedown.stop
    @pointerdown.stop
  >
    <button
      type="button"
      class="drag-handle"
      :title="t('graph.layout.dragHandle')"
      @pointerdown="onDragStart"
    >
      ⋮⋮
    </button>

    <button
      type="button"
      class="icon-btn toggle-btn"
      :class="{ active: expanded }"
      :title="expanded ? t('graph.layout.collapse') : t('graph.layout.expand')"
      :aria-label="expanded ? t('graph.layout.collapse') : t('graph.layout.expand')"
      :aria-expanded="expanded"
      @click="toggleExpanded"
    >
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <path
          fill="none"
          stroke="currentColor"
          stroke-width="1.25"
          d="M2.5 3.5h11M2.5 8h11M2.5 12.5h11"
        />
      </svg>
    </button>

    <template v-if="expanded">
      <button
        type="button"
        class="icon-btn"
        :class="{ active: gridVisible }"
        :title="t('graph.layout.grid')"
        :aria-label="t('graph.layout.grid')"
        @click="emit('update:gridVisible', !gridVisible)"
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path
            fill="none"
            stroke="currentColor"
            stroke-width="1.25"
            d="M2.5 2.5h11v11h-11zM2.5 6.5h11M2.5 10.5h11M6.5 2.5v11M10.5 2.5v11"
          />
        </svg>
      </button>

      <button
        type="button"
        :class="{ active: snapEnabled }"
        :title="t('graph.layout.snap')"
        @click="emit('update:snapEnabled', !snapEnabled)"
      >
        {{ t('graph.layout.snapShort') }}
      </button>

      <span class="sep" aria-hidden="true" />

      <button
        type="button"
        :disabled="selectedCount < 2"
        :title="t('graph.layout.alignLeft')"
        @click="emit('align', 'left')"
      >
        ⇤
      </button>
      <button
        type="button"
        :disabled="selectedCount < 2"
        :title="t('graph.layout.alignCenterX')"
        @click="emit('align', 'centerX')"
      >
        ↔
      </button>
      <button
        type="button"
        :disabled="selectedCount < 2"
        :title="t('graph.layout.alignRight')"
        @click="emit('align', 'right')"
      >
        ⇥
      </button>
      <button
        type="button"
        :disabled="selectedCount < 2"
        :title="t('graph.layout.alignTop')"
        @click="emit('align', 'top')"
      >
        ↥
      </button>
      <button
        type="button"
        :disabled="selectedCount < 2"
        :title="t('graph.layout.alignCenterY')"
        @click="emit('align', 'centerY')"
      >
        ↕
      </button>
      <button
        type="button"
        :disabled="selectedCount < 2"
        :title="t('graph.layout.alignBottom')"
        @click="emit('align', 'bottom')"
      >
        ↧
      </button>

      <span class="sep" aria-hidden="true" />

      <button
        type="button"
        :disabled="selectedCount < 3"
        :title="t('graph.layout.distributeH')"
        @click="emit('distribute', 'horizontal')"
      >
        {{ t('graph.layout.distributeHShort') }}
      </button>
      <button
        type="button"
        :disabled="selectedCount < 3"
        :title="t('graph.layout.distributeV')"
        @click="emit('distribute', 'vertical')"
      >
        {{ t('graph.layout.distributeVShort') }}
      </button>
      <button
        type="button"
        :disabled="selectedCount < 2"
        :title="t('graph.layout.auto')"
        @click="emit('auto-layout')"
      >
        {{ t('graph.layout.autoShort') }}
      </button>
    </template>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import type { AlignMode, DistributeMode } from '@shared/graph'
import { useStudioI18n } from '../composables/useStudioI18n'

const STORAGE_KEY = 'aiartengine.graph.layoutFloatPos'
const EXPANDED_KEY = 'aiartengine.graph.layoutFloatExpanded'

const props = defineProps<{
  selectedCount: number
  snapEnabled: boolean
  gridVisible: boolean
  /** 相对 node-graph 容器的初始/约束区域 */
  boundsPad?: number
}>()

const emit = defineEmits<{
  'update:snapEnabled': [value: boolean]
  'update:gridVisible': [value: boolean]
  align: [mode: AlignMode]
  distribute: [mode: DistributeMode]
  'auto-layout': []
}>()

const { t } = useStudioI18n()

function loadPos(): { x: number; y: number } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { x: 16, y: 56 }
    const parsed = JSON.parse(raw) as { x?: number; y?: number }
    if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
      return { x: parsed.x, y: parsed.y }
    }
  } catch {
    /* ignore */
  }
  return { x: 16, y: 56 }
}

function loadExpanded(): boolean {
  try {
    const raw = localStorage.getItem(EXPANDED_KEY)
    if (raw === '1' || raw === 'true') return true
    if (raw === '0' || raw === 'false') return false
  } catch {
    /* ignore */
  }
  return false
}

const pos = reactive(loadPos())
const expanded = ref(loadExpanded())
const barEl = ref<HTMLElement | null>(null)

function persistPos(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ x: pos.x, y: pos.y }))
  } catch {
    /* ignore */
  }
}

function persistExpanded(): void {
  try {
    localStorage.setItem(EXPANDED_KEY, expanded.value ? '1' : '0')
  } catch {
    /* ignore */
  }
}

function toggleExpanded(): void {
  expanded.value = !expanded.value
  persistExpanded()
  // 展开/折叠改变宽度，可能顶出右边界
  void nextTick(() => clampIntoView(true))
}

let drag: { startX: number; startY: number; originX: number; originY: number } | null = null

function clampToParent(x: number, y: number, el: HTMLElement): { x: number; y: number } {
  const parent = el.offsetParent as HTMLElement | null
  if (!parent) return { x, y }
  const pad = props.boundsPad ?? 8
  const maxX = Math.max(pad, parent.clientWidth - el.offsetWidth - pad)
  const maxY = Math.max(pad, parent.clientHeight - el.offsetHeight - pad)
  return {
    x: Math.min(maxX, Math.max(pad, x)),
    y: Math.min(maxY, Math.max(pad, y))
  }
}

/**
 * 恢复的旧坐标或容器变小都可能把工具栏顶出可视区域，
 * 挂载与容器尺寸变化时都要夹回，否则用户以为工具栏消失了。
 */
function clampIntoView(persist = false): void {
  const el = barEl.value
  const parent = el?.offsetParent as HTMLElement | null
  if (!el || !parent) return
  // 容器尚未布局（隐藏的面板）时尺寸为 0，此时夹取会把坐标压成 pad 并覆盖用户位置
  if (!parent.clientWidth || !parent.clientHeight) return
  const next = clampToParent(pos.x, pos.y, el)
  if (next.x === pos.x && next.y === pos.y) return
  pos.x = next.x
  pos.y = next.y
  if (persist) persistPos()
}

function onDragStart(event: PointerEvent): void {
  if (event.button !== 0) return
  const handle = event.currentTarget as HTMLElement
  const bar = handle.closest('.layout-float') as HTMLElement | null
  if (!bar) return
  event.preventDefault()
  handle.setPointerCapture(event.pointerId)
  drag = {
    startX: event.clientX,
    startY: event.clientY,
    originX: pos.x,
    originY: pos.y
  }

  const onMove = (moveEvent: PointerEvent): void => {
    if (!drag) return
    const next = clampToParent(
      drag.originX + (moveEvent.clientX - drag.startX),
      drag.originY + (moveEvent.clientY - drag.startY),
      bar
    )
    pos.x = next.x
    pos.y = next.y
  }

  const onUp = (): void => {
    drag = null
    persistPos()
    handle.removeEventListener('pointermove', onMove)
    handle.removeEventListener('pointerup', onUp)
    handle.removeEventListener('pointercancel', onUp)
  }

  handle.addEventListener('pointermove', onMove)
  handle.addEventListener('pointerup', onUp)
  handle.addEventListener('pointercancel', onUp)
}

let boundsObserver: ResizeObserver | null = null

onMounted(() => {
  clampIntoView(true)
  const parent = barEl.value?.offsetParent as HTMLElement | null
  if (!parent || typeof ResizeObserver === 'undefined') return
  boundsObserver = new ResizeObserver(() => clampIntoView())
  boundsObserver.observe(parent)
})

onBeforeUnmount(() => {
  drag = null
  boundsObserver?.disconnect()
  boundsObserver = null
})
</script>

<style scoped>
.layout-float {
  position: absolute;
  z-index: 40;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--graph-float-bg);
  box-shadow: 0 10px 28px var(--shadow);
  backdrop-filter: blur(6px);
  user-select: none;
}

.layout-float.collapsed {
  padding: 5px 6px;
}

.drag-handle {
  width: 22px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  cursor: grab;
  font-size: 11px;
  letter-spacing: -1px;
  line-height: 1;
}

.drag-handle:active {
  cursor: grabbing;
}

.layout-float > button:not(.drag-handle) {
  min-width: 28px;
  height: 24px;
  padding: 0 7px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-elevated);
  color: var(--text);
  font-size: 11px;
  cursor: pointer;
}

.layout-float > button.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 28px;
  padding: 0;
}

.layout-float > button:not(.drag-handle):hover:not(:disabled) {
  border-color: var(--accent-45);
  color: var(--accent-fg);
  background: var(--accent-12);
}

.layout-float > button.active {
  border-color: var(--accent-45);
  color: var(--accent-fg);
  background: var(--accent-18);
}

.layout-float > button:disabled {
  opacity: 0.35;
  cursor: default;
}

.sep {
  width: 1px;
  height: 16px;
  margin: 0 2px;
  background: var(--border);
}
</style>
