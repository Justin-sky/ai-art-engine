import { describe, expect, it } from 'vitest'
import { resolveGraphInspectorId } from '../src/renderer/src/inspector/defaults'

describe('graph inspector defaults', () => {
  it('resolves asset ref vs processing inspectors', () => {
    expect(
      resolveGraphInspectorId(
        { inspector: 'asset' },
        { category: 'asset', params: { assetRef: true } }
      )
    ).toBe('studio.graph.assetRef')
    expect(
      resolveGraphInspectorId(
        { inspector: 'asset' },
        { category: 'asset', assetId: 'a1', params: {} }
      )
    ).toBe('studio.graph.assetRef')
    expect(
      resolveGraphInspectorId({ inspector: 'asset' }, { category: 'asset', params: {} })
    ).toBe('studio.graph.asset')
  })

  it('prefers explicit inspectorId on node type', () => {
    expect(
      resolveGraphInspectorId(
        { inspector: 'asset', inspectorId: 'plugin.custom' },
        { category: 'asset', params: {} }
      )
    ).toBe('plugin.custom')
  })

  it('resolves shot / world table inspector ids', () => {
    expect(
      resolveGraphInspectorId(
        { inspector: 'none', inspectorId: 'studio.graph.shotTable' },
        { category: 'note', typeId: 'script.shotTable', params: {} }
      )
    ).toBe('studio.graph.shotTable')
    expect(
      resolveGraphInspectorId(
        { inspector: 'none', inspectorId: 'studio.graph.worldTable' },
        { category: 'note', typeId: 'world.table', params: {} }
      )
    ).toBe('studio.graph.worldTable')
  })
})
