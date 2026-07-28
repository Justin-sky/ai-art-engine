import { describe, expect, it } from 'vitest'
import { extractShotTableWorldEntities, type GraphDocument } from '../src/shared/graph'

const ENTITIES = JSON.stringify([
  { type: '角色', name: '老人', imageUrl: 'Cache/Images/old-man.png' },
  { type: '场景', name: '公园黄昏', imageUrl: 'Cache/Images/park.png' }
])

function docWithUpstream(sourceParams: Record<string, unknown>): GraphDocument {
  return {
    nodes: [
      { id: 'table', typeId: 'script.shotTable', params: {} },
      { id: 'world-in', typeId: 'graph.boundary.input', params: sourceParams }
    ],
    edges: [
      {
        id: 'e1',
        source: 'world-in',
        target: 'table',
        sourcePort: 'out',
        targetPort: 'in-worldEntities'
      }
    ],
    groups: []
  } as unknown as GraphDocument
}

/** 绑定候选项过去只来自表格节点运行后的缓存，未运行时绑定面板为空 */
describe('extractShotTableWorldEntities', () => {
  it('reads entities from the in-worldEntities upstream text', () => {
    const items = extractShotTableWorldEntities(docWithUpstream({ text: ENTITIES }))
    expect(items.map((item) => item.name)).toEqual(['老人', '公园黄昏'])
    expect(items[0]).toMatchObject({ type: '角色', imageUrl: 'Cache/Images/old-man.png' })
  })

  it('reads entities cached on the upstream node params', () => {
    const items = extractShotTableWorldEntities(
      docWithUpstream({
        worldElementOutputs: [
          { type: '道具', name: '旧书', imageUrl: 'Cache/Images/book.png' },
          { type: '道具', name: '', imageUrl: 'Cache/Images/blank.png' }
        ]
      })
    )
    expect(items).toEqual([
      { type: '道具', name: '旧书', imageUrl: 'Cache/Images/book.png' }
    ])
  })

  it('falls back to the upstream run output', () => {
    const doc = docWithUpstream({})
    doc.runStates = {
      'world-in': {
        status: 'done',
        outputs: { out: { kind: 'worldEntities', text: ENTITIES } }
      }
    }
    expect(extractShotTableWorldEntities(doc).map((item) => item.type)).toEqual(['角色', '场景'])
  })

  it('merges the table node cache with upstream and de-dupes', () => {
    const doc = docWithUpstream({ text: ENTITIES })
    doc.nodes[0]!.params = {
      worldElementOutputs: [
        { type: '角色', name: '老人', imageUrl: 'Cache/Images/old-man.png' },
        { type: '武器', name: '匕首', imageUrl: 'Cache/Images/knife.png' }
      ]
    }
    expect(extractShotTableWorldEntities(doc).map((item) => item.name)).toEqual([
      '老人',
      '匕首',
      '公园黄昏'
    ])
  })

  it('returns nothing when the graph has no shot table', () => {
    expect(extractShotTableWorldEntities(null)).toEqual([])
    expect(
      extractShotTableWorldEntities({ nodes: [], edges: [], groups: [] } as unknown as GraphDocument)
    ).toEqual([])
  })
})
