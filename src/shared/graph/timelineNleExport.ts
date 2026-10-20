import {
  clampClipSpeed,
  contentEndSecOfTimeline,
  type ScriptTimelineClip,
  type ScriptTimelineDocument
} from './scriptTimeline'

export interface TimelineNleExportOptions {
  projectName?: string
  width?: number
  height?: number
  fps?: number
  /** 将工程相对路径解析为本地绝对路径（用于 NLE 直接定位媒体文件） */
  resolveMediaPath?: (relativePath: string) => string
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function toFileUrl(rawPath: string): string {
  const trimmed = rawPath.trim()
  if (!trimmed) return ''
  if (/^file:\/\//i.test(trimmed)) return trimmed
  const normalized = trimmed.replace(/\\/g, '/')
  if (/^[a-zA-Z]:\//.test(normalized)) {
    return `file:///${encodeURI(normalized)}`
  }
  if (normalized.startsWith('/')) {
    return `file://${encodeURI(normalized)}`
  }
  return encodeURI(normalized)
}

function toRationalSeconds(sec: number, fps: number): string {
  const safeFps = Math.max(1, Math.round(fps))
  const timebase = safeFps * 100
  const ticks = Math.max(0, Math.round(Math.max(0, sec) * timebase))
  if (ticks === 0) return '0s'
  return `${ticks}/${timebase}s`
}

function toMicroseconds(sec: number): number {
  return Math.max(0, Math.round(Math.max(0, sec) * 1_000_000))
}

function resolveClipPath(
  clip: ScriptTimelineClip,
  resolveMediaPath?: (relativePath: string) => string
): string {
  const rel = clip.relativePath?.trim() ?? ''
  if (!rel) return ''
  return resolveMediaPath ? resolveMediaPath(rel) : rel
}

/**
 * 生成标准 FCPXML 1.9 工程文件（兼容 DaVinci Resolve / Premiere Pro / Final Cut Pro）。
 * - 主视频轨写入 `<spine>`，自动补齐空白 `<gap>`；
 * - 画中画、字幕、配音、BGM、音效作为多通道（lane）挂载，完整保留入点（`sourceOffsetSec`）与时长。
 */
export function buildFcpxmlDocument(
  doc: ScriptTimelineDocument,
  options?: TimelineNleExportOptions
): string {
  const settings = doc.settings ?? {}
  const width = Math.max(320, Math.round(options?.width ?? settings.exportWidth ?? 1920))
  const height = Math.max(180, Math.round(options?.height ?? settings.exportHeight ?? 1080))
  const fps = Math.max(1, Math.min(60, Math.round(options?.fps ?? settings.exportFps ?? 30)))
  const projectName = (options?.projectName ?? 'AIArtEngine Timeline').trim() || 'Timeline'

  const hidden = new Set(doc.hiddenTracks ?? [])
  const muted = new Set(doc.mutedTracks ?? [])
  const activeClips = (doc.clips ?? []).filter(
    (c) => !hidden.has(c.track) && Number.isFinite(c.startSec) && c.durationSec > 0
  )
  const totalSec = Math.max(1, settings.durationSec ?? 0, contentEndSecOfTimeline(activeClips))

  const assetIdByKey = new Map<
    string,
    { id: string; name: string; src: string; hasVideo: boolean; durationSec: number }
  >()
  let nextResourceNum = 2

  for (const clip of activeClips) {
    if (clip.track === 'subtitle') continue
    const resolvedPath = resolveClipPath(clip, options?.resolveMediaPath)
    if (!resolvedPath) continue
    const hasVideo = clip.track === 'video' || clip.track === 'overlay'
    const key = `${hasVideo ? 'v' : 'a'}:${resolvedPath}`
    const speed = clampClipSpeed(clip.speed)
    const neededSourceSec = Math.max(0, clip.sourceOffsetSec ?? 0) + clip.durationSec * speed + 1
    const existing = assetIdByKey.get(key)
    if (existing) {
      existing.durationSec = Math.max(existing.durationSec, neededSourceSec)
      continue
    }
    const id = `r${nextResourceNum++}`
    assetIdByKey.set(key, {
      id,
      name: clip.title || clip.id,
      src: toFileUrl(resolvedPath),
      hasVideo,
      durationSec: Math.max(totalSec, neededSourceSec)
    })
  }

  const resourceLines: string[] = [
    `    <format id="r1" name="FFVideoFormat${height}p${fps}" frameDuration="100/${fps * 100}s" width="${width}" height="${height}" colorSpace="1-1-1 (Rec. 709)"/>`
  ]
  for (const asset of assetIdByKey.values()) {
    resourceLines.push(
      `    <asset id="${asset.id}" name="${escapeXml(asset.name)}" src="${escapeXml(asset.src)}" start="0s" duration="${toRationalSeconds(asset.durationSec, fps)}" hasVideo="${asset.hasVideo ? '1' : '0'}" hasAudio="1" format="r1"/>`
    )
  }

  const videoClips = activeClips
    .filter((c) => c.track === 'video' && resolveClipPath(c, options?.resolveMediaPath))
    .slice()
    .sort((a, b) => a.startSec - b.startSec || a.id.localeCompare(b.id))

  const connectedClips = activeClips
    .filter((c) => c.track !== 'video')
    .slice()
    .sort((a, b) => a.startSec - b.startSec || a.id.localeCompare(b.id))

  const laneByTrack: Record<string, number> = {
    overlay: 1,
    subtitle: 2,
    voice: -1,
    music: -2,
    sfx: -3
  }

  const renderConnectedItems = (indent: string): string[] => {
    const lines: string[] = []
    for (const clip of connectedClips) {
      const lane = laneByTrack[clip.track] ?? 1
      const offset = toRationalSeconds(clip.startSec, fps)
      const duration = toRationalSeconds(clip.durationSec, fps)
      const start = toRationalSeconds(Math.max(0, clip.sourceOffsetSec ?? 0), fps)
      if (clip.track === 'subtitle') {
        const text = (clip.text ?? clip.title ?? '').trim()
        if (!text) continue
        lines.push(
          `${indent}<title name="${escapeXml(text)}" lane="${lane}" offset="${offset}" start="0s" duration="${duration}">`,
          `${indent}  <text><text-style ref="ts-${escapeXml(clip.id)}">${escapeXml(text)}</text-style></text>`,
          `${indent}  <text-style-def id="ts-${escapeXml(clip.id)}"><text-style font="PingFang SC" fontSize="${clip.fontSize ?? settings.subtitleFontSize ?? 36}" fontColor="1 1 1 1" alignment="center"/></text-style-def>`,
          `${indent}</title>`
        )
        continue
      }
      if (
        muted.has(clip.track) &&
        (clip.track === 'voice' || clip.track === 'music' || clip.track === 'sfx')
      ) {
        continue
      }
      const resolvedPath = resolveClipPath(clip, options?.resolveMediaPath)
      if (!resolvedPath) continue
      const hasVideo = clip.track === 'overlay'
      const asset = assetIdByKey.get(`${hasVideo ? 'v' : 'a'}:${resolvedPath}`)
      if (!asset) continue
      lines.push(
        `${indent}<asset-clip name="${escapeXml(clip.title || clip.id)}" ref="${asset.id}" lane="${lane}" offset="${offset}" start="${start}" duration="${duration}" audioRole="${clip.track === 'music' ? 'music' : clip.track === 'sfx' ? 'effects' : 'dialogue'}"/>`
      )
    }
    return lines
  }

  const spineLines: string[] = []
  let cursorSec = 0
  const connectedLines = renderConnectedItems('              ')

  if (videoClips.length === 0) {
    spineLines.push(
      `            <gap name="Gap" offset="0s" start="0s" duration="${toRationalSeconds(totalSec, fps)}">`,
      ...connectedLines,
      `            </gap>`
    )
  } else {
    let attachedConnected = false
    for (const clip of videoClips) {
      const clipStart = Math.max(0, clip.startSec)
      if (clipStart - cursorSec > 1e-3) {
        const gapDur = clipStart - cursorSec
        if (!attachedConnected && connectedLines.length > 0) {
          spineLines.push(
            `            <gap name="Gap" offset="${toRationalSeconds(cursorSec, fps)}" start="0s" duration="${toRationalSeconds(gapDur, fps)}">`,
            ...connectedLines,
            `            </gap>`
          )
          attachedConnected = true
        } else {
          spineLines.push(
            `            <gap name="Gap" offset="${toRationalSeconds(cursorSec, fps)}" start="0s" duration="${toRationalSeconds(gapDur, fps)}"/>`
          )
        }
        cursorSec = clipStart
      }
      const resolvedPath = resolveClipPath(clip, options?.resolveMediaPath)
      const asset = assetIdByKey.get(`v:${resolvedPath}`)
      if (!asset) continue
      const effectiveStart = Math.max(cursorSec, clipStart)
      const effectiveDur = Math.max(0.04, clip.startSec + clip.durationSec - effectiveStart)
      const srcStart = Math.max(0, (clip.sourceOffsetSec ?? 0) + (effectiveStart - clipStart))
      if (!attachedConnected && connectedLines.length > 0) {
        spineLines.push(
          `            <asset-clip name="${escapeXml(clip.title || clip.id)}" ref="${asset.id}" offset="${toRationalSeconds(effectiveStart, fps)}" start="${toRationalSeconds(srcStart, fps)}" duration="${toRationalSeconds(effectiveDur, fps)}">`,
          ...connectedLines,
          `            </asset-clip>`
        )
        attachedConnected = true
      } else {
        spineLines.push(
          `            <asset-clip name="${escapeXml(clip.title || clip.id)}" ref="${asset.id}" offset="${toRationalSeconds(effectiveStart, fps)}" start="${toRationalSeconds(srcStart, fps)}" duration="${toRationalSeconds(effectiveDur, fps)}"/>`
        )
      }
      cursorSec = Math.max(cursorSec, effectiveStart + effectiveDur)
    }
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE fcpxml>',
    '<fcpxml version="1.9">',
    '  <resources>',
    ...resourceLines,
    '  </resources>',
    '  <library>',
    `    <event name="${escapeXml(projectName)}">`,
    `      <project name="${escapeXml(projectName)}">`,
    `        <sequence format="r1" duration="${toRationalSeconds(Math.max(totalSec, cursorSec), fps)}" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">`,
    '          <spine>',
    ...spineLines,
    '          </spine>',
    '        </sequence>',
    '      </project>',
    '    </event>',
    '  </library>',
    '</fcpxml>',
    ''
  ].join('\n')
}

/**
 * 生成剪映专业版 / CapCut 兼容的 `draft_content.json` 工程结构。
 * 时间单位统一采用微秒（1s = 1,000,000us），包含视频轨、画中画轨、字幕轨与多路音轨。
 */
export function buildCapCutDraftContent(
  doc: ScriptTimelineDocument,
  options?: TimelineNleExportOptions
): string {
  const settings = doc.settings ?? {}
  const width = Math.max(320, Math.round(options?.width ?? settings.exportWidth ?? 1920))
  const height = Math.max(180, Math.round(options?.height ?? settings.exportHeight ?? 1080))
  const fps = Math.max(1, Math.min(60, Math.round(options?.fps ?? settings.exportFps ?? 30)))
  const projectName = (options?.projectName ?? 'AIArtEngine Timeline').trim() || 'Timeline'

  const hidden = new Set(doc.hiddenTracks ?? [])
  const muted = new Set(doc.mutedTracks ?? [])
  const activeClips = (doc.clips ?? []).filter(
    (c) => !hidden.has(c.track) && Number.isFinite(c.startSec) && c.durationSec > 0
  )
  const totalSec = Math.max(1, settings.durationSec ?? 0, contentEndSecOfTimeline(activeClips))

  const videos: Array<Record<string, unknown>> = []
  const audios: Array<Record<string, unknown>> = []
  const texts: Array<Record<string, unknown>> = []
  const speeds: Array<Record<string, unknown>> = []

  const buildTrackSegments = (
    trackClips: ScriptTimelineClip[],
    kind: 'video' | 'audio' | 'text'
  ) => {
    const segments: Array<Record<string, unknown>> = []
    const sorted = trackClips
      .slice()
      .sort((a, b) => a.startSec - b.startSec || a.id.localeCompare(b.id))

    for (const clip of sorted) {
      const speed = clampClipSpeed(clip.speed)
      const targetStartUs = toMicroseconds(clip.startSec)
      const targetDurUs = toMicroseconds(clip.durationSec)
      const sourceStartUs = toMicroseconds(Math.max(0, clip.sourceOffsetSec ?? 0))
      const sourceDurUs = toMicroseconds(clip.durationSec * speed)
      const matId = `mat-${clip.id}`
      const speedId = `spd-${clip.id}`
      speeds.push({
        id: speedId,
        speed,
        type: 'speed'
      })

      if (kind === 'text') {
        const content = (clip.text ?? clip.title ?? '').trim()
        if (!content) continue
        texts.push({
          id: matId,
          type: 'subtitle',
          content,
          font_size: clip.fontSize ?? settings.subtitleFontSize ?? 36,
          text_color: clip.textColor ?? settings.subtitleColor ?? '#ffffff'
        })
        segments.push({
          id: `seg-${clip.id}`,
          material_id: matId,
          extra_material_refs: [speedId],
          target_timerange: { start: targetStartUs, duration: targetDurUs },
          source_timerange: { start: 0, duration: targetDurUs },
          volume: 1
        })
        continue
      }

      const resolvedPath = resolveClipPath(clip, options?.resolveMediaPath)
      if (!resolvedPath) continue

      if (kind === 'video') {
        videos.push({
          id: matId,
          type: 'video',
          path: resolvedPath,
          material_name: clip.title || clip.id,
          duration: Math.max(sourceStartUs + sourceDurUs, targetDurUs),
          width,
          height
        })
      } else {
        audios.push({
          id: matId,
          type: clip.track === 'music' ? 'music' : 'sound',
          path: resolvedPath,
          name: clip.title || clip.id,
          duration: Math.max(sourceStartUs + sourceDurUs, targetDurUs)
        })
      }

      segments.push({
        id: `seg-${clip.id}`,
        material_id: matId,
        extra_material_refs: [speedId],
        target_timerange: { start: targetStartUs, duration: targetDurUs },
        source_timerange: { start: sourceStartUs, duration: sourceDurUs },
        speed,
        volume: muted.has(clip.track) ? 0 : Math.max(0, Math.min(2, clip.volume ?? 1))
      })
    }
    return segments
  }

  const tracks: Array<Record<string, unknown>> = []
  const mainVideoSegs = buildTrackSegments(
    activeClips.filter((c) => c.track === 'video'),
    'video'
  )
  if (mainVideoSegs.length > 0) {
    tracks.push({ id: 'track-video-main', type: 'video', segments: mainVideoSegs })
  }

  const overlaySegs = buildTrackSegments(
    activeClips.filter((c) => c.track === 'overlay'),
    'video'
  )
  if (overlaySegs.length > 0) {
    tracks.push({ id: 'track-video-overlay', type: 'video', segments: overlaySegs })
  }

  const subtitleSegs = buildTrackSegments(
    activeClips.filter((c) => c.track === 'subtitle'),
    'text'
  )
  if (subtitleSegs.length > 0) {
    tracks.push({ id: 'track-text-subtitle', type: 'text', segments: subtitleSegs })
  }

  for (const audioTrack of ['voice', 'music', 'sfx'] as const) {
    if (muted.has(audioTrack)) continue
    const segs = buildTrackSegments(
      activeClips.filter((c) => c.track === audioTrack),
      'audio'
    )
    if (segs.length > 0) {
      tracks.push({ id: `track-audio-${audioTrack}`, type: 'audio', segments: segs })
    }
  }

  const draft = {
    id: `draft-${Date.now()}`,
    name: projectName,
    version: 360000,
    fps,
    duration: toMicroseconds(totalSec),
    canvas_config: {
      width,
      height,
      ratio: 'original'
    },
    materials: {
      videos,
      audios,
      texts,
      speeds
    },
    tracks
  }

  return JSON.stringify(draft, null, 2)
}

/**
 * 生成剪映专业版（JianyingPro）草稿目录所需的 `draft_meta_info.json` 元信息文件。
 * 与 `draft_content.json` 同目录放置于 `JianyingPro Drafts/<ProjectName>/` 下即可直接在剪映首页识别打开。
 */
export function buildCapCutDraftMetaInfo(
  doc: ScriptTimelineDocument,
  options?: TimelineNleExportOptions
): string {
  const settings = doc.settings ?? {}
  const projectName = (options?.projectName ?? 'AIArtEngine Timeline').trim() || 'Timeline'
  const activeClips = (doc.clips ?? []).filter(
    (c) => Number.isFinite(c.startSec) && c.durationSec > 0
  )
  const totalSec = Math.max(1, settings.durationSec ?? 0, contentEndSecOfTimeline(activeClips))
  const nowUs = Date.now() * 1000
  const meta = {
    draft_cloud_capcut_purchase_info: '',
    draft_cloud_last_action_download: false,
    draft_cloud_materials: [],
    draft_cloud_purchase_info: '',
    draft_cloud_template_id: '',
    draft_cloud_tutorial_info: '',
    draft_cloud_videocut_purchase_info: '',
    draft_cover: 'draft_cover.jpg',
    draft_deeplink_url: '',
    draft_enterprise_info: {
      draft_enterprise_extra: '',
      draft_enterprise_id: '',
      draft_enterprise_name: ''
    },
    draft_fold_path: '',
    draft_id: `aiae-${Date.now()}`,
    draft_is_ai_packaging_used: false,
    draft_is_ai_shorts: false,
    draft_is_Invisible: false,
    draft_materials: [
      { type: 0, value: [] },
      { type: 1, value: [] },
      { type: 2, value: [] },
      { type: 3, value: [] },
      { type: 6, value: [] },
      { type: 7, value: [] },
      { type: 8, value: [] }
    ],
    draft_materials_copied_info: [],
    draft_name: projectName,
    draft_new_version: '',
    draft_removable_storage_device: '',
    draft_root_path: '',
    draft_segment_extra_info: [],
    draft_timeline_materials_size_: 0,
    tm_draft_cloud_completed: '',
    tm_draft_cloud_modified: 0,
    tm_draft_create: nowUs,
    tm_draft_modified: nowUs,
    tm_draft_removed: 0,
    tm_duration: toMicroseconds(totalSec)
  }
  return JSON.stringify(meta, null, 2)
}
