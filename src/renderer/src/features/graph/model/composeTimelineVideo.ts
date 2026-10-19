import {
  contentEndSecOfTimeline,
  readScriptTimelineFromGenParams,
  withScriptTimeline,
  type GraphImageItem,
  type GraphTimelineVisualItem,
  type GraphVideoItem,
  type GraphVoiceItem,
  type ScriptTimelineClip,
  type ScriptTimelineDocument,
  type TimelineExportClip
} from '@shared/graph'
import { isDraftAssetId } from '@shared/domain'
import { persistAssetRecord } from '../../../composables/useAssetRecord'
import { resolveAssetFileUrl } from '../../media/assetUrlCache'
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

function isImageOrGifPath(rel: string): boolean {
  return /\.(png|jpe?g|webp|bmp|gif|svg)$/i.test(rel.trim())
}

/** 探测工程内音频或视频文件的真实时长（秒）；失败或非音视频时返回 null */
async function probeMediaDurationSec(
  relativePath: string,
  kind: 'audio' | 'video'
): Promise<number | null> {
  if (typeof document === 'undefined') return null
  if (isImageOrGifPath(relativePath)) return null
  const url = await resolveAssetFileUrl(relativePath)
  if (!url) return null
  return new Promise<number | null>((resolve) => {
    const el = document.createElement(kind === 'audio' ? 'audio' : 'video')
    let settled = false
    const finish = (dur: number | null): void => {
      if (settled) return
      settled = true
      try {
        el.removeAttribute('src')
        el.load()
      } catch {
        /* ignore */
      }
      resolve(dur)
    }
    const timer = setTimeout(() => finish(null), 4000)
    el.preload = 'metadata'
    el.onloadedmetadata = () => {
      clearTimeout(timer)
      const d = Number(el.duration)
      finish(Number.isFinite(d) && d > 0.1 ? Math.round(d * 100) / 100 : null)
    }
    el.onerror = () => {
      clearTimeout(timer)
      finish(null)
    }
    el.src = url
  })
}

/** 按旁白文本长度估算朗读时长（当无 DOM 或音频元数据未就绪时兜底） */
function estimateSpeechDurationSec(text?: string): number {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim()
  if (!clean) return 4
  const cjkCount = (clean.match(/[\u4e00-\u9fff]/g) ?? []).length
  const nonCjkWords = clean
    .replace(/[\u4e00-\u9fff]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length
  const sec = cjkCount / 4.2 + nonCjkWords / 2.6
  return Math.max(2.5, Math.round(sec * 10) / 10)
}

/** 将一段旁白拆分为适屏的字幕分句（按句末标点切分，过长单句再按逗号切分） */
export function splitNarrationIntoSubtitleSegments(text: string): string[] {
  const rawSentences = text
    .split(/[。！？!?；;\n]+/)
    .map((s) => s.replace(/^[，、。！？!?；;\s]+|[。！？!?；;\s]+$/g, '').trim())
    .filter(Boolean)
  const segments: string[] = []
  for (const sentence of rawSentences) {
    if (sentence.length <= 26) {
      segments.push(sentence)
      continue
    }
    const clauses = sentence
      .split(/[，,]+/)
      .map((c) => c.trim())
      .filter(Boolean)
    let buf = ''
    for (const clause of clauses) {
      if (!buf) {
        buf = clause
      } else if (buf.length + 1 + clause.length <= 26) {
        buf = `${buf}，${clause}`
      } else {
        segments.push(buf)
        buf = clause
      }
    }
    if (buf) segments.push(buf)
  }
  return segments.length ? segments : text.trim() ? [text.trim()] : []
}

/**
 * 成片时间线节点自动合成（Audio-First 时长对齐）：
 * - 当节点图运行到 `output.timeline` 时，读取宿主资产上的时间线配置；
 * - 探测上游每段旁白音频（`voice`）与视频（`video`）的真实时长，让对应画面镜头（视频 / 静态图 / SVG 烘焙 GIF）
 *   自动对齐旁白时长（视频短于旁白时自动开启 `freezeTailSec` 尾帧定格，图片/GIF 自动延展铺满旁白）；
 * - 自动从每段旁白台词（或 `subtitles` 输入）生成时间轴精确对齐的分句字幕轨（`track: 'subtitle'`）；
 * - 若接入背景音乐（`music`），自动铺入 `track: 'music'` 并开启 `mixAutoDucking` 人声闪避；
 * - 调用主进程 `exportScriptTimeline` 无界面合成单条 MP4，返回新成片的工程相对路径与 assetId。
 */
export async function composeTimelineVideoForNode(input: {
  hostAssetId?: string
  nodeId: string
  videos: GraphVideoItem[]
  images?: GraphImageItem[]
  visuals?: GraphTimelineVisualItem[]
  voices: Array<GraphVoiceItem & { text?: string; title?: string }>
  music?: GraphVoiceItem[]
  subtitles?: string[]
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
  let clips: ScriptTimelineClip[] = doc.clips.map((c) => ({ ...c }))
  let dirtyDoc = false

  const rawVisuals: GraphTimelineVisualItem[] = input.visuals?.length
    ? input.visuals
    : [
        ...input.videos.map((v) => ({
          id: v.id,
          kind: 'video' as const,
          dataUrl: v.dataUrl,
          relativePath: v.relativePath,
          createdAt: v.createdAt
        })),
        ...(input.images ?? []).map((img) => ({
          id: img.id,
          kind: 'image' as const,
          dataUrl: img.dataUrl,
          relativePath: img.relativePath,
          createdAt: img.createdAt,
          title: img.title
        }))
      ]

  const resolvedVisuals = rawVisuals
    .map((vis) => ({
      ...vis,
      rel: resolveMediaRelPath(vis, project.assets)
    }))
    .filter((vis): vis is typeof vis & { rel: string } => Boolean(vis.rel))

  const resolvedVoices = input.voices
    .map((v, idx) => ({
      ...v,
      rel: resolveMediaRelPath(v, project.assets),
      text: v.text?.trim() || input.subtitles?.[idx]?.trim() || ''
    }))
    .filter((v): v is typeof v & { rel: string } => Boolean(v.rel))

  const resolvedMusic = (input.music ?? [])
    .map((m) => ({
      ...m,
      rel: resolveMediaRelPath(m, project.assets)
    }))
    .filter((m): m is typeof m & { rel: string } => Boolean(m.rel))

  const extractShotNum = (title?: string): number | null => {
    if (!title) return null
    const m =
      title.match(
        /(?:\u5206\u955c|\u955c\u5934|\u7247\u6bb5|\u7ae0\u8282|\u5e55|\u6b65\u9aa4|Shot|Scene|Step|Part|Clip)\s*#?(\d+)/i
      ) ??
      title.match(/^#?(\d+)[\s._:\uff1a-]/i) ??
      title.match(/(\d+)/)
    return m ? Number(m[1]) : null
  }

  const isAutoOrInputClip = (c: ScriptTimelineClip): boolean => {
    if (c.id.startsWith('clip:auto:')) return true
    if (
      c.nodeId &&
      !c.sourceOffsetSec &&
      !c.speed &&
      (!c.transitionType || c.transitionType === 'none')
    ) {
      return true
    }
    return false
  }

  // 仅当轨道上不存在用户手动精编的非 auto 片段时，用最新上游产物重建自动时间线
  const hasManualVideoClips = clips.some((c) => c.track === 'video' && !isAutoOrInputClip(c))
  const hasManualVoiceClips = clips.some((c) => c.track === 'voice' && !isAutoOrInputClip(c))
  const hasManualSubtitleClips = clips.some(
    (c) => c.track === 'subtitle' && !c.id.startsWith('clip:auto:')
  )
  const hasManualMusicClips = clips.some(
    (c) => c.track === 'music' && !c.id.startsWith('clip:auto:')
  )

  const canAutoBuildVideo = !hasManualVideoClips && resolvedVisuals.length > 0
  const canAutoBuildVoice = !hasManualVoiceClips && resolvedVoices.length > 0

  if (canAutoBuildVideo || canAutoBuildVoice) {
    // 清理将被重建的旧 auto / 节点输入片段（含误拖入 overlay 的 clip:auto:v: 片段）
    clips = clips.filter((c) => {
      if (canAutoBuildVideo && c.track === 'overlay' && c.id.startsWith('clip:auto:v:')) {
        return false
      }
      if (!isAutoOrInputClip(c)) return true
      if (canAutoBuildVideo && c.track === 'video') return false
      if (canAutoBuildVoice && c.track === 'voice') return false
      if (!hasManualSubtitleClips && c.track === 'subtitle') return false
      if (!hasManualMusicClips && resolvedMusic.length > 0 && c.track === 'music') return false
      return true
    })

    const voiceDurations = await Promise.all(
      resolvedVoices.map(async (v) => {
        const probed = await probeMediaDurationSec(v.rel, 'audio')
        return probed ?? estimateSpeechDurationSec(v.text)
      })
    )

    const visualDurations = await Promise.all(
      resolvedVisuals.map(async (vis) => {
        if (vis.kind === 'image' || isImageOrGifPath(vis.rel)) return null
        return probeMediaDurationSec(vis.rel, 'video')
      })
    )

    const stamp = Date.now().toString(36)

    // 构建分镜配对槽位：若画面与旁白标题均带分镜序号（如 分镜1..分镜5），按分镜号精确配对，避免中间某段旁白缺失导致后续错位
    const shotSlots: Array<{ visIdx?: number; voiceIdx?: number }> = []
    const hasVisShotNums =
      canAutoBuildVideo && resolvedVisuals.some((v) => extractShotNum(v.title) !== null)
    const hasVoiceShotNums =
      canAutoBuildVoice && resolvedVoices.some((v) => extractShotNum(v.title) !== null)

    if (hasVisShotNums && hasVoiceShotNums) {
      const usedVoices = new Set<number>()
      for (let vi = 0; vi < resolvedVisuals.length; vi++) {
        const vShot = extractShotNum(resolvedVisuals[vi]!.title)
        let matchedVoiceIdx: number | undefined
        if (vShot !== null) {
          const found = resolvedVoices.findIndex(
            (vo, idx) => !usedVoices.has(idx) && extractShotNum(vo.title) === vShot
          )
          if (found >= 0) {
            matchedVoiceIdx = found
            usedVoices.add(found)
          }
        }
        shotSlots.push({ visIdx: vi, voiceIdx: matchedVoiceIdx })
      }
      for (let ai = 0; ai < resolvedVoices.length; ai++) {
        if (!usedVoices.has(ai)) {
          shotSlots.push({ voiceIdx: ai })
        }
      }
    } else {
      const shotCount = Math.max(
        canAutoBuildVideo ? resolvedVisuals.length : 0,
        canAutoBuildVoice ? resolvedVoices.length : 0
      )
      for (let i = 0; i < shotCount; i++) {
        shotSlots.push({
          visIdx: canAutoBuildVideo && i < resolvedVisuals.length ? i : undefined,
          voiceIdx: canAutoBuildVoice && i < resolvedVoices.length ? i : undefined
        })
      }
    }

    let cursor = 0
    for (let i = 0; i < shotSlots.length; i++) {
      const slot = shotSlots[i]!
      const vis = slot.visIdx !== undefined ? resolvedVisuals[slot.visIdx] : undefined
      const voice = slot.voiceIdx !== undefined ? resolvedVoices[slot.voiceIdx] : undefined
      const voiceDur = slot.voiceIdx !== undefined ? voiceDurations[slot.voiceIdx]! : null
      const nativeVisDur = slot.visIdx !== undefined ? visualDurations[slot.visIdx]! : null

      // Audio-First：有对应配音时镜头时长严格对齐配音；否则采用视频原生时长或默认 4 秒
      const shotDur = Math.max(0.5, Math.round((voiceDur ?? nativeVisDur ?? 4) * 100) / 100)

      if (vis) {
        const isStillOrGif = vis.kind === 'image' || isImageOrGifPath(vis.rel)
        const freezeTailSec =
          !isStillOrGif && nativeVisDur !== null && shotDur > nativeVisDur + 0.08
            ? Math.round((shotDur - nativeVisDur) * 100) / 100
            : undefined
        clips.push({
          id: `clip:auto:v:${i}:${stamp}`,
          track: 'video',
          sourceId: vis.rel || vis.id || `shot:${i}`,
          title: vis.title?.trim() || `Shot ${i + 1}`,
          relativePath: vis.rel,
          startSec: cursor,
          durationSec: shotDur,
          ...(freezeTailSec ? { freezeTailSec } : {})
        })
      } else if (canAutoBuildVideo && resolvedVisuals.length > 0) {
        // 配音段数多于画面段数时，自动延长最后一个画面片段覆盖当前配音，避免黑场
        const lastVideoClip = [...clips].reverse().find((c) => c.track === 'video')
        if (lastVideoClip) {
          const newDur = Math.round((cursor + shotDur - lastVideoClip.startSec) * 100) / 100
          const lastVisIdx = resolvedVisuals.length - 1
          const lastNativeDur = visualDurations[lastVisIdx] ?? null
          const lastIsStillOrGif =
            resolvedVisuals[lastVisIdx]!.kind === 'image' ||
            isImageOrGifPath(resolvedVisuals[lastVisIdx]!.rel)
          lastVideoClip.durationSec = newDur
          if (!lastIsStillOrGif && lastNativeDur !== null && newDur > lastNativeDur + 0.08) {
            lastVideoClip.freezeTailSec = Math.round((newDur - lastNativeDur) * 100) / 100
          }
        }
      }

      if (voice) {
        const vDur = voiceDur ?? shotDur
        clips.push({
          id: `clip:auto:a:${i}:${stamp}`,
          track: 'voice',
          sourceId: voice.id || voice.rel,
          title: voice.title?.trim() || `Voice ${i + 1}`,
          relativePath: voice.rel,
          ...(voice.id ? { assetId: voice.id } : {}),
          startSec: cursor,
          durationSec: vDur
        })

        // 自动铺设与该段旁白严格同步的分句字幕
        if (!hasManualSubtitleClips && voice.text) {
          const segs = splitNarrationIntoSubtitleSegments(voice.text)
          const totalChars = Math.max(
            1,
            segs.reduce((acc, s) => acc + s.length, 0)
          )
          let subCursor = cursor
          segs.forEach((segText, segIdx) => {
            const isLast = segIdx === segs.length - 1
            const rawSegDur = isLast
              ? cursor + vDur - subCursor
              : (vDur * segText.length) / totalChars
            const segDur = Math.max(0.4, Math.round(rawSegDur * 100) / 100)
            clips.push({
              id: `clip:auto:sub:${i}_${segIdx}:${stamp}`,
              track: 'subtitle',
              sourceId: `sub:${i}:${segIdx}`,
              title: segText,
              text: segText,
              startSec: Math.round(subCursor * 100) / 100,
              durationSec: segDur
            })
            subCursor += segDur
          })
        }
      } else if (!hasManualSubtitleClips && input.subtitles?.[i]?.trim()) {
        const subText = input.subtitles[i]!.trim()
        clips.push({
          id: `clip:auto:sub:${i}_0:${stamp}`,
          track: 'subtitle',
          sourceId: `sub:${i}:0`,
          title: subText,
          text: subText,
          startSec: cursor,
          durationSec: shotDur
        })
      }

      cursor = Math.round((cursor + shotDur) * 100) / 100
    }
    dirtyDoc = true
  }

  // 自动铺入背景音乐轨（in-music）
  if (!hasManualMusicClips && resolvedMusic.length > 0) {
    clips = clips.filter((c) => !(c.track === 'music' && c.id.startsWith('clip:auto:')))
    const totalDur = Math.max(4, contentEndSecOfTimeline(clips))
    const bgm = resolvedMusic[0]!
    clips.push({
      id: `clip:auto:bgm:0:${Date.now().toString(36)}`,
      track: 'music',
      sourceId: bgm.id || bgm.rel,
      title: 'BGM',
      relativePath: bgm.rel,
      ...(bgm.id ? { assetId: bgm.id } : {}),
      startSec: 0,
      durationSec: totalDur,
      volume: 0.35,
      fadeInSec: 1,
      fadeOutSec: Math.min(1.5, Math.max(0.3, totalDur * 0.15))
    })
    dirtyDoc = true
  }

  const hasBothVoiceAndMusic =
    clips.some((c) => c.track === 'voice') && clips.some((c) => c.track === 'music')

  if (dirtyDoc && hostAssetId) {
    const nextDoc: ScriptTimelineDocument = {
      ...doc,
      clips,
      settings: {
        ...doc.settings,
        ...(hasBothVoiceAndMusic && doc.settings?.mixAutoDucking === undefined
          ? { mixAutoDucking: true }
          : {})
      }
    }
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
      mixAutoDucking: settings.mixAutoDucking ?? (hasBothVoiceAndMusic ? true : undefined),
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
