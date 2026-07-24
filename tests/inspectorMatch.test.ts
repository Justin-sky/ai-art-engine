import { describe, expect, it } from 'vitest'
import { matchesInspectorTarget } from '../src/renderer/src/inspector/match'
import type { InspectorDefinition, InspectorTarget } from '../src/renderer/src/inspector/types'
import type { GraphNode } from '../src/shared/graph'

function graphNodeTarget(node: GraphNode, inspector: string): InspectorTarget {
  return {
    kind: 'graph.node',
    key: node.id,
    subject: node,
    graphNodeType: { inspector } as InspectorTarget['graphNodeType']
  }
}

describe('inspector match', () => {
  const processingNode: GraphNode = {
    id: 'n1',
    typeId: 'asset.image',
    category: 'asset',
    assetType: 'image',
    position: { x: 0, y: 0 },
    params: {}
  }

  const refNode: GraphNode = {
    ...processingNode,
    id: 'n2',
    assetId: 'asset-1',
    params: { assetRef: true }
  }

  it('matches asset processing inspector', () => {
    const def: InspectorDefinition = {
      id: 'studio.graph.asset',
      component: {} as InspectorDefinition['component'],
      nodeInspectorKind: 'asset',
      nodeAssetRef: false
    }
    expect(matchesInspectorTarget(def, graphNodeTarget(processingNode, 'asset'))).toBe(true)
    expect(matchesInspectorTarget(def, graphNodeTarget(refNode, 'asset'))).toBe(false)
  })

  it('treats assetId without params.assetRef as asset ref', () => {
    const legacyRef: GraphNode = {
      ...processingNode,
      id: 'n3',
      assetId: 'asset-legacy',
      params: {}
    }
    const refDef: InspectorDefinition = {
      id: 'studio.graph.assetRef',
      component: {} as InspectorDefinition['component'],
      nodeInspectorKind: 'asset',
      nodeAssetRef: true
    }
    const editDef: InspectorDefinition = {
      id: 'studio.graph.asset',
      component: {} as InspectorDefinition['component'],
      nodeInspectorKind: 'asset',
      nodeAssetRef: false
    }
    expect(matchesInspectorTarget(refDef, graphNodeTarget(legacyRef, 'asset'))).toBe(true)
    expect(matchesInspectorTarget(editDef, graphNodeTarget(legacyRef, 'asset'))).toBe(false)
  })

  it('matches by node type id', () => {
    const def: InspectorDefinition = {
      id: 'plugin.custom',
      component: {} as InspectorDefinition['component'],
      nodeTypeId: 'asset.motion'
    }
    const motionNode: GraphNode = {
      id: 'motion-edit',
      typeId: 'asset.motion',
      category: 'asset',
      assetType: 'motion',
      position: { x: 0, y: 0 },
      params: {}
    }
    expect(matchesInspectorTarget(def, graphNodeTarget(motionNode, 'camera'))).toBe(true)
    expect(matchesInspectorTarget(def, graphNodeTarget(processingNode, 'asset'))).toBe(false)
  })
})
