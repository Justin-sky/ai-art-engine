import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { AI_WORKFLOW_PRESET_IDS, getAiWorkflowPresetPlan } from '@shared/graph'
import {
  IpcChannels,
  type CommitAiWorkflowInput,
  type CreateProjectInput,
  type PlanAiWorkflowInput,
  type WriteAssetTextInput
} from '@shared/ipc'
import { broadcastToAllWindows } from '../broadcast'
import { commitAiWorkflow, planAiWorkflow } from './graphPlanService'
import { projectService } from './projectService'
import { settingsService } from './settingsService'
import { updateService } from './updateService'
import { videoJobService } from './videoJobService'

/**
 * 本地 MCP 工具服务：在 127.0.0.1 上暴露一组工具端点，供 stdio MCP 桥
 * （scripts/mcp-bridge.mjs）转发外部 Agent（Claude Code / Codex 等）的调用。
 *
 * 端点约定：
 *   GET  /health          无需鉴权，仅供桥探测服务是否在线
 *   GET  /tools           工具元数据列表（供 tools/list）
 *   POST /tools/<name>    Body: { arguments } → { ok, result? , error? }
 *
 * 鉴权：除 /health 外均需 `Authorization: Bearer <token>`；token 与端口写入
 * <userData>/mcp.json，应用退出时删除。
 */

const MCP_DEFAULT_PORT = 43110
const MCP_PORT_RANGE = 10
const MCP_BODY_LIMIT = 8 * 1024 * 1024

interface McpToolDef {
  name: string
  title: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
  handler: (args: Record<string, unknown>) => Promise<unknown> | unknown
}

function readString(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`缺少必填字符串参数「${key}」`)
  }
  return value
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key]
  return typeof value === 'string' && value.trim() ? value : undefined
}

const TOOL_DEFS: McpToolDef[] = [
  {
    name: 'app_status',
    title: '应用状态',
    description:
      '查询 AiArtEngine 应用状态：版本号、是否已打开工程、当前工程根目录 / 名称与资产数量。',
    inputSchema: { type: 'object', properties: {} },
    handler: () => {
      const open = projectService.isOpen()
      const state = projectService.getOpenProjectState()
      return {
        version: updateService.getCurrentVersion(),
        projectOpen: open,
        rootPath: open ? projectService.getRoot() : null,
        projectName: open ? (state?.config.name ?? null) : null,
        assetCount: open ? projectService.listAssets().length : 0
      }
    }
  },
  {
    name: 'project_list',
    title: '最近工程',
    description: '列出应用中记录的最近工程（project.json 的绝对路径列表）。',
    inputSchema: { type: 'object', properties: {} },
    handler: () => ({ projects: settingsService.getRecent() })
  },
  {
    name: 'project_open',
    title: '打开工程',
    description:
      '打开指定工程（project.json 的绝对路径）。注意：应用界面当前显示的工程不会自动切换，建议在界面中确认。',
    inputSchema: {
      type: 'object',
      properties: {
        projectJsonPath: { type: 'string', description: 'project.json 的绝对路径' }
      },
      required: ['projectJsonPath']
    },
    handler: async (args) => {
      const projectJsonPath = readString(args, 'projectJsonPath')
      const result = projectService.openProject(projectJsonPath)
      videoJobService.resumePending()
      return {
        rootPath: result.rootPath,
        projectName: result.config.name,
        assetCount: result.assets.length
      }
    }
  },
  {
    name: 'project_create',
    title: '新建工程',
    description: '在指定父目录下新建工程（会创建以工程名命名的目录与 project.json）。',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '工程名称' },
        parentDir: { type: 'string', description: '父目录绝对路径' }
      },
      required: ['name', 'parentDir']
    },
    handler: async (args) => {
      const input: CreateProjectInput = {
        name: readString(args, 'name'),
        parentDir: readString(args, 'parentDir')
      }
      const result = projectService.createProject(input)
      return {
        projectJsonPath: join(result.rootPath, 'project.json'),
        rootPath: result.rootPath,
        projectName: result.config.name
      }
    }
  },
  {
    name: 'asset_list',
    title: '资产列表',
    description: '列出当前工程全部资产（id、类型、名称、相对路径、所在文件夹）。',
    inputSchema: { type: 'object', properties: {} },
    handler: () => {
      assertProjectOpen()
      return {
        assets: projectService.listAssets().map((asset) => ({
          id: asset.id,
          type: asset.type,
          name: asset.name,
          folderId: asset.folderId ?? null,
          relativePath: asset.relativePath,
          updatedAt: asset.updatedAt
        }))
      }
    }
  },
  {
    name: 'asset_read_file',
    title: '读取工程文件',
    description:
      '按工程内相对路径读取文本文件（受限于工程根目录内）。可用于读取剧本、图文档 JSON 等资产内容。',
    inputSchema: {
      type: 'object',
      properties: {
        relativePath: { type: 'string', description: '工程内相对路径，如 Assets/xxx/graph.json' }
      },
      required: ['relativePath']
    },
    handler: async (args) => {
      assertProjectOpen()
      const relativePath = readString(args, 'relativePath')
      const content = await projectService.readProjectFile(relativePath)
      if (content === null) throw new Error(`文件不存在：${relativePath}`)
      return { relativePath, content }
    }
  },
  {
    name: 'asset_write_text',
    title: '写入文本资产',
    description: '更新文本资产内容（剧本、备注等），应用界面会同步刷新。',
    inputSchema: {
      type: 'object',
      properties: {
        assetId: { type: 'string' },
        content: { type: 'string' }
      },
      required: ['assetId', 'content']
    },
    handler: (args) => {
      assertProjectOpen()
      const input: WriteAssetTextInput = {
        assetId: readString(args, 'assetId'),
        content: readString(args, 'content')
      }
      const updated = projectService.writeAssetText(input)
      broadcastToAllWindows(IpcChannels.ASSET_UPDATED, updated)
      return { id: updated.id, updatedAt: updated.updatedAt }
    }
  },
  {
    name: 'workflow_list_presets',
    title: '行业模板列表',
    description: '列出一键工作流的行业模板（id 与标题），可作为 workflow_plan 的 presetId。',
    inputSchema: { type: 'object', properties: {} },
    handler: () => ({
      presets: AI_WORKFLOW_PRESET_IDS.map((id) => ({
        id,
        title: getAiWorkflowPresetPlan(id)?.title ?? id
      }))
    })
  },
  {
    name: 'workflow_plan',
    title: '规划工作流',
    description:
      '用文本模型把自然语言描述规划成一张节点图（GraphPlan 预览）。可用 workflow_list_presets 返回的 presetId 作为种子模板；useSeedOnly=true 时跳过模型直接用固化模板。返回的 plan 原样传给 workflow_commit 落盘。依赖应用已配置文本模型，调用可能耗时数十秒。',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '工作流描述（presetId 缺省时必填）' },
        presetId: { type: 'string', description: '行业模板 id，可选' },
        useSeedOnly: { type: 'boolean', description: 'true 时只用预设固化拓扑，不调用文本模型' },
        model: { type: 'string', description: '文本模型 id，可选（缺省用应用当前选择）' },
        generateAspectRatio: { type: 'string', description: '统一宽高比，如 9:16' }
      },
      required: []
    },
    handler: async (args) => {
      assertProjectOpen()
      const input: PlanAiWorkflowInput = {
        prompt: optionalString(args, 'prompt') ?? '',
        presetId: optionalString(args, 'presetId'),
        useSeedOnly: args.useSeedOnly === true,
        model: optionalString(args, 'model'),
        generateAspectRatio: optionalString(args, 'generateAspectRatio')
      }
      return planAiWorkflow(input)
    }
  },
  {
    name: 'workflow_commit',
    title: '落盘工作流',
    description:
      '把 workflow_plan 返回的 plan 落盘为工程内的宿主资产（应用界面会同步出现该资产）。返回资产 id。',
    inputSchema: {
      type: 'object',
      properties: {
        plan: { type: 'object', description: 'workflow_plan 返回的 plan 对象' },
        name: { type: 'string', description: '资产显示名，缺省用计划标题' },
        generateAspectRatio: { type: 'string', description: '统一宽高比，如 9:16' }
      },
      required: ['plan']
    },
    handler: async (args) => {
      assertProjectOpen()
      const plan = args.plan
      if (!plan || typeof plan !== 'object') throw new Error('缺少必填对象参数「plan」')
      const input: CommitAiWorkflowInput = {
        plan: plan as CommitAiWorkflowInput['plan'],
        name: optionalString(args, 'name'),
        generateAspectRatio: optionalString(args, 'generateAspectRatio')
      }
      const result = await commitAiWorkflow(input)
      if (!result.ok || !result.assetId) {
        throw new Error(result.error ?? '无法落盘工作流')
      }
      const asset = projectService.listAssets().find((item) => item.id === result.assetId)
      if (asset) broadcastToAllWindows(IpcChannels.ASSET_UPDATED, asset)
      return { assetId: result.assetId, name: asset?.name ?? input.name ?? null }
    }
  },
  {
    name: 'video_job_list',
    title: '视频任务列表',
    description: '列出异步视频生成任务（提交 / 轮询中的任务）及其状态。',
    inputSchema: { type: 'object', properties: {} },
    handler: () => ({ jobs: videoJobService.list() })
  },
  {
    name: 'video_job_get',
    title: '视频任务详情',
    description: '查询单个异步视频生成任务的状态与产出。',
    inputSchema: {
      type: 'object',
      properties: { localJobId: { type: 'string' } },
      required: ['localJobId']
    },
    handler: (args) => {
      const job = videoJobService.get(readString(args, 'localJobId'))
      if (!job) throw new Error('任务不存在')
      return job
    }
  }
]

function assertProjectOpen(): void {
  if (!projectService.isOpen()) {
    throw new Error('请先在应用中打开工程（或调用 project_open）')
  }
}

let server: Server | null = null
let mcpToken = ''
let mcpConfigPath = ''

function mcpConfigFile(): string {
  return join(app.getPath('userData'), 'mcp.json')
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload)
  })
  res.end(payload)
}

function authorized(req: IncomingMessage): boolean {
  return req.headers.authorization === `Bearer ${mcpToken}`
}

async function readBody(req: IncomingMessage): Promise<string> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > MCP_BODY_LIMIT) throw new Error('请求体过大')
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function handleToolCall(name: string, body: string): Promise<unknown> {
  const tool = TOOL_DEFS.find((item) => item.name === name)
  if (!tool) throw new Error(`未知工具：${name}`)
  let args: Record<string, unknown> = {}
  if (body.trim()) {
    const parsed: unknown = JSON.parse(body)
    if (parsed && typeof parsed === 'object') {
      const raw = (parsed as { arguments?: unknown }).arguments
      if (raw && typeof raw === 'object') args = raw as Record<string, unknown>
    }
  }
  const result = await tool.handler(args)
  return { ok: true, result }
}

export async function startMcpServer(): Promise<void> {
  if (server) return
  const basePort = Number(process.env.AIAE_MCP_PORT) || MCP_DEFAULT_PORT
  mcpToken = randomUUID()

  for (let offset = 0; offset < MCP_PORT_RANGE; offset++) {
    const port = basePort + offset
    const started = await new Promise<boolean>((resolve) => {
      const candidate = createServer((req, res) => {
        void onRequest(req, res).catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err)
          sendJson(res, 500, { ok: false, error: message })
        })
      })
      candidate.on('error', () => resolve(false))
      candidate.listen(port, '127.0.0.1', () => {
        server = candidate
        resolve(true)
      })
    })
    if (started) {
      mcpConfigPath = mcpConfigFile()
      mkdirSync(app.getPath('userData'), { recursive: true })
      writeFileSync(
        mcpConfigPath,
        JSON.stringify(
          { port, token: mcpToken, pid: process.pid, version: updateService.getCurrentVersion() },
          null,
          2
        )
      )
      console.log(`[mcp] tool server ready at http://127.0.0.1:${port} (config: ${mcpConfigPath})`)
      return
    }
  }
  console.error(`[mcp] 端口 ${basePort}-${basePort + MCP_PORT_RANGE - 1} 均被占用，工具服务未启动`)
}

export function stopMcpServer(): void {
  if (!server) return
  const closing = server
  server = null
  if (mcpConfigPath) {
    try {
      rmSync(mcpConfigPath, { force: true })
    } catch {
      /* 配置文件清理失败可忽略 */
    }
    mcpConfigPath = ''
  }
  closing.close(() => {
    /* 端口释放即可，无需回调逻辑 */
  })
}

async function onRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = (req.url ?? '/').split('?')[0]
  if (req.method === 'GET' && url === '/health') {
    sendJson(res, 200, { ok: true, app: 'aiartengine' })
    return
  }
  if (!authorized(req)) {
    sendJson(res, 401, { ok: false, error: '未授权：缺少或错误的 Bearer token' })
    return
  }
  if (req.method === 'GET' && url === '/tools') {
    sendJson(res, 200, {
      tools: TOOL_DEFS.map(({ name, title, description, inputSchema }) => ({
        name,
        title,
        description,
        inputSchema
      }))
    })
    return
  }
  const call = url.match(/^\/tools\/([A-Za-z0-9_-]+)$/)
  if (req.method === 'POST' && call) {
    const body = await readBody(req)
    try {
      sendJson(res, 200, await handleToolCall(decodeURIComponent(call[1]), body))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[mcp tool ${call[1]}]`, message)
      sendJson(res, 200, { ok: false, error: message })
    }
    return
  }
  sendJson(res, 404, { ok: false, error: `未知端点：${req.method} ${url}` })
}

/** 供测试注入：当前 token（仅测试用途） */
export const __mcpServerTest = {
  getToolNames: () => TOOL_DEFS.map((tool) => tool.name),
  randomToken: randomUUID
}
