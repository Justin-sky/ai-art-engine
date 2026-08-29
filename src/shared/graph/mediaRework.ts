/**
 * 媒体自动返工循环数据模型：FAIL → 注入失败原因 → 重新生成，直到 PASS 或达尝试上限。
 * 纯函数、无渲染环境依赖；循环日志供运行日志/UI 展示，状态序列化存 GraphNodeParams.mediaReworkState。
 */
import { stripJsonCodeFence } from './jsonFence'
import { mediaReworkDirective } from './mediaReviewPrompts'

/** 返工循环终态：running（继续）/ passed（通过）/ exhausted（达上限仍未通过） */
export type MediaReworkStatus = 'running' | 'passed' | 'exhausted'

/**
 * 单轮结论。
 * UNDECIDED：模型没有按 `## 结论:` 协议输出，属格式问题而非质量问题。
 * 此前它与 FAIL 同权，白白吃掉一次尝试额度——默认 3 次里可能 1~2 次浪费在格式上。
 */
export type MediaReworkIterationResult = 'PASS' | 'FAIL' | 'UNDECIDED'

/** 单轮调用开销（生图 / 质检调用次数） */
export interface MediaReworkCostEntry {
  attempt: number
  imageCalls: number
  reviewCalls: number
  at: string
}

/** 单次迭代记录（写运行日志用） */
export interface MediaReworkIteration {
  attempt: number
  result: MediaReworkIterationResult
  reason: string
  at: string
  /** 该轮生图种子，便于复现与人工挑选 */
  seed?: number
  /** 该轮产物 id，用于从累积图库回溯定位 */
  imageIds?: string[]
  /** 该轮质检均分（解析到打分时才有） */
  score?: number
  /** 该轮采用的返工策略 */
  strategy?: MediaReworkStrategyKind
  /** 该轮实际生效的生图模型（首选失败自动切换后为最终生效的那个） */
  model?: string
  /** 该轮实际生效的质检模型 */
  reviewModel?: string
  /** 该轮换模型次数：首选模型调用失败后按备选链自动切换 */
  modelSwitches?: number
}

/** 返工策略：guidance=针对性修正 / reseed=换构图重抽 / stronger=强化约束重解 */
export type MediaReworkStrategyKind = 'guidance' | 'reseed' | 'stronger'

/** 返工循环状态 */
export interface MediaReworkState {
  /** 已完成的尝试次数（仅统计有明确 PASS/FAIL 结论的轮次） */
  attempt: number
  /** 最大尝试次数上限（含首次） */
  maxAttempts: number
  status: MediaReworkStatus
  /** 最近一次 FAIL 原因（用于下一轮注入；PASS 后清空） */
  lastReason: string
  iterations: MediaReworkIteration[]
  /** 连续「结论未解析」次数：达上限直接 exhausted，避免格式问题死循环 */
  undecidedStreak: number
  /** 各轮调用开销，供 UI 展示成本 */
  cost: MediaReworkCostEntry[]
}

export const MEDIA_REWORK_DEFAULT_MAX_ATTEMPTS = 3
export const MEDIA_REWORK_MAX_ATTEMPTS_HARD_LIMIT = 8
/** 连续未解析上限：超过则判定本节点无法自证质量，转 exhausted 交人工 */
export const MEDIA_REWORK_UNDECIDED_LIMIT = 2

/**
 * 选择本轮返工策略。
 * auto 按失败轮次自动升档：首轮针对性修正 → 二轮换构图重抽 → 三轮起强化约束，
 * 避免每轮都用同一句话重抽卡（生图模型对「修 X 保其余」理解力弱，同语重抽等于碰运气）。
 */
export function resolveReworkStrategy(
  preference: 'auto' | MediaReworkStrategyKind | undefined | null,
  failedRounds: number
): MediaReworkStrategyKind {
  if (preference && preference !== 'auto') return preference
  if (failedRounds <= 1) return 'guidance'
  if (failedRounds === 2) return 'reseed'
  return 'stronger'
}

/** 夹取最大尝试次数：非法/缺省回退 3，夹到 [1, 8] */
export function clampMediaReworkMaxAttempts(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isFinite(n)) return MEDIA_REWORK_DEFAULT_MAX_ATTEMPTS
  return Math.max(1, Math.min(MEDIA_REWORK_MAX_ATTEMPTS_HARD_LIMIT, Math.round(n)))
}

export function createMediaReworkState(maxAttempts?: number): MediaReworkState {
  return {
    attempt: 0,
    maxAttempts: clampMediaReworkMaxAttempts(maxAttempts),
    status: 'running',
    lastReason: '',
    iterations: [],
    undecidedStreak: 0,
    cost: []
  }
}

/** 是否应继续下一轮：仍 running、未达尝试上限、且未解析次数未触顶 */
export function shouldMediaReworkContinue(state: MediaReworkState): boolean {
  if (state.status !== 'running') return false
  if ((state.undecidedStreak ?? 0) >= MEDIA_REWORK_UNDECIDED_LIMIT) return false
  return state.attempt < state.maxAttempts
}

/**
 * 从全部轮次里挑最优产物：优先 PASS，其次质检均分最高，最后退回最新一轮。
 * 返工的价值是「多试取优」，此前只保留最后一轮，等于花了 N 倍成本却可能拿到最差的一张。
 */
export function selectBestIteration(
  state: MediaReworkState
): MediaReworkIteration | null {
  const rounds = (state.iterations ?? []).filter((it) => it.result !== 'UNDECIDED')
  if (!rounds.length) return null
  const passed = rounds.filter((it) => it.result === 'PASS')
  const pool = passed.length ? passed : rounds
  let best = pool[pool.length - 1]!
  for (const item of pool) {
    const bestScore = best.score ?? 0
    const score = item.score ?? 0
    if (score > bestScore) best = item
  }
  return best
}

/**
 * 应用一轮质检结论：
 * PASS → passed；FAIL 且已达上限 → exhausted；否则继续 running 并记录原因供下一轮注入。
 */
export interface ApplyMediaReworkReviewMeta {
  seed?: number
  imageIds?: string[]
  score?: number
  strategy?: MediaReworkStrategyKind
  /** 本轮实际生效的生图模型 */
  model?: string
  /** 本轮实际生效的质检模型 */
  reviewModel?: string
  /** 本轮换模型次数 */
  modelSwitches?: number
}

export function applyMediaReworkReview(
  state: MediaReworkState,
  result: MediaReworkIterationResult,
  reason: string,
  meta?: ApplyMediaReworkReviewMeta
): MediaReworkState {
  const at = new Date().toISOString()
  const iterations = [...(state.iterations ?? [])]
  const metaFields = {
    ...(meta?.seed !== undefined ? { seed: meta.seed } : {}),
    ...(meta?.imageIds ? { imageIds: meta.imageIds } : {}),
    ...(meta?.score !== undefined ? { score: meta.score } : {}),
    ...(meta?.strategy ? { strategy: meta.strategy } : {}),
    ...(meta?.model ? { model: meta.model } : {}),
    ...(meta?.reviewModel ? { reviewModel: meta.reviewModel } : {}),
    ...(meta?.modelSwitches !== undefined ? { modelSwitches: meta.modelSwitches } : {})
  }

  // 结论未解析：只记格式问题，不消耗尝试额度，也不把原因注入下一轮（它不是质量反馈）
  if (result === 'UNDECIDED') {
    const undecidedStreak = (state.undecidedStreak ?? 0) + 1
    iterations.push({
      attempt: state.attempt,
      result: 'UNDECIDED',
      reason: reason || '',
      at,
      ...metaFields
    })
    return {
      ...state,
      iterations,
      undecidedStreak,
      status: undecidedStreak >= MEDIA_REWORK_UNDECIDED_LIMIT ? 'exhausted' : state.status
    }
  }

  const attempt = state.attempt + 1
  iterations.push({ attempt, result, reason: reason || '', at, ...metaFields })
  const status: MediaReworkStatus =
    result === 'PASS' ? 'passed' : attempt >= state.maxAttempts ? 'exhausted' : 'running'
  return {
    ...state,
    attempt,
    status,
    lastReason: result === 'FAIL' ? reason || '' : '',
    iterations,
    undecidedStreak: 0
  }
}

/** 返工指令装配参数 */
export interface BuildMediaReworkInstructionExtra {
  /** 本轮策略（缺省 guidance） */
  strategy?: MediaReworkStrategyKind
  /** 客观校验未通过项的英文描述，优先于质检原因注入 */
  objectiveIssues?: readonly string[]
}

/**
 * 返工指令：原始指令 + 客观校验问题 + 质检 FAIL 原因 + 本轮策略提示。
 * 文案本体在 mediaReviewPrompts.ts（双语域数据，cjk 豁免）。
 */
export function buildMediaReworkInstruction(
  baseInstruction: string,
  failReason: string,
  locale?: string,
  extra?: BuildMediaReworkInstructionExtra
): string {
  return mediaReworkDirective(baseInstruction, {
    failReason,
    locale,
    ...(extra?.strategy ? { strategy: extra.strategy } : {}),
    ...(extra?.objectiveIssues?.length ? { objectiveIssues: extra.objectiveIssues } : {})
  })
}

/** 渲染循环日志行（运行日志 / UI 用）：`#N PASS` / `#N FAIL: 原因` */
export function mediaReworkLogLines(state: MediaReworkState): string[] {
  return state.iterations.map(
    (it) => `#${it.attempt} ${it.result}${it.reason ? `: ${it.reason}` : ''}`
  )
}

export function serializeMediaReworkState(state: MediaReworkState): string {
  return `${JSON.stringify(state, null, 2)}\n`
}

export function parseMediaReworkState(raw: string | null | undefined): MediaReworkState | null {
  if (!raw?.trim()) return null
  const text = stripJsonCodeFence(raw)
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const obj = parsed as Partial<MediaReworkState>
  if (typeof obj.attempt !== 'number' || !Number.isFinite(obj.attempt)) return null
  const attempt = Math.max(0, Math.round(obj.attempt))
  const maxAttempts = clampMediaReworkMaxAttempts(obj.maxAttempts)
  const status: MediaReworkStatus =
    obj.status === 'passed' || obj.status === 'exhausted' ? obj.status : 'running'
  const iterations = Array.isArray(obj.iterations)
    ? obj.iterations.filter(
        (it): it is MediaReworkIteration =>
          !!it &&
          typeof it === 'object' &&
          typeof (it as MediaReworkIteration).attempt === 'number' &&
          ((it as MediaReworkIteration).result === 'PASS' ||
            (it as MediaReworkIteration).result === 'FAIL' ||
            (it as MediaReworkIteration).result === 'UNDECIDED')
      )
    : []
  const cost = Array.isArray(obj.cost)
    ? obj.cost.filter(
        (it): it is MediaReworkCostEntry =>
          !!it &&
          typeof it === 'object' &&
          typeof (it as MediaReworkCostEntry).attempt === 'number'
      )
    : []
  const undecidedStreakRaw = obj.undecidedStreak
  return {
    attempt,
    maxAttempts,
    status,
    lastReason: typeof obj.lastReason === 'string' ? obj.lastReason : '',
    iterations,
    undecidedStreak:
      typeof undecidedStreakRaw === 'number' && Number.isFinite(undecidedStreakRaw)
        ? Math.max(0, Math.round(undecidedStreakRaw))
        : 0,
    cost
  }
}
