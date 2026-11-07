import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  analyzePcmAudioForensics,
  parsePcm16WavBuffer
} from '../src/main/services/semanticTimeline/forensics/audioForensics'
import { parseAigcImplicitJson } from '../src/main/services/semanticTimeline/forensics/probeProvenance'
import { analyzeSemanticTimeline } from '../src/main/services/semanticTimeline/SemanticTimelineService'
import {
  generateHardCutFixture,
  probeMediaFacts
} from '../src/main/services/semanticTimeline/mediaFacts'
import {
  resolveFfmpegForSemantic,
  resolveFfprobeForSemantic
} from '../src/main/services/semanticTimeline/resolveFfmpeg'
import { rebuildVideoFromSegments } from '../src/main/services/semanticTimeline/segmentRebuild'
import { separateAudioStems } from '../src/main/services/audioSeparationService'

const hasFfmpeg = (() => {
  try {
    execFileSync(resolveFfmpegForSemantic(), ['-version'], {
      stdio: 'ignore',
      windowsHide: true,
      timeout: 10_000
    })
    execFileSync(resolveFfprobeForSemantic(), ['-version'], {
      stdio: 'ignore',
      windowsHide: true,
      timeout: 10_000
    })
    return true
  } catch {
    return false
  }
})()

function makeSyntheticMonoWav(options: {
  sampleRate?: number
  durationSec: number
  cutJumpAtSec?: number
}): Buffer {
  const sr = options.sampleRate ?? 16000
  const count = Math.floor(sr * options.durationSec)
  const buf = Buffer.alloc(44 + count * 2)
  buf.write('RIFF', 0, 'ascii')
  buf.writeUInt32LE(36 + count * 2, 4)
  buf.write('WAVE', 8, 'ascii')
  buf.write('fmt ', 12, 'ascii')
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(sr, 24)
  buf.writeUInt32LE(sr * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36, 'ascii')
  buf.writeUInt32LE(count * 2, 40)

  for (let i = 0; i < count; i += 1) {
    const t = i / sr
    // Jump amplitude + harmonic pitch across cutJumpAtSec to simulate per-clip AI native audio
    const amp = options.cutJumpAtSec && t >= options.cutJumpAtSec ? 0.55 : 0.08
    const freq = options.cutJumpAtSec && t >= options.cutJumpAtSec ? 220 : 180
    const v =
      amp * (0.7 * Math.sin(2 * Math.PI * freq * t) + 0.3 * Math.sin(4 * Math.PI * freq * t))
    const s16 = Math.max(-32767, Math.min(32767, Math.round(v * 32767)))
    buf.writeInt16LE(s16, 44 + i * 2)
  }
  return buf
}

describe('rea-video Phase 2: provenance, visual/audio forensics, mono stems & local FFmpeg remake', () => {
  const tempDirs: string[] = []
  const makeTempDir = (): string => {
    const dir = join(
      tmpdir(),
      `aiart-rea-p2-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    )
    mkdirSync(dir, { recursive: true })
    tempDirs.push(dir)
    return dir
  }

  afterEach(() => {
    for (const d of tempDirs.splice(0)) {
      try {
        rmSync(d, { recursive: true, force: true })
      } catch {
        /* ignore cleanup race */
      }
    }
  })

  it('parses GB 45438-2025 AIGC implicit metadata JSON payloads from container metadata', () => {
    const raw =
      'prefix {"Label":"1","ContentProducer":"Seedance","ProduceID":"vid_2026_abc","ReservedCode1":"001"} suffix'
    const parsed = parseAigcImplicitJson(raw)
    expect(parsed).toMatchObject({
      label: '1',
      contentProducer: 'Seedance',
      produceId: 'vid_2026_abc',
      reservedCode1: '001'
    })
  })

  it('extracts 16kHz PCM audio forensics including f0 pitch and per-clip cut discontinuities', () => {
    const wavBuf = makeSyntheticMonoWav({ durationSec: 4.0, cutJumpAtSec: 2.0 })
    const parsed = parsePcm16WavBuffer(wavBuf)
    expect(parsed).not.toBeNull()
    const audio = analyzePcmAudioForensics(parsed!, [1.0, 2.0])
    expect(audio.hasAudio).toBe(true)
    expect(audio.rmsDbfs).toBeGreaterThan(-30)
    expect(audio.perClipAudio?.atCutsDb).toBeGreaterThan(audio.perClipAudio!.withinShotsDb)
    expect(audio.voice.f0MedianHz).toBeGreaterThanOrEqual(170)
    expect(audio.voice.f0MedianHz).toBeLessThanOrEqual(235)
  })

  it.runIf(hasFfmpeg)(
    'runs end-to-end deterministic forensics, writes storyboard.jpg + report.md, avoids mono stem silence, and renders local Ken Burns + compare.mp4',
    async () => {
      const root = makeTempDir()
      const videoRel = 'Assets/sample-cut.mp4'
      const videoAbs = join(root, ...videoRel.split('/'))
      mkdirSync(join(root, 'Assets'), { recursive: true })
      await generateHardCutFixture(videoAbs, { partSec: 1.2, fps: 24 })

      // 1. Full semantic analysis with forensics + mono stem separation
      const res = await analyzeSemanticTimeline(root, 'asset.cut.1', videoAbs, {
        videoRelativePath: videoRel,
        separateAudio: true,
        detectEntities: false
      })

      expect(res.timeline.shots?.length).toBeGreaterThanOrEqual(2)
      expect(res.timeline.breakdown).toBeDefined()
      expect(res.timeline.breakdown?.summary.shotCount).toBe(res.timeline.shots?.length)

      // Verify storyboard.jpg and report.md were written
      const storyboardRel = res.timeline.breakdown?.summary.storyboardRelativePath
      expect(storyboardRel).toBeTruthy()
      expect(existsSync(join(root, ...storyboardRel!.split('/')))).toBe(true)

      const reportRel = res.timeline.breakdown?.summary.reportRelativePath
      expect(reportRel).toBeTruthy()
      const reportMd = readFileSync(join(root, ...reportRel!.split('/')), 'utf8')
      expect(reportMd).toContain('# 视频逆向拆解与复刻报告')

      // 2. Verify mono/dual-mono stem separation does NOT cancel instrumental.wav to silence!
      const sep = await separateAudioStems({ projectRoot: root, relativePath: videoRel })
      const instWav = parsePcm16WavBuffer(
        readFileSync(join(root, ...sep.instrumentalRelativePath.split('/')))
      )
      expect(instWav).not.toBeNull()
      let maxAbs = 0
      for (let i = 0; i < instWav!.samples.length; i += 1) {
        maxAbs = Math.max(maxAbs, Math.abs(instWav!.samples[i]!))
      }
      expect(maxAbs).toBeGreaterThan(0.01)

      // 3. Render zero-API-cost local Ken Burns + static hold + side-by-side compare.mp4
      const firstShot = res.timeline.shots![0]!
      const secondShot = res.timeline.shots![1]!
      const anchor1 = `Semantic/${res.timeline.id}/${firstShot.keyframes.first ?? firstShot.keyframes.middle}`
      const anchor2 = `Semantic/${res.timeline.id}/${secondShot.keyframes.first ?? secondShot.keyframes.middle}`
      writeFileSync(join(root, 'dummy.txt'), 'ok', 'utf8')

      const rebuild = await rebuildVideoFromSegments({
        projectRoot: root,
        sourceRelativePath: videoRel,
        workDirRelativePath: `Semantic/${res.timeline.id}/rebuilds/test_local`,
        outputRelativePath: `Semantic/${res.timeline.id}/rebuilds/test_local/output.mp4`,
        renderCompare: true,
        width: 320,
        height: 240,
        fps: 24,
        localMotionClips: [
          {
            key: firstShot.id,
            shotId: firstShot.id,
            anchorImageRelativePath: anchor1,
            durationSec: 1.2,
            mode: 'ken_burns',
            zoomPerSec: 0.04,
            panPxPerSec: 0.02,
            panDirDeg: 0
          },
          {
            key: secondShot.id,
            shotId: secondShot.id,
            anchorImageRelativePath: anchor2,
            durationSec: 1.2,
            mode: 'static_hold'
          }
        ],
        segments: [
          {
            key: firstShot.id,
            kind: 'generate',
            durationSec: 1.2,
            sourceStartSec: 0,
            sourceEndSec: 1.2
          },
          {
            key: secondShot.id,
            kind: 'generate',
            durationSec: 1.2,
            sourceStartSec: 1.2,
            sourceEndSec: 2.4
          }
        ]
      })

      expect(rebuild.ok).toBe(true)
      expect(rebuild.localClipCount).toBe(2)
      expect(rebuild.compareRelativePath).toBe(
        `Semantic/${res.timeline.id}/rebuilds/test_local/compare.mp4`
      )
      expect(existsSync(join(root, ...rebuild.outputRelativePath.split('/')))).toBe(true)
      expect(existsSync(join(root, ...rebuild.compareRelativePath!.split('/')))).toBe(true)

      // 4. Multi-shot G1 proportional slicing across a bridged K1 local motion insert!
      const ffmpeg = resolveFfmpegForSemantic()
      const g1Rel = 'Assets/g1_batched.mp4'
      execFileSync(
        ffmpeg,
        [
          '-y',
          '-f',
          'lavfi',
          '-i',
          'color=c=red:s=320x240:d=2.0:r=24',
          '-f',
          'lavfi',
          '-i',
          'color=c=blue:s=320x240:d=2.0:r=24',
          '-filter_complex',
          '[0:v][1:v]concat=n=2:v=1:a=0[v]',
          '-map',
          '[v]',
          '-c:v',
          'libx264',
          '-pix_fmt',
          'yuv420p',
          join(root, ...g1Rel.split('/'))
        ],
        { stdio: 'ignore', windowsHide: true }
      )

      const bridgedRebuild = await rebuildVideoFromSegments({
        projectRoot: root,
        sourceRelativePath: videoRel,
        workDirRelativePath: `Semantic/${res.timeline.id}/rebuilds/test_bridged_g1`,
        outputRelativePath: `Semantic/${res.timeline.id}/rebuilds/test_bridged_g1/output.mp4`,
        keepAudio: false,
        width: 320,
        height: 240,
        fps: 24,
        localMotionClips: [
          {
            key: 'K1',
            shotId: 'shot.insert',
            anchorImageRelativePath: anchor1,
            durationSec: 1.0,
            mode: 'ken_burns',
            zoomPerSec: 0.03
          }
        ],
        segments: [
          {
            key: 'shot.1',
            kind: 'generate',
            relativePath: g1Rel,
            clipOffsetRatio: 0,
            clipDurationRatio: 0.5,
            durationSec: 1.5,
            sourceStartSec: 0,
            sourceEndSec: 1.5
          },
          {
            key: 'K1',
            kind: 'generate',
            durationSec: 1.0,
            sourceStartSec: 1.5,
            sourceEndSec: 2.5
          },
          {
            key: 'shot.3',
            kind: 'generate',
            relativePath: g1Rel,
            clipOffsetRatio: 0.5,
            clipDurationRatio: 0.5,
            durationSec: 1.5,
            sourceStartSec: 2.5,
            sourceEndSec: 4.0
          }
        ]
      })

      expect(bridgedRebuild.ok).toBe(true)
      expect(bridgedRebuild.generatedCount).toBe(3)
      expect(bridgedRebuild.localClipCount).toBe(1)
      const bridgedFacts = await probeMediaFacts(
        join(root, ...bridgedRebuild.outputRelativePath.split('/'))
      )
      expect(Math.abs(bridgedFacts.durationSec - 4.0)).toBeLessThan(0.2)
    },
    60_000
  )
})
