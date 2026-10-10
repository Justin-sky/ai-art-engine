/**
 * 修复执行链：replaceEntity / removeEntity / rewriteUtterance / editText / grade。
 * 未改镜头由 buildExecutor 直拷；此处产出「受影响镜头」的替换视频或音轨。
 * 同一镜头的多个编辑按顺序叠加（后一个以前一个的产物为底）。
 */
import { mkdirSync, existsSync, writeFileSync } from 'fs'
import { extname, join } from 'path'
import type {
  EditTextEdit,
  GradeEdit,
  OcrRegion,
  RemoveEntityEdit,
  ReplaceEntityEdit,
  RewriteUtteranceEdit,
  ShotEvidence,
  SemanticEdit
} from '@shared/semanticTimeline'
import { compositeMaskedReplace } from './maskComposite'
import { runFfmpeg } from '../ffmpegRunner'
import { resolveFfmpegForSemantic } from './resolveFfmpeg'

type NormBox = { x: number; y: number; w: number; h: number }

export interface EditChainContext {
  sourceVideoAbs: string
  shots: ShotEvidence[]
  workDirAbs: string
  /** 实体 → 掩码目录（mask_00001.png 序列） */
  entityMaskDirs?: Map<string, string>
  /** 实体 → 镜头 → 关键帧检测框（归一化）；无掩码时的近似编辑区域 */
  entityBoxes?: Map<string, Map<string, NormBox>>
  /** 替换参考图/视频绝对路径（按 newAssetId 或 entityId） */
  replaceMediaAbs?: Map<string, string>
  /** 新语音 wav（rewriteUtterance） */
  speechWavAbs?: Map<string, string>
  ocrRegions?: OcrRegion[]
  frameWidth?: number
  frameHeight?: number
  /** 已产出的镜头替换视频；执行链内部维护，用于叠加 */
  currentShotVideos?: Map<string, string>
}

export interface EditChainResult {
  /** shotId → 替换后视频绝对路径 */
  replacedShotVideos: Map<string, string>
  /** 新音轨片段 */
  audioReplacements: Map<string, string>
  notes: string[]
}

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif'])

function emptyResult(notes: string[] = []): EditChainResult {
  return { replacedShotVideos: new Map(), audioReplacements: new Map(), notes }
}

function affectedShots(shots: ShotEvidence[], shotIds: string[] | undefined): ShotEvidence[] {
  if (!shotIds?.length) return shots
  const set = new Set(shotIds)
  return shots.filter((s) => set.has(s.id))
}

function hasMaskPngs(dir: string | undefined): dir is string {
  return !!dir && existsSync(join(dir, 'mask_00001.png'))
}

/**
 * 该镜头的编辑底片：已有替换产物则叠加其上，否则从源片裁切。
 * 必须重编码裁切：stream copy 只能落在关键帧上，非关键帧起点的镜头会多出前面的帧，拼回后时长变长。
 */
async function prepareShotSource(
  ctx: EditChainContext,
  shot: ShotEvidence,
  outDir: string
): Promise<string> {
  const current = ctx.currentShotVideos?.get(shot.id)
  if (current && existsSync(current)) return current
  const seg = join(outDir, `${shot.id}.src.mp4`)
  await runFfmpeg(resolveFfmpegForSemantic(), [
    '-y',
    '-ss',
    String(shot.range.start),
    '-i',
    ctx.sourceVideoAbs,
    '-t',
    String(Math.max(0.04, shot.range.end - shot.range.start)),
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    seg
  ])
  return seg
}

/** 归一化框 → 像素框；delogo 要求框严格位于画面内 */
function pixelBox(
  box: NormBox,
  ctx: EditChainContext,
  inset = false
): {
  x: number
  y: number
  w: number
  h: number
} | null {
  const fw = ctx.frameWidth ?? 0
  const fh = ctx.frameHeight ?? 0
  if (fw <= 0 || fh <= 0) return null
  const margin = inset ? 1 : 0
  const x = Math.max(margin, Math.round(box.x * fw))
  const y = Math.max(margin, Math.round(box.y * fh))
  const w = Math.min(Math.round(box.w * fw), fw - x - margin)
  const h = Math.min(Math.round(box.h * fh), fh - y - margin)
  if (w < 4 || h < 4) return null
  return { x, y, w, h }
}

function escapeDrawtext(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'").replace(/%/g, '\\%')
}

async function runFilter(input: string, filter: string, out: string): Promise<void> {
  await runFfmpeg(resolveFfmpegForSemantic(), [
    '-y',
    '-i',
    input,
    '-vf',
    filter,
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'copy',
    out
  ])
}

/** 无掩码时：把替换图/视频缩放贴进检测框（L1 近似，框取自镜头中帧） */
async function overlayIntoBox(
  baseAbs: string,
  mediaAbs: string,
  box: { x: number; y: number; w: number; h: number },
  out: string
): Promise<void> {
  const isImage = IMAGE_EXTS.has(extname(mediaAbs).toLowerCase())
  const mediaInput = isImage
    ? ['-loop', '1', '-i', mediaAbs]
    : ['-stream_loop', '-1', '-i', mediaAbs]
  await runFfmpeg(resolveFfmpegForSemantic(), [
    '-y',
    '-i',
    baseAbs,
    ...mediaInput,
    '-filter_complex',
    `[1:v]scale=${box.w}:${box.h}:force_original_aspect_ratio=decrease,format=rgba[r];[0:v][r]overlay=x=${box.x}+(${box.w}-overlay_w)/2:y=${box.y}+(${box.h}-overlay_h)/2:shortest=1[outv]`,
    '-map',
    '[outv]',
    '-map',
    '0:a?',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'copy',
    out
  ])
}

/** 抹除：有掩码走 alphamerge；否则按检测框 delogo（周边像素插值填充） */
export async function executeRemoveEntity(
  edit: RemoveEntityEdit,
  ctx: EditChainContext,
  shotIds: string[]
): Promise<EditChainResult> {
  const result = emptyResult()
  const outDir = join(ctx.workDirAbs, 'remove', edit.entityId)
  mkdirSync(outDir, { recursive: true })
  const maskDir = ctx.entityMaskDirs?.get(edit.entityId)
  const boxes = ctx.entityBoxes?.get(edit.entityId)
  for (const shot of affectedShots(ctx.shots, shotIds)) {
    const out = join(outDir, `${shot.id}.out.mp4`)
    try {
      if (hasMaskPngs(maskDir)) {
        const base = await prepareShotSource(ctx, shot, outDir)
        // 无 inpaint 模型时以自身为替换底（视觉上需外部补全）
        await compositeMaskedReplace({
          sourceVideoAbs: base,
          replaceVideoAbs: base,
          maskDirAbs: maskDir,
          outputAbs: out,
          durationSec: shot.range.end - shot.range.start
        })
        result.replacedShotVideos.set(shot.id, out)
        continue
      }
      const norm = boxes?.get(shot.id)
      const px = norm ? pixelBox(norm, ctx, true) : null
      if (!px) {
        result.notes.push(`removeEntity ${edit.entityId}@${shot.id}: no mask/box — skipped`)
        continue
      }
      const base = await prepareShotSource(ctx, shot, outDir)
      await runFilter(base, `delogo=x=${px.x}:y=${px.y}:w=${px.w}:h=${px.h}`, out)
      result.replacedShotVideos.set(shot.id, out)
      result.notes.push(`removeEntity ${edit.entityId}@${shot.id}: box delogo (approx, no mask)`)
    } catch (e) {
      result.notes.push(`removeEntity ${shot.id}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return result
}

/** 替换：有掩码走 alphamerge；否则按检测框贴图（框取自中帧，运动镜头会有偏差） */
export async function executeReplaceEntity(
  edit: ReplaceEntityEdit,
  ctx: EditChainContext,
  shotIds: string[]
): Promise<EditChainResult> {
  const result = emptyResult()
  const outDir = join(ctx.workDirAbs, 'replace', edit.entityId)
  mkdirSync(outDir, { recursive: true })
  const maskDir = ctx.entityMaskDirs?.get(edit.entityId)
  const boxes = ctx.entityBoxes?.get(edit.entityId)
  const replaceAbs =
    ctx.replaceMediaAbs?.get(edit.newAssetId) ?? ctx.replaceMediaAbs?.get(edit.entityId)
  if (!replaceAbs || !existsSync(replaceAbs)) {
    result.notes.push(
      `replaceEntity ${edit.entityId}: replace media missing (asset ${edit.newAssetId})`
    )
    return result
  }
  const targets = affectedShots(ctx.shots, shotIds)
  if (targets.length === 0) {
    result.notes.push(`replaceEntity ${edit.entityId}: entity has no appearances`)
    return result
  }
  for (const shot of targets) {
    const out = join(outDir, `${shot.id}.out.mp4`)
    try {
      if (hasMaskPngs(maskDir)) {
        const base = await prepareShotSource(ctx, shot, outDir)
        await compositeMaskedReplace({
          sourceVideoAbs: base,
          replaceVideoAbs: replaceAbs,
          maskDirAbs: maskDir,
          outputAbs: out,
          durationSec: shot.range.end - shot.range.start
        })
        result.replacedShotVideos.set(shot.id, out)
        continue
      }
      const norm = boxes?.get(shot.id)
      const px = norm ? pixelBox(norm, ctx) : null
      if (!px) {
        result.notes.push(`replaceEntity ${edit.entityId}@${shot.id}: no mask/box — skipped`)
        continue
      }
      const base = await prepareShotSource(ctx, shot, outDir)
      await overlayIntoBox(base, replaceAbs, px, out)
      result.replacedShotVideos.set(shot.id, out)
      result.notes.push(`replaceEntity ${edit.entityId}@${shot.id}: box overlay (approx, no mask)`)
    } catch (e) {
      result.notes.push(`replaceEntity ${shot.id}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return result
}

/** 话术改写：挂接已生成的 TTS wav；口型由上层 video.lipSync */
export async function executeRewriteUtterance(
  edit: RewriteUtteranceEdit,
  ctx: EditChainContext
): Promise<EditChainResult> {
  const result = emptyResult()
  const wav = ctx.speechWavAbs?.get(edit.utteranceId)
  if (!wav || !existsSync(wav)) {
    result.notes.push(
      `rewriteUtterance ${edit.utteranceId}: speech wav missing (generate_speech first)`
    )
    const notePath = join(ctx.workDirAbs, 'rewrite', `${edit.utteranceId}.txt`)
    mkdirSync(join(notePath, '..'), { recursive: true })
    writeFileSync(notePath, edit.newText, 'utf8')
  } else {
    result.audioReplacements.set(edit.utteranceId, wav)
    if (edit.lipSync) result.notes.push('lipSync requested — run video.lipSync on affected shots')
  }
  return result
}

/**
 * editText：先 delogo 擦除区域，再 drawtext 重排（需 box 归一化坐标）。
 * 无 box 时仅记录新文本，不改像素。
 */
export async function executeEditText(
  edit: EditTextEdit,
  ctx: EditChainContext,
  options: {
    shot: ShotEvidence
    boxNorm?: NormBox
    frameW: number
    frameH: number
  }
): Promise<EditChainResult> {
  const result = emptyResult()
  if (!options.boxNorm) {
    result.notes.push(`editText ${edit.regionId}: no box — text-only metadata update`)
    return result
  }
  const px = pixelBox(
    options.boxNorm,
    { ...ctx, frameWidth: options.frameW, frameHeight: options.frameH },
    true
  )
  if (!px) {
    result.notes.push(`editText ${edit.regionId}: box too small`)
    return result
  }
  const outDir = join(ctx.workDirAbs, 'editText', edit.regionId)
  mkdirSync(outDir, { recursive: true })
  const base = await prepareShotSource(ctx, options.shot, outDir)
  const out = join(outDir, `${options.shot.id}.out.mp4`)
  const fontSize = Math.max(16, Math.floor(px.h * 0.7))
  try {
    await runFilter(
      base,
      `delogo=x=${px.x}:y=${px.y}:w=${px.w}:h=${px.h},drawtext=text='${escapeDrawtext(edit.newText)}':x=${px.x}:y=${px.y}+(${px.h}-text_h)/2:fontsize=${fontSize}:fontcolor=white:borderw=2:bordercolor=black`,
      out
    )
    result.replacedShotVideos.set(options.shot.id, out)
  } catch (e) {
    result.notes.push(`editText: ${e instanceof Error ? e.message : String(e)}`)
  }
  return result
}

function num(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : fallback
}

/** 调色：eq 滤镜（brightness -1..1 / contrast / saturation / gamma） */
export async function executeGrade(
  edit: GradeEdit,
  ctx: EditChainContext
): Promise<EditChainResult> {
  const result = emptyResult()
  const p = edit.params ?? {}
  const filter = `eq=brightness=${num(p.brightness, 0)}:contrast=${num(p.contrast, 1)}:saturation=${num(p.saturation, 1)}:gamma=${num(p.gamma, 1)}`
  const outDir = join(ctx.workDirAbs, 'grade', edit.id)
  mkdirSync(outDir, { recursive: true })
  for (const shot of affectedShots(ctx.shots, edit.shotIds)) {
    const out = join(outDir, `${shot.id}.out.mp4`)
    try {
      const base = await prepareShotSource(ctx, shot, outDir)
      await runFilter(base, filter, out)
      result.replacedShotVideos.set(shot.id, out)
    } catch (e) {
      result.notes.push(`grade ${shot.id}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return result
}

function shotForRegion(ctx: EditChainContext, region: OcrRegion): ShotEvidence | undefined {
  if (region.shotId) {
    const byId = ctx.shots.find((s) => s.id === region.shotId)
    if (byId) return byId
  }
  const mid = (region.range.start + region.range.end) / 2
  return ctx.shots.find((s) => s.range.start <= mid && mid < s.range.end)
}

/** 按 edits 分发到各执行链，合并结果 */
export async function runEditChains(
  edits: SemanticEdit[],
  ctx: EditChainContext,
  entityShotIndex: Map<string, string[]>
): Promise<EditChainResult> {
  const merged = emptyResult()
  const chainCtx: EditChainContext = { ...ctx, currentShotVideos: merged.replacedShotVideos }
  for (const edit of edits) {
    let partial = emptyResult()
    if (edit.kind === 'replaceEntity') {
      partial = await executeReplaceEntity(edit, chainCtx, entityShotIndex.get(edit.entityId) ?? [])
    } else if (edit.kind === 'removeEntity') {
      partial = await executeRemoveEntity(edit, chainCtx, entityShotIndex.get(edit.entityId) ?? [])
    } else if (edit.kind === 'rewriteUtterance') {
      partial = await executeRewriteUtterance(edit, chainCtx)
    } else if (edit.kind === 'editText') {
      const region = ctx.ocrRegions?.find((r) => r.id === edit.regionId)
      const shot = region ? shotForRegion(ctx, region) : undefined
      if (!region || !shot) {
        partial.notes.push(`editText ${edit.regionId}: OCR region not found`)
      } else {
        partial = await executeEditText(edit, chainCtx, {
          shot,
          boxNorm: region.box,
          frameW: ctx.frameWidth ?? 0,
          frameH: ctx.frameHeight ?? 0
        })
      }
    } else if (edit.kind === 'grade') {
      partial = await executeGrade(edit, chainCtx)
    } else if (edit.kind === 'dropBeat' || edit.kind === 'reorderBeats') {
      // 结构性编辑由 buildExecutor 重排镜头序列
    } else {
      partial.notes.push(`edit ${edit.kind}: needs generator (not executed locally)`)
    }
    for (const [k, v] of partial.replacedShotVideos) merged.replacedShotVideos.set(k, v)
    for (const [k, v] of partial.audioReplacements) merged.audioReplacements.set(k, v)
    merged.notes.push(...partial.notes)
  }
  return merged
}
