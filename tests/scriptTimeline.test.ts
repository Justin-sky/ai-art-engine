import { describe, expect, it } from 'vitest'
import {
  clampMixEqGainDb,
  clampTrackGain,
  contentEndSecOfTimeline,
  normalizeScriptTimelineSource,
  readScriptTimelineFromGenParams,
  withScriptTimeline,
  type ScriptTimelineClip
} from '../src/shared/graph/scriptTimeline'

describe('normalizeScriptTimelineSource', () => {
  it('透传来源图节点 nodeId / nodeTitle', () => {
    const src = normalizeScriptTimelineSource({
      id: 'v1',
      title: '镜头A',
      relativePath: 'videos/a.mp4',
      origin: 'input',
      nodeId: 'node-gen-1',
      nodeTitle: '生成·分镜A'
    })
    expect(src).not.toBeNull()
    expect(src?.nodeId).toBe('node-gen-1')
    expect(src?.nodeTitle).toBe('生成·分镜A')
  })

  it('空 nodeId 不写入', () => {
    const src = normalizeScriptTimelineSource({
      id: 'v2',
      title: '镜头B',
      nodeId: '   ',
      nodeTitle: undefined
    })
    expect(src?.nodeId).toBeUndefined()
    expect(src?.nodeTitle).toBeUndefined()
  })

  it('imported 素材不携带来源节点字段', () => {
    const src = normalizeScriptTimelineSource({
      id: 'im-1',
      title: '本地素材',
      origin: 'imported',
      nodeId: 'should-not-survive'
    })
    expect(src?.nodeId).toBeUndefined()
  })
})

describe('readScriptTimelineFromGenParams / withScriptTimeline 往返', () => {
  it('clip 的 nodeId / nodeTitle 可持久化读取', () => {
    const clip: ScriptTimelineClip = {
      id: 'c1',
      track: 'video',
      sourceId: 'v1',
      title: '镜头A',
      relativePath: 'videos/a.mp4',
      nodeId: 'node-gen-1',
      nodeTitle: '生成·分镜A',
      startSec: 0,
      durationSec: 4
    }
    const written = withScriptTimeline({}, { clips: [clip] })
    const read = readScriptTimelineFromGenParams(written)
    expect(read.clips).toHaveLength(1)
    expect(read.clips[0].nodeId).toBe('node-gen-1')
    expect(read.clips[0].nodeTitle).toBe('生成·分镜A')
  })

  it('按 timelineNodeId 分键时同样保留来源节点', () => {
    const clip: ScriptTimelineClip = {
      id: 'c2',
      track: 'voice',
      sourceId: 'voice-1',
      title: '旁白',
      nodeId: 'voice-node',
      startSec: 1,
      durationSec: 2
    }
    const written = withScriptTimeline({}, { clips: [clip] }, 'sub-3')
    const read = readScriptTimelineFromGenParams(written, 'sub-3')
    expect(read.clips[0].nodeId).toBe('voice-node')
  })

  it('旧数据（无来源节点字段）兼容读取', () => {
    const written = withScriptTimeline({}, {
      clips: [
        { id: 'c3', track: 'video', sourceId: 'v9', title: '旧片段', startSec: 0, durationSec: 2 }
      ]
    })
    const read = readScriptTimelineFromGenParams(written)
    expect(read.clips[0].nodeId).toBeUndefined()
  })
})

describe('contentEndSecOfTimeline', () => {
  it('取最晚片段结束时间', () => {
    expect(
      contentEndSecOfTimeline([
        { id: 'a', track: 'video', sourceId: 's', title: 'a', startSec: 0, durationSec: 3 },
        { id: 'b', track: 'music', sourceId: 'm', title: 'b', startSec: 5, durationSec: 2 }
      ])
    ).toBe(7)
  })
})

describe('sfx 轨 + 混音设置', () => {
  it('sfx 轨 clip 可持久化读取', () => {
    const clip: ScriptTimelineClip = {
      id: 'sfx1',
      track: 'sfx',
      sourceId: 'sfx-src',
      title: '雨声',
      relativePath: 'Cache/Sfx/rain.mp3',
      startSec: 2,
      durationSec: 3,
      volume: 0.8
    }
    const written = withScriptTimeline({}, { clips: [clip] })
    const read = readScriptTimelineFromGenParams(written)
    expect(read.clips).toHaveLength(1)
    expect(read.clips[0].track).toBe('sfx')
    expect(read.clips[0].volume).toBe(0.8)
  })

  it('混音设置（轨道增益 / 主增益 / EQ / 压缩）往返与越界收敛', () => {
    const written = withScriptTimeline(
      {},
      {
        clips: [],
        settings: {
          mixGains: { music: 1.5, voice: 0.3, sfx: 9 },
          mixMasterGain: 1.2,
          mixBassGainDb: 8,
          mixTrebleGainDb: -99,
          mixCompression: true
        }
      }
    )
    const read = readScriptTimelineFromGenParams(written)
    const s = read.settings
    expect(s?.mixGains?.music).toBe(1.5)
    expect(s?.mixGains?.voice).toBe(0.3)
    expect(s?.mixGains?.sfx).toBe(2)
    expect(s?.mixMasterGain).toBe(1.2)
    expect(s?.mixBassGainDb).toBe(8)
    expect(s?.mixTrebleGainDb).toBe(-12)
    expect(s?.mixCompression).toBe(true)
  })

  it('clampTrackGain / clampMixEqGainDb 边界', () => {
    expect(clampTrackGain(0)).toBe(0)
    expect(clampTrackGain(2.5)).toBe(2)
    expect(clampTrackGain('abc' as unknown as number)).toBe(1)
    expect(clampMixEqGainDb(-30)).toBe(-12)
    expect(clampMixEqGainDb(30)).toBe(12)
    expect(clampMixEqGainDb(undefined as unknown as number)).toBe(0)
  })

  it('exportPlatformId 持久化', () => {
    const written = withScriptTimeline(
      {},
      { clips: [], settings: { exportPlatformId: 'douyin' } }
    )
    expect(readScriptTimelineFromGenParams(written).settings?.exportPlatformId).toBe('douyin')
  })
})
