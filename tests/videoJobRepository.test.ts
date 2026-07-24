import { describe, expect, it } from 'vitest'
import { mkdtempSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { VideoJobRecord } from '../src/shared/videoJob'
import { isVideoJobActive } from '../src/shared/videoJob'
import { VideoJobRepository } from '../src/main/repositories/videoJobRepository'

function sampleJob(overrides: Partial<VideoJobRecord> = {}): VideoJobRecord {
  const now = new Date().toISOString()
  return {
    version: 1,
    localJobId: overrides.localJobId ?? 'job-1',
    providerJobId: 'prov-1',
    pollingUrl: 'https://example.com/videos/prov-1',
    providerInstanceId: 'provider-1',
    model: 'demo-video',
    prompt: 'a cat',
    status: 'running',
    progress: 20,
    source: 'graph',
    createdAt: now,
    submittedAt: now,
    updatedAt: now,
    ...overrides
  }
}

describe('videoJob shared helpers', () => {
  it('isVideoJobActive', () => {
    expect(isVideoJobActive('submitted')).toBe(true)
    expect(isVideoJobActive('running')).toBe(true)
    expect(isVideoJobActive('succeeded')).toBe(false)
    expect(isVideoJobActive('failed')).toBe(false)
    expect(isVideoJobActive('cancelled')).toBe(false)
  })
})

describe('VideoJobRepository', () => {
  it('writes, reads, lists active, and patches', () => {
    const root = mkdtempSync(join(tmpdir(), 'video-job-repo-'))
    const repo = new VideoJobRepository()
    const saved = repo.write(root, sampleJob())
    expect(saved.localJobId).toBe('job-1')
    expect(repo.get(root, 'job-1')?.prompt).toBe('a cat')
    expect(repo.listActive(root)).toHaveLength(1)

    const patched = repo.patch(root, 'job-1', { progress: 55, status: 'running' })
    expect(patched?.progress).toBe(55)
    expect(repo.list(root)[0].progress).toBe(55)
  })

  it('prunes old terminal jobs', () => {
    const root = mkdtempSync(join(tmpdir(), 'video-job-prune-'))
    const repo = new VideoJobRepository()
    for (let i = 0; i < 5; i++) {
      const ts = new Date(Date.UTC(2020, 0, i + 1)).toISOString()
      repo.write(
        root,
        sampleJob({
          localJobId: `done-${i}`,
          status: 'succeeded',
          progress: 100,
          createdAt: ts,
          submittedAt: ts,
          updatedAt: ts
        })
      )
    }
    repo.write(root, sampleJob({ localJobId: 'still-running', status: 'running' }))
    repo.pruneTerminal(root, 2)
    const ids = repo.list(root).map((j) => j.localJobId).sort()
    expect(ids).toContain('still-running')
    expect(repo.list(root).filter((j) => j.status === 'succeeded')).toHaveLength(2)
    expect(existsSync(join(root, '.aiartengine', 'video-jobs', 'still-running.json'))).toBe(true)
  })

  it('listActive ignores terminal', () => {
    const root = mkdtempSync(join(tmpdir(), 'video-job-active-'))
    const repo = new VideoJobRepository()
    repo.write(root, sampleJob({ localJobId: 'a', status: 'running' }))
    repo.write(root, sampleJob({ localJobId: 'b', status: 'failed', progress: 100 }))
    expect(repo.listActive(root).map((j) => j.localJobId)).toEqual(['a'])
  })
})
