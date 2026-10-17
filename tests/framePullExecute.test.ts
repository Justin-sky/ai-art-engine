import { describe, expect, it } from 'vitest'
import {
  buildFramePullReshootPrompt,
  buildFramePullSpliceSegments,
  collectRangeFrameNotes,
  computeAdaptiveFilmstripTimes,
  createNodeFromType,
  executeFramePullNode,
  expandIncomingThroughBundles,
  formatFramePullNotesReport,
  getNodePorts,
  isFramePullNode,
  normalizeFramePullRange,
  recommendVideoGenerationDuration
} from '../src/shared/graph'
import type { NodeExecuteContext } from '../src/shared/graph'

function makeCtx(
  params?: Record<string, unknown>,
  inputs?: NodeExecuteContext['inputs']
): NodeExecuteContext {
  const node = createNodeFromType('video.framePull', { x: 0, y: 0 }, { id: 'pull-1' })
  node.params = { ...node.params, ...(params ?? {}) }
  return {
    node,
    inputs: inputs ?? {},
    document: { nodes: [], edges: [] }
  }
}

describe('video.framePull node & segment reshoot/splice helpers', () => {
  it('creates with defaults, exposes out-video port, and is recognized by node role', () => {
    const node = createNodeFromType('video.framePull', { x: 0, y: 0 })
    expect(node.typeId).toBe('video.framePull')
    expect(isFramePullNode(node)).toBe(true)
    expect(node.params.frameNotes).toEqual({})
    expect(node.params.generatedImages ?? []).toEqual([])
    expect(node.params.framePullConditioningMode).toBe('first_last')
    expect(node.params.framePullFitMode).toBe('stretch')
    expect(node.params.framePullKeepAudio).toBe(true)

    const ports = getNodePorts(node)
    expect(ports.map((p) => `${p.id}:${p.direction}:${p.dataType}`)).toEqual([
      'in:in:video',
      'in-image:in:image',
      'out:out:image',
      'out-all:out:images',
      'out-video:out:video'
    ])
  })

  it('emits captured frames as image gallery outputs', () => {
    const ctx = makeCtx({
      generatedImages: [
        { id: 'pull:12:1', dataUrl: 'data:image/png;base64,aaa', createdAt: '2026-08-08' },
        { id: 'pull:30:2', dataUrl: 'data:image/png;base64,bbb', createdAt: '2026-08-08' }
      ],
      selectedImageId: 'pull:12:1'
    })
    const out = executeFramePullNode(ctx)
    expect(out.out?.kind).toBe('image')
    expect(out['out-all']?.kind).toBe('images')
    // 图库语义：执行后强制选中最新一帧
    expect(ctx.node.params.selectedImageId).toBe('pull:30:2')
    const all = out['out-all'] as { items?: Array<{ id?: string }> } | undefined
    expect(all?.items?.map((item) => item.id)).toEqual(['pull:12:1', 'pull:30:2'])
  })

  it('returns an empty image when no frames captured', () => {
    const ctx = makeCtx({})
    const out = executeFramePullNode(ctx)
    expect(out.out?.kind).toBe('image')
    expect(out['out-all']).toBeUndefined()
  })

  it('emits out-video from framePullActiveVideoPath or upstream video input', () => {
    const splicedCtx = makeCtx({
      framePullActiveVideoPath: 'Semantic/framepull_1/rebuilds/run1/output.f24_72.mp4'
    })
    const splicedOut = executeFramePullNode(splicedCtx)
    expect(splicedOut['out-video']).toEqual({
      kind: 'video',
      id: 'framepull:Semantic/framepull_1/rebuilds/run1/output.f24_72.mp4',
      relativePath: 'Semantic/framepull_1/rebuilds/run1/output.f24_72.mp4'
    })

    const passthroughCtx = makeCtx(
      {},
      {
        in: [{ kind: 'video', id: 'vid-src', relativePath: 'Assets/Videos/source.mp4' }]
      }
    )
    const passthroughOut = executeFramePullNode(passthroughCtx)
    expect(passthroughOut['out-video']).toEqual({
      kind: 'video',
      id: 'vid-src',
      relativePath: 'Assets/Videos/source.mp4'
    })
  })

  it('normalizes frame ranges and computes frame-accurate timecodes', () => {
    const range = normalizeFramePullRange({
      inFrame: 72,
      outFrame: 24,
      totalFrames: 240,
      fps: 24,
      durationSec: 10
    })
    expect(range.valid).toBe(true)
    expect(range.inFrame).toBe(24)
    expect(range.outFrame).toBe(72)
    expect(range.frameCount).toBe(49)
    expect(range.inSec).toBeCloseTo(1.0, 3)
    expect(range.outSec).toBeCloseTo(73 / 24, 2)
    expect(range.segmentDurationSec).toBeCloseTo(49 / 24, 2)
  })

  it('computes adaptive filmstrip times with hybrid fill when keyframes are sparse', () => {
    const sparsePlan = computeAdaptiveFilmstripTimes({
      durationSec: 6,
      fps: 24,
      keyframeTimes: [0, 3.0],
      minThumbs: 16,
      maxThumbs: 24
    })
    expect(sparsePlan.mode).toBe('hybrid')
    expect(sparsePlan.frames.length).toBeGreaterThanOrEqual(16)
    expect(sparsePlan.frames.length).toBeLessThanOrEqual(24)
    expect(sparsePlan.frames[0]).toBe(0)
    expect(sparsePlan.frames[sparsePlan.frames.length - 1]).toBe(143)
  })

  it('collects frame notes within the selected range and merges them into reshoot prompt', () => {
    const frames = [
      { id: 'pull:10:1' },
      { id: 'pull:30:2' },
      { id: 'pull:48:3' },
      { id: 'pull:90:4' }
    ]
    const frameNotes = {
      'pull:10:1': '区间外前缀笔记',
      'pull:30:2': '手部动作穿模需修正',
      'pull:48:3': '眼神转向镜头',
      'pull:90:4': '区间外后缀笔记'
    }
    const inRange = collectRangeFrameNotes({
      frames,
      frameNotes,
      inFrame: 24,
      outFrame: 72
    })
    expect(inRange).toEqual([
      { frame: 30, note: '手部动作穿模需修正' },
      { frame: 48, note: '眼神转向镜头' }
    ])

    const promptZh = buildFramePullReshootPrompt({
      instruction: '角色自然转身拔剑',
      inFrame: 24,
      outFrame: 72,
      inSec: 1.0,
      outSec: 3.0,
      conditioningMode: 'first_last',
      rangeNotes: inRange,
      locale: 'zh-CN'
    })
    expect(promptZh).toContain('第 24～72 帧')
    expect(promptZh).toContain('角色自然转身拔剑')
    expect(promptZh).toContain('[帧30] 手部动作穿模需修正')
    expect(promptZh).toContain('[帧48] 眼神转向镜头')

    const report = formatFramePullNotesReport({ frames, frameNotes, fps: 24 })
    expect(report).toContain('[F30 | 00:01] 手部动作穿模需修正')
  })

  it('builds 3-part head/reshoot/tail FFmpeg splice segments and handles boundary ranges', () => {
    const midSegments = buildFramePullSpliceSegments({
      sourceDurationSec: 10,
      inSec: 2,
      outSec: 5,
      generatedClipRelativePath: 'Cache/Videos/reshoot.mp4',
      fitMode: 'stretch'
    })
    expect(midSegments).toEqual([
      {
        key: 'head',
        kind: 'source',
        durationSec: 2,
        sourceStartSec: 0,
        sourceEndSec: 2
      },
      {
        key: 'reshoot',
        kind: 'generate',
        durationSec: 3,
        relativePath: 'Cache/Videos/reshoot.mp4',
        sourceStartSec: 2,
        sourceEndSec: 5,
        fitMode: 'stretch'
      },
      {
        key: 'tail',
        kind: 'source',
        durationSec: 5,
        sourceStartSec: 5,
        sourceEndSec: 10
      }
    ])

    const headOnlySegments = buildFramePullSpliceSegments({
      sourceDurationSec: 8,
      inSec: 0,
      outSec: 3,
      generatedClipRelativePath: 'Cache/Videos/intro.mp4',
      fitMode: 'trim'
    })
    expect(headOnlySegments.map((s) => s.key)).toEqual(['reshoot', 'tail'])
    expect(recommendVideoGenerationDuration(2.4)).toBe(5)
    expect(recommendVideoGenerationDuration(6.2)).toBe(7)
  })

  it('indexes only in-image reference edges (and image bundles) for @n mentions on video.framePull', () => {
    const pullNode = createNodeFromType('video.framePull', { x: 400, y: 0 }, { id: 'pull-1' })
    const srcVideo = createNodeFromType('asset.video', { x: 0, y: 0 }, { id: 'vid-src' })
    const refImg1 = createNodeFromType('asset.image', { x: 0, y: 100 }, { id: 'img-1' })
    const bundle = createNodeFromType('media.bundle', { x: 180, y: 200 }, { id: 'bundle-1' })
    const refImg2 = createNodeFromType('asset.image', { x: 0, y: 200 }, { id: 'img-2' })

    const expanded = expandIncomingThroughBundles(
      {
        nodes: [pullNode, srcVideo, refImg1, bundle, refImg2],
        edges: [
          {
            id: 'e-vid',
            source: 'vid-src',
            sourcePort: 'out',
            target: 'pull-1',
            targetPort: 'in'
          },
          {
            id: 'e-img1',
            source: 'img-1',
            sourcePort: 'out',
            target: 'pull-1',
            targetPort: 'in-image'
          },
          {
            id: 'e-img2-to-bundle',
            source: 'img-2',
            sourcePort: 'out',
            target: 'bundle-1',
            targetPort: 'in'
          },
          {
            id: 'e-bundle-to-pull',
            source: 'bundle-1',
            sourcePort: 'out',
            target: 'pull-1',
            targetPort: 'in-image'
          }
        ]
      },
      'pull-1'
    )

    expect(expanded.map((item) => item.sourceNodeId)).toEqual(['img-1', 'img-2'])
  })
})
