import { describe, expect, it } from 'vitest'
import {
  inferComfyUiMediaInputs,
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

  it('resolves r2v to the multi-modal ref profile (image + video + audio)', () => {
    const r2v = resolveComfyUiModelCapabilities('xxx-r2v', 'video')
    expect(r2v?.max_input_images).toBe(1)
    expect(r2v?.max_input_videos).toBe(1)
    expect(r2v?.max_input_audios).toBe(1)
    // i2v 仍只允许图片参考
    const i2v = resolveComfyUiModelCapabilities('custom-i2v', 'video')
    expect(i2v?.max_input_images).toBe(1)
    expect(i2v?.max_input_videos).toBe(0)
    expect(i2v?.max_input_audios).toBe(0)
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

describe('inferComfyUiMediaInputs', () => {
  it('infers image + video + audio inputs from an r2v generate node', () => {
    const graph = {
      '1': {
        class_type: 'WanImageToVideo',
        inputs: {
          reference_image: ['10', 0],
          reference_video: ['11', 0],
          reference_audio: ['12', 0],
          prompt: 'x'
        }
      }
    }
    expect(inferComfyUiMediaInputs(graph)).toEqual({
      maxImages: 1,
      maxVideos: 1,
      maxAudios: 1
    })
  })

  it('infers image-only input from an i2v node with start_image', () => {
    const graph = {
      '1': {
        class_type: 'MiniMaxH3ImageToVideo',
        inputs: { start_image: ['2', 0], first_frame: ['3', 0], length: 73 }
      }
    }
    expect(inferComfyUiMediaInputs(graph)).toEqual({
      maxImages: 1,
      maxVideos: 0,
      maxAudios: 0
    })
  })

  it('returns all zeros for a pure text-to-video node with no media socket', () => {
    const graph = {
      '1': { class_type: 'EmptyHunyuanLatentVideo', inputs: { width: 1280, height: 720, length: 73 } }
    }
    expect(inferComfyUiMediaInputs(graph)).toEqual({
      maxImages: 0,
      maxVideos: 0,
      maxAudios: 0
    })
  })

  it('returns null for a null or empty graph with no generate node', () => {
    expect(inferComfyUiMediaInputs(null)).toBeNull()
    expect(inferComfyUiMediaInputs({})).toBeNull()
    expect(
      inferComfyUiMediaInputs({ '1': { class_type: 'LoadImage', inputs: { image: 'a.png' } } })
    ).toBeNull()
  })

  it('infers media inputs from load nodes even when the generate node has no media socket', () => {
    const graph = {
      '1': { class_type: 'MiniMaxH3ReferenceToVideo', inputs: { prompt: 'x', model: ['2', 0] } },
      '10': { class_type: 'LoadImage', inputs: { image: 'a.png' } },
      '11': { class_type: 'VHS_LoadVideo', inputs: { video: 'a.mp4' } },
      '12': { class_type: 'VHS_LoadAudio', inputs: { audio_file: 'a.wav' } }
    }
    expect(inferComfyUiMediaInputs(graph)).toEqual({
      maxImages: 1,
      maxVideos: 1,
      maxAudios: 1
    })
  })

  it('infers image-only from a single LoadImage when video/audio load nodes are absent', () => {
    const graph = {
      '1': { class_type: 'WanImageToVideo', inputs: { prompt: 'x' } },
      '10': { class_type: 'LoadImage', inputs: { image: 'a.png' } }
    }
    expect(inferComfyUiMediaInputs(graph)).toEqual({
      maxImages: 1,
      maxVideos: 0,
      maxAudios: 0
    })
  })
})
