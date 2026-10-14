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
    const cleaned = sanitizePersistedRunStates({ a: { status: 'done' }, b: { status: 'done' } }, [
      'a'
    ])
    expect(cleaned).toEqual({ a: { status: 'done' } })
  })

  /**
   * 语义链路的产物**必须落盘**：漏了它们，存档/重开工程后节点状态还是 done 但 outputs 已空，
   * 在重建节点上 Cook 就只会拿到空计划 —— 既不出片也不报错（实测踩到）。
   */
  it('语义时间线 / 提示词计划 / 目录 / 声音等 kind 不再被落盘丢掉', () => {
    const timeline = {
      id: 'stl.keep.1',
      schema: 'aiart.semantic-timeline@1',
      source: { assetId: 'a1', fps: 30, duration: 3, width: 640, height: 360 },
      entities: [],
      events: [],
      beats: [],
      intents: [],
      tracks: [],
      updatedAt: '2026-01-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z'
    }
    const plan = {
      schema: 'aiart.video-prompt-plan@1',
      timelineId: 'stl.keep.1',
      sourceAssetId: 'a1',
      lang: 'zh',
      shots: [{ shotId: 'shot.1', prompt: '推近', durationSec: 3, strategy: 'generate' }],
      fullPrompt: '整片',
      settings: { width: 640, height: 360, fps: 30, durationSec: 3 }
    }
    const snap = exportPersistedRunStates(
      {
        analyze: {
          status: 'done',
          outputs: {
            out: { kind: 'semanticTimeline', doc: timeline, text: JSON.stringify(timeline) }
          }
        },
        compile: {
          status: 'done',
          outputs: { out: { kind: 'videoPrompts', plan, text: JSON.stringify(plan) } }
        },
        world: { status: 'done', outputs: { out: { kind: 'world', text: '{"a":1}' } } },
        beat: { status: 'done', outputs: { out: { kind: 'beat', text: '{"b":1}' } } },
        voice: {
          status: 'done',
          outputs: { out: { kind: 'voice', id: 'v1', relativePath: 'Audio/a.wav' } }
        },
        project: {
          status: 'done',
          outputs: { out: { kind: 'project', relativePath: 'Cache/game/project', gameMode: '2d' } }
        }
      },
      ['analyze', 'compile', 'world', 'beat', 'voice', 'project']
    )
    expect(snap?.analyze?.outputs?.out).toMatchObject({ kind: 'semanticTimeline' })
    expect(snap?.compile?.outputs?.out).toMatchObject({ kind: 'videoPrompts' })
    expect(snap?.world?.outputs?.out).toMatchObject({ kind: 'world' })
    expect(snap?.beat?.outputs?.out).toMatchObject({ kind: 'beat' })
    expect(snap?.voice?.outputs?.out).toMatchObject({ kind: 'voice', id: 'v1' })
    expect(snap?.project?.outputs?.out).toMatchObject({ kind: 'project' })
  })
})
