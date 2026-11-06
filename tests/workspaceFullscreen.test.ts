import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  enterWorkspaceFullscreen,
  exitWorkspaceFullscreen,
  installWorkspaceFullscreenListeners,
  toggleWorkspaceFullscreen,
  useWorkspaceFullscreen
} from '../src/renderer/src/composables/useWorkspaceFullscreen'

class KeyEvent extends Event {
  key: string
  override target: unknown
  constructor(type: string, init: { key: string; target?: unknown }) {
    super(type, { cancelable: true })
    this.key = init.key
    if (init.target !== undefined) {
      Object.defineProperty(this, 'target', { value: init.target })
    }
  }
}

describe('useWorkspaceFullscreen', () => {
  let cleanup: (() => void) | null = null
  let mockFullscreenEl: object | null = null
  let openDialogSelectorMatch: object | null = null
  let winTarget: EventTarget
  let docTarget: EventTarget & {
    fullscreenElement: object | null
    documentElement: { requestFullscreen: () => Promise<void> }
    exitFullscreen: () => Promise<void>
    querySelector: (sel: string) => object | null
  }

  beforeEach(() => {
    mockFullscreenEl = null
    openDialogSelectorMatch = null
    winTarget = new EventTarget()
    const baseDoc = new EventTarget()
    const docEl = {
      requestFullscreen: vi.fn(async () => {
        mockFullscreenEl = docEl
        baseDoc.dispatchEvent(new Event('fullscreenchange'))
      })
    }
    docTarget = Object.assign(baseDoc, {
      documentElement: docEl,
      exitFullscreen: vi.fn(async () => {
        mockFullscreenEl = null
        baseDoc.dispatchEvent(new Event('fullscreenchange'))
      }),
      querySelector: (_sel: string) => openDialogSelectorMatch
    }) as typeof docTarget
    Object.defineProperty(docTarget, 'fullscreenElement', {
      configurable: true,
      get: () => mockFullscreenEl
    })
    vi.stubGlobal('window', winTarget)
    vi.stubGlobal('document', docTarget)
    exitWorkspaceFullscreen()
    cleanup = installWorkspaceFullscreenListeners()
  })

  afterEach(() => {
    cleanup?.()
    cleanup = null
    exitWorkspaceFullscreen()
    vi.unstubAllGlobals()
  })

  it('toggles workspace and native HTML fullscreen in sync', async () => {
    const { isWorkspaceFullscreen, isNativeHtmlFullscreen } = useWorkspaceFullscreen()
    expect(isWorkspaceFullscreen.value).toBe(false)
    expect(isNativeHtmlFullscreen.value).toBe(false)

    const active = toggleWorkspaceFullscreen()
    expect(active).toBe(true)
    expect(isWorkspaceFullscreen.value).toBe(true)
    await Promise.resolve()
    expect(isNativeHtmlFullscreen.value).toBe(true)
    expect(docTarget.documentElement.requestFullscreen).toHaveBeenCalledTimes(1)

    // Simulating OS-level Escape exiting browser fullscreen should also exit workspace fullscreen
    mockFullscreenEl = null
    docTarget.dispatchEvent(new Event('fullscreenchange'))
    expect(isNativeHtmlFullscreen.value).toBe(false)
    expect(isWorkspaceFullscreen.value).toBe(false)
  })

  it('supports F11 toggle and windowed Escape exit while ignoring inputs/dialogs', () => {
    const { isWorkspaceFullscreen } = useWorkspaceFullscreen()

    // Enter windowed immersive mode (without browser native fullscreen)
    enterWorkspaceFullscreen({ requestBrowserFullscreen: false })
    expect(isWorkspaceFullscreen.value).toBe(true)

    // Escape inside an <input> must NOT exit fullscreen
    const inputTarget = {
      closest: (sel: string) => (sel.includes('input') ? {} : null)
    }
    winTarget.dispatchEvent(new KeyEvent('keydown', { key: 'Escape', target: inputTarget }))
    expect(isWorkspaceFullscreen.value).toBe(true)

    // Escape when a dialog is open must NOT exit fullscreen
    openDialogSelectorMatch = {}
    winTarget.dispatchEvent(
      new KeyEvent('keydown', { key: 'Escape', target: { closest: () => null } })
    )
    expect(isWorkspaceFullscreen.value).toBe(true)
    openDialogSelectorMatch = null

    // Escape on general workspace exits windowed fullscreen
    winTarget.dispatchEvent(
      new KeyEvent('keydown', { key: 'Escape', target: { closest: () => null } })
    )
    expect(isWorkspaceFullscreen.value).toBe(false)

    // F11 toggles fullscreen on and off
    winTarget.dispatchEvent(new KeyEvent('keydown', { key: 'F11' }))
    expect(isWorkspaceFullscreen.value).toBe(true)
    winTarget.dispatchEvent(new KeyEvent('keydown', { key: 'F11' }))
    expect(isWorkspaceFullscreen.value).toBe(false)
  })
})
