import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, appendFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, ipcMain } from 'electron'
import { AsyncSemaphore } from '@shared/asyncSemaphore'
import { createMcpProtocolHandler } from '@shared/mcpProtocol'
import {
  AI_WORKFLOW_PRESET_IDS,
  getAiWorkflowPresetPlan,
  type GraphDocument
} from '@shared/graph'
import {
  IpcChannels,
  type CommitAiWorkflowInput,
  type CreateProjectInput,
  type McpGraphEditResultPayload,
  type McpRestartInput,
  type McpServerInfo,
  type McpTaskReportPayload,
  type PlanAiWorkflowInput,
  type WriteAssetTextInput
} from '@shared/ipc'
import {
  getObjectStorageBucket,
  pickActiveObjectStorage,
  type ObjectStorageProviderInstance
} from '@shared/objectStorage'
import type {
  GenerateImageInput,
  GenerateModel3dInput,
  GenerateVideoInput
} from '@shared/modelProvider'
import { modelProviderFacade } from './modelProviders'
import { mcpActivityService } from './mcpActivityService'
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
 *   POST /mcp             streamable HTTP MCP 端点：单条 JSON-RPC（请求→200，
 *                         通知→202 空体）；其余路径一律 404
 *
 * 鉴权：除 /health 外均需 `Authorization: Bearer <token>`；token 与端口写入
 * <userData>/mcp.json，应用退出时删除。
 */

const MCP_DEFAULT_PORT = 43110
const MCP_PORT_RANGE = 10
const MCP_BODY_LIMIT = 8 * 1024 * 1024
/** 生成并发闸门：同步生成调用同时上限与排队上限（环境变量可覆盖） */
const MCP_GEN_LIMIT = Number(process.env.AIAE_MCP_GEN_LIMIT) || 3
/** 审计日志单文件上限（超过滚动为 .1） */
const MCP_AUDIT_MAX_BYTES = 5 * 1024 * 1024
/** 纳入并发闸门的工具（同步等待的耗时生成/规划） */
const GATED_TOOLS = new Set(['generate_image', 'generate_speech', 'workflow_plan'])

interface McpToolDef {
  name: string
  title: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
  handler: (
    args: Record<string, unknown>,
    ctx: { signal?: AbortSignal }
  ) => Promise<unknown> | unknown
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

/**
 * 执行旁路生成并登记为界面可见的「MCP 生成」活动：
 * 开始即广播 running，成功 / 失败广播终态（任务列表与执行日志同步展示）。
 * settle 在成功落盘后、终态广播前执行（如按 folderId 把资产搬移到资产库文件夹），
 * 保证活动里记录的相对路径是资产最终落盘路径，界面预览不会指向失效路径。
 */
async function runGenActivity<T>(
  tool: import('@shared/ipc').McpActivityTool,
  title: string,
  model: string | undefined,
  fn: () => Promise<T>,
  describe: (result: T) => { assetId?: string; relativePath?: string },
  settle?: (result: T) => void | Promise<void>
): Promise<T> {
  const activityId = mcpActivityService.begin({ tool, title, model })
  try {
    const result = await fn()
    await settle?.(result)
    mcpActivityService.end(activityId, { ok: true, ...describe(result) })
    return result
  } catch (err) {
    mcpActivityService.end(activityId, {
      ok: false,
      error: err instanceof Error ? err.message : String(err)
    })
    throw err
  }
}

/** 活动展示标题：优先 name，否则截断 prompt 摘要 */
function activityTitle(name: string | undefined, prompt: string): string {
  const text = name?.trim() || prompt.trim()
  return text.length > 60 ? `${text.slice(0, 60)}…` : text
}

/**
 * 取资产最新的相对路径：资产可能已被 applyAssetFolder 按 folderId 搬移，
 * 活动终态 / 工具返回值都必须用最终路径，否则界面预览会指向失效文件。
 */
function liveAssetRelativePath(result: { assetId?: string; relativePath?: string }): string | undefined {
  if (!result.assetId) return result.relativePath
  const live = projectService.listAssets().find((item) => item.id === result.assetId)
  return live?.relativePath || result.relativePath
}

/** settle 钩子：把生成资产挂到 folder_list 返回的资产库文件夹（可能触发搬移） */
function settleAssetFolder(assetId: string | undefined, folderId: string | undefined): void {
  if (!folderId || !assetId) return
  applyAssetFolder(assetId, folderId)
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
    name: 'folder_list',
    title: '资产库文件夹',
    description:
      '列出当前工程的资产库文件夹（id / 名称 / 父级），generate_* 与 workflow_commit 的 folderId 参数从这里取。',
    inputSchema: { type: 'object', properties: {} },
    handler: () => {
      assertProjectOpen()
      return {
        folders: projectService.listFolders().map((folder) => ({
          id: folder.id,
          name: folder.name,
          parentId: folder.parentId ?? null
        }))
      }
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
    handler: async (args, ctx) => {
      assertProjectOpen()
      const input: PlanAiWorkflowInput = {
        prompt: optionalString(args, 'prompt') ?? '',
        presetId: optionalString(args, 'presetId'),
        useSeedOnly: args.useSeedOnly === true,
        model: optionalString(args, 'model'),
        generateAspectRatio: optionalString(args, 'generateAspectRatio')
      }
      return planAiWorkflow(input, { signal: ctx?.signal })
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
        generateAspectRatio: { type: 'string', description: '统一宽高比，如 9:16' },
        folderId: { type: 'string', description: '资产库文件夹 id（folder_list 查询）' }
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
        generateAspectRatio: optionalString(args, 'generateAspectRatio'),
        folderId: optionalString(args, 'folderId')
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
  },
  {
    name: 'task_run',
    title: '运行工作流',
    description:
      '在应用中运行一个已落盘的宿主资产工作流（一键工作流产出的子图资产），整图按拓扑序执行生成，输出写回资产。返回 mcpTaskId，用 task_status 轮询；应用界面任务列表会同步显示。',
    inputSchema: {
      type: 'object',
      properties: {
        assetId: { type: 'string', description: '宿主资产 id（asset_list 或 workflow_commit 返回）' }
      },
      required: ['assetId']
    },
    handler: async (args) => {
      assertProjectOpen()
      const assetId = readString(args, 'assetId')
      const asset = projectService.listAssets().find((item) => item.id === assetId)
      const graphJson = (asset?.genParams as Record<string, unknown> | undefined)?.graphJson as
        | GraphDocument
        | undefined
      if (!asset || !graphJson || !Array.isArray(graphJson.nodes)) {
        throw new Error('资产不存在或不含图文档（task_run 仅支持宿主资产子图）')
      }
      const mcpTaskId = randomUUID()
      pendingMcpTaskReports.delete(mcpTaskId)
      broadcastToAllWindows(IpcChannels.MCP_TASK_RUN, { mcpTaskId, assetId })
      // 等渲染层确认受理
      for (let i = 0; i < 20; i++) {
        await sleep(300)
        const report = pendingMcpTaskReports.get(mcpTaskId)
        if (report?.phase === 'accepted') {
          return { mcpTaskId, taskId: report.taskId ?? null, state: 'running' }
        }
        if (report?.phase === 'failed') {
          throw new Error(report.error ?? '任务受理失败')
        }
      }
      return {
        mcpTaskId,
        state: 'dispatched',
        note: '界面未确认受理（可能界面非最新版本）；可稍后用 task_status 查询'
      }
    }
  },
  {
    name: 'task_status',
    title: '任务状态',
    description: '查询 task_run 返回的 mcpTaskId 当前执行状态（running / done / error / stopped）。',
    inputSchema: {
      type: 'object',
      properties: { mcpTaskId: { type: 'string' } },
      required: ['mcpTaskId']
    },
    handler: (args) => {
      const mcpTaskId = readString(args, 'mcpTaskId')
      const report = pendingMcpTaskReports.get(mcpTaskId)
      if (!report) throw new Error('未知任务 id（或尚未受理）')
      return report
    }
  },
  {
    name: 'graph_read',
    title: '读取节点图',
    description:
      '读取一个已落盘的宿主资产图的结构：节点（id / 类型 / 标题）与连线清单，供 graph_edit 前确认节点 id，或 task_run 前了解图内容。只读操作，图在编辑器中打开时也可调用。',
    inputSchema: {
      type: 'object',
      properties: {
        assetId: { type: 'string', description: '宿主资产 id' },
        includeParams: {
          type: 'boolean',
          description: 'true 时附带每个节点的完整参数（默认只返回结构摘要）'
        }
      },
      required: ['assetId']
    },
    handler: (args) => {
      assertProjectOpen()
      const assetId = readString(args, 'assetId')
      const asset = projectService.listAssets().find((item) => item.id === assetId)
      const graphJson = (asset?.genParams as Record<string, unknown> | undefined)?.graphJson as
        | GraphDocument
        | undefined
      if (!asset || !graphJson || !Array.isArray(graphJson.nodes)) {
        throw new Error('资产不存在或不含图文档（仅支持宿主资产子图）')
      }
      const includeParams = args.includeParams === true
      return {
        assetId,
        assetName: asset.name,
        nodeCount: graphJson.nodes.length,
        edgeCount: graphJson.edges.length,
        nodes: graphJson.nodes.map((node) => ({
          id: node.id,
          typeId: node.typeId ?? '',
          title: node.title ?? '',
          ...(includeParams ? { params: node.params } : {})
        })),
        edges: graphJson.edges.map((edge) => ({
          from: edge.source,
          to: edge.target,
          sourcePort: edge.sourcePort,
          targetPort: edge.targetPort
        }))
      }
    }
  },
  {
    name: 'graph_edit',
    title: '编辑节点图',
    description:
      '对一个已落盘的宿主资产图应用一批编辑操作（node_upsert / node_update / node_delete / edge_connect / edge_delete）。端口兼容性与类型合法性在应用内校验，未通过的操作跳过并记入 warnings。图正在编辑器中打开时会拒绝。修改立即持久化并同步应用界面。',
    inputSchema: {
      type: 'object',
      properties: {
        assetId: { type: 'string', description: '宿主资产 id' },
        ops: {
          type: 'array',
          description: '编辑操作批，按顺序执行',
          items: {
            type: 'object',
            properties: {
              op: {
                type: 'string',
                enum: ['node_upsert', 'node_update', 'node_delete', 'edge_connect', 'edge_delete']
              },
              nodeId: { type: 'string' },
              typeId: { type: 'string', description: 'node_upsert 必填，如 asset.image / play.script' },
              title: { type: 'string' },
              params: { type: 'object', description: '节点参数（浅合并）' },
              fromNodeId: { type: 'string' },
              toNodeId: { type: 'string' },
              fromPort: { type: 'string' },
              toPort: { type: 'string' }
            },
            required: ['op']
          }
        }
      },
      required: ['assetId', 'ops']
    },
    handler: async (args) => {
      assertProjectOpen()
      const assetId = readString(args, 'assetId')
      const asset = projectService.listAssets().find((item) => item.id === assetId)
      const graphJson = (asset?.genParams as Record<string, unknown> | undefined)?.graphJson as
        | GraphDocument
        | undefined
      if (!asset || !graphJson || !Array.isArray(graphJson.nodes)) {
        throw new Error('资产不存在或不含图文档（graph_edit 仅支持宿主资产子图）')
      }
      if (!Array.isArray(args.ops) || !args.ops.length) {
        throw new Error('缺少编辑操作数组「ops」')
      }
      const requestId = randomUUID()
      pendingMcpGraphEditResults.delete(requestId)
      broadcastToAllWindows(IpcChannels.MCP_GRAPH_EDIT, {
        requestId,
        assetId,
        ops: args.ops
      })
      try {
        for (let i = 0; i < 20; i++) {
          await sleep(300)
          const report = pendingMcpGraphEditResults.get(requestId)
          if (!report) continue
          if (report.ok) {
            return { applied: report.applied ?? [], warnings: report.warnings ?? [] }
          }
          throw new Error(report.error ?? '图编辑失败')
        }
        throw new Error('渲染层未响应（请确认应用界面为最新版本）')
      } finally {
        // 一次性请求信道：无论结果如何都释放，避免残留
        pendingMcpGraphEditResults.delete(requestId)
      }
    }
  },
  {
    name: 'generate_speech',
    title: '生成语音',
    description:
      '用音频模型（火山方舟 TTS / 声音设计等）把台词转成 MP3 并导入为工程声音资产。返回资产 id 与相对路径。',
    inputSchema: {
      type: 'object',
      properties: {
        input: { type: 'string', description: '台词 / 文本提示' },
        name: { type: 'string', description: '资产显示名' },
        model: { type: 'string', description: '音频模型 id（models_list 查询）' },
        providerInstanceId: { type: 'string', description: '提供商实例 id' },
        voice: { type: 'string', description: '音色（缺省用模型默认音色）' },
        speed: { type: 'number', description: '语速' },
        outputDir: { type: 'string', description: '工程内相对输出目录' },
        folderId: { type: 'string', description: '资产库文件夹 id（folder_list 查询）' },
        extraParams: { type: 'object', description: '低频参数透传（如 responseFormat / 参考图），合并进底层生成输入' }
      },
      required: ['input']
    },
    handler: async (args) => {
      assertProjectOpen()
      const inputText = readString(args, 'input')
      const input = {
        ...extraParamsOf(args),
        input: inputText,
        model: optionalString(args, 'model'),
        providerInstanceId: optionalString(args, 'providerInstanceId'),
        voice: optionalString(args, 'voice'),
        speed: typeof args.speed === 'number' && Number.isFinite(args.speed) ? args.speed : undefined,
        name: optionalString(args, 'name'),
        outputDir: optionalString(args, 'outputDir')
      }
      const result = await runGenActivity(
        'generate_speech',
        activityTitle(input.name, inputText),
        input.model,
        () => modelProviderFacade.generateSpeechAsset(input),
        (r) => ({ assetId: r.assetId, relativePath: liveAssetRelativePath(r) }),
        (r) => settleAssetFolder(r.assetId, optionalString(args, 'folderId'))
      )
      broadcastAsset(result.assetId)
      return {
        assetId: result.assetId,
        relativePath: liveAssetRelativePath(result),
        model: result.model,
        voice: result.voice
      }
    }
  },
  {
    name: 'models_list',
    title: '可用模型列表',
    description:
      '列出应用设置中已启用的模型提供商与各模态（text/image/video/audio/model3d）勾选的模型。generate_* 工具的 model / providerInstanceId 参数从这里取。',
    inputSchema: { type: 'object', properties: {} },
    handler: () => ({
      providers: settingsService
        .get()
        .models.providers.filter((provider) => provider.enabled)
        .map((provider) => ({
          providerInstanceId: provider.id,
          label: provider.label,
          providerKind: provider.providerKind,
          modalities: Object.fromEntries(
            (['text', 'image', 'video', 'audio', 'model3d'] as const).map((modality) => [
              modality,
              {
                selected: provider.modalities[modality]?.selectedModelIds ?? [],
                default: provider.modalities[modality]?.defaultModelId ?? ''
              }
            ])
          )
        }))
    })
  },
  {
    name: 'storage_status',
    title: '对象存储状态',
    description:
      '查询对象存储配置状态：是否已配置、当前启用的提供商与桶、公网地址。generate_model3d / generate_video 传本地或相对路径参考图时需要对象存储转公网 URL，图片生成则不依赖；调用前可用本工具确认。',
    inputSchema: { type: 'object', properties: {} },
    handler: () => {
      const providers = settingsService.get().objectStorage.providers
      const active = pickActiveObjectStorage({ providers })
      return {
        configured: providers.some((p) => p.enabled),
        enabled: active != null,
        provider: active ? { kind: active.providerKind, label: active.label } : null,
        bucket: active ? getObjectStorageBucket(active) : null,
        publicBaseUrl: active ? objectStoragePublicBaseUrl(active) : null,
        note: active
          ? null
          : '未配置可用的对象存储：图片参考会内联为 data URL（无需上传）；视频/3D 参考需先在设置 → 对象存储中配置 TOS/OSS/COS'
      }
    }
  },
  {
    name: 'generate_image',
    title: '生成图片',
    description:
      '用图片模型生成图片并落盘为工程资产（不进入节点图）。需要已打开工程；模型 / 提供商缺省时用应用当前选择。返回资产 id 与文件相对路径。',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '画面描述' },
        name: { type: 'string', description: '资产显示名' },
        model: { type: 'string', description: '图片模型 id（models_list 查询）' },
        providerInstanceId: { type: 'string', description: '提供商实例 id（models_list 查询）' },
        aspectRatio: { type: 'string', description: '如 1:1 / 16:9' },
        n: { type: 'integer', description: '生成张数' },
        referenceImageUrls: {
          type: 'array',
          items: { type: 'string' },
          description:
            '参考图（图生图）：支持 http(s) 地址、data URL、工程内相对路径（如 Assets/Generated/Images/x.png）或本地绝对路径。相对/本地路径会自动读取为 data URL 内联发送，无需对象存储'
        },
        outputDir: { type: 'string', description: '工程内相对输出目录（缺省 Assets/Generated/Images）' },
        folderId: { type: 'string', description: '资产库文件夹 id（folder_list 查询），界面分类用' },
        extraParams: { type: 'object', description: '低频参数透传（如 seed / quality / resolution），合并进底层生成输入；同名常用参数以显式传参为准' }
      },
      required: ['prompt']
    },
    handler: async (args) => {
      assertProjectOpen()
      const input: GenerateImageInput & { name?: string; outputDir?: string } = {
        ...extraParamsOf(args),
        prompt: readString(args, 'prompt'),
        name: optionalString(args, 'name'),
        model: optionalString(args, 'model'),
        providerInstanceId: optionalString(args, 'providerInstanceId'),
        aspectRatio: optionalString(args, 'aspectRatio'),
        n: typeof args.n === 'number' && Number.isFinite(args.n) ? args.n : undefined,
        inputReferences: Array.isArray(args.referenceImageUrls)
          ? args.referenceImageUrls.filter((item): item is string => typeof item === 'string')
          : undefined,
        outputDir: optionalString(args, 'outputDir')
      }
      const result = await runGenActivity(
        'generate_image',
        activityTitle(input.name, input.prompt),
        input.model,
        () => modelProviderFacade.generateImageAsset(input),
        (r) => ({ assetId: r.assetId, relativePath: liveAssetRelativePath(r) }),
        (r) => settleAssetFolder(r.assetId, optionalString(args, 'folderId'))
      )
      broadcastAsset(result.assetId)
      return { ...result, relativePath: liveAssetRelativePath(result) }
    }
  },
  {
    name: 'generate_video',
    title: '生成视频',
    description:
      '提交视频生成任务并登记为工程资产（供应商异步任务由应用后台轮询；可用 video_job_list / video_job_get 跟踪进度）。返回资产 id 与相对路径。',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '画面与运镜描述' },
        name: { type: 'string', description: '资产显示名' },
        model: { type: 'string', description: '视频模型 id（models_list 查询）' },
        providerInstanceId: { type: 'string', description: '提供商实例 id' },
        duration: { type: 'integer', description: '时长（秒）' },
        aspectRatio: { type: 'string', description: '如 9:16 / 16:9' },
        generateAudio: { type: 'boolean', description: '是否同步生成音频（部分模型）' },
        firstFrameImageUrl: {
          type: 'string',
          description:
            '首帧图：支持 http(s) 地址、data URL、工程内相对路径或本地绝对路径；本地文件会经对象存储转远程 URL（未配置对象存储时报错，可用 storage_status 查询）'
        },
        outputDir: { type: 'string', description: '工程内相对输出目录（缺省 Cache/Videos）' },
        folderId: { type: 'string', description: '资产库文件夹 id（folder_list 查询）' },
        extraParams: { type: 'object', description: '低频参数透传（如 resolution / size / lastFrameImageUrl / seed），合并进底层生成输入' }
      },
      required: ['prompt']
    },
    handler: async (args) => {
      assertProjectOpen()
      const input: GenerateVideoInput & { name?: string; outputDir?: string } = {
        ...extraParamsOf(args),
        prompt: readString(args, 'prompt'),
        name: optionalString(args, 'name'),
        model: optionalString(args, 'model'),
        providerInstanceId: optionalString(args, 'providerInstanceId'),
        duration: typeof args.duration === 'number' && Number.isFinite(args.duration) ? args.duration : undefined,
        aspectRatio: optionalString(args, 'aspectRatio'),
        generateAudio: typeof args.generateAudio === 'boolean' ? args.generateAudio : undefined,
        firstFrameImageUrl: optionalString(args, 'firstFrameImageUrl'),
        outputDir: optionalString(args, 'outputDir'),
        folderId: optionalString(args, 'folderId')
      }
      const result = await runGenActivity(
        'generate_video',
        activityTitle(input.name, input.prompt),
        input.model,
        () => modelProviderFacade.generateVideo(input),
        (r) => ({ assetId: r.assetId, relativePath: liveAssetRelativePath(r) }),
        (r) => settleAssetFolder(r.assetId, optionalString(args, 'folderId'))
      )
      broadcastAsset(result.assetId)
      return { ...result, relativePath: liveAssetRelativePath(result) }
    }
  },
  {
    name: 'generate_model3d',
    title: '生成 3D 模型',
    description:
      '文生 3D / 图生 3D（Meshy / Tripo / Rodin / Luma / Lux3D），产出 GLB 模型资产（供应商异步轮询）。返回资产 id 与相对路径。',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '外观描述' },
        name: { type: 'string', description: '资产显示名' },
        model: { type: 'string', description: '3D 模型 id（models_list 查询）' },
        providerInstanceId: { type: 'string', description: '提供商实例 id' },
        style: {
          type: 'string',
          description: '风格：photorealistic / cartoon / anime / hand_painted / cyberpunk / fantasy / glass'
        },
        referenceImageUrls: {
          type: 'array',
          items: { type: 'string' },
          description:
            '参考图（图生 3D / 多图生 3D）：支持 http(s) 地址、data URL、工程内相对路径或本地绝对路径。3D 供应商仅接受 http(s) 图片，相对/本地路径会自动上传到已配置的对象存储转换为公网 URL（未配置对象存储时报错，可用 storage_status 查询）'
        },
        folderId: { type: 'string', description: '资产库文件夹 id（folder_list 查询）' },
        extraParams: { type: 'object', description: '低频参数透传（模型特有字段），合并进底层生成输入' }
      },
      required: ['prompt']
    },
    handler: async (args) => {
      assertProjectOpen()
      const input: GenerateModel3dInput & { name?: string; outputDir?: string } = {
        ...extraParamsOf(args),
        prompt: readString(args, 'prompt'),
        name: optionalString(args, 'name'),
        model: optionalString(args, 'model'),
        providerInstanceId: optionalString(args, 'providerInstanceId'),
        style: optionalString(args, 'style'),
        inputReferences: Array.isArray(args.referenceImageUrls)
          ? args.referenceImageUrls.filter((item): item is string => typeof item === 'string')
          : undefined,
        folderId: optionalString(args, 'folderId')
      }
      const result = await runGenActivity(
        'generate_model3d',
        activityTitle(input.name, input.prompt),
        input.model,
        () => modelProviderFacade.generateModel3d(input),
        (r) => ({ assetId: r.assetId, relativePath: liveAssetRelativePath(r) }),
        (r) => settleAssetFolder(r.assetId, optionalString(args, 'folderId'))
      )
      broadcastAsset(result.assetId)
      return { ...result, relativePath: liveAssetRelativePath(result) }
    }
  }
]

/**
 * 校验 folderId 存在并把资产挂到该资产库文件夹。
 * 注意：updateAsset 在 folderId 变化时会 moveAssetBetweenFolders 把媒体文件
 * 搬进文件夹目录并更新 relativePath，因此调用方必须在活动终态广播前处理并回填最终路径。
 */
function applyAssetFolder(assetId: string, folderId: string | undefined): void {
  if (!folderId) return
  const folders = projectService.listFolders()
  if (!folders.some((folder) => folder.id === folderId)) {
    throw new Error(`资产库文件夹不存在：${folderId}（用 folder_list 查询可用 id）`)
  }
  const asset = projectService.listAssets().find((item) => item.id === assetId)
  if (asset) projectService.updateAsset({ ...asset, folderId })
}

/** 读取 extraParams 透传对象：剥离内部回写绑定字段，避免外部注入节点级回写 */
function extraParamsOf(args: Record<string, unknown>): Record<string, unknown> {
  const extra = args.extraParams && typeof args.extraParams === 'object'
    ? { ...(args.extraParams as Record<string, unknown>) }
    : {}
  delete extra.graphBinding
  return extra
}

function assertProjectOpen(): void {
  if (!projectService.isOpen()) {
    throw new Error('请先在应用中打开工程（或调用 project_open）')
  }
}

/** 取当前提供商实例的 publicBaseUrl（未填时返回空字符串） */
function objectStoragePublicBaseUrl(provider: ObjectStorageProviderInstance): string {
  if (provider.providerKind === 'aliyun-oss') return provider.oss.publicBaseUrl
  if (provider.providerKind === 'tencent-cos') return provider.cos.publicBaseUrl
  return provider.tos.publicBaseUrl
}

/** 终态报告保留时长：task_status 在此期间仍可查到结果，超时自动回收 */
const TASK_REPORT_RETENTION_MS = 10 * 60 * 1000

/** MCP task_run 的渲染层回报（受理 / 终态），task_status 从这里读 */
const pendingMcpTaskReports = new Map<string, McpTaskReportPayload>()
const taskReportCleanups = new Map<string, NodeJS.Timeout>()

/** 终态报告到期后自动清理，避免 Map 无限增长 */
function scheduleTaskReportCleanup(mcpTaskId: string): void {
  const prev = taskReportCleanups.get(mcpTaskId)
  if (prev) clearTimeout(prev)
  const timer = setTimeout(() => {
    pendingMcpTaskReports.delete(mcpTaskId)
    taskReportCleanups.delete(mcpTaskId)
  }, TASK_REPORT_RETENTION_MS)
  timer.unref?.()
  taskReportCleanups.set(mcpTaskId, timer)
}

/** MCP graph_edit 的渲染层回报（应用结果），graph_edit 等待并返回 */
const pendingMcpGraphEditResults = new Map<string, McpGraphEditResultPayload>()
const graphEditResultCleanups = new Map<string, NodeJS.Timeout>()

/** 回报已被等待方消费或超时后自动清理，与任务报告同一保留策略 */
function scheduleGraphEditResultCleanup(requestId: string): void {
  const prev = graphEditResultCleanups.get(requestId)
  if (prev) clearTimeout(prev)
  const timer = setTimeout(() => {
    pendingMcpGraphEditResults.delete(requestId)
    graphEditResultCleanups.delete(requestId)
  }, TASK_REPORT_RETENTION_MS)
  timer.unref?.()
  graphEditResultCleanups.set(requestId, timer)
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** 生成落盘后同步刷新应用界面中的资产卡片 */
function broadcastAsset(assetId: string | undefined): void {
  if (!assetId) return
  const asset = projectService.listAssets().find((item) => item.id === assetId)
  if (asset) broadcastToAllWindows(IpcChannels.ASSET_UPDATED, asset)
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
  const header = Buffer.from(req.headers.authorization ?? '')
  const expected = Buffer.from(`Bearer ${mcpToken}`)
  // 常量时间比较，避免 token 的计时侧信道
  return header.length === expected.length && timingSafeEqual(header, expected)
}

let mcpPort = 0

/** 本机允许的 Host / Origin（DNS rebinding 防护：MCP HTTP 传输规范要求） */
function localAddresses(): string[] {
  return [`127.0.0.1:${mcpPort}`, `localhost:${mcpPort}`, `[::1]:${mcpPort}`]
}

function rejectCrossOrigin(req: IncomingMessage, res: ServerResponse): boolean {
  const host = (req.headers.host ?? '').toLowerCase()
  if (!localAddresses().includes(host)) {
    sendJson(res, 403, { ok: false, error: `非法 Host：${host || '(空)'}（DNS rebinding 防护）` })
    return true
  }
  const origin = req.headers.origin
  if (origin && !localAddresses().some((addr) => origin === `http://${addr}`)) {
    sendJson(res, 403, { ok: false, error: `非法 Origin：${origin}（DNS rebinding 防护）` })
    return true
  }
  return false
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

let mcpAuditDir: string | null = null

function initMcpAuditDir(): void {
  mcpAuditDir = join(app.getPath('userData'), 'logs')
  mkdirSync(mcpAuditDir, { recursive: true })
}

function truncateText(value: string, max = 200): string {
  return value.length > max ? `${value.slice(0, max)}…` : value
}

/** 参数摘要：长文本截断、对象折叠，避免审计日志膨胀或落敏感全文 */
function summarizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string') out[key] = truncateText(value)
    else if (typeof value === 'number' || typeof value === 'boolean' || value === null) out[key] = value
    else if (Array.isArray(value)) out[key] = `[${value.length} 项]`
    else if (typeof value === 'object') out[key] = truncateText(JSON.stringify(value))
  }
  return out
}

/** MCP 操作审计：JSONL 追加写，超限滚动；失败不影响工具调用本身 */
function appendMcpAudit(entry: {
  tool: string
  ok: boolean
  durationMs: number
  args: Record<string, unknown>
  error?: unknown
}): void {
  if (!mcpAuditDir) return
  try {
    const path = join(mcpAuditDir, 'mcp-audit.jsonl')
    try {
      if (existsSync(path) && statSync(path).size > MCP_AUDIT_MAX_BYTES) {
        renameSync(path, join(mcpAuditDir, 'mcp-audit.1.jsonl'))
      }
    } catch {
      /* 滚动失败忽略 */
    }
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      tool: entry.tool,
      ok: entry.ok,
      durationMs: entry.durationMs,
      args: summarizeArgs(entry.args),
      ...(entry.error !== undefined
        ? { error: truncateText(String(entry.error), 300) }
        : {})
    })
    appendFileSync(path, `${line}
`)
  } catch {
    /* 审计写失败不影响工具调用 */
  }
}

const genGate = new AsyncSemaphore(MCP_GEN_LIMIT, MCP_GEN_LIMIT * 2)

async function handleToolCall(
  name: string,
  body: string,
  ctx?: { signal?: AbortSignal }
): Promise<unknown> {
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
  const startedAt = Date.now()
  const gated = GATED_TOOLS.has(name)
  if (gated) {
    const acquired = await genGate.acquire()
    if (!acquired) {
      throw new Error(
        `生成并发已达上限（同时 ${MCP_GEN_LIMIT} 个、排队 ${genGate.waiting} 个），请稍后重试或调高 AIAE_MCP_GEN_LIMIT`
      )
    }
  }
  try {
    const result = await tool.handler(args, { signal: ctx?.signal })
    const durationMs = Date.now() - startedAt
    const bytes = JSON.stringify(result).length
    appendMcpAudit({ tool: name, ok: true, durationMs, args })
    console.log(`[mcp] tool ${name} ok ${durationMs}ms ${bytes}B`)
    return { ok: true, result }
  } catch (err) {
    appendMcpAudit({ tool: name, ok: false, durationMs: Date.now() - startedAt, args, error: err })
    throw err
  } finally {
    if (gated) genGate.release()
  }
}

/** MCP 协议处理（streamable HTTP /mcp 端点与 stdio 桥共用同一工具面） */
let mcpServerVersion = '0.0.0'
const handleMcpProtocolMessage = createMcpProtocolHandler({
  serverInfo: { name: 'aiartengine', title: 'AiArtEngine', get version() { return mcpServerVersion } },
  listTools: () =>
    TOOL_DEFS.map(({ name, title, description, inputSchema }) => ({
      name,
      title,
      description,
      inputSchema
    })),
  callTool: async (name, args, callCtx) => {
    try {
      const payload = (await handleToolCall(
        name,
        JSON.stringify({ arguments: args }),
        callCtx
      )) as {
        ok?: boolean
        result?: unknown
        error?: string
      }
      if (payload && payload.ok === false) return { error: payload.error ?? '未知错误' }
      return { result: (payload as { result?: unknown }).result ?? null }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  }
})

function readStoredMcpConfig(): { port?: number; token?: string } {
  try {
    const path = mcpConfigFile()
    if (!existsSync(path)) return {}
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { port?: unknown; token?: unknown }
    return {
      port: typeof parsed.port === 'number' ? parsed.port : undefined,
      token: typeof parsed.token === 'string' && parsed.token ? parsed.token : undefined
    }
  } catch {
    return {}
  }
}

/** MCP 工具服务当前状态：供设置界面展示接入地址 / token / 一键复制命令 */
export function getMcpServerInfo(): McpServerInfo | null {
  if (!server || !mcpPort) return null
  return {
    running: true,
    port: mcpPort,
    token: mcpToken,
    configPath: mcpConfigPath,
    endpoint: `http://127.0.0.1:${mcpPort}/mcp`
  }
}

export async function startMcpServer(): Promise<void> {
  if (server) return
  const stored = readStoredMcpConfig()
  mcpServerVersion = String(updateService.getCurrentVersion())
  initMcpAuditDir()
  // token 持久复用：HTTP 直连模式下客户端配置的 header 才能保持有效；
  // 要重置可删除 mcp.json 后重启应用
  mcpToken = stored.token ?? randomUUID()
  // 端口偏好：优先上次使用的端口（HTTP 直连配置不变），再扫默认段
  const preferred = Number(process.env.AIAE_MCP_PORT) || stored.port
  const candidates: number[] = []
  if (preferred) candidates.push(preferred)
  for (let offset = 0; offset < MCP_PORT_RANGE; offset++) {
    const port = (Number(process.env.AIAE_MCP_PORT) || MCP_DEFAULT_PORT) + offset
    if (!candidates.includes(port)) candidates.push(port)
  }

  ipcMain.handle(IpcChannels.MCP_TASK_REPORT, (_event, payload: McpTaskReportPayload) => {
    if (payload && typeof payload.mcpTaskId === 'string') {
      pendingMcpTaskReports.set(payload.mcpTaskId, payload)
      // 终态（成功或失败）保留一段可查询时间后自动回收，避免 Map 无限增长
      if (payload.phase !== 'accepted') scheduleTaskReportCleanup(payload.mcpTaskId)
    }
    return true
  })
  ipcMain.handle(
    IpcChannels.MCP_GRAPH_EDIT_RESULT,
    (_event, payload: McpGraphEditResultPayload) => {
      if (payload && typeof payload.requestId === 'string') {
        pendingMcpGraphEditResults.set(payload.requestId, payload)
        scheduleGraphEditResultCleanup(payload.requestId)
      }
      return true
    }
  )

  for (const port of candidates) {
    const started = await new Promise<boolean>((resolve) => {
      const candidate = createServer((req, res) => {
        void onRequest(req, res).catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err)
          sendJson(res, 500, { ok: false, error: message })
        })
      })
      candidate.on('error', () => resolve(false))
      candidate.listen(port, '127.0.0.1', () => {
        mcpPort = port
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
  console.error(`[mcp] 候选端口均被占用（${candidates.join(', ')}），工具服务未启动`)
}

/** 关闭运行中的 MCP 服务（保留 mcp.json，供 restart 复用 token / 端口偏好） */
async function closeMcpServer(): Promise<void> {
  if (!server) return
  const closing = server
  server = null
  ipcMain.removeHandler(IpcChannels.MCP_TASK_REPORT)
  ipcMain.removeHandler(IpcChannels.MCP_GRAPH_EDIT_RESULT)
  // 清理进行中请求的等待状态与终态回收 timer，避免 stop 后残留
  for (const timer of taskReportCleanups.values()) clearTimeout(timer)
  taskReportCleanups.clear()
  pendingMcpTaskReports.clear()
  pendingMcpGraphEditResults.clear()
  await new Promise<void>((resolve) => {
    closing.close(() => resolve())
  })
}

/** 设置界面：应用端口 / 重置 token 修改并重启工具服务（token 默认持久复用） */
export async function restartMcpServer(input: McpRestartInput): Promise<McpServerInfo | null> {
  const { port, resetToken } = input ?? {}
  let nextPort: number | undefined
  if (port !== undefined) {
    nextPort = Math.trunc(Number(port))
    if (!Number.isFinite(nextPort) || nextPort < 1 || nextPort > 65535) {
      throw new Error('端口必须在 1–65535 之间')
    }
  }
  // 自定义 token 优先（8–128 位、不含空白）；其次重置生成；否则保留当前 token，
  // 保证已接入的客户端配置持续有效
  const customToken = typeof input?.token === 'string' ? input.token.trim() : ''
  if (customToken && !/^\S{8,128}$/.test(customToken)) {
    throw new Error('token 需为 8–128 位且不含空白的字符串')
  }
  const nextToken = customToken
    ? customToken
    : resetToken
      ? randomUUID()
      : mcpToken || readStoredMcpConfig().token || randomUUID()
  // 先落盘再启动：startMcpServer 会从 mcp.json 读取 token 与端口偏好
  const configPath = mcpConfigFile()
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(
    configPath,
    JSON.stringify(
      {
        ...(nextPort !== undefined ? { port: nextPort } : {}),
        token: nextToken,
        pid: process.pid,
        version: updateService.getCurrentVersion()
      },
      null,
      2
    )
  )
  await closeMcpServer()
  await startMcpServer()
  return getMcpServerInfo()
}

export function stopMcpServer(): void {
  if (!server) return
  const closing = server
  server = null
  ipcMain.removeHandler(IpcChannels.MCP_TASK_REPORT)
  ipcMain.removeHandler(IpcChannels.MCP_GRAPH_EDIT_RESULT)
  // 清理进行中请求的等待状态与终态回收 timer，避免 stop 后残留
  for (const timer of taskReportCleanups.values()) clearTimeout(timer)
  taskReportCleanups.clear()
  pendingMcpTaskReports.clear()
  pendingMcpGraphEditResults.clear()
  // 应用退出：保留 mcp.json——token 跨重启稳定，桥 / HTTP 直连配置持续有效；
  // pid 字段可能过期，桥只读取 port + token，不受影响
  mcpConfigPath = ''
  if (closing) {
    closing.close(() => {
      /* 端口释放即可，无需回调逻辑 */
    })
  }
}

async function onRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = (req.url ?? '/').split('?')[0]
  if (rejectCrossOrigin(req, res)) return
  if (req.method === 'GET' && url === '/health') {
    sendJson(res, 200, { ok: true, app: 'aiartengine' })
    return
  }
  if (!authorized(req)) {
    sendJson(res, 401, { ok: false, error: '未授权：缺少或错误的 Bearer token' })
    return
  }

  /** MCP streamable HTTP 直连端点：POST 单条 JSON-RPC；通知回 202；GET/DELETE 不支持 */
  if (url === '/mcp') {
    if (req.method !== 'POST') {
      res.writeHead(405, { Allow: 'POST' })
      res.end()
      return
    }
    const body = await readBody(req)
    let message: unknown
    try {
      message = JSON.parse(body)
    } catch {
      sendJson(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON 解析失败' } })
      return
    }
    // 客户端断开连接即视为取消：中止进行中的长任务（如 workflow_plan）
    const controller = new AbortController()
    const onClose = (): void => {
      if (!res.writableEnded) controller.abort()
    }
    req.on('close', onClose)
    try {
      const response = await handleMcpProtocolMessage(message, { signal: controller.signal })
      if (!response) {
        res.writeHead(202, { 'Content-Type': 'application/json' })
        res.end()
        return
      }
      sendJson(res, 200, response)
    } finally {
      req.off('close', onClose)
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
