/**
 * AI 智能粗剪：基于视频素材标题 / 分镜描述生成视频轨编排方案（顺序、时长、转场）。
 * 纯函数（提示词构建 / 解析 / 应用），可在 renderer 与测试中直接使用。
 */
import { stripJsonCodeFence } from '@shared/graph'
import type { ScriptTimelineClip, ScriptTimelineSource } from './scriptTimeline'

/** 智能粗剪允许的转场白名单（ScriptTimelineClip.transitionType 子集） */
export const SMART_CUT_TRANSITIONS = [
  'none',
  'dissolve',
  'fade',
  'flash',
  'slideleft',
  'slideright',
  'wipeleft',
  'wiperight',
  'circleopen'
] as const

export const SMART_CUT_MIN_DURATION_SEC = 0.5
export const SMART_CUT_MAX_DURATION_SEC = 60
export const SMART_CUT_DEFAULT_TRANSITION_SEC = 0.4
/** 单次粗剪最多参与决策的素材数（防止 prompt 过长） */
export const SMART_CUT_MAX_ITEMS = 40

export type SmartCutTransitionType = (typeof SMART_CUT_TRANSITIONS)[number]

export interface SmartCutSourceInfo {
  id: string
  title: string
  /** 素材元数据时长（秒），可能未知 */
  durationSec?: number
  /** 来源图节点标题（分镜描述） */
  nodeTitle?: string
}

export interface SmartCutCurrentClipInfo {
  title: string
  sourceId: string
  startSec: number
  durationSec: number
}

export interface SmartCutEdit {
  /** 素材 id（必须存在于素材清单） */
  sourceId: string
  /** 保留时长（秒）；缺省用素材原始时长 */
  durationSec?: number
  /** 转场效果；缺省 none */
  transitionType?: SmartCutTransitionType
  /** 转场时长（秒）；缺省 0.4 */
  transitionSec?: number
}

export interface SmartCutPlan {
  edits: SmartCutEdit[]
  /** 建议总时长（秒）；缺省按各段累加 */
  totalDurationSec?: number
}

export interface SmartCutPromptInput {
  sources: SmartCutSourceInfo[]
  currentClips?: SmartCutCurrentClipInfo[]
  locale?: string
  maxItems?: number
}

function clampDuration(n: number): number {
  return Math.min(SMART_CUT_MAX_DURATION_SEC, Math.max(SMART_CUT_MIN_DURATION_SEC, n))
}

function isTransition(value: unknown): value is SmartCutTransitionType {
  return typeof value === 'string' && (SMART_CUT_TRANSITIONS as readonly string[]).includes(value)
}

/** 构建粗剪指令（中/英）；素材超量时提示仅参考前 N 条 */
export function buildSmartCutPrompt(input: SmartCutPromptInput): string {
  const zh = !(input.locale ?? '').toLowerCase().startsWith('en')
  const max = Math.max(1, Math.min(SMART_CUT_MAX_ITEMS, input.maxItems ?? SMART_CUT_MAX_ITEMS))
  const sources = input.sources.slice(0, max)
  const lines = sources.map((s, i) => {
    const dur = typeof s.durationSec === 'number' && Number.isFinite(s.durationSec) ? `${s.durationSec}s` : '未知'
    const shot = s.nodeTitle?.trim() ? `（分镜：${s.nodeTitle.trim()}）` : ''
    return `${i + 1}. 素材ID:${s.id} | 标题:${s.title}${shot} | 素材时长:${dur}`
  })
  const current = (input.currentClips ?? [])
    .map((c, i) => `${i + 1}. ${c.title} (${c.sourceId}) ${c.startSec.toFixed(1)}-${(c.startSec + c.durationSec).toFixed(1)}s`)
    .join('\n')

  if (zh) {
    return `你是专业短视频剪辑师。请根据下列视频素材的标题与分镜描述，编排一段叙事流畅、节奏合适的粗剪方案（只排视频轨）。

## 可用视频素材（共 ${input.sources.length} 条，参考前 ${max} 条）
${lines.join('\n')}

## 当前视频轨顺序（供参考，可完全重排）
${current || '（空）'}

## 要求
- 依据标题 / 分镜描述判断叙事逻辑，决定顺序、取舍与每段保留时长。
- 每段时长建议 2~8 秒；不必用完每个素材，可跳过次要素材。
- 转场从下列选择：none / dissolve / fade / flash / slideleft / slideright / wipeleft / wiperight / circleopen。
- 只输出 JSON，不要任何解释或代码围栏：

{
  "edits": [
    { "sourceId": "素材ID", "durationSec": 4, "transitionType": "dissolve", "transitionSec": 0.5 }
  ],
  "totalDurationSec": 60
}

durationSec 与 transitionType 可省略（缺省用素材原始时长 / none）。素材ID 必须来自上方清单。`
  }
  return `You are a professional short-video editor. Arrange a smooth, well-paced rough cut (video track only) from the clips below, using their titles and shot descriptions.

## Available video sources (${input.sources.length} total; consider first ${max})
${lines.join('\n')}

## Current video track order (reference only; you may reorder freely)
${current || '(empty)'}

## Rules
- Judge narrative order, selection and per-clip duration from titles/shot descriptions.
- Keep each clip about 2-8s. You may skip minor clips.
- Transitions from: none / dissolve / fade / flash / slideleft / slideright / wipeleft / wiperight / circleopen.
- Output ONLY JSON, no explanation, no code fence:

{
  "edits": [
    { "sourceId": "<source id>", "durationSec": 4, "transitionType": "dissolve", "transitionSec": 0.5 }
  ],
  "totalDurationSec": 60
}

durationSec and transitionType are optional (default: source duration / none). sourceId must be from the list above.`
}

/** 解析模型返回文本为粗剪方案；非法 / 空方案返回 null */
export function parseSmartCutPlan(text: string): SmartCutPlan | null {
  const cleaned = stripJsonCodeFence(text ?? '')
  let raw: unknown
  try {
    raw = JSON.parse(cleaned)
  } catch {
    const first = cleaned.indexOf('{')
    const last = cleaned.lastIndexOf('}')
    if (first < 0 || last <= first) return null
    try {
      raw = JSON.parse(cleaned.slice(first, last + 1))
    } catch {
      return null
    }
  }
  if (!raw || typeof raw !== 'object') return null
  const row = raw as { edits?: unknown; totalDurationSec?: unknown }
  if (!Array.isArray(row.edits)) return null
  const edits: SmartCutEdit[] = []
  for (const item of row.edits) {
    if (!item || typeof item !== 'object') continue
    const e = item as Record<string, unknown>
    if (typeof e.sourceId !== 'string' || !e.sourceId.trim()) continue
    const edit: SmartCutEdit = { sourceId: e.sourceId.trim() }
    const dur = Number(e.durationSec)
    if (Number.isFinite(dur) && dur > 0) edit.durationSec = clampDuration(dur)
    if (isTransition(e.transitionType)) edit.transitionType = e.transitionType
    const tr = Number(e.transitionSec)
    if (Number.isFinite(tr) && tr >= 0) edit.transitionSec = Math.min(3, tr)
    edits.push(edit)
  }
  if (!edits.length) return null
  const plan: SmartCutPlan = { edits }
  const total = Number(row.totalDurationSec)
  if (Number.isFinite(total) && total > 0) plan.totalDurationSec = clampDuration(total)
  return plan
}

export interface ApplySmartCutInput {
  clips: ScriptTimelineClip[]
  sources: ScriptTimelineSource[]
  plan: SmartCutPlan
}

export interface ApplySmartCutResult {
  clips: ScriptTimelineClip[]
  /** 视频轨总时长（秒） */
  totalDurationSec: number
}

function newClipId(seed: number): string {
  return `clip:sc${Date.now().toString(36)}:${seed.toString(36)}:${Math.random().toString(36).slice(2, 7)}`
}

/**
 * 应用粗剪方案：清空原视频轨，按方案顺序重排（时长 / 转场防御式收敛）；
 * 非视频轨保持原样。缺失素材的条目自动跳过。
 */
export function applySmartCutPlan(input: ApplySmartCutInput): ApplySmartCutResult {
  const byId = new Map<string, ScriptTimelineSource>()
  for (const s of input.sources) byId.set(s.id, s)

  const videoClips: ScriptTimelineClip[] = []
  let cursor = 0
  let index = 0
  for (const edit of input.plan.edits) {
    const source = byId.get(edit.sourceId)
    if (!source) continue
    const rawDuration =
      edit.durationSec ?? (typeof source.durationSec === 'number' ? source.durationSec : 3)
    const durationSec = clampDuration(rawDuration)
    const transitionType = edit.transitionType ?? 'none'
    const clip: ScriptTimelineClip = {
      id: newClipId(index),
      track: 'video',
      sourceId: source.id,
      title: source.title,
      ...(source.relativePath?.trim() ? { relativePath: source.relativePath.trim() } : {}),
      ...(source.assetId?.trim() ? { assetId: source.assetId.trim() } : {}),
      ...(source.nodeId?.trim() ? { nodeId: source.nodeId.trim() } : {}),
      ...(source.nodeTitle?.trim() ? { nodeTitle: source.nodeTitle.trim() } : {}),
      startSec: cursor,
      durationSec
    }
    if (transitionType !== 'none' && isTransition(transitionType)) {
      const transitionSec = Math.min(
        Math.min(2, durationSec / 2),
        edit.transitionSec ?? SMART_CUT_DEFAULT_TRANSITION_SEC
      )
      if (transitionSec > 0.05) {
        clip.transitionType = transitionType
        clip.transitionInSec = Math.round(transitionSec * 10) / 10
      }
    }
    videoClips.push(clip)
    cursor += durationSec
    index += 1
  }

  const next = [
    ...input.clips.filter((c) => c.track !== 'video'),
    ...videoClips
  ]
  return {
    clips: next,
    totalDurationSec: Math.round(cursor * 10) / 10
  }
}
