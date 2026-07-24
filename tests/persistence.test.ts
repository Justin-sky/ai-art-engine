import { describe, expect, it, vi } from 'vitest'
import { runTransactionSync } from '../src/main/persistence/transactionRunner'
import { isAttachCompatible } from '../src/shared/import'

describe('persistence transaction', () => {
  it('rolls back completed steps in reverse order', () => {
    const state: string[] = []
    expect(() =>
      runTransactionSync([
        {
          label: 'first',
          forward: () => { state.push('first') },
          rollback: () => { state.push('undo-first') }
        },
        {
          label: 'second',
          forward: () => { throw new Error('failed') },
          rollback: vi.fn()
        }
      ])
    ).toThrow('failed')
    expect(state).toEqual(['first', 'undo-first'])
  })
})

describe('asset attach policy', () => {
  it('accepts director media attachments', () => {
    expect(isAttachCompatible('motion', 'model', 'stage.glb')).toBe(true)
    expect(isAttachCompatible('motion', 'model', 'stage.fbx')).toBe(true)
    expect(isAttachCompatible('image', 'image', 'scene.png')).toBe(true)
  })

  it('rejects incompatible media', () => {
    expect(isAttachCompatible('voice', 'image', 'voice.png')).toBe(false)
    expect(isAttachCompatible('image', 'video', 'clip.mp4')).toBe(false)
  })
})
