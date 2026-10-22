import { describe, expect, it } from 'vitest'
import {
  applyTimelineCreativeTemplateToClips,
  applyVideoTransitionBetweenClips,
  buildClipVisualCssFilter,
  buildClipVisualCssTransform,
  buildClipVisualFfmpegFilter,
  buildClipVisualOverlayMeta,
  buildClipVisualSvgFilterMeta,
  hasClipCreativeAdjustments,
  isDynamicVisualEffect,
  TIMELINE_ADJUSTMENT_CONTROLS,
  TIMELINE_BROWSER_TABS,
  TIMELINE_CREATIVE_TEMPLATES,
  TIMELINE_FILTER_CATEGORIES,
  TIMELINE_FILTER_PRESETS,
  TIMELINE_TRANSITION_CATALOG,
  TIMELINE_TRANSITION_CATEGORIES,
  TIMELINE_VISUAL_EFFECT_CATEGORIES,
  TIMELINE_VISUAL_EFFECTS,
  type ScriptTimelineClip,
  type ScriptTimelineSource
} from '../src/shared/graph/scriptTimeline'
import { applyTimelineEdits } from '../src/shared/graph/timelineEdit'

describe('timelineCreativePack (CapCut 6-tab creative engine)', () => {
  it('exposes complete catalogs and vector SVG iconPaths for all tabs, categories, effects, transitions, filters, adjustments, and templates', () => {
    expect(TIMELINE_BROWSER_TABS.map((t) => t.id)).toEqual([
      'sources',
      'effects',
      'transitions',
      'filters',
      'adjustments',
      'templates'
    ])
    expect(TIMELINE_VISUAL_EFFECT_CATEGORIES.length).toBe(7)
    expect(TIMELINE_VISUAL_EFFECTS.length).toBe(31)
    expect(TIMELINE_TRANSITION_CATEGORIES.length).toBe(6)
    expect(TIMELINE_TRANSITION_CATALOG.length).toBe(40)
    expect(TIMELINE_FILTER_CATEGORIES.length).toBe(6)
    expect(TIMELINE_FILTER_PRESETS.length).toBe(26)
    expect(TIMELINE_ADJUSTMENT_CONTROLS.length).toBe(12)
    expect(TIMELINE_CREATIVE_TEMPLATES.length).toBe(12)

    const allWithIconPath = [
      ...TIMELINE_BROWSER_TABS,
      ...TIMELINE_VISUAL_EFFECT_CATEGORIES,
      ...TIMELINE_VISUAL_EFFECTS,
      ...TIMELINE_TRANSITION_CATEGORIES,
      ...TIMELINE_TRANSITION_CATALOG,
      ...TIMELINE_FILTER_CATEGORIES,
      ...TIMELINE_FILTER_PRESETS,
      ...TIMELINE_ADJUSTMENT_CONTROLS,
      ...TIMELINE_CREATIVE_TEMPLATES
    ]
    for (const item of allWithIconPath) {
      expect(typeof item.iconPath).toBe('string')
      expect(item.iconPath.trim().length).toBeGreaterThan(4)
    }
  })

  it('compiles 60fps CSS filter, transform, and stage overlays for adjustments, LUT filters, and effects', () => {
    expect(hasClipCreativeAdjustments({})).toBe(false)
    expect(buildClipVisualCssFilter({})).toBeUndefined()

    const clip: Partial<ScriptTimelineClip> = {
      brightness: 0.08,
      contrast: 1.2,
      saturation: 1.15,
      vibrance: 20,
      temperature: 25,
      tint: -10,
      highlights: 15,
      shadows: -12,
      sharpen: 30,
      vignette: 40,
      fade: 10,
      grain: 25,
      filterPreset: 'black-gold',
      filterIntensity: 90,
      visualEffect: 'rgb-glitch',
      effectIntensity: 80
    }

    expect(hasClipCreativeAdjustments(clip)).toBe(true)
    const cssFilter = buildClipVisualCssFilter(clip, 0.35)
    expect(cssFilter).toBeTruthy()
    expect(cssFilter).toContain('brightness(')
    expect(cssFilter).toContain('contrast(')
    expect(cssFilter).toContain('saturate(')
    expect(cssFilter).toContain('drop-shadow(')

    const shakeTransform = buildClipVisualCssTransform(
      { visualEffect: 'camera-shake', effectIntensity: 80 },
      0.25
    )
    expect(shakeTransform).toContain('translate(')
    expect(shakeTransform).toContain('rotate(')
    expect(shakeTransform).toContain('scale(')

    const pendulumTransform = buildClipVisualCssTransform(
      { visualEffect: 'pendulum-swing', effectIntensity: 85 },
      0.3
    )
    expect(pendulumTransform).toContain('rotate(')

    const overlayMeta = buildClipVisualOverlayMeta({
      ...clip,
      visualEffect: 'cinema-letterbox',
      effectIntensity: 90
    })
    expect(overlayMeta.hasOverlay).toBe(true)
    expect(overlayMeta.vignetteOpacity).toBeGreaterThan(0.2)
    expect(overlayMeta.letterboxRatio).toBeGreaterThan(0.08)
    expect(overlayMeta.grainOpacity).toBeGreaterThan(0.1)

    const leakMeta = buildClipVisualOverlayMeta({
      visualEffect: 'sunset-leak',
      effectIntensity: 85
    })
    expect(leakMeta.lightLeakOpacity).toBeGreaterThan(0.3)

    const splitMeta = buildClipVisualOverlayMeta({
      visualEffect: 'split-4grid',
      effectIntensity: 80
    })
    expect(splitMeta.splitMode).toBe('split-4grid')
    expect(splitMeta.hasOverlay).toBe(true)
  })

  it('compiles safe FFmpeg filter chains for all filter presets and visual effects without inner parameter commas', () => {
    expect(buildClipVisualFfmpegFilter({})).toBeNull()

    for (const preset of TIMELINE_FILTER_PRESETS) {
      for (const effect of TIMELINE_VISUAL_EFFECTS) {
        const ff = buildClipVisualFfmpegFilter({
          filterPreset: preset.id,
          filterIntensity: 90,
          visualEffect: effect.id,
          effectIntensity: 80,
          sharpen: 25,
          vignette: 30,
          grain: 20,
          temperature: 15,
          tint: -10
        })
        expect(ff).toBeTruthy()
        // Every comma-separated segment must be a valid filterName or filterName=key=val...
        for (const step of ff!.split(',')) {
          expect(step).toMatch(/^[a-z0-9_]+(=[^,]+)?$/)
        }
      }
    }
  })

  it('auto-places video sources and applies full template recipe in one click', () => {
    const sources: ScriptTimelineSource[] = [
      {
        id: 's1',
        title: 'Shot 1',
        relativePath: 'Assets/s1.mp4',
        durationSec: 3,
        mediaKind: 'video'
      },
      {
        id: 's2',
        title: 'Shot 2',
        relativePath: 'Assets/s2.mp4',
        durationSec: 4,
        mediaKind: 'video'
      },
      {
        id: 's3',
        title: 'Shot 3',
        relativePath: 'Assets/s3.mp4',
        durationSec: 3.5,
        mediaKind: 'video'
      }
    ]

    const res = applyTimelineCreativeTemplateToClips(
      [],
      sources,
      {},
      'cyber-neon-drama',
      (list, leftId, rightId, opts) => applyVideoTransitionBetweenClips(list, leftId, rightId, opts)
    )

    expect(res.appliedVideoClipCount).toBe(3)
    expect(res.clips).toHaveLength(3)
    expect(res.clips[0]?.filterPreset).toBe('cyberpunk')
    expect(res.clips[0]?.visualEffect).toBe('rgb-glitch')
    expect(res.clips[1]?.transitionType).toBe('smoothleft')
    expect(res.clips[2]?.transitionType).toBe('pixelize')
    expect(res.settings.subtitleColor).toBe('#22d3ee')
  })

  it('allows patching creative fields through timelineEdit ops', () => {
    const initialClips: ScriptTimelineClip[] = [
      {
        id: 'c1',
        track: 'video',
        sourceId: 's1',
        title: 'Clip 1',
        startSec: 0,
        durationSec: 4
      }
    ]
    const edited = applyTimelineEdits({ clips: initialClips }, [
      {
        op: 'update',
        clipId: 'c1',
        patch: {
          filterPreset: 'teal-orange',
          filterIntensity: 85,
          visualEffect: 'beat-pulse',
          effectIntensity: 70,
          temperature: 22,
          vignette: 35,
          sharpen: 40
        }
      }
    ])
    expect(edited.updated).toBe(1)
    const updated = edited.document.clips[0]!
    expect(updated.filterPreset).toBe('teal-orange')
    expect(updated.filterIntensity).toBe(85)
    expect(updated.visualEffect).toBe('beat-pulse')
    expect(updated.effectIntensity).toBe(70)
    expect(updated.temperature).toBe(22)
    expect(updated.vignette).toBe(35)
    expect(updated.sharpen).toBe(40)
  })

  it('builds GPU SVG filter metadata (colorMatrix, RGB split, sharpen, posterize, mosaic) and supports MCP batchUpdate & applyTemplate', () => {
    expect(isDynamicVisualEffect('rgb-glitch')).toBe(true)
    expect(isDynamicVisualEffect('soul-out')).toBe(true)
    expect(isDynamicVisualEffect('cinema-letterbox')).toBe(false)

    // Dynamic effects produce visible changes even at localTimeSec = 0 (when playhead is paused at clip start)
    expect(
      buildClipVisualCssFilter({ visualEffect: 'rgb-glitch', effectIntensity: 80 }, 0)
    ).toContain('drop-shadow(')
    expect(
      buildClipVisualCssTransform({ visualEffect: 'camera-shake', effectIntensity: 80 }, 0)
    ).toContain('translate(')

    const svgMeta = buildClipVisualSvgFilterMeta(
      {
        filterPreset: 'cyberpunk',
        filterIntensity: 90,
        visualEffect: 'rgb-glitch',
        effectIntensity: 85,
        sharpen: 45,
        temperature: -25,
        tint: 20,
        fade: 15
      },
      0
    )
    expect(svgMeta.enabled).toBe(true)
    expect(svgMeta.colorMatrixValues.split(' ')).toHaveLength(20)
    expect(svgMeta.rgbShiftPx).toBeGreaterThan(2)
    expect(svgMeta.sharpenAmount).toBeGreaterThan(0.1)

    const posterizeMeta = buildClipVisualSvgFilterMeta(
      { visualEffect: 'posterize-pop', effectIntensity: 80 },
      0
    )
    expect(posterizeMeta.posterizeTable).toBeTruthy()

    const mosaicMeta = buildClipVisualSvgFilterMeta(
      { visualEffect: 'pixel-mosaic', effectIntensity: 80 },
      0
    )
    expect(mosaicMeta.mosaicRadius).toBeGreaterThanOrEqual(2)

    const initialClips: ScriptTimelineClip[] = [
      { id: 'v1', track: 'video', sourceId: 's1', title: 'Shot 1', startSec: 0, durationSec: 4 },
      { id: 'v2', track: 'video', sourceId: 's2', title: 'Shot 2', startSec: 4, durationSec: 4 },
      { id: 'v3', track: 'video', sourceId: 's3', title: 'Shot 3', startSec: 8, durationSec: 4 }
    ]

    const batchRes = applyTimelineEdits({ clips: initialClips }, [
      {
        op: 'batchUpdate',
        track: 'video',
        patch: {
          filterPreset: 'black-gold',
          filterIntensity: 88,
          transitionType: 'smoothleft',
          transitionInSec: 0.5
        }
      }
    ])
    expect(batchRes.failures).toEqual([])
    expect(batchRes.updated).toBe(3)
    expect(batchRes.document.clips[0]?.filterPreset).toBe('black-gold')
    expect(batchRes.document.clips[1]?.transitionType).toBe('smoothleft')
    expect(batchRes.document.clips[1]?.startSec).toBe(3.5)
    expect(batchRes.document.clips[2]?.startSec).toBe(7)

    const templateRes = applyTimelineEdits({ clips: initialClips }, [
      { op: 'applyTemplate', templateId: 'black-gold-cinema' }
    ])
    expect(templateRes.failures).toEqual([])
    expect(templateRes.document.clips[0]?.filterPreset).toBe('black-gold')
    expect(templateRes.document.settings?.subtitleColor).toBeTruthy()
  })
})
