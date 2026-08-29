import { app } from 'electron'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  IpcChannels,
  type HarnessEvent,
  type HarnessRunInput,
  type HarnessRunResult,
  type HarnessStatus
} from '@shared/ipc'
import { broadcastToAllWindows } from '../broadcast'
import { getMcpServerInfo } from './mcpServerService'
import { settingsService } from './settingsService'

/**
 * DeepSeek Harness (dsh) 接入服务。
 *
 * dsh 是 DeepSeek 2026-08 开源的 agent 运行时（开发者预览 v0.1，API 会快速迭代）。
 * 本服务把它作为子进程拉起（headless profile），并注入 dsh-mcp-client 插件配置，
 * 让 agent 通过 Streamable HTTP 调用本应用自带的 MCP 工具服务——即「聊天窗口里调用 MCP」。
 *
 * 流程：
 *   Chat 面板 → HARNESS_RUN → spawn `npx @deepseek-ai/dsh --profile headless <task>`
 *     → dsh 内嵌 mcp-client → GET/POST http://127.0.0.1:<port>/mcp (Bearer token)
 *     → 工具执行（generate_image 等）→ MCP 活动广播给渲染层做工具卡
 *   dsh stdout / stderr 按行转发为 HARNESS_EVENT（assistant / status / done / error）。
 *
 * 注意：dsh 是外部 npm 包，运行需要系统 Node ^22.19 或 24+（本服务通过 `npx` 拉起，
 * 与应用内 Electron 内置 Node 无关）。首次运行 npx 会现场拉包，耗时较长，状态会提示。
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

/** 读取用户已配置的 DeepSeek 文本 provider（含密钥），供 dsh 使用 */
function resolveDeepseekProvider(): {
  apiKey: string
  baseUrl?: string
  modelId: string
} | null {
  const settings = settingsService.get()
  const providers = settings.models?.providers ?? []
  const provider = providers.find(
    (p) => p.providerKind === 'deepseek' && p.enabled && p.apiKey?.trim()
  )
  if (!provider) return null
  const modelId = provider.modalities?.text?.selectedModelIds?.[0]?.trim() || 'deepseek-chat'
  const baseUrl = provider.baseUrl?.trim()
  return { apiKey: provider.apiKey.trim(), modelId, ...(baseUrl ? { baseUrl } : {}) }
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

export async function getHarnessStatus(): Promise<HarnessStatus> {
  const nodeVersion = detectSystemNode()
  const nodeOk = isNodeVersionOk(nodeVersion)
  const mcp = getMcpServerInfo()
  const provider = resolveDeepseekProvider()
  const dshReady = nodeOk && detectDshCached()

  const hints: string[] = []
  if (!nodeVersion) hints.push('未检测到系统 Node，请先安装 Node.js 22.19+ 或 24+')
  else if (!nodeOk) hints.push(`系统 Node ${nodeVersion}，dsh 建议 ^22.19 或 24+`)
  if (!dshReady) hints.push('首次发送消息时会自动下载 dsh（需联网，约 1–2 分钟）')
  if (!provider) hints.push('尚未配置 DeepSeek API Key（模型设置中添加）')
  if (!mcp?.running) hints.push('MCP 工具服务未启动（设置中开启）')

  return {
    nodeVersion: nodeVersion || '未知',
    nodeOk,
    dshReady,
    mcpRunning: !!mcp?.running,
    mcpEndpoint: mcp?.endpoint,
    hasDeepseekKey: !!provider,
    message: hints.join('；') || undefined
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
  const provider = resolveDeepseekProvider()
  if (!provider) {
    return { started: false, message: '未配置 DeepSeek API Key，请先在模型设置中添加' }
  }

  writeDshConfig(mcp.endpoint)
  const runId = String(++runSeq)
  emit({ type: 'status', text: '正在启动 DeepSeek Harness…' })
  emit({ type: 'tool', name: 'dsh-agent', state: 'start' })

  const npxBin = process.platform === 'win32' ? 'npx.cmd' : 'npx'
  const proc = spawn(
    npxBin,
    ['--yes', DSH_PACKAGE, '--profile', 'headless', task],
    {
      cwd: app.getPath('userData'),
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
  let lastAssistantAt = 0

  const onData = (chunk: Buffer | string, source: 'out' | 'err'): void => {
    stdoutBuf += String(chunk)
    const lines = stdoutBuf.split('\n')
    stdoutBuf = lines.pop() ?? ''
    for (const raw of lines) {
      const line = stripAnsi(raw).trim()
      if (!line) continue
      if (source === 'out') {
        sawOutput = true
        lastAssistantAt = Date.now()
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
      emit({
        type: 'error',
        message: `dsh 异常退出（code ${code}）。若为首次运行，请等待包下载完成后重试。`
      })
    } else {
      emit({ type: 'done', runId })
      // 保留 final 事件：渲染层可据此把「最终回答」与流式文本区分开
      if (finalText) emit({ type: 'final', text: finalText })
    }
  })

  // npx 现场拉包可能耗时数分钟：超时兜底，避免子进程悬挂
  const timeout = setTimeout(() => {
    if (child !== proc) return
    emit({ type: 'status', text: 'dsh 响应超时，正在中止（可重试）' })
    proc.kill()
  }, NPX_TIMEOUT_MS)
  proc.once('close', () => clearTimeout(timeout))

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
