import { describe, expect, it } from 'vitest'
import { extractChatCompletionText } from '../src/main/services/modelProviders/openaiCompat'

describe('extractChatCompletionText', () => {
  it('reads plain string content', () => {
    expect(
      extractChatCompletionText({
        choices: [{ message: { content: '  hello  ' } }]
      })
    ).toBe('hello')
  })

  it('joins multipart content arrays', () => {
    expect(
      extractChatCompletionText({
        choices: [
          {
            message: {
              content: [
                { type: 'text', text: '{"name":' },
                { type: 'text', text: '"apply_bone_pose"}' }
              ]
            }
          }
        ]
      })
    ).toBe('{"name":"apply_bone_pose"}')
  })

  it('falls back to reasoning_content', () => {
    expect(
      extractChatCompletionText({
        choices: [{ message: { content: '', reasoning_content: 'only reasoning' } }]
      })
    ).toBe('only reasoning')
  })

  it('serializes tool_calls for downstream JSON parsers', () => {
    const text = extractChatCompletionText({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                function: {
                  name: 'apply_bone_pose',
                  arguments: '{"bones":{"Hips":{"x":0,"y":1,"z":0}}}'
                }
              }
            ]
          }
        }
      ]
    })
    expect(JSON.parse(text)).toEqual({
      name: 'apply_bone_pose',
      arguments: { bones: { Hips: { x: 0, y: 1, z: 0 } } }
    })
  })
})
