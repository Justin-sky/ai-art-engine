import { describe, expect, it } from 'vitest'
import { normalizeScopedGraph } from '../src/shared/graph/normalize'
import { canConnectNodes, portsCompatible } from '../src/shared/graph/ports'
import { SEMANTIC_TIMELINE_NODE_TYPES } from '../src/shared/graph/semanticTimelineNodes'
import { GraphPortType, ensureBuiltinNodeTypes } from '../src/shared/graph'
import type { GraphDocument, GraphNode } from '../src/shared/graph'

/**
 * 语义分析管线的端口类型。
 *
 * 这条管线以前全用 `text` 口传 JSON 字符串，后果是**任何文本产地都能接进语义口**
 * （提示词 / 剧本 / OCR），且要等运行期解析才报「不是合法 JSON / 不是语义时间线文档」。
 * 现在语义时间线有自己的端口类型：
 *   - 只有「产物确实是整份 SemanticTimeline 文档」的口才用它（分析出口 + 时间线节点进出）；
 *   - 触发 / 编译 / 修复 / 多版本的出口是各自的信封，仍是 text（不能一刀切）；
 *   - 兼容规则**单向**：semanticTimeline → text 允许，反向不允许。
 */
ensureBuiltinNodeTypes()

function portsOf(typeId: string) {
  const def = SEMANTIC_TIMELINE_NODE_TYPES.find((d) => d.typeId === typeId)
  expect(def, `缺少节点定义 ${typeId}`).toBeTruthy()
  return def!.ports
}

function portOf(typeId: string, portId: string) {
  const port = portsOf(typeId).find((p) => p.id === portId)
  expect(port, `${typeId} 缺少端口 ${portId}`).toBeTruthy()
  return port!
}

function node(id: string, typeId: string): GraphNode {
  return {
    id,
    typeId,
    category: 'note',
    position: { x: 0, y: 0 },
    params: {},
    title: typeId
  }
}

describe('语义时间线端口类型', () => {
  it('语义分析节点的出口是语义时间线（不再是 text）', () => {
    expect(portOf('video.semanticAnalyze', 'out').dataType).toBe(GraphPortType.semanticTimeline)
  })

  it('语义时间线节点的进出都是语义时间线（它是透传）', () => {
    expect(portOf('semantic.timeline', 'in').dataType).toBe(GraphPortType.semanticTimeline)
    expect(portOf('semantic.timeline', 'out').dataType).toBe(GraphPortType.semanticTimeline)
  })

  it('所有吃时间线的入端口都被收窄', () => {
    for (const typeId of [
      'semantic.timeline',
      'semantic.trigger',
      'semantic.compile',
      'video.repair',
      'video.variant'
    ]) {
      expect(portOf(typeId, 'in').dataType, typeId).toBe(GraphPortType.semanticTimeline)
    }
  })

  it('**出口不能被一刀切**：触发/编译/修复/多版本吐的是各自信封，仍是 text', () => {
    for (const typeId of [
      'semantic.trigger',
      'semantic.compile',
      'video.repair',
      'video.variant'
    ]) {
      expect(portOf(typeId, 'out').dataType, typeId).toBe(GraphPortType.text)
    }
  })

  it('兼容规则单向：时间线可流向文本口，文本口进不了时间线口', () => {
    expect(portsCompatible(GraphPortType.semanticTimeline, GraphPortType.semanticTimeline)).toBe(
      true
    )
    expect(portsCompatible(GraphPortType.semanticTimeline, GraphPortType.text)).toBe(true)
    expect(portsCompatible(GraphPortType.text, GraphPortType.semanticTimeline)).toBe(false)
    expect(portsCompatible(GraphPortType.image, GraphPortType.semanticTimeline)).toBe(false)
    // 既有例外不受影响
    expect(portsCompatible(GraphPortType.image, GraphPortType.svg)).toBe(true)
  })

  it('连线校验：分析 → 时间线可以连，随便一个文本节点 → 时间线连不上', () => {
    const analyze = node('n-analyze', 'video.semanticAnalyze')
    const timeline = node('n-timeline', 'semantic.timeline')
    const noteText = node('n-text', 'note.text')

    expect(canConnectNodes(analyze, timeline)).toBe(true)
    expect(canConnectNodes(noteText, timeline)).toBe(false)
  })

  it('规范化会剪掉工程里「文本 → 时间线口」的旧连线，合法连线保留', () => {
    const analyze = node('n-analyze', 'video.semanticAnalyze')
    const timeline = node('n-timeline', 'semantic.timeline')
    const noteText = node('n-text', 'note.text')
    const doc: GraphDocument = {
      nodes: [analyze, timeline, noteText],
      edges: [
        // 合法：语义分析 → 语义时间线
        {
          id: 'e-ok',
          source: 'n-analyze',
          target: 'n-timeline',
          sourcePort: 'out',
          targetPort: 'in'
        },
        // 非法：普通文本接进语义口（正是这次要挡住的用法）
        { id: 'e-bad', source: 'n-text', target: 'n-timeline', sourcePort: 'out', targetPort: 'in' }
      ],
      groups: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    }

    const out = normalizeScopedGraph('canvasAsset', doc, {})
    const ids = out.edges.map((e) => e.id)
    expect(ids).toContain('e-ok')
    expect(ids).not.toContain('e-bad')
  })
})
