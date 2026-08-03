import { describe, expect, it } from 'vitest'
import {
  isOlderGraphTaskPeer,
  listSharedNodeIds,
  mergeDoneRunStates,
  peerBlocksSharedUpstream
} from '../src/renderer/src/stores/graphTasks'

describe('graph task shared upstream reuse helpers', () => {
  it('mergeDoneRunStates keeps only done nodes and later sources win', () => {
    const merged = mergeDoneRunStates(
      {
        a: { status: 'done', outputs: { out: { kind: 'text', text: '1' } } },
        b: { status: 'running' }
      },
      {
        a: { status: 'done', outputs: { out: { kind: 'text', text: '2' } } },
        c: { status: 'error', error: 'x' }
      }
    )
    expect(Object.keys(merged).sort()).toEqual(['a'])
    expect(merged.a.outputs?.out).toEqual({ kind: 'text', text: '2' })
  })

  it('isOlderGraphTaskPeer prefers earlier createdAt then smaller id', () => {
    expect(
      isOlderGraphTaskPeer({ id: 'b', createdAt: 2 }, { id: 'a', createdAt: 1 })
    ).toBe(true)
    expect(
      isOlderGraphTaskPeer({ id: 'b', createdAt: 1 }, { id: 'a', createdAt: 1 })
    ).toBe(true)
    expect(
      isOlderGraphTaskPeer({ id: 'a', createdAt: 1 }, { id: 'b', createdAt: 1 })
    ).toBe(false)
  })

  it('listSharedNodeIds returns intersection preserving b order', () => {
    expect(listSharedNodeIds(['a', 'b', 'c'], ['c', 'x', 'a'])).toEqual(['c', 'a'])
  })

  it('peerBlocksSharedUpstream while shared nodes are still pending/running', () => {
    const peer = {
      status: 'running' as const,
      order: ['shared', 'leaf'],
      runStates: {
        shared: { status: 'running' },
        leaf: { status: 'pending' }
      }
    }
    expect(peerBlocksSharedUpstream(peer, ['shared'])).toBe(true)
    peer.runStates.shared = { status: 'done' }
    expect(peerBlocksSharedUpstream(peer, ['shared'])).toBe(false)
    expect(peerBlocksSharedUpstream(peer, ['leaf'])).toBe(true)
    peer.runStates.leaf = { status: 'error', error: 'x' }
    expect(peerBlocksSharedUpstream(peer, ['leaf'])).toBe(false)
  })
})
