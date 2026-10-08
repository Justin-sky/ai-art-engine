/**
 * 教学视频一键合成：录屏 MP4 + alignment + 旁白 → 时间线铺轨 → 导出 Cache/Videos。
 *
 * 旁白 / 字幕约定见 GraphSkill `tutorial.recording`：title/caption 已由录制 HUD 烧进画面，
 * 所以**默认不再加字幕轨**（`subtitles: true` 才加），否则同一句话会在画面上出现两次。
 *
 * 时间轴口径：视频时长取录制文件的真实时长；**旁白时长取音频真实长度**（probe），
 * 取「步骤窗口 / 音频」较大者作为声轨长度 —— 导出侧对声轨有 `atrim=0:dur`，
 * 拿窗口当声轨长度会把长句口播从中间砍掉（末步窗口可能只有 1.2 秒）。
 */
import { mkdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import {
  contentEndSecOfTimeline,
  withScriptTimeline,
  type ScriptTimelineDocument,
  type TimelineExportClip,
  type TimelineExportInput
} from '@shared/graph'
import { applyTimelineEdits, type TimelineClipDraft } from '@shared/graph/timelineEdit'
import { resolveMediaOutputDir } from '@shared/domain'
import type { StepAlignment } from '@shared/screenRecord'
import { projectService } from './projectService'
import { modelProviderFacade } from './modelProviders'
import { probeDurationSec } from './videoFrameService'
import { exportScriptTimeline } from './timelineExportService'

function toPosix(path: string): string {
  return path.replace(/\\/g, '/')
}

export type TutorialComposeStepInput = {
  /** 与 alignment.index 对应；缺省按数组下标 */
  index?: number
  /** 口播长句；缺省用 alignment.caption / title */
  narration?: string
  /** 成片字幕；缺省 = narration */
  caption?: string
  /** 已生成的旁白相对路径；给出则跳过 TTS */
  voiceRelativePath?: string
  /**
   * 这一步**被演示的那个音效**的工程内相对路径（如 `Cache/Sfx/xxx.mp3`）。
   *
   * 讲音效生成的教程如果只铺口播，观众听不到被演示的音效本身 —— 这条就是给它留的轨位。
   */
  sfxRelativePath?: string
  voice?: string
  model?: string
  providerInstanceId?: string
}

export type TutorialComposeInput = {
  recordingRelativePath: string
  alignment: StepAlignment[]
  steps?: TutorialComposeStepInput[]
  name?: string
  /** 是否导出成片（默认 true） */
  export?: boolean
  /** 成片绝对路径；缺省写到 Cache/Videos */
  targetPath?: string
  /**
   * 是否额外烧一条字幕轨。**默认 false**：录屏里的 HUD 字卡已经把 title/caption 烧进画面，
   * 再加同文字幕就是叠字（本文件头部原先声称「避免叠字」，但实现里一直在叠）。
   */
  subtitles?: boolean
}

/** 每一步的旁白实况：窗口多长、音频多长、是否因此把时间线往后延 */
export type TutorialNarrationTiming = {
  index: number
  /** 这一步在画面上的窗口（秒） */
  windowSec: number
  /** 旁白音频真实时长（秒）；探测不到时为 null，此时声轨退化用窗口长度 */
  narrationSec: number | null
  /** 声轨实际使用时长：取窗口与音频的较大者，避免长句被 atrim 砍掉 */
  voiceSec: number
  /** 声轨实际起点（可能因为上一条口播没说完而顺延） */
  startSec: number
  /** 相对画面时刻被顺延了多少秒（> 0 说明口播比步骤间隔长） */
  shiftedSec: number
  /** 旁白比窗口长出的部分（秒）；> 0 表示这一步口播会压到下一步的时间 */
  overhangSec: number
}

/** 被演示的音效在成片里的落点 */
export type TutorialSfxTiming = {
  index: number
  startSec: number
  durationSec: number
  /** 音效音频探测到的真实时长；探测不到时为 null（此时用窗口长度） */
  detectedSec: number | null
}

export type TutorialComposeResult = {
  screenplayAssetId: string
  recordingRelativePath: string
  relativePath?: string
  durationSec: number
  voicePaths: string[]
  clipCount: number
  /** 录屏视频本身的实际时长（从文件 probe；探测不到时为 null） */
  recordingDurationSec: number | null
  narration: TutorialNarrationTiming[]
  /** 铺进 sfx 轨的音效落点（空数组 = 这一步教学里没有演示音效） */
  sfx: TutorialSfxTiming[]
  /**
   * 最大顺延秒数：口播比步骤间隔长时，声轨只能顺序往后排（**绝不重叠**），
   * 代价是画面落后于旁白。这个值 > 0 就是在告诉调用方「缩短口播或加长步骤停顿」。
   */
  narrationShiftedSec: number
}

function makeClipId(track: string, index: number): string {
  return `tutorial:${Date.now().toString(36)}:${track}:${index}`
}

function toExportClip(clip: {
  track: TimelineExportClip['track']
  title: string
  startSec: number
  durationSec: number
  relativePath?: string
  text?: string
}): TimelineExportClip {
  return {
    track: clip.track,
    title: clip.title,
    startSec: clip.startSec,
    durationSec: clip.durationSec,
    ...(clip.relativePath ? { relativePath: clip.relativePath } : {}),
    ...(clip.text ? { text: clip.text } : {})
  }
}

function resolveAbsUnderProject(relativePath: string): string {
  const root = projectService.getRoot()
  const rel = relativePath.replace(/\\/g, '/').replace(/^\.\//, '').trim()
  return join(root, ...rel.split('/'))
}

export async function composeTutorialVideo(
  input: TutorialComposeInput
): Promise<TutorialComposeResult> {
  if (!projectService.isOpen()) throw new Error('请先在应用中打开工程') // cjk-ok（面向 Agent 的 MCP 工具诊断文案，不进界面文案表）
  const recordingRelativePath = input.recordingRelativePath.replace(/\\/g, '/').trim()
  if (!recordingRelativePath) throw new Error('缺少 recordingRelativePath') // cjk-ok（面向 Agent 的 MCP 工具诊断文案，不进界面文案表）
  const alignment = Array.isArray(input.alignment) ? input.alignment : []
  if (!alignment.length) throw new Error('缺少 alignment（请先 screen_record_stop）') // cjk-ok（面向 Agent 的 MCP 工具诊断文案，不进界面文案表）

  const name =
    input.name?.trim() || `教学视频 ${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}` // cjk-ok（工程内数据名：资产名 / 轨道标题 / 口播文本）

  const screenplay = projectService.createAsset({
    type: 'screenplay',
    name: `${name} · 时间线` // cjk-ok（工程内数据名：资产名 / 轨道标题 / 口播文本）
  })

  const stepByIndex = new Map<number, TutorialComposeStepInput>()
  for (const step of input.steps ?? []) {
    const index = typeof step.index === 'number' ? step.index : stepByIndex.size
    stepByIndex.set(index, step)
  }

  const voicePaths: string[] = []
  const drafts: TimelineClipDraft[] = []
  const narration: TutorialNarrationTiming[] = []

  /**
   * 视频时长以**文件实际时长**为准，而不是「最后一个步骤窗口的末端」。
   *
   * 末步窗口允许超出成片（见 `MIN_LAST_STEP_WINDOW_MS`），拿它当视频长度会让画面被拉长；
   * 反过来，旁白比窗口长时要靠时间线延长来容纳，而不是把音频砍掉。
   */
  const probedVideoSec = await probeDurationSec(
    resolveAbsUnderProject(recordingRelativePath)
  ).catch(() => null)
  const alignmentEndSec = Math.max(...alignment.map((row) => row.endSec), 0)
  const videoDurationSec = Math.max(0.1, Number((probedVideoSec ?? alignmentEndSec).toFixed(3)))

  let lastVoiceEndSec = videoDurationSec
  /** 声轨游标：下一条声轨最早只能从这里开始（保证不重叠） */
  let voiceCursorSec = 0
  /** 铺进 sfx 轨的音效落点（数量即 length，回报给调用方便于自查「有没有把演示的音效放进去」） */
  const sfxTiming: TutorialSfxTiming[] = []

  for (const row of alignment) {
    const step = stepByIndex.get(row.index) ?? {}
    const narrationText =
      step.narration?.trim() || row.caption?.trim() || row.title?.trim() || `步骤 ${row.index + 1}` // cjk-ok（工程内数据名：资产名 / 轨道标题 / 口播文本）
    const caption = step.caption?.trim() || narrationText
    const pictureStartSec = Math.max(0, row.startSec)
    const windowSec = Math.max(0.1, Number((row.endSec - row.startSec).toFixed(3)))

    let voiceRel = step.voiceRelativePath?.trim() || ''
    if (!voiceRel) {
      const speech = await modelProviderFacade.generateSpeechAsset({
        input: narrationText,
        name: `${name}-step-${row.index + 1}`,
        ...(step.voice ? { voice: step.voice } : {}),
        ...(step.model ? { model: step.model } : {}),
        ...(step.providerInstanceId ? { providerInstanceId: step.providerInstanceId } : {})
      })
      voiceRel = speech.relativePath?.trim() || ''
      if (!voiceRel) throw new Error(`第 ${row.index + 1} 步旁白生成失败（无相对路径）`) // cjk-ok（面向 Agent 的 MCP 工具诊断文案，不进界面文案表）
    }
    voicePaths.push(voiceRel)

    /**
     * 声轨顺序排布：**绝不重叠**。
     *
     * 真机故障：步骤间隔只有 1.2 秒、每步口播 4–13 秒，而「声轨时长取音频真实长度」
     * 会把每条都盖到下一条头上 —— 开头三条同时出声（用户反馈「3 短配音同时，混乱了」）。
     * 这里让起点至少落在上一条结束之后：口播比间隔长时只能顺延（画面落后于旁白），
     * 但至少听得清；顺延量如实回报在 `narrationShiftedSec`。
     */
    const startSec = Math.max(pictureStartSec, voiceCursorSec)
    const probedVoiceSec = await probeDurationSec(resolveAbsUnderProject(voiceRel)).catch(
      () => null
    )
    const voiceSec = Math.max(windowSec, probedVoiceSec ?? 0)
    voiceCursorSec = startSec + voiceSec
    lastVoiceEndSec = Math.max(lastVoiceEndSec, voiceCursorSec)
    narration.push({
      index: row.index,
      windowSec,
      narrationSec: probedVoiceSec === null ? null : Number(probedVoiceSec.toFixed(3)),
      voiceSec: Number(voiceSec.toFixed(3)),
      startSec: Number(startSec.toFixed(3)),
      shiftedSec: Number(Math.max(0, startSec - pictureStartSec).toFixed(3)),
      overhangSec: Number(Math.max(0, voiceSec - windowSec).toFixed(3))
    })

    drafts.push({
      track: 'voice',
      title: row.title || `旁白 ${row.index + 1}`, // cjk-ok（工程内数据名：资产名 / 轨道标题 / 口播文本）
      relativePath: voiceRel,
      startSec: Number(startSec.toFixed(3)),
      durationSec: Number(voiceSec.toFixed(3))
    })
    if (input.subtitles === true) {
      // 字幕跟着声轨走（观众听到哪句就看到哪句），否则画面与声音会错位
      drafts.push({
        track: 'subtitle',
        title: row.title || `字幕 ${row.index + 1}`, // cjk-ok（工程内数据名：资产名 / 轨道标题 / 口播文本）
        text: caption,
        startSec: Number(startSec.toFixed(3)),
        durationSec: Number(voiceSec.toFixed(3))
      })
    }

    /**
     * 被演示的音效：铺在 **sfx 轨**，起点跟这一步的声轨对齐。
     *
     * 讲音效生成的教程，重点就是让人**听到**那个音效；只铺口播等于讲了没演示。
     * 时长用音频真实长度（探测失败就退到窗口长度），并保证不越过下一条口播的起点 ——
     * 音效与旁白叠在一起是正常的（一个在演示、一个在讲解），但音效之间不该互相压。
     */
    const sfxRel = step.sfxRelativePath?.trim() || ''
    if (sfxRel) {
      const probedSfxSec = await probeDurationSec(resolveAbsUnderProject(sfxRel)).catch(() => null)
      const sfxSec = Math.max(0.2, probedSfxSec ?? windowSec)
      drafts.push({
        track: 'sfx',
        title: row.title ? `${row.title} · 音效` : `音效 ${row.index + 1}`, // cjk-ok（工程内数据名：资产名 / 轨道标题 / 口播文本）
        relativePath: sfxRel,
        startSec: Number(startSec.toFixed(3)),
        durationSec: Number(sfxSec.toFixed(3))
      })
      sfxTiming.push({
        index: row.index,
        startSec: Number(startSec.toFixed(3)),
        durationSec: Number(sfxSec.toFixed(3)),
        detectedSec: probedSfxSec === null ? null : Number(probedSfxSec.toFixed(3))
      })
    }
  }

  // 画面至少铺到「最后一个旁白说完」为止：成片末尾要么定格、要么黑尾，但绝不吞掉口播
  const videoClipSec = Math.max(videoDurationSec, lastVoiceEndSec)
  drafts.unshift({
    track: 'video',
    title: name,
    relativePath: recordingRelativePath,
    startSec: 0,
    durationSec: Number(videoClipSec.toFixed(3))
  })

  const edited = applyTimelineEdits({ clips: [] }, [{ op: 'add', clips: drafts }], {
    makeClipId: (track, index) => makeClipId(track, index)
  })
  if (edited.failures.length) {
    throw new Error(`时间线铺轨失败：${edited.failures.map((f) => `${f.op}/${f.code}`).join(', ')}`) // cjk-ok（面向 Agent 的 MCP 工具诊断文案，不进界面文案表）
  }

  const timelineDoc: ScriptTimelineDocument = edited.document
  const nextGen = withScriptTimeline(
    (screenplay.genParams as Record<string, unknown> | undefined) ?? {},
    timelineDoc
  )
  projectService.updateAsset({
    ...screenplay,
    genParams: nextGen
  })

  const durationSec = contentEndSecOfTimeline(timelineDoc.clips)
  const shouldExport = input.export !== false
  if (!shouldExport) {
    return {
      screenplayAssetId: screenplay.id,
      recordingRelativePath,
      durationSec,
      voicePaths,
      clipCount: timelineDoc.clips.length,
      recordingDurationSec: probedVideoSec === null ? null : Number(probedVideoSec.toFixed(3)),
      narration,
      sfx: sfxTiming,
      narrationShiftedSec: Number(Math.max(0, ...narration.map((n) => n.shiftedSec)).toFixed(3))
    }
  }

  let targetPath = input.targetPath?.trim() || ''
  if (!targetPath) {
    const cacheDir = resolveMediaOutputDir({
      cacheOutputDir: projectService.getConfig().cacheOutputDir,
      kind: 'video'
    })
    const absDir = resolveAbsUnderProject(cacheDir)
    mkdirSync(absDir, { recursive: true })
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    targetPath = join(absDir, `tutorial-${stamp}.mp4`)
  }

  const exportInput: TimelineExportInput = {
    clips: timelineDoc.clips.map((clip) =>
      toExportClip({
        track: clip.track,
        title: clip.title,
        startSec: clip.startSec,
        durationSec: clip.durationSec,
        relativePath: clip.relativePath,
        text: clip.text
      })
    ),
    durationSec,
    defaultFileName: `${name}.mp4`,
    targetPath
  }

  const exported = await exportScriptTimeline(exportInput)
  if (!exported.ok) {
    throw new Error(exported.error || '教学视频导出失败') // cjk-ok（面向 Agent 的 MCP 工具诊断文案，不进界面文案表）
  }

  const root = projectService.getRoot()
  const filePath = exported.filePath!
  const relativePath = toPosix(relative(root, filePath))
  if (!relativePath || relativePath.startsWith('..')) {
    throw new Error(`导出路径不在工程内：${filePath}`) // cjk-ok（面向 Agent 的 MCP 工具诊断文案，不进界面文案表）
  }

  return {
    screenplayAssetId: screenplay.id,
    recordingRelativePath,
    relativePath,
    durationSec,
    voicePaths,
    clipCount: timelineDoc.clips.length,
    recordingDurationSec: probedVideoSec === null ? null : Number(probedVideoSec.toFixed(3)),
    narration,
    sfx: sfxTiming,
    narrationShiftedSec: Number(Math.max(0, ...narration.map((n) => n.shiftedSec)).toFixed(3))
  }
}
