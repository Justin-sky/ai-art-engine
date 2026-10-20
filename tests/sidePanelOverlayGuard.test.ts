import { describe, expect, it } from 'vitest'
import type { DockviewApi } from 'dockview-vue'
import {
  rebalanceHorizontalColumns,
  setChatPanelVisible,
  shouldPreventSidePanelDrop,
  shouldPreventSidePanelOverlay,
  sidePanelCollapsed
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

describe('rebalanceHorizontalColumns & setChatPanelVisible', () => {
  function createMockDock(totalWidth = 1600) {
    const calls: Array<{ id: string; width: number }> = []
    const makePanel = (id: string, initialW: number, visible = true) => {
      const state = { width: initialW, isVisible: visible }
      const groupApi = {
        setVisible(v: boolean) {
          state.isVisible = v
        }
      }
      const group = { id: `group-${id}`, api: groupApi }
      return {
        id,
        group,
        api: {
          id,
          get width() {
            return state.width
          },
          get isVisible() {
            return state.isVisible
          },
          group,
          setActive() {},
          setSize({ width }: { width: number }) {
            state.width = width
            calls.push({ id, width })
          }
        }
      }
    }
    const panels: Record<string, ReturnType<typeof makePanel>> = {
      assets: makePanel('assets', 270, true),
      workspace: makePanel('workspace', 700, true),
      inspector: makePanel('inspector', 290, true),
      chat: makePanel('chat', 340, true)
    }
    const dock = {
      width: totalWidth,
      getPanel(id: string) {
        return panels[id]
      }
    } as unknown as DockviewApi
    return { dock, panels, calls }
  }

  it('sizes columns strictly left-to-right so inspector and chat never steal from each other', () => {
    sidePanelCollapsed.assets = false
    sidePanelCollapsed.inspector = false
    const { dock, calls } = createMockDock(1600)
    rebalanceHorizontalColumns(dock, { assets: 270, inspector: 290, chat: 340 })
    expect(calls).toEqual([
      { id: 'assets', width: 270 },
      { id: 'workspace', width: 700 },
      { id: 'inspector', width: 290 },
      { id: 'chat', width: 340 }
    ])
  })

  it('preserves inspector width and transfers chat width to/from workspace when toggling chat', () => {
    sidePanelCollapsed.assets = false
    sidePanelCollapsed.inspector = false
    const { dock, panels } = createMockDock(1600)

    // Hide chat: workspace absorbs 340px (700 -> 1040), inspector stays 290px
    setChatPanelVisible(dock, false, 340)
    expect(panels.chat.api.isVisible).toBe(false)
    expect(panels.assets.api.width).toBe(270)
    expect(panels.inspector.api.width).toBe(290)
    expect(panels.workspace.api.width).toBe(1040)

    // Show chat again: workspace yields 340px (1040 -> 700), inspector stays 290px, chat restores 340px
    setChatPanelVisible(dock, true, 340)
    expect(panels.chat.api.isVisible).toBe(true)
    expect(panels.assets.api.width).toBe(270)
    expect(panels.inspector.api.width).toBe(290)
    expect(panels.chat.api.width).toBe(340)
    expect(panels.workspace.api.width).toBe(700)
  })
})
