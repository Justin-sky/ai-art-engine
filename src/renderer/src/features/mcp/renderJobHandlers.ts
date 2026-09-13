/**
 * MCP「渲染层能力作业」执行入口。
 *
 * 有些工具只能跑在渲染层（要 canvas / 图片解码 / 界面上下文）：Spine 骨架包导出、
 * UI 部件提取。主进程经 `MCP_RENDER_JOB` 按 `kind` 派发，这里分派执行并回报结果。
 *
 * 与 `mcpTaskRunner` 的分工：那边是「跑工作流 / 改图」这类要长期占用工程状态的任务
 * （受理 + 终态两段回报），这边是「读图 → 本地像素处理 → 落盘」的一次性作业。
 * 两者错误口径一致：把可读原因原样回传给 Agent，不吞异常。
 */
import type { GraphDocument } from '@shared/graph'
import {
  contentEndSecOfTimeline,
  normalizeStage2dScene,
  readStage2dPoseFromNode,
  readStage2dRigFromNode,
  withScriptTimeline,
  type ScriptTimelineDocument
} from '@shared/graph'
import {
  UI_KIT_PART_KINDS,
  UI_KIT_PART_KIND_PREFIXES,
  analyzeAssetQc,
  applyAssetQcFringeFix,
  buildUiKitManifest,
  checkAssetQcNaming,
  normalizeUiKitDocument,
  suggestAssetQcName,
  summarizeAssetQc,
  type AssetQcIssue,
  type AssetQcMetrics
} from '@shared/gameAssets'
import { isUnderAssetLibraryDir, normalizeProjectRelativeDir, type AssetInfo } from '@shared/domain'
import type { McpRenderJobKind, McpRenderJobPayload } from '@shared/ipc'
import { persistAssetRecord } from '../../composables/useAssetRecord'
import { useProjectStore } from '../../stores/project'
import { composeStage2dSpineExport } from '../graph/model/composeStage2dSpineExport'
import { resolveAssetPreviewUrl } from '../media/assetUrlCache'
import { cropUiKitPartPng, loadUiKitSourceImage } from '../uiKit/uiKitRender'
import { isGraphEditorOpen } from './openGraphEditors'
import { isTimelineEditorOpen } from './openTimelineEditors'

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** 把工程相对路径解析成可绘制 URL（与 2D 舞台编辑器 render 同一口径） */
async function resolveLayerUrl(sourceUrl: string): Promise<string> {
  const raw = sourceUrl.trim()
  if (!raw) return ''
  if (/^(data:|https?:\/\/|blob:)/i.test(raw)) return raw
  try {
    return await resolveAssetPreviewUrl(raw)
  } catch {
    return ''
  }
}

/**
 * 部件输出目录必须落在资产库（`Assets/`）内。
 *
 * 部件是「给人用的素材」：主进程只在落盘目录属于资产库时写旁挂 `.asset.json` 登记，
 * 库外目录只会静静落盘、素材库扫不到。Agent 传 `outputDir` 时各种写法都收（前导斜杠、
 * 反斜杠、尾斜杠统一归一），归一后仍不在库内就拒绝并说明用法，别退回静默半成功。
 */
function resolveLibraryOutDir(dir: string, fallback: string): string {
  const posix = normalizeProjectRelativeDir(dir)
  if (!posix) return fallback
  if (!isUnderAssetLibraryDir(posix)) {
    throw new Error(`outputDir 必须落在资产库内（以 Assets/ 开头）：${dir}；默认目录为 ${fallback}`)
  }
  return posix
}

/** 素材库可刷新 + 可枚举的宿主（用于落盘后复查部件是否真的入库） */
interface LibraryHost {
  assets: AssetInfo[]
  scheduleRefreshLibrary(delayMs?: number): Promise<void>
}

/**
 * 落盘后复查部件确实进了素材库。
 *
 * `saveGraphRunMedia` 只回相对路径、登记与否由主进程按目录判定，一旦判定口径出岔
 * （库外目录 / 被缓存根覆盖），作业会「文件写好了但素材库里没有」静默半成功——
 * 这里显式复查并报错，把原因交回 Agent / 用户。
 */
async function assertPartsImported(
  project: LibraryHost,
  savedPaths: string[],
  dir: string
): Promise<void> {
  await project.scheduleRefreshLibrary()
  const missing = savedPaths.filter(
    (rel) => !project.assets.some((asset) => asset.relativePath === rel)
  )
  if (missing.length) {
    throw new Error(
      `部件已落盘但没进素材库（${dir}）：${missing.join('、')}；请确认输出目录在资产库内且未被工程缓存根目录覆盖`
    )
  }
}

/**
 * Spine 骨架包导出：读宿主资产图里 stage.2d 节点的落盘装配（rig / pose / 舞台），
 * 把挂到关节的部件层按放置计划裁成独立透明 PNG 页，连同 skeleton.json + .atlas
 * 落 `Assets/2D/Spine/<包名>/`。
 *
 * 图编辑器打开时拒绝：编辑器里可能有未落盘的装配与摆姿，导出会与用户所见不一致
 * （与 graph_edit / graph_icon_refine 同一保护口径）。
 */
async function handleStage2dSpineExport(args: Record<string, unknown>): Promise<unknown> {
  const project = useProjectStore()
  const assetId = readString(args.assetId).trim()
  const asset = project.assets.find((item) => item.id === assetId)
  if (!asset) throw new Error(`资产不存在：${assetId}`)
  const graphJson = (asset.genParams as Record<string, unknown> | undefined)?.graphJson as
    GraphDocument | undefined
  if (!graphJson || !Array.isArray(graphJson.nodes)) {
    throw new Error('资产不含图文档（stage2d_spine_export 仅支持宿主资产子图）')
  }
  if (isGraphEditorOpen(assetId)) {
    throw new Error(
      '该资产的图编辑器正在界面中打开：编辑器里可能有未落盘的骨骼装配 / 摆姿，请先关闭编辑器再导出'
    )
  }

  const stageNodes = graphJson.nodes.filter((node) => node.typeId === 'stage.2d')
  if (!stageNodes.length) throw new Error('该资产图里没有 stage.2d「2D 舞台」节点')
  const nodeId = readString(args.nodeId).trim()
  const node = nodeId ? stageNodes.find((item) => item.id === nodeId) : stageNodes[0]
  if (!node) {
    throw new Error(
      `未找到节点 ${nodeId}（该图的 2D 舞台节点：${stageNodes.map((item) => item.id).join(', ')}）`
    )
  }

  const params = node.params ?? {}
  const rig = readStage2dRigFromNode(params)
  if (!rig.joints.length || !rig.attachments.length) {
    throw new Error(
      '该 2D 舞台还没有骨骼装配：请先在编辑器里加关节、把部件层挂到关节上，再导出骨架包'
    )
  }

  const result = await composeStage2dSpineExport({
    state: normalizeStage2dScene(params.stage2dScene),
    rig,
    pose: readStage2dPoseFromNode(params, rig),
    resolveLayerUrl,
    baseName: readString(args.baseName).trim() || 'skeleton'
  })
  if (!result || !result.files.length) {
    throw new Error('没有可导出的部件：需要把可见部件层挂到关节上（挂点层），平面几何才成立')
  }

  const dir = resolveLibraryOutDir(`Assets/2D/Spine/${result.skeletonName}`, 'Assets/2D/Spine')
  const files: string[] = []
  for (const file of result.files) {
    const saved = await window.studio.saveGraphRunMedia({
      dataUrl: file.dataUrl,
      key: file.fileName.replace(/\.png$/i, ''),
      outputDir: dir
    })
    files.push(saved)
  }
  const skeletonPath = `${dir}/${result.skeletonName}.json`
  const atlasPath = `${dir}/${result.skeletonName}.atlas`
  await window.studio.writeProjectFile({ relativePath: skeletonPath, content: result.jsonText })
  await window.studio.writeProjectFile({ relativePath: atlasPath, content: result.atlasText })
  await assertPartsImported(project, files, dir)

  return {
    assetId,
    nodeId: node.id,
    skeletonName: result.skeletonName,
    dir,
    skeletonPath,
    atlasPath,
    partCount: files.length,
    files
  }
}

/**
 * UI 部件提取：把整屏 UI 图按给定的框选矩形逐部件裁成透明 PNG 落资产库
 * （`Assets/UIKits/<源图名>/`），并同目录写出 `ui-kit.json` 九宫格清单。
 *
 * 入参部件是宽松 JSON（kind / name / rect / border / safe），归一化与命名规范
 * 全走共享层 `normalizeUiKitDocument`——非法部件被剔除并在返回值里报数量。
 */
async function handleUiKitExtract(args: Record<string, unknown>): Promise<unknown> {
  const project = useProjectStore()
  const assetId = readString(args.assetId).trim()
  const asset = project.assets.find((item) => item.id === assetId)
  if (!asset) throw new Error(`资产不存在：${assetId}`)
  if (asset.type !== 'image') throw new Error('ui_kit_extract 只支持图片资产（整屏 UI 效果图）')
  const relativePath = asset.relativePath.trim()
  if (!relativePath) throw new Error('该资产还没有媒体文件（占位资产无法提取部件）')

  const rawParts = Array.isArray(args.parts) ? args.parts : []
  if (!rawParts.length) {
    throw new Error('请给出至少一个部件（parts：kind / name / rect，可选 border / safe）')
  }

  const img = await loadUiKitSourceImage(await resolveAssetPreviewUrl(relativePath))
  const width = img.naturalWidth || img.width
  const height = img.naturalHeight || img.height
  const doc = normalizeUiKitDocument({ parts: rawParts }, { name: asset.name, width, height })
  if (!doc.parts.length) {
    throw new Error(
      `没有合法部件：kind 需为 ${UI_KIT_PART_KINDS.join(' / ')}，rect 需为源图内的有限像素矩形`
    )
  }

  const outDir = resolveLibraryOutDir(readString(args.outputDir), `Assets/UIKits/${doc.sourceName}`)

  const saved: string[] = []
  for (const part of doc.parts) {
    const dataUrl = cropUiKitPartPng(img, part)
    saved.push(
      await window.studio.saveGraphRunMedia({
        dataUrl,
        key: `${UI_KIT_PART_KIND_PREFIXES[part.kind]}-${part.name}`,
        outputDir: outDir
      })
    )
  }

  const manifest = buildUiKitManifest({
    sourceName: doc.sourceName,
    sourceWidth: doc.sourceWidth,
    sourceHeight: doc.sourceHeight,
    parts: doc.parts
  })
  // 让清单 fileName 与实际落盘文件一致（同名二次导出时 uniqueFileName 会追加序号）
  for (let i = 0; i < manifest.parts.length; i += 1) {
    const rel = saved[i]
    const fileName = rel ? rel.slice(rel.lastIndexOf('/') + 1) : ''
    if (fileName) manifest.parts[i]!.fileName = fileName
  }
  const manifestPath = `${outDir}/ui-kit.json`
  await window.studio.writeProjectFile({
    relativePath: manifestPath,
    content: JSON.stringify(manifest, null, 2)
  })
  await assertPartsImported(project, saved, outDir)

  return {
    assetId,
    dir: outDir,
    manifestPath,
    count: saved.length,
    /** 被归一化剔除的部件数（rect 越界 / kind 非法 / 尺寸为 0） */
    skipped: rawParts.length - doc.parts.length,
    parts: manifest.parts.map((part, index) => ({
      kind: part.kind,
      name: part.name,
      fileName: part.fileName,
      path: saved[index] ?? ''
    }))
  }
}

/** 单次体检的资产数上限（每个都要解码整图，避免一次调用把界面卡住） */
const ASSET_QC_MAX_ASSETS = 40

/** 解码图片为像素数据（质检要逐像素读，不是画到界面上） */
async function loadAssetImageData(url: string): Promise<ImageData> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image()
    el.crossOrigin = 'anonymous'
    el.onload = () => resolve(el)
    el.onerror = () => reject(new Error('图片解码失败（媒体文件可能已丢失或格式不支持）'))
    el.src = url
  })
  const width = img.naturalWidth || img.width
  const height = img.naturalHeight || img.height
  if (!width || !height) throw new Error('图片尺寸非法')
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d context unavailable')
  ctx.drawImage(img, 0, 0)
  return ctx.getImageData(0, 0, width, height)
}

function imageDataToPngDataUrl(image: ImageData): string {
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d context unavailable')
  ctx.putImageData(image, 0, 0)
  return canvas.toDataURL('image/png')
}

interface AssetQcOptions {
  /** 是否对可修项（当前只有边缘去污染）执行返工并落盘新资产 */
  fix: boolean
  /** 是否附带命名规范检查（默认关：存量中文名不该被刷屏） */
  naming: boolean
}

/** 单张资产的体检（+ 可选返工），返回结构化结果；文案由工具层拼 */
async function runAssetQcOnAsset(
  asset: { id: string; name: string; relativePath: string },
  options: AssetQcOptions
): Promise<Record<string, unknown>> {
  const relativePath = asset.relativePath.trim()
  const url = await resolveLayerUrl(relativePath)
  if (!url) throw new Error('无法解析媒体文件 URL')
  const image = await loadAssetImageData(url)
  const input = { data: image.data, width: image.width, height: image.height }
  const report = analyzeAssetQc(input)
  const issues: AssetQcIssue[] = [...report.issues]
  if (options.naming) {
    const namingIssue = checkAssetQcNaming(asset.name)
    if (namingIssue) issues.push(namingIssue)
  }

  const item: Record<string, unknown> = {
    assetId: asset.id,
    name: asset.name,
    path: relativePath,
    width: image.width,
    height: image.height,
    issues,
    metrics: report.metrics
  }
  if (issues.some((issue) => issue.code === 'naming')) {
    item.suggestedName = suggestAssetQcName(asset.name)
  }

  const fixable = report.issues.filter((issue) => issue.fixable)
  if (!options.fix) return item
  if (!fixable.length) {
    item.fixSkipped = 'no-fixable-issue'
    return item
  }

  applyAssetQcFringeFix(input)
  const after = analyzeAssetQc(input)
  const saved = await window.studio.saveGraphRunMedia({
    dataUrl: imageDataToPngDataUrl(image),
    key: `${asset.name}-qc`,
    outputDir: `Assets/QC/${asset.name}`
  })
  item.fixed = {
    path: saved,
    resolved: fixable.map((issue) => issue.code),
    issues: after.issues,
    metrics: after.metrics
  }
  return item
}

/**
 * 资产规范质检（+ 安全返工）：读图片像素跑共享层判定，报「抠图漏底 / 边缘白边 /
 * 半透明碎屑 / 主体贴边 / 空图 / 超大尺寸 / 命名」。
 *
 * 返工只做安全项：边缘去污染（复用 yoloCutout 的 defringeRgba）产出**新资产**
 * 落 `Assets/QC/<原名>/`，不覆盖原件——原件保留可回溯，下游引用也不受影响。
 * 孔洞 / 贴边 / 命名只报告：镂空可能是刻意设计，改画布与改名都会动到下游。
 */
async function handleAssetQc(args: Record<string, unknown>): Promise<unknown> {
  const project = useProjectStore()
  const options: AssetQcOptions = { fix: args.fix === true, naming: args.naming === true }
  const single = readString(args.assetId).trim()
  const rawList = Array.isArray(args.assetIds) ? args.assetIds : []
  const ids = single
    ? [single]
    : [...new Set(rawList.map((value) => readString(value).trim()).filter(Boolean))]
  if (!ids.length) throw new Error('请给出 assetId 或 assetIds（要体检的图片资产）')

  const limited = ids.slice(0, ASSET_QC_MAX_ASSETS)
  const items: Record<string, unknown>[] = []
  const skipped: { assetId: string; reason: string }[] = []
  for (const id of limited) {
    const asset = project.assets.find((entry) => entry.id === id)
    if (!asset) {
      skipped.push({ assetId: id, reason: 'not-found' })
      continue
    }
    if (asset.type !== 'image') {
      skipped.push({ assetId: id, reason: 'not-image' })
      continue
    }
    if (!asset.relativePath.trim()) {
      skipped.push({ assetId: id, reason: 'no-media-file' })
      continue
    }
    try {
      items.push(
        await runAssetQcOnAsset(
          { id: asset.id, name: asset.name, relativePath: asset.relativePath },
          options
        )
      )
    } catch (err) {
      skipped.push({ assetId: id, reason: err instanceof Error ? err.message : String(err) })
    }
  }
  if (options.fix && items.length) await project.scheduleRefreshLibrary()

  const summary = summarizeAssetQc(
    items.map((item) => ({
      issues: item.issues as AssetQcIssue[],
      metrics: item.metrics as AssetQcMetrics
    }))
  )
  return {
    count: items.length,
    requested: ids.length,
    truncated: ids.length > limited.length,
    summary,
    items,
    skipped
  }
}

/**
 * 时间线文档写入：Agent 侧（智能粗剪 / 重排）算完新片段后，由这里落回剧本资产。
 *
 * 时间线编辑器打开时拒绝：编辑器内存态与它的自动保存会把远端写入覆盖掉
 * （与 graph_edit / stage2d_spine_export 同一保护口径）。
 */
async function handleTimelineDocumentApply(args: Record<string, unknown>): Promise<unknown> {
  const project = useProjectStore()
  const assetId = readString(args.assetId).trim()
  if (!assetId) throw new Error('缺少 assetId')
  const document = args.document as ScriptTimelineDocument | undefined
  if (!document || !Array.isArray(document.clips)) {
    throw new Error('缺少时间线文档 document（需含 clips 数组）')
  }
  const asset = project.assets.find((item) => item.id === assetId)
  if (!asset) throw new Error(`资产不存在：${assetId}`)
  if (isTimelineEditorOpen(assetId)) {
    throw new Error(
      '该剧本的时间线编辑器正在界面中打开：编辑器里可能有未落盘的剪辑，请先关闭时间线再让 Agent 重排'
    )
  }
  const nodeId = readString(args.nodeId).trim()
  const genParams = withScriptTimeline(
    asset.genParams as Record<string, unknown> | undefined,
    document,
    nodeId || undefined
  )
  await persistAssetRecord(assetId, { genParams })
  await project.scheduleRefreshLibrary()
  return {
    assetId,
    clipCount: document.clips.length,
    durationSec: contentEndSecOfTimeline(document.clips)
  }
}

/**
 * 作业清单：`Record<McpRenderJobKind, …>` 让「主进程声明的 kind」与「渲染层实现」
 * 在类型层强绑定——新增能力漏写实现会直接编译失败，不会拖到运行时才发现。
 */
const RENDER_JOB_HANDLERS: Record<
  McpRenderJobKind,
  (args: Record<string, unknown>) => Promise<unknown>
> = {
  'stage2d-spine-export': handleStage2dSpineExport,
  'ui-kit-extract': handleUiKitExtract,
  'asset-qc': handleAssetQc,
  'timeline-document-apply': handleTimelineDocumentApply
}

async function handleRenderJob(payload: McpRenderJobPayload): Promise<void> {
  const reply = (ok: boolean, extra: { result?: unknown; error?: string } = {}): void => {
    void window.studio?.reportMcpRenderJob?.({ jobId: payload.jobId, ok, ...extra })
  }
  const handler = RENDER_JOB_HANDLERS[payload.kind]
  if (!handler) {
    reply(false, {
      error: `界面不支持该能力：${String(payload.kind)}（请把应用更新到最新版本）`
    })
    return
  }
  try {
    reply(true, { result: await handler(payload.args ?? {}) })
  } catch (err) {
    reply(false, { error: err instanceof Error ? err.message : String(err) })
  }
}

let registered = false

export function registerMcpRenderJobRunner(): void {
  if (registered) return
  registered = true
  if (typeof window.studio?.onMcpRenderJob !== 'function') return
  window.studio.onMcpRenderJob((payload) => {
    void handleRenderJob(payload)
  })
}
