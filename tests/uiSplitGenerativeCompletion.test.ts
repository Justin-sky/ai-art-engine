import { describe, expect, it } from 'vitest'
import {
  blendWithOffsetField,
  buildOwnershipMap,
  completeOccludedGenerative,
  createImage,
  resizeBilinear,
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
  img.data[i] = Math.max(0, Math.min(255, rgb[0]))
  img.data[i + 1] = Math.max(0, Math.min(255, rgb[1]))
  img.data[i + 2] = Math.max(0, Math.min(255, rgb[2]))
  img.data[i + 3] = 255
}
function fill(img: RgbaImage, rgb: Rgb, r?: Rect): void {
  const rect = r ?? { left: 0, top: 0, width: img.width, height: img.height }
  for (let y = rect.top; y < rect.top + rect.height; y++)
    for (let x = rect.left; x < rect.left + rect.width; x++) setPx(img, x, y, rgb)
}
function px(img: RgbaImage, x: number, y: number): number[] {
  const i = (y * img.width + x) * 4
  return [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!, img.data[i + 3]!]
}
function rectMask(rect: Rect): CanvasMask {
  return { rect: { ...rect }, mask: new Uint8Array(rect.width * rect.height).fill(1) }
}
/** 平滑但有纹理的「立绘」内容（条纹 + 低频变化），按绝对坐标定义 */
function art(x: number, y: number): Rgb {
  const s = Math.sin(x * 0.9) * 40 + Math.cos(y * 0.7) * 30
  return [150 + s, 110 + s * 0.6, 90 - s * 0.4]
}
function maxDiff(a: number[], b: Rgb): number {
  return Math.max(Math.abs(a[0]! - b[0]), Math.abs(a[1]! - b[1]), Math.abs(a[2]! - b[2]))
}

describe('uiPreciseSplit v2 · P3 per-layer generative completion', () => {
  it('offset-field blending removes a global colour cast at the seam and inside the hole', () => {
    const w = 40
    const h = 30
    const plate = createImage(w, h)
    const gen = createImage(w, h)
    const hole = new Uint8Array(w * h)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const c = art(x, y)
        setPx(plate, x, y, c)
        setPx(gen, x, y, [c[0] + 20, c[1] + 20, c[2] + 20])
        if (x >= 12 && x < 28 && y >= 8 && y < 22) {
          hole[y * w + x] = 1
          setPx(plate, x, y, [128, 128, 128])
        }
      }
    const out = blendWithOffsetField(plate, gen, hole)
    for (const [x, y] of [
      [12, 8],
      [20, 15],
      [27, 21]
    ] as const) {
      expect(maxDiff(px(out, x, y), art(x, y))).toBeLessThanOrEqual(3)
    }
    // 补全区外不变
    expect(px(out, 2, 2)).toEqual(px(plate, 2, 2))
  })

  function scene(): {
    W: number
    H: number
    portrait: Rect
    badge: Rect
    plate: RgbaImage
    truth: RgbaImage
  } {
    const W = 120
    const H = 100
    const portrait = { left: 20, top: 10, width: 80, height: 80 }
    const badge = { left: 50, top: 40, width: 24, height: 20 }
    const truth = createImage(W, H)
    fill(truth, [12, 14, 20])
    for (let y = portrait.top; y < portrait.top + portrait.height; y++)
      for (let x = portrait.left; x < portrait.left + portrait.width; x++)
        setPx(truth, x, y, art(x, y))
    // 剥掉角标后的本地补底：一团平均色（糊块）
    const plate = createImage(W, H)
    plate.data.set(truth.data)
    fill(plate, [150, 110, 90], badge)
    return { W, H, portrait, badge, plate, truth }
  }

  it('fills a blurry occluded portrait region from a per-layer masked generation (tinted, rescaled) and rejects a recomposed result', async () => {
    const s = scene()
    const own = buildOwnershipMap(s.W, s.H, [
      { id: 'portrait', paintIndex: 1, mask: rectMask(s.portrait) },
      { id: 'badge', paintIndex: 2, mask: rectMask(s.badge) }
    ])
    const store = new Map<string, RgbaImage>()
    let n = 0
    const prompts: string[] = []
    const io: Pick<PreciseSplitIo, 'editImage' | 'encodePng' | 'log' | 'signal'> = {
      encodePng: async (img) => {
        const id = `img${n++}`
        store.set(id, img)
        return id
      },
      editImage: async (req) => {
        prompts.push(req.prompt)
        const diag = store.get(req.image)!
        // 模型输出：真实内容 + 整体偏色，且分辨率是 2 倍（模拟生图模型输出尺寸不同）
        const out = createImage(diag.width, diag.height)
        const ox = s.portrait.left - Math.max(8, Math.round(80 * 0.12))
        const oy = s.portrait.top - Math.max(8, Math.round(80 * 0.12))
        for (let y = 0; y < diag.height; y++)
          for (let x = 0; x < diag.width; x++) {
            const t = px(
              s.truth,
              Math.max(0, Math.min(s.W - 1, x + ox)),
              Math.max(0, Math.min(s.H - 1, y + oy))
            )
            setPx(out, x, y, [t[0]! + 12, t[1]! + 12, t[2]! + 12])
          }
        return resizeBilinear(out, diag.width * 2, diag.height * 2)
      }
    }
    const rep = await completeOccludedGenerative({
      io,
      ownership: own,
      targets: [
        {
          id: 'portrait',
          name: 'Hero Portrait',
          kind: 'avatar',
          entryIndex: 0,
          mask: rectMask(s.portrait),
          plate: s.plate
        }
      ]
    })
    expect(rep.attempted).toBe(1)
    expect(rep.accepted).toBe(1)
    expect(prompts[0]).toContain('Hero Portrait')
    // 角标中心恢复成真实立绘内容（偏色已被偏移场消除）
    for (const [x, y] of [
      [56, 46],
      [62, 50],
      [70, 56]
    ] as const) {
      expect(maxDiff(px(s.plate, x, y), art(x, y))).toBeLessThanOrEqual(10)
    }

    // 重构了构图的结果：被拒绝，底板不动
    const s2 = scene()
    const before = new Uint8ClampedArray(s2.plate.data)
    const rep2 = await completeOccludedGenerative({
      io: {
        encodePng: async () => 'x',
        editImage: async () => {
          const junk = createImage(100, 100)
          for (let y = 0; y < 100; y++)
            for (let x = 0; x < 100; x++) setPx(junk, x, y, [(x * 7) % 255, 20, (y * 5) % 255])
          return junk
        }
      },
      ownership: own,
      targets: [
        {
          id: 'portrait',
          name: 'Hero Portrait',
          kind: 'avatar',
          entryIndex: 0,
          mask: rectMask(s2.portrait),
          plate: s2.plate
        }
      ]
    })
    expect(rep2.rejected).toBe(1)
    expect(Array.from(s2.plate.data)).toEqual(Array.from(before))
  })

  it('does not spend a generation call on flat surroundings or structured controls', async () => {
    const W = 80
    const H = 60
    const panel = { left: 10, top: 10, width: 60, height: 40 }
    const child = { left: 30, top: 20, width: 20, height: 15 }
    const plate = createImage(W, H)
    fill(plate, [40, 60, 120])
    const own = buildOwnershipMap(W, H, [
      { id: 'a', paintIndex: 1, mask: rectMask(panel) },
      { id: 'b', paintIndex: 2, mask: rectMask(child) }
    ])
    let calls = 0
    const io = {
      encodePng: async () => 'x',
      editImage: async () => {
        calls++
        return null
      }
    }
    // 平涂立绘区域（周围无纹理）
    await completeOccludedGenerative({
      io,
      ownership: own,
      targets: [
        { id: 'a', name: 'flat', kind: 'avatar', entryIndex: 0, mask: rectMask(panel), plate }
      ]
    })
    // 结构类控件（交给 P2）
    await completeOccludedGenerative({
      io,
      ownership: own,
      targets: [
        { id: 'a', name: 'panel', kind: 'panel', entryIndex: 0, mask: rectMask(panel), plate }
      ]
    })
    expect(calls).toBe(0)
  })

  it('pipeline: QA flags a blurry occluded portrait when generation is off, and per-layer completion clears it when on', async () => {
    const W = 120
    const H = 100
    const portrait = { left: 20, top: 10, width: 80, height: 80 }
    const badge = { left: 50, top: 40, width: 24, height: 20 }
    const img = createImage(W, H)
    fill(img, [12, 14, 20])
    for (let y = portrait.top; y < portrait.top + portrait.height; y++)
      for (let x = portrait.left; x < portrait.left + portrait.width; x++)
        setPx(img, x, y, art(x, y))
    fill(img, [240, 240, 250], badge)
    const toBox2d = (r: Rect): number[] => [
      Math.round((r.top / H) * 1000),
      Math.round((r.left / W) * 1000),
      Math.round(((r.top + r.height) / H) * 1000),
      Math.round(((r.left + r.width) / W) * 1000)
    ]
    const vlm = async (): Promise<string> =>
      JSON.stringify({
        elements: [
          {
            id: 'p',
            name: 'Hero Portrait',
            kind: 'illustration',
            box_2d: toBox2d(portrait),
            order: 1
          },
          { id: 'b', name: 'Badge', kind: 'badge', parent: 'p', box_2d: toBox2d(badge), order: 2 }
        ]
      })
    const off = await runPreciseUiSplit(
      { vlm, encodePng: async () => 'x', ocr: async () => [] },
      img,
      { generativePeel: false, zoomRefine: false }
    )
    const offQa = off.qa!.layers.find((l) => l.name === 'Hero Portrait')!
    expect(offQa.issues).toContain('occluded_blurry')

    // 有生图能力：整版剥层返回 null（不可用），单图层补全返回真实内容
    const store = new Map<string, RgbaImage>()
    let n = 0
    const io: PreciseSplitIo = {
      vlm,
      ocr: async () => [],
      encodePng: async (im) => {
        const id = `img${n++}`
        store.set(id, im)
        return id
      },
      editImage: async (req) => {
        if (!/裁剪图|cropped game UI layer/.test(req.prompt)) return null
        const diag = store.get(req.image)!
        // 在原图里定位裁剪偏移（用非黑像素做模板匹配）
        let best = { ox: 0, oy: 0, err: Infinity }
        for (let oy = 0; oy + diag.height <= H; oy++)
          for (let ox = 0; ox + diag.width <= W; ox++) {
            let err = 0
            let cnt = 0
            for (let k = 0; k < 40; k++) {
              const x = (k * 13) % diag.width
              const y = (k * 7) % diag.height
              const d = px(diag, x, y)
              if (d[0] === 0 && d[1] === 0 && d[2] === 0) continue
              const t = px(img, x + ox, y + oy)
              err += Math.abs(d[0]! - t[0]!) + Math.abs(d[1]! - t[1]!)
              cnt++
            }
            if (cnt && err / cnt < best.err) best = { ox, oy, err: err / cnt }
          }
        const out = createImage(diag.width, diag.height)
        for (let y = 0; y < diag.height; y++)
          for (let x = 0; x < diag.width; x++) {
            const ax = x + best.ox
            const ay = y + best.oy
            const inP =
              ax >= portrait.left &&
              ax < portrait.left + portrait.width &&
              ay >= portrait.top &&
              ay < portrait.top + portrait.height
            setPx(out, x, y, inP ? art(ax, ay) : [12, 14, 20])
          }
        return out
      }
    }
    const on = await runPreciseUiSplit(io, img, { zoomRefine: false })
    expect(on.generativeCompletion?.accepted).toBe(1)
    const onQa = on.qa!.layers.find((l) => l.name === 'Hero Portrait')!
    expect(onQa.issues).not.toContain('occluded_blurry')
    const layer = on.layers.find((l) => l.name === 'Hero Portrait')!
    const lp = (x: number, y: number): number[] => {
      const i = ((y - layer.top) * layer.width + (x - layer.left)) * 4
      return [layer.rgba[i]!, layer.rgba[i + 1]!, layer.rgba[i + 2]!, layer.rgba[i + 3]!]
    }
    expect(maxDiff(lp(62, 50), art(62, 50))).toBeLessThanOrEqual(12)
    expect(lp(62, 50)[3]).toBe(255)
  })
})
