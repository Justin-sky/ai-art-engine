import { describe, expect, it } from 'vitest'
import {
  isRealThumbnailPath,
  resolveFullMediaPath,
  resolvePreviewMediaPath,
  thumbRelativePathFor
} from '../src/shared/media/thumbnailPath'

describe('thumbnailPath', () => {
  it('maps source path into .aiartengine/thumbs', () => {
    expect(thumbRelativePathFor('Assets/foo.png')).toBe('.aiartengine/thumbs/Assets/foo.png.png')
  })

  it('detects legacy fake thumbs', () => {
    expect(isRealThumbnailPath('Assets/foo.png', 'Assets/foo.png')).toBe(false)
    expect(isRealThumbnailPath('.aiartengine/thumbs/Assets/foo.png.png', 'Assets/foo.png')).toBe(true)
  })

  it('prefers real thumb for preview, original for full', () => {
    const thumb = '.aiartengine/thumbs/Assets/foo.png.png'
    expect(
      resolvePreviewMediaPath({
        relativePath: 'Assets/foo.png',
        thumbnailPath: thumb,
        type: 'image'
      })
    ).toBe(thumb)
    expect(
      resolveFullMediaPath({
        relativePath: 'Assets/foo.png',
        thumbnailPath: thumb,
        type: 'image'
      })
    ).toBe('Assets/foo.png')
  })

  it('falls back to original when thumb is fake', () => {
    expect(
      resolvePreviewMediaPath({
        relativePath: 'Assets/foo.png',
        thumbnailPath: 'Assets/foo.png',
        type: 'image'
      })
    ).toBe('Assets/foo.png')
  })

  it('uses relativePath for video/audio playback (not first-frame thumb)', () => {
    expect(
      resolvePreviewMediaPath({
        relativePath: 'Assets/a.mp4',
        thumbnailPath: '.aiartengine/thumbs/Assets/a.mp4.png',
        type: 'video'
      })
    ).toBe('Assets/a.mp4')
    expect(
      resolvePreviewMediaPath({
        relativePath: 'Assets/a.wav',
        thumbnailPath: '.aiartengine/thumbs/Assets/a.wav.png',
        type: 'voice'
      })
    ).toBe('Assets/a.wav')
  })
})
