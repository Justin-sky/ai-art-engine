import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { normalizeScopedGraph } from '../src/shared/graph/normalize'
import {
  canConnectNodes,
  canConnectToNodeType,
  portsCompatible,
  portsCompatibleForMenu
} from '../src/shared/graph/ports'
import { SEMANTIC_TIMELINE_NODE_TYPES } from '../src/shared/graph/semanticTimelineNodes'
import { GraphPortType, ensureBuiltinNodeTypes } from '../src/shared/graph'
import type { GraphDocument, GraphNode } from '../src/shared/graph'

/**
 * 视频拆解 → 视频重制二节点直连管线的端口契约守卫：
 *   - `semantic.analyze` 出 `semanticTimeline`；
 *   - `semantic.rebuild` 直接吃 `semanticTimeline`（`in`）+ 多张参考图（`in-images`），吐 `video`（`out-video`）；
 *   - 兼容规则**单向**：`semanticTimeline → text` 执行期允许，反向不允许。
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

describe('语义时间线二节点直连端口类型', () => {
  it('语义分析节点的出口是语义时间线（不再是 text），并接收参考图入端', () => {
    expect(portOf('semantic.analyze', 'out').dataType).toBe(GraphPortType.semanticTimeline)
    const refIn = portOf('semantic.analyze', 'in-images')
    expect(refIn.dataType).toBe(GraphPortType.image)
    expect(refIn.multiple).toBe(true)
  })

  it('视频重制节点直接吃语义时间线与多张参考图，出口为视频口', () => {
    expect(portOf('semantic.rebuild', 'in').dataType).toBe(GraphPortType.semanticTimeline)
    const refIn = portOf('semantic.rebuild', 'in-images')
    expect(refIn.dataType).toBe(GraphPortType.image)
    expect(refIn.multiple).toBe(true)
    expect(portOf('semantic.rebuild', 'out-video').dataType).toBe(GraphPortType.video)
  })

  it('兼容规则单向：时间线可流向文本口，文本口进不了时间线口', () => {
    expect(portsCompatible(GraphPortType.semanticTimeline, GraphPortType.semanticTimeline)).toBe(
      true
    )
    expect(portsCompatible(GraphPortType.semanticTimeline, GraphPortType.text)).toBe(true)
    expect(portsCompatible(GraphPortType.text, GraphPortType.semanticTimeline)).toBe(false)
    expect(portsCompatible(GraphPortType.image, GraphPortType.semanticTimeline)).toBe(false)
    expect(portsCompatible(GraphPortType.image, GraphPortType.svg)).toBe(true)
  })

  it('连线校验：视频拆解 → 视频重制直连可通，普通文本节点 → 视频重制被拒', () => {
    const analyze = node('n-analyze', 'semantic.analyze')
    const rebuild = node('n-rebuild', 'semantic.rebuild')
    const noteText = node('n-text', 'note.text')

    expect(canConnectNodes(analyze, rebuild)).toBe(true)
    expect(canConnectNodes(noteText, rebuild)).toBe(false)
  })

  it('规范化会剪掉工程里「文本 → 时间线口」的非法连线，保留直连合法边', () => {
    const analyze = node('n-analyze', 'semantic.analyze')
    const rebuild = node('n-rebuild', 'semantic.rebuild')
    const noteText = node('n-text', 'note.text')
    const doc: GraphDocument = {
      nodes: [analyze, rebuild, noteText],
      edges: [
        {
          id: 'e-ok',
          source: 'n-analyze',
          target: 'n-rebuild',
          sourcePort: 'out',
          targetPort: 'in'
        },
        {
          id: 'e-bad',
          source: 'n-text',
          target: 'n-rebuild',
          sourcePort: 'out',
          targetPort: 'in'
        }
      ],
      groups: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    }

    const out = normalizeScopedGraph('canvasAsset', doc, {})
    const ids = out.edges.map((e) => e.id)
    expect(ids).toContain('e-ok')
    expect(ids).not.toContain('e-bad')
  })

  it('菜单过滤：从时间线口拖出时，只有吃时间线的视频重制节点出现，普通文本消费节点被过滤', () => {
    const analyze = node('n-analyze', 'semantic.analyze')
    const textConsumer = {
      typeId: 'test.textConsumer',
      ports: [
        {
          id: 'in-text',
          direction: 'in' as const,
          dataType: GraphPortType.text,
          multiple: false,
          label: 'Text'
        }
      ]
    }
    const rebuildDef = SEMANTIC_TIMELINE_NODE_TYPES.find((d) => d.typeId === 'semantic.rebuild')!

    expect(
      canConnectToNodeType(analyze, textConsumer, { dataType: GraphPortType.semanticTimeline })
    ).toBe(false)
    expect(
      canConnectToNodeType(analyze, rebuildDef, {
        dataType: GraphPortType.semanticTimeline
      })
    ).toBe(true)
  })

  it('菜单口径不含投影兼容，但仍保留既有的 image → svg 窄例外', () => {
    expect(portsCompatibleForMenu(GraphPortType.semanticTimeline, GraphPortType.text)).toBe(false)
    expect(
      portsCompatibleForMenu(GraphPortType.semanticTimeline, GraphPortType.semanticTimeline)
    ).toBe(true)
    expect(portsCompatibleForMenu(GraphPortType.image, GraphPortType.svg)).toBe(true)
    expect(portsCompatible(GraphPortType.semanticTimeline, GraphPortType.text)).toBe(true)
  })

  it('画布菜单的过滤确实走菜单口径入口', () => {
    const editor = readFileSync(
      resolve(__dirname, '../src/renderer/src/components/NodeGraphEditor.vue'),
      'utf8'
    )
    expect(editor).toContain('canConnectToNodeType(source, def')
    expect(editor).toContain('canConnectFromNodeType(target, def')
    expect(editor).not.toContain('portsCompatible(')
  })
})
