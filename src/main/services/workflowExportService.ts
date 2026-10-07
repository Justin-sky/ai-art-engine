/**
 * 「导出为市场工作流」的主进程侧。
 *
 * 链路：读工程里的图（与 MCP `graph_read` 同一个访问器）→ `documentToPlanReport`
 * → `buildMarketWorkflowBundle` → 选市场仓库目录 → 写 `workflows/<id>/{workflow.json, cover.png}`。
 *
 * ## 为什么图不由渲染层传上来
 *
 * 「导出的是不是用户眼前那张图」只允许有一处口径。渲染层负责在调用前落盘（编辑器暴露的
 * `flushSave`），主进程按 `assetId` 读**落盘图** —— 与 MCP 那套（`graph_read` / `task_run`）
 * 完全一致，因此不会出现「界面上一张图、导出的另一张图」。
 *
 * ## 为什么每一步都拒绝得这么细
 *
 * 产物是要提交进公开仓库、过 CI 校验的**发布物**。目录选错一层、封面不是 PNG、id 与官方
 * 那 15 条撞名、同名目录已存在，这些都是贡献流程里的家常事；每一条都在写盘**之前**拒掉并给出
 * 可翻译的原因（`reasonKey`），比写完再让用户去 CI 日志里找错要省事得多。
 *
 * ## 主进程不产出成品文案
 *
 * 所有给用户看的话都由渲染层按 `reasonKey` 出（两套 locale）；这里只返回键与插值参数。
 *
 * ## `requires.appMinVersion` 写成导出时的应用版本
 *
 * 计划是用**本版本**的节点类型与参数声明生成的（旧版应用可能缺其中某些），因此把它作为最低
 * 版本声明出去 —— 这与官方那 15 条的做法一致。市场校验器不校验该字段，但客户端会据此在安装
 * 前拦下「版本太旧」的用户。
 */

import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { listNodeTypes, type GraphDocument } from '@shared/graph'
import type { ExportWorkflowToMarketInput, ExportWorkflowToMarketResult } from '@shared/ipc'
import {
  WORKFLOW_EXPORT_COVER_FILE_NAME,
  WORKFLOW_EXPORT_COVER_SIZE,
  WORKFLOW_EXPORT_LIMITS,
  WorkflowExportUnknownTypesError,
  buildMarketWorkflowBundle,
  documentToPlanReport,
  normalizeWorkflowExportMeta,
  readPngSize,
  serializeWorkflowJson,
  type WorkflowExportNote
} from '@shared/workflowExport'
import { dialogService } from './dialogService'
import { projectService } from './projectService'
import { updateService } from './updateService'

/** 失败返回：原因 + 已有提示（成功路径单独构造） */
function fail(
  reasonKey: string,
  params?: Record<string, string | number>,
  warnings: WorkflowExportNote[] = []
): ExportWorkflowToMarketResult {
  return {
    ok: false,
    warnings,
    nextSteps: [],
    reasonKey,
    ...(params ? { reasonParams: params } : {})
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/** 目标必须落在所选目录内（id 已过 kebab 校验，这里是第二道闸） */
function isInside(root: string, target: string): boolean {
  return target === root || target.startsWith(root + sep)
}

/** 读工程里的图文档：与 MCP `graph_read` 同一个访问器（listAssets + genParams.graphJson） */
function readAssetGraph(assetId: string): { name: string; doc: GraphDocument } | null {
  const asset = projectService.listAssets().find((item) => item.id === assetId)
  const graphJson = (asset?.genParams as Record<string, unknown> | undefined)?.graphJson as
    GraphDocument | undefined
  if (!asset || !graphJson || !Array.isArray(graphJson.nodes)) return null
  return { name: asset.name?.trim() ?? '', doc: graphJson }
}

/** 上次成功导出用过的仓库目录：派生状态，不进用户设置（与市场那侧记住生效源同理） */
function lastRepoFile(): string {
  return join(app.getPath('userData'), 'workflow-export', 'last-repo.json')
}

function readLastRepoDir(): string | undefined {
  try {
    const raw = JSON.parse(readFileSync(lastRepoFile(), 'utf8')) as { dir?: unknown }
    const dir = typeof raw.dir === 'string' ? raw.dir.trim() : ''
    return dir && isDirectory(dir) ? dir : undefined
  } catch {
    return undefined
  }
}

function rememberRepoDir(dir: string): void {
  try {
    const file = lastRepoFile()
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, `${JSON.stringify({ dir }, null, 2)}\n`, 'utf8')
  } catch {
    // 记住偏好失败不该影响已经写好的导出结果
  }
}

type CoverResult =
  | { ok: true; bytes: Buffer }
  | { ok: false; reasonKey: string; params?: Record<string, string | number> }

/**
 * 读封面图。
 *
 * **必填且必须是 PNG**：市场校验器要求包内存在 `cover.png`（缺图直接判「缺少封面」），
 * 而落进包里的文件名是固定的 —— 收一张 JPEG 却叫 cover.png 只会制造一个名不副实的文件。
 */
function readCover(coverPath: string | undefined): CoverResult {
  const target = (coverPath ?? '').trim()
  if (!target) return { ok: false, reasonKey: 'coverRequired' }
  if (extname(target).toLowerCase() !== '.png') return { ok: false, reasonKey: 'coverNotPng' }
  let stat
  try {
    stat = statSync(target)
  } catch {
    return { ok: false, reasonKey: 'coverNotFound' }
  }
  if (!stat.isFile()) return { ok: false, reasonKey: 'coverNotFound' }
  if (stat.size > WORKFLOW_EXPORT_LIMITS.coverMaxBytes) {
    return {
      ok: false,
      reasonKey: 'coverTooLarge',
      params: { maxKb: Math.round(WORKFLOW_EXPORT_LIMITS.coverMaxBytes / 1024) }
    }
  }
  try {
    return { ok: true, bytes: readFileSync(target) }
  } catch {
    return { ok: false, reasonKey: 'coverNotFound' }
  }
}

/** 封面尺寸建议（800×450）：校验器只查存在与体积，所以这里只提示不拦 */
function coverWarnings(bytes: Buffer): WorkflowExportNote[] {
  const size = readPngSize(bytes)
  if (!size) return []
  if (
    size.width === WORKFLOW_EXPORT_COVER_SIZE.width &&
    size.height === WORKFLOW_EXPORT_COVER_SIZE.height
  ) {
    return []
  }
  return [
    {
      reasonKey: 'coverSize',
      params: {
        width: size.width,
        height: size.height,
        suggested: `${WORKFLOW_EXPORT_COVER_SIZE.width}x${WORKFLOW_EXPORT_COVER_SIZE.height}`
      }
    }
  ]
}

export async function exportWorkflowToMarket(
  input: ExportWorkflowToMarketInput
): Promise<ExportWorkflowToMarketResult> {
  if (!projectService.isOpen()) return fail('projectNotOpen')

  const metaResult = normalizeWorkflowExportMeta(input?.meta)
  if (!metaResult.ok) return fail(metaResult.reasonKey, metaResult.params)
  const meta = metaResult.meta

  const assetId = (input?.assetId ?? '').trim()
  const graph = assetId ? readAssetGraph(assetId) : null
  if (!graph) return fail('assetNotFound')

  const report = documentToPlanReport(graph.doc, { title: graph.name })
  if (!report.plan.nodes.length) return fail('emptyPlan', undefined, report.warnings)

  let bundle
  try {
    bundle = buildMarketWorkflowBundle({
      meta,
      plan: report.plan,
      // 注册表是本版本认识的全部节点类型；plan 里出现别的类型说明导出链路出了问题
      nodeTypes: listNodeTypes().map((def) => def.typeId),
      appMinVersion: updateService.getCurrentVersion()
    })
  } catch (err) {
    if (err instanceof WorkflowExportUnknownTypesError) {
      return fail('unknownNodeTypes', { typeIds: err.typeIds.join(', ') }, report.warnings)
    }
    throw err
  }

  const cover = readCover(input?.coverPath)
  if (!cover.ok) return fail(cover.reasonKey, cover.params, report.warnings)

  const picked = await dialogService.selectDirectory({
    title: input?.directoryTitle,
    defaultPath: readLastRepoDir()
  })
  // 用户按了取消：不是错误，界面据此静默回到表单
  if (!picked) return fail('canceled', undefined, report.warnings)

  const repoRoot = resolve(picked)
  const workflowsRoot = join(repoRoot, 'workflows')
  if (!isDirectory(workflowsRoot)) {
    return fail('repoMissing', { dir: repoRoot }, report.warnings)
  }
  const targetDir = join(workflowsRoot, meta.id)
  if (!isInside(repoRoot, targetDir) || !isInside(workflowsRoot, targetDir)) {
    return fail('unsafeTarget', { dir: repoRoot }, report.warnings)
  }
  if (existsSync(targetDir) && input?.overwrite !== true) {
    return fail('targetExists', { dir: targetDir }, report.warnings)
  }

  mkdirSync(targetDir, { recursive: true })
  writeFileSync(join(targetDir, 'workflow.json'), serializeWorkflowJson(bundle), 'utf8')
  writeFileSync(join(targetDir, WORKFLOW_EXPORT_COVER_FILE_NAME), cover.bytes)
  rememberRepoDir(repoRoot)

  return {
    ok: true,
    dir: targetDir,
    warnings: [...report.warnings, ...coverWarnings(cover.bytes)],
    nextSteps: [
      // 索引里的派生字段（requires / nodeCount / skill 清单）由仓库脚本从磁盘生成，
      // 不跑 build-index 直接 validate 会因为「索引与磁盘不一致」被拒。
      { reasonKey: 'rebuildIndex', params: { dir: repoRoot } },
      { reasonKey: 'commit', params: { id: meta.id } }
    ]
  }
}
