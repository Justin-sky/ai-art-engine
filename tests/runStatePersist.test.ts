import { describe, expect, it } from 'vitest'
import {
  exportPersistedRunStates,
  importPersistedRunStates,
  sanitizePersistedRunStates
} from '../src/shared/graph/runStatePersist'
import type { GraphNodeRunState } from '../src/shared/graph'

describe('run state persist', () => {
  it('keeps light outputs; strips bare dataUrl images; converts running to error', () => {
    const live: Record<string, GraphNodeRunState> = {
      a: { status: 'done', outputs: { out: { kind: 'text', text: 'x' } } },
      b: { status: 'running' },
      c: { status: 'idle' },
      d: { status: 'error', error: 'boom' },
      img: {
        status: 'done',
        outputs: {
          out: { kind: 'image', dataUrl: 'data:image/png;base64,abc' }
        }
      },
      asset: {
        status: 'done',
        outputs: {
          out: {
            kind: 'asset',
            assetId: 'a1',
            assetType: 'image',
            title: 'Pic'
          }
        }
      },
      gone: { status: 'done' }
    }
    const snap = exportPersistedRunStates(live, ['a', 'b', 'c', 'd', 'img', 'asset'])
    expect(snap).toEqual({
      a: { status: 'done', outputs: { out: { kind: 'text', text: 'x' } } },
      b: { status: 'error', error: 'Interrupted' },
      d: { status: 'error', error: 'boom' },
      img: { status: 'done' },
      asset: {
        status: 'done',
        outputs: {
          out: {
            kind: 'asset',
            assetId: 'a1',
            assetType: 'image',
            title: 'Pic'
          }
        }
      }
    })
  })

  it('keeps materialized image relativePath without dataUrl', () => {
    const snap = exportPersistedRunStates(
      {
        n: {
          status: 'done',
          outputs: {
            out: {
              kind: 'image',
              dataUrl: '',
              relativePath: '.aiartengine/graph-outputs/n.png'
            }
          }
        }
      },
      ['n']
    )
    expect(snap).toEqual({
      n: {
        status: 'done',
        outputs: {
          out: {
            kind: 'image',
            dataUrl: '',
            relativePath: '.aiartengine/graph-outputs/n.png'
          }
        }
      }
    })
  })

  it('import clears previous and restores snapshot with outputs', () => {
    const target: Record<string, GraphNodeRunState> = {
      old: { status: 'done' }
    }
    importPersistedRunStates(
      target,
      {
        a: {
          status: 'done',
          outputs: { out: { kind: 'text', text: 'hi' } }
        },
        b: { status: 'error', error: 'x' }
      },
      ['a', 'b']
    )
    expect(target).toEqual({
      a: { status: 'done', outputs: { out: { kind: 'text', text: 'hi' } } },
      b: { status: 'error', error: 'x' }
    })
  })

  it('sanitize keeps only known node ids', () => {
    const cleaned = sanitizePersistedRunStates(
      { a: { status: 'done' }, b: { status: 'done' } },
      ['a']
    )
    expect(cleaned).toEqual({ a: { status: 'done' } })
  })
})
