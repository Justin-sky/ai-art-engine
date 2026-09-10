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
  stageSceneWithUpstreamSources,
  type Stage2dSceneState
} from '../stage2d'
import { readStage2dPoseFromNode, readStage2dRigFromNode, type Stage2dRig } from '../stage2dRig'
import {
  STAGE2D_FRAMES_OUT_PORT_ID,
  STAGE2D_SHEET_OUT_PORT_ID,
  buildStage2dFrameTimes,
  readStage2dActionFromNode,
  readStage2dAnimFpsFromNode
} from '../stage2dAction'
import { sampleStage2dAction } from '../../gameAssets/stage2dAction'
import { buildGeneratedMediaFileKey } from '../../domain'

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
  // 动作帧序列产物：节点设了帧率且带自定义动作时逐帧采样合成，走独立出口
  // out-frames / out-sheet，不改变单帧舞台图（out / out-all）的既有语义。
  const frames = await composeStage2dActionFrames(ctx, {
    scene: composeScene,
    rig,
    stamp
  })
  const outputs = commitGeneratedImages(
    ctx,
    generatedImages,
    materializedBatch[0]?.relativePath?.trim(),
    { ...(sceneChanged ? patch : {}), ...frames.params }
  )
  return frames.outputs ? { ...outputs, ...frames.outputs } : outputs
}

/**
 * 动作帧序列产物：按节点帧率逐帧采样动作 → 逐帧透明 PNG + 一张拼版 sheet。
 *
 * 帧率为 0 / 无自定义动作 / 无骨骼装配 / 宿主未注入合成能力时不产出，节点保持
 * 「只出单帧舞台图」的原行为；单帧合成或落盘失败只跳过该帧，附加产物绝不牵连
 * 整轮 cook（与动图 GIF 产物同一容错口径）。
 */
async function composeStage2dActionFrames(
  ctx: NodeExecuteContext,
  input: { scene: Stage2dSceneState; rig: Stage2dRig; stamp: number }
): Promise<{ outputs?: Record<string, GraphValue>; params: Record<string, unknown> }> {
  const fps = readStage2dAnimFpsFromNode(ctx.node.params)
  if (fps <= 0) return { params: {} }
  const action = readStage2dActionFromNode(ctx.node.params)
  if (!action || !input.rig.joints.length) return { params: {} }

  const composeCanvas = ctx.composeStage2dCanvas
  const composeSheet = ctx.composeStage2dFrameSheet
  const saveMedia = ctx.saveRunMedia
  if (!composeCanvas || !saveMedia) return { params: {} }

  const times = buildStage2dFrameTimes(action.duration ?? 0, fps)
  const createdAt = new Date().toISOString()
  const stem = ctx.node.title?.trim() || ctx.node.typeId || 'stage2d'
  const actionName = action.name?.trim() || 'action'
  const baseKey = `${stem}-anim-${actionName}`
  const outputDir = ctx.node.params.mediaOutputDir?.trim() || undefined

  const frames: Array<{ dataUrl: string; relativePath: string }> = []
  for (const [index, time] of times.entries()) {
    await ensureAlive(ctx)
    const pose = sampleStage2dAction(action, time)
    const composed = await composeCanvas({ state: input.scene, rig: input.rig, pose })
    const dataUrl = composed.dataUrl?.trim()
    if (!dataUrl) continue
    try {
      const relativePath = await saveMedia({
        dataUrl,
        key: buildGeneratedMediaFileKey({
          hostAssetName: ctx.resolveHostAssetName?.(),
          nodeTitle: `${baseKey}-${String(index + 1).padStart(3, '0')}`
        }),
        outputDir,
        node: ctx.node
      })
      if (relativePath?.trim()) frames.push({ dataUrl, relativePath: relativePath.trim() })
    } catch (err) {
      console.warn('[graph] save stage2d action frame failed', err)
    }
  }
  if (!frames.length) return { params: {} }

  const params: Record<string, unknown> = {
    stage2dAnimFps: fps,
    stage2dAnimFramePaths: frames.map((frame) => frame.relativePath),
    stage2dAnimFrameCount: frames.length
  }
  const outputs: Record<string, GraphValue> = {
    [STAGE2D_FRAMES_OUT_PORT_ID]: {
      kind: 'images',
      items: frames.map((frame, index) => ({
        id: `stage2d-frames:${ctx.node.id}:${input.stamp}:${index}`,
        dataUrl: '',
        createdAt,
        relativePath: frame.relativePath
      }))
    }
  }

  if (composeSheet) {
    try {
      const sheet = await composeSheet({ frameUrls: frames.map((frame) => frame.dataUrl) })
      const sheetDataUrl = sheet?.dataUrl?.trim()
      if (sheetDataUrl) {
        const savedSheetPath = await saveMedia({
          dataUrl: sheetDataUrl,
          key: buildGeneratedMediaFileKey({
            hostAssetName: ctx.resolveHostAssetName?.(),
            nodeTitle: `${baseKey}-sheet`
          }),
          outputDir,
          node: ctx.node
        })
        const sheetPath = savedSheetPath?.trim()
        if (sheetPath) {
          params.stage2dAnimSheetRelativePath = sheetPath
          params.stage2dAnimSheetColumns = sheet?.columns
          params.stage2dAnimSheetRows = sheet?.rows
          outputs[STAGE2D_SHEET_OUT_PORT_ID] = {
            kind: 'image',
            dataUrl: '',
            createdAt,
            relativePath: sheetPath
          }
        }
      }
    } catch (err) {
      // sheet 拼版失败不影响已产出的逐帧 PNG
      console.warn('[graph] compose stage2d frame sheet failed', err)
    }
  }

  return { outputs, params }
}
