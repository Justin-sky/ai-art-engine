import { describe, expect, it } from 'vitest'
import { stripPanelsFromDockLayout } from '../src/renderer/src/utils/studioLayouts'

describe('stripPanelsFromDockLayout', () => {
  it('removes panel entries and matching grid views so fromJSON stays valid', () => {
    const data = {
      grid: {
        root: {
          type: 'branch',
          data: [
            {
              type: 'leaf',
              data: {
                id: 'group-shell',
                views: ['workspace', 'assets'],
                activeView: 'workspace'
              },
              size: 1
            },
            {
              type: 'leaf',
              data: {
                id: 'group-editor',
                views: ['script-editor-asset-1'],
                activeView: 'script-editor-asset-1'
              },
              size: 1
            }
          ]
        },
        width: 1200,
        height: 800,
        orientation: 'HORIZONTAL'
      },
      panels: {
        workspace: { id: 'workspace', contentComponent: 'workspace' },
        assets: { id: 'assets', contentComponent: 'assets' },
        'script-editor-asset-1': {
          id: 'script-editor-asset-1',
          contentComponent: 'script'
        }
      }
    }

    const next = stripPanelsFromDockLayout(data, (id) => id.startsWith('script-editor-'))

    expect(next.panels).toEqual({
      workspace: data.panels.workspace,
      assets: data.panels.assets
    })
    expect(next.grid).toEqual({
      root: {
        type: 'branch',
        data: [
          {
            type: 'leaf',
            data: {
              id: 'group-shell',
              views: ['workspace', 'assets'],
              activeView: 'workspace'
            },
            size: 1
          }
        ],
        size: 1
      },
      width: 1200,
      height: 800,
      orientation: 'HORIZONTAL'
    })
  })

  it('drops a panel from a mixed group and reassigns activeView', () => {
    const data = {
      grid: {
        root: {
          type: 'branch',
          data: [
            {
              type: 'leaf',
              data: {
                id: 'group-1',
                views: ['inspector', 'world-editor-w1'],
                activeView: 'world-editor-w1'
              }
            }
          ]
        },
        width: 800,
        height: 600,
        orientation: 'HORIZONTAL'
      },
      panels: {
        inspector: { id: 'inspector', contentComponent: 'inspector' },
        'world-editor-w1': { id: 'world-editor-w1', contentComponent: 'world' }
      }
    }

    const next = stripPanelsFromDockLayout(data, (id) => id.startsWith('world-editor-'))
    const leaf = (next.grid as { root: { data: unknown[] } }).root.data[0] as {
      data: { views: string[]; activeView: string }
    }
    expect(Object.keys(next.panels as object)).toEqual(['inspector'])
    expect(leaf.data.views).toEqual(['inspector'])
    expect(leaf.data.activeView).toBe('inspector')
  })

  it('heals layouts that lost panel entries but still reference them in views', () => {
    const data = {
      grid: {
        root: {
          type: 'branch',
          data: [
            {
              type: 'leaf',
              data: {
                id: 'group-1',
                views: ['workspace', 'script-editor-gone'],
                activeView: 'script-editor-gone'
              }
            }
          ]
        },
        width: 800,
        height: 600,
        orientation: 'HORIZONTAL'
      },
      panels: {
        workspace: { id: 'workspace', contentComponent: 'workspace' }
      }
    }

    const next = stripPanelsFromDockLayout(data, () => false)
    const leaf = (next.grid as { root: { data: Array<{ data: { views: string[]; activeView: string } }> } })
      .root.data[0]
    expect(leaf.data.views).toEqual(['workspace'])
    expect(leaf.data.activeView).toBe('workspace')
  })
})
