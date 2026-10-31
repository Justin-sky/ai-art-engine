import { describe, expect, it } from 'vitest'
import {
  buildOwnershipMap,
  completeOccludedRegions,
  createImage,
  refineMaskByPalette,
  runPreciseUiSplit,
  type CanvasMask,
  type PreciseSplitIo,
  type RgbaImage
} from '../src/shared/graph/uiPreciseSplit'

type Rgb = [number, number, number]
interface Rect {
  left: number
  top: number
  width: number
  height: number
}

function setPx(img: RgbaImage, x: number, y: number, rgb: Rgb): void {
  const i = (y * img.width + x) * 4
  img.data[i] = rgb[0]
  img.data[i + 1] = rgb[1]
  img.data[i + 2] = rgb[2]
  img.data[i + 3] = 255
}

function fill(img: RgbaImage, rgb: Rgb, r?: Rect): void {
  const rect = r ?? { left: 0, top: 0, width: img.width, height: img.height }
  for (let y = rect.top; y < rect.top + rect.height; y++)
    for (let x = rect.left; x < rect.left + rect.width; x++) setPx(img, x, y, rgb)
}

function px(img: { width: number; data: Uint8ClampedArray }, x: number, y: number): number[] {
  const i = (y * img.width + x) * 4
  return [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!, img.data[i + 3]!]
}

function rectMask(rect: Rect): CanvasMask {
  return { rect: { ...rect }, mask: new Uint8Array(rect.width * rect.height).fill(1) }
}

/** 确定性伪随机纹理（同一相对坐标在所有实例上颜色相同；既不平坦也不对称） */
function texture(rx: number, ry: number): Rgb {
  const h = Math.imul(rx * 374761393 + ry * 668265263, 1274126177) >>> 0
  return [60 + (h & 63), 40 + ((h >> 6) & 63), 90 + ((h >> 12) & 63)]
}

const GARBAGE: Rgb = [255, 0, 255]

describe('uiPreciseSplit v2 · P2 deterministic occlusion completion', () => {
  it('row/column interpolation reproduces a vertical-gradient panel exactly under a child', () => {
    const W = 60
    const H = 40
    const panel = { left: 5, top: 5, width: 50, height: 30 }
    const child = { left: 20, top: 12, width: 18, height: 10 }
    const plate = createImage(W, H)
    fill(plate, [10, 10, 10])
    const grad = (y: number): Rgb => [30 + y * 3, 50 + y * 2, 120 - y]
    for (let y = panel.top; y < panel.top + panel.height; y++)
      fill(plate, grad(y), { left: panel.left, top: y, width: panel.width, height: 1 })
    // 子元素下方的补底是垃圾（模拟推拉糊块 / 生图漂移）
    fill(plate, GARBAGE, child)
    const own = buildOwnershipMap(W, H, [
      { id: 'panel', paintIndex: 1, mask: rectMask(panel) },
      { id: 'child', paintIndex: 2, mask: rectMask(child) }
    ])
    const rep = completeOccludedRegions({
      ownership: own,
      targets: [{ id: 'panel', kind: 'panel', entryIndex: 0, mask: rectMask(panel), plate }]
    })
    expect(rep.axis).toBeGreaterThan(child.width * child.height * 0.9)
    for (const [x, y] of [
      [25, 15],
      [30, 18],
      [36, 20]
    ] as const) {
      const p = px(plate, x, y)
      const g = grad(y)
      expect(Math.abs(p[0]! - g[0])).toBeLessThanOrEqual(2)
      expect(Math.abs(p[1]! - g[1])).toBeLessThanOrEqual(2)
      expect(Math.abs(p[2]! - g[2])).toBeLessThanOrEqual(2)
    }
    // 可见像素不动
    expect(px(plate, 8, 8)).toEqual([...grad(8), 255])
  })

  it('mirror symmetry restores an occluded decorated corner exactly', () => {
    const W = 50
    const H = 40
    const frame = { left: 5, top: 5, width: 40, height: 30 }
    const plate = createImage(W, H)
    fill(plate, [10, 10, 10])
    fill(plate, [70, 80, 100], frame)
    // 左右对称的角花（纹理随机 → 行列插值失效，只能靠镜像）
    for (let ry = 0; ry < 8; ry++) {
      for (let rx = 0; rx < 8; rx++) {
        const c = texture(rx, ry)
        setPx(plate, frame.left + rx, frame.top + ry, c)
        setPx(plate, frame.left + frame.width - 1 - rx, frame.top + ry, c)
      }
    }
    const occ = { left: frame.left + frame.width - 10, top: frame.top, width: 10, height: 10 }
    const truth = createImage(W, H)
    truth.data.set(plate.data)
    fill(plate, GARBAGE, occ)
    const own = buildOwnershipMap(W, H, [
      { id: 'frame', paintIndex: 1, mask: rectMask(frame) },
      { id: 'badge', paintIndex: 2, mask: rectMask(occ) }
    ])
    const rep = completeOccludedRegions({
      ownership: own,
      targets: [{ id: 'frame', kind: 'item-slot', entryIndex: 0, mask: rectMask(frame), plate }]
    })
    expect(rep.mirror).toBeGreaterThan(0)
    for (let y = occ.top; y < occ.top + 8; y++) {
      for (let x = occ.left + 2; x < occ.left + occ.width; x++) {
        expect(px(plate, x, y)).toEqual(px(truth, x, y))
      }
    }
  })

  it('fuses repeated prefab instances: each occluded patch is restored from the other instances, mismatched look-alikes are not grouped', () => {
    const W = 180
    const H = 50
    const slots = [10, 50, 90].map((left) => ({ left, top: 10, width: 30, height: 30 }))
    const odd = { left: 135, top: 10, width: 30, height: 30 }
    const plate = createImage(W, H)
    fill(plate, [8, 10, 16])
    for (const s of slots)
      for (let ry = 0; ry < s.height; ry++)
        for (let rx = 0; rx < s.width; rx++) setPx(plate, s.left + rx, s.top + ry, texture(rx, ry))
    for (let ry = 0; ry < odd.height; ry++)
      for (let rx = 0; rx < odd.width; rx++)
        setPx(plate, odd.left + rx, odd.top + ry, texture(rx + 7, ry + 3))
    const truth = createImage(W, H)
    truth.data.set(plate.data)
    const occluders = [
      { left: slots[0]!.left + 4, top: 14, width: 8, height: 8 },
      { left: slots[1]!.left + 16, top: 14, width: 8, height: 8 },
      { left: slots[2]!.left + 4, top: 26, width: 8, height: 8 }
    ]
    for (const o of occluders) fill(plate, GARBAGE, o)
    const entries = [
      ...slots.map((s, i) => ({ id: `slot${i}`, paintIndex: 1, mask: rectMask(s) })),
      { id: 'odd', paintIndex: 1, mask: rectMask(odd) },
      ...occluders.map((o, i) => ({ id: `icon${i}`, paintIndex: 2, mask: rectMask(o) }))
    ]
    const own = buildOwnershipMap(W, H, entries)
    const rep = completeOccludedRegions({
      ownership: own,
      targets: [
        ...slots.map((s, i) => ({
          id: `slot${i}`,
          kind: 'item-slot',
          entryIndex: i,
          mask: rectMask(s),
          plate
        })),
        { id: 'odd', kind: 'item-slot', entryIndex: 3, mask: rectMask(odd), plate }
      ]
    })
    expect(rep.prefabGroups).toHaveLength(1)
    expect([...rep.prefabGroups[0]!].sort()).toEqual(['slot0', 'slot1', 'slot2'])
    expect(rep.instances).toBeGreaterThan(150)
    for (const o of occluders) {
      for (let y = o.top; y < o.top + o.height; y++) {
        for (let x = o.left; x < o.left + o.width; x++) {
          expect(px(plate, x, y)).toEqual(px(truth, x, y))
        }
      }
    }
  })

  it('palette refine trims background pixels that a loose mask swallowed, but keeps a distinct border line', () => {
    const W = 60
    const H = 60
    const img = createImage(W, H)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) setPx(img, x, y, texture(x, y))
    const icon = { left: 20, top: 20, width: 14, height: 14 }
    fill(img, [250, 220, 30], icon)
    // 掩码多包了 2px 纹理底
    const loose = { left: 18, top: 18, width: 18, height: 18 }
    const r1 = refineMaskByPalette(img, rectMask(loose))
    expect(r1.removed).toBeGreaterThan(100)
    // 图标本体一个都没删
    for (let y = icon.top; y < icon.top + icon.height; y++)
      for (let x = icon.left; x < icon.left + icon.width; x++)
        expect(r1.mask[(y - loose.top) * loose.width + (x - loose.left)]).toBe(1)

    // 独立颜色的 2px 灰边框：既不像核心也不像底色 → 保留
    const img2 = createImage(W, H)
    fill(img2, [10, 35, 65])
    const card = { left: 10, top: 10, width: 30, height: 30 }
    fill(img2, [135, 140, 145], card)
    fill(img2, [14, 14, 20], { left: 12, top: 12, width: 26, height: 26 })
    const r2 = refineMaskByPalette(img2, rectMask(card))
    expect(r2.removed).toBe(0)
  })

  it('end-to-end: three reward slots with icons at different spots get exact slot backgrounds and a shared prefab key', async () => {
    const W = 140
    const H = 50
    const slots = [10, 55, 100].map((left) => ({ left, top: 10, width: 30, height: 30 }))
    const icons = [
      { left: slots[0]!.left + 4, top: 14, width: 9, height: 9 },
      { left: slots[1]!.left + 17, top: 14, width: 9, height: 9 },
      { left: slots[2]!.left + 4, top: 27, width: 9, height: 9 }
    ]
    const img = createImage(W, H)
    fill(img, [8, 10, 16])
    for (const s of slots)
      for (let ry = 0; ry < s.height; ry++)
        for (let rx = 0; rx < s.width; rx++) setPx(img, s.left + rx, s.top + ry, texture(rx, ry))
    const ICON: Rgb = [250, 220, 30]
    for (const ic of icons) fill(img, ICON, ic)
    const toBox2d = (r: Rect): number[] => [
      Math.round((r.top / H) * 1000),
      Math.round((r.left / W) * 1000),
      Math.round(((r.top + r.height) / H) * 1000),
      Math.round(((r.left + r.width) / W) * 1000)
    ]
    const io: PreciseSplitIo = {
      vlm: async () =>
        JSON.stringify({
          background_repair: { mode: 'surface' },
          elements: [
            ...slots.map((s, i) => ({
              id: `slot${i}`,
              name: `Reward Slot ${i + 1}`,
              kind: 'item-slot',
              box_2d: toBox2d(s),
              order: 1
            })),
            ...icons.map((ic, i) => ({
              id: `icon${i}`,
              name: `Reward Icon ${i + 1}`,
              kind: 'icon',
              parent: `slot${i}`,
              box_2d: toBox2d(ic),
              order: 2
            }))
          ]
        }),
      encodePng: async () => 'data:image/png;base64,AAAA',
      ocr: async () => []
    }
    const res = await runPreciseUiSplit(io, img, { generativePeel: false, zoomRefine: false })
    expect(res.completion?.prefabGroups.length).toBe(1)
    expect(res.qa?.flagged).toBe(0)
    expect(res.reconstructionError).toBeLessThan(0.5)
    const slotLayers = res.layers.filter((l) => l.name.startsWith('Reward Slot'))
    expect(slotLayers).toHaveLength(3)
    expect(new Set(slotLayers.map((l) => l.prefabKey)).size).toBe(1)
    expect(slotLayers[0]!.prefabKey).toBeTruthy()
    // 每个槽位图层在其图标正下方都恢复成真实槽位纹理
    slotLayers.forEach((layer, i) => {
      const ic = icons[i]!
      const s = slots[i]!
      for (const [dx, dy] of [
        [2, 2],
        [4, 4],
        [6, 5]
      ] as const) {
        const x = ic.left + dx
        const y = ic.top + dy
        const got = px({ width: layer.width, data: layer.rgba }, x - layer.left, y - layer.top)
        expect(got).toEqual([...texture(x - s.left, y - s.top), 255])
      }
    })
  })
})
