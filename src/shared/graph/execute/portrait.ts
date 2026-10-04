/**
 * 人像处理（`image.portrait`）执行器：全部功能走图片模型。
 *
 * 口径与 `image.portraitTexture` / `image.crop` 等「能力缝」节点对齐：
 * 共享层负责「取上游图 → 归一化参数 → 合成提示词 → 调 `ctx.generateImage`
 * → 落盘 → 回写节点参数」，像素活全部由模型完成，本地只保留两处**纯几何**后处理
 * （证件照按规格裁切 + 5 寸拼版，见 `idPhoto.ts`），因为模型做不可靠像素对齐。
 *
 * 三个刻意的取舍：
 * - **未注入 `ctx.generateImage` 直接报错，绝不透传上游**：透传会让用户以为修过的图
 *   就是原图，属于「静默错结果」，比报错难查得多；
 * - **缺依赖的组整组不进提示词**：没有关键点还让模型「眼睛放大」，结果通常是随机改一张脸，
 *   少修一项远好过改错一项（`buildPortraitPrompt` 的 needs 门禁）；
 * - **人脸关键点缓存进节点 params**：编辑器打开时已算过，Cook 不必重检测；
 *   源图变了靠 `sourceHash` 失效。
 */

import type { GraphImageItem, GraphValue, NodeExecuteContext } from './types'
import { collectIncomingImageItems } from './mediaInputs'
import { collectIncomingValues } from './incoming'
import {
  commitGeneratedImages,
  materializeGeneratedBatch,
  mergeGeneratedImages
} from './materialize'
import { expandInstructionMentions } from '../instructionMentions'
import { resolveMentionSources } from './context'
import { resolvePortraitRetouchSystemPrompt } from '../systemPromptSchemes'
import { fail } from '@shared/errors/appError'
import { SHARED_ERRORS } from '../../errors/catalog'
import {
  buildPortraitPrompt,
  normalizePortraitAiLayers,
  normalizePortraitRetouch,
  readPortraitRetouchFromNode,
  type PortraitAiLayer,
  type PortraitOutputSize,
  type PortraitRetouchState
} from '../portraitRetouch'
import { idPhotoBackgroundLabel, idPhotoSpecById, planIdPhoto, type IdPhotoPlan } from '../idPhoto'
import { portraitScopePlan, type PortraitScopePlan } from '../portraitScope'
import {
  describePortraitFraming,
  portraitAspectRatioForSize,
  portraitResolutionTierForSize
} from '../portraitFraming'
import {
  PORTRAIT_FACES_VERSION,
  portraitFaceArea,
  type PortraitFaceAnalysis,
  type PortraitFacesPayload
} from '../portraitFace'

/** 局部回贴的范围说明（进运行日志，方便核对「这次到底罩了哪儿」） */
function describePortraitScope(plan: PortraitScopePlan): string {
  const parts: string[] = []
  if (plan.face) parts.push('face')
  if (plan.person) parts.push('person')
  if (plan.regions.length) parts.push(`regions:${plan.regions.length}`)
  return parts.join('+') || 'none'
}

/**
 * 局部回贴：把模型结果按蒙版贴回原图，未请求部位保持原图像素。
 *
 * 任何一步不成立（开关关掉 / 没有能力缝 / 没有可用蒙版来源 / 抛错）都原样返回整张结果，
 * 并写一条运行日志说明原因 —— 「悄悄退回整图」和「悄悄只改局部」都会让人以为功能坏了。
 */
async function applyPortraitScope(
  ctx: NodeExecuteContext,
  input: {
    enabled: boolean
    plan: PortraitScopePlan
    sourceUrl: string
    generatedDataUrl: string
    landmarks: ReadonlyArray<readonly [number, number]> | null
  }
): Promise<string> {
  const compose = ctx.composePortraitScopedRetouch
  if (!input.enabled || !compose) return input.generatedDataUrl
  try {
    const result = await compose({
      sourceDataUrl: input.sourceUrl,
      generatedDataUrl: input.generatedDataUrl,
      mask: { face: input.plan.face, person: input.plan.person, regions: input.plan.regions },
      landmarks: input.landmarks,
      signal: ctx.signal
    })
    for (const note of result.notes) ctx.log?.(`scoped retouch: ${note}`)
    if (!result.applied) return input.generatedDataUrl
    ctx.log?.(
      `scoped retouch applied (${describePortraitScope(input.plan)}, covers ${Math.round(
        result.coverRatio * 100
      )}% of frame)`
    )
    return result.dataUrl
  } catch (err) {
    ctx.log?.(`scoped retouch skipped: ${err instanceof Error ? err.message : String(err)}`)
    return input.generatedDataUrl
  }
}

/** 单次 Cook 的批量上限（超出部分只在日志里提示） */
export const PORTRAIT_BATCH_LIMIT = 24

/** 源图指纹：用 URL 长度 + 前后各 64 字符做稳定摘要（不需要密码学强度） */
export function portraitSourceHash(sourceUrl: string): string {
  const value = sourceUrl.trim()
  if (!value) return ''
  const head = value.slice(0, 64)
  const tail = value.slice(-64)
  return `${value.length}:${head}:${tail}`
}

/** 人脸分析缓存的最长有效期判断依据：源图指纹 + 版本 */
function readCachedFaces(
  params: { portraitFaces?: Partial<PortraitFacesPayload> },
  sourceHash: string
): { faces: PortraitFaceAnalysis[]; picked: number } | null {
  const cached = params.portraitFaces
  if (!cached || !Array.isArray(cached.faces) || !cached.faces.length) return null
  if (cached.v !== PORTRAIT_FACES_VERSION) return null
  // 源图换了就重算：关键点是相对这张图的，换图后原坐标没有意义
  if (cached.sourceHash !== sourceHash) return null
  return {
    faces: cached.faces as PortraitFaceAnalysis[],
    picked: typeof cached.picked === 'number' ? cached.picked : 0
  }
}

function resolvePickedFace(
  faces: PortraitFaceAnalysis[],
  picked: number
): PortraitFaceAnalysis | null {
  if (!faces.length) return null
  const index = Number.isFinite(picked) ? Math.min(faces.length - 1, Math.max(0, picked)) : 0
  return faces[index] ?? faces[0] ?? null
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

/** 模型输出尺寸偏好 → `generateImage` 的 resolution 参数 */
function portraitResolution(outputSize: PortraitOutputSize): string | undefined {
  return outputSize === 'auto' ? undefined : outputSize
}

/**
 * 编辑器的 AI 版本栈底图：当前版本的资产 URL；取不到则回退上游原图。
 *
 * 版本栈在 v2 里仍然有意义 —— 节点每次 Cook 只调**一次**模型，
 * 而用户在编辑器里可能反复试了多个版本；`portraitBaseLayerId` 决定拿哪一张当上游。
 */
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

/** 解析人脸（缓存优先，缺失则检测并回写节点参数） */
async function resolveFace(
  ctx: NodeExecuteContext,
  sourceUrl: string,
  sourceHash: string,
  writeBack: boolean
): Promise<PortraitFaceAnalysis | null> {
  let cached = writeBack ? readCachedFaces(ctx.node.params, sourceHash) : null
  if (!cached && ctx.detectPortraitFaces) {
    if (writeBack) ctx.log?.('detecting face landmarks…')
    try {
      const faces = await ctx.detectPortraitFaces({ sourceDataUrl: sourceUrl, signal: ctx.signal })
      if (faces.length) {
        const picked = faces.reduce(
          (best, face, i, all) => (portraitFaceArea(face) > portraitFaceArea(all[best]) ? i : best),
          0
        )
        cached = { faces, picked }
        if (writeBack) {
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
    } catch {
      // 检测失败一律降级为「没有人脸」：靠 needs 门禁跳过该组，绝不因此让整张图失败
    }
  }
  return cached ? resolvePickedFace(cached.faces, cached.picked) : null
}

/** 该节点参数实际需要哪些依赖：只按「用到了才探测」原则返回，避免白跑推理 */
function portraitNeedsFor(state: PortraitRetouchState): { pose: boolean; mask: boolean } {
  const pose =
    state.shoulderNeck !== 'off' || state.waistSlim !== 'off' || state.legLengthen !== 'off'
  // 「虚化背景」需要人像分割；换底色 / 换场景属于重绘背景，没有蒙版也能做
  const mask = state.bgMode === 'blur'
  return { pose, mask }
}

/**
 * 源图像素尺寸：拿不到时按 3:4 假定（证件照裁切框仍算得出来，只是不够精确）。
 * 返回 `measured` 让调用方如实报告口径，而不是谎报「居中裁切」。
 */
async function resolveSourceSize(
  ctx: NodeExecuteContext,
  sourceUrl: string
): Promise<{ width: number; height: number; measured: boolean }> {
  if (ctx.inspectImageSize) {
    try {
      const size = await ctx.inspectImageSize({ sourceDataUrl: sourceUrl })
      if (size.width > 0 && size.height > 0) return { ...size, measured: true }
    } catch {
      /* 量不到就走假定尺寸 */
    }
  }
  return { width: 900, height: 1200, measured: false }
}

export async function executePortraitNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  if (!ctx.generateImage) {
    throw fail(SHARED_ERRORS.capabilityImageGenerate)
  }

  const sourceUrls = await resolveSourceUrls(ctx)
  const state = readPortraitRetouchFromNode(ctx.node.params)
  const spec = idPhotoSpecById(state.idPhotoSpecId)
  const needs = portraitNeedsFor(state)
  if (needs.pose) ctx.log?.('body tiers requested: pose landmarks needed')
  if (needs.mask) ctx.log?.('blur background requested: subject mask needed')

  // 局部回贴：模型一次调用必定重绘整图，跑完按「脸 / 人物 / 手动框」蒙版贴回原图
  const scopePlan = portraitScopePlan(state)
  const scopeRequested = ctx.node.params.portraitScopeMode !== 'global'
  const useScope = scopeRequested && !scopePlan.disabled
  if (!scopeRequested) {
    ctx.log?.('scoped retouch off (switch): whole-frame result')
  } else if (scopePlan.disabled) {
    ctx.log?.(`scoped retouch off (${scopePlan.reason ?? 'global'} request): whole-frame result`)
  }

  if (sourceUrls.length > 1) {
    ctx.log?.(`batch retouch: ${sourceUrls.length} images`)
  }

  const systemPrompt = resolvePortraitRetouchSystemPrompt(
    ctx.node.params.generateSystemPrompt,
    ctx.locale
  )
  const extra = expandInstructionMentions(
    ctx.node.params.generateInstruction ?? '',
    resolveMentionSources(ctx)
  )

  const createdAt = new Date().toISOString()
  const stamp = Date.now()
  const items: GraphImageItem[] = []
  let firstRelativePatch = ''
  let firstFaces: PortraitFacesPayload | null = null
  let firstPrompt = ''
  let firstPlan: IdPhotoPlan | null = null

  for (const [index, rawSourceUrl] of sourceUrls.entries()) {
    if (ctx.signal?.aborted) throw new DOMException('Aborted', 'AbortError')

    // AI 版本栈的底图只对第一张图有意义（版本是在编辑器里针对某一张图生成的）
    const { url: sourceUrl, layer } =
      index === 0 ? await resolveBaseUrl(ctx, rawSourceUrl) : { url: rawSourceUrl, layer: null }
    const sourceHash = portraitSourceHash(sourceUrl)
    if (layer) {
      ctx.log?.(`base image: AI version (${layer.tool}${layer.model ? ` / ${layer.model}` : ''})`)
    }
    if (sourceUrls.length > 1) ctx.log?.(`image ${index + 1}/${sourceUrls.length}`)

    // ── 依赖探测：人脸 / 人像分割 / 姿态。任一项拿不到，对应组整组跳过 ──
    const face = await resolveFace(ctx, sourceUrl, sourceHash, index === 0)
    if (index === 0) {
      if (face) ctx.log?.(`face landmarks: ${face.landmarks.length} pts (${face.modelId})`)
      else ctx.log?.('no face detected: face / makeup / ID-photo framing hints will be skipped')
    }

    if (ctx.signal?.aborted) throw new DOMException('Aborted', 'AbortError')

    // ── 画幅与尺寸：源图尺寸 → 模型参数 ──
    //
    // 线上问题（7.0.x）：这里原先只发 resolution（档位）与 quality，**不发 aspectRatio**，
    // 于是模型按自己的默认画幅出图（多数 1:1），修完的图和原图尺寸对不上、构图也变了。
    // 画幅必须走接口参数（系统提示词里那句「取景与原片一致」拦不住模型）。
    //
    // 「输出尺寸 = 自动」的语义是**跟随原图**：按源图最大边选一个够用的档，
    // 出图后再由本地能力缝精确缩放到原图尺寸（见下方 fitPortraitToSourceSize）。
    // 显式选 1K/2K/4K 时不改尺寸（用户要的就是那个档），画幅仍跟随原图。
    const frameSize = await resolveSourceSize(ctx, sourceUrl)
    const aspectRatio = portraitAspectRatioForSize(frameSize.width, frameSize.height)
    const resolution =
      state.outputSize === 'auto'
        ? portraitResolutionTierForSize(frameSize.width, frameSize.height)
        : portraitResolution(state.outputSize)
    if (index === 0) {
      ctx.log?.(
        describePortraitFraming({
          width: frameSize.width,
          height: frameSize.height,
          measured: frameSize.measured,
          outputSize: state.outputSize
        })
      )
    }

    // ── 证件照几何计划（纯计算；模型负责出图，这里负责「怎么裁」） ──
    let plan: IdPhotoPlan | null = null
    if (spec) {
      const size = frameSize
      if (size.measured) {
        ctx.log?.(`source size: ${size.width}×${size.height}`)
      } else if (face) {
        // 量不到尺寸仍有脸：裁切框按关键点 + 假定画布算，尺度可能不准（不谎报「居中」）
        ctx.log?.('source size unavailable: ID-photo crop uses landmarks on an assumed 3:4 frame')
      } else {
        ctx.log?.('source size unavailable: ID-photo crop falls back to a centred frame')
      }
      plan = planIdPhoto({
        analysis: face,
        spec,
        imageWidth: size.width,
        imageHeight: size.height,
        dpi: state.exportDpi,
        sheet: state.idPhotoSheet
      })
      if (plan.sheet) {
        ctx.log?.(
          `ID photo sheet: ${plan.sheet.cols}×${plan.sheet.rows} = ${plan.sheet.count} per page`
        )
      }
    }

    // ── 提示词合成：只写「改什么、改多少」，硬约束在系统提示词里 ──
    const prompt = buildPortraitPrompt({
      state,
      needs: { face: !!face, mask: needs.mask, pose: needs.pose },
      idPhoto: spec
        ? {
            label: spec.labelKey,
            widthMm: spec.widthMm,
            heightMm: spec.heightMm,
            background: idPhotoBackgroundLabel(state.idPhotoBg),
            sheet: state.idPhotoSheet
          }
        : null
    })
    if (!prompt.main.trim()) throw new Error('GRAPH_PROCESS_EMPTY_PROMPT')
    if (index === 0) {
      if (prompt.skippedGroups.length) {
        ctx.log?.(`skipped groups (missing inputs): ${prompt.skippedGroups.join(', ')}`)
      }
    }
    // 负面提示词没有独立的 API 字段，与 imageEdit 同一口径拼在正文之后
    const negative = prompt.negative ? `。负面提示：${prompt.negative}` : ''
    const withExtra = extra.trim()
      ? `${prompt.main}${negative}。补充要求：${extra.trim()}`
      : `${prompt.main}${negative}`
    const fullPrompt = systemPrompt.trim() ? `${systemPrompt.trim()}\n\n${withExtra}` : withExtra
    if (index === 0) firstPrompt = fullPrompt

    if (ctx.signal?.aborted) throw new DOMException('Aborted', 'AbortError')

    // ── 唯一的执行路径：调图片模型 ──
    const result = await ctx.generateImage({
      prompt: fullPrompt,
      model: ctx.node.params.generateModel || undefined,
      providerInstanceId: ctx.node.params.generateProviderInstanceId || undefined,
      resolution,
      // 画幅跟随原图：不发它模型会按自己的默认（多为 1:1）出图，回来就和原图尺寸不一致
      aspectRatio,
      quality: 'high',
      n: 1,
      inputReferences: [sourceUrl]
    })

    if (ctx.signal?.aborted) throw new DOMException('Aborted', 'AbortError')

    const idSuffix = sourceUrls.length > 1 ? `:${index + 1}` : ''
    let produced = 0
    for (const [imageIndex, url] of (result.images ?? []).entries()) {
      const dataUrl = typeof url === 'string' ? url.trim() : ''
      if (!dataUrl) continue
      produced++

      // 局部回贴先于规格裁切：先把「只改对应部位」的像素定下来，再按证件照规格裁
      const scoped = await applyPortraitScope(ctx, {
        enabled: useScope,
        plan: scopePlan,
        sourceUrl,
        generatedDataUrl: dataUrl,
        landmarks: face?.landmarks ?? null
      })

      // 「输出尺寸 = 自动」= 跟随原图：把结果精确缩放到原图像素尺寸。
      // 必须排在证件照裁切**之前** —— 证件照有自己确定的输出尺寸，那一步说了算。
      let framed = scoped
      if (state.outputSize === 'auto' && ctx.fitPortraitToSourceSize) {
        try {
          const fitted = await ctx.fitPortraitToSourceSize({
            dataUrl: scoped,
            width: frameSize.width,
            height: frameSize.height,
            signal: ctx.signal
          })
          framed = fitted.dataUrl
        } catch (err) {
          ctx.log?.(
            `fit to source size skipped: ${err instanceof Error ? err.message : String(err)}`
          )
        }
      }

      // 证件照：按规格精确裁切（+ 可选拼版）。几何能力缺失或失败都不影响主图落盘。
      let mainDataUrl = framed
      let sheetDataUrl: string | null = null
      if (plan && ctx.composePortraitIdPhoto) {
        try {
          const composed = await ctx.composePortraitIdPhoto({
            sourceDataUrl: framed,
            crop: plan.crop,
            outputWidth: plan.outputWidth,
            outputHeight: plan.outputHeight,
            sheet: plan.sheet,
            signal: ctx.signal
          })
          if (composed.dataUrl) {
            mainDataUrl = composed.dataUrl
            sheetDataUrl = composed.sheetDataUrl ?? null
          }
        } catch (err) {
          ctx.log?.(`ID-photo crop skipped: ${err instanceof Error ? err.message : String(err)}`)
        }
      }

      const suffix = produced > 1 ? `:${imageIndex}` : ''
      items.push({
        id: `portrait:${ctx.node.id}:${stamp}${idSuffix}${suffix}`,
        dataUrl: mainDataUrl,
        createdAt
      })
      if (sheetDataUrl) {
        items.push({
          id: `portrait:${ctx.node.id}:${stamp}${idSuffix}${suffix}:sheet`,
          dataUrl: sheetDataUrl,
          createdAt
        })
      }
    }
    if (!produced) {
      throw fail(SHARED_ERRORS.resultMissing, {
        what: { zh: '人像处理图片', en: 'portrait retouch image' } // cjk-ok 双语错误数据（zh/en，由 errors/catalog 统一格式化）
      })
    }

    if (index === 0) {
      firstPlan = plan
      // 关键点回写：下一次 Cook 与其它消费方直接复用（模型不改变关键点，无需重算）。
      // 原样搬运缓存里的 sourceHash / picked，避免把当前的源图指纹改写成别的值。
      if (face) {
        const cached = readCachedFaces(ctx.node.params, sourceHash)
        if (cached) {
          firstFaces = {
            v: PORTRAIT_FACES_VERSION,
            sourceHash: ctx.node.params.portraitFaces?.sourceHash ?? sourceHash,
            faces: cached.faces,
            picked: cached.picked,
            at: new Date().toISOString()
          }
        }
      }
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
    portraitBakedRelativePath: firstRelativePatch,
    portraitPrompt: firstPrompt,
    portraitIdPhotoPlan: firstPlan
      ? {
          specId: firstPlan.spec.id,
          outputWidth: firstPlan.outputWidth,
          outputHeight: firstPlan.outputHeight,
          crop: firstPlan.crop,
          sheet: firstPlan.sheet
        }
      : null
  }
  if (firstFaces) patch.portraitFaces = firstFaces
  ctx.node.params = { ...ctx.node.params, ...patch }
  ctx.patchNode?.({ params: patch })

  return commitGeneratedImages(ctx, generatedImages, firstRelativePatch, patch)
}
