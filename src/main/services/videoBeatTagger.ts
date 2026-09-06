/**
 * 视频人 / 物打点（主进程）：
 * ffmpeg 按均匀时间戳抽帧 → 逐帧本地 YOLO 检测 → `summarizeVideoBeatFrame`
 * 折成离散时间样本 → `buildVideoBeatTags` 聚合出「空镜段 / 有物无人段 / 单人段 / 群像段」
 * 与「某对象在第几秒出现」摘要，落旁挂 meta 的 `asset.videoBeats` 字段。
 *
 * 与 assetVisionTagger 同理：本模块只负责「排队 + 执行 + 返回结果」，
 * 写回 `.asset.json` 与广播刷新由 projectService 在调用方完成。
 * 打点不做打开工程自动补漏（单任务最多 30 帧推理，成本高），
 * 入队分两档：手动（右键 / 智能剪辑主动触发，优先执行）与自动
 * （导入 / 换媒体后就绪的低优先级补打，只在没有手动任务等待时执行，
 * 失败静默写 skipped 由 projectService 按节流窗口决定是否重试）。
 *
 * 失败语义：ffprobe / ffmpeg / YOLO 模型任一环不可用 → 返回 status 'skipped'
 * 占位（runAt 供 UI 提示），不产出半成品。
 */
import { existsSync } from 'fs'
import { join } from 'path'
import { isVideoFilePath } from '@shared/import'
import {
  buildVideoBeatTags,
  buildVideoBeatTimestamps,
  createSkippedVideoBeatTags,
  ffmpegInstallHintFor,
  summarizeVideoBeatFrame,
  type VideoBeatInstallHint,
  type VideoBeatSample,
  type VideoBeatTags
} from '@shared/videoBeats'
import { yoloService } from '../yolo/yoloService'
import {
  grabFramesAtTimestamps,
  isFfprobeAvailable,
  probeVideoDurationSec
} from './videoFrameService'

type VideoBeatJob = {
  root: string
  rel: string
  /** true = 自动（导入 / 换媒体后低优先级补打）；false = 手动（右键等主动触发，优先执行） */
  auto: boolean
  resolve: (tags: VideoBeatTags | null) => void
}

const pending = new Map<string, Promise<VideoBeatTags | null>>()
const queue: VideoBeatJob[] = []
let active = 0
/** 打点单任务最多跑 VIDEO_BEAT_MAX_SAMPLES 帧推理，串行避免抢占打标 / 抠图等实时推理 */
const MAX_CONCURRENT = 1

function jobKey(root: string, rel: string): string {
  return `${root}::${rel}`
}

/** 取下一个待执行任务：手动任务始终优先于自动任务（自动任务不阻塞用户主动打点） */
function nextJob(): VideoBeatJob | null {
  const manualIdx = queue.findIndex((job) => !job.auto)
  if (manualIdx >= 0) return queue.splice(manualIdx, 1)[0]
  return queue.shift() ?? null
}

function pumpQueue(): void {
  while (active < MAX_CONCURRENT && queue.length > 0) {
    const job = nextJob()
    if (!job) return
    active += 1
    void detectOnce(job.root, job.rel)
      .then((tags) => job.resolve(tags))
      .catch((err) => {
        console.warn('[video-beat] unexpected failure', job.rel, err)
        job.resolve(null)
      })
      .finally(() => {
        active -= 1
        pending.delete(jobKey(job.root, job.rel))
        pumpQueue()
      })
  }
}

/** 排队打点；同路径去重（分析中再次触发复用同一次任务）。返回 null 表示本次不产生 meta */
export function scheduleAssetVideoBeats(
  root: string,
  relativePath: string,
  options?: { auto?: boolean }
): Promise<VideoBeatTags | null> {
  const rel = relativePath.replace(/\\/g, '/').trim()
  if (!rel) return Promise.resolve(null)
  const key = jobKey(root, rel)
  const existing = pending.get(key)
  if (existing) return existing

  const promise = new Promise<VideoBeatTags | null>((resolve) => {
    queue.push({ root, rel, auto: options?.auto === true, resolve })
    queueMicrotask(pumpQueue)
  })
  pending.set(key, promise)
  return promise
}

/** 查询指定路径是否仍在排队 / 执行中（调试与测试用） */
export function hasPendingVideoBeat(root: string, relativePath: string): boolean {
  return pending.has(jobKey(root, relativePath.replace(/\\/g, '/').trim()))
}

// ── 执行 ──────────────────────────────────────────────────────────

function skipped(error: string, install?: VideoBeatInstallHint): VideoBeatTags {
  console.warn('[video-beat]', error)
  return createSkippedVideoBeatTags(error, undefined, install)
}

async function detectOnce(root: string, rel: string): Promise<VideoBeatTags | null> {
  const abs = join(root, rel)
  if (!existsSync(abs) || !isVideoFilePath(abs)) return null

  try {
    const durationSec = await probeVideoDurationSec({ projectRoot: root, relativePath: rel })
    if (!durationSec || durationSec <= 0) {
      // 打点失败原因直接透传 UI（skipped.error，与 assetVisionTagger 同约定）
      if (!(await isFfprobeAvailable())) {
        // 打点失败原因直接透传 UI（skipped.error，与 assetVisionTagger 同约定）
        return skipped('视频打点需要 ffmpeg：当前系统未检测到 ffmpeg/ffprobe，安装后重试', ffmpegInstallHintFor(process.platform)) // cjk-ok 失败原因直接透传 UI
      }
      return skipped('视频打点失败：无法读取视频时长，文件可能已损坏或格式不受支持') // cjk-ok 失败原因直接透传 UI
    }
    const timestamps = buildVideoBeatTimestamps(durationSec)
    const frames = await grabFramesAtTimestamps({
      projectRoot: root,
      relativePath: rel,
      timestamps
    })
    if (!frames.length) {
      // 打点失败原因直接透传 UI（skipped.error，与 assetVisionTagger 同约定）
      return skipped('视频打点失败：无法按时间点抽帧（请确认已安装 ffmpeg 且文件可正常解码）') // cjk-ok 失败原因直接透传 UI
    }

    const samples: VideoBeatSample[] = []
    for (const frame of frames) {
      // 模型未就绪等一致性失败会直接 throw → 中止并标记 skipped，不写半成品
      const result = await yoloService.detect({
        image: { kind: 'dataUrl', dataUrl: frame.dataUrl }
      })
      samples.push(summarizeVideoBeatFrame(result, frame.timeSec))
    }
    return buildVideoBeatTags({ durationSec, samples })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn('[video-beat] detect failed', rel, message)
    // 打点失败原因直接透传 UI（skipped.error，与 assetVisionTagger 同约定）
    return skipped(`视频打点失败：${message.slice(0, 300)}`) // cjk-ok 失败原因直接透传 UI
  }
}
