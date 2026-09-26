/**
 * 可玩 HTML 作业契约（AI 对话路径）：prepare → build → status 三段式。
 *
 * 生成者是**当前可见的对话会话**（agent 自己写 `src/**`），宿主只负责「落脚手架 / cook /
 * 报状态」，因此不需要 brief.md / result.json 这类中间契约文件——那是早期「图节点开隐藏
 * dsh 会话」时的做法，已随 `game.htmlGen` 节点一起下线。
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
  /** 游戏名（准备工程时给的名字，缺省按 jobId 兜底）；用于资产卡与游戏资产命名 */
  title?: string
  /** cook 成功后自动登记的 gamePlay 资产 id */
  assetId?: string
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

/**
 * 资产名：给了游戏名就用它；没给则 `<fallback> <jobId 前 8 位>`——
 * fallback 由调用方按语言传入（`defaultAssetName('gamePlay', language)`），
 * 避免共享层写死中文。
 */
export const GAME_PLAY_ASSET_NAME_MAX = 60

export function gamePlayAssetName(
  title: string | undefined,
  jobId: string,
  fallback: string
): string {
  const raw = String(title ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, GAME_PLAY_ASSET_NAME_MAX)
  if (raw) return raw
  const short = String(jobId ?? '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 8)
  const base = String(fallback ?? '').trim()
  return short ? `${base} ${short}`.trim() : base
}

/** 游戏资产的 genParams：工程目录 + 单文件路径 + 模式（`gamePlayHtml` 一律留空，别把整页 HTML 塞进资产） */
export function gamePlayAssetGenParams(input: {
  projectRelativeDir: string
  buildHtmlRelativePath: string
  mode: GamePlayJobMode
}): Record<string, unknown> {
  return {
    gamePlayProjectDir: input.projectRelativeDir,
    gamePlayBuildHtmlPath: input.buildHtmlRelativePath,
    gamePlayHtmlPath: input.buildHtmlRelativePath,
    gamePlayMode: input.mode,
    gamePlayHtml: ''
  }
}

function normalizeProjectDirKey(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase()
}

/**
 * 按工程目录找已登记的 gamePlay 资产：对话里「再改一版」重复 cook 时必须更新既有资产，
 * 否则每轮迭代都会在资产库里多出一条。缺失 / 类型不符一律当没有。
 */
export function findGamePlayAssetByProject<
  T extends { id: string; type?: string; genParams?: Record<string, unknown> | null }
>(assets: readonly T[], projectRelativeDir: string): T | undefined {
  const key = normalizeProjectDirKey(projectRelativeDir)
  if (!key) return undefined
  return assets.find((asset) => {
    if (asset.type && asset.type !== 'gamePlay') return false
    return normalizeProjectDirKey(asset.genParams?.gamePlayProjectDir) === key
  })
}
