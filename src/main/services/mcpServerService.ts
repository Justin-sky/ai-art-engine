import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, appendFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, ipcMain } from 'electron'
import { AsyncSemaphore } from '@shared/asyncSemaphore'
import type { AssetInfo } from '@shared/domain'
import { UI_KIT_PART_KINDS } from '@shared/gameAssets'
import { createMcpProtocolHandler, type McpToolImage } from '@shared/mcpProtocol'
import {
  AI_WORKFLOW_PRESET_IDS,
  MCP_GRAPH_EDIT_SCOPE,
  getAiWorkflowPresetPlan,
  getNodeType,
  listAddableNodeTypes,
  summarizeMediaUrlForLog,
  summarizeReferenceListForLog,
  type GraphDocument,
  contentEndSecOfTimeline,
  readScriptTimelineFromGenParams,
  type GraphRunLogApiCall,
  type ScriptTimelineClip,
  type ScriptTimelineDocument,
  type ScriptTimelineTrackKind,
  type TimelineExportClip,
  type TimelineExportInput
} from '@shared/graph'
import {
  planTimelineRoughCut,
  type TimelineRoughCutWarning
} from '@shared/graph/timelineCut'
import {
  applyTimelineEdits,
  type TimelineClipDraft,
  type TimelineClipPatch,
  type TimelineEditFailure,
  type TimelineEditOperation
} from '@shared/graph/timelineEdit'
import {
  DEFAULT_PREVIEW_FRAMES,
  MAX_PREVIEW_FRAMES,
  planPreviewTimestamps,
  type TimelinePreviewNote
} from '@shared/graph/timelinePreview'
import { buildSubtitleClipsFromTranscription } from '@shared/graph/timelineSubtitle'
import {
  IpcChannels,
  type AskUserAnswer,
  type CommitAiWorkflowInput,
  type CreateFolderInput,
  type CreateProjectInput,
  type McpGraphEditResultPayload,
  type McpGraphIconRefineResultPayload,
  type McpRenderJobKind,
  type McpRenderJobPayload,
  type McpRenderJobResultPayload,
  type McpRestartInput,
  type McpServerInfo,
  type McpTaskReportPayload,
  type PlanAiWorkflowInput,
  type WriteAssetTextInput
} from '@shared/ipc'
import {
  appendMemorySection,
  memorySectionTitle,
  PROJECT_MEMORY_RELATIVE_PATH,
  PROJECT_MEMORY_WRITE_LIMIT,
  type ProjectMemorySectionId
} from '@shared/projectMemory'
import {
  deleteVoiceProfile,
  normalizeVoiceProfiles,
  serializeVoiceProfiles,
  upsertVoiceProfile,
  VOICE_PROFILES_RELATIVE_PATH,
  voiceProfilesToMarkdown,
  type VoiceProfile
} from '@shared/voiceProfiles'
import {
  MCP_ASSET_IMPORT_LIMIT,
  MCP_CREATABLE_ASSET_TYPES,
  isMcpCreatableAssetType,
  normalizeImportFilePaths,
  normalizeProjectRelativePath,
  normalizeStringList
} from '@shared/mcpAssetWrite'
import {
  getObjectStorageBucket,
  pickActiveObjectStorage,
  type ObjectStorageProviderInstance
} from '@shared/objectStorage'
import type {
  GenerateImageInput,
  GenerateModel3dInput,
  GenerateVideoInput,
  TranscribeAudioSegment
} from '@shared/modelProvider'
import { modelProviderFacade } from './modelProviders'
import { mcpActivityService } from './mcpActivityService'
import { broadcastToAllWindows } from '../broadcast'
import { commitAiWorkflow, planAiWorkflow } from './graphPlanService'
import { projectService } from './projectService'
import { assetPackageService } from './assetPackageService'
import { uploadProjectMedia } from './objectStorageUploadService'
import { settingsService } from './settingsService'
import { updateService } from './updateService'
import { videoJobService } from './videoJobService'
import { exportScriptTimeline, renderTimelineFrames } from './timelineExportService'

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
const GATED_TOOLS = new Set(['generate_image', 'generate_speech', 'generate_music', 'workflow_plan'])

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
  settle?: (result: T) => void | Promise<void>,
  apiCall?: (
    result: T
  ) => Omit<GraphRunLogApiCall, 'id' | 'ts'> | undefined
): Promise<T> {
  const activityId = mcpActivityService.begin({ tool, title, model })
  try {
    const result = await fn()
    await settle?.(result)
    mcpActivityService.end(activityId, {
      ok: true,
      ...describe(result),
      apiCall: apiCall?.(result)
    })
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
    name: 'project_memory_read',
    title: '读取项目记忆',
    description:
      '读取当前工程的 Agent 记忆文件内容（跨会话沉淀的风格 / 机位 / 角色一致性 / 其它偏好）。返回原始 Markdown 文本与是否存在。',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      assertProjectOpen()
      const content = await projectService.readProjectFile(PROJECT_MEMORY_RELATIVE_PATH)
      return {
        exists: content !== null,
        path: PROJECT_MEMORY_RELATIVE_PATH,
        content
      }
    }
  },
  {
    name: 'project_memory_write',
    title: '写入项目记忆',
    description:
      '整体覆盖写入当前工程的 Agent 记忆文件（Markdown）。一般建议用 project_memory_append 增量沉淀，仅在需要整体整理 / 重建记忆时使用。',
    inputSchema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: '记忆文件完整 Markdown 内容（工程内 `.aiartengine/memory.md`）'
        }
      },
      required: ['content']
    },
    handler: async (args) => {
      assertProjectOpen()
      const content = String(args.content ?? '').trim()
      if (!content) throw new Error('记忆内容不能为空')
      if (content.length > PROJECT_MEMORY_WRITE_LIMIT) {
        throw new Error(`记忆内容超过上限 ${PROJECT_MEMORY_WRITE_LIMIT} 字符`)
      }
      const ok = await projectService.writeProjectFile({
        relativePath: PROJECT_MEMORY_RELATIVE_PATH,
        content
      })
      if (!ok) throw new Error('记忆文件写入失败（路径非法或工程未打开）')
      return { path: PROJECT_MEMORY_RELATIVE_PATH, updatedAt: new Date().toISOString() }
    }
  },
  {
    name: 'project_memory_append',
    title: '追加项目记忆',
    description:
      '向当前工程 Agent 记忆的指定分类追加一条偏好（风格 style / 机位 camera / 角色一致性 character / 其它 other）。' +
      'Agent 在创作中沉淀重要偏好时使用；跨会话随对话自动加载生效。',
    inputSchema: {
      type: 'object',
      properties: {
        section: {
          type: 'string',
          enum: ['style', 'camera', 'character', 'other'],
          description: '记忆分类：style（风格）/ camera（机位与镜头）/ character（角色一致性）/ other（其它）'
        },
        content: {
          type: 'string',
          description: '要追加的偏好描述（一句话）'
        }
      },
      required: ['content']
    },
    handler: async (args) => {
      assertProjectOpen()
      const sectionRaw = optionalString(args, 'section') ?? 'other'
      const validSections: string[] = ['style', 'camera', 'character', 'other']
      const section: ProjectMemorySectionId = validSections.includes(sectionRaw)
        ? (sectionRaw as ProjectMemorySectionId)
        : 'other'
      const entry = optionalString(args, 'content')
      if (!entry) throw new Error('缺少要追加的记忆内容')
      if (entry.length > 2000) throw new Error('单条记忆超过 2000 字符上限')
      const current = await projectService.readProjectFile(PROJECT_MEMORY_RELATIVE_PATH)
      const next = appendMemorySection(current ?? '', section, entry)
      if (next.length > PROJECT_MEMORY_WRITE_LIMIT) {
        throw new Error(`记忆文件超过上限 ${PROJECT_MEMORY_WRITE_LIMIT} 字符`)
      }
      const ok = await projectService.writeProjectFile({
        relativePath: PROJECT_MEMORY_RELATIVE_PATH,
        content: next
      })
      if (!ok) throw new Error('记忆文件写入失败（路径非法或工程未打开）')
      const title = memorySectionTitle(section)
      return { path: PROJECT_MEMORY_RELATIVE_PATH, section, sectionTitle: title, added: entry }
    }
  },
  {
    name: 'voice_profile_list',
    title: '角色音色档案',
    description:
      '列出当前工程的角色音色档案（角色 → 音色 id / 克隆参考音频），返回 Markdown 摘要与 JSON 明细。' +
      '配音节点按角色名（generateSpeechCharacter）自动取用档案音色，实现跨镜头一致配音。',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      assertProjectOpen()
      const profiles = await readVoiceProfiles()
      return {
        count: profiles.length,
        summary: voiceProfilesToMarkdown(profiles),
        profiles
      }
    }
  },
  {
    name: 'voice_profile_upsert',
    title: '新建 / 更新角色音色档案',
    description:
      '为角色建档或更新：character 必填；voice 为音色 id（MiniMax voice_id / 方舟 speaker_id，二选一与参考音频同有可）；' +
      'referenceAudio 为克隆参考音频（工程内相对路径或 http(s) URL，10-30s 人声）；description 为音色描述。' +
      '声音克隆成功后建议把新 speaker_id 回填到 voice。',
    inputSchema: {
      type: 'object',
      properties: {
        character: { type: 'string', description: '角色名（唯一键）' },
        voice: { type: 'string', description: '音色 id（可选）' },
        referenceAudio: { type: 'string', description: '克隆参考音频相对路径或 URL（可选）' },
        description: { type: 'string', description: '音色描述（可选）' }
      },
      required: ['character']
    },
    handler: async (args) => {
      assertProjectOpen()
      const character = optionalString(args, 'character')?.trim()
      if (!character) throw new Error('缺少角色名（character）')
      const profiles = await readVoiceProfiles()
      const next = upsertVoiceProfile(profiles, {
        character,
        voice: optionalString(args, 'voice'),
        referenceAudio: optionalString(args, 'referenceAudio'),
        description: optionalString(args, 'description')
      })
      await writeVoiceProfiles(next)
      const created = next.find((p) => p.character === character)
      return { character, profile: created }
    }
  },
  {
    name: 'voice_profile_delete',
    title: '删除角色音色档案',
    description: '删除指定角色的音色档案。',
    inputSchema: {
      type: 'object',
      properties: {
        character: { type: 'string', description: '角色名' }
      },
      required: ['character']
    },
    handler: async (args) => {
      assertProjectOpen()
      const character = optionalString(args, 'character')?.trim()
      if (!character) throw new Error('缺少角色名（character）')
      const profiles = await readVoiceProfiles()
      const next = deleteVoiceProfile(profiles, character)
      await writeVoiceProfiles(next)
      return { character, removed: next.length !== profiles.length }
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
    name: 'folder_create',
    title: '新建资产库文件夹',
    description:
      '在当前工程的资产库中新建文件夹，返回文件夹 id（可作为 asset_import / asset_create / generate_* 的 folderId）。应用的目录树会同步刷新。',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '文件夹名称' },
        parentId: { type: 'string', description: '父文件夹 id（可选，缺省建在资产库根目录）' }
      },
      required: ['name']
    },
    handler: (args) => {
      assertProjectOpen()
      const input: CreateFolderInput = {
        name: readString(args, 'name'),
        parentId: optionalString(args, 'parentId') ?? null
      }
      const folder = projectService.createFolder(input)
      broadcastToAllWindows(IpcChannels.FOLDERS_UPDATED, null)
      return { folderId: folder.id, name: folder.name, parentId: folder.parentId ?? null }
    }
  },
  {
    name: 'asset_create',
    title: '新建资产',
    description:
      '在资产库新建一个资产，返回资产 id，应用界面同步出现。支持类型：screenplay 剧本 / gameSystem 策划案 / world 世界观 / beat 分镜 / subgraph 子图 / canvas 自由画布 / image 图片 / video 视频 / voice 声音 / motion2d 2D 动作。',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: '资产类型（见工具描述白名单）' },
        name: { type: 'string', description: '资产名称（可选，缺省按类型自动命名）' },
        folderId: { type: 'string', description: '目标资产库文件夹 id（可选，缺省放资产库根目录）' },
        prompt: { type: 'string', description: '初始提示词 / 摘要（可选）' },
        notes: { type: 'string', description: '备注（可选）' }
      },
      required: ['type']
    },
    handler: (args) => {
      assertProjectOpen()
      const type = readString(args, 'type').trim()
      if (!isMcpCreatableAssetType(type)) {
        throw new Error(
          `不支持的资产类型：${type}（可选：${MCP_CREATABLE_ASSET_TYPES.join(' / ')}）`
        )
      }
      const folderId = optionalString(args, 'folderId') ?? null
      assertFolderExists(folderId)
      const asset = projectService.createAsset({
        type,
        name: optionalString(args, 'name'),
        folderId,
        prompt: optionalString(args, 'prompt'),
        notes: optionalString(args, 'notes')
      })
      broadcastToAllWindows(IpcChannels.ASSET_UPDATED, asset)
      return {
        assetId: asset.id,
        type: asset.type,
        name: asset.name,
        folderId: asset.folderId ?? null
      }
    }
  },
  {
    name: 'asset_import',
    title: '导入素材',
    description:
      '把本机绝对路径上的媒体文件导入当前工程资产库（图片 / 视频 / 音频 / 文本，按扩展名判定类型），返回逐条导入结果与跳过原因；界面资产库同步刷新。',
    inputSchema: {
      type: 'object',
      properties: {
        filePaths: {
          type: 'array',
          items: { type: 'string' },
          description: `本机绝对路径列表（最多 ${MCP_ASSET_IMPORT_LIMIT} 条）`
        },
        folderId: { type: 'string', description: '目标资产库文件夹 id（可选，缺省放资产库根目录）' }
      },
      required: ['filePaths']
    },
    handler: (args) => {
      assertProjectOpen()
      const filePaths = normalizeImportFilePaths(args.filePaths)
      if (!filePaths.length) {
        throw new Error('缺少必填参数「filePaths」（非空的本机绝对路径字符串数组）')
      }
      if (filePaths.length > MCP_ASSET_IMPORT_LIMIT) {
        throw new Error(
          `单次最多导入 ${MCP_ASSET_IMPORT_LIMIT} 个文件（本次 ${filePaths.length} 个），请分批调用`
        )
      }
      const folderId = optionalString(args, 'folderId') ?? null
      assertFolderExists(folderId)
      const result = projectService.importAssets(filePaths, folderId)
      for (const asset of result.imported) {
        broadcastToAllWindows(IpcChannels.ASSET_UPDATED, asset)
      }
      return {
        imported: result.imported.map((asset) => ({
          assetId: asset.id,
          type: asset.type,
          name: asset.name,
          relativePath: asset.relativePath
        })),
        skipped: result.skipped
      }
    }
  },
  {
    name: 'asset_rename',
    title: '重命名资产',
    description: '修改资产名称，应用界面同步刷新。',
    inputSchema: {
      type: 'object',
      properties: {
        assetId: { type: 'string' },
        name: { type: 'string', description: '新名称（空白字符会被裁剪）' }
      },
      required: ['assetId', 'name']
    },
    handler: (args) => {
      assertProjectOpen()
      const updated = projectService.renameAsset(
        readString(args, 'assetId'),
        readString(args, 'name')
      )
      broadcastToAllWindows(IpcChannels.ASSET_UPDATED, updated)
      return { assetId: updated.id, name: updated.name }
    }
  },
  {
    name: 'asset_move',
    title: '移动资产',
    description:
      '把资产移动到指定资产库文件夹（省略 folderId 表示移回资产库根目录）；媒体文件随目录一起搬移，返回搬移后的相对路径。',
    inputSchema: {
      type: 'object',
      properties: {
        assetId: { type: 'string' },
        folderId: { type: 'string', description: '目标文件夹 id；省略即移回资产库根目录' }
      },
      required: ['assetId']
    },
    handler: (args) => {
      assertProjectOpen()
      const asset = findAssetOrThrow(readString(args, 'assetId'))
      const folderId = optionalString(args, 'folderId') ?? null
      assertFolderExists(folderId)
      const updated = projectService.updateAsset({ ...asset, folderId })
      broadcastToAllWindows(IpcChannels.ASSET_UPDATED, updated)
      return {
        assetId: updated.id,
        folderId: updated.folderId ?? null,
        relativePath: updated.relativePath
      }
    }
  },
  {
    name: 'asset_delete',
    title: '删除资产',
    description:
      '从资产库移除资产（连同其元数据；源媒体文件保留在工程目录内）。默认拒绝删除仍被其他资产 / 节点引用的资产，确认影响后传 force=true 强制删除。',
    inputSchema: {
      type: 'object',
      properties: {
        assetId: { type: 'string' },
        force: { type: 'boolean', description: '被引用时是否强制删除（默认 false）' }
      },
      required: ['assetId']
    },
    handler: (args) => {
      assertProjectOpen()
      const assetId = readString(args, 'assetId')
      const asset = projectService.listAssets().find((item) => item.id === assetId)
      if (!asset) return { assetId, deleted: false, reason: '资产不存在（可能已被删除）' }
      const { hits } = projectService.findAssetReferences([assetId])
      if (hits.length && args.force !== true) {
        const sites = hits
          .slice(0, 5)
          .map((hit) => hit.site.assetName)
          .join('、')
        throw new Error(
          `资产「${asset.name}」被 ${hits.length} 处引用（${sites}），确认无影响后传 force=true 强制删除`
        )
      }
      projectService.deleteAsset(assetId)
      broadcastToAllWindows(IpcChannels.ASSET_REMOVED, assetId)
      return { assetId, name: asset.name, deleted: true, referencedBy: hits.length }
    }
  },
  {
    name: 'transcribe_audio',
    title: '转写音频 / 视频',
    description:
      '把工程内的音频 / 视频文件转写成带时间戳的分段文本（台词表 / 字幕底稿），返回 segments（startSec / endSec / text）与整段文本。',
    inputSchema: {
      type: 'object',
      properties: {
        assetId: { type: 'string', description: '音频 / 视频资产 id（与 relativePath 二选一）' },
        relativePath: { type: 'string', description: '工程内相对路径（与 assetId 二选一）' },
        language: { type: 'string', description: '音频语言代码（如 zh / en），可提升准确率' },
        prompt: { type: 'string', description: '提示词：纠正专有名词识别（可选）' },
        model: { type: 'string', description: '转写模型 id（可选，缺省由适配器决定）' }
      }
    },
    handler: async (args) => {
      assertProjectOpen()
      const { relativePath } = resolveProjectRelativePath(args, '音频 / 视频')
      const result = await modelProviderFacade.transcribeAudio({
        relativePath,
        language: optionalString(args, 'language'),
        prompt: optionalString(args, 'prompt'),
        model: optionalString(args, 'model')
      })
      return {
        relativePath,
        model: result.model,
        language: result.language ?? null,
        text: result.text ?? null,
        segments: result.segments
      }
    }
  },
  {
    name: 'audio_separate',
    title: '人声 / 伴奏分离',
    description:
      '对工程内的音频做音源分离，产出人声与伴奏两条音轨（落工程 Cache/Separated/，不登记进资产库），返回两条相对路径。',
    inputSchema: {
      type: 'object',
      properties: {
        assetId: { type: 'string', description: '声音资产 id（与 relativePath 二选一）' },
        relativePath: { type: 'string', description: '工程内相对路径（与 assetId 二选一）' }
      }
    },
    handler: async (args) => {
      assertProjectOpen()
      const { relativePath } = resolveProjectRelativePath(args, '音频')
      return projectService.separateAudio(relativePath)
    }
  },
  {
    name: 'storage_upload',
    title: '上传素材到对象存储',
    description:
      '把工程内的媒体文件上传到已配置的对象存储，返回可分享的公网 / 预签名 URL（用于交付、外部评审）。',
    inputSchema: {
      type: 'object',
      properties: {
        assetId: { type: 'string', description: '要上传的资产 id（与 relativePath 二选一）' },
        relativePath: { type: 'string', description: '工程内相对路径（与 assetId 二选一）' }
      }
    },
    handler: async (args) => {
      assertProjectOpen()
      const { relativePath } = resolveProjectRelativePath(args, '媒体')
      const uploaded = await uploadProjectMedia(relativePath)
      return {
        relativePath,
        url: uploaded.url,
        objectKey: uploaded.objectKey ?? null,
        bytes: uploaded.bytes ?? null,
        sourceLabel: uploaded.sourceLabel ?? null
      }
    }
  },
  {
    name: 'asset_package_export',
    title: '导出资产包',
    description:
      '把指定资产 / 文件夹（可选带依赖与生成缓存）打包成 .aipackage 交付包。必须给绝对路径 targetPath，不走「另存为」对话框。',
    inputSchema: {
      type: 'object',
      properties: {
        targetPath: { type: 'string', description: '输出绝对路径（缺扩展名时自动补 .aipackage）' },
        assetIds: {
          type: 'array',
          items: { type: 'string' },
          description: '要打包的资产 id（与 folderIds 至少给一个）'
        },
        folderIds: {
          type: 'array',
          items: { type: 'string' },
          description: '要打包的资产库文件夹 id（含子文件夹）'
        },
        includeDependencies: { type: 'boolean', description: '是否收集依赖资产（默认 true）' },
        includeGeneratedOutputs: { type: 'boolean', description: '是否一并打包生成缓存（默认 false）' }
      },
      required: ['targetPath']
    },
    handler: async (args) => {
      assertProjectOpen()
      const assetIds = normalizeStringList(args.assetIds)
      const folderIds = normalizeStringList(args.folderIds)
      if (!assetIds.length && !folderIds.length) {
        throw new Error('请至少提供 assetIds 或 folderIds 之一（先建好文件夹本身不算内容）')
      }
      for (const id of assetIds) findAssetOrThrow(id)
      for (const id of folderIds) assertFolderExists(id)
      return assetPackageService.exportPackage({
        assetIds,
        folderIds,
        includeDependencies: args.includeDependencies !== false,
        includeGeneratedOutputs: args.includeGeneratedOutputs === true,
        targetPath: readString(args, 'targetPath').trim()
      })
    }
  },
  {
    name: 'asset_package_import',
    title: '导入资产包',
    description:
      '把 .aipackage 交付包导入当前工程（可按 guid 选子集、可选是否带依赖），返回逐条 导入 / 复用 / 重映射 报告，界面素材库同步刷新。',
    inputSchema: {
      type: 'object',
      properties: {
        packPath: { type: 'string', description: '资产包绝对路径（必须提供，不弹「打开」对话框）' },
        destinationFolderId: { type: 'string', description: '导入到指定资产库文件夹（可选）' },
        selectedGuids: {
          type: 'array',
          items: { type: 'string' },
          description: '仅导入这些 guid（省略 = 包内全部；会自动补齐祖先文件夹）'
        },
        includeDependencies: { type: 'boolean', description: '是否一并导入依赖（默认 true）' }
      },
      required: ['packPath']
    },
    handler: async (args) => {
      assertProjectOpen()
      const destinationFolderId = optionalString(args, 'destinationFolderId') ?? null
      assertFolderExists(destinationFolderId)
      const selectedGuids = normalizeStringList(args.selectedGuids)
      const result = await assetPackageService.importPackage({
        packPath: readString(args, 'packPath').trim(),
        destinationFolderId,
        selectedGuids: selectedGuids.length ? selectedGuids : undefined,
        includeDependencies: args.includeDependencies !== false
      })
      if (result.importedAssets || result.importedFolders) {
        broadcastToAllWindows(IpcChannels.FOLDERS_UPDATED, null)
      }
      return {
        importedAssets: result.importedAssets,
        importedFolders: result.importedFolders,
        reusedFolders: result.reusedFolders,
        reused: result.reused,
        remapped: result.remapped,
        restoredGenerated: result.restoredGenerated,
        items: result.items.slice(0, 50)
      }
    }
  },
  {
    name: 'stage2d_spine_export',
    title: '导出 Spine 骨架包',
    description:
      '把宿主资产图里 stage.2d「2D 舞台」节点的骨骼装配导出成 Spine 可用的骨架包：挂到关节的部件按放置计划裁成独立透明 PNG 页，加 skeleton.json 与 .atlas，落 Assets/2D/Spine/<包名>/。图编辑器正在界面中打开时会被拒绝（编辑器里可能有未落盘的装配 / 摆姿，导出的会是旧状态）。',
    inputSchema: {
      type: 'object',
      properties: {
        assetId: { type: 'string', description: '宿主资产 id（含 stage.2d 节点的图）' },
        nodeId: { type: 'string', description: '指定 2D 舞台节点 id（图里有多个时必须指定）' },
        baseName: { type: 'string', description: '骨架包名（默认 skeleton）' }
      },
      required: ['assetId']
    },
    handler: async (args) => {
      assertProjectOpen()
      const assetId = readString(args, 'assetId').trim()
      findAssetOrThrow(assetId)
      const nodeId = optionalString(args, 'nodeId')?.trim()
      const baseName = optionalString(args, 'baseName')?.trim()
      return runRenderJob('stage2d-spine-export', {
        assetId,
        ...(nodeId ? { nodeId } : {}),
        ...(baseName ? { baseName } : {})
      })
    }
  },
  {
    name: 'ui_kit_extract',
    title: '提取 UI 部件（九宫格）',
    description:
      '把整屏 UI 效果图按框选矩形逐部件裁成透明 PNG 落资产库（Assets/UIKits/<源图名>/），同目录写出 ui-kit.json 九宫格清单（含每部件 border / safe 边距，可直接给引擎做九宫格拉伸）。',
    inputSchema: {
      type: 'object',
      properties: {
        assetId: { type: 'string', description: '整屏 UI 图片资产 id' },
        parts: {
          type: 'array',
          description: '部件列表（源图像素坐标；面板 / 按钮 / 输入框 / 页签 / 弹窗）',
          items: {
            type: 'object',
            properties: {
              kind: { type: 'string', enum: [...UI_KIT_PART_KINDS], description: '部件类型' },
              name: { type: 'string', description: '部件名（同时作为落盘文件名，建议 kebab-case）' },
              rect: {
                type: 'object',
                description: '源图内的像素矩形（左上角坐标 + 宽高）',
                properties: {
                  x: { type: 'number' },
                  y: { type: 'number' },
                  width: { type: 'number' },
                  height: { type: 'number' }
                },
                required: ['x', 'y', 'width', 'height']
              },
              border: {
                type: 'object',
                description: '九宫格边距（像素，可选）',
                properties: {
                  left: { type: 'number' },
                  top: { type: 'number' },
                  right: { type: 'number' },
                  bottom: { type: 'number' }
                }
              },
              safe: {
                type: 'object',
                description: '安全区（像素，可选）',
                properties: {
                  left: { type: 'number' },
                  top: { type: 'number' },
                  right: { type: 'number' },
                  bottom: { type: 'number' }
                }
              }
            },
            required: ['kind', 'name', 'rect']
          }
        },
        outputDir: {
          type: 'string',
          description:
            '输出目录（工程内相对路径，必须落在资产库内、以 Assets/ 开头，默认 Assets/UIKits/<源图名>；部件需入库才能在素材库看到）'
        }
      },
      required: ['assetId', 'parts']
    },
    handler: async (args) => {
      assertProjectOpen()
      const assetId = readString(args, 'assetId').trim()
      findAssetOrThrow(assetId)
      const parts = Array.isArray(args.parts) ? args.parts : []
      if (!parts.length) throw new Error('请给出至少一个部件（parts）')
      const outputDir = optionalString(args, 'outputDir')?.trim()
      return runRenderJob('ui-kit-extract', {
        assetId,
        parts,
        ...(outputDir ? { outputDir } : {})
      })
    }
  },
  {
    name: 'asset_qc',
    title: '资产规范质检',
    description:
      '对图片资产做「能不能直接进引擎」的本地像素体检（不耗模型、不写盘、不改资产）：抠图漏底（主体内部透明孔洞）、边缘白边 / 光晕残留（半透明过渡像素偏亮或偏暗，量化指标 lumaDelta）、半透明碎屑、主体贴边可能已被裁切、空图、尺寸超 8192、命名规范（默认不查，naming=true 才查）。一次最多 40 个资产。返回每个资产的问题码 + 证据数值（metrics / bounds / coverage），以及可自动返工的问题码清单——要真修请调 asset_qc_fix。',
    inputSchema: {
      type: 'object',
      properties: {
        assetId: { type: 'string', description: '单个体检的图片资产 id' },
        assetIds: {
          type: 'array',
          items: { type: 'string' },
          description: '批量体检的图片资产 id 列表（与 assetId 二选一，上限 40）'
        },
        naming: { type: 'boolean', description: '是否附带命名规范检查（默认 false）' }
      }
    },
    handler: (args) => runAssetQcTool(args, false)
  },
  {
    name: 'asset_qc_fix',
    title: '资产质检返工（去边缘污染）',
    description:
      '对图片资产执行安全返工：按反混合公式剔除半透明边缘里残留的背景色（白边 / 轮廓光晕），修完自动再体检一遍，返回值里给出修复前后对比（fixed.resolved / fixed.metrics）。只修「边缘白边」这一项安全缺陷，且产出**新资产**落 Assets/QC/<原名>/，不覆盖原件。抠图漏底（镂空可能是刻意设计）、主体贴边、命名只报告不自动改（改名请用 asset_rename）。一次最多 40 个资产。',
    inputSchema: {
      type: 'object',
      properties: {
        assetId: { type: 'string', description: '要返工的图片资产 id' },
        assetIds: {
          type: 'array',
          items: { type: 'string' },
          description: '批量返工的图片资产 id 列表（与 assetId 二选一，上限 40）'
        },
        naming: { type: 'boolean', description: '是否附带命名规范检查（默认 false）' }
      }
    },
    handler: (args) => runAssetQcTool(args, true)
  },
  {
    name: 'timeline_read',
    title: '读取成片时间线',
    description:
      '读剧本资产里的成片时间线：返回片段列表（轨道 / 起止秒 / 源内取段起点 / 字幕文本 / 音量 / 淡入淡出 / 转场 / 画中画位置）、时间线设置（导出画布、帧率、码率、字幕样式、混音增益、水印）与总时长。所有时间坐标都是秒。可用 track 只看某条轨（video / overlay / voice / subtitle / music / sfx），用 limit 限制返回片段数。',
    inputSchema: {
      type: 'object',
      properties: {
        assetId: { type: 'string', description: '剧本资产 id（用 asset_list 查询）' },
        nodeId: {
          type: 'string',
          description: '时间线节点 id（同一资产挂多条时间线时用；缺省读默认时间线）'
        },
        track: {
          type: 'string',
          enum: ['video', 'overlay', 'voice', 'subtitle', 'music', 'sfx'],
          description: '只看某条轨'
        },
        limit: { type: 'number', description: '最多返回多少条片段（默认 200，上限 1000）' }
      },
      required: ['assetId']
    },
    handler: async (args) => {
      assertProjectOpen()
      const assetId = readString(args, 'assetId')
      const nodeId = optionalString(args, 'nodeId')
      const { asset, doc } = readTimelineDoc(assetId, nodeId)
      const track = optionalString(args, 'track')?.trim()
      const filtered = track ? doc.clips.filter((clip) => String(clip.track) === track) : doc.clips
      const limit = Math.min(1000, Math.max(1, Math.round(Number(args.limit) || 200)))
      const clips = filtered.slice(0, limit)
      const trackCounts: Record<string, number> = {}
      for (const clip of doc.clips) {
        trackCounts[clip.track] = (trackCounts[clip.track] ?? 0) + 1
      }
      return {
        assetId,
        assetName: asset.name,
        nodeId: nodeId ?? null,
        durationSec: contentEndSecOfTimeline(doc.clips),
        declaredDurationSec: doc.settings?.durationSec ?? null,
        clipCount: doc.clips.length,
        returnedClipCount: clips.length,
        truncated: filtered.length > clips.length,
        trackCounts,
        mutedTracks: doc.mutedTracks ?? [],
        settings: doc.settings ?? {},
        clips
      }
    }
  },
  {
    name: 'timeline_rough_cut',
    title: '智能粗剪（按转写挤掉静默）',
    description:
      '按配音转写把成片时间线里的静默挤掉：每句语音前后各留呼吸边距，净静默超过阈值的段落连同其它轨一起剪掉并整体前移（ripple），字幕 / 音乐 / 特效轨同步跟随；被切开的片段会按取段起点正确重算，转场与淡入淡出只保留在片段真正的首尾。只动配音轨覆盖的时间段，配音轨之外（空镜、纯音乐）一律不碰；某条配音片段一句语音都没匹配上时整段保留——宁可漏剪，不可误剪。默认 dry-run 只回计划摘要（beforeSec / afterSec / removedSec / cuts），apply=true 才写回剧本资产（需该剧本的时间线编辑器已关闭）。segments 请先用 transcribe_audio 转写配音资产后原样传入（源文件时间戳，会按片段 sourceOffsetSec 自动平移）。',
    inputSchema: {
      type: 'object',
      properties: {
        assetId: { type: 'string', description: '剧本资产 id' },
        segments: {
          type: 'array',
          description: '配音转写分段（transcribe_audio 的 segments 原样传入）',
          items: {
            type: 'object',
            properties: {
              startSec: { type: 'number', description: '语音起始（源文件秒）' },
              endSec: { type: 'number', description: '语音结束（源文件秒）' },
              text: { type: 'string', description: '该句文本（本工具不读，仅便于原样透传）' }
            },
            required: ['startSec', 'endSec']
          }
        },
        nodeId: { type: 'string', description: '时间线节点 id（缺省默认时间线）' },
        paddingSec: { type: 'number', description: '每句语音前后保留的呼吸边距（秒，默认 0.2）' },
        minSilenceSec: { type: 'number', description: '净静默达到该时长才剪（秒，默认 0.8）' },
        apply: { type: 'boolean', description: '是否把计划写回时间线（默认 false，只回计划不落盘）' }
      },
      required: ['assetId', 'segments']
    },
    handler: async (args) => {
      assertProjectOpen()
      const assetId = readString(args, 'assetId')
      const nodeId = optionalString(args, 'nodeId')
      const { asset, doc } = readTimelineDoc(assetId, nodeId)
      if (!doc.clips.length) {
        throw new Error(`剧本资产「${asset.name}」的时间线还没有任何片段（先在界面里把素材铺上轨）`)
      }
      const segments = readSpeechSegments(args.segments)
      const paddingSec = Number(args.paddingSec)
      const minSilenceSec = Number(args.minSilenceSec)
      const plan = planTimelineRoughCut({
        clips: doc.clips,
        segments,
        options: {
          ...(Number.isFinite(paddingSec) ? { paddingSec } : {}),
          ...(Number.isFinite(minSilenceSec) ? { minSilenceSec } : {})
        }
      })
      const summary = {
        beforeSec: plan.beforeSec,
        afterSec: plan.afterSec,
        removedSec: plan.removedSec,
        speechSec: plan.speechSec,
        cutCount: plan.cuts.length,
        cuts: plan.cuts.slice(0, 50),
        cutsTruncated: plan.cuts.length > 50,
        splitCount: plan.splitCount,
        droppedCount: plan.droppedCount,
        warnings: plan.warnings.map(roughCutWarningText)
      }
      if (args.apply !== true || !plan.cuts.length) {
        return { applied: false, ...summary }
      }
      await runRenderJob('timeline-document-apply', {
        assetId,
        ...(nodeId ? { nodeId } : {}),
        document: { ...doc, clips: plan.clips }
      })
      return { applied: true, ...summary }
    }
  },
  {
    name: 'timeline_export',
    title: '导出成片（ffmpeg）',
    description:
      '把剧本资产的时间线合成 MP4：视频轨拼接 + 转场 + 画中画叠加 + 配音 / 音乐混音（含音量与淡入淡出）+ 字幕烧录 + 水印。需要系统可用 ffmpeg（设置页可一键安装）。无界面链路必须给绝对路径 targetPath（缺扩展名自动补 .mp4、自动建父目录）；界面上走「另存为」对话框。产物会登记为工程内的视频资产。耗时随总时长与分辨率增长，长片可能数分钟。',
    inputSchema: {
      type: 'object',
      properties: {
        assetId: { type: 'string', description: '剧本资产 id' },
        nodeId: { type: 'string', description: '时间线节点 id（缺省默认时间线）' },
        targetPath: {
          type: 'string',
          description: '输出文件绝对路径（无界面链路必填，如 D:/out/final.mp4）'
        }
      },
      required: ['assetId']
    },
    handler: async (args) => {
      assertProjectOpen()
      const assetId = readString(args, 'assetId')
      const nodeId = optionalString(args, 'nodeId')
      const { asset, doc } = readTimelineDoc(assetId, nodeId)
      if (!doc.clips.length) {
        throw new Error(`剧本资产「${asset.name}」的时间线还没有任何片段，无从导出`)
      }
      const targetPath = optionalString(args, 'targetPath')?.trim()
      const input = buildTimelineExportInput(doc, {
        defaultFileName: `${asset.name}.mp4`,
        ...(targetPath ? { targetPath } : {})
      })
      const durationSec = input.durationSec
      if (durationSec <= 0) throw new Error('时间线内容时长为 0，无从导出')
      const result = await exportScriptTimeline(input)
      if (!result.ok) {
        if (result.canceled) {
          throw new Error('导出已取消：无界面 / Agent 链路必须显式传绝对路径 targetPath')
        }
        throw new Error(result.error)
      }
      return {
        ok: true,
        filePath: result.filePath,
        assetId: result.assetId ?? null,
        durationSec,
        clipCount: input.clips.length
      }
    }
  },
  {
    name: 'timeline_edit',
    title: '编辑成片时间线',
    description:
      '在剧本资产的时间线上增删改片段，四类指令按 operations 顺序执行：add（铺素材上轨；每枚给 track 与 durationSec，assetId 会自动补媒体路径与标题，缺 startSec 时自动排到该轨轨尾、多枚依次紧接）/ update（按片段 id 改字段：音量 / 淡入淡出 / 转场 / 时长 / 字幕文本 / 画中画位置；传 null 表示清除该字段）/ remove（按 id 删）/ subtitles（把 transcribe_audio 的分段铺成字幕，按配音片段的取段起点对齐；默认替换该配音区间上的旧字幕，mode=append 则只追加）。单条指令失败只记入 failures 并继续执行其余指令，返回里带 added / removed 的片段 id。默认 dry-run 只回报告，apply=true 才写回剧本资产（需该剧本的时间线编辑器已关闭）。片段 id 用 timeline_read 查；粗剪会切分片段并改名（clip-1 → clip-1~2），重排后再编辑请重新读一次。',
    inputSchema: {
      type: 'object',
      properties: {
        assetId: { type: 'string', description: '剧本资产 id' },
        nodeId: { type: 'string', description: '时间线节点 id（缺省默认时间线）' },
        operations: {
          type: 'array',
          description: '按顺序执行的编辑指令',
          items: {
            type: 'object',
            properties: {
              op: {
                type: 'string',
                enum: ['add', 'update', 'remove', 'subtitles'],
                description: '指令类型'
              },
              clips: {
                type: 'array',
                description:
                  'add：要铺的片段。每项需含 track（video / overlay / voice / subtitle / music / sfx）与 durationSec，可用 assetId 或工程内相对路径 relativePath 指定媒体，startSec 缺省排到该轨轨尾；也支持 volume / fadeInSec / overlayX 等片段字段',
                items: { type: 'object' }
              },
              gapSec: {
                type: 'number',
                description: 'add：片段之间（以及与轨内既有内容之间）留的空隙秒数，默认 0'
              },
              clipId: { type: 'string', description: 'update：要改的片段 id' },
              patch: {
                type: 'object',
                description:
                  'update：要改的字段（text / title / startSec / durationSec / sourceOffsetSec / volume / opacity / fadeInSec / fadeOutSec / overlayX / overlayY / overlayWidth / overlayHeight / transitionInSec / transitionOutSec / transitionType；传 null 表示清除）'
              },
              clipIds: {
                type: 'array',
                items: { type: 'string' },
                description: 'remove：要删的片段 id 列表'
              },
              voiceClipId: {
                type: 'string',
                description: 'subtitles：配音轨片段 id（字幕按它的位置与取段起点对齐）'
              },
              segments: {
                type: 'array',
                description: 'subtitles：transcribe_audio 返回的分段原样传入（需要 text）',
                items: {
                  type: 'object',
                  properties: {
                    startSec: { type: 'number', description: '源文件时间戳（秒）' },
                    endSec: { type: 'number' },
                    text: { type: 'string' }
                  },
                  required: ['startSec', 'endSec', 'text']
                }
              },
              mode: {
                type: 'string',
                enum: ['replace', 'append'],
                description: 'subtitles：replace（默认，替换该配音区间上的旧字幕）或 append（直接追加）'
              }
            },
            required: ['op']
          }
        },
        apply: { type: 'boolean', description: '是否写回时间线（默认 false，只回报告不落盘）' }
      },
      required: ['assetId', 'operations']
    },
    handler: async (args) => {
      assertProjectOpen()
      const assetId = readString(args, 'assetId')
      const nodeId = optionalString(args, 'nodeId')
      const { asset, doc } = readTimelineDoc(assetId, nodeId)
      const rows = readTimelineEditRows(args.operations)
      // 同一批编辑共用一份 id 工厂：新增片段与字幕片段不会撞名
      const makeClipId = mcpClipIdFactory()
      const operations = buildTimelineEditOperations(rows, doc, makeClipId)
      const result = applyTimelineEdits(doc, operations, { makeClipId })
      const beforeIds = new Set(doc.clips.map((clip) => clip.id))
      const afterIds = new Set(result.document.clips.map((clip) => clip.id))
      const summary = {
        assetId,
        assetName: asset.name,
        beforeClipCount: doc.clips.length,
        afterClipCount: result.document.clips.length,
        added: result.added,
        updated: result.updated,
        removed: result.removed,
        addedClipIds: result.document.clips
          .filter((clip) => !beforeIds.has(clip.id))
          .map((clip) => clip.id),
        removedClipIds: doc.clips.filter((clip) => !afterIds.has(clip.id)).map((clip) => clip.id),
        durationSec: contentEndSecOfTimeline(result.document.clips),
        failures: result.failures.map(timelineEditFailureText)
      }
      const changed = result.added + result.updated + result.removed > 0
      if (args.apply !== true || !changed) {
        return { applied: false, ...summary }
      }
      await runRenderJob('timeline-document-apply', {
        assetId,
        ...(nodeId ? { nodeId } : {}),
        document: result.document
      })
      return { applied: true, ...summary }
    }
  },
  {
    name: 'timeline_preview',
    title: '看成片画面（抽帧）',
    description:
      '把剧本资产的时间线渲染成几张静帧直接回给你看——与 timeline_export 走同一条 ffmpeg 滤镜图，转场 / 画中画 / 烧录字幕 / 水印都会出现在画面里，所以「预览看到的就是成片」。默认按成片时长均匀抽 3 帧（取每格中心，避开开头淡入与结尾淡出）；也可以用 atSec 定点检查某一刻（比如刚加的转场落在 12.5 秒）。每张图带自己的时间点，图随本次响应回给客户端：多模态客户端能直接看到画面，纯文本客户端只会看到时间点列表。需要系统可用 ffmpeg；时间点越靠后解码越久，抽几帧比导出一次便宜得多，但仍不是瞬时。',
    inputSchema: {
      type: 'object',
      properties: {
        assetId: { type: 'string', description: '剧本资产 id' },
        nodeId: { type: 'string', description: '时间线节点 id（缺省默认时间线）' },
        count: {
          type: 'number',
          description: `均匀抽帧数（1~${MAX_PREVIEW_FRAMES}，默认 ${DEFAULT_PREVIEW_FRAMES}）；给了 atSec 时忽略`
        },
        atSec: {
          type: 'array',
          items: { type: 'number' },
          description: `指定抽帧时间点（秒，最多 ${MAX_PREVIEW_FRAMES} 个）：越界会夹到片内，重复的会合并`
        },
        width: { type: 'number', description: '预览帧宽（160~1280，默认 640）' }
      },
      required: ['assetId']
    },
    handler: async (args) => {
      assertProjectOpen()
      const assetId = readString(args, 'assetId')
      const nodeId = optionalString(args, 'nodeId')
      const { asset, doc } = readTimelineDoc(assetId, nodeId)
      if (!doc.clips.length) {
        throw new Error(`剧本资产「${asset.name}」的时间线还没有任何片段，没有可预览的画面`)
      }
      const input = buildTimelineExportInput(doc)
      const plan = planPreviewTimestamps({
        durationSec: input.durationSec,
        ...(args.count !== undefined ? { count: Number(args.count) } : {}),
        ...(Array.isArray(args.atSec) ? { atSec: args.atSec.map((sec) => Number(sec)) } : {})
      })
      if (!plan.timestamps.length) {
        const reason = plan.notes
          .map(previewNoteText)
          .filter(Boolean)
          .join('；')
        throw new Error(reason || '没有可抽帧的画面')
      }
      const width = Number(args.width)
      const result = await renderTimelineFrames(input, plan.timestamps, {
        ...(Number.isFinite(width) ? { width } : {})
      })
      if (!result.ok) throw new Error(result.error)
      return {
        ok: true,
        assetId,
        assetName: asset.name,
        durationSec: input.durationSec,
        frameWidth: result.width,
        frames: result.frames.map((frame) => ({
          timeSec: frame.timeSec,
          at: formatTimelineSec(frame.timeSec)
        })),
        notes: [
          ...plan.notes.map(previewNoteText).filter(Boolean),
          `${result.frames.length} 张画面已随本次响应回给客户端（纯文本客户端只能看到上面的时间点）`
        ],
        mcpImages: result.frames.map((frame) => frame.dataUrl)
      }
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
      // 登记为界面可见的旁路活动：终点由渲染层回报本轮产物相对路径后收尾，
      // 任务列表 / 执行日志 / AI 对话流三处共用这一条记录出预览
      pendingMcpTaskActivities.set(
        mcpTaskId,
        mcpActivityService.begin({
          tool: 'task_run',
          title: `运行工作流 · ${asset.name}`,
          detail: '按拓扑序执行整图，产物写回资产',
          assetId
        })
      )
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
    name: 'ask_user',
    title: '询问用户',
    description:
      '当需要用户选择或确认时调用（例如：方案 A/B 决策、是否继续执行、参数偏好等）。会向用户弹出问题与选项列表并等待其选择；返回用户选中的选项文本。不要在无关紧要的问题上使用，尽量一次给出 2~6 个自包含的选项。',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: '向用户提出的问题（简明扼要）' },
        options: {
          type: 'array',
          items: { type: 'string' },
          description: '候选选项（2~6 项，每项应自包含、用户可直接理解）'
        },
        hint: { type: 'string', description: '可选的补充说明' }
      },
      required: ['question']
    },
    handler: async (args) => {
      const question = readString(args, 'question')
      const rawOptions = args['options']
      const options = Array.isArray(rawOptions)
        ? rawOptions
            .filter((item): item is string => typeof item === 'string' && item.trim() !== '')
            .map((item) => item.trim())
            .slice(0, 6)
        : []
      const requestId = randomUUID()
      pendingAskUserAnswers.delete(requestId)
      broadcastToAllWindows(IpcChannels.MCP_ASK_USER, {
        requestId,
        question,
        options: options.length >= 2 ? options : undefined,
        hint: optionalString(args, 'hint')
      })
      // 等待渲染层回传用户选择（默认 5 分钟超时，agent 内部卡住时避免永久挂起）
      for (let i = 0; i < 1000; i++) {
        await sleep(300)
        const answer = pendingAskUserAnswers.get(requestId)
        if (answer) {
          pendingAskUserAnswers.delete(requestId)
          return { answer: answer.answer, cancelled: answer.answer === null }
        }
      }
      pendingAskUserAnswers.delete(requestId)
      return { answer: null, cancelled: true, reason: 'timeout' }
    }
  },
  {
    name: 'graph_node_types',
    title: '节点类型清单',
    description:
      '列出能被 graph_edit 添加到宿主资产子图的节点类型（与 graph_edit 的 node_upsert 校验同一白名单，含 2D 舞台 / 宫格切分 / 图标包等新节点）：typeId、名称、分类、端口（连线时 fromPort / toPort 用的 id）与可选默认参数。用于外部 Agent 自发现可建节点，避免用猜的 typeId 被 graph_edit 跳过。只读操作，无需打开工程。',
    inputSchema: {
      type: 'object',
      properties: {
        typeId: { type: 'string', description: '只查该节点类型；缺省返回全部可添加类型' },
        includeParams: {
          type: 'boolean',
          description: 'true 时附带每种节点的默认参数（可作 node_upsert 的 params 起点；默认 false）'
        }
      },
      required: []
    },
    handler: (args) => {
      const typeId = optionalString(args, 'typeId')?.trim()
      const includeParams = args.includeParams === true
      const defs = listAddableNodeTypes(MCP_GRAPH_EDIT_SCOPE)
      const matched = typeId ? defs.filter((def) => def.typeId === typeId) : defs
      const types = matched.map((def) => ({
        typeId: def.typeId,
        label: def.label,
        category: def.category,
        ...(def.assetType ? { assetType: def.assetType } : {}),
        ...(def.description ? { description: def.description } : {}),
        ports: def.ports.map((port) => ({
          id: port.id,
          direction: port.direction,
          dataType: port.dataType,
          multiple: port.multiple === true,
          ...(port.label ? { label: port.label } : {})
        })),
        ...(includeParams ? { params: def.defaultParams() } : {})
      }))
      if (typeId && !types.length) {
        return {
          scope: MCP_GRAPH_EDIT_SCOPE,
          total: 0,
          types: [],
          note: getNodeType(typeId)
            ? `节点类型「${typeId}」存在但不可添加（输出 / 边界等节点由图自带），graph_edit 会跳过它`
            : `未知节点类型「${typeId}」；省略 typeId 可获取全部可添加类型`
        }
      }
      return { scope: MCP_GRAPH_EDIT_SCOPE, total: types.length, types }
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
    name: 'graph_icon_refine',
    title: '单枚图标精修回炉',
    description:
      '对「整版图标表 → 宫格切分 → 图标包打包」链路里的某一枚做精修回炉：按整版画风与命名规范（可用 hint 指出不满意点，或直接给 prompt）重画这一枚方形图标卡片，写回同源打包节点的逐枚覆盖（iconPackCellRefines），并默认重跑打包节点、用精修图顶替该格 PNG。生图在应用界面（渲染层）执行，需该资产的图编辑器处于关闭状态；耗时较长（一次生图 + 一次打包重跑）。',
    inputSchema: {
      type: 'object',
      properties: {
        assetId: { type: 'string', description: '宿主资产 id（asset_list 查询）' },
        splitNodeId: {
          type: 'string',
          description: 'image.gridSplit 节点 id（要回炉的格位所在切分节点，graph_read 查询）'
        },
        cellKey: { type: 'string', description: '格位 key，形如 1-1 / 2-3（行-列）' },
        hint: { type: 'string', description: '针对不满意点的修正说明（缺省按整版同规范重画）' },
        prompt: { type: 'string', description: '完整生图指令（给出时覆盖默认指令与 hint）' },
        repack: { type: 'boolean', description: '完成后是否重跑同源打包节点（默认 true）' },
        locale: { type: 'string', enum: ['zh', 'en'], description: '默认生图指令语言（默认 zh）' }
      },
      required: ['assetId', 'splitNodeId', 'cellKey']
    },
    handler: async (args) => {
      assertProjectOpen()
      const assetId = readString(args, 'assetId')
      const splitNodeId = readString(args, 'splitNodeId')
      const cellKey = readString(args, 'cellKey')
      const asset = projectService.listAssets().find((item) => item.id === assetId)
      const graphJson = (asset?.genParams as Record<string, unknown> | undefined)?.graphJson as
        | GraphDocument
        | undefined
      if (!asset || !graphJson || !Array.isArray(graphJson.nodes)) {
        throw new Error('资产不存在或不含图文档（graph_icon_refine 仅支持宿主资产子图）')
      }
      const hint = optionalString(args, 'hint')
      // 登记为界面可见的「MCP 生成」活动：外部 Agent 触发回炉时，
      // 任务按钮出现角标、任务列表出现运行中条目、执行日志出现会话（含终态）
      const activityId = mcpActivityService.begin({
        tool: 'graph_icon_refine',
        title: `${asset.name} · 第 ${cellKey} 格`,
        detail: hint ? `修正：${hint}` : '按整版画风重画这一枚',
        // 运行中即带上资产：该图编辑器此时必然关闭（上面已校验），素材库卡片角标
        // 是用户在应用里唯一能直接看到「这一枚正在被重画」的地方
        assetId
      })
      const requestId = randomUUID()
      pendingMcpGraphIconRefineResults.delete(requestId)
      broadcastToAllWindows(IpcChannels.MCP_GRAPH_ICON_REFINE, {
        requestId,
        assetId,
        splitNodeId,
        cellKey,
        hint,
        prompt: optionalString(args, 'prompt'),
        locale: args.locale === 'en' ? 'en' : 'zh',
        repack: args.repack !== false
      })
      try {
        const deadline = Date.now() + MCP_GRAPH_ICON_REFINE_TIMEOUT_MS
        while (Date.now() < deadline) {
          await sleep(MCP_GRAPH_ICON_REFINE_POLL_MS)
          const report = pendingMcpGraphIconRefineResults.get(requestId)
          if (!report) continue
          if (!report.ok) throw new Error(report.error ?? '精修回炉失败')
          const result = {
            cellKey: report.cellKey ?? cellKey,
            name: report.name ?? null,
            packNodeId: report.packNodeId ?? '',
            prompt: report.prompt ?? '',
            repacked: report.repacked === true,
            ...(report.warning ? { warning: report.warning } : {})
          }
          mcpActivityService.end(activityId, {
            ok: true,
            assetId,
            // 精修产物落在该资产自身文件上（重跑打包后覆盖），指向它便于界面定位
            relativePath: asset.relativePath || undefined
          })
          return result
        }
        throw new Error(
          '精修回炉超时：渲染层仍在生成或重跑打包，可在应用任务列表查看进度（结果已写回图文档时无需重试）'
        )
      } catch (err) {
        mcpActivityService.end(activityId, {
          ok: false,
          assetId,
          error: err instanceof Error ? err.message : String(err)
        })
        throw err
      } finally {
        // 一次性请求信道：无论结果如何都释放，避免残留
        pendingMcpGraphIconRefineResults.delete(requestId)
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
        (r) => settleAssetFolder(r.assetId, optionalString(args, 'folderId')),
        (r) => ({
          kind: 'generateSpeech',
          nodeId: 'mcp',
          request: {
            input: input.input,
            model: input.model,
            providerInstanceId: input.providerInstanceId,
            voice: input.voice,
            name: input.name
          },
          response: {
            model: r.model,
            voice: r.voice,
            assetId: r.assetId,
            relativePath: liveAssetRelativePath(r)
          }
        })
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
    name: 'generate_music',
    title: '生成 BGM / 音乐',
    description:
      '用音乐模型（MiniMax Music / 百炼 Fun-Music 等）按情绪与时长描述生成配乐并落盘到工程缓存目录（缺省 Cache/Music，不自动进资产库）。返回资产 id 与相对路径，可直接铺到时间线 music 轨。',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '音乐描述：风格 / 情绪 / 场景（如「轻快明亮的电子配乐，适合 Vlog」）' },
        name: { type: 'string', description: '资产显示名' },
        model: { type: 'string', description: '音乐模型 id（models_list 查询，如 music-3.0 / fun-music-v1）' },
        providerInstanceId: { type: 'string', description: '提供商实例 id' },
        lyrics: { type: 'string', description: '歌词（纯音乐时省略；多段用 \\n 分隔，支持 [Intro]/[Verse]/[Chorus] 结构标签）' },
        instrumental: { type: 'boolean', description: '是否纯音乐（无歌词 / 人声），缺省 true' },
        outputDir: { type: 'string', description: '工程内相对输出目录（缺省 Cache/Music）' },
        folderId: { type: 'string', description: '资产库文件夹 id（folder_list 查询）' },
        extraParams: { type: 'object', description: '低频参数透传（如 audio_setting），合并进底层生成输入' }
      },
      required: ['prompt']
    },
    handler: async (args) => {
      assertProjectOpen()
      const inputText = readString(args, 'prompt')
      const input = {
        ...extraParamsOf(args),
        prompt: inputText,
        name: optionalString(args, 'name'),
        model: optionalString(args, 'model'),
        providerInstanceId: optionalString(args, 'providerInstanceId'),
        lyrics: optionalString(args, 'lyrics'),
        instrumental: typeof args.instrumental === 'boolean' ? args.instrumental : undefined,
        outputDir: optionalString(args, 'outputDir')
      }
      const result = await runGenActivity(
        'generate_music',
        activityTitle(input.name, inputText),
        input.model,
        () => modelProviderFacade.generateMusicAsset(input),
        (r) => ({ assetId: r.assetId, relativePath: liveAssetRelativePath(r) }),
        (r) => settleAssetFolder(r.assetId, optionalString(args, 'folderId')),
        (r) => ({
          kind: 'generateMusic',
          nodeId: 'mcp',
          request: {
            prompt: input.prompt,
            model: input.model,
            providerInstanceId: input.providerInstanceId,
            lyrics: input.lyrics,
            instrumental: input.instrumental,
            name: input.name
          },
          response: {
            model: r.model,
            assetId: r.assetId,
            relativePath: liveAssetRelativePath(r),
            durationMs: r.durationMs
          }
        })
      )
      broadcastAsset(result.assetId)
      return {
        assetId: result.assetId,
        relativePath: liveAssetRelativePath(result),
        model: result.model,
        durationMs: result.durationMs
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
      '用图片模型生成图片并落盘到工程缓存目录（缺省 Cache/Images，不自动进资产库，与视频一致；需要进资产库时用界面「保存到资产库」或显式指定 Assets/ 下的 outputDir）。需要已打开工程；模型 / 提供商缺省时用应用当前选择。返回文件相对路径。',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '画面描述' },
        name: { type: 'string', description: '文件显示名' },
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
        outputDir: {
          type: 'string',
          description: '工程内相对输出目录（缺省 Cache/Images，只落盘不登记资产；指定 Assets/ 下目录则同时登记为资产）'
        },
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
        (r) => settleAssetFolder(r.assetId, optionalString(args, 'folderId')),
        (r) => ({
          kind: 'generateImage',
          nodeId: 'mcp',
          request: {
            prompt: input.prompt,
            model: input.model,
            providerInstanceId: input.providerInstanceId,
            aspectRatio: input.aspectRatio,
            n: input.n,
            inputReferenceCount: input.inputReferences?.length || undefined,
            inputReferenceUrls: summarizeReferenceListForLog(input.inputReferences)
          },
          response: {
            model: r.model,
            assetId: r.assetId,
            relativePath: liveAssetRelativePath(r)
          }
        })
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
            '首帧图：支持 http(s) 地址、data URL、工程内相对路径或本地绝对路径；本地文件会经对象存储转远程 URL（未配置对象存储时报错，可用 storage_status 查询）。用户消息含多张参考图时，第一张为首帧'
        },
        lastFrameImageUrl: {
          type: 'string',
          description:
            '尾帧图：支持 http(s) 地址、data URL、工程内相对路径或本地绝对路径；本地文件会经对象存储转远程 URL（未配置对象存储时报错，可用 storage_status 查询）。用户消息含两张参考图生成视频时，第二张为尾帧'
        },
        outputDir: { type: 'string', description: '工程内相对输出目录（缺省 Cache/Videos）' },
        folderId: { type: 'string', description: '资产库文件夹 id（folder_list 查询）' },
        extraParams: { type: 'object', description: '低频参数透传（如 resolution / size / seed），合并进底层生成输入' }
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
        lastFrameImageUrl: optionalString(args, 'lastFrameImageUrl'),
        outputDir: optionalString(args, 'outputDir'),
        folderId: optionalString(args, 'folderId')
      }
      const result = await runGenActivity(
        'generate_video',
        activityTitle(input.name, input.prompt),
        input.model,
        () => modelProviderFacade.generateVideo(input),
        (r) => ({ assetId: r.assetId, relativePath: liveAssetRelativePath(r) }),
        (r) => settleAssetFolder(r.assetId, optionalString(args, 'folderId')),
        (r) => ({
          kind: 'generateVideo',
          nodeId: 'mcp',
          request: {
            prompt: input.prompt,
            model: input.model,
            providerInstanceId: input.providerInstanceId,
            duration: input.duration,
            aspectRatio: input.aspectRatio,
            generateAudio: input.generateAudio,
            firstFrameImageUrl: input.firstFrameImageUrl?.trim()
              ? summarizeMediaUrlForLog(input.firstFrameImageUrl)
              : undefined,
            lastFrameImageUrl: input.lastFrameImageUrl?.trim()
              ? summarizeMediaUrlForLog(input.lastFrameImageUrl)
              : undefined,
            uploads: r.uploads?.map((item) => ({
              sourceLabel: item.sourceLabel,
              objectKey: item.objectKey,
              bytes: item.bytes,
              urlPreview: item.url.slice(0, 120)
            }))
          },
          response: {
            model: r.model,
            assetId: r.assetId,
            relativePath: liveAssetRelativePath(r)
          }
        })
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
        (r) => settleAssetFolder(r.assetId, optionalString(args, 'folderId')),
        (r) => ({
          kind: 'generateModel3d',
          nodeId: 'mcp',
          request: {
            prompt: input.prompt,
            model: input.model,
            providerInstanceId: input.providerInstanceId,
            style: input.style,
            inputReferenceCount: input.inputReferences?.length || undefined,
            inputReferenceUrls: summarizeReferenceListForLog(input.inputReferences),
            uploads: r.uploads?.map((item) => ({
              sourceLabel: item.sourceLabel,
              objectKey: item.objectKey,
              bytes: item.bytes,
              urlPreview: item.url.slice(0, 120)
            }))
          },
          response: {
            model: r.model,
            assetId: r.assetId,
            relativePath: liveAssetRelativePath(r)
          }
        })
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
  assertFolderExists(folderId)
  const asset = projectService.listAssets().find((item) => item.id === assetId)
  if (asset) projectService.updateAsset({ ...asset, folderId })
}

/** 校验资产库文件夹 id 存在（不存在直接报错，避免资产落进无效目录） */
function assertFolderExists(folderId: string | null): void {
  if (!folderId) return
  const folders = projectService.listFolders()
  if (!folders.some((folder) => folder.id === folderId)) {
    throw new Error(`资产库文件夹不存在：${folderId}（用 folder_list 查询可用 id）`)
  }
}

function findAssetOrThrow(assetId: string): AssetInfo {
  const asset = projectService.listAssets().find((item) => item.id === assetId)
  if (!asset) throw new Error(`资产不存在：${assetId}（用 asset_list 查询可用 id）`)
  return asset
}

/** 读取字符串数组参数（去空值并去重）；非数组返回空数组 */
function readStringList(args: Record<string, unknown>, key: string): string[] {
  const value = args[key]
  if (!Array.isArray(value)) return []
  return [
    ...new Set(
      value
        .filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
        .map((item) => item.trim())
    )
  ]
}

/**
 * 资产规范质检 / 返工的公共入口：本进程只做资产存在性校验与参数整形，
 * 真正的逐像素判定与（可选）返工在渲染层跑——要解码整图，走渲染层作业通道往返。
 */
async function runAssetQcTool(args: Record<string, unknown>, fix: boolean): Promise<unknown> {
  assertProjectOpen()
  const assetId = optionalString(args, 'assetId')?.trim()
  const assetIds = readStringList(args, 'assetIds')
  if (!assetId && !assetIds.length) {
    throw new Error('请给出 assetId 或 assetIds（要体检的图片资产）')
  }
  if (assetId) findAssetOrThrow(assetId)
  return runRenderJob('asset-qc', {
    ...(assetId ? { assetId } : { assetIds }),
    naming: args.naming === true,
    ...(fix ? { fix: true } : {})
  })
}

/**
 * 时间线文档 → 导出输入。
 *
 * `timeline_export`（出片）与 `timeline_preview`（抽帧预览）共用这一份映射：
 * 预览必须带上与成片相同的画布尺寸、字幕字号/颜色、水印与倍速，否则就成了「预览看着对、导出不对」——
 * 预览的全部价值就在于它等于成片。
 */
function buildTimelineExportInput(
  doc: ScriptTimelineDocument,
  extra?: { defaultFileName?: string; targetPath?: string }
): TimelineExportInput {
  const settings = doc.settings ?? {}
  return {
    clips: doc.clips.map(toExportClip),
    durationSec: contentEndSecOfTimeline(doc.clips),
    ...(extra?.defaultFileName ? { defaultFileName: extra.defaultFileName } : {}),
    ...(extra?.targetPath ? { targetPath: extra.targetPath } : {}),
    ...(settings.playbackRate ? { playbackRate: settings.playbackRate } : {}),
    ...(settings.exportWidth ? { width: settings.exportWidth } : {}),
    ...(settings.exportHeight ? { height: settings.exportHeight } : {}),
    ...(settings.exportFps ? { fps: settings.exportFps } : {}),
    ...(settings.exportVideoBitrateKbps
      ? { videoBitrateKbps: settings.exportVideoBitrateKbps }
      : {}),
    ...(settings.subtitleFontSize ? { subtitleFontSize: settings.subtitleFontSize } : {}),
    ...(settings.subtitleColor ? { subtitleColor: settings.subtitleColor } : {}),
    ...(settings.watermarkEnabled && settings.watermarkSrc
      ? { watermarkSrc: settings.watermarkSrc }
      : {}),
    ...(doc.mutedTracks?.length ? { mutedTracks: doc.mutedTracks } : {})
  }
}

/** 抽帧规划的 note → 面向 Agent 的可读说明 */
function previewNoteText(note: TimelinePreviewNote): string {
  switch (note.code) {
    case 'empty-timeline':
      return '时间线内容时长为 0，没有可抽帧的画面'
    case 'invalid-timestamps-dropped':
      return `${note.count} 个时间点不是有限数字，已忽略`
    case 'timestamps-clamped':
      return `${note.count} 个时间点超出成片时长，已夹到片内（成片 ${note.durationSec.toFixed(2)} 秒）`
    case 'timestamps-truncated':
      return `一次最多抽 ${note.limit} 帧，已取前 ${note.limit} 个（共给了 ${note.requested} 个时间点）`
    case 'frame-count-clamped':
      return `抽帧数已从 ${note.requested} 夹到 ${note.applied}（可用范围 1~${MAX_PREVIEW_FRAMES}）`
    default:
      return ''
  }
}

/** 秒 → 成片时间码（m:ss.t），给返回结构里的人读字段 */
function formatTimelineSec(sec: number): string {
  const total = Math.max(0, sec)
  const minutes = Math.floor(total / 60)
  const seconds = total - minutes * 60
  return `${minutes}:${seconds.toFixed(1).padStart(4, '0')}`
}

/**
 * 工具结果里可携带的「给客户端看的图」：data URL 数组，固定放在 `mcpImages` 键上。
 *
 * 工具只管把图塞进这个键，转成 MCP image content 交给协议层（`mcpProtocol`）；
 * 这里把它摘出来，避免 base64 混进文本结果。纯文本客户端拿不到图，仍能从文本读到时间点与说明。
 */
const MCP_IMAGES_KEY = 'mcpImages'

function splitToolImages(result: unknown): { result: unknown; images: McpToolImage[] } {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return { result, images: [] }
  }
  const record = result as Record<string, unknown>
  const raw = record[MCP_IMAGES_KEY]
  if (!Array.isArray(raw) || !raw.length) return { result, images: [] }
  const images: McpToolImage[] = []
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const match = /^data:([^;,]+);base64,(.+)$/.exec(item)
    if (!match) continue
    images.push({ mimeType: match[1], data: match[2] })
  }
  const rest = { ...record }
  delete rest[MCP_IMAGES_KEY]
  return { result: rest, images }
}

/** 读剧本资产的时间线文档；资产不存在直接抛错 */
function readTimelineDoc(
  assetId: string,
  nodeId?: string
): { asset: AssetInfo; doc: ScriptTimelineDocument } {
  const asset = findAssetOrThrow(assetId)
  return { asset, doc: readScriptTimelineFromGenParams(asset.genParams, nodeId) }
}

/** 时间线片段 → 导出链路认识的片段（只挑导出用得到的字段） */
function toExportClip(clip: ScriptTimelineClip): TimelineExportClip {
  return {
    track: clip.track,
    title: clip.title,
    startSec: clip.startSec,
    durationSec: clip.durationSec,
    ...(clip.relativePath ? { relativePath: clip.relativePath } : {}),
    ...(clip.text ? { text: clip.text } : {}),
    ...(clip.sourceOffsetSec != null ? { sourceOffsetSec: clip.sourceOffsetSec } : {}),
    ...(clip.volume != null ? { volume: clip.volume } : {}),
    ...(clip.fadeInSec != null ? { fadeInSec: clip.fadeInSec } : {}),
    ...(clip.fadeOutSec != null ? { fadeOutSec: clip.fadeOutSec } : {}),
    ...(clip.overlayX != null ? { overlayX: clip.overlayX } : {}),
    ...(clip.overlayY != null ? { overlayY: clip.overlayY } : {}),
    ...(clip.overlayWidth != null ? { overlayWidth: clip.overlayWidth } : {}),
    ...(clip.overlayHeight != null ? { overlayHeight: clip.overlayHeight } : {}),
    ...(clip.opacity != null ? { opacity: clip.opacity } : {}),
    ...(clip.transitionInSec != null ? { transitionInSec: clip.transitionInSec } : {}),
    ...(clip.transitionOutSec != null ? { transitionOutSec: clip.transitionOutSec } : {}),
    ...(clip.transitionType ? { transitionType: clip.transitionType } : {})
  }
}

/** 粗剪 warning 码 → 面向 Agent 的可读说明 */
function roughCutWarningText(warning: TimelineRoughCutWarning): string {
  switch (warning.code) {
    case 'no-voice-clips':
      return '时间线上没有配音轨片段：粗剪的依据是配音转写，请先把配音铺到 voice 轨'
    case 'clip-without-speech':
      return `配音片段 ${warning.clipId ?? ''} 内没有匹配到转写分段，已整段保留（可能本就是纯音乐 / 环境音，或转写时间戳对不上）`
    case 'no-speech-detected':
      return '全部配音片段都没匹配到语音：转写结果可能为空，或 segments 的时间戳不属于该配音源文件'
    case 'nothing-to-cut':
      return '按当前阈值没有可剪的静默（这本来就很紧凑，或可以放宽 minSilenceSec）'
    default:
      return warning.code
  }
}

/** 读取转写分段（含文本）；缺字段直接报错，避免拿半个计划去剪时间线 / 生成字幕 */
function readSpeechSegments(value: unknown): TranscribeAudioSegment[] {
  if (!Array.isArray(value) || !value.length) {
    throw new Error(
      '缺少转写分段「segments」：请先用 transcribe_audio 转写配音资产，把它返回的 segments 原样传进来'
    )
  }
  return value.map((item, index) => {
    const row = (item ?? {}) as Record<string, unknown>
    const startSec = Number(row.startSec)
    const endSec = Number(row.endSec)
    if (!Number.isFinite(startSec) || !Number.isFinite(endSec)) {
      throw new Error(`第 ${index + 1} 个 segment 缺少合法的 startSec / endSec（秒）`)
    }
    return { startSec, endSec, text: typeof row.text === 'string' ? row.text : '' }
  })
}

/** 时间线编辑指令的类型名（`subtitles` 在主进程展开成区间替换 + 新增） */
const TIMELINE_EDIT_OPS = ['add', 'update', 'remove', 'subtitles'] as const

/** 主进程口径的片段 id 工厂：前缀带时间戳，同一批编辑内不重名 */
function mcpClipIdFactory(): (track: ScriptTimelineTrackKind, index: number) => string {
  const stamp = Date.now().toString(36)
  return (track, index) => `clip:${stamp}:${track}:${index}`
}

/**
 * 读取编辑指令行；op 不认识 / 不是对象直接报错。
 *
 * 与「单条失败只记 failure」的分工：这里是**调用方把 API 用错了**（必须整体重发），
 * 而 id 找不到、时长非法属于**数据问题**，交给共享层记 failure 继续跑其余的指令。
 */
function readTimelineEditRows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value) || !value.length) {
    throw new Error(
      '缺少编辑指令「operations」：至少给一条 { op: "add" | "update" | "remove" | "subtitles" }'
    )
  }
  return value.map((item, index) => {
    const label = `第 ${index + 1} 条 operation`
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`${label} 不是对象`)
    }
    const row = item as Record<string, unknown>
    const op = typeof row.op === 'string' ? row.op.trim() : ''
    if (!TIMELINE_EDIT_OPS.includes(op as (typeof TIMELINE_EDIT_OPS)[number])) {
      throw new Error(
        `${label} 的 op 不认识：${op || '(空)'}（可用 ${TIMELINE_EDIT_OPS.join(' / ')}）`
      )
    }
    return row
  })
}

/** 片段草稿：把 assetId 解析成工程内相对路径与标题（Agent 不必自己查路径） */
function resolveTimelineDraft(value: unknown, label: string): TimelineClipDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} 不是对象：需含 track 与 durationSec`)
  }
  const row = { ...(value as Record<string, unknown>) }
  const track = typeof row.track === 'string' ? row.track.trim() : ''
  if (!track) throw new Error(`${label} 缺少 track（video / overlay / voice / subtitle / music / sfx）`)
  const durationSec = Number(row.durationSec)
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new Error(`${label} 缺少合法的 durationSec（秒，需大于 0）`)
  }
  const assetId = typeof row.assetId === 'string' ? row.assetId.trim() : ''
  if (assetId) {
    const asset = findAssetOrThrow(assetId)
    if (!asset.relativePath) {
      throw new Error(`${label} 的资产「${asset.name}」没有媒体文件（数据型资产不能铺轨）`)
    }
    row.assetId = assetId
    row.relativePath = asset.relativePath
    if (typeof row.title !== 'string' || !row.title.trim()) row.title = asset.name
  }
  return row as unknown as TimelineClipDraft
}

/** 把指令行解析成共享层认识的编辑指令（资产引用解析 + 字幕展开成区间替换） */
function buildTimelineEditOperations(
  rows: Record<string, unknown>[],
  doc: ScriptTimelineDocument,
  makeClipId: (track: ScriptTimelineTrackKind, index: number) => string
): TimelineEditOperation[] {
  const operations: TimelineEditOperation[] = []
  rows.forEach((row, index) => {
    const label = `第 ${index + 1} 条 operation`
    if (row.op === 'add') {
      const clips = Array.isArray(row.clips) ? row.clips : []
      if (!clips.length) throw new Error(`${label}（add）缺少 clips 数组：至少给一枚要铺的片段`)
      const gapSec = Number(row.gapSec)
      operations.push({
        op: 'add',
        clips: clips.map((item, at) => resolveTimelineDraft(item, `${label} 第 ${at + 1} 枚片段`)),
        ...(Number.isFinite(gapSec) ? { gapSec: Math.max(0, gapSec) } : {})
      })
      return
    }
    if (row.op === 'update') {
      const clipId = typeof row.clipId === 'string' ? row.clipId.trim() : ''
      if (!clipId) throw new Error(`${label}（update）缺少 clipId（用 timeline_read 查片段 id）`)
      const patch = row.patch
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
        throw new Error(`${label}（update）缺少 patch 对象：把要改的字段放进去`)
      }
      operations.push({ op: 'update', clipId, patch: patch as TimelineClipPatch })
      return
    }
    if (row.op === 'remove') {
      const clipIds = readStringList(row, 'clipIds')
      if (!clipIds.length) throw new Error(`${label}（remove）缺少 clipIds 数组`)
      operations.push({ op: 'remove', clipIds })
      return
    }
    // subtitles：转写分段 → 字幕片段；replace 模式顺手替换与该配音区间重叠的旧字幕
    const voiceClipId = typeof row.voiceClipId === 'string' ? row.voiceClipId.trim() : ''
    if (!voiceClipId) {
      throw new Error(`${label}（subtitles）缺少 voiceClipId：先 timeline_read 看配音轨片段 id`)
    }
    const voice = doc.clips.find((clip) => clip.id === voiceClipId)
    if (!voice) throw new Error(`${label}（subtitles）配音片段不存在：${voiceClipId}`)
    if (voice.track !== 'voice') {
      throw new Error(`${label}（subtitles）片段 ${voiceClipId} 在 ${voice.track} 轨上，不是配音轨`)
    }
    const subtitleClips = buildSubtitleClipsFromTranscription(
      voice,
      readSpeechSegments(row.segments),
      (at) => makeClipId('subtitle', at)
    )
    if (!subtitleClips.length) {
      throw new Error(
        `${label}（subtitles）转写分段里没有可用文本，没有生成任何字幕（检查 segments 的 text 是否为空）`
      )
    }
    const drafts = subtitleClips.map((clip) => ({ ...clip }))
    if (row.mode === 'append') {
      operations.push({ op: 'add', clips: drafts })
      return
    }
    operations.push({
      op: 'replaceRange',
      track: 'subtitle',
      range: { startSec: voice.startSec, endSec: voice.startSec + voice.durationSec },
      clips: drafts
    })
  })
  return operations
}

/** 编辑失败码 → 面向 Agent 的可读说明 */
function timelineEditFailureText(failure: TimelineEditFailure): string {
  const target = failure.target ? `「${failure.target}」` : ''
  switch (failure.code) {
    case 'clip-not-found':
      return `${failure.op} ${target}：片段不在时间线上——粗剪会切分片段并改名（如 clip-1 → clip-1~2），重排后请重新 timeline_read 拿最新 id`
    case 'invalid-track':
      return `${failure.op} ${target}：轨道名不认识（可用 video / overlay / voice / subtitle / music / sfx）`
    case 'invalid-duration':
      return `${failure.op} ${target}：时长必须大于 0 秒`
    case 'empty-patch':
      return `${failure.op} ${target}：patch 里没有可识别的字段（id / track 不能改，换轨请 remove + add）`
    default:
      return `${failure.op} ${target}：${failure.code}`
  }
}

/**
 * 解析「工程内媒体文件」入参：优先 assetId（取其 relativePath），其次 relativePath。
 * 拒绝绝对路径与 `..` 越界，保证 MCP 不会读到工程根目录之外。
 */
function resolveProjectRelativePath(
  args: Record<string, unknown>,
  label: string
): { relativePath: string; assetId: string | null } {
  const assetId = optionalString(args, 'assetId') ?? null
  if (assetId) {
    const asset = findAssetOrThrow(assetId)
    const resolved = normalizeProjectRelativePath(asset.relativePath ?? '')
    if (!resolved) throw new Error(`资产「${asset.name}」还没有${label}文件（relativePath 为空）`)
    return { relativePath: resolved, assetId }
  }
  const raw = optionalString(args, 'relativePath')
  if (!raw) throw new Error(`缺少 assetId 或 relativePath（用于定位${label}文件，二选一）`)
  const resolved = normalizeProjectRelativePath(raw)
  if (!resolved) throw new Error('relativePath 必须是工程内相对路径（不接受绝对路径或 .. 越界）')
  return { relativePath: resolved, assetId: null }
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

async function readVoiceProfiles(): Promise<VoiceProfile[]> {
  try {
    const raw = await projectService.readProjectFile(VOICE_PROFILES_RELATIVE_PATH)
    return normalizeVoiceProfiles(raw ? JSON.parse(raw) : null)
  } catch {
    return []
  }
}

async function writeVoiceProfiles(profiles: VoiceProfile[]): Promise<void> {
  const ok = await projectService.writeProjectFile({
    relativePath: VOICE_PROFILES_RELATIVE_PATH,
    content: serializeVoiceProfiles(profiles)
  })
  if (!ok) throw new Error('角色音色档案写入失败')
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

/** mcpTaskId → 旁路活动 id：task_run 的产物路径随终态回报到达时据此收尾活动 */
const pendingMcpTaskActivities = new Map<string, string>()

/** MCP ask_user 的渲染层回报（用户选择 / 取消），ask_user 工具轮询这里 */
const pendingAskUserAnswers = new Map<string, AskUserAnswer>()

/**
 * 渲染层回传 MCP ask_user 的用户选择（requestId 以 mcp: 开头，经 main/ipc.ts 分发到本方法）。
 * 与 harness 侧原生 ask_user_question（harness: 前缀）走同一条 IPC 通道，按前缀分流。
 */
export function receiveAskUserAnswer(payload: AskUserAnswer): void {
  if (payload && typeof payload.requestId === 'string') {
    pendingAskUserAnswers.set(payload.requestId, {
      requestId: payload.requestId,
      answer: typeof payload.answer === 'string' ? payload.answer : null
    })
  }
}

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

/**
 * task_run 终态收尾：把渲染层回报的本轮产物写进旁路活动
 * （relativePath 供单产物消费方，relativePaths 供对话流出多张预览卡）。
 * 受理失败 / 停止等异常路径同样收尾，避免活动一直挂在「运行中」。
 */
function settleMcpTaskActivity(report: McpTaskReportPayload): void {
  const activityId = pendingMcpTaskActivities.get(report.mcpTaskId)
  if (!activityId) return
  pendingMcpTaskActivities.delete(report.mcpTaskId)
  const relativePaths = (report.relativePaths ?? []).filter(
    (path): path is string => typeof path === 'string' && !!path.trim()
  )
  const ok = report.phase === 'finished' && report.status === 'done'
  mcpActivityService.end(activityId, {
    ok,
    ...(relativePaths.length ? { relativePath: relativePaths[0], relativePaths } : {}),
    ...(report.error ? { error: report.error } : {})
  })
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

/**
 * MCP graph_icon_refine 的渲染层回报：精修要跑一次生图（数十秒级）并重跑打包节点，
 * 因此轮询预算远比 graph_edit 宽松（10 分钟），用 1s 间隔探测。
 */
const MCP_GRAPH_ICON_REFINE_TIMEOUT_MS = 10 * 60 * 1000
const MCP_GRAPH_ICON_REFINE_POLL_MS = 1000

const pendingMcpGraphIconRefineResults = new Map<string, McpGraphIconRefineResultPayload>()
const graphIconRefineResultCleanups = new Map<string, NodeJS.Timeout>()

function scheduleGraphIconRefineResultCleanup(requestId: string): void {
  const prev = graphIconRefineResultCleanups.get(requestId)
  if (prev) clearTimeout(prev)
  const timer = setTimeout(() => {
    pendingMcpGraphIconRefineResults.delete(requestId)
    graphIconRefineResultCleanups.delete(requestId)
  }, TASK_REPORT_RETENTION_MS)
  timer.unref?.()
  graphIconRefineResultCleanups.set(requestId, timer)
}

/** 渲染层能力作业：等待上限（导出类作业含像素拼装与多文件落盘，给足预算） */
const MCP_RENDER_JOB_TIMEOUT_MS = 5 * 60 * 1000
const MCP_RENDER_JOB_POLL_MS = 800

const pendingMcpRenderJobResults = new Map<string, McpRenderJobResultPayload>()
const renderJobResultCleanups = new Map<string, NodeJS.Timeout>()

function scheduleRenderJobResultCleanup(jobId: string): void {
  const prev = renderJobResultCleanups.get(jobId)
  if (prev) clearTimeout(prev)
  const timer = setTimeout(() => {
    pendingMcpRenderJobResults.delete(jobId)
    renderJobResultCleanups.delete(jobId)
  }, TASK_REPORT_RETENTION_MS)
  timer.unref?.()
  renderJobResultCleanups.set(jobId, timer)
}

/**
 * 派发一项渲染层能力作业并等结果（canvas 拼装 / 落盘在渲染层做，本进程只转发与超时）。
 *
 * 界面未响应（旧版界面 / 无窗口）时抛错而不是静默返回空结果——Agent 需要知道
 * 「这条能力当前用不了」，而不是拿到一个空壳成功。
 */
async function runRenderJob<T = unknown>(
  kind: McpRenderJobKind,
  args: Record<string, unknown>,
  timeoutMs = MCP_RENDER_JOB_TIMEOUT_MS
): Promise<T> {
  const jobId = randomUUID()
  pendingMcpRenderJobResults.delete(jobId)
  const payload: McpRenderJobPayload = { jobId, kind, args }
  broadcastToAllWindows(IpcChannels.MCP_RENDER_JOB, payload)
  try {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      await sleep(MCP_RENDER_JOB_POLL_MS)
      const report = pendingMcpRenderJobResults.get(jobId)
      if (!report) continue
      if (!report.ok) throw new Error(report.error ?? '渲染层作业失败')
      return report.result as T
    }
    throw new Error('渲染层未响应（请确认应用界面为最新版本）')
  } finally {
    pendingMcpRenderJobResults.delete(jobId)
  }
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
      // 工具把「要回给客户端看的图」放在 result.mcpImages 上：这里摘出来交给协议层转成 image content
      const outcome = splitToolImages((payload as { result?: unknown }).result ?? null)
      return {
        result: outcome.result,
        ...(outcome.images.length ? { images: outcome.images } : {})
      }
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
      if (payload.phase !== 'accepted') {
        settleMcpTaskActivity(payload)
        scheduleTaskReportCleanup(payload.mcpTaskId)
      }
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
  ipcMain.handle(
    IpcChannels.MCP_GRAPH_ICON_REFINE_RESULT,
    (_event, payload: McpGraphIconRefineResultPayload) => {
      if (payload && typeof payload.requestId === 'string') {
        pendingMcpGraphIconRefineResults.set(payload.requestId, payload)
        scheduleGraphIconRefineResultCleanup(payload.requestId)
      }
      return true
    }
  )
  ipcMain.handle(
    IpcChannels.MCP_RENDER_JOB_RESULT,
    (_event, payload: McpRenderJobResultPayload) => {
      if (payload && typeof payload.jobId === 'string') {
        pendingMcpRenderJobResults.set(payload.jobId, payload)
        scheduleRenderJobResultCleanup(payload.jobId)
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
  ipcMain.removeHandler(IpcChannels.MCP_GRAPH_ICON_REFINE_RESULT)
  ipcMain.removeHandler(IpcChannels.MCP_RENDER_JOB_RESULT)
  // 清理进行中请求的等待状态与终态回收 timer，避免 stop 后残留
  for (const timer of taskReportCleanups.values()) clearTimeout(timer)
  for (const timer of renderJobResultCleanups.values()) clearTimeout(timer)
  taskReportCleanups.clear()
  renderJobResultCleanups.clear()
  pendingMcpTaskReports.clear()
  pendingMcpTaskActivities.clear()
  pendingMcpGraphEditResults.clear()
  pendingMcpGraphIconRefineResults.clear()
  pendingMcpRenderJobResults.clear()
  pendingAskUserAnswers.clear()
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
  ipcMain.removeHandler(IpcChannels.MCP_GRAPH_ICON_REFINE_RESULT)
  ipcMain.removeHandler(IpcChannels.MCP_RENDER_JOB_RESULT)
  // 清理进行中请求的等待状态与终态回收 timer，避免 stop 后残留
  for (const timer of taskReportCleanups.values()) clearTimeout(timer)
  for (const timer of renderJobResultCleanups.values()) clearTimeout(timer)
  taskReportCleanups.clear()
  renderJobResultCleanups.clear()
  pendingMcpTaskReports.clear()
  pendingMcpTaskActivities.clear()
  pendingMcpGraphEditResults.clear()
  pendingMcpGraphIconRefineResults.clear()
  pendingMcpRenderJobResults.clear()
  pendingAskUserAnswers.clear()
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
