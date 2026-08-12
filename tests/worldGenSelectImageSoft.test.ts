import { describe, expect, it } from 'vitest'
import {
  createNodeFromType,
  ensureBuiltinNodeTypes,
  runGraph,
  softResolveSourceOutput,
  type GraphDocument,
  type WorldElementGenResult
} from '../src/shared/graph'

ensureBuiltinNodeTypes()

describe('world.gen → image.select soft images', () => {
  it('softResolve falls back to resolveWorldElementOutputs when params empty', () => {
    const gen = createNodeFromType('world.gen', { x: 0, y: 0 })
    const doc: GraphDocument = { nodes: [gen], edges: [] }
    const entities: WorldElementGenResult[] = [
      { type: '角色', name: 'Ada', imageUrl: 'Assets/ada.png' }
    ]
    const value = softResolveSourceOutput(doc, gen.id, 'out-characters', {
      resolveWorldElementOutputs: () => entities
    })
    expect(value?.kind).toBe('images')
    if (value?.kind === 'images') {
      expect(value.items).toEqual([
        { id: '角色:Ada:0', title: 'Ada', dataUrl: '', relativePath: 'Assets/ada.png' }
      ])
    }
  })

  it('onlyTarget soft-snapshot does not treat empty image-group outs as usable', async () => {
    const gen = createNodeFromType('world.gen', { x: 0, y: 0 })
    const select = createNodeFromType('image.select', { x: 240, y: 0 })
    const doc: GraphDocument = {
      nodes: [gen, select],
      edges: [
        {
          id: 'e1',
          source: gen.id,
          target: select.id,
          sourcePort: 'out-characters',
          targetPort: 'in'
        }
      ]
    }
    const entities: WorldElementGenResult[] = [
      { type: '角色', name: 'Ada', imageUrl: 'Assets/ada.png' }
    ]
    const result = await runGraph(doc, {
      targetNodeId: select.id,
      onlyTargetNode: true,
      priorNodeStates: {
        [gen.id]: {
          status: 'done',
          outputs: {
            'out-characters': { kind: 'images', items: [] },
            'out-scenes': { kind: 'images', items: [] },
            'out-props': { kind: 'images', items: [] },
            'out-weapons': { kind: 'images', items: [] }
          }
        }
      },
      resolveWorldElementOutputs: () => entities
    })
    expect(result.ok).toBe(true)
    const out = result.states[select.id]?.outputs?.out
    expect(out?.kind).toBe('image')
    if (out?.kind === 'image') {
      expect(out.relativePath).toBe('Assets/ada.png')
    }
  })
})
