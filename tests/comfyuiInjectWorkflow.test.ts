import { describe, expect, it } from 'vitest'
import {
  collectComfyNodeClassTypes,
  injectComfyWorkflow,
  minimaxH3NativeSize,
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
  it('unwraps prompt wrapper and converts UI graphs', () => {
    expect(unwrapComfyApiWorkflow({ prompt: sample })['6']?.class_type).toBe('CLIPTextEncode')
    expect(() => unwrapComfyApiWorkflow({ nodes: [], links: [] })).toThrow(/没有可执行节点/)
    expect(
      unwrapComfyApiWorkflow({
        nodes: [{ id: 1, type: 'SaveImage', widgets_values_named: { filename_prefix: 'a' } }]
      })['1']?.class_type
    ).toBe('SaveImage')
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

  it('overrides width/height on MiniMax H3 nodes even when linked upstream', () => {
    const next = injectComfyWorkflow(
      {
        '104': {
          class_type: 'MiniMaxH3ImageToVideo',
          inputs: {
            clip: ['13', 0],
            vae: ['11', 0],
            width: ['115', 0],
            height: ['115', 1],
            length: 73,
            first_frame: ['114', 0]
          }
        }
      },
      { prompt: 'a cat', width: 1920, height: 1088 }
    )
    expect(next['104']?.inputs?.width).toBe(1920)
    expect(next['104']?.inputs?.height).toBe(1088)
  })

  it('overrides linked length on MiniMax H3 nodes with the 24fps 17k+5 grid', () => {
    const graph = {
      '104': {
        class_type: 'MiniMaxH3ImageToVideo',
        inputs: { clip: ['13', 0], vae: ['11', 0], length: ['107', 1] }
      },
      '10': { class_type: 'EmptyLTXVLatents', inputs: { length: 97 } }
    }
    const next = injectComfyWorkflow(graph, { prompt: 'a cat', durationSec: 5 })
    // H3: 5s * 24fps = 120 -> snap to 17k+5 => 124
    expect(next['104']?.inputs?.length).toBe(124)
    // non-H3 stays on the legacy 16fps heuristic
    expect(next['10']?.inputs?.length).toBe(80)
  })

  it('computes the MiniMax H3 native canvas', () => {
    expect(minimaxH3NativeSize(1920, 1088)).toEqual({ width: 1344, height: 768 })
    expect(minimaxH3NativeSize(1024, 1024)).toEqual({ width: 768, height: 768 })
    expect(minimaxH3NativeSize(1088, 1920)).toEqual({ width: 768, height: 1344 })
  })

  it('collects class types from API graphs and UI workflows', () => {
    expect(collectComfyNodeClassTypes(sample)).toContain('EmptyLatentImage')
    expect(collectComfyNodeClassTypes({ prompt: sample })).toContain('CLIPTextEncode')
    expect(
      collectComfyNodeClassTypes({
        nodes: [{ type: 'VHS_VideoCombine' }, { class_type: 'SaveVideo' }],
        links: []
      })
    ).toEqual(['VHS_VideoCombine', 'SaveVideo'])
    expect(
      collectComfyNodeClassTypes({
        '1': { class_type: 'SaveImage', _meta: { title: '最终出图' } }
      })
    ).toEqual(['SaveImage', '最终出图'])
  })
})
