<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import MediaRunIcon from './icons/MediaRunIcon.vue'

export type RadialIconKind = 'play' | 'replay' | 'forward' | 'rewind' | 'queue' | 'stop'

export type RadialMenuItem = {
  id: string
  label: string
  icon: RadialIconKind
  disabled?: boolean
}

const props = withDefaults(
  defineProps<{
    x: number
    y: number
    items: RadialMenuItem[]
    hint?: string
    /** 目标节点中心（client 坐标），用于画指引线 */
    anchorX?: number | null
    anchorY?: number | null
    outerRadius?: number
    innerRadius?: number
  }>(),
  {
    hint: '',
    anchorX: null,
    anchorY: null,
    outerRadius: 128,
    innerRadius: 36
  }
)

const emit = defineEmits<{
  pick: [id: string]
  cancel: []
  'update:hoveredId': [id: string | null]
}>()

const hoveredId = ref<string | null>(null)
const size = computed(() => props.outerRadius * 2 + 8)
const cx = computed(() => size.value / 2)
const cy = computed(() => size.value / 2)

/** 扇区内容区最大宽度：按弦长估算，避免文字溢出相邻扇区 */
const contentMaxWidth = computed(() => {
  const n = Math.max(1, props.items.length)
  const midR = (props.innerRadius + props.outerRadius) / 2
  const chord = 2 * midR * Math.sin(Math.PI / n)
  return Math.max(48, Math.min(96, Math.floor(chord * 0.78)))
})

/** 圆盘边缘 → 节点中心的线段（避免穿过圆盘内部） */
const linkGeometry = computed(() => {
  const ax = props.anchorX
  const ay = props.anchorY
  if (ax == null || ay == null) return null
  const dx = ax - props.x
  const dy = ay - props.y
  const dist = Math.hypot(dx, dy)
  if (dist < 4) return null
  const ux = dx / dist
  const uy = dy / dist
  const discEdge = Math.min(dist - 6, props.outerRadius)
  if (discEdge <= 2) return null
  return {
    x1: props.x + ux * discEdge,
    y1: props.y + uy * discEdge,
    x2: ax,
    y2: ay
  }
})

const wedges = computed(() => {
  const n = props.items.length
  if (n === 0) return []
  const step = (Math.PI * 2) / n
  const start = -Math.PI / 2 - step / 2
  const contentR = (props.innerRadius + props.outerRadius) / 2
  return props.items.map((item, i) => {
    const a0 = start + i * step
    const a1 = a0 + step
    const mid = (a0 + a1) / 2
    return {
      item,
      a0,
      a1,
      mid,
      path: donutSlice(cx.value, cy.value, props.innerRadius, props.outerRadius, a0, a1),
      contentX: cx.value + Math.cos(mid) * contentR,
      contentY: cy.value + Math.sin(mid) * contentR
    }
  })
})

function donutSlice(
  x: number,
  y: number,
  r0: number,
  r1: number,
  a0: number,
  a1: number
): string {
  const large = a1 - a0 > Math.PI ? 1 : 0
  const p = (r: number, a: number) => [x + Math.cos(a) * r, y + Math.sin(a) * r] as const
  const [x0, y0] = p(r1, a0)
  const [x1, y1] = p(r1, a1)
  const [x2, y2] = p(r0, a1)
  const [x3, y3] = p(r0, a0)
  return [
    `M ${x0} ${y0}`,
    `A ${r1} ${r1} 0 ${large} 1 ${x1} ${y1}`,
    `L ${x2} ${y2}`,
    `A ${r0} ${r0} 0 ${large} 0 ${x3} ${y3}`,
    'Z'
  ].join(' ')
}

function setHovered(id: string | null): void {
  if (hoveredId.value === id) return
  hoveredId.value = id
  emit('update:hoveredId', id)
}

function hitTest(clientX: number, clientY: number): string | null {
  const root = rootEl.value
  if (!root || props.items.length === 0) return null
  const rect = root.getBoundingClientRect()
  const dx = clientX - (rect.left + rect.width / 2)
  const dy = clientY - (rect.top + rect.height / 2)
  const dist = Math.hypot(dx, dy)
  if (dist < props.innerRadius || dist > props.outerRadius) return null
  const n = props.items.length
  const step = (Math.PI * 2) / n
  const start = -Math.PI / 2 - step / 2
  let rel = Math.atan2(dy, dx) - start
  while (rel < 0) rel += Math.PI * 2
  while (rel >= Math.PI * 2) rel -= Math.PI * 2
  const index = Math.min(n - 1, Math.floor(rel / step))
  const item = props.items[index]
  if (!item || item.disabled) return null
  return item.id
}

function onPointerMove(e: PointerEvent): void {
  setHovered(hitTest(e.clientX, e.clientY))
}

function onPointerDown(e: PointerEvent): void {
  if (e.button !== 0) return
  e.preventDefault()
  e.stopPropagation()
  const id = hitTest(e.clientX, e.clientY)
  if (id) {
    emit('pick', id)
    return
  }
  emit('cancel')
}

const rootEl = ref<HTMLElement | null>(null)

onMounted(() => {
  window.addEventListener('pointermove', onPointerMove, true)
})

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onPointerMove, true)
})

watch(
  () => props.items,
  () => setHovered(null),
  { deep: true }
)

defineExpose({
  hoveredId,
  hitTest
})
</script>

<template>
  <Teleport to="body">
    <svg
      v-if="linkGeometry"
      class="radial-link-layer"
      aria-hidden="true"
    >
      <line
        class="radial-link-line"
        :x1="linkGeometry.x1"
        :y1="linkGeometry.y1"
        :x2="linkGeometry.x2"
        :y2="linkGeometry.y2"
      />
      <circle
        class="radial-link-dot"
        :cx="linkGeometry.x2"
        :cy="linkGeometry.y2"
        r="4.5"
      />
    </svg>
  </Teleport>

  <div
    ref="rootEl"
    class="radial-menu"
    :style="{
      left: `${x}px`,
      top: `${y}px`,
      width: `${size}px`,
      height: `${size}px`
    }"
    role="menu"
    @pointerdown="onPointerDown"
  >
    <svg class="radial-svg" :width="size" :height="size" aria-hidden="true">
      <circle
        class="radial-dead"
        :cx="cx"
        :cy="cy"
        :r="innerRadius - 2"
      />
      <path
        v-for="w in wedges"
        :key="w.item.id"
        class="radial-wedge"
        :class="{
          active: hoveredId === w.item.id,
          disabled: w.item.disabled
        }"
        :d="w.path"
      />
    </svg>

    <div
      v-for="w in wedges"
      :key="`content-${w.item.id}`"
      class="radial-content"
      :class="{ active: hoveredId === w.item.id, disabled: w.item.disabled }"
      :style="{
        left: `${w.contentX}px`,
        top: `${w.contentY}px`,
        width: `${contentMaxWidth}px`
      }"
    >
      <MediaRunIcon :kind="w.item.icon" :size="16" />
      <span class="radial-label">{{ w.item.label }}</span>
    </div>

    <div class="radial-center" aria-hidden="true">
      <span v-if="hint" class="radial-hint">{{ hint }}</span>
    </div>
  </div>
</template>

<style scoped>
.radial-link-layer {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 1095;
  pointer-events: none;
  overflow: visible;
}

.radial-link-line {
  stroke: rgba(142, 197, 255, 0.85);
  stroke-width: 1.5;
  stroke-dasharray: 4 3;
  stroke-linecap: round;
}

.radial-link-dot {
  fill: rgba(142, 197, 255, 0.95);
  stroke: rgba(20, 24, 30, 0.9);
  stroke-width: 1.5;
}

.radial-menu {
  position: fixed;
  z-index: 1100;
  transform: translate(-50%, -50%);
  pointer-events: auto;
  user-select: none;
}

.radial-svg {
  display: block;
  overflow: visible;
  filter: drop-shadow(0 10px 28px rgba(0, 0, 0, 0.45));
}

.radial-dead {
  fill: rgba(22, 26, 32, 0.92);
  stroke: var(--border);
  stroke-width: 1;
}

.radial-wedge {
  fill: rgba(36, 42, 52, 0.94);
  stroke: rgba(0, 0, 0, 0.35);
  stroke-width: 1;
  transition: fill 0.08s ease;
}

.radial-wedge.active {
  fill: rgba(52, 96, 160, 0.95);
}

.radial-wedge.disabled {
  fill: rgba(28, 32, 38, 0.7);
  opacity: 0.45;
}

.radial-content {
  position: absolute;
  transform: translate(-50%, -50%);
  pointer-events: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  color: var(--text);
  opacity: 0.9;
  text-align: center;
}

.radial-content.active {
  color: #fff;
  opacity: 1;
}

.radial-content.disabled {
  opacity: 0.35;
}

.radial-label {
  font-size: 11px;
  line-height: 1.15;
  font-weight: 500;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.65);
  word-break: break-all;
  overflow-wrap: anywhere;
}

.radial-content.active .radial-label {
  font-weight: 650;
}

.radial-center {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  pointer-events: none;
}

.radial-hint {
  font-size: 10px;
  color: var(--text-muted);
  letter-spacing: 0.02em;
}
</style>
