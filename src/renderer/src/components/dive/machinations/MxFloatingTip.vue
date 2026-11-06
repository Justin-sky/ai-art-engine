<script setup lang="ts">
/**
 * Delegated theme-aware floating tooltip for Machinations Studio & Numerical Studio.
 * - Automatically follows local `[data-theme]` overrides (e.g. light `.mx-canvas` or `.mx-fm-backdrop`
 *   inside a dark app shell, or vice versa) as well as detached windows.
 * - Supports both HTML/SVG `[title]` attributes and SVG child `<title>` elements while suppressing
 *   duplicate native OS tooltips during hover.
 * - Fast-bails when `e.buttons !== 0` so 60fps canvas panning/dragging incurs zero overhead.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { themePreference } from '../../../editor/preferences'

const SCOPE_SELECTOR = '.mx-studio, .num-studio, .mx-fm-backdrop, .mx-ag-modal-backdrop'
const SHOW_DELAY_MS = 150

const markerEl = ref<HTMLElement | null>(null)
const popEl = ref<HTMLElement | null>(null)
const bodyTarget = ref<HTMLElement | null>(null)
const visible = ref(false)
const tipText = ref('')
const tipTheme = ref<'dark' | 'light'>('dark')

const pos = reactive({
  left: 0,
  top: 0,
  placement: 'bottom' as 'top' | 'bottom'
})

let activeAnchor: Element | null = null
let activeSvgTitleEl: Element | null = null
let showTimer: ReturnType<typeof setTimeout> | null = null
let lastClientX = 0
let lastClientY = 0
let attachedDoc: Document | null = null

const popStyle = computed(() => ({
  left: `${pos.left}px`,
  top: `${pos.top}px`
}))

function clearShowTimer(): void {
  if (showTimer !== null) {
    clearTimeout(showTimer)
    showTimer = null
  }
}

function restoreActiveAnchor(): void {
  if (activeAnchor) {
    const saved = activeAnchor.getAttribute('data-mx-tip')
    if (saved !== null) {
      if (!activeAnchor.hasAttribute('title')) {
        activeAnchor.setAttribute('title', saved)
      }
      activeAnchor.removeAttribute('data-mx-tip')
    }
    activeAnchor = null
  }
  if (activeSvgTitleEl) {
    const savedSvg = activeSvgTitleEl.getAttribute('data-mx-svg-tip')
    if (savedSvg !== null) {
      if (!(activeSvgTitleEl.textContent || '').trim()) {
        activeSvgTitleEl.textContent = savedSvg
      }
      activeSvgTitleEl.removeAttribute('data-mx-svg-tip')
    }
    activeSvgTitleEl = null
  }
}

function clearActiveTip(): void {
  clearShowTimer()
  visible.value = false
  tipText.value = ''
  restoreActiveAnchor()
}

interface TipMatch {
  anchor: Element
  text: string
  svgTitleEl?: Element
}

function findDirectSvgTitle(el: Element): Element | null {
  const children = el.children
  for (let i = 0; i < children.length; i++) {
    const child = children[i]
    if (child && child.tagName.toLowerCase() === 'title') {
      return child
    }
  }
  return null
}

function resolveTipMatch(start: Element | null, scopeRoot: Element): TipMatch | null {
  let cur: Element | null = start
  const stopParent = scopeRoot.parentElement
  while (cur && cur !== stopParent) {
    if (cur.tagName.toLowerCase() !== 'svg') {
      const rawAttr = cur.getAttribute('title')
      if (rawAttr && rawAttr.trim()) {
        return { anchor: cur, text: rawAttr.trim() }
      }
      const cachedAttr = cur.getAttribute('data-mx-tip')
      if (cachedAttr && cachedAttr.trim()) {
        return { anchor: cur, text: cachedAttr.trim() }
      }
      if (cur.namespaceURI === 'http://www.w3.org/2000/svg') {
        const svgTitle = findDirectSvgTitle(cur)
        if (svgTitle) {
          const rawSvg = (
            svgTitle.getAttribute('data-mx-svg-tip') ??
            svgTitle.textContent ??
            ''
          ).trim()
          if (rawSvg) {
            return { anchor: cur, text: rawSvg, svgTitleEl: svgTitle }
          }
        }
      }
    }
    cur = cur.parentElement
  }
  return null
}

function resolveElementTheme(el: Element): 'dark' | 'light' {
  const themed = el.closest('[data-theme]')?.getAttribute('data-theme')
  if (themed === 'light' || themed === 'dark') return themed
  const docTheme = el.ownerDocument.documentElement.getAttribute('data-theme')
  if (docTheme === 'light' || docTheme === 'dark') return docTheme
  return themePreference.value === 'light' ? 'light' : 'dark'
}

function positionTooltip(): void {
  const anchor = activeAnchor
  const tipEl = popEl.value
  if (!anchor || !tipEl || !anchor.isConnected) {
    clearActiveTip()
    return
  }
  const win = anchor.ownerDocument.defaultView ?? window
  const vw = win.visualViewport?.width ?? win.innerWidth
  const vh = win.visualViewport?.height ?? win.innerHeight
  const rect = anchor.getBoundingClientRect()
  const tipW = tipEl.offsetWidth || 180
  const tipH = tipEl.offsetHeight || 32
  const useRectAnchor = rect.width > 0 && rect.width <= 140 && rect.height > 0 && rect.height <= 64

  let left: number
  let top: number
  let placement: 'top' | 'bottom' = 'bottom'

  if (useRectAnchor) {
    left = rect.left + rect.width / 2 - tipW / 2
    if (rect.bottom + 8 + tipH <= vh - 8) {
      top = rect.bottom + 8
      placement = 'bottom'
    } else {
      top = rect.top - tipH - 8
      placement = 'top'
    }
  } else {
    left = lastClientX - Math.min(32, tipW / 2)
    if (lastClientY + 16 + tipH <= vh - 8) {
      top = lastClientY + 16
      placement = 'bottom'
    } else {
      top = lastClientY - tipH - 12
      placement = 'top'
    }
  }

  pos.left = Math.round(Math.max(8, Math.min(left, vw - tipW - 8)))
  pos.top = Math.round(Math.max(8, Math.min(top, vh - tipH - 8)))
  pos.placement = placement
}

function onPointerOver(e: PointerEvent): void {
  if (e.buttons !== 0) {
    if (activeAnchor || visible.value) clearActiveTip()
    return
  }
  const target = e.target
  if (!(target instanceof Element)) return
  const scopeRoot = target.closest(SCOPE_SELECTOR)
  if (!scopeRoot) {
    if (activeAnchor || visible.value) clearActiveTip()
    return
  }

  lastClientX = e.clientX
  lastClientY = e.clientY

  const match = resolveTipMatch(target, scopeRoot)
  if (!match) {
    if (activeAnchor || visible.value) clearActiveTip()
    return
  }

  if (match.anchor === activeAnchor && tipText.value === match.text) {
    return
  }

  clearActiveTip()
  activeAnchor = match.anchor

  if (match.svgTitleEl) {
    activeSvgTitleEl = match.svgTitleEl
    if (!match.svgTitleEl.hasAttribute('data-mx-svg-tip')) {
      match.svgTitleEl.setAttribute('data-mx-svg-tip', match.text)
    }
    match.svgTitleEl.textContent = ''
  } else if (match.anchor.hasAttribute('title')) {
    match.anchor.setAttribute('data-mx-tip', match.text)
    match.anchor.removeAttribute('title')
  }

  tipText.value = match.text
  tipTheme.value = resolveElementTheme(match.anchor)
  bodyTarget.value = match.anchor.ownerDocument.body

  showTimer = setTimeout(() => {
    showTimer = null
    if (!activeAnchor || !activeAnchor.isConnected) {
      clearActiveTip()
      return
    }
    tipTheme.value = resolveElementTheme(activeAnchor)
    visible.value = true
    void nextTick(() => positionTooltip())
  }, SHOW_DELAY_MS)
}

function onPointerOut(e: PointerEvent): void {
  if (!activeAnchor) return
  const related = e.relatedTarget
  if (related instanceof Node && activeAnchor.contains(related)) {
    return
  }
  clearActiveTip()
}

function onDismissEvent(): void {
  if (activeAnchor || visible.value || showTimer !== null) {
    clearActiveTip()
  }
}

onMounted(() => {
  const doc = markerEl.value?.ownerDocument ?? document
  attachedDoc = doc
  doc.addEventListener('pointerover', onPointerOver, { passive: true })
  doc.addEventListener('pointerout', onPointerOut, { passive: true })
  doc.addEventListener('pointerdown', onDismissEvent, { capture: true, passive: true })
  doc.addEventListener('wheel', onDismissEvent, { passive: true })
  doc.addEventListener('keydown', onDismissEvent, { capture: true, passive: true })
  doc.addEventListener('scroll', onDismissEvent, { capture: true, passive: true })
})

onBeforeUnmount(() => {
  clearActiveTip()
  if (attachedDoc) {
    attachedDoc.removeEventListener('pointerover', onPointerOver)
    attachedDoc.removeEventListener('pointerout', onPointerOut)
    attachedDoc.removeEventListener('pointerdown', onDismissEvent, true)
    attachedDoc.removeEventListener('wheel', onDismissEvent)
    attachedDoc.removeEventListener('keydown', onDismissEvent, true)
    attachedDoc.removeEventListener('scroll', onDismissEvent, true)
    attachedDoc = null
  }
})
</script>

<template>
  <span ref="markerEl" class="mx-floating-tip-anchor" aria-hidden="true" />
  <Teleport :to="bodyTarget" :disabled="!bodyTarget">
    <div
      v-if="visible && tipText"
      ref="popEl"
      class="mx-floating-tip"
      :class="`is-${pos.placement}`"
      :data-theme="tipTheme"
      role="tooltip"
      :style="popStyle"
    >
      {{ tipText }}
    </div>
  </Teleport>
</template>

<style scoped>
.mx-floating-tip-anchor {
  display: none;
}

.mx-floating-tip {
  position: fixed;
  z-index: 10020;
  box-sizing: border-box;
  max-width: min(340px, calc(100vw - 16px));
  padding: 5px 10px;
  border-radius: 7px;
  border: 1px solid var(--border);
  background: var(--panel-glass, var(--bg-panel));
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 11.5px;
  font-weight: 500;
  line-height: 1.45;
  white-space: pre-line;
  word-break: break-word;
  box-shadow:
    0 6px 20px var(--shadow, rgba(0, 0, 0, 0.32)),
    0 1px 2px rgba(0, 0, 0, 0.08);
  backdrop-filter: blur(8px);
  pointer-events: none;
  animation: mx-tip-fade-in 0.1s ease-out;
}

@keyframes mx-tip-fade-in {
  from {
    opacity: 0;
    transform: translateY(2px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
