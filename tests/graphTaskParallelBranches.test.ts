import { describe, expect, it } from 'vitest'
import {
  conflictsWithActiveWorkflow,
  type GraphTaskStatus,
  type GraphTaskTarget
} from '../src/renderer/src/stores/graphTasks'

const target: GraphTaskTarget = {
  kind: 'asset',
  assetId: 'asset-1',
  hostId: 'asset:asset-1'
}

function active(
  targetNodeIds: string[] | undefined,
  status: GraphTaskStatus = 'running'
): { status: GraphTaskStatus; target: GraphTaskTarget; targetNodeIds?: string[] } {
  return { status, target, targetNodeIds }
}

describe('conflictsWithActiveWorkflow parallel branches', () => {
  it('allows different boundary output branches on the same canvas', () => {
    expect(
      conflictsWithActiveWorkflow(target, ['out-b'], [active(['out-a'])])
    ).toBe(false)
  })

  it('rejects the same branch twice', () => {
    expect(
      conflictsWithActiveWorkflow(target, ['out-a'], [active(['out-a'])])
    ).toBe(true)
  })

  it('rejects a full-graph enqueue while a branch is running', () => {
    expect(conflictsWithActiveWorkflow(target, undefined, [active(['out-a'])])).toBe(true)
  })

  it('rejects a branch enqueue while a full-graph task is running', () => {
    expect(conflictsWithActiveWorkflow(target, ['out-a'], [active(undefined)])).toBe(true)
  })
})
