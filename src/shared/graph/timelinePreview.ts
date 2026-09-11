/**
 * 成片预览的抽帧时间点规划（纯函数，与 ffmpeg 无关）。
 *
 * Agent 改完时间线只看得到数字；`timeline_preview` 用导出同一条滤镜图抽帧回给它「看一眼」。
 * 这里只回答「抽哪几个时间点」这一件事——渲染在主进程的 timelineExportService 里。
 * 文案口径与 timelineEdit 一致：本模块只产出 code，中文说明由主进程拼。
 */

/** 单次抽帧上限：响应体积随帧数线性增长（每帧几十 KB 的 base64），6 张够看清节奏 */
export const MAX_PREVIEW_FRAMES = 6

/** 不传帧数时的默认值 */
export const DEFAULT_PREVIEW_FRAMES = 3

/** 采样点之间的最小间隔（秒）：更近视为同一帧 */
const MIN_GAP_SEC = 0.01

/** 越界时间点夹取时距片尾保留的余量（秒）：正好落在 duration 上多半是黑场，ffmpeg 也可能取不到帧 */
const TAIL_EPSILON_SEC = 0.01

export type TimelinePreviewNote =
  | { code: 'empty-timeline' }
  | { code: 'invalid-timestamps-dropped'; count: number }
  | { code: 'timestamps-clamped'; count: number; durationSec: number }
  | { code: 'timestamps-truncated'; limit: number; requested: number }
  | { code: 'frame-count-clamped'; requested: number; applied: number }

export type TimelinePreviewPlan = {
  /** 抽帧时间点（秒，升序去重） */
  timestamps: number[]
  /** 规划过程中的调整，供调用方拼成可读说明 */
  notes: TimelinePreviewNote[]
}

/**
 * 规划抽帧时间点。
 *
 * - 给了 `atSec` 就按给定时间点抽（定点检查某个转场 / 字幕落点）：越界夹取、重复合并、超量截断
 * - 否则按 `count` 均匀抽：取每格中心 `duration * (i + 0.5) / count`，
 *   首尾各留半格——成片开头常是淡入黑场、结尾常是淡出，取边界只会拿到黑帧
 */
export function planPreviewTimestamps(options: {
  durationSec: number
  count?: number
  atSec?: number[]
}): TimelinePreviewPlan {
  const durationSec = Number(options.durationSec)
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    return { timestamps: [], notes: [{ code: 'empty-timeline' }] }
  }

  // 判据是「给没给 atSec」而不是「atSec 里有没有合法值」：全是不合法值时应当如实回报，
  // 而不是悄悄换成均匀采样——那会让调用方以为抽的是自己点的那几个位置。
  const rawList = options.atSec ?? []
  const requested = rawList.filter((sec) => Number.isFinite(sec))
  if (rawList.length) return planFromRequested(requested, rawList.length, durationSec)

  const raw = Number(options.count)
  const wanted = Number.isFinite(raw) ? Math.floor(raw) : DEFAULT_PREVIEW_FRAMES
  const applied = Math.min(MAX_PREVIEW_FRAMES, Math.max(1, wanted))
  const notes: TimelinePreviewNote[] =
    applied === wanted ? [] : [{ code: 'frame-count-clamped', requested: wanted, applied }]
  const timestamps = Array.from({ length: applied }, (_, index) =>
    roundSec(durationSec * ((index + 0.5) / applied))
  )
  return { timestamps, notes }
}

/** 指定时间点分支：夹取 → 取整 → 去重 → 截断 */
function planFromRequested(
  requested: number[],
  rawCount: number,
  durationSec: number
): TimelinePreviewPlan {
  const notes: TimelinePreviewNote[] = []
  const dropped = rawCount - requested.length
  if (dropped > 0) notes.push({ code: 'invalid-timestamps-dropped', count: dropped })

  const upper = Math.max(0, durationSec - TAIL_EPSILON_SEC)
  let clamped = 0
  const bounded = requested.map((sec) => {
    const next = Math.min(Math.max(0, sec), upper)
    if (Math.abs(next - sec) > MIN_GAP_SEC) clamped++
    return next
  })
  if (clamped > 0) notes.push({ code: 'timestamps-clamped', count: clamped, durationSec })

  const timestamps = dedupeSorted(bounded.map(roundSec))
  if (timestamps.length > MAX_PREVIEW_FRAMES) {
    notes.push({
      code: 'timestamps-truncated',
      limit: MAX_PREVIEW_FRAMES,
      requested: timestamps.length
    })
    return { timestamps: timestamps.slice(0, MAX_PREVIEW_FRAMES), notes }
  }
  return { timestamps, notes }
}

/** 升序 + 去重（间隔小于 0.01 秒的视为同一帧） */
function dedupeSorted(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b)
  const out: number[] = []
  for (const value of sorted) {
    const prev = out[out.length - 1]
    if (prev === undefined || value - prev >= MIN_GAP_SEC) out.push(value)
  }
  return out
}

/** 保留两位小数：抽帧时间给到 0.01 秒就够，也让返回结构读起来干净 */
function roundSec(sec: number): number {
  return Math.round(sec * 100) / 100
}

/** 抽帧滤镜链的一段：从导出的视频输出接出来，缩放到预览宽度后按时间点分叉 */
export type TimelinePreviewFramePlan = {
  /** 追加在导出滤镜图之后的链（用 `;` 接在原图末尾） */
  filterParts: string[]
  /** 每帧一个输出：label 供 `-map` 用，timeSec 是它的成片时间点 */
  outputs: Array<{ label: string; timeSec: number }>
}

/**
 * 组装抽帧的滤镜链（纯字符串，便于单测——这段写错只有实跑 ffmpeg 才看得出来）。
 *
 * 只在最前面缩放一次再 `split`：抽 6 帧只缩放一次，而不是每帧各缩一遍。
 * 只抽一帧时不走 `split`（`split=1` 虽然合法但没必要，少一份不确定性）。
 */
export function buildPreviewFramePlan(options: {
  mapVideo: string
  timestamps: number[]
  width: number
}): TimelinePreviewFramePlan {
  const label = options.mapVideo.replace(/^\[|\]$/g, '')
  const width = Math.round(options.width)
  const filterParts: string[] = []
  const outputs: Array<{ label: string; timeSec: number }> = []

  if (options.timestamps.length === 1) {
    const only = options.timestamps[0]
    filterParts.push(`[${label}]scale=${width}:-2[vpreview]`)
    filterParts.push(`[vpreview]trim=start=${only.toFixed(3)},setpts=PTS-STARTPTS[vframe0]`)
    outputs.push({ label: 'vframe0', timeSec: only })
    return { filterParts, outputs }
  }

  const branches = options.timestamps.map((_, index) => `[vsel${index}]`).join('')
  filterParts.push(`[${label}]scale=${width}:-2[vscaled]`)
  filterParts.push(`[vscaled]split=${options.timestamps.length}${branches}`)
  options.timestamps.forEach((sec, index) => {
    filterParts.push(
      `[vsel${index}]trim=start=${sec.toFixed(3)},setpts=PTS-STARTPTS[vframe${index}]`
    )
    outputs.push({ label: `vframe${index}`, timeSec: sec })
  })
  return { filterParts, outputs }
}
