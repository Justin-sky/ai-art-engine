import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { VideoJobRecord } from '../src/shared/videoJob'
import { videoJobRepository } from '../src/main/repositories/videoJobRepository'

/**
 * 轻量级「resume 完成」路径：模拟已落盘 running job + poll 返回 completed，
 * 验证会写成 succeeded 并带上 asset 字段（不启动真实 HTTP）。
 */
describe('video job resume completion (repository + settle shape)', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'video-job-resume-'))
    mkdirSync(join(root, '.aiartengine', 'video-jobs'), { recursive: true })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('active job on disk can be marked succeeded after download metadata is known', () => {
    const now = new Date().toISOString()
    const job: VideoJobRecord = {
      version: 1,
      localJobId: 'resume-1',
      providerJobId: 'prov-x',
      pollingUrl: 'https://example.com/videos/prov-x',
      providerInstanceId: 'p1',
      model: 'm1',
      prompt: 'hello',
      status: 'running',
      progress: 55,
      source: 'graph',
      createdAt: now,
      submittedAt: now,
      updatedAt: now,
      tosUploads: [
        {
          objectKey: 'k',
          url: 'https://tos/k',
          bytes: 10,
          bucket: 'b',
          providerId: 'tos',
          providerLabel: 'TOS',
          sourceLabel: 'ref.mp4'
        }
      ]
    }
    videoJobRepository.write(root, job)

    const active = videoJobRepository.listActive(root)
    expect(active).toHaveLength(1)
    expect(active[0].providerJobId).toBe('prov-x')

    // 模拟 poll completed 后的落盘结果（service completeJob 写入）
    const done = videoJobRepository.write(root, {
      ...active[0],
      status: 'succeeded',
      progress: 100,
      assetId: 'asset-1',
      relativePath: 'Assets/gen.mp4',
      tosUploads: undefined,
      error: undefined
    })

    expect(videoJobRepository.listActive(root)).toHaveLength(0)
    expect(done.assetId).toBe('asset-1')
    expect(done.relativePath).toBe('Assets/gen.mp4')
  })

  it('missing provider case is represented as failed record', () => {
    const now = new Date().toISOString()
    videoJobRepository.write(root, {
      version: 1,
      localJobId: 'orphan',
      providerJobId: 'p',
      pollingUrl: 'https://x',
      providerInstanceId: 'gone',
      model: 'm',
      prompt: 'x',
      status: 'submitted',
      progress: 8,
      source: 'graph',
      createdAt: now,
      submittedAt: now,
      updatedAt: now
    })

    const failed = videoJobRepository.write(root, {
      ...videoJobRepository.get(root, 'orphan')!,
      status: 'failed',
      progress: 100,
      error: '视频提供商已移除，无法继续轮询'
    })

    expect(failed.status).toBe('failed')
    expect(failed.error).toContain('提供商')
    writeFileSync(join(root, 'marker.txt'), 'ok')
  })
})
