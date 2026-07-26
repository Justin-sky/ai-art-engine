import { describe, expect, it } from 'vitest'
import {
  summarizeGraphValueForLog,
  summarizeInputPortsForLog,
  summarizeOutputPortsForLog
} from '../src/shared/graph'

describe('summarizeGraphValueForLog', () => {
  it('truncates long text and strips image data urls', () => {
    const text = summarizeGraphValueForLog({
      kind: 'text',
      text: 'x'.repeat(5000)
    })
    expect(text.textLength).toBe(5000)
    expect(text.text?.includes('truncated')).toBe(true)

    const images = summarizeGraphValueForLog({
      kind: 'images',
      items: [
        {
          id: '1',
          dataUrl: 'data:image/png;base64,AAAA',
          relativePath: 'Assets/a.png'
        }
      ]
    })
    expect(images.imageCount).toBe(1)
    expect(images.items?.[0]?.relativePath).toBe('Assets/a.png')
    expect(JSON.stringify(images)).not.toContain('data:image')
  })

  it('summarizes input and output port maps', () => {
    const inputs = summarizeInputPortsForLog({
      'in-text': [{ kind: 'text', text: 'hello' }],
      'in-image': [
        {
          kind: 'images',
          items: [{ id: 'a', dataUrl: '', relativePath: 'x.png' }]
        }
      ]
    })
    expect(inputs?.['in-text']?.[0]?.text).toBe('hello')
    expect(inputs?.['in-image']?.[0]?.items?.[0]?.relativePath).toBe('x.png')

    const outputs = summarizeOutputPortsForLog({
      out: { kind: 'videos', items: [{ id: 'v', relativePath: 'a.mp4' }] }
    })
    expect(outputs?.out?.videoCount).toBe(1)
  })
})
