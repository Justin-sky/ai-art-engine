import { describe, expect, it } from 'vitest'
import {
  listKlingCatalogModels,
  resolveKlingModelCapabilities
} from '../src/shared/modelProviders/kling/modelCapabilities'

describe('kling modelCapabilities', () => {
  it('lists image and video models separately', () => {
    const images = listKlingCatalogModels('image')
    const videos = listKlingCatalogModels('video')
    expect(images.every((m) => m.modality === 'image')).toBe(true)
    expect(videos.every((m) => m.modality === 'video')).toBe(true)
    expect(listKlingCatalogModels('text')).toEqual([])
  })

  it('resolves known model profiles', () => {
    const image = resolveKlingModelCapabilities('kling-v2', 'image')
    expect(image?.supported_parameters).toBeTruthy()
    const video = resolveKlingModelCapabilities('kling-v2-6', 'video')
    expect(video?.generate_audio).toBe(true)
    expect(video?.supported_durations).toEqual([5, 10])
  })
})
