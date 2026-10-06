import type { GraphValue, NodeExecuteContext } from './types'
import { expandInstructionMentions } from '../instructionMentions'
import { resolveMentionSources } from './context'
import { autoIncomingTextForInstruction } from './incoming'
import { selectIncomingValuesForInstruction } from './incoming'
import { collectImageGenerateSourceItems } from './mediaInputs'
import { collectMediaInputReferences } from './generateMedia'
import { dualImageGalleryOutputs } from './gallery'
import { persistModelGeneration } from './materialize'

/**
 * 空间世界可吃的最多参考图张数。
 * World Labs `multi-image` 的 world_prompt 上限为 4 张（reconstruct_images=true 时 8 张，
 * 这里按保守口径截断，与适配器 `buildWorldPrompt` 的 slice(0, 4) 一致）。
 */
export const WORLD_MAX_REFERENCE_IMAGES = 4

/**
 * 收集上游图片输入（参考图）
 */
async function collectWorldImageUrls(
  ctx: NodeExecuteContext,
  instructionRaw: string
): Promise<string[]> {
  const items = await collectImageGenerateSourceItems(ctx, instructionRaw)
  if (!items.length) return []

  const urls = ctx.resolveImageUrls
    ? await ctx.resolveImageUrls(items)
    : items.map((item) => item.dataUrl?.trim() ?? '')
  return urls.map((url) => url?.trim() ?? '').filter(Boolean)
}

/**
 * 收集上游视频输入（参考视频）。
 * 与视频生成节点同口径：拿到的是工程相对路径（或 data URL），由主进程门面上传对象存储换公网 URL。
 * World Labs 的 video world_prompt 只吃 1 条，故只用第一条。
 */
async function collectWorldVideoUrls(ctx: NodeExecuteContext): Promise<string[]> {
  const values = ctx.inputs['in-video'] ?? []
  if (!values.length) return []
  const refs = await collectMediaInputReferences(ctx, values)
  return refs.filter((ref) => ref.kind === 'video_url').map((ref) => ref.url)
}

/** 世界生成种子：0 / 非有限值表示不传 seed（交给上游随机） */
function resolveWorldSeed(raw: number | undefined): number | undefined {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined
  const seed = Math.trunc(raw)
  if (seed <= 0) return undefined
  return Math.min(4294967295, seed)
}

/** 单图参考的全景模式（官方 is_pano）：只认三个合法值，缺省 auto（自动识别等距柱状全景） */
function resolveWorldPanoMode(raw: string | undefined): 'auto' | 'always' | 'never' {
  if (raw === 'always' || raw === 'never') return raw
  return 'auto'
}

/**
 * 空间世界生成节点执行器（World Labs Marble）
 *
 * 流程：
 * 1. 解析指令文本
 * 2. 收集上游参考：参考视频（最多 1 条）或图片（单图 / 多图同场景，最多 4 张）
 * 3. 有 generateSpatialWorld API 时调用 API 生成（异步 submit → poll → download）
 * 4. 无 API 时退化为透传（输出上游文本/图片）
 * 5. 返回世界网格（GLB）资产输出；入 generatedModels 画廊，与 3D 模型同口径可复用/挑选
 */
export async function executeSpatialWorldGenerateNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const { node } = ctx
  const instructionRaw = node.params.generateInstruction?.trim() ?? ''
  const mentionSources = resolveMentionSources(ctx)
  const selected = selectIncomingValuesForInstruction(ctx, instructionRaw)
  const localNotes = expandInstructionMentions(instructionRaw, mentionSources) || undefined
  const incomingText = autoIncomingTextForInstruction(instructionRaw, selected, mentionSources)

  // 收集图片参考与参考视频
  const imageUrls = await collectWorldImageUrls(ctx, instructionRaw)
  const videoUrl = (await collectWorldVideoUrls(ctx))[0]?.trim() ?? ''

  // 无 API 时的透传行为
  if (!ctx.generateSpatialWorld) {
    // 有上游图片则透传
    if (imageUrls.length > 0) {
      return dualImageGalleryOutputs(
        imageUrls.map((url, i) => ({
          id: `passthrough:${i}`,
          dataUrl: url,
          relativePath: ''
        })),
        imageUrls[0] ?? ''
      )
    }
    // 有上游文本则输出文本
    if (incomingText || instructionRaw.trim()) {
      return {
        out: {
          kind: 'text',
          text:
            [localNotes, incomingText].filter(Boolean).join('\n').trim() || instructionRaw.trim()
        }
      }
    }
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  // 构建提示词
  const instruction = expandInstructionMentions(instructionRaw, mentionSources)
  const prompt = instruction || incomingText || ''

  /**
   * 构建输入引用。上游 world_prompt 四选一（text / image / multi-image / video），一次只能给一种：
   * 视频信息量最大（一段镜头直接给出空间与运动），同时接了视频与图时**以视频为准**——
   * 与 `video.lipSync`「视频优先于图片」同一口径；多图最多 4 张（多视角同场景）。
   * 丢弃图片时不静默：写一行运行日志说明这次用的是视频。
   */
  const inputReferences: Array<{ kind: 'image_url' | 'video_url'; url: string }> = videoUrl
    ? [{ kind: 'video_url', url: videoUrl }]
    : imageUrls
        .slice(0, WORLD_MAX_REFERENCE_IMAGES)
        .map((url) => ({ kind: 'image_url' as const, url }))

  if (videoUrl && imageUrls.length > 0) {
    ctx.log?.(
      `world prompt: using the reference video; ignoring ${imageUrls.length} connected image(s) (the upstream world_prompt accepts only one input kind)`,
      'warn'
    )
  }
  if (imageUrls.length > WORLD_MAX_REFERENCE_IMAGES) {
    ctx.log?.(
      `world prompt: ${imageUrls.length} reference images connected, keeping the first ${WORLD_MAX_REFERENCE_IMAGES}`,
      'warn'
    )
  }

  if (!prompt.trim() && !inputReferences.length) {
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }

  // 调用空间世界生成 API（World Labs Marble，异步 operation 轮询约 5 分钟）
  const result = await ctx.generateSpatialWorld({
    prompt,
    model: node.params.generateModel || undefined,
    providerInstanceId: node.params.generateProviderInstanceId || undefined,
    inputReferences: inputReferences.length > 0 ? inputReferences : undefined,
    seed: resolveWorldSeed(node.params.spatialWorldSeed),
    // 全景判定只在单图形态生效；关闭 recaption 会取消上游自动补写的画面描述
    panoMode: resolveWorldPanoMode(node.params.spatialWorldPanoMode),
    disableRecaption: node.params.spatialWorldDisableRecaption === true,
    displayName: node.title?.trim() || undefined,
    name: node.title,
    graphBinding: {
      nodeId: node.id,
      assetId: ctx.resolveHostAssetId?.()
    }
  })

  // Marble 产物为世界网格 GLB，按模型资产登记（与 3D 模型生成同口径）
  const spatialWorldId = result.spatialWorldId?.trim() || undefined
  const out = persistModelGeneration(
    ctx,
    {
      relativePath: result.relativePath,
      assetId: result.assetId,
      // 世界 id 随模型值往下传：下游「空间世界导出」节点只认它
      ...(spatialWorldId ? { spatialWorldId } : {})
    },
    {
      kind: 'asset',
      assetId: result.assetId,
      assetType: 'model',
      relativePath: result.relativePath,
      label: node.params.label,
      weight: node.params.weight,
      notes: localNotes,
      title: node.title,
      ...(spatialWorldId ? { spatialWorldId } : {})
    }
  )

  // 附加产物（高斯泼溅 SPZ / 360 全景图）随世界一起返回并落盘在主产物旁边：
  // 写回节点参数（Inspector 列路径）并各记一行运行日志 —— 这两份是导入引擎时真正要用的文件
  const extras = (result.extras ?? [])
    .filter((item) => item.relativePath?.trim())
    .map((item) => ({
      kind: item.kind,
      relativePath: item.relativePath!.trim(),
      // 泼溅会登记为模型资产（导演台可直接拿它做泼溅渲染）：记下 id，
      // 下游不必再按路径反查，保存到资产库时也知道该带上哪一份
      ...(item.assetId?.trim() ? { assetId: item.assetId.trim() } : {})
    }))
  if (extras.length) {
    ctx.node.params = { ...ctx.node.params, spatialWorldExtras: extras }
    ctx.patchNode?.({ params: { spatialWorldExtras: extras } })
    for (const item of extras) {
      ctx.log?.(
        `world output: ${WORLD_EXTRA_LABELS[item.kind] ?? item.kind} -> ${item.relativePath}`
      )
    }
  }

  return out
}

/** 附加产物的日志/展示名（未收录的 kind 直接显示原值） */
const WORLD_EXTRA_LABELS: Record<string, string> = {
  splats: 'gaussian splats (SPZ)',
  pano: '360 panorama (PNG)'
}
