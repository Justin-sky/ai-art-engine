import { describe, expect, it } from 'vitest'
import {
  buildAgentPipelineOverview,
  collectAgentReviewRows,
  collectAgentReworkRows,
  createNodeFromType,
  isAgentPipelineNode,
  serializeMediaReworkState,
  type GraphNode
} from '../src/shared/graph'

function reviewNode(overrides: Record<string, unknown> = {}): GraphNode {
  const node = createNodeFromType('media.review', { x: 0, y: 0 })
  node.params = { ...node.params, ...overrides }
  return node
}

function reworkNode(overrides: Record<string, unknown> = {}): GraphNode {
  const node = createNodeFromType('media.rework', { x: 0, y: 0 })
  node.params = { ...node.params, ...overrides }
  return node
}

describe('agent pipeline overview', () => {
  it('recognizes media.review / media.rework as pipeline nodes', () => {
    expect(isAgentPipelineNode(reviewNode())).toBe(true)
    expect(isAgentPipelineNode(reworkNode())).toBe(true)
    expect(isAgentPipelineNode(createNodeFromType('asset.image', { x: 0, y: 0 }))).toBe(false)
    expect(isAgentPipelineNode(createNodeFromType('note.text', { x: 0, y: 0 }))).toBe(false)
  })

  it('collects review rows with pending / PASS / FAIL statuses', () => {
    const nodes = [
      reviewNode(),
      reviewNode({ mediaReviewPending: false, mediaReviewStatus: 'PASS' }),
      reviewNode({ mediaReviewPending: false, mediaReviewStatus: 'FAIL', mediaReviewReason: '糊脸' })
    ]
    const rows = collectAgentReviewRows(nodes)
    expect(rows.map((r) => r.status)).toEqual(['pending', 'PASS', 'FAIL'])
    expect(rows[2]!.reason).toBe('糊脸')
  })

  it('collects rework rows, falling back to serialized state', () => {
    const exhausted = serializeMediaReworkState({
      attempt: 3,
      maxAttempts: 3,
      status: 'exhausted',
      lastReason: '手指畸形',
      iterations: [{ attempt: 1, result: 'FAIL', reason: 'a', at: 'x' }]
    })
    const nodes = [
      reworkNode(),
      reworkNode({ mediaReworkState: exhausted, mediaReviewStatus: 'FAIL', mediaReviewReason: '手指畸形' })
    ]
    const rows = collectAgentReworkRows(nodes)
    expect(rows[0]!.status).toBe('running')
    expect(rows[0]!.attempt).toBe(0)
    expect(rows[1]!.status).toBe('exhausted')
    expect(rows[1]!.attempt).toBe(3)
    expect(rows[1]!.maxAttempts).toBe(3)
    expect(rows[1]!.lastReason).toBe('手指畸形')
    expect(rows[1]!.finalResult).toBe('FAIL')
  })

  it('summarizes counts and last fail reason', () => {
    const exhausted = serializeMediaReworkState({
      attempt: 2,
      maxAttempts: 2,
      status: 'exhausted',
      lastReason: '多手指',
      iterations: []
    })
    const overview = buildAgentPipelineOverview([
      reviewNode(),
      reviewNode({ mediaReviewPending: false, mediaReviewStatus: 'FAIL', mediaReviewReason: '错乱主体' }),
      reworkNode({ mediaReworkState: exhausted, mediaReviewStatus: 'FAIL', mediaReviewReason: '多手指' })
    ])
    expect(overview.hasPipeline).toBe(true)
    expect(overview.reviewRows).toHaveLength(2)
    expect(overview.reworkRows).toHaveLength(1)
    expect(overview.pendingCount).toBe(1)
    expect(overview.failCount).toBe(1)
    expect(overview.exhaustedCount).toBe(1)
    expect(overview.lastFailReason).toBe('多手指')
  })

  it('reports empty pipeline when no agent nodes present', () => {
    const overview = buildAgentPipelineOverview([createNodeFromType('asset.image', { x: 0, y: 0 })])
    expect(overview.hasPipeline).toBe(false)
    expect(overview.pendingCount).toBe(0)
    expect(overview.lastFailReason).toBe('')
  })

  it('projects run failures from runStates into the error panel', () => {
    const nodes = [
      createNodeFromType('play.script', { x: 0, y: 0 }, { id: 'n1', title: '脚本' }),
      createNodeFromType('asset.image', { x: 0, y: 0 }, { id: 'n2' }),
      createNodeFromType('media.review', { x: 0, y: 0 }, { id: 'n3', title: '质检' })
    ]
    const overview = buildAgentPipelineOverview(nodes, {
      n1: { status: 'error', error: '模型限流' },
      n2: { status: 'degraded', error: 'GRAPH_LOCK_NO_CACHE' }
    })
    expect(overview.errorRows).toHaveLength(2)
    expect(overview.errorRows[0]).toMatchObject({
      nodeId: 'n1',
      title: '脚本',
      status: 'error',
      reason: '模型限流'
    })
    expect(overview.errorRows[1]).toMatchObject({
      nodeId: 'n2',
      status: 'degraded',
      reason: 'GRAPH_LOCK_NO_CACHE'
    })
    expect(overview.errorCount).toBe(1)
    expect(overview.degradedCount).toBe(1)
    expect(overview.hasIssues).toBe(true)
  })

  it('reports no issues when runStates are absent', () => {
    const overview = buildAgentPipelineOverview([createNodeFromType('asset.image', { x: 0, y: 0 })])
    expect(overview.errorRows).toEqual([])
    expect(overview.errorCount).toBe(0)
    expect(overview.degradedCount).toBe(0)
    expect(overview.hasIssues).toBe(false)
  })
})
