import { app } from 'electron'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
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

let child: ChildProcess | null = null
let runSeq = 0

function emit(event: HarnessEvent): void {
  broadcastToAllWindows(IpcChannels.HARNESS_EVENT, event)
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
  // !!js 为 dsh 的 YAML 特殊语法：环境变量在 spawn 时注入（token 不进命令行，也不落盘）
  const patch = [
    '# AIArtEngine 生成的 dsh 配置，请勿手改。',
    '- id: mcp-studio',
    "  name: '@deepseek-ai/dsh-mcp-client'",
    '  config:',
    '    serverName: studio',
    '    transport: streamable-http',
    `    url: ${endpoint}`,
    '    headers:',
    '      Authorization: !!js `Bearer ${process.env.STUDIO_MCP_TOKEN}`'
  ]
  writeFileSync(join(home, 'cordis.patch.yml'), patch.join('\n') + '\n', 'utf8')
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
  emit({ type: 'status', text: '正在启动 DeepSeek Harness…' })
  emit({
    type: 'status',
    text:
      workspace === app.getPath('userData')
        ? '未打开工程：AI 工作区为应用数据目录（建议先打开工程）'
        : `工作区：${workspace}`
  })
  emit({ type: 'tool', name: 'dsh-agent', state: 'start' })

  const dshEntry = resolveDshEntry()
  const command = dshEntry ? 'node' : process.platform === 'win32' ? 'npx.cmd' : 'npx'
  const args = dshEntry
    ? [dshEntry, '--profile', 'headless', task]
    : ['--yes', DSH_PACKAGE, '--profile', 'headless', task]
  const proc = spawn(
    command,
    args,
    {
      cwd: workspace,
      windowsHide: true,
      shell: false,
      env: {
        ...process.env,
        DSH_HOME: dshHome(),
        DEEPSEEK_API_KEY: provider.apiKey,
        DSH_MODEL: input.model?.trim() || provider.modelId,
        ...(provider.baseUrl ? { DEEPSEEK_BASE_URL: provider.baseUrl } : {}),
        // MCP 插件配置里的 header 由该变量展开；name 为 /TOKEN/ 会被 dsh 清洗，故用 STUDIO_ 前缀
        STUDIO_MCP_TOKEN: mcp.token
      } as NodeJS.ProcessEnv
    }
  )
  child = proc

  let stdoutBuf = ''
  let sawOutput = false
  let finalText = ''

  const onData = (chunk: Buffer | string, source: 'out' | 'err'): void => {
    stdoutBuf += String(chunk)
    const lines = stdoutBuf.split('\n')
    stdoutBuf = lines.pop() ?? ''
    for (const raw of lines) {
      const line = stripAnsi(raw).trim()
      if (!line) continue
      if (source === 'out') {
        sawOutput = true
        finalText = (finalText ? finalText + '\n' : '') + line
        emit({ type: 'assistant', text: line + '\n' })
      } else {
        emit({ type: 'status', text: line })
      }
    }
  }

  const cleanup = (): void => {
    if (child === proc) child = null
  }

  proc.stdout?.on('data', (chunk) => onData(chunk, 'out'))
  proc.stderr?.on('data', (chunk) => onData(chunk, 'err'))
  proc.on('error', (err) => {
    cleanup()
    emit({ type: 'error', message: `dsh 启动失败：${err.message}` })
  })
  proc.on('close', (code) => {
    cleanup()
    if (stdoutBuf.trim()) {
      const line = stripAnsi(stdoutBuf).trim()
      if (line) {
        finalText = (finalText ? finalText + '\n' : '') + line
        emit({ type: 'assistant', text: line + '\n' })
      }
    }
    emit({ type: 'tool', name: 'dsh-agent', state: 'done' })
    if (code !== 0 && !sawOutput) {
      const hint = dshEntry ? '请重试或查看上方状态信息' : '若为首次运行，请等待包下载完成后重试'
      emit({ type: 'error', message: `dsh 异常退出（code ${code}）。${hint}。` })
    } else {
      emit({ type: 'done', runId })
      // 保留 final 事件：渲染层可据此把「最终回答」与流式文本区分开
      if (finalText) emit({ type: 'final', text: finalText })
    }
  })

  // 仅 npx 现场拉包时保留超时兜底（下载可能悬挂）；内置运行体执行时长不可预测，交给用户手动中止
  if (!dshEntry) {
    const timeout = setTimeout(() => {
      if (child !== proc) return
      emit({ type: 'status', text: 'dsh 响应超时，正在中止（可重试）' })
      proc.kill()
    }, NPX_TIMEOUT_MS)
    proc.once('close', () => clearTimeout(timeout))
  }

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
