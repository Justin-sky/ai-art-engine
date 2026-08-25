import { describe, expect, it } from 'vitest'
import {
  inferComfyUiWorkflowModality,
  resolveComfyUiModelCapabilities
} from '../src/shared/modelProviders/comfyui/modelCapabilities'

describe('comfyui modelCapabilities', () => {
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
    expect(inferComfyUiWorkflowModality('千问文生图zimage')).toBe('image')
    expect(inferComfyUiWorkflowModality('flux1_krea文生图')).toBe('image')
    expect(inferComfyUiWorkflowModality('wan22文生视频')).toBe('video')
    expect(inferComfyUiWorkflowModality('wan22_animate')).toBe('video')
    expect(inferComfyUiWorkflowModality('wan22fun_inpaint')).toBe('video')
    expect(inferComfyUiWorkflowModality('txt2vid')).toBe('video')
    expect(inferComfyUiWorkflowModality('千问TTS语音克隆')).toBe('audio')
  })

  it('infers modality from node class types and ignores the filename', () => {
    expect(
      inferComfyUiWorkflowModality('my-flow', undefined, ['EmptyHunyuanLatentVideo', 'VHS_VideoCombine'])
    ).toBe('video')
    expect(inferComfyUiWorkflowModality('my-flow', undefined, ['EmptyLatentImage', 'SaveImage'])).toBe(
      'image'
    )
    expect(inferComfyUiWorkflowModality('my-flow', undefined, ['SaveAudio'])).toBe('audio')
    expect(
      inferComfyUiWorkflowModality('wan22文生视频', undefined, ['EmptyLatentImage', 'SaveImage'])
    ).toBe('image')
    expect(inferComfyUiWorkflowModality('千问文生图', undefined, ['WanImageToVideo'])).toBe('video')
    expect(
      inferComfyUiWorkflowModality('video_minimax_h3_i2v', undefined, [
        'VAEDecodeAudio',
        'SaveVideo',
        'MiniMaxH3ImageToVideo'
      ])
    ).toBe('video')
    expect(
      inferComfyUiWorkflowModality('audio-flow', undefined, ['VAEDecodeAudio', 'SaveAudio'])
    ).toBe('audio')
  })
})
