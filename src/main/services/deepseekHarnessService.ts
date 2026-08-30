import { app } from 'electron'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  IpcChannels,
  type HarnessEvent,
  type HarnessRunInput,
  type HarnessRunResult,
  type HarnessStatus
} from '@shared/ipc'
import { modalityConfig, type ModelProviderInstance } from '@shared/modelProvider'
import { broadcastToAllWindows } from '../broadcast'
import { getMcpServerInfo } from './mcpServerService'
import { projectService } from './projectService'
import { settingsService } from './settingsService'

/**
 * DeepSeek Harness (dsh) 接入服务。
 *
 * dsh 是 DeepSeek 2026-08 开源的 agent 运行时（开发者预览 v0.1，API 会快速迭代）。
 * 本服务把它作为子进程拉起（headless profile），并注入 dsh-mcp-client 插件配置，
 * 让 agent 通过 Streamable HTTP 调用本应用自带的 MCP 工具服务——即「聊天窗口里调用 MCP」。
 *
 * 流程：
 *   Chat 面板 → HARNESS_RUN → spawn dsh `--profile headless <task>`
 *     → dsh 内嵌 mcp-client → GET/POST http://127.0.0.1:<port>/mcp (Bearer token)
 *     → 工具执行（generate_image 等）→ MCP 活动广播给渲染层做工具卡
 *   dsh stdout / stderr 按行转发为 HARNESS_EVENT（assistant / status / done / error）。
 *
 * dsh 运行体来源（按优先级）：
 *   1. 安装包内置：构建时由 scripts/bundle-dsh.mjs 产出，随 extraResources 打入
 *      `<resources>/dsh`，开箱即用，无需联网下载；
 *   2. 工程本地安装：开发模式下 `node_modules/@deepseek-ai/dsh`；
 *   3. npx 现场拉包（回退）：无内置且未安装时 `npx --yes @deepseek-ai/dsh`，耗时较长。
 * dsh 由系统 Node ^22.19 或 24+ 执行（与应用内 Electron 内置 Node 无关）。
 */

const DSH_PACKAGE = '@deepseek-ai/dsh'
const MIN_NODE_MAJOR = 22
const MIN_NODE_MINOR = 19
const NPX_TIMEOUT_MS = 120_000
/** npx 现场拉包期间的进度提醒间隔：下载可能长时间无输出，避免界面看起来卡死 */
const NPX_PROGRESS_HINT_MS = 20_000

let child: ChildProcess | null = null
let runSeq = 0
/** 最近一次下发的 status 文本，用于合并连续重复行，避免同文刷屏 */
let lastStatusText = ''
/** 已提示过的工作区路径：仅在切换时提示，避免每条消息都重复输出 */
let workspaceNotified = ''

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
  // eslint-disable-next-line no-control-regex
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
    return { apiKey: p.apiKey.trim(), modelId, ...(baseUrl ? { baseUrl } : {}) }
  }
  if (providerId) {
    const candidate = providers.find(
      (p) => p.id === providerId && p.enabled && p.apiKey?.trim() && hasTextModels(p)
    )
    return candidate ? pick(candidate) : null
  }
  const pool = providers.filter((p) => p.enabled && p.apiKey?.trim() && hasTextModels(p))
  const provider = pool.find((p) => p.providerKind === 'deepseek') ?? pool[0]
  return provider ? pick(provider) : null
}

/** 检测系统 Node 版本（dsh 走系统 node，与应用内置版本无关） */
function detectSystemNode(): string {
  const res = spawnSync('node', ['--version'], { timeout: 5_000, encoding: 'utf8' })
  return res.status === 0 && res.stdout ? res.stdout.trim() : ''
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
  const res = spawnSync('npm', ['config', 'get', 'cache'], { timeout: 5_000, encoding: 'utf8' })
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

/** dsh 包根目录的候选位置：安装包内置 resources → 工程本地 node_modules（开发模式） */
function dshPackageRoots(): string[] {
  const roots: string[] = []
  if (process.resourcesPath) roots.push(join(process.resourcesPath, 'dsh', 'node_modules', DSH_PACKAGE))
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

export async function getHarnessStatus(): Promise<HarnessStatus> {
  const nodeVersion = detectSystemNode()
  const nodeOk = isNodeVersionOk(nodeVersion)
  const mcp = getMcpServerInfo()
  const provider = resolveTextProvider()
  const dshEntry = resolveDshEntry()
  const dshReady = nodeOk && (!!dshEntry || detectDshCached())

  const hints: string[] = []
  if (!nodeVersion) hints.push('未检测到系统 Node，请先安装 Node.js 22.19+ 或 24+')
  else if (!nodeOk) hints.push(`系统 Node ${nodeVersion}，dsh 建议 ^22.19 或 24+`)
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
    nodeVersion: nodeVersion || '未知',
    nodeOk,
    dshReady,
    mcpRunning: !!mcp?.running,
    mcpEndpoint: mcp?.endpoint,
    hasDeepseekKey: !!provider,
    message: hints.join('；') || undefined,
    workspace
  }
}

/** 生成 dsh 的 home 级配置：注册 mcp-client 插件，指向本应用 MCP 工具服务 */
function writeDshConfig(endpoint: string): void {
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
    '      headers:',
    '        Authorization: !!js "`Bearer ${process.env.STUDIO_MCP_TOKEN}`"'
  ]
  writeFileSync(join(home, 'cordis.patch.yml'), patch.join('\n') + '\n', 'utf8')
}

/** 思考过程在 dsh stdout 中的包裹标记：自定义 runner 输出，主进程据此切分事件 */
const REASONING_BEGIN = '===BEGIN_REASONING==='
const REASONING_END = '===END_REASONING==='

/**
 * 自定义 headless runner 模板（ESM）。dsh 自带的 headless-runner 只打印最终
 * assistant 文本，把消息里的 `reasoning` 块（DeepSeek 思考内容）丢弃了；
 * 我们注入一个等价 runner，额外把 reasoning 包在 `REASONING_BEGIN/END` 之间
 * 输出到 stdout，主进程转发为 `reasoning` 事件，渲染层折叠展示思考过程。
 *
 * 该文件写到 userData 下（不污染 dsh 包），依赖通过 `createRequire` 锚定到
 * dsh 安装目录的 node_modules 解析（`__DSH_NODE_MODULES_JSON__` 运行时填充）。
 */
const AIART_RUNNER_TEMPLATE = String.raw`// Generated by AIArtEngine. Based on @deepseek-ai/dsh-headless (one-shot driver).
// Outputs the final assistant text plus any model reasoning blocks, delimited by markers.
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const PKG_ROOT = __DSH_NODE_MODULES_JSON__
const require = createRequire(pathToFileURL(join(PKG_ROOT, 'aiart-anchor.js')).href)
const imp = (id) => import(pathToFileURL(require.resolve(id)).href)

const { default: z } = await imp('@deepseek-ai/schemastery')
const { installModelSelection } = await imp('@deepseek-ai/dsh-agent')
const { createUserMessage } = await imp('@deepseek-ai/dsh-llm')
const { SessionId } = await imp('@deepseek-ai/dsh-session')

const name = 'aiart-headless-runner'
const inject = ['agentDefaultModel', 'agents', 'sessions']
const Config = z.object({ task: z.string().required() })

const REASONING_BEGIN = '===BEGIN_REASONING==='
const REASONING_END = '===END_REASONING==='

function summarize(events, firstSeq) {
  let started = false
  let text = ''
  let reason
  const reasoning = []
  for (const event of events) {
    if (event.seq < firstSeq) continue
    if (event.type === 'turn/start') {
      started = true
      continue
    }
    if (!started) continue
    if (event.type === 'assistant/message') {
      const content = event.data?.message?.content ?? []
      const joined = content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('')
      if (joined !== '') text = joined
      for (const block of content) {
        if (block.type === 'reasoning' && typeof block.text === 'string' && block.text !== '') {
          reasoning.push(block.text)
        }
      }
    }
    if (event.type === 'turn/end') reason = event.data.reason
  }
  return { text, reason, reasoning: reasoning.join('\n') }
}

async function run(ctx, task, io) {
  await ctx.get('loader')?.await()
  const agents = ctx.get('agents')
  const defaultModel = ctx.get('agentDefaultModel')
  const sessions = ctx.get('sessions')
  if (agents === void 0 || defaultModel === void 0 || sessions === void 0) return
  const selection = defaultModel.currentSelection()
  const { agent } = await agents.create({
    sessionId: SessionId('session-' + randomUUID()),
    meta: { cwd: process.cwd() },
    agentOptions: {
      provider: selection.provider,
      model: selection.model
    },
    setup: (agentCtx) => {
      installModelSelection(agentCtx, {
        current: selection,
        assembled: void 0
      })
    }
  })
  await agent.whenIdle()
  const firstSeq = agent.session.seq

  // 流式驱动：轮询事件日志，把 text-delta / reasoning-delta 实时写 stdout，
  // 思考内容包在 REASONING_BEGIN/END 标记之间（marker 独占一行，正文不换行）。
  let lastSeq = firstSeq
  let inReasoning = false
  let streamedText = false
  const flushEvents = () => {
    const events = agent.session.events
    for (; lastSeq < events.length; lastSeq++) {
      const event = events[lastSeq]
      if (event.type !== 'assistant/chunk') continue
      const chunk = event.data?.chunk
      if (!chunk) continue
      if (chunk.type === 'reasoning-delta' && typeof chunk.text === 'string' && chunk.text !== '') {
        if (!inReasoning) {
          inReasoning = true
          io.stdout.write(REASONING_BEGIN + '\n')
        }
        io.stdout.write(chunk.text)
      } else if (chunk.type === 'text-delta' && typeof chunk.text === 'string' && chunk.text !== '') {
        streamedText = true
        io.stdout.write(chunk.text)
      }
    }
  }

  const timer = setInterval(flushEvents, 30)
  try {
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: task }],
      source: { kind: 'user' }
    }))
    await agent.whenIdle()
  } finally {
    clearInterval(timer)
  }
  flushEvents()
  if (inReasoning) io.stdout.write('\n' + REASONING_END + '\n')
  const outcome = summarize(agent.session.events, firstSeq)
  // 兜底：没有任何 text delta 时（异常/纯工具轮次），用最终消息补齐一次
  if (!streamedText && outcome.text) io.stdout.write(outcome.text + '\n')
  if (outcome.reason?.kind === 'error') {
    io.stderr.write('dsh: ' + outcome.reason.error.code + ': ' + outcome.reason.error.message + '\n')
  }
  io.exit(outcome.reason?.kind === 'completed' ? 0 : 1)
}

function apply(ctx, config) {
  const exit = ctx.get('appExit')
  if (exit === void 0) {
    throw new Error('aiart-headless-runner: the launcher must provide ctx.appExit before the tree mounts')
  }
  const io = { stdout: process.stdout, stderr: process.stderr, exit }
  run(ctx, config.task, io).catch((error) => {
    io.stderr.write('dsh: ' + (error instanceof Error ? error.message : String(error)) + '\n')
    io.exit(1)
  })
}

export { Config, apply, inject, name }
`

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
 * 写自定义 runner 与 overlay patch（禁用原 headless-runner、注入 aiart-runner）。
 * 返回 patch 文件路径；任何一步失败返回 null（回退原 headless 行为，不影响主流程）。
 */
function writeAiartHarness(dshNodeModules: string): string | null {
  try {
    const home = dshHome()
    mkdirSync(home, { recursive: true })
    const runnerPath = join(home, 'aiart-headless-runner.mjs')
    writeFileSync(
      runnerPath,
      AIART_RUNNER_TEMPLATE.replace('__DSH_NODE_MODULES_JSON__', JSON.stringify(resolve(dshNodeModules))),
      'utf8'
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
      '    persona: >-',
      '      You are a helpful assistant in AIArtEngine. You have access to MCP tools provided by the studio.',
      '      Prefer using the available MCP tools to complete the user request.',
      '      Only write code when no suitable tool is available.',
      '      The user may reference project assets by writing @ followed by a workspace-relative path (e.g. @Assets/Images/foo.png).',
      '      When you see such references, confirm the paths with asset_list if needed, then pass the relative path directly',
      '      to the appropriate generate_* tool argument (referenceImageUrls / firstFrameImageUrl / inputReferences),',
      '      and mention the reference with @n or a clear label in the prompt text so the model aligns with it.'
    ]
    const patchPath = join(home, 'aiart.patch.yml')
    writeFileSync(patchPath, patch.join('\n') + '\n', 'utf8')
    return patchPath
  } catch {
    return null
  }
}

/**
 * 拉起一次 dsh 进程：spawn、按行转发输出、处理结束。
 *
 * dsh 的 headless profile 是一次性的（跑完即退），所以每条任务必然一个新进程；
 * 任务本身执行失败不重试——那会重复消耗 token，且用户意图已经明确失败。
 */
function launchDsh(opts: {
  command: string
  args: string[]
  workspace: string
  env: NodeJS.ProcessEnv
  runId: string
  dshEntry: string | null
}): void {
  const { command, args, workspace, env, runId, dshEntry } = opts
  const proc = spawn(command, args, { cwd: workspace, windowsHide: true, shell: false, env })
  child = proc
  const startedAt = Date.now()

  let sawOutput = false
  let finalText = ''
  let errBuf = ''
  // 自定义 runner 流式输出：fullOut 累积 stdout，parsedLen 标记已解析位置。
  // 增量文本可能不换行，marker（BEGIN/END）独占一行，也可能被 chunk 切断，
  // 因此每次 data 事件都重新扫描「新增区段」，残段是 marker 前缀时留待补齐。
  let fullOut = ''
  let parsedLen = 0
  let inReasoning = false
  let reasoningBuf = ''

  const isMarkerPrefix = (s: string): boolean =>
    s.length > 0 && (REASONING_BEGIN.startsWith(s) || REASONING_END.startsWith(s))

  const emitAssistantDelta = (delta: string): void => {
    if (!delta) return
    sawOutput = true
    finalText += delta
    emit({ type: 'assistant', text: delta })
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
          } else {
            emitAssistantDelta(line + '\n')
          }
        }
      }
      i++
    }
    // 未换行的残段：流式文本/思考内容立即转发（若是 marker 前缀则留待补齐）
    if (start < until) {
      const tail = stripAnsi(fullOut.slice(start, until))
      if (tail) {
        if (isMarkerPrefix(tail)) {
          // 可能是 BEGIN/END 的半截，保留在 fullOut 等待后续数据
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

  const onData = (chunk: Buffer | string, source: 'out' | 'err'): void => {
    if (source === 'err') {
      errBuf += String(chunk)
      const lines = errBuf.split('\n')
      errBuf = lines.pop() ?? ''
      for (const raw of lines) {
        const line = stripAnsi(raw).trim()
        if (!line) continue
        // 过滤 runner 的调试输出（tools 列表等），避免每次任务刷屏进聊天面板
        if (line.startsWith('[aiart-runner]')) continue
        emitStatus(line)
      }
      return
    }
    fullOut += String(chunk)
    parseStdout(fullOut.length)
  }

  proc.stdout?.on('data', (chunk) => onData(chunk, 'out'))
  proc.stderr?.on('data', (chunk) => onData(chunk, 'err'))
  proc.on('error', (err) => {
    if (child === proc) child = null
    emit({ type: 'error', message: `dsh 启动失败：${err.message}` })
  })
  proc.on('close', (code) => {
    if (child === proc) child = null
    // 末尾未换行的残段最后解析一次；若思考段因异常未闭合，补发一次
    if (parsedLen < fullOut.length) parseStdout(fullOut.length)
    if (inReasoning) emit({ type: 'reasoning', text: reasoningBuf })
    const failed = code !== 0 && !sawOutput
    emit({ type: 'tool', name: 'dsh-agent', state: 'done' })
    if (failed) {
      const hint = dshEntry
        ? '请重试或查看上方状态信息'
        : '若为首次运行，请等待包下载完成后重试'
      emit({ type: 'error', message: `dsh 异常退出（code ${code}）。${hint}。` })
    } else {
      emit({ type: 'done', runId })
      // 流式期间已把文本通过 assistant 事件实时下发，final 仅标记「回答已完成」
      if (finalText) emit({ type: 'final', text: finalText })
    }
  })

  // 仅 npx 现场拉包时保留超时兜底（下载可能悬挂）；内置运行体执行时长不可预测，交给用户手动中止
  if (!dshEntry) {
    const timeout = setTimeout(() => {
      if (child !== proc) return
      emitStatus('dsh 响应超时，正在中止（可重试）')
      proc.kill()
    }, NPX_TIMEOUT_MS)
    // 文本带等待秒数：emitStatus 会合并完全相同的相邻行，固定文案只会出现一次
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
  }
}

export async function runHarnessTask(input: HarnessRunInput): Promise<HarnessRunResult> {
  const task = String(input?.task ?? '').trim()
  if (!task) return { started: false, message: '任务内容为空' }
  if (child) return { started: false, message: '已有任务正在运行' }

  const mcp = getMcpServerInfo()
  if (!mcp?.running) {
    return { started: false, message: 'MCP 工具服务未运行，请先在设置中启动' }
  }
  const provider = resolveTextProvider(input?.providerId)
  if (!provider) {
    return { started: false, message: '未配置可用文本模型，请先在模型设置中添加' }
  }
  writeDshConfig(mcp.endpoint)
  const workspace = resolveWorkspace()
  const runId = String(++runSeq)
  lastStatusText = ''
  const dshEntry = resolveDshEntry()
  emitStatus(
    dshEntry
      ? '正在启动 DeepSeek Harness…'
      : '首次运行：正在准备 dsh 运行体（需联网，约 1–2 分钟）'
  )
  // 工作区只在切换时提示一次，避免每条消息都重复输出同一行
  if (workspaceNotified !== workspace) {
    workspaceNotified = workspace
    emitStatus(
      workspace === app.getPath('userData')
        ? '未打开工程：AI 工作区为应用数据目录（建议先打开工程）'
        : `工作区：${workspace}`
    )
  }
  emit({ type: 'tool', name: 'dsh-agent', state: 'start' })

  const command = dshEntry ? 'node' : process.platform === 'win32' ? 'npx.cmd' : 'npx'
  // 本地/内置 dsh 时可注入自定义 runner 输出思考过程；npx 现场拉包时无法预知
  // 依赖树位置，保持原 headless 行为（无 reasoning，不影响主流程）。
  const dshModules = dshEntry ? locateNodeModules(dshEntry) : null
  const patchPath = dshModules ? writeAiartHarness(dshModules) : null
  const args = dshEntry
    ? [
        dshEntry,
        '--profile',
        'headless',
        ...(patchPath ? ['--patch', patchPath] : []),
        task
      ]
    : ['--yes', DSH_PACKAGE, '--profile', 'headless', task]
  launchDsh({
    command,
    args,
    workspace,
    env: {
      ...process.env,
      DSH_HOME: dshHome(),
      DEEPSEEK_API_KEY: provider.apiKey,
      DSH_MODEL: input.model?.trim() || provider.modelId,
      ...(provider.baseUrl ? { DEEPSEEK_BASE_URL: provider.baseUrl } : {}),
      // MCP 插件配置里的 header 由该变量展开；name 为 /TOKEN/ 会被 dsh 清洗，故用 STUDIO_ 前缀
      STUDIO_MCP_TOKEN: mcp.token
    } as NodeJS.ProcessEnv,
    runId,
    dshEntry
  })

  return { started: true }
}

export function abortHarnessTask(): void {
  if (!child) return
  emit({ type: 'status', text: '已请求中止' })
  child.kill()
  child = null
}

/** 应用退出时清理子进程，避免残留 npx 拉起的 dsh */
app.on('will-quit', () => {
  if (child) {
    child.kill()
    child = null
  }
})
