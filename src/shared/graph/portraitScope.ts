/**
 * 人像处理「局部生效」的范围计划与蒙版几何（纯函数，可单测）。
 *
 * 为什么需要它：图片模型接口（`GenerateImageInput`）只有 prompt + 参考图，**没有蒙版通道**，
 * 一次调用必定重绘整张图 —— 于是「磨皮」会连衣服背景一起糊、「瘦脸」会带着背景一起扭。
 * 执行器因此改用「整图出图 + 按蒙版回贴」：这个文件给出**这次请求真正该动的区域**，
 * 渲染层据此把模型结果羽化贴回原图，未请求部位保持像素级不变。
 *
 * 两个刻意的取舍：
 * - **有全局项就整体放弃蒙版**：调色（LUT / 色温）、换背景、证件照规格本身就是整图语义，
 *   只回贴局部会把它们一起裁掉 —— 那比「作用到全局」更糟。
 * - **蒙版由可用的来源拼成**：缺人脸关键点就退回「只有手动区域框」，缺分割模型就只有脸，
 *   全都没有才整体放弃（并在运行日志里说明）。
 */

import {
  PORTRAIT_PARAM_SPECS,
  isPortraitParamChanged,
  normalizePortraitManualRegions,
  normalizePortraitRetouch,
  type PortraitManualRegion,
  type PortraitRetouchState,
  type PortraitToolGroupId
} from './portraitRetouch'
import { PORTRAIT_LANDMARK_COUNT, portraitFaceBoxFromLandmarks } from './portraitFace'

export interface PortraitScopeRect {
  x: number
  y: number
  w: number
  h: number
}

/** 蒙版构成：脸 / 人物 / 手动框，三者取并集 */
export interface PortraitScopeMask {
  /** 脸 + 颈（依赖人脸关键点） */
  face: boolean
  /** 人物实例（依赖本地实例分割模型） */
  person: boolean
  /** 手动区域框（归一化 0..1） */
  regions: PortraitScopeRect[]
}

export interface PortraitScopePlan extends PortraitScopeMask {
  /** true = 这次请求不该套蒙版（整体整图生效） */
  disabled: boolean
  /** disabled 的原因，进运行日志 */
  reason?: 'global' | 'idPhoto' | 'off' | 'scopeOff'
}

/** 整图语义的组：出现任一改动就整体放弃局部回贴 */
const GLOBAL_SCOPE_GROUPS = new Set<PortraitToolGroupId>(['color', 'background', 'idPhoto'])
/** 身形类：需要人物区域（分割），脸也要一起罩住（身形请求常伴面部微调） */
const PERSON_SCOPE_GROUPS = new Set<PortraitToolGroupId>(['body'])
/** 导出组是输出设置，与「改哪里」无关 */
const EXPORT_GROUP: PortraitToolGroupId = 'export'

function regionBoxes(regions: readonly PortraitManualRegion[]): PortraitScopeRect[] {
  const out: PortraitScopeRect[] = []
  for (const region of regions) {
    const box = region.box
    if (!box) continue
    if (!(box.w > 0.001 && box.h > 0.001)) continue
    out.push({ x: box.x, y: box.y, w: box.w, h: box.h })
  }
  return out
}

/**
 * 这次请求的局部范围计划。
 *
 * 「改过」的判定与卡片角标「已修 N 项」同一套（`isPortraitParamChanged`），
 * 所以面板上看到有改动、计划里就一定认。
 */
export function portraitScopePlan(
  raw: Partial<PortraitRetouchState> | null | undefined
): PortraitScopePlan {
  const state = normalizePortraitRetouch(raw)
  const regions = regionBoxes(normalizePortraitManualRegions(state.manualRegions))
  const empty: PortraitScopeMask = { face: false, person: false, regions: [] }

  // 证件照要重新构图 + 换底：整图语义
  if (state.idPhotoSpecId && state.idPhotoSpecId !== 'none') {
    return { ...empty, disabled: true, reason: 'idPhoto' }
  }

  let hasLocal = false
  let person = false
  let face = false
  for (const spec of PORTRAIT_PARAM_SPECS) {
    if (spec.group === EXPORT_GROUP) continue
    if (!isPortraitParamChanged(state, spec)) continue
    if (GLOBAL_SCOPE_GROUPS.has(spec.group)) {
      return { ...empty, disabled: true, reason: 'global' }
    }
    if (PERSON_SCOPE_GROUPS.has(spec.group)) person = true
    else face = true
    hasLocal = true
  }

  // 只画了区域框：蒙版就只由框组成（人像之外也能用）
  if (!hasLocal) {
    if (regions.length) return { face: false, person: false, regions, disabled: false }
    return { ...empty, disabled: true, reason: 'off' }
  }

  return { face, person, regions, disabled: false }
}

export interface PortraitMaskEllipse {
  cx: number
  cy: number
  rx: number
  ry: number
}

export interface PortraitMaskShape {
  /** 脸：椭圆 */
  ellipse: PortraitMaskEllipse
  /** 颈 / 锁骨：梯形（顺时针四个点） */
  neck: Array<[number, number]>
}

/**
 * 由 canonical-68 关键点推出「脸 + 颈」蒙版形状（归一化坐标）。
 *
 * 关键点外接框只到眉骨与下颌，直接罩它会让额头留在原样；脖子不罩则磨皮后接缝极明显，
 * 所以这里：椭圆向上抬、两侧放宽覆盖额头与耳缘，再补一段下巴以下的梯形盖住颈与锁骨。
 */
export function portraitFaceMaskShape(
  landmarks: ReadonlyArray<readonly [number, number]> | null | undefined
): PortraitMaskShape | null {
  if (!landmarks || landmarks.length < PORTRAIT_LANDMARK_COUNT) return null
  const box = portraitFaceBoxFromLandmarks(
    landmarks.map((point) => [point[0] ?? 0, point[1] ?? 0] as [number, number])
  )
  if (!(box.w > 0.002 && box.h > 0.002)) return null

  const cx = box.x + box.w / 2
  const ellipse: PortraitMaskEllipse = {
    cx,
    // 略微下移并加高：上沿落到发际线附近，下沿包住下巴
    cy: box.y + box.h * 0.42,
    rx: box.w * 0.62,
    ry: box.h * 0.86
  }

  const chinY = box.y + box.h * 0.9
  const bottomY = box.y + box.h * 1.7
  const halfTop = box.w * 0.3
  const halfBottom = box.w * 0.5
  const neck: Array<[number, number]> = [
    [cx - halfTop, chinY],
    [cx + halfTop, chinY],
    [cx + halfBottom, bottomY],
    [cx - halfBottom, bottomY]
  ]

  return { ellipse, neck }
}

/** 蒙版羽化半径（蒙版画布短边比例）：太小留硬边，太大等于没修 */
export const PORTRAIT_MASK_FEATHER_RATIO = 0.012
/** 蒙版画布上限（回贴时再放大到原图分辨率；羽化靠放大插值自然过渡） */
export const PORTRAIT_MASK_MAX_EDGE = 1024

export function clampScopeRect(rect: PortraitScopeRect): PortraitScopeRect {
  const x = Math.min(1, Math.max(0, rect.x))
  const y = Math.min(1, Math.max(0, rect.y))
  return {
    x,
    y,
    w: Math.min(1 - x, Math.max(0, rect.w)),
    h: Math.min(1 - y, Math.max(0, rect.h))
  }
}
