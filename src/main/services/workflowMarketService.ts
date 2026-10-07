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
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
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
  validateSkillEntryText,
  workflowEntryBlockReason,
  workflowMarketUrls,
  type WorkflowBundle,
  type WorkflowMarketEntry,
  type WorkflowSkillManifest
} from '@shared/workflowMarket'
import { MarketPipeline, sha256OfBytes } from './marketPipeline'
import { dshSkillsDir } from './dshPaths'
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
  /**
   * 随本条工作流装上的技能名（`wf-<id>`）。
   *
   * 卸载时**只按这个名字删**，绝不按前缀批量删 —— 用户可能自己建了同名/同前缀的目录，
   * 批量删会把用户的东西一起带走。
   */
  skillName?: string
  /**
   * 随包脚本**已**落盘（技能目录下存在 `scripts/`，且是用户明示同意的那一次装的）。
   *
   * 脚本是会被 agent 在本机执行起来的代码，所以这条必须留在记账里：日后回头看
   * 「这个技能为什么能跑脚本」时，答案只能是「某次安装时用户同意过」。
   */
  skillScripts?: boolean
  /** 上述同意的落盘时刻（ISO）；只在 `skillScripts` 为真时存在 */
  skillScriptsConsentAt?: string
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
 * 上次成功的源，**落盘**保存。
 *
 * 内存里的 `activeSource` 一重启就没了，于是每次启动后的第一次打开都要先撞一遍不通的主源
 * （黑洞路由下要等到超时）。记住它就能跨重启跳过死源。
 *
 * 这是**派生事实**不是用户配置，所以存在缓存目录而不是 settings —— 不能去覆盖用户填的
 * `workflowMarket.source`（那会让「我明明配了自建源」变得不可解释）。
 */
function preferredSourcePath(): string {
  return join(marketCacheDir(), 'preferred-source.json')
}

function readPreferredSource(): string | null {
  try {
    const raw = JSON.parse(readFileSync(preferredSourcePath(), 'utf8')) as { source?: unknown }
    return typeof raw.source === 'string' && raw.source ? raw.source : null
  } catch {
    return null
  }
}

function writePreferredSource(source: string): void {
  try {
    mkdirSync(marketCacheDir(), { recursive: true })
    writeFileSync(
      preferredSourcePath(),
      `${JSON.stringify({ source, at: new Date().toISOString() }, null, 2)}\n`,
      'utf8'
    )
  } catch {
    /* 记不住不影响本次结果 */
  }
}

/**
 * 按尝试顺序排列的源：**上次成功的源优先**，其余保持原顺序兜底。
 *
 * 这样已装内容在断网/换网后仍能从原来那个通得了的源更新，而不是每次都先撞一遍不通的主源。
 */
function orderedSources(): string[] {
  const candidates = candidateSources()
  const preferred = activeSource ?? readPreferredSource()
  if (!preferred || !candidates.includes(preferred)) return candidates
  return [preferred, ...candidates.filter((item) => item !== preferred)]
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

  /** 组装界面视图（各源共用） */
  const viewOf = (
    source: string,
    index: { workflows: WorkflowMarketEntry[] },
    dropped: number,
    stale: boolean | undefined,
    cachedAt: string | undefined,
    error: string | undefined
  ): WorkflowMarketFetchResult => {
    const known = knownNodeTypeIds()
    const appVersion = updateService.getCurrentVersion()
    const installed = listInstalledWorkflows()
    const entries = index.workflows.map((entry) => {
      const record = installed.find((item) => item.id === entry.id)
      return {
        ...entry,
        missingNodeTypes: missingNodeTypes(entry, known),
        blockReason: workflowEntryBlockReason(entry, { knownNodeTypes: known, appVersion }),
        installedVersion: record?.version ?? null,
        updatable: !!record && !!record.version && record.version !== entry.version,
        installed: !!record
      }
    })
    return {
      ok: true,
      entries,
      source,
      usedFallback: source !== sources[0],
      ...(dropped ? { dropped } : {}),
      ...(stale ? { stale: true } : {}),
      ...(cachedAt ? { cachedAt } : {}),
      ...(error ? { error } : {})
    }
  }

  /**
   * 一个「离线但有缓存」的源**不会立刻结束循环**。
   *
   * 顺序很关键：**新鲜数据优于过期数据**。若主源只是挂着旧缓存、而镜像此刻是通的，
   * 就该用镜像的新数据，而不是把主源的旧缓存当成成功结果直接返回 ——
   * 那会让备用源在自己最该生效的场景下反而不生效。
   */
  let bestStale: WorkflowMarketFetchResult | null = null

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

    const view = viewOf(
      source,
      result.catalog.index,
      result.catalog.dropped,
      result.stale,
      result.cachedAt,
      result.error
    )
    if (!result.stale) {
      // 新鲜数据：立即采用并记住这个源
      activeSource = source
      writePreferredSource(source)
      return view
    }
    // 过期数据：先留着，继续看看有没有源能给出新鲜的
    if (!bestStale) bestStale = view
  }

  if (bestStale) {
    activeSource = bestStale.source ?? null
    return bestStale
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

/**
 * 本地封面小于这个字节数就当成**占位图**，不当真封面用。
 *
 * 市场上最早那批官方封面是 68 字节的 1×1 PNG（校验器只查「存在 + ≤300KB」，
 * 所以一直没人拦）。而 `fetchWorkflowCover` 对**已安装**的工作流是本地优先 ——
 * 于是**在封面更新之前装过**的每一条，本地都留着那张占位图，即使联网也永远显示不出来。
 * 2KB 远低于任何真实的 800×450 封面（实际都在 100KB 以上），不会误伤。
 */
const MIN_REAL_COVER_BYTES = 2048

export async function fetchWorkflowCover(id: string): Promise<WorkflowCoverResult> {
  const cached = coverMemo.get(id)
  if (cached) return { ok: true, dataUrl: cached }

  const local = join(installedWorkflowsDir(), id, 'cover.png')
  try {
    let bytes: Uint8Array | null = null
    /**
     * 本地那份**能不能当真封面用**：存在且不是占位图。
     *
     * 已安装的仍然优先用本地（断网也能看到封面），但占位图例外 —— 见
     * `MIN_REAL_COVER_BYTES`：那种情况必须回远端取，否则封面永远停在装的时候那一版。
     */
    const localUsable =
      existsSync(local) && (statSync(local).size >= MIN_REAL_COVER_BYTES ? true : false)
    if (localUsable) {
      bytes = new Uint8Array(readFileSync(local))
    } else {
      // 未安装（或本地只是占位图）的按源顺序尝试（与目录同序，避免只因为主源不通就没有封面）
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
      // 远端也拿不到时，宁可显示本地那张占位图，也不能什么都不显示（断网路径）
      if (!bytes && existsSync(local)) bytes = new Uint8Array(readFileSync(local))
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
        ...(typeof obj.contentHash === 'string' ? { contentHash: obj.contentHash } : {}),
        /**
         * 技能字段必须原样读回来。
         *
         * 记账是**整体重写**的（安装另一条工作流时也会重写全部记录），读的时候漏掉哪个字段，
         * 那个字段就在下一次写入时被抹掉：`skillName` 掉了 → 卸载时技能目录没人删；
         * 同意记录掉了 → 「脚本是怎么进来的」变成无据可查。
         */
        ...(typeof obj.skillName === 'string' && obj.skillName ? { skillName: obj.skillName } : {}),
        ...(obj.skillScripts === true ? { skillScripts: true } : {}),
        ...(typeof obj.skillScriptsConsentAt === 'string' && obj.skillScriptsConsentAt
          ? { skillScriptsConsentAt: obj.skillScriptsConsentAt }
          : {})
      })
    }
    /**
     * 与磁盘对账：目录被手删的记录不该继续显示「已安装」。
     *
     * **只过滤、不落盘。** 这里曾经顺手 `writeRecords(reconciled)`，结果把一个读函数
     * 变成了写函数：`uninstallWorkflow` 先删工作流目录、再调本函数取记录，于是对账
     * 立刻把 `skillName` 一起抹掉，紧接着的 `removeInstalledSkill` 拿到 `undefined`
     * —— 技能目录永远删不掉。**读函数写盘是个陷阱**，清理交给写路径做。
     */
    return out.filter((item) => existsSync(join(installedWorkflowsDir(), item.id, 'workflow.json')))
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
 * 已安装工作流的**可直接展示**清单（标题 / 简介 / 规模）。
 *
 * 记账文件只有 id 与版本，界面要渲染卡片就得知道标题与规模，因此这里读一遍包内的
 * `workflow.json` 补齐。放在主进程一次读完，避免界面按卡片数量发 N 次 IPC。
 *
 * 包损坏时**不隐藏它**：返回 `broken: true`，界面据此禁用「使用」并说明原因 ——
 * 悄悄消失会让用户以为「我明明装过」。
 */
export function listInstalledWorkflowDetails(): Array<
  InstalledWorkflowRecord & {
    title: string
    summary: string
    nodeCount: number
    edgeCount: number
    broken: boolean
  }
> {
  return listInstalledWorkflows().map((record) => {
    const file = join(installedWorkflowsDir(), record.id, 'workflow.json')
    try {
      const parsed = parseWorkflowBundle(JSON.parse(readFileSync(file, 'utf8')))
      if (!parsed.ok) {
        return {
          ...record,
          title: record.id,
          summary: '',
          nodeCount: 0,
          edgeCount: 0,
          broken: true
        }
      }
      return {
        ...record,
        title: parsed.bundle.title,
        summary: parsed.bundle.summary,
        nodeCount: parsed.bundle.plan.nodes.length,
        edgeCount: parsed.bundle.plan.edges.length,
        broken: false
      }
    } catch {
      return { ...record, title: record.id, summary: '', nodeCount: 0, edgeCount: 0, broken: true }
    }
  })
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
  /**
   * 索引条目里的技能包清单（界面点安装时把它一并传进来）。
   *
   * 由界面传入而非在主进程重取索引：用户点的就是那一条条目，两者必须是同一个对象，
   * 否则会出现「卡片说含技能、装的却是另一份」的漂移。主进程仍会**重新校验**全部字段
   *（路径白名单 + SKILL.md frontmatter），所以这不等于信任界面。
   */
  skill?: WorkflowSkillManifest
  /**
   * 用户**明示同意**安装技能包里的 `scripts/`。
   *
   * 缺省（含 undefined / false）= 只装说明书与 references —— 与放开脚本之前的行为完全一致，
   * 且**不算安装失败**（技能本身仍然可用，只是没有随包脚本）。
   */
  skillScriptsConsent?: boolean
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
  input: {
    id: string
    acceptMissingTypes?: boolean
    skill?: WorkflowSkillManifest
    skillScriptsConsent?: boolean
  },
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

  /**
   * 技能包：**与工作流同生共死**。
   *
   * 卡片上写着「含技能」，若技能没装上而工作流留着，用户会以为 agent 拿到了说明书 ——
   * 能力缺失却是静默的，正是最难排查的一类问题。所以技能装失败就把工作流一并卸掉，
   * 宁可整体失败并给出明确原因，也不留半成品。安装是幂等的，重试即可。
   */
  const skillResult = await installSkillBundle(urls, bundle.id, input.skill, {
    allowScripts: input.skillScriptsConsent === true
  })
  if (skillResult && !skillResult.ok) {
    getPipeline().uninstall(targetDir)
    return {
      ok: false,
      reasonKey: skillResult.reasonKey,
      error: skillResult.error ?? input.skill?.name
    }
  }
  const skillName = skillResult?.ok ? skillResult.name : null
  const skillScripts = skillResult?.ok === true && skillResult.scriptsInstalled

  // 记下成功安装的源，后续 bundle / cover 优先走它
  activeSource = source
  const records = listInstalledWorkflows().filter((item) => item.id !== bundle.id)
  records.push({
    id: bundle.id,
    version: bundle.version,
    installedAt: new Date().toISOString(),
    source,
    contentHash: sha256OfBytes(new TextEncoder().encode(JSON.stringify(bundle.plan))).slice(0, 16),
    ...(typeof skillName === 'string' ? { skillName } : {}),
    // 只有脚本真的落了盘才记这笔账：记账说「装过脚本」而磁盘上没有，等于把审计线索写歪
    ...(skillScripts ? { skillScripts: true, skillScriptsConsentAt: new Date().toISOString() } : {})
  })
  writeRecords(records)
  /**
   * 装上/更新之后必须丢掉这个 id 的封面内存缓存。
   *
   * 不丢的话「重装一次让封面刷新」这条自救路走不通：`fetchWorkflowCover` **先查 memo 再读本地**，
   * 而 memo 只在**卸载**时按 id 失效 —— 于是刚下载进 `<installed>/<id>/cover.png` 的新封面
   * 也显示不出来（用户看到的现象就是「这张卡没有封面」，重启应用才恢复）。
   */
  coverMemo.delete(bundle.id)
  return { ok: true }
}

/**
 * 安装技能包到 dsh 技能根（`$DSH_HOME/skills/<name>`）。
 *
 * 返回装上的技能名与「脚本是否落盘」；没有技能返回 `null`；失败返回 reasonKey
 *（调用方据此回滚工作流）。
 *
 * 三点刻意的取舍：
 * - **脚本要用户明示同意**（`allowScripts`）：`scripts/` 是会被 agent 在本机执行起来的
 *   代码，不是说明书。不同意就只装说明书与 references —— 与放开脚本之前的行为一致，
 *   且**不算失败**（技能本身照样可用，只是少了随包脚本）。
 * - **同意也不等于免检**：路径仍要过 `isSafeSkillFilePath`（下载器只接受白名单路径），
 *   体积仍走管道的上限，脚本文件与说明书走同一套校验。
 * - **安装前校验 SKILL.md**：dsh 对不合法的技能是**静默忽略**，不校验就会「装上了却看不见」。
 */
async function installSkillBundle(
  urls: ReturnType<typeof workflowMarketUrls>,
  workflowId: string,
  manifest: WorkflowSkillManifest | undefined,
  options: { allowScripts: boolean }
): Promise<
  | { ok: true; name: string; scriptsInstalled: boolean }
  | { ok: false; reasonKey: string; error?: string }
  | null
> {
  if (!manifest) return null
  const skillDir = join(dshSkillsDir(), manifest.name)
  const files: Array<{ path: string; url: string }> = []
  let scriptsInstalled = false
  for (const file of manifest.files) {
    const isScript = file.path.startsWith('scripts/')
    if (isScript && !options.allowScripts) continue
    const url = urls.skillFile(workflowId, file.path)
    // 白名单在契约层已校验过；这里再挡一次，避免把非法路径交给下载器
    if (!url) return { ok: false, reasonKey: 'skillBadPath', error: file.path }
    files.push({ path: file.path, url })
    if (isScript) scriptsInstalled = true
  }
  if (!files.some((file) => file.path === manifest.entry)) {
    return { ok: false, reasonKey: 'skillMissingEntry', error: manifest.entry }
  }

  const result = await getPipeline().install({
    targetDir: skillDir,
    files,
    verify: (staged) => {
      const entry = staged.find((item) => item.path === manifest.entry)
      if (!entry) return { ok: false, reasonKey: 'skillMissingEntry' }
      const check = validateSkillEntryText(Buffer.from(entry.bytes).toString('utf8'), manifest.name)
      return check.ok ? { ok: true } : { ok: false, reasonKey: check.reasonKey }
    }
  })
  if (result.ok) return { ok: true, name: manifest.name, scriptsInstalled }
  // 具体原因（缺 description / 名字不符 / 旧键…）比一句「技能安装失败」有用得多，原样带回
  return {
    ok: false,
    reasonKey: result.reasonKey,
    ...(result.error ? { error: result.error } : {})
  }
}

/**
 * 删除随工作流装上的技能。
 *
 * 只删记账里记着的那个目录名，且**只在它确实是目录时**才删 —— 用户自建的技能
 *（哪怕是同名）不该被卸载工作流这件事牵连。
 */
function removeInstalledSkill(record: InstalledWorkflowRecord | undefined): void {
  const name = record?.skillName
  if (!name) return
  const dir = join(dshSkillsDir(), name)
  try {
    if (existsSync(dir) && statSync(dir).isDirectory())
      rmSync(dir, { recursive: true, force: true })
  } catch {
    // 技能删不掉不该让「卸载工作流」失败：工作流本体已经移除，残留技能下次安装会覆盖
  }
}

export function uninstallWorkflow(input: { id: string }): WorkflowMarketActionResult {
  const targetDir = join(installedWorkflowsDir(), input.id)
  /**
   * **先取记录，再删目录。** 记录本身也被磁盘对账过滤（目录不在就不返回），
   * 所以顺序反了就拿不到 `skillName`，随工作流一起装上的技能包就留在 dsh 技能根里
   * 变成孤儿 —— 卸载界面说"已卸载"，agent 那边却还挂着一份说明书。
   */
  const record = listInstalledWorkflows().find((item) => item.id === input.id)
  const result = getPipeline().uninstall(targetDir)
  if (!result.ok) return { ok: false, reasonKey: 'removeFailed', error: result.error }
  removeInstalledSkill(record)
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
