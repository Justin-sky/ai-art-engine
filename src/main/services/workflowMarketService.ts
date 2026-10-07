/**
 * 工作流市场服务：把远端仓库的目录与工作流接进应用。
 *
 * 传输/缓存/原子落盘都在 `marketPipeline`（通用件）；这里只负责**工作流特有的事**：
 * 格式校验、兼容性判定（依赖的节点类型是否都存在）、安装记账、封面转 data URL。
 *
 * ## 为什么封面要转 data URL
 *
 * 渲染层的内容安全策略是 `img-src 'self' data: file: blob: studio-media:` —— **不允许
 * https 图片直连**。与其放宽 CSP，不如在主进程拉下来转成 data URL（顺带得到磁盘缓存，
 * 断网时封面也还在）。
 *
 * ## 兼容性为什么必须在安装前判定
 *
 * 工作流引用节点类型（`typeId`）。旧版应用拿到引用了新类型的工作流会**物化出残图** ——
 * 用户拿到的东西看着像工作流，其实缺了半边。因此这里把「缺哪些类型」算清楚交给界面拦截，
 * 而不是靠 `materializeGraphPlan` 的 warnings 兜底（那时用户已经点了「使用」）。
 */

import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { listNodeTypes } from '@shared/graph'
import {
  missingNodeTypes,
  parseWorkflowBundle,
  parseWorkflowMarketIndex,
  workflowEntryBlockReason,
  workflowMarketUrls,
  type WorkflowBundle,
  type WorkflowMarketEntry
} from '@shared/workflowMarket'
import { MarketPipeline, sha256OfBytes } from './marketPipeline'
import { settingsService } from './settingsService'
import { updateService } from './updateService'

/** 安装记账条目 */
export interface InstalledWorkflowRecord {
  id: string
  version: string
  installedAt: string
  /** 安装时的源地址：换源后旧记录仍能说明它从哪来 */
  source: string
  /** 安装时的内容哈希，用于判断「已装的是不是当前索引那一份」 */
  contentHash?: string
}

const KIND = 'workflow-market'

/** 缓存根（必须延迟取：app.getPath 在模块加载时未必可用） */
function marketCacheDir(): string {
  return join(app.getPath('userData'), KIND)
}

/** 已安装工作流的目录根 */
export function installedWorkflowsDir(): string {
  return join(app.getPath('userData'), 'workflows')
}

function recordPath(): string {
  return join(installedWorkflowsDir(), 'installed.json')
}

/** 每次调用新建 pipeline 的成本可以忽略（无状态），但缓存按 kind 复用 */
let pipelineInstance: MarketPipeline | null = null

function getPipeline(): MarketPipeline {
  if (!pipelineInstance) {
    pipelineInstance = new MarketPipeline({ kind: KIND, cacheDir: marketCacheDir() })
  }
  return pipelineInstance
}

/** 市场源地址（设置可覆盖；留空用官方仓库） */
export const DEFAULT_WORKFLOW_MARKET_SOURCE =
  'https://raw.githubusercontent.com/Justin-sky/ai-art-engine-workflow/main'

function sourceUrl(): string {
  const configured = settingsService.get().workflowMarket?.source?.trim()
  return configured || DEFAULT_WORKFLOW_MARKET_SOURCE
}

/** 本应用已注册的节点类型（兼容性判定的依据） */
export function knownNodeTypeIds(): string[] {
  return listNodeTypes().map((def) => def.typeId)
}

// ─────────────────────────────────────────────────────────────
// 目录
// ─────────────────────────────────────────────────────────────

export interface WorkflowCatalogView {
  entries: Array<
    WorkflowMarketEntry & {
      /** 本应用缺哪些节点类型（空数组 = 可用） */
      missingNodeTypes: string[]
      /** 不可用原因键（null = 可用） */
      blockReason: string | null
      installedVersion: string | null
      /** 索引版本比已装的新 */
      updatable: boolean
      installed: boolean
    }
  >
  /** 被丢弃的非法条目数（界面提示「N 条被忽略」） */
  dropped: number
  stale: boolean
  cachedAt?: string
  error?: string
}

export async function fetchWorkflowCatalog(input?: {
  force?: boolean
}): Promise<
  { ok: true; catalog: WorkflowCatalogView } | { ok: false; reasonKey: string; error?: string }
> {
  const urls = workflowMarketUrls(sourceUrl())
  const result = await getPipeline().fetchCatalog({
    url: urls.index,
    force: input?.force,
    parse: (raw) => {
      const parsed = parseWorkflowMarketIndex(raw)
      return parsed.ok
        ? { ok: true as const, catalog: { index: parsed.index, dropped: parsed.dropped } }
        : { ok: false as const, reasonKey: parsed.reasonKey }
    }
  })
  if (!result.ok || !result.catalog) {
    return {
      ok: false,
      reasonKey: result.reasonKey ?? 'unknown',
      ...(result.error ? { error: result.error } : {})
    }
  }

  const known = knownNodeTypeIds()
  const appVersion = updateService.getCurrentVersion()
  const installed = listInstalledWorkflows()

  const entries = result.catalog.index.workflows.map((entry) => {
    const record = installed.find((item) => item.id === entry.id)
    const blockReason = workflowEntryBlockReason(entry, {
      knownNodeTypes: known,
      appVersion
    })
    return {
      ...entry,
      missingNodeTypes: missingNodeTypes(entry, known),
      blockReason,
      installedVersion: record?.version ?? null,
      updatable: !!record && !!record.version && record.version !== entry.version,
      installed: !!record
    }
  })

  return {
    ok: true,
    catalog: {
      entries,
      dropped: result.catalog.dropped,
      stale: !!result.stale,
      ...(result.cachedAt ? { cachedAt: result.cachedAt } : {}),
      ...(result.error ? { error: result.error } : {})
    }
  }
}

// ─────────────────────────────────────────────────────────────
// 封面
// ─────────────────────────────────────────────────────────────

/** 封面内存缓存（data URL）：切页签来回看不该反复下载 */
const coverMemo = new Map<string, string>()
const COVER_MEMO_MAX = 64

export async function fetchWorkflowCover(
  id: string
): Promise<{ ok: true; dataUrl: string } | { ok: false; reasonKey: string; error?: string }> {
  const cached = coverMemo.get(id)
  if (cached) return { ok: true, dataUrl: cached }

  const urls = workflowMarketUrls(sourceUrl())
  const local = join(installedWorkflowsDir(), id, 'cover.png')
  try {
    let bytes: Uint8Array
    if (existsSync(local)) {
      // 已安装的优先用本地：断网也能看到封面
      bytes = new Uint8Array(readFileSync(local))
    } else {
      const coverUrl = urls.cover({ id, cover: 'cover.png' })
      if (!coverUrl) return { ok: false, reasonKey: 'cover' }
      bytes = await getPipeline().fetchBinary(coverUrl)
    }
    const dataUrl = `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`
    if (coverMemo.size >= COVER_MEMO_MAX) {
      const oldest = coverMemo.keys().next().value
      if (oldest) coverMemo.delete(oldest)
    }
    coverMemo.set(id, dataUrl)
    return { ok: true, dataUrl }
  } catch (err) {
    return {
      ok: false,
      reasonKey: 'cover',
      error: err instanceof Error ? err.message : String(err)
    }
  }
}

// ─────────────────────────────────────────────────────────────
// 安装 / 卸载 / 记账
// ─────────────────────────────────────────────────────────────

export function listInstalledWorkflows(): InstalledWorkflowRecord[] {
  try {
    if (!existsSync(recordPath())) return []
    const raw = JSON.parse(readFileSync(recordPath(), 'utf8')) as unknown
    if (!Array.isArray(raw)) return []
    const out: InstalledWorkflowRecord[] = []
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue
      const obj = item as Record<string, unknown>
      const id = typeof obj.id === 'string' ? obj.id : ''
      if (!id) continue
      out.push({
        id,
        version: typeof obj.version === 'string' ? obj.version : '',
        installedAt: typeof obj.installedAt === 'string' ? obj.installedAt : '',
        source: typeof obj.source === 'string' ? obj.source : '',
        ...(typeof obj.contentHash === 'string' ? { contentHash: obj.contentHash } : {})
      })
    }
    // 与磁盘对账：目录被手删的记录不该继续显示「已安装」
    const reconciled = out.filter((item) =>
      existsSync(join(installedWorkflowsDir(), item.id, 'workflow.json'))
    )
    if (reconciled.length !== out.length) writeRecords(reconciled)
    return reconciled
  } catch {
    return []
  }
}

function writeRecords(records: InstalledWorkflowRecord[]): void {
  try {
    mkdirSync(installedWorkflowsDir(), { recursive: true })
    writeFileSync(recordPath(), `${JSON.stringify(records, null, 2)}\n`, 'utf8')
  } catch (err) {
    console.warn('[workflowMarket] failed to write install records:', err) // cjk-ok：主进程开发日志
  }
}

/**
 * 安装（或更新）一条工作流。
 *
 * `acceptMissingTypes` 是给「我知道缺类型但先装上」用的逃生门；默认 `false` ——
 * 缺依赖的安装应当被拦在界面层，而不是装进来一个用不了的东西。
 */
export async function installWorkflow(input: {
  id: string
  acceptMissingTypes?: boolean
}): Promise<{ ok: true } | { ok: false; reasonKey: string; error?: string }> {
  const urls = workflowMarketUrls(sourceUrl())
  let bundleRaw: unknown
  try {
    bundleRaw = await getPipeline().fetchJson(urls.bundle(input.id))
  } catch (err) {
    return {
      ok: false,
      reasonKey: 'download',
      error: err instanceof Error ? err.message : String(err)
    }
  }

  const parsed = parseWorkflowBundle(bundleRaw)
  if (!parsed.ok) return { ok: false, reasonKey: parsed.reasonKey }
  const bundle: WorkflowBundle = parsed.bundle
  if (bundle.id !== input.id) {
    // 索引说 A、包里写 B：这是仓库发错了，不能装（否则目录与记录会对不上）
    return { ok: false, reasonKey: 'idMismatch' }
  }

  const known = knownNodeTypeIds()
  const missing = missingNodeTypes(bundle, known)
  if (missing.length > 0 && !input.acceptMissingTypes) {
    return { ok: false, reasonKey: 'missingNodeTypes', error: missing.join(', ') }
  }

  const targetDir = join(installedWorkflowsDir(), bundle.id)
  const installed = await getPipeline().install({
    targetDir,
    files: [
      { path: 'workflow.json', url: urls.bundle(bundle.id) },
      { path: 'cover.png', url: urls.cover({ id: bundle.id, cover: bundle.cover ?? 'cover.png' })! }
    ],
    verify: (files) => {
      const workflowFile = files.find((item) => item.path === 'workflow.json')
      if (!workflowFile) return { ok: false, reasonKey: 'badBundle' }
      // 落到磁盘的内容再校验一次：防止「下载到的东西」与「刚才 parse 的东西」不是同一份
      //（例如中间被网关替换 / 截断）
      try {
        const re = parseWorkflowBundle(JSON.parse(Buffer.from(workflowFile.bytes).toString('utf8')))
        if (!re.ok) return { ok: false, reasonKey: re.reasonKey }
        if (re.bundle.id !== bundle.id) return { ok: false, reasonKey: 'idMismatch' }
      } catch {
        return { ok: false, reasonKey: 'badBundle' }
      }
      return { ok: true }
    }
  })
  if (!installed.ok) return installed

  const records = listInstalledWorkflows().filter((item) => item.id !== bundle.id)
  records.push({
    id: bundle.id,
    version: bundle.version,
    installedAt: new Date().toISOString(),
    source: sourceUrl(),
    contentHash: sha256OfBytes(new TextEncoder().encode(JSON.stringify(bundle.plan))).slice(0, 16)
  })
  writeRecords(records)
  return { ok: true }
}

export function uninstallWorkflow(input: {
  id: string
}): { ok: true } | { ok: false; reasonKey?: string; error?: string } {
  const targetDir = join(installedWorkflowsDir(), input.id)
  const result = getPipeline().uninstall(targetDir)
  if (!result.ok) return { ok: false, reasonKey: 'removeFailed', error: result.error }
  writeRecords(listInstalledWorkflows().filter((item) => item.id !== input.id))
  coverMemo.delete(input.id)
  return { ok: true }
}

/** 读取已安装的工作流本体的 plan，供界面「使用」时物化 */
export function readInstalledWorkflowPlan(
  id: string
): { ok: true; bundle: WorkflowBundle } | { ok: false; reasonKey: string; error?: string } {
  const file = join(installedWorkflowsDir(), id, 'workflow.json')
  try {
    if (!existsSync(file)) return { ok: false, reasonKey: 'notInstalled' }
    const parsed = parseWorkflowBundle(JSON.parse(readFileSync(file, 'utf8')))
    return parsed.ok
      ? { ok: true, bundle: parsed.bundle }
      : { ok: false, reasonKey: parsed.reasonKey }
  } catch (err) {
    return {
      ok: false,
      reasonKey: 'readFailed',
      error: err instanceof Error ? err.message : String(err)
    }
  }
}

/** 设置里改了源地址后清缓存（内存目录缓存 + 封面缓存） */
export function resetWorkflowMarketCache(): void {
  pipelineInstance = null
  coverMemo.clear()
}
