/**
 * stage.2d「2D 舞台」节点执行器（5.5「2D 导演台」叠绘接线）。
 *
 * 与 imageLocal.ts 的 cutout/align 同构：本文件只负责
 * 收集上游精灵（自动成层级联刷新）→ 请求渲染层叠绘合成 →
 * 物化落盘 → 写回图库；像素推理由宿主注入的 `composeStage2dCanvas`
 * 提供，几何在 shared/gameAssets/stage2dScene 可离线单测。
 * 舞台层随节点 params（stage2dScene）持久化：无上游时直接合成
 * 既有层（供 dock 预置 / 后台 cook 重跑同一舞台）。
 */
import type { GraphImageItem, GraphValue, NodeExecuteContext } from './types'
import { collectIncomingImageItems } from './mediaInputs'
import {
  commitGeneratedImages,
  materializeGeneratedBatch,
  mergeGeneratedImages
} from './materialize'
import { fail } from '@shared/errors/appError'
import { SHARED_ERRORS } from '../../errors/catalog'
import {
  normalizeStage2dScene,
  readStage2dSceneFromNode,
  stage2dSceneToNodePatch,
  stageSceneWithUpstreamSources
} from '../stage2d'
import { readStage2dPoseFromNode, readStage2dRigFromNode } from '../stage2dRig'

/** 可直接交给 <img> 绘制的层源；其余视为项目相对路径，经 resolver 读成 dataUrl */
const DIRECT_DRAWABLE_URL = /^(data:|https?:\/\/|blob:)/i

async function ensureAlive(ctx: NodeExecuteContext): Promise<void> {
  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }
}

/** 逐层解析为可绘制 URL（同序）；不可解析 / 不可绘制返回 '' */
async function resolveStageLayerUrls(
  ctx: NodeExecuteContext,
  layers: Array<{ sourceUrl: string }>
): Promise<string[]> {
  const urls = layers.map((layer) => layer.sourceUrl.trim())
  if (!ctx.resolveImageUrls) {
    return urls.map((url) => (DIRECT_DRAWABLE_URL.test(url) ? url : ''))
  }
  const items = urls.map((url) =>
    DIRECT_DRAWABLE_URL.test(url) ? { dataUrl: url } : { relativePath: url }
  )
  const resolved = await ctx.resolveImageUrls(items)
  return resolved.map((url) => url ?? '')
}

/**
 * 2D 舞台叠绘：上游精灵自动成层后合成一帧 PNG 输出。
 * 输出单张舞台帧（out / out-all 图库）；运行后把本次层源写回
 * params.stage2dScene，dock / 后续重跑共享同一舞台。
 */
export async function executeStage2dNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const initial = readStage2dSceneFromNode(ctx.node.params)
  const incoming = await collectIncomingImageItems(ctx)

  // 上游精灵（如级联 image.align 输出）按序自动成层；无上游则合成既有层
  const rig = readStage2dRigFromNode(ctx.node.params)
  const pose = readStage2dPoseFromNode(ctx.node.params, rig)
  const scene = incoming.length
    ? stageSceneWithUpstreamSources(
        initial,
        incoming.map((item) => ({
          sourceUrl: item.relativePath?.trim() || item.dataUrl?.trim() || '',
          name: item.title ?? null
        }))
      )
    : initial
  const patch = stage2dSceneToNodePatch(scene)
  const sceneChanged = JSON.stringify(patch.stage2dScene) !== JSON.stringify(initial)

  if (!scene.layers.length) {
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }

  if (!ctx.composeStage2dCanvas) {
    // 无合成注入时透传，便于离线
    if (!incoming.length) throw new Error('GRAPH_PROCESS_NO_INPUT')
    const picked = incoming[0]!
    ctx.node.params = { ...ctx.node.params, ...patch }
    if (sceneChanged) ctx.patchNode?.({ params: patch })
    return commitGeneratedImages(
      ctx,
      [{ ...picked, id: picked.id?.trim() || 'passthrough:0' }],
      picked.relativePath?.trim()
    )
  }

  const layerUrls = await resolveStageLayerUrls(ctx, scene.layers)
  await ensureAlive(ctx)

  // 空源层在归一化时剔除；其余层可绘制源进入合成
  const composeScene = normalizeStage2dScene({
    ...scene,
    layers: scene.layers.map((layer, index) => ({
      ...layer,
      sourceUrl: layerUrls[index] ?? ''
    }))
  })
  const composed = await ctx.composeStage2dCanvas({ state: composeScene, rig, pose })
  if (!composed.dataUrl) {
    throw fail(SHARED_ERRORS.imageCropEmpty)
  }
  await ensureAlive(ctx)

  const createdAt = new Date().toISOString()
  const stamp = Date.now()
  const item: GraphImageItem = {
    id: `stage:${ctx.node.id}:${stamp}`,
    dataUrl: composed.dataUrl,
    createdAt
  }
  const materializedBatch = await materializeGeneratedBatch(
    ctx,
    [item],
    `stage:${ctx.node.id}:${stamp}`
  )
  if (!materializedBatch.length) {
    throw fail(SHARED_ERRORS.persistImageFailed, { detail: '' })
  }
  const generatedImages = mergeGeneratedImages(
    ctx,
    materializedBatch,
    `stage:${ctx.node.id}:${stamp}:keep`
  )
  return commitGeneratedImages(
    ctx,
    generatedImages,
    materializedBatch[0]?.relativePath?.trim(),
    sceneChanged ? patch : undefined
  )
}
