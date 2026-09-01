/**
 * 平台规格导出预设：主流短视频 / 长视频平台的画幅、分辨率、码率、时长上限与安全区常量。
 * 供导出向导自动套用规格、预览安全区可视化、字幕适配使用。
 */

export type ExportPlatformId =
  | 'custom'
  | 'douyin'
  | 'kuaishou'
  | 'shipinhao'
  | 'tiktok'
  | 'youtube'

export type ExportFrame = 'portrait' | 'landscape' | 'square'

export interface ExportPlatformSpec {
  id: ExportPlatformId
  /** i18n key 后缀（locales 下 `script.timeline.platform.${nameKey}`） */
  nameKey: string
  frame: ExportFrame
  /** 推荐输出分辨率（宽 × 高） */
  width: number
  height: number
  /** 推荐帧率 */
  fps: number
  /** 建议视频码率（kbps） */
  videoBitrateKbps: number
  /** 平台时长上限（秒） */
  maxDurationSec: number
  /** 四周安全区比例（0~0.5），字幕应落在底部安全区以内 */
  safeAreaRatio: number
}

/** 平台规格库（含「通用/自定义」占位，便于下拉对齐） */
export const EXPORT_PLATFORMS: ExportPlatformSpec[] = [
  {
    id: 'custom',
    nameKey: 'custom',
    frame: 'landscape',
    width: 1280,
    height: 720,
    fps: 30,
    videoBitrateKbps: 5000,
    maxDurationSec: Infinity,
    safeAreaRatio: 0
  },
  {
    id: 'douyin',
    nameKey: 'douyin',
    frame: 'portrait',
    width: 1080,
    height: 1920,
    fps: 30,
    videoBitrateKbps: 10000,
    maxDurationSec: 15 * 60,
    safeAreaRatio: 0.1
  },
  {
    id: 'kuaishou',
    nameKey: 'kuaishou',
    frame: 'portrait',
    width: 1080,
    height: 1920,
    fps: 30,
    videoBitrateKbps: 10000,
    maxDurationSec: 15 * 60,
    safeAreaRatio: 0.1
  },
  {
    id: 'shipinhao',
    nameKey: 'shipinhao',
    frame: 'portrait',
    width: 1080,
    height: 1920,
    fps: 30,
    videoBitrateKbps: 10000,
    maxDurationSec: 20 * 60,
    safeAreaRatio: 0.1
  },
  {
    id: 'tiktok',
    nameKey: 'tiktok',
    frame: 'portrait',
    width: 1080,
    height: 1920,
    fps: 30,
    videoBitrateKbps: 8000,
    maxDurationSec: 60 * 60,
    safeAreaRatio: 0.12
  },
  {
    id: 'youtube',
    nameKey: 'youtube',
    frame: 'landscape',
    width: 1920,
    height: 1080,
    fps: 30,
    videoBitrateKbps: 12000,
    maxDurationSec: Infinity,
    safeAreaRatio: 0.05
  }
]

export function exportPlatformById(id: string): ExportPlatformSpec | undefined {
  return EXPORT_PLATFORMS.find((p) => p.id === id)
}

export function isExportPlatformId(value: unknown): value is ExportPlatformId {
  return typeof value === 'string' && EXPORT_PLATFORMS.some((p) => p.id === value)
}

/** 指定输出尺寸下的安全区矩形（像素坐标，已按比例外扩） */
export function exportPlatformSafeRect(
  width: number,
  height: number,
  spec: ExportPlatformSpec
): { left: number; top: number; right: number; bottom: number } {
  const ratio = Math.min(0.5, Math.max(0, spec.safeAreaRatio))
  const hInset = Math.round(width * ratio)
  const vInset = Math.round(height * ratio)
  return {
    left: hInset,
    top: vInset,
    right: Math.max(0, width - hInset),
    bottom: Math.max(0, height - vInset)
  }
}

/** 竖屏平台建议的字幕底部偏移（px，落在底部安全区下沿内侧） */
export function exportPlatformSubtitleOffset(
  height: number,
  spec: ExportPlatformSpec
): number {
  if (spec.frame !== 'portrait' || spec.safeAreaRatio <= 0) return Math.round(height * 0.11)
  return Math.max(24, Math.round(height * spec.safeAreaRatio * 0.75))
}

/** 时长是否超出平台上限 */
export function isExportDurationOverLimit(
  durationSec: number,
  spec: ExportPlatformSpec
): boolean {
  return Number.isFinite(spec.maxDurationSec) && durationSec > spec.maxDurationSec
}

/** 字幕是否落在底部安全区内（偏移 + 半行字高 ≤ 安全区下沿内缩量） */
export function isSubtitleWithinSafeArea(
  height: number,
  fontSize: number,
  yOffset: number,
  spec: ExportPlatformSpec
): boolean {
  if (spec.id === 'custom' || spec.safeAreaRatio <= 0) return true
  const bottomInset = height * spec.safeAreaRatio
  return yOffset + Math.max(0, fontSize) / 2 <= bottomInset
}
