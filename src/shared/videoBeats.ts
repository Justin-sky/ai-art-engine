/**
 * 视频人 / 物打点 — 帧序列 YOLO 检测结果的时间线聚合（ROADMAP 5.3「视频人/物打点」）。
 *
 * 链路：主进程按均匀时间戳抽帧（ffmpeg）→ 逐帧 `yoloService.detect` →
 * 每帧 `summarizeVideoBeatFrame` 折成离散样本 → `buildVideoBeatTags`
 * 聚合出「空镜段 / 有物无人段 / 单人段 / 群像段」与「某对象第几秒出现」，
 * 落旁挂 `.asset.json` 新顶层字段 `videoBeats`（与单帧快照 `visionTags` 并存）。
 *
 * 本文件只含类型 / 常量 / 纯函数，主进程与单测直接可用；
 * 坐标与置信度一律不上送（消费方只关心「什么在第几秒出现」），
 * 需要精确框位置的场景可对目标秒重跑 detect。
 */
import type { YoloDetectResult } from './yolo'
import { cocoLabelZh } from './yolo'
import { buildVideoFrameTimestamps } from './graph/videoReview'

/** 打点默认抽帧间隔（秒） */
export const VIDEO_BEAT_INTERVAL_SEC = 2
/** 单条视频打点最多抽帧数（防长视频推理耗时与 meta 膨胀） */
export const VIDEO_BEAT_MAX_SAMPLES = 30
/** 单帧只保留最可信的 N 个不同标签（防止一帧几十类撑爆 meta） */
export const VIDEO_BEAT_SAMPLE_LABEL_CAP = 6
/** 人物的 COCO 英文标签（单人 / 群像判定的唯一依据） */
export const VIDEO_BEAT_PERSON_LABEL = 'person'
/** 自动打点遇环境性失败（skipped）后的重试窗口（毫秒）；窗口内不再自动入队，手动触发不受限 */
export const VIDEO_BEAT_AUTO_RETRY_MS = 15 * 60 * 1000

/** 时间线标注段类型：空镜 / 有物无人 / 单人 / 群像（≥2 人） */
export type VideoBeatKind = 'empty' | 'objects' | 'person-solo' | 'person-group'

/** 单个抽帧样本（该帧 YOLO detect 结果的聚合，离散时间点） */
export interface VideoBeatSample {
  /** 帧时刻（秒） */
  timeSec: number
  /** 该帧人物框数 */
  personCount: number
  /** 该帧全部检测框数 */
  objectCount: number
  /** 是否空镜帧（无任何检出对象） */
  isEmpty: boolean
  /** 检出对象标签（置信度降序去重，含 person；上限 VIDEO_BEAT_SAMPLE_LABEL_CAP） */
  labels: string[]
  /** 与 labels 等长的中文展示名 */
  labelsZh: string[]
}

/** 相邻样本同类保持推断出的连续段（时间近似，供时间线标注 / 智能剪辑选段） */
export interface VideoBeatSegment {
  kind: VideoBeatKind
  /** 段起始秒（内部边界取相邻样本中点近似） */
  fromSec: number
  /** 段结束秒（末段取视频总时长） */
  toSec: number
  /** 段内出现过的对象标签（按首次出现顺序去重） */
  labels: string[]
}

/** 对象标签的时间线摘要（「人物在第几秒出现」的检索 / chip 数据源） */
export interface VideoBeatSummaryItem {
  /** COCO 英文标签，如 person */
  label: string
  /** 中文展示名，如 人物 */
  labelZh: string
  /** 命中该标签的抽帧数 */
  frames: number
  /** 首次出现秒 */
  firstSec: number
  /** 末次出现秒 */
  lastSec: number
}

export type VideoBeatStatus = 'ok' | 'skipped'

/**
 * 环境性失败（如 ffmpeg 缺失）的安装引导，供 UI 提供「一键下载安装」按钮。
 * 仅当 skipped 属「缺 ffmpeg」时存在；其它失败不携带。
 */
export interface VideoBeatInstallHint {
  /** 打开系统浏览器到下载 / 安装引导页的 URL */
  url: string
  /** 终端可粘贴运行的安装命令示例 */
  command: string
  /** 命令所在终端名（PowerShell / Terminal），用于展示 */
  commandLabel: string
  /** 当前 OS 是否支持应用内一键自动安装（true → UI 提供「一键安装」走 ipc；false → 打开 url 引导） */
  autoInstall: boolean
}

/** ffmpeg 一键安装的执行结果（主进程 → UI） */
export interface VideoBeatInstallResult {
  ok: boolean
  /** 用户可见说明 */
  message: string
  /** ok=false 时的手动下载引导页（UI 可提供「打开下载页」按钮） */
  downloadUrl?: string
}

/** ffmpeg 一键安装的实时进度（主进程 → UI，走事件广播） */
export interface FfmpegInstallProgress {
  /** downloading=下载安装包，extracting=解压并安装，done=完成 */
  phase: 'downloading' | 'extracting' | 'done'
  /** 下载进度 0~100（仅 downloading 阶段；总长未知时为 0） */
  percent?: number
  /** 已下载字节（仅 downloading 阶段） */
  loadedBytes?: number
  /** 总字节（仅 downloading 阶段；总长未知则缺省） */
  totalBytes?: number
}

/** ffmpeg / ffprobe 二进制生效来源（设置页状态徽标用） */
export type FfmpegRuntimeSource = 'env' | 'bundled' | 'private' | 'path' | 'none'

/** ffmpeg / ffprobe 运行时状态（主进程 → 设置页「通用工具 ffmpeg」） */
export interface FfmpegRuntimeStatus {
  /** ffmpeg 与 ffprobe 均解析到可运行来源 */
  available: boolean
  /** ffmpeg 实际生效来源（'none' = 未检测到） */
  source: FfmpegRuntimeSource
  /** 生效的 ffmpeg 可执行文件（绝对路径或命令名）；不可用为 null */
  ffmpegPath: string | null
  /** 生效的 ffprobe 可执行文件；不可用为 null */
  ffprobePath: string | null
  /** ffmpeg -version 首行；不可用为 null */
  ffmpegVersion: string | null
  /** ffprobe -version 首行；不可用为 null */
  ffprobeVersion: string | null
  /** 一键下载安装进行中 */
  installing: boolean
  /** 当前系统是否支持应用内一键下载安装（false → 引导下载页 / 终端命令） */
  autoInstallSupported: boolean
  /** 一键下载的安装落盘目录（应用私有 ffmpeg 目录） */
  installDir: string
  /** 手动下载引导页 URL */
  downloadUrl: string
  /** 终端安装命令示例 */
  command: string
  /** 命令所在终端名（PowerShell / Terminal） */
  commandLabel: string
}

/**
 * 落盘到 `.asset.json` 的 `videoBeats` 字段形状。
 * 扫树读取时未知字段原样保留，可作为 AssetInfo 新顶层可选字段安全落盘。
 */
export interface VideoBeatTags {
  v: 1
  status: VideoBeatStatus
  /** skipped 时的原因说明 */
  error?: string
  /** skipped 属 ffmpeg 缺失时的安装引导（UI 据此提供一键下载） */
  install?: VideoBeatInstallHint
  /** 产出检测的模型 id（如 yolo11n） */
  modelId?: string
  runAt: string
  /** 视频总时长（秒；取帧失败等未知时长时为 NaN → 存 0） */
  durationSec: number
  samples: VideoBeatSample[]
  segments: VideoBeatSegment[]
  summary: VideoBeatSummaryItem[]
}

/** 抽帧策略参数 */
export interface VideoBeatSamplingOptions {
  /** 抽帧间隔（秒），缺省 VIDEO_BEAT_INTERVAL_SEC */
  intervalSec?: number
  /** 上限帧数，缺省 VIDEO_BEAT_MAX_SAMPLES */
  maxSamples?: number
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * 打点抽帧时间戳（秒，升序）。
 * 按固定间隔布点并含末端帧，帧数 = floor(duration / interval) + 1，
 * 截断到 maxSamples；时长非法返回 []，时长小于一个间隔时仍取 [0] 保证首帧。
 */
export function buildVideoBeatTimestamps(
  durationSec: number,
  options?: VideoBeatSamplingOptions
): number[] {
  const duration = Number(durationSec)
  if (!Number.isFinite(duration) || duration <= 0) return []
  const interval = Math.max(0.1, options?.intervalSec ?? VIDEO_BEAT_INTERVAL_SEC)
  const max = Math.max(1, Math.floor(options?.maxSamples ?? VIDEO_BEAT_MAX_SAMPLES))
  const count = Math.min(max, Math.floor(duration / interval) + 1)
  return buildVideoFrameTimestamps(duration, count)
}

/** 把单帧 detect 结果折成打点样本（只保留时间线关心的聚合信息） */
export function summarizeVideoBeatFrame(
  result: YoloDetectResult,
  timeSec: number
): VideoBeatSample {
  const boxes = [...(result.boxes ?? [])].sort((a, b) => b.confidence - a.confidence)
  const labels: string[] = []
  for (const box of boxes) {
    if (labels.length >= VIDEO_BEAT_SAMPLE_LABEL_CAP) break
    if (!labels.includes(box.label)) labels.push(box.label)
  }
  const personCount = boxes.filter((box) => box.label === VIDEO_BEAT_PERSON_LABEL).length
  return {
    timeSec: round2(timeSec),
    personCount,
    objectCount: boxes.length,
    isEmpty: boxes.length === 0,
    labels,
    labelsZh: labels.map((label) => cocoLabelZh(label))
  }
}

/** 样本归属的时间线段类型 */
export function videoBeatKindOf(sample: VideoBeatSample): VideoBeatKind {
  if (sample.personCount >= 2) return 'person-group'
  if (sample.personCount === 1) return 'person-solo'
  return sample.isEmpty ? 'empty' : 'objects'
}

/**
 * 样本序列 → 连续段标注。
 * 相邻样本视为同一段的前提是类型相同；段内边界取两侧样本时间中点近似，
 * 首段 from = 0、末段 to = durationSec。samples 会按 timeSec 升序防御性重排；
 * 空序列返回 []。
 */
export function buildVideoBeatSegments(
  samples: VideoBeatSample[],
  durationSec: number
): VideoBeatSegment[] {
  const ordered = [...samples].sort((a, b) => a.timeSec - b.timeSec)
  if (ordered.length === 0) return []

  const groups: Array<{ kind: VideoBeatKind; samples: VideoBeatSample[] }> = []
  for (const sample of ordered) {
    const kind = videoBeatKindOf(sample)
    const last = groups[groups.length - 1]
    if (last && last.kind === kind) last.samples.push(sample)
    else groups.push({ kind, samples: [sample] })
  }

  const boundaries: number[] = []
  for (let i = 0; i < groups.length - 1; i += 1) {
    const left = groups[i].samples[groups[i].samples.length - 1].timeSec
    const right = groups[i + 1].samples[0].timeSec
    boundaries.push(round2((left + right) / 2))
  }

  const duration =
    Number.isFinite(Number(durationSec)) && Number(durationSec) >= 0 ? Number(durationSec) : 0
  return groups.map((group, index) => {
    const labels: string[] = []
    for (const sample of group.samples) {
      for (const label of sample.labels) {
        if (!labels.includes(label)) labels.push(label)
      }
    }
    return {
      kind: group.kind,
      fromSec: index === 0 ? 0 : boundaries[index - 1],
      toSec: index === groups.length - 1 ? round2(duration) : boundaries[index],
      labels
    }
  })
}

/** 样本序列 → 对象标签时间线摘要（frames 降序、firstSec 升序） */
export function summarizeVideoBeatSamples(samples: VideoBeatSample[]): VideoBeatSummaryItem[] {
  const byLabel = new Map<
    string,
    { frames: number; firstSec: number; lastSec: number; labelZh: string }
  >()
  for (const sample of samples) {
    for (let i = 0; i < sample.labels.length; i += 1) {
      const label = sample.labels[i]
      const existing = byLabel.get(label)
      if (existing) {
        existing.frames += 1
        existing.firstSec = Math.min(existing.firstSec, sample.timeSec)
        existing.lastSec = Math.max(existing.lastSec, sample.timeSec)
      } else {
        byLabel.set(label, {
          frames: 1,
          firstSec: sample.timeSec,
          lastSec: sample.timeSec,
          labelZh: sample.labelsZh[i] ?? cocoLabelZh(label)
        })
      }
    }
  }
  return [...byLabel.entries()]
    .map(([label, item]) => ({
      label,
      labelZh: item.labelZh,
      frames: item.frames,
      firstSec: round2(item.firstSec),
      lastSec: round2(item.lastSec)
    }))
    .sort((a, b) => b.frames - a.frames || a.firstSec - b.firstSec)
}

/** 组装落盘 tags（skipped 由主进程按环境失败直接构造） */
export interface VideoBeatTagsInput {
  durationSec: number
  samples: VideoBeatSample[]
  modelId?: string
  runAt?: string
}

export function buildVideoBeatTags(input: VideoBeatTagsInput): VideoBeatTags {
  const samples = [...input.samples].sort((a, b) => a.timeSec - b.timeSec)
  const durationSec = Number(input.durationSec)
  const duration = Number.isFinite(durationSec) && durationSec > 0 ? round2(durationSec) : 0
  return {
    v: 1,
    status: 'ok',
    modelId: input.modelId,
    runAt: input.runAt ?? new Date().toISOString(),
    durationSec: duration,
    samples,
    segments: buildVideoBeatSegments(samples, duration),
    summary: summarizeVideoBeatSamples(samples)
  }
}

/** 环境性失败（模型未就绪 / 抽帧失败 / ffmpeg 缺失）的占位结果 */
export function createSkippedVideoBeatTags(
  error: string,
  runAt?: string,
  install?: VideoBeatInstallHint
): VideoBeatTags {
  return {
    v: 1,
    status: 'skipped',
    error,
    install,
    runAt: runAt ?? new Date().toISOString(),
    durationSec: 0,
    samples: [],
    segments: [],
    summary: []
  }
}

/** 按运行平台返回 ffmpeg 安装引导（win / mac / linux 三套，供「一键安装」按钮） */
export function ffmpegInstallHintFor(platform: string): VideoBeatInstallHint {
  switch (platform) {
    case 'win32':
      return {
        url: 'https://www.gyan.dev/ffmpeg/builds/',
        command: 'winget install Gyan.FFmpeg',
        commandLabel: 'PowerShell',
        autoInstall: true
      }
    case 'darwin':
      return {
        url: 'https://evermeet.cx/ffmpeg/',
        command: 'brew install ffmpeg',
        commandLabel: 'Terminal',
        autoInstall: false
      }
    default:
      return {
        url: 'https://ffmpeg.org/download.html',
        command: 'sudo apt install ffmpeg',
        commandLabel: 'Terminal',
        autoInstall: false
      }
  }
}
