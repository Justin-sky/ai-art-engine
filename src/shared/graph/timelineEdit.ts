/**
 * 成片时间线「结构编辑」纯函数地基：新增 / 修改 / 删除片段，以及按区间整段替换。
 *
 * 与 timelineCut 的分工：那边按语音间隙整体重排（粗剪，一刀下去所有片段前移），
 * 这边是逐条编辑指令——铺素材上轨、改音量 / 转场 / 字幕文本、删掉不要的片段、
 * 用新字幕替换某段配音区间上的旧字幕。两者都是**只读入参、只产出新文档 + 报告**的
 * 纯函数，不写盘、不查资产、不做 i18n（文案由调用方拼）。
 *
 * 设计取舍：
 * - id / track 不允许通过 update 改（换轨等于换片段，请 remove + add），避免 Agent 把图片搬到
 *   voice 轨这类类型不匹配的位置；
 * - patch 传 `null` 表示**清除该字段**（JSON 表达不了 undefined，DELETE 需要一条通道）；
 * - 数值字段一律夹取到合法区间（超出范围多半是估算），只有「时长 ≤ 0」算无效指令——它没有意义；
 * - 单条指令失败只记 failure 继续跑其余的：批量编辑里一条 typo 不该让整批白干，
 *   但失败项必须原样回报给调用方，绝不能静默跳过。
 */
import {
  applyVideoTransitionBetweenClips,
  isTimelineEaseType,
  isTimelineMainCameraPreset,
  isTimelineSubtitleKaraokeMode,
  isTimelineTweenInPreset,
  isTimelineTweenLoopPreset,
  isTimelineTweenOutPreset,
  isTimelineVoiceEffectId,
  normalizeTimelineKeyframes,
  normalizeTimelineWidgetConfig,
  syncTimelineCueAnchors,
  hasInlineCueMarkup,
  type ScriptTimelineClip,
  type ScriptTimelineDocument,
  type ScriptTimelineSettings,
  type ScriptTimelineTrackKind,
  type ScriptTimelineTransitionType
} from './scriptTimeline'
import {
  applyTimelineCreativeTemplateToClips,
  TIMELINE_CREATIVE_TEMPLATES,
  type TimelineCreativeTemplateId
} from './timelineCreativePack'
import type { TimelineTimeRange } from './timelineCut'

/** 允许新建的片段草稿：`id` / `startSec` 由本模块补齐 */
export type TimelineClipDraft = Partial<Omit<ScriptTimelineClip, 'startSec'>> & {
  track: ScriptTimelineTrackKind
  durationSec: number
  /** 缺省排到该轨轨尾；显式给则就地插入，不搬动别的片段 */
  startSec?: number
}

/** 可改字段：`id` / `track` 不在其中 */
export type TimelineClipPatch = Partial<Omit<ScriptTimelineClip, 'id' | 'track'>>

export type TimelineEditOperation =
  | {
      op: 'add'
      clips: TimelineClipDraft[]
      /** 排到轨尾时，片段之间（以及与轨内既有内容之间）留的空隙（秒，默认 0） */
      gapSec?: number
    }
  | {
      /** 用 `clips` 替换该轨上一切与 `range` 重叠的片段（字幕重建走这条：原子、不会堆积） */
      op: 'replaceRange'
      track: ScriptTimelineTrackKind
      range: TimelineTimeRange
      clips: TimelineClipDraft[]
    }
  | { op: 'update'; clipId: string; patch: TimelineClipPatch }
  | {
      /** 按轨道（或指定 clipIds）批量更新片段属性（滤镜/特效/调色/转场/运镜/音量等） */
      op: 'batchUpdate'
      track?: ScriptTimelineTrackKind
      clipIds?: string[]
      patch: TimelineClipPatch
    }
  | {
      /** 一键套用剪映风格成片模板（自动为视频轨片段注入特效、滤镜、调色、运镜、转场及字幕预设） */
      op: 'applyTemplate'
      templateId: TimelineCreativeTemplateId | string
    }
  | {
      /** 扫描字幕中的 @{tag} 内联语义锚点，自动将绑定了 anchorCueTag / cueTag 的画中画、动态组件与音效吸附对齐到对应单词发声时刻 */
      op: 'syncCues'
    }
  | { op: 'remove'; clipIds: string[] }

export type TimelineEditFailureCode =
  /** 指定 id 的片段不在时间线上（可能已被粗剪切分改名，如 `clip-1` → `clip-1~2`） */
  | 'clip-not-found'
  /** 轨道名不认识 */
  | 'invalid-track'
  /** 片段时长为零或负数 */
  | 'invalid-duration'
  /** patch 里没有任何可识别字段 */
  | 'empty-patch'
  /** 模板 ID 不存在 */
  | 'invalid-template'

export interface TimelineEditFailure {
  op: TimelineEditOperation['op']
  code: TimelineEditFailureCode
  /** 出问题的片段 id，或草稿的序号说明 */
  target?: string
}

export interface TimelineEditResult {
  document: ScriptTimelineDocument
  added: number
  updated: number
  removed: number
  failures: TimelineEditFailure[]
}

const TRACK_KINDS: ScriptTimelineTrackKind[] = [
  'video',
  'overlay',
  'voice',
  'subtitle',
  'music',
  'sfx'
]

const TRANSITION_TYPES = [
  'none',
  'dissolve',
  'fade',
  'fadeout',
  'fadein',
  'flash',
  'fadegrays',
  'hblur',
  'distance',
  'smoothleft',
  'smoothright',
  'smoothup',
  'smoothdown',
  'slideleft',
  'slideright',
  'slideup',
  'slidedown',
  'wipeleft',
  'wiperight',
  'wipeup',
  'wipedown',
  'wipetl',
  'wipetr',
  'wipebl',
  'wipebr',
  'circleopen',
  'circleclose',
  'rectcrop',
  'radial',
  'zoomin',
  'pixelize',
  'horzopen',
  'horzclose',
  'vertopen',
  'vertclose',
  'hlslice',
  'hrslice',
  'vuslice',
  'vdslice',
  'squeezeh',
  'squeezev',
  'diagtl',
  'diagbr'
]

/** 可改字段白名单：类型约束在外部入口不可信，运行时也要防脏数据 */
const EDITABLE_PATCH_KEYS = new Set([
  'lane',
  'title',
  'text',
  'sourceId',
  'relativePath',
  'assetId',
  'nodeId',
  'nodeTitle',
  'startSec',
  'durationSec',
  'sourceOffsetSec',
  'speed',
  'pitchSemitones',
  'voiceEffect',
  'freezeTailSec',
  'brightness',
  'contrast',
  'saturation',
  'vibrance',
  'temperature',
  'tint',
  'highlights',
  'shadows',
  'sharpen',
  'vignette',
  'fade',
  'grain',
  'filterPreset',
  'filterIntensity',
  'visualEffect',
  'effectIntensity',
  'textColor',
  'fontSize',
  'volume',
  'loop',
  'fadeInSec',
  'fadeOutSec',
  'overlayX',
  'overlayY',
  'overlayWidth',
  'overlayHeight',
  'overlayRotation',
  'cropX',
  'cropY',
  'cropWidth',
  'cropHeight',
  'opacity',
  'tweenIn',
  'tweenInDurationSec',
  'tweenInEase',
  'tweenOut',
  'tweenOutDurationSec',
  'tweenOutEase',
  'tweenLoop',
  'tweenLoopSpeedHz',
  'tweenLoopIntensity',
  'cameraMotion',
  'keyframes',
  'stickerId',
  'stickerColor',
  'sfxPresetId',
  'rawCueText',
  'words',
  'anchorCueTag',
  'anchorOffsetSec',
  'anchorMatchDuration',
  'subtitleKaraokeMode',
  'subtitleHighlightColor',
  'subtitleHighlightBgColor',
  'widgetConfig',
  'transitionInSec',
  'transitionOutSec',
  'transitionType'
])

/** 数值字段的取值区间；`strictMin` 表示「必须大于 min」（只有时长用） */
const NUMERIC_PATCH_RULES: Record<string, { min: number; max?: number; strictMin?: boolean }> = {
  lane: { min: 0, max: 7 },
  startSec: { min: 0 },
  durationSec: { min: 0, strictMin: true },
  sourceOffsetSec: { min: 0 },
  speed: { min: 0.25, max: 4 },
  pitchSemitones: { min: -12, max: 12 },
  freezeTailSec: { min: 0, max: 30 },
  brightness: { min: -0.5, max: 0.5 },
  contrast: { min: 0.5, max: 2 },
  saturation: { min: 0, max: 3 },
  vibrance: { min: -100, max: 100 },
  temperature: { min: -100, max: 100 },
  tint: { min: -100, max: 100 },
  highlights: { min: -100, max: 100 },
  shadows: { min: -100, max: 100 },
  sharpen: { min: 0, max: 100 },
  vignette: { min: 0, max: 100 },
  fade: { min: 0, max: 100 },
  grain: { min: 0, max: 100 },
  filterIntensity: { min: 0, max: 100 },
  effectIntensity: { min: 0, max: 100 },
  fontSize: { min: 12, max: 200 },
  volume: { min: 0, max: 1 },
  opacity: { min: 0, max: 1 },
  fadeInSec: { min: 0 },
  fadeOutSec: { min: 0 },
  transitionInSec: { min: 0 },
  transitionOutSec: { min: 0 },
  overlayX: { min: -1, max: 2 },
  overlayY: { min: -1, max: 2 },
  overlayWidth: { min: 0.02, max: 2 },
  overlayHeight: { min: 0.02, max: 2 },
  overlayRotation: { min: -720, max: 720 },
  cropX: { min: 0, max: 0.95 },
  cropY: { min: 0, max: 0.95 },
  cropWidth: { min: 0.05, max: 1 },
  cropHeight: { min: 0.05, max: 1 },
  tweenInDurationSec: { min: 0.05, max: 10 },
  tweenOutDurationSec: { min: 0.05, max: 10 },
  tweenLoopSpeedHz: { min: 0.2, max: 6 },
  tweenLoopIntensity: { min: 0.1, max: 3 },
  anchorOffsetSec: { min: -30, max: 30 }
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000
}

function toFinite(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

function isTrackKind(value: unknown): value is ScriptTimelineTrackKind {
  return typeof value === 'string' && TRACK_KINDS.includes(value as ScriptTimelineTrackKind)
}

function isUsableClip(clip: ScriptTimelineClip | undefined | null): clip is ScriptTimelineClip {
  return (
    !!clip &&
    typeof clip.id === 'string' &&
    !!clip.id &&
    isTrackKind(clip.track) &&
    Number.isFinite(clip.startSec) &&
    Number.isFinite(clip.durationSec)
  )
}

/** 轨内内容结束时间（秒）：新增片段缺省排到这儿 */
export function trackEndSec(clips: ScriptTimelineClip[], track: ScriptTimelineTrackKind): number {
  let max = 0
  for (const clip of clips ?? []) {
    if (!isUsableClip(clip) || clip.track !== track) continue
    max = Math.max(max, clip.startSec + clip.durationSec)
  }
  return max
}

/** 与给定时间区间重叠的某轨片段 id（半开区间：首尾相接不算重叠） */
export function findOverlappingClipIds(
  clips: ScriptTimelineClip[],
  track: ScriptTimelineTrackKind,
  range: TimelineTimeRange
): string[] {
  const from = Math.min(range.startSec, range.endSec)
  const to = Math.max(range.startSec, range.endSec)
  const out: string[] = []
  for (const clip of clips ?? []) {
    if (!isUsableClip(clip) || clip.track !== track) continue
    if (clip.startSec < to && clip.startSec + clip.durationSec > from) out.push(clip.id)
  }
  return out
}

/** 生成不与既有 id 冲突的片段 id：冲突时加 `~n` 后缀（确定性、可测） */
function uniqueClipId(desired: string, used: Set<string>): string {
  if (!used.has(desired)) return desired
  let index = 2
  while (used.has(`${desired}~${index}`)) index += 1
  return `${desired}~${index}`
}

/** 默认 id 工厂：调用方没给时用轨名 + 序号（主进程 / 编辑器都传自己的口径） */
function defaultClipIdFactory(track: ScriptTimelineTrackKind, index: number): string {
  return `clip:edit:${track}:${index}`
}

/**
 * 清洗一条 patch：白名单过滤、数值夹取、`null` 转清除标记。
 */
function sanitizeClipPatch(patch: TimelineClipPatch | undefined | null): {
  patch: Record<string, unknown>
  clear: string[]
  failures: TimelineEditFailureCode[]
} {
  const out: Record<string, unknown> = {}
  const clear: string[] = []
  const failures: TimelineEditFailureCode[] = []
  if (!patch || typeof patch !== 'object') return { patch: out, clear, failures }

  for (const [key, raw] of Object.entries(patch)) {
    if (!EDITABLE_PATCH_KEYS.has(key)) continue
    if (raw === null) {
      clear.push(key)
      continue
    }
    const rule = NUMERIC_PATCH_RULES[key]
    if (rule) {
      const n = toFinite(raw)
      if (n === null) continue
      // 时长 <= 0 是「这条指令没有意义」而非「越界」，报错让调用方知道它没生效
      if (rule.strictMin && n <= rule.min) {
        failures.push('invalid-duration')
        continue
      }
      const clamped =
        rule.max == null ? Math.max(rule.min, n) : Math.min(rule.max, Math.max(rule.min, n))
      out[key] = round4(clamped)
      continue
    }
    if (key === 'transitionType') {
      if (typeof raw === 'string' && TRANSITION_TYPES.includes(raw)) out[key] = raw
      continue
    }
    if (key === 'tweenIn') {
      if (isTimelineTweenInPreset(raw)) out[key] = raw
      continue
    }
    if (key === 'tweenOut') {
      if (isTimelineTweenOutPreset(raw)) out[key] = raw
      continue
    }
    if (key === 'tweenLoop') {
      if (isTimelineTweenLoopPreset(raw)) out[key] = raw
      continue
    }
    if (key === 'tweenInEase' || key === 'tweenOutEase') {
      if (isTimelineEaseType(raw)) out[key] = raw
      continue
    }
    if (key === 'cameraMotion') {
      if (isTimelineMainCameraPreset(raw)) out[key] = raw
      continue
    }
    if (key === 'keyframes') {
      if (Array.isArray(raw)) out[key] = normalizeTimelineKeyframes(raw)
      continue
    }
    if (key === 'subtitleKaraokeMode') {
      if (isTimelineSubtitleKaraokeMode(raw)) out[key] = raw
      continue
    }
    if (key === 'voiceEffect') {
      if (isTimelineVoiceEffectId(raw)) out[key] = raw
      continue
    }
    if (key === 'anchorMatchDuration' || key === 'loop') {
      if (typeof raw === 'boolean') out[key] = raw
      continue
    }
    if (key === 'widgetConfig') {
      const cfg = normalizeTimelineWidgetConfig(raw)
      if (cfg) out[key] = cfg
      continue
    }
    if (key === 'words') {
      if (Array.isArray(raw)) out[key] = raw
      continue
    }
    if (typeof raw === 'string') out[key] = raw
  }
  return { patch: out, clear, failures }
}

/** 草稿的可读标识：优先用调用方给的 id / 标题，否则用序号 */
function describeDraft(draft: TimelineClipDraft | undefined, index: number): string {
  const label = draft?.id ?? draft?.title ?? draft?.relativePath
  return typeof label === 'string' && label ? label : `#${index + 1}`
}

/**
 * 按顺序执行编辑指令，返回新文档与逐项报告。
 *
 * `add` 未给 `startSec` 时排到该轨轨尾（同一批草稿依次紧接，中间留 `gapSec`）。
 * 入参 `document` 不被修改；片段数组按原顺序保留，新增片段追加在末尾。
 */
export function applyTimelineEdits(
  document: ScriptTimelineDocument,
  operations: TimelineEditOperation[] | undefined,
  options?: { makeClipId?: (track: ScriptTimelineTrackKind, index: number) => string }
): TimelineEditResult {
  const makeClipId = options?.makeClipId ?? defaultClipIdFactory
  // 浅拷贝：入参不被改写；结构不完整的脏片段原样留着（只是不参与排布计算），绝不顺手丢数据
  const clips: ScriptTimelineClip[] = (document.clips ?? [])
    .filter((clip) => !!clip && typeof clip === 'object')
    .map((clip) => ({ ...clip }))
  let nextSettings: ScriptTimelineSettings | undefined = document.settings
    ? { ...document.settings }
    : undefined
  const used = new Set(clips.filter(isUsableClip).map((clip) => clip.id))
  const failures: TimelineEditFailure[] = []
  let added = 0
  let updated = 0
  let removed = 0
  let draftIndex = 0

  /**
   * 当修改或新增主视频轨片段的 `transitionType` / `transitionInSec` 且未显式指定 `startSec` 时，
   * 自动与前一视频轨片段建立/解除转场重叠（涟漪平移后续片段），保证预览与导出真正生效。
   */
  const syncVideoTransitionOverlap = (
    rightClipId: string,
    patch: Record<string, unknown>,
    clear: string[]
  ): void => {
    if (patch.startSec !== undefined) return
    const touchesTransition =
      'transitionType' in patch ||
      'transitionInSec' in patch ||
      clear.includes('transitionType') ||
      clear.includes('transitionInSec')
    if (!touchesTransition) return
    const vClips = clips
      .filter((c) => isUsableClip(c) && c.track === 'video')
      .slice()
      .sort((a, b) => a.startSec - b.startSec || a.id.localeCompare(b.id))
    const rightIdx = vClips.findIndex((c) => c.id === rightClipId)
    if (rightIdx <= 0) return
    const left = vClips[rightIdx - 1]!
    const right = vClips[rightIdx]!
    const clearTrans =
      clear.includes('transitionType') ||
      clear.includes('transitionInSec') ||
      patch.transitionType === 'none'
    const nextType: ScriptTimelineTransitionType = clearTrans
      ? 'none'
      : ((patch.transitionType as ScriptTimelineTransitionType | undefined) ??
        (right.transitionType && right.transitionType !== 'none'
          ? right.transitionType
          : 'dissolve'))
    const rawDur = clearTrans
      ? 0
      : typeof patch.transitionInSec === 'number'
        ? patch.transitionInSec
        : right.transitionInSec
    const nextClips = applyVideoTransitionBetweenClips(clips, left.id, right.id, {
      transitionType: nextType,
      durationSec: rawDur
    })
    clips.splice(0, clips.length, ...nextClips)
    const updatedRight = clips.find((c) => c.id === rightClipId)
    if (updatedRight) {
      if (clear.includes('transitionType')) {
        delete (updatedRight as Record<string, unknown>).transitionType
      }
      if (clear.includes('transitionInSec')) {
        delete (updatedRight as Record<string, unknown>).transitionInSec
      }
    }
  }

  /** 逐枚校验并插入草稿；`add` 与 `replaceRange` 共用 */
  const insertDrafts = (
    drafts: TimelineClipDraft[] | undefined,
    gapSec: number,
    opLabel: 'add' | 'replaceRange'
  ): void => {
    for (const draft of drafts ?? []) {
      const index = draftIndex++
      if (!draft || !isTrackKind(draft.track)) {
        failures.push({ op: opLabel, code: 'invalid-track', target: describeDraft(draft, index) })
        continue
      }
      const durationSec = toFinite(draft.durationSec)
      if (durationSec === null || durationSec <= 0) {
        failures.push({
          op: opLabel,
          code: 'invalid-duration',
          target: describeDraft(draft, index)
        })
        continue
      }
      const explicitStart = toFinite(draft.startSec)
      const startSec =
        explicitStart === null
          ? round4(trackEndSec(clips, draft.track) + gapSec)
          : round4(Math.max(0, explicitStart))
      const id = uniqueClipId(
        typeof draft.id === 'string' && draft.id ? draft.id : makeClipId(draft.track, index),
        used
      )
      used.add(id)
      const inserted: ScriptTimelineClip = {
        ...draft,
        id,
        track: draft.track,
        startSec,
        durationSec: round4(durationSec),
        title: String(draft.title ?? draft.text ?? ''),
        sourceId: String(draft.sourceId ?? draft.assetId ?? draft.relativePath ?? '')
      }
      clips.push(inserted)
      if (
        opLabel === 'add' &&
        explicitStart === null &&
        gapSec === 0 &&
        inserted.track === 'video' &&
        ((inserted.transitionType && inserted.transitionType !== 'none') ||
          (inserted.transitionInSec ?? 0) > 0)
      ) {
        syncVideoTransitionOverlap(
          inserted.id,
          {
            ...(inserted.transitionType ? { transitionType: inserted.transitionType } : {}),
            ...(inserted.transitionInSec !== undefined
              ? { transitionInSec: inserted.transitionInSec }
              : {})
          },
          []
        )
      }
      added += 1
    }
  }

  /** 删掉该轨上与区间重叠的片段 */
  const dropOverlapping = (track: ScriptTimelineTrackKind, range: TimelineTimeRange): void => {
    for (const clipId of findOverlappingClipIds(clips, track, range)) {
      const index = clips.findIndex((clip) => clip.id === clipId)
      if (index < 0) continue
      clips.splice(index, 1)
      used.delete(clipId)
      removed += 1
    }
  }

  for (const operation of operations ?? []) {
    if (!operation || typeof operation !== 'object') continue

    if (operation.op === 'add') {
      insertDrafts(operation.clips, Math.max(0, toFinite(operation.gapSec) ?? 0), 'add')
      continue
    }

    if (operation.op === 'replaceRange') {
      if (!isTrackKind(operation.track)) {
        failures.push({
          op: 'replaceRange',
          code: 'invalid-track',
          target: String(operation.track)
        })
        continue
      }
      dropOverlapping(operation.track, operation.range)
      // 替换进来的草稿必须自带 startSec：轨尾语义在这里会让新内容跑到整轨末尾去
      insertDrafts(
        (operation.clips ?? []).map((clip) => ({ ...clip, startSec: clip.startSec ?? 0 })),
        0,
        'replaceRange'
      )
      continue
    }

    if (operation.op === 'update') {
      const clipId = String(operation.clipId ?? '')
      const target = clips.find((clip) => clip.id === clipId)
      if (!target) {
        failures.push({ op: 'update', code: 'clip-not-found', target: clipId })
        continue
      }
      const { patch, clear, failures: patchFailures } = sanitizeClipPatch(operation.patch)
      const usable = Object.keys(patch).length > 0 || clear.length > 0
      if (!usable) {
        // 一个可用字段都没有：有具体原因（如时长为 0）就报原因，否则是 patch 里全是无关字段
        if (patchFailures.length) {
          for (const code of patchFailures) failures.push({ op: 'update', code, target: clipId })
        } else {
          failures.push({ op: 'update', code: 'empty-patch', target: clipId })
        }
        continue
      }
      for (const code of patchFailures) {
        failures.push({ op: 'update', code, target: clipId })
      }
      Object.assign(target, patch)
      for (const key of clear) delete (target as Record<string, unknown>)[key]
      if (target.track === 'video') {
        syncVideoTransitionOverlap(target.id, patch, clear)
      }
      updated += 1
      continue
    }

    if (operation.op === 'batchUpdate') {
      if (operation.track !== undefined && !isTrackKind(operation.track)) {
        failures.push({
          op: 'batchUpdate',
          code: 'invalid-track',
          target: String(operation.track)
        })
        continue
      }
      const { patch, clear, failures: patchFailures } = sanitizeClipPatch(operation.patch)
      const usable = Object.keys(patch).length > 0 || clear.length > 0
      if (!usable) {
        if (patchFailures.length) {
          for (const code of patchFailures) {
            failures.push({ op: 'batchUpdate', code, target: operation.track ?? '*' })
          }
        } else {
          failures.push({
            op: 'batchUpdate',
            code: 'empty-patch',
            target: operation.track ?? '*'
          })
        }
        continue
      }
      for (const code of patchFailures) {
        failures.push({ op: 'batchUpdate', code, target: operation.track ?? '*' })
      }
      const targetIds: string[] = []
      if (Array.isArray(operation.clipIds) && operation.clipIds.length > 0) {
        for (const rawId of operation.clipIds) {
          const cid = String(rawId ?? '')
          const found = clips.find((c) => c.id === cid)
          if (!found) {
            failures.push({ op: 'batchUpdate', code: 'clip-not-found', target: cid })
            continue
          }
          if (operation.track && found.track !== operation.track) continue
          targetIds.push(cid)
        }
      } else {
        for (const clip of clips) {
          if (!isUsableClip(clip)) continue
          if (operation.track && clip.track !== operation.track) continue
          targetIds.push(clip.id)
        }
      }
      for (const cid of targetIds) {
        const target = clips.find((c) => c.id === cid)
        if (!target) continue
        Object.assign(target, patch)
        for (const key of clear) delete (target as Record<string, unknown>)[key]
        updated += 1
      }
      // 若批量操作涉及主视频轨转场，按时间顺序建立相邻切点重叠
      const vTargets = clips
        .filter((c) => isUsableClip(c) && c.track === 'video' && targetIds.includes(c.id))
        .slice()
        .sort((a, b) => a.startSec - b.startSec || a.id.localeCompare(b.id))
      for (const vc of vTargets) {
        syncVideoTransitionOverlap(vc.id, patch, clear)
      }
      continue
    }

    if (operation.op === 'applyTemplate') {
      const preset = TIMELINE_CREATIVE_TEMPLATES.find((item) => item.id === operation.templateId)
      if (!preset) {
        failures.push({
          op: 'applyTemplate',
          code: 'invalid-template',
          target: String(operation.templateId ?? '')
        })
        continue
      }
      const beforeCount = clips.length
      const templated = applyTimelineCreativeTemplateToClips(
        clips,
        document.sources ?? [],
        nextSettings ?? {},
        preset.id,
        (list, leftId, rightId, opts) =>
          applyVideoTransitionBetweenClips(list, leftId, rightId, opts)
      )
      clips.splice(0, clips.length, ...templated.clips)
      for (const c of clips) {
        if (isUsableClip(c)) used.add(c.id)
      }
      nextSettings = templated.settings
      if (clips.length > beforeCount) {
        added += clips.length - beforeCount
      }
      updated += Math.max(1, templated.appliedVideoClipCount)
      continue
    }

    if (operation.op === 'syncCues') {
      const synced = syncTimelineCueAnchors(clips)
      clips.splice(0, clips.length, ...synced.clips)
      updated += Math.max(1, synced.syncedClipCount + synced.syncedWidgetItemCount)
      continue
    }

    if (operation.op === 'remove') {
      for (const clipId of operation.clipIds ?? []) {
        const index = clips.findIndex((clip) => clip.id === clipId)
        if (index < 0) {
          failures.push({ op: 'remove', code: 'clip-not-found', target: String(clipId) })
          continue
        }
        clips.splice(index, 1)
        used.delete(String(clipId))
        removed += 1
      }
    }
  }

  // 当时间线包含带内联锚点的字幕或绑定了 anchorCueTag / widgetConfig.cueTag 的片段时，自动同步一次
  const shouldAutoSyncCues = clips.some(
    (c) =>
      (c.track === 'subtitle' &&
        (hasInlineCueMarkup(c.rawCueText) || hasInlineCueMarkup(c.text))) ||
      Boolean(c.anchorCueTag?.trim()) ||
      Boolean(c.widgetConfig?.items?.some((it) => Boolean(it.cueTag?.trim())))
  )
  if (shouldAutoSyncCues) {
    const synced = syncTimelineCueAnchors(clips)
    clips.splice(0, clips.length, ...synced.clips)
  }

  return {
    document: {
      ...document,
      clips,
      ...(nextSettings ? { settings: nextSettings } : {})
    },
    added,
    updated,
    removed,
    failures
  }
}
