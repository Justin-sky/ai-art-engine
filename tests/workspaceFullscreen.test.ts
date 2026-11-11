import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  enterChatFullscreen,
  enterWorkspaceFullscreen,
  exitChatFullscreen,
  exitWorkspaceFullscreen,
  installWorkspaceFullscreenListeners,
  toggleChatFullscreen,
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
    exitChatFullscreen()
    cleanup = installWorkspaceFullscreenListeners()
  })

  afterEach(() => {
    cleanup?.()
    cleanup = null
    exitWorkspaceFullscreen()
    exitChatFullscreen()
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

  it('supports dedicated AI Chat fullscreen toggle, mutual exclusion with workspace fullscreen, and Esc/F11 exit', async () => {
    const { isWorkspaceFullscreen, isChatFullscreen, isNativeHtmlFullscreen } =
      useWorkspaceFullscreen()

    expect(isChatFullscreen.value).toBe(false)
    const active = toggleChatFullscreen()
    expect(active).toBe(true)
    expect(isChatFullscreen.value).toBe(true)
    expect(isWorkspaceFullscreen.value).toBe(false)
    await Promise.resolve()
    expect(isNativeHtmlFullscreen.value).toBe(true)

    // Switching to workspace fullscreen exits chat fullscreen cleanly
    enterWorkspaceFullscreen({ requestBrowserFullscreen: false })
    expect(isWorkspaceFullscreen.value).toBe(true)
    expect(isChatFullscreen.value).toBe(false)

    // Switching back to chat fullscreen exits workspace fullscreen cleanly
    enterChatFullscreen({ requestBrowserFullscreen: false })
    expect(isChatFullscreen.value).toBe(true)
    expect(isWorkspaceFullscreen.value).toBe(false)

    // Exit native HTML fullscreen mock so we can verify windowed Escape exit on chat fullscreen
    mockFullscreenEl = null
    docTarget.dispatchEvent(new Event('fullscreenchange'))
    expect(isChatFullscreen.value).toBe(false)

    enterChatFullscreen({ requestBrowserFullscreen: false })
    expect(isChatFullscreen.value).toBe(true)
    winTarget.dispatchEvent(
      new KeyEvent('keydown', { key: 'Escape', target: { closest: () => null } })
    )
    expect(isChatFullscreen.value).toBe(false)

    // F11 inside .chat-panel enters chat fullscreen and next F11 exits it
    winTarget.dispatchEvent(
      new KeyEvent('keydown', {
        key: 'F11',
        target: { closest: (sel: string) => (sel === '.chat-panel' ? {} : null) }
      })
    )
    expect(isChatFullscreen.value).toBe(true)
    winTarget.dispatchEvent(new KeyEvent('keydown', { key: 'F11' }))
    expect(isChatFullscreen.value).toBe(false)
  })

  it('places AI Chat fullscreen button on the far right of the AI Chat Dockview tab header instead of top toolbar', () => {
    const studioSrc = readFileSync(resolve('src/renderer/src/views/StudioView.vue'), 'utf8')
    const rightActionsSrc = readFileSync(
      resolve('src/renderer/src/components/EditorDockRightActions.vue'),
      'utf8'
    )

    expect(studioSrc).not.toContain('<WorkspaceFullscreenBtn')
    expect(studioSrc).toContain(':right-header-actions-component="dockRightHeaderActionsComponent"')
    expect(studioSrc).toContain('watch(isChatFullscreen')
    expect(studioSrc).toContain('api.maximizeGroup(chatPanel)')

    expect(rightActionsSrc).toContain("activePanelId.value === 'chat'")
    expect(rightActionsSrc).toContain('class="chat-tab-fullscreen-btn"')
    expect(rightActionsSrc).toContain('toggleChatFullscreen()')
  })
})
