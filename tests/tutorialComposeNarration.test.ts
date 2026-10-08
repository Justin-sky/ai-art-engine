import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 教学合成：**旁白长度说了算**。
 *
 * 审查实测出的缺陷：`alignment` 给的是「这一步在画面上的窗口」，末步窗口只有 1.0 秒；
 * 旧实现直接拿窗口当声轨时长，而导出侧对声轨有 `atrim=0:dur` —— 于是 4 秒的口播
 * 被砍成 1 秒（教学视频最关键的那一步，静默截断、无任何提示）。
 *
 * 这里把 TTS 与时长探测换成可控替身，真跑一遍合成，钉住：
 * 1. 声轨时长 = max(窗口, 音频真实长度)；2. 画面延长到最后一个旁白说完；
 * 3. 默认**不铺字幕轨**（title/caption 已由录制 HUD 烧进画面）。
 */

const ROOT = 'C:/proj'
const updateAsset = vi.fn()
const generateSpeechAsset = vi.fn()
const probeDurationSec = vi.fn()
const exportScriptTimeline = vi.fn()

vi.mock('../src/main/services/projectService', () => ({
  projectService: {
    isOpen: () => true,
    getRoot: () => ROOT,
    getConfig: () => ({ cacheOutputDir: 'Cache' }),
    createAsset: (input: { type: string; name: string }) => ({
      id: 'screenplay-1',
      type: input.type,
      name: input.name,
      genParams: {},
      relativePath: '',
      folderId: null,
      version: 1,
      createdAt: '',
      updatedAt: ''
    }),
    updateAsset: (asset: unknown) => {
      updateAsset(asset)
      return asset
    }
  }
}))
vi.mock('../src/main/services/modelProviders', () => ({
  modelProviderFacade: {
    generateSpeechAsset: (...args: unknown[]) => generateSpeechAsset(...args)
  }
}))
vi.mock('../src/main/services/videoFrameService', () => ({
  probeDurationSec: (...args: unknown[]) => probeDurationSec(...args)
}))
vi.mock('../src/main/services/timelineExportService', () => ({
  exportScriptTimeline: (...args: unknown[]) => exportScriptTimeline(...args)
}))

type Clip = { track: string; title: string; startSec: number; durationSec: number; text?: string }

async function compose(input: Record<string, unknown>) {
  vi.resetModules()
  const mod = await import('../src/main/services/tutorialComposeService')
  return mod.composeTutorialVideo(input as never)
}

/** 录屏 2.5 秒；最后一步的窗口只有 1.0 秒；旁白音频 4.0 秒 */
const ALIGNMENT = [
  { index: 0, title: '打开节点图', caption: '打开节点图', startSec: 0, endSec: 1.5 },
  { index: 1, title: '点运行看结果', caption: '点运行看结果', startSec: 1.5, endSec: 2.5 }
]

beforeEach(() => {
  vi.clearAllMocks()
  updateAsset.mockReset()
  generateSpeechAsset.mockResolvedValue({ relativePath: 'Cache/Voices/step.mp3' })
  probeDurationSec.mockImplementation(async (file: string) =>
    file.replace(/\\/g, '/').endsWith('recording.mp4') ? 2.5 : 4.0
  )
  exportScriptTimeline.mockResolvedValue({
    ok: true,
    filePath: `${ROOT}/Cache/Videos/tutorial.mp4`
  })
})

describe('教学合成：旁白与时间轴', () => {
  it('声轨用音频真实时长，长句口播不会被 atrim 砍成窗口长度', async () => {
    const result = await compose({
      recordingRelativePath: 'Cache/Videos/recording.mp4',
      alignment: ALIGNMENT,
      steps: [
        { index: 0, narration: '先打开节点图' },
        { index: 1, narration: '点运行，等结果上屏，看这一栏的输出' }
      ]
    })

    const clips = (exportScriptTimeline.mock.calls[0]![0] as { clips: Clip[] }).clips
    const voiceClips = clips.filter((c) => c.track === 'voice')
    expect(voiceClips).toHaveLength(2)
    // 关键：每一步都是 4 秒音频，而不是窗口的 1.5 / 1.0 秒
    for (const clip of voiceClips) expect(clip.durationSec).toBeCloseTo(4, 3)

    expect(result.recordingDurationSec).toBe(2.5)
    expect(result.narration.map((n) => n.windowSec)).toEqual([1.5, 1])
    expect(result.narration.map((n) => n.voiceSec)).toEqual([4, 4])
    // 末步窗口 1 秒 vs 音频 4 秒 → 延长 3 秒（旧实现会把这 3 秒砍掉）
    expect(result.narration[1]!.overhangSec).toBeCloseTo(3, 3)
  })

  it('画面延长到最后一个旁白说完，成片时长覆盖全部口播', async () => {
    const result = await compose({
      recordingRelativePath: 'Cache/Videos/recording.mp4',
      alignment: ALIGNMENT,
      steps: [
        { index: 0, narration: '开场' },
        { index: 1, narration: '收尾长句' }
      ]
    })
    const clips = (exportScriptTimeline.mock.calls[0]![0] as { clips: Clip[]; durationSec: number })
      .clips
    const video = clips.find((c) => c.track === 'video')!
    // 末步从 1.5s 起、放 4s → 画面至少铺到 5.5s（而不是停在录屏的 2.5s）
    expect(video.durationSec).toBeCloseTo(5.5, 3)
    expect(result.durationSec).toBeGreaterThanOrEqual(5.5)
  })

  it('默认不铺字幕轨（HUD 已把 caption 烧进画面，再加就是叠字）', async () => {
    await compose({
      recordingRelativePath: 'Cache/Videos/recording.mp4',
      alignment: ALIGNMENT,
      steps: [
        { index: 0, narration: '开场' },
        { index: 1, narration: '收尾' }
      ]
    })
    const clips = (exportScriptTimeline.mock.calls[0]![0] as { clips: Clip[] }).clips
    expect(clips.filter((c) => c.track === 'subtitle')).toHaveLength(0)
  })

  it('显式 subtitles:true 才铺字幕，且字幕跟着**画面窗口**而不是音频长度', async () => {
    await compose({
      recordingRelativePath: 'Cache/Videos/recording.mp4',
      alignment: ALIGNMENT,
      steps: [
        { index: 0, narration: '开场' },
        // 同时给 caption 时字幕用 caption（叠在画面上）；只给 narration 时回落到口播
        { index: 1, narration: '收尾长句', caption: '点运行看结果' }
      ],
      subtitles: true
    })
    const clips = (exportScriptTimeline.mock.calls[0]![0] as { clips: Clip[] }).clips
    const subs = clips.filter((c) => c.track === 'subtitle')
    expect(subs).toHaveLength(2)
    expect(subs[0]!.durationSec).toBeCloseTo(1.5, 3)
    expect(subs[1]!.durationSec).toBeCloseTo(1, 3)
    expect(subs[1]!.text).toBe('点运行看结果')
    expect(subs[0]!.text).toBe('开场')
  })

  it('探测不到时长时退化用窗口长度，并如实标 null（不假装知道）', async () => {
    probeDurationSec.mockImplementation(async (file: string) =>
      file.replace(/\\/g, '/').endsWith('recording.mp4') ? null : null
    )
    const result = await compose({
      recordingRelativePath: 'Cache/Videos/recording.mp4',
      alignment: ALIGNMENT,
      steps: [
        { index: 0, narration: '开场' },
        { index: 1, narration: '收尾' }
      ]
    })
    expect(result.recordingDurationSec).toBeNull()
    expect(result.narration[1]!.narrationSec).toBeNull()
    // 退回窗口长度：至少不会凭空砍或凭空加
    expect(result.narration[1]!.voiceSec).toBeCloseTo(1, 3)
    expect(result.narration[1]!.overhangSec).toBe(0)
  })
})
