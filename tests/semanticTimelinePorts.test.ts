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
 * 语义分析管线的端口类型。
 *
 * 这条管线以前全用 `text` 口传 JSON 字符串，后果是**任何文本产地都能接进语义口**
 * （提示词 / 剧本 / OCR），且要等运行期解析才报「不是合法 JSON / 不是语义时间线文档」。
 * 现在语义时间线有自己的端口类型：
 *   - 只有「产物确实是整份 SemanticTimeline 文档」的口才用它（分析出口 + 编译入口）；
 *   - 编译出**提示词计划**，用 `videoPrompts` 结构化口（重建的入口也是它）；
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
    expect(portOf('semantic.analyze', 'out').dataType).toBe(GraphPortType.semanticTimeline)
  })

  it('所有吃时间线的入端口都被收窄', () => {
    for (const typeId of ['semantic.compile']) {
      expect(portOf(typeId, 'in').dataType, typeId).toBe(GraphPortType.semanticTimeline)
    }
  })

  it('**出口不能被一刀切**：按各自产物类型走专用口，不再一律文本', () => {
    // 编译出的**提示词计划**是结构化口（每镜提示词 + 首帧），接错类型连线时就该被拒
    expect(portOf('semantic.compile', 'out').dataType).toBe(GraphPortType.videoPrompts)
    // 重建吃提示词口、吐视频口
    expect(portOf('semantic.rebuild', 'in').dataType).toBe(GraphPortType.videoPrompts)
    expect(portOf('semantic.rebuild', 'out-video').dataType).toBe(GraphPortType.video)
  })

  it('提示词口单向兼容文本口（与时间线口同一口径）', () => {
    expect(portsCompatible(GraphPortType.videoPrompts, GraphPortType.text)).toBe(true)
    expect(portsCompatible(GraphPortType.text, GraphPortType.videoPrompts)).toBe(false)
    expect(portsCompatible(GraphPortType.semanticTimeline, GraphPortType.videoPrompts)).toBe(false)
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

  it('连线校验：分析 → 编译可以连，随便一个文本节点 → 编译连不上', () => {
    const analyze = node('n-analyze', 'semantic.analyze')
    const compile = node('n-compile', 'semantic.compile')
    const noteText = node('n-text', 'note.text')

    expect(canConnectNodes(analyze, compile)).toBe(true)
    expect(canConnectNodes(noteText, compile)).toBe(false)
  })

  it('规范化会剪掉工程里「文本 → 时间线口」的旧连线，合法连线保留', () => {
    const analyze = node('n-analyze', 'semantic.analyze')
    const compile = node('n-compile', 'semantic.compile')
    const noteText = node('n-text', 'note.text')
    const doc: GraphDocument = {
      nodes: [analyze, compile, noteText],
      edges: [
        // 合法：语义分析 → 语义编译
        {
          id: 'e-ok',
          source: 'n-analyze',
          target: 'n-compile',
          sourcePort: 'out',
          targetPort: 'in'
        },
        // 非法：普通文本接进语义口（正是这次要挡住的用法）
        { id: 'e-bad', source: 'n-text', target: 'n-compile', sourcePort: 'out', targetPort: 'in' }
      ],
      groups: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    }

    const out = normalizeScopedGraph('canvasAsset', doc, {})
    const ids = out.edges.map((e) => e.id)
    expect(ids).toContain('e-ok')
    expect(ids).not.toContain('e-bad')
  })

  /**
   * 回归：从语义时间线拖出去的「添加并连接」菜单**必须被过滤**。
   *
   * 值可以被投影成文本（`semanticTimeline → text`，执行期成立），但拿这条兼容去筛菜单，
   * 会把**所有**带文本入端的节点都列出来（几乎等于没筛）—— 这正是用户报的现象。
   * 菜单按「直接对口」算：只有真吃时间线的节点才出现。
   */
  it('菜单过滤：从时间线口拖出时，普通文本消费节点不该出现在菜单里', () => {
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
    const timelineConsumerDef = SEMANTIC_TIMELINE_NODE_TYPES.find(
      (d) => d.typeId === 'semantic.compile'
    )!

    expect(
      canConnectToNodeType(analyze, textConsumer, { dataType: GraphPortType.semanticTimeline })
    ).toBe(false)
    expect(
      canConnectToNodeType(analyze, timelineConsumerDef, {
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
    // 执行口径不受影响：投影仍然可用（把文档喂给文本消费者）
    expect(portsCompatible(GraphPortType.semanticTimeline, GraphPortType.text)).toBe(true)
  })

  /**
   * 接线守卫：画布的「添加并连接」菜单必须走菜单口径的那两个入口
   * （`canConnectToNodeType` / `canConnectFromNodeType`）。若有人改成直接调
   * `portsCompatible`，菜单会立刻回到「不过滤」，这个用例会先红。
   */
  it('画布菜单的过滤确实走菜单口径入口', () => {
    const editor = readFileSync(
      resolve(__dirname, '../src/renderer/src/components/NodeGraphEditor.vue'),
      'utf8'
    )
    expect(editor).toContain('canConnectToNodeType(source, def')
    expect(editor).toContain('canConnectFromNodeType(target, def')
    // 渲染层不该直接用执行口径的兼容判断
    expect(editor).not.toContain('portsCompatible(')
  })
})
