import { describe, expect, it } from 'vitest'
import { createNodeFromType } from '../src/shared/graph'
import type { GraphDocument, GraphEdge } from '../src/shared/graph'
import {
  buildIconRefineInstruction,
  parseIconCellKey,
  refineCategoryOf,
  resolveIconRefineContext,
  withIconPackCellRefine
} from '../src/shared/graph/iconRefine'
import { readIconPackRefinesFromNode } from '../src/shared/graph/iconPack'

/**
 * image.gridSplit 单枚「逐枚精修回炉」上下文解析契约：
 * 给定切格节点 + 格位 key，能解析出这一枚的名字（打包名单 row-major 对齐）、
 * 画风主题句、上游整版节点与打包目录；据此组装单枚精修指令。
 */
function buildGameIconsDoc(): GraphDocument {
  const theme = createNodeFromType(
    'play.script',
    { x: 0, y: 0 },
    { id: 'theme', title: '画风主题', params: { text: '暖色 2D 卡通、浅色卡片底、描边统一' } }
  )
  const names = createNodeFromType(
    'play.script',
    { x: 0, y: 120 },
    {
      id: 'names',
      title: '技能图标名单',
      params: { text: '火焰斩\n冰霜护盾\n\n# 注释行\n雷击\n治疗术' }
    }
  )
  const sheet = createNodeFromType(
    'asset.image',
    { x: 240, y: 0 },
    {
      id: 'sheet',
      title: '技能图标·整版',
      params: {
        generateInstruction: '按名单顺序，绘制一张 3×3 均匀九宫格的技能图标整版表',
        generateAspectRatio: '1:1'
      }
    }
  )
  const split = createNodeFromType(
    'image.gridSplit',
    { x: 480, y: 0 },
    { id: 'split', params: { imageGridSplit: { rows: 3, cols: 3, selected: [] } } }
  )
  const pack = createNodeFromType(
    'image.iconPack',
    { x: 720, y: 0 },
    {
      id: 'pack',
      params: {
        iconPack: {
          rows: 3,
          cols: 3,
          edgeInset: 'auto',
          keyColor: 'auto',
          distance: 40,
          feather: 34,
          canvasSize: 0
        },
        mediaOutputDir: 'Assets/IconPacks/skill'
      }
    }
  )
  const edges: GraphEdge[] = [
    { id: 'e1', source: theme.id, target: sheet.id, targetPort: 'in-text' },
    { id: 'e2', source: names.id, target: sheet.id, targetPort: 'in-text' },
    { id: 'e3', source: sheet.id, target: split.id, targetPort: 'in' },
    { id: 'e4', source: names.id, target: pack.id, targetPort: 'in-text' },
    { id: 'e5', source: sheet.id, target: pack.id, targetPort: 'in' }
  ]
  return { nodes: [theme, names, sheet, split, pack], edges, viewport: { x: 0, y: 0, zoom: 1 } }
}

describe('单枚精修上下文解析（iconRefine）', () => {
  it('1-3 → 名单第 3 枚「雷击」，主题/整版/打包目录齐全', () => {
    const doc = buildGameIconsDoc()
    const ctx = resolveIconRefineContext(doc, 'split', '1-3')
    expect(ctx).not.toBeNull()
    expect(ctx!.cellKey).toBe('1-3')
    expect(ctx!.row1).toBe(1)
    expect(ctx!.col1).toBe(3)
    expect(ctx!.index).toBe(2)
    expect(ctx!.rows).toBe(3)
    expect(ctx!.cols).toBe(3)
    expect(ctx!.name).toBe('雷击')
    expect(ctx!.sheetNodeId).toBe('sheet')
    expect(ctx!.sheetTitle).toBe('技能图标·整版')
    expect(ctx!.sheetInstruction).toContain('整版表')
    // 名单整块不混进主题句；主题句来自只喂整版、未喂打包的文本节点
    expect(ctx!.themeTexts).toEqual(['暖色 2D 卡通、浅色卡片底、描边统一'])
    expect(ctx!.themeTexts.join('\n')).not.toContain('火焰斩')
    expect(ctx!.pack).not.toBeNull()
    expect(ctx!.pack!.names).toEqual(['火焰斩', '冰霜护盾', '雷击', '治疗术'])
    expect(ctx!.pack!.mediaOutputDir).toBe('Assets/IconPacks/skill')
  })

  it('row-major 跨行格位正确：2-1 → 第 4 枚「治疗术」；2-2 名单不足为 null', () => {
    const doc = buildGameIconsDoc()
    const ctx21 = resolveIconRefineContext(doc, 'split', '2-1')
    expect(ctx21!.index).toBe(3)
    expect(ctx21!.name).toBe('治疗术')

    const ctx22 = resolveIconRefineContext(doc, 'split', '2-2')
    expect(ctx22!.index).toBe(4)
    expect(ctx22!.name).toBeNull()
    // 仍能定位到打包节点（用于写回目录），只是名字缺省
    expect(ctx22!.pack!.nodeId).toBe('pack')
    expect(ctx22!.pack!.mediaOutputDir).toBe('Assets/IconPacks/skill')
  })

  it('无同源打包时 pack 为 null，name 为 null，主题句保留全部静态文本', () => {
    const doc = buildGameIconsDoc()
    doc.nodes = doc.nodes.filter((n) => n.id !== 'pack')
    doc.edges = doc.edges.filter((e) => e.target !== 'pack')
    const ctx = resolveIconRefineContext(doc, 'split', '1-1')
    expect(ctx).not.toBeNull()
    expect(ctx!.pack).toBeNull()
    expect(ctx!.name).toBeNull()
    expect(ctx!.themeTexts.join('\n')).toContain('火焰斩')
    expect(ctx!.themeTexts.join('\n')).toContain('暖色 2D 卡通')
  })

  it('非法输入返回 null：节点缺失 / 非 gridSplit / 格位越界 / key 格式非法', () => {
    const doc = buildGameIconsDoc()
    expect(resolveIconRefineContext(doc, 'missing', '1-1')).toBeNull()
    expect(resolveIconRefineContext(doc, 'sheet', '1-1')).toBeNull() // 非 gridSplit
    expect(resolveIconRefineContext(doc, 'split', '4-1')).toBeNull() // 越界
    expect(resolveIconRefineContext(doc, 'split', 'a-b')).toBeNull()
    expect(resolveIconRefineContext(null, 'split', '1-1')).toBeNull()
  })

  it('parseIconCellKey 与 refineCategoryOf', () => {
    expect(parseIconCellKey('2-3')).toEqual({ row1: 2, col1: 3 })
    expect(parseIconCellKey('0-1')).toBeNull()
    expect(parseIconCellKey('1-0')).toBeNull()
    expect(parseIconCellKey('1')).toBeNull()
    expect(refineCategoryOf('技能图标·整版')).toBe('技能图标')
    expect(refineCategoryOf('Item icons sheet')).toBe('Item icons sheet')
    expect(refineCategoryOf(undefined)).toBe('')
  })
})

describe('单枚精修指令组装', () => {
  it('中文：含名单名 / 分类 / 主题 / 单枚规范与修正 hint', () => {
    const ctx = resolveIconRefineContext(buildGameIconsDoc(), 'split', '1-3')!
    const instruction = buildIconRefineInstruction(ctx, {
      locale: 'zh',
      hint: '主体太糊、描边断线'
    })
    expect(instruction).toContain('雷击')
    expect(instruction).toContain('技能图标')
    expect(instruction).toContain('暖色 2D 卡通')
    expect(instruction).toContain('仅一枚图标') // 单枚语义提示
    expect(instruction).toContain('不画文字')
    expect(instruction).toContain('主体太糊、描边断线')
    expect(instruction).not.toContain('火焰斩') // 其余名单不混入
    expect(instruction).not.toContain('整版表')
  })

  it('英文：含名字与 hint，不含中文主题字面', () => {
    const ctx = resolveIconRefineContext(buildGameIconsDoc(), 'split', '1-3')!
    const instruction = buildIconRefineInstruction(ctx, { locale: 'en', hint: 'line work broken' })
    expect(instruction).toContain('雷击')
    expect(instruction).toContain('line work broken')
    expect(instruction).toContain('single square icon card')
  })

  it('名字缺失时退回格位 key，仍可组装', () => {
    const ctx = resolveIconRefineContext(buildGameIconsDoc(), 'split', '2-2')!
    const instruction = buildIconRefineInstruction(ctx, { locale: 'zh' })
    expect(instruction).toContain('2-2')
    expect(instruction).not.toContain('null')
  })
})

describe('单枚精修结果写回（withIconPackCellRefine）', () => {
  it('只替换本格覆盖，其余格位与其它参数不动，且原文档不可变', () => {
    const doc = buildGameIconsDoc()
    const pack = doc.nodes.find((n) => n.id === 'pack')!
    pack.params = {
      ...pack.params,
      iconPackCellRefines: { '1-1': { cellKey: '1-1', dataUrl: 'data:image/png;base64,AAA' } }
    }
    const edgesBefore = JSON.stringify(doc.edges)

    const next = withIconPackCellRefine(doc, {
      packNodeId: 'pack',
      cellKey: '1-3',
      dataUrl: 'data:image/png;base64,BBB',
      updatedAt: '2026-09-10T00:00:00.000Z'
    })

    const refines = readIconPackRefinesFromNode(next.nodes.find((n) => n.id === 'pack')!.params)
    expect(Object.keys(refines).sort()).toEqual(['1-1', '1-3'])
    expect(refines['1-1']!.dataUrl).toBe('data:image/png;base64,AAA')
    expect(refines['1-3']).toEqual({
      cellKey: '1-3',
      dataUrl: 'data:image/png;base64,BBB',
      updatedAt: '2026-09-10T00:00:00.000Z'
    })
    // 同一格重复精修：后一次顶替前一次
    const again = withIconPackCellRefine(next, {
      packNodeId: 'pack',
      cellKey: '1-3',
      dataUrl: 'data:image/png;base64,CCC'
    })
    expect(
      readIconPackRefinesFromNode(again.nodes.find((n) => n.id === 'pack')!.params)['1-3']!.dataUrl
    ).toBe('data:image/png;base64,CCC')

    // 原文档未被就地修改
    expect(
      readIconPackRefinesFromNode(doc.nodes.find((n) => n.id === 'pack')!.params)['1-3']
    ).toBeUndefined()
    expect(JSON.stringify(doc.edges)).toBe(edgesBefore)
    expect(next.nodes.find((n) => n.id === 'split')).toBe(doc.nodes.find((n) => n.id === 'split'))
  })

  it('格位 key 非法 / dataUrl 非 data:image / 节点缺失时原样返回', () => {
    const doc = buildGameIconsDoc()
    expect(
      withIconPackCellRefine(doc, {
        packNodeId: 'pack',
        cellKey: 'a-b',
        dataUrl: 'data:image/png;base64,AAA'
      })
    ).toBe(doc)
    expect(
      withIconPackCellRefine(doc, {
        packNodeId: 'pack',
        cellKey: '1-1',
        dataUrl: 'https://x/y.png'
      })
    ).toBe(doc)
    expect(
      withIconPackCellRefine(doc, {
        packNodeId: 'missing',
        cellKey: '1-1',
        dataUrl: 'data:image/png;base64,AAA'
      })
    ).toBe(doc)
  })

  it('写回时归一化丢弃旧脏条目（与打包执行器读取口径一致）', () => {
    const doc = buildGameIconsDoc()
    const pack = doc.nodes.find((n) => n.id === 'pack')!
    pack.params = {
      ...pack.params,
      iconPackCellRefines: {
        '1-1': { cellKey: '1-1', dataUrl: 'data:image/png;base64,AAA' },
        'bad-key': { cellKey: 'bad-key', dataUrl: 'data:image/png;base64,XXX' },
        '2-2': { cellKey: '2-2', dataUrl: 'https://x/y.png' }
      } as never
    }
    const next = withIconPackCellRefine(doc, {
      packNodeId: 'pack',
      cellKey: '1-2',
      dataUrl: 'data:image/png;base64,DDD'
    })
    expect(
      Object.keys(
        readIconPackRefinesFromNode(next.nodes.find((n) => n.id === 'pack')!.params)
      ).sort()
    ).toEqual(['1-1', '1-2'])
  })
})
