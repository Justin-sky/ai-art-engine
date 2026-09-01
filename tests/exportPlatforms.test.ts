import { describe, expect, it } from 'vitest'
import {
  EXPORT_PLATFORMS,
  exportPlatformById,
  exportPlatformSafeRect,
  exportPlatformSubtitleOffset,
  isExportDurationOverLimit,
  isExportPlatformId,
  isSubtitleWithinSafeArea
} from '../src/shared/graph/exportPlatforms'

describe('exportPlatforms 平台规格库', () => {
  it('平台 id 唯一且首项为 custom', () => {
    const ids = EXPORT_PLATFORMS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids[0]).toBe('custom')
  })

  it('画幅比例与 frame 一致', () => {
    for (const p of EXPORT_PLATFORMS) {
      if (p.id === 'custom') continue
      if (p.frame === 'portrait') {
        expect(p.height).toBeGreaterThan(p.width)
      } else if (p.frame === 'landscape') {
        expect(p.width).toBeGreaterThan(p.height)
      } else {
        expect(p.width).toBe(p.height)
      }
    }
  })

  it('竖屏平台均为 1080×1920，安全区比例在 (0,0.5)', () => {
    const portrait = EXPORT_PLATFORMS.filter((p) => p.frame === 'portrait')
    expect(portrait.length).toBeGreaterThanOrEqual(3)
    for (const p of portrait) {
      expect(p.width).toBe(1080)
      expect(p.height).toBe(1920)
      expect(p.safeAreaRatio).toBeGreaterThan(0)
      expect(p.safeAreaRatio).toBeLessThan(0.5)
    }
  })

  it('exportPlatformById / isExportPlatformId', () => {
    expect(exportPlatformById('douyin')?.frame).toBe('portrait')
    expect(exportPlatformById('youtube')?.width).toBe(1920)
    expect(exportPlatformById('unknown')).toBeUndefined()
    expect(isExportPlatformId('tiktok')).toBe(true)
    expect(isExportPlatformId('custom')).toBe(true)
    expect(isExportPlatformId('bogus')).toBe(false)
    expect(isExportPlatformId(undefined)).toBe(false)
  })
})

describe('exportPlatformSafeRect', () => {
  it('按比例外扩并取整', () => {
    const douyin = exportPlatformById('douyin')!
    const rect = exportPlatformSafeRect(1080, 1920, douyin)
    expect(rect.left).toBe(108)
    expect(rect.top).toBe(192)
    expect(rect.right).toBe(972)
    expect(rect.bottom).toBe(1728)
  })

  it('custom 平台安全区为全幅', () => {
    const custom = exportPlatformById('custom')!
    const rect = exportPlatformSafeRect(1280, 720, custom)
    expect(rect).toEqual({ left: 0, top: 0, right: 1280, bottom: 720 })
  })
})

describe('exportPlatformSubtitleOffset', () => {
  it('竖屏平台返回落在底部安全区内的偏移', () => {
    const douyin = exportPlatformById('douyin')!
    const offset = exportPlatformSubtitleOffset(1920, douyin)
    expect(offset).toBeGreaterThanOrEqual(24)
    // 底部安全区高度 = 1920*0.1 = 192，字幕应在其内侧
    expect(offset).toBeLessThan(192)
  })

  it('横屏 / custom 走兜底比例', () => {
    const youtube = exportPlatformById('youtube')!
    const custom = exportPlatformById('custom')!
    expect(exportPlatformSubtitleOffset(1080, youtube)).toBe(Math.round(1080 * 0.11))
    expect(exportPlatformSubtitleOffset(720, custom)).toBe(Math.round(720 * 0.11))
  })
})

describe('isExportDurationOverLimit', () => {
  it('超出平台上限判定', () => {
    const douyin = exportPlatformById('douyin')!
    expect(isExportDurationOverLimit(900, douyin)).toBe(false)
    expect(isExportDurationOverLimit(901, douyin)).toBe(true)
    const youtube = exportPlatformById('youtube')!
    expect(isExportDurationOverLimit(99999, youtube)).toBe(false)
  })
})

describe('isSubtitleWithinSafeArea', () => {
  it('竖屏默认偏移落在安全区内，过大偏移越界', () => {
    const douyin = exportPlatformById('douyin')!
    // 1920*0.1=192；144 + 36/2 = 162 ≤ 192
    expect(isSubtitleWithinSafeArea(1920, 36, 144, douyin)).toBe(true)
    // 300 远超安全区下沿
    expect(isSubtitleWithinSafeArea(1920, 36, 300, douyin)).toBe(false)
  })

  it('custom / 零安全区恒通过', () => {
    const custom = exportPlatformById('custom')!
    expect(isSubtitleWithinSafeArea(720, 200, 0, custom)).toBe(true)
  })
})
