import { describe, expect, it } from 'vitest'
import {
  applyVideoTransitionBetweenClips,
  applyVideoTransitionToAllCuts,
  clampClipFreezeTailSec,
  clampClipSpeed,
  clampMixDuckingRatio,
  clampMixEqGainDb,
  clampTrackGain,
  closeTimelineTrackGaps,
  contentEndSecOfTimeline,
  normalizeClipCropRect,
  normalizeScriptTimelineSource,
  readScriptTimelineFromGenParams,
  splitTimelineClipAtTime,
  trimTimelineClipToTime,
  withScriptTimeline,
  type ScriptTimelineClip
} from '../src/shared/graph/scriptTimeline'
import { buildCapCutDraftContent, buildFcpxmlDocument } from '../src/shared/graph/timelineNleExport'
import { buildAtempoChain, buildFilterGraph } from '../src/main/services/timelineExportService'
import { executeTimelineOutputNode } from '../src/shared/graph/execute/narrative'
import { GraphPortType } from '../src/shared/graph/types'

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
    const written = withScriptTimeline(
      {},
      {
        clips: [
          { id: 'c3', track: 'video', sourceId: 'v9', title: '旧片段', startSec: 0, durationSec: 2 }
        ]
      }
    )
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

  it('混音设置（轨道增益 / 主增益 / EQ / 压缩 / 闪避 / 响度标准化）往返与越界收敛', () => {
    const written = withScriptTimeline(
      {},
      {
        clips: [],
        settings: {
          mixGains: { music: 1.5, voice: 0.3, sfx: 9 },
          mixMasterGain: 1.2,
          mixBassGainDb: 8,
          mixTrebleGainDb: -99,
          mixCompression: true,
          mixAutoDucking: true,
          mixDuckingRatio: 0.2,
          mixLoudnorm: true,
          scaleMode: 'blur',
          subtitleBorderColor: '#112233',
          subtitleBorderWidth: 4,
          subtitleBoxEnabled: true,
          subtitleBoxColor: '#000000',
          subtitleBoxOpacity: 0.6,
          subtitleMotion: 'fade'
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
    expect(s?.mixAutoDucking).toBe(true)
    expect(s?.mixDuckingRatio).toBe(0.2)
    expect(s?.mixLoudnorm).toBe(true)
    expect(s?.scaleMode).toBe('blur')
    expect(s?.subtitleBorderColor).toBe('#112233')
    expect(s?.subtitleBorderWidth).toBe(4)
    expect(s?.subtitleBoxEnabled).toBe(true)
    expect(s?.subtitleMotion).toBe('fade')
  })

  it('clampTrackGain / clampMixEqGainDb / clampClipSpeed / clampClipFreezeTailSec / clampMixDuckingRatio 边界', () => {
    expect(clampTrackGain(0)).toBe(0)
    expect(clampTrackGain(2.5)).toBe(2)
    expect(clampTrackGain('abc' as unknown as number)).toBe(1)
    expect(clampMixEqGainDb(-30)).toBe(-12)
    expect(clampMixEqGainDb(30)).toBe(12)
    expect(clampMixEqGainDb(undefined as unknown as number)).toBe(0)
    expect(clampClipSpeed(0.1)).toBe(0.25)
    expect(clampClipSpeed(8)).toBe(4)
    expect(clampClipFreezeTailSec(-1)).toBe(0)
    expect(clampClipFreezeTailSec(45)).toBe(30)
    expect(clampMixDuckingRatio(0.01)).toBe(0.05)
    expect(clampMixDuckingRatio(0.95)).toBe(0.8)
  })

  it('exportPlatformId 持久化', () => {
    const written = withScriptTimeline({}, { clips: [], settings: { exportPlatformId: 'douyin' } })
    expect(readScriptTimelineFromGenParams(written).settings?.exportPlatformId).toBe('douyin')
  })
})

describe('Stage 1 · splitTimelineClipAtTime & closeTimelineTrackGaps', () => {
  it('splitTimelineClipAtTime：后半段自动推进 sourceOffsetSec += delta * speed，并转移尾帧定格与淡出', () => {
    const clip: ScriptTimelineClip = {
      id: 'v1',
      track: 'video',
      sourceId: 's1',
      title: '镜头1',
      startSec: 2,
      durationSec: 6,
      sourceOffsetSec: 1.5,
      speed: 1.5,
      freezeTailSec: 1,
      fadeInSec: 0.5,
      fadeOutSec: 0.8
    }
    const split = splitTimelineClipAtTime(clip, 4, 'v1-b')
    expect(split).not.toBeNull()
    const [first, second] = split!
    expect(first.startSec).toBe(2)
    expect(first.durationSec).toBe(2)
    expect(first.sourceOffsetSec).toBe(1.5)
    expect(first.fadeInSec).toBe(0.5)
    expect(first.fadeOutSec).toBeUndefined()
    expect(first.freezeTailSec).toBeUndefined()

    expect(second.id).toBe('v1-b')
    expect(second.startSec).toBe(4)
    expect(second.durationSec).toBe(4)
    // 1.5 + (4 - 2) * 1.5 = 4.5
    expect(second.sourceOffsetSec).toBe(4.5)
    expect(second.fadeInSec).toBeUndefined()
    expect(second.fadeOutSec).toBe(0.8)
    expect(second.freezeTailSec).toBe(1)
  })

  it('closeTimelineTrackGaps：磁吸消除正间隙并保留转场负重叠', () => {
    const clips: ScriptTimelineClip[] = [
      { id: 'c1', track: 'video', sourceId: 's1', title: 'A', startSec: 1, durationSec: 3 },
      { id: 'c2', track: 'video', sourceId: 's2', title: 'B', startSec: 6, durationSec: 4 },
      // 与 c2 重叠 0.5s 做转场（原区间 [9.5, 12.5]）
      {
        id: 'c3',
        track: 'video',
        sourceId: 's3',
        title: 'C',
        startSec: 9.5,
        durationSec: 3,
        transitionInSec: 0.5,
        transitionType: 'dissolve'
      }
    ]
    const res = closeTimelineTrackGaps(clips, 'video')
    expect(res.closedCount).toBe(2)
    expect(res.savedSec).toBe(3)
    expect(res.clips.map((c) => c.startSec)).toEqual([0, 3, 6.5])
  })
})

describe('Stage 1 & Stage 2 · buildAtempoChain & buildFilterGraph', () => {
  it('buildAtempoChain 将超出 [0.5, 2.0] 的倍速拆分为多级 atempo', () => {
    expect(buildAtempoChain(1)).toBe('')
    expect(buildAtempoChain(0.25)).toBe('atempo=0.500,atempo=0.500')
    expect(buildAtempoChain(4)).toBe('atempo=2.000,atempo=2.000')
  })

  it('buildFilterGraph：支持音频入点偏移、视频原声混音、模糊背景填充、片段调色/定格与闪避/响度标准化', () => {
    const mainVideos = [
      {
        track: 'video' as const,
        title: 'V1',
        path: 'v1.mp4',
        startSec: 0,
        durationSec: 4,
        sourceOffsetSec: 1.2,
        speed: 1.5,
        freezeTailSec: 1,
        brightness: 0.1,
        contrast: 1.2,
        saturation: 1.3,
        volume: 0.8,
        inputIndex: 0,
        hasAudioStream: true
      }
    ]
    const audios = [
      {
        track: 'video' as const,
        title: 'V1',
        path: 'v1.mp4',
        startSec: 0,
        durationSec: 4,
        sourceOffsetSec: 1.2,
        speed: 1.5,
        volume: 0.8,
        inputIndex: 0
      },
      {
        track: 'voice' as const,
        title: 'Voice',
        path: 'voice.mp3',
        startSec: 0.5,
        durationSec: 2,
        sourceOffsetSec: 2.5,
        speed: 1,
        inputIndex: 1
      },
      {
        track: 'music' as const,
        title: 'BGM',
        path: 'bgm.mp3',
        startSec: 0,
        durationSec: 4,
        sourceOffsetSec: 5,
        speed: 1,
        inputIndex: 2
      }
    ]
    const subs = [
      {
        track: 'subtitle' as const,
        title: 'Sub',
        text: '测试字幕',
        startSec: 0.5,
        durationSec: 2,
        fontSize: 48,
        textColor: '#ffcc00'
      }
    ]
    const graph = buildFilterGraph(
      mainVideos,
      [],
      audios,
      subs,
      3,
      4,
      1,
      1080,
      1920,
      30,
      36,
      80,
      '#ffffff',
      {
        mixAutoDucking: true,
        mixDuckingRatio: 0.25,
        mixLoudnorm: true
      },
      undefined,
      {
        scaleMode: 'blur',
        subtitleBorderColor: '#000000',
        subtitleBorderWidth: 3,
        subtitleBoxEnabled: true,
        subtitleBoxColor: '#111111',
        subtitleBoxOpacity: 0.6,
        subtitleMotion: 'fade'
      }
    )
    // 模糊背景填充
    expect(graph.filter).toContain('boxblur=24:2')
    // 片段尾帧定格 + 调色 eq
    expect(graph.filter).toContain('tpad=stop_mode=clone:stop_duration=1.000')
    expect(graph.filter).toContain('eq=brightness=0.100:contrast=1.200:saturation=1.300')
    // 音频 sourceOffsetSec 生效（voice 从 2.5s 截到 4.500s）
    expect(graph.filter).toContain('[1:a]atrim=2.5:4.500')
    // 主视频原声纳入混音（[0:a]atrim=1.2:...）
    expect(graph.filter).toContain('[0:a]atrim=1.2:')
    // BGM 自动闪避音量表达式 + EBU R128 响度标准化
    expect(graph.filter).toContain("volume=0.250:enable='between(t\\,0.42\\,2.62)'")
    expect(graph.filter).toContain('loudnorm=I=-16:TP=-1.5:LRA=11')
    // 字幕片段独立字号/字色 + 底框
    expect(graph.filter).toContain(
      'fontsize=48:fontcolor=#ffcc00:borderw=3:bordercolor=#000000:box=1:boxcolor=#111111@0.60'
    )
  })
})

describe('Stage 3 · NLE 工程互通导出 & 节点图执行自动合成', () => {
  it('buildFcpxmlDocument 生成合法的 FCPXML 1.9 工程结构', () => {
    const xml = buildFcpxmlDocument(
      {
        clips: [
          {
            id: 'v1',
            track: 'video',
            sourceId: 's1',
            title: '镜头1',
            relativePath: 'Assets/shot1.mp4',
            startSec: 0,
            durationSec: 3,
            sourceOffsetSec: 1.5
          },
          {
            id: 'sub1',
            track: 'subtitle',
            sourceId: 'sub',
            title: '台词1',
            text: '你好世界',
            startSec: 0.5,
            durationSec: 2
          }
        ]
      },
      { projectName: 'DemoCut', width: 1920, height: 1080, fps: 30 }
    )
    expect(xml).toContain('<!DOCTYPE fcpxml>')
    expect(xml).toContain('<fcpxml version="1.9">')
    expect(xml).toContain('<project name="DemoCut">')
    expect(xml).toContain('<asset-clip name="镜头1"')
    expect(xml).toContain('你好世界')
  })

  it('buildCapCutDraftContent 生成剪映 draft_content.json 结构', () => {
    const raw = buildCapCutDraftContent(
      {
        clips: [
          {
            id: 'v1',
            track: 'video',
            sourceId: 's1',
            title: '镜头1',
            relativePath: 'Assets/shot1.mp4',
            startSec: 0,
            durationSec: 3,
            sourceOffsetSec: 1
          },
          {
            id: 'a1',
            track: 'voice',
            sourceId: 's2',
            title: '旁白1',
            relativePath: 'Assets/voice1.mp3',
            startSec: 0.5,
            durationSec: 2
          }
        ]
      },
      { projectName: 'JianyingDemo', width: 1080, height: 1920, fps: 30 }
    )
    const parsed = JSON.parse(raw)
    expect(parsed.canvas_config.width).toBe(1080)
    expect(parsed.canvas_config.height).toBe(1920)
    expect(parsed.materials.videos).toHaveLength(1)
    expect(parsed.materials.audios).toHaveLength(1)
    expect(parsed.tracks.length).toBeGreaterThanOrEqual(2)
  })

  it('executeTimelineOutputNode 调用 composeTimelineVideo 自动合成成片并置顶输出', async () => {
    let capturedArgs: unknown = null
    const node = {
      id: 'tl-1',
      typeId: 'output.timeline',
      title: '成片时间线',
      x: 0,
      y: 0,
      inputs: [],
      outputs: [{ id: 'out', name: 'out', type: GraphPortType.video }],
      params: {}
    }
    const out = await executeTimelineOutputNode({
      node,
      inputs: {
        'in-videos': [
          {
            kind: 'videos',
            items: [{ id: 'v1', relativePath: 'Assets/shot1.mp4', createdAt: '01-01 12:00' }]
          }
        ],
        'in-voices': [
          {
            kind: 'voices',
            items: [{ id: 'a1', relativePath: 'Assets/voice1.mp3', createdAt: '01-01 12:00' }]
          }
        ]
      },
      composeTimelineVideo: async (args) => {
        capturedArgs = args
        return { relativePath: 'Exports/tl-1-composed.mp4', assetId: 'composed-asset-1' }
      }
    } as unknown as Parameters<typeof executeTimelineOutputNode>[0])
    expect(capturedArgs).toBeTruthy()
    expect(node.params.previewRelativePath).toBe('Exports/tl-1-composed.mp4')
    expect(node.params.generatedVoices).toHaveLength(1)
    expect(out.out?.kind).toBe('videos')
    if (out.out?.kind === 'videos') {
      expect(out.out.items[0]?.relativePath).toBe('Exports/tl-1-composed.mp4')
    }
  })
})

describe('Stage 4 · 裁剪工具（Trim In/Out + Frame Crop）与专业片段转场', () => {
  it('normalizeClipCropRect：归一化画面裁剪框并识别 isCropped', () => {
    const uncropped = normalizeClipCropRect(null)
    expect(uncropped.isCropped).toBe(false)
    expect(uncropped.cropWidth).toBe(1)
    expect(uncropped.cropHeight).toBe(1)

    const cropped = normalizeClipCropRect({
      cropX: 0.15,
      cropY: 0.2,
      cropWidth: 0.5,
      cropHeight: 0.6
    })
    expect(cropped.isCropped).toBe(true)
    expect(cropped.x).toBe(0.15)
    expect(cropped.y).toBe(0.2)
    expect(cropped.width).toBe(0.5)
    expect(cropped.height).toBe(0.6)
  })

  it('trimTimelineClipToTime：支持入点 [ 与出点 ] 快速裁剪并同步推进 sourceOffsetSec', () => {
    const clip: ScriptTimelineClip = {
      id: 'v1',
      track: 'video',
      sourceId: 's1',
      title: '镜头1',
      startSec: 2,
      durationSec: 6,
      sourceOffsetSec: 1,
      speed: 1.5
    }
    const trimmedIn = trimTimelineClipToTime(clip, 4, 'in')
    expect(trimmedIn).not.toBeNull()
    expect(trimmedIn?.startSec).toBe(4)
    expect(trimmedIn?.durationSec).toBe(4)
    // 1 + (4 - 2) * 1.5 = 4
    expect(trimmedIn?.sourceOffsetSec).toBe(4)

    const trimmedOut = trimTimelineClipToTime(clip, 5.5, 'out')
    expect(trimmedOut).not.toBeNull()
    expect(trimmedOut?.startSec).toBe(2)
    expect(trimmedOut?.durationSec).toBe(3.5)
    expect(trimmedOut?.sourceOffsetSec).toBe(1)
  })

  it('applyVideoTransitionBetweenClips & applyVideoTransitionToAllCuts：自动涟漪重叠并在移除转场时恢复紧贴切点', () => {
    const initial: ScriptTimelineClip[] = [
      { id: 'c1', track: 'video', sourceId: 's1', title: 'A', startSec: 0, durationSec: 4 },
      { id: 'c2', track: 'video', sourceId: 's2', title: 'B', startSec: 4, durationSec: 4 },
      { id: 'c3', track: 'video', sourceId: 's3', title: 'C', startSec: 8, durationSec: 4 }
    ]
    const withTrans = applyVideoTransitionBetweenClips(initial, 'c1', 'c2', {
      transitionType: 'circleopen',
      durationSec: 0.8
    })
    const c1 = withTrans.find((c) => c.id === 'c1')!
    const c2 = withTrans.find((c) => c.id === 'c2')!
    const c3 = withTrans.find((c) => c.id === 'c3')!
    expect(c1.transitionOutSec).toBe(0.8)
    expect(c2.transitionType).toBe('circleopen')
    expect(c2.transitionInSec).toBe(0.8)
    expect(c2.startSec).toBe(3.2)
    // 后续片段同步左移 0.8s，不留空隙
    expect(c3.startSec).toBe(7.2)

    // 移除转场时恢复无重叠紧贴切点
    const cleared = applyVideoTransitionBetweenClips(withTrans, 'c1', 'c2', {
      transitionType: 'none',
      durationSec: 0
    })
    expect(cleared.find((c) => c.id === 'c2')?.startSec).toBe(4)
    expect(cleared.find((c) => c.id === 'c3')?.startSec).toBe(8)
    expect(cleared.find((c) => c.id === 'c2')?.transitionInSec).toBeUndefined()

    // 一键应用到全部切点
    const allApplied = applyVideoTransitionToAllCuts(initial, 'zoomin', 0.5)
    expect(allApplied.find((c) => c.id === 'c2')?.startSec).toBe(3.5)
    expect(allApplied.find((c) => c.id === 'c2')?.transitionType).toBe('zoomin')
    expect(allApplied.find((c) => c.id === 'c3')?.startSec).toBe(7)
    expect(allApplied.find((c) => c.id === 'c3')?.transitionType).toBe('zoomin')
  })

  it('buildFilterGraph 注入 FFmpeg crop 滤镜与新增 xfade 转场类型', () => {
    const graph = buildFilterGraph(
      [
        {
          track: 'video',
          title: 'V1',
          path: 'v1.mp4',
          startSec: 0,
          durationSec: 3,
          cropX: 0.1,
          cropY: 0.2,
          cropWidth: 0.8,
          cropHeight: 0.6,
          transitionOutSec: 0.5,
          inputIndex: 0
        },
        {
          track: 'video',
          title: 'V2',
          path: 'v2.mp4',
          startSec: 2.5,
          durationSec: 3,
          transitionInSec: 0.5,
          transitionType: 'zoomin',
          inputIndex: 1
        }
      ],
      [],
      [],
      [],
      2,
      5.5,
      1,
      1280,
      720,
      30,
      36,
      80,
      '#ffffff'
    )
    expect(graph.filter).toContain('crop=iw*0.8000:ih*0.6000:iw*0.1000:ih*0.2000')
    expect(graph.filter).toContain('xfade=transition=zoomin:duration=0.500')
  })
})
