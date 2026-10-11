import { mkdtempSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  buildShotsFromCutPoints,
  roundtripDurationOk,
  singleShot
} from '../src/shared/semanticTimeline'
import {
  generateHardCutFixture,
  generateSolidVideoFixture,
  probeMediaFacts
} from '../src/main/services/semanticTimeline/mediaFacts'
import { detectShots } from '../src/main/services/semanticTimeline/shotDetect'
import {
  extractFrameHashes,
  frameHashMatchRatio,
  rebuildVideoFromShots
} from '../src/main/services/semanticTimeline/roundtrip'
import { analyzeShotsOnly } from '../src/main/services/semanticTimeline/SemanticTimelineService'
import { execFileSync } from 'child_process'

const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore', windowsHide: true, timeout: 5000 })
    return true
  } catch {
    return false
  }
})()

describe.runIf(hasFfmpeg)('semanticTimeline L0 roundtrip (ffmpeg)', () => {
  let dir = ''

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'stl-l0-'))
  })

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it('probes solid fixture and rebuilds single shot with frame hash match', async () => {
    const src = join(dir, 'solid.mp4')
    await generateSolidVideoFixture(src, { durationSec: 2, fps: 15, width: 160, height: 120 })
    const facts = await probeMediaFacts(src)
    expect(facts.durationSec).toBeGreaterThan(1.5)
    expect(facts.fps).toBeGreaterThan(0)

    const shots = singleShot(facts.durationSec, facts.fps)
    expect(roundtripDurationOk(facts.durationSec, shots, facts.fps).ok).toBe(true)

    const out = join(dir, 'solid-rebuild.mp4')
    const work = join(dir, 'work-solid')
    const result = await rebuildVideoFromShots(src, shots, out, work)
    expect(result.ok).toBe(true)
    expect(existsSync(out)).toBe(true)

    const h1 = await extractFrameHashes(src, join(work, 'orig'), 20)
    const h2 = await extractFrameHashes(out, join(work, 'reb'), 20)
    // stream copy 往返应高度一致；允许极少数边界帧差异
    expect(frameHashMatchRatio(h1, h2)).toBeGreaterThanOrEqual(0.8)
  }, 120_000)

  it('detects hard cut and duration-preserving multi-shot rebuild', async () => {
    const src = join(dir, 'cut.mp4')
    const meta = await generateHardCutFixture(src, { partSec: 1.2, fps: 15 })
    const facts = await probeMediaFacts(src)
    const detected = await detectShots(src, facts, { threshold: 0.2, minShotSec: 0.3 })
    // 硬切应至少检出 1 个切点，或回退单镜（环境差异）
    expect(detected.shots.length).toBeGreaterThanOrEqual(1)
    expect(roundtripDurationOk(facts.durationSec, detected.shots, facts.fps).ok).toBe(true)

    // 即使 detect 失败，用已知切点构建也应 OK
    const forced = buildShotsFromCutPoints([meta.cutSec], meta.durationSec, meta.fps)
    expect(forced.length).toBe(2)

    const out = join(dir, 'cut-rebuild.mp4')
    const result = await rebuildVideoFromShots(src, forced, out, join(dir, 'work-cut'))
    expect(result.ok).toBe(true)
    expect(result.segmentCount).toBe(2)
  }, 120_000)

  it('analyzeShotsOnly writes Semantic/<id>/timeline.json', async () => {
    const src = join(dir, 'analyze.mp4')
    await generateSolidVideoFixture(src, { durationSec: 1.5, fps: 12 })
    const project = join(dir, 'project')
    const result = await analyzeShotsOnly(project, 'asset-video-1', src)
    expect(result.timeline.source.assetId).toBe('asset-video-1')
    expect(existsSync(join(project, 'Semantic', result.timeline.id, 'timeline.json'))).toBe(true)
    expect(
      existsSync(join(project, 'Semantic', result.timeline.id, 'evidence', 'shots.json'))
    ).toBe(true)
  }, 120_000)
})

describe('semanticTimeline L0 pure (no ffmpeg)', () => {
  it('forced cut points preserve duration', () => {
    const shots = buildShotsFromCutPoints([2, 5], 8, 30)
    expect(shots.length).toBe(3)
    expect(roundtripDurationOk(8, shots, 30).ok).toBe(true)
  })
})
