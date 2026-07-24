import { describe, expect, it } from 'vitest'
import { createDefaultDirectorStage } from '../src/shared/domain'
import { createNodeFromType } from '../src/shared/graph'
import {
  createFreshDirectorStage,
  patchGenParamsWithNodeStage,
  readStagesByNodeId,
  removeNodeStagesFromGenParams,
  resolveDirectorStageForNode,
  resolveDirectorStageFromAsset,
  shouldResetDirectorStage
} from '../src/renderer/src/features/director/directorStageBinding'

describe('directorStageBinding', () => {
  it('keeps independent stages per processing node', () => {
    const nodeA = createNodeFromType('asset.motion', { x: 0, y: 0 })
    const nodeB = createNodeFromType('asset.motion', { x: 120, y: 0 })
    const stageA = createFreshDirectorStage(nodeA)
    stageA.objects = [
      {
        id: 'obj-a',
        name: 'A',
        kind: 'primitive',
        primitive: 'box',
        position: { x: 1, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 }
      }
    ]
    let genParams = patchGenParamsWithNodeStage({}, nodeA.id, stageA)
    const stageB = createFreshDirectorStage(nodeB)
    genParams = patchGenParamsWithNodeStage(genParams, nodeB.id, stageB)
    const graphJson = {
      nodes: [nodeA, nodeB],
      edges: [],
      groups: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    }

    const resolvedA = resolveDirectorStageForNode(genParams, graphJson, nodeA.id)
    const resolvedB = resolveDirectorStageForNode(genParams, graphJson, nodeB.id)
    expect(resolvedA.objects).toHaveLength(1)
    expect(resolvedA.objects[0]?.id).toBe('obj-a')
    expect(resolvedB.objects).toHaveLength(0)
    expect(resolvedB.ownerProcessingNodeId).toBe(nodeB.id)
  })

  it('migrates legacy single stage into node map', () => {
    const node = createNodeFromType('asset.motion', { x: 0, y: 0 })
    const stage = createDefaultDirectorStage()
    stage.objects = [
      {
        id: 'obj-1',
        name: 'Box',
        kind: 'primitive',
        primitive: 'box',
        position: { x: 2, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 }
      }
    ]
    const genParams = { stage }
    const graphJson = { nodes: [node], edges: [], groups: [], viewport: { x: 0, y: 0, zoom: 1 } }
    const map = readStagesByNodeId(genParams, graphJson)
    expect(map[node.id]?.objects).toHaveLength(1)
    const resolved = resolveDirectorStageFromAsset(genParams, graphJson)
    expect(resolved.objects).toHaveLength(1)
    expect(resolved.ownerProcessingNodeId).toBe(node.id)
  })

  it('removes only deleted node stages', () => {
    const nodeA = createNodeFromType('asset.motion', { x: 0, y: 0 })
    const nodeB = createNodeFromType('asset.motion', { x: 120, y: 0 })
    let genParams = patchGenParamsWithNodeStage({}, nodeA.id, createFreshDirectorStage(nodeA))
    genParams = patchGenParamsWithNodeStage(genParams, nodeB.id, createFreshDirectorStage(nodeB))
    const next = removeNodeStagesFromGenParams(genParams, [nodeA.id])
    const map = readStagesByNodeId(next)
    expect(map[nodeA.id]).toBeUndefined()
    expect(map[nodeB.id]).toBeTruthy()
  })

  it('resets stage when owner node id no longer exists in graph', () => {
    const oldNode = createNodeFromType('asset.motion', { x: 0, y: 0 })
    const newNode = createNodeFromType('asset.motion', { x: 120, y: 0 })
    expect(shouldResetDirectorStage(oldNode.id, newNode.id)).toBe(true)
  })

  it('creates fresh stage bound to processing node', () => {
    const node = createNodeFromType('asset.motion', { x: 0, y: 0 })
    node.params.viewer = {
      position: { x: 1, y: 2, z: 3 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      target: { x: 0, y: 1, z: 0 },
      fov: 55
    }
    const stage = createFreshDirectorStage(node)
    expect(stage.ownerProcessingNodeId).toBe(node.id)
    expect(stage.viewer?.fov).toBe(55)
  })
})
