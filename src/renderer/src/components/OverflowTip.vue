<template>
  <span
    ref="el"
    class="overflow-tip"
    :class="{ 'has-tip': !!text }"
    @mouseenter="onEnter"
    @mousemove="onMove"
    @mouseleave="hide"
  >
    <slot />
    <Teleport :to="bodyTarget" :disabled="!bodyTarget">
      <span
        ref="popEl"
        v-if="visible && text"
        class="overflow-tip-pop"
        :class="placementClass"
        role="tooltip"
        :style="popStyle"
      >
        {{ text }}
      </span>
    </Teleport>
  </span>
</template>

<script setup lang="ts">
import { computed, nextTick, reactive, ref } from 'vue'

const props = defineProps<{
  /** 悬停时显示的完整文本；为空则不显示提示 */
  text?: string
}>()

const el = ref<HTMLElement | null>(null)
const popEl = ref<HTMLElement | null>(null)
const visible = ref(false)
const pop = reactive({ left: 0, top: 0, maxWidth: 360, arrowLeft: 16, placement: 'top' as 'top' | 'bottom' })
let lastMouseY = 0

/**
 * 独立窗口（detached window）会把已挂载的 DOM 整体 Teleport 进弹窗文档：
 * `el` 节点引用不变，但 ownerDocument 会切换，computed 不会因此重算。
 * 因此在悬停时（元素已就位于最终文档后）再解析目标 body，并缓存到 ref 供 Teleport 使用。
 */
const bodyTarget = ref<HTMLElement | null>(null)

function viewportSize(target: HTMLElement | null | undefined): { width: number; height: number } {
  const win = target?.ownerDocument.defaultView ?? window
  return {
    width: win.visualViewport?.width ?? win.innerWidth,
    height: win.visualViewport?.height ?? win.innerHeight
  }
}

const popStyle = computed(() => ({
  left: `${pop.left}px`,
  top: `${pop.top}px`,
  maxWidth: `${pop.maxWidth}px`,
  '--arrow-left': `${pop.arrowLeft}px`
}))

const placementClass = computed(() =>
  pop.placement === 'bottom' ? 'placement-bottom' : 'placement-top'
)

function onEnter(event: MouseEvent): void {
  show(event.clientX, event.clientY)
}

function onMove(event: MouseEvent): void {
  lastMouseY = event.clientY
  if (!visible.value) return
  pop.arrowLeft = clampArrow(event.clientX)
  positionPop()
}

function show(mouseX?: number, mouseY?: number): void {
  if (!props.text) return
  const rect = el.value?.getBoundingClientRect()
  if (!rect) return
  bodyTarget.value = el.value?.ownerDocument.body ?? null
  const viewportW = viewportSize(el.value).width
  const maxWidth = Math.min(360, Math.max(160, viewportW - 16))
  const anchorX = mouseX ?? rect.left + rect.width / 2
  const anchorY = mouseY ?? rect.top + rect.height / 2
  lastMouseY = anchorY
  // 弹窗以鼠标为锚点：左缘从光标向左偏 36px（越界时贴边）
  const left = Math.max(8, Math.min(anchorX - 36, viewportW - maxWidth - 8))
  pop.left = left
  pop.maxWidth = maxWidth
  pop.arrowLeft = clampArrow(anchorX)
  visible.value = true
  void nextTick(() => positionPop())
}

/** 按鼠标 y 定位：优先在鼠标上方，上方空间不足时移到下方 */
function positionPop(): void {
  const target = popEl.value
  if (!target) return
  const height = target.offsetHeight || 120
  const viewportH = viewportSize(el.value).height
  const gap = 12
  let placement: 'top' | 'bottom'
  let top: number
  if (lastMouseY - height - gap >= 8) {
    placement = 'top'
    top = lastMouseY - height - gap
  } else {
    placement = 'bottom'
    top = lastMouseY + gap
    if (top + height > viewportH - 8) top = Math.max(8, viewportH - height - 8)
  }
  pop.placement = placement
  pop.top = top
}

/** 箭头中心对准光标：减去三角半宽 8px，并限制在弹窗内 */
function clampArrow(mouseX: number): number {
  return Math.max(18, Math.min(mouseX - pop.left - 8, pop.maxWidth - 18))
}

function hide(): void {
  visible.value = false
}
</script>

<style scoped>
.overflow-tip {
  position: relative;
}
.overflow-tip.has-tip {
  cursor: default;
}
.overflow-tip-pop {
  position: fixed;
  z-index: 9999;
  box-sizing: border-box;
  max-width: min(420px, 80vw);
  white-space: pre-wrap;
  word-break: break-word;
  background: #1b2230;
  color: #b8e0ff;
  border: 2px solid var(--accent, #4aa3ff);
  border-radius: 8px;
  padding: 10px 14px;
  font-size: 13px;
  line-height: 1.6;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.5);
  pointer-events: none;
}
.overflow-tip-pop::after {
  content: '';
  position: absolute;
  left: var(--arrow-left, 16px);
  width: 0;
  height: 0;
  border: 8px solid transparent;
}
.overflow-tip-pop.placement-top::after {
  bottom: -16px;
  border-top: 10px solid var(--accent, #4aa3ff);
  border-bottom: none;
}
.overflow-tip-pop.placement-bottom::after {
  top: -16px;
  border-bottom: 10px solid var(--accent, #4aa3ff);
  border-top: none;
}
</style>
