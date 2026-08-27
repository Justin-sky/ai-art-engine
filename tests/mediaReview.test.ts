import { describe, expect, it, vi } from 'vitest'
import { createNodeFromType } from '../src/shared/graph'
import { executeMediaReviewNode } from '../src/shared/graph/execute'
import type { NodeExecuteContext } from '../src/shared/graph/execute/types'
import {
  buildMediaReviewPack,
  MEDIA_REVIEW_CHECKLIST_EN,
  MEDIA_REVIEW_CHECKLIST_ZH,
  mediaReviewCachedText,
  mediaReviewParamsFromVerdict,
  parseMediaReviewVerdict
} from '../src/shared/graph/mediaReview'

function baseCtx(
  overrides: Partial<NodeExecuteContext> & { node: NodeExecuteContext['node'] }
): NodeExecuteContext {
  return {
    inputs: {},
    locale: 'zh-CN',
    ...overrides
  }
}

describe('buildMediaReviewPack', () => {
  it('embeds media checklist, framework and output protocol in both languages', () => {
    const pack = buildMediaReviewPack()
    expect(pack.systemPromptZh).toContain('审核对象：生成结果')
    expect(pack.systemPromptZh).toContain(MEDIA_REVIEW_CHECKLIST_ZH)
    expect(pack.systemPromptZh).toContain('## 结论: PASS')
    expect(pack.systemPromptEn).toContain('Review target: generated media')
    expect(pack.systemPromptEn).toContain(MEDIA_REVIEW_CHECKLIST_EN)
    expect(pack.instructionZh).toContain('## 结论: PASS')
  })

  it('honors custom target and context', () => {
    const pack = buildMediaReviewPack({ targetZh: '主视觉图', contextZh: '对照 @1' })
    expect(pack.systemPromptZh).toContain('审核对象：主视觉图')
    expect(pack.instructionZh).toContain('对照 @1')
  })
})

describe('parseMediaReviewVerdict', () => {
  it('parses PASS and FAIL with inline reason', () => {
    expect(parseMediaReviewVerdict('## 结论: PASS')).toEqual({ result: 'PASS', reason: '' })
    expect(parseMediaReviewVerdict('## 结论: FAIL (原因: 缺手指；风格漂移)')).toEqual({
      result: 'FAIL',
      reason: '缺手指；风格漂移'
    })
  })

  it('parses full-width colon and next-line reason', () => {
    expect(parseMediaReviewVerdict('## 结论：FAIL\n主体不清晰')).toEqual({
      result: 'FAIL',
      reason: '主体不清晰'
    })
  })

  it('returns null when no conclusion line', () => {
    expect(parseMediaReviewVerdict('随便一段没有结论的文本')).toBeNull()
  })
})

describe('mediaReviewParamsFromVerdict / mediaReviewCachedText', () => {
  it('maps verdict to params patch', () => {
    expect(mediaReviewParamsFromVerdict({ result: 'FAIL', reason: '糊脸' })).toEqual({
      mediaReviewStatus: 'FAIL',
      mediaReviewReason: '糊脸',
      mediaReviewPending: false
    })
  })

  it('renders cached text', () => {
    expect(mediaReviewCachedText('PASS', '')).toBe('质检结论: PASS')
    expect(mediaReviewCachedText('FAIL', '缺手指')).toBe('质检结论: FAIL — 缺手指')
  })
})

describe('executeMediaReviewNode', () => {
  const imageInput = (): NodeExecuteContext['inputs'] => ({
    'in-image': [{ kind: 'image', dataUrl: 'data:image/png;base64,AAAA' }]
  })

  it('reviews images, patches PASS and writes text gallery', async () => {
    const node = createNodeFromType('media.review', { x: 0, y: 0 })
    const generateText = vi.fn(async () => ({ text: '## 结论: PASS', model: 'mock' }))
    const patchNode = vi.fn()

    const result = await executeMediaReviewNode(
      baseCtx({ node, generateText, patchNode, inputs: imageInput() })
    )

    expect(generateText).toHaveBeenCalledTimes(1)
    expect(generateText.mock.calls[0]![0].images).toEqual(['data:image/png;base64,AAAA'])
    expect(patchNode).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          mediaReviewStatus: 'PASS',
          mediaReviewPending: false
        })
      })
    )
    expect(node.params.mediaReviewStatus).toBe('PASS')
    expect(result.out.kind).toBe('text')
  })

  it('patches FAIL with reason', async () => {
    const node = createNodeFromType('media.review', { x: 0, y: 0 })
    const generateText = vi.fn(async () => ({
      text: '## 结论: FAIL (原因: 缺手指；风格漂移)',
      model: 'mock'
    }))
    const patchNode = vi.fn()

    await executeMediaReviewNode(
      baseCtx({ node, generateText, patchNode, inputs: imageInput() })
    )

    expect(node.params.mediaReviewStatus).toBe('FAIL')
    expect(node.params.mediaReviewReason).toBe('缺手指；风格漂移')
  })

  it('throws GRAPH_PROCESS_NO_INPUT without images', async () => {
    const node = createNodeFromType('media.review', { x: 0, y: 0 })
    const generateText = vi.fn(async () => ({ text: 'x', model: 'mock' }))

    await expect(
      executeMediaReviewNode(baseCtx({ node, generateText, inputs: {} }))
    ).rejects.toThrow('GRAPH_PROCESS_NO_INPUT')
    expect(generateText).not.toHaveBeenCalled()
  })

  it('reuses cached verdict without calling the model', async () => {
    const node = createNodeFromType('media.review', { x: 0, y: 0 }, {
      params: { mediaReviewStatus: 'PASS', mediaReviewPending: false, text: '## 结论: PASS' }
    })
    const generateText = vi.fn(async () => ({ text: 'x', model: 'mock' }))

    const result = await executeMediaReviewNode(baseCtx({ node, generateText, inputs: {} }))

    expect(generateText).not.toHaveBeenCalled()
    expect(result.out.kind).toBe('text')
    expect(result.out.kind === 'text' && result.out.text).toBe('## 结论: PASS')
  })
})
