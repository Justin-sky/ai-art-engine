import { describe, expect, it, vi } from 'vitest'
import {
  buildModelChain,
  modelRefKey,
  parseModelChain,
  parseModelRefKey,
  runWithModelFallback,
  serializeModelChain
} from '../src/shared/graph/modelFallback'

const PRIMARY = { providerInstanceId: 'p1', model: 'm1' }
const BACKUP = { providerInstanceId: 'p2', model: 'm2' }
const THIRD = { providerInstanceId: 'p3', model: 'm3' }

describe('model chain parsing', () => {
  it('builds and parses model keys', () => {
    expect(modelRefKey(PRIMARY)).toBe('p1::m1')
    expect(parseModelRefKey('p1::m1')).toEqual(PRIMARY)
    expect(parseModelRefKey('m1')).toBeNull()
    expect(parseModelRefKey('')).toBeNull()
    expect(modelRefKey({ model: 'm1' })).toBe('')
  })

  it('parses array / JSON / delimited text and drops invalid entries', () => {
    expect(parseModelChain(['p2::m2', 'p3::m3'])).toEqual([BACKUP, THIRD])
    expect(parseModelChain('["p2::m2","p3::m3"]')).toEqual([BACKUP, THIRD])
    expect(parseModelChain('p2::m2\np3::m3')).toEqual([BACKUP, THIRD])
    expect(parseModelChain('p2::m2,p3::m3')).toEqual([BACKUP, THIRD])
    expect(parseModelChain(['garbage', 'p2::m2'])).toEqual([BACKUP])
    expect(parseModelChain(undefined)).toEqual([])
    expect(parseModelChain('')).toEqual([])
  })

  it('serializes back to a model key list', () => {
    expect(serializeModelChain([PRIMARY, BACKUP])).toEqual(['p1::m1', 'p2::m2'])
  })

  it('buildModelChain puts primary first and de-duplicates fallbacks', () => {
    expect(buildModelChain(PRIMARY, [BACKUP, PRIMARY, BACKUP])).toEqual([PRIMARY, BACKUP])
  })

  it('buildModelChain keeps a primary without provider (legacy graphs)', () => {
    expect(buildModelChain({ model: 'legacy' }, [BACKUP])).toEqual([{ model: 'legacy' }, BACKUP])
  })
})

describe('runWithModelFallback', () => {
  it('uses the primary model when it succeeds', async () => {
    const call = vi.fn(async () => 'ok')
    const result = await runWithModelFallback([PRIMARY, BACKUP], call)
    expect(result.value).toBe('ok')
    expect(result.used).toEqual(PRIMARY)
    expect(result.skipped).toEqual([])
    expect(call).toHaveBeenCalledTimes(1)
  })

  it('switches to the next candidate when the primary throws', async () => {
    const call = vi.fn(async (ref: { model?: string }) => {
      if (ref.model === 'm1') throw new Error('rate limited')
      return 'ok'
    })
    const onFallback = vi.fn()
    const result = await runWithModelFallback([PRIMARY, BACKUP], call, { onFallback })
    expect(result.value).toBe('ok')
    expect(result.used).toEqual(BACKUP)
    expect(result.skipped).toEqual([{ ...PRIMARY, error: 'rate limited' }])
    expect(onFallback).toHaveBeenCalledWith(PRIMARY, 'rate limited', BACKUP)
  })

  it('rethrows the last error when every candidate fails', async () => {
    const call = vi.fn(async () => {
      throw new Error('all down')
    })
    await expect(runWithModelFallback([PRIMARY, BACKUP], call)).rejects.toThrow('all down')
    expect(call).toHaveBeenCalledTimes(2)
  })

  it('stops retrying when the user aborts', async () => {
    const call = vi.fn(async () => {
      throw new DOMException('Aborted', 'AbortError')
    })
    await expect(runWithModelFallback([PRIMARY, BACKUP], call)).rejects.toThrow()
    // 中止不是模型故障，换模型只会白烧钱
    expect(call).toHaveBeenCalledTimes(1)
  })

  it('honors a custom isRetryable predicate', async () => {
    const call = vi.fn(async () => {
      throw new Error('bad request')
    })
    await expect(
      runWithModelFallback([PRIMARY, BACKUP], call, {
        isRetryable: (err) => !(err instanceof Error && err.message === 'bad request')
      })
    ).rejects.toThrow('bad request')
    expect(call).toHaveBeenCalledTimes(1)
  })
})
