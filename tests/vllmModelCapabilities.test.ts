import { describe, expect, it } from 'vitest'
import {
  listVllmCatalogModels,
  resolveVllmModelCapabilities
} from '../src/shared/modelProviders/vllm/modelCapabilities'

describe('vllmModelCapabilities', () => {
  it('resolves video capabilities for any vLLM-Omni model id', () => {
    const caps = resolveVllmModelCapabilities('Wan-AI/Wan2.2-T2V-A14B-Diffusers', 'video')
    expect(caps?.supported_resolutions).toContain('720p')
    expect(caps?.supported_aspect_ratios).toContain('16:9')
    expect(caps?.supported_durations).toContain(10)
    expect(caps?.supported_frame_images).toEqual(['first_frame'])
    expect(caps?.generate_audio).toBe(false)
    expect(caps?.max_input_images).toBe(1)
    expect(caps?.max_input_videos).toBe(1)
    expect(caps?.max_input_audios).toBe(1)
  })

  it('returns null for non-video modalities', () => {
    expect(resolveVllmModelCapabilities('Qwen2.5-72B-Instruct', 'text')).toBeNull()
    expect(resolveVllmModelCapabilities('x', 'image')).toBeNull()
  })

  it('has no static catalog (models come from /models or manual add)', () => {
    expect(listVllmCatalogModels('video')).toEqual([])
    expect(listVllmCatalogModels('text')).toEqual([])
  })
})
