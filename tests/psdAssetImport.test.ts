import { describe, expect, it } from 'vitest'
import {
  IMPORTABLE_EXTENSIONS,
  detectImportAssetType,
  importFileFilter,
  isAnimatedImageFilePath,
  isImageFilePath,
  isImportablePath,
  isLayeredSourceImageFilePath
} from '@shared/import'

describe('PSD 资产：入库白名单与分层源文件口径', () => {
  it('按图片资产入库，不再被挡在导入白名单外', () => {
    expect(isImportablePath('Assets/2D/cover.psd')).toBe(true)
    expect(isImportablePath('Assets/2D/COVER.PSD')).toBe(true)
    expect(detectImportAssetType('Assets/2D/cover.psd')).toBe('image')
    expect(isImageFilePath('Assets/2D/cover.psd')).toBe(true)
    expect(IMPORTABLE_EXTENSIONS).toContain('psd')
    expect(importFileFilter()[0]!.extensions).toContain('psd')
  })

  it('标记为分层源文件：像素要经合成解码，不能直接当图片用', () => {
    expect(isLayeredSourceImageFilePath('Assets/2D/cover.psd')).toBe(true)
    expect(isLayeredSourceImageFilePath('Assets/2D/COVER.PSD')).toBe(true)
    for (const direct of ['cover.png', 'cover.jpg', 'cover.jpeg', 'cover.webp', 'cover.gif']) {
      expect(isLayeredSourceImageFilePath(`Assets/2D/${direct}`)).toBe(false)
    }
    // 非图片路径同样不该被误判
    expect(isLayeredSourceImageFilePath('Assets/Video/clip.mp4')).toBe(false)
    expect(isLayeredSourceImageFilePath('Assets/2D/cover')).toBe(false)
  })

  it('PSD 不是动画图片：预览不走原文件播放分支', () => {
    expect(isAnimatedImageFilePath('Assets/2D/cover.psd')).toBe(false)
  })

  it('无扩展名与不支持的扩展名仍被拒绝', () => {
    expect(isImportablePath('Assets/2D/cover')).toBe(false)
    expect(isImportablePath('Assets/2D/cover.xyz')).toBe(false)
  })
})
