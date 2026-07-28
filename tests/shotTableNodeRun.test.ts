import { describe, expect, it } from 'vitest'
import { createNodeFromType, runGraph } from '../src/shared/graph'

const SPLIT_JSON = '[{"title":"镜1","visualDescription":"公园黄昏"}]'

const BOUND_SHOTS_JSON = JSON.stringify(
  [
    {
      title: '镜1',
      durationSec: 5,
      visualDescription: '公园黄昏',
      shotSize: '',
      lighting: '',
      dialogue: '',
      soundFx: '',
      cameraMove: '',
      status: '未审核',
      characters: [{ name: '老人', type: '角色', imageUrl: 'Cache/Images/old-man.png' }],
      scenes: [{ name: '公园黄昏', type: '场景', imageUrl: 'Cache/Images/park.png' }],
      props: [{ name: '旧书', type: '道具' }],
      weapons: []
    }
  ],
  null,
  2
)

/** 表格填充改到双击打开时做，节点执行只负责产出输出端口 */
describe('script.shotTable run', () => {
  it('passes the upstream split through without importing shots', async () => {
    const split = createNodeFromType('script.shotSplit', { x: 0, y: 0 }, { id: 'split' })
    const table = createNodeFromType('script.shotTable', { x: 200, y: 0 }, { id: 'table' })
    let imports = 0

    const result = await runGraph(
      {
        nodes: [split, table],
        edges: [
          { id: 'e1', source: 'split', target: 'table', sourcePort: 'out', targetPort: 'in' }
        ],
        viewport: { x: 0, y: 0, zoom: 1 }
      },
      {
        stepDelayMs: 1,
        targetNodeId: 'table',
        skipCompletedNodes: true,
        priorNodeStates: {
          split: {
            status: 'done',
            outputs: { out: { kind: 'shots', text: SPLIT_JSON } }
          }
        },
        importShotSplitTableJson: () => {
          imports += 1
        }
      }
    )

    expect(result.ok, result.error).toBe(true)
    expect(imports).toBe(0)
    expect(result.states.table?.outputs?.out).toMatchObject({
      kind: 'shots',
      text: SPLIT_JSON
    })
    expect(table.params.text).toBe(SPLIT_JSON)
  })

  it('prefers live shots with bound world entities over upstream split', async () => {
    const split = createNodeFromType('script.shotSplit', { x: 0, y: 0 }, { id: 'split' })
    const table = createNodeFromType('script.shotTable', { x: 200, y: 0 }, { id: 'table' })

    const result = await runGraph(
      {
        nodes: [split, table],
        edges: [
          { id: 'e1', source: 'split', target: 'table', sourcePort: 'out', targetPort: 'in' }
        ],
        viewport: { x: 0, y: 0, zoom: 1 }
      },
      {
        stepDelayMs: 1,
        targetNodeId: 'table',
        skipCompletedNodes: true,
        priorNodeStates: {
          split: {
            status: 'done',
            outputs: { out: { kind: 'shots', text: SPLIT_JSON } }
          }
        },
        resolveShotSplitTableJson: () => BOUND_SHOTS_JSON
      }
    )

    expect(result.ok, result.error).toBe(true)
    expect(result.states.table?.outputs?.out).toMatchObject({
      kind: 'shots',
      text: BOUND_SHOTS_JSON
    })
    expect(table.params.text).toContain('"name": "老人"')
    expect(table.params.text).toContain('"name": "公园黄昏"')
    expect(table.params.text).toContain('"name": "旧书"')
  })
})
