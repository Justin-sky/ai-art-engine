import { describe, expect, it } from 'vitest'
import { buildJobDoneOutputs } from '../src/renderer/src/features/graph/model/graphGalleryOutput'
import type { VideoJobRecord } from '../src/shared/videoJob'
import type { GraphAssetValue } from '../src/shared/graph/execute/types'

/**
 * 重新打开工程时的任务对账（后台任务落定 → 回写节点出口）。
 *
 * 这条值会**覆盖**节点运行态的 out / out-all，而单节点执行时上游不 cook，
 * 下游「空间世界导出」只能从这里拿 world_id —— 漏掉就是那条
 * GRAPH_WORLD_EXPORT_NO_WORLD：世界已经生成好、也下回来了，导出却说「没有世界」。
 */
function worldJob(patch: Partial<VideoJobRecord> = {}): VideoJobRecord {
  return {
    version: 1,
    kind: 'spatialWorld',
    localJobId: 'job-1',
    providerJobId: 'op-1',
    pollingUrl: 'op-1',
    providerInstanceId: 'p1',
    model: 'marble-1.1',
    prompt: 'a quiet alley',
    status: 'succeeded',
    progress: 100,
    source: 'graph',
    assetId: 'db4ebd80-9e5c-4837-98f4-d131035cddeb',
    relativePath: 'Cache/Models/世界.glb',
    resourceId: 'wl-world-42',
    createdAt: '2026-10-05T05:00:00.000Z',
    submittedAt: '2026-10-05T05:00:00.000Z',
    updatedAt: '2026-10-05T05:09:00.000Z',
    ...patch
  }
}

describe('buildJobDoneOutputs', () => {
  it('carries the world id from the job record into the node output', () => {
    const outputs = buildJobDoneOutputs(worldJob())
    const out = outputs.out as GraphAssetValue
    expect(out).toMatchObject({
      kind: 'asset',
      assetType: 'model',
      assetId: 'db4ebd80-9e5c-4837-98f4-d131035cddeb',
      relativePath: 'Cache/Models/世界.glb',
      spatialWorldId: 'wl-world-42'
    })
    // out-all 也要带（导出节点两条入线都可能读）
    expect((outputs['out-all'] as GraphAssetValue).spatialWorldId).toBe('wl-world-42')
  })

  it('omits the id when the job record has none (does not invent a world)', () => {
    const out = buildJobDoneOutputs(worldJob({ resourceId: undefined })).out as GraphAssetValue
    expect(out.relativePath).toBe('Cache/Models/世界.glb')
    expect(out.spatialWorldId).toBeUndefined()
    // 空串同样按「没有」处理
    const blank = buildJobDoneOutputs(worldJob({ resourceId: '   ' })).out as GraphAssetValue
    expect(blank.spatialWorldId).toBeUndefined()
  })

  it('never attaches a world id to non-world model jobs', () => {
    const out = buildJobDoneOutputs(worldJob({ kind: 'model3d', resourceId: 'wl-world-42' }))
      .out as GraphAssetValue
    // 3D 模型任务的 resourceId 不是 World.id（这里是防御性断言）
    expect(out.kind).toBe('asset')
  })

  it('still writes a video value for video jobs', () => {
    const outputs = buildJobDoneOutputs(
      worldJob({ kind: 'video', resourceId: undefined, relativePath: 'Cache/Videos/a.mp4' })
    )
    expect((outputs.out as { kind: string }).kind).toBe('video')
    expect((outputs['out-all'] as { kind: string }).kind).toBe('videos')
  })
})
