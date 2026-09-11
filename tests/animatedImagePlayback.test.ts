import { describe, expect, it } from 'vitest'
import {
  attachAnimatedImagePlayback,
  isAnimatedPlaybackPath,
  observeInView,
  pickChatImageSrc
} from '@renderer/features/media/animatedImagePlayback'

describe('isAnimatedPlaybackPath', () => {
  it('识别 GIF（大写扩展名 / Windows 反斜杠路径同样成立）', () => {
    expect(isAnimatedPlaybackPath('Assets/2D/run.gif')).toBe(true)
    expect(isAnimatedPlaybackPath('Assets\\2D\\RUN.GIF')).toBe(true)
  })

  it('静态图 / 视频 / 空路径不走原文件播放', () => {
    expect(isAnimatedPlaybackPath('Assets/a.png')).toBe(false)
    expect(isAnimatedPlaybackPath('Assets/a.webp')).toBe(false)
    expect(isAnimatedPlaybackPath('Cache/clip.mp4')).toBe(false)
    expect(isAnimatedPlaybackPath('')).toBe(false)
  })
})

describe('pickChatImageSrc', () => {
  it('动图进入视口后取原文件（动画不被缩略图压成首帧）', () => {
    expect(
      pickChatImageSrc({
        relativePath: 'Assets/2D/run.gif',
        previewUrl: 'studio-media://local/?path=thumb.png',
        fileUrl: 'studio-media://local/?path=run.gif',
        playback: true
      })
    ).toBe('studio-media://local/?path=run.gif')
  })

  it('动图未进入视口时仍是缩略图占位', () => {
    expect(
      pickChatImageSrc({
        relativePath: 'Assets/2D/run.gif',
        previewUrl: 'studio-media://local/?path=thumb.png',
        fileUrl: 'studio-media://local/?path=run.gif',
        playback: false
      })
    ).toBe('studio-media://local/?path=thumb.png')
  })

  it('非动图即使用播放态也不换源（静态图行为与改动前一致）', () => {
    expect(
      pickChatImageSrc({
        relativePath: 'Assets/a.png',
        previewUrl: 'studio-media://local/?path=thumb.png',
        fileUrl: 'studio-media://local/?path=a.png',
        playback: true
      })
    ).toBe('studio-media://local/?path=thumb.png')
  })

  it('缩略图缺失时回退原文件（动图未播放也如此，保持既有预览语义）', () => {
    expect(
      pickChatImageSrc({
        relativePath: 'Assets/2D/run.gif',
        previewUrl: '',
        fileUrl: 'studio-media://local/?path=run.gif',
        playback: false
      })
    ).toBe('studio-media://local/?path=run.gif')
    expect(
      pickChatImageSrc({
        relativePath: 'Assets/a.png',
        fileUrl: 'studio-media://local/?path=a.png',
        playback: false
      })
    ).toBe('studio-media://local/?path=a.png')
  })

  it('动图声明播放但拿不到原文件时回退缩略图，不给出空 src', () => {
    expect(
      pickChatImageSrc({
        relativePath: 'Assets/2D/run.gif',
        previewUrl: 'studio-media://local/?path=thumb.png',
        fileUrl: '',
        playback: true
      })
    ).toBe('studio-media://local/?path=thumb.png')
  })
})

describe('observeInView', () => {
  it('无 IntersectionObserver 时按「始终可见」回调一次，解绑可安全调用', () => {
    // 测试运行在 node 环境：没有 IntersectionObserver，走降级分支
    expect(typeof IntersectionObserver).toBe('undefined')
    const seen: boolean[] = []
    const dispose = observeInView({} as Element, (visible) => seen.push(visible))
    expect(seen).toEqual([true])
    expect(() => dispose()).not.toThrow()
  })
})

describe('attachAnimatedImagePlayback', () => {
  it('静态图直接返回空操作，不观察元素', () => {
    const img = { src: 'studio-media://local/?path=a.png' } as unknown as HTMLImageElement
    const dispose = attachAnimatedImagePlayback(img, 'Assets/a.png', img.src)
    expect(() => dispose()).not.toThrow()
    expect(img.src).toBe('studio-media://local/?path=a.png')
  })

  it('节点已脱离文档时不加载原文件（src 保持静态占位）', () => {
    const img = {
      src: 'studio-media://local/?path=thumb.png',
      isConnected: false
    } as unknown as HTMLImageElement
    const dispose = attachAnimatedImagePlayback(img, 'Assets/2D/run.gif', img.src)
    expect(img.src).toBe('studio-media://local/?path=thumb.png')
    expect(() => dispose()).not.toThrow()
  })
})
