import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { VideoJobRecord } from '../src/shared/videoJob'
import { isVideoJobActive, jobKind } from '../src/shared/videoJob'
import { videoJobRepository } from '../src/main/repositories/videoJobRepository'

function makeJob(overrides: Partial<VideoJobRecord> = {}): VideoJobRecord {
  const now = new Date().toISOString()
  return {
    version: 1,
    localJobId: 'x',
    providerJobId: 'p',
    pollingUrl: 'https://example.com/p',
    providerInstanceId: 'pi',
    model: 'm',
    prompt: 'p',
    status: 'submitted',
    progress: 8,
    source: 'graph',
    createdAt: now,
    submittedAt: now,
    updatedAt: now,
    ...overrides
  }
}

/**
 * 3D 模型生成任务：验证 `kind` 判别字段、落盘续拉（listActive）、
 * 任务列表取消（cancelled）与完成登记（succeeded + asset）——不打真实 HTTP。
 */
describe('model3d generation job persistence', () => {
  it('jobKind defaults to video and resolves model3d', () => {
    expect(jobKind(makeJob())).toBe('video')
    expect(jobKind(makeJob({ kind: 'model3d' }))).toBe('model3d')
  })

  it('model3d job roundtrips repository and stays active until cancelled', () => {
    const root = mkdtempSync(join(tmpdir(), 'model3d-job-'))
    mkdirSync(join(root, '.aiartengine', 'video-jobs'), { recursive: true })

    videoJobRepository.write(
      root,
      makeJob({
        kind: 'model3d',
        localJobId: 'mdl-1',
        providerJobId: 'prov-m',
        name: 'robot.glb',
        status: 'submitted'
      })
    )

    const active = videoJobRepository.listActive(root)
    expect(active).toHaveLength(1)
    expect(active[0].kind).toBe('model3d')
    expect(isVideoJobActive(active[0].status)).toBe(true)

    // 任务列表取消
    const cancelled = videoJobRepository.write(root, {
      ...active[0],
      status: 'cancelled',
      progress: 100,
      error: '已取消'
    })
    expect(cancelled.status).toBe('cancelled')
    expect(videoJobRepository.listActive(root)).toHaveLength(0)
    expect(videoJobRepository.list(root)[0].kind).toBe('model3d')
  })

  it('model3d job completed download records model asset id', () => {
    const root = mkdtempSync(join(tmpdir(), 'model3d-job-'))
    mkdirSync(join(root, '.aiartengine', 'video-jobs'), { recursive: true })

    videoJobRepository.write(
      root,
      makeJob({ kind: 'model3d', localJobId: 'mdl-2', status: 'running', progress: 60 })
    )

    const done = videoJobRepository.write(root, {
      ...videoJobRepository.get(root, 'mdl-2')!,
      status: 'succeeded',
      progress: 100,
      assetId: 'asset-m',
      relativePath: 'Assets/robot.glb',
      uploads: undefined,
      error: undefined
    })

    expect(done.assetId).toBe('asset-m')
    expect(done.relativePath).toBe('Assets/robot.glb')
    expect(videoJobRepository.listActive(root)).toHaveLength(0)
  })
})
