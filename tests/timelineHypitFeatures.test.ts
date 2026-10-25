import { describe, expect, it } from 'vitest'
import {
  alignSubtitleWordsAndCues,
  applyCuePunchZoomToVideoClips,
  autoAnnotateSubtitleCueTags,
  buildAutoCueSfxClips,
  buildFaceTrackingKeyframesFromDetections,
  buildKaraokeSubtitleSvgDataUrl,
  buildKaraokeSubtitleSvgMarkup,
  buildSubtitleKeyframeFfmpegXYExpr,
  buildTimelineWidgetSvgDataUrl,
  buildTimelineWidgetSvgMarkup,
  buildViralPackagingPrompts,
  buildVlmSpeakerTrackingPrompts,
  computeSmartReframeCropFromDetections,
  computeSubtitleKaraokeTimeSlices,
  computeTimelineWidgetTimeSlices,
  detectAudioBeatTimestampsFromPeaks,
  evaluateSubtitleClipPosition,
  evaluateTrackedSubjectBoxAtTime,
  extractSpeakerDetectionFromYoloFrame,
  extractTimelineCueWindows,
  getSubtitleClipWordTimings,
  mergeInlineCuesWithAsrWords,
  normalizeTimelineWidgetConfig,
  parseInlineCueText,
  parseViralPackagingResponse,
  parseVlmSpeakerTrackingResponse,
  snapClipsToAudioBeats,
  syncTimelineCueAnchors,
  synthesizeTimelineSfxWavBytes,
  synthesizeTimelineSfxWavDataUrl,
  TIMELINE_PROCEDURAL_SFX_PRESETS,
  TIMELINE_WIDGET_PRESETS,
  type ScriptTimelineClip,
  type ScriptTimelineDocument
} from '../src/shared/graph/scriptTimeline'
import { buildSubtitleClipsFromTranscription } from '../src/shared/graph/timelineSubtitle'
import { applyTimelineEdits } from '../src/shared/graph/timelineEdit'
import {
  applyVariantToPromptPlan,
  buildScriptTimelineBatchVariants,
  BUILTIN_BATCH_VARIANT_TEMPLATES,
  parseBatchVariantSpecs
} from '../src/shared/semanticTimeline/batchVariants'
import {
  buildClipPitchAndVoiceFilter,
  buildFilterGraph,
  expandOverlayClipsForWidgets,
  expandSubtitleKaraokeSnapshotsToOverlays,
  MAX_SUBTITLE_KARAOKE_OVERLAY_SNAPSHOTS,
  renderTimelineWidgetPngBuffer
} from '../src/main/services/timelineExportService'
import {
  materializeFfmpegFilterComplexArgs,
  WINDOWS_CMD_SAFE_LIMIT
} from '../src/main/services/ffmpegRunner'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

describe('Capability 1: Word-Level Forced Alignment & Inline @{tag} Semantic Cues', () => {
  it('parses @{tag}keyword@{/tag}, @[tag:keyword], and || phrase chunks accurately', () => {
    const raw =
      '家人们注意看！||今天带来这款@{boom}王炸黑科技@{/boom}，||价格更是@[deal:真香暴击]！'
    const parsed = parseInlineCueText(raw)
    expect(parsed.cleanText).toBe('家人们注意看！今天带来这款王炸黑科技，价格更是真香暴击！')
    expect(parsed.phraseChunks).toHaveLength(3)
    expect(parsed.cues).toHaveLength(2)
    expect(parsed.cues[0]).toMatchObject({ tag: 'boom', text: '王炸黑科技' })
    expect(parsed.cues[1]).toMatchObject({ tag: 'deal', text: '真香暴击' })
  })

  it('aligns word timings and projects @{tag} spans onto word tokens', () => {
    const aligned = alignSubtitleWordsAndCues({
      text: '真正做到@{fast}毫秒级响应@{/fast}体验',
      durationSec: 3.0
    })
    expect(aligned.cleanText).toBe('真正做到毫秒级响应体验')
    expect(aligned.words.length).toBeGreaterThan(5)
    expect(aligned.cues).toHaveLength(1)
    const fastCue = aligned.cues[0]!
    expect(fastCue.tag).toBe('fast')
    expect(fastCue.text).toBe('毫秒级响应')
    expect(fastCue.startSec).toBeGreaterThan(0)
    expect(fastCue.endSec).toBeGreaterThan(fastCue.startSec)
    const taggedWords = aligned.words.filter((w) => w.cueTags?.includes('fast'))
    expect(taggedWords.map((w) => w.text).join('')).toBe('毫秒级响应')
  })

  it('splits || phrase chunks and preserves @{tag} cues in buildSubtitleClipsFromTranscription', () => {
    const subs = buildSubtitleClipsFromTranscription(
      { startSec: 1.0, durationSec: 4.0 },
      [
        {
          startSec: 0,
          endSec: 4.0,
          text: '第一句开场钩子||第二句点亮@{trophy}冠军奖杯@{/trophy}'
        }
      ],
      (i) => `sub-${i}`
    )
    expect(subs).toHaveLength(2)
    expect(subs[0]!.text).toBe('第一句开场钩子')
    expect(subs[1]!.text).toBe('第二句点亮冠军奖杯')
    expect(subs[1]!.rawCueText).toContain('@{trophy}')
    const cues = extractTimelineCueWindows(subs)
    expect(cues).toHaveLength(1)
    expect(cues[0]!.tag).toBe('trophy')
    expect(cues[0]!.startSec).toBeGreaterThan(subs[1]!.startSec)
  })

  it('automatically snaps overlay, sfx, and widget item triggerSec to @cueTag timestamps', () => {
    const clips: ScriptTimelineClip[] = [
      {
        id: 'sub-1',
        track: 'subtitle',
        sourceId: 's1',
        title: '台词',
        rawCueText: '接下来揭晓@{king}天花板神作@{/king}以及@{boom}核爆级福利@{/boom}！',
        text: '接下来揭晓天花板神作以及核爆级福利！',
        startSec: 2.0,
        durationSec: 4.0
      },
      {
        id: 'ov-sticker',
        track: 'overlay',
        sourceId: 'st1',
        title: '贴纸',
        stickerId: 'boom-burst',
        anchorCueTag: 'boom',
        anchorOffsetSec: -0.05,
        anchorMatchDuration: true,
        startSec: 0,
        durationSec: 1.5
      },
      {
        id: 'ov-widget',
        track: 'overlay',
        sourceId: 'w1',
        title: 'Tier 榜',
        startSec: 1.0,
        durationSec: 6.0,
        widgetConfig: {
          kind: 'tier-board',
          title: '年度神作榜',
          items: [{ id: 'i1', label: '天花板神作', tier: 'S', cueTag: 'king', triggerSec: 0 }]
        }
      }
    ]

    const synced = syncTimelineCueAnchors(clips)
    expect(synced.cueWindows.map((c) => c.tag)).toEqual(['king', 'boom'])
    expect(synced.syncedClipCount).toBe(1)
    expect(synced.syncedWidgetItemCount).toBe(1)

    const stickerClip = synced.clips.find((c) => c.id === 'ov-sticker')!
    const boomCue = synced.cueWindows.find((c) => c.tag === 'boom')!
    expect(stickerClip.startSec).toBeCloseTo(boomCue.startSec - 0.05, 2)

    const widgetClip = synced.clips.find((c) => c.id === 'ov-widget')!
    const kingCue = synced.cueWindows.find((c) => c.tag === 'king')!
    expect(widgetClip.widgetConfig!.items[0]!.triggerSec).toBeCloseTo(
      kingCue.startSec - widgetClip.startSec,
      2
    )
  })

  it('supports syncCues operation in applyTimelineEdits', () => {
    const doc: ScriptTimelineDocument = {
      clips: [
        {
          id: 'sub-1',
          track: 'subtitle',
          sourceId: 's1',
          title: '字幕',
          rawCueText: '看这个@{pop}核心亮点@{/pop}',
          text: '看这个核心亮点',
          startSec: 1.0,
          durationSec: 2.0
        },
        {
          id: 'sfx-1',
          track: 'sfx',
          sourceId: 'sfx',
          title: '音效',
          relativePath: 'Assets/whoosh.mp3',
          anchorCueTag: 'pop',
          startSec: 0,
          durationSec: 0.8
        }
      ]
    }
    const res = applyTimelineEdits(doc, [{ op: 'syncCues' }])
    const sfx = res.document.clips.find((c) => c.id === 'sfx-1')!
    expect(sfx.startSec).toBeGreaterThan(1.1)
  })
})

describe('Capability 2: Word-by-Word Karaoke Pill Captions & YOLO Face-Tracking Subtitles', () => {
  it('builds smoothed face-tracking keyframes and evaluates dynamic subtitle coordinates', () => {
    const kfs = buildFaceTrackingKeyframesFromDetections(
      [
        { offsetSec: 0, box: { x: 0.25, y: 0.18, w: 0.3, h: 0.35 } },
        { offsetSec: 1.0, box: { x: 0.45, y: 0.22, w: 0.3, h: 0.35 } },
        { offsetSec: 2.0, box: { x: 0.35, y: 0.2, w: 0.3, h: 0.35 } }
      ],
      2.0
    )
    expect(kfs).toHaveLength(3)

    const clip: ScriptTimelineClip = {
      id: 'sub-track',
      track: 'subtitle',
      sourceId: 's',
      title: '动态跟随字幕',
      text: '动态跟随字幕',
      startSec: 5.0,
      durationSec: 2.0,
      keyframes: kfs
    }
    const posStart = evaluateSubtitleClipPosition(clip, 5.0)
    const posMid = evaluateSubtitleClipPosition(clip, 6.0)
    expect(posStart.hasCustomPosition).toBe(true)
    expect(posMid.hasCustomPosition).toBe(true)
    expect(posMid.centerX).not.toBeCloseTo(posStart.centerX, 2)

    const expr = buildSubtitleKeyframeFfmpegXYExpr(clip, 48)
    expect(expr).not.toBeNull()
    expect(expr!.xExpr).toContain('(t-5)')
    expect(expr!.yExpr).toContain('(t-5)')
  })

  it('parses multimodal VLM speaker-tracking responses in both [0..1] and [0..1000] coordinate systems', () => {
    const offsets = [0, 1.0, 2.0]
    const prompts = buildVlmSpeakerTrackingPrompts(offsets, '今天测评最强神器')
    expect(prompts.system).toContain('Visual Grounding')
    expect(prompts.prompt).toContain('今天测评最强神器')

    const vlmRaw = `\`\`\`json
[
  {"frame": 1, "x": 0.22, "y": 0.15, "w": 0.24, "h": 0.28, "captionX": 0.34, "captionY": 0.52, "subject": "科技博主"},
  {"frame": 2, "box_2d": [180, 460, 480, 720], "captionX": 590, "captionY": 580, "subject": "科技博主"},
  {"frame": 3, "x": 38, "y": 16, "w": 24, "h": 28, "captionX": 50, "captionY": 54, "subject": "科技博主"}
]
\`\`\``
    const detections = parseVlmSpeakerTrackingResponse(vlmRaw, offsets)
    expect(detections).toHaveLength(3)
    expect(detections[0]!.subject).toBe('科技博主')
    expect(detections[0]!.captionCenter?.x).toBeCloseTo(0.34, 2)
    // Frame 2 uses 0..1000 scale box_2d [ymin=180, xmin=460, ymax=480, xmax=720]
    expect(detections[1]!.box.x).toBeCloseTo(0.46, 2)
    expect(detections[1]!.box.y).toBeCloseTo(0.18, 2)
    expect(detections[1]!.captionCenter?.x).toBeCloseTo(0.59, 2)
    // Frame 3 uses 0..100 percentage scale
    expect(detections[2]!.box.x).toBeCloseTo(0.38, 2)

    const kfs = buildFaceTrackingKeyframesFromDetections(detections, 2.0)
    expect(kfs).toHaveLength(3)
  })

  it('generates word-by-word karaoke-pill drawtext filters in FFmpeg buildFilterGraph', () => {
    const subClip: ScriptTimelineClip = {
      id: 'sub-karaoke',
      track: 'subtitle',
      sourceId: 's',
      title: '爆款字幕',
      text: '今天必看神作',
      startSec: 0.5,
      durationSec: 2.0,
      subtitleKaraokeMode: 'karaoke-pill',
      subtitleHighlightColor: '#facc15',
      subtitleHighlightBgColor: '#ff3b5c'
    }
    const words = getSubtitleClipWordTimings(subClip)
    const graph = buildFilterGraph(
      [
        {
          track: 'video',
          title: 'v0',
          path: '/tmp/v0.mp4',
          inputIndex: 1,
          startSec: 0,
          durationSec: 3
        }
      ],
      [],
      [],
      [
        {
          track: 'subtitle',
          title: subClip.title,
          text: subClip.text!,
          startSec: subClip.startSec,
          durationSec: subClip.durationSec,
          words,
          subtitleKaraokeMode: 'karaoke-pill',
          subtitleHighlightColor: '#facc15',
          subtitleHighlightBgColor: '#ff3b5c'
        }
      ],
      0,
      2,
      1,
      1080,
      1920,
      30,
      44,
      140,
      '#ffffff',
      undefined,
      undefined,
      {
        scaleMode: 'cover',
        subtitleKaraokeMode: 'karaoke-pill',
        subtitleHighlightColor: '#facc15',
        subtitleHighlightBgColor: '#ff3b5c'
      }
    )
    expect(graph.filter).toContain('drawtext=')
    expect(graph.filter).toContain('box=1:boxcolor=#ff3b5c')
  })
})

describe('Capability 3: Programmable Motion-Graphics Widget Overlays', () => {
  it('renders SVG markup and slices stateful widget overlays for FFmpeg export', () => {
    for (const preset of TIMELINE_WIDGET_PRESETS) {
      const cfg = normalizeTimelineWidgetConfig(preset.defaultConfig())
      expect(cfg).toBeDefined()
      const svg = buildTimelineWidgetSvgMarkup(cfg!, 1.5)
      expect(svg).toContain('<svg')
      const url = buildTimelineWidgetSvgDataUrl(cfg!, 1.5)
      expect(url.startsWith('data:image/svg+xml;utf8,')).toBe(true)
      const pngBuf = renderTimelineWidgetPngBuffer(cfg!, 1.5)
      expect(pngBuf.subarray(0, 4).toString('hex')).toBe('89504e47')
    }

    const tierCfg = TIMELINE_WIDGET_PRESETS[0]!.defaultConfig()
    const slices = computeTimelineWidgetTimeSlices(tierCfg, 4.5)
    expect(slices.length).toBeGreaterThanOrEqual(3)

    const expanded = expandOverlayClipsForWidgets([
      {
        track: 'overlay',
        title: '梯度榜',
        startSec: 1.0,
        durationSec: 4.5,
        widgetConfig: tierCfg
      }
    ])
    expect(expanded.length).toBe(slices.length)
  })
})

describe('Capability 4: 1-to-N Batch Variant Matrix', () => {
  it('parses batch variant specs and generates N prompt plan & script timeline variants', () => {
    const tpl = BUILTIN_BATCH_VARIANT_TEMPLATES[0]!
    const specs = parseBatchVariantSpecs(JSON.stringify(tpl.specs))
    expect(specs.length).toBe(tpl.specs.length)

    const basePlan = {
      schema: 'aiart.video-prompts@1' as const,
      timelineId: 'stl.demo',
      sourceAssetId: 'asset.demo',
      createdAt: new Date().toISOString(),
      lang: 'zh' as const,
      fullPrompt: 'Original visual prompt',
      settings: {
        width: 1080,
        height: 1920,
        fps: 30,
        durationSec: 3
      },
      source: { durationSec: 3, fps: 30 },
      shots: [
        {
          shotId: 'sh.1',
          sourceRange: { start: 0, end: 3 },
          startSec: 0,
          durationSec: 3,
          targetDurationSec: 3,
          strategy: 'regenerate' as const,
          prompt: 'Original visual prompt',
          negativePrompt: '',
          entities: [],
          eventLabels: [],
          sourceIntentIds: [],
          changeReasons: ['hook']
        }
      ],
      subtitles: [
        {
          sourceStartSec: 0.2,
          sourceEndSec: 2.8,
          text: '原始台词'
        }
      ],
      dubs: [
        {
          id: 'utt.1',
          sourceStartSec: 0.2,
          sourceEndSec: 2.8,
          sourceText: '原始台词',
          text: '原始台词'
        }
      ],
      removedShotIds: []
    }

    const vPlan = applyVariantToPromptPlan(basePlan, {
      id: 'v-custom',
      title: '脱口秀版',
      instruction: '夸张霓虹赛博风',
      dubVoice: 'male-energetic',
      dialogueOverrides: {
        'utt.1': '全新@{boom}爆梗开场@{/boom}！'
      }
    })
    expect(vPlan.shots[0]!.prompt).toContain('夸张霓虹赛博风')
    expect(vPlan.dubs![0]!.text).toBe('全新爆梗开场！')

    const baseTimeline: ScriptTimelineDocument = {
      clips: [
        {
          id: 'sub-0',
          track: 'subtitle',
          sourceId: 's0',
          title: '原始台词',
          text: '原始台词',
          startSec: 0.5,
          durationSec: 2.5
        },
        {
          id: 'ov-0',
          track: 'overlay',
          sourceId: 'o0',
          title: '贴纸',
          stickerId: 'boom-burst',
          anchorCueTag: 'boom',
          startSec: 0,
          durationSec: 1.0
        }
      ]
    }

    const timelineVariants = buildScriptTimelineBatchVariants(baseTimeline, [
      {
        id: 'v1',
        title: '变体1',
        subtitleKaraokeMode: 'karaoke-pill',
        dialogueOverrides: {
          0: '开头第一句立刻引爆@{boom}全场焦点@{/boom}！'
        }
      }
    ])
    expect(timelineVariants).toHaveLength(1)
    expect(timelineVariants[0]!.document.settings?.subtitleKaraokeMode).toBe('karaoke-pill')
    const syncedOverlay = timelineVariants[0]!.document.clips.find((c) => c.id === 'ov-0')!
    expect(syncedOverlay.startSec).toBeGreaterThan(0.8)
  })
})

describe('Perfection Upgrades: ASR Cue Merge, Pixel-Identical Karaoke SVG, Procedural SFX & Punch-In Zoom', () => {
  it('merges @{tag} inline cues onto real ASR word timestamps without losing spoken timings', () => {
    const asrWords = [
      { text: '今天', startSec: 0.08, endSec: 0.42 },
      { text: '揭秘', startSec: 0.45, endSec: 0.88 },
      { text: '王炸', startSec: 0.92, endSec: 1.35 },
      { text: '神器', startSec: 1.36, endSec: 1.82 }
    ]
    const merged = mergeInlineCuesWithAsrWords({
      rawCueText: '今天揭秘@{boom}王炸神器@{/boom}',
      asrWords,
      durationSec: 2.0
    })
    expect(merged.cleanText).toBe('今天揭秘王炸神器')
    expect(merged.words).toHaveLength(4)
    // Exact spoken timestamps from ASR are preserved
    expect(merged.words[2]!.startSec).toBe(0.92)
    expect(merged.words[3]!.endSec).toBe(1.82)
    // And @boom tag is projected onto the exact ASR words "王炸" and "神器"
    expect(merged.words[2]!.cueTags).toContain('boom')
    expect(merged.words[3]!.cueTags).toContain('boom')
    expect(merged.cues).toHaveLength(1)
    expect(merged.cues[0]!.startSec).toBeCloseTo(0.92, 2)
    expect(merged.cues[0]!.endSec).toBeCloseTo(1.82, 2)
  })

  it('renders rounded-pill karaoke SVG slices and expands subtitleStateSnapshots for FFmpeg export', () => {
    const subClip: ScriptTimelineClip = {
      id: 'sub-pill',
      track: 'subtitle',
      sourceId: 's',
      title: '测试胶囊字幕',
      rawCueText: '马上点亮@{trophy}年度王炸神作@{/trophy}！',
      text: '马上点亮年度王炸神作！',
      startSec: 1.0,
      durationSec: 2.4,
      subtitleKaraokeMode: 'karaoke-pill',
      subtitleHighlightColor: '#ffffff',
      subtitleHighlightBgColor: '#ff3b5c'
    }
    const slices = computeSubtitleKaraokeTimeSlices(subClip)
    expect(slices.length).toBeGreaterThanOrEqual(4)
    const svg = buildKaraokeSubtitleSvgMarkup({
      clip: subClip,
      localTimeSec: slices[1]!.sampleLocalSec,
      karaokeMode: 'karaoke-pill'
    })
    expect(svg).toContain('<svg')
    expect(svg).toContain('rx="13"')
    expect(svg).toContain('#ff3b5c')
    const dataUrl = buildKaraokeSubtitleSvgDataUrl({
      clip: subClip,
      localTimeSec: slices[1]!.sampleLocalSec,
      karaokeMode: 'karaoke-pill'
    })
    expect(dataUrl.startsWith('data:image/svg+xml;utf8,')).toBe(true)

    // Verify expandSubtitleKaraokeSnapshotsToOverlays with a 1x1 PNG data URL
    const tinyPngDataUrl =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const expanded = expandSubtitleKaraokeSnapshotsToOverlays(
      [
        {
          track: 'subtitle',
          title: '测试胶囊字幕',
          text: '马上点亮年度王炸神作！',
          startSec: 1.0,
          durationSec: 2.4,
          subtitleStateSnapshots: [
            { startOffsetSec: 0, endOffsetSec: 1.2, pngDataUrl: tinyPngDataUrl },
            { startOffsetSec: 1.2, endOffsetSec: 2.4, pngDataUrl: tinyPngDataUrl }
          ]
        }
      ],
      120,
      1920
    )
    expect(expanded.remainingSubs).toHaveLength(0)
    expect(expanded.subtitleOverlayClips).toHaveLength(2)
    expect(expanded.subtitleOverlayClips[0]!.track).toBe('overlay')
  })

  it('supports iconEmoji, imageUrl thumbnails, and theme palettes in motion widgets', () => {
    const cfg = normalizeTimelineWidgetConfig({
      kind: 'tier-board',
      title: '全模态神作榜',
      theme: 'gold-luxury',
      items: [
        {
          id: 'i1',
          label: 'DeepSeek V4',
          tier: 'S',
          iconEmoji: '🏆',
          imageUrl:
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
          triggerSec: 0.2
        }
      ]
    })
    expect(cfg?.items[0]!.iconEmoji).toBe('🏆')
    expect(cfg?.items[0]!.imageUrl).toContain('data:image/png;base64,')
    const svg = buildTimelineWidgetSvgMarkup(cfg!, 1.0)
    expect(svg).toContain('🏆')
    expect(svg).toContain('<image href="data:image/png;base64,')
  })

  it('synthesizes 16-bit PCM WAV procedural SFX and auto-populates @cueTag & widget card-pop SFX', () => {
    for (const preset of TIMELINE_PROCEDURAL_SFX_PRESETS) {
      const wav = synthesizeTimelineSfxWavBytes(preset.id)
      expect(Buffer.from(wav.subarray(0, 4)).toString('ascii')).toBe('RIFF')
      expect(Buffer.from(wav.subarray(8, 12)).toString('ascii')).toBe('WAVE')
      const url = synthesizeTimelineSfxWavDataUrl(preset.id)
      expect(url.startsWith('data:audio/wav;base64,')).toBe(true)
    }

    const clips: ScriptTimelineClip[] = [
      {
        id: 'sub-1',
        track: 'subtitle',
        sourceId: 's1',
        title: '台词',
        rawCueText: '第一名@{boom}重磅登场@{/boom}！',
        text: '第一名重磅登场！',
        startSec: 1.0,
        durationSec: 2.0
      },
      {
        id: 'w-1',
        track: 'overlay',
        sourceId: 'w1',
        title: '排行榜',
        startSec: 0.5,
        durationSec: 4.0,
        widgetConfig: {
          kind: 'ranking-list',
          title: 'TOP 榜',
          items: [
            { id: 'r1', label: '条目A', triggerSec: 0.4 },
            { id: 'r2', label: '条目B', triggerSec: 1.8 }
          ]
        }
      }
    ]
    const autoSfx = buildAutoCueSfxClips(clips, (i) => `auto-sfx-${i}`)
    expect(autoSfx.addedCount).toBe(3)
    const boomSfx = autoSfx.clips.find((c) => c.track === 'sfx' && c.anchorCueTag === 'boom')
    expect(boomSfx).toBeDefined()
    expect(boomSfx!.sfxPresetId).toBe('boom')
  })

  it('automatically applies ImpactPush camera motion and punch-in zoom on video clips overlapping @cueTag', () => {
    const clips: ScriptTimelineClip[] = [
      {
        id: 'v-1',
        track: 'video',
        sourceId: 'v1',
        title: '主镜头1',
        startSec: 0,
        durationSec: 3.0
      },
      {
        id: 'sub-1',
        track: 'subtitle',
        sourceId: 's1',
        title: '字幕',
        rawCueText: '注意看这个@{boom}神级细节@{/boom}！',
        text: '注意看这个神级细节！',
        startSec: 0.5,
        durationSec: 2.0
      }
    ]
    const punched = applyCuePunchZoomToVideoClips(clips)
    expect(punched.updatedVideoClipCount).toBe(1)
    const v1 = punched.clips.find((c) => c.id === 'v-1')!
    expect(v1.cameraMotion).toBe('impactPush')
    expect(v1.cropWidth).toBeLessThan(0.95)
    expect(v1.cropX).toBeGreaterThan(0.02)
  })
})

describe('Next-Level Enhancements (1~6): Multi-Line Karaoke SVG, Spring-Settle Widgets, AI Viral Auto-Packaging, 9:16 Smart Reframe, Beat Sub-Clip Split & BGM Beat Snapping', () => {
  it('1. wraps long karaoke subtitles into 2 balanced lines and renders persistent @cueTag emphasis bars', () => {
    const longSubClip: ScriptTimelineClip = {
      id: 'sub-long',
      track: 'subtitle',
      sourceId: 's-long',
      title: '超长字幕折行测试',
      rawCueText:
        '今天带大家深度评测这款真正做到@{boom}颠覆行业天花板@{/boom}的全模态人工智能生产力工具！',
      text: '今天带大家深度评测这款真正做到颠覆行业天花板的全模态人工智能生产力工具！',
      startSec: 0,
      durationSec: 4.0,
      fontSize: 54,
      subtitleKaraokeMode: 'karaoke-pill',
      subtitleHighlightColor: '#facc15',
      subtitleHighlightBgColor: '#ff3b5c'
    }
    const svg = buildKaraokeSubtitleSvgMarkup({
      clip: longSubClip,
      localTimeSec: 0.1, // first word active, @boom words inactive yet still emphasized
      karaokeMode: 'karaoke-pill'
    })
    // Should contain persistent underline bar (height="4" rx="2") for inactive @cueTag words
    expect(svg).toContain('height="4" rx="2" fill="#facc15"')
    // Should wrap into 2 distinct baseline Y coordinates
    const yMatches = [...svg.matchAll(/<text x="\d+" y="(\d+)"/g)].map((m) => Number(m[1]))
    const uniqueYs = new Set(yMatches)
    expect(uniqueYs.size).toBeGreaterThanOrEqual(2)
  })

  it('2. emits dual-phase [bounce -> settle] time slices for motion widgets so newly triggered items spring-pop', () => {
    const cfg = normalizeTimelineWidgetConfig({
      kind: 'ranking-list',
      title: 'TOP 榜',
      items: [
        { id: '1', label: '第一项', triggerSec: 0 },
        { id: '2', label: '第二项', triggerSec: 1.0 }
      ]
    })!
    const slices = computeTimelineWidgetTimeSlices(cfg, 3.0)
    // Trigger at 0s -> [0, 0.2] bounce + [0.2, 1.0] settle; Trigger at 1.0s -> [1.0, 1.2] bounce + [1.2, 3.0] settle
    expect(slices.length).toBe(4)
    expect(slices[0]!.startOffsetSec).toBe(0)
    expect(slices[0]!.endOffsetSec).toBeCloseTo(0.2, 2)
    expect(slices[1]!.startOffsetSec).toBeCloseTo(0.2, 2)
    expect(slices[1]!.endOffsetSec).toBeCloseTo(1.0, 2)

    const bounceSvg = buildTimelineWidgetSvgMarkup(cfg, slices[2]!.sampleLocalSec)
    const settleSvg = buildTimelineWidgetSvgMarkup(cfg, slices[3]!.sampleLocalSec)
    expect(bounceSvg).toContain('scale(1.06)')
    expect(settleSvg).not.toContain('scale(1.06)')
  })

  it('3. auto-annotates plain subtitles with @cueTag (LLM + rule fallback) and enables karaoke-pill', () => {
    const plainClips: ScriptTimelineClip[] = [
      {
        id: 'sub-a',
        track: 'subtitle',
        sourceId: 'sa',
        title: '测试1',
        text: '这绝对是今年王炸级的100%免费工具！',
        startSec: 0,
        durationSec: 2.5
      },
      {
        id: 'sub-b',
        track: 'subtitle',
        sourceId: 'sb',
        title: '测试2',
        text: '但是接下来的隐藏技巧更绝了',
        startSec: 2.5,
        durationSec: 2.5
      }
    ]
    const annotated = autoAnnotateSubtitleCueTags(plainClips)
    expect(annotated.annotatedSubtitleCount).toBe(2)
    expect(annotated.injectedTagCount).toBeGreaterThanOrEqual(2)
    expect(annotated.clips[0]!.rawCueText).toContain('@{boom}王炸@{/boom}')
    expect(annotated.clips[0]!.rawCueText).toContain('@{ding}100%@{/ding}')
    expect(annotated.clips[0]!.subtitleKaraokeMode).toBe('karaoke-pill')

    // Also verify LLM response parser guards against hallucinated text modifications
    const prompts = buildViralPackagingPrompts([{ id: 'sub-a', text: '测试原文字幕' }])
    expect(prompts.prompt).toContain('sub-a')
    const validMap = parseViralPackagingResponse(
      JSON.stringify([{ id: 'sub-a', cueText: '测试@{boom}原文@{/boom}字幕' }]),
      [{ id: 'sub-a', text: '测试原文字幕' }]
    )
    expect(validMap.get('sub-a')).toBe('测试@{boom}原文@{/boom}字幕')
  })

  it('4. computes 9:16 portrait subject-centered crop window from VLM speaker detections', () => {
    const detections = [
      { offsetSec: 0, box: { x: 0.68, y: 0.18, w: 0.2, h: 0.32 } },
      { offsetSec: 1, box: { x: 0.7, y: 0.2, w: 0.2, h: 0.32 } }
    ]
    const reframe = computeSmartReframeCropFromDetections(detections, 16 / 9, 9 / 16)
    // Subject is on the right (~0.79 center X), so cropX should shift right instead of staying at center
    expect(reframe.cropWidth).toBeCloseTo(0.316, 2)
    expect(reframe.cropHeight).toBe(1)
    expect(reframe.cropX).toBeGreaterThan(0.5)
  })

  it('5. splits long video clips around the spoken @cueTag window when splitAtCueWindow is enabled', () => {
    const clips: ScriptTimelineClip[] = [
      {
        id: 'v-long',
        track: 'video',
        sourceId: 'v1',
        title: '长镜头',
        startSec: 0,
        durationSec: 4.0,
        sourceOffsetSec: 2.0
      },
      {
        id: 'sub-cue',
        track: 'subtitle',
        sourceId: 's1',
        title: '台词',
        rawCueText: '前面铺垫一下然后@{boom}直接封神@{/boom}后面继续讲',
        text: '前面铺垫一下然后直接封神后面继续讲',
        startSec: 0.5,
        durationSec: 3.0
      }
    ]
    const res = applyCuePunchZoomToVideoClips(clips, 1.15, { splitAtCueWindow: true })
    expect(res.updatedVideoClipCount).toBe(1)
    expect(res.splitSubClipCount).toBeGreaterThanOrEqual(2)
    const videoParts = res.clips.filter((c) => c.track === 'video')
    expect(videoParts.length).toBe(3)
    // Middle clip is the punched beat window; pre and post remain un-punched
    expect(videoParts[0]!.cameraMotion).toBeUndefined()
    expect(videoParts[1]!.cameraMotion).toBe('impactPush')
    expect(videoParts[2]!.cameraMotion).toBeUndefined()
    // Source offsets are continuous
    expect(videoParts[1]!.sourceOffsetSec).toBeCloseTo(2.0 + (videoParts[1]!.startSec - 0), 2)
  })

  it('6. detects audio beat onset timestamps from peaks envelope and snaps video cuts to BGM beats', () => {
    const peaks = new Float32Array(200)
    // Inject strong drum transients at 1.0s (bucket 50), 2.0s (bucket 100), 3.0s (bucket 150) over 4.0s duration
    peaks[50] = 0.95
    peaks[100] = 0.92
    peaks[150] = 0.98
    const beats = detectAudioBeatTimestampsFromPeaks(peaks, 4.0, { minIntervalSec: 0.25 })
    expect(beats).toHaveLength(3)
    expect(beats[0]).toBeCloseTo(1.0, 1)
    expect(beats[1]).toBeCloseTo(2.0, 1)
    expect(beats[2]).toBeCloseTo(3.0, 1)

    const rawClips: ScriptTimelineClip[] = [
      { id: 'v1', track: 'video', sourceId: 's1', title: '镜头1', startSec: 0, durationSec: 1.08 },
      {
        id: 'v2',
        track: 'video',
        sourceId: 's2',
        title: '镜头2',
        startSec: 1.08,
        durationSec: 0.96
      },
      { id: 'v3', track: 'video', sourceId: 's3', title: '镜头3', startSec: 2.04, durationSec: 1.5 }
    ]
    const snapped = snapClipsToAudioBeats(rawClips, beats, 0.2)
    expect(snapped.snappedClipCount).toBeGreaterThanOrEqual(2)
    const sv2 = snapped.clips.find((c) => c.id === 'v2')!
    const sv3 = snapped.clips.find((c) => c.id === 'v3')!
    expect(sv2.startSec).toBeCloseTo(1.0, 1)
    expect(sv3.startSec).toBeCloseTo(2.0, 1)
  })

  it('7. prevents Windows spawn ENAMETOOLONG by offloading -filter_complex to -filter_complex_script and capping karaoke PNG inputs', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'aiart-test-ffscript-'))
    try {
      const hugeFilter = Array.from(
        { length: 650 },
        (_, i) => `[v${i}]drawtext=text='测试超长滤镜链_${i}':x=100:y=200[v${i + 1}]`
      ).join(';')
      expect(hugeFilter.length).toBeGreaterThan(WINDOWS_CMD_SAFE_LIMIT)

      const rawArgs = ['-y', '-i', 'input.mp4', '-filter_complex', hugeFilter, 'out.mp4']
      const safeArgs = materializeFfmpegFilterComplexArgs(rawArgs, tempDir)
      expect(safeArgs).not.toContain('-filter_complex')
      expect(safeArgs).toContain('-filter_complex_script')
      const scriptIdx = safeArgs.indexOf('-filter_complex_script')
      const scriptPath = safeArgs[scriptIdx + 1]!
      expect(readFileSync(scriptPath, 'utf-8')).toBe(hugeFilter)
      const cmdLen = safeArgs.reduce((s, a) => s + a.length + 3, 0)
      expect(cmdLen).toBeLessThan(500)
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }

    // Also verify karaoke snapshot expansion caps PNG overlay count at MAX_SUBTITLE_KARAOKE_OVERLAY_SNAPSHOTS
    const fakePng = `data:image/png;base64,${renderTimelineWidgetPngBuffer(TIMELINE_WIDGET_PRESETS[0]!.defaultConfig(), 0).toString('base64')}`
    const manySubs = Array.from({ length: 12 }, (_, idx) => ({
      track: 'subtitle' as const,
      title: `sub-${idx}`,
      text: '一二三四',
      startSec: idx * 2,
      durationSec: 1.8,
      subtitleStateSnapshots: [
        { startOffsetSec: 0, endOffsetSec: 0.45, pngDataUrl: fakePng },
        { startOffsetSec: 0.45, endOffsetSec: 0.9, pngDataUrl: fakePng },
        { startOffsetSec: 0.9, endOffsetSec: 1.35, pngDataUrl: fakePng },
        { startOffsetSec: 1.35, endOffsetSec: 1.8, pngDataUrl: fakePng }
      ]
    }))
    const expanded = expandSubtitleKaraokeSnapshotsToOverlays(manySubs, 100, 1920)
    expect(expanded.subtitleOverlayClips.length).toBeLessThanOrEqual(
      MAX_SUBTITLE_KARAOKE_OVERLAY_SNAPSHOTS
    )
    expect(expanded.remainingSubs.length).toBeGreaterThan(0)
  })

  it('8. extracts speaker detection from local YOLO face and person boxes by default', () => {
    const fromFace = extractSpeakerDetectionFromYoloFrame(
      0.5,
      {
        width: 1000,
        height: 1000,
        faces: [{ score: 0.92, box: { x: 400, y: 200, width: 200, height: 220 } }]
      },
      null
    )
    expect(fromFace).not.toBeNull()
    expect(fromFace!.subject).toBe('人脸')
    expect(fromFace!.box.x).toBeCloseTo(0.4, 2)
    expect(fromFace!.box.y).toBeCloseTo(0.2, 2)

    const fromPerson = extractSpeakerDetectionFromYoloFrame(0.8, null, {
      width: 1920,
      height: 1080,
      boxes: [
        { label: 'chair', confidence: 0.9, x: 100, y: 500, width: 300, height: 400 },
        { label: 'person', confidence: 0.85, x: 768, y: 180, width: 384, height: 720 }
      ]
    })
    expect(fromPerson).not.toBeNull()
    expect(fromPerson!.subject).toBe('人物主体')
    expect(fromPerson!.box.x).toBeCloseTo(0.4, 2)
  })

  it('9. provides visual tracking HUD box and dynamic speaking micro-motion even on still speakers', () => {
    const staticDetections = [
      { offsetSec: 0, box: { x: 0.4, y: 0.2, w: 0.2, h: 0.3 }, subject: '人脸' },
      { offsetSec: 1.0, box: { x: 0.4, y: 0.2, w: 0.2, h: 0.3 }, subject: '人脸' },
      { offsetSec: 2.0, box: { x: 0.4, y: 0.2, w: 0.2, h: 0.3 }, subject: '人脸' }
    ]
    const kfs = buildFaceTrackingKeyframesFromDetections(staticDetections, 2.0)
    expect(kfs).toHaveLength(3)
    // Micro-motion ensures middle keyframe differs slightly from start keyframe so tracking movement is visible
    expect(Math.abs(kfs[1]!.x - kfs[0]!.x)).toBeGreaterThan(0.01)

    const trackedClip: ScriptTimelineClip = {
      id: 'sub-hud',
      track: 'subtitle',
      sourceId: 's-hud',
      title: '测试字幕',
      text: '测试字幕',
      startSec: 1.0,
      durationSec: 2.0,
      keyframes: kfs
    }
    const hud = evaluateTrackedSubjectBoxAtTime(
      trackedClip,
      2.0,
      staticDetections,
      '本地 YOLO（人脸）'
    )
    expect(hud).not.toBeNull()
    expect(hud!.w).toBeCloseTo(0.2, 2)
    expect(hud!.label).toContain('本地 YOLO')
    expect(hud!.subtitleCenterY).toBeGreaterThan(hud!.y + hud!.h)
  })

  it('10. supports duration-preserving semitone pitch shifting (pitchSemitones) and vocal effects (voiceEffect)', () => {
    // 1) Pure semitone shift (+7 semitones = perfect fifth, 2^(7/12) ≈ 1.498307)
    const fifthUp = buildClipPitchAndVoiceFilter(1, 7, 'none')
    expect(fifthUp).toContain('aresample=44100,asetrate=66075,aresample=44100')
    expect(fifthUp).toContain('atempo=0.667')

    // 2) VoiceEffect preset defaults (chipmunk -> +5 semitones, demon -> -5 semitones)
    const chipmunk = buildClipPitchAndVoiceFilter(1, 0, 'chipmunk')
    expect(chipmunk).toContain('asetrate=58866')
    const demon = buildClipPitchAndVoiceFilter(1, 0, 'demon')
    expect(demon).toContain('asetrate=33038')
    expect(demon).toContain('equalizer=f=110:t=q:w=1.0:g=5')

    // 3) Combined speed + pitchSemitones + autotune-chorus in buildFilterGraph
    const graph = buildFilterGraph(
      [
        {
          track: 'video',
          title: '鬼畜高潮镜头',
          path: '/tmp/guichu.mp4',
          inputIndex: 1,
          startSec: 0,
          durationSec: 0.96,
          speed: 1.25
        }
      ],
      [],
      [
        {
          track: 'video',
          title: '鬼畜高潮镜头',
          path: '/tmp/guichu.mp4',
          inputIndex: 1,
          startSec: 0,
          durationSec: 0.96,
          speed: 1.25,
          pitchSemitones: 4,
          voiceEffect: 'autotune-chorus'
        }
      ],
      [],
      0,
      2,
      1,
      1280,
      720,
      30,
      44,
      60,
      '#FACC15'
    )
    expect(graph.filter).toContain('asetrate=55563')
    expect(graph.filter).toContain('aecho=0.8:0.88:12|24:0.42|0.32')

    // 4) timelineEdit patch supports pitchSemitones & voiceEffect
    const doc: ScriptTimelineDocument = {
      clips: [
        {
          id: 'v-1',
          track: 'video',
          sourceId: 'src-video',
          title: '测试镜头',
          startSec: 0,
          durationSec: 0.96
        }
      ]
    }
    const edited = applyTimelineEdits(doc, [
      {
        op: 'update',
        clipId: 'v-1',
        patch: { pitchSemitones: 15, voiceEffect: 'autotune-chorus' }
      }
    ])
    const patchedClip = edited.document.clips[0]!
    expect(patchedClip.pitchSemitones).toBe(12) // clamped to [-12, 12]
    expect(patchedClip.voiceEffect).toBe('autotune-chorus')
  })
})
