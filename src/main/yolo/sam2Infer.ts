/**
 * SAM 2.1 点 / 框提示分割（ONNX encoder + decoder，运行在 YOLO 推理子进程内）。
 *
 * 兼容 samexporter / AnyLabeling 导出格式（`local-models/sam2/<id>.encoder.onnx` + `<id>.decoder.onnx`）：
 * - encoder：输入 `image` [1,3,1024,1024]（直接缩放到 1024²，ImageNet 均值方差归一化），
 *   输出 `high_res_feats_0` [1,32,256,256] / `high_res_feats_1` [1,64,128,128] / `image_embed` [1,256,64,64]；
 * - decoder：输入 `image_embed` / `high_res_feats_*` / `point_coords` [1,N,2]（1024 坐标系）/
 *   `point_labels` [1,N]（1 前景 0 背景 2 框左上 3 框右下）/ `mask_input` / `has_mask_input`，
 *   部分导出额外带 `orig_im_size`；输出 `masks` [1,K,h,w] logits + `iou_predictions` [1,K]。
 *
 * 输入/输出一律按名字匹配，匹配不上时按通道数推断，兼容不同导出版本。
 */
import { decodeImage } from './imageDecoder'
import { createOrtSession } from './ortSession'
import type { YoloSam2PromptInput, YoloSam2PromptResult } from '@shared/yolo'

type OrtModule = typeof import('onnxruntime-node')
type OrtSession = import('onnxruntime-node').InferenceSession
type OrtTensor = import('onnxruntime-node').Tensor

const SAM2_INPUT = 1024
const MEAN = [0.485, 0.456, 0.406]
const STD = [0.229, 0.224, 0.225]

export interface Sam2WorkerParams extends YoloSam2PromptInput {
  encoderPath: string
  decoderPath: string
  modelId: string
}

interface Sam2Sessions {
  key: string
  encoder: OrtSession
  decoder: OrtSession
}

interface Sam2Embedding {
  key: string
  width: number
  height: number
  embed: OrtTensor
  feats0: OrtTensor
  feats1: OrtTensor
}

let sessions: Sam2Sessions | null = null
/** 图像嵌入 LRU（同一张裁剪图多次提示时省掉 encoder） */
const embedCache: Sam2Embedding[] = []
const EMBED_CACHE_MAX = 6

async function getSessions(mod: OrtModule, params: Sam2WorkerParams): Promise<Sam2Sessions> {
  const key = `${params.encoderPath}\u0000${params.decoderPath}`
  if (sessions?.key === key) return sessions
  const encoder = await createOrtSession(mod, params.encoderPath)
  const decoder = await createOrtSession(mod, params.decoderPath)
  sessions = { key, encoder, decoder }
  embedCache.length = 0
  return sessions
}

function fingerprint(width: number, height: number, rgba: Uint8Array): string {
  let h1 = 2166136261 >>> 0
  let h2 = 0x9e3779b9 >>> 0
  const step = Math.max(4, Math.floor(rgba.length / 4096 / 4) * 4)
  for (let i = 0; i < rgba.length; i += step) {
    h1 = Math.imul(h1 ^ rgba[i]!, 16777619) >>> 0
    h2 = Math.imul(h2 ^ (rgba[i + 1]! | (rgba[i + 2]! << 8)), 2246822519) >>> 0
  }
  return `${width}x${height}:${h1.toString(36)}:${h2.toString(36)}`
}

/** 双线性缩放 RGBA → 1024² 并按 ImageNet 均值方差归一化为 CHW float32 */
function toEncoderTensor(rgba: Uint8Array, width: number, height: number): Float32Array {
  const S = SAM2_INPUT
  const out = new Float32Array(3 * S * S)
  const sx = width / S
  const sy = height / S
  for (let y = 0; y < S; y++) {
    const fy = Math.max(0, Math.min(height - 1, (y + 0.5) * sy - 0.5))
    const y0 = Math.floor(fy)
    const y1 = Math.min(height - 1, y0 + 1)
    const wy = fy - y0
    for (let x = 0; x < S; x++) {
      const fx = Math.max(0, Math.min(width - 1, (x + 0.5) * sx - 0.5))
      const x0 = Math.floor(fx)
      const x1 = Math.min(width - 1, x0 + 1)
      const wx = fx - x0
      const i00 = (y0 * width + x0) * 4
      const i01 = (y0 * width + x1) * 4
      const i10 = (y1 * width + x0) * 4
      const i11 = (y1 * width + x1) * 4
      const p = y * S + x
      for (let c = 0; c < 3; c++) {
        // 透明像素按其颜色参与（UI 裁剪图基本不透明）
        const v =
          (rgba[i00 + c]! * (1 - wx) + rgba[i01 + c]! * wx) * (1 - wy) +
          (rgba[i10 + c]! * (1 - wx) + rgba[i11 + c]! * wx) * wy
        out[c * S * S + p] = (v / 255 - MEAN[c]!) / STD[c]!
      }
    }
  }
  return out
}

function pickEncoderOutputs(outputs: Record<string, OrtTensor>): {
  embed: OrtTensor
  feats0: OrtTensor
  feats1: OrtTensor
} {
  let embed: OrtTensor | undefined
  let feats0: OrtTensor | undefined
  let feats1: OrtTensor | undefined
  for (const [name, t] of Object.entries(outputs)) {
    const n = name.toLowerCase()
    if (n.includes('image_embed')) embed = t
    else if (n.includes('high_res_feats_0') || n.endsWith('feats_0')) feats0 = t
    else if (n.includes('high_res_feats_1') || n.endsWith('feats_1')) feats1 = t
  }
  // 按通道数兜底：256 → embed，32 → feats0，64 → feats1
  for (const t of Object.values(outputs)) {
    const ch = Number(t.dims[1])
    if (!embed && ch === 256) embed = t
    else if (!feats0 && ch === 32) feats0 = t
    else if (!feats1 && ch === 64) feats1 = t
  }
  if (!embed || !feats0 || !feats1) {
    throw new Error(
      `SAM2: unexpected encoder outputs (${Object.keys(outputs).join(', ')}); expected image_embed + high_res_feats_0/1`
    )
  }
  return { embed, feats0, feats1 }
}

async function getEmbedding(
  mod: OrtModule,
  encoder: OrtSession,
  width: number,
  height: number,
  rgba: Uint8Array,
  cacheKey: string
): Promise<Sam2Embedding> {
  const hitIdx = embedCache.findIndex((e) => e.key === cacheKey)
  if (hitIdx >= 0) {
    const hit = embedCache[hitIdx]!
    embedCache.splice(hitIdx, 1)
    embedCache.push(hit)
    return hit
  }
  const tensor = new mod.Tensor('float32', toEncoderTensor(rgba, width, height), [
    1,
    3,
    SAM2_INPUT,
    SAM2_INPUT
  ])
  const outputs = (await encoder.run({ [encoder.inputNames[0]!]: tensor })) as Record<
    string,
    OrtTensor
  >
  const picked = pickEncoderOutputs(outputs)
  const entry: Sam2Embedding = { key: cacheKey, width, height, ...picked }
  embedCache.push(entry)
  while (embedCache.length > EMBED_CACHE_MAX) embedCache.shift()
  return entry
}

function sigmoidByte(logit: number): number {
  if (logit > 12) return 255
  if (logit < -12) return 0
  return Math.round(255 / (1 + Math.exp(-logit)))
}

/** 低分辨率 logits（h×w，对应整张 1024² 输入）双线性放大回原图尺寸并 sigmoid 成 0..255 */
function upsampleLogits(
  logits: Float32Array,
  offset: number,
  lw: number,
  lh: number,
  width: number,
  height: number
): Uint8Array {
  const out = new Uint8Array(width * height)
  const sx = lw / width
  const sy = lh / height
  for (let y = 0; y < height; y++) {
    const fy = Math.max(0, Math.min(lh - 1, (y + 0.5) * sy - 0.5))
    const y0 = Math.floor(fy)
    const y1 = Math.min(lh - 1, y0 + 1)
    const wy = fy - y0
    for (let x = 0; x < width; x++) {
      const fx = Math.max(0, Math.min(lw - 1, (x + 0.5) * sx - 0.5))
      const x0 = Math.floor(fx)
      const x1 = Math.min(lw - 1, x0 + 1)
      const wx = fx - x0
      const v =
        (logits[offset + y0 * lw + x0]! * (1 - wx) + logits[offset + y0 * lw + x1]! * wx) *
          (1 - wy) +
        (logits[offset + y1 * lw + x0]! * (1 - wx) + logits[offset + y1 * lw + x1]! * wx) * wy
      out[y * width + x] = sigmoidByte(v)
    }
  }
  return out
}

export async function inferSam2(
  mod: OrtModule,
  params: Sam2WorkerParams
): Promise<YoloSam2PromptResult> {
  const started = Date.now()
  const decoded = await decodeImage(params.image)
  const { width, height } = decoded
  const rgba = decoded.rgba
  const { encoder, decoder } = await getSessions(mod, params)
  const cacheKey = params.cacheKey || fingerprint(width, height, rgba)
  const emb = await getEmbedding(mod, encoder, width, height, rgba, cacheKey)

  const coords: number[] = []
  const labels: number[] = []
  const kx = SAM2_INPUT / width
  const ky = SAM2_INPUT / height
  for (const p of params.points ?? []) {
    coords.push(p.x * kx, p.y * ky)
    labels.push(p.label === 1 ? 1 : 0)
  }
  if (params.box) {
    coords.push(params.box.x0 * kx, params.box.y0 * ky, params.box.x1 * kx, params.box.y1 * ky)
    labels.push(2, 3)
  }
  if (!labels.length) throw new Error('SAM2: need at least one point or a box prompt')
  const n = labels.length

  const feeds: Record<string, OrtTensor> = {}
  const lowRes = SAM2_INPUT / 4
  for (const name of decoder.inputNames) {
    const k = name.toLowerCase()
    if (k.includes('image_embed')) feeds[name] = emb.embed
    else if (k.includes('high_res_feats_0') || k.endsWith('feats_0')) feeds[name] = emb.feats0
    else if (k.includes('high_res_feats_1') || k.endsWith('feats_1')) feeds[name] = emb.feats1
    else if (k.includes('point_coords'))
      feeds[name] = new mod.Tensor('float32', Float32Array.from(coords), [1, n, 2])
    else if (k.includes('point_labels'))
      feeds[name] = new mod.Tensor('float32', Float32Array.from(labels), [1, n])
    else if (k.includes('has_mask'))
      feeds[name] = new mod.Tensor('float32', new Float32Array([0]), [1])
    else if (k.includes('mask_input'))
      feeds[name] = new mod.Tensor('float32', new Float32Array(lowRes * lowRes), [
        1,
        1,
        lowRes,
        lowRes
      ])
    else if (k.includes('orig_im_size'))
      feeds[name] = new mod.Tensor('int32', Int32Array.from([SAM2_INPUT, SAM2_INPUT]), [2])
  }

  let outputs: Record<string, OrtTensor>
  try {
    outputs = (await decoder.run(feeds)) as Record<string, OrtTensor>
  } catch (err) {
    // 部分导出把 orig_im_size 声明为 int64 / float32：逐一重试
    const sizeName = decoder.inputNames.find((nm) => nm.toLowerCase().includes('orig_im_size'))
    if (!sizeName) throw err
    try {
      feeds[sizeName] = new mod.Tensor(
        'int64',
        BigInt64Array.from([BigInt(SAM2_INPUT), BigInt(SAM2_INPUT)]),
        [2]
      )
      outputs = (await decoder.run(feeds)) as Record<string, OrtTensor>
    } catch {
      feeds[sizeName] = new mod.Tensor('float32', Float32Array.from([SAM2_INPUT, SAM2_INPUT]), [2])
      outputs = (await decoder.run(feeds)) as Record<string, OrtTensor>
    }
  }

  let masksT: OrtTensor | undefined
  let scoresT: OrtTensor | undefined
  for (const [name, t] of Object.entries(outputs)) {
    const k = name.toLowerCase()
    if (!masksT && k.includes('mask') && !k.includes('low')) masksT = t
    else if (!scoresT && (k.includes('iou') || k.includes('score'))) scoresT = t
  }
  for (const t of Object.values(outputs)) {
    if (!masksT && t.dims.length >= 3) masksT = t
    else if (!scoresT && t.dims.length <= 2 && t !== masksT) scoresT = t
  }
  if (!masksT) throw new Error('SAM2: decoder returned no mask tensor')
  const dims = masksT.dims.map(Number)
  const lh = dims[dims.length - 2]!
  const lw = dims[dims.length - 1]!
  const k = Math.max(1, Math.round((masksT.data as Float32Array).length / (lh * lw)))
  const logits = masksT.data as Float32Array
  const rawScores = scoresT ? Array.from(scoresT.data as Float32Array) : []

  const masks: YoloSam2PromptResult['masks'] = []
  const scores: number[] = []
  for (let i = 0; i < k; i++) {
    masks.push({ width, height, data: upsampleLogits(logits, i * lh * lw, lw, lh, width, height) })
    const s = rawScores[i]
    scores.push(typeof s === 'number' && Number.isFinite(s) ? Math.max(0, Math.min(1, s)) : 0.5)
  }

  return {
    width,
    height,
    masks,
    scores,
    modelId: params.modelId,
    inferenceMs: Date.now() - started
  }
}

export function disposeSam2Sessions(): void {
  sessions = null
  embedCache.length = 0
}
