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
  /** 旁白比窗口长出的部分（秒）；> 0 表示成片末尾被延长 */
  overhangSec: number
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

  for (const row of alignment) {
    const step = stepByIndex.get(row.index) ?? {}
    const narrationText =
      step.narration?.trim() || row.caption?.trim() || row.title?.trim() || `步骤 ${row.index + 1}` // cjk-ok（工程内数据名：资产名 / 轨道标题 / 口播文本）
    const caption = step.caption?.trim() || narrationText
    const startSec = Math.max(0, row.startSec)
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

    // 旁白时长说了算：探测音频真实长度，取「窗口 / 音频」较大者 —— 长句口播不再被 atrim 砍掉
    const probedVoiceSec = await probeDurationSec(resolveAbsUnderProject(voiceRel)).catch(
      () => null
    )
    const voiceSec = Math.max(windowSec, probedVoiceSec ?? 0)
    lastVoiceEndSec = Math.max(lastVoiceEndSec, startSec + voiceSec)
    narration.push({
      index: row.index,
      windowSec,
      narrationSec: probedVoiceSec === null ? null : Number(probedVoiceSec.toFixed(3)),
      voiceSec: Number(voiceSec.toFixed(3)),
      overhangSec: Number(Math.max(0, voiceSec - windowSec).toFixed(3))
    })

    drafts.push({
      track: 'voice',
      title: row.title || `旁白 ${row.index + 1}`, // cjk-ok（工程内数据名：资产名 / 轨道标题 / 口播文本）
      relativePath: voiceRel,
      startSec,
      durationSec: Number(voiceSec.toFixed(3))
    })
    if (input.subtitles === true) {
      drafts.push({
        track: 'subtitle',
        title: row.title || `字幕 ${row.index + 1}`, // cjk-ok（工程内数据名：资产名 / 轨道标题 / 口播文本）
        text: caption,
        startSec,
        durationSec: windowSec
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
      narration
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
    narration
  }
}
