/**
 * 人像处理（`image.portrait`）执行器：本地确定性精修。
 *
 * 与 `image.crop` / `image.iconPack` 同一套「能力缝」口径：
 * 像素活跑在渲染层（`bakePortraitRetouch` 钩子），共享层只负责
 * 取上游图 → 归一化参数 → 缓存人脸分析 → 调钩子 → 落盘 → 回写节点参数。
 *
 * 两个刻意的取舍：
 * - **缺钩子直接报错，绝不透传上游**：透传会让用户以为修过的图就是原图，
 *   属于「静默错结果」，比报错难查得多（crop 对几何编辑也用同一口径）；
 * - **关键点/参数都缓存进节点 params**：Cook 因此可复现，且编辑器打开时
 *   不用重新检测一遍脸；源图变了靠 `sourceHash` 失效。
 */

import type { GraphImageItem, GraphValue, NodeExecuteContext } from './types'
import { collectIncomingImageItems } from './mediaInputs'
import { collectIncomingValues } from './incoming'
import {
  commitGeneratedImages,
  materializeGeneratedBatch,
  mergeGeneratedImages
} from './materialize'
import { fail } from '@shared/errors/appError'
import { SHARED_ERRORS } from '../../errors/catalog'
import {
  normalizePortraitAiLayers,
  normalizePortraitRetouch,
  normalizePortraitStrokes,
  readPortraitRetouchFromNode,
  type PortraitAiLayer,
  type PortraitBrushStroke
} from '../portraitRetouch'
import { idPhotoSpecById } from '../idPhoto'
import {
  PORTRAIT_FACES_VERSION,
  PORTRAIT_MANUAL_HASH,
  portraitFaceArea,
  type PortraitFaceAnalysis,
  type PortraitFacesPayload
} from '../portraitFace'

/** 人脸分析缓存的最长有效期判断依据：源图指纹 */
function resolvePickedFace(
  faces: PortraitFaceAnalysis[],
  picked: number
): PortraitFaceAnalysis | null {
  if (!faces.length) return null
  const index = Number.isFinite(picked) ? Math.min(faces.length - 1, Math.max(0, picked)) : 0
  return faces[index] ?? faces[0] ?? null
}

function readCachedFaces(
  params: { portraitFaces?: Partial<PortraitFacesPayload> },
  sourceHash: string
): { faces: PortraitFaceAnalysis[]; picked: number } | null {
  const cached = params.portraitFaces
  if (!cached || !Array.isArray(cached.faces) || !cached.faces.length) return null
  // 手动锚点（PORTRAIT_MANUAL_HASH）不参与「源图变了就失效」：它由用户手工标定
  if (cached.sourceHash !== sourceHash && cached.sourceHash !== PORTRAIT_MANUAL_HASH) return null
  return {
    faces: cached.faces as PortraitFaceAnalysis[],
    picked: typeof cached.picked === 'number' ? cached.picked : 0
  }
}

/** 源图指纹：用 URL 长度 + 前后各 64 字符做稳定摘要（不需要密码学强度） */
export function portraitSourceHash(sourceUrl: string): string {
  const value = sourceUrl.trim()
  if (!value) return ''
  const head = value.slice(0, 64)
  const tail = value.slice(-64)
  return `${value.length}:${head}:${tail}`
}

/**
 * 上游原图解析（批量）：与 crop 同一条链（图库项 → 资产图片 URL → 直接 dataUrl），
 * 但**不截断** —— 该节点的 `in` 口允许多连，一条链喂 N 张图即「同一套参数批量精修」。
 */
async function resolveSourceUrls(ctx: NodeExecuteContext): Promise<string[]> {
  const sourceItems = await collectIncomingImageItems(ctx)
  if (!sourceItems.length) throw new Error('GRAPH_PROCESS_NO_INPUT')
  let urls: string[] = []
  if (ctx.resolveImageUrls) {
    urls = (await ctx.resolveImageUrls(sourceItems)).filter(Boolean)
  } else {
    urls = sourceItems.map((item) => item.dataUrl?.trim() ?? '').filter(Boolean)
  }
  if (!urls.length && ctx.resolveAssetImageUrl) {
    for (const value of [
      ...(ctx.inputs.in ?? []),
      ...(ctx.inputs['in-image'] ?? []),
      ...collectIncomingValues(ctx.inputs)
    ]) {
      if (value.kind !== 'asset' || value.assetType !== 'image') continue
      const url = await ctx.resolveAssetImageUrl(value.assetId)
      if (url) urls.push(url)
    }
  }
  if (!urls.length) throw new Error('GRAPH_PROCESS_NO_INPUT')
  // 去重后按上限截断：一次 Cook 里几百张图既没人等得起，也不是这个节点的用法
  return [...new Set(urls)].slice(0, PORTRAIT_BATCH_LIMIT)
}

/** 单次 Cook 的批量上限（超出部分只在日志里提示） */
export const PORTRAIT_BATCH_LIMIT = 24

/** AI 版本栈的底图解析：当前版本的资产 URL；取不到则回退上游原图 */
async function resolveBaseUrl(
  ctx: NodeExecuteContext,
  fallbackUrl: string
): Promise<{ url: string; layer: PortraitAiLayer | null }> {
  const baseId = ctx.node.params.portraitBaseLayerId?.trim()
  if (!baseId) return { url: fallbackUrl, layer: null }
  const layers = normalizePortraitAiLayers(ctx.node.params.portraitLayers)
  const layer = layers.find((item) => item.id === baseId) ?? null
  if (!layer) return { url: fallbackUrl, layer: null }
  if (layer.assetId && ctx.resolveAssetMediaUrl) {
    const url = await ctx.resolveAssetMediaUrl(layer.assetId)
    if (url) return { url, layer }
  }
  return { url: fallbackUrl, layer: null }
}

export async function executePortraitNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  if (!ctx.bakePortraitRetouch) {
    throw fail(SHARED_ERRORS.capabilityPortraitBake)
  }

  const sourceUrls = await resolveSourceUrls(ctx)
  const state = readPortraitRetouchFromNode(ctx.node.params)
  const strokes: PortraitBrushStroke[] = normalizePortraitStrokes(ctx.node.params.portraitStrokes)
  const spec = idPhotoSpecById(state.idPhotoSpecId)

  const createdAt = new Date().toISOString()
  const stamp = Date.now()
  const items: GraphImageItem[] = []
  let firstRelativePatch = ''
  let firstFaces: PortraitFacesPayload | null = null

  if (sourceUrls.length > 1) {
    ctx.log?.(`batch retouch: ${sourceUrls.length} images`)
  }

  for (const [index, rawSourceUrl] of sourceUrls.entries()) {
    // AI 版本栈的底图只对第一张图有意义（版本是在编辑器里针对某一张图生成的）
    const { url: sourceUrl, layer } =
      index === 0 ? await resolveBaseUrl(ctx, rawSourceUrl) : { url: rawSourceUrl, layer: null }
    const sourceHash = portraitSourceHash(sourceUrl)
    if (layer) {
      ctx.log?.(`base image: AI version (${layer.tool}${layer.model ? ` / ${layer.model}` : ''})`)
    }
    if (sourceUrls.length > 1) {
      ctx.log?.(`image ${index + 1}/${sourceUrls.length}`)
    }

    if (ctx.signal?.aborted) throw new DOMException('Aborted', 'AbortError')

    // ── 人脸分析：第一张可用节点缓存（编辑器打开时已算过），其余逐张检测 ──
    let cached = index === 0 ? readCachedFaces(ctx.node.params, sourceHash) : null
    if (!cached && ctx.detectPortraitFaces) {
      if (index === 0) ctx.log?.('detecting face landmarks…')
      const faces = await ctx.detectPortraitFaces({ sourceDataUrl: sourceUrl, signal: ctx.signal })
      if (faces.length) {
        const picked = faces.reduce(
          (best, face, i, all) => (portraitFaceArea(face) > portraitFaceArea(all[best]) ? i : best),
          0
        )
        cached = { faces, picked }
        if (index === 0) {
          const payload: PortraitFacesPayload = {
            v: PORTRAIT_FACES_VERSION,
            sourceHash,
            faces,
            picked,
            at: new Date().toISOString()
          }
          ctx.node.params = { ...ctx.node.params, portraitFaces: payload }
          ctx.patchNode?.({ params: { portraitFaces: payload } })
        }
      }
    }
    const face = cached ? resolvePickedFace(cached.faces, cached.picked) : null
    if (index === 0) {
      if (face) {
        ctx.log?.(`face landmarks: ${face.landmarks.length} pts (${face.modelId})`)
      } else {
        ctx.log?.(
          'no face detected: face / makeup / ID-photo tools will be skipped; mark 5 anchors manually in the editor'
        )
      }
    }

    if (ctx.signal?.aborted) throw new DOMException('Aborted', 'AbortError')

    // ── 本地烘焙（渲染层） ──
    const baked = await ctx.bakePortraitRetouch({
      sourceDataUrl: sourceUrl,
      state,
      strokes,
      face,
      // 颗粒种子：与源图、参数、笔画都相关，保证「同一份输入 → 同一张图」
      seed: portraitSeedFor(sourceHash, state.v, strokes.length),
      idPhoto: spec
        ? { dpi: state.exportDpi || 300, paper: 'fiveInch', sheet: state.idPhotoSheet }
        : null,
      signal: ctx.signal,
      onStage: ({ stage, index: stageIndex, total }) =>
        ctx.log?.(`portrait ${stageIndex}/${total} ${stage}`)
    })
    if (!baked.dataUrl) throw fail(SHARED_ERRORS.portraitBakeEmpty)

    if (ctx.signal?.aborted) throw new DOMException('Aborted', 'AbortError')

    const idSuffix = sourceUrls.length > 1 ? `:${index + 1}` : ''
    items.push({
      id: `portrait:${ctx.node.id}:${stamp}${idSuffix}`,
      dataUrl: baked.dataUrl,
      createdAt
    })
    if (baked.sheetDataUrl) {
      items.push({
        id: `portrait:${ctx.node.id}:${stamp}${idSuffix}:sheet`,
        dataUrl: baked.sheetDataUrl,
        createdAt
      })
    }

    if (index === 0 && baked.landmarks && cached) {
      // 变形后的关键点回写：编辑器叠加层与下一次 Cook 直接复用
      const warped = baked.landmarks
      firstFaces = {
        v: PORTRAIT_FACES_VERSION,
        sourceHash,
        faces: cached.faces.map((item, i) =>
          i === cached!.picked ? { ...item, landmarks: warped } : item
        ),
        picked: cached.picked,
        at: new Date().toISOString()
      } satisfies PortraitFacesPayload
    }
  }

  // ── 落盘 + 端口 ──
  const materialized = await materializeGeneratedBatch(
    ctx,
    items,
    `portrait:${ctx.node.id}:${stamp}`
  )
  if (!materialized.length) throw fail(SHARED_ERRORS.persistImageFailed, { detail: '' })
  const generatedImages = mergeGeneratedImages(
    ctx,
    materialized,
    `portrait:${ctx.node.id}:${stamp}:keep`
  )
  firstRelativePatch = materialized[0]?.relativePath?.trim() ?? ''

  const patch: Record<string, unknown> = {
    portraitRetouch: normalizePortraitRetouch(state),
    portraitBakedRelativePath: firstRelativePatch
  }
  if (firstFaces) patch.portraitFaces = firstFaces
  ctx.node.params = { ...ctx.node.params, ...patch }
  ctx.patchNode?.({ params: patch })

  return commitGeneratedImages(ctx, generatedImages, firstRelativePatch, patch)
}

/** 稳定的 32 位种子：同一份输入永远得到同一串颗粒 */
export function portraitSeedFor(sourceHash: string, version: number, strokeCount: number): number {
  let hash = 2166136261 ^ version
  const text = `${sourceHash}|${strokeCount}`
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}
