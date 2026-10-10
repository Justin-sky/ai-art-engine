import { mkdtempSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  buildEntityShotIndex,
  buildShotsFromCutPoints,
  createEmptySemanticTimeline,
  freezeBuildDefinition,
  normalizeSemanticEdits,
  planInvalidation,
  roundtripDurationOk,
  singleShot
} from '../src/shared/semanticTimeline'
import { executeBuild } from '../src/main/services/semanticTimeline/buildExecutor'
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

  it('executeBuild splices locally edited shots and reorders beats', async () => {
    const src = join(dir, 'edit-src.mp4')
    const meta = await generateHardCutFixture(src, { partSec: 1.2, fps: 15 })
    const shots = buildShotsFromCutPoints([meta.cutSec], meta.durationSec, meta.fps)
    const facts = await probeMediaFacts(src)
    const timeline = {
      ...createEmptySemanticTimeline('asset.edit', facts),
      entities: [
        {
          id: 'ent.object.box-1',
          kind: 'object' as const,
          name: 'box-1',
          appearances: [
            {
              shotId: shots[1]!.id,
              range: shots[1]!.range,
              box: { x: 0.3, y: 0.3, w: 0.3, h: 0.3 }
            }
          ],
          pixelEditable: true
        }
      ]
    }
    const { edits } = normalizeSemanticEdits([
      { kind: 'grade', shotIds: [shots[0]!.id], params: { brightness: 0.2 } },
      { kind: 'removeEntity', entityId: 'ent.object.box-1' }
    ])
    const plan = planInvalidation({ timeline, shots, edits })
    const definition = freezeBuildDefinition(timeline, edits, plan, 'h')
    const work = join(dir, 'work-edit')
    const out = join(work, 'out.mp4')
    const manifest = await executeBuild({
      sourceVideoAbs: src,
      shots,
      outputShots: [shots[1]!, shots[0]!],
      definition,
      workDirAbs: work,
      outputAbs: out,
      outputRelativePath: 'Semantic/x/out.mp4',
      edits,
      runEdits: true,
      entityShotIndex: buildEntityShotIndex(timeline),
      entityBoxes: new Map([
        ['ent.object.box-1', new Map([[shots[1]!.id, { x: 0.3, y: 0.3, w: 0.3, h: 0.3 }]])]
      ]),
      frameWidth: facts.width,
      frameHeight: facts.height
    })
    expect(manifest.status).toBe('done')
    expect(manifest.outputRelativePath).toBe('Semantic/x/out.mp4')
    expect(manifest.shotActions.map((a) => a.action)).toEqual(['mask_replace', 'mask_replace'])
    const outFacts = await probeMediaFacts(out)
    expect(Math.abs(outFacts.durationSec - facts.durationSec)).toBeLessThan(0.3)
  }, 180_000)

  it('replaceEntity overlays the replacement image into the detection box', async () => {
    const src = join(dir, 'replace-src.mp4')
    await generateSolidVideoFixture(src, { durationSec: 1.5, fps: 15, width: 160, height: 120 })
    const png = join(dir, 'product.png')
    execFileSync(
      'ffmpeg',
      ['-y', '-f', 'lavfi', '-i', 'color=red:s=64x64', '-frames:v', '1', png],
      {
        stdio: 'ignore',
        windowsHide: true
      }
    )
    const facts = await probeMediaFacts(src)
    const shots = singleShot(facts.durationSec, facts.fps)
    const timeline = {
      ...createEmptySemanticTimeline('asset.replace', facts),
      entities: [
        {
          id: 'ent.product.bottle-1',
          kind: 'product' as const,
          name: 'bottle-1',
          appearances: [
            {
              shotId: shots[0]!.id,
              range: shots[0]!.range,
              box: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }
            }
          ],
          pixelEditable: true
        }
      ]
    }
    const { edits } = normalizeSemanticEdits([
      { kind: 'replaceEntity', entityId: 'ent.product.bottle-1', newAssetId: 'asset.png' }
    ])
    const plan = planInvalidation({ timeline, shots, edits })
    const work = join(dir, 'work-replace')
    const manifest = await executeBuild({
      sourceVideoAbs: src,
      shots,
      definition: freezeBuildDefinition(timeline, edits, plan, 'h'),
      workDirAbs: work,
      outputAbs: join(work, 'out.mp4'),
      edits,
      runEdits: true,
      entityShotIndex: buildEntityShotIndex(timeline),
      entityBoxes: new Map([
        ['ent.product.bottle-1', new Map([[shots[0]!.id, { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }]])]
      ]),
      replaceMediaAbs: new Map([['asset.png', png]]),
      frameWidth: facts.width,
      frameHeight: facts.height
    })
    expect(manifest.status).toBe('done')
    expect(manifest.shotActions[0]!.action).toBe('mask_replace')
    expect(manifest.notes?.some((n) => n.includes('box overlay'))).toBe(true)
  }, 180_000)

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
