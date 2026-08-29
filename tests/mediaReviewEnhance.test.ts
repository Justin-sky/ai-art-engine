import { describe, expect, it, vi } from 'vitest'
import { createNodeFromType } from '../src/shared/graph'
import {
  executeMediaReviewNode,
  executeMediaReworkNode
} from '../src/shared/graph/execute'
import { describeAspectRatio, readImageDimensions } from '../src/shared/graph/execute/imageDimensions'
import type { NodeExecuteContext } from '../src/shared/graph/execute/types'
import {
  checkMediaObjective,
  parseMediaReviewScores,
  resolveMediaReviewRoles,
  resolveReviewModel
} from '../src/shared/graph/mediaReview'
import {
  applyMediaReworkReview,
  createMediaReworkState,
  resolveReworkStrategy,
  selectBestIteration,
  shouldMediaReworkContinue
} from '../src/shared/graph/mediaRework'

function baseCtx(
  overrides: Partial<NodeExecuteContext> & { node: NodeExecuteContext['node'] }
): NodeExecuteContext {
  return { inputs: {}, locale: 'zh-CN', ...overrides }
}

/* ───────────────── P0-1：质检模型与生成模型解耦 ───────────────── */

describe('resolveReviewModel', () => {
  it('prefers the dedicated review model', () => {
    const picked = resolveReviewModel({
      reviewModel: 'vlm-1',
      reviewProviderInstanceId: 'p-vlm',
      generateModel: 'img-1',
      generateProviderInstanceId: 'p-img'
    })
    expect(picked.model).toBe('vlm-1')
    expect(picked.providerInstanceId).toBe('p-vlm')
    expect(picked.dedicated).toBe(true)
  })

  it('falls back to the generate model for legacy graphs', () => {
    const picked = resolveReviewModel({
      generateModel: 'img-1',
      generateProviderInstanceId: 'p-img'
    })
    expect(picked.model).toBe('img-1')
    expect(picked.providerInstanceId).toBe('p-img')
    expect(picked.dedicated).toBe(false)
  })

  it('returns empty selection when nothing is configured', () => {
    expect(resolveReviewModel({}).dedicated).toBe(false)
    expect(resolveReviewModel({}).model).toBeUndefined()
  })
})

/* ───────────────── P0-2：输入身份判定 ───────────────── */

describe('resolveMediaReviewRoles', () => {
  it('treats a single image as the artifact under review', () => {
    expect(resolveMediaReviewRoles(1)).toEqual(['artifact'])
  })

  it('treats the first of several as the reference baseline', () => {
    expect(resolveMediaReviewRoles(3)).toEqual(['reference', 'artifact', 'artifact'])
  })

  it('honors an explicit reference count', () => {
    expect(resolveMediaReviewRoles(3, 0)).toEqual(['artifact', 'artifact', 'artifact'])
    expect(resolveMediaReviewRoles(3, 2)).toEqual(['reference', 'reference', 'artifact'])
  })

  it('never marks every image as reference — at least one must be reviewed', () => {
    expect(resolveMediaReviewRoles(2, 9)).toEqual(['reference', 'artifact'])
    expect(resolveMediaReviewRoles(0)).toEqual([])
  })
})

/* ───────────────── P2：五维评分解析 ───────────────── */

describe('parseMediaReviewScores', () => {
  const checklist = [
    '## 审核清单',
    '1. 完整性：4 — 覆盖完整',
    '2. 一致性：3 — 风格略偏',
    '3. 结构与规范：5 — 齐全',
    '4. 逻辑与合理性：4 — 成立',
    '5. 可执行性：4 — 可用',
    '',
    '## 结论: PASS'
  ].join('\n')

  it('parses every scored dimension', () => {
    const scores = parseMediaReviewScores(checklist)
    expect(scores?.items).toHaveLength(5)
    expect(scores?.items[1]).toEqual({ name: '一致性', score: 3 })
  })

  it('averages the dimensions', () => {
    // (4 + 3 + 5 + 4 + 4) / 5
    expect(parseMediaReviewScores(checklist)?.average).toBe(4)
  })

  it('parses the english checklist form', () => {
    const text = ['## Review Checklist', '- Completeness: 4/5 — ok', '- Consistency: 3/5 — drift', '', '## 结论: FAIL'].join('\n')
    expect(parseMediaReviewScores(text)?.items).toHaveLength(2)
  })

  it('returns null when the model skipped the checklist', () => {
    expect(parseMediaReviewScores('## 结论: PASS')).toBeNull()
    expect(parseMediaReviewScores('')).toBeNull()
  })
})

/* ───────────────── P1：客观校验 ───────────────── */

describe('checkMediaObjective', () => {
  it('flags a count mismatch only when both sides are known', () => {
    expect(checkMediaObjective({ expectedCount: 4, actualCount: 2 })).toEqual([
      { code: 'count-mismatch', detail: 'expected 4, got 2' }
    ])
    expect(checkMediaObjective({ expectedCount: 2, actualCount: 2 })).toEqual([])
    expect(checkMediaObjective({ expectedCount: 2 })).toEqual([])
  })

  it('compares aspect ratios with tolerance', () => {
    expect(checkMediaObjective({ expectedAspectRatio: '16:9', actualAspectRatio: '1:1' })).toHaveLength(1)
    expect(checkMediaObjective({ expectedAspectRatio: '16:9', actualAspectRatio: '16:9' })).toEqual([])
    expect(checkMediaObjective({ expectedAspectRatio: '16:9' })).toEqual([])
  })

  it('flags a short edge below the minimum', () => {
    expect(
      checkMediaObjective({ minEdge: 1000, actualWidth: 800, actualHeight: 600 })
    ).toHaveLength(1)
    expect(
      checkMediaObjective({ minEdge: 500, actualWidth: 800, actualHeight: 600 })
    ).toEqual([])
  })
})

describe('readImageDimensions', () => {
  it('reads PNG dimensions from the header only', () => {
    const png = makePng(640, 480)
    expect(readImageDimensions(png)).toEqual({ width: 640, height: 480 })
    expect(describeAspectRatio({ width: 640, height: 480 })).toBe('4:3')
  })

  it('reads JPEG dimensions', () => {
    expect(readImageDimensions(makeJpeg(1920, 1080))).toEqual({ width: 1920, height: 1080 })
    expect(describeAspectRatio({ width: 1920, height: 1080 })).toBe('16:9')
  })

  it('reads WebP VP8X dimensions', () => {
    expect(readImageDimensions(makeWebpVp8x(1280, 720))).toEqual({ width: 1280, height: 720 })
  })

  it('returns null instead of throwing on garbage input', () => {
    expect(readImageDimensions('data:image/png;base64,AAAA')).toBeNull()
    expect(readImageDimensions('not-a-data-url')).toBeNull()
    expect(readImageDimensions('')).toBeNull()
  })
})

function makePng(width: number, height: number): string {
  const bytes = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52,
    (width >>> 24) & 0xff, (width >>> 16) & 0xff, (width >>> 8) & 0xff, width & 0xff,
    (height >>> 24) & 0xff, (height >>> 16) & 0xff, (height >>> 8) & 0xff, height & 0xff,
    0x08, 0x02, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00
  ])
  return `data:image/png;base64,${bytes.toString('base64')}`
}

function makeJpeg(width: number, height: number): string {
  const bytes = Buffer.from([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >>> 8) & 0xff, height & 0xff,
    (width >>> 8) & 0xff, width & 0xff,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    0xff, 0xd9
  ])
  return `data:image/jpeg;base64,${bytes.toString('base64')}`
}

function makeWebpVp8x(width: number, height: number): string {
  const bytes = Buffer.from([
    0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00,
    0x57, 0x45, 0x42, 0x50,
    0x56, 0x50, 0x38, 0x58,
    0x0a, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    (width - 1) & 0xff, ((width - 1) >>> 8) & 0xff, ((width - 1) >>> 16) & 0xff,
    (height - 1) & 0xff, ((height - 1) >>> 8) & 0xff, ((height - 1) >>> 16) & 0xff
  ])
  return `data:image/webp;base64,${bytes.toString('base64')}`
}

/* ───────────────── P1：结论未解析不再吃掉尝试额度 ───────────────── */

describe('UNDECIDED handling', () => {
  it('does not consume an attempt when the verdict cannot be parsed', () => {
    const first = applyMediaReworkReview(createMediaReworkState(2), 'UNDECIDED', 'no verdict line')
    expect(first.attempt).toBe(0)
    expect(first.undecidedStreak).toBe(1)
    expect(shouldMediaReworkContinue(first)).toBe(true)
  })

  it('gives up after repeated unparseable verdicts instead of looping forever', () => {
    const first = applyMediaReworkReview(createMediaReworkState(3), 'UNDECIDED', 'x')
    const second = applyMediaReworkReview(first, 'UNDECIDED', 'y')
    expect(second.status).toBe('exhausted')
    expect(shouldMediaReworkContinue(second)).toBe(false)
  })

  it('resets the streak once a real verdict arrives', () => {
    const first = applyMediaReworkReview(createMediaReworkState(3), 'UNDECIDED', 'x')
    const second = applyMediaReworkReview(first, 'FAIL', 'blurry')
    expect(second.undecidedStreak).toBe(0)
    expect(second.attempt).toBe(1)
    expect(second.lastReason).toBe('blurry')
  })
})

/* ───────────────── P1：返工策略升档 ───────────────── */

describe('resolveReworkStrategy', () => {
  it('escalates as failures accumulate', () => {
    expect(resolveReworkStrategy('auto', 0)).toBe('guidance')
    expect(resolveReworkStrategy('auto', 1)).toBe('guidance')
    expect(resolveReworkStrategy('auto', 2)).toBe('reseed')
    expect(resolveReworkStrategy('auto', 3)).toBe('stronger')
    expect(resolveReworkStrategy('auto', 9)).toBe('stronger')
  })

  it('honors a pinned strategy', () => {
    expect(resolveReworkStrategy('reseed', 0)).toBe('reseed')
    expect(resolveReworkStrategy('stronger', 3)).toBe('stronger')
  })
})

/* ───────────────── P0-3：多轮取优 ───────────────── */

describe('selectBestIteration', () => {
  it('prefers a PASS over a higher-scoring FAIL', () => {
    let state = createMediaReworkState(3)
    state = applyMediaReworkReview(state, 'FAIL', 'a', { imageIds: ['r1'], score: 5 })
    state = applyMediaReworkReview(state, 'PASS', '', { imageIds: ['r2'], score: 2 })
    expect(selectBestIteration(state)?.imageIds).toEqual(['r2'])
  })

  it('picks the highest score when nothing passed', () => {
    let state = createMediaReworkState(3)
    state = applyMediaReworkReview(state, 'FAIL', 'a', { imageIds: ['r1'], score: 3 })
    state = applyMediaReworkReview(state, 'FAIL', 'b', { imageIds: ['r2'], score: 4.8 })
    expect(selectBestIteration(state)?.imageIds).toEqual(['r2'])
  })

  it('ignores unparseable rounds', () => {
    const state = applyMediaReworkReview(createMediaReworkState(3), 'UNDECIDED', 'x')
    expect(selectBestIteration(state)).toBeNull()
  })
})

/* ───────────────── 执行器行为 ───────────────── */

describe('executeMediaReworkNode (reworked)', () => {
  function genImage() {
    return vi.fn(async () => ({ images: ['data:image/png;base64,AAAA'], model: 'img' }))
  }

  it('sends QC to the review model and generation to the image model', async () => {
    const node = createNodeFromType('media.rework', { x: 0, y: 0 }, {
      params: {
        generateInstruction: '一只猫',
        generateModel: 'img-model',
        reviewModel: 'vlm-model'
      }
    })
    const generateImage = genImage()
    const generateText = vi.fn(async () => ({ text: '## 结论: PASS', model: 'vlm' }))

    await executeMediaReworkNode(baseCtx({ node, generateImage, generateText }))

    expect(generateImage.mock.calls[0]![0].model).toBe('img-model')
    expect(generateText.mock.calls[0]![0].model).toBe('vlm-model')
  })

  it('keeps every attempt in the gallery instead of only the last', async () => {
    const node = createNodeFromType('media.rework', { x: 0, y: 0 }, {
      params: { generateInstruction: '一只猫', mediaReworkMaxAttempts: 3 }
    })
    const generateImage = genImage()
    let calls = 0
    const generateText = vi.fn(async () => {
      calls += 1
      return calls < 3
        ? { text: '## 结论: FAIL (原因: 缺手指)', model: 'vlm' }
        : { text: '## 结论: PASS', model: 'vlm' }
    })

    await executeMediaReworkNode(baseCtx({ node, generateImage, generateText }))

    expect(generateImage).toHaveBeenCalledTimes(3)
    expect(node.params.generatedImages).toHaveLength(3)
  })

  it('pauses after the first attempt when confirm-first is on', async () => {
    const node = createNodeFromType('media.rework', { x: 0, y: 0 }, {
      params: {
        generateInstruction: '一只猫',
        mediaReworkMaxAttempts: 3,
        mediaReworkConfirmFirst: true
      }
    })
    const generateImage = genImage()
    const generateText = vi.fn(async () => ({ text: '## 结论: FAIL (原因: 糊脸)', model: 'vlm' }))

    await executeMediaReworkNode(baseCtx({ node, generateImage, generateText }))

    expect(generateImage).toHaveBeenCalledTimes(1)
    expect(node.params.mediaReworkAwaitingConfirm).toBe(true)
  })

  it('does not burn an attempt when the verdict format is missing', async () => {
    const node = createNodeFromType('media.rework', { x: 0, y: 0 }, {
      params: { generateInstruction: '一只猫', mediaReworkMaxAttempts: 3 }
    })
    const generateImage = genImage()
    const generateText = vi.fn(async () => ({ text: '这张图整体还不错。', model: 'vlm' }))

    await executeMediaReworkNode(baseCtx({ node, generateImage, generateText }))

    // 连续两次无法解析即放弃，而不是把 3 次额度耗在格式问题上
    expect(generateText).toHaveBeenCalledTimes(2)
    expect(node.params.mediaReworkStatus).toBe('exhausted')
  })

  it('records per-round cost and the QC score', async () => {
    const node = createNodeFromType('media.rework', { x: 0, y: 0 }, {
      params: { generateInstruction: '一只猫' }
    })
    const generateImage = genImage()
    const generateText = vi.fn(async () => ({
      text: ['## 审核清单', '1. 完整性：4 — ok', '2. 一致性：4 — ok', '', '## 结论: PASS'].join('\n'),
      model: 'vlm'
    }))

    await executeMediaReworkNode(baseCtx({ node, generateImage, generateText }))

    const cost = JSON.parse(node.params.mediaReworkCost ?? '[]')
    expect(cost).toHaveLength(1)
    expect(cost[0]).toMatchObject({ imageCalls: 1, reviewCalls: 1 })
    expect(JSON.parse(node.params.mediaReviewScores ?? '{}').average).toBe(4)
  })
})

describe('executeMediaReviewNode (reworked)', () => {
  it('uses the dedicated review model', async () => {
    const node = createNodeFromType('media.review', { x: 0, y: 0 }, {
      params: { generateModel: 'img-model', reviewModel: 'vlm-model' }
    })
    const generateText = vi.fn(async () => ({ text: '## 结论: PASS', model: 'vlm' }))

    await executeMediaReviewNode(
      baseCtx({
        node,
        generateText,
        inputs: { 'in-image': [{ kind: 'image', dataUrl: 'data:image/png;base64,AAAA' }] }
      })
    )

    expect(generateText.mock.calls[0]![0].model).toBe('vlm-model')
  })

  it('labels which input is the reference and which is under review', async () => {
    const node = createNodeFromType('media.review', { x: 0, y: 0 })
    const generateText = vi.fn(async () => ({ text: '## 结论: PASS', model: 'vlm' }))

    await executeMediaReviewNode(
      baseCtx({
        node,
        generateText,
        inputs: {
          'in-image': [
            { kind: 'image', dataUrl: 'data:image/png;base64,REF' },
            { kind: 'image', dataUrl: 'data:image/png;base64,OUT' }
          ]
        }
      })
    )

    const prompt = generateText.mock.calls[0]![0].prompt as string
    expect(prompt).toContain('@1 参考图')
    expect(prompt).toContain('@2 待审产物')
  })

  it('stores the parsed scores alongside the verdict', async () => {
    const node = createNodeFromType('media.review', { x: 0, y: 0 })
    const generateText = vi.fn(async () => ({
      text: ['## 审核清单', '1. 完整性：5 — ok', '2. 一致性：3 — drift', '', '## 结论: PASS'].join('\n'),
      model: 'vlm'
    }))

    await executeMediaReviewNode(
      baseCtx({
        node,
        generateText,
        inputs: { 'in-image': [{ kind: 'image', dataUrl: 'data:image/png;base64,AAAA' }] }
      })
    )

    expect(JSON.parse(node.params.mediaReviewScores ?? '{}').average).toBe(4)
  })
})
