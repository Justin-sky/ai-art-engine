import { describe, expect, it } from 'vitest'
import {
  computeIdPhotoCropBox,
  renderIdPhotoSingleRgba,
  composeIdPhotoPrintSheetRgba,
  serializePortraitBatchClipboard,
  parsePortraitBatchClipboard,
  matchShotColorHistogramRgba,
  apply25dRelightToRgba,
  normalizeLightingSetup,
  normalizePortraitRetouch,
  alignClipsToBeatMarkers,
  computeJLCutAudioOffsets,
  computeVoiceDuckingEnvelope,
  applySubtitleStylePreset,
  SUBTITLE_STYLE_PRESETS,
  supportsInlineAbCompare,
  computeInlineAbSplitStyle,
  clampAbSplitRatio
} from '../src/shared/graph'
import {
  DIRECTOR_CAPTURE_PASSES,
  normalizeDirectorCapturePass
} from '../src/shared/directorCinematography'
import { computeCannyEdgePassRgba } from '../src/renderer/src/features/director/directorRenderPasses'
import {
  exportSubgraphToSkillMarkdown,
  checkSkillRuntimeDependencies
} from '../src/shared/claudeSkill'
import { createNodeToolDialogController } from '../src/renderer/src/features/graph/model/nodeToolStateFactory'

describe('Six Pillars Commercial Upgrade Suite', () => {
  describe('Pillar 1 — Portrait Batch Sync, Local ID Photo Auto-Crop & 6-Inch Print Sheet', () => {
    it('computes head-anchored ID photo crop box and renders single + 8-up print sheet with cut marks', () => {
      const landmarks = Array.from(
        { length: 68 },
        (_, i) => [0.35 + (i % 5) * 0.05, 0.25 + (i / 68) * 0.35] as const
      )
      const box = computeIdPhotoCropBox('oneInch', landmarks, 400 / 600, 300)
      expect(box).not.toBeNull()
      expect(box!.w).toBeGreaterThan(0.2)
      expect(box!.h).toBeGreaterThan(0.2)
      expect(box!.widthPx).toBe(295)
      expect(box!.heightPx).toBe(413)

      const src = new Uint8ClampedArray(32 * 32 * 4)
      for (let i = 0; i < src.length; i += 4) {
        src[i] = 200
        src[i + 1] = 170
        src[i + 2] = 155
        src[i + 3] = 255
      }
      const single = renderIdPhotoSingleRgba(
        src,
        32,
        32,
        {
          state: { idPhotoSpecId: 'oneInch', idPhotoBg: 'blue' },
          landmarks
        },
        { dpi: 72 }
      )
      expect(single).not.toBeNull()
      expect(single!.pixels.length).toBe(single!.width * single!.height * 4)

      const sheet = composeIdPhotoPrintSheetRgba(single!.pixels, single!.width, single!.height, {
        columns: 4,
        rows: 2,
        gapPx: 6,
        marginPx: 12,
        cutMarks: true
      })
      expect(sheet.width).toBe(4 * single!.width + 3 * 6 + 24)
      expect(sheet.height).toBe(2 * single!.height + 1 * 6 + 24)
      expect(sheet.pixels.length).toBe(sheet.width * sheet.height * 4)
      expect(sheet.count).toBe(8)
    })

    it('serializes and parses portrait batch sync clipboard payload losslessly', () => {
      const state = {
        ...normalizePortraitRetouch({}),
        skinSmoothing: 'standard' as const,
        skinWhiten: 'strong' as const,
        lutId: 'fuji' as const
      }
      const raw = serializePortraitBatchClipboard({ state, customLut: null })
      const parsed = parsePortraitBatchClipboard(raw)
      expect(parsed).not.toBeNull()
      expect(parsed?.state.skinSmoothing).toBe('standard')
      expect(parsed?.state.skinWhiten).toBe('strong')
      expect(parsed?.state.lutId).toBe('fuji')
    })

    it('matches shot color distribution via Reinhard RGB mean/std transfer', () => {
      const src = new Uint8ClampedArray(16 * 4)
      const ref = new Uint8ClampedArray(16 * 4)
      for (let i = 0; i < 16; i++) {
        src[i * 4] = 60 + (i % 4) * 5
        src[i * 4 + 1] = 70 + (i % 4) * 5
        src[i * 4 + 2] = 80 + (i % 4) * 5
        src[i * 4 + 3] = 255

        ref[i * 4] = 160 + (i % 4) * 10
        ref[i * 4 + 1] = 140 + (i % 4) * 10
        ref[i * 4 + 2] = 110 + (i % 4) * 10
        ref[i * 4 + 3] = 255
      }
      const matched = matchShotColorHistogramRgba(src, ref, 1.0)
      expect(matched[0]).toBeGreaterThan(src[0])
      expect(matched[1]).toBeGreaterThan(src[1])
    })
  })

  describe('Pillar 2 — 2.5D Normal-Shaded Relighting', () => {
    it('applies directional key light, ambient fill, and Fresnel rim light to RGBA image', () => {
      const w = 16
      const h = 16
      const src = new Uint8ClampedArray(w * h * 4)
      for (let i = 0; i < w * h; i++) {
        src[i * 4] = 150
        src[i * 4 + 1] = 140
        src[i * 4 + 2] = 135
        src[i * 4 + 3] = 255
      }
      const setup = {
        ...normalizeLightingSetup({}),
        yaw: 65,
        pitch: 20,
        brightness: 95,
        color: '#ff9944',
        rimLight: true
      }
      const relit = apply25dRelightToRgba(src, w, h, setup)
      expect(relit.length).toBe(src.length)
      // Right side (yaw > 0) should be brighter than left side
      const leftIdx = (8 * w + 2) * 4
      const rightIdx = (8 * w + 13) * 4
      expect(relit[rightIdx]).toBeGreaterThan(relit[leftIdx])
    })
  })

  describe('Pillar 3 — Film & Video Timeline Beat-Cut Sync, J/L-Cut, Ducking & Subtitle Presets', () => {
    it('snaps video clip cuts to nearest beat markers and applies J/L-cut audio offsets', () => {
      const clips = [
        {
          id: 'v1',
          track: 'video' as const,
          sourceId: 's1',
          title: 'Shot 1',
          startSec: 0,
          durationSec: 2.1
        },
        {
          id: 'v2',
          track: 'video' as const,
          sourceId: 's2',
          title: 'Shot 2',
          startSec: 2.1,
          durationSec: 1.85
        },
        {
          id: 'vo1',
          track: 'voice' as const,
          sourceId: 'sv1',
          title: 'Line 1',
          startSec: 2.1,
          durationSec: 1.5
        }
      ]
      const snapped = alignClipsToBeatMarkers(clips, [1.0, 2.0, 4.0], { maxSnapSec: 0.35 })
      const v1 = snapped.find((c) => c.id === 'v1')!
      const v2 = snapped.find((c) => c.id === 'v2')!
      expect(v1.durationSec).toBe(2.0)
      expect(v2.startSec).toBe(2.0)
      expect(v2.durationSec).toBe(2.0)

      const jCut = computeJLCutAudioOffsets(snapped, 'j-cut', 0.3)
      const vo1 = jCut.find((c) => c.id === 'vo1')!
      expect(vo1.startSec).toBeCloseTo(1.8, 2)
      expect(vo1.fadeInSec).toBeGreaterThanOrEqual(0.3)
    })

    it('computes voice auto-ducking envelope and applies subtitle style presets', () => {
      const env = computeVoiceDuckingEnvelope(
        [
          {
            id: 'vo1',
            track: 'voice',
            sourceId: 'sv1',
            title: 'Line 1',
            startSec: 1.0,
            durationSec: 2.0
          }
        ],
        { duckGain: 0.2, attackSec: 0.2, releaseSec: 0.4 }
      )
      expect(env.some((p) => p.gain === 0.2)).toBe(true)
      expect(env[env.length - 1].gain).toBe(1)

      expect(SUBTITLE_STYLE_PRESETS.length).toBeGreaterThanOrEqual(5)
      const nextSettings = applySubtitleStylePreset(undefined, 'shortDramaPop')
      expect(nextSettings.subtitleFontSize).toBe(52)
      expect(nextSettings.subtitleBorderWidth).toBe(5)
    })
  })

  describe('Pillar 4 — 3D Director Canny ControlPass & Multi-Pass AOV', () => {
    it('registers canny in DIRECTOR_CAPTURE_PASSES and extracts crisp Canny edges from RGBA', () => {
      expect(DIRECTOR_CAPTURE_PASSES).toContain('canny')
      expect(normalizeDirectorCapturePass('canny')).toBe('canny')

      const w = 16
      const h = 16
      const img = new Uint8ClampedArray(w * h * 4)
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const idx = (y * w + x) * 4
          const v = x >= 8 ? 240 : 15
          img[idx] = v
          img[idx + 1] = v
          img[idx + 2] = v
          img[idx + 3] = 255
        }
      }
      const canny = computeCannyEdgePassRgba(img, w, h, 25, 60)
      // Vertical step edge around x = 7..8 should produce 255 white edge pixels
      const edgeVal = Math.max(canny[(8 * w + 7) * 4], canny[(8 * w + 8) * 4])
      expect(edgeVal).toBe(255)
      // Flat interior should remain 0 black
      expect(canny[(8 * w + 2) * 4]).toBe(0)
    })
  })

  describe('Pillar 5 — Inline A/B Comparison Wipe & Node Tool State Factory', () => {
    it('validates inline A/B compare eligibility and computes split CSS clip-paths', () => {
      expect(
        supportsInlineAbCompare(
          'image.portrait',
          'data:image/png;base64,a',
          'data:image/png;base64,b'
        )
      ).toBe(true)
      expect(supportsInlineAbCompare('image.portrait', 'same', 'same')).toBe(false)
      expect(supportsInlineAbCompare('note.text', 'a', 'b')).toBe(false)

      expect(clampAbSplitRatio(-1)).toBe(0.02)
      expect(clampAbSplitRatio(2)).toBe(0.98)
      const style = computeInlineAbSplitStyle(0.35)
      expect(style.splitPercent).toBe(35)
      expect(style.beforeClipPath).toBe('inset(0 65% 0 0)')
      expect(style.afterClipPath).toBe('inset(0 0 0 35%)')
    })

    it('manages node tool dialog open, close, and undo history snapshot consumption', () => {
      const ctrl = createNodeToolDialogController<{ scale: number }>()
      expect(ctrl.state.open).toBe(false)
      const fakeDoc = { version: 1, nodes: [], edges: [] }
      ctrl.beginOpen({
        nodeId: 'node-1',
        setup: { scale: 2 },
        historyBefore: fakeDoc,
        generateModel: 'seedream-5.0'
      })
      expect(ctrl.state.open).toBe(true)
      expect(ctrl.state.nodeId).toBe('node-1')
      expect(ctrl.state.setup?.scale).toBe(2)
      expect(ctrl.consumeHistorySnapshot()).toEqual(fakeDoc)
      expect(ctrl.consumeHistorySnapshot()).toBeNull()
      ctrl.close()
      expect(ctrl.state.open).toBe(false)
      expect(ctrl.state.nodeId).toBe('')
    })
  })

  describe('Pillar 6 — Subgraph-to-Skill Packager & Runtime Dependency Self-Check', () => {
    it('exports a canvas subgraph to valid Claude Code SKILL.md and checks runtime dependencies', () => {
      const md = exportSubgraphToSkillMarkdown({
        name: 'Portrait Commercial Studio',
        description: 'Automated commercial portrait retouching and ID photo pipeline',
        nodes: [
          { id: 'n1', typeId: 'image.portrait', title: 'Portrait Retouch' },
          { id: 'n2', typeId: 'asset.motion', title: '3D Director' }
        ],
        edges: [{ source: 'n2', target: 'n1', sourcePort: 'out-shots', targetPort: 'in-image' }],
        author: 'Studio Team'
      })
      expect(md).toContain('name: portrait-commercial-studio')
      expect(md).toContain('mcp__aiartengine__*')
      expect(md).toContain('mcp__blender__*')
      expect(md).toContain('## Pipeline Topology')

      const depMissing = checkSkillRuntimeDependencies({
        allowedTools: ['Read', 'Bash(python *)', 'mcp__blender__*', 'mcp__figma__*'],
        nodeTypes: ['image.portrait', 'custom.unknownNode'],
        registeredNodeTypes: ['image.portrait'],
        mcpRunning: true,
        blenderConnected: false,
        configuredExternalMcpIds: []
      })
      expect(depMissing.ready).toBe(false)
      expect(depMissing.requiresBash).toBe(true)
      expect(depMissing.missingNodeTypes).toEqual(['custom.unknownNode'])
      expect(depMissing.missingMcpServices).toEqual(['blender', 'figma'])

      const depReady = checkSkillRuntimeDependencies({
        allowedTools: ['Read', 'mcp__aiartengine__*', 'mcp__blender__*'],
        nodeTypes: ['image.portrait'],
        registeredNodeTypes: ['image.portrait'],
        mcpRunning: true,
        blenderConnected: true,
        configuredExternalMcpIds: []
      })
      expect(depReady.ready).toBe(true)
    })
  })
})
