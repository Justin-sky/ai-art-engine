import { describe, expect, it, vi } from 'vitest'
import { createNodeFromType } from '../src/shared/graph'
import { executeMediaReworkNode } from '../src/shared/graph/execute'
import type { NodeExecuteContext } from '../src/shared/graph/execute/types'
import {
  applyMediaReworkReview,
  buildMediaReworkInstruction,
  clampMediaReworkMaxAttempts,
  createMediaReworkState,
  MEDIA_REWORK_DEFAULT_MAX_ATTEMPTS,
  mediaReworkLogLines,
  parseMediaReworkState,
  serializeMediaReworkState,
  shouldMediaReworkContinue
} from '../src/shared/graph/mediaRework'

function baseCtx(
  overrides: Partial<NodeExecuteContext> & { node: NodeExecuteContext['node'] }
): NodeExecuteContext {
  return {
    inputs: {},
    locale: 'zh-CN',
    ...overrides
  }
}

describe('clampMediaReworkMaxAttempts', () => {
  it('clamps into [1, 8] and defaults invalid input', () => {
    expect(clampMediaReworkMaxAttempts(undefined)).toBe(MEDIA_REWORK_DEFAULT_MAX_ATTEMPTS)
    expect(clampMediaReworkMaxAttempts(0)).toBe(1)
    expect(clampMediaReworkMaxAttempts(99)).toBe(8)
    expect(clampMediaReworkMaxAttempts('2.6')).toBe(3)
    expect(clampMediaReworkMaxAttempts('x')).toBe(MEDIA_REWORK_DEFAULT_MAX_ATTEMPTS)
  })
})

describe('createMediaReworkState / shouldMediaReworkContinue', () => {
  it('starts running with zero attempts', () => {
    const state = createMediaReworkState(3)
    expect(state).toMatchObject({ attempt: 0, maxAttempts: 3, status: 'running', lastReason: '' })
    expect(state.iterations).toEqual([])
    expect(shouldMediaReworkContinue(state)).toBe(true)
  })

  it('stops when passed or at max attempts', () => {
    expect(shouldMediaReworkContinue({ ...createMediaReworkState(2), status: 'passed' })).toBe(false)
    expect(
      shouldMediaReworkContinue({ ...createMediaReworkState(2), attempt: 2, status: 'running' })
    ).toBe(false)
  })
})

describe('applyMediaReworkReview', () => {
  it('PASS advances to passed and clears lastReason', () => {
    const state = applyMediaReworkReview(createMediaReworkState(3), 'PASS', '')
    expect(state.attempt).toBe(1)
    expect(state.status).toBe('passed')
    expect(state.lastReason).toBe('')
    expect(state.iterations).toHaveLength(1)
  })

  it('FAIL under limit keeps running and records reason', () => {
    const state = applyMediaReworkReview(createMediaReworkState(3), 'FAIL', '缺手指')
    expect(state.attempt).toBe(1)
    expect(state.status).toBe('running')
    expect(state.lastReason).toBe('缺手指')
  })

  it('FAIL at limit becomes exhausted', () => {
    const one = applyMediaReworkReview(createMediaReworkState(2), 'FAIL', 'a')
    const two = applyMediaReworkReview(one, 'FAIL', 'b')
    expect(two.attempt).toBe(2)
    expect(two.status).toBe('exhausted')
    expect(two.iterations).toHaveLength(2)
  })
})

describe('buildMediaReworkInstruction / mediaReworkLogLines', () => {
  it('injects FAIL reason into base instruction', () => {
    const out = buildMediaReworkInstruction('一只猫', '缺手指', 'zh-CN')
    expect(out).toContain('一只猫')
    expect(out).toContain('缺手指')
    expect(out).toContain('上次质检 FAIL 原因')
  })

  it('returns base unchanged when no reason', () => {
    expect(buildMediaReworkInstruction('一只猫', '', 'zh-CN')).toBe('一只猫')
  })

  it('renders english directive', () => {
    expect(buildMediaReworkInstruction('a cat', 'missing finger', 'en-US')).toContain(
      'Fix the following issues'
    )
  })

  it('renders log lines', () => {
    const state = applyMediaReworkReview(
      applyMediaReworkReview(createMediaReworkState(3), 'FAIL', '糊脸'),
      'PASS',
      ''
    )
    expect(mediaReworkLogLines(state)).toEqual(['#1 FAIL: 糊脸', '#2 PASS'])
  })
})

describe('serializeMediaReworkState / parseMediaReworkState', () => {
  it('round-trips', () => {
    const state = applyMediaReworkReview(createMediaReworkState(3), 'FAIL', '缺手指')
    expect(parseMediaReworkState(serializeMediaReworkState(state))).toEqual(state)
  })

  it('returns null on empty / invalid', () => {
    expect(parseMediaReworkState('')).toBeNull()
    expect(parseMediaReworkState(null)).toBeNull()
    expect(parseMediaReworkState('not json')).toBeNull()
    expect(parseMediaReworkState('{"noAttempt":true}')).toBeNull()
  })
})

describe('executeMediaReworkNode', () => {
  function genImage() {
    return vi.fn(async () => ({ images: ['data:image/png;base64,AAAA'], model: 'mock' }))
  }

  it('passes on first attempt and writes gallery', async () => {
    const node = createNodeFromType('media.rework', { x: 0, y: 0 }, {
      params: { generateInstruction: '一只猫' }
    })
    const generateImage = genImage()
    const generateText = vi.fn(async () => ({ text: '## 结论: PASS', model: 'mock' }))
    const patchNode = vi.fn()

    const result = await executeMediaReworkNode(
      baseCtx({ node, generateImage, generateText, patchNode })
    )

    expect(generateImage).toHaveBeenCalledTimes(1)
    expect(generateText).toHaveBeenCalledTimes(1)
    expect(node.params.mediaReworkStatus).toBe('passed')
    expect(node.params.mediaReviewStatus).toBe('PASS')
    expect(result.out.kind).toBe('image')
  })

  it('FAIL then PASS: retries with injected reason and converges', async () => {
    const node = createNodeFromType('media.rework', { x: 0, y: 0 }, {
      params: { generateInstruction: '一只猫' }
    })
    const generateImage = genImage()
    let textCalls = 0
    const generateText = vi.fn(async () => {
      textCalls += 1
      return textCalls === 1
        ? { text: '## 结论: FAIL (原因: 缺手指)', model: 'mock' }
        : { text: '## 结论: PASS', model: 'mock' }
    })

    await executeMediaReworkNode(baseCtx({ node, generateImage, generateText }))

    expect(generateImage).toHaveBeenCalledTimes(2)
    expect(generateText).toHaveBeenCalledTimes(2)
    expect(node.params.mediaReworkStatus).toBe('passed')
    expect(parseMediaReworkState(node.params.mediaReworkState)?.attempt).toBe(2)
    const secondPrompt = generateImage.mock.calls[1]![0].prompt as string
    expect(secondPrompt).toContain('缺手指')
  })

  it('exhausts at max attempts and marks FAIL', async () => {
    const node = createNodeFromType('media.rework', { x: 0, y: 0 }, {
      params: { generateInstruction: '一只猫', mediaReworkMaxAttempts: 2 }
    })
    const generateImage = genImage()
    const generateText = vi.fn(async () => ({
      text: '## 结论: FAIL (原因: 风格漂移)',
      model: 'mock'
    }))

    await executeMediaReworkNode(baseCtx({ node, generateImage, generateText }))

    expect(generateImage).toHaveBeenCalledTimes(2)
    expect(generateText).toHaveBeenCalledTimes(2)
    expect(node.params.mediaReworkStatus).toBe('exhausted')
    expect(node.params.mediaReviewStatus).toBe('FAIL')
    expect(node.params.mediaReviewReason).toBe('风格漂移')
  })

  it('without model returns empty images', async () => {
    const node = createNodeFromType('media.rework', { x: 0, y: 0 }, {
      params: { generateInstruction: '一只猫' }
    })
    const result = await executeMediaReworkNode(baseCtx({ node }))
    expect(result.out.kind).toBe('images')
  })
})
