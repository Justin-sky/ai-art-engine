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
import type {
  WorkflowBundleResult,
  WorkflowCoverResult,
  WorkflowMarketActionResult,
  WorkflowMarketFetchResult
} from '@shared/ipc'
import {
  DEFAULT_WORKFLOW_MARKET_SOURCE,
  missingNodeTypes,
  parseWorkflowBundle,
  parseWorkflowMarketIndex,
  resolveWorkflowMarketSources,
  workflowEntryBlockReason,
  workflowMarketUrls,
  type WorkflowBundle
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

/**
 * 当前生效的数据源。
 *
 * **索引、包、封面必须同源**。否则会出现「索引从镜像读到、点安装却去打已经不通的 GitHub」
 * 这种难查的失败。所以目录取成功后把生效源记下来，后续的 bundle / cover 优先走它。
 */
let activeSource: string | null = null

/** 候选源：用户配置的地址（可多个），留空则为官方主源 + 镜像 */
function candidateSources(): string[] {
  const configured = settingsService.get().workflowMarket?.source ?? ''
  return resolveWorkflowMarketSources(configured)
}

/**
 * 按尝试顺序排列的源：**上次成功的源优先**，其余保持原顺序兜底。
 *
 * 这样已装内容在断网/换网后仍能从原来那个通得了的源更新，而不是每次都先撞一遍不通的主源。
 */
function orderedSources(): string[] {
  const candidates = candidateSources()
  if (!activeSource || !candidates.includes(activeSource)) return candidates
  return [activeSource, ...candidates.filter((item) => item !== activeSource)]
}

/** 本应用已注册的节点类型（兼容性判定的依据） */
export function knownNodeTypeIds(): string[] {
  return listNodeTypes().map((def) => def.typeId)
}

/** 当前生效源（界面展示「正在用哪个源」用） */
export function currentWorkflowMarketSource(): string {
  return activeSource ?? candidateSources()[0] ?? DEFAULT_WORKFLOW_MARKET_SOURCE
}

// ─────────────────────────────────────────────────────────────
// 目录
// ─────────────────────────────────────────────────────────────

/**
 * 返回类型**直接复用 IPC 契约**（`WorkflowMarketFetchResult`），而不是在这里另立一个视图类型。
 *
 * 这里曾经返回 `{ ok, catalog: { entries } }` 而契约声明的是顶层 `entries`，渲染层读
 * `result.entries` 得到 `undefined`，界面于是显示「0 个工作流」——**主进程日志却显示 15 条**，
 * 因为日志打在返回之前。
 *
 * 这个 bug 能溜过类型检查，是因为 `handle()` 是泛型 `<T>`、`ipcRenderer.invoke` 返回 `any`，
 * 两端之间没有任何类型约束。现在服务端与契约共用同一个类型，形状漂移会**直接编译报错**。
 */
export async function fetchWorkflowCatalog(input?: {
  force?: boolean
}): Promise<WorkflowMarketFetchResult> {
  const sources = orderedSources()
  const attempted: Array<{ source: string; reasonKey: string; error?: string }> = []

  /**
   * 依次尝试各源。
   *
   * 注意 `fetchCatalog` 自己带磁盘缓存回退：某个源「网络不通但有缓存」会返回
   * `ok:true, stale:true`。这算成功 —— 有可用目录就不必再去撞下一个源，
   * 界面会提示「离线，数据可能过期」。
   */
  for (const source of sources) {
    const urls = workflowMarketUrls(source)
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
      // 索引本身不合法（仓库发坏了）也算这个源失败 —— 换镜像可能拿到一份好的
      attempted.push({
        source,
        reasonKey: result.reasonKey ?? 'unknown',
        ...(result.error ? { error: result.error } : {})
      })
      continue
    }

    activeSource = source
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

    // 顶层字段与 `WorkflowMarketFetchResult` 一一对应（见上方注释：嵌套一层曾导致界面全空）
    return {
      ok: true,
      entries,
      dropped: result.catalog.dropped,
      stale: !!result.stale,
      source,
      usedFallback: source !== sources[0],
      ...(result.cachedAt ? { cachedAt: result.cachedAt } : {}),
      ...(result.error ? { error: result.error } : {})
    }
  }

  /**
   * 全部源都不通：把**每一个源失败的原因**都带回去。
   * 只说「网络失败」会让人以为是自己的网络，而实际可能是某一个源在特定网络下不可达。
   */
  return {
    ok: false,
    reasonKey: attempted[0]?.reasonKey ?? 'network',
    attempted
  }
}

// ─────────────────────────────────────────────────────────────
// 封面
// ─────────────────────────────────────────────────────────────

/** 封面内存缓存（data URL）：切页签来回看不该反复下载 */
const coverMemo = new Map<string, string>()
const COVER_MEMO_MAX = 64

export async function fetchWorkflowCover(id: string): Promise<WorkflowCoverResult> {
  const cached = coverMemo.get(id)
  if (cached) return { ok: true, dataUrl: cached }

  const local = join(installedWorkflowsDir(), id, 'cover.png')
  try {
    let bytes: Uint8Array | null = null
    if (existsSync(local)) {
      // 已安装的优先用本地：断网也能看到封面
      bytes = new Uint8Array(readFileSync(local))
    } else {
      // 未安装的按源顺序尝试（与目录同序，避免只因为主源不通就没有封面）
      let lastError: unknown = null
      for (const source of orderedSources()) {
        const coverUrl = workflowMarketUrls(source).cover({ id, cover: 'cover.png' })
        if (!coverUrl) continue
        try {
          bytes = await getPipeline().fetchBinary(coverUrl)
          break
        } catch (err) {
          lastError = err
        }
      }
      if (!bytes) {
        return {
          ok: false,
          reasonKey: 'cover',
          ...(lastError
            ? { error: lastError instanceof Error ? lastError.message : String(lastError) }
            : {})
        }
      }
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
 *
 * **整包（本体 + 封面）从同一个源取**：混源会出现「本体从镜像来、封面从主源来」，
 * 一旦主源不通，封面那一步就把整次安装拖挂，而用户看到的是一个说不清原因的失败。
 */
export async function installWorkflow(input: {
  id: string
  acceptMissingTypes?: boolean
}): Promise<WorkflowMarketActionResult> {
  const sources = orderedSources()
  const failures: string[] = []

  for (const source of sources) {
    const urls = workflowMarketUrls(source)
    const result = await installFromSource(source, urls, input, failures)
    if (result) return result
  }

  // 全部源都失败：把每个源的原因都带上，便于区分「都不通」与「仓库发坏了」
  return {
    ok: false,
    reasonKey: 'download',
    error: failures.join(' | ')
  }
}

/**
 * 从单个源安装。成功或「仓库内容有错」时返回结果；**只有该源取不到文件**时才返回 `null`
 * 让调用方换下一个源。
 *
 * 内容错误（id 不符、格式非法、缺依赖）不换源 —— 镜像与主源内容应当一致，
 * 换源重试只会把同一个错误再撞一遍，还会掩盖真正的原因。
 */
async function installFromSource(
  source: string,
  urls: ReturnType<typeof workflowMarketUrls>,
  input: { id: string; acceptMissingTypes?: boolean },
  failures: string[]
): Promise<WorkflowMarketActionResult | null> {
  let bundleRaw: unknown
  try {
    bundleRaw = await getPipeline().fetchJson(urls.bundle(input.id))
  } catch (err) {
    failures.push(`${source}: ${err instanceof Error ? err.message : String(err)}`)
    return null
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

  const coverUrl = urls.cover({ id: bundle.id, cover: bundle.cover ?? 'cover.png' })
  const targetDir = join(installedWorkflowsDir(), bundle.id)
  const installed = await getPipeline().install({
    targetDir,
    files: [
      { path: 'workflow.json', url: urls.bundle(bundle.id) },
      // 封面取不到不该让整次安装失败：没有封面只是卡片不好看，工作流本身是可用的
      ...(coverUrl ? [{ path: 'cover.png', url: coverUrl }] : [])
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
  if (!installed.ok) {
    failures.push(`${source}: ${installed.error ?? installed.reasonKey}`)
    return null
  }

  // 记下成功安装的源，后续 bundle / cover 优先走它
  activeSource = source
  const records = listInstalledWorkflows().filter((item) => item.id !== bundle.id)
  records.push({
    id: bundle.id,
    version: bundle.version,
    installedAt: new Date().toISOString(),
    source,
    contentHash: sha256OfBytes(new TextEncoder().encode(JSON.stringify(bundle.plan))).slice(0, 16)
  })
  writeRecords(records)
  return { ok: true }
}

export function uninstallWorkflow(input: { id: string }): WorkflowMarketActionResult {
  const targetDir = join(installedWorkflowsDir(), input.id)
  const result = getPipeline().uninstall(targetDir)
  if (!result.ok) return { ok: false, reasonKey: 'removeFailed', error: result.error }
  writeRecords(listInstalledWorkflows().filter((item) => item.id !== input.id))
  coverMemo.delete(input.id)
  return { ok: true }
}

/** 读取已安装的工作流本体的 plan，供界面「使用」时物化 */
export function readInstalledWorkflowPlan(id: string): WorkflowBundleResult {
  const file = join(installedWorkflowsDir(), id, 'workflow.json')
  try {
    if (!existsSync(file)) return { ok: false, reasonKey: 'notInstalled' }
    const parsed = parseWorkflowBundle(JSON.parse(readFileSync(file, 'utf8')))
    if (!parsed.ok) return { ok: false, reasonKey: parsed.reasonKey }
    /**
     * 只回传界面需要的字段（`plan` 透传为 `unknown`）—— 契约里 `WorkflowBundleResult.bundle`
     * 就是按这个用途定义的，直接把整个 WorkflowBundle 塞进去会让两边的类型再次分叉。
     */
    return {
      ok: true,
      bundle: {
        id: parsed.bundle.id,
        title: parsed.bundle.title,
        summary: parsed.bundle.summary,
        version: parsed.bundle.version,
        plan: parsed.bundle.plan
      }
    }
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
