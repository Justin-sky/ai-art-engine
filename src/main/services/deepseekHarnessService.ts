import { app, shell } from 'electron'
import { createHash } from 'node:crypto'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { readdir, rm } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { constants as zlibConstants, zstdCompressSync, zstdDecompressSync } from 'node:zlib'
import {
  IpcChannels,
  type AskUserAnswer,
  type ChatMode,
  type ControlHarnessGoalInput,
  type DeleteHarnessScheduleInput,
  type DshSkillsFile,
  type DshSkillsInfo,
  type DshSkillsTemplateResult,
  type ExportHarnessSessionInput,
  type ExportHarnessSessionResult,
  type HarnessCanvasEventInput,
  type HarnessCanvasEventResult,
  type HarnessCanvasEventView,
  type HarnessEvent,
  type HarnessGoalView,
  type HarnessJobWaitInput,
  type HarnessJobWaitResult,
  type HarnessPresentFile,
  type HarnessRunInput,
  type HarnessRunResult,
  type HarnessScheduleView,
  type HarnessSessionSearchHit,
  type HarnessStatus,
  type HarnessSubagentView,
  type HarnessTodoItem,
  type OpenHarnessFileInput,
  type RewindHarnessSessionInput,
  type RewindHarnessSessionResult,
  type SearchHarnessSessionsInput,
  type SearchHarnessSessionsResult,
  type SessionSkill,
  type SteerHarnessTurnInput,
  type SteerHarnessTurnResult
} from '@shared/ipc'
import { parseClaudeSkillMarkdown, parseGitHubSkillSourceUrl } from '@shared/claudeSkill'
import { accessHeaders, isCancelAnswer, normalizeChatMode } from '@shared/mcpModeAccess'
import {
  isCustomProvider,
  MODEL_PROVIDER_KINDS,
  modalityConfig,
  resolveCustomApiStyle,
  type ModelProviderInstance
} from '@shared/modelProvider'
import {
  GOOGLE_CHAT_FALLBACK_MODELS,
  resolveGoogleChatModelId,
  resolveGoogleOpenAiBaseUrl
} from '@shared/modelProviders/google/modelCapabilities'
import {
  OPENAI_CHAT_FALLBACK_MODELS,
  normalizeOpenAiTextModelId
} from '@shared/modelProviders/openai/modelCapabilities'
import { resolveDshChatInputModalitiesForProvider } from '@shared/dshChatModelModalities'
import { PROJECT_MEMORY_INJECT_LIMIT, PROJECT_MEMORY_RELATIVE_PATH } from '@shared/projectMemory'
import { broadcastToAllWindows } from '../broadcast'
import {
  buildStudioNodeCapabilitiesBridge,
  cleanupLegacyDshSkills,
  discoverInstalledClaudeSkills,
  preprocessSkillInvocation,
  runSkillLifecycleHooks,
  shouldAutoApproveSkillTool,
  type ActiveSkillTurnContext
} from './claudeSkillRuntime'
import {
  inspectGitHubSkillSource,
  installGitHubSkills,
  listInstalledGitHubSkillRecords,
  searchOnlineSkills
} from './githubSkillInstaller'
import { extractWebArticleWithHeadlessBrowser } from './webArticleExtractService'
import { isDshQuotaError } from './deepseekHarnessFailure'
import {
  appendNodeRequireOption,
  HIDE_CHILD_WINDOWS_HOOK_FILENAME,
  HIDE_CHILD_WINDOWS_HOOK_SOURCE
} from './dshHideChildWindowsHook'
import { patchBrowserGuard } from './dshBrowserGuardPatch'
import { patchAclSandboxConsole } from './dshSandboxConsolePatch'
import { dshHome, dshSkillsDir } from './dshPaths'
import {
  clearActiveHarnessRun,
  confirmHarnessRunAccess,
  getBlenderMcpEndpoint,
  getMcpServerInfo,
  registerHarnessRunAccess,
  releaseHarnessRunAccess,
  setActiveHarnessRun,
  setCanvasTaskSettledHook,
  setMcpToolSettledHook,
  syncActiveCanvasFromWorkspaceContext
} from './mcpServerService'
import { stripMcpToolPrefix, summarizeMcpToolOperation } from '@shared/mcpToolOperationSummary'
import { projectService } from './projectService'
import { settingsService } from './settingsService'
import {
  EXTERNAL_MCP_PATH_PREFIX,
  externalMcpUnusableReason,
  normalizeExternalMcpServer
} from '@shared/externalMcp'
import {
  approvalAnswerForDecision,
  approvalViewOf,
  parseApprovalMarker,
  type ApprovalAnswer
} from '@shared/dshApproval'
import AIART_RUNNER_TEMPLATE from 'virtual:aiart-headless-runner-template'
import AIART_APPROVAL_ANSWERER_TEMPLATE from 'virtual:aiart-approval-answerer-template'

/**
 * DeepSeek Harness (dsh) 接入服务。
 *
 * dsh 是 DeepSeek 2026-08 开源的 agent 运行时（开发者预览 v0.1，API 会快速迭代）。
 * 本服务把它作为子进程拉起（headless profile），并注入 dsh-mcp-client 插件配置，
 * 让 agent 通过 Streamable HTTP 调用本应用自带的 MCP 工具服务——即「聊天窗口里调用 MCP」。
 *
 * 流程：
 *   Chat 面板 → HARNESS_RUN → 常驻 dsh worker（stdin NDJSON prompt）或 one-shot headless
 *     → dsh 内嵌 mcp-client → GET/POST http://127.0.0.1:<port>/mcp (Bearer token)
 *     → 工具执行（generate_image 等）→ MCP 活动广播给渲染层做工具卡
 *   dsh stdout / stderr 按行转发为 HARNESS_EVENT（assistant / status / done / error）。
 * 常驻模式砍掉每轮 Cordis/MCP/TLS 冷启动；fingerprint 变（工作区/MCP/Blender/baseUrl）才重启。
 *
 * dsh 运行体来源（按优先级）：
 *   1. 安装包内置：构建时由 scripts/bundle-dsh.mjs 产出，随 extraResources 打入
 *      `<resources>/dsh`，开箱即用，无需联网下载；
 *   2. 工程本地安装：开发模式下 `node_modules/@deepseek-ai/dsh`；
 *   3. npx 现场拉包（回退）：无内置且未安装时 `npx --yes @deepseek-ai/dsh`，耗时较长。
 * dsh 由内置 Node 执行：spawn Electron 二进制并注入 ELECTRON_RUN_AS_NODE=1，以纯 Node 模式运行
 * （Electron 44 内置 Node 24.x，满足 ^22.19 或 24+），用户无需安装系统 Node；
 * 仅在内置 Node 不可用（理论上不会）时回退系统 node。
 */

const DSH_PACKAGE = '@deepseek-ai/dsh'
const MIN_NODE_MAJOR = 22
const MIN_NODE_MINOR = 19
const NPX_TIMEOUT_MS = 120_000
/** npx 现场拉包期间的进度提醒间隔：下载可能长时间无输出，避免界面看起来卡死 */
const NPX_PROGRESS_HINT_MS = 20_000
/**
 * 内置 dsh 已启动但尚未有任何输出时的进度提示间隔。
 * 常见卡点：OpenRouter/上游 TLS 已连上却迟迟不回首包，面板会一直停在「正在启动」。
 */
const DSH_IDLE_PROGRESS_HINT_MS = 15_000
/** 常驻 worker 占位 task：runner 见此值则进入 stdin NDJSON 多轮循环 */
const PERSISTENT_PLACEHOLDER_TASK = '__AIART_PERSISTENT__'
/** 空闲回收：无对话后关闭常驻进程 */
const WORKER_IDLE_MS = 12 * 60 * 1000

let child: ChildProcess | null = null
/** 当前是否有一轮 prompt 在跑（常驻时 child 非空 ≠ 忙碌） */
let turnActive = false
let workerFingerprint = ''
let workerModelId = ''
let workerReady = false
let workerPersistent = false
let workerRunId = ''
let lastPreferredProviderId = ''
let lastPreferredModelId = ''
let idleTimer: ReturnType<typeof setTimeout> | null = null
let lastSettingsWriteHash = ''
let lastHarnessWriteHash = ''
let readyWaiters: Array<(ready: boolean) => void> = []
let lastWorkerBootError = ''
let runSeq = 0
let abortSeq = 0
/** 串行化常驻 worker 拉起，避免 Chat 双挂载 / 连点预热并发出两个进程（终端打两次 ready） */
let ensureWorkerChain: Promise<void> = Promise.resolve()
type HarnessQueueItem = {
  input: HarnessRunInput
  waiters: Array<(result: HarnessJobWaitResult) => void>
  onStart?: () => void
}
const harnessQueue: HarnessQueueItem[] = []
let activeWaiters: Array<(result: HarnessJobWaitResult) => void> = []

function completeActiveJob(result: HarnessJobWaitResult): void {
  const waiters = activeWaiters
  activeWaiters = []
  for (const wait of waiters) wait(result)
  pumpHarnessQueue()
}

function pumpHarnessQueue(): void {
  if (turnActive || activeWaiters.length) return
  const next = harnessQueue.shift()
  if (!next) return
  activeWaiters = next.waiters
  next.onStart?.()
  void startHarnessNow(next.input).then((started) => {
    if (!started.started) {
      completeActiveJob({ ok: false, error: started.message || 'GRAPH_MODEL_DSH_START' })
    }
  })
}
/** 最近一次下发的 status 文本，用于合并连续重复行，避免同文刷屏 */
let lastStatusText = ''
/** 已提示过的工作区路径：仅在切换时提示，避免每条消息都重复输出 */
let workspaceNotified = ''
/**
 * 待回传的 ask_user_question 提问：requestId（harness: 前缀）→ 回答文件与题号。
 * 渲染层选择经 MCP_ASK_USER_RESPONSE 回传 → handleAskUserResponse 写 answerFile，
 * runner 侧 provider 轮询读到后 resolve 给 agent。
 */
const harnessAskUserRequests = new Map<
  string,
  { runId: string; answerFile: string; questionId: string }
>()

/**
 * 待回传的 dsh 审批请求：requestId（approval: 前缀）→ 回答文件与工具名。
 *
 * 与 `harnessAskUserRequests` 同一套往返机制（标记行下行、回答文件上行），但**语义更重**：
 * 它决定 agent 能否突破沙箱边界，所以这里只记「问题」与「写回答的位置」，
 * 放行判定一律走 `approvalAnswerFileText`（唯一能写出 `allow-once` 的地方）。
 */
const harnessApprovalRequests = new Map<
  string,
  { runId: string; answerFile: string; toolName: string }
>()

function emit(event: HarnessEvent): void {
  broadcastToAllWindows(IpcChannels.HARNESS_EVENT, event)
}

/**
 * 下发一条状态行；与上一行完全相同的文本会被合并，只保留一次。
 *
 * tone 由这里按语义给出：状态文案随语言与上游措辞变化，渲染层不该靠关键字猜。
 * 缺省 waiting，只报错与降级两种情形需要显式指定。
 */
type StatusTone = 'waiting' | 'warn' | 'error'

function emitStatus(text: string, tone: StatusTone = 'waiting'): void {
  if (!text) return
  if (text === lastStatusText) return
  lastStatusText = text
  emit({ type: 'status', text, tone })
}

/** 剥离 ANSI 颜色码 / 控制字符，保留可读文本 */
function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, '').replace(/\r/g, '')
}

/**
 * dsh 工作区：优先当前打开的工程根目录（agent 在工程内读写资产），
 * 未打开工程时回退应用数据目录（仅可做纯对话）。
 */
function resolveWorkspace(): string {
  const root = projectService.getOpenProjectState()?.rootPath?.trim()
  if (root && existsSync(root)) return root
  return app.getPath('userData')
}

/**
 * 解析 dsh 使用的文本 provider（含密钥）。
 * 优先指定 providerId；未指定时取 DeepSeek 官方，其次任意已配置文本模型的 provider。
 * 任一 provider 的文本模型都可作为 agent 模型（OpenAI 兼容端点经 DEEPSEEK_BASE_URL 透传）。
 */
function resolveTextProvider(providerId?: string): {
  apiKey: string
  baseUrl?: string
  modelId: string
  provider: ModelProviderInstance
} | null {
  const settings = settingsService.get()
  const providers = settings.models?.providers ?? []
  const hasTextModels = (p: ModelProviderInstance): boolean =>
    (modalityConfig(p, 'text').selectedModelIds?.length ?? 0) > 0
  const pick = (p: ModelProviderInstance): ReturnType<typeof resolveTextProvider> => {
    const text = modalityConfig(p, 'text')
    const rawModelId =
      (text.defaultModelId?.trim() && text.selectedModelIds.includes(text.defaultModelId)
        ? text.defaultModelId.trim()
        : undefined) ?? text.selectedModelIds[0]?.trim()
    if (!rawModelId) return null
    const rawBaseUrl =
      p.baseUrl?.trim() ||
      MODEL_PROVIDER_KINDS.find((k) => k.id === p.providerKind)?.defaultBaseUrl ||
      ''
    const isGoogle =
      p.providerKind === 'google' || /generativelanguage\.googleapis\.com/i.test(rawBaseUrl)
    const isOpenAi = p.providerKind === 'openai' || /\bapi\.openai\.com\b/i.test(rawBaseUrl)
    const modelId = isGoogle
      ? resolveGoogleChatModelId(rawModelId)
      : isOpenAi
        ? normalizeOpenAiTextModelId(rawModelId, { hasTools: true })
        : rawModelId
    const baseUrl = isGoogle
      ? resolveGoogleOpenAiBaseUrl(rawBaseUrl)
      : rawBaseUrl.replace(/\/+$/, '')
    return {
      apiKey: p.apiKey.trim(),
      modelId,
      provider: p,
      ...(baseUrl ? { baseUrl } : {})
    }
  }
  // dsh 经由 OpenAI 兼容端点透传：Anthropic Messages API（一等提供商或自定义 anthropic 端点）不可用作 agent 模型
  const isDshCompatible = (p: ModelProviderInstance): boolean =>
    p.providerKind !== 'anthropic' &&
    (!isCustomProvider(p) || resolveCustomApiStyle(p) !== 'anthropic')
  if (providerId) {
    const candidate = providers.find(
      (p) =>
        p.id === providerId &&
        p.enabled &&
        p.apiKey?.trim() &&
        hasTextModels(p) &&
        isDshCompatible(p)
    )
    return candidate ? pick(candidate) : null
  }
  const pool = providers.filter(
    (p) => p.enabled && p.apiKey?.trim() && hasTextModels(p) && isDshCompatible(p)
  )
  const provider = pool.find((p) => p.providerKind === 'deepseek') ?? pool[0]
  return provider ? pick(provider) : null
}

/** Electron 内置 Node 版本（主进程 process.versions.node 即内置运行时版本） */
function embeddedNodeVersion(): string {
  return `v${process.versions.node ?? ''}`
}

/** 检测执行 dsh 所用的 Node 版本：优先内置 Node，否则回退系统 node */
function detectNodeVersion(): string {
  const embedded = embeddedNodeVersion()
  if (isNodeVersionOk(embedded)) return embedded
  // windowsHide: 宿主是 GUI 进程（没有控制台），不隐藏就会闪一个控制台窗口
  const res = spawnSync('node', ['--version'], {
    timeout: 5_000,
    encoding: 'utf8',
    windowsHide: true
  })
  return res.status === 0 && res.stdout ? res.stdout.trim() : ''
}

/**
 * 解析执行 dsh 所用的 Node 命令。
 * 优先应用内置 Node：Electron 二进制 + ELECTRON_RUN_AS_NODE=1 即进入纯 Node 模式
 * （Electron 44 内置 Node 24.x，满足 ^22.19 或 24+），用户无需安装系统 Node；
 * 仅在内置 Node 版本不满足要求时回退系统 node。
 */
function resolveNodeCommand(): { command: string; env: NodeJS.ProcessEnv } {
  if (isNodeVersionOk(embeddedNodeVersion())) {
    return { command: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' } }
  }
  return { command: 'node', env: {} }
}

function parseNodeVersion(version: string): { major: number; minor: number } | null {
  const m = /^v?(\d+)\.(\d+)\.\d+/.exec(version.trim())
  if (!m) return null
  return { major: Number(m[1]), minor: Number(m[2]) }
}

function isNodeVersionOk(version: string): boolean {
  const parsed = parseNodeVersion(version)
  if (!parsed) return false
  if (parsed.major < MIN_NODE_MAJOR) return false
  if (parsed.major === MIN_NODE_MAJOR && parsed.minor < MIN_NODE_MINOR) return false
  return true
}

/** npm 缓存目录（用于判断 dsh 是否已缓存、免现场下载） */
function npmCacheDir(): string {
  const res = spawnSync('npm', ['config', 'get', 'cache'], {
    timeout: 5_000,
    encoding: 'utf8',
    windowsHide: true
  })
  return res.status === 0 && res.stdout ? res.stdout.trim() : ''
}

/** dsh 是否已存在于 npx 缓存（`npm exec` 命名的 `_npx` 目录） */
function detectDshCached(): boolean {
  const cache = npmCacheDir()
  if (!cache) return false
  const npxDir = join(cache, '_npx')
  if (!existsSync(npxDir)) return false
  return existsSync(join(npxDir, 'node_modules', DSH_PACKAGE))
}

/** dsh 包根目录的候选位置：安装包内置 resources/dsh → 工程本地 node_modules（开发模式） */
function dshPackageRoots(): string[] {
  const roots: string[] = []
  if (process.resourcesPath)
    roots.push(join(process.resourcesPath, 'dsh', 'node_modules', DSH_PACKAGE))
  roots.push(join(app.getAppPath(), 'node_modules', DSH_PACKAGE))
  return roots
}

/** 读取包 package.json 的 bin 入口（bin 为字符串或对象，对象取首个值） */
function readBinEntry(packageRoot: string): string | null {
  try {
    const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
      bin?: string | Record<string, string>
    }
    if (typeof pkg.bin === 'string') return join(packageRoot, pkg.bin)
    const first = pkg.bin ? Object.values(pkg.bin)[0] : ''
    return first ? join(packageRoot, first) : null
  } catch {
    return null
  }
}

/** 定位可用的 dsh 运行入口（内置优先，其次本地安装）；无可用返回 null */
function resolveDshEntry(): string | null {
  for (const root of dshPackageRoots()) {
    if (!existsSync(root)) continue
    const entry = readBinEntry(root)
    if (entry && existsSync(entry)) return entry
  }
  return null
}

/**
 * 清理旧版本遗留：早期版本把 dsh 解压到 userData/dsh-runtime（约 200MB）。
 * 现版本直接使用安装包内置的 <resources>/dsh，旧解压结果成为孤儿，首次查询状态时后台删除。
 * 删除在后台进行（数万文件），不阻塞状态查询。
 */
let legacyCleanupStarted = false
function cleanupLegacyUnpackedDsh(): void {
  if (legacyCleanupStarted) return
  legacyCleanupStarted = true
  const legacy = join(app.getPath('userData'), 'dsh-runtime')
  if (!existsSync(legacy)) return
  void rm(legacy, { recursive: true, force: true }).catch((error) => {
    console.warn('[aiart] legacy dsh-runtime cleanup failed:', error)
  })
}

export async function getHarnessStatus(): Promise<HarnessStatus> {
  cleanupLegacyUnpackedDsh()
  const usingEmbedded = isNodeVersionOk(embeddedNodeVersion())
  const nodeVersion = detectNodeVersion()
  const nodeOk = isNodeVersionOk(nodeVersion)
  const mcp = getMcpServerInfo()
  const provider = resolveTextProvider()
  const dshEntry = resolveDshEntry()
  const dshReady = nodeOk && (!!dshEntry || detectDshCached())

  const hints: string[] = []
  if (!nodeOk) hints.push('未检测到可用 Node（请安装 Node.js 22.19+ 或 24+）')
  if (!dshEntry && !detectDshCached()) {
    hints.push('首次发送消息时会自动下载 dsh（需联网，约 1–2 分钟）')
  }
  if (!provider) hints.push('尚未配置文本模型或 API Key（模型设置中添加）')
  if (!mcp?.running) hints.push('MCP 工具服务未启动（设置中开启）')

  // 仅打开工程时上报工作区（agent 以工程为工作区）；否则 UI 提示未打开工程
  const projectRoot = projectService.getOpenProjectState()?.rootPath?.trim()
  const workspace = projectRoot && existsSync(projectRoot) ? projectRoot : undefined
  if (!workspace) hints.push('未打开工程：AI 工作区将回退为应用数据目录')

  return {
    nodeVersion: usingEmbedded && nodeVersion ? `${nodeVersion}（内置）` : nodeVersion || '未知',
    nodeOk,
    dshReady,
    mcpRunning: !!mcp?.running,
    mcpEndpoint: mcp?.endpoint,
    hasDeepseekKey: !!provider,
    message: hints.join('；') || undefined,
    workspace,
    running: turnActive
  }
}

/**
 * 生成 dsh 的 home 级配置：注册 mcp-client 插件，指向本应用 MCP 工具服务。
 *
 * mode / runId 随请求头下发：面板模式在 MCP 服务端是硬约束（Ask 不给任何工具、Plan 未确认前
 * 只留只读工具，见 shared/mcpModeAccess.ts），不再只靠 persona 提示；runId 供 Plan 回查
 * 「用户是否已确认计划」。配置每轮重写，所以这两个头天然是一次运行一个值。
 */

/**
 * 第二个 mcp-client 的接入信息；未启用或主 MCP 服务未起 → null（不写 blender 段）。
 *
 * 与旧实现差别：端点固定指向主服务的 `/mcp/blender`，**凭据复用主 token**。旧实现给桥
 * 单独发一套 port + token、再经 `STUDIO_BLENDER_MCP_*` 环境变量注入 dsh，一旦端口被占或
 * token 不同步，dsh 会整轮起不来；同端口同 token 之后这两类故障整体消失。
 */
function getBlenderClientForHarness(): { endpoint: string } | null {
  const endpoint = getBlenderMcpEndpoint()
  return endpoint ? { endpoint } : null
}

/**
 * 第三方 MCP 服务的中转端点（与 Blender 工具面同端口、按路径分流）。
 *
 * 端口由调用方传入而不是读模块级 `mcpPort`：那个变量没有对外导出，而这里的调用点
 * 本来就持有 `McpServerInfo`（含 port），显式传参也免掉一层隐式全局状态。
 */
function externalMcpEndpoint(port: number, id: string): string {
  return `http://127.0.0.1:${port}${EXTERNAL_MCP_PATH_PREFIX}${id}`
}
function buildDshCatalogModelEntries(llm: {
  baseUrl?: string
  modelId: string
  modelName?: string
  inputModalities: ReadonlyArray<'text' | 'image'>
  provider?: ModelProviderInstance
}): Array<{ id: string; name: string; inputModalities: ReadonlyArray<'text' | 'image'> }> {
  const entries = new Map<
    string,
    { id: string; name: string; inputModalities: ReadonlyArray<'text' | 'image'> }
  >()
  const addEntry = (
    id: string,
    name: string | undefined,
    modalities: ReadonlyArray<'text' | 'image'>
  ): void => {
    const cleanId = id.trim()
    if (!cleanId || entries.has(cleanId)) return
    entries.set(cleanId, {
      id: cleanId,
      name: name?.trim() || cleanId,
      inputModalities: modalities.length > 0 ? modalities : (['text'] as const)
    })
  }

  addEntry(llm.modelId, llm.modelName, llm.inputModalities)

  if (llm.provider) {
    const textCfg = modalityConfig(llm.provider, 'text')
    const isGoogle =
      llm.provider.providerKind === 'google' ||
      /generativelanguage\.googleapis\.com/i.test(llm.baseUrl ?? '')
    const isOpenAi =
      llm.provider.providerKind === 'openai' || /\bapi\.openai\.com\b/i.test(llm.baseUrl ?? '')
    for (const rawSelected of textCfg.selectedModelIds ?? []) {
      const trimmed = rawSelected?.trim()
      if (!trimmed) continue
      const mods = resolveDshChatInputModalitiesForProvider(llm.provider, trimmed)
      const catName = textCfg.catalog?.[trimmed]?.name
      addEntry(trimmed, catName, mods)
      if (isGoogle) {
        const normalized = resolveGoogleChatModelId(trimmed)
        addEntry(normalized, catName || normalized, mods)
      } else if (isOpenAi) {
        const normalized = normalizeOpenAiTextModelId(trimmed, { hasTools: true })
        addEntry(normalized, catName || normalized, mods)
      }
    }
    if (isGoogle) {
      for (const fallbackId of GOOGLE_CHAT_FALLBACK_MODELS) {
        addEntry(fallbackId, fallbackId, ['text', 'image'])
      }
    } else if (isOpenAi) {
      for (const fallbackId of OPENAI_CHAT_FALLBACK_MODELS) {
        addEntry(fallbackId, fallbackId, ['text', 'image'])
      }
    }
  }

  return [...entries.values()]
}

function writeDshConfig(
  endpoint: string,
  mode: ChatMode,
  runId: string,
  blenderClient: { endpoint: string } | null,
  /** 主 MCP 服务端口：第三方工具面的中转端点按 `http://127.0.0.1:<port>/mcp/ext/<id>` 拼 */
  port: number,
  llm?: {
    baseUrl?: string
    modelId: string
    modelName?: string
    inputModalities: ReadonlyArray<'text' | 'image'>
    provider?: ModelProviderInstance
  }
): void {
  const home = dshHome()
  mkdirSync(home, { recursive: true })
  // !!js 为 dsh 的 YAML 特殊语法：标签值必须是「合法 JS 表达式」，由 cordis-plugin-loader
  // 在加载配置时 eval 求值。环境变量在 spawn 时注入（token 不进命令行，也不落盘）。
  // 注意：YAML 引号只是 YAML 层语法，解析后交给 eval 的是引号内原文——
  // 因此不能写 !!js 'Bearer ${...}'（裸字符串不是 JS 表达式，eval 报 Unexpected identifier）。
  // 正确写法是把 JS 模板字符串（反引号）包进 YAML 引号：!!js "`Bearer ${...}`"。
  const patch = [
    '# AIArtEngine 生成的 dsh 配置，请勿手改。',
    '# dsh 的 patch 语义：`- id` 只能修补已有条目，新增插件必须用 `- insert:`',
    '- insert:',
    '  - id: mcp-studio',
    "    name: '@deepseek-ai/dsh-mcp-client'",
    '    config:',
    '      serverName: studio',
    '      transport: streamable-http',
    `      url: ${endpoint}`,
    // dsh-mcp-client 默认单次工具调用超时 60s；generate_model3d / generate_video 等
    // 是「提交后阻塞轮询到生成完成」的调用，Lux3D/视频生成常需数分钟，60s 必超时，
    // 导致 Agent 误以为提交失败而重复提交。调到 120 分钟与 LONG_GENERATE_TIMEOUT_MS 对齐。
    '      toolCallTimeoutMs: 7200000',
    '      headers:',
    '        Authorization: !!js "`Bearer ${process.env.STUDIO_MCP_TOKEN}`"',
    // 面板模式与本次运行 id：MCP 侧据此收窄工具面并拒绝越权调用。
    // 值一律经 yamlScalar 序列化成 YAML 字符串：dsh-mcp-client 的 headers schema 是
    // `{ [key: string]: string }`，裸写纯数字的 runId 会被 YAML 解析成 number，整棵插件树
    // 校验失败、dsh 直接起不来（实测报 invalid config: ... but got {"x-aiart-run-id":1}）。
    // 载荷由 accessHeaders 产出（值类型锁死为 string），这里只负责 YAML 序列化。
    ...Object.entries(accessHeaders(mode, runId)).map(
      ([key, value]) => `        ${key}: ${yamlScalar(value)}`
    )
  ]
  // 第二个 mcp-client 实例：指向主 MCP 服务的 Blender 工具面路径（应用内建，无子进程）。
  // 未启用时不写这一段，dsh 就只看到本应用的工具面。
  if (blenderClient) {
    patch.push(
      '- insert:',
      '  - id: mcp-blender',
      "    name: '@deepseek-ai/dsh-mcp-client'",
      '    config:',
      '      serverName: blender',
      '      transport: streamable-http',
      `      url: ${blenderClient.endpoint}`,
      '      toolCallTimeoutMs: 7200000',
      '      headers:',
      // 与主工具面共用同一个 token：Blender 工具面挂在同一个服务上，不需要独立凭据。
      '        Authorization: !!js "`Bearer ${process.env.STUDIO_MCP_TOKEN}`"',
      // 模式与 runId 同样下发：Blender 侧会改场景（execute_blender_code 等属 write），
      // 必须和主工具面一样受面板模式约束，而不是成为绕过 Plan/Ask 的后门。
      ...Object.entries(accessHeaders(mode, runId)).map(
        ([key, value]) => `        ${key}: ${yamlScalar(value)}`
      )
    )
  }

  /**
   * 第三方 MCP 服务：每条一个 mcp-client 实例，指向**本应用的中转端点**
   * （`/mcp/ext/<id>`），而不是外部服务本身。
   *
   * 为什么不直连外部服务：dsh 每轮下发的模式 / runId 头只有本应用的端点看得见。
   * 直连时那些头会被发给外部服务（多半直接忽略），Ask / Plan 的护栏就形同虚设；
   * 而且外部工具名可能与内建重名 —— 经应用中转这两件事都归位。
   */
  for (const server of settingsService.get().externalMcp) {
    const configured = normalizeExternalMcpServer(server)
    if (!configured || !configured.enabled) continue
    // 配置还不完好的（没填地址 / 命令）不挂：挂上去只会变成每次调用的报错
    if (externalMcpUnusableReason(configured)) continue
    patch.push(
      '- insert:',
      '  - id: mcp-ext-' + configured.id,
      "    name: '@deepseek-ai/dsh-mcp-client'",
      '    config:',
      `      serverName: ${yamlScalar('ext-' + configured.id)}`,
      '      transport: streamable-http',
      `      url: ${yamlScalar(externalMcpEndpoint(port, configured.id))}`,
      // 超时用该服务自己的值（内建那两条固定 2 小时是因为有长任务；第三方按用户配置）
      `      toolCallTimeoutMs: ${configured.timeoutMs}`,
      '      headers:',
      '        Authorization: !!js "`Bearer ${process.env.STUDIO_MCP_TOKEN}`"',
      // 与内建工具面同样受面板模式约束：这是「第三方工具不成为绕过 Plan/Ask 后门」的关键
      ...Object.entries(accessHeaders(mode, runId)).map(
        ([key, value]) => `        ${key}: ${yamlScalar(value)}`
      )
    )
  }

  // 同步修补 llm-deepseek / agent-default-model：不能只靠 settings.yaml。
  // settings-file 异步 publish；首轮 LLM 若仍读到内置 DEFAULT_MODELS，会把附图投影成
  // 「image omitted because this model accepts text only」，模型就回「不支持图片输入」。
  if (llm?.modelId) {
    const catalogEntries = buildDshCatalogModelEntries(llm)
    patch.push(
      '- id: agent-default-model',
      '  config:',
      '    provider: deepseek-official',
      `    model: ${yamlScalar(llm.modelId)}`,
      '- id: llm-deepseek',
      '  config:',
      ...(llm.baseUrl?.trim() ? [`    baseURL: ${yamlScalar(llm.baseUrl.trim())}`] : []),
      '    models:',
      ...catalogEntries.flatMap((entry) => [
        `      - id: ${yamlScalar(entry.id)}`,
        `        name: ${yamlScalar(entry.name)}`,
        '        inputModalities:',
        ...entry.inputModalities.map((m) => `          - ${m}`)
      ])
    )
  }

  writeFileSync(join(home, 'cordis.patch.yml'), patch.join('\n') + '\n', 'utf8')
}

/** YAML 双引号标量：JSON 字符串字面量对 YAML 兼容，且天然处理转义 */
function yamlScalar(value: string): string {
  return JSON.stringify(value)
}

/**
 * 写入 dsh 的 settings 文档（`$DSH_HOME/settings.yaml`），覆盖默认模型与端点。
 *
 * 背景：dsh 的模型选择不读取 `DSH_MODEL` 环境变量——`agentDefaultModel.currentSelection()`
 * 只从 settings 的 `agent-default-model` 一节读取；未设置时回落到 dsh-base 插件配置里的
 * 默认值 `deepseek-v4-flash`（provider `deepseek-official`）。该模型 ID 在 DeepSeek 官方
 * 以外的 OpenAI 兼容端点（或前缀裁剪后）多不存在，导致每次对话都报 HTTP_404，且与用户
 * 在面板里选中的模型无关。这里在每次任务前把用户选择的模型/端点写入 settings，覆盖默认值；
 * API Key 仍经 `DEEPSEEK_API_KEY` 环境变量透传（dsh 的 llm-deepseek 默认读它）。
 *
 * 另须写入 `llm-deepseek.models`：适配器对「不在内置目录」的模型默认 inputModalities=["text"]，
 * 附图时会被 LlmRuntime 投影成 text-only placeholder。OpenRouter 多模态模型须显式声明 text+image。
 * 仅写 settings.yaml 不够：settings-file 异步 publish，首轮可能仍用 composition 默认目录；
 * 同步修补见 writeDshConfig 对 `llm-deepseek` 的 cordis.patch.yml 条目。
 */
function writeDshSettings(provider: {
  baseUrl?: string
  modelId: string
  inputModalities: ReadonlyArray<'text' | 'image'>
  modelName?: string
  provider?: ModelProviderInstance
}): void {
  const home = dshHome()
  mkdirSync(home, { recursive: true })
  const catalogEntries = buildDshCatalogModelEntries(provider)
  const lines = [
    '# AIArtEngine 生成的 dsh 设置（模型选择/端点），请勿手改。',
    'agent-default-model:',
    '  provider: deepseek-official',
    `  model: ${yamlScalar(provider.modelId)}`,
    'llm-deepseek:',
    ...(provider.baseUrl?.trim() ? [`  baseURL: ${yamlScalar(provider.baseUrl.trim())}`] : []),
    '  models:',
    ...catalogEntries.flatMap((entry) => [
      `    - id: ${yamlScalar(entry.id)}`,
      `      name: ${yamlScalar(entry.name)}`,
      '      inputModalities:',
      ...entry.inputModalities.map((m) => `        - ${m}`)
    ])
  ]
  const content = lines.join('\n') + '\n'
  const hash = createHash('sha1').update(content).digest('hex')
  if (hash === lastSettingsWriteHash) {
    const path = join(home, 'settings.yaml')
    if (existsSync(path)) return
  }
  lastSettingsWriteHash = hash
  writeFileSync(join(home, 'settings.yaml'), content, 'utf8')
}

/** 当前正在执行的斜杠技能运行时上下文（用于 allowed-tools 自动放行与生命周期 Hooks） */
let activeSkillTurn: ActiveSkillTurnContext | null = null

/** dsh 示例技能模板文件名：不带 .md 后缀，避免被 dsh 的 skill-filesystem 扫描成真技能 */
const DSH_SKILLS_TEMPLATE_FILE = 'my-skill.example'

/**
 * 查询 dsh / Claude Code 技能目录信息（技能市场与设置页展示用）。
 * 自动清理旧版生成的 `.aiart-skill-manifest.json` 节点快照，并扫描个人级与工程级技能。
 */
export function getDshSkillsInfo(): DshSkillsInfo {
  cleanupLegacyDshSkills()
  const skillsDir = dshSkillsDir()
  const discovered = discoverInstalledClaudeSkills({
    personalSkillsDir: skillsDir,
    workspaceRoot: resolveWorkspace()
  })
  const githubRecordsByName = new Map(
    listInstalledGitHubSkillRecords(skillsDir).map((rec) => [rec.name, rec])
  )
  const files: DshSkillsFile[] = discovered.map((item) => {
    let githubRepo: string | undefined
    let githubRef: string | undefined
    if (item.layout === 'bundle') {
      try {
        const metaPath = join(dirname(item.skillFilePath), '.aiart-github-skill.json')
        if (existsSync(metaPath)) {
          const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as {
            owner?: string
            repo?: string
            resolvedRef?: string
          }
          if (meta.owner && meta.repo) githubRepo = `${meta.owner}/${meta.repo}`
          if (meta.resolvedRef) githubRef = meta.resolvedRef
        }
      } catch {
        // ignore
      }
      if (!githubRepo && item.scope === 'personal') {
        const rec = githubRecordsByName.get(item.name)
        if (rec?.owner && rec?.repo) {
          githubRepo = `${rec.owner}/${rec.repo}`
          if (rec.ref) githubRef = rec.ref
        }
      }
    }
    return {
      fileName: item.layout === 'bundle' ? item.name : basename(item.skillFilePath),
      kind:
        item.scope === 'project'
          ? 'project'
          : githubRepo
            ? 'github'
            : item.layout === 'bundle'
              ? 'bundle'
              : 'custom',
      title: item.frontmatter.name,
      description: item.frontmatter.description,
      hasScripts: item.hasScripts,
      hasWorkflow: item.hasWorkflow,
      extraFileCount: item.extraFileCount,
      scope: item.scope,
      argumentHint: item.frontmatter.argumentHint,
      userInvocable: item.frontmatter.userInvocable,
      disableModelInvocation: item.frontmatter.disableModelInvocation,
      allowedTools: item.frontmatter.allowedTools,
      model: item.frontmatter.model,
      context: item.frontmatter.context,
      agent: item.frontmatter.agent,
      whenToUse: item.frontmatter.whenToUse,
      ...(githubRepo ? { githubRepo } : {}),
      ...(githubRef ? { githubRef } : {}),
      version: item.frontmatter.version,
      author: item.frontmatter.author,
      license: item.frontmatter.license
    }
  })

  // 补充示例模板文件（如 my-skill.example）
  if (existsSync(skillsDir)) {
    try {
      for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
        if (!entry.isFile() || entry.name.startsWith('.') || entry.name.endsWith('.md')) continue
        const content = readSkillFileSafe(join(skillsDir, entry.name))
        const parsed = content ? parseClaudeSkillMarkdown(content, entry.name) : null
        files.push({
          fileName: entry.name,
          kind: 'template',
          title: parsed?.frontmatter.name ?? entry.name,
          ...(parsed?.frontmatter.description
            ? { description: parsed.frontmatter.description }
            : {})
        })
      }
    } catch {
      // ignore
    }
  }

  files.sort((a, b) => a.fileName.localeCompare(b.fileName))
  return {
    dirPath: skillsDir,
    builtinCount: 0,
    files
  }
}

/** 读技能文件内容；读不到返回 undefined（界面回落为只显示标题，不该为此报错） */
function readSkillFileSafe(filePath: string): string | undefined {
  try {
    return readFileSync(filePath, 'utf8')
  } catch {
    return undefined
  }
}

/** 在系统文件管理器中打开 dsh 技能目录（不存在则先创建） */
export async function openDshSkillsDir(): Promise<void> {
  const skillsDir = dshSkillsDir()
  mkdirSync(skillsDir, { recursive: true })
  const error = await shell.openPath(skillsDir)
  if (error) throw new Error(error)
}

/** 写入一个示例 SKILL.md 模板；同名文件已存在时跳过（不覆盖用户可能改动过的内容） */
export function writeDshSkillsTemplate(): DshSkillsTemplateResult {
  const skillsDir = dshSkillsDir()
  mkdirSync(skillsDir, { recursive: true })
  const filePath = join(skillsDir, DSH_SKILLS_TEMPLATE_FILE)
  if (existsSync(filePath)) return { filePath, skipped: true }
  writeFileSync(filePath, renderDshSkillsTemplate(), 'utf8')
  return { filePath, skipped: false }
}

const BUILTIN_HARNESS_SLASH_COMMANDS: SessionSkill[] = [
  {
    name: 'compact',
    kind: 'builtin',
    description: '压缩当前会话上下文，释放 Token 空间并保留关键创作与执行摘要',
    argumentHint: '[focus]',
    userInvocable: true
  },
  {
    name: 'goal',
    kind: 'builtin',
    description: '启动或管理多轮自主目标执行器（/goal <目标> | status | pause | resume | end）',
    argumentHint: '<objective | status | pause | resume | end>',
    userInvocable: true
  },
  {
    name: 'feedback',
    kind: 'builtin',
    description: '记录对当前会话或 Agent 表现的反馈日志（正面/负面评价与说明）',
    argumentHint: '[positive|negative] <comment>',
    userInvocable: true
  },
  {
    name: 'export',
    kind: 'builtin',
    description: '将当前会话完整日志导出为 .zip 压缩包并生成交付卡片',
    userInvocable: true
  }
]

/** 查询本次会话可用的技能清单（含内置斜杠指令与完整 Claude Code 元数据，供对话 `/` 斜杠菜单与技能调试视图展示） */
export function getSessionSkills(): SessionSkill[] {
  const discovered = discoverInstalledClaudeSkills({
    personalSkillsDir: dshSkillsDir(),
    workspaceRoot: resolveWorkspace()
  })
  const customSkills: SessionSkill[] = discovered.map((item) => ({
    name: item.name,
    kind: 'custom',
    description: item.frontmatter.description,
    argumentHint: item.frontmatter.argumentHint,
    userInvocable: item.frontmatter.userInvocable,
    disableModelInvocation: item.frontmatter.disableModelInvocation,
    allowedTools: item.frontmatter.allowedTools,
    model: item.frontmatter.model,
    context: item.frontmatter.context,
    agent: item.frontmatter.agent,
    hasScripts: item.hasScripts,
    hasWorkflow: item.hasWorkflow,
    scope: item.scope
  }))
  const customNames = new Set(customSkills.map((s) => s.name))
  return [
    ...BUILTIN_HARNESS_SLASH_COMMANDS.filter((b) => !customNames.has(b.name)),
    ...customSkills
  ]
}

/** 示例 SKILL.md 模板：完整展示 Claude Code 技能规范（frontmatter + 变量插值 + 动态上下文） */
function renderDshSkillsTemplate(): string {
  return [
    '---',
    'name: my-skill',
    'description: 示例 Claude Code 技能：说明本技能的作用以及何时应当调用它。',
    'argument-hint: "[subject] [style]"',
    'user-invocable: true',
    'disable-model-invocation: false',
    'allowed-tools: Read, Grep, Glob',
    'context: inline',
    '---',
    '',
    '# 技能执行指南',
    '',
    '当用户通过 `/my-skill $ARGUMENTS` 调用或模型自动匹配本技能时，按以下步骤执行：',
    '',
    '- 首个参数（主体）：`$0`',
    '- 第二个参数（风格）：`$1`',
    '- 技能目录路径：`${CLAUDE_SKILL_DIR}`',
    '',
    '## 步骤',
    '1. 明确创作或开发目标',
    '2. 调用合适的工具完成任务',
    '3. 检查产出并向用户汇报结果',
    ''
  ].join('\n')
}

/** 思考过程在 dsh stdout 中的包裹标记：自定义 runner 输出，主进程据此切分事件 */
const REASONING_BEGIN = '===BEGIN_REASONING==='
const REASONING_END = '===END_REASONING==='
/** 工具调用标记：runner 在 skill/MCP 工具开始与结束时各输出一行（JSON 载荷） */
const TOOL_BEGIN = '===BEGIN_TOOL==='
const TOOL_END = '===END_TOOL==='
/** ask_user_question 提问标记：runner 把原生 userQuestions 提问转发给主进程（单行 JSON 载荷） */
const ASK_USER_BEGIN = '===BEGIN_ASK_USER==='
/**
 * 审批请求标记：审批应答插件把 dsh 的 approval/request 转发给主进程（单行 JSON 载荷）。
 * 字面量必须与 `aiartApprovalAnswerer.template.mjs` 里的 APPROVAL_BEGIN 逐字一致（测试钉住）。
 */
const APPROVAL_BEGIN = '===BEGIN_APPROVAL==='
/** 上下文用量标记：runner 每轮 LLM 请求完成后输出（单行 JSON 载荷，provider usage） */
const CONTEXT_BEGIN = '===BEGIN_CONTEXT==='
/** Todo 进度看板标记：runner 监听 todo/write 事件后输出（单行 JSON 载荷） */
const TODO_BEGIN = '===BEGIN_TODO==='
/** 多轮目标状态标记：runner 监听 goal/change 与多轮续跑后输出（单行 JSON 载荷） */
const GOAL_BEGIN = '===BEGIN_GOAL==='
/** 交付物展示标记：runner 监听 deliverables/presented 事件后输出（单行 JSON 载荷） */
const PRESENT_BEGIN = '===BEGIN_PRESENT==='
/** 会话内定时提醒标记：runner 监听 schedule/change 事件后输出（单行 JSON 载荷） */
const SCHEDULE_BEGIN = '===BEGIN_SCHEDULE==='
/** 子代理并发实时树标记：runner 监听子代理创建/工具调用/完成状态后输出（单行 JSON 载荷） */
const SUBAGENT_BEGIN = '===BEGIN_SUBAGENT==='
/** 盘中实时转向生效标记：runner 在注入 steer 指令后输出（单行 JSON 载荷） */
const STEER_BEGIN = '===BEGIN_STEER==='

/**
 * 影视 / 美术 / 3D / 剪辑四大领域专属子代理矩阵定义。
 * 写入 `$DSH_HOME/agents/<id>.md` 并注入系统提示词，供 `subagent` / `subagent_fork` 并发调度。
 */
export const STUDIO_DOMAIN_SUBAGENTS = [
  {
    id: 'storyboard-director',
    name: 'storyboard-director',
    mode: 'craft',
    title: '分镜与剧本导演 (Storyboard Director)',
    description:
      'Breaks down scripts into structured shot lists, character consistency sheets (Series Bible), camera angles, and text.plain -> film.workbench canvas pipelines.',
    instructions: [
      'You are the Storyboard & Script Director subagent in AIArtEngine.',
      'Focus on script analysis, scene/shot breakdown, character consistency (in-cast/out-cast), camera movement, and building or updating text.plain -> film.workbench -> film.shot canvas nodes via graph_read, graph_edit, and task_run.',
      'Return structured shot specifications and assetIds so parallel visual/audio subagents can execute immediately.'
    ]
  },
  {
    id: 'visual-asset-artist',
    name: 'visual-asset-artist',
    mode: 'craft',
    title: '美术与视觉资产师 (Visual Asset Artist)',
    description:
      'Generates and refines 2D keyframes, character turnarounds, lighting variants, 10-in-1 image edits (cutout/matte/inpaint/upscale), and SVG vector animations via canvas nodes.',
    instructions: [
      'You are the Visual & 2D Asset Artist subagent in AIArtEngine.',
      'Orchestrate canvas nodes via graph_edit and execute them live via task_run: asset.image, image.process (cutout, matte, redraw, upscale, gridSplit), image.multiAngle, image.lighting, image.Consistent, and svg.gen -> svg.anim + render_svg.',
      'Always perform visual self-critique on attached preview images (composition, character consistency, anatomy, transparency) before reporting completion.'
    ]
  },
  {
    id: 'blender-3d-director',
    name: 'blender-3d-director',
    mode: 'craft',
    title: '3D 场景与绑定导演 (Blender & 3D World Director)',
    description:
      'Creates 3D models (asset.model3d), 3DGS spatial worlds (spatialWorld.generate), skeletal rigging/animation (model3d.rig), and operates Blender MCP scenes.',
    instructions: [
      'You are the Blender & 3D World Director subagent in AIArtEngine.',
      'Create and run canvas nodes via graph_edit + task_run (asset.model3d, model3d.rig, model3d.segment, model3d.postProcess, spatialWorld.generate, spatialWorld.export) and use Blender MCP tools to build, rig, pose, light, and render 3D assets.',
      'Verify 3D viewport screenshots or exported GLB assets before finishing.'
    ]
  },
  {
    id: 'timeline-audio-editor',
    name: 'timeline-audio-editor',
    mode: 'craft',
    title: '配音与成片剪辑师 (Timeline & Audio Editor)',
    description:
      'Produces multi-speaker dialogue (voice.dialogue), narration (voice.tts), SFX (audio.sfx), BGM (audio.music), subtitle alignment, rough cuts, and timeline previews.',
    instructions: [
      'You are the Timeline & Audio Editor subagent in AIArtEngine.',
      'Create and run audio canvas nodes via graph_edit + task_run (voice.dialogue, voice.tts, audio.sfx with loop: true for ambience, audio.music), and use transcribe_audio, timeline_edit, timeline_rough_cut, and timeline_preview.',
      'After editing the timeline, call timeline_preview to visually inspect rendered frames (subtitles, overlays, transitions) before timeline_export.'
    ]
  }
] as const

function writeDomainSubagentProfiles(home: string): void {
  try {
    const agentsDir = join(home, 'agents')
    mkdirSync(agentsDir, { recursive: true })
    for (const profile of STUDIO_DOMAIN_SUBAGENTS) {
      const filePath = join(agentsDir, `${profile.id}.md`)
      const content = [
        '---',
        `name: ${profile.id}`,
        `description: ${JSON.stringify(profile.description)}`,
        '---',
        '',
        `# ${profile.title}`,
        '',
        ...profile.instructions,
        ''
      ].join('\n')
      if (!existsSync(filePath) || readFileSync(filePath, 'utf8') !== content) {
        writeFileSync(filePath, content, 'utf8')
      }
    }
  } catch {
    /* ignore */
  }
}

/**
 * 从 dsh 运行入口向上定位其 node_modules 根（依赖 @deepseek-ai/* 都在同一棵树下）。
 * 返回绝对路径；向上 8 层仍找不到则返回 null（视为无法解析依赖，跳过注入）。
 */
function locateNodeModules(entry: string): string | null {
  let dir = dirname(entry)
  for (let i = 0; i < 8; i++) {
    if (basename(dir) === 'node_modules') return dir
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
  return null
}

/**
 * 按 Chat 面板模式生成 dsh system-prompt personaPrefix（YAML 折叠块延续行，缩进 6 空格）。
 * - craft：完整 agent，优先用 MCP 工具；需要用户选择/确认时用 ask_user 工具
 * - ask：纯问答，禁止调用工具与改动任何文件
 * - plan：先输出执行计划，用 ask_user 请求用户确认，确认后才允许执行工具
 *
 * projectMemory：工程级 Agent 记忆原文（`.aiartengine/memory.md`），
 * 压缩为单行段注入，保证在 YAML 折叠块中安全并保留语义。
 */
function buildPersona(mode: ChatMode, projectMemory?: string | null): string[] {
  const memory = projectMemory?.trim()
  const memoryBlock = memory
    ? [
        '=== Project memory ===',
        "The following is this project's persisted memory (style / camera / character / other preferences).",
        'Always follow these preferences when generating content for this project.',
        memory
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean)
          .join(' | ')
      ]
    : []
  const base = [
    ...memoryBlock,
    'You are a helpful assistant in AIArtEngine. You have access to MCP tools provided by the studio.',
    'Prefer using the available MCP tools to complete the user request.',
    'Only write code when no suitable tool is available.',
    '=== Mandatory Canvas-First Generation & Execution Protocol (Live Canvas Nodes Only) ===',
    'ALL media, narrative, and game-design generation/processing tasks (image, video, speech/TTS, multi-speaker dialogue, sound effects/SFX, music/BGM, 3D models, 3D rigging/segmentation/post-processing, 3DGS spatial worlds, Game Economy & Numerical Systems `game.economy`, Novel & Long-Drama Serialization `asset.novel`, and Game System Design Documents / GDD `asset.gameSystem`) MUST be executed by creating or updating nodes on the canvas via `graph_edit` and running them live via `task_run` (NEVER satisfy a request to write a novel, design a game economy/numerical system, or write a game system GDD by merely dumping plain text in the chat reply or writing a local `.md` file!):',
    'Step 1 (Edit/Create Canvas Nodes via `graph_edit`): Call `graph_edit({ assetId, ops: [...] })` on the active canvas (you may pass `assetId` from `[Workspace Canvas & Node Context]` or omit `assetId` so the studio automatically targets the open canvas or creates and opens a new free canvas in the left window).',
    'If the user is asking to generate a new item (e.g. "生成一只小猫", "写一部修仙小说并设计经济系统", "生成肉鸽卡牌策划案"), use `op: "node_upsert"` (or reuse/update the selected node on the canvas if appropriate):',
    '(a) Image generation: `typeId: "asset.image"`, `params: { prompt, aspectRatio, model, providerInstanceId, count, generateTransparentBg, referenceImageUrls }` (`generateTransparentBg` defaults to `true`; when enabled, transparent-capable models generate transparent PNGs and other models generate normal opaque images without post-generation background removal; set `generateTransparentBg: false` when the user explicitly requests a non-transparent/opaque background or full environment scene)',
    '(b) Video generation: `typeId: "asset.video"`, `params: { prompt, aspectRatio, duration, generateAudio, model, providerInstanceId, firstFrameImageUrl, lastFrameImageUrl, referenceImageUrls }`',
    '(c) Speech / Narration (TTS): `typeId: "voice.tts"`, `params: { prompt, voice, voiceProfile, model, providerInstanceId }`',
    '(d) Multi-speaker Dialogue: `typeId: "voice.dialogue"`, `params: { script, voices, voice, voiceProfile, model, providerInstanceId }`',
    '(e) Sound Effect / Ambience (SFX): `typeId: "audio.sfx"`, `params: { prompt, loop, durationSeconds, promptInfluence, model, providerInstanceId }` (use `loop: true` for seamless ambience)',
    '(f) Music / BGM: `typeId: "audio.music"`, `params: { prompt, lyrics, instrumental, model, providerInstanceId }`',
    '(g) 3D Model generation & processing: `typeId: "asset.model3d"` (`params: { prompt, style, model, providerInstanceId, referenceImageUrls }`), `model3d.rig` (rigging), `model3d.segment` (part segmentation), `model3d.postProcess` (retopology / meshComplete / retarget / convert)',
    '(h) Spatial World generation & export: `typeId: "spatialWorld.generate"` (`params: { prompt, model, seed, panoMode, disableRecaption, referenceImageUrls, referenceVideoUrl }`), `spatialWorld.export`',
    '(i) Game Economy & Numerical System (`经济与数值系统`): `typeId: "game.economy"`, `preset: "slay_the_spire_dbg" | "genshin_gacha" | "diablo_arpg" | "lol_moba" | "idle_tycoon" | "battle_royale"`, `params: { prompt, gameEconomyTemplateId, gameEconomySteps, gameEconomyMonteCarloRuns, gameEconomySeed, gameEconomyWorkbench }` — runs Monte Carlo flow simulation + 4-stage numerical workbench (Multiplier Pipeline, Loot & Substat Roll, Combat TTK/EHP Kernel, Roguelike Deck/Encounter Envelope) and outputs structured economy specification text on port `out-text`.',
    '(j) Novel & Long-Drama Serialization (`创建小说`): `typeId: "asset.novel"`, `preset: "xianxia_cultivation" | "cyber_apocalypse" | "urban_suspense" | "ancient_court"`, `params: { prompt, novelTargetEpisodes, novelGenre, novelTone, novelChapterWords, novelChapters, novelCharacters, novelFactions, novelLocations, novelBibles }` — builds the Story Bible (characters, factions, locations, realm/item rules) + multi-chapter outline & full novel prose, accepting upstream `game.economy` (`out-text` -> `in`) so the novel world/cultivation/currency/combat power scaling strictly follows the numerical economy, and outputting chapters on `out` / `out-all`.',
    '(k) Game System Design Document / GDD (`策划案生成`): `typeId: "asset.gameSystem"`, `preset: "arpg_combat" | "roguelike_dbg" | "slg_kingdom" | "mmo_economy" | "survivor_bullet" | "avg_narrative"`, `params: { prompt, gameGenre, gameArtStyle, gamePlatform, gamePerspective, gameSyncMode, gameSystemTargetModules, gameSystemFocus, gameSystemIncludeNumerical, gameSystemIncludeUiFlow, gameSystemIncludeStateFlow }` — accepts upstream `game.economy` (`out-text` -> `in`) and/or `asset.novel` (`out` or `out-all` -> `in`), generates structured system modules (overview, core loop, state machine, numerical tables, UI flow, edge rules), and outputs full Markdown specs on `out` / `out-all` (which can further wire into `ui.split` `in`).',
    'Step 2 (Execute Live on Canvas via `task_run`): Immediately after `graph_edit`, call `task_run({ assetId, nodeIds })` (passing the `assetId` and `nodeIds` returned by `graph_edit`, or simply `task_run({})` to run the just-edited canvas nodes). `task_run` executes the nodes on the live canvas with real-time progress spinners, updates the node preview in place, waits until completion by default, and returns `{ relativePath, relativePaths }` plus visual inspection images.',
    'The user may reference project assets by writing @ followed by a workspace-relative path (e.g. @Assets/Images/foo.png).',
    'Image references are attached to your user message as image blocks, so you can see the picture content directly.',
    'Each image is followed by its @path text: pass that same @path in `graph_edit` node `params` (`referenceImageUrls` / `firstFrameImageUrl` / `lastFrameImageUrl` / `referenceVideoUrl`) — `graph_edit` will automatically create locked upstream reference media nodes on the canvas and wire them to the target node ports!',
    'For AI video generation (`asset.video`) with reference images: a single image is the first frame (`firstFrameImageUrl`); when the user provides two images for AI start/end-frame video generation, the first one is `firstFrameImageUrl` and the second one is `lastFrameImageUrl`. However, when the user provides multiple photos and asks for a Music Photo Album / Slideshow / Photo MV (e.g. "给定几张照片帮我生成音乐相册" / "电子相册" / "把这几张图合成配乐视频"), DO NOT use `asset.video` — wire the locked photo nodes (`typeId: "asset.image", locked: true, params: { sourceRelativePath }`) + a BGM node (`typeId: "asset.music"`) directly into `output.timeline` (`成片时间线`) and run `task_run({ nodeIds: ["timeline-out"] })`!',
    'When the user asks for "一镜入画" / "古画活起来" / "古画复活" / "名画复活" / "让这幅画动起来并解说" (e.g. "帮我做一个一镜入画视频", with or without an attached painting like `@Assets/qm-jpg.jpeg`), NEVER create a single long-take `asset.video` node directly from the full scroll! You MUST build the multi-act ancient-scroll revival pipeline (or call `workflow_use_installed({ id: "ancient-scroll-revive" })`) so the timeline edits multiple segments together: for each act (`N = 1..K`, defaulting to 3 acts when the user does not specify a count, or any `K` acts requested by the user), (1) pan across the original painting to the focus area and crop a 16:9 focus frame (`actN-crop`, `typeId: "image.process", params: { imageProcessTool: "crop", imageCrop: { aspectId: "16:9", ... } }`), (2) analyze scene & dialogue/narration (`actN-recognize`, `typeId: "image.toPrompt"`), (3) generate a 1:1 photorealistic restored photo from that focus crop (`actN-real`, `typeId: "asset.image", params: { aspectRatio: "16:9", generateTransparentBg: false }` wired from `actN-crop` via `in-image`), (4) use `actN-real` as the FIRST FRAME (`toPort: "in-first-frame"`, `params: { generateFrameMode: "first", aspectRatio: "16:9", generateAudio: true }`) of the video node (`actN-video`, `typeId: "asset.video"`) and instruct `actN-video` to start from the 1:1 wide restored photo for the first 1.5s and then smoothly zoom/push the camera in (`镜头从全景平滑拉近推入画中对应焦点人物的近景特写`) to the specific talking figures in the scene with lip-synced dialogue audio, and (5) wire all `actN-crop` (`toPort: "in-image"`), `actN-video` (`toPort: "in"`), `actN-voice` (`typeId: "asset.voice"`, `toPort: "in-voice"`), `actN-sfx` (`typeId: "asset.sfx"`, `toPort: "in-voice"`), and `bgm` (`typeId: "asset.music"`, `toPort: "in-music"`) into `output.timeline` (`nodeId: "timeline-out"`) and run `task_run({ nodeIds: ["timeline-out"] })`!',
    'The mode stated for the current turn is authoritative: the user may switch modes between turns of this same session.',
    "Never carry over a previous turn's mode name, and never repeat an earlier claim that tools are unavailable unless this turn says so.",
    '=== Headless browser is unavailable ===',
    'Shell commands run inside the harness sandbox, where some host programs cannot start at all.',
    'Never launch a local browser from a shell command (msedge.exe / chrome.exe, including any --headless or --remote-debugging-port run):',
    'under the sandbox restricted token Chromium cannot create its internal IPC pipe, so it aborts with exit code 0x80000003 (STATUS_BREAKPOINT)',
    'and Windows pops a modal application-error dialog in front of the user while the command fails anyway.',
    'Such commands are refused before they run: the harness rejects any shell command that launches a browser and answers with exactly this policy reason,',
    'so trying another browser, path, flag, script file or wrapper only wastes a turn.',
    'Do not retry with --no-sandbox or any other flag, and never try to escalate or bypass the sandbox just to run a browser.',
    'To rasterize or visually check an SVG or HTML artifact, call the render_svg tool instead:',
    'it renders the file with the app own engine and returns the picture to you, with no browser involved.',
    'To render and extract any external web page or technical article URL (including SPA/JS pages, WeChat Official Accounts, Zhihu, Juejin, CSDN, Medium, or docs) together with its embedded figures/diagrams, call the studio MCP tool `web_extract_article({ url })`: it runs a real local headless Chromium browser inside the privileged host process, scrolls to trigger lazy-loaded `data-src` images, extracts structured Markdown, and automatically downloads the article images into `Cache/imports/` for direct use on canvas nodes.',
    'To search and download movie / TV / comedy sketch iconic scene video clips by movie name or Bilibili URL / BV ID (e.g. for Guichu / YTPMV beat remixing with `wf-guichu-remix`), call the studio MCP tool `web_fetch_video({ query, url, count, maxDurationSec })`: it searches Bilibili for clean iconic scene clips, downloads the MP4 stream into `Cache/imports/...`, and returns `relativePath` ready for `transcribe_audio`, `detect_video_keyframes`, `grab_video_frames`, and `timeline_edit`.',
    'To bake assets into the project, use the studio path: wire `svg.gen` into `svg.anim` on the active canvas via `graph_edit` and run `task_run`, then read the baked PNG frames and the GIF reported by the task result.',
    'If a check genuinely needs a real browser, stop and tell the user to run it outside the app.',
    '=== Generated media must not land in the project root ===',
    'Never write image/video/audio/3D files into the workspace root (cwd) with shell, Save-File, or relative paths like ./foo.png or .\\bar.mp4.',
    'Always create media by editing canvas nodes via `graph_edit` and executing them via `task_run`: they save under Cache/Images (or Cache/Videos, Cache/Voices, Cache/Sfx, …) automatically and update the canvas nodes in real time.',
    'Pick the audio node by what the audio IS, not by the word "audio": speech (lines / narration) → `voice.tts`; ambience, foley and non-speech effects (rain, wind, footsteps, UI clicks, explosions) → `audio.sfx`; a conversation between named speakers → `voice.dialogue`; music / BGM → `audio.music`.',
    'Never satisfy a sound-effect or ambience request with `voice.tts`: it would read the description aloud as narration, which is the wrong result and still costs a call.',
    'For a seamless ambience loop, pass `loop: true` in `audio.sfx` node params; otherwise the seam is audible when the clip repeats.',
    'If you need a file on disk after generation, read the `relativePath` returned by `task_run` — never invent a path at the project root.',
    '=== Playable HTML games (one-sentence game) ===',
    'FIRST choice: if the request fits one of the 5 sandbox genres — survivor (top-down horde / roguelike / bullet heaven), platformer (side-scroller), tower_defense, card_dbg (deck-builder card battle), avg_dialogue (visual novel / branching story) — call `game_one_sentence_create` ONCE with `prompt` (the user sentence verbatim) plus as many spec fields as you can infer: English `artStyle`, `hero.look`, `enemy.look`, `tile.look`, `difficulty`, `cards` for card_dbg, `dialogues` (with valid choices[].nextId) for avg_dialogue.',
    'It builds the whole image-generation → keying → level/audio → playable-sandbox workflow and shows a game card in the chat. It does NOT run the graph unless the user ticked "Auto-run after generation" on that card: never call task_run on it yourself — relay `nextStep`, and state any `scopeNotes` (parts of the request that were simplified) honestly.',
    'Use the code path below only for custom mechanics, real 3D, or when the user explicitly wants hand-written game code:',
    'gameplay_prepare_project → write src/** with your own file tools → gameplay_build → poll gameplay_job_status until done.',
    'All art and audio must be generated by the code you write (procedural geometry, Canvas-painted textures, WebAudio SFX, seeded levels); load the gameplay-proc-assets skill for the asset-layer conventions.',
    'Never run npm / npm install / node build.mjs yourself — the host cooks the project, and the finished build appears in the conversation as a card whose Play button opens the sandbox window.',
    'Every successful build is followed by a playtest gate: read the smoke report from gameplay_job_status and fix the reported errors (uncaught exception / load failure / black screen / no rendered frame) with one more edit-and-rebuild round before telling the user it is done.',
    '=== Tutorial / how-to screen recording ===',
    'When the user asks to record a tutorial (e.g. “录制一个图片生成节点教程”), load tutorial-recording and shoot ONE continuous take.',
    'SAY=SHOW: caption actions must be real — right-click via doContextMenu + graph-ctx-*; select via node_select; doDblClick opens instruction panel / notepad / dive (graph-instruction-*, graph-notepad*, graph-dive / graph-dive-view-*); run via doClick graph-run then screen_record_wait(graph-idle); never silent create/params/run; never stop right after run click.',
    'Start from a blank free canvas (asset_create type=canvas + openEditor). No background task_run while recording; no self-restart spam.',
    'From start through tutorial_compose stay in one tool chain. After stop, tutorial_compose with steps[{index,narration,caption}]. Library save is the chat-card button only.',
    '=== Project Canvas & Built-in Node Capabilities ===',
    'Every user message automatically includes a [Workspace Canvas & Node Context] block summarizing everything currently open in the left workspace window and right-hand Inspector panel: the root canvas asset, the Left Window Dive Breadcrumb stack, any open 3D Director Stage / 3D Storyboard Previz, the Frontmost Dive View, and the [Active Inspector Panel State].',
    'When the user asks to modify anything in the left window or right-hand Inspector (e.g. "隐藏林小满", "把林小满移到左边并旋转45度", "切换FK/IK姿态", "把摄像机焦距改成50并开启跟随", "修改天光为深蓝并开启雾效", "修改节点指令/系统提示词/比例", "修改全局画风"), inspect the [Workspace Canvas & Node Context] first and execute the change in 1 SINGLE tool call:',
    'Rule 1 (CRITICAL): NEVER use `read`, `grep`, `glob`, `edit`, `write`, or `str_replace_editor` on `.canvas.asset.json` or any `Assets/**/*.json` file, and NEVER use `ui_click` / `ui_bounds` to edit 3D stage objects, canvas nodes, or Inspector fields! Editing `.canvas.asset.json` on disk does NOT update the live 3D WebGL scene or Vue Inspector and will be overwritten.',
    'Rule 2 (3D Director Stage): When [Active 3D Director Stage in Left Window] is present, call `mcp__studio__graph_edit({ assetId, nodeId, ops: [...] })` (or `mcp__studio__director_stage_edit({ assetId, nodeId, ops: [...] })`) in 1 single call. Both tools accept the exact same 3D stage `ops` (`object_update`, `hide_object`, `show_object`, `lock_object`, `unlock_object`, `object_add`, `object_delete`, `object_duplicate`, `object_select`, `camera_update`, `camera_add`, `camera_delete`, `lighting_preset`, `environment_update`, `viewport_update`, `ai_blocking`, `cinemachine_pack`, `storyboard_previz`, `capture_shot`, `anim_control`, `inspector_update`). You can target objects/cameras by `name` (e.g. `{ op: "hide_object", name: "林小满" }` or `{ op: "object_update", name: "林小满", visible: false, positionDelta: { x: 1 }, rotationDeltaDeg: { y: 45 } }`) or omit `name`/`objectId` to target the currently selected Inspector object/camera.',
    'Rule 3 (Node & Inspector Live Editing): When editing any Node Inspector or dived node workbench (`game.economy`, `asset.novel`, `asset.gameSystem`, `film.workbench`, `comic.page`, `anim.2d`, `stage.2d`, `image.process`, `image.multiAngle`, `image.lighting`, `image.adVariants`, `node.instruction`, etc.), call `mcp__studio__graph_edit({ assetId, hostId, ops: [{ op: "node_update", nodeId, title, locked, params: { ... } }] })` (supports shorthand params: `prompt`/`instruction`, `systemPrompt`, `model`, `aspectRatio`, `resolution`/`size`, `count`, `useGlobalStyle`, `styleImages`, `voiceCharacter`, plus all raw node params, `op: "apply_preset"`, and `op: "node_dive"` to open the node Dive workbench in the left window). For Project Globals Inspector use `op: "project_globals_update"`, and for Asset Inspector use `op: "asset_update"`.',
    'Rule 4 (Timeline Editor): When the user is dived into `script.timeline` (Video Compose / Timeline Editor), use `timeline_read({ assetId })` and `timeline_edit({ assetId, operations })` or `timeline_rough_cut` — open timeline editors automatically reload live.',
    'Rule 5 (Active Canvas & Minimal Viable Graph): Always inspect via `graph_read` if needed and build/edit nodes directly on the currently open canvas (`assetId` from `[Workspace Canvas & Node Context]`) using `graph_edit` (`node_upsert` + `edge_connect`) and execute via `task_run({ assetId, nodeIds })`. Only call `asset_create({ type: "canvas", openEditor: true })` if no canvas is open. NEVER create a `subgraph` package asset unless the user explicitly asks to encapsulate a reusable subgraph component, and NEVER call `skill_search` for built-in studio node capabilities. Build ONLY the minimal exact nodes requested by the user (e.g. if the user asks for 1 UI interface, create 1 `asset.image` node — never invent multiple unrequested screens or `note.text` instruction nodes).',
    'When a request matches any specialized studio node capability or multi-step production pipeline below, call `graph_node_types({ typeId, includeParams: true })` if you need exact ports/params, then wire the nodes on the active canvas with `graph_edit` and run `task_run`:',
    'Film / Short Drama / Storyboard / Cast & Shoot pipeline: for the full multi-episode short-drama pipeline (创建剧本 → 剧本分集 → 分集短剧工作台 → 成片时间线), wire `text.plain` (story outline) -> `asset.screenplay` (create multi-episode script with `【人物小传】` and `第1集：...` / `第2集：...` headers, outputting split episodes on `out-all`) -> multiple `text.select` nodes (`selectedTextId: "ep:1"`, `"ep:2"`, etc., extracting each episode script) -> per-episode `film.workbench` nodes (with Episode 1 `out-cast` wired into Episode 2 `in-cast` for Series Bible character/location reuse, plus optional `film.shot` for single-shot polish) + `asset.music` (BGM) -> `output.timeline` (`in-videos` + `in-music` for final MP4 composition).',
    'Image Editing 10-in-1 Workbench uses image.process (set params.imageProcessTool to cutout, matte, erase, redraw, expand, upscale, gridSplit, compose, crop, or transform) for background removal, AI matting, inpainting, outpainting, upscaling, grid slicing, and compositing.',
    'Portrait / Multi-Angle / Lighting / Character Consistency nodes use image.portrait (retouch & ID photos), image.multiAngle (turnaround sheets & 3D camera angles), image.lighting (3D studio relighting), and image.Consistent (emotion pad & locked identity).',
    'Ad Multi-Variant Matrix uses image.adVariants (params.adVariantMatrix) to batch-generate e-commerce or UA ad variants across audience, scene, tone, and copy dimensions.',
    '2D Frame Animation & 2D Stage Director use anim.2d (sprite sheet slicing/GIF baking, frame interpolation, 2D bones), image.align (sprite background keying, defringe, 9-slice, seamless tile), and stage.2d (multi-layer Z-depth stage, skeletal action baking, Spine export).',
    'SVG Vector & Animation use svg.gen -> svg.anim to generate pure vector SVG assets and bake SMIL animations into PNG frame sequences and GIFs.',
    'Knowledge / Popular-Science / Explainer Document-to-Video Pipeline: Whenever the user gives a short natural command like "根据下面文章生成科普视频" / "把这篇文档做成视频" / "生成知识解说视频" or provides a technical/popular-science article URL (e.g. "根据这个技术文章 URL 生成短视频", without needing to mention any node names), automatically build the complete Audio-First multi-node pipeline on the active canvas in a single `graph_edit` call and run the sink `output.timeline` node via `task_run`: (0) If the user provided a web URL and `[Studio Host Pre-Extracted Web Article]` is not already present in the prompt, first call `web_extract_article({ url })` to render the page with the local headless browser, extract structured Markdown, and download the article figures into `Cache/imports/...`; (1) Break the document into 3–5 clear sections (`分镜1`..`分镜N`); (2) For each section `i`, create a narration node (`typeId: "asset.voice"`, `nodeId: "voice-i"`, `title: "分镜i旁白"`, `params: { prompt: "该段口播旁白正文..." }`) and a matching visual node — if the section matches an extracted article figure from `Cache/imports/...`, wire that original figure directly as a locked image node (`typeId: "asset.image"`, `nodeId: "image-i"`, `title: "分镜i文章原图"`, `locked: true`, `params: { sourceRelativePath: "Cache/imports/..." }`) or pass it as `firstFrameImageUrl` / `referenceImageUrls: ["Cache/imports/..."]` on `asset.video` / `asset.image`; otherwise choose `svg.gen` (`aspectRatio: "16:9"`, `background: "black"`, with SMIL `<animate>`/`<animateTransform>` motion for mechanisms/flowcharts/data charts) wired into `svg.anim` (`nodeId: "svg-anim-i"`, `title: "分镜i原理动图"`, `aspectRatio: "16:9"`), or `asset.image` / `asset.video` (`title: "分镜i画面"`, `aspectRatio: "16:9"`); (3) Create a BGM node (`typeId: "asset.music"`, `nodeId: "bgm-1"`, `title: "科普背景音乐"`, `params: { prompt: "轻快温暖的科普背景纯音乐", instrumental: true }`); (4) Create `typeId: "output.timeline"` (`nodeId: "timeline-out"`, `title: "成片时间线"`) and connect all visual nodes (`svg-anim-i` / `image-i` / `video-i`), all `voice-i` nodes, and `bgm-1` into `timeline-out`; (5) Call `task_run({ assetId, nodeIds: ["timeline-out"] })` — `output.timeline` automatically runs all upstream nodes in topological order, probes each TTS voiceover duration to align every visual shot, generates synchronized sentence-level subtitles from each voice node script, mixes BGM with auto-ducking, and exports the final MP4.',
    'Music Photo Album / Slideshow / Photo-to-Video Pipeline: Whenever the user provides multiple photos (via `@Assets/...` or uploaded images) and asks to generate a music photo album / slideshow / photo MV (e.g. "给定几张照片帮我生成音乐相册" / "制作电子相册" / "把这几张照片做成带音乐的视频"), automatically build the `output.timeline` pipeline on the active canvas in a single `graph_edit` call and run `task_run({ assetId, nodeIds: ["timeline-out"] })`: (1) For each provided photo `i`, create a locked image reference node (`typeId: "asset.image"`, `nodeId: "photo-i"`, `title: "照片 i"`, `locked: true`, `params: { sourceRelativePath: "<photo @path>" }`) — or pass `referenceImageUrls: ["<@path1>", "<@path2>", ...]` directly on `output.timeline`; (2) Create a BGM node (`typeId: "asset.music"`, `nodeId: "bgm-1"`, `title: "相册背景音乐"`, `params: { prompt: "<matching mood/theme BGM description>", instrumental: true }`, or a locked `asset.voice`/`asset.music` node if the user provided an audio `@path`); (3) If the user also requested voiceover/narration for each photo, add `typeId: "asset.voice"` (`nodeId: "voice-i"`, `title: "照片 i 旁白"`) and connect to `timeline-out`; (4) Create `typeId: "output.timeline"` (`nodeId: "timeline-out"`, `title: "成片时间线"`) and connect all `photo-i` nodes (`toPort: "in-image"`) and `bgm-1` (`toPort: "in-music"`) into `timeline-out`; (5) Call `task_run({ assetId, nodeIds: ["timeline-out"] })` — `output.timeline` automatically applies Ken Burns camera push/pull/pan motion (`kenBurnsIn` / `kenBurnsOut` / `panRight` / `panLeft`) and smooth cross-dissolve transitions to every static photo, mixes the BGM track, and exports the final MP4.',
    'Semantic Video Analysis & Rebuild use semantic.analyze -> semantic.compile -> semantic.rebuild for shot-level video deconstruction, product/character replacement, and non-destructive video rebuild.',
    'Spatial World & 3D Rigging/Animation use world.graph -> world.panoramic -> world.extract -> world.splatView for 360 panoramas and 3DGS camera walkthroughs, and model.rigSkin -> model.pose -> model.animation for Blender 3D rigging, posing, and keyframe animation.',
    'Game Economy (`game.economy`), Novel Serialization (`asset.novel`), Game System GDD (`asset.gameSystem`) & Closed-Loop Pipeline: Whenever the user asks to design a game economy / numerical balance system (`经济系统` / `数值系统` / `掉落暴击乘区` / `战力膨胀仿真`), write a novel or serialized story (`写小说` / `长篇连载` / `世界观与章节`), or generate a game system specification / GDD (`游戏策划案` / `系统策划案`), ALWAYS create the corresponding canvas nodes via `graph_edit` and execute them via `task_run`! When the user asks for multiple together (e.g. "写一部小说并设计经济系统", or "设计经济系统、写小说并生成策划案"), wire them as a connected closed-loop pipeline on the active canvas in a single `graph_edit` call and run the sink node via `task_run`: `game.economy` (`fromPort: "out-text"`) -> `asset.novel` (`toPort: "in"`, so the novel incorporates the economy/currency/realm numerical system into its Story Bible and chapters) -> `asset.gameSystem` (`fromPort: "out"` or `"out-all"`, `toPort: "in"`, plus optional direct edge from `game.economy` `out-text` -> `asset.gameSystem` `in`) -> `ui.split` (`toPort: "in"`). You can also add `{ op: "node_dive", nodeId }` in `graph_edit` when the user wants to inspect the interactive Machinations/4-stage numerical workbench (`game-economy`), Novel Workbench (`novel-workbench`), or Game System Spec Workbench (`game-system-workbench`).',
    'Game UI, PSD Layer Split, Icons, Comic & Audio Compose: for a single UI interface + layer decomposition / PSD export (e.g. "创建仙侠游戏装备界面UI并拆分出PSD"), wire `asset.image` (generate the single UI screen) -> `image.layerSplit` (UI layer split, which decomposes the UI into a clean base + transparent widget PNG layers, auto-groups them into standard game UI PSD folders, and writes the `.psd` file to `Cache/Images/` under `out-psd` / `params.layerSplitPsdRelativePath`); use `asset.gameSystem` for game system GDD generation, and wire `asset.gameSystem -> ui.split -> ui.gen` when breaking down a multi-screen game system specification into UI screens. Use `image.iconPack` for batch icons, `comic.page` for manga/comic page layout, `voice.design` / `voice.tts` / `audio.music` / `audio.separate` for audio, and `output.timeline` for multi-track video/image/GIF/voice/music/subtitle timeline synthesis.',
    '=== Online Skill Search & GitHub Skill Installation ===',
    'ONLY when the user explicitly provides a GitHub skill URL (repo root, /tree/<branch>/<subpath>, /blob/.../SKILL.md, or raw.githubusercontent.com) or explicitly asks to search online and install a skill, use the studio skill MCP tools (`skill_search`, `skill_inspect_github`, `skill_install`, `skill_list`, `skill_uninstall`) or the `<skill>` block pre-installed by the host in the current turn:',
    '0. NEVER use `web_fetch` + `pwsh` / `write` / `edit` to manually create files under `$DSH_HOME/skills` or `%APPDATA%\\aiartengine\\dsh-harness\\skills` — that directory is outside the project workspace and blocked by the Windows ACL sandbox (`PermissionDenied`). Only `skill_install` (which runs in the privileged Electron host process) can install skills and update `.installed-github-skills.json`.',
    '1. Given a GitHub URL: if the host has already pre-installed and injected the `<skill>` block in your prompt, apply it directly; otherwise call `skill_install({ url, skillNames })` (or `skill_inspect_github({ url })` first to inspect a multi-skill repository).',
    '2. Asked to search online for a skill by topic/keyword: call `skill_search({ query })` (which searches official Claude Code skills `anthropics/skills`, the AIArtEngine Skill Market, and live GitHub repositories with SKILL.md verification), then call `skill_install({ url })` or `skill_install({ marketId })` to install the best match.',
    '3. Script safety: `skill_install` defaults to `allowScripts: false` (installing `SKILL.md` and `references/` while skipping `scripts/`). If a skill has `hasScripts: true` and running its bundled scripts is needed, ask the user via `ask_user_question` before calling `skill_install` with `allowScripts: true`.',
    '4. Immediate use: `skill_install` returns `skills[].instructions` (the full `SKILL.md` body) and `skillDir`, so you can immediately apply the newly installed skill in the current turn and inform the user they can also invoke it anytime via `/<skill-name>`.',
    '=== Native Harness Capabilities (Todo, Goal, Present, Schedule, StrReplaceEditor, Continuable Subagents) ===',
    'Use todo_write to maintain a structured task board (pending / in_progress / completed) for multi-step tasks so the user can track progress live in the chat panel.',
    'Use goal (start / update / pause / complete) or respond to /goal commands for multi-round autonomous objectives with verification criteria.',
    'Use present to showcase key deliverable files (images, videos, audio, code, documents, archives) with titles and descriptions as interactive deliverable cards in the chat panel.',
    'Use schedule (create / list / delete) when the user asks for a delayed reminder or recurring follow-up within the session.',
    'Both read/edit/write and str_replace_editor are available for file inspection and editing; subagent and subagent_fork support continuable background subagents via send_message.',
    '=== Visual Self-Critique & Director Verification Loop ===',
    'Studio tools (`task_run`, `task_status`, `render_svg`, and `timeline_preview`) automatically attach visual preview images to tool results so multimodal models can inspect the generated frames directly.',
    'Whenever you receive attached visual preview images (especially during `/goal` verification or multi-step `craft` pipelines), perform a director visual critique: verify composition, subject anatomy, lighting, character consistency against reference images, and subtitle/UI legibility.',
    'If a generated image, SVG frame, or timeline preview exhibits defects (broken anatomy, clipped subtitles, wrong aspect/style, or blank frame), adjust the canvas node parameters via `graph_edit` and re-run via `task_run` before calling `present` or completing the goal.',
    'When you receive a `[Live User Steering]` message mid-turn or a `[Reactive Canvas Event]` notification (such as `node_error` or `workflow_finished`), immediately adapt your next tool calls to honor the user steering or diagnose/repair the reported canvas node.',
    '=== Studio Domain Subagent Matrix (Parallel Production) ===',
    'For complex multi-shot dramas, multi-asset packs, or full film production pipelines, use `subagent_fork` or `subagent` (with `send_message` to coordinate continuable subagents) across the 4 specialized studio roles:',
    '1. `storyboard-director`: script breakdown (`text.plain` -> `film.workbench`), character consistency sheets, and shot list planning.',
    '2. `visual-asset-artist`: parallel keyframe generation (`asset.image`), 10-in-1 image processing (`image.process`), turnaround views (`image.multiAngle`), and vector animation (`svg.gen` -> `svg.anim`) via `graph_edit` + `task_run`.',
    '3. `blender-3d-director`: 3D asset generation (`asset.model3d`), 3DGS spatial worlds (`spatialWorld.generate`), rigging (`model3d.rig`), and Blender MCP scene layout.',
    '4. `timeline-audio-editor`: multi-speaker dialogue (`voice.dialogue`), narration (`voice.tts`), SFX/BGM (`audio.sfx` / `audio.music`), audio transcription (`transcribe_audio`), rough cut (`timeline_rough_cut`), and frame inspection (`timeline_preview`).'
  ]
  if (mode === 'ask') {
    return [
      ...base,
      'You are currently running in Ask mode: answer the user question directly and concisely using your knowledge.',
      'Do NOT call any MCP tool, do NOT modify any file, and do NOT generate any asset.',
      'If the request requires actions, briefly explain what you would do and suggest switching to Craft or Plan mode.'
    ]
  }
  if (mode === 'plan') {
    return [
      ...base,
      'You are currently running in Plan mode: before doing anything, first present a clear step-by-step execution plan.',
      'After presenting the plan, call the ask_user_question tool to ask the user whether to proceed,',
      'offering self-contained options such as "Proceed", "Adjust", and "Cancel".',
      'Only after the user confirms may you call other MCP tools to execute the plan.',
      'Do NOT modify files or generate assets before the user confirms the plan.',
      'The harness also exposes an exit_plan_mode tool: this panel does not run the harness plan mode, so never call it.',
      'Confirm the plan with ask_user_question only.'
    ]
  }
  return [
    ...base,
    'When you need the user to choose or confirm (e.g. picking between options, approving an action before it runs),',
    'call the ask_user_question tool with a concise question and 2-6 self-contained options, and wait for the user answer before proceeding.'
  ]
}

/**
 * 写自定义 runner、审批应答插件与 overlay patch
 *（禁用原 headless-runner、注入 aiart-runner 与 aiart-approval，以及完整 dsh 插件集）。
 * 返回 patch 文件路径；任何一步失败返回 null（回退原 headless 行为，不影响主流程）。
 *
 * 审批应答器单独一个补丁行而不是并进 runner：它只做一件事（approval/request → 用户），
 * 与对话流量的生死互不牵连 —— runner 起不来时审批通道不会被一起带走，反过来也一样。
 * 两份源码都进同一个 hash，改动任一都会重写 patch。
 */
function writeAiartHarness(
  dshNodeModules: string,
  mode: ChatMode = 'craft',
  projectMemory?: string | null
): string | null {
  try {
    const home = dshHome()
    mkdirSync(home, { recursive: true })
    writeDomainSubagentProfiles(home)
    const runnerPath = join(home, 'aiart-headless-runner.mjs')
    const runnerSource = AIART_RUNNER_TEMPLATE.replace(
      '__DSH_NODE_MODULES_JSON__',
      JSON.stringify(resolve(dshNodeModules))
    )
    const runnerUrl = pathToFileURL(runnerPath).href
    const approvalPath = join(home, 'aiart-approval-answerer.mjs')
    const approvalSource = AIART_APPROVAL_ANSWERER_TEMPLATE
    const approvalUrl = pathToFileURL(approvalPath).href
    const workspace = resolveWorkspace()
    const hasPkg = (pkgName: string): boolean => existsSync(join(dshNodeModules, pkgName))
    const hasClaudeHooksConfig =
      existsSync(join(workspace, '.claude', 'hooks.json')) ||
      existsSync(join(workspace, '.claude', 'settings.json')) ||
      existsSync(join(home, '.claude', 'hooks.json'))
    const hasCodexHooksConfig =
      existsSync(join(workspace, '.codex', 'hooks.json')) ||
      existsSync(join(home, '.codex', 'hooks.json'))
    const extraInserts: string[] = []
    if (hasPkg('@deepseek-ai/dsh-time-context')) {
      extraInserts.push('    - id: time-context', "      name: '@deepseek-ai/dsh-time-context'")
    }
    if (hasPkg('@deepseek-ai/dsh-schedule')) {
      extraInserts.push('    - id: schedule', "      name: '@deepseek-ai/dsh-schedule'")
    }
    if (hasPkg('@deepseek-ai/dsh-tool-present')) {
      extraInserts.push(
        '    - id: tool-present',
        "      name: '@deepseek-ai/dsh-tool-present'",
        '      config:',
        '        maxFiles: 8'
      )
    }
    if (hasPkg('@deepseek-ai/dsh-tool-str-replace-editor')) {
      extraInserts.push(
        '    - id: tool-str-replace-editor',
        "      name: '@deepseek-ai/dsh-tool-str-replace-editor'",
        '      config:',
        '        maxOutputChars: 16000'
      )
    }
    const hasSessionQuerySqlite = hasPkg('@deepseek-ai/dsh-session-query-sqlite')
    const searchDbPath = join(home, 'session-search.sqlite').replace(/\\/g, '/')
    if (hasPkg('@deepseek-ai/dsh-hooks-claude-code') && hasClaudeHooksConfig) {
      extraInserts.push(
        '    - id: hooks-claude-code',
        "      name: '@deepseek-ai/dsh-hooks-claude-code'"
      )
    }
    if (hasPkg('@deepseek-ai/dsh-hooks-codex') && hasCodexHooksConfig) {
      extraInserts.push('    - id: hooks-codex', "      name: '@deepseek-ai/dsh-hooks-codex'")
    }
    if (hasPkg('@deepseek-ai/dsh-subagent-claude-code')) {
      extraInserts.push(
        '    - id: subagent-claude-code',
        "      name: '@deepseek-ai/dsh-subagent-claude-code'"
      )
    }
    if (hasPkg('@deepseek-ai/dsh-subagent-codex')) {
      extraInserts.push('    - id: subagent-codex', "      name: '@deepseek-ai/dsh-subagent-codex'")
    }

    const patch = [
      '# AIArtEngine 生成的 headless overlay：输出思考过程，请勿手改。',
      '- id: headless-runner',
      "  name: '@deepseek-ai/dsh-headless'",
      '  disabled: true',
      '- insert:',
      '    - id: aiart-runner',
      `      name: '${runnerUrl}'`,
      '      inject: [headlessStartup]',
      '      config:',
      '        task: !!js ctx.headlessStartup.task',
      // 审批应答器只挂 approval/request 事件、不 inject 任何服务，所以 dsh 里有没有
      // approval 插件都不影响这一行挂载；没有审批请求时它是一段静止的代码。
      '    - id: aiart-approval',
      `      name: '${approvalUrl}'`,
      ...extraInserts,
      ...(hasSessionQuerySqlite
        ? [
            '- id: session-query-sqlite',
            '  config:',
            `    path: '${searchDbPath}'`,
            '    openAt: first-search'
          ]
        : []),
      '- id: tool-subagent-fork',
      '  config:',
      '    provider: fork',
      '    toolName: subagent_fork',
      '    backgroundMode: continuable',
      '- id: system-prompt',
      '  config:',
      // dsh 0.1.5 起 system-prompt 的配置键由 persona 改名为 personaPrefix（旧键会被 schema 丢弃）
      '    personaPrefix: >-',
      ...buildPersona(mode, projectMemory).map((line) => `      ${line}`)
    ]
    const patchBody = patch.join('\n') + '\n'
    const hash = createHash('sha1')
      .update(runnerSource)
      .update('\0')
      .update(approvalSource)
      .update('\0')
      .update(patchBody)
      .digest('hex')
    const patchPath = join(home, 'aiart.patch.yml')
    if (
      hash !== lastHarnessWriteHash ||
      !existsSync(runnerPath) ||
      !existsSync(approvalPath) ||
      !existsSync(patchPath)
    ) {
      writeFileSync(runnerPath, runnerSource, 'utf8')
      writeFileSync(approvalPath, approvalSource, 'utf8')
      writeFileSync(patchPath, patchBody, 'utf8')
      lastHarnessWriteHash = hash
    }
    return patchPath
  } catch {
    return null
  }
}

/**
 * 写「隐藏子进程控制台窗口」预载 hook，返回其绝对路径（失败返回 null）。
 *
 * dsh 的子进程服务在 Windows 上 spawn 时不传 windowsHide，而宿主是 GUI 进程
 * （没有控制台窗口），于是 agent 每执行一条命令都会新建一个可见控制台窗口——
 * 用户看到的就是对话过程中频繁闪黑窗。上游修好前由这层 hook 兜底：它把
 * child_process 各启动 API 的 windowsHide 默认置为 true，只改这一个选项。
 * 内容固定，已存在且一致时跳过写入，避免每条消息都做无谓写盘。
 */
function writeHideChildWindowsHook(): string | null {
  try {
    const home = dshHome()
    mkdirSync(home, { recursive: true })
    const hookPath = join(home, HIDE_CHILD_WINDOWS_HOOK_FILENAME)
    const exists =
      existsSync(hookPath) && readFileSync(hookPath, 'utf8') === HIDE_CHILD_WINDOWS_HOOK_SOURCE
    if (!exists) writeFileSync(hookPath, HIDE_CHILD_WINDOWS_HOOK_SOURCE, 'utf8')
    return hookPath
  } catch {
    return null
  }
}

/**
 * ACL 沙箱控制台补丁的应用记录：同一棵依赖树只尝试一次。补丁本身幂等（第二次读到的
 * 就是已补丁内容），失败也不值得重试——只读安装目录不会中途变成可写。
 */
const aclConsolePatchApplied = new Set<string>()

/** 同上：浏览器启动守卫补丁的应用记录（补丁自身幂等，失败也不重试） */
const browserGuardApplied = new Set<string>()

/**
 * 给 dsh 依赖树里的 ACL 沙箱打「隐藏控制台窗口」补丁。
 *
 * writeHideChildWindowsHook 管不到沙箱链路：ACL 沙箱的子进程由原生 CreateProcessAsUserW
 * 创建（不经过 Node 的 spawn），受限令牌下又不能用 CREATE_NO_WINDOW，于是宿主没有控制台时
 * 它会新建一个可见控制台窗口。详见 dshSandboxConsolePatch 的说明。写盘失败只记一行日志，
 * 补丁只是体验优化，绝不影响对话。
 */
function applyAclConsolePatch(dshModules: string): void {
  if (aclConsolePatchApplied.has(dshModules)) return
  aclConsolePatchApplied.add(dshModules)
  const report = patchAclSandboxConsole(dshModules)
  if (report.failedFiles > 0) {
    console.warn(
      '[aiart] acl sandbox console patch not applied (read-only install?):',
      dshModules,
      `${report.failedFiles} file(s)`
    )
  }
}

/**
 * 给 dsh 依赖树的子进程收口打「禁止启动浏览器」补丁。
 *
 * 提示词侧的软约束压不住这件事：agent 为给 SVG / HTML 产物做视觉自查，会起本机浏览器
 * （会话日志里的实测形态：把 msedge.exe 路径存进变量，再 `& $edge --headless=new
 * --screenshot=...`）。命令跑在 ACL 沙箱的受限令牌里，Chromium 建不出自己的 mojo 命名管道
 * → 0x80000003，系统在**应用之外**弹出模态「应用程序错误」框挡住用户，而工具调用照样失败。
 * 沙箱只有文件效果策略、没有进程策略，拦不住 CreateProcess 出浏览器这一步；Windows 上所有
 * shell 进程（pwsh 直连、沙箱重包后的 argv、终端）都要过
 * `LocalSubprocessRuntime.spawn(spec)` / `spawnTerminal(spec)`，所以在那两个方法体开头按 argv
 * 判定并抛出可读原因。详见 dshBrowserGuardPatch。
 *
 * 写盘失败只记一行日志：补丁只是体验优化，绝不影响对话。
 */
function applyBrowserGuardPatch(dshModules: string): void {
  if (browserGuardApplied.has(dshModules)) return
  browserGuardApplied.add(dshModules)
  const report = patchBrowserGuard(dshModules)
  if (report.patchedSites > 0) {
    console.info(
      '[aiart] browser launch guard patch applied:',
      dshModules,
      `${report.patchedFiles} file(s) / ${report.patchedSites} site(s)`
    )
  }
  if (report.failedFiles > 0) {
    console.warn(
      '[aiart] browser launch guard patch not applied (read-only install?):',
      dshModules,
      `${report.failedFiles} file(s)`
    )
  }
}

function clearIdleTimer(): void {
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
}

let activeScheduleCount = 0
let lastGoalSnapshot: HarnessGoalView | null = null
let lastSchedulesSnapshot: HarnessScheduleView[] = []
let sessionReleaseWaiters: Array<() => void> = []

function notifySessionReleased(): void {
  const list = sessionReleaseWaiters
  sessionReleaseWaiters = []
  for (const fn of list) fn()
}

function scheduleIdleShutdown(): void {
  clearIdleTimer()
  // 有会话内定时提醒待触发时保持常驻进程存活，否则定时器随进程销毁而丢失
  if (!workerPersistent || !child || turnActive || activeScheduleCount > 0) return
  idleTimer = setTimeout(() => {
    idleTimer = null
    if (turnActive || !child || activeScheduleCount > 0) return
    emitStatus('dsh 空闲回收，已关闭常驻进程')
    sendWorkerCommand({ op: 'shutdown' })
    setTimeout(() => {
      if (child && !turnActive) {
        child.kill()
        resetWorkerState()
      }
    }, 2000)
  }, WORKER_IDLE_MS)
}

function resetWorkerState(): void {
  child = null
  workerFingerprint = ''
  workerModelId = ''
  workerReady = false
  workerPersistent = false
  workerRunId = ''
  activeScheduleCount = 0
  const pendingReady = readyWaiters
  readyWaiters = []
  for (const w of pendingReady) w(false)
  notifySessionReleased()
  /**
   * 进程没了，等待中的审批也就无从回传（回答文件写下去也没人读）。
   * 清空待决定表，`handleApprovalResponse` 随后的调用会返回 false —— 界面据此知道
   * 这一条已经作废，而不是以为自己同意了什么。
   */
  harnessApprovalRequests.clear()
  clearIdleTimer()
}

function notifyReady(): void {
  workerReady = true
  lastWorkerBootError = ''
  const waiters = readyWaiters
  readyWaiters = []
  for (const w of waiters) w(true)
}

function waitUntilReady(timeoutMs = 120_000): Promise<boolean> {
  if (workerReady) return Promise.resolve(true)
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      readyWaiters = readyWaiters.filter((w) => w !== onSettled)
      resolve(false)
    }, timeoutMs)
    const onSettled = (ready: boolean): void => {
      clearTimeout(timer)
      resolve(ready)
    }
    readyWaiters.push(onSettled)
  })
}

function sendWorkerCommand(payload: Record<string, unknown>): boolean {
  if (!child || child.killed) return false
  if (child.connected && typeof child.send === 'function') {
    try {
      child.send(payload)
      return true
    } catch {
      // 回落到 stdin JSONL
    }
  }
  if (!child.stdin) return false
  try {
    const line = `${JSON.stringify(payload)}\n`
    const ok = child.stdin.write(line, 'utf8')
    if (!ok) {
      // 背压：仍视为已入队，让 drain 继续；失败才算写不进
      child.stdin.once('drain', () => undefined)
    }
    return true
  } catch {
    return false
  }
}

/** 常驻 worker 协议版本：改 runner 交互或 MCP 核心工具集时递增，强制热进程重建 */
const WORKER_PROTOCOL = '11'
const RUNNER_TEMPLATE_FP = createHash('sha1')
  .update(AIART_RUNNER_TEMPLATE)
  .digest('hex')
  .slice(0, 12)

function workerFingerprintOf(input: {
  workspace: string
  mcpEndpoint: string
  blenderOn: boolean
  /**
   * 已挂载的第三方 MCP 服务指纹（id / 地址 / 命令 / 是否启用）。
   *
   * 必须进指纹：常驻 worker 只在自己这份配置上建工具面，用户新加一个第三方服务后
   * 若复用旧进程，新工具**这轮不会出现**，表现是「加了服务但对话里调不到」。
   * 只取影响挂载的字段，凭据（headers / env）不参与比较也不落盘。
   */
  externalMcpFp: string
  baseUrl?: string
  apiKey?: string
}): string {
  const keyFp = input.apiKey
    ? createHash('sha1').update(input.apiKey).digest('hex').slice(0, 12)
    : ''
  return [
    WORKER_PROTOCOL,
    RUNNER_TEMPLATE_FP,
    input.workspace,
    input.mcpEndpoint,
    input.blenderOn ? '1' : '0',
    input.externalMcpFp,
    input.baseUrl?.trim() || '',
    keyFp
  ].join('\u0000')
}

/** 第三方 MCP 服务中**影响工具面挂载**的那部分指纹（不含凭据） */
function externalMcpFingerprint(): string {
  const parts = settingsService
    .get()
    .externalMcp.map((raw) => {
      const server = normalizeExternalMcpServer(raw)
      if (!server) return ''
      const usable = server.enabled && !externalMcpUnusableReason(server)
      return usable
        ? `${server.id}|${server.transport}|${server.transport === 'http' ? server.url : server.command}|${server.args.join(' ')}`
        : ''
    })
    .filter(Boolean)
  return parts.join(';')
}

/**
 * 拉起 / 复用常驻 dsh 进程，或回退 one-shot（无自定义 runner / npx）。
 */
function attachWorkerIo(opts: {
  proc: ChildProcess
  runId: string
  dshEntry: string | null
  persistent: boolean
}): void {
  const { proc, dshEntry, persistent } = opts
  let currentRunId = opts.runId
  workerRunId = currentRunId
  const startedAt = Date.now()
  let sawOutput = false
  /** runner 已确认收到本轮 prompt（上游仍可能卡在 TTFT） */
  let turnAccepted = false
  let finalText = ''
  let errBuf = ''
  let fullOut = ''
  let parsedLen = 0
  let inReasoning = false
  let reasoningBuf = ''
  let turnFinalized = false
  let procAborted = false

  const setRunId = (id: string): void => {
    currentRunId = id
    workerRunId = id
  }

  ;(proc as ChildProcess & { __aiartSetRunId?: (id: string) => void }).__aiartSetRunId = setRunId
  ;(proc as ChildProcess & { __aiartMarkAborted?: () => void }).__aiartMarkAborted = () => {
    procAborted = true
    turnFinalized = true
  }
  ;(proc as ChildProcess & { __aiartResetTurn?: () => void }).__aiartResetTurn = () => {
    sawOutput = false
    turnAccepted = false
    finalText = ''
    fullOut = ''
    parsedLen = 0
    inReasoning = false
    reasoningBuf = ''
    turnFinalized = false
    errBuf = ''
  }
  ;(proc as ChildProcess & { __aiartTurnSawOutput?: () => boolean }).__aiartTurnSawOutput = () =>
    sawOutput
  ;(proc as ChildProcess & { __aiartTurnAccepted?: () => boolean }).__aiartTurnAccepted = () =>
    turnAccepted

  const isMarkerPrefix = (text: string): boolean =>
    text.length > 0 &&
    (REASONING_BEGIN.startsWith(text) ||
      REASONING_END.startsWith(text) ||
      text.startsWith(TOOL_BEGIN) ||
      text.startsWith(TOOL_END) ||
      text.startsWith(ASK_USER_BEGIN) ||
      text.startsWith(APPROVAL_BEGIN) ||
      text.startsWith(CONTEXT_BEGIN) ||
      text.startsWith(TODO_BEGIN) ||
      text.startsWith(GOAL_BEGIN) ||
      text.startsWith(PRESENT_BEGIN) ||
      text.startsWith(SCHEDULE_BEGIN) ||
      text.startsWith(SUBAGENT_BEGIN) ||
      text.startsWith(STEER_BEGIN))

  const emitAssistantDelta = (delta: string): void => {
    if (!delta || !turnActive) return
    sawOutput = true
    finalText += delta
    emit({ type: 'assistant', text: delta })
  }

  const emitToolFromLine = (line: string, state: 'start' | 'done'): void => {
    if (!turnActive) return
    const marker = state === 'start' ? TOOL_BEGIN : TOOL_END
    const payload = line.slice(marker.length).trim()
    let name = 'tool'
    let detail: string | undefined
    let args: string | undefined
    let id: string | undefined
    let parentId: string | undefined
    let steps: string[] | undefined
    try {
      const parsed = JSON.parse(payload)
      if (typeof parsed.name === 'string' && parsed.name) name = parsed.name
      if (typeof parsed.detail === 'string' && parsed.detail) detail = parsed.detail
      if (typeof parsed.args === 'string' && parsed.args) args = parsed.args
      if (typeof parsed.callId === 'string' && parsed.callId) id = parsed.callId
      if (typeof parsed.parentId === 'string' && parsed.parentId) parentId = parsed.parentId
      if (Array.isArray(parsed.steps)) {
        const clean = parsed.steps
          .filter(
            (item: unknown): item is string => typeof item === 'string' && Boolean(item.trim())
          )
          .map((item: string) => item.trim())
        if (clean.length > 0) steps = clean
      }
    } catch {
      /* ignore */
    }
    const bareName = stripMcpToolPrefix(name)
    if (state === 'start' && args) {
      const argSummary = summarizeMcpToolOperation(name, args)
      if (!steps?.length && argSummary.steps.length > 0) {
        steps = argSummary.steps
      }
      if (argSummary.detail) {
        detail = argSummary.detail
      }
    } else if (state === 'done') {
      const settled = latestMcpToolExecution.get(bareName)
      if (settled && Date.now() - settled.at < 60_000) {
        if (!steps?.length && settled.steps.length > 0) {
          steps = settled.steps
        }
        if (!detail && settled.detail) {
          detail = settled.detail
        }
        latestMcpToolExecution.delete(bareName)
      }
    }
    if (activeSkillTurn) {
      runSkillLifecycleHooks(activeSkillTurn, state === 'start' ? 'PreToolUse' : 'PostToolUse', {
        toolName: name,
        toolArgs: args || detail,
        workspaceRoot: resolveWorkspace()
      })
    }
    emit({
      type: 'tool',
      ...(id ? { id } : {}),
      ...(parentId ? { parentId } : {}),
      name,
      state,
      ...(detail ? { detail } : {}),
      ...(steps?.length ? { steps } : {}),
      ...(args ? { args } : {})
    })
    sawOutput = true
  }

  const emitAskUserFromLine = (line: string): void => {
    if (!turnActive) return
    const payload = line.slice(ASK_USER_BEGIN.length).trim()
    try {
      const raw = JSON.parse(payload)
      const parsed =
        raw && typeof raw === 'object' && raw.payload && typeof raw.payload === 'object'
          ? raw.payload
          : raw
      if (typeof parsed.requestId !== 'string' || typeof parsed.question !== 'string') return
      harnessAskUserRequests.set(parsed.requestId, {
        runId: currentRunId,
        answerFile: typeof parsed.answerFile === 'string' ? parsed.answerFile : '',
        questionId: typeof parsed.questionId === 'string' ? parsed.questionId : 'q1'
      })
      broadcastToAllWindows(IpcChannels.MCP_ASK_USER, {
        requestId: parsed.requestId,
        question: parsed.question,
        ...(typeof parsed.hint === 'string' && parsed.hint ? { hint: parsed.hint } : {}),
        ...(Array.isArray(parsed.options) && parsed.options.length
          ? { options: parsed.options }
          : {})
      })
      sawOutput = true
    } catch {
      /* ignore */
    }
  }

  /**
   * 审批请求标记 → 待决定表 + 广播给界面（若命中当前激活 Claude Code 技能的 `allowed-tools` 则自动放行一次）。
   *
   * 解析失败**什么都不做**（既不登记也不广播）：dsh 侧等不到回答文件，5 分钟后收敛到
   * `unavailable` —— 工具调用失败。这条路径上不存在「解析不出来就当同意」的可能。
   */
  const emitApprovalFromLine = (line: string): void => {
    if (!turnActive) return
    const payload = parseApprovalMarker(line)
    if (!payload) return
    if (
      payload.answerFile &&
      shouldAutoApproveSkillTool(activeSkillTurn, payload.toolName, payload.reason)
    ) {
      try {
        mkdirSync(dirname(payload.answerFile), { recursive: true })
        writeFileSync(payload.answerFile, approvalAnswerForDecision('allow-once'), 'utf8')
        sawOutput = true
        return
      } catch {
        // 自动写盘失败时回落到人工审批弹窗
      }
    }
    harnessApprovalRequests.set(payload.requestId, {
      runId: currentRunId,
      answerFile: payload.answerFile,
      toolName: payload.toolName
    })
    broadcastToAllWindows(IpcChannels.MCP_APPROVAL_REQUEST, approvalViewOf(payload))
    sawOutput = true
  }

  const emitContextFromLine = (line: string): void => {
    if (!turnActive) return
    const payload = line.slice(CONTEXT_BEGIN.length).trim()
    try {
      const parsed = JSON.parse(payload)
      if (typeof parsed.inputTokens !== 'number' || parsed.inputTokens < 0) return
      const cacheRead =
        typeof parsed.cacheReadTokens === 'number' && parsed.cacheReadTokens > 0
          ? parsed.cacheReadTokens
          : 0
      const cacheWrite =
        typeof parsed.cacheWriteTokens === 'number' && parsed.cacheWriteTokens > 0
          ? parsed.cacheWriteTokens
          : 0
      emit({ type: 'context', used: Math.round(parsed.inputTokens + cacheRead + cacheWrite) })
      sawOutput = true
    } catch {
      /* ignore */
    }
  }

  const emitTodoFromLine = (line: string): void => {
    const payload = line.slice(TODO_BEGIN.length).trim()
    try {
      const parsed = JSON.parse(payload) as { todos?: HarnessTodoItem[] }
      const todos = Array.isArray(parsed.todos) ? parsed.todos : []
      emit({ type: 'todo', todos })
      sawOutput = true
    } catch {
      /* ignore */
    }
  }

  const emitGoalFromLine = (line: string): void => {
    const payload = line.slice(GOAL_BEGIN.length).trim()
    try {
      const parsed = JSON.parse(payload) as { goal?: HarnessGoalView | null }
      const rawGoal = parsed.goal ?? null
      lastGoalSnapshot = rawGoal
        ? {
            ...rawGoal,
            roundsSinceUser: rawGoal.roundsSinceUser ?? rawGoal.round ?? rawGoal.roundsStarted ?? 0
          }
        : null
      emit({ type: 'goal', goal: lastGoalSnapshot })
      sawOutput = true
    } catch {
      /* ignore */
    }
  }

  const emitPresentFromLine = (line: string): void => {
    const payload = line.slice(PRESENT_BEGIN.length).trim()
    try {
      const parsed = JSON.parse(payload) as {
        callId?: string
        turn?: number
        files?: HarnessPresentFile[]
      }
      const rawFiles = Array.isArray(parsed.files) ? parsed.files : []
      if (!rawFiles.length) return
      const files = rawFiles.map((f) => ({
        ...f,
        caption: f.caption || f.description || f.title
      }))
      emit({
        type: 'present',
        callId: typeof parsed.callId === 'string' ? parsed.callId : '',
        turn: typeof parsed.turn === 'number' ? parsed.turn : 0,
        files
      })
      sawOutput = true
    } catch {
      /* ignore */
    }
  }

  const emitScheduleFromLine = (line: string): void => {
    const payload = line.slice(SCHEDULE_BEGIN.length).trim()
    try {
      const parsed = JSON.parse(payload) as { schedules?: HarnessScheduleView[] }
      const rawSchedules = Array.isArray(parsed.schedules) ? parsed.schedules : []
      const schedules: HarnessScheduleView[] = rawSchedules.map((s) => ({
        ...s,
        summary: s.summary || s.prompt,
        timing:
          s.timing ||
          (s.kind === 'every' && s.everySeconds
            ? `every ${s.everySeconds}s`
            : s.kind === 'after' && s.afterSeconds
              ? `after ${s.afterSeconds}s`
              : s.kind),
        nextRunAt: s.nextRunAt || s.scheduledAt,
        status: s.status || 'active'
      }))
      lastSchedulesSnapshot = schedules
      activeScheduleCount = schedules.length
      emit({ type: 'schedule', schedules })
      sawOutput = true
    } catch {
      /* ignore */
    }
  }

  const emitSubagentFromLine = (line: string): void => {
    const payload = line.slice(SUBAGENT_BEGIN.length).trim()
    try {
      const parsed = JSON.parse(payload) as { subagents?: HarnessSubagentView[] }
      const subagents = Array.isArray(parsed.subagents) ? parsed.subagents : []
      emit({ type: 'subagent', subagents })
      sawOutput = true
    } catch {
      /* ignore */
    }
  }

  const emitSteerFromLine = (line: string): void => {
    const payload = line.slice(STEER_BEGIN.length).trim()
    try {
      const parsed = JSON.parse(payload) as { ok?: boolean }
      if (parsed.ok !== false) {
        emit({ type: 'steered' })
        sawOutput = true
      }
    } catch {
      /* ignore */
    }
  }

  const parseStdout = (until: number): void => {
    let i = parsedLen
    let start = i
    while (i < until) {
      if (fullOut[i] === '\n') {
        const line = stripAnsi(fullOut.slice(start, i)).trim()
        start = i + 1
        if (line) {
          if (line === REASONING_BEGIN) {
            inReasoning = true
            reasoningBuf = ''
            sawOutput = true
          } else if (inReasoning && line === REASONING_END) {
            inReasoning = false
            emit({ type: 'reasoning', text: reasoningBuf })
          } else if (inReasoning) {
            reasoningBuf = reasoningBuf ? reasoningBuf + '\n' + line : line
            emit({ type: 'reasoning', text: reasoningBuf })
          } else if (line.startsWith(TOOL_BEGIN)) {
            emitToolFromLine(line, 'start')
          } else if (line.startsWith(TOOL_END)) {
            emitToolFromLine(line, 'done')
          } else if (line.startsWith(ASK_USER_BEGIN)) {
            emitAskUserFromLine(line)
          } else if (line.startsWith(APPROVAL_BEGIN)) {
            emitApprovalFromLine(line)
          } else if (line.startsWith(CONTEXT_BEGIN)) {
            emitContextFromLine(line)
          } else if (line.startsWith(TODO_BEGIN)) {
            emitTodoFromLine(line)
          } else if (line.startsWith(GOAL_BEGIN)) {
            emitGoalFromLine(line)
          } else if (line.startsWith(PRESENT_BEGIN)) {
            emitPresentFromLine(line)
          } else if (line.startsWith(SCHEDULE_BEGIN)) {
            emitScheduleFromLine(line)
          } else if (line.startsWith(SUBAGENT_BEGIN)) {
            emitSubagentFromLine(line)
          } else if (line.startsWith(STEER_BEGIN)) {
            emitSteerFromLine(line)
          } else {
            emitAssistantDelta(line + '\n')
          }
        }
      }
      i++
    }
    if (start < until) {
      const tail = stripAnsi(fullOut.slice(start, until))
      if (tail) {
        if (isMarkerPrefix(tail)) {
          /* wait */
        } else if (inReasoning) {
          reasoningBuf += tail
          emit({ type: 'reasoning', text: reasoningBuf })
        } else {
          emitAssistantDelta(tail)
        }
      }
    }
    parsedLen = until
  }

  const finishTurn = (result: HarnessJobWaitResult, runIdForRelease: string): void => {
    if (turnFinalized) return
    turnFinalized = true
    turnActive = false
    if (activeSkillTurn) {
      runSkillLifecycleHooks(activeSkillTurn, 'Stop', { workspaceRoot: resolveWorkspace() })
      activeSkillTurn = null
    }
    clearActiveHarnessRun()
    releaseHarnessRunAccess(runIdForRelease)
    for (const [id, entry] of harnessAskUserRequests) {
      if (entry.runId === runIdForRelease) harnessAskUserRequests.delete(id)
    }
    // 本轮结束时仍未决定的审批：条目作废，界面上的同意卡随之失效（见 handleApprovalResponse）。
    // 只是删条目、**不写任何回答文件**：dsh 侧 signal 已中止，会收敛到 cancelled。
    for (const [id, entry] of harnessApprovalRequests) {
      if (entry.runId === runIdForRelease) harnessApprovalRequests.delete(id)
    }
    emit({
      type: 'tool',
      name: 'dsh-agent',
      state: 'done',
      ...(!result.ok && result.error ? { detail: result.error } : {})
    })
    if (result.ok) {
      if (result.finalText) emit({ type: 'final', text: result.finalText })
      emit({ type: 'done', runId: runIdForRelease })
    } else if (result.error) {
      emit({ type: 'error', message: result.error })
    }
    completeActiveJob(result)
    scheduleIdleShutdown()
  }

  const onData = (chunk: Buffer | string, source: 'out' | 'err'): void => {
    if (procAborted || child !== proc) return
    if (source === 'err') {
      errBuf += String(chunk)
      const lines = errBuf.split('\n')
      errBuf = lines.pop() ?? ''
      for (const raw of lines) {
        const line = stripAnsi(raw).trim()
        if (!line) continue
        if (line.startsWith('[aiart-runner]')) {
          if (line === '[aiart-runner] ready' || line.startsWith('[aiart-runner] ready ')) {
            // 预热 / 常驻就绪不刷进对话流，避免「dsh 就绪」占满聊天
            console.info('[aiart] dsh worker ready')
            notifyReady()
            continue
          }
          if (line.startsWith('[aiart-runner] session_released')) {
            notifySessionReleased()
            continue
          }
          if (
            line.startsWith('[aiart-runner] goal_control_ack') ||
            line.startsWith('[aiart-runner] schedule_delete_ack') ||
            line.startsWith('[aiart-runner] steer_ack')
          ) {
            continue
          }
          if (line.startsWith('[aiart-runner] schedule_turn_start ')) {
            const payload = line.slice('[aiart-runner] schedule_turn_start '.length)
            let schedRunId = `sched-${Date.now()}`
            let schedMode: ChatMode = 'craft'
            try {
              const parsed = JSON.parse(payload) as { runId?: string; mode?: string }
              if (parsed.runId) schedRunId = parsed.runId
              if (parsed.mode) schedMode = normalizeChatMode(parsed.mode)
            } catch {
              /* ignore */
            }
            if (!turnActive) {
              clearIdleTimer()
              sawOutput = false
              turnAccepted = true
              finalText = ''
              fullOut = ''
              parsedLen = 0
              inReasoning = false
              reasoningBuf = ''
              turnFinalized = false
              setRunId(schedRunId)
              registerHarnessRunAccess(schedRunId, schedMode)
              setActiveHarnessRun(schedRunId, schedMode)
              turnActive = true
              emit({ type: 'tool', name: 'dsh-agent', state: 'start' })
              emitStatus('定时提醒已触发，正在执行…')
            }
            continue
          }
          if (line.startsWith('[aiart-runner] prompt_start')) {
            turnAccepted = true
            emitStatus('已提交给模型，等待响应…')
            continue
          }
          if (line.startsWith('[aiart-runner] turn_done ')) {
            const payload = line.slice('[aiart-runner] turn_done '.length)
            let ok = true
            let error: string | undefined
            try {
              const parsed = JSON.parse(payload) as { ok?: boolean; error?: string }
              ok = parsed.ok !== false
              error = parsed.error
            } catch {
              ok = false
              error = payload
            }
            if (parsedLen < fullOut.length) parseStdout(fullOut.length)
            if (inReasoning) emit({ type: 'reasoning', text: reasoningBuf })
            if (ok) {
              finishTurn({ ok: true, finalText }, currentRunId)
            } else {
              const message =
                error?.trim() ||
                (finalText
                  ? `本轮结束但 runner 报错：${error || 'unknown'}`
                  : `本轮失败：${error || 'unknown'}`)
              finishTurn({ ok: false, error: message, finalText }, currentRunId)
            }
            continue
          }
          if (line.startsWith('[aiart-runner] model_set ')) {
            continue
          }
          // stderr 里的报错行：语气按内容归类，渲染层按 tone 上色，不再自行解析文案
          if (/error|fail|abort/i.test(line)) emitStatus(line, 'error')
          continue
        }
        emitStatus(line)
      }
      return
    }
    const textChunk = String(chunk)
    if (
      !turnActive &&
      persistent &&
      !textChunk.includes(GOAL_BEGIN) &&
      !textChunk.includes(SCHEDULE_BEGIN) &&
      !textChunk.includes(TODO_BEGIN) &&
      !textChunk.includes(PRESENT_BEGIN) &&
      !textChunk.includes(SUBAGENT_BEGIN) &&
      !textChunk.includes(STEER_BEGIN)
    ) {
      // 常驻空闲时忽略普通 stdout 噪声，但放行带外状态快照
      return
    }
    fullOut += textChunk
    parseStdout(fullOut.length)
  }

  proc.stdout?.on('data', (chunk) => onData(chunk, 'out'))
  proc.stderr?.on('data', (chunk) => onData(chunk, 'err'))
  proc.on('message', (rawMsg: unknown) => {
    if (procAborted || child !== proc) return
    if (!rawMsg || typeof rawMsg !== 'object') return
    const msg = rawMsg as Record<string, unknown>
    if (msg.__aiartEvent !== true || typeof msg.type !== 'string') return
    switch (msg.type) {
      case 'ready':
        console.info('[aiart] dsh worker ready (ipc)')
        notifyReady()
        break
      case 'session_released':
        notifySessionReleased()
        break
      case 'prompt_start':
        turnAccepted = true
        emitStatus('已提交给模型，等待响应…')
        break
      case 'schedule_turn_start': {
        const schedRunId =
          typeof msg.runId === 'string' && msg.runId ? msg.runId : `sched-${Date.now()}`
        const schedMode =
          typeof msg.mode === 'string' && msg.mode ? normalizeChatMode(msg.mode) : 'craft'
        if (!turnActive) {
          clearIdleTimer()
          sawOutput = false
          turnAccepted = true
          finalText = ''
          fullOut = ''
          parsedLen = 0
          inReasoning = false
          reasoningBuf = ''
          turnFinalized = false
          setRunId(schedRunId)
          registerHarnessRunAccess(schedRunId, schedMode)
          setActiveHarnessRun(schedRunId, schedMode)
          turnActive = true
          emit({ type: 'tool', name: 'dsh-agent', state: 'start' })
          emitStatus('定时提醒已触发，正在执行…')
        }
        break
      }
      case 'reasoning_begin':
        if (turnActive) {
          inReasoning = true
        }
        break
      case 'reasoning_delta':
        if (turnActive && typeof msg.text === 'string' && msg.text) {
          sawOutput = true
          inReasoning = true
          reasoningBuf += msg.text
          emit({ type: 'reasoning', text: reasoningBuf })
        }
        break
      case 'reasoning_end':
        if (inReasoning) {
          inReasoning = false
          emit({ type: 'reasoning', text: reasoningBuf })
        }
        break
      case 'assistant_delta':
        if (typeof msg.text === 'string' && msg.text) {
          if (inReasoning) {
            inReasoning = false
            emit({ type: 'reasoning', text: reasoningBuf })
          }
          emitAssistantDelta(msg.text)
        }
        break
      case 'turn_done': {
        if (parsedLen < fullOut.length) parseStdout(fullOut.length)
        if (inReasoning) {
          inReasoning = false
          emit({ type: 'reasoning', text: reasoningBuf })
        }
        const ok = msg.ok !== false
        const error = typeof msg.error === 'string' ? msg.error : undefined
        if (ok) {
          finishTurn({ ok: true, finalText }, currentRunId)
        } else {
          const message =
            error?.trim() ||
            (finalText
              ? `本轮结束但 runner 报错：${error || 'unknown'}`
              : `本轮失败：${error || 'unknown'}`)
          finishTurn({ ok: false, error: message, finalText }, currentRunId)
        }
        break
      }
      case 'tool': {
        const toolPayload = JSON.stringify(
          msg.payload && typeof msg.payload === 'object' ? msg.payload : msg
        )
        emitToolFromLine(
          `${msg.state === 'done' ? TOOL_END : TOOL_BEGIN} ${toolPayload}`,
          msg.state === 'done' ? 'done' : 'start'
        )
        break
      }
      case 'ask_user': {
        const askPayload = JSON.stringify(
          msg.payload && typeof msg.payload === 'object' ? msg.payload : msg
        )
        emitAskUserFromLine(`${ASK_USER_BEGIN} ${askPayload}`)
        break
      }
      case 'approval': {
        const approvalPayload = JSON.stringify(
          msg.payload && typeof msg.payload === 'object' ? msg.payload : msg
        )
        emitApprovalFromLine(`${APPROVAL_BEGIN} ${approvalPayload}`)
        break
      }
      case 'context': {
        const ctxPayload = JSON.stringify(
          msg.usage && typeof msg.usage === 'object' ? msg.usage : msg
        )
        emitContextFromLine(`${CONTEXT_BEGIN} ${ctxPayload}`)
        break
      }
      case 'todo':
        emitTodoFromLine(`${TODO_BEGIN} ${JSON.stringify(msg)}`)
        break
      case 'goal':
        emitGoalFromLine(`${GOAL_BEGIN} ${JSON.stringify(msg)}`)
        break
      case 'present':
        emitPresentFromLine(`${PRESENT_BEGIN} ${JSON.stringify(msg)}`)
        break
      case 'schedule':
        emitScheduleFromLine(`${SCHEDULE_BEGIN} ${JSON.stringify(msg)}`)
        break
      case 'subagent':
        emitSubagentFromLine(`${SUBAGENT_BEGIN} ${JSON.stringify(msg)}`)
        break
      case 'steered':
        emitSteerFromLine(`${STEER_BEGIN} ${JSON.stringify(msg)}`)
        break
    }
  })
  proc.on('error', (err) => {
    if (procAborted || child !== proc) return
    const wasPersistent = persistent
    const wasReady = workerReady
    if (wasPersistent && !wasReady) {
      lastWorkerBootError = `dsh 启动失败：${err.message}`
      if (child === proc) resetWorkerState()
      return
    }
    if (child === proc) resetWorkerState()
    if (turnActive) {
      clearActiveHarnessRun()
      releaseHarnessRunAccess(currentRunId)
      emit({ type: 'error', message: `dsh 启动失败：${err.message}` })
      turnActive = false
      completeActiveJob({ ok: false, error: err.message, finalText: '' })
    }
  })
  proc.on('close', (code) => {
    if (procAborted || child !== proc) return
    const wasPersistent = persistent
    const wasReady = workerReady
    const wasTurn = turnActive
    const rid = currentRunId
    if (wasPersistent && !wasReady) {
      const quotaHint = isDshQuotaError(fullOut + '\n' + errBuf)
        ? 'DeepSeek 账户余额不足：到 platform.deepseek.com → 账户中心充值后再发，或在设置 → 模型接入切换到其它服务商'
        : null
      const hint =
        quotaHint ??
        (dshEntry ? '请重试或查看上方状态信息' : '若为首次运行，请等待包下载完成后重试')
      lastWorkerBootError = `dsh 异常退出（code ${code}）。${hint}。`
      if (child === proc) resetWorkerState()
      return
    }
    if (child === proc) resetWorkerState()
    if (parsedLen < fullOut.length) parseStdout(fullOut.length)
    if (inReasoning) emit({ type: 'reasoning', text: reasoningBuf })
    if (wasPersistent && !wasTurn) {
      // 空闲回收或主动 shutdown
      return
    }
    if (!wasTurn) return
    const failed = code !== 0 && finalText === ''
    if (failed) {
      const quotaHint = isDshQuotaError(fullOut + '\n' + errBuf)
        ? 'DeepSeek 账户余额不足：到 platform.deepseek.com → 账户中心充值后再发，或在设置 → 模型接入切换到其它服务商'
        : null
      const hint =
        quotaHint ??
        (dshEntry ? '请重试或查看上方状态信息' : '若为首次运行，请等待包下载完成后重试')
      const onlyTools = sawOutput ? '，本轮只产生了工具调用、没有文本' : ''
      const message = `dsh 异常退出（code ${code}）${onlyTools}。${hint}。`
      finishTurn({ ok: false, error: message, finalText }, rid)
    } else {
      if (code !== 0) emitStatus(`dsh 退出码 ${code}（本轮已有输出，未受影响）`, 'warn')
      finishTurn({ ok: true, finalText }, rid)
    }
  })

  if (!dshEntry) {
    const timeout = setTimeout(() => {
      if (child !== proc) return
      emitStatus('dsh 响应超时，正在中止（可重试）', 'error')
      proc.kill()
    }, NPX_TIMEOUT_MS)
    const progress = setInterval(() => {
      if (child !== proc) return
      const waited = Math.round((Date.now() - startedAt) / 1000)
      emitStatus(`仍在准备 dsh 运行体（首次运行需联网下载，已等待 ${waited}s）…`)
    }, NPX_PROGRESS_HINT_MS)
    const stopTimers = (): void => {
      clearTimeout(timeout)
      clearInterval(progress)
    }
    proc.once('close', stopTimers)
    proc.once('error', stopTimers)
  } else if (!persistent) {
    // 仅提示，不自动中止：慢模型 / 长工具链可能远超数分钟
    const idleProgress = setInterval(() => {
      if (child !== proc || sawOutput) return
      const waited = Math.round((Date.now() - startedAt) / 1000)
      emitStatus(
        `仍在等待模型响应（已等待 ${waited}s）。若长时间无进展，可手动中止后检查网络 / OpenRouter 额度`
      )
    }, DSH_IDLE_PROGRESS_HINT_MS)
    const stopIdleTimers = (): void => {
      clearInterval(idleProgress)
    }
    const onFirstOutput = (): void => {
      stopIdleTimers()
      proc.stdout?.off('data', onFirstOutput)
      proc.stderr?.off('data', onFirstOutput)
    }
    proc.stdout?.on('data', onFirstOutput)
    proc.stderr?.on('data', onFirstOutput)
    proc.once('close', stopIdleTimers)
    proc.once('error', stopIdleTimers)
  }
}

function launchDsh(opts: {
  command: string
  args: string[]
  workspace: string
  env: NodeJS.ProcessEnv
  runId: string
  dshEntry: string | null
  persistent?: boolean
}): void {
  const { command, args, workspace, env, runId, dshEntry } = opts
  const persistent = !!opts.persistent
  clearIdleTimer()
  const proc = spawn(command, args, {
    cwd: workspace,
    windowsHide: true,
    shell: false,
    env,
    stdio: persistent ? ['pipe', 'pipe', 'pipe', 'ipc'] : undefined
  })
  child = proc
  workerPersistent = persistent
  workerReady = false
  if (persistent) {
    emitStatus('正在启动 DeepSeek Harness（常驻）…')
  } else {
    emitStatus('dsh 已启动，等待模型响应…')
  }
  attachWorkerIo({ proc, runId, dshEntry, persistent })
}

export async function runHarnessJobWait(input: HarnessJobWaitInput): Promise<HarnessJobWaitResult> {
  const rest: HarnessRunInput = {
    task: input.task,
    mode: input.mode,
    sessionId: input.sessionId,
    model: input.model,
    providerId: input.providerId
  }
  const rawTask = String(rest.task ?? '').trim()
  if (!rawTask) return { ok: false, error: '任务内容为空' }
  return new Promise((resolve) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (result: HarnessJobWaitResult): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve(result)
    }
    const armTimeout = (): void => {
      if (!input.timeoutMs || input.timeoutMs <= 0 || timer) return
      timer = setTimeout(() => {
        finish({ ok: false, error: 'GRAPH_MODEL_DSH_TIMEOUT' })
      }, input.timeoutMs)
    }
    const waiter = (result: HarnessJobWaitResult): void => finish(result)
    if (turnActive || harnessQueue.length || activeWaiters.length) {
      harnessQueue.push({ input: rest, waiters: [waiter], onStart: armTimeout })
      emitStatus('排队等待 dsh…')
      return
    }
    activeWaiters = [waiter]
    armTimeout()
    void startHarnessNow(rest).then((started) => {
      if (!started.started) finish({ ok: false, error: started.message || 'GRAPH_MODEL_DSH_START' })
    })
  })
}

export async function runHarnessTask(input: HarnessRunInput): Promise<HarnessRunResult> {
  const rawTask = String(input?.task ?? '').trim()
  if (!rawTask) return { started: false, message: '任务内容为空' }
  if (turnActive || harnessQueue.length || activeWaiters.length) {
    harnessQueue.push({ input, waiters: [] })
    emitStatus('已加入队列，当前 dsh 任务结束后开始')
    return { started: true, message: 'queued' }
  }
  return startHarnessNow(input)
}

/** 闲时预热：拉起常驻 worker 到 ready，用户发消息时跳过 Cordis/MCP 冷启动 */
export async function prewarmHarness(): Promise<{ ok: boolean; message?: string }> {
  if (turnActive) return { ok: true, message: 'busy' }
  if (child && workerPersistent && workerReady) {
    scheduleIdleShutdown()
    return { ok: true, message: 'already-warm' }
  }
  const mcp = getMcpServerInfo()
  if (!mcp?.running) return { ok: false, message: 'MCP 未运行' }
  const provider =
    resolveTextProvider(lastPreferredProviderId || undefined) ?? resolveTextProvider()
  if (!provider) return { ok: false, message: '未配置文本模型' }
  const dshEntry = resolveDshEntry()
  if (!dshEntry) return { ok: false, message: '无内置 dsh，跳过预热' }
  try {
    await ensurePersistentWorker({
      provider,
      modelId:
        lastPreferredProviderId &&
        provider.provider.id === lastPreferredProviderId &&
        lastPreferredModelId
          ? lastPreferredModelId
          : provider.modelId,
      warmOnly: true
    })
    scheduleIdleShutdown()
    return { ok: true }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

async function ensurePersistentWorker(opts: {
  provider: NonNullable<ReturnType<typeof resolveTextProvider>>
  modelId: string
  modelName?: string
  inputModalities?: ReadonlyArray<'text' | 'image'>
  mode?: ChatMode
  warmOnly?: boolean
}): Promise<void> {
  // 必须先挂上 chain 再 await，否则并发调用会同时进入 Unlocked 拉起两个进程
  const run = ensureWorkerChain.then(() => ensurePersistentWorkerUnlocked(opts))
  ensureWorkerChain = run.then(
    () => undefined,
    () => undefined
  )
  await run
}

async function ensurePersistentWorkerUnlocked(opts: {
  provider: NonNullable<ReturnType<typeof resolveTextProvider>>
  modelId: string
  modelName?: string
  inputModalities?: ReadonlyArray<'text' | 'image'>
  mode?: ChatMode
  warmOnly?: boolean
}): Promise<void> {
  const mcp = getMcpServerInfo()
  if (!mcp?.running) throw new Error('MCP 工具服务未运行，请先在设置中启动')
  const workspace = resolveWorkspace()
  const blender = getBlenderClientForHarness()
  const fingerprint = workerFingerprintOf({
    workspace,
    mcpEndpoint: mcp.endpoint,
    blenderOn: !!blender,
    externalMcpFp: externalMcpFingerprint(),
    baseUrl: opts.provider.baseUrl,
    apiKey: opts.provider.apiKey
  })
  const dshEntry = resolveDshEntry()
  if (!dshEntry) throw new Error('no dsh entry')
  const dshModules = locateNodeModules(dshEntry)
  if (!dshModules) throw new Error('no dsh modules')

  if (child && workerPersistent && workerFingerprint === fingerprint && workerReady) {
    return
  }

  if (child) {
    ;(child as ChildProcess & { __aiartMarkAborted?: () => void }).__aiartMarkAborted?.()
    try {
      sendWorkerCommand({ op: 'shutdown' })
    } catch {
      /* ignore */
    }
    child.kill()
    resetWorkerState()
  }

  const mode = opts.mode ?? 'craft'
  const isGoogle =
    opts.provider.provider.providerKind === 'google' ||
    /generativelanguage\.googleapis\.com/i.test(opts.provider.baseUrl ?? '')
  const isOpenAi =
    opts.provider.provider.providerKind === 'openai' ||
    /\bapi\.openai\.com\b/i.test(opts.provider.baseUrl ?? '')
  const modelId = isGoogle
    ? resolveGoogleChatModelId(opts.modelId)
    : isOpenAi
      ? normalizeOpenAiTextModelId(opts.modelId, { hasTools: true })
      : opts.modelId
  const textCatalog =
    modalityConfig(opts.provider.provider, 'text').catalog?.[opts.modelId] ??
    modalityConfig(opts.provider.provider, 'text').catalog?.[modelId]
  const inputModalities =
    opts.inputModalities ??
    resolveDshChatInputModalitiesForProvider(opts.provider.provider, modelId)
  const modelName = opts.modelName?.trim() || textCatalog?.name?.trim() || modelId

  // 常驻连接用 craft 占位头拿全量 tools/list；每轮授权走 activeHarnessRun
  writeDshConfig(mcp.endpoint, 'craft', '0', blender, mcp.port, {
    baseUrl: opts.provider.baseUrl,
    modelId,
    modelName,
    inputModalities,
    provider: opts.provider.provider
  })
  writeDshSettings({
    baseUrl: opts.provider.baseUrl,
    modelId,
    modelName,
    inputModalities,
    provider: opts.provider.provider
  })
  cleanupLegacyDshSkills()

  let projectMemory: string | null = null
  if (projectService.isOpen()) {
    try {
      const raw = await projectService.readProjectFile(PROJECT_MEMORY_RELATIVE_PATH)
      if (raw) projectMemory = raw.slice(0, PROJECT_MEMORY_INJECT_LIMIT)
    } catch {
      projectMemory = null
    }
  }
  // persona 用 craft 基线；每轮 mode 由 runner modePreamble 注入
  const patchPath = writeAiartHarness(dshModules, 'craft', projectMemory)
  if (!patchPath) throw new Error('writeAiartHarness failed')
  applyAclConsolePatch(dshModules)
  applyBrowserGuardPatch(dshModules)
  const hideWindowsHook = writeHideChildWindowsHook()
  const nodeCmd = resolveNodeCommand()
  const command = nodeCmd?.command ?? (process.platform === 'win32' ? 'npx.cmd' : 'npx')
  const args = [
    ...(nodeCmd ? ['--expose-internals'] : []),
    ...(nodeCmd && hideWindowsHook ? ['--require', hideWindowsHook] : []),
    dshEntry,
    '--profile',
    'headless',
    '--patch',
    patchPath,
    PERSISTENT_PLACEHOLDER_TASK
  ]

  if (workspaceNotified !== workspace) {
    workspaceNotified = workspace
    emitStatus(
      workspace === app.getPath('userData')
        ? '未打开工程：AI 工作区为应用数据目录（建议先打开工程）'
        : `工作区：${workspace}`
    )
  }

  const bootRunId = 'boot'
  lastWorkerBootError = ''
  launchDsh({
    command,
    args,
    workspace,
    env: {
      ...process.env,
      ...(nodeCmd?.env ?? {}),
      ...(hideWindowsHook
        ? { NODE_OPTIONS: appendNodeRequireOption(process.env.NODE_OPTIONS, hideWindowsHook) }
        : {}),
      DSH_HOME: dshHome(),
      DEEPSEEK_API_KEY: opts.provider.apiKey,
      DSH_MODEL: modelId,
      ...(opts.provider.baseUrl ? { DEEPSEEK_BASE_URL: opts.provider.baseUrl } : {}),
      STUDIO_MCP_TOKEN: mcp.token,
      AIART_ASK_DIR: join(app.getPath('temp'), 'aiart-harness-ask'),
      AIART_RUN_ID: bootRunId,
      AIART_MODE: mode,
      AIART_PERSISTENT: '1'
    } as NodeJS.ProcessEnv,
    runId: bootRunId,
    dshEntry,
    persistent: true
  })
  workerFingerprint = fingerprint
  workerModelId = modelId
  const ready = await waitUntilReady(180_000)
  if (!ready) {
    const bootError = lastWorkerBootError
    child?.kill()
    resetWorkerState()
    throw new Error(bootError || 'dsh 常驻进程就绪超时')
  }
}

/**
 * 解析当前工程内画布与节点上下文摘要：
 * - 优先使用渲染层上报的实时工作区画布与选中节点上下文（`input.canvasContext`）；
 * - 若未传入但当前已打开工程，则从 `projectService.listAssets()` 汇总工程内已有画布资产及节点清单，
 *   确保 Agent 能直接感知项目中的 `assetId` 与节点拓扑，主动调用 `graph_read` / `graph_edit` / `task_run`。
 */
function resolveProjectCanvasContext(explicitContext?: string): string {
  const trimmed = explicitContext?.trim()
  if (trimmed) return trimmed
  if (!projectService.isOpen()) return ''
  try {
    const readGraph = (
      a: import('@shared/domain').AssetInfo
    ): import('@shared/graph').GraphDocument | null => {
      const graphJson = (a.genParams as Record<string, unknown> | undefined)?.graphJson as
        import('@shared/graph').GraphDocument | undefined
      return graphJson && Array.isArray(graphJson.nodes) ? graphJson : null
    }
    const graphAssets = projectService
      .listAssets()
      .filter((a) => a.type === 'canvas' || (readGraph(a)?.nodes?.length ?? 0) > 0)
      .slice(0, 10)
    if (!graphAssets.length) return ''
    const lines: string[] = []
    for (const asset of graphAssets) {
      const nodes = readGraph(asset)?.nodes ?? []
      const nodeBrief = nodes
        .slice(0, 20)
        .map((n) => `${n.id}[${n.typeId}:"${n.title || n.typeId}"]`)
        .join(', ')
      lines.push(
        `Project canvas asset: "${asset.name}" (assetId: "${asset.id}", type: ${asset.type}, nodes: ${nodes.length}${nodeBrief ? ` -> ${nodeBrief}` : ''})`
      )
    }
    return lines.join('\n')
  } catch {
    return ''
  }
}

/**
 * 宿主侧预处理用户的「给 GitHub 技能 URL 安装」或「主动联网搜索并安装技能」意图：
 * 1. 当用户在消息中提供了 GitHub 技能链接（repo / tree / blob / raw）且处于 Craft 模式时，
 *    直接由宿主主进程（不受 ACL 沙箱限制）预检并安装到 `$DSH_HOME/skills/<name>/SKILL.md`，
 *    同步写入 `.aiart-github-skill.json` 与 `.installed-github-skills.json`，下发工具完成卡片，
 *    并将已安装技能的完整 `SKILL.md` 指令直接注入本轮上下文，彻底杜绝模型用 `web_fetch + pwsh + write`
 *    越界写盘触发沙箱拒绝或多次弹窗提权。
 * 2. 当用户要求「上网搜索某个技能并安装」时，宿主主进程先执行 `searchOnlineSkills` 检索候选技能，
 *    若用户明确要求安装且命中高置信候选，则在 Craft 模式下直接预装首条匹配技能并把完整候选列表与已装指令一并注入本轮提示词。
 */
async function preprocessOnlineSkillInstallIntent(input: {
  taskText: string
  mode: ChatMode
  workspaceRoot: string
}): Promise<string> {
  const { taskText, mode, workspaceRoot } = input
  if (mode === 'ask' || taskText.startsWith('[Claude Code Skill Active:')) return taskText

  // 1. 提取消息中的 GitHub URL
  const urlMatches =
    taskText.match(
      /https?:\/\/(?:github\.com|raw\.githubusercontent\.com)\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[^\s，。；！？"',)>]*)?/gi
    ) ?? []
  const validGhUrls = [
    ...new Set(
      urlMatches
        .map((u) => u.replace(/[.,;:!?)'"`]+$/, ''))
        .filter((u) => Boolean(parseGitHubSkillSourceUrl(u)))
    )
  ]

  const mentionsSkillOrInstall =
    /(?:技能|skill|安装|install|导入|添加|装上|装一下|装个|SKILL\.md)/i.test(taskText) ||
    validGhUrls.some((u) => /\/skills?\b|SKILL\.md/i.test(u))

  if (validGhUrls.length > 0 && mentionsSkillOrInstall && mode === 'craft') {
    const installedBlocks: string[] = []
    for (const url of validGhUrls) {
      const toolCallId = `host-skill-install:${Date.now()}`
      emit({
        type: 'tool',
        id: toolCallId,
        name: 'skill_install',
        state: 'start',
        detail: `正在从 GitHub 安装技能：${url}`
      })
      try {
        let skillNames: string[] | undefined
        const inspected = await inspectGitHubSkillSource({ url })
        if (inspected.ok && inspected.skills && inspected.skills.length > 1) {
          const lowerTask = taskText.toLowerCase()
          const matchedNames = inspected.skills
            .filter((s) => lowerTask.includes(s.name.toLowerCase()))
            .map((s) => s.name)
          if (matchedNames.length > 0) {
            skillNames = matchedNames
          }
        }
        const res = await installGitHubSkills({
          url,
          ...(skillNames?.length ? { skillNames } : {}),
          skillScriptsConsent: false
        })
        if (res.ok && res.installed.length > 0) {
          emit({
            type: 'tool',
            id: toolCallId,
            name: 'skill_install',
            state: 'done',
            detail: `已安装技能：${res.installed.map((n) => `/${n}`).join('、')}`
          })
          const allSkills = discoverInstalledClaudeSkills({ workspaceRoot })
          for (const installedName of res.installed) {
            const entry = allSkills.find((s) => s.name === installedName)
            if (entry) {
              installedBlocks.push(
                [
                  `Installed Skill: /${entry.name} (from ${url})`,
                  `Skill Directory: ${entry.dirPath}`,
                  `Skill File: ${entry.skillFilePath}`,
                  ...(res.skippedScriptsFor?.includes(entry.name)
                    ? [
                        `Note: Bundled scripts/ were skipped by default for safety. If running bundled scripts is required, ask the user via ask_user_question and call skill_install({ url: "${url}", skillNames: ["${entry.name}"], allowScripts: true }).`
                      ]
                    : []),
                  `<skill name="${entry.name}" dir="${entry.dirPath}">`,
                  entry.body,
                  `</skill>`
                ].join('\n')
              )
            }
          }
        } else {
          emit({
            type: 'tool',
            id: toolCallId,
            name: 'skill_install',
            state: 'done',
            detail: res.error ?? res.reasonKey ?? '未发现可安装的 SKILL.md'
          })
        }
      } catch (err) {
        emit({
          type: 'tool',
          id: toolCallId,
          name: 'skill_install',
          state: 'done',
          detail: err instanceof Error ? err.message : String(err)
        })
      }
    }

    if (installedBlocks.length > 0) {
      return [
        taskText,
        '',
        '[Studio Host Pre-Installed GitHub Skill(s)]',
        'IMPORTANT: The studio host has ALREADY downloaded and installed the requested GitHub skill(s) into `$DSH_HOME/skills` before this turn started.',
        'Do NOT call `web_fetch`, `pwsh`, `New-Item`, or `write` to download or write `SKILL.md` into `$DSH_HOME/skills` again (that path is outside the workspace sandbox and manual writes will fail).',
        "Acknowledge that the skill is now installed (and available via `/<skill-name>`), and immediately follow the installed skill instructions below together with AIArtEngine's built-in node capabilities to complete the rest of the user request:",
        '',
        ...installedBlocks,
        '',
        buildStudioNodeCapabilitiesBridge()
      ].join('\n')
    }
  }

  // 2. 无直接 URL，但用户要求联网搜索/查找/安装技能
  const asksOnlineSkillSearch =
    validGhUrls.length === 0 &&
    /(?:技能|skill|skills)/i.test(taskText) &&
    /(?:搜索|搜一下|搜个|搜|上网|联网|在线|查找|找一个|找个|找|安装|install|装上|装一下|装个|导入|添加|search|github)/i.test(
      taskText
    )

  if (asksOnlineSkillSearch) {
    const searchCallId = `host-skill-search:${Date.now()}`
    emit({
      type: 'tool',
      id: searchCallId,
      name: 'skill_search',
      state: 'start',
      detail: '正在联网检索匹配的技能…'
    })
    try {
      const searchRes = await searchOnlineSkills({ query: taskText, limit: 8 })
      emit({
        type: 'tool',
        id: searchCallId,
        name: 'skill_search',
        state: 'done',
        detail: `找到 ${searchRes.items.length} 个候选技能`
      })
      const wantsInstallNow = /(?:安装|install|装上|装一下|装个|导入|添加)/i.test(taskText)
      let autoInstalledBlock = ''
      if (wantsInstallNow && mode === 'craft' && searchRes.items.length > 0) {
        const top = searchRes.items[0]!
        if (top.url) {
          const installCallId = `host-skill-install:${Date.now()}`
          emit({
            type: 'tool',
            id: installCallId,
            name: 'skill_install',
            state: 'start',
            detail: `正在安装技能 /${top.name}（${top.url}）`
          })
          const inst = await installGitHubSkills({
            url: top.url,
            skillNames: [top.name],
            skillScriptsConsent: false
          })
          if (inst.ok && inst.installed.length > 0) {
            emit({
              type: 'tool',
              id: installCallId,
              name: 'skill_install',
              state: 'done',
              detail: `已安装技能：${inst.installed.map((n) => `/${n}`).join('、')}`
            })
            const allSkills = discoverInstalledClaudeSkills({ workspaceRoot })
            const entry = allSkills.find((s) => s.name === inst.installed[0])
            if (entry) {
              autoInstalledBlock = [
                '[Studio Host Auto-Installed Skill from Online Search]',
                `The studio host searched online and automatically installed the best-matching skill: /${entry.name} (${top.url}).`,
                'Do NOT use `pwsh` or `write` to write into `$DSH_HOME/skills`.',
                `<skill name="${entry.name}" dir="${entry.dirPath}">`,
                entry.body,
                `</skill>`,
                '',
                buildStudioNodeCapabilitiesBridge()
              ].join('\n')
            }
          }
        }
      }

      if (searchRes.items.length > 0) {
        const candidatesText = searchRes.items
          .map(
            (item, idx) =>
              `${idx + 1}. /${item.name} — ${item.title}: ${item.description} (url: ${item.url ?? 'N/A'}, hasScripts: ${item.hasScripts}, installed: ${item.installed})`
          )
          .join('\n')
        return [
          taskText,
          '',
          ...(autoInstalledBlock ? [autoInstalledBlock, ''] : []),
          '[Online Skill Search Results]',
          candidatesText,
          'Note: To install or manage any skill, ALWAYS use the studio MCP tools `skill_install({ url })`, `skill_search({ query })`, `skill_list()`, or `skill_uninstall({ name })`. NEVER use `pwsh`, `New-Item`, or `write` to write to `$DSH_HOME/skills`.'
        ].join('\n')
      }
    } catch {
      emit({
        type: 'tool',
        id: searchCallId,
        name: 'skill_search',
        state: 'done',
        detail: '在线技能检索完成'
      })
    }
  }

  // 3. 用户提供了普通网页/技术文章 URL 并要求生成短视频/解说视频/提取图文时：
  //    宿主主进程直接启动本地无头 Chromium 浏览器渲染页面、滚动触发懒加载、提取正文并将文章配图下载到 Cache/imports/，
  //    把正文与 @Cache/imports/... 图片路径一并注入本轮提示词，免去模型用纯文本 web_fetch 丢图。
  const generalHttpUrls =
    taskText
      .match(/https?:\/\/[^\s，。；！？"',)>]+/gi)
      ?.map((u) => u.replace(/[.,;:!?)'"`]+$/, '')) ?? []
  const articleUrls = [
    ...new Set(
      generalHttpUrls.filter(
        (u) =>
          !validGhUrls.includes(u) &&
          !/^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)/i.test(u) &&
          !/^https?:\/\/(?:[\w.-]+\.)?(?:bilibili\.com\/video\/|b23\.tv\/)/i.test(u) &&
          !/\.(?:png|jpe?g|webp|gif|mp4|webm|mp3|wav|glb|gltf|zip)(?:$|[?#])/i.test(u)
      )
    )
  ]
  const asksArticleVideoOrExtract =
    articleUrls.length > 0 &&
    /(?:视频|短视频|成片|解说|科普|分镜|动画|教程|文章|网页|链接|内容|总结|生成|制作|转成|做成|video|short|article|explainer)/i.test(
      taskText
    )

  if (asksArticleVideoOrExtract && mode === 'craft') {
    const targetUrl = articleUrls[0]!
    const extractCallId = `host-web-extract:${Date.now()}`
    emit({
      type: 'tool',
      id: extractCallId,
      name: 'web_extract_article',
      state: 'start',
      detail: `正在启动本地无头浏览器抓取图文：${targetUrl}`
    })
    try {
      const extracted = await extractWebArticleWithHeadlessBrowser({
        url: targetUrl,
        maxImages: 8,
        projectRootOverride: workspaceRoot
      })
      emit({
        type: 'tool',
        id: extractCallId,
        name: 'web_extract_article',
        state: 'done',
        detail: `已提取《${extracted.title}》正文及 ${extracted.images.length} 张文章配图`
      })
      const imagesManifest =
        extracted.images.length > 0
          ? extracted.images
              .map(
                (img) =>
                  `- 图${img.index}: relativePath="${img.relativePath}" | 章节="${img.sectionHeading}" | 图注="${img.caption || img.alt || '无'}" | 上下文="${img.contextText.slice(0, 120)}"`
              )
              .join('\n')
          : '（该页面未提取到独立内容配图，请使用 svg.gen -> svg.anim 或 asset.image / asset.video 生成配套画面）'

      return [
        taskText,
        '',
        '[Studio Host Pre-Extracted Web Article (via Local Headless Chromium Browser)]',
        `IMPORTANT: The studio host has ALREADY rendered ${extracted.url} in a local headless Chromium browser, scrolled lazy-loaded images, extracted the structured article text, and downloaded ${extracted.images.length} article figure(s) into the project's \`Cache/imports/\` directory.`,
        'Do NOT call `web_fetch` or `web_extract_article` on this URL again — use the extracted content and downloaded `Cache/imports/...` image paths below directly!',
        'When building a video pipeline on the active canvas via `graph_edit` + `task_run`:',
        '1. For sections that correspond to a downloaded article figure (`Cache/imports/...`), either create a locked image node (`typeId: "asset.image", locked: true, params: { sourceRelativePath: "Cache/imports/..." }`) wired into `output.timeline`, OR pass `"Cache/imports/..."` as `firstFrameImageUrl` / `referenceImageUrls` on `asset.video` / `asset.image`.',
        '2. For sections without a matching original figure (or where animated diagrams are better), wire `svg.gen -> svg.anim` or `asset.image` / `asset.video` into `output.timeline`.',
        '3. Create per-section `voice.tts` narration nodes and an `audio.music` (`instrumental: true`) BGM node, connect everything into `output.timeline`, and call `task_run({ assetId, nodeIds: ["timeline-out"] })`.',
        '',
        `Article Title: ${extracted.title}`,
        `Source URL: ${extracted.url}`,
        ...(extracted.author ? [`Author: ${extracted.author}`] : []),
        '',
        'Downloaded Article Figures in Cache/imports/:',
        imagesManifest,
        '',
        'Extracted Article Markdown:',
        extracted.markdown
      ].join('\n')
    } catch (err) {
      emit({
        type: 'tool',
        id: extractCallId,
        name: 'web_extract_article',
        state: 'done',
        detail: `无头浏览器提取提示：${err instanceof Error ? err.message : String(err)}`
      })
    }
  }

  return taskText
}

async function startHarnessNow(input: HarnessRunInput): Promise<HarnessRunResult> {
  const rawInputTask = String(input?.task ?? '').trim()
  if (!rawInputTask) return { started: false, message: '任务内容为空' }
  if (turnActive) return { started: false, message: '已有任务正在运行' }

  // 原生 /export 斜杠命令：直接由宿主打包当前会话日志并推送交付卡片
  if (/^\/export(?=$|\s)/i.test(rawInputTask)) {
    const runId = String(++runSeq)
    const targetSessionId = (input.sessionId ?? '').trim()
    turnActive = true
    emit({ type: 'tool', name: 'dsh-agent', state: 'start' })
    const exportCallId = `session-export:${Date.now()}`
    emit({
      type: 'tool',
      id: exportCallId,
      name: 'session_export',
      state: 'start',
      detail: '正在导出当前会话日志 (.zip)…'
    })
    void (async () => {
      try {
        const res = await exportHarnessSession({ sessionId: targetSessionId })
        emit({
          type: 'tool',
          id: exportCallId,
          name: 'session_export',
          state: 'done',
          detail: res.ok ? `已导出到 ${res.archivePath}` : (res.error ?? '当前会话尚无持久化记录')
        })
        let finalText = ''
        if (res.ok && res.archivePath) {
          emit({
            type: 'present',
            callId: exportCallId,
            turn: 0,
            files: [
              {
                path: res.archivePath,
                title: basename(res.archivePath),
                description: `包含 ${res.fileCount ?? 1} 个会话日志文件（关联 ${res.sessionIds?.length ?? 1} 个主/子代理会话）`
              }
            ]
          })
          finalText = `已将当前会话日志导出为压缩包：\`${res.archivePath}\`（共 ${res.fileCount ?? 1} 个文件）。`
        } else {
          finalText = `导出会话失败：${res.error ?? '当前会话尚无持久化记录，请先发送一条消息后再导出。'}`
        }
        emit({ type: 'assistant', text: finalText })
        turnActive = false
        emit({ type: 'tool', name: 'dsh-agent', state: 'done' })
        emit({ type: 'done', runId })
        emit({ type: 'final', text: finalText })
        completeActiveJob({ ok: res.ok, finalText, ...(res.ok ? {} : { error: finalText }) })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        turnActive = false
        emit({ type: 'tool', name: 'dsh-agent', state: 'done' })
        emit({ type: 'error', message: msg })
        completeActiveJob({ ok: false, error: msg })
      }
    })()
    return { started: true }
  }

  const mcp = getMcpServerInfo()
  if (!mcp?.running) {
    return { started: false, message: 'MCP 工具服务未运行，请先在设置中启动' }
  }
  const provider = resolveTextProvider(input?.providerId)
  if (!provider) {
    return { started: false, message: '未配置可用文本模型，请先在模型设置中添加' }
  }

  const workspace = resolveWorkspace()
  const mode = normalizeChatMode(input.mode)
  const isNativeSlashCommand = /^\/(compact|goal|feedback)(?=$|\s)/i.test(rawInputTask)
  const skillPreprocessed = isNativeSlashCommand
    ? { taskText: rawInputTask, activeSkill: null }
    : preprocessSkillInvocation({
        taskText: rawInputTask,
        sessionId: input.sessionId,
        workspaceRoot: workspace
      })

  // 立即置 turnActive = true，封闭 preprocessOnlineSkillInstallIntent 与 ensurePersistentWorker
  // 异步等待期间的并发窗口，保证期间到达的新消息稳定进入队列
  turnActive = true
  const myAbortSeq = abortSeq
  let taskAfterOnlineSkills = skillPreprocessed.taskText
  if (!isNativeSlashCommand) {
    try {
      taskAfterOnlineSkills = await preprocessOnlineSkillInstallIntent({
        taskText: skillPreprocessed.taskText,
        mode,
        workspaceRoot: workspace
      })
    } catch {
      taskAfterOnlineSkills = skillPreprocessed.taskText
    }
  }
  if (abortSeq !== myAbortSeq || !turnActive) {
    return { started: false, message: '已中止' }
  }
  if (!isNativeSlashCommand) {
    syncActiveCanvasFromWorkspaceContext(input.canvasContext)
  }
  const canvasContext = isNativeSlashCommand ? '' : resolveProjectCanvasContext(input.canvasContext)
  const rawTask = canvasContext
    ? `${taskAfterOnlineSkills}\n\n[Workspace Canvas & Node Context]\n${canvasContext}`
    : taskAfterOnlineSkills
  activeSkillTurn = skillPreprocessed.activeSkill ?? null
  const effectiveSessionId =
    skillPreprocessed.activeSkill?.isolatedSessionId ?? (input.sessionId?.trim() || '')

  const runId = String(++runSeq)
  const rawModelId =
    skillPreprocessed.activeSkill?.modelOverride?.trim() || input.model?.trim() || provider.modelId
  const isGoogle =
    provider.provider.providerKind === 'google' ||
    /generativelanguage\.googleapis\.com/i.test(provider.baseUrl ?? '')
  const isOpenAi =
    provider.provider.providerKind === 'openai' ||
    /\bapi\.openai\.com\b/i.test(provider.baseUrl ?? '')
  const modelId = isGoogle
    ? resolveGoogleChatModelId(rawModelId)
    : isOpenAi
      ? normalizeOpenAiTextModelId(rawModelId, { hasTools: true })
      : rawModelId
  lastPreferredProviderId = provider.provider.id
  lastPreferredModelId = modelId
  const textCatalog =
    modalityConfig(provider.provider, 'text').catalog?.[rawModelId] ??
    modalityConfig(provider.provider, 'text').catalog?.[modelId]
  const inputModalities = resolveDshChatInputModalitiesForProvider(provider.provider, modelId)
  const modelName = textCatalog?.name?.trim() || modelId
  const dshEntry = resolveDshEntry()
  const dshModules = dshEntry ? locateNodeModules(dshEntry) : null
  const canPersist = !!(dshEntry && dshModules)

  lastStatusText = ''
  clearIdleTimer()

  if (!canPersist) {
    // npx / 无 runner：保持 one-shot
    writeDshConfig(mcp.endpoint, mode, runId, getBlenderClientForHarness(), mcp.port, {
      baseUrl: provider.baseUrl,
      modelId,
      modelName,
      inputModalities,
      provider: provider.provider
    })
    registerHarnessRunAccess(runId, mode)
    setActiveHarnessRun(runId, mode)
    writeDshSettings({
      baseUrl: provider.baseUrl,
      modelId,
      modelName,
      inputModalities,
      provider: provider.provider
    })
    cleanupLegacyDshSkills()
    emitStatus(
      dshEntry
        ? '正在启动 DeepSeek Harness…'
        : '首次运行：正在准备 dsh 运行体（需联网，约 1–2 分钟）'
    )
    if (workspaceNotified !== workspace) {
      workspaceNotified = workspace
      emitStatus(
        workspace === app.getPath('userData')
          ? '未打开工程：AI 工作区为应用数据目录（建议先打开工程）'
          : `工作区：${workspace}`
      )
    }
    emit({ type: 'tool', name: 'dsh-agent', state: 'start' })
    const nodeCmd = dshEntry ? resolveNodeCommand() : null
    const command = nodeCmd?.command ?? (process.platform === 'win32' ? 'npx.cmd' : 'npx')
    const hideWindowsHook = writeHideChildWindowsHook()
    const args = dshEntry
      ? [
          ...(nodeCmd ? ['--expose-internals'] : []),
          ...(nodeCmd && hideWindowsHook ? ['--require', hideWindowsHook] : []),
          dshEntry,
          '--profile',
          'headless',
          rawTask
        ]
      : ['--yes', DSH_PACKAGE, '--profile', 'headless', rawTask]
    launchDsh({
      command,
      args,
      workspace,
      env: {
        ...process.env,
        ...(nodeCmd?.env ?? {}),
        ...(hideWindowsHook
          ? { NODE_OPTIONS: appendNodeRequireOption(process.env.NODE_OPTIONS, hideWindowsHook) }
          : {}),
        DSH_HOME: dshHome(),
        DEEPSEEK_API_KEY: provider.apiKey,
        DSH_MODEL: modelId,
        ...(provider.baseUrl ? { DEEPSEEK_BASE_URL: provider.baseUrl } : {}),
        STUDIO_MCP_TOKEN: mcp.token,
        ...(effectiveSessionId ? { AIART_SESSION_ID: effectiveSessionId } : {}),
        AIART_ASK_DIR: join(app.getPath('temp'), 'aiart-harness-ask'),
        AIART_RUN_ID: runId,
        AIART_MODE: mode
      } as NodeJS.ProcessEnv,
      runId,
      dshEntry,
      persistent: false
    })
    return { started: true }
  }

  try {
    await ensurePersistentWorker({
      provider,
      modelId,
      modelName,
      inputModalities,
      mode
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (abortSeq === myAbortSeq) {
      turnActive = false
      activeSkillTurn = null
      completeActiveJob({ ok: false, error: message, finalText: '' })
    }
    return {
      started: false,
      message
    }
  }

  if (abortSeq !== myAbortSeq || !turnActive) {
    return { started: false, message: '已中止' }
  }

  if (workerModelId !== modelId) {
    writeDshSettings({
      baseUrl: provider.baseUrl,
      modelId,
      modelName,
      inputModalities,
      provider: provider.provider
    })
    sendWorkerCommand({
      op: 'set_model',
      modelId,
      modelName,
      inputModalities: [...inputModalities]
    })
    workerModelId = modelId
  }

  registerHarnessRunAccess(runId, mode)
  setActiveHarnessRun(runId, mode)
  ;(
    child as
      | (ChildProcess & { __aiartSetRunId?: (id: string) => void; __aiartResetTurn?: () => void })
      | null
  )?.__aiartResetTurn?.()
  ;(child as (ChildProcess & { __aiartSetRunId?: (id: string) => void }) | null)?.__aiartSetRunId?.(
    runId
  )

  emit({ type: 'tool', name: 'dsh-agent', state: 'start' })
  // 不在每轮刷「等待模型首包」：常驻热路径下会误导成「又在冷启动」；
  // 真卡住由下方 15s 心跳提示「仍在等待模型响应」。

  const ok = sendWorkerCommand({
    op: 'prompt',
    task: rawTask,
    sessionId: effectiveSessionId,
    mode,
    runId
  })
  if (!ok) {
    const message = '无法向常驻 dsh 写入任务'
    turnActive = false
    activeSkillTurn = null
    clearActiveHarnessRun()
    releaseHarnessRunAccess(runId)
    resetWorkerState()
    completeActiveJob({ ok: false, error: message, finalText: '' })
    return { started: false, message }
  }

  // 无输出心跳：仅提示、不自动中止。有模型/工具输出后停掉；稀疏里程碑避免刷屏。
  const turnStartedAt = Date.now()
  let lastWaitEmitSec = 0
  const idleProgress = setInterval(() => {
    if (!turnActive || !child) {
      clearInterval(idleProgress)
      return
    }
    const procEx = child as ChildProcess & {
      __aiartTurnSawOutput?: () => boolean
      __aiartTurnAccepted?: () => boolean
    }
    if (procEx.__aiartTurnSawOutput?.()) {
      clearInterval(idleProgress)
      return
    }
    const waited = Math.round((Date.now() - turnStartedAt) / 1000)
    // 超过 4 分钟后每 2 分钟再提示一次，仍不中止
    const milestones = [15, 60, 120, 180, 240]
    let hit = milestones.find((s) => waited >= s && lastWaitEmitSec < s)
    if (hit === undefined && waited > 240 && waited - lastWaitEmitSec >= 120) {
      hit = waited
    }
    if (hit === undefined) return
    lastWaitEmitSec = hit
    const accepted = procEx.__aiartTurnAccepted?.() ?? false
    emitStatus(
      accepted
        ? `模型尚未返回内容（已等待 ${hit}s）。可手动中止后检查网络 / OpenRouter 额度或换模型重试`
        : `仍在等待 runner 接手任务（已等待 ${hit}s）。可手动中止后重试`
    )
  }, 5_000)
  const poll = setInterval(() => {
    if (!turnActive) {
      clearInterval(idleProgress)
      clearInterval(poll)
    }
  }, 500)
  void poll

  return { started: true }
}

/** 强制结束 dsh 进程（含 Windows 进程树，避免杀不干净导致「已请求中止」却仍挂着） */
function forceKillProcess(proc: ChildProcess): void {
  const pid = proc.pid
  if (process.platform === 'win32' && pid) {
    try {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
        shell: false
      })
      return
    } catch {
      /* fall through */
    }
  }
  try {
    proc.kill('SIGKILL')
  } catch {
    try {
      proc.kill()
    } catch {
      /* already dead */
    }
  }
}

export function abortHarnessTask(): void {
  abortSeq++
  clearIdleTimer()
  const hadTurn = turnActive
  activeSkillTurn = null
  if (!child) {
    turnActive = false
    clearActiveHarnessRun()
    if (workerRunId) releaseHarnessRunAccess(workerRunId)
    // 无子进程也要让面板退出 running（例如正在异步预检/拉起常驻进程或已崩但 UI 未收）
    if (hadTurn) {
      emit({ type: 'tool', name: 'dsh-agent', state: 'done' })
      emit({ type: 'error', message: '已中止' })
      completeActiveJob({ ok: false, error: '已中止', finalText: '' })
    } else {
      emit({ type: 'done', runId: workerRunId || '0' })
    }
    return
  }
  emit({ type: 'status', text: '已请求中止' })
  const proc = child
  ;(proc as ChildProcess & { __aiartMarkAborted?: () => void }).__aiartMarkAborted?.()
  turnActive = false
  clearActiveHarnessRun()
  if (workerRunId) releaseHarnessRunAccess(workerRunId)
  forceKillProcess(proc)
  resetWorkerState()
  // 必须发 error/done：面板只在这两种事件里把 running 置 false
  emit({ type: 'tool', name: 'dsh-agent', state: 'done' })
  if (hadTurn) {
    emit({ type: 'error', message: '已中止' })
    completeActiveJob({ ok: false, error: '已中止', finalText: '' })
  } else {
    emit({ type: 'done', runId: '0' })
  }
}

/**
 * 渲染层回传 ask_user_question 的用户选择（经 main/ipc.ts 分发，requestId 以 harness: 开头）：
 * 把选择写入 answerFile，runner 侧 provider 轮询读到后把答案返回给 agent。
 */
export function handleAskUserResponse(payload: AskUserAnswer): void {
  const entry = harnessAskUserRequests.get(payload.requestId)
  if (!entry || !entry.answerFile) return
  harnessAskUserRequests.delete(payload.requestId)
  // Plan 模式：用户对计划给出任何非「取消」的选择即视为确认，本条消息内放行写 / 生成类工具
  // （MCP 侧按请求头里的 runId 回查这个标记，见 mcpServerService.confirmHarnessRunAccess）
  // `fromCustom`：用户自己打字的回答是任意句子，判断「是否取消」得换严格口径（见 isCancelAnswer），
  // 否则「不要正面，要侧脸」会被当成取消，写权限悄悄不放行。
  if (!isCancelAnswer(payload.answer, payload.fromCustom === true))
    confirmHarnessRunAccess(entry.runId)
  try {
    mkdirSync(dirname(entry.answerFile), { recursive: true })
    writeFileSync(
      entry.answerFile,
      JSON.stringify({
        answers: [
          {
            id: entry.questionId,
            selected:
              typeof payload.answer === 'string' && payload.answer !== '' ? [payload.answer] : []
          }
        ]
      }),
      'utf8'
    )
  } catch {
    // 写文件失败：runner 侧 5 分钟超时返回空答案，agent 正常继续
  }
}

/**
 * 渲染层回传 dsh 审批的用户决定：把决定写入回答文件，dsh 侧的应答插件轮询读到后
 * 翻译成审批结果（只有 `allow-once` 会变成 `allowed-once`，且只对本次调用有效）。
 *
 * 三条失败即关闭的规则：
 * - 找不到待决定条目（本轮已结束 / 进程已换 / requestId 不认识）→ 返回 false，不写文件；
 * - 决定认不出来（不是两个字面量之一）→ 由 `approvalAnswerForDecision` **按拒绝写**；
 * - 写盘失败 → 返回 false，dsh 侧超时收敛到 unavailable。
 */
export function handleApprovalResponse(payload: ApprovalAnswer): boolean {
  const requestId = typeof payload?.requestId === 'string' ? payload.requestId : ''
  const entry = requestId ? harnessApprovalRequests.get(requestId) : undefined
  if (!entry || !entry.answerFile) return false
  harnessApprovalRequests.delete(requestId)
  try {
    mkdirSync(dirname(entry.answerFile), { recursive: true })
    // 写盘内容由 @shared/dshApproval 决定：认不出的决定在那里按拒绝处理（不放行）
    writeFileSync(entry.answerFile, approvalAnswerForDecision(payload?.decision), 'utf8')
    return true
  } catch {
    return false
  }
}

/** 请求常驻 worker 刷盘并释放指定会话的写锁，便于宿主直接读取/导出/截断会话文件 */
async function requestWorkerReleaseSession(sessionId?: string): Promise<void> {
  if (!child || !workerPersistent || !workerReady || turnActive) return
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      sessionReleaseWaiters = sessionReleaseWaiters.filter((w) => w !== onDone)
      resolve()
    }, 1500)
    const onDone = (): void => {
      clearTimeout(timer)
      resolve()
    }
    sessionReleaseWaiters.push(onDone)
    const ok = sendWorkerCommand({ op: 'release_session', ...(sessionId ? { sessionId } : {}) })
    if (!ok) {
      clearTimeout(timer)
      sessionReleaseWaiters = sessionReleaseWaiters.filter((w) => w !== onDone)
      resolve()
    }
  })
}

const ZSTD_MAGIC = 0xfd2fb528
const SKIPPABLE_MASK = 0xfffffff0
const SKIPPABLE_MAGIC = 0x184d2a50
const FCS_SIZES = [0, 2, 4, 8]

function scanZstdFrames(buf: Buffer): Array<{ start: number; end: number }> {
  const frames: Array<{ start: number; end: number }> = []
  let pos = 0
  while (pos < buf.length) {
    if (pos + 4 > buf.length) break
    const magic = buf.readUInt32LE(pos)
    if ((magic & SKIPPABLE_MASK) === SKIPPABLE_MAGIC) {
      if (pos + 8 > buf.length) break
      const size = buf.readUInt32LE(pos + 4)
      if (pos + 8 + size > buf.length) break
      pos += 8 + size
      continue
    }
    if (magic !== ZSTD_MAGIC) break
    const frameStart = pos
    pos += 4
    if (pos >= buf.length) break
    const fhd = buf[pos++]!
    const fcsFlag = fhd >>> 6
    const singleSegment = (fhd & 0x20) !== 0
    const hasChecksum = (fhd & 0x04) !== 0
    const dictIdFlag = fhd & 0x03
    if (!singleSegment) {
      if (pos >= buf.length) break
      pos += 1
    }
    const dictSize = dictIdFlag === 0 ? 0 : 1 << (dictIdFlag - 1)
    pos += dictSize
    const fcsSize = fcsFlag === 0 && singleSegment ? 1 : FCS_SIZES[fcsFlag]!
    pos += fcsSize
    if (pos > buf.length) break
    let frameComplete = false
    while (pos + 3 <= buf.length) {
      const bh = buf[pos]! | (buf[pos + 1]! << 8) | (buf[pos + 2]! << 16)
      pos += 3
      const lastBlock = (bh & 1) !== 0
      const blockType = (bh >>> 1) & 3
      const blockSize = bh >>> 3
      if (blockType === 3) break
      const payloadBytes = blockType === 1 ? 1 : blockSize
      if (pos + payloadBytes > buf.length) break
      pos += payloadBytes
      if (lastBlock) {
        if (hasChecksum) {
          if (pos + 4 > buf.length) break
          pos += 4
        }
        frameComplete = true
        break
      }
    }
    if (!frameComplete) break
    frames.push({ start: frameStart, end: pos })
  }
  return frames
}

interface DiskSessionData {
  sessionDir: string
  filePath: string
  compressed: boolean
  header: Record<string, unknown>
  events: Array<{ seq: number; timestamp: string; type: string; data: Record<string, unknown> }>
}

function readDiskSession(sessionDir: string): DiskSessionData | null {
  const zstdPath = join(sessionDir, 'session.v3.jsonl.zstd')
  const plainPath = join(sessionDir, 'session.v3.jsonl')
  let rawText = ''
  let filePath = ''
  let compressed = false
  try {
    if (existsSync(zstdPath)) {
      filePath = zstdPath
      compressed = true
      const buf = readFileSync(zstdPath)
      const frames = scanZstdFrames(buf)
      const parts: string[] = []
      for (const frame of frames) {
        const decompressed = zstdDecompressSync(buf.subarray(frame.start, frame.end))
        parts.push(decompressed.toString('utf8'))
      }
      rawText = parts.join('')
    } else if (existsSync(plainPath)) {
      filePath = plainPath
      compressed = false
      rawText = readFileSync(plainPath, 'utf8')
    } else {
      return null
    }
  } catch {
    return null
  }
  const lines = rawText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  if (!lines.length) return null
  try {
    const header = JSON.parse(lines[0]!) as Record<string, unknown>
    if (header.type !== 'session') return null
    const events: DiskSessionData['events'] = []
    for (let i = 1; i < lines.length; i++) {
      try {
        const ev = JSON.parse(lines[i]!)
        if (ev && typeof ev.type === 'string') {
          events.push(ev)
        }
      } catch {
        /* ignore corrupted tail line */
      }
    }
    return { sessionDir, filePath, compressed, header, events }
  } catch {
    return null
  }
}

function writeDiskSession(
  targetDir: string,
  header: Record<string, unknown>,
  events: DiskSessionData['events'],
  compressed = true
): void {
  mkdirSync(targetDir, { recursive: true })
  const headerLine = `${JSON.stringify(header)}\n`
  const eventsBody = events.map((ev, idx) => JSON.stringify({ ...ev, seq: idx })).join('\n')
  const eventsPayload = eventsBody ? `${eventsBody}\n` : ''
  const checkpointPath = join(targetDir, 'session.v3.checkpoint.json')
  if (existsSync(checkpointPath)) {
    try {
      rm(checkpointPath, { force: true }).catch(() => {})
    } catch {
      /* ignore */
    }
  }
  if (compressed) {
    const zstdParams = { params: { [zlibConstants.ZSTD_c_checksumFlag]: 1 } }
    const frame0 = zstdCompressSync(Buffer.from(headerLine, 'utf8'), zstdParams)
    const chunks = [frame0]
    if (eventsPayload) {
      chunks.push(zstdCompressSync(Buffer.from(eventsPayload, 'utf8'), zstdParams))
    }
    writeFileSync(join(targetDir, 'session.v3.jsonl.zstd'), Buffer.concat(chunks))
  } else {
    writeFileSync(join(targetDir, 'session.v3.jsonl'), headerLine + eventsPayload, 'utf8')
  }
}

function findSessionDirectories(sessionId: string): string[] {
  const id = String(sessionId ?? '').trim()
  if (!id || !/^[A-Za-z0-9._-]+$/.test(id)) return []
  const sessionsRoot = join(dshHome(), 'sessions')
  if (!existsSync(sessionsRoot)) return []
  const dirs: string[] = []
  try {
    for (const entry of readdirSync(sessionsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const candidate = join(sessionsRoot, entry.name, id)
      if (existsSync(candidate)) dirs.push(candidate)
    }
  } catch {
    /* ignore */
  }
  return dirs
}

/**
 * 删除会话在磁盘上的持久化记录（`$DSH_HOME/sessions/<project>/<id>/`）。
 * 前端删除会话后调用：否则 localStorage 里的会话没了，但 dsh 的 JSONL 日志仍在，
 * 下次同 id 发消息会被「幽灵恢复」成已删除的对话。路径布局与
 * dsh-session-persistence-jsonl 保持一致（root = dshHomePath('sessions')，按项目分目录）。
 */
export async function deleteHarnessSession(sessionId: string): Promise<void> {
  const id = String(sessionId ?? '').trim()
  // 只放行安全字符，防止把删除目标带出 sessions 目录
  if (!id || !/^[A-Za-z0-9._-]+$/.test(id)) return
  await requestWorkerReleaseSession(id)
  const sessionsRoot = join(dshHome(), 'sessions')
  let entries
  try {
    entries = await readdir(sessionsRoot, { withFileTypes: true })
  } catch {
    return // 尚无任何会话记录
  }
  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        try {
          await rm(join(sessionsRoot, entry.name, id), { recursive: true, force: true })
        } catch {
          // 单个项目目录清理失败不阻塞整体删除
        }
      })
  )
}

/**
 * 导出指定会话日志为 .zip 压缩包（复用 @deepseek-ai/dsh-session-log-export，自动收集关联子代理会话与附件）。
 */
export async function exportHarnessSession(
  input: ExportHarnessSessionInput
): Promise<ExportHarnessSessionResult> {
  const id = String(input?.sessionId ?? '').trim()
  if (!id || !/^[A-Za-z0-9._-]+$/.test(id)) {
    return { ok: false, error: '无效的会话 ID' }
  }
  await requestWorkerReleaseSession(id)
  const dirs = findSessionDirectories(id)
  if (!dirs.length) {
    return { ok: false, error: '当前会话尚无持久化记录，请先发送一条消息后再导出' }
  }
  const workspace = resolveWorkspace()
  const defaultOut = join(workspace, 'Output', 'Exports', `session-${id}-${Date.now()}.zip`)
  const outputPath = input.outputPath?.trim()
    ? resolve(workspace, input.outputPath.trim())
    : defaultOut
  mkdirSync(dirname(outputPath), { recursive: true })

  const dshEntry = resolveDshEntry()
  const dshModules = dshEntry ? locateNodeModules(dshEntry) : null
  if (dshModules) {
    try {
      const exportPkgPath = join(
        dshModules,
        '@deepseek-ai',
        'dsh-session-log-export',
        'dist',
        'index.mjs'
      )
      if (existsSync(exportPkgPath)) {
        const mod = (await import(pathToFileURL(exportPkgPath).href)) as {
          exportSessionLogBundle: (opts: {
            rootSessionId: string
            sessionsRoot: string
            outputPath: string
            now?: Date
          }) => Promise<{
            archivePath: string
            rootSessionId: string
            sessionIds: string[]
            fileCount: number
          }>
        }
        const res = await mod.exportSessionLogBundle({
          rootSessionId: id,
          sessionsRoot: join(dshHome(), 'sessions'),
          outputPath,
          now: new Date()
        })
        return {
          ok: true,
          path: res.archivePath,
          archivePath: res.archivePath,
          filePath: res.archivePath,
          sessionIds: [...res.sessionIds],
          fileCount: res.fileCount
        }
      }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }
  return { ok: false, error: '未找到 @deepseek-ai/dsh-session-log-export 模块' }
}

/**
 * 在指定用户轮次处回退（截断）或分叉（克隆到新会话 ID）持久化会话记录。
 * `userTurnIndex` / `keepTurns` 为 0-based 的用户消息序号：保留前 N 轮用户消息及其回复。
 */
export async function rewindHarnessSession(
  input: RewindHarnessSessionInput
): Promise<RewindHarnessSessionResult> {
  const id = String(input?.sessionId ?? '').trim()
  if (!id || !/^[A-Za-z0-9._-]+$/.test(id)) {
    return { ok: false, error: '无效的会话 ID' }
  }
  const userTurnIndex = Math.max(0, Math.floor(Number(input.keepTurns ?? input.userTurnIndex ?? 0)))
  const explicitForkId = String(input.forkSessionId ?? input.targetSessionId ?? '').trim()
  const fork = Boolean(input.fork || (explicitForkId && explicitForkId !== id))
  const targetSessionId = fork
    ? explicitForkId || `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    : id

  await requestWorkerReleaseSession(id)
  const dirs = findSessionDirectories(id)
  if (!dirs.length) {
    return { ok: true, sessionId: targetSessionId, keptEvents: 0 }
  }

  let totalKept = 0
  for (const dir of dirs) {
    const parsed = readDiskSession(dir)
    if (!parsed) continue
    let userMsgSeen = 0
    let cutIndex = parsed.events.length
    for (let i = 0; i < parsed.events.length; i++) {
      const ev = parsed.events[i]!
      const source = (ev.data?.message as { source?: { kind?: string } } | undefined)?.source
      if (ev.type === 'user/message' && (!source || source.kind === 'user')) {
        if (userMsgSeen === userTurnIndex) {
          // 若紧邻上一条是 turn/start，一并截掉
          cutIndex = i > 0 && parsed.events[i - 1]?.type === 'turn/start' ? i - 1 : i
          break
        }
        userMsgSeen += 1
      }
    }
    const keptEvents = parsed.events.slice(0, cutIndex)
    totalKept = Math.max(totalKept, keptEvents.length)
    const outDir = fork ? join(dirname(dir), targetSessionId) : dir
    const outHeader = fork
      ? {
          ...parsed.header,
          id: targetSessionId,
          createdAt: new Date().toISOString(),
          parentSession: id,
          origin: 'fork'
        }
      : parsed.header
    writeDiskSession(outDir, outHeader, keptEvents, parsed.compressed)
  }

  return {
    ok: true,
    sessionId: targetSessionId,
    keptEvents: totalKept
  }
}

/**
 * 跨会话全文搜索历史记录（直接解码 `$DSH_HOME/sessions` 下所有项目的 v3 JSONL/zstd 会话日志）。
 */
export async function searchHarnessSessions(
  input: SearchHarnessSessionsInput
): Promise<SearchHarnessSessionsResult> {
  const query = String(input?.query ?? '').trim()
  if (!query) return { ok: true, hits: [] }
  const limit = Math.min(Math.max(Number(input?.limit ?? 20), 1), 100)
  const keywords = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!keywords.length) return { ok: true, hits: [] }

  const sessionsRoot = join(dshHome(), 'sessions')
  if (!existsSync(sessionsRoot)) return { ok: true, hits: [] }

  const hits: HarnessSessionSearchHit[] = []
  try {
    const projects = readdirSync(sessionsRoot, { withFileTypes: true }).filter((d) =>
      d.isDirectory()
    )
    for (const proj of projects) {
      const projDir = join(sessionsRoot, proj.name)
      let sessionDirs: import('node:fs').Dirent[] = []
      try {
        sessionDirs = readdirSync(projDir, { withFileTypes: true }).filter((d) => d.isDirectory())
      } catch {
        continue
      }
      for (const sDir of sessionDirs) {
        const parsed = readDiskSession(join(projDir, sDir.name))
        if (!parsed) continue
        // 跳过子代理内部会话，只检索主会话与分叉会话
        if (parsed.header.origin === 'subagent') continue
        const sessionId = String(parsed.header.id ?? sDir.name)
        for (const ev of parsed.events) {
          if (ev.type !== 'user/message' && ev.type !== 'assistant/message') continue
          const role: 'user' | 'assistant' = ev.type === 'user/message' ? 'user' : 'assistant'
          const msg = ev.data?.message as
            | {
                source?: { kind?: string }
                content?: Array<{ type?: string; text?: string }>
              }
            | undefined
          if (role === 'user' && msg?.source?.kind && msg.source.kind !== 'user') continue
          const rawContent = Array.isArray(msg?.content)
            ? msg!.content
                .filter((b) => b?.type === 'text' && typeof b.text === 'string')
                .map((b) => b.text!)
                .join('\n')
            : ''
          if (!rawContent) continue
          // 剥掉注入的 [AIArtEngine panel mode: ...] 与 [Workspace Canvas & Node Context]
          const cleanText = rawContent
            .replace(/^\[AIArtEngine panel mode:[^\]]*\]\s*/i, '')
            .replace(/\n*\[Workspace Canvas & Node Context\][\s\S]*$/i, '')
            .trim()
          if (!cleanText) continue
          const lower = cleanText.toLowerCase()
          if (!keywords.every((kw) => lower.includes(kw))) continue
          const firstIdx = lower.indexOf(keywords[0]!)
          const snippetStart = Math.max(0, firstIdx - 36)
          const snippetEnd = Math.min(cleanText.length, firstIdx + 120)
          const snippet =
            (snippetStart > 0 ? '…' : '') +
            cleanText.slice(snippetStart, snippetEnd).replace(/\s+/g, ' ') +
            (snippetEnd < cleanText.length ? '…' : '')
          const ts = ev.timestamp || String(parsed.header.createdAt || '')
          hits.push({
            sessionId,
            seq: ev.seq,
            timestamp: ts,
            updatedAt: ts,
            role,
            snippet,
            ...(typeof parsed.header.cwd === 'string' ? { cwd: parsed.header.cwd } : {})
          })
        }
      }
    }
  } catch (error) {
    return {
      ok: false,
      hits: [],
      error: error instanceof Error ? error.message : String(error)
    }
  }

  hits.sort((a, b) => (b.timestamp ?? '').localeCompare(a.timestamp ?? ''))
  return { ok: true, hits: hits.slice(0, limit) }
}

/**
 * 控制多轮目标执行器（暂停 / 恢复 / 结束）。
 */
export async function controlHarnessGoal(
  input: ControlHarnessGoalInput
): Promise<{ ok: boolean; goal?: HarnessGoalView | null; error?: string }> {
  const rawAction = input?.action
  const action = rawAction === 'complete' || rawAction === 'clear' ? 'end' : rawAction
  if (action !== 'pause' && action !== 'resume' && action !== 'end') {
    return { ok: false, error: '不支持的目标操作' }
  }
  if (action === 'resume' && !turnActive) {
    const started = await runHarnessTask({
      task: '/goal resume',
      sessionId: input.sessionId,
      mode: 'craft'
    })
    return { ok: started.started, goal: lastGoalSnapshot, error: started.message }
  }
  if (child && workerPersistent && workerReady) {
    sendWorkerCommand({
      op: 'goal_control',
      action,
      ...(input.summary ? { summary: input.summary } : {}),
      ...(input.sessionId ? { sessionId: input.sessionId } : {})
    })
    if (lastGoalSnapshot) {
      if (action === 'pause') {
        lastGoalSnapshot = { ...lastGoalSnapshot, phase: 'paused', activation: 'paused' }
      } else if (action === 'end') {
        lastGoalSnapshot = { ...lastGoalSnapshot, phase: 'completed', activation: 'paused' }
      }
      emit({ type: 'goal', goal: lastGoalSnapshot })
    }
    return { ok: true, goal: lastGoalSnapshot }
  }
  return { ok: false, error: '当前无运行中的目标会话' }
}

/**
 * 取消会话内待触发的定时提醒。
 */
export async function deleteHarnessSchedule(
  input: DeleteHarnessScheduleInput
): Promise<{ ok: boolean; schedules?: HarnessScheduleView[]; error?: string }> {
  const scheduleId = String(input?.scheduleId ?? '').trim()
  if (!scheduleId) return { ok: false, error: '缺少 scheduleId' }
  if (child && workerPersistent && workerReady) {
    sendWorkerCommand({
      op: 'schedule_delete',
      scheduleId,
      ...(input.sessionId ? { sessionId: input.sessionId } : {})
    })
  }
  lastSchedulesSnapshot = lastSchedulesSnapshot.filter((s) => s.id !== scheduleId)
  activeScheduleCount = lastSchedulesSnapshot.length
  emit({ type: 'schedule', schedules: lastSchedulesSnapshot })
  return { ok: true, schedules: lastSchedulesSnapshot }
}

/**
 * 打开或定位交付物文件（供 present 卡片与导出压缩包卡片直接调用）。
 */
export async function openHarnessFile(
  input: OpenHarnessFileInput
): Promise<{ ok: boolean; error?: string }> {
  const rawPath = String(input?.path ?? input?.filePath ?? '').trim()
  if (!rawPath) return { ok: false, error: '文件路径为空' }
  const workspace = resolveWorkspace()
  const absPath = isAbsolute(rawPath) ? resolve(rawPath) : resolve(workspace, rawPath)
  const relToWorkspace = relative(workspace, absPath)
  const relToHome = relative(dshHome(), absPath)
  const insideAllowed =
    (!relToWorkspace.startsWith('..') && !isAbsolute(relToWorkspace)) ||
    (!relToHome.startsWith('..') && !isAbsolute(relToHome))
  if (!insideAllowed) {
    return { ok: false, error: '仅允许打开工作区或 Harness 目录下的文件' }
  }
  if (!existsSync(absPath)) {
    return { ok: false, error: `文件不存在：${absPath}` }
  }
  try {
    const shouldReveal = Boolean(input.revealInFolder || input.reveal || input.mode === 'reveal')
    if (shouldReveal || statSync(absPath).isDirectory()) {
      shell.showItemInFolder(absPath)
      return { ok: true }
    }
    const err = await shell.openPath(absPath)
    if (err) return { ok: false, error: err }
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * 阶段一：盘中实时转向（Mid-Turn Live Steering）。
 * 在 Agent 运行过程中或向可续聊子代理注入即时导演/修正指令，无需中断重跑整轮。
 */
export async function steerHarnessTurn(
  input: SteerHarnessTurnInput
): Promise<SteerHarnessTurnResult> {
  const text = String(input?.text ?? '').trim()
  if (!text) return { ok: false, steered: false, error: '转向指令为空' }
  if (!child || (!turnActive && !input?.subagentSessionId)) {
    return { ok: false, steered: false, error: '当前无运行中的 Agent 轮次' }
  }
  const sent = sendWorkerCommand({
    op: 'steer',
    text,
    ...(input.subagentSessionId ? { subagentSessionId: input.subagentSessionId } : {}),
    ...(input.sessionId ? { sessionId: input.sessionId } : {})
  })
  if (!sent) {
    return { ok: false, steered: false, error: '向 dsh worker 发送实时转向指令失败' }
  }
  emit({ type: 'steered' })
  emitStatus(
    input.subagentSessionId
      ? `⚡ 已向子代理（${input.subagentSessionId.slice(0, 8)}）注入实时指令`
      : '⚡ 已注入盘中实时转向指令（无需中断当前轮次）'
  )
  return { ok: true, steered: true }
}

/**
 * 阶段二：画布异步事件触发器（Reactive Canvas Hooks）。
 * 当画布工作流执行报错或整条管线跑完时，向对话面板推送可交互事件横幅，或按需自动触发 AI 诊断/审片。
 */
export async function notifyHarnessCanvasEvent(
  input: HarnessCanvasEventInput
): Promise<HarnessCanvasEventResult> {
  const title = input?.title || input?.summary || ''
  if (!input || !input.kind || !title) {
    return { ok: false, error: '画布事件缺少必要字段' }
  }
  const summary =
    input.summary ||
    (input.detail
      ? `${title} · ${input.detail}`
      : input.errorMessage
        ? `${title} · ${input.errorMessage}`
        : title)
  const outputPaths = input.outputPaths ?? input.relativePaths
  const view: HarnessCanvasEventView = {
    id: `canvas-ev-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    kind: input.kind,
    title,
    summary,
    timestamp: Date.now(),
    ...(input.detail ? { detail: input.detail } : {}),
    ...(input.workflowId ? { workflowId: input.workflowId } : {}),
    ...(input.nodeId ? { nodeId: input.nodeId } : {}),
    ...(input.nodeTitle ? { nodeTitle: input.nodeTitle } : {}),
    ...(input.nodeType ? { nodeType: input.nodeType } : {}),
    ...(input.errorMessage ? { errorMessage: input.errorMessage } : {}),
    ...(input.error || input.errorMessage ? { error: input.error || input.errorMessage } : {}),
    ...(Array.isArray(outputPaths) && outputPaths.length ? { outputPaths } : {}),
    createdAt: new Date().toISOString(),
    autoTriggered: Boolean(input.autoTrigger)
  }
  emit({ type: 'canvas-event', event: view })
  broadcastToAllWindows(IpcChannels.HARNESS_CANVAS_EVENT, view)

  if (input.autoTrigger) {
    const prompt =
      input.kind === 'node_error'
        ? `[Reactive Canvas Event: 节点执行报错]\n节点：${input.nodeTitle || input.nodeId || '未知节点'}${input.nodeType ? ` (${input.nodeType})` : ''}\n错误信息：${input.errorMessage || input.detail || input.title}\n请立即定位报错原因，检查节点参数或上游连线并给出修复方案（必要时直接调用画布工具修复）。`
        : `[Reactive Canvas Event: 画布工作流执行完成]\n${input.title}${input.detail ? `\n详情：${input.detail}` : ''}${input.outputPaths?.length ? `\n产物路径：${input.outputPaths.join(', ')}` : ''}\n请审阅本次工作流产出，检查是否需要进一步合成、剪辑或调用 present_files 交付。`
    if (turnActive) {
      await steerHarnessTurn({
        text: prompt,
        sessionId: input.sessionId
      })
    } else {
      await runHarnessTask({
        task: prompt,
        sessionId: input.sessionId,
        mode: 'craft'
      })
    }
  }
  return { ok: true, event: view }
}

/**
 * 阶段三：导出影视/美术领域专属子代理清单（供 UI 快捷派单与测试校验）。
 */
export function listStudioDomainSubagents(): ReadonlyArray<{
  name: string
  description: string
  mode: string
}> {
  return STUDIO_DOMAIN_SUBAGENTS.map(({ name, description, mode }) => ({
    name,
    description,
    mode
  }))
}

const latestMcpToolExecution = new Map<string, { detail: string; steps: string[]; at: number }>()

setMcpToolSettledHook((ev) => {
  const summary = summarizeMcpToolOperation(ev.tool, ev.args, ev.result)
  if (summary.steps.length > 0 || summary.detail) {
    latestMcpToolExecution.set(ev.tool, {
      detail: summary.detail,
      steps: summary.steps,
      at: Date.now()
    })
  }
})

setCanvasTaskSettledHook((report) => {
  const ok = report.phase === 'finished' && report.status === 'done'
  if (ok) {
    void notifyHarnessCanvasEvent({
      kind: 'workflow_finished',
      title: '画布工作流执行完成',
      detail: report.relativePaths?.length
        ? `共生成 ${report.relativePaths.length} 个产物文件`
        : undefined,
      outputPaths: report.relativePaths
    })
  } else if (report.phase === 'failed' || report.status === 'error') {
    void notifyHarnessCanvasEvent({
      kind: 'node_error',
      title: '画布工作流执行报错',
      errorMessage: report.error || '节点执行异常'
    })
  }
})

/** 应用退出时清理子进程，避免残留 npx 拉起的 dsh */
app.on('will-quit', () => {
  clearIdleTimer()
  clearActiveHarnessRun()
  if (child) {
    try {
      sendWorkerCommand({ op: 'shutdown' })
    } catch {
      /* ignore */
    }
    const proc = child
    resetWorkerState()
    forceKillProcess(proc)
  }
})
