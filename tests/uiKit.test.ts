import { describe, expect, it } from 'vitest'
import {
  buildUiKitManifest,
  clampUiKitRect,
  computeNineSliceCells,
  defaultUiKitPartName,
  normalizeUiKitDocument,
  normalizeUiKitPart,
  sanitizeUiKitPartName,
  uiKitPartFileName,
  UI_KIT_PART_KIND_PREFIXES,
  type UiKitPart
} from '../src/shared/gameAssets/uiKit'

const makePart = (over: Partial<UiKitPart> = {}): UiKitPart => ({
  id: 'p1',
  kind: 'button',
  name: 'close',
  rect: { x: 10, y: 20, width: 80, height: 40 },
  border: { left: 8, top: 8, right: 8, bottom: 8 },
  safe: { left: 4, top: 2, right: 4, bottom: 2 },
  ...over
})

describe('uiKit 部件矩形归一化（框选坐标夹取）', () => {
  it('越界坐标与越界尺寸夹取回源图内', () => {
    const rect = clampUiKitRect(
      { x: -5, y: 300, width: 9999, height: 40 },
      200,
      400
    )
    expect(rect.x).toBe(0)
    expect(rect.y).toBe(300)
    expect(rect.width).toBe(200)
    expect(rect.height).toBe(40)
  })

  it('零尺寸 / 非法矩形兜底为整张源图', () => {
    const rect = clampUiKitRect(null, 300, 500)
    expect(rect).toEqual({ x: 0, y: 0, width: 300, height: 500 })
  })

  it('归一化后切边与安全边距被夹取进部件内', () => {
    const part = normalizeUiKitPart(
      {
        kind: 'panel',
        rect: { x: 0, y: 0, width: 100, height: 60 },
        border: { left: 120, top: 4, right: 8, bottom: 70 },
        safe: { left: -2, top: 3, right: 1000, bottom: 0 }
      },
      0,
      { width: 400, height: 300 }
    )!
    // 左切边 120 夹到部件宽 100；剩余宽度 0 时右切边归 0；上下同理
    expect(part.border).toEqual({ left: 100, top: 4, right: 0, bottom: 56 })
    expect(part.safe).toEqual({ left: 0, top: 3, right: 100, bottom: 0 })
  })
})

describe('uiKit 部件命名规范', () => {
  it('默认名按类型前缀 + 序号生成', () => {
    expect(defaultUiKitPartName('panel', 0)).toBe('panel-1')
    expect(defaultUiKitPartName('button', 4)).toBe('btn-5')
    expect(defaultUiKitPartName('popup', 0)).toBe('popup-1')
  })

  it('文件名主干安全化：小写、去非法字符、首尾去连字符、限长', () => {
    expect(sanitizeUiKitPartName('  Btn/Close? ', 'x')).toBe('btn-close')
    expect(sanitizeUiKitPartName('-_-', 'x')).toBe('x')
    expect(sanitizeUiKitPartName('a'.repeat(80), 'x')).toHaveLength(48)
  })

  it('落盘文件名 = 类型前缀 + 安全名 + .png', () => {
    expect(uiKitPartFileName(makePart({ name: 'Close' }))).toBe('btn-close.png')
    expect(uiKitPartFileName(makePart({ kind: 'panel', name: 'InventoryPanel' }))).toBe(
      'panel-inventorypanel.png'
    )
  })

  it('同一文档内重名自动追加序号避免覆盖', () => {
    const used = new Set<string>()
    const a = normalizeUiKitPart(makePart({ name: 'close' }), 0, { width: 200, height: 200 }, used)!
    const b = normalizeUiKitPart(makePart({ name: 'close' }), 1, { width: 200, height: 200 }, used)!
    expect(a.name).toBe('close')
    expect(b.name).toBe('close-2')
  })

  it('每个类型前缀都有规范映射', () => {
    expect(Object.keys(UI_KIT_PART_KIND_PREFIXES).sort()).toEqual([
      'button',
      'input',
      'panel',
      'popup',
      'tab'
    ])
  })
})

describe('uiKit 九宫格拉伸网格（验收：任意缩放不变形）', () => {
  const part = makePart({
    rect: { x: 0, y: 0, width: 100, height: 60 },
    border: { left: 20, top: 10, right: 20, bottom: 10 }
  })
  const src = part.rect

  it('放大到超大目标时：四角 / 四边像素块原样保留尺寸，仅中央区被拉伸', () => {
    const cells = computeNineSliceCells(src.width, src.height, part.border, 500, 300)
    const [tl, tc, tr, cl, cc, cr, bl, bc, br] = cells
    // 角块尺寸与切边一致（不变形）
    expect([tl.src.width, tl.dst.width]).toEqual([20, 20])
    expect([tl.src.height, tl.dst.height]).toEqual([10, 10])
    expect(tr.dst.width).toBe(20)
    expect(bl.dst.width).toBe(20)
    expect(br.dst.height).toBe(10)
    // 上下 / 左右边块：一个方向保持切边，另一方向拉伸
    expect(tc.dst.width).toBe(460)
    expect(tc.dst.height).toBe(10)
    expect(cl.dst.width).toBe(20)
    expect(cl.dst.height).toBe(280)
    // 中央区双向拉伸铺满
    expect([cc.dst.width, cc.dst.height]).toEqual([460, 280])
    // 九宫格无缝铺满目标（横向三段宽和 / 纵向三段高和）
    const rows = [
      [tl, tc, tr],
      [cl, cc, cr],
      [bl, bc, br]
    ]
    for (const [a, b, c] of rows) {
      expect(a.dst.width + b.dst.width + c.dst.width).toBe(500)
      expect(a.dst.y).toBe(b.dst.y)
      expect(b.dst.y).toBe(c.dst.y)
    }
    const cols = [
      [tl, cl, bl],
      [tc, cc, bc],
      [tr, cr, br]
    ]
    for (const [a, b, c] of cols) {
      expect(a.dst.height + b.dst.height + c.dst.height).toBe(300)
    }
  })

  it('缩小到小于双边切边总和的目标时：角块按目标收缩、中央区不为负、不越界', () => {
    const cells = computeNineSliceCells(src.width, src.height, part.border, 30, 14)
    // 九宫格顺序固定为 3×3 row-major：本用例只校验角块与中央区，其余位置留空不绑定
    const [tl, tc, tr, cl, cc, , , , br] = cells
    expect(cc.dst.width).toBeGreaterThanOrEqual(0)
    expect(cc.dst.height).toBeGreaterThanOrEqual(0)
    expect(tl.dst.x).toBe(0)
    expect(br.dst.x + br.dst.width).toBe(30)
    expect(br.dst.y + br.dst.height).toBe(14)
    expect(tl.src).toEqual({ x: 0, y: 0, width: 20, height: 10 })
    expect(tr.src.width).toBe(20)
    expect(br.src.width).toBe(20)
    // 源中央区始终为整块余量（原样读取）
    expect(tc.src.width).toBe(60)
    expect(cl.src.height).toBe(40)
  })

  it('等大绘制时九宫格每格与源图一一对应，无变形', () => {
    const cells = computeNineSliceCells(src.width, src.height, part.border, 100, 60)
    for (const cell of cells) {
      expect(cell.dst).toEqual(cell.src)
    }
  })
})

describe('uiKit 文档归一化与 manifest', () => {
  it('缺失条目被剔除，重名自动去重，源尺寸兜底', () => {
    const doc = normalizeUiKitDocument(
      {
        parts: [
          makePart({ name: 'ok', kind: 'panel' }),
          null,
          makePart({ name: 'ok' })
        ]
      },
      { width: 640, height: 960 }
    )
    expect(doc.parts).toHaveLength(2)
    expect(doc.parts[0]!.name).toBe('ok')
    expect(doc.parts[1]!.name).toBe('ok-2')
    expect(doc.sourceWidth).toBe(640)
    expect(doc.sourceHeight).toBe(960)
  })

  it('manifest 条目保序，rect/border/safe 与部件一致，fileName 走命名规范', () => {
    const a = makePart({ id: 'pa', kind: 'panel', name: 'BasePanel' })
    const b = makePart({ id: 'pb', kind: 'button', name: 'Close', rect: { x: 5, y: 5, width: 40, height: 20 } })
    const manifest = buildUiKitManifest({
      sourceName: 'ShopScreen',
      sourceWidth: 640,
      sourceHeight: 960,
      parts: [a, b]
    })
    expect(manifest.kind).toBe('ui-kit')
    expect(manifest.parts.map((p) => p.id)).toEqual(['pa', 'pb'])
    expect(manifest.parts[0]).toMatchObject({
      kind: 'panel',
      name: 'basepanel',
      fileName: 'panel-basepanel.png',
      rect: a.rect,
      border: a.border,
      safe: a.safe
    })
    expect(manifest.sourceName).toBe('shopscreen')
    // 该条目的矩形落盘成小数时按整像素写入
    expect(manifest.parts[1]!.rect.x).toBe(5)
  })
})
