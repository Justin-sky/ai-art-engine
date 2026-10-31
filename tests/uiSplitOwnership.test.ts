import { describe, expect, it } from 'vitest'
import {
  buildOwnershipMap,
  composeOwnedLayer,
  createImage,
  runPreciseUiSplit,
  runSplitQa,
  scanPlateResidue,
  scrubPlateResidue,
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

function fill(img: RgbaImage, rgb: Rgb, rect?: Rect): void {
  const r = rect ?? { left: 0, top: 0, width: img.width, height: img.height }
  for (let y = r.top; y < r.top + r.height; y++) {
    for (let x = r.left; x < r.left + r.width; x++) {
      const i = (y * img.width + x) * 4
      img.data[i] = rgb[0]
      img.data[i + 1] = rgb[1]
      img.data[i + 2] = rgb[2]
      img.data[i + 3] = 255
    }
  }
}

function setPx(img: RgbaImage, x: number, y: number, rgb: Rgb): void {
  const i = (y * img.width + x) * 4
  img.data[i] = rgb[0]
  img.data[i + 1] = rgb[1]
  img.data[i + 2] = rgb[2]
  img.data[i + 3] = 255
}

function px(img: { width: number; data: Uint8ClampedArray }, x: number, y: number): number[] {
  const i = (y * img.width + x) * 4
  return [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!, img.data[i + 3]!]
}

function layerPx(layer: { rect: Rect; rgba: Uint8ClampedArray }, x: number, y: number): number[] {
  const lx = x - layer.rect.left
  const ly = y - layer.rect.top
  if (lx < 0 || ly < 0 || lx >= layer.rect.width || ly >= layer.rect.height) return [0, 0, 0, 0]
  const i = (ly * layer.rect.width + lx) * 4
  return [layer.rgba[i]!, layer.rgba[i + 1]!, layer.rgba[i + 2]!, layer.rgba[i + 3]!]
}

function rectMask(rect: Rect): CanvasMask {
  return { rect: { ...rect }, mask: new Uint8Array(rect.width * rect.height).fill(1) }
}

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  Math.round(a[0] * t + b[0] * (1 - t)),
  Math.round(a[1] * t + b[1] * (1 - t)),
  Math.round(a[2] * t + b[2] * (1 - t))
]

const PANEL: Rgb = [40, 60, 120]
const BTN: Rgb = [230, 180, 40]

describe('uiPreciseSplit v2 · ownership / edge unmix / pixel lock / residue / QA', () => {
  it('builds a gap-free, overlap-free ownership map where higher paint wins', () => {
    const own = buildOwnershipMap(20, 10, [
      { id: 'panel', paintIndex: 1, mask: rectMask({ left: 0, top: 0, width: 20, height: 10 }) },
      { id: 'btn', paintIndex: 2, mask: rectMask({ left: 5, top: 2, width: 6, height: 4 }) }
    ])
    expect(own.owner[3 * 20 + 7]).toBe(1)
    expect(own.owner[0]).toBe(0)
    let base = 0
    for (const o of own.owner) if (o < 0) base++
    expect(base).toBe(0)
  })

  it('keeps the element interior fully opaque even when the inpainted lower plate is wrong, and unmixes AA edges without background tint', () => {
    const W = 40
    const H = 30
    const btnRect = { left: 10, top: 8, width: 20, height: 12 }
    const source = createImage(W, H)
    fill(source, PANEL)
    fill(source, BTN, btnRect)
    // 1px 抗锯齿边：右侧一列 50% 混合
    for (let y = btnRect.top; y < btnRect.top + btnRect.height; y++) {
      setPx(source, btnRect.left + btnRect.width, y, mix(BTN, PANEL, 0.5))
    }
    const upper = createImage(W, H)
    upper.data.set(source.data)
    // 故意糟糕的补底：按钮区域被补成「接近按钮色」的错误颜色（旧差分抠图会把内部判成透明）
    const lower = createImage(W, H)
    fill(lower, PANEL)
    fill(lower, [222, 176, 52], btnRect)
    const mask = rectMask(btnRect)
    const own = buildOwnershipMap(W, H, [
      { id: 'panel', paintIndex: 1, mask: rectMask({ left: 0, top: 0, width: W, height: H }) },
      { id: 'btn', paintIndex: 2, mask }
    ])
    const layer = composeOwnedLayer({
      source,
      upper,
      lower,
      mask,
      ownership: own,
      entryIndex: 1
    })!
    expect(layer).not.toBeNull()
    // 内部全部不透明且是原图像素（旧路径：色差 < t0 → 透明，按钮被切掉一半）
    for (let y = btnRect.top + 1; y < btnRect.top + btnRect.height - 1; y++) {
      for (let x = btnRect.left + 1; x < btnRect.left + btnRect.width - 1; x++) {
        expect(layerPx(layer, x, y)).toEqual([...BTN, 255])
      }
    }
    // 抗锯齿列：alpha ≈ 0.5，颜色解混回按钮色（不带面板蓝）
    const aa = layerPx(layer, btnRect.left + btnRect.width, btnRect.top + 5)
    expect(aa[3]).toBeGreaterThan(100)
    expect(aa[3]).toBeLessThan(155)
    expect(Math.abs(aa[0]! - BTN[0])).toBeLessThanOrEqual(8)
    expect(Math.abs(aa[2]! - BTN[2])).toBeLessThanOrEqual(12)
  })

  it('locks visible pixels to the source so drifted (generated) upper plates never leak into the layer', () => {
    const W = 30
    const H = 20
    const r = { left: 5, top: 5, width: 20, height: 10 }
    const source = createImage(W, H)
    fill(source, PANEL)
    fill(source, BTN, r)
    const upper = createImage(W, H)
    upper.data.set(source.data)
    // 生成模型漂移：可见区域整体偏色
    fill(upper, [250, 150, 70], r)
    const lower = createImage(W, H)
    fill(lower, PANEL)
    const mask = rectMask(r)
    const own = buildOwnershipMap(W, H, [{ id: 'btn', paintIndex: 1, mask }])
    const layer = composeOwnedLayer({ source, upper, lower, mask, ownership: own, entryIndex: 0 })!
    expect(layerPx(layer, 15, 10)).toEqual([...BTN, 255])
  })

  it('keeps a distinct-colour 2px border opaque instead of unmixing it away', () => {
    const W = 40
    const H = 40
    const card = { left: 8, top: 8, width: 24, height: 24 }
    const source = createImage(W, H)
    fill(source, [10, 35, 65])
    fill(source, [135, 140, 145], card)
    fill(source, [14, 14, 20], { left: 10, top: 10, width: 20, height: 20 })
    const upper = createImage(W, H)
    upper.data.set(source.data)
    const lower = createImage(W, H)
    fill(lower, [10, 35, 65])
    const mask = rectMask(card)
    const own = buildOwnershipMap(W, H, [{ id: 'card', paintIndex: 1, mask }])
    const layer = composeOwnedLayer({ source, upper, lower, mask, ownership: own, entryIndex: 0 })!
    expect(layerPx(layer, 20, 8)).toEqual([135, 140, 145, 255])
    expect(layerPx(layer, 8, 20)).toEqual([135, 140, 145, 255])
  })

  it('detects and scrubs a glow ring left on the plate, but leaves an adjacent third-colour border line alone', () => {
    const W = 60
    const H = 40
    const btn = { left: 20, top: 12, width: 20, height: 14 }
    const upper = createImage(W, H)
    fill(upper, PANEL)
    fill(upper, BTN, btn)
    // 外发光 2px（按钮色 60% / 30% 混合），只在左、上、下三侧
    for (let x = btn.left - 2; x < btn.left + btn.width + 2; x++) {
      for (const [y, t] of [
        [btn.top - 1, 0.6],
        [btn.top - 2, 0.3],
        [btn.top + btn.height, 0.6],
        [btn.top + btn.height + 1, 0.3]
      ] as const) {
        setPx(upper, x, y, mix(BTN, PANEL, t))
      }
    }
    for (let y = btn.top; y < btn.top + btn.height; y++) {
      setPx(upper, btn.left - 1, y, mix(BTN, PANEL, 0.6))
      setPx(upper, btn.left - 2, y, mix(BTN, PANEL, 0.3))
    }
    // 右侧紧贴一条第三种颜色（绿色）的竖分割线：不是残留
    for (let y = 4; y < 36; y++) setPx(upper, btn.left + btn.width + 1, y, [40, 200, 90])
    // 剥层补底只覆盖了按钮本体（旧 pad 不够大）：外发光留在下层底板上
    const lower = createImage(W, H)
    lower.data.set(upper.data)
    fill(lower, PANEL, btn)
    const mask = rectMask(btn)
    const own = buildOwnershipMap(W, H, [
      { id: 'panel', paintIndex: 1, mask: rectMask({ left: 0, top: 0, width: W, height: H }) },
      { id: 'btn', paintIndex: 2, mask }
    ])
    const scan = scanPlateResidue({
      plate: lower,
      upper,
      mask,
      ownership: own,
      entryIndex: 1,
      radius: 3
    })
    expect(scan.pixels.length).toBeGreaterThan(40)
    const greenIdx = 20 * W + btn.left + btn.width + 1
    expect(scan.pixels.includes(greenIdx)).toBe(false)

    const plates: RgbaImage[] = []
    plates[1] = lower
    plates[2] = upper
    const fixed = scrubPlateResidue({ plates, level: 1, residue: scan.pixels, mask })
    expect(fixed).toBeGreaterThan(40)
    // 发光环被补成面板色
    const glow = px(lower, btn.left - 1, 18)
    expect(Math.abs(glow[0]! - PANEL[0])).toBeLessThan(25)
    expect(Math.abs(glow[2]! - PANEL[2])).toBeLessThan(25)
    // 绿色分割线原样保留
    expect(px(lower, btn.left + btn.width + 1, 20)).toEqual([40, 200, 90, 255])

    // 清扫后再合成：外发光作为按钮图层的软 alpha，而不是留在底板
    const layer = composeOwnedLayer({
      source: upper,
      upper,
      lower,
      mask,
      ownership: own,
      entryIndex: 1,
      haloRadius: 3
    })!
    expect(layerPx(layer, btn.left - 1, 18)[3]).toBeGreaterThan(90)
    const qa = runSplitQa({
      source: upper,
      base: lower,
      ownership: own,
      layers: [
        {
          elementId: 'btn',
          name: 'btn',
          plainText: false,
          entryIndex: 1,
          mask,
          layer,
          lower,
          upper,
          haloRadius: 3
        }
      ]
    })
    expect(qa.layers[0]!.issues).not.toContain('base_residue')
    expect(qa.layers[0]!.issues).not.toContain('edge_halo')
  })

  it('end-to-end: a glowing button leaves zero glow residue on the panel and reconstructs exactly', async () => {
    const W = 120
    const H = 80
    const panel = { left: 10, top: 10, width: 100, height: 60 }
    const btn = { left: 40, top: 30, width: 40, height: 20 }
    const img = createImage(W, H)
    fill(img, [16, 22, 34])
    fill(img, PANEL, panel)
    // 3px 外发光
    for (let d = 3; d >= 1; d--) {
      const t = 0.25 * (4 - d)
      fill(img, mix(BTN, PANEL, t), {
        left: btn.left - d,
        top: btn.top - d,
        width: btn.width + 2 * d,
        height: btn.height + 2 * d
      })
    }
    fill(img, BTN, btn)
    const toBox2d = (r: Rect): number[] => [
      Math.round((r.top / H) * 1000),
      Math.round((r.left / W) * 1000),
      Math.round(((r.top + r.height) / H) * 1000),
      Math.round(((r.left + r.width) / W) * 1000)
    ]
    const io: PreciseSplitIo = {
      vlm: async () =>
        JSON.stringify({
          screen_kind: 'popup',
          background_repair: { mode: 'surface' },
          elements: [
            { id: 'panel', name: 'Panel', kind: 'panel', box_2d: toBox2d(panel), order: 1 },
            {
              id: 'btn',
              name: 'Confirm Button',
              kind: 'button',
              parent: 'panel',
              box_2d: toBox2d(btn),
              order: 2
            }
          ]
        }),
      encodePng: async () => 'data:image/png;base64,AAAA',
      ocr: async () => []
    }
    const res = await runPreciseUiSplit(io, img, { generativePeel: false, zoomRefine: false })
    const panelLayer = res.layers.find((l) => l.name === 'Panel')!
    const btnLayer = res.layers.find((l) => l.name === 'Confirm Button')!
    expect(panelLayer).toBeTruthy()
    expect(btnLayer).toBeTruthy()
    // 面板图层在发光环位置是干净的面板色（没有按钮黄色残留）
    for (const [x, y] of [
      [btn.left - 2, btn.top + 10],
      [btn.left + 20, btn.top - 2],
      [btn.left + btn.width + 1, btn.top + 5],
      [btn.left + 20, btn.top + btn.height + 1]
    ] as const) {
      const p = px(
        { width: panelLayer.width, data: panelLayer.rgba },
        x - panelLayer.left,
        y - panelLayer.top
      )
      expect(Math.abs(p[0]! - PANEL[0])).toBeLessThan(30)
      expect(Math.abs(p[1]! - PANEL[1])).toBeLessThan(30)
      expect(Math.abs(p[2]! - PANEL[2])).toBeLessThan(30)
    }
    // 按钮本体完整不透明
    const center = px(
      { width: btnLayer.width, data: btnLayer.rgba },
      btn.left + 20 - btnLayer.left,
      btn.top + 10 - btnLayer.top
    )
    expect(center).toEqual([...BTN, 255])
    // 发光归按钮：发光环内侧像素有明显 alpha
    const glow = px(
      { width: btnLayer.width, data: btnLayer.rgba },
      btn.left - 1 - btnLayer.left,
      btn.top + 10 - btnLayer.top
    )
    expect(glow[3]).toBeGreaterThan(80)
    expect(res.reconstructionError).toBeLessThan(1.5)
    expect(res.qa).toBeTruthy()
  })

  it('routes SAM 2.1 through a large context crop and maps the mask back to canvas coordinates', async () => {
    const W = 120
    const H = 80
    const panel = { left: 10, top: 10, width: 100, height: 60 }
    // 圆形图标（非矩形）：SAM 返回真实圆形掩码
    const icon = { cx: 60, cy: 40, r: 10 }
    const img = createImage(W, H)
    fill(img, [16, 22, 34])
    fill(img, PANEL, panel)
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        if (Math.hypot(x - icon.cx, y - icon.cy) <= icon.r) setPx(img, x, y, [240, 90, 60])
    const toBox2d = (r: Rect): number[] => [
      Math.round((r.top / H) * 1000),
      Math.round((r.left / W) * 1000),
      Math.round(((r.top + r.height) / H) * 1000),
      Math.round(((r.left + r.width) / W) * 1000)
    ]
    const samCalls: Array<{ w: number; h: number }> = []
    const io: PreciseSplitIo = {
      vlm: async () =>
        JSON.stringify({
          elements: [
            { id: 'panel', name: 'Panel', kind: 'panel', box_2d: toBox2d(panel), order: 1 },
            {
              id: 'icon',
              name: 'Gem Icon',
              kind: 'icon',
              parent: 'panel',
              // VLM 框故意偏大
              box_2d: toBox2d({ left: 46, top: 26, width: 28, height: 28 }),
              order: 2
            }
          ]
        }),
      encodePng: async () => 'data:image/png;base64,AAAA',
      ocr: async () => [],
      segmentSam2: async (req) => {
        samCalls.push({ w: req.image.width, h: req.image.height })
        const n = req.image.width * req.image.height
        const mask = new Uint8Array(n)
        for (let p = 0; p < n; p++) {
          const i = p * 4
          if (req.image.data[i]! > 200 && req.image.data[i + 1]! < 120) mask[p] = 1
        }
        return [{ mask, samScore: 0.97 }]
      }
    }
    const res = await runPreciseUiSplit(io, img, { generativePeel: false, zoomRefine: false })
    expect(samCalls.length).toBeGreaterThan(0)
    // 上下文裁剪比元素框大（≥ 框 + 2×12px）
    expect(Math.max(...samCalls.map((c) => c.w))).toBeGreaterThanOrEqual(28 + 24)
    const iconLayer = res.layers.find((l) => l.name === 'Gem Icon')!
    expect(iconLayer).toBeTruthy()
    // 紧致到真实圆形（21px 直径 + ≤2px 软边）
    expect(iconLayer.width).toBeLessThanOrEqual(25)
    expect(iconLayer.height).toBeLessThanOrEqual(25)
    // 圆外的四角透明（没有把面板方角带进图标层）
    const corner = px({ width: iconLayer.width, data: iconLayer.rgba }, 0, 0)
    expect(corner[3]).toBeLessThan(40)
  })
})
