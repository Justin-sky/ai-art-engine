/**
 * 可玩 HTML 作业契约（AI 对话路径）：prepare → build → status 三段式。
 *
 * 与旧的文件式 dsh 作业契约（`gamePlayDshJob.ts`：brief.md / result.json，供图节点用隐藏
 * dsh 会话执行）不同：对话路径里**生成者就是当前可见会话**，宿主只负责「落脚手架 / cook /
 * 报状态」，不需要 brief 与 result 这两个中间文件。两者共用同一份工程根目录常量。
 */

/** 工程根下存放可玩 HTML 作业的目录（相对路径，正斜杠） */
export const GAME_PLAY_PROJECT_ROOT = 'Cache/GamePlayJobs'

export type GamePlayJobMode = '2d' | '3d' | 'auto'

export type GamePlayJobStatus = 'ready' | 'building' | 'done' | 'error'

/** 单条状态快照：日志只回尾部，避免把整个 npm install 输出灌进对话 */
export interface GamePlayJobSnapshot {
  jobId: string
  /** 相对工程根，如 Cache/GamePlayJobs/<id>/project */
  projectRelativeDir: string
  mode: GamePlayJobMode
  status: GamePlayJobStatus
  /** 日志尾部（最新在后） */
  logs: string[]
  error?: string
  /** cook 成功后的单文件 HTML 相对路径 */
  buildHtmlRelativePath?: string
  bytes?: number
  updatedAt: string
}

export const GAME_PLAY_JOB_LOG_TAIL = 40
export const GAME_PLAY_JOB_LOG_MAX = 400

export function gamePlayJobError(code: string): string {
  return `GRAPH_GAMEPLAY_${code}`
}

export function normalizeGamePlayJobMode(raw: string | undefined): GamePlayJobMode {
  if (raw === '2d' || raw === '3d' || raw === 'auto') return raw
  return 'auto'
}

/**
 * 把调用方给的工程相对路径规范化并校验：必须是 `<root>/<jobId>/project` 形态。
 * 非法（含 `..`、不是 project 目录、jobId 带分隔符）一律返回 null——工具入参来自模型，
 * 不能拿它当任意路径读取器。
 */
export function resolveGamePlayProjectRelativeDir(raw: string | undefined): string | null {
  const rel = String(raw ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .trim()
  if (!rel || rel.includes('..')) return null
  const prefix = `${GAME_PLAY_PROJECT_ROOT}/`
  if (!rel.startsWith(prefix) || !rel.endsWith('/project')) return null
  const jobId = rel.slice(prefix.length, -'/project'.length)
  if (!jobId || jobId.includes('/')) return null
  return rel
}

/** 日志入队 + 截断：超出上限丢最旧的，避免长构建把内存吃满 */
export function appendGamePlayJobLog(logs: string[], line: string): void {
  const text = line.trim()
  if (!text) return
  logs.push(text)
  if (logs.length > GAME_PLAY_JOB_LOG_MAX) logs.splice(0, logs.length - GAME_PLAY_JOB_LOG_MAX)
}

/** 从已校验的 `<root>/<jobId>/project` 里取出 jobId */
export function gamePlayJobIdOf(projectRelativeDir: string): string | null {
  const rel = resolveGamePlayProjectRelativeDir(projectRelativeDir)
  if (!rel) return null
  return rel.slice(`${GAME_PLAY_PROJECT_ROOT}/`.length, -'/project'.length) || null
}

export function gamePlayJobLogTail(logs: readonly string[]): string[] {
  return logs.slice(-GAME_PLAY_JOB_LOG_TAIL)
}
