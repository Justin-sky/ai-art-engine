import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type { VideoJobRecord } from '../src/shared/videoJob'
import {
  formatVideoJobProgressMessage,
  subscribeVideoJobProgress
} from '../src/renderer/src/features/graph/model/subscribeVideoJobProgress'

function sampleJob(
  partial: Partial<VideoJobRecord> & Pick<VideoJobRecord, 'localJobId'>
): VideoJobRecord {
  return {
    version: 1,
    providerJobId: 'p1',
    pollingUrl: 'https://example.test/poll',
    providerInstanceId: 'prov',
    model: 'm',
    prompt: 'hi',
    status: 'running',
    progress: 0,
    source: 'graph',
    createdAt: new Date().toISOString(),
    submittedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...partial
  }
}

describe('subscribeVideoJobProgress', () => {
  let listeners: Array<(job: VideoJobRecord) => void> = []

  beforeEach(() => {
    listeners = []
    vi.stubGlobal('window', {
      studio: {
        onVideoJobUpdated: (cb: (job: VideoJobRecord) => void) => {
          listeners.push(cb)
          return () => {
            listeners = listeners.filter((l) => l !== cb)
          }
        }
      }
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('filters by graphBinding.nodeId and throttles by progress step', () => {
    const messages: string[] = []
    const stop = subscribeVideoJobProgress({
      nodeId: 'n-video',
      onMessage: (m) => messages.push(m),
      format: (job) => `${job.progress}%`
    })

    for (const l of listeners) {
      l(sampleJob({ localJobId: 'a', graphBinding: { nodeId: 'other' }, progress: 20 }))
      l(sampleJob({ localJobId: 'b', graphBinding: { nodeId: 'n-video' }, progress: 10 }))
      l(sampleJob({ localJobId: 'b', graphBinding: { nodeId: 'n-video' }, progress: 12 }))
      l(sampleJob({ localJobId: 'b', graphBinding: { nodeId: 'n-video' }, progress: 20 }))
    }

    expect(messages).toEqual(['10%', '20%'])
    stop()
    expect(listeners).toHaveLength(0)
  })

  it('formats video vs model3d progress keys', () => {
    const t = (key: string, params?: Record<string, unknown>) =>
      `${key}:${params?.progress}:${params?.status}`
    expect(
      formatVideoJobProgressMessage(
        sampleJob({ localJobId: 'v', kind: 'video', progress: 42, status: 'running' }),
        t
      )
    ).toBe('graph.logs.videoProgress:42:running')
    expect(
      formatVideoJobProgressMessage(
        sampleJob({ localJobId: 'm', kind: 'model3d', progress: 7, status: 'submitted' }),
        t
      )
    ).toBe('graph.logs.model3dProgress:7:submitted')
  })
})
