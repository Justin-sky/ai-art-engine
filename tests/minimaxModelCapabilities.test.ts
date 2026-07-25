import { describe, expect, it } from 'vitest'
import {
  listMiniMaxCatalogModels,
  resolveMiniMaxModelCapabilities
} from '../src/shared/modelProviders/minimax/modelCapabilities'

describe('minimax modelCapabilities', () => {
  it('lists text, image, audio and video models', () => {
    const texts = listMiniMaxCatalogModels('text')
    expect(texts.some((m) => m.id === 'MiniMax-M3')).toBe(true)
    expect(texts.some((m) => m.id === 'MiniMax-M2.7')).toBe(true)
    const images = listMiniMaxCatalogModels('image')
    expect(images.some((m) => m.id === 'image-01')).toBe(true)
    expect(images.some((m) => m.id === 'image-01-live')).toBe(true)
    const audios = listMiniMaxCatalogModels('audio')
    expect(audios.some((m) => m.id === 'voice-design')).toBe(true)
    const videos = listMiniMaxCatalogModels('video')
    expect(videos.some((m) => m.id === 'MiniMax-Hailuo-2.3')).toBe(true)
    expect(videos.some((m) => m.id === 'MiniMax-Hailuo-2.3-Fast')).toBe(true)
    expect(videos.some((m) => m.id === 'MiniMax-Hailuo-02')).toBe(true)
  })

  it('resolves image and video capabilities', () => {
    const text = resolveMiniMaxModelCapabilities('MiniMax-M3', 'text')
    expect(text).toEqual({})
    const image = resolveMiniMaxModelCapabilities('image-01', 'image')
    expect((image?.supported_parameters as { n?: { max?: number } })?.n?.max).toBe(9)
    const v23 = resolveMiniMaxModelCapabilities('MiniMax-Hailuo-2.3', 'video')
    expect(v23?.supported_frame_images).toEqual(['first_frame'])
    expect(v23?.supported_durations).toEqual([6, 10])
    expect(v23?.supported_resolutions).toEqual(['768P', '1080P'])

    const v02 = resolveMiniMaxModelCapabilities('MiniMax-Hailuo-02', 'video')
    expect(v02?.supported_frame_images).toEqual(['first_frame', 'last_frame'])
    expect(v02?.supported_resolutions).toContain('512P')
  })
})
