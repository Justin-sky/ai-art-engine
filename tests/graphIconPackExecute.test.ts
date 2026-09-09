import { describe, expect, it } from 'vitest'
import { createNodeFromType, runGraph } from '../src/shared/graph'
import {
  iconPackCellRefinesToOverrides,
  normalizeIconPackCellRefines,
  readIconPackRefinesFromNode
} from '../src/shared/graph/iconPack'

/**
 * image.iconPack 端到端契约：整版切格产物 → 逐格键控透明 → 统一对齐出口 →
 * 「按 cellKey 落命名 manifest + 交付引擎透明 PNG」一条链跑通后的可观测产物。
 * 聚焦三点契约：
 * 1) 名单按整版表 row-major 顺序解析并逐格喂给画布合成；
 * 2) 逐枚透明 PNG 按名单名落盘（saveRunMedia key = 清理后的名单名）；
 * 3) icons manifest（JSON）按 cellKey 逐条记录 name ↔ fileName ↔ 尺寸 ↔ 锚点，
 *    且 fileName 与实际落盘 relativePath 文件名一致（引擎直接可读）。
 */
describe('image.iconPack 执行产物契约', () => {
  const NAME_LINES = ['火焰斩', '冰霜护盾', '雷击', '治疗术']

  function buildGraph() {
    const names = createNodeFromType(
      'play.script',
      { x: 0, y: 0 },
      { id: 'names', params: { text: NAME_LINES.join('\n') } }
    )
    const sheet = createNodeFromType(
      'asset.image',
      { x: 200, y: 0 },
      { id: 'sheet', title: '技能图标·整版' }
    )
    const pack = createNodeFromType(
      'image.iconPack',
      { x: 400, y: 0 },
      {
        id: 'pack',
        params: {
          iconPack: { rows: 3, cols: 3, edgeInset: 'auto', keyColor: 'auto', distance: 40, feather: 34, canvasSize: 0 },
          mediaOutputDir: 'Assets/IconPacks/skill'
        }
      }
    )
    return { names, sheet, pack }
  }

  function buildRunOptions() {
    const savedMedia: Array<{ key: string; dataUrl: string; outputDir?: string }> = []
    const texts: Array<{ content: string; key: string; outputDir?: string }> = []
    const composeCalls: Array<{ url: string; names: string[]; cellOverrides?: Record<string, string> }> = []
    const stub = {
      stepDelayMs: 1,
      resolveImageUrls: async (items: Array<{ dataUrl?: string }>) =>
        items.map((item) => item.dataUrl ?? ''),
      composeImageIconPackSheet: async (arg: {
        sourceDataUrl: string
        names: string[]
        cellOverrides?: Record<string, string>
      }) => {
        composeCalls.push({ url: arg.sourceDataUrl, names: arg.names, cellOverrides: arg.cellOverrides })
        return {
          items: arg.names.map((name, index) => ({
            cellKey: `${Math.floor(index / 3) + 1}-${(index % 3) + 1}`,
            name,
            dataUrl: `data:image/png;base64,AAAA${index}`,
            width: 512,
            height: 512
          })),
          canvasSize: 512,
          background: { r: 240, g: 240, b: 240 }
        }
      },
      saveRunMedia: async (input: { dataUrl: string; key: string; outputDir?: string }) => {
        savedMedia.push(input)
        return `Assets/IconPacks/skill/${input.key}.png`
      },
      saveRunText: async (input: { content: string; key: string; outputDir?: string }) => {
        texts.push(input)
        return `Assets/IconPacks/skill/${input.key}.txt`
      }
    }
    return { savedMedia, texts, composeCalls, stub }
  }

  it('名单逐格裁切 → 按名单名落透明 PNG → manifest 按 cellKey 记录 name/fileName/锚点', async () => {
    const { names, sheet, pack } = buildGraph()
    const { savedMedia, texts, composeCalls, stub } = buildRunOptions()

    const result = await runGraph(
      {
        nodes: [names, sheet, pack],
        edges: [
          { id: 'e1', source: names.id, target: pack.id, sourcePort: 'out', targetPort: 'in-text' },
          { id: 'e2', source: sheet.id, target: pack.id, sourcePort: 'out', targetPort: 'in' }
        ],
        viewport: { x: 0, y: 0, zoom: 1 }
      },
      {
        ...stub,
        targetNodeId: pack.id,
        onlyTargetNode: true,
        priorNodeStates: {
          [sheet.id]: {
            status: 'done',
            outputs: {
              out: {
                kind: 'image',
                id: 'sheet-out',
                dataUrl: 'data:image/png;base64,AAAA',
                createdAt: '2026-09-09T00:00:00.000Z',
                relativePath: ''
              }
            }
          }
        }
      } as never
    )

    expect(result.ok, (result as any).error).toBe(true)

    // 1) 画布合成收到整版图 URL 与完整名单（含 2 行开始的第 4 枚，跨行格位 2-1）
    expect(composeCalls).toHaveLength(1)
    expect(composeCalls[0]!.names).toEqual(NAME_LINES)

    // 2) 逐枚透明 PNG 按名单名落盘：key 顺序即名单顺序、目录来自节点参数
    expect(savedMedia.map((m) => m.key)).toEqual(NAME_LINES)
    expect(savedMedia.every((m) => m.outputDir === 'Assets/IconPacks/skill')).toBe(true)

    // 3) manifest 内容：cellKey ↔ 名单名 ↔ 落盘文件名 ↔ 统一画布/锚点
    expect(texts).toHaveLength(1)
    const manifest = JSON.parse(texts[0]!.content) as {
      kind: string
      version: number
      canvasSize: number
      background: { r: number; g: number; b: number }
      grid: { rows: number; cols: number }
      icons: Array<{ name: string; fileName: string; cellKey: string; width: number; height: number; anchorX: number; anchorY: number }>
    }
    expect(manifest.kind).toBe('icon-pack')
    expect(manifest.version).toBe(1)
    expect(manifest.canvasSize).toBe(512)
    expect(manifest.background).toEqual({ r: 240, g: 240, b: 240 })
    expect(manifest.grid).toEqual({ rows: 3, cols: 3 })
    expect(manifest.icons).toHaveLength(NAME_LINES.length)
    expect(manifest.icons.map((i) => i.name)).toEqual(NAME_LINES)
    expect(manifest.icons.map((i) => i.cellKey)).toEqual(['1-1', '1-2', '1-3', '2-1'])
    // fileName 必须与实际落盘 relativePath 尾名一致，引擎照 manifest 直接读文件
    manifest.icons.forEach((entry, index) => {
      expect(entry.fileName).toBe(`${NAME_LINES[index]}.png`)
    })
    // 锚点统一为画布中心（引擎摆位不抖动）
    manifest.icons.forEach((entry) => {
      expect(entry.width).toBe(512)
      expect(entry.height).toBe(512)
      expect(entry.anchorX).toBe(256)
      expect(entry.anchorY).toBe(256)
    })
  })

  it('名单占不满整表：仅导出名单条目，空白格不进 manifest', async () => {
    const { names, sheet, pack } = buildGraph()
    const { savedMedia, texts, composeCalls, stub } = buildRunOptions()

    // 名单仅 2 枚（1-1 / 1-2），其余 7 格为纯色空白底
    names.params.text = '火焰斩\n治疗术'

    const result = await runGraph(
      {
        nodes: [names, sheet, pack],
        edges: [
          { id: 'e1', source: names.id, target: pack.id, sourcePort: 'out', targetPort: 'in-text' },
          { id: 'e2', source: sheet.id, target: pack.id, sourcePort: 'out', targetPort: 'in' }
        ],
        viewport: { x: 0, y: 0, zoom: 1 }
      },
      {
        ...stub,
        targetNodeId: pack.id,
        onlyTargetNode: true,
        priorNodeStates: {
          [sheet.id]: {
            status: 'done',
            outputs: {
              out: {
                kind: 'image',
                id: 'sheet-out',
                dataUrl: 'data:image/png;base64,AAAA',
                createdAt: '2026-09-09T00:00:00.000Z',
                relativePath: ''
              }
            }
          }
        }
      } as never
    )

    expect(result.ok, (result as any).error).toBe(true)
    expect(composeCalls[0]!.names).toEqual(['火焰斩', '治疗术'])
    expect(savedMedia.map((m) => m.key)).toEqual(['火焰斩', '治疗术'])
    const manifest = JSON.parse(texts[0]!.content) as {
      icons: Array<{ name: string; fileName: string; cellKey: string }>
    }
    expect(manifest.icons).toHaveLength(2)
    expect(manifest.icons.map((i) => i.cellKey)).toEqual(['1-1', '1-2'])
  })

  it('回炉覆盖（iconPackCellRefines）只替换对应格位：compose 收到 cellOverrides，其余产物契约不变', async () => {
    const { names, sheet, pack } = buildGraph()
    const { savedMedia, texts, composeCalls, stub } = buildRunOptions()

    // 只回炉 1-2（冰霜护盾），其余格照旧从整版裁切
    pack.params.iconPackCellRefines = {
      '1-2': 'data:image/png;base64,REFINED'
    }

    const result = await runGraph(
      {
        nodes: [names, sheet, pack],
        edges: [
          { id: 'e1', source: names.id, target: pack.id, sourcePort: 'out', targetPort: 'in-text' },
          { id: 'e2', source: sheet.id, target: pack.id, sourcePort: 'out', targetPort: 'in' }
        ],
        viewport: { x: 0, y: 0, zoom: 1 }
      },
      {
        ...stub,
        targetNodeId: pack.id,
        onlyTargetNode: true,
        priorNodeStates: {
          [sheet.id]: {
            status: 'done',
            outputs: {
              out: {
                kind: 'image',
                id: 'sheet-out',
                dataUrl: 'data:image/png;base64,AAAA',
                createdAt: '2026-09-09T00:00:00.000Z',
                relativePath: ''
              }
            }
          }
        }
      } as never
    )

    expect(result.ok, (result as any).error).toBe(true)
    // 画布合成收到整版图 + 完整名单 + 单格覆盖图
    expect(composeCalls).toHaveLength(1)
    expect(composeCalls[0]!.names).toEqual(NAME_LINES)
    expect(composeCalls[0]!.cellOverrides).toEqual({ '1-2': 'data:image/png;base64,REFINED' })
    // 落盘与 manifest 契约不变：仍是按名单全量导出、cellKey ↔ fileName 一一对应
    expect(savedMedia.map((m) => m.key)).toEqual(NAME_LINES)
    const manifest = JSON.parse(texts[0]!.content) as {
      icons: Array<{ name: string; fileName: string; cellKey: string }>
    }
    expect(manifest.icons.map((i) => i.cellKey)).toEqual(['1-1', '1-2', '1-3', '2-1'])
    expect(manifest.icons.map((i) => i.fileName)).toEqual(NAME_LINES.map((n) => `${n}.png`))
  })

  it('iconPackCellRefines 参数归一化：仅保留合法格位 + data:image/ 的条目', () => {
    expect(normalizeIconPackCellRefines(undefined)).toEqual({})
    expect(
      normalizeIconPackCellRefines({
        '1-2': 'data:image/png;base64,AAA',
        '0-0': 'data:image/png;base64,BAD',
        '2-1': { dataUrl: 'data:image/png;base64,BBB', updatedAt: '2026-09-09T00:00:00.000Z' },
        '3-4': 'http://not-a-data-url.png'
      })
    ).toEqual({
      '1-2': { cellKey: '1-2', dataUrl: 'data:image/png;base64,AAA', updatedAt: undefined },
      '2-1': { cellKey: '2-1', dataUrl: 'data:image/png;base64,BBB', updatedAt: '2026-09-09T00:00:00.000Z' }
    })
    expect(
      iconPackCellRefinesToOverrides(
        readIconPackRefinesFromNode({ iconPackCellRefines: { '1-2': { dataUrl: 'data:image/png;base64,AAA' } } })
      )
    ).toEqual({ '1-2': 'data:image/png;base64,AAA' })
    expect(iconPackCellRefinesToOverrides({ '1-2': { cellKey: '1-2', dataUrl: '' } })).toEqual({})
  })
})
