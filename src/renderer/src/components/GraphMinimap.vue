<template>
  <div
    class="graph-minimap"
    role="img"
    :aria-label="t('graph.minimap.title')"
    :title="t('graph.minimap.title')"
    :style="{ width: `${cssW}px`, height: `${cssH}px` }"
    @mousedown.stop
    @pointerdown.stop
    @wheel.prevent.stop
  >
    <canvas
      ref="canvasEl"
      class="graph-minimap-canvas"
      :width="bitmapW"
      :height="bitmapH"
      @pointerdown="onPointerDown"
    />
    <div v-if="nodes.length === 0" class="graph-minimap-empty">
      {{ t('graph.minimap.empty') }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { GraphNode, GraphViewport } from '@shared/graph'
import {
  collectMinimapNodeRects,
  computeMinimapTransform,
  graphRectToMinimap,
  minimapToWorld,
  resolveMinimapWorldBounds,
  viewportWorldRect,
  type MinimapTransform
} from '../graph/minimapGeometry'
import { useStudioI18n } from '../composables/useStudioI18n'

const props = withDefaults(
  defineProps<{
    nodes: GraphNode[]
    viewport: GraphViewport
    hostWidth: number
    hostHeight: number
    selectedNodeIds?: ReadonlySet<string> | string[]
    /** CSS 像素尺寸 */
    width?: number
    height?: number
  }>(),
  {
    width: 180,
    height: 120
  }
)

const emit = defineEmits<{
  'pan-to': [worldX: number, worldY: number]
}>()

const { t } = useStudioI18n()
const canvasEl = ref<HTMLCanvasElement | null>(null)

const cssW = computed(() => Math.max(80, Math.round(props.width)))
const cssH = computed(() => Math.max(60, Math.round(props.height)))
const dpr = ref(Math.max(1, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1))
const bitmapW = computed(() => Math.max(1, Math.round(cssW.value * dpr.value)))
const bitmapH = computed(() => Math.max(1, Math.round(cssH.value * dpr.value)))

const selectedSet = computed(() => {
  const raw = props.selectedNodeIds
  if (!raw) return new Set<string>()
  return raw instanceof Set ? raw : new Set(raw)
})

let transform: MinimapTransform = computeMinimapTransform(
  resolveMinimapWorldBounds([]),
  cssW.value,
  cssH.value
)
let dragActive = false
let dragPointerId: number | null = null

function redraw(): void {
  const canvas = canvasEl.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const world = resolveMinimapWorldBounds(props.nodes)
  transform = computeMinimapTransform(world, cssW.value, cssH.value)
  const ratio = dpr.value

  ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  ctx.clearRect(0, 0, cssW.value, cssH.value)

  // 背景（外框由 CSS 上/右边线承担）
  ctx.fillStyle = 'rgba(16, 18, 22, 0.92)'
  ctx.fillRect(0, 0, cssW.value, cssH.value)

  const rects = collectMinimapNodeRects(props.nodes)
  const selected = selectedSet.value
  for (const r of rects) {
    const p = graphRectToMinimap(
      { left: r.x, top: r.y, right: r.x + r.w, bottom: r.y + r.h },
      transform
    )
    const isSel = selected.has(r.id)
    ctx.fillStyle = isSel ? 'rgba(61, 139, 253, 0.85)' : 'rgba(154, 160, 166, 0.55)'
    ctx.fillRect(p.x, p.y, Math.max(2, p.w), Math.max(2, p.h))
  }

  if (props.hostWidth > 0 && props.hostHeight > 0) {
    const vr = viewportWorldRect(props.viewport, props.hostWidth, props.hostHeight)
    const box = graphRectToMinimap(vr, transform)
    ctx.fillStyle = 'rgba(61, 139, 253, 0.12)'
    ctx.strokeStyle = 'rgba(61, 139, 253, 0.95)'
    ctx.lineWidth = 1.25
    ctx.fillRect(box.x, box.y, box.w, box.h)
    ctx.strokeRect(box.x + 0.5, box.y + 0.5, Math.max(0, box.w - 1), Math.max(0, box.h - 1))
  }
}

function localPoint(e: PointerEvent): { x: number; y: number } {
  const canvas = canvasEl.value
  if (!canvas) return { x: 0, y: 0 }
  const rect = canvas.getBoundingClientRect()
  return {
    x: ((e.clientX - rect.left) / rect.width) * cssW.value,
    y: ((e.clientY - rect.top) / rect.height) * cssH.value
  }
}

function panFromEvent(e: PointerEvent): void {
  const p = localPoint(e)
  const world = minimapToWorld(p.x, p.y, transform)
  emit('pan-to', world.x, world.y)
}

function onPointerDown(e: PointerEvent): void {
  if (e.button !== 0) return
  e.preventDefault()
  e.stopPropagation()
  dragActive = true
  dragPointerId = e.pointerId
  const canvas = canvasEl.value
  canvas?.setPointerCapture(e.pointerId)
  panFromEvent(e)
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerUp)
}

function onPointerMove(e: PointerEvent): void {
  if (!dragActive || (dragPointerId != null && e.pointerId !== dragPointerId)) return
  panFromEvent(e)
}

function onPointerUp(e: PointerEvent): void {
  if (dragPointerId != null && e.pointerId !== dragPointerId) return
  dragActive = false
  const canvas = canvasEl.value
  if (canvas && dragPointerId != null) {
    try {
      canvas.releasePointerCapture(dragPointerId)
    } catch {
      /* ignore */
    }
  }
  dragPointerId = null
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerUp)
}

watch(
  [
    () => props.nodes,
    () => props.viewport.x,
    () => props.viewport.y,
    () => props.viewport.zoom,
    () => props.hostWidth,
    () => props.hostHeight,
    selectedSet,
    cssW,
    cssH,
    dpr
  ],
  () => redraw(),
  { deep: true, flush: 'post' }
)

function onDprChange(): void {
  dpr.value = Math.max(1, window.devicePixelRatio || 1)
}

onMounted(() => {
  onDprChange()
  redraw()
  window.addEventListener('resize', onDprChange)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onDprChange)
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerUp)
})
</script>

<style scoped>
.graph-minimap {
  position: absolute;
  left: 0;
  bottom: 0;
  z-index: 40;
  /* 贴齐左/下，四边均有边框 */
  border: 1px solid var(--border);
  border-radius: 0 6px 0 0;
  background: color-mix(in srgb, var(--bg-panel) 92%, transparent);
  box-shadow: 2px -2px 12px rgba(0, 0, 0, 0.28);
  overflow: hidden;
  cursor: crosshair;
  user-select: none;
  touch-action: none;
  box-sizing: border-box;
}

.graph-minimap-canvas {
  display: block;
  width: 100%;
  height: 100%;
}

.graph-minimap-empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  font-size: 11px;
  color: var(--text-muted);
  background: transparent;
}
</style>
