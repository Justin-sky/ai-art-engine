import { describe, expect, it } from 'vitest'
import {
  normalizeScriptTimelineSource,
  readScriptTimelineFromGenParams,
  withScriptTimeline,
  type ScriptTimelineClip
} from '@shared/graph'

function clipWithNode(overrides: Partial<ScriptTimelineClip> = {}): ScriptTimelineClip {
  return {
    id: 'clip-1',
    track: 'video',
    sourceId: 'shot.mp4',
    title: '镜头 1',
    startSec: 0,
    durationSec: 3,
    ...overrides
  }
}

describe('script timeline clip source node', () => {
  it('keeps nodeId when normalizing an input source', () => {
    const source = normalizeScriptTimelineSource({
      id: 'shot.mp4',
      title: '镜头 1',
      origin: 'input',
      nodeId: 'node-9'
    })
    expect(source?.nodeId).toBe('node-9')
  })

  it('drops a blank nodeId', () => {
    const source = normalizeScriptTimelineSource({
      id: 'shot.mp4',
      title: '镜头 1',
      nodeId: '   '
    })
    expect(source?.nodeId).toBeUndefined()
  })

  it('round-trips clip.nodeId through genParams', () => {
    const genParams = withScriptTimeline({}, { clips: [clipWithNode({ nodeId: 'node-9' })] })
    const doc = readScriptTimelineFromGenParams(genParams)
    expect(doc.clips).toHaveLength(1)
    expect(doc.clips[0]?.nodeId).toBe('node-9')
  })

  it('tolerates clips collected before nodeId existed', () => {
    const genParams = withScriptTimeline({}, { clips: [clipWithNode()] })
    expect(readScriptTimelineFromGenParams(genParams).clips[0]?.nodeId).toBeUndefined()
  })
})
