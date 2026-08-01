import { describe, expect, it } from 'vitest'
import { shouldPreventSidePanelOverlay } from '../src/renderer/src/editor/workbench/sidePanelCollapse'

function event(partial: {
  panelId?: string | null
  position: string
  kind?: string
  groupPanels?: string[]
}) {
  return {
    position: partial.position,
    kind: partial.kind,
    group: partial.groupPanels
      ? { panels: partial.groupPanels.map((id) => ({ id })) }
      : undefined,
    getData: () =>
      partial.panelId === undefined ? undefined : { panelId: partial.panelId }
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

  it('blocks half-screen left/right/center overlays on the other side panel', () => {
    expect(
      shouldPreventSidePanelOverlay(
        event({ panelId: 'assets', position: 'left', groupPanels: ['inspector'] })
      )
    ).toBe(true)
    expect(
      shouldPreventSidePanelOverlay(
        event({ panelId: 'assets', position: 'center', groupPanels: ['inspector'] })
      )
    ).toBe(true)
  })

  it('blocks overlays onto workspace or edge docks', () => {
    expect(
      shouldPreventSidePanelOverlay(
        event({ panelId: 'assets', position: 'right', groupPanels: ['workspace'] })
      )
    ).toBe(true)
    expect(
      shouldPreventSidePanelOverlay(
        event({ panelId: 'assets', position: 'left', kind: 'edge' })
      )
    ).toBe(true)
  })
})
