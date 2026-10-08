import { describe, expect, it } from 'vitest'
import { resolveMediaPreviewKind } from '../src/renderer/src/features/media/openFullImagePreview'

describe('resolveMediaPreviewKind', () => {
  it('按 relativePath 扩展名识别视频（不与 URL 拼接误判）', () => {
    expect(
      resolveMediaPreviewKind({
        relativePath: 'Assets/Imports/recording-2026-10-08040058.mp4',
        url: 'studio-media://local/?path=Assets%2FImports%2Frecording-2026-10-08040058.mp4&t=1'
      })
    ).toBe('video')
  })

  it('studio-media URL 带 query 时仍能从 path 参数识别', () => {
    expect(
      resolveMediaPreviewKind({
        url: 'studio-media://local/?path=Assets%2Fclip.webm&t=99'
      })
    ).toBe('video')
  })

  it('assetType=video 优先于看起来像图片的路径', () => {
    expect(
      resolveMediaPreviewKind({
        assetType: 'video',
        relativePath: 'Assets/Imports/recording-poster.png'
      })
    ).toBe('video')
  })

  it('assetType=voice 识别为 audio', () => {
    expect(
      resolveMediaPreviewKind({
        assetType: 'voice',
        relativePath: 'Assets/Imports/line.mp3'
      })
    ).toBe('audio')
  })

  it('显式 mediaKind 最高优先', () => {
    expect(
      resolveMediaPreviewKind({
        mediaKind: 'video',
        assetType: 'image',
        relativePath: 'Assets/a.png'
      })
    ).toBe('video')
  })

  it('普通图片路径仍为 image', () => {
    expect(
      resolveMediaPreviewKind({
        relativePath: 'Assets/Imports/photo.jpg',
        url: 'studio-media://local/?path=Assets%2FImports%2Fphoto.jpg&t=1'
      })
    ).toBe('image')
  })
})
