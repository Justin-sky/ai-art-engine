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
    /**
     * 顺序排布后的新真相：声轨一条接一条，不再叠着放。
     * step0 从 0 起、音频 4s → 0–4；step1 的画面时刻是 1.5s，但上一条到 4s 才说完，
     * 所以从 4s 起、再到 8s。画面因此铺到 8s（不再停在录屏的 2.5s）。
     */
    expect(video.durationSec).toBeCloseTo(8, 3)
    expect(result.durationSec).toBeGreaterThanOrEqual(8)
    expect(result.narration.map((n) => n.startSec)).toEqual([0, 4])
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

  it('显式 subtitles:true 才铺字幕，且字幕跟着**声轨**走（听到哪句看到哪句）', async () => {
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
    /**
     * 字幕改成跟**声轨**（而不是只覆盖画面窗口）：声轨被顺序顺延之后，
     * 若字幕还只盖那 1.5 / 1 秒的画面窗口，观众就会「听得到、看不到」。
     */
    expect(subs[0]!.startSec).toBeCloseTo(0, 3)
    expect(subs[0]!.durationSec).toBeCloseTo(4, 3)
    expect(subs[1]!.startSec).toBeCloseTo(4, 3)
    expect(subs[1]!.durationSec).toBeCloseTo(4, 3)
    expect(subs[1]!.text).toBe('点运行看结果')
    expect(subs[0]!.text).toBe('开场')
  })

  it('探测不到时长时退化用窗口长度，并如实标 null（不假装知道）', async () => {
    probeDurationSec.mockImplementation(async () => null)
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

  it('export:false 只铺轨不出片，但顺延量照样回报（两条返回路径口径一致）', async () => {
    const result = await compose({
      recordingRelativePath: 'Cache/Videos/recording.mp4',
      alignment: ALIGNMENT,
      steps: [
        { index: 0, narration: '开场' },
        { index: 1, narration: '收尾长句' }
      ],
      export: false
    })
    expect(exportScriptTimeline).not.toHaveBeenCalled()
    expect(result.relativePath).toBeUndefined()
    expect(result.narration.map((n) => n.startSec)).toEqual([0, 4])
    expect(result.narrationShiftedSec).toBeCloseTo(2.5, 3)
  })

  /**
   * 真机故障回归：用户那条「音效生成教学」成片里 **10 条声轨互相压着**，
   * 开头三条 1.12s / 2.33s / 3.65s 同时出声（「3 短配音同时，混乱了」）。
   *
   * 数据取自那条真实时间线：步骤间隔只有 1.2–4.6 秒，而每步口播 4–13 秒
   * （音乐时长即 probe 到的音频长度）。根因是我把声轨时长改成
   * `max(窗口, 音频)` 之后**没有做顺序排布**，于是每条都盖到下一条头上。
   */
  it('口播比步骤间隔长时，声轨必须顺序排布、绝不重叠（真机回归）', async () => {
    // 真实 alignment 起点（来自故障成片的时间线）
    const starts = [1.122, 2.326, 3.652, 5.371, 6.538, 7.811, 9.608, 11.96, 12.926, 17.514]
    const totalSec = 23.898
    const alignment = starts.map((startSec, i) => ({
      index: i,
      title: `step${i}`,
      caption: `step${i}`,
      startSec,
      endSec: i + 1 < starts.length ? starts[i + 1]! : totalSec
    }))
    // 真实音频长度（探测到的 mp3 时长）
    const audioSecs = [3.768, 5.184, 5.76, 11.28, 4.2, 5.328, 12.936, 5.016, 4.588, 6.384]
    probeDurationSec.mockImplementation(async (file: string) => {
      if (file.replace(/\\/g, '/').endsWith('recording.mp4')) return totalSec
      const at = Number(/step-(\d+)\.mp3$/.exec(file.replace(/\\/g, '/'))?.[1] ?? '1') - 1
      return audioSecs[at] ?? 1
    })
    generateSpeechAsset.mockImplementation(async (input: { name: string }) => ({
      relativePath: `Cache/Voices/${input.name}.mp3`
    }))

    const result = await compose({
      recordingRelativePath: 'Cache/Videos/recording.mp4',
      alignment,
      steps: starts.map((_, i) => ({ index: i, narration: `第 ${i + 1} 步` }))
    })

    const voices = (exportScriptTimeline.mock.calls[0]![0] as { clips: Clip[] }).clips
      .filter((c) => c.track === 'voice')
      .sort((a, b) => a.startSec - b.startSec)
    expect(voices).toHaveLength(10)

    // ① 谁都不许压在谁身上
    for (let i = 1; i < voices.length; i += 1) {
      const prevEnd = voices[i - 1]!.startSec + voices[i - 1]!.durationSec
      expect(
        voices[i]!.startSec,
        `第 ${i + 1} 条声轨在 ${voices[i]!.startSec}s 开始，但上一条到 ${prevEnd}s 才结束`
      ).toBeGreaterThanOrEqual(prevEnd - 0.001)
    }
    // ② 每条都要放完整（不被截断）
    for (const [i, voice] of voices.entries()) {
      expect(voice.durationSec).toBeCloseTo(audioSecs[i]!, 3)
    }
    // ③ 起点不许早于它的画面时刻（顺序只能往后让，不能提前）
    for (const [i, voice] of voices.entries()) {
      expect(voice.startSec).toBeGreaterThanOrEqual(starts[i]! - 0.001)
    }
    // ④ 成片时长覆盖全部口播
    const lastEnd = voices[voices.length - 1]!.startSec + voices[voices.length - 1]!.durationSec
    expect(result.durationSec).toBeGreaterThanOrEqual(lastEnd - 0.001)
    // ⑤ 被推后了多少要如实回报（口播超窗口是录制侧的问题，agent 得知道）
    expect(result.narration.some((n) => n.shiftedSec > 0)).toBe(true)
    expect(result.narrationShiftedSec).toBeGreaterThan(0)
  })
})
