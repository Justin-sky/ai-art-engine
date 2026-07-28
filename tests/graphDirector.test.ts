import { describe, expect, it } from 'vitest'
import {
  createDefaultScopedGraph,
  getNodePorts,
  isProcessingAssetNode,
  normalizeScopedGraph
} from '../src/shared/graph'

describe('director asset graph', () => {
  it('creates default processing node without classic output', () => {
    const doc = createDefaultScopedGraph('directorAsset', 'motion')
    const processing = doc.nodes.find((node) => node.typeId === 'asset.motion')
    expect(processing && isProcessingAssetNode(processing)).toBe(true)
    expect(doc.nodes.some((node) => node.category === 'output')).toBe(false)
    expect(getNodePorts(processing!).some((p) => p.direction === 'out' && p.dataType === 'image')).toBe(
      true
    )
    expect(getNodePorts(processing!).filter((p) => p.direction === 'in')).toEqual([])
    expect(doc.edges).toHaveLength(0)
  })

  it('normalizes empty graph with processing node only', () => {
    const doc = normalizeScopedGraph('directorAsset', null, { assetType: 'motion' })
    expect(doc.nodes.some((n) => n.typeId === 'asset.motion' && isProcessingAssetNode(n))).toBe(true)
    expect(doc.nodes.some((n) => n.category === 'output')).toBe(false)
    expect(doc.edges).toHaveLength(0)
  })
})
