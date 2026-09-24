import { describe, expect, it } from 'vitest'
import {
  shouldPreventSidePanelDrop,
  shouldPreventSidePanelOverlay
} from '../src/renderer/src/editor/workbench/sidePanelCollapse'

function event(partial: {
  panelId?: string | null
  position: string
  kind?: string
  groupPanels?: string[]
}) {
  return {
    position: partial.position,
    kind: partial.kind,
    group: partial.groupPanels ? { panels: partial.groupPanels.map((id) => ({ id })) } : undefined,
    getData: () => (partial.panelId === undefined ? undefined : { panelId: partial.panelId })
  }
}

describe('shouldPreventSidePanelOverlay', () => {
  it('ignores non-side-panel drags', () => {
    expect(
      shouldPreventSidePanelOverlay(
        event({ panelId: 'workspace', position: 'center', groupPanels: ['workspace'] })
      )
    ).toBe(false)
  })

  it('allows stacking side panels top/bottom', () => {
    expect(
      shouldPreventSidePanelOverlay(
        event({ panelId: 'assets', position: 'bottom', groupPanels: ['inspector'] })
      )
    ).toBe(false)
    expect(
      shouldPreventSidePanelOverlay(
        event({ panelId: 'inspector', position: 'top', groupPanels: ['assets'] })
      )
    ).toBe(false)
  })

  it('blocks half-screen left/right overlays but allows center tab merge', () => {
    expect(
      shouldPreventSidePanelOverlay(
        event({ panelId: 'assets', position: 'left', groupPanels: ['inspector'] })
      )
    ).toBe(true)
    // center = merge into the other side panel's group (tab group), so it is allowed
    expect(
      shouldPreventSidePanelOverlay(
        event({ panelId: 'assets', position: 'center', groupPanels: ['inspector'] })
      )
    ).toBe(false)
  })

  it('blocks overlays onto workspace or edge docks', () => {
    expect(
      shouldPreventSidePanelOverlay(
        event({ panelId: 'assets', position: 'right', groupPanels: ['workspace'] })
      )
    ).toBe(true)
    expect(
      shouldPreventSidePanelOverlay(event({ panelId: 'assets', position: 'left', kind: 'edge' }))
    ).toBe(true)
  })

  it('blocks solo panel dropping onto itself (dockview would no-op after showing gray)', () => {
    expect(
      shouldPreventSidePanelOverlay(
        event({ panelId: 'inspector', position: 'bottom', groupPanels: ['inspector'] })
      )
    ).toBe(true)
    expect(
      shouldPreventSidePanelOverlay(
        event({ panelId: 'assets', position: 'top', groupPanels: ['assets'] })
      )
    ).toBe(true)
  })
})

describe('shouldPreventSidePanelDrop', () => {
  it('never cancels top/bottom/center even if target group looks non-side', () => {
    expect(
      shouldPreventSidePanelDrop(
        event({ panelId: 'inspector', position: 'bottom', groupPanels: ['workspace'] })
      )
    ).toBe(false)
    expect(
      shouldPreventSidePanelDrop(
        event({ panelId: 'inspector', position: 'top', groupPanels: ['assets'] })
      )
    ).toBe(false)
    expect(
      shouldPreventSidePanelDrop(
        event({ panelId: 'inspector', position: 'center', groupPanels: ['assets'] })
      )
    ).toBe(false)
  })

  it('still blocks left/right and edge drops for side panels', () => {
    expect(
      shouldPreventSidePanelDrop(
        event({ panelId: 'inspector', position: 'left', groupPanels: ['assets'] })
      )
    ).toBe(true)
    expect(
      shouldPreventSidePanelDrop(event({ panelId: 'inspector', position: 'bottom', kind: 'edge' }))
    ).toBe(true)
  })

  it('blocks solo self drops so gray cannot lie about a move', () => {
    expect(
      shouldPreventSidePanelDrop(
        event({ panelId: 'assets', position: 'bottom', groupPanels: ['assets'] })
      )
    ).toBe(true)
  })
})
