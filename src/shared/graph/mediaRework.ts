/**
 * 媒体自动返工循环数据模型：FAIL → 注入失败原因 → 重新生成，直到 PASS 或达尝试上限。
 * 纯函数、无渲染环境依赖；循环日志供运行日志/UI 展示，状态序列化存 GraphNodeParams.mediaReworkState。
 */
import { stripJsonCodeFence } from './jsonFence'

/** 返工循环终态：running（继续）/ passed（通过）/ exhausted（达上限仍未通过） */
export type MediaReworkStatus = 'running' | 'passed' | 'exhausted'

/** 单次迭代记录（写运行日志用） */
export interface MediaReworkIteration {
  attempt: number
  result: 'PASS' | 'FAIL'
  reason: string
  at: string
}

/** 返工循环状态 */
export interface MediaReworkState {
  /** 已完成的尝试次数 */
  attempt: number
  /** 最大尝试次数上限（含首次） */
  maxAttempts: number
  status: MediaReworkStatus
  /** 最近一次 FAIL 原因（用于下一轮注入；PASS 后清空） */
  lastReason: string
  iterations: MediaReworkIteration[]
}

export const MEDIA_REWORK_DEFAULT_MAX_ATTEMPTS = 3
export const MEDIA_REWORK_MAX_ATTEMPTS_HARD_LIMIT = 8

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
    iterations: []
  }
}

/** 是否应继续下一轮：仍 running 且未达上限 */
export function shouldMediaReworkContinue(state: MediaReworkState): boolean {
  return state.status === 'running' && state.attempt < state.maxAttempts
}

/**
 * 应用一轮质检结论：
 * PASS → passed；FAIL 且已达上限 → exhausted；否则继续 running 并记录原因供下一轮注入。
 */
export function applyMediaReworkReview(
  state: MediaReworkState,
  result: 'PASS' | 'FAIL',
  reason: string
): MediaReworkState {
  const attempt = state.attempt + 1
  const iteration: MediaReworkIteration = {
    attempt,
    result,
    reason: reason || '',
    at: new Date().toISOString()
  }
  const status: MediaReworkStatus =
    result === 'PASS' ? 'passed' : attempt >= state.maxAttempts ? 'exhausted' : 'running'
  return {
    ...state,
    attempt,
    status,
    lastReason: result === 'FAIL' ? reason || '' : '',
    iterations: [...state.iterations, iteration]
  }
}

/** 返工指令：注入 FAIL 原因，要求针对性地修改并保持其余不变 */
export function buildMediaReworkInstruction(
  baseInstruction: string,
  failReason: string,
  locale?: string
): string {
  const base = (baseInstruction ?? '').trim()
  const reason = (failReason ?? '').trim()
  if (!reason) return base
  const english = (locale ?? '').toLowerCase().startsWith('en')
  const directive = english
    ? `Fix the following issues while keeping everything else unchanged: ${reason}`
    : `【上次质检 FAIL 原因，必须针对性地修改并保持其余不变】${reason}`
  return base ? `${base}\n\n${directive}` : directive
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
            (it as MediaReworkIteration).result === 'FAIL')
      )
    : []
  return {
    attempt,
    maxAttempts,
    status,
    lastReason: typeof obj.lastReason === 'string' ? obj.lastReason : '',
    iterations
  }
}
