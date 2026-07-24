import type { Directive } from 'vue'

type NumberScrubEl = HTMLInputElement & {
  __numberScrubCleanup?: () => void
}

function stepDecimals(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0
  const text = String(step)
  const dot = text.indexOf('.')
  return dot < 0 ? 0 : text.length - dot - 1
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function roundToDecimals(value: number, decimals: number): number {
  if (decimals <= 0) return Math.round(value)
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

/**
 * 在 number 输入框上按住鼠标中键左右拖动，按 step 调整数值并触发 input。
 * 仅用于全景编辑器属性面板，不改动资产库面板。
 */
export const vNumberScrub: Directive<NumberScrubEl, undefined> = {
  mounted(el) {
    if (el.type !== 'number') return

    let dragging = false
    let startX = 0
    let startValue = 0
    let step = 0.01
    let min = Number.NEGATIVE_INFINITY
    let max = Number.POSITIVE_INFINITY
    let decimals = 2
    let previousCursor = ''
    let previousUserSelect = ''

    const finish = (): void => {
      if (!dragging) return
      dragging = false
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
    }

    const onPointerMove = (event: PointerEvent): void => {
      if (!dragging) return
      const dx = event.clientX - startX
      // 每 4px 调整一个 step；Shift 细调，Alt 粗调。
      const pixelsPerStep = event.shiftKey ? 10 : event.altKey ? 2 : 4
      const deltaSteps = Math.round(dx / pixelsPerStep)
      const next = clamp(startValue + deltaSteps * step, min, max)
      const rounded = roundToDecimals(next, decimals)
      if (Number(el.value) === rounded) return
      el.value = String(rounded)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }

    const onPointerUp = (): void => {
      finish()
    }

    const onPointerDown = (event: PointerEvent): void => {
      if (event.button !== 1 || el.disabled || el.readOnly) return
      event.preventDefault()
      event.stopPropagation()

      const parsed = Number(el.value)
      startValue = Number.isFinite(parsed) ? parsed : 0
      startX = event.clientX
      const parsedStep = Number(el.step)
      step = Number.isFinite(parsedStep) && parsedStep > 0 ? parsedStep : 1
      decimals = stepDecimals(step)
      min = el.min === '' ? Number.NEGATIVE_INFINITY : Number(el.min)
      max = el.max === '' ? Number.POSITIVE_INFINITY : Number(el.max)
      if (!Number.isFinite(min)) min = Number.NEGATIVE_INFINITY
      if (!Number.isFinite(max)) max = Number.POSITIVE_INFINITY

      dragging = true
      previousCursor = document.body.style.cursor
      previousUserSelect = document.body.style.userSelect
      document.body.style.cursor = 'ew-resize'
      document.body.style.userSelect = 'none'
      // 不 blur，避免 focusout 清掉 isEditingObject，导致拖拽时本地值被回填覆盖。

      window.addEventListener('pointermove', onPointerMove)
      window.addEventListener('pointerup', onPointerUp)
      window.addEventListener('pointercancel', onPointerUp)
    }

    const onAuxClick = (event: MouseEvent): void => {
      if (event.button === 1) {
        event.preventDefault()
        event.stopPropagation()
      }
    }

    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('auxclick', onAuxClick)
    el.__numberScrubCleanup = () => {
      finish()
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('auxclick', onAuxClick)
    }
  },

  unmounted(el: NumberScrubEl) {
    el.__numberScrubCleanup?.()
    delete el.__numberScrubCleanup
  }
}
