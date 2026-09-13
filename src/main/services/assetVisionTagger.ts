/**
 * 素材视觉打标（主进程）：
 * 资产入库 / 打开工程补漏时对图片与视频首帧跑本地 YOLO 检测，
 * 把「对象标签 + 主体位置」整理成旁挂 meta（`asset.visionTags`），
 * 供素材卡展示对象标签、资产语义检索（P1）做本地标签数据源。
 *
 * 与 thumbnailService 同理：本模块只负责「排队 + 执行 + 返回结果」，
 * 写回 `.asset.json` 与广播刷新由 projectService 在 then 回调中完成。
 *
 * 检测策略：
 * - 图片（png/jpg/jpeg）走 file 输入，由内置纯 JS 解码器解码；
 * - 图片（webp/gif 等解码器不支持的格式）转 PNG dataUrl：
 *   先 nativeImage 同步解码（buffer→path），失败再走 Electron 系统缩略图
 *   （OS/Shell 解码，nativeImage 本身不保证 webp/gif）；
 * - 视频先经 Electron 系统缩略图取首帧（OS 解码、无需 ffmpeg，与视频缩略图同机制），
 *   失败再回退 ffmpeg 首帧（需系统装了 ffmpeg），取到帧后走 dataUrl 检测。
 */
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from 'fs'
import { join } from 'path'
import { nativeImage, type NativeImage } from 'electron'
import {
  isImageFilePath,
  isLayeredSourceImageFilePath,
  isVectorImageFilePath,
  isVideoFilePath
} from '@shared/import'
import { cocoLabelZh } from '@shared/yolo'
import type { YoloDetectResult } from '@shared/yolo'
import {
  VISION_OBJECTS_CAP,
  type VisionAssetTags,
  type VisionDetectedObject,
  type VisionObjectTag
} from '@shared/visionTags'
import { yoloService } from '../yolo/yoloService'
import { extractVideoFrames } from './videoFrameService'

/** 内置纯 JS 解码器不支持的图片扩展名 → 需 nativeImage 转 PNG dataUrl */
const NATIVE_FALLBACK_EXT = new Set(['.webp', '.gif'])

/** 转换 dataUrl 前把原图最长边压到该值（控制 IPC/推理开销） */
const NATIVE_FALLBACK_MAX_EDGE = 1600

/** 系统视频帧请求尺寸（系统实现可能返回更小；YOLO 在此尺度上检主体已足够） */
const VISION_SYSTEM_FRAME_MAX_EDGE = 1280

type VisionJob = {
  root: string
  rel: string
  resolve: (tags: VisionAssetTags | null) => void
}

const pending = new Map<string, Promise<VisionAssetTags | null>>()
const queue: VisionJob[] = []
let active = 0
const MAX_CONCURRENT = 2

function jobKey(root: string, rel: string): string {
  return `${root}::${rel}`
}

function pumpQueue(): void {
  while (active < MAX_CONCURRENT && queue.length > 0) {
    const job = queue.shift()!
    active += 1
    void detectOnce(job.root, job.rel)
      .then((tags) => job.resolve(tags))
      .catch((err) => {
        console.warn('[vision-tag] unexpected failure', job.rel, err)
        job.resolve(null)
      })
      .finally(() => {
        active -= 1
        pending.delete(jobKey(job.root, job.rel))
        pumpQueue()
      })
  }
}

/** 后台排队打标；同路径去重。返回 null 表示本次不产生 meta（不写盘） */
export function scheduleAssetVisionTag(
  root: string,
  relativePath: string
): Promise<VisionAssetTags | null> {
  const rel = relativePath.replace(/\\/g, '/').trim()
  if (!rel) return Promise.resolve(null)
  const key = jobKey(root, rel)
  const existing = pending.get(key)
  if (existing) return existing

  const promise = new Promise<VisionAssetTags | null>((resolve) => {
    queue.push({ root, rel, resolve })
    queueMicrotask(pumpQueue)
  })
  pending.set(key, promise)
  return promise
}

/** 查询指定路径是否仍在队列/执行中（调试与测试用） */
export function hasPendingVisionTag(root: string, relativePath: string): boolean {
  return pending.has(jobKey(root, relativePath.replace(/\\/g, '/').trim()))
}

// ── 执行 ──────────────────────────────────────────────────────────

async function detectOnce(root: string, rel: string): Promise<VisionAssetTags | null> {
  const abs = join(root, rel)
  if (!existsSync(abs)) return null
  // PSD 等分层源文件：画面要经合成解码才有（数百毫秒 + 数十 MB 内存），而打标只在
  // 缩略图尺度上跑，收益不对等，暂不参与入库打标——不写 skipped 状态，
  // 免得素材卡长出「打标失败」角标
  if (isLayeredSourceImageFilePath(abs)) return null
  // 矢量图（SVG）：画面由 Chromium 渲染，nativeImage 取不到像素，打标无从谈起
  if (isVectorImageFilePath(abs)) return null
  if (!isImageFilePath(abs) && !isVideoFilePath(abs)) return null

  try {
    let result: YoloDetectResult
    if (isVideoFilePath(abs)) {
      // 取帧优先级：Electron 系统缩略图（OS 解码，无需 ffmpeg）→ ffmpeg 首帧（需已安装）
      const frame =
        (await systemThumbnailDataUrl(abs)) ??
        (await extractVideoFrames({ projectRoot: root, relativePath: rel, count: 1 }))[0] ??
        null
      if (!frame) {
        // 两种取帧均失败：记录 skipped（runAt 供打开工程节流重试），修复后自动补齐
        console.warn('[vision-tag] video frame extract failed, skip', rel)
        return {
          v: 1,
          status: 'skipped',
          error: '视频取帧失败（系统解码不可用且 ffmpeg 缺失）', // cjk-ok：主进程状态透传，渲染层负责展示
          runAt: new Date().toISOString(),
          summary: [],
          objects: []
        }
      }
      result = await yoloService.detect({ image: { kind: 'dataUrl', dataUrl: frame } })
    } else if (NATIVE_FALLBACK_EXT.has(extOf(rel))) {
      // 解码链：nativeImage 同步（buffer→path）→ Electron 系统缩略图（OS/Shell 解码）
      const dataUrl = await nativeImageToPngDataUrl(abs)
      if (!dataUrl) {
        console.warn('[vision-tag] image decode failed, skip', rel, describeFile(abs))
        return null
      }
      result = await yoloService.detect({ image: { kind: 'dataUrl', dataUrl } })
    } else {
      result = await yoloService.detect({ image: { kind: 'file', path: abs } })
    }
    return summarize(result)
  } catch (err) {
    // 模型未就绪 / onnxruntime 缺失等环境性失败：标记 skipped，
    // 打开工程补漏时会重试，待模型可用后自动补标
    const message = err instanceof Error ? err.message : String(err)
    console.warn('[vision-tag] detect failed', rel, message)
    return {
      v: 1,
      status: 'skipped',
      error: message.slice(0, 300),
      runAt: new Date().toISOString(),
      summary: [],
      objects: []
    }
  }
}

/**
 * 用 Electron 系统缩略图接口解码图片 / 取视频首帧（OS/Shell 解码，不依赖 nativeImage 内置解码器；
 * 对 nativeImage 不保证支持的 webp/gif 也能兜底，与 thumbnailService 同机制）。
 * 不可用时返回 null。
 */
async function systemThumbnailDataUrl(abs: string): Promise<string | null> {
  const createThumb = (
    nativeImage as typeof nativeImage & {
      createThumbnailFromPath?: (
        path: string,
        size: { width: number; height: number }
      ) => Promise<NativeImage>
    }
  ).createThumbnailFromPath
  if (typeof createThumb !== 'function') return null
  try {
    const thumb = await createThumb(abs, {
      width: VISION_SYSTEM_FRAME_MAX_EDGE,
      height: VISION_SYSTEM_FRAME_MAX_EDGE
    })
    if (!thumb || thumb.isEmpty()) return null
    const { width, height } = thumb.getSize()
    if (!width || !height) return null
    const png = thumb.toPNG()
    if (!png || png.length === 0) return null
    return `data:image/png;base64,${png.toString('base64')}`
  } catch {
    return null
  }
}

function extOf(path: string): string {
  const lower = path.toLowerCase()
  const dot = lower.lastIndexOf('.')
  return dot >= 0 ? lower.slice(dot) : ''
}

/**
 * nativeImage 同步解码（一级回退）：
 * createFromPath 对部分图片（含按扩展名路由失败/伪装扩展名的 webp、gif）会解码为空，
 * 因此优先 createFromBuffer（Chromium 按内容嗅探解码，不看扩展名），失败再回退 createFromPath。
 * 与 thumbnailService.loadNativeImageSync 同策略。
 */
function loadImageViaNativeImage(abs: string): NativeImage | null {
  try {
    const buf = readFileSync(abs)
    const fromBuf = nativeImage.createFromBuffer(buf)
    if (!fromBuf.isEmpty()) return fromBuf
  } catch {
    /* try path */
  }
  try {
    const fromPath = nativeImage.createFromPath(abs)
    if (!fromPath.isEmpty()) return fromPath
  } catch {
    /* empty */
  }
  return null
}

/**
 * webp/gif → PNG dataUrl。解码链：
 * 1) nativeImage 同步（buffer→path），可解伪装扩展名/主流格式；
 * 2) 同步失败再走 Electron 系统缩略图（OS/Shell 解码）——nativeImage 并不保证
 *    webp/gif 解码，系统缩略图是 thumbnailService 已验证的兜底。
 * 全部失败返回 null。
 */
async function nativeImageToPngDataUrl(abs: string): Promise<string | null> {
  try {
    const image = loadImageViaNativeImage(abs)
    if (image) {
      const { width, height } = image.getSize()
      if (width && height) {
        const maxEdge = Math.max(width, height)
        const resized =
          maxEdge > NATIVE_FALLBACK_MAX_EDGE
            ? image.resize({
                width: Math.max(1, Math.round((width * NATIVE_FALLBACK_MAX_EDGE) / maxEdge)),
                height: Math.max(1, Math.round((height * NATIVE_FALLBACK_MAX_EDGE) / maxEdge)),
                quality: 'good'
              })
            : image
        const png = resized.toPNG()
        if (png && png.length > 0) {
          return `data:image/png;base64,${png.toString('base64')}`
        }
      }
    }
  } catch {
    /* fall to system thumbnail */
  }
  return systemThumbnailDataUrl(abs)
}

/** 解码失败时的诊断信息（字节数 + 头部 magic），用于确认是否伪装扩展名/损坏 */
function describeFile(abs: string): string {
  try {
    const size = statSync(abs).size
    const fd = openSync(abs, 'r')
    const buf = Buffer.alloc(16)
    try {
      readSync(fd, buf, 0, buf.length, 0)
    } finally {
      closeSync(fd)
    }
    return `${size} bytes, head=${buf.toString('hex')}`
  } catch {
    return 'unreadable'
  }
}

function summarize(result: YoloDetectResult): VisionAssetTags {
  const objects: VisionDetectedObject[] = result.boxes
    .map((box) => ({
      ...box,
      labelZh: cocoLabelZh(box.label)
    }))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, VISION_OBJECTS_CAP)

  const byLabel = new Map<string, VisionDetectedObject[]>()
  for (const obj of objects) {
    const list = byLabel.get(obj.label)
    if (list) list.push(obj)
    else byLabel.set(obj.label, [obj])
  }
  const summary: VisionObjectTag[] = [...byLabel.entries()]
    .map(([label, items]) => ({
      label,
      labelZh: items[0].labelZh,
      count: items.length,
      maxConfidence: Math.max(...items.map((item) => item.confidence))
    }))
    .sort((a, b) => b.maxConfidence - a.maxConfidence)

  return {
    v: 1,
    status: 'ok',
    runAt: new Date().toISOString(),
    imageWidth: result.width,
    imageHeight: result.height,
    summary,
    objects
  }
}
