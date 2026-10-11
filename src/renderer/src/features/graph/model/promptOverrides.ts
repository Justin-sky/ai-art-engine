/**
 * 逐镜提示词覆盖（编译节点参数 `promptOverridesJson`）的纯函数读写。
 *
 * 为什么单独成模块：dive 里的提示词面板要「按 shotId 改一句、删一句」，
 * 而节点参数是一段 JSON 文本 —— 直接字符串拼接会让手写/agent 写的其它镜头条目被吃掉，
 * 而且空字符串该表示「删掉这条覆盖」还是「提示词就是空」在界面上分不清。
 * 契约（与 `applyPromptOverrides` 一致）：
 * - 磁盘格式是 `{"<shotId>": "<prompt>"}`；
 * - **只改目标镜头**，其余键原样保留（含本函数不认识的形状）；
 * - 文本清空 = 删除该条覆盖（回到自动拼装结果），不是写一条空提示词。
 */
import type { VideoPromptPlan, VideoPromptShot } from '@shared/semanticTimeline'

export interface PromptOverrideRow {
  shotId: string
  startSec: number
  endSec: number
  durationSec: number
  /** 该镜有首帧图（重建时走图生视频） */
  hasFirstFrame: boolean
  /** 面板里显示的提示词：有人工覆盖用覆盖值，否则用计划里的拼装结果 */
  prompt: string
  /** 这一镜是否被人工覆盖过（决定「已覆盖」标记与「恢复」按钮） */
  overridden: boolean
  /** 提示词是否由文本模型撰写（false = 规则拼装） */
  modelAuthored: boolean
  eventLabels: string[]
}

function parseJson(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw
  const text = raw.trim()
  if (!text) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

/**
 * 读出 `{shotId: prompt}`。
 *
 * 两种输入都认：紧凑对象（UI 写的）与 `[{shotId, prompt}]` 数组（agent / 手写，
 * 与 `applyPromptOverrides` 同一宽容度）—— 否则 agent 写的覆盖在面板里会「看不见」，
 * 用户一改就把它们冲掉。
 */
export function readPromptOverrides(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  const parsed = parseJson(raw)
  /**
   * 必须先判数组再判对象：`JSON.parse('[{…}]')` 的结果 `typeof` 也是 `'object'`，
   * 若按对象展开就会把下标（`'0'`）当成 shotId —— 实测踩到（数组形状认不出来）。
   */
  const list = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' ? [parsed] : []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    // 数组形状
    if (typeof row.shotId === 'string') {
      const id = row.shotId.trim()
      if (id && typeof row.prompt === 'string') out[id] = row.prompt
      continue
    }
    // 紧凑对象形状
    for (const [key, value] of Object.entries(row)) {
      const id = key.trim()
      if (!id) continue
      if (typeof value === 'string') out[id] = value
      else if (value && typeof value === 'object') {
        const nested = (value as { prompt?: unknown }).prompt
        if (typeof nested === 'string') out[id] = nested
      }
    }
  }
  return out
}

/** `{shotId: prompt}` → 参数文本；空表写空串（参数留空 = 一条覆盖都没有） */
export function writePromptOverrides(map: Record<string, string>): string {
  const keys = Object.keys(map).filter((k) => k.trim().length > 0)
  if (keys.length === 0) return ''
  const out: Record<string, string> = {}
  for (const key of keys) out[key] = map[key]!
  return JSON.stringify(out, null, 2)
}

/** 改一镜：空文本 = 删掉这条覆盖 */
export function setPromptOverride(raw: unknown, shotId: string, prompt: string): string {
  const id = shotId.trim()
  const map = readPromptOverrides(raw)
  if (!id) return writePromptOverrides(map)
  if (prompt.trim().length === 0) delete map[id]
  else map[id] = prompt
  return writePromptOverrides(map)
}

/** 删一镜（回到自动拼装结果） */
export function removePromptOverride(raw: unknown, shotId: string): string {
  const id = shotId.trim()
  const map = readPromptOverrides(raw)
  if (id) delete map[id]
  return writePromptOverrides(map)
}

/** 面板的行：计划里的镜头 + 当前生效的提示词与覆盖状态 */
export function promptOverrideRows(
  plan: VideoPromptPlan | null | undefined,
  overridesJson: unknown
): PromptOverrideRow[] {
  const overrides = readPromptOverrides(overridesJson)
  return (plan?.shots ?? []).map((shot: VideoPromptShot) => {
    const startSec = Number.isFinite(shot.startSec) ? shot.startSec : 0
    const durationSec = Number.isFinite(shot.durationSec) ? shot.durationSec : 0
    const override = overrides[shot.shotId]
    return {
      shotId: shot.shotId,
      startSec,
      durationSec,
      endSec: startSec + durationSec,
      hasFirstFrame: !!shot.firstFrameRelativePath,
      prompt: override ?? shot.prompt,
      overridden: override !== undefined,
      modelAuthored: shot.modelAuthored === true,
      eventLabels: Array.isArray(shot.eventLabels) ? shot.eventLabels : []
    }
  })
}
