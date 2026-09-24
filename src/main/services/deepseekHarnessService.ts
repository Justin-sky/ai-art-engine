import { app, shell } from 'electron'
import { createHash } from 'node:crypto'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { readdir, rm } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  IpcChannels,
  type AskUserAnswer,
  type ChatMode,
  type DshSkillsFile,
  type DshSkillsInfo,
  type DshSkillsTemplateResult,
  type HarnessEvent,
  type HarnessJobWaitInput,
  type HarnessJobWaitResult,
  type HarnessRunInput,
  type HarnessRunResult,
  type HarnessStatus,
  type SessionSkill,
  type SkillImportResult,
  type SkillTemplate
} from '@shared/ipc'
import { listGraphSkills, registerGraphSkill, type GraphSkill } from '@shared/graph/graphSkills'
import { accessHeaders, isCancelAnswer, normalizeChatMode } from '@shared/mcpModeAccess'
import {
  isCustomProvider,
  modalityConfig,
  resolveCustomApiStyle,
  type ModelProviderInstance
} from '@shared/modelProvider'
import { resolveDshChatInputModalitiesForProvider } from '@shared/dshChatModelModalities'
import { PROJECT_MEMORY_INJECT_LIMIT, PROJECT_MEMORY_RELATIVE_PATH } from '@shared/projectMemory'
import { broadcastToAllWindows } from '../broadcast'
import { isDshQuotaError } from './deepseekHarnessFailure'
import {
  appendNodeRequireOption,
  HIDE_CHILD_WINDOWS_HOOK_FILENAME,
  HIDE_CHILD_WINDOWS_HOOK_SOURCE
} from './dshHideChildWindowsHook'
import { patchBrowserGuard } from './dshBrowserGuardPatch'
import { patchAclSandboxConsole } from './dshSandboxConsolePatch'
import {
  clearActiveHarnessRun,
  confirmHarnessRunAccess,
  getBlenderMcpEndpoint,
  getMcpServerInfo,
  registerHarnessRunAccess,
  releaseHarnessRunAccess,
  setActiveHarnessRun
} from './mcpServerService'
import { projectService } from './projectService'
import { settingsService } from './settingsService'
import AIART_RUNNER_TEMPLATE from 'virtual:aiart-headless-runner-template'

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
let idleTimer: ReturnType<typeof setTimeout> | null = null
let lastSettingsWriteHash = ''
let lastHarnessWriteHash = ''
let readyWaiters: Array<() => void> = []
let runSeq = 0
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

function emit(event: HarnessEvent): void {
  broadcastToAllWindows(IpcChannels.HARNESS_EVENT, event)
}

/** 下发一条状态行；与上一行完全相同的文本会被合并，只保留一次 */
function emitStatus(text: string): void {
  if (!text) return
  if (text === lastStatusText) return
  lastStatusText = text
  emit({ type: 'status', text })
}

/** 剥离 ANSI 颜色码 / 控制字符，保留可读文本 */
function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, '').replace(/\r/g, '')
}

/** dsh 配置根目录（userData 下，避免污染工程目录） */
function dshHome(): string {
  return join(app.getPath('userData'), 'dsh-harness')
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
    const modelId =
      (text.defaultModelId?.trim() && text.selectedModelIds.includes(text.defaultModelId)
        ? text.defaultModelId.trim()
        : undefined) ?? text.selectedModelIds[0]?.trim()
    if (!modelId) return null
    const baseUrl = p.baseUrl?.trim()
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
    workspace
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
function writeDshConfig(
  endpoint: string,
  mode: ChatMode,
  runId: string,
  blenderClient: { endpoint: string } | null,
  llm?: {
    baseUrl?: string
    modelId: string
    modelName?: string
    inputModalities: ReadonlyArray<'text' | 'image'>
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

  // 同步修补 llm-deepseek / agent-default-model：不能只靠 settings.yaml。
  // settings-file 异步 publish；首轮 LLM 若仍读到内置 DEFAULT_MODELS，会把附图投影成
  // 「image omitted because this model accepts text only」，模型就回「不支持图片输入」。
  if (llm?.modelId) {
    const modelName = llm.modelName?.trim() || llm.modelId
    const modalities = llm.inputModalities.length > 0 ? llm.inputModalities : (['text'] as const)
    patch.push(
      '- id: agent-default-model',
      '  config:',
      '    provider: deepseek-official',
      `    model: ${yamlScalar(llm.modelId)}`,
      '- id: llm-deepseek',
      '  config:',
      ...(llm.baseUrl?.trim() ? [`    baseURL: ${yamlScalar(llm.baseUrl.trim())}`] : []),
      '    models:',
      `      - id: ${yamlScalar(llm.modelId)}`,
      `        name: ${yamlScalar(modelName)}`,
      '        inputModalities:',
      ...modalities.map((m) => `          - ${m}`)
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
}): void {
  const home = dshHome()
  mkdirSync(home, { recursive: true })
  const modelName = provider.modelName?.trim() || provider.modelId
  const modalities = provider.inputModalities.length
    ? provider.inputModalities
    : (['text'] as const)
  const lines = [
    '# AIArtEngine 生成的 dsh 设置（模型选择/端点），请勿手改。',
    'agent-default-model:',
    '  provider: deepseek-official',
    `  model: ${yamlScalar(provider.modelId)}`,
    'llm-deepseek:',
    ...(provider.baseUrl?.trim() ? [`  baseURL: ${yamlScalar(provider.baseUrl.trim())}`] : []),
    '  models:',
    `    - id: ${yamlScalar(provider.modelId)}`,
    `      name: ${yamlScalar(modelName)}`,
    '      inputModalities:',
    ...modalities.map((m) => `        - ${m}`)
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

/** dsh 的 skill 快照清单文件：记录上次生成的文件，下次写入前清理，避免残留失效技能 */
const DSH_SKILLS_MANIFEST = '.aiart-skill-manifest.json'

/** GraphSkill id → dsh 合法 skill 名（kebab-case，`/^[a-z0-9]+(?:-[a-z0-9]+)*$/`） */
function toDshSkillName(id: string): string {
  const kebab = id
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return kebab
}

/** 把一条 GraphSkill 渲染为 dsh 的 SKILL.md（frontmatter + 用法 + 中英双语正文） */
function renderDshSkillMd(skill: GraphSkill): string {
  const name = toDshSkillName(skill.id)
  const zhTitle = skill.titleZh || skill.id
  const enTitle = skill.titleEn || skill.id
  const description = `${enTitle} — ${zhTitle}`
  const sections: string[] = []
  // 用法置顶：Agent 加载技能后先看到「怎么用、产物是什么」，再看提示词正文
  if (skill.usageZh) sections.push(`### 用法（中文）\n\n${skill.usageZh}`)
  if (skill.usageEn) sections.push(`### Usage (English)\n\n${skill.usageEn}`)
  if (skill.systemPromptZh) sections.push(`### 系统提示（中文）\n\n${skill.systemPromptZh}`)
  if (skill.systemPromptEn) sections.push(`### System prompt (English)\n\n${skill.systemPromptEn}`)
  if (skill.instructionZh) sections.push(`### 生成指令（中文）\n\n${skill.instructionZh}`)
  if (skill.instructionEn) sections.push(`### Instruction (English)\n\n${skill.instructionEn}`)
  const body = sections.length ? sections.join('\n\n') : `> 技能 ${name}：${description}`
  return [
    '---',
    `name: ${name}`,
    `description: ${JSON.stringify(description.replace(/[\r\n]+/g, ' '))}`,
    '---',
    '',
    `# ${enTitle}`,
    '',
    body,
    ''
  ].join('\n')
}

/**
 * 把应用内置 GraphSkill 目录快照成 dsh 的 SKILL.md 文件（`$DSH_HOME/skills`）。
 *
 * dsh 的 `skill-filesystem` 插件默认挂载且 `includeDefaultRoots: true`，会扫描
 * `$DSH_HOME/skills` 目录下的 `*.md`（rank 400），并由 `tool-skill` 把技能清单
 * 注入模型可见的 `<available_skills>` 目录、提供 `skill` 加载工具——即 AI 对话里
 * 的 agent 能感知并加载应用内置技能（分镜拆解、9宫格、动态提示词等）。
 *
 * 带签名指纹：覆盖栈可能被插件 `registerGraphSkill` 动态增删，但多数对话之间
 * 技能并无变化。先算当前清单的 SHA-1 签名，与 manifest 记录的签名一致且上次
 * 生成的文件都在时直接跳过，避免每次对话都做无谓的删写；变化才按 manifest
 * 清理上次生成的文件再全量重写，避免残留失效技能。
 */
function writeDshSkills(): void {
  try {
    const home = dshHome()
    mkdirSync(home, { recursive: true })
    const skillsDir = join(home, 'skills')
    mkdirSync(skillsDir, { recursive: true })
    const manifestPath = join(skillsDir, DSH_SKILLS_MANIFEST)
    const { previous, signature: lastSignature } = readDshSkillsManifest()
    const signature = dshSkillsSignature()
    // 技能没变且上次生成的文件都还在 → 跳过写盘，复用现有快照
    if (
      lastSignature === signature &&
      previous.every((file) => existsSync(join(skillsDir, file)))
    ) {
      return
    }
    // 只清理上次由本函数生成的文件，用户自行放入的自定义技能不受影响
    for (const file of previous) {
      const target = join(skillsDir, file)
      if (existsSync(target)) rmSync(target, { force: true })
    }
    const generated: string[] = []
    for (const skill of listGraphSkills()) {
      const name = toDshSkillName(skill.id)
      if (!name) continue
      const file = `${name}.md`
      generated.push(file)
      writeFileSync(join(skillsDir, file), renderDshSkillMd(skill), 'utf8')
    }
    writeFileSync(manifestPath, JSON.stringify({ files: generated, signature }), 'utf8')
  } catch (error) {
    // 技能快照失败不阻塞主流程（dsh 无技能也能对话）
    console.warn('[aiart] writeDshSkills failed:', error)
  }
}

/** 当前技能清单的指纹：任何技能 id / 渲染内容变化都会改变，用于跳过无谓写盘 */
function dshSkillsSignature(): string {
  const hash = createHash('sha1')
  for (const skill of listGraphSkills()) {
    hash.update(`${skill.id}\u0000${renderDshSkillMd(skill)}\u0000`)
  }
  return hash.digest('hex')
}

/** 读 dsh 技能 manifest（旧格式 string[] / 新格式 { files, signature } 均兼容） */
function readDshSkillsManifest(): { previous: string[]; signature: string } {
  try {
    const raw = JSON.parse(
      readFileSync(join(dshHome(), 'skills', DSH_SKILLS_MANIFEST), 'utf8') || '[]'
    ) as string[] | { files?: unknown; signature?: unknown }
    if (Array.isArray(raw)) return { previous: raw, signature: '' }
    return {
      previous: Array.isArray(raw.files) ? (raw.files as string[]) : [],
      signature: typeof raw.signature === 'string' ? raw.signature : ''
    }
  } catch {
    return { previous: [], signature: '' }
  }
}

/** dsh 示例技能模板文件名：不带 .md 后缀，避免被 dsh 的 skill-filesystem 扫描成真技能 */
const DSH_SKILLS_TEMPLATE_FILE = 'my-skill.example'

/** 查询 dsh 技能目录信息（渲染层设置页展示用） */
export function getDshSkillsInfo(): DshSkillsInfo {
  const skillsDir = join(dshHome(), 'skills')
  const files: DshSkillsFile[] = []
  if (existsSync(skillsDir)) {
    const builtin = new Set(readDshSkillsManifest().previous)
    for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
      if (!entry.isFile() || entry.name === DSH_SKILLS_MANIFEST) continue
      files.push({
        fileName: entry.name,
        kind: builtin.has(entry.name)
          ? 'builtin'
          : entry.name.endsWith('.md')
            ? 'custom'
            : 'template'
      })
    }
  }
  files.sort((a, b) => a.fileName.localeCompare(b.fileName))
  return {
    dirPath: skillsDir,
    builtinCount: listGraphSkills().filter((skill) => !!toDshSkillName(skill.id)).length,
    files
  }
}

/** 在系统文件管理器中打开 dsh 技能目录（不存在则先创建） */
export async function openDshSkillsDir(): Promise<void> {
  const skillsDir = join(dshHome(), 'skills')
  mkdirSync(skillsDir, { recursive: true })
  const error = await shell.openPath(skillsDir)
  if (error) throw new Error(error)
}

/** 写入一个示例 SKILL.md 模板；同名文件已存在时跳过（不覆盖用户可能改动过的内容） */
export function writeDshSkillsTemplate(): DshSkillsTemplateResult {
  const skillsDir = join(dshHome(), 'skills')
  mkdirSync(skillsDir, { recursive: true })
  const filePath = join(skillsDir, DSH_SKILLS_TEMPLATE_FILE)
  if (existsSync(filePath)) return { filePath, skipped: true }
  writeFileSync(filePath, renderDshSkillsTemplate(), 'utf8')
  return { filePath, skipped: false }
}

/** 查询内置技能模板库：应用内置 GraphSkill 提炼为可复用 SKILL.md 模板 */
export function listSkillTemplates(): SkillTemplate[] {
  return listGraphSkills()
    .map((skill) => {
      const name = toDshSkillName(skill.id)
      if (!name) return null
      return {
        id: skill.id,
        name,
        titleZh: skill.titleZh,
        titleEn: skill.titleEn,
        description: `${skill.titleEn} — ${skill.titleZh}`,
        content: renderDshSkillMd(skill)
      }
    })
    .filter((template): template is SkillTemplate => template !== null)
}

/** 把内置技能模板导出为技能目录中的 .example 模板文件（同名跳过，不覆盖用户内容） */
export function exportSkillTemplate(id: string): DshSkillsTemplateResult {
  const template = listSkillTemplates().find((item) => item.id === id)
  if (!template) throw new Error(`Unknown skill template: ${id}`)
  const skillsDir = join(dshHome(), 'skills')
  mkdirSync(skillsDir, { recursive: true })
  const filePath = join(skillsDir, `${template.name}.example`)
  if (existsSync(filePath)) return { filePath, skipped: true }
  writeFileSync(filePath, template.content, 'utf8')
  return { filePath, skipped: false }
}

/** 解析 SKILL.md frontmatter（name / description），供会话技能清单与反向导入复用 */
function parseDshSkillFrontmatter(content: string): { name?: string; description?: string } {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/)
  if (!match) return {}
  const result: Record<string, string> = {}
  for (const line of match[1].split('\n')) {
    const kv = line.match(/^([\w-]+):\s*(.*)$/)
    if (kv) result[kv[1]] = kv[2].trim()
  }
  return { name: result.name, description: result.description }
}

/** 解析 SKILL.md 正文分节（### 用法（中文）/ ### 系统提示（中文）等），供反向导入 GraphSkill 复用 */
function parseDshSkillSections(content: string): {
  usageZh?: string
  usageEn?: string
  systemPromptZh?: string
  systemPromptEn?: string
  instructionZh?: string
  instructionEn?: string
} {
  const section = (heading: string): string | undefined => {
    const start = content.indexOf(heading)
    if (start < 0) return undefined
    const bodyStart = start + heading.length
    const next = content.indexOf('\n### ', bodyStart)
    const raw = (next < 0 ? content.slice(bodyStart) : content.slice(bodyStart, next)).trim()
    return raw || undefined
  }
  return {
    usageZh: section('### 用法（中文）'),
    usageEn: section('### Usage (English)'),
    systemPromptZh: section('### 系统提示（中文）'),
    systemPromptEn: section('### System prompt (English)'),
    instructionZh: section('### 生成指令（中文）'),
    instructionEn: section('### Instruction (English)')
  }
}

/** 查询本次会话可用的技能清单（内置快照 + 用户自定义 .md），供对话技能调试视图展示 */
export function getSessionSkills(): SessionSkill[] {
  const skills: SessionSkill[] = []
  const builtinNames = new Set<string>()
  for (const skill of listGraphSkills()) {
    const name = toDshSkillName(skill.id)
    if (!name) continue
    builtinNames.add(name)
    skills.push({
      name,
      kind: 'builtin',
      titleZh: skill.titleZh,
      titleEn: skill.titleEn,
      description: `${skill.titleEn} — ${skill.titleZh}`
    })
  }
  const skillsDir = join(dshHome(), 'skills')
  const builtinFiles = new Set(readDshSkillsManifest().previous)
  if (existsSync(skillsDir)) {
    for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md') || builtinFiles.has(entry.name)) continue
      try {
        const content = readFileSync(join(skillsDir, entry.name), 'utf8')
        const frontmatter = parseDshSkillFrontmatter(content)
        const name = frontmatter.name || entry.name.replace(/\.md$/, '')
        if (builtinNames.has(name)) continue
        skills.push({
          name,
          kind: 'custom',
          description: frontmatter.description || name
        })
      } catch {
        // 单个文件解析失败不阻塞清单
      }
    }
  }
  return skills
}

/** 反向同步：把用户自定义 .md 技能导入为应用 GraphSkill（保存 dispose，重复导入先清理） */
const importedSkillDisposes = new Set<() => void>()
export function importCustomSkillsToGraph(): SkillImportResult {
  const imported: string[] = []
  const skipped: { name: string; reason: string }[] = []
  // 先清理上次导入的 GraphSkill（后注册优先，重复导入需先 dispose 才能回落到内置）
  for (const dispose of importedSkillDisposes) {
    try {
      dispose()
    } catch {
      // 忽略清理失败
    }
  }
  importedSkillDisposes.clear()
  const skillsDir = join(dshHome(), 'skills')
  const builtinFiles = new Set(readDshSkillsManifest().previous)
  if (existsSync(skillsDir)) {
    for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md') || builtinFiles.has(entry.name)) continue
      try {
        const content = readFileSync(join(skillsDir, entry.name), 'utf8')
        const frontmatter = parseDshSkillFrontmatter(content)
        const name = frontmatter.name || entry.name.replace(/\.md$/, '')
        const id = `dsh.${toDshSkillName(name)}`
        if (!id || id === 'dsh.') {
          skipped.push({ name: entry.name, reason: 'invalid skill name' })
          continue
        }
        const sections = parseDshSkillSections(content)
        const title = frontmatter.description || name
        importedSkillDisposes.add(
          registerGraphSkill({
            id,
            kind: 'system',
            titleZh: title,
            titleEn: name,
            usageZh: sections.usageZh,
            usageEn: sections.usageEn,
            systemPromptZh: sections.systemPromptZh,
            systemPromptEn: sections.systemPromptEn,
            instructionZh: sections.instructionZh,
            instructionEn: sections.instructionEn
          })
        )
        imported.push(name)
      } catch (error) {
        skipped.push({
          name: entry.name,
          reason: error instanceof Error ? error.message : String(error)
        })
      }
    }
  }
  return { imported, skipped }
}

/** 示例 SKILL.md 模板：dsh 格式（frontmatter name/description + 正文），复制重命名为 .md 即生效 */
function renderDshSkillsTemplate(): string {
  return [
    '---',
    'name: my-skill',
    'description: 示例技能：演示 dsh 技能的写法。请根据实际用途改写技能名与描述。',
    '---',
    '',
    '# 技能正文',
    '',
    '在这里编写技能的执行说明。模型调用本技能时，本文件会作为指令注入上下文。',
    '',
    '## 步骤',
    '1. 明确技能目标',
    '2. 列出执行步骤',
    '3. 说明输出要求',
    '',
    '## 注意事项',
    '- 描述要具体，避免模糊指令',
    '- 需要遵守的约束写在这里',
    '',
    '---',
    '提示：把本文件复制并重命名为「你的技能名.md」（小写字母 + 连字符）即生效；',
    'frontmatter 的 name / description（文件开头两行）用于模型判断何时调用本技能。',
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
/** 上下文用量标记：runner 每轮 LLM 请求完成后输出（单行 JSON 载荷，provider usage） */
const CONTEXT_BEGIN = '===BEGIN_CONTEXT==='

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
    'The user may reference project assets by writing @ followed by a workspace-relative path (e.g. @Assets/Images/foo.png).',
    'Image references are attached to your user message as image blocks, so you can see the picture content directly.',
    'Each image is followed by its @path text: use that same path in generate_* tool arguments',
    '(referenceImageUrls / firstFrameImageUrl / lastFrameImageUrl / inputReferences) when the generation should use the image,',
    'and mention the reference with @n or a clear label in the prompt text so the model aligns with it.',
    'For video generation with reference images: a single image is the first frame (firstFrameImageUrl);',
    'when the user provides two images, the first one is the first frame and the second one is the last frame',
    '(lastFrameImageUrl). The image order in your user message follows the order the user attached them.',
    'Pass the @path text of each image to the matching generate_video argument instead of inventing URLs.',
    // 同一会话里模式可以逐轮切换（面板上换一下再发就行），而模型会顺手沿用上一轮的模式自述：
    // 实测 Ask 轮说过「我在 Ask 模式」后，同一会话切到 Plan 的下一轮它仍照抄这句话（即使这一轮的
    // system prompt 已是 Plan、工具面也已换成只读）。这里明确「以本轮说法为准」，并禁止复述旧结论。
    'The mode stated for the current turn is authoritative: the user may switch modes between turns of this same session.',
    "Never carry over a previous turn's mode name, and never repeat an earlier claim that tools are unavailable unless this turn says so.",
    // 沙箱禁用本机浏览器：shell 命令跑在 Windows ACL 沙箱（受限令牌）里，Chromium 建不出自己的
    // mojo IPC 命名管道会 CHECK 失败 → __debugbreak → 0x80000003，系统在应用之外弹「应用程序错误」
    // 对话框（实测每次都会弹，而且工具调用还是失败）。光靠这段提示词压不住——实测模型会换写法继续
    // 试（把路径存进变量、用调用运算符、--version 试探），所以另有硬拦截：运行体补丁在所有 shell
    // 进程的必经点（LocalSubprocessRuntime.spawn / spawnTerminal）按 argv 拒绝这类命令并回同一条
    // 原因（dshBrowserGuardPatch）。这里要讲清替代路径：视觉自查调 render_svg（应用自己的引擎出图，
    // 不碰浏览器），批量出资产走 svg.gen → svg.anim；并且「换写法也没用」。详见 CHANGELOG。
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
    'To bake assets into the project, use the studio path: commit a plan whose svg.gen node feeds svg.anim, then read the baked PNG frames and the GIF reported by the task result.',
    'If a check genuinely needs a real browser, stop and tell the user to run it outside the app.',
    '=== Generated media must not land in the project root ===',
    'Never write image/video/audio/3D files into the workspace root (cwd) with shell, Save-File, or relative paths like ./foo.png or .\\bar.mp4.',
    'Always create media through studio MCP tools (generate_image / generate_video / generate_speech / generate_music / …): they save under Cache/Images (or Cache/Videos, Cache/Voices, …) automatically.',
    'Do not invent outputDir as "." or the absolute project path. Leave outputDir unset for MCP generate_* tools.',
    'If you need a file on disk after generation, read the relativePath returned by the MCP tool — never invent a path at the project root.'
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
      // dsh 自带的 plan-mode 插件同样把 exit_plan_mode 挂在工具面里（官方注释：工具目录不随模式变化，
      // 为的是请求缓存稳定），但它要求 dsh 自己的 session 处于 plan 模式；面板这套 Plan 不走那条路，
      // 调它必报「exit_plan_mode is only available in plan mode」。点名禁掉，免得模型在「提交计划」
      // 这一步选错工具，然后回头怀疑当前模式。
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
 * 写自定义 runner 与 overlay patch（禁用原 headless-runner、注入 aiart-runner）。
 * 返回 patch 文件路径；任何一步失败返回 null（回退原 headless 行为，不影响主流程）。
 */
function writeAiartHarness(
  dshNodeModules: string,
  mode: ChatMode = 'craft',
  projectMemory?: string | null
): string | null {
  try {
    const home = dshHome()
    mkdirSync(home, { recursive: true })
    const runnerPath = join(home, 'aiart-headless-runner.mjs')
    const runnerSource = AIART_RUNNER_TEMPLATE.replace(
      '__DSH_NODE_MODULES_JSON__',
      JSON.stringify(resolve(dshNodeModules))
    )
    const runnerUrl = pathToFileURL(runnerPath).href
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
      .update(patchBody)
      .digest('hex')
    const patchPath = join(home, 'aiart.patch.yml')
    if (hash !== lastHarnessWriteHash || !existsSync(runnerPath) || !existsSync(patchPath)) {
      writeFileSync(runnerPath, runnerSource, 'utf8')
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

function scheduleIdleShutdown(): void {
  clearIdleTimer()
  if (!workerPersistent || !child || turnActive) return
  idleTimer = setTimeout(() => {
    idleTimer = null
    if (turnActive || !child) return
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
  readyWaiters = []
  clearIdleTimer()
}

function notifyReady(): void {
  workerReady = true
  const waiters = readyWaiters
  readyWaiters = []
  for (const w of waiters) w()
}

function waitUntilReady(timeoutMs = 120_000): Promise<boolean> {
  if (workerReady) return Promise.resolve(true)
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      readyWaiters = readyWaiters.filter((w) => w !== onReady)
      resolve(false)
    }, timeoutMs)
    const onReady = (): void => {
      clearTimeout(timer)
      resolve(true)
    }
    readyWaiters.push(onReady)
  })
}

function sendWorkerCommand(payload: Record<string, unknown>): boolean {
  if (!child?.stdin || child.killed) return false
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

/** 常驻 worker 协议版本：改 runner 交互时递增，强制热进程重建 */
const WORKER_PROTOCOL = '2'

function workerFingerprintOf(input: {
  workspace: string
  mcpEndpoint: string
  blenderOn: boolean
  baseUrl?: string
  apiKey?: string
}): string {
  const keyFp = input.apiKey
    ? createHash('sha1').update(input.apiKey).digest('hex').slice(0, 12)
    : ''
  return [
    WORKER_PROTOCOL,
    input.workspace,
    input.mcpEndpoint,
    input.blenderOn ? '1' : '0',
    input.baseUrl?.trim() || '',
    keyFp
  ].join('\u0000')
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

  const setRunId = (id: string): void => {
    currentRunId = id
    workerRunId = id
  }

  ;(proc as ChildProcess & { __aiartSetRunId?: (id: string) => void }).__aiartSetRunId = setRunId
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
      text.startsWith(CONTEXT_BEGIN))

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
    try {
      const parsed = JSON.parse(payload)
      if (typeof parsed.name === 'string' && parsed.name) name = parsed.name
      if (typeof parsed.detail === 'string' && parsed.detail) detail = parsed.detail
      if (typeof parsed.args === 'string' && parsed.args) args = parsed.args
      if (typeof parsed.callId === 'string' && parsed.callId) id = parsed.callId
    } catch {
      /* ignore */
    }
    emit({
      type: 'tool',
      ...(id ? { id } : {}),
      name,
      state,
      ...(detail ? { detail } : {}),
      ...(args ? { args } : {})
    })
    sawOutput = true
  }

  const emitAskUserFromLine = (line: string): void => {
    if (!turnActive) return
    const payload = line.slice(ASK_USER_BEGIN.length).trim()
    try {
      const parsed = JSON.parse(payload)
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
          } else if (line.startsWith(CONTEXT_BEGIN)) {
            emitContextFromLine(line)
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
    clearActiveHarnessRun()
    releaseHarnessRunAccess(runIdForRelease)
    for (const [id, entry] of harnessAskUserRequests) {
      if (entry.runId === runIdForRelease) harnessAskUserRequests.delete(id)
    }
    emit({ type: 'tool', name: 'dsh-agent', state: 'done' })
    if (result.ok) {
      emit({ type: 'done', runId: runIdForRelease })
      if (result.finalText) emit({ type: 'final', text: result.finalText })
    } else if (result.error) {
      emit({ type: 'error', message: result.error })
    }
    completeActiveJob(result)
    scheduleIdleShutdown()
  }

  const onData = (chunk: Buffer | string, source: 'out' | 'err'): void => {
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
          if (/error|fail|abort/i.test(line)) emitStatus(line)
          continue
        }
        emitStatus(line)
      }
      return
    }
    if (!turnActive && persistent) {
      // 常驻空闲时忽略 stdout 噪声
      return
    }
    fullOut += String(chunk)
    parseStdout(fullOut.length)
  }

  proc.stdout?.on('data', (chunk) => onData(chunk, 'out'))
  proc.stderr?.on('data', (chunk) => onData(chunk, 'err'))
  proc.on('error', (err) => {
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
    const wasPersistent = persistent
    const wasTurn = turnActive
    const rid = currentRunId
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
      if (code !== 0) emitStatus(`dsh 退出码 ${code}（本轮已有输出，未受影响）`)
      finishTurn({ ok: true, finalText }, rid)
    }
  })

  if (!dshEntry) {
    const timeout = setTimeout(() => {
      if (child !== proc) return
      emitStatus('dsh 响应超时，正在中止（可重试）')
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
    stdio: persistent ? ['pipe', 'pipe', 'pipe'] : undefined
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
  const provider = resolveTextProvider()
  if (!provider) return { ok: false, message: '未配置文本模型' }
  const dshEntry = resolveDshEntry()
  if (!dshEntry) return { ok: false, message: '无内置 dsh，跳过预热' }
  try {
    await ensurePersistentWorker({
      provider,
      modelId: provider.modelId,
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
    try {
      sendWorkerCommand({ op: 'shutdown' })
    } catch {
      /* ignore */
    }
    child.kill()
    resetWorkerState()
  }

  const mode = opts.mode ?? 'craft'
  const modelId = opts.modelId
  const textCatalog = modalityConfig(opts.provider.provider, 'text').catalog?.[modelId]
  const inputModalities =
    opts.inputModalities ??
    resolveDshChatInputModalitiesForProvider(opts.provider.provider, modelId)
  const modelName = opts.modelName?.trim() || textCatalog?.name?.trim() || modelId

  // 常驻连接用 craft 占位头拿全量 tools/list；每轮授权走 activeHarnessRun
  writeDshConfig(mcp.endpoint, 'craft', '0', blender, {
    baseUrl: opts.provider.baseUrl,
    modelId,
    modelName,
    inputModalities
  })
  writeDshSettings({
    baseUrl: opts.provider.baseUrl,
    modelId,
    modelName,
    inputModalities
  })
  writeDshSkills()

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
    child?.kill()
    resetWorkerState()
    throw new Error('dsh 常驻进程就绪超时')
  }
}

async function startHarnessNow(input: HarnessRunInput): Promise<HarnessRunResult> {
  const rawTask = String(input?.task ?? '').trim()
  if (!rawTask) return { started: false, message: '任务内容为空' }
  if (turnActive) return { started: false, message: '已有任务正在运行' }

  const mcp = getMcpServerInfo()
  if (!mcp?.running) {
    return { started: false, message: 'MCP 工具服务未运行，请先在设置中启动' }
  }
  const provider = resolveTextProvider(input?.providerId)
  if (!provider) {
    return { started: false, message: '未配置可用文本模型，请先在模型设置中添加' }
  }

  const runId = String(++runSeq)
  const mode = normalizeChatMode(input.mode)
  const modelId = input.model?.trim() || provider.modelId
  const textCatalog = modalityConfig(provider.provider, 'text').catalog?.[modelId]
  const inputModalities = resolveDshChatInputModalitiesForProvider(provider.provider, modelId)
  const modelName = textCatalog?.name?.trim() || modelId
  const dshEntry = resolveDshEntry()
  const dshModules = dshEntry ? locateNodeModules(dshEntry) : null
  const canPersist = !!(dshEntry && dshModules)

  lastStatusText = ''
  clearIdleTimer()

  if (!canPersist) {
    // npx / 无 runner：保持 one-shot
    writeDshConfig(mcp.endpoint, mode, runId, getBlenderClientForHarness(), {
      baseUrl: provider.baseUrl,
      modelId,
      modelName,
      inputModalities
    })
    registerHarnessRunAccess(runId, mode)
    setActiveHarnessRun(runId, mode)
    writeDshSettings({
      baseUrl: provider.baseUrl,
      modelId,
      modelName,
      inputModalities
    })
    writeDshSkills()
    const workspace = resolveWorkspace()
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
    turnActive = true
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
        ...(input.sessionId?.trim() ? { AIART_SESSION_ID: input.sessionId.trim() } : {}),
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
    return {
      started: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }

  if (workerModelId !== modelId) {
    writeDshSettings({
      baseUrl: provider.baseUrl,
      modelId,
      modelName,
      inputModalities
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

  turnActive = true
  emit({ type: 'tool', name: 'dsh-agent', state: 'start' })
  // 不在每轮刷「等待模型首包」：常驻热路径下会误导成「又在冷启动」；
  // 真卡住由下方 15s 心跳提示「仍在等待模型响应」。

  const ok = sendWorkerCommand({
    op: 'prompt',
    task: rawTask,
    sessionId: input.sessionId?.trim() || '',
    mode,
    runId
  })
  if (!ok) {
    turnActive = false
    clearActiveHarnessRun()
    releaseHarnessRunAccess(runId)
    resetWorkerState()
    return { started: false, message: '无法向常驻 dsh 写入任务' }
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
  clearIdleTimer()
  const hadTurn = turnActive
  if (!child) {
    turnActive = false
    // 无子进程也要让面板退出 running（例如已崩但 UI 未收）
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
  if (!isCancelAnswer(payload.answer)) confirmHarnessRunAccess(entry.runId)
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
 * 删除会话在磁盘上的持久化记录（`$DSH_HOME/sessions/<project>/<id>/`）。
 *
 * 前端删除会话后调用：否则 localStorage 里的会话没了，但 dsh 的 JSONL 日志仍在，
 * 下次同 id 发消息会被「幽灵恢复」成已删除的对话。路径布局与
 * dsh-session-persistence-jsonl 保持一致（root = dshHomePath('sessions')，按项目分目录）。
 */
export async function deleteHarnessSession(sessionId: string): Promise<void> {
  const id = String(sessionId ?? '').trim()
  // 只放行安全字符，防止把删除目标带出 sessions 目录
  if (!id || !/^[A-Za-z0-9._-]+$/.test(id)) return
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
