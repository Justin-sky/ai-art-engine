import {
  contentEndSecOfTimeline,
  readScriptTimelineFromGenParams,
  withScriptTimeline,
  type GraphVideoItem,
  type GraphVoiceItem,
  type ScriptTimelineClip,
  type ScriptTimelineDocument,
  type TimelineExportClip
} from '@shared/graph'
import { isDraftAssetId } from '@shared/domain'
import { persistAssetRecord } from '../../../composables/useAssetRecord'
import { useDraftStore } from '../../../stores/drafts'
import { useProjectStore } from '../../../stores/project'
import { toPlain } from '../../../utils/toPlain'

function resolveMediaRelPath(
  item: { relativePath?: string; id?: string; assetId?: string },
  projectAssets: Array<{ id: string; relativePath?: string }>
): string | undefined {
  const rel = item.relativePath?.trim()
  if (rel) return rel
  const aid = (item.assetId ?? item.id)?.trim()
  if (!aid) return undefined
  return projectAssets.find((a) => a.id === aid)?.relativePath?.trim() || undefined
}

/**
 * 成片时间线节点自动合成：
 * - 当节点图运行到 `output.timeline` 时，读取宿主资产上的时间线配置；
 * - 若时间线尚无主视频轨片段且上游传入了视频/配音，自动按顺序铺入时间线并落盘；
 * - 调用主进程 `exportScriptTimeline` 无界面合成单条 MP4，返回新成片的工程相对路径与 assetId。
 */
export async function composeTimelineVideoForNode(input: {
  hostAssetId?: string
  nodeId: string
  videos: GraphVideoItem[]
  voices: GraphVoiceItem[]
  signal?: AbortSignal
}): Promise<{ relativePath?: string; assetId?: string } | null> {
  if (input.signal?.aborted) return null
  const project = useProjectStore()
  const drafts = useDraftStore()
  if (!project.isOpen || !project.rootPath) return null

  const hostAssetId = input.hostAssetId?.trim()
  const readGenParams = (): Record<string, unknown> => {
    if (!hostAssetId) return {}
    if (isDraftAssetId(hostAssetId)) {
      return { ...(drafts.getDraft(hostAssetId)?.genParams ?? {}) }
    }
    const asset = project.assets.find((a) => a.id === hostAssetId)
    return { ...((asset?.genParams as Record<string, unknown> | undefined) ?? {}) }
  }

  const doc: ScriptTimelineDocument = readScriptTimelineFromGenParams(readGenParams(), input.nodeId)
  const clips: ScriptTimelineClip[] = doc.clips.map((c) => ({ ...c }))
  let dirtyDoc = false

  const hasVideoClips = clips.some((c) => c.track === 'video')
  if (!hasVideoClips && input.videos.length > 0) {
    let cursor = 0
    input.videos.forEach((v, idx) => {
      const rel = resolveMediaRelPath(v, project.assets)
      if (!rel) return
      const dur = 4
      clips.push({
        id: `clip:auto:v:${idx}:${Date.now().toString(36)}`,
        track: 'video',
        sourceId: v.id || rel,
        title: `Shot ${idx + 1}`,
        relativePath: rel,
        startSec: cursor,
        durationSec: dur
      })
      cursor += dur
      dirtyDoc = true
    })
  }

  const hasVoiceClips = clips.some((c) => c.track === 'voice')
  if (!hasVoiceClips && input.voices.length > 0) {
    let cursor = 0
    input.voices.forEach((v, idx) => {
      const rel = resolveMediaRelPath(v, project.assets)
      if (!rel) return
      const dur = 4
      clips.push({
        id: `clip:auto:a:${idx}:${Date.now().toString(36)}`,
        track: 'voice',
        sourceId: v.id || rel,
        title: `Voice ${idx + 1}`,
        relativePath: rel,
        ...(v.id ? { assetId: v.id } : {}),
        startSec: cursor,
        durationSec: dur
      })
      cursor += dur
      dirtyDoc = true
    })
  }

  if (dirtyDoc && hostAssetId) {
    const nextDoc: ScriptTimelineDocument = { ...doc, clips }
    const nextGen = withScriptTimeline(readGenParams(), nextDoc, input.nodeId)
    if (isDraftAssetId(hostAssetId)) {
      drafts.updateDraft(hostAssetId, { genParams: nextGen })
    } else {
      await persistAssetRecord(hostAssetId, { genParams: nextGen })
    }
  }

  const hidden = new Set(doc.hiddenTracks ?? [])
  const exportClips: TimelineExportClip[] = clips
    .filter((c) => !hidden.has(c.track))
    .map((c) => ({
      track: c.track,
      relativePath: resolveMediaRelPath(c, project.assets),
      text: c.text,
      title: c.title,
      startSec: c.startSec,
      durationSec: c.durationSec,
      sourceOffsetSec: c.sourceOffsetSec,
      speed: c.speed,
      freezeTailSec: c.freezeTailSec,
      brightness: c.brightness,
      contrast: c.contrast,
      saturation: c.saturation,
      textColor: c.textColor,
      fontSize: c.fontSize,
      volume: c.volume,
      fadeInSec: c.fadeInSec,
      fadeOutSec: c.fadeOutSec,
      overlayX: c.overlayX,
      overlayY: c.overlayY,
      overlayWidth: c.overlayWidth,
      overlayHeight: c.overlayHeight,
      opacity: c.opacity,
      transitionInSec: c.transitionInSec,
      transitionOutSec: c.transitionOutSec,
      transitionType: c.transitionType
    }))

  const hasExportableMedia = exportClips.some(
    (c) => c.track !== 'subtitle' && !!c.relativePath?.trim()
  )
  if (!hasExportableMedia) return null

  const settings = doc.settings ?? {}
  const contentEnd = contentEndSecOfTimeline(clips)
  const durationSec = Math.max(1, settings.durationSec ?? 0, contentEnd)
  const relOut = `Cache/TimelineCompose/timeline-${input.nodeId.replace(/[^a-zA-Z0-9_-]/g, '_')}-${Date.now()}.mp4`
  const rootNormalized = project.rootPath.replace(/\\/g, '/').replace(/\/+$/, '')
  const targetPath = `${rootNormalized}/${relOut}`

  const res = await window.studio.exportScriptTimeline(
    toPlain({
      clips: exportClips,
      durationSec,
      playbackRate: settings.playbackRate ?? 1,
      width: settings.exportWidth ?? 1280,
      height: settings.exportHeight ?? 720,
      fps: settings.exportFps ?? 30,
      videoBitrateKbps: settings.exportVideoBitrateKbps ?? 5000,
      scaleMode: settings.scaleMode ?? 'contain',
      subtitleFontSize: settings.subtitleFontSize ?? 36,
      subtitleYOffset: settings.subtitleYOffset ?? 80,
      subtitleColor: settings.subtitleColor ?? '#ffffff',
      subtitleBorderColor: settings.subtitleBorderColor,
      subtitleBorderWidth: settings.subtitleBorderWidth,
      subtitleBoxEnabled: settings.subtitleBoxEnabled,
      subtitleBoxColor: settings.subtitleBoxColor,
      subtitleBoxOpacity: settings.subtitleBoxOpacity,
      subtitleMotion: settings.subtitleMotion,
      mixGains: settings.mixGains,
      mixMasterGain: settings.mixMasterGain,
      mixBassGainDb: settings.mixBassGainDb,
      mixTrebleGainDb: settings.mixTrebleGainDb,
      mixCompression: settings.mixCompression,
      mixAutoDucking: settings.mixAutoDucking,
      mixDuckingRatio: settings.mixDuckingRatio,
      mixLoudnorm: settings.mixLoudnorm,
      mutedTracks: doc.mutedTracks,
      watermarkSrc:
        settings.watermarkEnabled && settings.watermarkSrc ? settings.watermarkSrc : undefined,
      watermarkOpacity: settings.watermarkOpacity,
      watermarkScale: settings.watermarkScale,
      watermarkPosition:
        settings.watermarkPosition === 'bl' ||
        settings.watermarkPosition === 'tr' ||
        settings.watermarkPosition === 'tl'
          ? settings.watermarkPosition
          : 'br',
      targetPath
    })
  )

  if (!res.ok) return null
  if (res.assetId) {
    await project.refreshAssets()
    const created = project.assets.find((a) => a.id === res.assetId)
    if (created?.relativePath) {
      return { relativePath: created.relativePath, assetId: res.assetId }
    }
  }
  return { relativePath: relOut, assetId: res.assetId }
}
