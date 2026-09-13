/**
 * SVG 烘焙节点（`svg.anim`）：把矢量源（SVG 生成节点 / 图库 SVG 资产）按动效时间轴逐帧烘焙成位图，
 * 并在帧率/时长就绪时合成 GIF 动图。
 *
 * 与 `anim2d.ts` 的分工一致：本文件只放常量、参数归一化与读写映射，
 * 执行器在 `execute/svgAnim.ts`，DOM 侧的烘焙与栅格化在渲染层
 * （`features/graph/model/renderSvgFrames.ts`），GIF 编码复用 `media/gifEncode`。
 */
import type { GraphNodeParams } from './types'

/** GIF 输出端口 id（运行后产出的动图） */
export const SVG_ANIM_GIF_OUT_PORT_ID = 'out-gif'
/** 帧数：决定采样密度（GIF 帧数即此值） */
export const SVG_ANIM_FRAMES_DEFAULT = 12
export const SVG_ANIM_FRAMES_MIN = 2
export const SVG_ANIM_FRAMES_MAX = 60
/** 单帧尺寸上限（GIF 合成时还会按 TARGET_FRAME_MAX 再缩放） */
export const SVG_ANIM_SIZE_MAX = 1024
/** 目标时长上限（秒）：防止把超长动画采成上千帧 */
export const SVG_ANIM_DURATION_MAX = 30

export type SvgAnimBackground = '' | 'white' | 'black'

export interface SvgAnimState {
  /** 采样帧数 */
  frames: number
  /** 目标时长（秒）；0 = 自动探测 SVG 自身动画周期 */
  durationSec: number
  /** 目标像素宽 / 高；0 = 用 SVG 自身尺寸 */
  width: number
  height: number
  /** 背景填充（'' = 透明） */
  background: SvgAnimBackground
}

export const DEFAULT_SVG_ANIM_STATE: SvgAnimState = {
  frames: SVG_ANIM_FRAMES_DEFAULT,
  durationSec: 0,
  width: 0,
  height: 0,
  background: ''
}

export function normalizeSvgAnimFrameCount(raw: unknown): number {
  const value = Math.floor(Number(raw))
  if (!Number.isFinite(value)) return SVG_ANIM_FRAMES_DEFAULT
  return Math.min(SVG_ANIM_FRAMES_MAX, Math.max(SVG_ANIM_FRAMES_MIN, value))
}

export function normalizeSvgAnimDurationSec(raw: unknown): number {
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.min(SVG_ANIM_DURATION_MAX, value)
}

export function normalizeSvgAnimSize(raw: unknown): number {
  const value = Math.floor(Number(raw))
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.min(SVG_ANIM_SIZE_MAX, value)
}

export function normalizeSvgAnimBackground(raw: unknown): SvgAnimBackground {
  return raw === 'white' || raw === 'black' ? raw : ''
}

export function normalizeSvgAnimState(raw?: Partial<SvgAnimState> | null): SvgAnimState {
  return {
    frames: normalizeSvgAnimFrameCount(raw?.frames),
    durationSec: normalizeSvgAnimDurationSec(raw?.durationSec),
    width: normalizeSvgAnimSize(raw?.width),
    height: normalizeSvgAnimSize(raw?.height),
    background: normalizeSvgAnimBackground(raw?.background)
  }
}

export function readSvgAnimFromNode(params: GraphNodeParams): SvgAnimState {
  return normalizeSvgAnimState({
    frames: params.svgFrames,
    durationSec: params.svgDurationSec,
    width: params.svgWidth,
    height: params.svgHeight,
    background: params.svgBackground
  })
}

export function svgAnimToNodePatch(state: SvgAnimState): {
  svgFrames: number
  svgDurationSec: number
  svgWidth: number
  svgHeight: number
  svgBackground: SvgAnimBackground
} {
  const normalized = normalizeSvgAnimState(state)
  return {
    svgFrames: normalized.frames,
    svgDurationSec: normalized.durationSec,
    svgWidth: normalized.width,
    svgHeight: normalized.height,
    svgBackground: normalized.background
  }
}

/** 目标尺寸上限换算：0 表示跟随 SVG 自身尺寸 */
export function resolveSvgAnimTargetSize(state: SvgAnimState): {
  width?: number
  height?: number
} {
  const width = state.width > 0 ? state.width : undefined
  const height = state.height > 0 ? state.height : undefined
  return { ...(width ? { width } : {}), ...(height ? { height } : {}) }
}
