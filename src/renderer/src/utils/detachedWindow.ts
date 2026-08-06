/**
 * 把主窗口内的浮动窗拖成独立系统窗口。
 *
 * 用同源 `about:blank` 弹窗做宿主：弹窗只提供一个空容器，真正的内容由调用方用
 * Vue `<Teleport>` 挂进来，因此组件实例、状态与事件绑定全部保持不变。
 */

export interface DetachedWindowOptions {
  title: string
  width?: number
  height?: number
  screenX?: number
  screenY?: number
  /** 弹窗被用户关掉（或本 handle 关闭）时回调，用于回停靠主窗口 */
  onClose?: () => void
}

export interface DetachedWindowHandle {
  readonly popup: Window
  readonly container: HTMLElement
  close(): void
}

const BASE_CSS = `
html, body { margin: 0; height: 100%; overflow: hidden; }
#detached-root { display: flex; flex-direction: column; height: 100%; }
`

const liveHandles = new Set<DetachedWindowHandle>()

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    for (const handle of [...liveHandles]) handle.close()
  })
}

export function openDetachedWindow(options: DetachedWindowOptions): DetachedWindowHandle | null {
  if (typeof window === 'undefined') return null

  const width = Math.max(320, Math.round(options.width ?? 720))
  const height = Math.max(240, Math.round(options.height ?? 520))
  const features = [`width=${width}`, `height=${height}`]
  if (Number.isFinite(options.screenX)) features.push(`left=${Math.round(options.screenX!)}`)
  if (Number.isFinite(options.screenY)) features.push(`top=${Math.round(options.screenY!)}`)

  const name = `aiart-detached-${Math.random().toString(36).slice(2)}`
  const popup = window.open('about:blank', name, features.join(','))
  if (!popup) return null

  const doc = popup.document
  if (!doc.body) {
    doc.open()
    doc.write('<!doctype html><html><head></head><body></body></html>')
    doc.close()
  }
  doc.title = options.title

  // about:blank 没有 baseURI，样式表里的相对地址要靠主文档的 base 才能解析
  const base = doc.createElement('base')
  base.href = window.location.href
  doc.head.appendChild(base)

  const stopStyleSync = syncStyles(doc)
  const stopThemeSync = syncTheme(doc)
  const stopEventRelay = relayPointerEvents(popup)

  const baseStyle = doc.createElement('style')
  baseStyle.textContent = BASE_CSS
  doc.head.appendChild(baseStyle)

  const container = doc.createElement('div')
  container.id = 'detached-root'
  doc.body.appendChild(container)

  let disposed = false
  let pollTimer: ReturnType<typeof setInterval> | null = null

  function dispose(): void {
    if (disposed) return
    disposed = true
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
    stopStyleSync()
    stopThemeSync()
    stopEventRelay()
    liveHandles.delete(handle)
    options.onClose?.()
  }

  const handle: DetachedWindowHandle = {
    popup,
    container,
    close(): void {
      if (!popup.closed) popup.close()
      dispose()
    }
  }

  popup.addEventListener('pagehide', dispose)
  // Electron 下 pagehide 偶发不触发，补一层轮询兜底
  pollTimer = setInterval(() => {
    if (popup.closed) dispose()
  }, 300)

  liveHandles.add(handle)
  return handle
}

/** 复制主文档样式，并跟随后续新增（开发态按需注入 / 懒加载组件样式） */
function syncStyles(doc: Document): () => void {
  const copy = (node: Node): void => {
    if (!(node instanceof Element)) return
    if (node.tagName === 'STYLE') {
      const style = doc.createElement('style')
      style.textContent = node.textContent
      doc.head.appendChild(style)
      return
    }
    if (node instanceof HTMLLinkElement && node.rel === 'stylesheet') {
      const link = doc.createElement('link')
      link.rel = 'stylesheet'
      link.href = node.href
      doc.head.appendChild(link)
    }
  }

  for (const node of document.head.querySelectorAll('style, link[rel="stylesheet"]')) {
    copy(node)
  }

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) copy(node)
    }
  })
  observer.observe(document.head, { childList: true })
  return () => observer.disconnect()
}

/** 主题变量挂在 documentElement 的 data-theme 上，弹窗要跟着切 */
function syncTheme(doc: Document): () => void {
  const apply = (): void => {
    doc.documentElement.dataset.theme = document.documentElement.dataset.theme ?? 'dark'
    doc.documentElement.lang = document.documentElement.lang
  }
  apply()
  const observer = new MutationObserver(apply)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme', 'lang']
  })
  return () => observer.disconnect()
}

/**
 * 把弹窗里的指针事件转发到主窗口。
 * 画布类编辑器普遍把拖拽的 move/up 监听挂在主窗口 window 上，内容被 Teleport 出去后
 * 这些监听收不到事件；转发后坐标系与弹窗内元素的 getBoundingClientRect 仍然一致。
 * 键盘事件不转发，避免弹窗内输入触发主窗口快捷键。
 */
function relayPointerEvents(popup: Window): () => void {
  const disposers: Array<() => void> = []

  const relay = (type: string, clone: (event: Event) => Event | null): void => {
    const handler = (event: Event): void => {
      const cloned = clone(event)
      if (cloned) window.dispatchEvent(cloned)
    }
    popup.addEventListener(type, handler, true)
    disposers.push(() => popup.removeEventListener(type, handler, true))
  }

  for (const type of ['pointermove', 'pointerup', 'pointercancel']) {
    relay(type, (event) =>
      event instanceof PointerEvent ? new PointerEvent(event.type, pointerInit(event)) : null
    )
  }
  for (const type of ['mousemove', 'mouseup']) {
    relay(type, (event) =>
      event instanceof MouseEvent && !(event instanceof PointerEvent)
        ? new MouseEvent(event.type, mouseInit(event))
        : null
    )
  }

  return () => {
    for (const dispose of disposers) dispose()
  }
}

function mouseInit(event: MouseEvent): MouseEventInit {
  return {
    bubbles: true,
    cancelable: event.cancelable,
    clientX: event.clientX,
    clientY: event.clientY,
    screenX: event.screenX,
    screenY: event.screenY,
    button: event.button,
    buttons: event.buttons,
    ctrlKey: event.ctrlKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    metaKey: event.metaKey
  }
}

function pointerInit(event: PointerEvent): PointerEventInit {
  return {
    ...mouseInit(event),
    pointerId: event.pointerId,
    pointerType: event.pointerType,
    isPrimary: event.isPrimary,
    pressure: event.pressure
  }
}
