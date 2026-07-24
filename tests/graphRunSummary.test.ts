import { describe, expect, it } from 'vitest'
import {
  pickGraphRunSuccessMessageKey,
  summarizeGraphRunOutput
} from '../src/shared/graph'

describe('graph run success summary', () => {
  it('counts asset refs for generation workflows', () => {
    const summary = summarizeGraphRunOutput({
      contribution: {
        genRefs: [
          { role: 'character', assetId: 'a1', refIndex: 1, weight: 0.85 },
          { role: 'background', assetId: 'a2', refIndex: 2, weight: 0.85 }
        ],
        audioRefs: [{ kind: 'voice', assetId: 'v1' }, { kind: 'voice' }]
      },
      output: {
        kind: 'output',
        outputKind: 'video',
        items: [],
        notes: [],
        params: {}
      }
    })
    expect(summary).toMatchObject({ visual: 2, voice: 1, text: 0, images: 0, hasOutput: true })
    expect(pickGraphRunSuccessMessageKey(summary)).toBe('complete')
  })

  it('counts director / select-image images instead of treating as empty', () => {
    const summary = summarizeGraphRunOutput({
      contribution: { genRefs: [], audioRefs: [] },
      output: {
        kind: 'output',
        outputKind: 'image',
        items: [],
        notes: [],
        params: {},
        images: [
          { id: 's1', dataUrl: 'data:image/png;base64,aaa' },
          { id: 's2', dataUrl: '   ' },
          { id: 's3', dataUrl: 'data:image/png;base64,bbb' }
        ]
      }
    })
    expect(summary.images).toBe(2)
    expect(pickGraphRunSuccessMessageKey(summary)).toBe('completeImages')
  })

  it('falls back to cameraShots on output params when images missing', () => {
    const summary = summarizeGraphRunOutput({
      contribution: { genRefs: [], audioRefs: [] },
      output: {
        kind: 'output',
        outputKind: 'image',
        items: [],
        notes: [],
        params: {
          cameraShots: [
            {
              id: 'shot:0',
              dataUrl: 'data:image/png;base64,ccc',
              createdAt: '2026-01-01T00:00:00.000Z'
            }
          ]
        }
      }
    })
    expect(summary.images).toBe(1)
    expect(pickGraphRunSuccessMessageKey(summary)).toBe('completeImages')
  })

  it('counts text notes for screenplay / visual workflows', () => {
    const summary = summarizeGraphRunOutput({
      contribution: { genRefs: [], audioRefs: [] },
      output: {
        kind: 'output',
        outputKind: 'image',
        items: [],
        notes: [{ kind: 'text', text: '独白' }, { kind: 'text', text: '  ' }],
        params: {}
      }
    })
    expect(summary.text).toBe(1)
    expect(pickGraphRunSuccessMessageKey(summary)).toBe('completeText')
  })

  it('uses noRefs only when output exists but all channels empty', () => {
    const summary = summarizeGraphRunOutput({
      contribution: { genRefs: [], audioRefs: [] },
      output: {
        kind: 'output',
        outputKind: 'video',
        items: [],
        notes: [],
        params: {}
      }
    })
    expect(pickGraphRunSuccessMessageKey(summary)).toBe('noRefs')
  })

  it('uses completeOk when intermediate node run has no output value', () => {
    const summary = summarizeGraphRunOutput({
      contribution: undefined,
      output: undefined
    })
    expect(summary.hasOutput).toBe(false)
    expect(pickGraphRunSuccessMessageKey(summary)).toBe('completeOk')
  })

  it('prefers asset contribution over images/text', () => {
    const summary = summarizeGraphRunOutput({
      contribution: {
        genRefs: [{ role: 'character', assetId: 'a1', refIndex: 1, weight: 0.85 }],
        audioRefs: []
      },
      output: {
        kind: 'output',
        outputKind: 'image',
        items: [],
        notes: [{ kind: 'text', text: 'note' }],
        params: {},
        images: [{ dataUrl: 'data:image/png;base64,x' }]
      }
    })
    expect(pickGraphRunSuccessMessageKey(summary)).toBe('complete')
  })
})
