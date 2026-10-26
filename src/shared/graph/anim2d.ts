/**
 * 2D 帧动画：外层节点输入一张图，dive 进内图用生图 API 生成序列图（rows×cols），
 * 外层按行列切分并在 inspector 中逐帧播放预览。
 */
import { createNodeFromType } from './create'
import {
  GRAPH_BOUNDARY_INPUT_TYPE_ID,
  GRAPH_BOUNDARY_OUTPUT_TYPE_ID,
  HOST_INTERFACE_FORMAT_VERSION,
  boundaryInputNodeId,
  boundaryOutputNodeId,
  type HostInterfaceDocument
} from './hostInterface'
import { GraphPortType, type GraphDocument, type GraphEdge, type GraphNode } from './types'

export const ANIM2D_MAX_DIM = Number.MAX_SAFE_INTEGER
export const ANIM2D_MIN_DIM = 1

export interface Anim2dState {
  rows: number
  cols: number
}

export const DEFAULT_ANIM2D_STATE: Anim2dState = { rows: 1, cols: 4 }

export interface Anim2dGridPreset {
  id: string
  rows: number
  cols: number
  frames: number
  aspectRatio: '16:9' | '4:3' | '1:1'
}

export const ANIM2D_GRID_PRESETS: readonly Anim2dGridPreset[] = [
  { id: '1x4', rows: 1, cols: 4, frames: 4, aspectRatio: '16:9' },
  { id: '1x6', rows: 1, cols: 6, frames: 6, aspectRatio: '16:9' },
  { id: '1x8', rows: 1, cols: 8, frames: 8, aspectRatio: '16:9' },
  { id: '2x2', rows: 2, cols: 2, frames: 4, aspectRatio: '1:1' },
  { id: '2x3', rows: 2, cols: 3, frames: 6, aspectRatio: '4:3' },
  { id: '2x4', rows: 2, cols: 4, frames: 8, aspectRatio: '16:9' },
  { id: '3x3', rows: 3, cols: 3, frames: 9, aspectRatio: '1:1' },
  { id: '4x4', rows: 4, cols: 4, frames: 16, aspectRatio: '1:1' }
] as const

/**
 * 根据 rows×cols 网格比例自动推算最佳生图画幅（使每个单格接近 1:1 正方比例，防止 1×4/2×4 在 1:1 画布中挤压变形或诱发模型乱分格）。
 */
export function recommendAnimGridAspectRatio(
  rows: number,
  cols: number
): '16:9' | '4:3' | '1:1' | '3:4' | '9:16' {
  const r = Math.max(1, Math.floor(Number(rows) || 1))
  const c = Math.max(1, Math.floor(Number(cols) || 1))
  const ratio = c / r
  if (ratio >= 1.65) return '16:9'
  if (ratio >= 1.25) return '4:3'
  if (ratio <= 1 / 1.65) return '9:16'
  if (ratio <= 1 / 1.25) return '3:4'
  return '1:1'
}

/**
 * 特效/角色序列透明化使用的背景模式：
 * - `''`/`none`：不约束背景；
 * - `'auto'`：切帧时自动采样每格四角背景色并键控抠除（适用纯色/灰底/立绘底）；
 * - `black`：生成/切帧按纯黑背景处理（发光特效最稳，键控时近黑像素转透明）；
 * - `white`：生成/切帧按纯白背景处理（暗色/描边角色适用）。
 */
export type AnimKeyColor = '' | 'black' | 'white' | 'auto'
export const ANIM_KEY_COLOR_DEFAULT: AnimKeyColor = ''

export function normalizeAnimKeyColor(raw: unknown): AnimKeyColor {
  return raw === 'black' || raw === 'white' || raw === 'auto' ? raw : ANIM_KEY_COLOR_DEFAULT
}

export function readAnimKeyColorFromNode(
  params: { animKeyColor?: unknown } | null | undefined
): AnimKeyColor {
  return normalizeAnimKeyColor(params?.animKeyColor)
}

export function animKeyColorToNodePatch(keyColor: unknown): { animKeyColor: AnimKeyColor } {
  return { animKeyColor: normalizeAnimKeyColor(keyColor) }
}

/** 键控容差阈值（5~180，默认 60） */
export const ANIM_KEY_THRESHOLD_DEFAULT = 60

export function normalizeAnimKeyThreshold(raw: unknown): number {
  if (raw === '' || raw === null || raw === undefined) return ANIM_KEY_THRESHOLD_DEFAULT
  const n = Number(raw)
  if (!Number.isFinite(n)) return ANIM_KEY_THRESHOLD_DEFAULT
  return Math.max(5, Math.min(180, Math.round(n)))
}

export function readAnimKeyThresholdFromNode(
  params: { animKeyThreshold?: unknown } | null | undefined
): number {
  return normalizeAnimKeyThreshold(params?.animKeyThreshold)
}

/** 切格边缘内缩（'auto' 或 0~24 px） */
export type AnimEdgeInset = 'auto' | number

export function normalizeAnimEdgeInset(raw: unknown): AnimEdgeInset {
  if (raw === 'auto' || raw === undefined || raw === null || raw === '') return 'auto'
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return 'auto'
  return Math.min(24, Math.round(n))
}

export function readAnimEdgeInsetFromNode(
  params: { animEdgeInset?: unknown } | null | undefined
): AnimEdgeInset {
  return normalizeAnimEdgeInset(params?.animEdgeInset)
}

/** 帧间防抖稳像模式：off=原始切格 / ground=脚底基线对齐 / center=主体质心居中 */
export type AnimStabilizeMode = 'off' | 'ground' | 'center'

export function normalizeAnimStabilizeMode(raw: unknown): AnimStabilizeMode {
  return raw === 'ground' || raw === 'center' ? raw : 'off'
}

export function readAnimStabilizeFromNode(
  params: { animStabilize?: unknown } | null | undefined
): AnimStabilizeMode {
  return normalizeAnimStabilizeMode(params?.animStabilize)
}

/** 播放循环模式：loop=正向循环 / pingpong=往返循环 */
export type AnimPlayMode = 'loop' | 'pingpong'

export function normalizeAnimPlayMode(raw: unknown): AnimPlayMode {
  return raw === 'pingpong' ? 'pingpong' : 'loop'
}

export function readAnimPlayModeFromNode(
  params: { animPlayMode?: unknown } | null | undefined
): AnimPlayMode {
  return normalizeAnimPlayMode(params?.animPlayMode)
}

/** 禁用/跳过的坏帧格子键列表（如 ['1-3']） */
export function normalizeAnimDisabledCells(raw: unknown, rows: number, cols: number): string[] {
  if (!Array.isArray(raw)) return []
  const valid = new Set(anim2dCellKeys(rows, cols))
  const out: string[] = []
  for (const item of raw) {
    const key = String(item ?? '').trim()
    if (valid.has(key) && !out.includes(key)) out.push(key)
  }
  return out
}

export function readAnimDisabledCellsFromNode(
  params: { animDisabledCells?: unknown; animRows?: unknown; animCols?: unknown } | null | undefined
): string[] {
  const s = readAnim2dFromNode(params ?? {})
  return normalizeAnimDisabledCells(params?.animDisabledCells, s.rows, s.cols)
}

/** 逐格停留时长倍率（0.25~8，默认 1；用于攻击蓄力、挥砍加速与命中顿帧 Hit-Stop） */
export type AnimRhythmPresetId = 'uniform' | 'attack-hitstop' | 'jump-arc' | 'charge-burst'

export function normalizeAnimCellHold(raw: unknown): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return 1
  return Math.round(Math.max(0.25, Math.min(8, n)) * 100) / 100
}

export function normalizeAnimCellHolds(
  raw: unknown,
  rows: number,
  cols: number
): Record<string, number> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const valid = new Set(anim2dCellKeys(rows, cols))
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = k.trim()
    if (!valid.has(key)) continue
    const hold = normalizeAnimCellHold(v)
    if (Math.abs(hold - 1) >= 0.01) {
      out[key] = hold
    }
  }
  return out
}

export function readAnimCellHoldsFromNode(
  params: { animCellHolds?: unknown; animRows?: unknown; animCols?: unknown } | null | undefined
): Record<string, number> {
  const s = readAnim2dFromNode(params ?? {})
  return normalizeAnimCellHolds(params?.animCellHolds, s.rows, s.cols)
}

/**
 * 构建专业游戏动作打击感节奏预设（逐格停留倍率）：
 * - uniform: 全帧等长 1x
 * - attack-hitstop: 蓄力预备(1.5x) → 极速挥砍(0.5x) → 命中定格顿帧 Hit-Stop(2.5x) → 收招(1x)
 * - jump-arc: 下蹲蓄力(1.5x) → 起跳爆发(0.5x) → 最高点滞空悬停(2x) → 下落(0.5x) → 落地缓冲(1.5x)
 * - charge-burst: 前半聚气蓄力(2x) → 瞬间爆发释放(0.5x) → 余威定格(2x)
 */
export function buildAnimRhythmPresetHolds(
  presetId: AnimRhythmPresetId,
  cellKeys: readonly string[]
): Record<string, number> {
  const n = cellKeys.length
  if (n === 0 || presetId === 'uniform') return {}
  const out: Record<string, number> = {}
  if (presetId === 'attack-hitstop') {
    cellKeys.forEach((key, i) => {
      if (i === 0) out[key] = 1.5
      else if (i === Math.max(1, Math.floor(n * 0.35))) out[key] = 0.5
      else if (i === Math.min(n - 1, Math.max(1, Math.floor(n * 0.65)))) out[key] = 2.5
    })
  } else if (presetId === 'jump-arc') {
    const apexIdx = Math.floor((n - 1) / 2)
    cellKeys.forEach((key, i) => {
      if (i === 0 || i === n - 1) out[key] = 1.5
      else if (i === apexIdx) out[key] = 2
      else out[key] = 0.5
    })
  } else if (presetId === 'charge-burst') {
    const burstIdx = Math.max(1, Math.floor(n * 0.6))
    cellKeys.forEach((key, i) => {
      if (i < burstIdx) out[key] = 2
      else if (i === burstIdx) out[key] = 0.5
      else if (i === n - 1) out[key] = 2
    })
  }
  return out
}

/** 单帧像素级偏移微调与水平镜像翻转 */
export interface AnimCellOffset {
  dx: number
  dy: number
  flipX?: boolean
}

export function normalizeAnimCellOffsets(
  raw: unknown,
  rows: number,
  cols: number
): Record<string, AnimCellOffset> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const valid = new Set(anim2dCellKeys(rows, cols))
  const out: Record<string, AnimCellOffset> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = k.trim()
    if (!valid.has(key) || !v || typeof v !== 'object') continue
    const item = v as { dx?: unknown; dy?: unknown; flipX?: unknown }
    const dx = Math.max(-256, Math.min(256, Math.round(Number(item.dx) || 0)))
    const dy = Math.max(-256, Math.min(256, Math.round(Number(item.dy) || 0)))
    const flipX = item.flipX === true
    if (dx !== 0 || dy !== 0 || flipX) {
      out[key] = { dx, dy, ...(flipX ? { flipX: true } : {}) }
    }
  }
  return out
}

export function readAnimCellOffsetsFromNode(
  params: { animCellOffsets?: unknown; animRows?: unknown; animCols?: unknown } | null | undefined
): Record<string, AnimCellOffset> {
  const s = readAnim2dFromNode(params ?? {})
  return normalizeAnimCellOffsets(params?.animCellOffsets, s.rows, s.cols)
}

/** 精灵后处理：外轮廓描边色（'' | 'black' | 'white' | 'gold' | 'cyan'） */
export type AnimOutlineColor = '' | 'black' | 'white' | 'gold' | 'cyan'

export function normalizeAnimOutlineColor(raw: unknown): AnimOutlineColor {
  return raw === 'black' || raw === 'white' || raw === 'gold' || raw === 'cyan' ? raw : ''
}

export function readAnimOutlineFromNode(
  params: { animOutline?: unknown } | null | undefined
): AnimOutlineColor {
  return normalizeAnimOutlineColor(params?.animOutline)
}

/** 精灵后处理：真像素网格对齐粒度（0=关闭, 2/3/4/6 px） */
export function normalizeAnimPixelSnap(raw: unknown): number {
  const n = Math.floor(Number(raw) || 0)
  if (!Number.isFinite(n) || n <= 1) return 0
  return Math.min(16, Math.max(2, n))
}

export function readAnimPixelSnapFromNode(
  params: { animPixelSnap?: unknown } | null | undefined
): number {
  return normalizeAnimPixelSnap(params?.animPixelSnap)
}

/** 精灵后处理：脚底接触椭圆阴影开关 */
export function readAnimGroundShadowFromNode(
  params: { animGroundShadow?: unknown } | null | undefined
): boolean {
  return params?.animGroundShadow === true
}

/** 精灵后处理：跨帧调色板锁死与限色量化（0=关闭, 16/32/64=像素索引色, 128=跨帧主色防闪烁锁死） */
export type AnimPaletteLock = 0 | 16 | 32 | 64 | 128

export function normalizeAnimPaletteLock(raw: unknown): AnimPaletteLock {
  const n = Math.floor(Number(raw) || 0)
  if (n === 16 || n === 32 || n === 64 || n === 128) return n
  return 0
}

export function readAnimPaletteLockFromNode(
  params: { animPaletteLock?: unknown } | null | undefined
): AnimPaletteLock {
  return normalizeAnimPaletteLock(params?.animPaletteLock)
}

/** 精灵后处理：动作残影/刀光幻影拖尾（'' | 'cyan' | 'gold' | 'purple' | 'crimson' | 'echo'） */
export type AnimMotionTrail = '' | 'cyan' | 'gold' | 'purple' | 'crimson' | 'echo'

export function normalizeAnimMotionTrail(raw: unknown): AnimMotionTrail {
  return raw === 'cyan' || raw === 'gold' || raw === 'purple' || raw === 'crimson' || raw === 'echo'
    ? raw
    : ''
}

export function readAnimMotionTrailFromNode(
  params: { animMotionTrail?: unknown } | null | undefined
): AnimMotionTrail {
  return normalizeAnimMotionTrail(params?.animMotionTrail)
}

/** 精灵后处理：首尾循环无缝平滑闭合开关 */
export function readAnimLoopBlendFromNode(
  params: { animLoopBlend?: unknown } | null | undefined
): boolean {
  return params?.animLoopBlend === true
}

/** 视角锁定与画风锁定（用于 frame.animGen 提示词增强） */
export type AnimViewAngle = '' | 'side' | 'iso' | 'front' | 'top'
export type AnimStyleLock = '' | 'cel' | 'pixel' | 'hd2d' | 'vfx'

export function normalizeAnimViewAngle(raw: unknown): AnimViewAngle {
  return raw === 'side' || raw === 'iso' || raw === 'front' || raw === 'top' ? raw : ''
}

export function readAnimViewAngleFromNode(
  params: { animViewAngle?: unknown } | null | undefined
): AnimViewAngle {
  return normalizeAnimViewAngle(params?.animViewAngle)
}

export function normalizeAnimStyleLock(raw: unknown): AnimStyleLock {
  return raw === 'cel' || raw === 'pixel' || raw === 'hd2d' || raw === 'vfx' ? raw : ''
}

/**
 * 序列图生成模式（解决纯提示词生图不可控问题）：
 * - 'auto'：根据入边自动判别
 * - 'video-sheet'：视频直接均匀抽帧 + 抠底去白边 + 原地脚底稳像 → 拼合序列图
 * - 'video-restyle'：视频抽帧拼成动作参考表 + 角色设定图 → AI 姿态锁定重绘
 * - 'frames-sheet'：多张散帧（如逐帧拉片 video.framePull 输出）直接对齐拼合序列图
 * - 'ai-sheet'：单张角色图 + 动作提示词 AI 生成序列图
 */
export type AnimGenMode = 'auto' | 'video-sheet' | 'video-restyle' | 'frames-sheet' | 'ai-sheet'

export function normalizeAnimGenMode(raw: unknown): AnimGenMode {
  return raw === 'video-sheet' ||
    raw === 'video-restyle' ||
    raw === 'frames-sheet' ||
    raw === 'ai-sheet'
    ? raw
    : 'auto'
}

export function readAnimGenModeFromNode(
  params: { animGenMode?: unknown } | null | undefined
): AnimGenMode {
  return normalizeAnimGenMode(params?.animGenMode)
}

export interface AnimVideoRange {
  startRatio: number
  endRatio: number
}

export function normalizeAnimVideoRange(startRaw: unknown, endRaw: unknown): AnimVideoRange {
  const sNum =
    startRaw === '' || startRaw === null || startRaw === undefined ? NaN : Number(startRaw)
  const eNum = endRaw === '' || endRaw === null || endRaw === undefined ? NaN : Number(endRaw)
  const startRatio = Number.isFinite(sNum)
    ? Math.round(Math.max(0, Math.min(0.95, sNum)) * 100) / 100
    : 0
  const endCandidate = Number.isFinite(eNum)
    ? Math.round(Math.max(0.05, Math.min(1, eNum)) * 100) / 100
    : 1
  const endRatio = Math.max(Math.min(1, Math.round((startRatio + 0.05) * 100) / 100), endCandidate)
  return { startRatio, endRatio }
}

export function readAnimVideoRangeFromNode(
  params: { animVideoStartRatio?: unknown; animVideoEndRatio?: unknown } | null | undefined
): AnimVideoRange {
  return normalizeAnimVideoRange(params?.animVideoStartRatio, params?.animVideoEndRatio)
}

/**
 * 计算视频在 [startRatio, endRatio] 区间内均匀抽取 `count` 帧的时间戳（秒）。
 * 留出微小的尾部安全余量（避免恰好 seek 到 duration EOF 导致黑帧）。
 */
export function computeVideoFrameTimestamps(
  durationSec: number,
  count: number,
  range?: Partial<AnimVideoRange> | null
): number[] {
  const dur = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 0
  const n = Math.max(1, Math.floor(count) || 1)
  if (dur <= 0) return [0]
  const { startRatio, endRatio } = normalizeAnimVideoRange(range?.startRatio, range?.endRatio)
  const safeMax = Math.max(0, dur - 0.04)
  const tStart = Math.min(safeMax, dur * startRatio)
  const tEnd = Math.min(safeMax, Math.max(tStart, dur * endRatio))
  if (n === 1) {
    return [Math.round(((tStart + tEnd) / 2) * 1000) / 1000]
  }
  const span = Math.max(0, tEnd - tStart)
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const t = tStart + (span * i) / (n - 1)
    out.push(Math.round(t * 1000) / 1000)
  }
  return out
}

/**
 * 视频姿态引导 AI 重绘指令：
 * 图 1 为角色外观设定图，最后一张参考图为从动作视频抽取的 rows×cols 帧姿态网格参考表。
 */
export function buildAnimVideoRestyleInstruction(
  rows: number,
  cols: number,
  locale?: string
): string {
  const r = Math.max(1, Math.floor(rows))
  const c = Math.max(1, Math.floor(cols))
  const total = r * c
  if (locale?.startsWith('en')) {
    return `IMPORTANT POSE-GUIDED RESTYLE: The first reference image defines the character's exact appearance, outfit, proportions, and art style. The last reference image is a ${r}×${c} (${total}-frame) motion contact sheet extracted from a reference video. Redraw the ${r}×${c} grid so that every cell (1 to ${total}, left-to-right, top-to-bottom) strictly replicates the exact body pose, limb angle, and timing of the corresponding cell in the motion contact sheet, while 100% preserving the character identity and art style from the first reference image. Do NOT draw any frame numbers or grid borders in the output.`
  }
  return `【视频姿态引导严格重绘】第 1 张参考图定义角色的精确外观、服饰、头身比与画风；最后一张参考图是从动作视频抽取的 ${r}×${c}（共 ${total} 帧）动作姿态分格参考表。请严格对照该动作姿态表的每一格（从左到右、从上到下第 1 至第 ${total} 格），1:1 复刻对应格子的肢体姿态、重心与动作相位，同时将人物 100% 替换为第 1 张参考图的角色形象与画风。输出画面禁止包含任何编号文字或分格线。` // cjk-ok
}

export function readAnimStyleLockFromNode(
  params: { animStyleLock?: unknown } | null | undefined
): AnimStyleLock {
  return normalizeAnimStyleLock(params?.animStyleLock)
}

export function buildAnimViewStylePrompt(
  viewAngle: AnimViewAngle,
  styleLock: AnimStyleLock,
  locale?: string
): string {
  const view = normalizeAnimViewAngle(viewAngle)
  const style = normalizeAnimStyleLock(styleLock)
  const isEn = Boolean(locale?.startsWith('en'))
  const parts: string[] = []

  if (view === 'side') {
    parts.push(
      isEn
        ? 'Camera angle lock: strict 2D side-scroller profile view (orthographic horizontal view), consistent ground line across all cells.'
        : '视角锁定：严格 2D 横版正侧视（正交平视视角），所有格子的角色脚底处于同一水平地面基线，禁止视角偏转或透视畸变。' // cjk-ok：AI 提示域数据，与 en 分支成对
    )
  } else if (view === 'iso') {
    parts.push(
      isEn
        ? 'Camera angle lock: strict 2.5D isometric 45-degree top-down game view, consistent camera elevation across all cells.'
        : '视角锁定：严格 2.5D 斜 45° 等轴测俯视角（ARPG 游戏视角），所有格子保持完全一致的俯仰角与脚底站位。' // cjk-ok：AI 提示域数据，与 en 分支成对
    )
  } else if (view === 'front') {
    parts.push(
      isEn
        ? 'Camera angle lock: strict orthographic front-facing view, consistent character scale and foot baseline across all cells.'
        : '视角锁定：严格正面平视立绘视角，所有格子保持统一人物比例与脚底水平基线。' // cjk-ok：AI 提示域数据，与 en 分支成对
    )
  } else if (view === 'top') {
    parts.push(
      isEn
        ? 'Camera angle lock: strict 90-degree top-down overhead view, centered pivot in every cell.'
        : '视角锁定：严格 90° 垂直俯视视角，每格主体以格子中心为枢轴对齐。' // cjk-ok：AI 提示域数据，与 en 分支成对
    )
  }

  if (style === 'cel') {
    parts.push(
      isEn
        ? 'Art style lock: clean 2D anime cel-shaded game sprite style (Spine 2D / Arc System Works quality), crisp lineart, flat clean color blocks, distinct silhouette.'
        : '画风锁定：标准 2D 游戏赛璐璐立绘风（Spine 2D 精品动作游戏质感），线条干净锐利、色块分明、外轮廓清晰。' // cjk-ok：AI 提示域数据，与 en 分支成对
    )
  } else if (style === 'pixel') {
    parts.push(
      isEn
        ? 'Art style lock: authentic 16-bit / 32-bit pixel art sprite sheet, crisp pixel edges, consistent pixel grid scale, no blurry anti-aliasing.'
        : '画风锁定：正统 16-bit / 32-bit 像素艺术（Pixel Art）精灵表，像素颗粒清晰统一，边缘硬朗无模糊抗锯齿。' // cjk-ok：AI 提示域数据，与 en 分支成对
    )
  } else if (style === 'hd2d') {
    parts.push(
      isEn
        ? 'Art style lock: rich HD-2D painted game sprite (Vanillaware / Octopath style), detailed shading, dramatic rim light, clean outer boundary.'
        : '画风锁定：精品 HD-2D 手绘厚涂游戏精灵风格（香草社质感），体积光影丰富，外轮廓干净利落。' // cjk-ok：AI 提示域数据，与 en 分支成对
    )
  } else if (style === 'vfx') {
    parts.push(
      isEn
        ? 'Art style lock: pure 2D game VFX sequence sheet, high-contrast energy/particles, no character body, self-contained within each cell.'
        : '画风锁定：纯 2D 游戏特效序列帧（VFX Sprite Sheet），高对比能量流光与粒子，不含人物本体，特效光晕完整收在各自格子内不裁边。' // cjk-ok：AI 提示域数据，与 en 分支成对
    )
  }

  return parts.join('\n')
}

/** GIF 输出端口 id（2D帧动画运行后按帧率合成动图的产物） */
export const ANIM2D_GIF_OUT_PORT_ID = 'out-gif'
/** GIF 帧率关闭值：0 表示只切帧、不合成 GIF */
export const ANIM2D_GIF_FPS_OFF = 0
/** 默认关闭：GIF 编码耗时随帧数与体积增长，按需开启 */
export const ANIM2D_GIF_FPS_DEFAULT = ANIM2D_GIF_FPS_OFF
export const ANIM2D_GIF_FPS_MAX = 24

/** 帧率归一化：非数字 / ≤0 → 0（关闭）；超过上限截断到 ANIM2D_GIF_FPS_MAX */
export function normalizeAnimGifFps(raw: unknown): number {
  const v = Math.floor(Number(raw))
  if (!Number.isFinite(v) || v <= ANIM2D_GIF_FPS_OFF) return ANIM2D_GIF_FPS_OFF
  return Math.min(ANIM2D_GIF_FPS_MAX, v)
}

export function readAnimGifFpsFromNode(
  params: { animGifFps?: unknown } | null | undefined
): number {
  return normalizeAnimGifFps(params?.animGifFps)
}

export function animGifFpsToNodePatch(fps: unknown): { animGifFps: number } {
  return { animGifFps: normalizeAnimGifFps(fps) }
}

/** 生成侧背景约束句子：序列图整底为纯黑/纯白，便于切帧键控透明 */
export function buildAnimKeyColorPrompt(keyColor: AnimKeyColor, locale?: string): string {
  const mode = normalizeAnimKeyColor(keyColor)
  if (!mode) return ''
  if (locale?.startsWith('en')) {
    if (mode === 'auto') {
      return 'The background of the entire sequence image must be a uniform, flat solid contrasting color with zero gradients, shadows, ground lines, or props, so the subject can be cleanly keyed out.'
    }
    return mode === 'black'
      ? 'The background of the entire sequence image must be solid pure black (#000000): no scene, ground, environment lighting, props, text or framing; only the glowing effect or sprite itself, with clear boundaries between the subject and the background.'
      : 'The background of the entire sequence image must be solid pure white (#FFFFFF): no scene, ground, environment lighting, props, text or framing; only the sprite itself, with clear boundaries between the subject and the background.'
  }
  if (mode === 'auto') {
    return '整张序列图背景必须为均匀单一的高对比纯色底（无渐变、无地面阴影、无场景杂物），便于自动取样抠除背景。' // cjk-ok：AI 提示域数据，与 en 分支成对
  }
  return mode === 'black'
    ? '整张序列图背景必须为纯黑色（#000000）：不要任何场景、地面、环境光照、道具、文字或画框；只保留特效或主体本身与发光，主体与背景边界清晰。' // cjk-ok：AI 提示域数据，与 en 分支成对
    : '整张序列图背景必须为纯白色（#FFFFFF）：不要任何场景、地面、环境光照、道具、文字或画框；只保留角色或特效本体，主体与背景边界清晰。' // cjk-ok：AI 提示域数据，与 en 分支成对
}

function clampDim(n: unknown): number {
  const v = Math.floor(Number(n))
  if (!Number.isFinite(v)) return 4
  return Math.max(ANIM2D_MIN_DIM, v)
}

export function normalizeAnim2dState(raw?: Partial<Anim2dState> | null): Anim2dState {
  const base = { ...DEFAULT_ANIM2D_STATE, ...(raw ?? {}) }
  return { rows: clampDim(base.rows), cols: clampDim(base.cols) }
}

export function readAnim2dFromNode(params: {
  animRows?: unknown
  animCols?: unknown
}): Anim2dState {
  return normalizeAnim2dState({ rows: Number(params.animRows), cols: Number(params.animCols) })
}

export function anim2dToNodePatch(state: Anim2dState): { animRows: number; animCols: number } {
  const s = normalizeAnim2dState(state)
  return { animRows: s.rows, animCols: s.cols }
}

/** 行优先帧序的格子键（"1-1"、"1-2" …） */
export function anim2dCellKeys(rows: number, cols: number): string[] {
  const s = normalizeAnim2dState({ rows, cols })
  const out: string[] = []
  for (let r = 1; r <= s.rows; r += 1) {
    for (let c = 1; c <= s.cols; c += 1) {
      out.push(`${r}-${c}`)
    }
  }
  return out
}

/** 动画/资产序列预设：动作/朝向/差分/瓦片描述会叠加「按 rows×cols 分格排版」指令 */
export type Anim2dPresetCategory =
  'locomotion' | 'combat' | 'vfx' | 'turnaround' | 'expression' | 'tile'

export interface Anim2dPreset {
  id: string
  labelKey: string
  category?: Anim2dPresetCategory
  recommendedGrid?: { rows: number; cols: number; aspectRatio: string }
  prompt: string
  promptEn: string
}

export const ANIM2D_PRESETS: readonly Anim2dPreset[] = [
  {
    id: 'idle',
    labelKey: 'idle',
    category: 'locomotion',
    prompt:
      '角色原地待机呼吸循环：身体轻微上下起伏，头发与衣摆自然飘动，表情平静，双脚站位稳固不漂移', // cjk-ok
    promptEn:
      'Idle breathing loop: subtle body bob, hair and clothes sway naturally, calm expression, feet planted firmly without drift'
  },
  {
    id: 'walk',
    labelKey: 'walk',
    category: 'locomotion',
    prompt:
      '角色侧面行走循环：双腿交替迈步（接触→跨步→蹬地→收腿），手臂自然反向摆动，包含一个完整闭环步态周期', // cjk-ok
    promptEn:
      'Side walk cycle loop: alternating legs (contact, pass, push-off, swing), natural counter arm swing, one complete seamless gait cycle'
  },
  {
    id: 'run',
    labelKey: 'run',
    category: 'locomotion',
    prompt: '角色奔跑循环：身体前倾，双臂屈肘有力摆动，双腿交替大步腾空跨跃，节奏明快，动态张力强', // cjk-ok
    promptEn:
      'Run cycle loop: leaning forward, bent arms pumping, long alternating airborne strides, fast rhythm, strong dynamic motion'
  },
  {
    id: 'jump',
    labelKey: 'jump',
    category: 'locomotion',
    prompt:
      '角色跳跃动作序列：依次为下蹲蓄力、蹬地起跳腾空、空中最高点舒展、加速下落、落地屈膝缓冲', // cjk-ok
    promptEn:
      'Jump sequence: crouch anticipation, takeoff launch, airborne apex, fast descent, landing knee-bend recovery'
  },
  {
    id: 'dash',
    labelKey: 'dash',
    category: 'locomotion',
    prompt: '角色高速冲刺闪避序列：压低重心瞬间爆发突进、残影疾行、急停稳住身形，速度感强烈', // cjk-ok
    promptEn:
      'High-speed dash evade sequence: low crouch burst, rapid forward lunge with motion trail, sharp braking recovery'
  },
  {
    id: 'attack',
    labelKey: 'attack',
    category: 'combat',
    prompt:
      '角色近战挥击序列：依次为引手蓄力预备、大幅度挥砍弧光、命中定格发力、收招归位，动作干脆有力', // cjk-ok
    promptEn:
      'Melee attack sequence: windup anticipation, wide slash arc, impact hit-stop, clean recovery to stance'
  },
  {
    id: 'combo',
    labelKey: 'combo',
    category: 'combat',
    prompt: '角色多段连击序列：第一击横斩、顺势转身第二击上挑、腾空终结重劈、收刃落地，连贯流畅', // cjk-ok
    promptEn:
      'Multi-hit combo sequence: horizontal slash, spinning upward cleave, leaping finisher strike, landing recovery'
  },
  {
    id: 'hurt',
    labelKey: 'hurt',
    category: 'combat',
    prompt: '角色受击反馈序列：受冲击身体后仰硬直、咬牙痛苦表情、重心后退卸力、重新稳住站姿', // cjk-ok
    promptEn:
      'Hit reaction sequence: sharp torso recoil on impact, pained expression, stagger step back, recover to combat stance'
  },
  {
    id: 'skill',
    labelKey: 'skill',
    category: 'combat',
    prompt:
      '角色施放必杀技序列：双手聚气蓄力、周身气场爆发、向前推出高能冲击、收势定格，附带能量特效', // cjk-ok
    promptEn:
      'Ultimate skill cast sequence: two-handed energy charge, aura burst, forward power release, heroic recovery pose'
  },
  {
    id: 'death',
    labelKey: 'death',
    category: 'combat',
    prompt: '角色力竭倒地序列：受重创失去平衡、双膝跪地、身体向前倾倒、完全倒地静止', // cjk-ok
    promptEn:
      'Defeat collapse sequence: staggering off-balance, dropping to knees, falling forward, lying motionless on ground'
  },
  {
    id: 'vfxSlash',
    labelKey: 'vfxSlash',
    category: 'vfx',
    prompt:
      '纯2D游戏刀光剑气特效序列（无人物）：从剑芒初现、新月形能量刀弧爆发、流光撕裂扩散、到残光粒子消散', // cjk-ok
    promptEn:
      'Pure 2D game sword slash VFX sequence (no character): initial spark, crescent energy blade arc burst, light trail expansion, particle dissipation'
  },
  {
    id: 'vfxExplosion',
    labelKey: 'vfxExplosion',
    category: 'vfx',
    prompt:
      '纯2D游戏爆炸冲击波特效序列（无人物）：核心闪光点、烈焰火球急速膨胀、环形冲击波扩散、浓烟与火星消散', // cjk-ok
    promptEn:
      'Pure 2D game explosion VFX sequence (no character): core flashignition, rapid fireball expansion, shockwave ring, smoke and ember dissipation'
  },
  {
    id: 'vfxAura',
    labelKey: 'vfxAura',
    category: 'vfx',
    prompt:
      '纯2D游戏能量光环循环特效序列（无人物）：底部魔法阵亮起、螺旋能量柱升腾、闪电粒子环绕跳动、光效循环脉动', // cjk-ok
    promptEn:
      'Pure 2D game aura loop VFX sequence (no character): glowing magic rune base, rising spiral energy pillar, crackling lightning particles, pulsing loop'
  },
  {
    id: 'dir4',
    labelKey: 'dir4',
    category: 'turnaround',
    recommendedGrid: { rows: 1, cols: 4, aspectRatio: '16:9' },
    prompt:
      '角色4方向正交标准站姿图（依次为：正前朝下、正左朝左、正右朝右、正后朝上）：四格角色头身比、身高与脚底水平基线严格一致，正交无透视畸变', // cjk-ok
    promptEn:
      '4-direction orthographic character turnaround idle sheet (front/down, left profile, right profile, back/up): identical head-to-body ratio, height, and foot ground baseline across all 4 cells'
  },
  {
    id: 'dir8',
    labelKey: 'dir8',
    category: 'turnaround',
    recommendedGrid: { rows: 2, cols: 4, aspectRatio: '16:9' },
    prompt:
      '角色8方向2.5D等距标准站姿图（依次为：正南、西南、正西、西北、正北、东北、正东、东南）：八格角色比例、服饰细节与脚底基线严格对齐', // cjk-ok
    promptEn:
      '8-direction isometric character turnaround sheet (S, SW, W, NW, N, NE, E, SE): identical proportions, costume details, and foot ground baseline across all 8 cells'
  },
  {
    id: 'walk4Dir',
    labelKey: 'walk4Dir',
    category: 'turnaround',
    recommendedGrid: { rows: 4, cols: 4, aspectRatio: '1:1' },
    prompt:
      '2D俯视角RPG角色4方向行走矩阵（4行×4列共16格：第1行正面朝下行走4帧、第2行朝左行走4帧、第3行朝右行走4帧、第4行背面朝上行走4帧）：每格角色体型与脚底基线完全一致', // cjk-ok
    promptEn:
      'Top-down RPG 4-direction walk cycle matrix (4 rows × 4 columns = 16 cells: Row 1 walk down 4 frames, Row 2 walk left 4 frames, Row 3 walk right 4 frames, Row 4 walk up 4 frames): consistent character scale and foot baseline'
  },
  {
    id: 'expr6',
    labelKey: 'expr6',
    category: 'expression',
    recommendedGrid: { rows: 2, cols: 3, aspectRatio: '3:2' },
    prompt:
      'AVG角色立绘6格表情差分（依次为：平静默认、开心微笑、愤怒咬牙、悲伤落泪、惊讶瞪眼、害羞脸红）：每格头部角度、发型轮廓、肩部衣领位置100%固定不动，仅五官神态变化', // cjk-ok
    promptEn:
      '6-cell visual novel character expression sheet (neutral, happy smile, angry grit, sad tearful, surprised wide-eyed, shy blush): head angle, hair silhouette, and shoulder/collar position 100% locked across cells, only facial features change'
  },
  {
    id: 'lipSync4',
    labelKey: 'lipSync4',
    category: 'expression',
    recommendedGrid: { rows: 2, cols: 2, aspectRatio: '1:1' },
    prompt:
      '角色对话口型与眨眼4格差分（依次为：睁眼闭嘴默认、睁眼半张嘴说话、睁眼大张嘴元音、闭眼微笑）：头部与身体轮廓严格锁定，用于2D口型与眨眼切换', // cjk-ok
    promptEn:
      '4-cell character lip-sync and blink expression sheet (eyes open mouth closed, eyes open mouth half-open, eyes open mouth wide-open, eyes closed gentle smile): head and body silhouette strictly locked'
  },
  {
    id: 'tileSeamless',
    labelKey: 'tileSeamless',
    category: 'tile',
    recommendedGrid: { rows: 2, cols: 2, aspectRatio: '1:1' },
    prompt:
      '2D游戏正交顶视无缝地砖材质变体集（2×2共4块同材质地砖变体，边缘色彩与纹理自然过渡，无透视阴影，铺满整格无留边）', // cjk-ok
    promptEn:
      '2D game orthographic top-down seamless terrain tile variants (2×2 grid of 4 matching surface tile variations, flat even lighting, edge-to-edge fill with zero borders)'
  },
  {
    id: 'autotile3x3',
    labelKey: 'autotile3x3',
    category: 'tile',
    recommendedGrid: { rows: 3, cols: 3, aspectRatio: '1:1' },
    prompt:
      '2D游戏3×3九宫格地形瓦片集（Auto-Tile / Nine-Slice：左上外角、上边缘、右上外角、左边缘、中心实心填充、右边缘、左下外角、下边缘、右下外角，严格正交顶视或横版平台块）', // cjk-ok
    promptEn:
      '2D game 3×3 nine-slice auto-tile terrain sheet (top-left corner, top edge, top-right corner, left edge, center fill, right edge, bottom-left corner, bottom edge, bottom-right corner, strictly orthographic)'
  }
] as const

export function resolveAnim2dPreset(id: string | undefined): Anim2dPreset | undefined {
  if (!id) return undefined
  return ANIM2D_PRESETS.find((p) => p.id === id)
}

const FRAME_ANIM_SYSTEM_PROMPT_ZH = [
  '你是 AIArtEngine 的 2D 帧动画序列图专家。', // cjk-ok
  '请把动作描述绘制成一张严格分格的序列图：', // cjk-ok
  '- 整张图横向分为 N 列、纵向分为 M 行，共 N×M 个等大格子，无缝紧贴拼接；', // cjk-ok
  '- 格与格之间禁止黑边、白边、分隔线、描边或空隙；每格内容必须铺满自己的格子，格子边界即画面边界，不得内缩留边；', // cjk-ok
  '- 帧序固定为从左到右、从上到下依次为该动作的连续帧；', // cjk-ok
  '- 同一角色/主体在所有格子中保持外观、体型、配色与画风完全一致，仅动作与姿态变化；', // cjk-ok
  '- 每一格中的角色脚底必须对齐该格同一相对高度的地面基线，水平居中于格子中心，严禁跨格漂移或忽大忽小；', // cjk-ok
  '- 动作连贯、每帧之间过渡自然，符合该动作的运动规律；', // cjk-ok
  '- 只输出序列图本身：不加外框、说明文字、序号、水印或多余装饰。' // cjk-ok
].join('\n')

const FRAME_ANIM_SYSTEM_PROMPT_EN = `You are an expert in 2D frame-animation sprite sheets for AIArtEngine.
Turn the action description into a strictly tiled sequence image:
- The image is divided into N columns and M rows, N×M equal cells, seamless edge-to-edge tiling;
- No black/white gutters, borders, outlines or gaps between cells; each frame must fill its cell completely (cell edge = image edge, no inset padding);
- Frame order is fixed: left to right, then top to bottom, as consecutive frames of the action;
- The same character/subject keeps identical look, proportions, palette and art style in every cell, only pose changes;
- In every cell, the character's feet must rest on the exact same relative horizontal ground baseline and stay horizontally centered within the cell, with zero scale or position drift;
- Motion is fluid and each frame transitions naturally per the action's movement rules;
- Output only the sequence image itself: no outer frame, captions, numbers, watermarks or extra decoration.`

export function resolveFrameAnimGenSystemPrompt(override?: string | null, locale?: string): string {
  if (typeof override === 'string' && override.trim()) return override.trim()
  return locale?.startsWith('en') ? FRAME_ANIM_SYSTEM_PROMPT_EN : FRAME_ANIM_SYSTEM_PROMPT_ZH
}

/** 帧数描述 → 序列图排版指令（追加在动作描述后） */
export function buildAnim2dGridInstruction(rows: number, cols: number, locale?: string): string {
  const r = Math.max(1, Math.floor(rows))
  const c = Math.max(1, Math.floor(cols))
  const total = r * c
  if (locale?.startsWith('en')) {
    return `Draw this as a single sequence image of ${total} frames arranged in a ${r}×${c} grid (${c} columns, ${r} rows), frame order left to right then top to bottom; seamless tiling with no gutters/borders between cells; each frame fills its cell edge-to-edge; keep the character identical in scale and foot baseline across all frames.`
  }
  return `将上述动作绘制成一张 ${total} 帧的序列图：横向 ${c} 列、纵向 ${r} 行，共 ${r}×${c} 个等大的格子；帧序从左到右、从上到下；格子无缝拼接，禁止格间黑边/白边/分隔线；每格内容铺满格子；所有格子中的角色保持外观、比例与脚底水平基线完全一致，仅动作不同。` // cjk-ok
}

/** dive 内图结构版本：结构变化时递增，使已存在的内图资产按新结构重建 */
export const ANIM2D_INNER_GRAPH_VERSION = 1

export const ANIM2D_HOST_INPUT_PORT_ID = 'in-image'
export const ANIM2D_HOST_OUTPUT_PORT_ID = 'out-image'

export function buildAnim2dHostInterface(): HostInterfaceDocument {
  return {
    version: HOST_INTERFACE_FORMAT_VERSION,
    inputs: [
      {
        id: ANIM2D_HOST_INPUT_PORT_ID,
        label: '参考图',
        dataType: GraphPortType.image,
        multiple: false
      }
    ],
    outputs: [
      {
        id: ANIM2D_HOST_OUTPUT_PORT_ID,
        label: '序列图',
        dataType: GraphPortType.image,
        multiple: false
      }
    ]
  }
}

/**
 * 构建 2D 帧动画的 dive 内图：
 * 参考图输入边界 → 生成帧动画序列图（frame.animGen）→ 序列图输出边界。
 * rows/cols/预设动作烘焙进 frame.animGen 节点参数，dive 后仍可编辑。
 */
export function buildAnim2dInnerGraph(
  state: Anim2dState,
  presetId: string,
  instruction: string,
  locale?: string
): GraphDocument {
  const s = normalizeAnim2dState(state)
  const preset = resolveAnim2dPreset(presetId)
  const inId = boundaryInputNodeId(ANIM2D_HOST_INPUT_PORT_ID)
  const genId = 'anim-gen-1'
  const outId = boundaryOutputNodeId(ANIM2D_HOST_OUTPUT_PORT_ID)

  const nodes: GraphNode[] = [
    {
      id: inId,
      typeId: GRAPH_BOUNDARY_INPUT_TYPE_ID,
      category: 'note',
      position: { x: 40, y: 80 },
      title: '参考图',
      params: {
        previewCollapsed: true,
        hostBoundaryPort: {
          portId: ANIM2D_HOST_INPUT_PORT_ID,
          dataType: GraphPortType.image,
          multiple: false
        }
      }
    },
    createNodeFromType(
      'frame.animGen',
      { x: 280, y: 80 },
      {
        id: genId,
        title: '生成帧动画序列图',
        params: {
          animRows: s.rows,
          animCols: s.cols,
          animPresetId: presetId,
          generateInstruction: instruction.trim() || preset?.prompt || '',
          generateSystemPrompt: resolveFrameAnimGenSystemPrompt(undefined, locale)
        }
      }
    ),
    {
      id: outId,
      typeId: GRAPH_BOUNDARY_OUTPUT_TYPE_ID,
      category: 'note',
      position: { x: 520, y: 80 },
      title: '序列图',
      params: {
        previewCollapsed: true,
        hostBoundaryPort: {
          portId: ANIM2D_HOST_OUTPUT_PORT_ID,
          dataType: GraphPortType.image,
          multiple: false
        }
      }
    }
  ]

  const edges: GraphEdge[] = [
    {
      id: 'anim-e-in',
      source: inId,
      target: genId,
      sourcePort: 'out',
      targetPort: 'in'
    },
    {
      id: 'anim-e-out',
      source: genId,
      target: outId,
      sourcePort: 'out',
      targetPort: 'in'
    }
  ]

  return { nodes, edges, groups: [], viewport: { x: 0, y: 0, zoom: 1 } }
}
