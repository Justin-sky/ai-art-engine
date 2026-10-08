/**
 * 教学视频一键合成：录屏 MP4 + alignment + 旁白 → 时间线铺轨 → 导出 Cache/Videos。
 *
 * 旁白 / 字幕约定见 GraphSkill `tutorial.recording`：title 已烧进录屏；
 * 这里只生成 narration 音频与 caption 字幕轨，避免叠字。
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
}

export type TutorialComposeResult = {
  screenplayAssetId: string
  recordingRelativePath: string
  relativePath?: string
  durationSec: number
  voicePaths: string[]
  clipCount: number
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

  const totalMs = Math.max(
    ...alignment.map((row) => row.endSec * 1000),
    alignment[alignment.length - 1]!.endSec * 1000
  )
  const videoDurationSec = Math.max(0.1, Number((totalMs / 1000).toFixed(3)))

  drafts.push({
    track: 'video',
    title: name,
    relativePath: recordingRelativePath,
    startSec: 0,
    durationSec: videoDurationSec
  })

  for (const row of alignment) {
    const step = stepByIndex.get(row.index) ?? {}
    const narration =
      step.narration?.trim() || row.caption?.trim() || row.title?.trim() || `步骤 ${row.index + 1}` // cjk-ok（工程内数据名：资产名 / 轨道标题 / 口播文本）
    const caption = step.caption?.trim() || narration
    const startSec = Math.max(0, row.startSec)
    const durationSec = Math.max(0.1, Number((row.endSec - row.startSec).toFixed(3)))

    let voiceRel = step.voiceRelativePath?.trim() || ''
    if (!voiceRel) {
      const speech = await modelProviderFacade.generateSpeechAsset({
        input: narration,
        name: `${name}-step-${row.index + 1}`,
        ...(step.voice ? { voice: step.voice } : {}),
        ...(step.model ? { model: step.model } : {}),
        ...(step.providerInstanceId ? { providerInstanceId: step.providerInstanceId } : {})
      })
      voiceRel = speech.relativePath?.trim() || ''
      if (!voiceRel) throw new Error(`第 ${row.index + 1} 步旁白生成失败（无相对路径）`) // cjk-ok（面向 Agent 的 MCP 工具诊断文案，不进界面文案表）
    }
    voicePaths.push(voiceRel)

    drafts.push({
      track: 'voice',
      title: row.title || `旁白 ${row.index + 1}`, // cjk-ok（工程内数据名：资产名 / 轨道标题 / 口播文本）
      relativePath: voiceRel,
      startSec,
      durationSec
    })
    drafts.push({
      track: 'subtitle',
      title: row.title || `字幕 ${row.index + 1}`, // cjk-ok（工程内数据名：资产名 / 轨道标题 / 口播文本）
      text: caption,
      startSec,
      durationSec
    })
  }

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
      clipCount: timelineDoc.clips.length
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
    clipCount: timelineDoc.clips.length
  }
}
