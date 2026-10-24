import {
  contentEndSecOfTimeline,
  parseActSceneSubtitlePlan,
  rasterizeTimelineStickerSvgToPngDataUrl,
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
  const rel = item.relativePath?.trim().replace(/^@+/, '').trim()
  if (rel) return rel
  const aid = (item.assetId ?? item.id)?.trim()
  if (!aid) return undefined
  return projectAssets.find((a) => a.id === aid)?.relativePath?.trim() || undefined
}

function isImageOrGifPath(rel: string): boolean {
  return /\.(png|jpe?g|webp|bmp|gif|svg)$/i.test(rel.trim())
}

function isStaticPhotoPath(rel: string): boolean {
  return /\.(png|jpe?g|webp|bmp|svg)$/i.test(rel.trim())
}

const AUTO_PHOTO_CAMERA_MOTIONS = ['kenBurnsIn', 'kenBurnsOut', 'panRight', 'panLeft'] as const

const AUTO_PHOTO_TRANSITIONS = ['dissolve', 'fade', 'smoothleft', 'circleopen'] as const

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
  voices: Array<
    GraphVoiceItem & { text?: string; title?: string; trackKind?: 'voice' | 'sfx'; lane?: number }
  >
  sfx?: Array<GraphVoiceItem & { title?: string; lane?: number }>
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

  const rawVoiceItems = input.voices.filter((v) => v.trackKind !== 'sfx')
  const rawSfxItems = [...(input.sfx ?? []), ...input.voices.filter((v) => v.trackKind === 'sfx')]

  const resolvedVoices = rawVoiceItems
    .map((v, idx) => ({
      ...v,
      rel: resolveMediaRelPath(v, project.assets),
      text: v.text?.trim() || input.subtitles?.[idx]?.trim() || ''
    }))
    .filter((v): v is typeof v & { rel: string } => Boolean(v.rel))

  const resolvedSfx = rawSfxItems
    .map((s) => ({
      ...s,
      rel: resolveMediaRelPath(s, project.assets)
    }))
    .filter((s): s is typeof s & { rel: string } => Boolean(s.rel))

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
        /(?:\u5206\u955c|\u955c\u5934|\u7247\u6bb5|\u7ae0\u8282|\u5e55|\u6b65\u9aa4|\u7167\u7247|\u56fe\u7247|Shot|Scene|Step|Part|Clip|Photo|Image)\s*#?(\d+)/i
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
      if (
        canAutoBuildVideo &&
        c.track === 'overlay' &&
        (c.id.startsWith('clip:auto:v:') || c.id.startsWith('clip:auto:vf:'))
      ) {
        return false
      }
      if (!isAutoOrInputClip(c)) return true
      if (canAutoBuildVideo && c.track === 'video') return false
      if (canAutoBuildVoice && c.track === 'voice') return false
      if (resolvedSfx.length > 0 && c.track === 'sfx' && c.id.startsWith('clip:auto:')) return false
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

    // 构建分镜配对槽位：
    // 1. 若画面与旁白标题均带分镜/幕序号（如 分镜1..分镜5 或 第1幕..第3幕），按序号精确配对；
    // 2. 若同一幕同时包含「古画取景切片图（image）」与「写实复活视频（video）」，自动合并为混合入画槽位（preImgIdx + visIdx）。
    const shotSlots: Array<{
      preImgIdx?: number
      visIdx?: number
      voiceIdx?: number
      extraVoiceIndices?: number[]
    }> = []
    const hasVisShotNums =
      canAutoBuildVideo && resolvedVisuals.some((v) => extractShotNum(v.title) !== null)
    const hasVoiceShotNums =
      canAutoBuildVoice && resolvedVoices.some((v) => extractShotNum(v.title) !== null)

    if (hasVisShotNums) {
      const usedVoices = new Set<number>()
      let slotCounter = 0
      for (let vi = 0; vi < resolvedVisuals.length; vi++) {
        const currVis = resolvedVisuals[vi]!
        const vShot = extractShotNum(currVis.title)
        const currIsPhoto = currVis.kind === 'image' || isStaticPhotoPath(currVis.rel)
        const nextVis = vi + 1 < resolvedVisuals.length ? resolvedVisuals[vi + 1] : undefined
        const nextIsVideo =
          nextVis !== undefined && nextVis.kind !== 'image' && !isStaticPhotoPath(nextVis.rel)
        const isHybridActPair =
          vShot !== null && currIsPhoto && nextIsVideo && extractShotNum(nextVis!.title) === vShot

        let matchedVoiceIdx: number | undefined
        const extraVoiceIndices: number[] = []
        if (hasVoiceShotNums && vShot !== null) {
          resolvedVoices.forEach((vo, idx) => {
            if (!usedVoices.has(idx) && extractShotNum(vo.title) === vShot) {
              usedVoices.add(idx)
              if (matchedVoiceIdx === undefined) {
                matchedVoiceIdx = idx
              } else {
                extraVoiceIndices.push(idx)
              }
            }
          })
        } else if (canAutoBuildVoice && slotCounter < resolvedVoices.length) {
          matchedVoiceIdx = slotCounter
          usedVoices.add(slotCounter)
        }

        if (isHybridActPair) {
          shotSlots.push({
            preImgIdx: vi,
            visIdx: vi + 1,
            voiceIdx: matchedVoiceIdx,
            ...(extraVoiceIndices.length ? { extraVoiceIndices } : {})
          })
          vi++
        } else {
          shotSlots.push({
            visIdx: vi,
            voiceIdx: matchedVoiceIdx,
            ...(extraVoiceIndices.length ? { extraVoiceIndices } : {})
          })
        }
        slotCounter++
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
      const preImg = slot.preImgIdx !== undefined ? resolvedVisuals[slot.preImgIdx] : undefined
      const vis = slot.visIdx !== undefined ? resolvedVisuals[slot.visIdx] : undefined
      const voice = slot.voiceIdx !== undefined ? resolvedVoices[slot.voiceIdx] : undefined
      const voiceDur = slot.voiceIdx !== undefined ? voiceDurations[slot.voiceIdx]! : null
      const nativeVisDur = slot.visIdx !== undefined ? visualDurations[slot.visIdx]! : null

      if (preImg && vis) {
        // ── 混合入画槽位（古画/世界名画一镜入画：4.2s 从容平移寻景与对位推进前奏 + 0.7s 墨韵/油彩消融叠化 + 写实复活视频） ──
        const preRollDur = 4.2
        const portalOverlap = 0.7
        const preLeadSec = Math.round((preRollDur - portalOverlap) * 100) / 100 // 3.5s
        const targetActDur = Math.max(
          preRollDur + 1.2,
          Math.round(Math.max(voiceDur ?? 0, preLeadSec + (nativeVisDur ?? 7.8)) * 100) / 100
        )
        const mainVidDur = Math.max(1.2, Math.round((targetActDur - preLeadSec) * 100) / 100)
        const shotDur = Math.round((preLeadSec + mainVidDur) * 100) / 100
        const freezeTailSec =
          nativeVisDur !== null && mainVidDur > nativeVisDur + 0.08
            ? Math.round((mainVidDur - nativeVisDur) * 100) / 100
            : undefined
        const rawSub = input.subtitles?.[i]?.trim() || voice?.text?.trim() || ''
        const rawGenParams = readGenParams()
        const graphNodes: Array<{
          id?: string
          typeId?: string
          title?: string
          params?: Record<string, unknown>
        }> =
          rawGenParams.graphJson &&
          typeof rawGenParams.graphJson === 'object' &&
          Array.isArray((rawGenParams.graphJson as { nodes?: unknown[] }).nodes)
            ? ((rawGenParams.graphJson as { nodes: Array<Record<string, unknown>> })
                .nodes as Array<{
                id?: string
                typeId?: string
                title?: string
                params?: Record<string, unknown>
              }>)
            : []
        const actMatchingNodes = graphNodes.filter(
          (n) => extractShotNum(`${n.title ?? ''} ${n.id ?? ''}`) === i + 1
        )
        const recognizeNode = actMatchingNodes.find((n) => n.typeId === 'image.toPrompt')
        const cropNode = actMatchingNodes.find((n) => n.typeId === 'image.process')
        const videoNode = actMatchingNodes.find((n) => n.typeId === 'asset.video')
        const realNode = actMatchingNodes.find((n) => n.typeId === 'asset.image')
        const cultureHint =
          cropNode?.params?.paintingCulture === 'western'
            ? ('western' as const)
            : cropNode?.params?.paintingCulture === 'chinese'
              ? ('chinese' as const)
              : undefined
        const plan = parseActSceneSubtitlePlan({
          actIndex: i,
          rawText:
            rawSub ||
            (typeof recognizeNode?.params?.text === 'string'
              ? recognizeNode.params.text
              : undefined) ||
            (typeof cropNode?.params?.text === 'string' ? cropNode.params.text : undefined),
          titleCandidates: [preImg.title, vis.title, cropNode?.title],
          fallbackPromptTexts: [
            typeof videoNode?.params?.generateInstruction === 'string'
              ? videoNode.params.generateInstruction
              : undefined,
            typeof realNode?.params?.generateInstruction === 'string'
              ? realNode.params.generateInstruction
              : undefined
          ],
          cultureHint
        })
        const snapTitle = plan.sceneTitle
        const isWestern = plan.culture === 'western'
        const rawCrop =
          cropNode?.params?.imageCrop && typeof cropNode.params.imageCrop === 'object'
            ? (cropNode.params.imageCrop as {
                cropX?: number
                cropY?: number
                cropW?: number
                cropH?: number
              })
            : undefined
        const vfStartX =
          rawCrop?.cropX != null && Number.isFinite(rawCrop.cropX)
            ? Math.min(0.26, Math.max(0.14, 0.16 + (1 - rawCrop.cropX) * 0.08))
            : 0.2
        const vfStartY =
          rawCrop?.cropY != null && Number.isFinite(rawCrop.cropY)
            ? Math.min(0.22, Math.max(0.08, rawCrop.cropY * 0.65 + 0.06))
            : 0.14
        const interActOverlap = 1.2
        const hasNextActPreRoll =
          i < shotSlots.length - 1 && shotSlots[i + 1]?.preImgIdx !== undefined
        const actIntroLeadOffset = i > 0 ? 0.55 : 0.2

        // 1) 0.0s ~ 4.2s：名画从容水平移镜寻景(Pan: 0~2.35s) → 锁定取景定格(2.35~2.86s) → 纵深推进至中近景(2.86~4.2s)
        //    国画幕间采用 1.2s smoothleft 手卷自右向左从容横移；西洋名画幕间采用 1.2s smoothright 顺应西画透视动线
        clips.push({
          id: `clip:auto:pre:${i}:${stamp}`,
          track: 'video',
          lane: 0,
          sourceId: preImg.rel || preImg.id || `pre:${i}`,
          title: snapTitle,
          relativePath: preImg.rel,
          startSec: cursor,
          durationSec: preRollDur,
          cameraMotion: 'scrollPanZoomIn',
          filterPreset: isWestern ? 'kodak-portra' : 'golden-autumn',
          visualEffect: 'gold-sparkle',
          effectIntensity: 0.45,
          ...(i > 0
            ? {
                transitionType: isWestern ? ('smoothright' as const) : ('smoothleft' as const),
                transitionInSec: interActOverlap
              }
            : {})
        })

        // 2) 文博取景框动态矢量贴纸（随加长后的水平移镜从容滑入 → 锁定对焦 → 推进放大淡出）
        const vfDur = Math.round((preLeadSec - actIntroLeadOffset + 0.1) * 100) / 100
        clips.push({
          id: `clip:auto:vf:${i}:${stamp}`,
          track: 'overlay',
          lane: 0,
          sourceId: `sticker:${isWestern ? 'museum-gilded-frame' : 'scroll-seal-frame'}:${i}`,
          stickerId: isWestern ? 'museum-gilded-frame' : 'scroll-seal-frame',
          stickerColor: isWestern ? '#EAB308' : '#D97706',
          title: snapTitle,
          text: snapTitle,
          startSec: Math.round((cursor + actIntroLeadOffset) * 100) / 100,
          durationSec: vfDur,
          overlayX: 0.06,
          overlayY: 0.08,
          overlayWidth: 0.88,
          overlayHeight: 0.84,
          keyframes: [
            {
              offsetSec: 0,
              x: Number(vfStartX.toFixed(3)),
              y: Number(vfStartY.toFixed(3)),
              width: 0.72,
              height: 0.68,
              opacity: 0.9,
              ease: 'inOutSine'
            },
            {
              offsetSec: Number((vfDur * 0.56).toFixed(2)),
              x: 0.06,
              y: 0.08,
              width: 0.88,
              height: 0.84,
              opacity: 1,
              ease: 'outCubic'
            },
            {
              offsetSec: Number((vfDur * 0.72).toFixed(2)),
              x: 0.06,
              y: 0.08,
              width: 0.88,
              height: 0.84,
              opacity: 1,
              ease: 'inCubic'
            },
            {
              offsetSec: vfDur,
              x: 0.01,
              y: 0.02,
              width: 0.98,
              height: 0.96,
              opacity: 0.15,
              ease: 'outCubic'
            }
          ],
          tweenIn: 'zoomIn',
          tweenInDurationSec: 0.4,
          tweenLoop: 'pulse',
          tweenOut: 'fadeOut',
          tweenOutDurationSec: 0.4
        })

        // 3) 字幕轨（lane 0）：移镜寻景期展示场景名铭牌 → 入画初期展示艺术史解说字幕 → 中后段展示画内人物开口对白字幕
        if (!hasManualSubtitleClips) {
          const bannerText = `【 ${snapTitle} 】`
          const bannerStart = Math.round((cursor + actIntroLeadOffset) * 100) / 100
          const bannerDur = Math.round((preLeadSec - actIntroLeadOffset - 0.15) * 100) / 100
          clips.push({
            id: `clip:auto:sub:${i}_0:${stamp}`,
            track: 'subtitle',
            lane: 0,
            sourceId: `sub:act:${i}:0`,
            title: bannerText,
            text: bannerText,
            textColor: '#FEF08A',
            fontSize: 40,
            startSec: bannerStart,
            durationSec: Math.max(1.8, bannerDur)
          })

          const bodyStart = Math.round((cursor + preLeadSec - 0.05) * 100) / 100
          const actSubEnd = cursor + shotDur - (hasNextActPreRoll ? interActOverlap + 0.1 : 0.15)
          const totalAvailDur = Math.max(2.6, actSubEnd - bodyStart)
          const hasDialogues = plan.dialogueLines.length > 0
          const narrTotalDur = hasDialogues ? Math.max(1.8, totalAvailDur * 0.44) : totalAvailDur
          let subCursor = bodyStart

          if (plan.narrationSegments.length > 0) {
            const totalChars = Math.max(
              1,
              plan.narrationSegments.reduce((acc, s) => acc + s.length, 0)
            )
            plan.narrationSegments.forEach((segText, segIdx) => {
              const isLast = segIdx === plan.narrationSegments.length - 1
              const rawSegDur = isLast
                ? bodyStart + narrTotalDur - subCursor
                : (narrTotalDur * segText.length) / totalChars
              const segDur = Math.max(0.75, Math.round(rawSegDur * 100) / 100)
              clips.push({
                id: `clip:auto:sub:${i}_${segIdx + 1}:${stamp}`,
                track: 'subtitle',
                lane: 0,
                sourceId: `sub:act:${i}:${segIdx + 1}`,
                title: segText,
                text: segText,
                startSec: Math.round(subCursor * 100) / 100,
                durationSec: segDur
              })
              subCursor += segDur
            })
          }

          if (hasDialogues) {
            let dlgCursor = Math.round((subCursor + 0.1) * 100) / 100
            const dlgTotalDur = Math.max(1.4, actSubEnd - dlgCursor)
            const dlgStep = dlgTotalDur / plan.dialogueLines.length
            plan.dialogueLines.forEach((dlg, dlgIdx) => {
              const isLastDlg = dlgIdx === plan.dialogueLines.length - 1
              const rawDlgDur = isLastDlg ? actSubEnd - dlgCursor : dlgStep - 0.06
              const dlgDur = Math.max(0.75, Math.round(rawDlgDur * 100) / 100)
              const dlgLineText = `${dlg.speaker}：「${dlg.text}」`
              clips.push({
                id: `clip:auto:sub:${i}_dlg_${dlgIdx}:${stamp}`,
                track: 'subtitle',
                lane: 0,
                sourceId: `sub:act:${i}:dlg:${dlgIdx}`,
                title: dlgLineText,
                text: dlgLineText,
                textColor: '#FDE68A',
                startSec: Math.round(dlgCursor * 100) / 100,
                durationSec: dlgDur
              })
              dlgCursor += dlgDur + 0.06
            })
          }
        }

        // 4) 2.2s ~ 10.2s：与前奏尾部重叠 0.6s，触发墨韵消融对位转场(dissolve) + 持续推镜(kenBurnsIn)进入写实视频（100% 保留视频模型直出的人物说话原声，旁白说话期间由混音器自动闪避至 42%）
        clips.push({
          id: `clip:auto:v:${i}:${stamp}`,
          track: 'video',
          lane: 0,
          sourceId: vis.rel || vis.id || `shot:${i}`,
          title: vis.title?.trim() || `Shot ${i + 1}`,
          relativePath: vis.rel,
          startSec: Math.round((cursor + preLeadSec) * 100) / 100,
          durationSec: mainVidDur,
          volume: 1,
          cameraMotion: 'kenBurnsIn',
          transitionType: 'dissolve',
          transitionInSec: portalOverlap,
          ...(hasNextActPreRoll ? { transitionOutSec: interActOverlap } : {}),
          ...(freezeTailSec ? { freezeTailSec } : {})
        })

        // 5) 画面解说旁白轨（voice 轨：从移镜寻景期起切入解说，在入画初期讲完，把视频中后段完整留给画内人物开口交谈原声）
        const actVoiceIndices = [
          ...(slot.voiceIdx !== undefined ? [slot.voiceIdx] : []),
          ...(slot.extraVoiceIndices ?? [])
        ]
        let voiceOffsetInAct = Math.round((cursor + actIntroLeadOffset + 0.05) * 100) / 100
        actVoiceIndices.forEach((vIdx, laneIdx) => {
          const vo = resolvedVoices[vIdx]
          if (!vo) return
          const rawVDur =
            voiceDurations[vIdx] ??
            Math.min(4.2, Math.max(2.6, (shotDur * 0.44) / Math.max(1, actVoiceIndices.length)))
          const vDur = Math.min(
            Math.max(1.2, rawVDur),
            Math.max(1.5, cursor + shotDur - voiceOffsetInAct - 2.2)
          )
          const assignedLane = vo.lane ?? laneIdx
          clips.push({
            id: `clip:auto:a:${i}_${laneIdx}:${stamp}`,
            track: 'voice',
            lane: assignedLane,
            sourceId: vo.id || vo.rel,
            title: vo.title?.trim() || `${snapTitle} · 画面解说旁白`, // cjk-ok
            relativePath: vo.rel,
            ...(vo.id ? { assetId: vo.id } : {}),
            startSec: Math.round(voiceOffsetInAct * 100) / 100,
            durationSec: Math.round(vDur * 100) / 100,
            volume: 1
          })
          voiceOffsetInAct = Math.min(
            cursor + shotDur - 2.0,
            Math.max(voiceOffsetInAct + 1.4, voiceOffsetInAct + vDur)
          )
        })

        // 6) 多轨环境与动作音效（音效 1：移镜快门与入画转场音；音效 2：中近景画内环境与动作底噪）
        const actSfxList = resolvedSfx.filter((s) => extractShotNum(s.title) === i + 1)
        const primarySfx = actSfxList[0] ?? resolvedSfx[i]
        const secondarySfx = actSfxList[1] ?? primarySfx
        if (primarySfx) {
          clips.push({
            id: `clip:auto:sfx:${i}_0:${stamp}`,
            track: 'sfx',
            lane: 0,
            sourceId: primarySfx.id || primarySfx.rel,
            title: `${snapTitle} · 移镜快门`, // cjk-ok
            relativePath: primarySfx.rel,
            ...(primarySfx.id ? { assetId: primarySfx.id } : {}),
            startSec: cursor,
            durationSec: preRollDur,
            volume: 0.68,
            fadeOutSec: 0.4
          })
        }
        if (secondarySfx) {
          clips.push({
            id: `clip:auto:sfx:${i}_1:${stamp}`,
            track: 'sfx',
            lane: 1,
            sourceId: secondarySfx.id || secondarySfx.rel,
            title: secondarySfx.title?.trim() || `${snapTitle} · 市井人声环境`, // cjk-ok
            relativePath: secondarySfx.rel,
            ...(secondarySfx.id ? { assetId: secondarySfx.id } : {}),
            startSec: Math.round((cursor + preLeadSec - 0.2) * 100) / 100,
            durationSec: Math.round((mainVidDur + 0.2) * 100) / 100,
            sourceOffsetSec: secondarySfx === primarySfx ? 1.5 : 0,
            volume: actVoiceIndices.length > 0 ? 0.56 : 0.82,
            fadeInSec: 0.35,
            fadeOutSec: 0.35
          })
        }
        cursor =
          Math.round((cursor + shotDur - (hasNextActPreRoll ? interActOverlap : 0)) * 100) / 100
        continue
      }

      // Audio-First：有对应配音时镜头时长严格对齐配音；否则采用视频原生时长或默认 4 秒
      const shotDur = Math.max(0.5, Math.round((voiceDur ?? nativeVisDur ?? 4) * 100) / 100)

      if (vis) {
        const isStillOrGif = vis.kind === 'image' || isImageOrGifPath(vis.rel)
        const isStaticPhoto = isStaticPhotoPath(vis.rel)
        const freezeTailSec =
          !isStillOrGif && nativeVisDur !== null && shotDur > nativeVisDur + 0.08
            ? Math.round((shotDur - nativeVisDur) * 100) / 100
            : undefined
        const hasMultiShots = shotSlots.length > 1
        clips.push({
          id: `clip:auto:v:${i}:${stamp}`,
          track: 'video',
          sourceId: vis.rel || vis.id || `shot:${i}`,
          title: vis.title?.trim() || `Shot ${i + 1}`,
          relativePath: vis.rel,
          startSec: cursor,
          durationSec: shotDur,
          ...(freezeTailSec ? { freezeTailSec } : {}),
          ...(isStaticPhoto
            ? {
                cameraMotion: AUTO_PHOTO_CAMERA_MOTIONS[i % AUTO_PHOTO_CAMERA_MOTIONS.length]
              }
            : {}),
          ...(isStaticPhoto && hasMultiShots
            ? {
                transitionType: AUTO_PHOTO_TRANSITIONS[i % AUTO_PHOTO_TRANSITIONS.length],
                ...(i > 0 ? { transitionInSec: 0.4 } : {}),
                ...(i < shotSlots.length - 1 ? { transitionOutSec: 0.4 } : {})
              }
            : {})
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
    const hasVoiceTrack = clips.some((c) => c.track === 'voice')
    clips.push({
      id: `clip:auto:bgm:0:${Date.now().toString(36)}`,
      track: 'music',
      sourceId: bgm.id || bgm.rel,
      title: 'BGM',
      relativePath: bgm.rel,
      ...(bgm.id ? { assetId: bgm.id } : {}),
      startSec: 0,
      durationSec: totalDur,
      volume: hasVoiceTrack ? 0.35 : 0.85,
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
  const exportClips: TimelineExportClip[] = await Promise.all(
    clips
      .filter((c) => !hidden.has(c.track))
      .map(async (c): Promise<TimelineExportClip> => {
        const stickerPngDataUrl = c.stickerId
          ? ((await rasterizeTimelineStickerSvgToPngDataUrl(c.stickerId, {
              text: c.text || c.title,
              color: c.stickerColor
            })) ?? undefined)
          : undefined
        return {
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
          vibrance: c.vibrance,
          temperature: c.temperature,
          tint: c.tint,
          highlights: c.highlights,
          shadows: c.shadows,
          sharpen: c.sharpen,
          vignette: c.vignette,
          fade: c.fade,
          grain: c.grain,
          filterPreset: c.filterPreset,
          filterIntensity: c.filterIntensity,
          visualEffect: c.visualEffect,
          effectIntensity: c.effectIntensity,
          textColor: c.textColor,
          fontSize: c.fontSize,
          volume: c.volume,
          fadeInSec: c.fadeInSec,
          fadeOutSec: c.fadeOutSec,
          overlayX: c.overlayX,
          overlayY: c.overlayY,
          overlayWidth: c.overlayWidth,
          overlayHeight: c.overlayHeight,
          overlayRotation: c.overlayRotation,
          opacity: c.opacity,
          tweenIn: c.tweenIn,
          tweenInDurationSec: c.tweenInDurationSec,
          tweenInEase: c.tweenInEase,
          tweenOut: c.tweenOut,
          tweenOutDurationSec: c.tweenOutDurationSec,
          tweenOutEase: c.tweenOutEase,
          tweenLoop: c.tweenLoop,
          tweenLoopSpeedHz: c.tweenLoopSpeedHz,
          tweenLoopIntensity: c.tweenLoopIntensity,
          cameraMotion: c.cameraMotion,
          keyframes: c.keyframes,
          stickerId: c.stickerId,
          stickerColor: c.stickerColor,
          stickerPngDataUrl,
          transitionInSec: c.transitionInSec,
          transitionOutSec: c.transitionOutSec,
          transitionType: c.transitionType
        }
      })
  )

  const hasExportableMedia = exportClips.some(
    (c) => c.track !== 'subtitle' && (!!c.relativePath?.trim() || !!c.stickerId)
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
