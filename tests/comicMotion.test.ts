import { describe, expect, it } from 'vitest'
import {
  buildComicMotionTimeline,
  computeComicPanelCropRect,
  createComicPage,
  extractComicDialogueLines,
  inferComicBubbleStickerAndSfx,
  inferComicPanelCameraMotion,
  readingOrderBubbles,
  slantPresetToCornerOffsets,
  type ComicPage
} from '../src/shared/graph'

describe('comicMotion (Motion Comic compiler)', () => {
  const sampleMangaPage: ComicPage = {
    version: 1,
    width: 1080,
    height: 1520,
    columns: 6,
    rows: 6,
    gutter: 16,
    padding: 32,
    readingDirection: 'rtl',
    title: '第一话：觉醒之夜',
    panels: [
      {
        id: 'p-top-right',
        row: 0,
        col: 3,
        rowSpan: 2,
        colSpan: 3,
        imageUrl: 'Assets/panel1.png',
        effectType: 'focus-lines',
        effectIntensity: 0.7,
        bubbles: [
          {
            id: 'b1',
            speaker: '凌霄',
            text: '这股灵压……绝不可能！',
            x: 0.75,
            y: 0.25,
            tail: 'bl',
            shape: 'shout'
          },
          {
            id: 'b2',
            speaker: '神秘人',
            text: '终于找到你了。',
            x: 0.25,
            y: 0.55,
            tail: 'br',
            shape: 'oval'
          }
        ]
      },
      {
        id: 'p-top-left',
        row: 0,
        col: 0,
        rowSpan: 2,
        colSpan: 3,
        imageUrl: 'Assets/panel2.png',
        effectType: 'speed-lines',
        cornerOffsets: slantPresetToCornerOffsets('slash-right'),
        bubbles: [
          {
            id: 'b3',
            text: '咔嚓！',
            x: 0.6,
            y: 0.7,
            tail: 'bl',
            shape: 'sfx'
          }
        ]
      },
      {
        id: 'p-bottom-climax',
        row: 2,
        col: 0,
        rowSpan: 4,
        colSpan: 6,
        imageUrl: 'Assets/panel3.png',
        videoUrl: 'Assets/panel3-climax.mp4',
        cameraMotion: 'kenBurnsIn',
        durationSec: 4.5,
        bubbles: [
          {
            id: 'b4',
            speaker: '凌霄',
            text: '雷霆万钧，破！',
            x: 0.5,
            y: 0.3,
            tail: 'bl',
            shape: 'shout'
          }
        ]
      }
    ]
  }

  it('orders bubbles and extracts dialogue lines respecting RTL manga reading order', () => {
    const bubbles = sampleMangaPage.panels[0]!.bubbles
    const ordered = readingOrderBubbles(bubbles, 'rtl')
    expect(ordered.map((b) => b.id)).toEqual(['b1', 'b2'])

    const dialogues = extractComicDialogueLines(sampleMangaPage)
    // RTL reading order: p-top-right (col 3) -> p-top-left (col 0, only sfx so skipped) -> p-bottom-climax (row 2)
    expect(dialogues.map((d) => d.bubbleId)).toEqual(['b1', 'b2', 'b4'])
    expect(dialogues[0]?.speaker).toBe('凌霄')
  })

  it('computes normalized crop rects within [0..1] for panels', () => {
    const crop1 = computeComicPanelCropRect(sampleMangaPage, 'p-top-right')
    expect(crop1).not.toBeNull()
    expect(crop1!.cropX).toBeGreaterThan(0.45)
    expect(crop1!.cropY).toBeGreaterThanOrEqual(0)
    expect(crop1!.cropWidth).toBeGreaterThan(0.35)
    expect(crop1!.cropX + crop1!.cropWidth).toBeLessThanOrEqual(1)
    expect(crop1!.cropY + crop1!.cropHeight).toBeLessThanOrEqual(1)
  })

  it('infers camera motion and bubble stickers/SFX from panel and bubble semantics', () => {
    const page = createComicPage()
    expect(inferComicPanelCameraMotion(sampleMangaPage, sampleMangaPage.panels[0]!, 0)).toBe(
      'kenBurnsIn'
    )
    expect(inferComicPanelCameraMotion(sampleMangaPage, sampleMangaPage.panels[1]!, 1)).toBe(
      'panLeft'
    )
    expect(page.width).toBeGreaterThan(0)

    const slashSfx = inferComicBubbleStickerAndSfx(sampleMangaPage.panels[1]!.bubbles[0]!)
    expect(slashSfx.stickerId).toBe('neon-slash-combo')
    expect(slashSfx.sfxPresetId).toBe('whoosh')

    const thunderShout = inferComicBubbleStickerAndSfx(sampleMangaPage.panels[2]!.bubbles[0]!)
    expect(thunderShout.stickerId).toBe('electric-lightning')
    expect(thunderShout.sfxPresetId).toBe('boom')
  })

  it('compiles a full multi-track Motion Comic ScriptTimelineDocument', () => {
    const doc = buildComicMotionTimeline({
      page: sampleMangaPage,
      pageImageRelativePath: 'Cache/Images/comic-page-1.png',
      nodeId: 'comic-1',
      nodeTitle: '第一话漫画页',
      voices: [
        { relativePath: 'Assets/v1.mp3', durationSec: 2.0, text: '这股灵压……绝不可能！' },
        { relativePath: 'Assets/v2.mp3', durationSec: 1.5, text: '终于找到你了。' },
        { relativePath: 'Assets/v3.mp3', durationSec: 2.2, text: '雷霆万钧，破！' }
      ],
      music: [{ relativePath: 'Assets/bgm.mp3', title: 'Battle BGM' }]
    })

    const videoClips = doc.clips.filter((c) => c.track === 'video')
    // 1 establishing shot + 3 panels = 4 video clips
    expect(videoClips.length).toBe(4)

    // Clip 0: full-page establishing shot (extended by 0.28s transition overlap into Clip 1)
    expect(videoClips[0]?.relativePath).toBe('Cache/Images/comic-page-1.png')
    expect(videoClips[0]?.cropWidth).toBeUndefined()
    expect(
      videoClips[0]!.startSec + videoClips[0]!.durationSec - videoClips[1]!.startSec
    ).toBeCloseTo(videoClips[1]!.transitionInSec ?? 0.28, 2)

    // Clip 1: p-top-right cropped from composed comic page when panelImageRelativePaths not passed
    expect(videoClips[1]?.relativePath).toBe('Cache/Images/comic-page-1.png')
    expect(videoClips[1]?.cropWidth).toBeGreaterThan(0.35)
    expect(videoClips[1]?.cameraMotion).toBe('kenBurnsIn')

    // Clip 3: p-bottom-climax uses hybrid videoUrl directly without page crop
    expect(videoClips[3]?.relativePath).toBe('Assets/panel3-climax.mp4')
    expect(videoClips[3]?.cropWidth).toBeUndefined()
    expect(videoClips[3]?.durationSec).toBe(4.5)

    // Media Bin sources populated for ScriptTimelineEditor
    expect(doc.sources?.length).toBeGreaterThanOrEqual(5)

    // When per-panel sliced images & bubble slices are provided, panel clips use standalone slice images
    // and bubbles pop in dynamically on overlay lane 2 at their speaking timestamps
    const pageWithParallax: ComicPage = {
      ...sampleMangaPage,
      panels: sampleMangaPage.panels.map((p, idx) =>
        idx === 0 ? { ...p, foregroundImageUrl: 'Assets/panel1-fg.png', parallaxDepth: 0.65 } : p
      )
    }
    const slicedDoc = buildComicMotionTimeline({
      page: pageWithParallax,
      pageImageRelativePath: 'Cache/Images/comic-page-1.png',
      panelImageRelativePaths: {
        'p-top-right': 'Cache/Images/comic-panel-1.png',
        'p-top-left': 'Cache/Images/comic-panel-2.png'
      },
      bubbleImageRelativePaths: {
        b1: 'Cache/Images/comic-bubble-b1.png',
        b2: 'Cache/Images/comic-bubble-b2.png',
        b3: 'Cache/Images/comic-bubble-b3.png'
      },
      nodeId: 'comic-1'
    })
    const slicedVideos = slicedDoc.clips.filter((c) => c.track === 'video')
    expect(slicedVideos[1]?.relativePath).toBe('Cache/Images/comic-panel-1.png')
    expect(slicedVideos[1]?.cropWidth).toBeUndefined()
    expect(slicedVideos[2]?.relativePath).toBe('Cache/Images/comic-panel-2.png')
    expect(slicedVideos[2]?.cropWidth).toBeUndefined()

    const slicedOverlays = slicedDoc.clips.filter((c) => c.track === 'overlay')
    // 2.5D foreground parallax clip on lane 1 with keyframes
    const parallaxClip = slicedOverlays.find((o) => o.relativePath === 'Assets/panel1-fg.png')
    expect(parallaxClip).toBeDefined()
    expect(parallaxClip?.keyframes?.length).toBe(2)

    // Dynamic bubble pop-in clips on lane 2 (b2 pops in AFTER b1)
    const b1Pop = slicedOverlays.find((o) => o.relativePath === 'Cache/Images/comic-bubble-b1.png')
    const b2Pop = slicedOverlays.find((o) => o.relativePath === 'Cache/Images/comic-bubble-b2.png')
    expect(b1Pop).toBeDefined()
    expect(b2Pop).toBeDefined()
    expect(b2Pop!.startSec).toBeGreaterThan(b1Pop!.startSec)

    // Voice clips aligned with dialogue bubbles
    const voiceClips = doc.clips.filter((c) => c.track === 'voice')
    expect(voiceClips.length).toBe(3)
    expect(voiceClips.map((v) => v.relativePath)).toEqual([
      'Assets/v1.mp3',
      'Assets/v2.mp3',
      'Assets/v3.mp3'
    ])

    // Subtitles with karaoke-pop word timings
    const subClips = doc.clips.filter((c) => c.track === 'subtitle')
    expect(subClips.length).toBeGreaterThanOrEqual(4) // 1 page title + 3 bubbles
    expect(subClips.every((s) => s.subtitleKaraokeMode === 'karaoke-pop')).toBe(true)

    // Overlay stickers (animated focus/speed lines + shout/sfx impact stickers + dynamic bubble pop-in for hybrid video panel)
    const overlayClips = doc.clips.filter((c) => c.track === 'overlay')
    expect(overlayClips.some((o) => o.stickerId === 'manga-focus-lines')).toBe(true)
    expect(overlayClips.some((o) => o.stickerId === 'manga-speed-lines')).toBe(true)
    expect(overlayClips.some((o) => o.stickerId === 'neon-slash-combo')).toBe(true)

    // Procedural SFX + BGM with auto-ducking
    const sfxClips = doc.clips.filter((c) => c.track === 'sfx')
    expect(sfxClips.length).toBeGreaterThan(0)
    const musicClips = doc.clips.filter((c) => c.track === 'music')
    expect(musicClips.length).toBe(1)
    expect(doc.settings?.mixAutoDucking).toBe(true)
  })
})
