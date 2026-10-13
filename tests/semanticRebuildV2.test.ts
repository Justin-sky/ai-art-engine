import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createNodeFromType, normalizeGraph } from '../src/shared/graph'
import {
  dubTempo,
  layoutSegments,
  mapCuesToOutput,
  muteVolumeExpression,
  normalizeCommandKind
} from '../src/shared/semanticTimeline'
import {
  generateHardCutFixture,
  probeMediaFacts
} from '../src/main/services/semanticTimeline/mediaFacts'
import { resolveFfmpegForSemantic } from '../src/main/services/semanticTimeline/resolveFfmpeg'
import { rebuildVideoFromSegments } from '../src/main/services/semanticTimeline/segmentRebuild'

describe('重建输出时间轴（纯函数）', () => {
  it('删镜后成片时间前移；字幕按段切开、落在删掉镜头里的句子丢掉', () => {
    // 原片 0-4 / 4-8 / 8-12，删掉中间一镜
    const laid = layoutSegments([
      { key: 'a', durationSec: 4, sourceStartSec: 0, sourceEndSec: 4 },
      { key: 'c', durationSec: 4, sourceStartSec: 8, sourceEndSec: 12 }
    ])
    expect(laid.map((s) => [s.outStartSec, s.outEndSec])).toEqual([
      [0, 4],
      [4, 8]
    ])
    const cues = mapCuesToOutput(
      [
        { sourceStartSec: 1, sourceEndSec: 3, text: 'A' },
        { sourceStartSec: 5, sourceEndSec: 7, text: '被删' },
        { sourceStartSec: 3, sourceEndSec: 9, text: '跨段' },
        { sourceStartSec: 9, sourceEndSec: 11, text: 'C' }
      ],
      laid
    )
    expect(cues.find((c) => c.text === '被删')).toBeUndefined()
    expect(cues.find((c) => c.text === 'C')).toEqual({ startSec: 5, endSec: 7, text: 'C' })
    // 跨段句子：第一段 3-4 → 3-4，第三段 8-9 → 4-5
    expect(cues.filter((c) => c.text === '跨段').map((c) => [c.startSec, c.endSec])).toEqual([
      [3, 4],
      [4, 5]
    ])
  })

  it('静音表达式 / 配音变速 / 命令名规范化', () => {
    expect(muteVolumeExpression([])).toBe('1')
    expect(muteVolumeExpression([{ start: 1, end: 2 }])).toBe('if(between(t,1.000,2.000),0,1)')
    expect(dubTempo(2, 2)).toBe(1)
    expect(dubTempo(3, 2)).toBe(1.5)
    expect(dubTempo(10, 2)).toBe(2)
    expect(normalizeCommandKind('camera.push_in')).toBe('camera.pushIn')
    expect(normalizeCommandKind('vfx.brighten')).toBe('light.brighten')
    expect(normalizeCommandKind('grade.warm')).toBe('grade.warm')
  })
})

describe('旧图迁移：语义重建的文本口', () => {
  it('rebuild:out 的旧边迁到 out-video（目标收视频时保留）', () => {
    const rebuild = createNodeFromType('semantic.rebuild', { x: 0, y: 0 })
    const analyze = createNodeFromType('semantic.analyze', { x: 300, y: 0 })
    const graph = normalizeGraph({
      nodes: [rebuild, analyze],
      edges: [
        {
          id: 'e1',
          source: rebuild.id,
          target: analyze.id,
          sourcePort: 'out',
          targetPort: 'in-video'
        }
      ],
      groups: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    } as never)
    expect(graph.edges).toHaveLength(1)
    expect(graph.edges[0]!.sourcePort).toBe('out-video')
  })
})

/**
 * 端到端拼接（ffmpeg 门控）：零修改直通 = 还原原片；删镜 = 成片变短；
 * 生成段对齐原镜头时长；配音只替换对应时间段。
 */
const hasFfmpeg = (() => {
  try {
    execFileSync(resolveFfmpegForSemantic(), ['-version'], {
      stdio: 'ignore',
      windowsHide: true,
      timeout: 10_000
    })
    return true
  } catch {
    return false
  }
})()

describe.runIf(hasFfmpeg)('segmentRebuild（ffmpeg）', () => {
  let root = ''
  const src = 'Assets/src.mp4'

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'stl-rebuild-'))
    mkdirSync(join(root, 'Assets'), { recursive: true })
    await generateHardCutFixture(join(root, 'Assets', 'src.mp4'), { partSec: 1.5, fps: 24 })
    // 一个 1 秒的"生成片段" + 一句 0.8 秒的"配音"
    const ffmpeg = resolveFfmpegForSemantic()
    execFileSync(
      ffmpeg,
      [
        '-y',
        '-f',
        'lavfi',
        '-i',
        'color=c=green:s=160x120:d=1:r=24',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        join(root, 'Assets', 'gen.mp4')
      ],
      { stdio: 'ignore', windowsHide: true }
    )
    execFileSync(
      ffmpeg,
      [
        '-y',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=880:duration=0.8',
        join(root, 'Assets', 'dub.wav')
      ],
      { stdio: 'ignore', windowsHide: true }
    )
  }, 60_000)

  afterAll(() => {
    if (root) rmSync(root, { recursive: true, force: true })
  })

  const base = {
    sourceRelativePath: src,
    keepAudio: true,
    burnSubtitles: false,
    width: 320,
    height: 240,
    fps: 24
  }

  it('零修改：两镜直通，成片时长 = 原片，带音轨', async () => {
    const res = await rebuildVideoFromSegments({
      ...base,
      projectRoot: root,
      segments: [
        { key: 's1', kind: 'source', durationSec: 1.5, sourceStartSec: 0, sourceEndSec: 1.5 },
        { key: 's2', kind: 'source', durationSec: 1.5, sourceStartSec: 1.5, sourceEndSec: 3 }
      ],
      outputRelativePath: 'out/identity.mp4',
      workDirRelativePath: 'out/identity'
    })
    expect(res.error).toBeUndefined()
    expect(res.ok).toBe(true)
    expect(res.passthroughCount).toBe(2)
    expect(res.generatedCount).toBe(0)
    const facts = await probeMediaFacts(join(root, 'out', 'identity.mp4'))
    expect(Math.abs(facts.durationSec - 3)).toBeLessThan(0.15)
    expect(facts.hasAudio).toBe(true)
    expect(facts.width).toBe(320)
  }, 120_000)

  it('删镜 + 生成段对齐原镜头时长 + 配音', async () => {
    const res = await rebuildVideoFromSegments({
      ...base,
      projectRoot: root,
      segments: [
        {
          key: 's1',
          kind: 'generate',
          relativePath: 'Assets/gen.mp4',
          durationSec: 1.5,
          sourceStartSec: 0,
          sourceEndSec: 1.5
        }
      ],
      dubs: [{ id: 'u1', relativePath: 'Assets/dub.wav', sourceStartSec: 0.3, sourceEndSec: 1.2 }],
      outputRelativePath: 'out/edited.mp4',
      workDirRelativePath: 'out/edited'
    })
    expect(res.error).toBeUndefined()
    expect(res.ok).toBe(true)
    expect(res.generatedCount).toBe(1)
    expect(res.dubCount).toBe(1)
    const out = join(root, 'out', 'edited.mp4')
    expect(existsSync(out)).toBe(true)
    const facts = await probeMediaFacts(out)
    // 1 秒的生成片段被对齐到原镜头 1.5 秒；第二镜被删 → 成片 1.5 秒
    expect(Math.abs(facts.durationSec - 1.5)).toBeLessThan(0.15)
    expect(facts.hasAudio).toBe(true)
  }, 120_000)
})
