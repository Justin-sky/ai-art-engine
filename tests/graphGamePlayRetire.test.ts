import { describe, expect, it } from 'vitest'
import { getNodeType, listAddableNodeTypes, normalizeScopedGraph } from '../src/shared/graph'
import type { GraphDocument, GraphNode } from '../src/shared/graph/types'

/**
 * `game.htmlGen` 已随「游戏生成改由 AI 对话面板驱动」（MCP gameplay_* 工具）下线。
 *
 * 旧工程里的节点不能丢、也不能留成未知类型（`inferNodeTypeId` 对 `category: 'note'`
 * 会兜底成 `note.text`，那是个隐式的、没人解释得清的行为）。这里守住显式迁移：
 * 迁成备注、保留标题与玩法需求全文、清掉工程参数。
 *
 * `asset.gamePlay` 则**保留类型注册但不可添加**：旧图里的节点还要能显示、能双击试玩，
 * 而 `inferNodeTypeId` 会由 `assetType: 'gamePlay'` 推回本类型——硬删只会留下未知 def。
 */
function retiredNode(partial: Partial<GraphNode> = {}): GraphNode {
  return {
    id: 'gen-1',
    typeId: 'game.htmlGen',
    category: 'note',
    title: '可玩 HTML 生成',
    x: 0,
    y: 0,
    width: 200,
    height: 120,
    params: {
      generateInstruction: '低多边形太空站捡能量块',
      gamePlayMode: '3d',
      gamePlayProjectDir: 'Cache/GamePlayJobs/old/project',
      gamePlayHtml: ''
    },
    ...partial
  } as GraphNode
}

function doc(nodes: GraphNode[], edges: GraphDocument['edges'] = []): GraphDocument {
  return {
    nodes,
    edges,
    viewport: { x: 0, y: 0, zoom: 1 }
  } as GraphDocument
}

describe('game.htmlGen 下线迁移', () => {
  it('迁成备注节点：保留玩法需求全文，清掉工程参数，标题加说明', () => {
    const graph = normalizeScopedGraph('workflow', doc([retiredNode()]))
    const node = graph.nodes.find((item) => item.id === 'gen-1')
    expect(node?.typeId).toBe('note.text')
    expect(node?.category).toBe('note')
    expect(node?.params.text).toBe('低多边形太空站捡能量块')
    // 游戏专属参数直接删掉（不是留空串），免得备注里拖着一堆无用键
    expect(node?.params.gamePlayProjectDir).toBeUndefined()
    expect(node?.params.gamePlayHtml).toBeUndefined()
    expect(node?.params.gamePlayMode).toBeUndefined()
    expect(node?.params.generateInstruction).toBeUndefined()
    // 原标题就是那条 legacy 默认名（`可玩 HTML 生成`）时换成兜底标题 + 说明
    expect(node?.title).toBe('游戏需求（已下线，改用 AI 对话生成）')
  })

  it('自定义标题照样保留（只在标题后追加说明）', () => {
    const graph = normalizeScopedGraph('workflow', doc([retiredNode({ title: '太空站 Demo' })]))
    const node = graph.nodes.find((item) => item.id === 'gen-1')
    expect(node?.title).toMatch(/^太空站 Demo/)
    expect(node?.title).toContain('已下线')
  })

  it('没有标题时用兜底标题', () => {
    const graph = normalizeScopedGraph('workflow', doc([retiredNode({ title: '' })]))
    const node = graph.nodes.find((item) => item.id === 'gen-1')
    expect(node?.title).toContain('游戏需求')
  })

  it('没有指令文本时不抛错（迁移是纯资源搬运）', () => {
    const bare = retiredNode({ params: {} })
    const graph = normalizeScopedGraph('workflow', doc([bare]))
    expect(graph.nodes.find((item) => item.id === 'gen-1')?.params.text).toBe('')
  })

  it('指向它的边被丢弃（迁成备注后端口不再兼容）', () => {
    const play: GraphNode = {
      id: 'play-1',
      typeId: 'asset.gamePlay',
      category: 'asset',
      assetType: 'gamePlay',
      title: '可玩 HTML',
      x: 400,
      y: 0,
      width: 200,
      height: 120,
      params: {}
    } as GraphNode
    const graph = normalizeScopedGraph(
      'workflow',
      doc(
        [retiredNode(), play],
        [{ id: 'e1', source: 'gen-1', target: 'play-1', sourcePort: 'out', targetPort: 'in' }]
      )
    )
    expect(graph.nodes).toHaveLength(2)
    expect(graph.edges.some((edge) => edge.source === 'gen-1')).toBe(false)
  })
})

describe('asset.gamePlay 兼容层', () => {
  it('类型仍注册（旧图能显示 / 双击试玩）', () => {
    const def = getNodeType('asset.gamePlay')
    expect(def).toBeTruthy()
    expect(def?.assetType).toBe('gamePlay')
    expect(def?.ports.some((port) => port.dataType === 'project')).toBe(true)
  })

  it('不再是可添加节点：右键菜单与 graph_node_types 都看不到', () => {
    expect(getNodeType('asset.gamePlay')?.addable).toBe(false)
    const addable = listAddableNodeTypes('workflow').map((item) => item.typeId)
    expect(addable).not.toContain('asset.gamePlay')
    expect(addable).not.toContain('game.htmlGen')
  })

  it('game.htmlGen 类型彻底移除', () => {
    expect(getNodeType('game.htmlGen')).toBeUndefined()
  })
})
