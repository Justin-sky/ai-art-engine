import { describe, expect, it } from 'vitest'
import {
  inferComfyUiWorkflowModality,
  listComfyUiCatalogModels,
  resolveComfyUiModelCapabilities
} from '../src/shared/modelProviders/comfyui/modelCapabilities'

describe('comfyui modelCapabilities', () => {
  it('lists image / video / audio templates and hides text', () => {
    expect(listComfyUiCatalogModels('image').some((m) => m.id === 'txt2img')).toBe(true)
    expect(listComfyUiCatalogModels('video').some((m) => m.id === 'img2vid')).toBe(true)
    expect(listComfyUiCatalogModels('audio').some((m) => m.id === 'txt2audio')).toBe(true)
    expect(listComfyUiCatalogModels('text')).toEqual([])
  })

  it('resolves static and inferred capabilities', () => {
    const image = resolveComfyUiModelCapabilities('txt2img', 'image')
    expect(image?.supported_parameters).toBeTruthy()
    const video = resolveComfyUiModelCapabilities('custom-i2v', 'video')
    expect(video?.supported_frame_images).toEqual(['first_frame'])
  })

  it('infers modality from workflow names', () => {
    expect(inferComfyUiWorkflowModality('wan-t2v')).toBe('video')
    expect(inferComfyUiWorkflowModality('stable-audio-3')).toBe('audio')
    expect(inferComfyUiWorkflowModality('flux-dev')).toBe('image')
  })
})
