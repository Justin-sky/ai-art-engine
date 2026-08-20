import { describe, expect, it } from 'vitest'
import { convertComfyUiWorkflowToApi } from '../src/shared/modelProviders/comfyui/uiToApi'

describe('comfyui uiToApi', () => {
  it('converts named widgets and links', () => {
    const api = convertComfyUiWorkflowToApi({
      nodes: [
        {
          id: 1,
          type: 'CLIPTextEncode',
          widgets_values_named: { text: 'a cat' },
          inputs: [{ name: 'clip', link: 9 }]
        },
        { id: 2, type: 'CheckpointLoaderSimple', widgets_values_named: { ckpt_name: 'x.safetensors' } }
      ],
      links: [[9, 2, 1, 1, 0, 'CLIP']]
    })
    expect(api['1']?.class_type).toBe('CLIPTextEncode')
    expect(api['1']?.inputs?.text).toBe('a cat')
    expect(api['1']?.inputs?.clip).toEqual(['2', 1])
    expect(api['2']?.inputs?.ckpt_name).toBe('x.safetensors')
  })

  it('inlines subgraphs and rewires outputs', () => {
    const api = convertComfyUiWorkflowToApi({
      nodes: [
        {
          id: 1,
          type: 'SaveVideo',
          inputs: [{ name: 'video', link: 1 }],
          widgets_values_named: { filename_prefix: 'out' }
        },
        {
          id: 2,
          type: 'abc-subgraph',
          inputs: [{ name: 'prompt', link: null }],
          widgets_values_named: { prompt: 'hello' }
        }
      ],
      links: [[1, 2, 0, 1, 0, 'VIDEO']],
      definitions: {
        subgraphs: [
          {
            id: 'abc-subgraph',
            inputs: [{ name: 'prompt' }],
            outputs: [{ name: 'VIDEO' }],
            nodes: [
              {
                id: 9,
                type: 'CreateVideo',
                inputs: [
                  { name: 'images', link: null },
                  { name: 'prompt', link: 10 }
                ],
                widgets_values_named: { fps: 24 }
              }
            ],
            links: [
              {
                id: 10,
                origin_id: -10,
                origin_slot: 0,
                target_id: 9,
                target_slot: 1,
                type: 'STRING'
              },
              {
                id: 11,
                origin_id: 9,
                origin_slot: 0,
                target_id: -20,
                target_slot: 0,
                type: 'VIDEO'
              }
            ]
          }
        ]
      }
    })
    expect(api['2']).toBeUndefined()
    expect(api['2:9']?.class_type).toBe('CreateVideo')
    expect(api['2:9']?.inputs?.prompt).toBe('hello')
    expect(api['2:9']?.inputs?.fps).toBe(24)
    expect(api['1']?.inputs?.video).toEqual(['2:9', 0])
  })
})
