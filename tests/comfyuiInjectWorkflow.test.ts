import { describe, expect, it } from 'vitest'
import {
  injectComfyWorkflow,
  sizeFromAspectRatio,
  unwrapComfyApiWorkflow
} from '../src/shared/modelProviders/comfyui/injectWorkflow'

const sample = {
  '6': {
    class_type: 'CLIPTextEncode',
    inputs: { text: 'old', clip: ['4', 0] },
    _meta: { title: 'Positive' }
  },
  '7': {
    class_type: 'CLIPTextEncode',
    inputs: { text: 'old-neg', clip: ['4', 0] },
    _meta: { title: 'Negative' }
  },
  '5': {
    class_type: 'EmptyLatentImage',
    inputs: { width: 512, height: 512, batch_size: 1 }
  },
  '3': {
    class_type: 'KSampler',
    inputs: { seed: 1, steps: 20 }
  },
  '10': {
    class_type: 'LoadImage',
    inputs: { image: 'in.png' }
  }
}

describe('comfyui injectWorkflow', () => {
  it('unwraps prompt wrapper and rejects UI format', () => {
    expect(unwrapComfyApiWorkflow({ prompt: sample })['6']?.class_type).toBe('CLIPTextEncode')
    expect(() => unwrapComfyApiWorkflow({ nodes: [], links: [] })).toThrow(/UI 格式/)
  })

  it('injects prompt, size, seed and load image', () => {
    const next = injectComfyWorkflow(sample, {
      prompt: 'a cat',
      negativePrompt: 'blur',
      seed: 42,
      width: 1280,
      height: 720,
      imageFilenames: ['ref.png']
    })
    expect(next['6']?.inputs?.text).toBe('a cat')
    expect(next['7']?.inputs?.text).toBe('blur')
    expect(next['5']?.inputs?.width).toBe(1280)
    expect(next['5']?.inputs?.height).toBe(720)
    expect(next['3']?.inputs?.seed).toBe(42)
    expect(next['10']?.inputs?.image).toBe('ref.png')
    expect(sample['6']?.inputs?.text).toBe('old')
  })

  it('maps aspect ratio to size', () => {
    expect(sizeFromAspectRatio('16:9', '1k')).toEqual({ width: 1280, height: 720 })
    expect(sizeFromAspectRatio('1:1', '2k')).toEqual({ width: 1536, height: 1536 })
  })
})
