import { describe, expect, it } from 'vitest'
import {
  createDefaultScopedGraph,
  getNodePorts,
  isProcessingAssetNode,
  normalizeScopedGraph
} from '../src/shared/graph'
import { graphOutputNodeId } from '../src/shared/graph/types'

const IMAGE_OUTPUT_ID = graphOutputNodeId('image')

describe('director asset graph', () => {
  it('creates default processing node wired to director output', () => {
    const doc = createDefaultScopedGraph('directorAsset', 'motion')
    const processing = doc.nodes.find((node) => node.typeId === 'asset.motion')
    const output = doc.nodes.find((node) => node.id === IMAGE_OUTPUT_ID)
    expect(processing && isProcessingAssetNode(processing)).toBe(true)
    expect(output?.params.outputKind).toBe('image')
    expect(output?.params.inputDataType).toBe('image')
    expect(getNodePorts(processing!).some((p) => p.direction === 'out' && p.dataType === 'image')).toBe(
      true
    )
    expect(getNodePorts(processing!).filter((p) => p.direction === 'in')).toEqual([])
    expect(
      doc.edges.some(
        (edge) =>
          edge.source === processing?.id &&
          edge.target === IMAGE_OUTPUT_ID &&
          edge.targetPort === 'in'
      )
    ).toBe(true)
  })

  it('normalizes empty graph with processing chain', () => {
    const doc = normalizeScopedGraph('directorAsset', null, { assetType: 'motion' })
    expect(doc.nodes.some((n) => n.typeId === 'asset.motion' && isProcessingAssetNode(n))).toBe(true)
    expect(doc.nodes.some((n) => n.category === 'output')).toBe(true)
    expect(doc.edges.length).toBeGreaterThan(0)
  })
})
