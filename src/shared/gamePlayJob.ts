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
  /** 试玩门禁结论：隐藏窗口真跑几秒后的「未捕获异常 / 黑屏 / 画面静止」体检报告 */
  smoke?: GamePlaySmokeReport
  updatedAt: string
}

/**
 * 试玩门禁（阶段 3）：把 cook 出来的单文件在隐藏窗口里真跑几秒，抓三类问题——
 * 未捕获异常 / 加载失败、黑屏、画面静止（rAF 卡死或只渲染了一帧）。
 *
 * 不做自动修复：报告回给 agent，由它决定要不要改一轮（避免我们在后台替用户烧轮次）。
 */
export type GamePlaySmokeStatus = 'pass' | 'warn' | 'fail'

/** 一帧采样的统计量：亮度均值 + 采样指纹（用于判断画面是否真的在动） */
export interface GamePlaySmokeSample {
  meanLuma: number
  hash: string
  pixels: number
}

export interface GamePlaySmokeReport {
  status: GamePlaySmokeStatus
  ok: boolean
  /** 硬问题：未捕获异常 / 加载失败 / 渲染进程崩溃 / 黑屏 / 一帧都采不到 */
  errors: string[]
  /** 软问题：画面静止、截不到图之类，需要人（或 agent）判断 */
  warnings: string[]
  metrics: {
    /** 成功采到的帧数 */
    frames: number
    /** 指纹去重后的帧数：1 表示画面从头到尾没变 */
    distinctFrames: number
    minLuma: number
    maxLuma: number
    averageLuma: number
    durationMs: number
  }
  htmlRelativePath: string
  checkedAt: string
}

/** 判黑屏的亮度阈值（0–255，采样点均值）：低于它按「整屏黑」处理 */
export const GAME_PLAY_SMOKE_BLACK_LUMA = 8

/**
 * 纯判定：把采样与错误清单折成结论（Electron 那部分单独在 main 里做，便于单测）。
 *
 * 判定顺序刻意如此：先看硬错误 → 再看有没有采到帧 → 再看是不是整屏黑 → 最后才看静止。
 * 「静止」只算 warn：等输入的回合制游戏本来就可能几秒不动，交给人判断。
 */
export function evaluateGamePlaySmoke(input: {
  errors: readonly string[]
  warnings: readonly string[]
  samples: readonly GamePlaySmokeSample[]
  durationMs: number
  htmlRelativePath: string
  checkedAt?: string
}): GamePlaySmokeReport {
  const errors = [...new Set(input.errors.map((item) => item.trim()).filter(Boolean))]
  const warnings = [...new Set(input.warnings.map((item) => item.trim()).filter(Boolean))]
  const samples = input.samples.filter((sample) => sample.pixels > 0)
  const lumas = samples.map((sample) => sample.meanLuma)
  const metrics = {
    frames: samples.length,
    distinctFrames: new Set(samples.map((sample) => sample.hash)).size,
    minLuma: lumas.length ? Math.min(...lumas) : 0,
    maxLuma: lumas.length ? Math.max(...lumas) : 0,
    averageLuma: lumas.length ? lumas.reduce((sum, value) => sum + value, 0) / lumas.length : 0,
    durationMs: input.durationMs
  }

  if (samples.length === 0) {
    errors.push('一帧都没采到：游戏可能没有真正渲染（检查主循环、canvas 尺寸与 WebGL 上下文创建）')
  } else if (metrics.maxLuma <= GAME_PLAY_SMOKE_BLACK_LUMA) {
    errors.push(
      `整屏黑（采样最亮一帧的平均亮度 ${metrics.maxLuma.toFixed(1)} ≤ ${GAME_PLAY_SMOKE_BLACK_LUMA}）：相机 / 灯光 / 背景色或首帧渲染有问题`
    )
  } else if (metrics.frames > 1 && metrics.distinctFrames === 1) {
    warnings.push(
      `画面静止（${metrics.frames} 帧指纹完全相同）：rAF 主循环可能已停，或渲染只跑了一帧——若游戏本来就等待输入可忽略`
    )
  }

  return {
    status: errors.length ? 'fail' : warnings.length ? 'warn' : 'pass',
    ok: errors.length === 0,
    errors,
    warnings,
    metrics,
    htmlRelativePath: input.htmlRelativePath,
    checkedAt: input.checkedAt ?? new Date().toISOString()
  }
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
