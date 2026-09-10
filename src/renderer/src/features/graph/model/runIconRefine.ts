/**
 * 单枚「精修回炉」执行器（渲染层）：dive 编辑弹窗与 MCP graph_icon_refine 共用同一口径。
 *
 * - 上下文 / 生图指令：shared/graph/iconRefine（纯逻辑，含「这一枚」的名字与画风主题）；
 * - 整版源图解析：resolveNodeUpstreamImageUrl（与编辑弹窗源图逻辑对齐，上游优先）；
 * - 单格裁切：composeImageGridCell（与打包 / 预览同一 canvas 口径，edgeInset: 'auto'）；
 * - 生成模型 / 服务：克隆上游整版节点参数，保证与整版画风一致；
 * - 写回：withIconPackCellRefine（并入同源打包节点的逐枚覆盖，其余格位不动）。
 *
 * 本模块只负责「算 + 生成 + 写回后的文档」，落盘 / 重跑打包由调用方决定：
 * 弹窗走 graphEditorHosts.updateNode + graphRunHosts.toggleNodeRun，
 * MCP 走 persistAssetRecord + 任务商店重跑 iconPack 节点。
 */
import {
  buildIconRefineInstruction,
  readIconPackRefinesFromNode,
  readImageGridSplitFromNode,
  resolveIconRefineContext,
  withIconPackCellRefine,
  type GraphDocument,
  type IconPackCellRefines
} from '@shared/graph'
import type { AssetInfo } from '@shared/domain'
import { composeImageGridCell } from './composeImageGridCell'
import { resolveNodeUpstreamImageUrl } from './resolveNodeUpstreamImageUrl'

/**
 * 精修失败原因码：只码不带文案，由调用方按语境映射
 * （弹窗走 i18n，MCP 给外部 Agent 中文提示，两者各自维护措辞）。
 */
export type IconRefineFailureCode = 'unresolved' | 'no-pack' | 'no-source' | 'no-result'

export class IconRefineError extends Error {
  readonly code: IconRefineFailureCode

  constructor(code: IconRefineFailureCode) {
    super(code)
    this.name = 'IconRefineError'
    this.code = code
  }
}

export interface IconRefineRunInput {
  /** 图文档：弹窗传实时文档，MCP 传落盘文档 */
  document: GraphDocument
  /** image.gridSplit 节点 id */
  splitNodeId: string
  /** 格位 key，如 1-1 / 2-3 */
  cellKey: string
  hint?: string
  /** 完整生图指令；给出时忽略 hint 与默认指令 */
  prompt?: string
  locale?: 'zh' | 'en'
  /** 已裁好的单格参考图（弹窗为预览裁过一次，直接复用）；缺省时按整版源图现裁 */
  referenceDataUrl?: string
  /** 整版源图（可绘制 URL）；缺省时按上游解析 */
  sourceDataUrl?: string
  /** 上游解析所需的工程资产表（MCP 从工程 store 取） */
  assets?: AssetInfo[]
}

export interface IconRefineRunResult {
  cellKey: string
  /** 该枚在打包名单里的名字；解析不到时为 null */
  name: string | null
  packNodeId: string
  /** 实际使用的生图指令 */
  prompt: string
  /** 精修后的单枚方形卡片图 dataURL */
  dataUrl: string
  /** 已并入本格覆盖的回炉覆盖表（弹窗按节点补丁写回） */
  cellRefines: IconPackCellRefines
  /** 已并入本格覆盖的图文档（MCP 落盘用） */
  document: GraphDocument
}

/** 解析单格参考图：优先用调用方已裁好的图，否则取整版源图现裁 */
async function resolveReference(input: IconRefineRunInput): Promise<string> {
  const direct = input.referenceDataUrl?.trim()
  if (direct) return direct

  const source =
    input.sourceDataUrl?.trim() ||
    (await resolveNodeUpstreamImageUrl({
      document: input.document,
      nodeId: input.splitNodeId,
      runStates: input.document.runStates,
      assets: input.assets ?? []
    }))
  if (!source) throw new IconRefineError('no-source')

  const split = input.document.nodes.find((node) => node.id === input.splitNodeId)
  const crop = await composeImageGridCell({
    sourceDataUrl: source,
    state: readImageGridSplitFromNode(split?.params ?? {}),
    cellKey: input.cellKey,
    edgeInset: 'auto'
  })
  const dataUrl = String(crop?.dataUrl ?? '').trim()
  // 裁不出图（源图不可绘制 / 画布污染）等价于拿不到源图，不给模型退化成「无参考纯文生图」
  if (!dataUrl.startsWith('data:image/')) throw new IconRefineError('no-source')
  return dataUrl
}

/** 从上游整版节点克隆生成模型 / 服务实例（与整版画风一致） */
function resolveModelClone(document: GraphDocument, sheetNodeId?: string): {
  model?: string
  providerInstanceId?: string
} {
  const sheet = sheetNodeId ? document.nodes.find((node) => node.id === sheetNodeId) : undefined
  const params = (sheet?.params ?? {}) as Record<string, unknown>
  const model = typeof params.generateModel === 'string' ? params.generateModel.trim() : ''
  const provider =
    typeof params.generateProviderInstanceId === 'string'
      ? params.generateProviderInstanceId.trim()
      : ''
  return {
    ...(model ? { model } : {}),
    ...(provider ? { providerInstanceId: provider } : {})
  }
}

/**
 * 重画单枚并写回同源打包节点的逐枚覆盖。
 * 生成服务 / 供应商错误原样抛出（保留原始报错文案）；可定位性问题抛 IconRefineError。
 */
export async function runIconRefine(input: IconRefineRunInput): Promise<IconRefineRunResult> {
  const ctx = resolveIconRefineContext(input.document, input.splitNodeId, input.cellKey)
  if (!ctx) throw new IconRefineError('unresolved')
  if (!ctx.pack) throw new IconRefineError('no-pack')

  const reference = await resolveReference(input)
  const prompt =
    input.prompt?.trim() ||
    buildIconRefineInstruction(ctx, { locale: input.locale ?? 'zh', hint: input.hint })
  const clone = resolveModelClone(input.document, ctx.sheetNodeId)

  const res = await window.studio.generateImage({
    prompt,
    ...clone,
    aspectRatio: '1:1',
    quality: 'high',
    n: 1,
    inputReferences: [reference]
  })
  const dataUrl = String(res?.images?.[0] ?? '').trim()
  if (!dataUrl.startsWith('data:image/')) throw new IconRefineError('no-result')

  const document = withIconPackCellRefine(input.document, {
    packNodeId: ctx.pack.nodeId,
    cellKey: ctx.cellKey,
    dataUrl,
    updatedAt: new Date().toISOString()
  })
  const packNode = document.nodes.find((node) => node.id === ctx.pack!.nodeId)

  return {
    cellKey: ctx.cellKey,
    name: ctx.name,
    packNodeId: ctx.pack.nodeId,
    prompt,
    dataUrl,
    cellRefines: readIconPackRefinesFromNode(packNode?.params ?? {}),
    document
  }
}
