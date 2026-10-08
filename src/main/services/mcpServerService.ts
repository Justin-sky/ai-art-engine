import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  appendFileSync,
  renameSync,
  writeFileSync,
  rmSync
} from 'node:fs'
import { join } from 'node:path'
import { app, ipcMain } from 'electron'
import { AsyncSemaphore } from '@shared/asyncSemaphore'
import {
  BLENDER_MCP_PATH,
  blenderToolAccessOf,
  blenderToolDescriptors,
  blenderToolSpec
} from '@shared/blenderMcp'
import type { AssetInfo } from '@shared/domain'
import {
  denialReasonForTool,
  isToolVisible,
  MCP_MODE_HEADER,
  MCP_RUN_ID_HEADER,
  normalizeChatMode,
  toolAccessOf,
  type McpAccessView
} from '@shared/mcpModeAccess'
import {
  clearActiveHarnessRunState,
  resolveHarnessAwareAccessView,
  setActiveHarnessRunState
} from '@shared/harnessActiveRunAccess'
import {
  createMcpProtocolHandler,
  type McpRequestContext,
  type McpToolImage
} from '@shared/mcpProtocol'
import {
  buildDialogueInputs,
  dialogueSpeakers,
  normalizeDialogueVoiceMap,
  parseDialogueScript
} from '@shared/graph/dialogueScript'
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
import { planTimelineRoughCut, type TimelineRoughCutWarning } from '@shared/graph/timelineCut'
import {
  applyTimelineEdits,
  type TimelineClipDraft,
  type TimelineClipPatch,
  type TimelineEditFailure,
  type TimelineEditOperation
} from '@shared/graph/timelineEdit'
import {
  SVG_ANIM_DURATION_MAX,
  SVG_ANIM_FRAMES_MAX,
  SVG_ANIM_FRAMES_MIN,
  SVG_ANIM_SIZE_MAX,
  SVG_RASTER_DEFAULT_FRAMES,
  SVG_RASTER_MAX_IMAGES
} from '@shared/graph/svgAnim'
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
  type ChatMode,
  type CommitAiWorkflowInput,
  type CreateFolderInput,
  type CreateProjectInput,
  type McpGraphEditResultPayload,
  type McpGraphIconRefineResultPayload,
  type McpBlenderBridgeInfo,
  type McpBlenderRestartInput,
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
  assetImportActivityDetail,
  assetImportActivityTitle,
  isMcpCreatableAssetType,
  isProjectInternalPath,
  normalizeImportFilePaths,
  normalizeProjectRelativePath,
  normalizeStringList,
  projectGeneratedOutputImportError
} from '@shared/mcpAssetWrite'
import {
  getObjectStorageBucket,
  pickActiveObjectStorage,
  type ObjectStorageProviderInstance
} from '@shared/objectStorage'
import {
  type DecisionEvidenceItem,
  type GenerateDecisionsInput,
  type GenerateImageInput,
  type GenerateModel3dInput,
  type GenerateVideoInput,
  type GenerateSpatialWorldInput,
  type TranscribeAudioSegment
} from '@shared/modelProvider'
import { parseDecisionQuestions } from '@shared/decisionQuestion'
import { modelProviderFacade } from './modelProviders'
import {
  blenderAddonLink,
  blenderMcpEnabled,
  probeBlenderAddon,
  restartBlenderMcp,
  runBlenderTool,
  stopBlenderMcp
} from './blenderMcpService'
import {
  normalizeExternalMcpServer,
  externalMcpIdFromPath,
  namespaceExternalMcpTool,
  stripExternalMcpToolPrefix,
  type ExternalMcpServer
} from '@shared/externalMcp'
import {
  closeAllExternalMcpSessions,
  dropExternalMcpSession,
  getExternalMcpSession
} from './externalMcpClient'
import { mcpActivityService } from './mcpActivityService'
import { broadcastToAllWindows } from '../broadcast'
import { SHARED_ERRORS } from '@shared/errors/catalog'
import { fail } from '@shared/errors/appError'
import { splitPrimaryAndRelated } from '@shared/outputScan'
import type {
  ExportWorldInput,
  Model3dConvertFormat,
  Model3dPostProcessInput,
  Model3dPostProcessOp,
  Model3dPostProcessResult,
  SpatialWorldExportAssetType,
  SpatialWorldExportMeshVariant,
  SpatialWorldExportResolution
} from '@shared/modelProvider'
import { commitAiWorkflow, planAiWorkflow } from './graphPlanService'
import { listInstalledWorkflowDetails, readInstalledWorkflowPlan } from './workflowMarketService'
import { projectService } from './projectService'
import { assetPackageService } from './assetPackageService'
import { uploadProjectMedia } from './objectStorageUploadService'
import { settingsService } from './settingsService'
import { updateService } from './updateService'
import { videoJobService } from './videoJobService'
import {
  getGamePlayJob,
  getGamePlayJobByProjectDir,
  listGamePlayJobs,
  prepareGamePlayProject,
  setGamePlayJobAsset,
  startGamePlayBuild
} from './gamePlayJobService'
import {
  findGamePlayAssetByProject,
  gamePlayAssetGenParams,
  gamePlayAssetName
} from '@shared/gamePlayJob'
import { defaultAssetName } from '@shared/domain'
import { exportScriptTimeline, renderTimelineFrames } from './timelineExportService'
import {
  isScreenRecording,
  patchScreenRecordingHud,
  screenRecordingStatus,
  setScreenRecordFinishListener,
  startScreenRecording,
  stepScreenRecording,
  stopScreenRecording
} from './screenRecordService'
import {
  SCREEN_RECORD_LIMITS,
  type ScreenRecordCursor,
  type ScreenRecordFocus,
  type StepAlignment
} from '@shared/screenRecord'
import { composeTutorialVideo } from './tutorialComposeService'
import {
  clickTutorialUi,
  fillTutorialUi,
  queryGraphIsRunning,
  queryTutorialUiBounds
} from './tutorialUiService'
import { TUTORIAL_POST_DBLCLICK_FOCUS_IDS, TUTORIAL_UI_ID_HINT } from '@shared/tutorialUi'

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
 * <userData>/mcp.json，由**持有监听 socket 的主实例**在绑定成功后写（port 取 socket 实际端口、
 * pid 为该进程），应用退出时保留——外部客户端（scripts/mcp-bridge.mjs / HTTP 直连）只认这个文件，
 * 所以文件里的地址必须是既成事实，不能是"打算用的端口"。
 */

const MCP_DEFAULT_PORT = 43110
const MCP_PORT_RANGE = 10
const MCP_BODY_LIMIT = 8 * 1024 * 1024
/** 生成并发闸门：同步生成调用同时上限与排队上限（环境变量可覆盖） */
const MCP_GEN_LIMIT = Number(process.env.AIAE_MCP_GEN_LIMIT) || 3
/** 审计日志单文件上限（超过滚动为 .1） */
const MCP_AUDIT_MAX_BYTES = 5 * 1024 * 1024
/** 纳入并发闸门的工具（同步等待的耗时生成/规划） */
const GATED_TOOLS = new Set([
  'generate_image',
  'generate_speech',
  'generate_dialogue',
  'generate_sound_effect',
  'generate_music',
  'generate_world',
  'export_spatial_world',
  'rig_model3d',
  'segment_model3d',
  'post_process_model3d',
  'decide',
  'workflow_plan',
  'tutorial_compose'
])

/**
 * 3D 加工的全部 op（与 `Model3dPostProcessOp` 同集合）。
 *
 * 这里显式列一份而不是从类型反推：`op` 是**必填字符串**，进来的是不可信的模型输出，
 * 不在白名单时给一条能读懂的错误（列出可选值），比让 facade 走到深处再报错好得多。
 */
const POST_PROCESS_OPS: readonly Model3dPostProcessOp[] = [
  'rigCheck',
  'retopology',
  'meshComplete',
  'retarget',
  'convert',
  'texture'
] as const

/** 格式转换的目标格式（与 `Model3dConvertFormat` 同集合） */
const MODEL3D_CONVERT_FORMATS: readonly Model3dConvertFormat[] = [
  'GLTF',
  'FBX',
  'USDZ',
  'OBJ',
  'STL',
  '3MF'
] as const

/**
 * 一次最多回给客户端几张视频帧。
 *
 * 帧是以 base64 内联进**单次响应**的，几 MB 的 data URL 会挤爆上下文；
 * 而且这些帧只是给 agent "看一眼"，不是交付物（要交付就走 `extract_video_frames` 落盘）。
 * 超出的部分丢弃并明确告知 —— 静默截断会让 agent 以为看到的就是全部。
 */
const VIDEO_FRAME_MAX_IMAGES = 6

/** 抽帧数量的上限（均匀抽帧会逐帧跑 ffmpeg，给太大等于让用户干等） */
const VIDEO_FRAME_EXTRACT_MAX = 24

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
 * describe 可回报多件产物（relativePaths）：会话流按清单逐条出资产卡（导入等批量场景）。
 * detail 是运行中补充说明，供无 model 可展示的活动代替副标题（如导入的首个文件名）。
 */
async function runGenActivity<T>(
  tool: import('@shared/ipc').McpActivityTool,
  title: string,
  model: string | undefined,
  fn: () => Promise<T>,
  describe: (result: T) => {
    assetId?: string
    relativePath?: string
    /** 一次调用产出多件产物时的完整清单（relativePath 取首条，兼容单产物消费方） */
    relativePaths?: string[]
    /** 与主产物同批、折叠进同一张卡的附件（如世界随包返回的泼溅 / 全景） */
    relatedPaths?: string[]
  },
  settle?: (result: T) => void | Promise<void>,
  apiCall?: (result: T) => Omit<GraphRunLogApiCall, 'id' | 'ts'> | undefined,
  detail?: string
): Promise<T> {
  const activityId = mcpActivityService.begin({ tool, title, model, detail })
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
 * 取资产最新的相对路径：资产可能在生成后被搬移过（如用户在资产库改文件夹），
 * 活动终态 / 工具返回值都必须用最终路径，否则界面预览会指向失效文件。
 */
function liveAssetRelativePath(result: {
  assetId?: string
  relativePath?: string
}): string | undefined {
  if (!result.assetId) return result.relativePath
  const live = projectService.listAssets().find((item) => item.id === result.assetId)
  return live?.relativePath || result.relativePath
}

/**
 * 可玩 HTML cook 成功后登记 / 更新 gamePlay 资产。
 *
 * 为什么要建资产：工程与单文件都落在 `Cache/GamePlayJobs/**`，没有资产就等于「关掉这条对话
 * 就找不回这个游戏」。去重键是工程目录——对话里「再暗一点」会反复 build，每次都新建资产
 * 会把资产库刷爆，所以同一个工程只更新同一条资产的 genParams。
 */
function ensureGamePlayAsset(input: {
  projectRelativeDir: string
  title?: string
  mode: string
  buildHtmlRelativePath: string
}): string {
  const genParams = gamePlayAssetGenParams({
    projectRelativeDir: input.projectRelativeDir,
    buildHtmlRelativePath: input.buildHtmlRelativePath,
    mode: input.mode === '2d' || input.mode === '3d' ? input.mode : 'auto'
  })
  const assets = projectService.listAssets()
  const existing = findGamePlayAssetByProject(assets, input.projectRelativeDir)
  if (existing) {
    const next = projectService.updateAsset({
      ...existing,
      genParams: { ...(existing.genParams ?? {}), ...genParams }
    })
    broadcastToAllWindows(IpcChannels.ASSET_UPDATED, next)
    return next.id
  }
  const jobId = input.projectRelativeDir.split('/').slice(-2)[0] ?? ''
  const asset = projectService.createAsset({
    type: 'gamePlay',
    name: gamePlayAssetName(
      input.title,
      jobId,
      defaultAssetName('gamePlay', settingsService.get().language)
    ),
    genParams
  })
  broadcastToAllWindows(IpcChannels.ASSET_UPDATED, asset)
  return asset.id
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
          description:
            '记忆分类：style（风格）/ camera（机位与镜头）/ character（角色一致性）/ other（其它）'
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
    description:
      '把正文写回剧本（screenplay）资产的旁挂文本文件，应用界面会同步刷新。仅支持剧本资产：策划案（gameSystem）等无旁挂文件的文本资产没有独立正文文件，其正文存于资产图文档中——要写入 Agent 撰写的 Markdown 底稿，请用 graph_edit 对该资产的 asset.gameSystem 节点做 node_update，把正文写入 params.text（持久化并同步界面，下游节点优先读取该参数）。',
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
    name: 'folder_move',
    title: '移动文件夹',
    description:
      '把文件夹移动到另一父目录（省略/传 null newParentId 表示移到资产库根目录）。新父目录不能是 folderId 自身，也不能是其任意子孙——子目录里的资产会随父目录一起搬移，磁盘上的目录与子孙 .asset.json 的 relativePath 都会更新。同名冲突会自动追加 " 2" / " 3" 后缀。',
    inputSchema: {
      type: 'object',
      properties: {
        folderId: { type: 'string', description: '要移动的文件夹 id' },
        newParentId: {
          type: 'string',
          description: '目标父目录 id；省略/传 null 表示移到资产库根目录'
        }
      },
      required: ['folderId']
    },
    handler: async (args) => {
      assertProjectOpen()
      const folderId = readString(args, 'folderId')
      const newParentId = optionalString(args, 'newParentId') ?? null
      assertFolderExists(newParentId)
      const updated = await projectService.moveFolder(folderId, newParentId)
      // 搬移会同时改动子孙目录与其中资产的相对路径：广播目录变化让界面
      // 立刻重扫（与 folder_create 一致），否则旧位置的目录树节点会残留。
      broadcastToAllWindows(IpcChannels.FOLDERS_UPDATED, null)
      return {
        folderId: updated.id,
        name: updated.name,
        parentId: updated.parentId ?? null
      }
    }
  },
  {
    name: 'asset_create',
    title: '新建资产',
    description:
      '在资产库新建一个资产，返回资产 id，应用界面同步出现。支持类型：screenplay 剧本 / gameSystem 策划案 / world 世界观 / beat 分镜 / subgraph 子图 / canvas 自由画布 / image 图片 / video 视频 / voice 声音 / motion2d 2D 动作。**可玩 HTML（gamePlay）不在其中**：游戏请直接走 gameplay_prepare_project → 写 src/** → gameplay_build，构建成功会自动登记资产，手工建空壳没有意义。',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: '资产类型（见工具描述白名单）' },
        name: { type: 'string', description: '资产名称（可选，缺省按类型自动命名）' },
        folderId: {
          type: 'string',
          description: '目标资产库文件夹 id（可选，缺省放资产库根目录）'
        },
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
      '把本机绝对路径上的媒体文件先收入工程的临时缓存 `Cache/imports/`（图片（含 PSD / SVG 矢量图）/ 视频 / 音频 / 3D 模型 / 剧本文本，按扩展名判定类型），不直接入库。导入结果以「素材导入」活动逐条回报工程内相对路径，对话流随即出产物卡并附带「保存到资产库」按钮——是否真正入 `Assets/<folder>/` 由用户在弹窗里挑文件夹、命名并点确认决定。只有用户点过保存的素材才会被资产库收录、并出现在 `asset_list` 等查询里。**只收编工程外的本机素材**：工程内任意路径（含 `Assets/`、`Cache/`、`Output/`）整单拒绝；生成产物要入库继续走对话产物卡上的「保存到资产库」。',
    inputSchema: {
      type: 'object',
      properties: {
        filePaths: {
          type: 'array',
          items: { type: 'string' },
          description: `本机绝对路径列表（最多 ${MCP_ASSET_IMPORT_LIMIT} 条）`
        }
      },
      required: ['filePaths']
    },
    handler: async (args) => {
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
      // 工程内任意路径（含 Assets/、Cache/、Output/）一律拒。
      // 此前这条仅防「Cache/Output 反复入 Assets/ 造成重复资产」，现在目的更广：
      // 既然素材不再自动入库、Cache/imports/ 也是工程内路径，重新导入同一份已缓存的
      // 文件只会再造一份磁盘拷贝（且无法被 ChatPanel 旧的「保存到资产库」按钮命中）。
      const internalPaths = filePaths.filter((filePath) =>
        isProjectInternalPath(
          filePath,
          projectService.getRoot(),
          projectService.getConfig().cacheOutputDir
        )
      )
      if (internalPaths.length) {
        throw new Error(projectGeneratedOutputImportError(internalPaths))
      }
      // 登记为界面可见的 MCP 活动：导入此前只进资产库、不进会话流，Agent 导入的 SVG / 图片
      // 在对话里没有任何产物卡（文件确实进了工程，用户却以为这一步没发生）；现按导入结果
      // 逐条回报工程内相对路径，对话流随即出产物卡，并附带「保存到资产库」按钮让用户拍板。
      const result = await runGenActivity(
        'asset_import',
        assetImportActivityTitle(filePaths.length),
        undefined,
        async () => projectService.importExternalMaterials(filePaths),
        (r) => {
          const relativePaths = r.imported
            .map((item) => item.relativePath)
            .filter((path): path is string => !!path?.trim())
          return {
            relativePath: relativePaths[0],
            relativePaths
          }
        },
        undefined,
        undefined,
        assetImportActivityDetail(filePaths)
      )
      return {
        imported: result.imported.map((item) => ({
          relativePath: item.relativePath,
          basename: item.basename
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
      // 同时携带 id 与目标路径：订阅方可按 id 关编辑器、按 path 让对话产物卡
      // 上的「已保存」状态回退（见 shared/ipc.ts ASSET_REMOVED）。
      broadcastToAllWindows(IpcChannels.ASSET_REMOVED, {
        id: assetId,
        path: asset.relativePath
      })
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
        includeGeneratedOutputs: {
          type: 'boolean',
          description: '是否一并打包生成缓存（默认 false）'
        }
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
        apply: {
          type: 'boolean',
          description: '是否把计划写回时间线（默认 false，只回计划不落盘）'
        }
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
                description:
                  'subtitles：replace（默认，替换该配音区间上的旧字幕）或 append（直接追加）'
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
        const reason = plan.notes.map(previewNoteText).filter(Boolean).join('；')
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
    name: 'render_svg',
    title: '渲染 SVG 看画面',
    description:
      '把矢量源（内联 SVG 标记，或工程内的 .svg 文件）用应用自己的引擎栅格化成画面直接回给你看：静态 SVG 出一帧，带动画的按动效时间轴逐帧烘焙，画面随本次响应回给客户端。全程不需要浏览器——沙箱里禁止起本机浏览器（受限令牌下 Chromium 建不出自己的 IPC 管道，会崩在 0x80000003 并弹出系统模态框挡住用户），所以矢量 / HTML 产物的视觉自查请用这个工具，不要用 msedge / chrome 截图。默认只回前 ' +
      `${SVG_RASTER_MAX_IMAGES} 帧。不落盘、只回画面：要产出可入库的 PNG / GIF 请走图的 svg.gen → svg.anim 出图。仅在应用界面打开时可用。`,
    inputSchema: {
      type: 'object',
      properties: {
        svg: { type: 'string', description: '内联 SVG 标记（与 svgPath 二选一）' },
        svgPath: {
          type: 'string',
          description: '工程内相对路径的 .svg 文件（如 Assets/Vector/hero.svg；与 svg 二选一）'
        },
        frames: {
          type: 'number',
          description: `动画取样帧数（${SVG_ANIM_FRAMES_MIN}~${SVG_ANIM_FRAMES_MAX}，默认 ${SVG_RASTER_DEFAULT_FRAMES}）；SVG 里没有可求值动画时忽略，只出一帧`
        },
        durationSec: {
          type: 'number',
          description: `取样时长（秒，上限 ${SVG_ANIM_DURATION_MAX}）；缺省 0 = 自动探测 SVG 自身动画周期`
        },
        width: {
          type: 'number',
          description: `目标像素宽（上限 ${SVG_ANIM_SIZE_MAX}；缺省跟随 SVG 自身尺寸）`
        },
        height: {
          type: 'number',
          description: `目标像素高（上限 ${SVG_ANIM_SIZE_MAX}；缺省跟随 SVG 自身尺寸）`
        },
        background: {
          type: 'string',
          enum: ['', 'white', 'black'],
          description: '背景填充：白 / 黑 / 透明（缺省透明）'
        }
      }
    },
    handler: async (args) => {
      assertProjectOpen()
      const svg = optionalString(args, 'svg')
      const svgPath = optionalString(args, 'svgPath')?.trim()
      const hasInline = Boolean(svg && svg.trim())
      if (hasInline === Boolean(svgPath)) {
        throw new Error('svg 与 svgPath 二选一：内联 SVG 标记，或工程内相对路径')
      }
      return runRenderJob('svg-raster', {
        ...(hasInline ? { svg } : {}),
        ...(svgPath ? { svgPath } : {}),
        ...(args.frames !== undefined ? { frames: args.frames } : {}),
        ...(args.durationSec !== undefined ? { durationSec: args.durationSec } : {}),
        ...(args.width !== undefined ? { width: args.width } : {}),
        ...(args.height !== undefined ? { height: args.height } : {}),
        ...(args.background !== undefined ? { background: args.background } : {})
      })
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
      '把一张 GraphPlan 落盘为工程内的宿主资产（应用界面会同步出现该资产）。plan 可来自 workflow_plan，也可直接手写（跳过规划，少一次调用）；节点 params 会按目标节点类型声明的键校验，未声明的键被忽略并出现在返回的 warnings 里，不会静默丢弃。返回资产 id 与 warnings。',
    inputSchema: {
      type: 'object',
      properties: {
        plan: {
          type: 'object',
          description:
            'GraphPlan：{ title?, nodes: [{ key, typeId, title?, params? }], edges: [{ from, to, fromPort?, toPort? }] }'
        },
        name: { type: 'string', description: '资产显示名，缺省用计划标题' },
        generateAspectRatio: { type: 'string', description: '统一宽高比，如 9:16' },
        imageModel: {
          type: 'string',
          description: '图片模型 id：写入计划中未指定 generateModel 的图片生成/高清放大节点'
        },
        imageProviderInstanceId: {
          type: 'string',
          description: '图片模型所属提供商实例 id，可选（自定义提供商模型需要）'
        },
        videoModel: {
          type: 'string',
          description: '视频模型 id：写入计划中未指定 generateModel 的视频生成节点'
        },
        videoProviderInstanceId: {
          type: 'string',
          description: '视频模型所属提供商实例 id，可选（自定义提供商模型需要）'
        },
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
        imageModel: optionalString(args, 'imageModel'),
        imageProviderInstanceId: optionalString(args, 'imageProviderInstanceId'),
        videoModel: optionalString(args, 'videoModel'),
        videoProviderInstanceId: optionalString(args, 'videoProviderInstanceId'),
        folderId: optionalString(args, 'folderId')
      }
      const result = await commitAiWorkflow(input)
      if (!result.ok || !result.assetId) {
        throw new Error(result.error ?? '无法落盘工作流')
      }
      const asset = projectService.listAssets().find((item) => item.id === result.assetId)
      if (asset) {
        broadcastToAllWindows(IpcChannels.ASSET_UPDATED, asset)
        broadcastToAllWindows(IpcChannels.MCP_WORKFLOW_FOCUS, { assetId: result.assetId })
      }
      return {
        assetId: result.assetId,
        name: asset?.name ?? input.name ?? null,
        warnings: result.warnings
      }
    }
  },
  {
    name: 'workflow_list_installed',
    title: '已安装工作流列表',
    description:
      '列出用户从市场安装到本机的工作流（id 与标题、简介、节点数），可作为 workflow_use_installed 的 id。与 workflow_list_presets 的区别：presets 是应用内置的行业模板，这里是用户自己装的内容。',
    inputSchema: { type: 'object', properties: {} },
    handler: () =>
      listInstalledWorkflowDetails().map((item) => ({
        id: item.id,
        title: item.title,
        summary: item.summary,
        version: item.version,
        nodeCount: item.nodeCount,
        edgeCount: item.edgeCount,
        /** 包损坏时明确标出，调用方不该把它当成可用内容 */
        broken: item.broken
      }))
  },
  {
    name: 'workflow_use_installed',
    title: '使用已安装工作流',
    description:
      '把一条**已安装的工作流**按它自带的节点图原样落盘为工程内的宿主资产。id 来自 workflow_list_installed。这条路径不调用文本模型（拓扑已固化），因此快且结果确定 —— 想复现用户装的那条工作流就用它，而不是用 workflow_plan 重新规划。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '已安装工作流的 id（workflow_list_installed 返回）' },
        name: { type: 'string', description: '资产显示名，缺省用工作流标题' },
        generateAspectRatio: { type: 'string', description: '统一宽高比，如 9:16' },
        imageModel: { type: 'string', description: '图片模型 id（覆盖计划中未指定的图片节点）' },
        videoModel: { type: 'string', description: '视频模型 id（覆盖计划中未指定的视频节点）' },
        folderId: { type: 'string', description: '资产库文件夹 id（folder_list 查询）' }
      },
      required: ['id']
    },
    handler: async (args, ctx) => {
      assertProjectOpen()
      const id = readString(args, 'id')
      const installed = readInstalledWorkflowPlan(id)
      if (!installed.ok || !installed.bundle) {
        throw new Error(`无法读取已安装工作流「${id}」：${installed.reasonKey ?? 'unknown'}`)
      }
      /**
       * 用 `useSeedOnly` + `seedPlan` 走既有落盘链路：与市场窗口的「使用」是同一条路径，
       * 因此参数白名单、warnings 语义完全一致 —— 不另造一套物化逻辑。
       */
      const planned = await planAiWorkflow(
        {
          prompt: installed.bundle.summary,
          seedPlan: installed.bundle.plan as PlanAiWorkflowInput['seedPlan'],
          useSeedOnly: true,
          generateAspectRatio: optionalString(args, 'generateAspectRatio'),
          imageModel: optionalString(args, 'imageModel'),
          videoModel: optionalString(args, 'videoModel')
        },
        { signal: ctx?.signal }
      )
      if (!planned.ok || !planned.plan) {
        throw new Error(planned.error ?? '无法生成工作流计划')
      }
      const result = await commitAiWorkflow({
        plan: planned.plan,
        name: optionalString(args, 'name') ?? installed.bundle.title,
        generateAspectRatio: optionalString(args, 'generateAspectRatio'),
        imageModel: optionalString(args, 'imageModel'),
        videoModel: optionalString(args, 'videoModel'),
        folderId: optionalString(args, 'folderId')
      })
      if (!result.ok || !result.assetId) {
        throw new Error(result.error ?? '无法落盘工作流')
      }
      const asset = projectService.listAssets().find((item) => item.id === result.assetId)
      if (asset) {
        broadcastToAllWindows(IpcChannels.ASSET_UPDATED, asset)
        broadcastToAllWindows(IpcChannels.MCP_WORKFLOW_FOCUS, { assetId: result.assetId })
      }
      return {
        assetId: result.assetId,
        name: asset?.name ?? installed.bundle.title,
        sourceWorkflowId: installed.bundle.id,
        warnings: result.warnings
      }
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
    name: 'gameplay_prepare_project',
    title: '准备可玩 HTML 工程',
    description:
      '为一句话小游戏落下宿主脚手架（纯 Node + esbuild 工程：package.json / build.mjs / index.template.html / src/core/{rng,palette,registry}.js / src/assets/** 骨架 / src/main.js 样例），返回 projectRelativeDir —— 之后用你自己的文件工具写 src/**（程序化生成几何 / 贴图 / 材质 / 音效 / 关卡），再调 gameplay_build。' +
      '传了 projectRelativeDir 则在既有工程上续写（保留你已写的代码）。**不要自己跑 npm 或 build.mjs**：cook 由宿主执行。' +
      '细节约定（资产层结构、硬规则、配方）见技能 gameplay-proc-assets。',
    inputSchema: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: ['2d', '3d', 'auto'],
          description:
            '2d = 只用 Canvas 2D；3d = three 依赖与 3D 样例；auto = 按玩法自选（脚手架按 2D 起）'
        },
        projectRelativeDir: {
          type: 'string',
          description:
            '可选：已有工程相对路径（如 Cache/GamePlayJobs/<id>/project），用于续写而不是新建'
        },
        title: { type: 'string', description: '游戏名（可选，用于资产命名与产物卡标题）' }
      }
    },
    handler: (args) => {
      assertProjectOpen()
      return prepareGamePlayProject({
        mode: optionalString(args, 'mode'),
        projectRelativeDir: optionalString(args, 'projectRelativeDir'),
        title: optionalString(args, 'title')
      })
    }
  },
  {
    name: 'gameplay_build',
    title: '构建可玩 HTML',
    description:
      '在后台 cook 一个可玩 HTML 工程：npm install + node build.mjs，把 src/main.js 打成单文件 dist/single.html。' +
      '立即返回 jobId（构建要几十秒到几分钟），用 gameplay_job_status 轮询到 done；成功后对话流会出现一张卡，卡上「试玩」按钮用系统默认程序（通常是浏览器）打开游戏，' +
      '若产物不是自包含（用了 ES 模块或相对引用）则自动退回应用内试玩窗口；同时自动在资产库登记一个 gamePlay 资产（同一工程重复 build 只更新它，不会多出重复资产）。' +
      '**构建成功后会跑一次试玩门禁**（隐藏窗口真跑几秒）：结论在 gameplay_job_status 的 smoke 字段里——`smoke.ok === false` 时先按 smoke.errors 改代码再重建一次，不要急着交付。',
    inputSchema: {
      type: 'object',
      properties: {
        projectRelativeDir: {
          type: 'string',
          description: '工程相对路径（gameplay_prepare_project 返回）'
        },
        title: { type: 'string', description: '游戏名（可选，用于资产命名与产物卡标题）' }
      },
      required: ['projectRelativeDir']
    },
    handler: (args) => {
      assertProjectOpen()
      const projectRelativeDir = readString(args, 'projectRelativeDir')
      const title = optionalString(args, 'title')
      const before = getGamePlayJobByProjectDir(projectRelativeDir)
      const activityId = mcpActivityService.begin({
        tool: 'gameplay_build',
        title: title || before?.title || projectRelativeDir.split('/').slice(-2)[0] || 'gamePlay',
        detail: 'npm install + node build.mjs…'
      })
      const snapshot = startGamePlayBuild({
        projectRelativeDir,
        title,
        onSettled: (job) => {
          if (job.status === 'done' && job.buildHtmlRelativePath) {
            const assetId = ensureGamePlayAsset({
              projectRelativeDir: job.projectRelativeDir,
              title: job.title,
              mode: job.mode,
              buildHtmlRelativePath: job.buildHtmlRelativePath
            })
            setGamePlayJobAsset(job.jobId, assetId)
            mcpActivityService.end(activityId, {
              ok: true,
              assetId,
              relativePaths: [job.buildHtmlRelativePath]
            })
            return
          }
          mcpActivityService.end(activityId, {
            ok: false,
            error: job.error || 'build failed'
          })
        }
      })
      return { ...snapshot, title: snapshot.title ?? title ?? null }
    }
  },
  {
    name: 'gameplay_job_status',
    title: '可玩 HTML 作业状态',
    description:
      '查询可玩 HTML 作业状态（ready / building / done / error）、日志尾部、单文件产物路径与体积，以及**试玩门禁报告** `smoke`。' +
      'smoke 是隐藏窗口真跑几秒后的体检：status（pass / warn / fail）、ok、errors（未捕获异常 / 加载失败 / 渲染进程崩溃 / 黑屏 / 一帧都没渲染）、' +
      'warnings（画面静止等需人判断的情况）、metrics（采到的帧数 / 去重帧数 / 亮度区间）。**smoke.ok === false 时应按 errors 修代码并重新 build**，而不是直接交付。' +
      '不传 jobId 时列出本次会话的全部作业。构建失败时看 error 与 logs 定位（npm 缺失 / 语法错误 / 体积超限）。',
    inputSchema: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: 'gameplay_build 返回的 jobId；省略则列出全部作业' }
      }
    },
    handler: (args) => {
      const jobId = optionalString(args, 'jobId')
      if (!jobId) return { jobs: listGamePlayJobs() }
      const job = getGamePlayJob(jobId)
      if (!job)
        throw new Error('作业不存在（应用重启后内存记录会清空，磁盘工程仍在 Cache/GamePlayJobs）')
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
        assetId: {
          type: 'string',
          description: '宿主资产 id（asset_list 或 workflow_commit 返回）'
        }
      },
      required: ['assetId']
    },
    handler: async (args) => {
      assertProjectOpen()
      const assetId = readString(args, 'assetId')
      const asset = projectService.listAssets().find((item) => item.id === assetId)
      const graphJson = (asset?.genParams as Record<string, unknown> | undefined)?.graphJson as
        GraphDocument | undefined
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
    description:
      '查询 task_run 返回的 mcpTaskId 当前执行状态（running / done / error / stopped）。',
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
      '列出能被 graph_edit 添加到宿主资产子图的节点类型（与 graph_edit 的 node_upsert 校验同一白名单，含 2D 舞台 / 宫格切分 / 图标包等新节点）：typeId、名称、分类、端口（连线时 fromPort / toPort 用的 id）与可选默认参数。用于外部 Agent 自发现可建节点，避免用猜的 typeId 被 graph_edit 跳过。需要 2D 帧动画 / GIF 动图时查 `anim.2d`：一张按行列分格的序列图（sprite sheet）从 in 端口接入，按 animRows / animCols 逐格切成帧 PNG；animGifFps（1–24，默认 0 = 只切帧）> 0 时额外经 out-gif 端口产出 GIF 动图并落盘为工程资产；动作预设与自定义描述见 animPresetId / animInstruction。只读操作，无需打开工程。需要 SVG 矢量图 / 矢量动画（不是位图）时查 `svg.gen` 与 `svg.anim`：`svg.gen` 用文本模型把描述画成 SVG 源码并落盘为工程 .svg 资产（in 接文本指令、in-image 接参考图照图生矢量，自带 SVG 系统提示词）；要帧序列 / GIF 就把它接到 `svg.anim` 的 in 端口（端口类型 svg）烘焙：含 SMIL 动效出多帧 PNG（out / out-all）+ GIF（out-gif），静态 SVG 只出 1 帧、不产 GIF（动效须写在 SVG 自身的 <animate> / <animateTransform> / <set> 里，CSS @keyframes 与 <animateMotion> 不参与求值）。关键参数：svgGenWidth / svgGenHeight（16–2048，默认 512）、svgGenBackground、svgFrames（2–60，默认 12）、svgDurationSec（0 = 自动探测动画周期，上限 30 秒），用 includeParams 查询。',
    inputSchema: {
      type: 'object',
      properties: {
        typeId: { type: 'string', description: '只查该节点类型；缺省返回全部可添加类型' },
        includeParams: {
          type: 'boolean',
          description:
            'true 时附带每种节点的默认参数（可作 node_upsert 的 params 起点；默认 false）'
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
        GraphDocument | undefined
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
      '对一个已落盘的宿主资产图应用一批编辑操作（node_upsert / node_update / node_delete / edge_connect / edge_delete）。端口兼容性与类型合法性在应用内校验，未通过的操作跳过并记入 warnings。**图正在编辑器中打开时同样可用**：改动叠加在编辑器当前状态之上并即时同步到界面（因此不会覆盖用户尚未落盘的编辑），落盘完成才返回。修改立即持久化并同步应用界面。可借此搭建生成链路，如「图片节点出序列图 → 2D 帧动画（anim.2d，animGifFps > 0 时运行产出 GIF 动图）」；可建节点类型清单见 graph_node_types。也用于落 Agent 撰写的 Markdown 正文（如游戏策划案底稿）：node_update 目标 asset.gameSystem 节点、把正文写入 params.text 即可（下游 ui.split 等优先读取该参数；注意该节点自身再跑生成会重写 text）。' +
      '教学录屏时请传 **openEditor: true**：先打开该资产编辑器再改图，保证 `screen_record_*` 拍到可见画布变化。' +
      '创建 / 串联节点后**默认自动布局**（左→右分层）；仅在需要保留手动坐标时传 **autoLayout: false**。',
    inputSchema: {
      type: 'object',
      properties: {
        assetId: { type: 'string', description: '宿主资产 id' },
        openEditor: {
          type: 'boolean',
          description: 'true：先打开该资产的图编辑器再应用 ops（录屏 / 教学必开）'
        },
        autoLayout: {
          type: 'boolean',
          description: '缺省：新建节点或新连线后自动布局。true 强制布局；false 保留坐标（精细摆位）'
        },
        ops: {
          type: 'array',
          description: '编辑操作批，按顺序执行',
          items: {
            type: 'object',
            properties: {
              op: {
                type: 'string',
                enum: [
                  'node_upsert',
                  'node_update',
                  'node_delete',
                  'edge_connect',
                  'edge_delete',
                  'node_select'
                ]
              },
              nodeId: { type: 'string' },
              typeId: {
                type: 'string',
                description: 'node_upsert 必填，如 asset.image / play.script'
              },
              title: { type: 'string' },
              params: {
                type: 'object',
                description:
                  '节点参数（与节点现有参数浅合并）。参考图参数会被校验：styleImages 条目须带 libraryId 或 data: 开头的 dataUrl，styleImagesUseGlobal=false 须同时给 styleImages，styleReferenceSubject 只能是 default / ui，characterRefs 条目须带 imageUrl（只写角色名解析不出参考图）；不可解析的值丢弃并记入 warnings'
              },
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
      const openEditor = args.openEditor === true
      const autoLayout =
        args.autoLayout === true ? true : args.autoLayout === false ? false : undefined
      const asset = projectService.listAssets().find((item) => item.id === assetId)
      const graphJson = (asset?.genParams as Record<string, unknown> | undefined)?.graphJson as
        GraphDocument | undefined
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
        ops: args.ops,
        ...(openEditor ? { openEditor: true } : {}),
        ...(autoLayout !== undefined ? { autoLayout } : {})
      })
      // openEditor 时渲染层要先挂编辑器，轮询预算放宽
      const attempts = openEditor ? 40 : 20
      try {
        for (let i = 0; i < attempts; i++) {
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
        GraphDocument | undefined
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
      '用音频模型（火山方舟 TTS / 声音设计等）把**台词 / 旁白**转成 MP3 并落盘到工程缓存目录 Cache/Voices（不自动进资产库，避免在对话流里出重复卡）；需要进资产库时由用户在对话产物卡上点「保存到资产库」按钮。返回工程内相对路径。' +
      '**本工具只做人声（TTS）**：`input` 是要被「念出来」的文字。' +
      '**雨声 / 风声 / 脚步 / 环境音 / 打击声 / 机械声这类非人声音效，以及任何「生成一段 XX 声」的请求，必须用 `generate_sound_effect`** —— 用本工具只会把描述当台词念出来（产出语音而不是音效，而且照样计费）。' +
      '带说话人标记的整段对白用 `generate_dialogue`；音乐 / BGM 用 `generate_music`。',
    inputSchema: {
      type: 'object',
      properties: {
        input: { type: 'string', description: '台词 / 文本提示' },
        name: { type: 'string', description: '资产显示名' },
        model: { type: 'string', description: '音频模型 id（models_list 查询）' },
        providerInstanceId: { type: 'string', description: '提供商实例 id' },
        voice: { type: 'string', description: '音色（缺省用模型默认音色）' },
        speed: { type: 'number', description: '语速' },
        extraParams: {
          type: 'object',
          description: '低频参数透传（如 responseFormat / 参考图），合并进底层生成输入'
        }
      },
      required: ['input']
    },
    handler: async (args) => {
      assertProjectOpen()
      const inputText = readString(args, 'input')
      const input = {
        ...cacheOnlyGenExtraParams(args),
        input: inputText,
        model: optionalString(args, 'model'),
        providerInstanceId: optionalString(args, 'providerInstanceId'),
        voice: optionalString(args, 'voice'),
        speed:
          typeof args.speed === 'number' && Number.isFinite(args.speed) ? args.speed : undefined,
        name: optionalString(args, 'name')
      }
      // 对话生成的语音只落 Cache、不入资产库（避免在对话流里出现重复卡）；
      // 想入库让用户点资产卡上的「保存到资产库」按钮。
      const result = await runGenActivity(
        'generate_speech',
        activityTitle(input.name, inputText),
        input.model,
        () => modelProviderFacade.generateSpeechAsset(input),
        (r) => ({ assetId: r.assetId, relativePath: liveAssetRelativePath(r) }),
        undefined,
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
      '用音乐模型（MiniMax Music / 百炼 Fun-Music 等）按情绪与时长描述生成配乐并落盘到工程缓存目录 Cache/Music（不自动进资产库，避免在对话流里出重复卡）；需要进资产库时由用户在对话产物卡上点「保存到资产库」按钮。返回工程内相对路径，可直接铺到时间线 music 轨。',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: '音乐描述：风格 / 情绪 / 场景（如「轻快明亮的电子配乐，适合 Vlog」）'
        },
        name: { type: 'string', description: '资产显示名' },
        model: {
          type: 'string',
          description: '音乐模型 id（models_list 查询，如 music-3.0 / fun-music-v1）'
        },
        providerInstanceId: { type: 'string', description: '提供商实例 id' },
        lyrics: {
          type: 'string',
          description:
            '歌词（纯音乐时省略；多段用 \\n 分隔，支持 [Intro]/[Verse]/[Chorus] 结构标签）'
        },
        instrumental: { type: 'boolean', description: '是否纯音乐（无歌词 / 人声），缺省 true' },
        extraParams: {
          type: 'object',
          description: '低频参数透传（如 audio_setting），合并进底层生成输入'
        }
      },
      required: ['prompt']
    },
    handler: async (args) => {
      assertProjectOpen()
      const inputText = readString(args, 'prompt')
      const input = {
        ...cacheOnlyGenExtraParams(args),
        prompt: inputText,
        name: optionalString(args, 'name'),
        model: optionalString(args, 'model'),
        providerInstanceId: optionalString(args, 'providerInstanceId'),
        lyrics: optionalString(args, 'lyrics'),
        instrumental: typeof args.instrumental === 'boolean' ? args.instrumental : undefined
      }
      // 对话生成的 BGM 只落 Cache、不入资产库（避免在对话流里出现重复卡）；
      // 想入库让用户点资产卡上的「保存到资产库」按钮。
      const result = await runGenActivity(
        'generate_music',
        activityTitle(input.name, inputText),
        input.model,
        () => modelProviderFacade.generateMusicAsset(input),
        (r) => ({ assetId: r.assetId, relativePath: liveAssetRelativePath(r) }),
        undefined,
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
    name: 'generate_dialogue',
    title: '生成多说话人对话',
    description:
      '把一段多说话人对白一次合成为单个音频（ElevenLabs Text to Dialogue，`POST /v1/text-to-dialogue`）并落盘到工程缓存目录 Cache/Voices（不自动进资产库，避免在对话流里出重复卡）；需要进资产库时由用户在对话产物卡上点「保存到资产库」按钮。返回工程内相对路径。' +
      '脚本按行写「说话人: 台词」，中英文冒号都认；不含冒号的行沿用上一段的说话人（旁白 / 连续独白）。每个说话人要绑定音色（`voices` 映射，或全局 `voice` 兜底），缺音色会报出是第几段、哪个说话人。' +
      '**为什么要用这个工具而不是逐句调 generate_speech**：整段一次合成能保住语气连贯，逐句拼接会在句间丢情绪；而且它走的是专门的对话端点。',
    inputSchema: {
      type: 'object',
      properties: {
        script: {
          type: 'string',
          description: '对白脚本，按行写；多段用 \\n 分隔。例：「A: 你终于来了。\\nB: 路上堵车。」'
        },
        voices: {
          type: 'object',
          description:
            '说话人 → 音色 id 的映射（如 {"A":"<voice_id>","B":"<voice_id>"}）；音色 id 见模型的 supported_voices，或先用 voice_profile_upsert 给角色建档'
        },
        voice: { type: 'string', description: '兜底音色（某段没匹配到说话人时用它）' },
        voiceProfile: {
          type: 'string',
          description: '角色音色档案名：按档案解析音色，与显式 voice 二选一'
        },
        model: { type: 'string', description: '音频模型 id（models_list 查询）' },
        providerInstanceId: { type: 'string', description: '提供商实例 id' },
        name: { type: 'string', description: '资产显示名' },
        extraParams: {
          type: 'object',
          description: '低频参数透传，合并进底层生成输入'
        }
      },
      required: ['script']
    },
    handler: async (args) => {
      assertProjectOpen()
      const script = readString(args, 'script')
      const lines = parseDialogueScript(script)
      if (!lines.length) throw fail(SHARED_ERRORS.dialogueEmpty)

      const fallbackVoice = optionalString(args, 'voice')
      const voiceBySpeaker = normalizeDialogueVoiceMap(args.voices)
      const { inputs, missingVoiceAt } = buildDialogueInputs(lines, voiceBySpeaker, fallbackVoice)
      if (missingVoiceAt.length) {
        // 与图节点同一条报错口径：点名第几段、哪个说话人 —— 对白一长只报「缺音色」没法定位
        const speakers = [
          ...new Set(missingVoiceAt.map((index) => lines[index]?.speaker).filter(Boolean))
        ] as string[]
        throw fail(SHARED_ERRORS.dialogueVoiceMissing, {
          lines: missingVoiceAt.map((index) => index + 1).join('、'),
          speakers: speakers.join('、')
        })
      }

      const input = {
        ...cacheOnlyGenExtraParams(args),
        // input 只作为日志/兜底内容，真正发出去的是 dialogue
        input: script,
        dialogue: inputs,
        model: optionalString(args, 'model'),
        providerInstanceId: optionalString(args, 'providerInstanceId'),
        voice: fallbackVoice,
        voiceProfile: optionalString(args, 'voiceProfile'),
        name: optionalString(args, 'name')
      }
      const result = await runGenActivity(
        'generate_dialogue',
        activityTitle(input.name, script),
        input.model,
        () => modelProviderFacade.generateSpeechAsset(input),
        (r) => ({ assetId: r.assetId, relativePath: liveAssetRelativePath(r) }),
        undefined,
        // 对话走的是语音端点，日志类别沿用 generateSpeech（没有独立的 dialogue 类别）
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
        segments: inputs.length,
        speakers: dialogueSpeakers(lines)
      }
    }
  },
  {
    name: 'generate_sound_effect',
    title: '生成音效',
    description:
      '按描述生成**音效本身**（ElevenLabs `POST /v1/sound-generation`）并落盘到工程缓存目录 Cache/Sfx（不自动进资产库，避免在对话流里出重复卡）；需要进资产库时由用户在对话产物卡上点「保存到资产库」按钮。返回工程内相对路径。' +
      '**「生成一段雨声 / 风声 / 环境音 / 脚步声」这类请求归本工具**（非人声），不要用 `generate_speech` —— 那会把描述当台词念出来。' +
      '描述要写成**声音听起来是什么样**（「雨落在铁皮屋顶上」「清脆短促的按钮点击」），而不是「我要一个按钮音效」这类**用途**——用途模型听不懂。' +
      '环境音（雨 / 风 / 海浪 / 机器嗡鸣）请把 `loop` 设为 true：否则长循环时接缝处会有可听见的咔嗒声。' +
      '需要**人声**（台词 / 旁白）请用 `generate_speech`；**对白**用 `generate_dialogue`；**音乐**用 `generate_music`。',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: '音效描述：音色质感 + 时间形态 + 空间感 + 排除项'
        },
        loop: {
          type: 'boolean',
          description: '生成可无缝循环的音频（环境音常用）；缺省 false'
        },
        durationSeconds: {
          type: 'number',
          description: '期望时长（秒），规范范围 0.5–30；超出会被夹到边界'
        },
        promptInfluence: {
          type: 'number',
          description: '提示词影响力 0–1（默认 0.3）：越高越贴合描述、随机性越低'
        },
        model: { type: 'string', description: '音效模型 id（通常留空，端点只有一个模型）' },
        providerInstanceId: { type: 'string', description: '提供商实例 id' },
        name: { type: 'string', description: '资产显示名' },
        extraParams: {
          type: 'object',
          description: '低频参数透传，合并进底层生成输入'
        }
      },
      required: ['prompt']
    },
    handler: async (args) => {
      assertProjectOpen()
      const prompt = readString(args, 'prompt')
      const input = {
        ...cacheOnlyGenExtraParams(args),
        prompt,
        // 越界值不用在这里夹：适配器 buildElevenSoundRequest 统一走 clampNumber，
        // 这里是**上游唯一入口**，重复夹一次只会让两处规则有机会漂移
        loop: typeof args.loop === 'boolean' ? args.loop : undefined,
        durationSeconds:
          typeof args.durationSeconds === 'number' && Number.isFinite(args.durationSeconds)
            ? args.durationSeconds
            : undefined,
        promptInfluence:
          typeof args.promptInfluence === 'number' && Number.isFinite(args.promptInfluence)
            ? args.promptInfluence
            : undefined,
        model: optionalString(args, 'model'),
        providerInstanceId: optionalString(args, 'providerInstanceId'),
        name: optionalString(args, 'name')
      }
      const result = await runGenActivity(
        'generate_sound_effect',
        activityTitle(input.name, prompt),
        input.model,
        () => modelProviderFacade.generateSoundEffectAsset(input),
        (r) => ({ assetId: r.assetId, relativePath: liveAssetRelativePath(r) }),
        undefined,
        (r) => ({
          kind: 'generateSoundEffect',
          nodeId: 'mcp',
          request: {
            prompt: input.prompt,
            model: input.model,
            providerInstanceId: input.providerInstanceId,
            // duration 是日志里的既有字段（音效的"期望时长"语义最接近它）
            duration: input.durationSeconds,
            name: input.name
          },
          response: {
            model: r.model,
            assetId: r.assetId,
            relativePath: liveAssetRelativePath(r)
          }
        })
      )
      broadcastAsset(result.assetId)
      return {
        assetId: result.assetId,
        relativePath: liveAssetRelativePath(result),
        model: result.model
      }
    }
  },
  {
    name: 'models_list',
    title: '可用模型列表',
    description:
      '列出应用设置中已启用的模型提供商与各模态（text/image/video/audio/model3d/world/decisions）勾选的模型。generate_* 工具的 model / providerInstanceId 参数从这里取；world 是 World Labs Marble 空间世界（generate_world 工具用）；decisions 是 OpenRouter 决策模型（decide 工具用）。',
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
            (['text', 'image', 'video', 'audio', 'model3d', 'world', 'decisions'] as const).map(
              (modality) => [
                modality,
                {
                  selected: provider.modalities[modality]?.selectedModelIds ?? [],
                  default: provider.modalities[modality]?.defaultModelId ?? ''
                }
              ]
            )
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
    name: 'decide',
    title: '决策判定',
    description:
      '用 OpenRouter 决策模型（TypeSafe Jev / Liquid D1 等，不生成文本）对给定状态回答一组带概率的类型化问题，返回可直接分支的结论：noul 是/否概率、choice 选中项与置信度、score 加权位置。三种原语一次请求可混用；同一状态的多条问题并行作答、互不可见。判定不落盘、不进资产库，只回结果 —— agent 想要一次判定用本工具；只有需要把判定**留在图里**（可复跑 / 用户在画布上可视化）时才改走 graph_edit 建 decisions.judge 节点，那条要配 task_run **跑整张图**（可能重跑上游生图等昂贵节点），代价高得多。需先在设置里添加 OpenRouter 提供商并在「决策」页签勾选决策模型（models_list 查看）。',
    inputSchema: {
      type: 'object',
      properties: {
        questions: {
          type: 'string',
          description:
            '问题清单，每行一条：`问题名 | 类型 | 问题 | 判定说明`。类型为 noul / choice / score。noul 的判定说明写「是的情形 / 否的情形」；choice 写选项（`;` 分隔，可用 `值:说明`）；score 写有序量表（低→高，`;` 分隔）。以 # 或 // 开头的行是注释。例：`is_bug | noul | 是缺陷吗？ | 描述了异常行为 / 只是在提问`、`team | choice | 哪个团队？ | payments:支付; frontend:前端`、`urgency | score | 多紧急？ | 可等; 本周修; 阻塞收入`'
        },
        state: {
          type: 'string',
          description: '待判定的状态文本（如工单正文 / 剧本片段）。与 assetId / assetIds 至少给一个'
        },
        assetId: {
          type: 'string',
          description: '把某份工程内文本资产作为 state（asset_list 查询）'
        },
        assetIds: {
          type: 'array',
          items: { type: 'string' },
          description: '把多份文本资产按顺序拼成 state，每条带来源标题'
        },
        noulYesThreshold: {
          type: 'number',
          description: 'noul 判「是」的概率阈值，缺省 0.5'
        },
        choiceMinConfidence: {
          type: 'number',
          description: 'choice 视为可信的最低置信度；低于该值时结论 confident=false'
        },
        scoreMin: { type: 'number', description: 'score 视为达标的最低分位' },
        model: { type: 'string', description: '决策模型 id（models_list 的 decisions 模态）' },
        providerInstanceId: { type: 'string', description: '提供商实例 id（models_list 查询）' }
      },
      required: ['questions']
    },
    handler: async (args) => {
      const questions = parseDecisionQuestions(readString(args, 'questions'))
      if (!questions.length) {
        throw new Error(
          '未解析出任何问题：每行格式为「问题名 | noul|choice|score | 问题 | 判定说明」'
        )
      }

      // 只给 state 时不要求打开工程（判定本身不落盘）；读资产才需要工程
      const inlineState = optionalString(args, 'state')
      const wantsAssets =
        Boolean(optionalString(args, 'assetId')) || readStringList(args, 'assetIds').length > 0
      if (wantsAssets) assertProjectOpen()
      const evidence = wantsAssets ? await readDecisionEvidence(args) : []
      if (!evidence.length && !inlineState) {
        throw new Error('请给出 state 或 assetId / assetIds（要判定的内容）')
      }

      const thresholds = {
        noulYes: optionalNumber(args, 'noulYesThreshold'),
        choiceMinConfidence: optionalNumber(args, 'choiceMinConfidence'),
        scoreMin: optionalNumber(args, 'scoreMin')
      }
      const model = optionalString(args, 'model')
      const input: GenerateDecisionsInput = {
        ...(inlineState ? { state: inlineState } : {}),
        ...(evidence.length ? { evidence } : {}),
        questions,
        ...(Object.values(thresholds).some((value) => value != null) ? { thresholds } : {}),
        model,
        providerInstanceId: optionalString(args, 'providerInstanceId')
      }

      return runGenActivity(
        'decide',
        questions.map((q) => q.key).join(', '),
        model,
        () => modelProviderFacade.generateDecisions(input),
        () => ({}),
        undefined,
        (r) => ({
          kind: 'generateDecisions',
          nodeId: 'mcp',
          request: {
            questions: questions.map((q) => ({ key: q.key, type: q.type })),
            model: r.model,
            thresholds
          },
          // response 字段是定形摘要（text/model/...）：判定结论拼成一行摘要便于日志阅读
          response: { model: r.model, text: r.summary, ok: true }
        })
      )
    }
  },
  {
    name: 'generate_image',
    title: '生成图片',
    description:
      '用图片模型生成图片并落盘到工程缓存目录 Cache/Images（不自动进资产库）；需要进资产库时由用户在对话卡上点「保存到资产库」按钮。需要已打开工程；模型 / 提供商缺省时用应用当前选择。返回工程内相对路径。',
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
        extraParams: {
          type: 'object',
          description:
            '低频参数透传（如 seed / quality / resolution），合并进底层生成输入；同名常用参数以显式传参为准'
        }
      },
      required: ['prompt']
    },
    handler: async (args) => {
      assertProjectOpen()
      const input: GenerateImageInput & { name?: string } = {
        ...cacheOnlyGenExtraParams(args),
        prompt: readString(args, 'prompt'),
        name: optionalString(args, 'name'),
        model: optionalString(args, 'model'),
        providerInstanceId: optionalString(args, 'providerInstanceId'),
        aspectRatio: optionalString(args, 'aspectRatio'),
        n: typeof args.n === 'number' && Number.isFinite(args.n) ? args.n : undefined,
        inputReferences: Array.isArray(args.referenceImageUrls)
          ? args.referenceImageUrls.filter((item): item is string => typeof item === 'string')
          : undefined
      }
      // 对话生成的图片只落 Cache、不入资产库（避免在对话流里出现重复卡）；
      // 想入库让用户点资产卡上的「保存到资产库」按钮。
      const result = await runGenActivity(
        'generate_image',
        activityTitle(input.name, input.prompt),
        input.model,
        () => modelProviderFacade.generateImageAsset(input),
        (r) => ({ assetId: r.assetId, relativePath: liveAssetRelativePath(r) }),
        undefined,
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
            relativePath: liveAssetRelativePath(r),
            referenceNotes: r.referenceNotes
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
      '提交视频生成任务并落盘到工程缓存目录 Cache/Videos（不自动进资产库，避免在对话流里出现重复卡）；供应商异步任务由应用后台轮询，可用 video_job_list / video_job_get 跟踪进度。需要进资产库时由用户在对话卡上点「保存到资产库」按钮。返回工程内相对路径。',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '画面与运镜描述' },
        name: { type: 'string', description: '文件显示名' },
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
        extraParams: {
          type: 'object',
          description: '低频参数透传（如 resolution / size / seed），合并进底层生成输入'
        }
      },
      required: ['prompt']
    },
    handler: async (args) => {
      assertProjectOpen()
      const input: GenerateVideoInput & { name?: string } = {
        ...cacheOnlyGenExtraParams(args),
        prompt: readString(args, 'prompt'),
        name: optionalString(args, 'name'),
        model: optionalString(args, 'model'),
        providerInstanceId: optionalString(args, 'providerInstanceId'),
        duration:
          typeof args.duration === 'number' && Number.isFinite(args.duration)
            ? args.duration
            : undefined,
        aspectRatio: optionalString(args, 'aspectRatio'),
        generateAudio: typeof args.generateAudio === 'boolean' ? args.generateAudio : undefined,
        firstFrameImageUrl: optionalString(args, 'firstFrameImageUrl'),
        lastFrameImageUrl: optionalString(args, 'lastFrameImageUrl')
      }
      // 对话生成的视频只落 Cache、不入资产库（避免在对话流里出现重复卡）；
      // 想入库让用户点资产卡上的「保存到资产库」按钮。
      const result = await runGenActivity(
        'generate_video',
        activityTitle(input.name, input.prompt),
        input.model,
        () => modelProviderFacade.generateVideo(input),
        (r) => ({ assetId: r.assetId, relativePath: liveAssetRelativePath(r) }),
        undefined,
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
      '文生 3D / 图生 3D（Meshy / Tripo / Rodin / Luma / Lux3D），产出 GLB 模型并落盘到工程缓存目录 Cache/Models（不自动进资产库）。需要进资产库时由用户在对话卡上点「保存到资产库」按钮。返回工程内相对路径。' +
      '**本工具只负责生成，不要传 rig**：骨骼蒙皮（Meshy/Tripo Rigging API）用 `rig_model3d`、拆件用 `segment_model3d`、重拓扑 / 补全 / 重定向 / 转换格式 / 贴图用 `post_process_model3d` —— 它们都吃本工具返回的模型资产。',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '外观描述' },
        name: { type: 'string', description: '文件显示名' },
        model: { type: 'string', description: '3D 模型 id（models_list 查询）' },
        providerInstanceId: { type: 'string', description: '提供商实例 id' },
        style: {
          type: 'string',
          description:
            '风格：photorealistic / cartoon / anime / hand_painted / cyberpunk / fantasy / glass'
        },
        referenceImageUrls: {
          type: 'array',
          items: { type: 'string' },
          description:
            '参考图（图生 3D / 多图生 3D）：支持 http(s) 地址、data URL、工程内相对路径或本地绝对路径。3D 供应商仅接受 http(s) 图片，相对/本地路径会自动上传到已配置的对象存储转换为公网 URL（未配置对象存储时报错，可用 storage_status 查询）'
        },
        extraParams: {
          type: 'object',
          description:
            '低频参数透传（模型特有字段），合并进底层生成输入；显式入参优先于这里的同名字段'
        }
      },
      required: ['prompt']
    },
    handler: async (args) => {
      assertProjectOpen()
      const input: GenerateModel3dInput & { name?: string } = {
        ...cacheOnlyGenExtraParams(args),
        prompt: readString(args, 'prompt'),
        name: optionalString(args, 'name'),
        model: optionalString(args, 'model'),
        providerInstanceId: optionalString(args, 'providerInstanceId'),
        style: optionalString(args, 'style'),
        inputReferences: Array.isArray(args.referenceImageUrls)
          ? args.referenceImageUrls.filter((item): item is string => typeof item === 'string')
          : undefined
      }
      // 对话生成的 3D 模型只落 Cache、不入资产库（避免在对话流里出现重复卡）；
      // 想入库让用户点资产卡上的「保存到资产库」按钮。
      const result = await runGenActivity(
        'generate_model3d',
        activityTitle(input.name, input.prompt),
        input.model,
        () => modelProviderFacade.generateModel3d(input),
        (r) => ({ assetId: r.assetId, relativePath: liveAssetRelativePath(r) }),
        undefined,
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
      return {
        ...result,
        relativePath: liveAssetRelativePath(result)
      }
    }
  },
  {
    name: 'generate_world',
    title: '生成空间世界',
    description:
      '文生世界 / 图生世界 / 多图生世界 / 视频生世界（World Labs Marble），产出可漫游 3D 世界的 GLB 网格并落盘到工程缓存目录 Cache/Models（不自动进资产库）。单次生成约 5 分钟，共 4 档模型：marble-1.1（标准）/ marble-1.1-plus（更大世界，更贵），以及上一代 marble-1.0 / marble-1.0-draft。参考输入四选一：文本、1 张图、2–4 张同场景多视角图、或 1 段参考视频（同时给了视频与图片时以视频为准；视频推荐 mp4 / webm / mov / avi，单条不超过 100MB）；相对 / 本地路径的参考**默认上传 World Labs 托管存储**（官方 media-asset，不占用对象存储配额；上传失败才回退到对象存储换成公网 URL，两条都失败时把两条原因一起写进报错）。需要 PLY 泼溅或 HQ 贴图网格时用图节点「空间世界导出」（spatialWorld.export）。需要进资产库时由用户在对话卡上点「保存到资产库」按钮。返回工程内相对路径。',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: '世界描述：空间格局、起始视角能看到的景物、光照与风格'
        },
        name: { type: 'string', description: '文件显示名' },
        model: {
          type: 'string',
          description:
            '空间世界 id：marble-1.1（标准）/ marble-1.1-plus（更大世界，更贵）/ marble-1.0 / marble-1.0-draft（上一代）'
        },
        providerInstanceId: { type: 'string', description: '提供商实例 id' },
        displayName: {
          type: 'string',
          description: '世界展示名（上游 display_name，最长 64 字符）'
        },
        seed: {
          type: 'number',
          description: '随机种子 0–4294967295（同种子同描述可复现同一世界；省略则由上游随机）'
        },
        panoMode: {
          type: 'string',
          enum: ['auto', 'always', 'never'],
          description:
            '仅单图参考生效：auto（默认，自动识别 2:1 等距柱状全景）/ always 强制当全景 / never 当普通图片。全景能给出完整空间信息，通常比普通图更准'
        },
        disableRecaption: {
          type: 'boolean',
          description:
            '关闭上游 recaption：true 时指令原文直送（配合 seed 更可复现）；缺省由上游自动补写画面描述'
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: '世界标签（官方 tags，最多 10 个、每个 ≤32 字符；仅供 World Labs 侧检索）'
        },
        publicWorld: {
          type: 'boolean',
          description: '把生成的世界设为公开（官方 permission.public，默认 false 仅自己可见）'
        },
        referenceImageUrls: {
          type: 'array',
          items: { type: 'string' },
          description:
            '参考图（图生世界 / 多图生世界，最多 4 张）：支持 http(s) 地址、data URL、工程内相对路径或本地绝对路径。与 referenceVideoUrl 同时给出时以视频为准'
        },
        referenceVideoUrl: {
          type: 'string',
          description:
            '参考视频（视频生世界，只取 1 条）：支持 http(s) 地址、工程内相对路径或本地绝对路径；相对/本地路径会自动上传对象存储换公网 URL。推荐 mp4 / webm / mov / avi，单条不超过 100MB（上游硬限制）'
        },
        extraParams: {
          type: 'object',
          description:
            '低频参数透传（模型特有字段），合并进底层生成输入；显式入参优先于这里的同名字段'
        }
      },
      required: ['prompt']
    },
    handler: async (args) => {
      assertProjectOpen()
      const referenceVideoUrl = optionalString(args, 'referenceVideoUrl')
      const input: GenerateSpatialWorldInput & { name?: string } = {
        ...cacheOnlyGenExtraParams(args),
        prompt: readString(args, 'prompt'),
        name: optionalString(args, 'name'),
        model: optionalString(args, 'model'),
        providerInstanceId: optionalString(args, 'providerInstanceId'),
        displayName: optionalString(args, 'displayName'),
        seed: typeof args.seed === 'number' && Number.isFinite(args.seed) ? args.seed : undefined,
        panoMode:
          args.panoMode === 'always' || args.panoMode === 'never' || args.panoMode === 'auto'
            ? args.panoMode
            : undefined,
        disableRecaption: args.disableRecaption === true ? true : undefined,
        tags: Array.isArray(args.tags)
          ? args.tags.filter((tag): tag is string => typeof tag === 'string')
          : undefined,
        publicWorld: args.publicWorld === true ? true : undefined,
        // 图片与视频都留在同一份引用列表里：适配器按 kind 决定 world_prompt 形态（视频优先）
        inputReferences: [
          ...(Array.isArray(args.referenceImageUrls)
            ? args.referenceImageUrls
                .filter((item): item is string => typeof item === 'string')
                .map((url) => ({ kind: 'image_url' as const, url }))
            : []),
          ...(referenceVideoUrl ? [{ kind: 'video_url' as const, url: referenceVideoUrl }] : [])
        ]
      }
      // 与 3D 模型同口径：对话生成的世界只落 Cache、不入资产库（避免重复卡）
      const result = await runGenActivity(
        'generate_world',
        activityTitle(input.name, input.prompt),
        input.model,
        () => modelProviderFacade.generateSpatialWorld(input),
        // 世界产物除主产物 GLB 外，还随包返回高斯泼溅（.spz）与 360 全景。
        // 它们是**主产物的附件**而非独立作品，所以走 relatedPaths 折叠进同一张卡，
        // 由 splitPrimaryAndRelated 决定谁当封面（有泼溅就用泼溅）。
        (r) => {
          const primary = liveAssetRelativePath(r) ?? r.relativePath
          const extras = (r.extras ?? []).map((item) => item.relativePath)
          const split = splitPrimaryAndRelated(primary, extras)
          return {
            assetId: r.assetId,
            relativePath: split.primary,
            ...(split.related.length ? { relatedPaths: split.related } : {})
          }
        },
        undefined,
        (r) => ({
          kind: 'generateSpatialWorld',
          nodeId: 'mcp',
          request: {
            prompt: input.prompt,
            model: input.model,
            providerInstanceId: input.providerInstanceId,
            seed: input.seed,
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
      return {
        ...result,
        // 附加产物（高斯泼溅 SPZ / 360 全景图）随世界落盘在主产物旁边，路径一并回报
        extras: result.extras?.filter((item) => item.relativePath?.trim()),
        relativePath: liveAssetRelativePath(result)
      }
    }
  },
  {
    name: 'export_spatial_world',
    title: '导出空间世界',
    description:
      '把 `generate_world` 产出的**世界**导出成能继续编排的产物。**这是世界的唯一出口** —— 世界端口严格同类型（不隐式兼容模型），不导出就拿不到可用的网格。' +
      '两种模式：`mesh`（默认）出 HQ 网格 GLB 并**登记为模型资产**，可接 3D 加工 / 导演台，`textured`（约 60 万面，带贴图）或 `vertex_colored`（约 100 万面）；' +
      '`splats` 出 PLY 泼溅，**落在世界产物同目录同名文件里、不登记资产**（PLY 在应用内没有预览通道），可带分辨率 `full_res` / `500k` / `150k` / `100k`。' +
      '**计费与耗时**：两者都单独计费；`mesh` 是上游异步服务，**最长约 1 小时**、限速 4 次/小时，所以这个调用会等很久。' +
      '**只想进去看看就不必导出**：世界生成时随包免费返回的 `.spz` 泼溅已经能直接浏览。' +
      '必须给 `spatialWorldId`（generate_world 的返回值里有）或 `spatialWorldAssetId`（世界 GLB 的资产 id，可反查）；`splats` 还需要能定位世界产物的路径。',
    inputSchema: {
      type: 'object',
      properties: {
        spatialWorldId: {
          type: 'string',
          description: 'World Labs 世界 id（generate_world 返回的 spatialWorldId）'
        },
        spatialWorldAssetId: {
          type: 'string',
          description:
            '世界 GLB 的资产 id（generate_world 返回的 assetId）：没给 spatialWorldId 时用它反查，同时作为 splats 的落盘参照'
        },
        sourceRelativePath: {
          type: 'string',
          description:
            '世界产物的工程内相对路径（splats 模式在自己的同目录同名落文件用）；缺省时从 spatialWorldAssetId 取'
        },
        assetType: {
          type: 'string',
          enum: ['mesh', 'splats'],
          description: 'mesh（默认，HQ 网格 GLB、登记模型资产）或 splats（PLY、只落文件）'
        },
        meshVariant: {
          type: 'string',
          enum: ['textured', 'vertex_colored'],
          description: '仅 mesh：带贴图（约 60 万面）或顶点色（约 100 万面），缺省 textured'
        },
        resolution: {
          type: 'string',
          enum: ['full_res', '500k', '150k', '100k'],
          description: '仅 splats：PLY 分辨率档，缺省 full_res'
        },
        model: { type: 'string', description: '空间世界模型 id（models_list 查询）' },
        providerInstanceId: { type: 'string', description: '提供商实例 id' },
        name: { type: 'string', description: '产物显示名' },
        extraParams: {
          type: 'object',
          description: '低频参数透传，合并进底层生成输入'
        }
      },
      required: []
    },
    handler: async (args) => {
      assertProjectOpen()
      const assetId = optionalString(args, 'spatialWorldAssetId')
      const asset = assetId ? findAssetOrThrow(assetId) : undefined

      // 世界 id：显式给最好；否则用世界资产反查生成任务记录（生成本身已花过积分，不该逼用户重生成）
      const explicitWorldId = optionalString(args, 'spatialWorldId')
      const spatialWorldId =
        explicitWorldId ??
        (assetId
          ? (await modelProviderFacade.recoverSpatialWorldId({ assetId }))?.trim() || undefined
          : undefined)
      if (!spatialWorldId) {
        throw fail(SHARED_ERRORS.worldExportNoWorldId)
      }

      const assetType: SpatialWorldExportAssetType = args.assetType === 'splats' ? 'splats' : 'mesh'
      const sourceRelativePath =
        optionalString(args, 'sourceRelativePath') ?? asset?.relativePath?.trim() ?? undefined

      const input: ExportWorldInput = {
        ...cacheOnlyGenExtraParams(args),
        spatialWorldId,
        assetType,
        format: assetType === 'splats' ? 'ply' : 'glb',
        ...(assetType === 'mesh'
          ? {
              meshVariant: (args.meshVariant === 'vertex_colored'
                ? 'vertex_colored'
                : 'textured') satisfies SpatialWorldExportMeshVariant
            }
          : {}),
        ...(assetType === 'splats' ? { resolution: readExportResolution(args) } : {}),
        model: optionalString(args, 'model'),
        providerInstanceId: optionalString(args, 'providerInstanceId'),
        sourceRelativePath,
        name: optionalString(args, 'name')
      }
      const result = await runGenActivity(
        'export_spatial_world',
        activityTitle(input.name, `导出世界（${assetType}）`),
        input.model,
        () => modelProviderFacade.exportWorld(input),
        (r) => ({ assetId: r.assetId, relativePath: liveAssetRelativePath(r) }),
        undefined,
        (r) => ({
          kind: 'exportWorld',
          nodeId: 'mcp',
          request: {
            model: input.model,
            providerInstanceId: input.providerInstanceId,
            name: input.name,
            // 世界导出没有 prompt；借 input 记录导出规格，便于运行日志复盘
            input: `export:${assetType}${assetType === 'mesh' ? `:${input.meshVariant}` : ''}`
          },
          response: {
            model: r.model,
            assetId: r.assetId,
            relativePath: liveAssetRelativePath(r)
          }
        })
      )
      // splats 不登记资产（没有可广播的卡），mesh 才有
      if (result.assetId) broadcastAsset(result.assetId)
      return {
        assetId: result.assetId,
        relativePath: liveAssetRelativePath(result),
        model: result.model,
        assetType: result.assetType,
        format: result.format,
        // splats 的 PLY 落在世界产物旁边；相对路径一并回报，否则 agent 不知道文件在哪
        ...(result.assetId ? {} : { note: 'PLY 泼溅落在世界产物同目录同名的 .ply 文件里' })
      }
    }
  },
  {
    name: 'rig_model3d',
    title: '3D 骨骼蒙皮',
    description:
      '给现有 3D 模型绑骨架（云端 Rigging API），产物 GLB（或 FBX）落 `Cache/Models`（不自动进资产库）。**只有 Meshy 与 Tripo 提供该能力**，别的 3D 供应商会明确报错。' +
      '输出会返回 `taskId` —— 做**动画重定向**（`post_process_model3d` 的 `op: retarget`）时要把它作为 `providerTaskId` 传回去。' +
      '源模型给 `assetId`（工程内模型资产）或 `modelUrl`（公网直链）。**给工程内文件需要先配置对象存储**：模型要先换成公网 URL 才能提交给上游；`modelUrl` 则不需要。',
    inputSchema: {
      type: 'object',
      properties: {
        assetId: { type: 'string', description: '源 3D 模型资产 id（与 modelUrl 二选一）' },
        modelUrl: { type: 'string', description: '公网可访问的模型直链（与 assetId 二选一）' },
        rigType: {
          type: 'string',
          description: '骨架类型（humanoid / quadruped 等，缺省 humanoid）'
        },
        spec: {
          type: 'string',
          enum: ['tripo', 'mixamo'],
          description:
            '骨架命名规范：mixamo（默认，兼容 Mixamo 动作库）/ tripo（原生命名）；Meshy 忽略'
        },
        outFormat: {
          type: 'string',
          enum: ['glb', 'fbx'],
          description: '输出格式：glb（默认，可直接预览）/ fbx（DCC / 游戏引擎）；Meshy 固定 glb'
        },
        model: { type: 'string', description: '3D 模型 id（models_list 查询）' },
        providerInstanceId: { type: 'string', description: '提供商实例 id' },
        name: { type: 'string', description: '产物显示名' },
        extraParams: { type: 'object', description: '低频参数透传，合并进底层生成输入' }
      },
      required: []
    },
    handler: async (args) => {
      assertProjectOpen()
      const input = {
        ...cacheOnlyGenExtraParams(args),
        ...resolveModel3dSourceInput(args),
        model: optionalString(args, 'model'),
        providerInstanceId: optionalString(args, 'providerInstanceId'),
        rigType: optionalString(args, 'rigType'),
        spec: readEnumArg(args, 'spec', ['tripo', 'mixamo'] as const),
        outFormat: readEnumArg(args, 'outFormat', ['glb', 'fbx'] as const),
        name: optionalString(args, 'name')
      }
      const result = await runGenActivity(
        'rig_model3d',
        activityTitle(input.name, `3D 骨骼蒙皮（${input.rigType || 'humanoid'}）`),
        input.model,
        () => modelProviderFacade.rigModel3d(input),
        (r) => ({ assetId: r.assetId, relativePath: liveAssetRelativePath(r) }),
        undefined,
        (r) => ({
          kind: 'rigModel3d',
          nodeId: 'mcp',
          request: {
            model: input.model,
            providerInstanceId: input.providerInstanceId,
            rigType: input.rigType,
            name: input.name
          },
          response: {
            model: r.model,
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
        // 下游重定向要用它，必须回给 agent
        taskId: result.taskId
      }
    }
  },
  {
    name: 'segment_model3d',
    title: '3D 模型拆分',
    description:
      '把 3D 模型拆成部件，产物 GLB 落 `Cache/Models`（不自动进资产库），并返回**部件名清单**（拆分后 GLB 的各 node 名，可用于后续「部件补全」点名）。' +
      '两种模式：`mesh`（网格分割，默认；可给 `granularity` 走语义 + 几何的 v2 算法）与 `smart`（智能分割，按语义拆，可用 `hint` 点名要拆哪些部件，如「带剑与盔甲的游戏角色」）。' +
      '源模型给 `assetId` 或 `modelUrl`；**给工程内文件需要先配置对象存储**（要先换成公网 URL）。输出含 `taskId`，可作为「部件补全」的 `providerTaskId`。',
    inputSchema: {
      type: 'object',
      properties: {
        assetId: { type: 'string', description: '源 3D 模型资产 id（与 modelUrl 二选一）' },
        modelUrl: { type: 'string', description: '公网可访问的模型直链（与 assetId 二选一）' },
        mode: {
          type: 'string',
          enum: ['mesh', 'smart'],
          description: '拆分模式：mesh（网格分割，默认）/ smart（智能分割，按语义）'
        },
        granularity: {
          type: 'string',
          description: 'mesh 模式的分割粒度（传入即用 v2.0 语义 + 几何算法）'
        },
        splitByConnectivity: {
          type: 'boolean',
          description: 'mesh v2：是否按连通域拆分（默认 true）'
        },
        smartGranularity: {
          type: 'string',
          description: 'smart 模式的粒度（缺省 medium）'
        },
        hint: { type: 'string', description: 'smart 模式：点名要拆哪些部件' },
        model: { type: 'string', description: '3D 模型 id（models_list 查询）' },
        providerInstanceId: { type: 'string', description: '提供商实例 id' },
        name: { type: 'string', description: '产物显示名' },
        extraParams: { type: 'object', description: '低频参数透传，合并进底层生成输入' }
      },
      required: []
    },
    handler: async (args) => {
      assertProjectOpen()
      const input = {
        ...cacheOnlyGenExtraParams(args),
        ...resolveModel3dSourceInput(args),
        model: optionalString(args, 'model'),
        providerInstanceId: optionalString(args, 'providerInstanceId'),
        mode: readEnumArg(args, 'mode', ['mesh', 'smart'] as const),
        granularity: readEnumArg(args, 'granularity', ['simple', 'balanced', 'detailed'] as const),
        splitByConnectivity:
          typeof args.splitByConnectivity === 'boolean' ? args.splitByConnectivity : undefined,
        smartGranularity: readEnumArg(args, 'smartGranularity', [
          'coarse',
          'medium',
          'fine'
        ] as const),
        hint: optionalString(args, 'hint'),
        name: optionalString(args, 'name')
      }
      const result = await runGenActivity(
        'segment_model3d',
        activityTitle(input.name, `3D 模型拆分（${input.mode || 'mesh'}）`),
        input.model,
        () => modelProviderFacade.segmentModel3d(input),
        (r) => ({ assetId: r.assetId, relativePath: liveAssetRelativePath(r) }),
        undefined,
        (r) => ({
          kind: 'segmentModel3d',
          nodeId: 'mcp',
          request: {
            model: input.model,
            providerInstanceId: input.providerInstanceId,
            name: input.name
          },
          response: {
            model: r.model,
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
        taskId: result.taskId,
        mode: result.mode,
        parts: result.parts
      }
    }
  },
  {
    name: 'post_process_model3d',
    title: '3D 模型加工',
    description:
      '对 3D 模型做后续加工，产物落 `Cache/Models`（不自动进资产库）。按 `op` 分流：' +
      '`rigCheck`（**免费**，检查能否绑骨 + 推荐骨架类型，**无产物**）、' +
      '`retopology`（重拓扑：`smart` v2 智能 / `basic` v1 减面，可给 `faceLimit` 目标面数、`quad` 四边面、`bake` 烘焙贴图）、' +
      '`meshComplete`（部件补全：`partNames` 点名要补的部件、省略=全部；`completionMode` 为 ai_completion / quick_cap）、' +
      '`retarget`（动画重定向：给 `animation` 单个或 `animations` 多个预设动作 id，动作用 `list_model3d_animations` 查；**必须传上一个绑骨或拆件任务的 `providerTaskId`**）、' +
      '`convert`（格式转换：`format` 必填 GLTF / FBX / USDZ / OBJ / STL / 3MF，另有贴图尺寸与格式、FBX 预设、pivot 归底、UV 打包、朝向、压平底部等）、' +
      '`texture`（重绘贴图）。' +
      '**能力按供应商矩阵过滤**：Tripo 支持 8 项、Meshy 支持 5 项，做不到的组合上游会明确报错。**部件补全只吃拆件任务 id、动画重定向只吃绑骨任务 id**，task id 属于别家时会退回「上传模型换公网 URL」。' +
      '源模型给 `assetId` 或 `modelUrl`；**给工程内文件需要先配置对象存储**。',
    inputSchema: {
      type: 'object',
      properties: {
        op: {
          type: 'string',
          enum: ['rigCheck', 'retopology', 'meshComplete', 'retarget', 'convert', 'texture'],
          description: '要做的加工类型'
        },
        assetId: { type: 'string', description: '源 3D 模型资产 id（与 modelUrl 二选一）' },
        modelUrl: { type: 'string', description: '公网可访问的模型直链（与 assetId 二选一）' },
        providerTaskId: {
          type: 'string',
          description:
            '上游任务 id：meshComplete 用拆件任务的、retarget 用绑骨任务的（见 rig_model3d / segment_model3d 返回的 taskId）'
        },
        partNames: {
          type: 'array',
          items: { type: 'string' },
          description: 'meshComplete：要补全的部件名（省略 = 全部）'
        },
        completionMode: {
          type: 'string',
          enum: ['ai_completion', 'quick_cap'],
          description: 'meshComplete：补全模式（缺省 ai_completion）'
        },
        retopologyMode: {
          type: 'string',
          enum: ['smart', 'basic'],
          description: 'retopology：算法档位（缺省 smart = v2.0 智能；basic = v1.0 基础减面）'
        },
        faceLimit: { type: 'number', description: 'retopology：目标面数' },
        quad: { type: 'boolean', description: 'retopology：输出四边面' },
        bake: { type: 'boolean', description: 'retopology：把贴图烘焙到低模（默认 true）' },
        animation: {
          type: 'string',
          description: 'retarget：单个预设动作 id（与 animations 互斥）'
        },
        animations: {
          type: 'array',
          items: { type: 'string' },
          description: 'retarget：多个预设动作 id（与 animation 互斥）'
        },
        actionIds: {
          type: 'array',
          items: { type: 'number' },
          description: 'retarget：Meshy 动作库的 action id'
        },
        outFormat: {
          type: 'string',
          enum: ['glb', 'fbx'],
          description: 'retarget：输出格式（缺省 glb）'
        },
        bakeAnimation: { type: 'boolean', description: 'retarget：把动画烘焙进模型（仅 glb）' },
        exportWithGeometry: {
          type: 'boolean',
          description: 'retarget：是否带几何导出（默认 true）'
        },
        animateInPlace: { type: 'boolean', description: 'retarget：原地播放（默认 false）' },
        format: {
          type: 'string',
          enum: ['GLTF', 'FBX', 'USDZ', 'OBJ', 'STL', '3MF'],
          description: 'convert：目标格式（必填）'
        },
        textureSize: { type: 'number', description: 'convert：输出贴图尺寸（默认 4096）' },
        textureFormat: { type: 'string', description: 'convert：贴图图片格式（默认 JPEG）' },
        fbxPreset: {
          type: 'string',
          enum: ['blender', '3dsmax', 'mixamo', 'bake_scale'],
          description: 'convert：FBX 兼容预设（默认 blender）'
        },
        pivotToCenterBottom: { type: 'boolean', description: 'convert：pivot 移到模型底部中心' },
        packUv: { type: 'boolean', description: 'convert：统一打包 UV' },
        exportVertexColors: {
          type: 'boolean',
          description: 'convert：导出顶点色（仅 OBJ / GLTF）'
        },
        exportOrientation: {
          type: 'string',
          enum: ['+x', '-x', '+y', '-y'],
          description: 'convert：导出朝向（前向轴）'
        },
        flattenBottom: { type: 'boolean', description: 'convert：压平底部（打印件常用）' },
        scaleFactor: { type: 'number', description: 'convert：导出缩放系数' },
        withAnimation: { type: 'boolean', description: 'convert：保留骨骼与动画数据' },
        model: { type: 'string', description: '3D 模型 id（models_list 查询）' },
        providerInstanceId: { type: 'string', description: '提供商实例 id' },
        name: { type: 'string', description: '产物显示名' },
        extraParams: { type: 'object', description: '低频参数透传，合并进底层生成输入' }
      },
      required: ['op']
    },
    handler: async (args) => {
      assertProjectOpen()
      const op = readString(args, 'op')
      if (!POST_PROCESS_OPS.includes(op as Model3dPostProcessOp)) {
        throw new Error(`不支持的 op：「${op}」（可选 ${POST_PROCESS_OPS.join(' / ')}）`)
      }
      const input: Model3dPostProcessInput = {
        ...cacheOnlyGenExtraParams(args),
        ...resolveModel3dSourceInput(args),
        op: op as Model3dPostProcessOp,
        providerTaskId: optionalString(args, 'providerTaskId'),
        model: optionalString(args, 'model'),
        providerInstanceId: optionalString(args, 'providerInstanceId'),
        partNames: readStringList(args, 'partNames'),
        completionMode: readEnumArg(args, 'completionMode', [
          'ai_completion',
          'quick_cap'
        ] as const),
        retopologyMode: readEnumArg(args, 'retopologyMode', ['smart', 'basic'] as const),
        faceLimit: optionalNumber(args, 'faceLimit'),
        quad: typeof args.quad === 'boolean' ? args.quad : undefined,
        bake: typeof args.bake === 'boolean' ? args.bake : undefined,
        animation: optionalString(args, 'animation'),
        animations: readStringList(args, 'animations'),
        actionIds: readNumberList(args, 'actionIds'),
        outFormat: readEnumArg(args, 'outFormat', ['glb', 'fbx'] as const),
        bakeAnimation: typeof args.bakeAnimation === 'boolean' ? args.bakeAnimation : undefined,
        exportWithGeometry:
          typeof args.exportWithGeometry === 'boolean' ? args.exportWithGeometry : undefined,
        animateInPlace: typeof args.animateInPlace === 'boolean' ? args.animateInPlace : undefined,
        format: readEnumArg(args, 'format', MODEL3D_CONVERT_FORMATS),
        textureSize: optionalNumber(args, 'textureSize'),
        textureFormat: readEnumArg(args, 'textureFormat', [
          'JPEG',
          'PNG',
          'WEBP',
          'BMP',
          'DPX',
          'HDR',
          'OPEN_EXR',
          'TARGA',
          'TIFF'
        ] as const),
        fbxPreset: readEnumArg(args, 'fbxPreset', [
          'blender',
          '3dsmax',
          'mixamo',
          'bake_scale'
        ] as const),
        pivotToCenterBottom:
          typeof args.pivotToCenterBottom === 'boolean' ? args.pivotToCenterBottom : undefined,
        packUv: typeof args.packUv === 'boolean' ? args.packUv : undefined,
        exportVertexColors:
          typeof args.exportVertexColors === 'boolean' ? args.exportVertexColors : undefined,
        exportOrientation: readEnumArg(args, 'exportOrientation', [
          '+x',
          '-x',
          '+y',
          '-y'
        ] as const),
        flattenBottom: typeof args.flattenBottom === 'boolean' ? args.flattenBottom : undefined,
        scaleFactor: optionalNumber(args, 'scaleFactor'),
        withAnimation: typeof args.withAnimation === 'boolean' ? args.withAnimation : undefined,
        name: optionalString(args, 'name')
      }
      const result = await runGenActivity(
        'post_process_model3d',
        activityTitle(input.name, `3D 加工（${op}）`),
        input.model,
        () => modelProviderFacade.postProcessModel3d(input),
        // 绑骨检查没有产物，不报 assetId（否则活动卡会指向不存在的资产）
        (r) =>
          isProducingPostProcess(r)
            ? { assetId: r.assetId, relativePath: liveAssetRelativePath(r) }
            : {},
        undefined,
        (r) => ({
          kind: 'postProcessModel3d',
          nodeId: 'mcp',
          request: {
            model: input.model,
            providerInstanceId: input.providerInstanceId,
            name: input.name,
            // 复用 input 字段记录 op，便于运行日志复盘（该调用没有 prompt）
            input: op
          },
          response: isProducingPostProcess(r)
            ? {
                model: r.model,
                assetId: r.assetId,
                relativePath: liveAssetRelativePath(r)
              }
            : {}
        })
      )
      // rigCheck 无产物，不广播
      if (isProducingPostProcess(result)) {
        broadcastAsset(result.assetId)
        return { ...result, relativePath: liveAssetRelativePath(result) }
      }
      return result
    }
  },
  {
    name: 'list_model3d_animations',
    title: '3D 动作库',
    description:
      '列出当前 3D 供应商可用的**预设动作**（Meshy 动作库），供 `post_process_model3d` 的 `op: retarget` 选动作。只读操作，不产生费用、不写资产。',
    inputSchema: {
      type: 'object',
      properties: {
        search: {
          type: 'string',
          description: '按动作名 / key 子串过滤（Meshy 服务端支持），不传则返回全部'
        },
        providerInstanceId: { type: 'string', description: '提供商实例 id' }
      },
      required: []
    },
    handler: async (args) => {
      assertProjectOpen()
      const actions = await modelProviderFacade.listModel3dAnimations({
        search: optionalString(args, 'search'),
        providerInstanceId: optionalString(args, 'providerInstanceId')
      })
      return { total: actions.length, actions }
    }
  },
  {
    name: 'extract_video_frames',
    title: '视频抽帧落盘',
    description:
      '把视频按时间**均匀**抽帧并**落盘为工程内图片**，返回相对路径清单（可直接当参考图喂给图片 / 视频工具）。' +
      `帧数上限 ${VIDEO_FRAME_EXTRACT_MAX}。**只想看一眼请用 grab_video_frames** —— 它把画面直接回给你，不占工程文件。` +
      '源视频给 `assetId`（视频资产）或 `relativePath`（工程内视频）。**依赖 ffmpeg**：缺失时返回空数组（不报错），可用 `app_status` 查运行时状态。',
    inputSchema: {
      type: 'object',
      properties: {
        assetId: { type: 'string', description: '视频资产 id（与 relativePath 二选一）' },
        relativePath: { type: 'string', description: '工程内视频相对路径（与 assetId 二选一）' },
        count: {
          type: 'number',
          description: `抽帧数量（默认 4，上限 ${VIDEO_FRAME_EXTRACT_MAX}）；给 1 时直接取首帧`
        }
      },
      required: []
    },
    handler: async (args) => {
      assertProjectOpen()
      const relativePath = resolveVideoRelativePath(args)
      const rawCount = optionalNumber(args, 'count')
      const count = Math.min(
        Math.max(1, rawCount === undefined ? 4 : Math.floor(rawCount)),
        VIDEO_FRAME_EXTRACT_MAX
      )
      const frames = await projectService.extractVideoFrames(relativePath, count)
      return {
        relativePath,
        requestedCount: count,
        frameCount: frames.length,
        frames,
        ...(frames.length
          ? {}
          : {
              note: '没有抽到帧：通常是 ffmpeg 缺失或视频文件不可读（可用 app_status 查 ffmpeg 状态）'
            })
      }
    }
  },
  {
    name: 'grab_video_frames',
    title: '视频按时间点取帧看画面',
    description:
      '按**指定时间点**取视频画面并**随本次响应回给你看**（不需要落盘、不产生工程文件）。' +
      `一次最多回 ${VIDEO_FRAME_MAX_IMAGES} 张，超出的会丢弃并在返回里说明。` +
      '这是 agent 做视觉判断的正路（甄别时间段发生了什么、找可用镜头、印证字幕与画面对不对得上）；' +
      '要拿到**可复用的图片文件**请用 extract_video_frames。**依赖 ffmpeg**，缺失时返回空数组。',
    inputSchema: {
      type: 'object',
      properties: {
        assetId: { type: 'string', description: '视频资产 id（与 relativePath 二选一）' },
        relativePath: { type: 'string', description: '工程内视频相对路径（与 assetId 二选一）' },
        timestamps: {
          type: 'array',
          items: { type: 'number' },
          description: `要取画面的时间点（秒），如 [0, 2.5, 7]。最多 ${VIDEO_FRAME_MAX_IMAGES} 个`
        },
        width: { type: 'number', description: '取帧宽度（像素，缺省由服务决定）；调小可省带宽' }
      },
      required: ['timestamps']
    },
    handler: async (args) => {
      assertProjectOpen()
      const relativePath = resolveVideoRelativePath(args)
      const timestamps = readNumberList(args, 'timestamps').filter((t) => t >= 0)
      if (!timestamps.length) throw new Error('需要至少一个非负的时间点（秒）')
      const width = optionalNumber(args, 'width')
      const grabbed = await projectService.grabVideoFramesAtTimestamps(relativePath, timestamps, {
        ...(width !== undefined ? { width } : {})
      })
      const kept = grabbed.slice(0, VIDEO_FRAME_MAX_IMAGES)
      return {
        relativePath,
        requestedCount: timestamps.length,
        frameCount: kept.length,
        frames: kept.map((frame) => ({ timeSec: frame.timeSec })),
        ...(kept.length < grabbed.length
          ? {
              note: `只回前 ${VIDEO_FRAME_MAX_IMAGES} 张（共取到 ${grabbed.length} 张）：多帧会挤爆上下文，剩余时间点请分批再取`
            }
          : {}),
        ...(grabbed.length
          ? {}
          : { note: '没有取到画面：通常是时间点超出视频时长，或 ffmpeg 缺失' }),
        mcpImages: kept.map((frame) => frame.dataUrl)
      }
    }
  },
  {
    name: 'detect_video_keyframes',
    title: '视频关键帧时间点',
    description:
      '列出视频的**关键帧时间点**（秒），用于挑「切点」附近的位置再做精确取帧（配合 `grab_video_frames`）。' +
      '只读轻量操作（走 ffprobe，不逐帧解码），不产生文件、不写资产。**依赖 ffprobe**，缺失或文件不可读时返回空数组。',
    inputSchema: {
      type: 'object',
      properties: {
        assetId: { type: 'string', description: '视频资产 id（与 relativePath 二选一）' },
        relativePath: { type: 'string', description: '工程内视频相对路径（与 assetId 二选一）' }
      },
      required: []
    },
    handler: async (args) => {
      assertProjectOpen()
      const relativePath = resolveVideoRelativePath(args)
      const keyframes = await projectService.detectVideoKeyframes(relativePath)
      return {
        relativePath,
        count: keyframes?.length ?? 0,
        keyframes: keyframes ?? [],
        ...(keyframes?.length ? {} : { note: '没有读到关键帧：ffprobe 缺失或视频不可读' })
      }
    }
  },
  {
    name: 'analyze_video_beats',
    title: '视频人/物打点',
    description:
      '对视频抽帧做**逐帧目标检测**，产出人 / 物出现的时间段（beat tags：总时长、逐帧样本、聚合片段、各类别摘要），' +
      '并把结果写回该视频资产的 meta（应用界面同步显示）。用于按"谁在什么时候出现"来粗剪 —— 比让模型看完整条视频便宜得多。' +
      '**只吃视频资产 id**（结果要写回资产，工程内相对路径没有可写的落点）。' +
      '**耗时且依赖 ffmpeg + 检测模型**：缺失时返回 `status: skipped` 与 `error` / `install` 说明，而不是抛错。',
    inputSchema: {
      type: 'object',
      properties: {
        assetId: { type: 'string', description: '视频资产 id（必填）' }
      },
      required: ['assetId']
    },
    handler: async (args) => {
      assertProjectOpen()
      const assetId = readString(args, 'assetId')
      const tags = await projectService.analyzeVideoBeats(assetId)
      if (!tags) {
        throw new Error(
          `打点失败：${assetId} 不是视频资产、没有可用文件路径，或分析被跳过（可用 app_status 查 ffmpeg / 检测模型状态）`
        )
      }
      return { assetId, ...tags }
    }
  },
  // ── 应用界面录制（教学视频的素材来源）────────────────────────────────────────
  // 访问等级：下面三个是 **write**（录制会占用真实时间与磁盘、并把屏幕内容录进文件，
  // 必须在 Plan 模式确认后 / Craft 模式下执行）；`screen_record_status` 是 read，见 mcpModeAccess。
  {
    name: 'screen_record_start',
    title: '开始录制应用界面',
    description:
      '开始录制**应用自己的窗口**（不是桌面；无系统指针——指针/高亮由 HUD+screen_record_step 画）。\n' +
      '**单次连续拍完**：本工具之后须在同一轮工具链里连续 step→短动作→…→screen_record_wait→screen_record_stop→tutorial_compose；' +
      '点运行后必须 wait(graph-idle) 等到结果上屏再 screen_record_stop。**禁止**录制中调 task_run / generate_*；' +
      '演示用 step 的 doClick/doDblClick/doContextMenu/fillText（口播=画面）。**禁止**自行反复 start/stop 连出多条废片。\n' +
      '标准流程：空白画布 → start → 右键创建→双击改参→运行→wait→讲结果 → screen_record_stop → tutorial_compose(steps 含 narration)。\n' +
      '加载技能 tutorial-recording。只在用户明确要求录制时调用；需可用 ffmpeg。',
    inputSchema: {
      type: 'object',
      properties: {
        fps: {
          type: 'number',
          description: '采样帧率（1~15，默认 10）；画面没变化时不会写盘，所以高一点不等于文件更大'
        },
        maxSeconds: {
          type: 'number',
          description: `最长录制秒数（默认与上限都是 ${SCREEN_RECORD_LIMITS.maxSeconds}），到点自动停`
        }
      }
    },
    handler: async (args) => {
      assertProjectOpen()
      const fps = optionalNumber(args, 'fps')
      const maxSeconds = optionalNumber(args, 'maxSeconds')
      const result = await startScreenRecording({
        ...(typeof fps === 'number' ? { fps } : {}),
        ...(typeof maxSeconds === 'number' ? { maxSeconds } : {})
      })
      if (!result.ok) throw new Error(screenRecordReasonText(result.reasonKey ?? 'badOptions'))
      return {
        recording: true,
        fps: result.fps,
        maxSeconds: result.maxSeconds,
        adjusted: result.adjusted ?? [],
        hint: '同一轮工具链里连续：step→短动作→…→stop→tutorial_compose；勿停顿等下一轮对话，勿 task_run。'
      }
    }
  },
  {
    name: 'screen_record_step',
    title: '推进录制步骤（标题 / 高亮 / 指针）',
    description:
      '在录制中标记「现在讲这一步」：HUD 显示短 **title** + 详细 **caption** 字卡（都烧进画面）、可选高亮、可选合成指针（`click: true` 涟漪）。' +
      '教学视频每步**必须**给详细 caption（一句完整操作说明）；title 只做短标签（≤12 字）。' +
      '口播 narration 在 `tutorial_compose.steps` 里按 index 传入（可与 caption 相同）；本工具不播音频。' +
      '调用后**立刻**执行真实 MCP 动作；编码会把静止段封顶到约 2 秒，但仍应单次连续拍完，勿跨多轮空等。' +
      '时间戳是旁白/字幕的权威对齐依据。' +
      '**高亮请传 tutorialId**（如 graph-selected-node / graph-toolbar）：服务端用 `ui_bounds` 自动填 focus+cursor，勿手写坐标（易偏、易超框）。',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'HUD 短标题（≤12 字）' },
        caption: {
          type: 'string',
          description: '详细字卡（必填推荐）：烧进画面 + 写入 alignment 作字幕；缺省与 title 相同'
        },
        tutorialId: {
          type: 'string',
          description: `优先：按 data-tutorial-id 自动取高亮框与指针（${TUTORIAL_UI_ID_HINT}）`
        },
        /** true：在 HUD 打点后真实点击 tutorialId（字卡说「点击生成」时必开，目标 graph-run） */
        doClick: {
          type: 'boolean',
          description:
            'true：高亮后立刻真实点击 tutorialId（说「点击运行/生成」时必须 true + tutorialId=graph-run）'
        },
        doDblClick: {
          type: 'boolean',
          description:
            'true：双击 tutorialId（打开指令面板 / 记事本 / dive 工具 / 漫画页等专属 UI；tutorialId=graph-selected-node）'
        },
        doContextMenu: {
          type: 'boolean',
          description:
            'true：右键 tutorialId（说「右键画布添加节点」时必须 true + tutorialId=graph-canvas）'
        },
        fillText: {
          type: 'string',
          description: '写入输入框：指令用 graph-instruction-input，记事本用 graph-notepad-input'
        },
        focus: {
          type: 'object',
          description: '可选：高亮框（窗口内容坐标，CSS 像素）；有 tutorialId 时通常不必传',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
            width: { type: 'number' },
            height: { type: 'number' }
          },
          required: ['x', 'y', 'width', 'height']
        },
        cursor: {
          type: 'object',
          description: '可选：把合成指针移到该坐标；有 tutorialId 时默认指到中心',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
            click: { type: 'boolean', description: 'true 时画一次点击涟漪' }
          },
          required: ['x', 'y']
        }
      },
      required: ['title']
    },
    handler: async (args) => {
      const title = readString(args, 'title')
      const caption = optionalString(args, 'caption')
      let focus = readFocusArg(args, 'focus')
      let cursor = readCursorArg(args, 'cursor')
      const tutorialId = optionalString(args, 'tutorialId')
      const doClick = args.doClick === true
      const doDblClick = args.doDblClick === true
      const doContextMenu = args.doContextMenu === true
      const fillText = optionalString(args, 'fillText')
      const actionCount = [doClick, doDblClick, doContextMenu].filter(Boolean).length
      if (actionCount > 1) {
        throw new Error('doClick / doDblClick / doContextMenu 同一 step 只能选一个')
      }
      const wantsPointer = doClick || doDblClick || doContextMenu
      /**
       * 「口播=画面」的硬约束：这些动作都靠 `tutorialId` 定位。
       *
       * 不传 tutorialId 时旧实现直接跳过动作、却照样回 ok —— 于是 agent 以为点了，
       * 成片里什么都没发生（"嘴上说点了、其实没点"）。宁可报错，让它补上 tutorialId。
       */
      assertTutorialActionTarget({ wantsPointer, fillText, tutorialId })
      if (tutorialId) {
        const bounds = await queryTutorialUiBounds(tutorialId)
        if (!bounds) {
          throw new Error(
            `找不到教学控件「${tutorialId}」（约定：${TUTORIAL_UI_ID_HINT}；请确认对应界面已打开）`
          )
        }
        if (!focus) {
          focus = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
        }
        if (!cursor) {
          cursor = {
            x: bounds.centerX,
            y: bounds.centerY,
            ...(wantsPointer ? { click: true as const } : {})
          }
        } else if (wantsPointer && !cursor.click) {
          cursor = { ...cursor, click: true }
        }
      }
      const result = stepScreenRecording({
        title,
        ...(caption ? { caption } : {}),
        ...(focus ? { focus } : {}),
        ...(cursor ? { cursor } : {})
      })
      if (!result.ok) throw new Error(screenRecordReasonText(result.reasonKey ?? 'notRecording'))
      let acted: { ok: boolean; tutorialId?: string; kind?: string } | undefined
      if (wantsPointer && tutorialId) {
        const kind = doDblClick ? 'dblclick' : doContextMenu ? 'contextmenu' : 'click'
        const clickResult = await clickTutorialUi(tutorialId, { kind })
        if (!clickResult.ok) {
          throw new Error(
            clickResult.reasonKey === 'notFound'
              ? `找不到可点击控件「${tutorialId}」（说点击生成前须先 node_select 让 graph-run 出现；说双击开面板须先选中节点；说右键添加须画布已打开）`
              : `交互「${tutorialId}」失败`
          )
        }
        acted = { ok: true, tutorialId, kind }
        // 等 Vue 渲染：右键菜单 / 指令面板 / dive 异步视图 / 运行→停止钮
        await sleep(doDblClick ? 280 : doContextMenu ? 120 : 80)
        if (doClick && tutorialId === 'graph-run') {
          const next = await queryTutorialUiBounds('graph-run')
          if (next) {
            patchScreenRecordingHud({
              focus: { x: next.x, y: next.y, width: next.width, height: next.height },
              cursor: { x: next.centerX, y: next.centerY }
            })
          }
        }
        if (doDblClick) {
          // 指令面板 / 记事本 / dive（含漫画页与节点工具浮窗）
          let focused = false
          for (let attempt = 0; attempt < 4 && !focused; attempt++) {
            if (attempt > 0) await sleep(150)
            for (const id of TUTORIAL_POST_DBLCLICK_FOCUS_IDS) {
              const panel = await queryTutorialUiBounds(id)
              if (!panel) continue
              patchScreenRecordingHud({
                focus: { x: panel.x, y: panel.y, width: panel.width, height: panel.height },
                cursor: { x: panel.centerX, y: panel.centerY }
              })
              focused = true
              break
            }
          }
        }
        if (doContextMenu) {
          const menu = await queryTutorialUiBounds('graph-ctx-menu')
          if (menu) {
            patchScreenRecordingHud({
              focus: { x: menu.x, y: menu.y, width: menu.width, height: menu.height },
              cursor: { x: menu.centerX, y: menu.centerY }
            })
          }
        }
      }
      let filled: { ok: boolean; tutorialId?: string } | undefined
      if (fillText != null && tutorialId) {
        const fillResult = await fillTutorialUi(tutorialId, fillText)
        if (!fillResult.ok) {
          throw new Error(
            fillResult.reasonKey === 'notFound'
              ? `找不到可填写控件「${tutorialId}」（先双击打开指令面板或记事本）`
              : `填写「${tutorialId}」失败：控件内没有输入框`
          )
        }
        filled = { ok: true, tutorialId }
      }
      return {
        ok: true,
        index: result.index,
        ...(acted ? { acted } : {}),
        ...(filled ? { filled } : {})
      }
    }
  },
  {
    name: 'screen_record_wait',
    title: '录制中等待画面就绪',
    description:
      '**必须在 screen_record_start 之后、stop 之前调用**。继续录制的同时阻塞等待条件满足：' +
      '`until:"graph-idle"` = 工具栏不再显示停止钮（节点跑完、预览上屏）。' +
      '点运行后**禁止立刻 stop**：先 wait 等到结果出现，再 step 高亮 graph-selected-node，最后 stop。' +
      '静止段会被编码封顶，等待本身不会把成片拖成冻帧。',
    inputSchema: {
      type: 'object',
      properties: {
        until: {
          type: 'string',
          enum: ['graph-idle'],
          description: 'graph-idle：等到图运行结束（结果上屏）'
        },
        timeoutMs: {
          type: 'number',
          description: '最长等待毫秒（默认 120000，上限 180000）'
        },
        title: { type: 'string', description: '可选：等待期间 HUD 短标题' },
        caption: { type: 'string', description: '可选：等待期间字卡' }
      },
      required: ['until']
    },
    handler: async (args) => {
      if (!isScreenRecording()) {
        throw new Error('当前没有进行中的录制：先 screen_record_start')
      }
      const until = readString(args, 'until')
      if (until !== 'graph-idle') {
        throw new Error('until 仅支持 graph-idle')
      }
      const rawTimeout = optionalNumber(args, 'timeoutMs')
      const timeoutMs = Math.max(
        1000,
        Math.min(typeof rawTimeout === 'number' ? rawTimeout : 120_000, 180_000)
      )
      const title = optionalString(args, 'title')
      const caption = optionalString(args, 'caption')
      if (title || caption) {
        patchScreenRecordingHud({
          ...(title ? { title } : {}),
          ...(caption ? { caption } : {})
        })
      }
      // 点运行后状态可能尚未翻到 playing：先等到「正在跑」或短暂宽限
      const start = Date.now()
      let sawRunning = await queryGraphIsRunning()
      while (!sawRunning && Date.now() - start < 2500) {
        await sleep(120)
        sawRunning = await queryGraphIsRunning()
      }
      while (await queryGraphIsRunning()) {
        if (Date.now() - start > timeoutMs) {
          throw new Error(`等待图运行结束超时（>${timeoutMs}ms）：结果可能未上屏`)
        }
        await sleep(250)
      }
      // 再留一点时间给预览贴图刷新进画面
      await sleep(400)
      return {
        ok: true,
        until,
        waitedMs: Date.now() - start,
        sawRunning
      }
    }
  },
  {
    name: 'screen_record_stop',
    title: '结束录制并编码成 MP4',
    description:
      '结束录制、把帧序列编码成 MP4，落盘到工程缓存目录 Cache/Videos（**不自动进资产库**，与 generate_video 同一口径，避免对话流出现重复卡）。' +
      '返回 `relativePath`、实际写盘帧数与丢弃的空闲帧数，以及每步的 `alignment`（含 title/caption 与起止秒）——' +
      '教学成片必须接着调 **tutorial_compose**，且 **steps 里按 index 传入 narration**（可与 caption 相同），否则成片无配音；不要手排 timeline_edit。' +
      '空闲帧会合并，静止段在成片里**封顶约 2 秒**（墙钟更长也会被裁短）；alignment 已映到压缩时间轴。',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      assertProjectOpen()
      // 走旁路活动：对话流才能收到 relativePath 并出预览卡（含「保存到资产库」）
      return runGenActivity(
        'screen_record_stop',
        '界面录制',
        undefined,
        async () => {
          const result = await stopScreenRecording()
          if (!result.ok) throw new Error(screenRecordReasonText(result.reasonKey, result.params))
          return result
        },
        (r) => ({ relativePath: r.relativePath })
      )
    }
  },
  {
    name: 'screen_record_status',
    title: '查询录制状态',
    description:
      '当前是否在录制、已采样多少帧、已经标记了哪些步骤（含各自的时间戳）。开始录制前想确认有没有遗留的录制、或中途想核对步骤，都可以查它。',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => screenRecordingStatus()
  },
  {
    name: 'ui_bounds',
    title: '查询教学控件位置',
    description:
      '按稳定 `data-tutorial-id` 查询主窗口内**可见**控件的矩形（相对窗口内容区 CSS 像素）。' +
      '通常不必手抄坐标：`screen_record_step` 直接传 `tutorialId` 即可自动填 focus/cursor。' +
      `可用 id：${TUTORIAL_UI_ID_HINT}（讲节点时优先 graph-selected-node）。只读，不改工程。`,
    inputSchema: {
      type: 'object',
      properties: {
        tutorialId: {
          type: 'string',
          description: `控件 id（${TUTORIAL_UI_ID_HINT}）`
        }
      },
      required: ['tutorialId']
    },
    handler: async (args) => {
      const tutorialId = readString(args, 'tutorialId')
      const bounds = await queryTutorialUiBounds(tutorialId)
      if (!bounds) {
        throw new Error(
          `找不到教学控件「${tutorialId}」（约定：${TUTORIAL_UI_ID_HINT}；请确认对应界面已打开）`
        )
      }
      return bounds
    }
  },
  {
    name: 'ui_click',
    title: '点击教学控件',
    description:
      '在 `data-tutorial-id` 控件中心派发真实 pointer 事件。' +
      `可用 id：${TUTORIAL_UI_ID_HINT}。教学优先用 screen_record_step 的 doClick/doDblClick/doContextMenu（会同步 HUD）；本工具作补刀。`,
    inputSchema: {
      type: 'object',
      properties: {
        tutorialId: {
          type: 'string',
          description: `控件 id（${TUTORIAL_UI_ID_HINT}）`
        },
        kind: {
          type: 'string',
          enum: ['click', 'dblclick', 'contextmenu'],
          description: 'click=单击；dblclick=双击开指令面板；contextmenu=右键开添加菜单'
        }
      },
      required: ['tutorialId']
    },
    handler: async (args) => {
      const tutorialId = readString(args, 'tutorialId')
      const kindRaw = optionalString(args, 'kind')
      const kind =
        kindRaw === 'dblclick' || kindRaw === 'contextmenu' || kindRaw === 'click'
          ? kindRaw
          : 'click'
      const result = await clickTutorialUi(tutorialId, { kind })
      if (!result.ok) {
        throw new Error(
          result.reasonKey === 'notFound'
            ? `找不到教学控件「${tutorialId}」（约定：${TUTORIAL_UI_ID_HINT}）`
            : `点击教学控件「${tutorialId}」失败`
        )
      }
      return result
    }
  },
  {
    name: 'tutorial_compose',
    title: '教学视频一键合成',
    description:
      '把 `screen_record_stop` 的录屏 MP4 + alignment 与每步口播（narration）合成成片：' +
      '自动 create screenplay → 铺 video/voice 轨 → 导出到 Cache/Videos（不自动进资产库）。' +
      '**steps 必传**：每项含 index（对齐 alignment）+ narration（口播，可与 caption 同文）；缺 narration 的步骤会用 caption/title 兜底，但教学场景应显式给口播。' +
      '**旁白长度由音频真实时长决定**：取「步骤窗口 / 音频」较大者，长句不会被截断；' +
      '**声轨顺序排布、绝不重叠**：口播比步骤间隔长时，后一条会往后顺延（画面落后于旁白），' +
      '顺延量在返回的 `narrationShiftedSec`（> 0 就说明该缩短口播、或录制时在每步之间多停留一会儿）。' +
      '画面至少铺到最后一个旁白说完（末尾定格或黑尾，但不吞口播）。' +
      '画面里已有 title/caption 字卡，所以**默认不再加字幕轨**（`subtitles: true` 才加，加了就是同文叠字）。' +
      '返回里带 `narration[]`（每步窗口/音频时长/延长了多少）与 `recordingDurationSec`，便于自查节奏。' +
      '对话流出预览卡；入库由用户点「保存到资产库」。不要手排 timeline_edit。',
    inputSchema: {
      type: 'object',
      properties: {
        recordingRelativePath: {
          type: 'string',
          description: 'screen_record_stop 返回的工程内相对路径'
        },
        alignment: {
          type: 'array',
          description: 'screen_record_stop 返回的 alignment 原样传入',
          items: { type: 'object' }
        },
        steps: {
          type: 'array',
          description:
            '每步：index 对齐 alignment.index；narration 口播长句；caption 字幕（缺省=narration）；' +
            'voiceRelativePath 可直接给旁白跳过 TTS；**sfxRelativePath 给「这一步被演示的那个音效」**' +
            '（如 Cache/Sfx/xxx.mp3）—— 讲音效生成的教程不给它，观众就听不到被演示的音效',
          items: {
            type: 'object',
            properties: {
              index: { type: 'number' },
              narration: { type: 'string' },
              caption: { type: 'string' },
              voiceRelativePath: { type: 'string' },
              sfxRelativePath: {
                type: 'string',
                description: '被演示的音效的工程内相对路径（铺到 sfx 轨，起点与这步口播对齐）'
              },
              voice: { type: 'string' },
              model: { type: 'string' },
              providerInstanceId: { type: 'string' }
            }
          }
        },
        name: { type: 'string', description: '成片显示名' },
        export: { type: 'boolean', description: '是否导出成片（默认 true）' },
        subtitles: {
          type: 'boolean',
          description:
            '是否额外烧一条字幕轨（默认 false：录屏 HUD 已把 title/caption 烧进画面，再加就是叠字）'
        },
        targetPath: {
          type: 'string',
          description: '成片绝对路径（缺省写 Cache/Videos/tutorial-*.mp4）'
        }
      },
      required: ['recordingRelativePath', 'alignment']
    },
    handler: async (args) => {
      assertProjectOpen()
      const recordingRelativePath = readString(args, 'recordingRelativePath')
      const alignment = readTutorialAlignment(args.alignment)
      const steps = readTutorialComposeSteps(args.steps)
      const name = optionalString(args, 'name')
      const targetPath = optionalString(args, 'targetPath')
      const doExport = args.export !== false
      const withSubtitles = args.subtitles === true
      return runGenActivity(
        'tutorial_compose',
        name || '教学视频',
        undefined,
        () =>
          composeTutorialVideo({
            recordingRelativePath,
            alignment,
            ...(steps.length ? { steps } : {}),
            ...(name ? { name } : {}),
            export: doExport,
            subtitles: withSubtitles,
            ...(targetPath ? { targetPath } : {})
          }),
        (r) => ({
          relativePath: r.relativePath,
          ...(r.relativePath ? { relativePaths: [r.relativePath] } : {})
        })
      )
    }
  }
]

function readTutorialAlignment(value: unknown): StepAlignment[] {
  if (!Array.isArray(value) || !value.length) {
    throw new Error('缺少 alignment：请把 screen_record_stop 返回的 alignment 原样传入')
  }
  return value.map((item, at) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`alignment[${at}] 不是对象`)
    }
    const row = item as Record<string, unknown>
    const index = Number(row.index)
    const startSec = Number(row.startSec)
    const endSec = Number(row.endSec)
    if (!Number.isFinite(index) || !Number.isFinite(startSec) || !Number.isFinite(endSec)) {
      throw new Error(`alignment[${at}] 缺少合法的 index / startSec / endSec`)
    }
    return {
      index,
      title: typeof row.title === 'string' ? row.title : '',
      caption: typeof row.caption === 'string' ? row.caption : '',
      startSec,
      endSec
    }
  })
}

function readTutorialComposeSteps(
  value: unknown
): import('./tutorialComposeService').TutorialComposeStepInput[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map((row) => ({
      ...(typeof row.index === 'number' && Number.isFinite(row.index) ? { index: row.index } : {}),
      ...(typeof row.narration === 'string' ? { narration: row.narration } : {}),
      ...(typeof row.caption === 'string' ? { caption: row.caption } : {}),
      ...(typeof row.voiceRelativePath === 'string'
        ? { voiceRelativePath: row.voiceRelativePath }
        : {}),
      ...(typeof row.sfxRelativePath === 'string' ? { sfxRelativePath: row.sfxRelativePath } : {}),
      ...(typeof row.voice === 'string' ? { voice: row.voice } : {}),
      ...(typeof row.model === 'string' ? { model: row.model } : {}),
      ...(typeof row.providerInstanceId === 'string'
        ? { providerInstanceId: row.providerInstanceId }
        : {})
    }))
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

/** 读取可选数字参数；非有限数值返回 undefined */
function optionalNumber(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
    return Number(value)
  }
  return undefined
}

/**
 * 「口播=画面」的硬约束：`doClick` / `doDblClick` / `doContextMenu` / `fillText` 都靠
 * `tutorialId` 定位，缺了它就没有任何**可见**动作。
 *
 * 旧实现静默跳过动作却照样回 ok：agent 以为点了，成片里什么都没发生。宁可报错让它补上。
 * 抽成导出函数是为了能被真正测到（这段逻辑在工具 handler 深处，没法单独调用）。
 */
export function assertTutorialActionTarget(input: {
  wantsPointer: boolean
  fillText: string | null | undefined
  tutorialId?: string | undefined
}): void {
  if ((input.wantsPointer || input.fillText != null) && !input.tutorialId) {
    throw new Error(
      'doClick / doDblClick / doContextMenu / fillText 必须同时给 tutorialId：没有它就没有任何可见动作（约定：' +
        TUTORIAL_UI_ID_HINT +
        '）'
    )
  }
}

/** 录制失败的原因键 → 给模型看的可执行说明（主进程不产出最终 UI 文案，这里只服务 Agent） */
function screenRecordReasonText(
  reasonKey: string,
  params?: Record<string, string | number>
): string {
  const map: Record<string, string> = {
    alreadyRecording: '已经在录制中：先 screen_record_stop 结束上一段，再开始新的',
    startingRecording: '正在启动录制（探测 ffmpeg），稍等一下再试',
    stopping:
      '上一段录制正在编码收尾：等它结束（HUD 会显示「编码中」），或稍后用 screen_record_status 取结果',
    badOptions: '录制参数不合法',
    fpsInvalid: 'fps 不合法：给 1~15 的数字',
    durationInvalid: `maxSeconds 不合法：给 1~${SCREEN_RECORD_LIMITS.maxSeconds} 的数字`,
    projectNotOpen: '没有打开工程：录制产物要落进工程，请先打开或新建工程',
    ffmpegMissing: '未找到可用的 ffmpeg：请在设置页一键安装后重试（录制结果的编码需要它）',
    ffmpegInstalling: 'ffmpeg 正在安装中，稍等片刻再开始录制',
    lowDiskSpace: '临时目录可用空间不足：请清理磁盘后重试（最坏情况要写约 2GB 帧文件）',
    noTargetWindow: '找不到可录制的主窗口',
    notRecording: '当前没有在录制',
    stepTitleRequired: '步骤标题不能为空',
    emptyRecording: '这一段没有录到有效画面（每次抓帧都失败或写盘全失败），没有产出',
    encodeFailed: `编码失败：${params?.detail ?? '未知原因'}`
  }
  return map[reasonKey] ?? `录制失败：${reasonKey}`
}

/** 读取高亮框参数（四个数字都要有；缺任何一个就当没给，而不是给个歪框） */
function readFocusArg(args: Record<string, unknown>, key: string): ScreenRecordFocus | undefined {
  const value = args[key]
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const obj = value as Record<string, unknown>
  const nums = (['x', 'y', 'width', 'height'] as const).map((k) =>
    typeof obj[k] === 'number' ? (obj[k] as number) : Number(obj[k])
  )
  if (nums.some((n) => !Number.isFinite(n))) return undefined
  const [x, y, width, height] = nums as [number, number, number, number]
  if (width <= 0 || height <= 0) return undefined
  return { x, y, width, height }
}

/** 读取合成指针参数（x/y 必需；click 可选） */
function readCursorArg(args: Record<string, unknown>, key: string): ScreenRecordCursor | undefined {
  const value = args[key]
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const obj = value as Record<string, unknown>
  const x = typeof obj.x === 'number' ? obj.x : Number(obj.x)
  const y = typeof obj.y === 'number' ? obj.y : Number(obj.y)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined
  return { x, y, ...(obj.click === true ? { click: true } : {}) }
}

/**
 * 读取数字数组参数（去重）；非数组返回空数组。
 *
 * 与 `readStringList` 同形，但用于 Meshy 动作库的 `actionIds`（数字 id）。
 * 接受数字字符串，因为不少 MCP 客户端会把 JSON 数字序列化成字符串。
 */
function readNumberList(args: Record<string, unknown>, key: string): number[] {
  const value = args[key]
  if (!Array.isArray(value)) return []
  const out: number[] = []
  for (const item of value) {
    const n = typeof item === 'number' ? item : typeof item === 'string' ? Number(item) : NaN
    if (Number.isFinite(n) && !out.includes(n)) out.push(n)
  }
  return out
}

/**
 * 读取枚举参数；不在白名单内（含缺省）返回 undefined，让上游用自己的默认值。
 *
 * 不用 `readString` 那套"必填报错"：这些枚举几乎都有服务端默认值，
 * 传错时**回落到默认**比报错更符合生成工具的既有体验（数值仍由上游夹紧）。
 */
function readEnumArg<T extends string>(
  args: Record<string, unknown>,
  key: string,
  allowed: readonly T[]
): T | undefined {
  const value = args[key]
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return (allowed as readonly string[]).includes(trimmed) ? (trimmed as T) : undefined
}

/**
 * 读取 3D 加工类工具的源模型入参。
 *
 * 上游只认**公网 URL**：给 `assetId` 时取它的工程内相对路径，由 facade 走
 * `ensureRemoteMediaUrl` 上传对象存储（未配置会明确报错）；给 `modelUrl` 则直接用，
 * **不需要对象存储** —— 这条差别对用户是真金白银的配置成本，所以工具描述里都写明了。
 */
function resolveModel3dSourceInput(args: Record<string, unknown>): {
  modelUrl?: string
  modelRelativePath?: string
} {
  const modelUrl = optionalString(args, 'modelUrl')
  if (modelUrl) return { modelUrl }
  const assetId = optionalString(args, 'assetId')
  if (!assetId) return {}
  const asset = findAssetOrThrow(assetId)
  const relativePath = asset.relativePath?.trim()
  if (!relativePath) throw new Error(`资产没有可用的文件路径：${assetId}`)
  return { modelRelativePath: relativePath }
}

/**
 * 判断一次 3D 加工是否产出了资产。
 *
 * `Model3dPostProcessResult` 是联合类型：`rigCheck` 只回检测结论（可绑骨？推荐骨架？），
 * **没有 assetId / relativePath / model**；其余 op 才有。
 *
 * 谓词不能写成 `Extract<..., { assetId: string }>` —— `op` 在产出分支里本身就是联合
 * （`meshComplete | retopology | ...`），`Extract` 会求成 `never`，于是守卫失效、
 * 后面的字段访问依旧报错（踩过）。写成"排除 rigCheck"才真正收窄。
 */
function isProducingPostProcess(
  result: Model3dPostProcessResult
): result is Exclude<Model3dPostProcessResult, { op: 'rigCheck' }> {
  return result.op !== 'rigCheck'
}

/**
 * 解析视频帧类工具的源视频：优先 `relativePath`，其次 `assetId` 反查资产路径。
 *
 * 三个取帧 / 关键帧工具都同时接受两者（与 `transcribe_audio` / `audio_separate`
 * 的既有口径一致：给 assetId 更方便，给路径更直接）。
 */
function resolveVideoRelativePath(args: Record<string, unknown>): string {
  const relativePath = optionalString(args, 'relativePath')
  if (relativePath) return relativePath
  const assetId = optionalString(args, 'assetId')
  if (!assetId) throw new Error('需要 assetId 或 relativePath 指定一个视频')
  const asset = findAssetOrThrow(assetId)
  const resolved = asset.relativePath?.trim()
  if (!resolved) throw new Error(`资产没有可用的文件路径：${assetId}`)
  return resolved
}

/**
 * 读取 PLY 泼溅的分辨率档。
 *
 * 与图节点 `spatialWorldExportResolution` 同一组取值；非法值一律回落 `full_res`
 * （与执行器里那段判断同口径，见 shared/graph/execute/spatialWorldExport.ts）。
 */
function readExportResolution(args: Record<string, unknown>): SpatialWorldExportResolution {
  const raw = args.resolution
  return raw === '500k' || raw === '150k' || raw === '100k' ? raw : 'full_res'
}

/**
 * decide 工具的证据来源：把工程内文本资产读成 state。
 * 单份（assetId）与多份（assetIds）合并；先 assetId，再 assetIds 的顺序，
 * 每条带资产名与相对路径，便于决策模型引用来源。读不到正文的资产直接跳过。
 */
async function readDecisionEvidence(
  args: Record<string, unknown>
): Promise<DecisionEvidenceItem[]> {
  const ids = [optionalString(args, 'assetId')?.trim(), ...readStringList(args, 'assetIds')].filter(
    (id): id is string => Boolean(id)
  )
  if (!ids.length) return []

  const evidence: DecisionEvidenceItem[] = []
  const seen = new Set<string>()
  for (const assetId of ids) {
    if (seen.has(assetId)) continue
    seen.add(assetId)
    const asset = findAssetOrThrow(assetId)
    const relativePath = asset.relativePath?.trim()
    if (!relativePath) continue
    const content = await projectService.readProjectFile(relativePath)
    if (!content?.trim()) continue
    evidence.push({
      title: asset.name?.trim() || asset.id,
      path: relativePath,
      text: content
    })
  }
  return evidence
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
  if (!track)
    throw new Error(`${label} 缺少 track（video / overlay / voice / subtitle / music / sfx）`)
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
  const extra =
    args.extraParams && typeof args.extraParams === 'object'
      ? { ...(args.extraParams as Record<string, unknown>) }
      : {}
  delete extra.graphBinding
  return extra
}

/**
 * `generate_*` 工具的低频透传参数：在 `extraParamsOf` 之上再剥掉 `outputDir` / `folderId`。
 *
 * 对话生成的产物一律只落缓存目录（Cache/Images、Videos、Voices、Music、Models），
 * 是否入库由用户在产物卡上点「保存到资产库」按钮决定。`inputSchema` 已不再暴露这两个字段，
 * 但 `extraParams` 是自由对象，能把它们夹带进来——展开后恰好命中
 * `attachExternalGeneratedFile` 的「落 Assets/ 即登记资产」分支，所以这里必须再兜一道。
 */
function cacheOnlyGenExtraParams(args: Record<string, unknown>): Record<string, unknown> {
  const extra = extraParamsOf(args)
  delete extra.outputDir
  delete extra.folderId
  // 防御 harness 缓存旧 schema 仍传 outputDir/folderId 顶层字段：input 字面量构造
  // 时虽然不展开这两个键，但 `GenerateImageInput` / `GenerateMusicInput` 等类型允许
  // 它们存在——这里直接 mutate args 抹掉，杜绝一切泄露。
  delete args.outputDir
  delete args.folderId
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

/** mcp.json 载荷：外部 MCP 客户端只信这个文件（见 docs/MCP.md），每个字段都要与既成事实一致 */
export interface McpConfigPayload {
  port: number
  token: string
  pid: number
  version: string
}

/**
 * 由**正在监听的 socket** 生成 mcp.json 载荷，而不是由"打算用的端口"生成。
 *
 * 为什么必须问 `listener.address()`：候选端口会因被占用而顺延，设置里填的端口、上次用过的端口
 * 都只是偏好；外部客户端不会去扫端口，只会照文件里写的连，写错就是连不上。
 * `pid` 同理必须是持有该监听 socket 的进程，否则排查连接问题时会被引到一个不相干的进程上。
 *
 * 返回 null = 这个 socket 不是 TCP（unix socket）或已经关闭：没有任何端口可对外公布，
 * 调用方必须放弃写文件，而不是退化成写期望端口。
 */
export function mcpConfigPayloadFor(
  listener: Pick<Server, 'address'>,
  token: string,
  pid: number,
  version: string
): McpConfigPayload | null {
  const address = listener.address()
  if (!address || typeof address === 'string') return null
  return { port: address.port, token, pid, version }
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

/**
 * 解析请求头里的对话模式上下文（`X-AIArt-Mode` / `X-AIArt-Run-Id`）。
 * 只有对话面板那条 mcp-client 配置会带（writeDshConfig 每轮重写）；stdio 桥 / HTTP 直连的
 * 外部 Agent 不带 → 返回空上下文 = 完全不做模式限制。
 */
function requestModeContext(req: IncomingMessage): { mode?: ChatMode; runId?: string } {
  const rawMode = req.headers[MCP_MODE_HEADER]
  const value = Array.isArray(rawMode) ? rawMode[0] : rawMode
  if (!value) return {}
  const rawRunId = req.headers[MCP_RUN_ID_HEADER]
  const runId = (Array.isArray(rawRunId) ? rawRunId[0] : rawRunId)?.trim()
  return { mode: normalizeChatMode(value), ...(runId ? { runId } : {}) }
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
    else if (typeof value === 'number' || typeof value === 'boolean' || value === null)
      out[key] = value
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
      ...(entry.error !== undefined ? { error: truncateText(String(entry.error), 300) } : {})
    })
    appendFileSync(
      path,
      `${line}
`
    )
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

/**
 * 对话面板每次运行的授权状态：runId → 模式 + 用户是否已确认计划。
 * deepseekHarnessService 在 spawn 前登记、用户经 ask_user 确认计划时置位、进程退出时释放；
 * 工具面按请求头里的 runId 回查这里（模式与 runId 由 writeDshConfig 写进 mcp-client 的请求头）。
 * 用 Map 而不是全局开关：面板会话与外部 Agent 共用同一个服务，模式必须绑在请求上。
 */
const harnessRunAccess = new Map<string, { mode: ChatMode; confirmed: boolean }>()

/** 登记一次对话运行的授权状态（spawn dsh 前调用） */
export function registerHarnessRunAccess(runId: string, mode: ChatMode): void {
  harnessRunAccess.set(runId, { mode, confirmed: false })
}

/** 用户确认了本次运行的计划：本条消息内放行写 / 生成类工具（Plan 模式） */
export function confirmHarnessRunAccess(runId: string): void {
  const state = harnessRunAccess.get(runId)
  if (state) state.confirmed = true
}

/** 运行结束（进程退出 / 中止）释放登记，避免 Map 随会话累积 */
export function releaseHarnessRunAccess(runId: string): void {
  harnessRunAccess.delete(runId)
}

/**
 * 常驻 harness 当前回合的模式授权（内存 + active-run.json）。
 * MCP headers 在进程启动时冻住，每轮改 mode/runId 靠这里，而不是 sticky headers。
 */
function activeHarnessRunPath(): string {
  return join(app.getPath('userData'), 'dsh-harness', 'active-run.json')
}

export function setActiveHarnessRun(runId: string, mode: ChatMode): void {
  setActiveHarnessRunState(runId, mode)
  try {
    const dir = join(app.getPath('userData'), 'dsh-harness')
    mkdirSync(dir, { recursive: true })
    writeFileSync(activeHarnessRunPath(), JSON.stringify({ runId, mode, ts: Date.now() }), 'utf8')
  } catch {
    /* 写盘失败不影响内存授权 */
  }
}

export function clearActiveHarnessRun(): void {
  clearActiveHarnessRunState()
  try {
    const path = activeHarnessRunPath()
    if (existsSync(path)) rmSync(path, { force: true })
  } catch {
    /* ignore */
  }
}

/** 把请求头里的模式 + runId 折算成授权视图；无模式声明的请求（外部客户端）不做任何限制 */
export function resolveMcpAccessView(ctx?: McpRequestContext): McpAccessView {
  return resolveHarnessAwareAccessView(ctx, harnessRunAccess)
}

function accessViewFor(ctx?: McpRequestContext): McpAccessView {
  return resolveMcpAccessView(ctx)
}

/** 被模式拦截的调用同样进审计：模型试图越权本身就是值得回查的线索 */
function auditDeniedToolCall(name: string, args: Record<string, unknown>, reason: string): void {
  appendMcpAudit({ tool: name, ok: false, durationMs: 0, args, error: reason })
  console.log(`[mcp] tool ${name} denied by chat mode: ${reason}`)
}

/**
 * 本服务对外声明的版本号（启动时从 package 版本填入）。
 *
 * 声明在协议处理器**之前**：处理器在模块加载时创建，其 `serverInfo` 的 getter 会闭包引用
 * 这个绑定；若把它写在处理器之后，`const` 的暂时性死区会让模块加载直接抛错。
 */
let mcpServerVersion = '0.0.0'

/**
 * 第三方 MCP 服务的中转协议处理器（每个外部服务一份，按需创建）。
 *
 * 为什么不让 dsh **直连**外部服务：直连会绕开既有护栏。dsh 每轮下发的
 * `X-AIArt-Mode` / `X-AIArt-Run-Id` 只有在本应用的端点上才看得见，Ask / Plan 的
 * 工具收窄与拒绝因此才管得住第三方工具；直连时那些头会被发给外部服务（对方多半
 * 直接忽略），护栏等于不存在。
 *
 * 另外两件事也必须在应用侧做：
 * - **工具名命名空间**：外部工具名可能与本应用内建的工具重名，重名后模型调的是谁不确定
 * - **超时与错误归一**：外部服务的失败要变成一句人话，而不是把栈信息丢给模型
 */
const externalMcpHandlers = new Map<string, ReturnType<typeof createMcpProtocolHandler>>()
/**
 * 建处理器时用的那份配置的指纹。
 *
 * 为什么要记：用户在插件市场里改地址 / 命令只走 `setSettings`，**不会重启 MCP 服务**。
 * 若一直复用旧处理器，改完的地址要等下次重启才生效 —— 表现是「测试连接通过了，
 * 对话里却还连着旧地址」。所以命中缓存前先比对，变了就把处理器与会话一起丢掉重建。
 */
const externalMcpHandlerConfig = new Map<string, string>()

/** 影响连接本身的字段（凭据也算：换了 token 必须重连） */
function externalMcpConfigKey(server: ExternalMcpServer): string {
  return JSON.stringify([
    server.transport,
    server.url,
    server.command,
    server.args,
    server.env,
    server.headers,
    server.timeoutMs
  ])
}

function externalMcpHandlerFor(
  server: ExternalMcpServer
): ReturnType<typeof createMcpProtocolHandler> {
  const configKey = externalMcpConfigKey(server)
  const cached = externalMcpHandlers.get(server.id)
  if (cached && externalMcpHandlerConfig.get(server.id) === configKey) return cached
  if (cached) {
    // 配置变了：连会话一起丢，否则仍会用旧地址 / 旧凭据
    dropExternalMcpSession(server.id)
    externalMcpHandlers.delete(server.id)
    externalMcpHandlerConfig.delete(server.id)
  }
  const handler = createMcpProtocolHandler({
    serverInfo: {
      name: `aiartengine-${server.id}`,
      title: server.name,
      get version() {
        return mcpServerVersion
      }
    },
    listTools: async (ctx) => {
      const view = accessViewFor(ctx)
      const session = getExternalMcpSession(server)
      const tools = await session.listTools()
      return (
        tools
          .map((tool) => ({
            ...tool,
            name: namespaceExternalMcpTool(server.id, tool.name)
          }))
          // 同一套可见性规则：Ask 模式外部服务也一个工具都看不到
          .filter((tool) => isToolVisible(toolAccessOf(tool.name), view))
      )
    },
    callTool: async (name, args, callCtx) => {
      /**
       * 第三方工具的副作用等级：名字必带 `<id>__` 前缀，不可能命中内建的只读 / 生成清单，
       * 因此 `toolAccessOf` 会把它归为 **write** —— 这正是想要的保守取值。
       * 外部服务到底只读与否本应用无从得知，按 write 归类意味着：
       * Ask 模式全禁、Plan 模式在用户确认计划前不放行。
       * （将来若要放开外部只读工具，得让用户显式声明该工具只读，而不是在这里猜。）
       */
      const denial = denialReasonForTool(toolAccessOf(name), accessViewFor(callCtx))
      if (denial) {
        auditDeniedToolCall(name, args, denial)
        return { error: denial }
      }
      const bare = stripExternalMcpToolPrefix(server.id, name)
      if (bare === null) {
        return { error: `工具名不属于该服务：${name}` }
      }
      try {
        const result = await getExternalMcpSession(server).callTool(bare, args)
        return { result: normalizeExternalToolResult(result) }
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    }
  })
  externalMcpHandlers.set(server.id, handler)
  externalMcpHandlerConfig.set(server.id, configKey)
  return handler
}

/**
 * 外部工具结果归一：`{content:[…]}` 摊平成模型好读的文本。
 *
 * 外部服务返回的是 MCP 的 content 数组（可能混着 text / image / resource）。
 * 整段 JSON 丢给模型会浪费上下文且难读，所以文本项直接拼接，非文本项标注类型。
 */
function normalizeExternalToolResult(result: unknown): unknown {
  if (!result || typeof result !== 'object') return result ?? null
  const content = (result as { content?: unknown }).content
  if (!Array.isArray(content)) return result
  const texts: string[] = []
  const others: string[] = []
  for (const item of content) {
    if (!item || typeof item !== 'object') continue
    const entry = item as Record<string, unknown>
    if (entry.type === 'text' && typeof entry.text === 'string') {
      texts.push(entry.text)
    } else if (typeof entry.type === 'string') {
      others.push(`[${entry.type}]`)
    }
  }
  const text = texts.join('\n').trim()
  if (others.length === 0) return text || null
  return [text, `（另有非文本内容：${others.join(' ')}）`].filter(Boolean).join('\n')
}

/** MCP 协议处理（streamable HTTP /mcp 端点与 stdio 桥共用同一工具面） */
const handleMcpProtocolMessage = createMcpProtocolHandler({
  serverInfo: {
    name: 'aiartengine',
    title: 'AiArtEngine',
    get version() {
      return mcpServerVersion
    }
  },
  listTools: (ctx) => {
    const view = accessViewFor(ctx)
    return TOOL_DEFS.filter(({ name }) => isToolVisible(toolAccessOf(name), view)).map(
      ({ name, title, description, inputSchema }) => ({
        name,
        title,
        description,
        inputSchema
      })
    )
  },
  callTool: async (name, args, callCtx) => {
    // 模式硬约束：Ask 不给任何工具、Plan 未确认前只放只读——工具清单里没有的东西被调用（模型幻觉 /
    // 陈旧清单）同样要挡住，否则收窄 tools/list 只是「看不见」，不是「做不到」
    const denial = denialReasonForTool(toolAccessOf(name), accessViewFor(callCtx))
    if (denial) {
      auditDeniedToolCall(name, args, denial)
      return { error: denial }
    }
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

/**
 * Blender 工具面的协议处理：挂在**同一个 HTTP 服务**的另一个路径上（`/mcp/blender`）。
 *
 * 复用主工具面的全部治理：模式收窄（Ask 不给工具、Plan 未确认前只留只读）、越权拒绝、
 * 审计日志、图片回传（截图走 image content）。差别只在「谁来执行」——这里把命令交给
 * blenderMcpService，由它走 TCP 直连 addon，不再有 Python / uv / 子进程。
 */
const handleBlenderMcpProtocolMessage = createMcpProtocolHandler({
  serverInfo: {
    name: 'blender',
    title: 'Blender',
    get version() {
      return mcpServerVersion
    }
  },
  listTools: (ctx) => {
    const view = accessViewFor(ctx)
    return blenderToolDescriptors().filter(({ name }) =>
      isToolVisible(blenderToolAccessOf(name), view)
    )
  },
  callTool: async (name, args, callCtx) => {
    const spec = blenderToolSpec(name)
    if (!spec) return { error: `未知工具：${name}` }
    // 与主工具面同一套硬约束：工具清单里没有的东西被调用（模型幻觉 / 陈旧清单）也要挡住
    const denial = denialReasonForTool(spec.access, accessViewFor(callCtx))
    if (denial) {
      auditDeniedToolCall(name, args, denial)
      return { error: denial }
    }
    if (callCtx?.signal?.aborted) return { error: '调用已取消' }
    const startedAt = Date.now()
    const outcome = await runBlenderTool(spec, args)
    appendMcpAudit({
      tool: `blender.${name}`,
      ok: !outcome.error,
      durationMs: Date.now() - startedAt,
      args,
      error: outcome.error
    })
    return outcome
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
    endpoint: `http://127.0.0.1:${mcpPort}/mcp`,
    blenderBridge: getBlenderMcpInfo()
  }
}

/**
 * dsh 侧 Blender 工具面接入信息：启用且主服务在跑时给出端点，否则 null（不写第二段 mcp-client）。
 *
 * 与旧实现的关键差别：**同端口、同 token**。Blender 工具面现在是主 MCP 服务上的一个路径
 * （`/mcp/blender`），不再是独立端口 + 独立 token + 独立子进程，因此这里只回端点——
 * dsh 复用 STUDIO_MCP_TOKEN，桥已经不需要自己的凭据了。
 */
export function getBlenderMcpEndpoint(): string | null {
  if (!server || !mcpPort) return null
  if (!blenderMcpEnabled()) return null
  return `http://127.0.0.1:${mcpPort}${BLENDER_MCP_PATH}`
}

/** Blender 工具面状态：供 getMcpServerInfo().blenderBridge 与 IPC 处理器共用（同步读缓存） */
export function getBlenderMcpInfo(): McpBlenderBridgeInfo {
  const link = blenderAddonLink()
  return {
    enabled: link.enabled,
    mounted: !!server && !!mcpPort && link.enabled,
    endpoint: mcpPort ? `http://127.0.0.1:${mcpPort}${BLENDER_MCP_PATH}` : '',
    serverHost: link.host,
    serverPort: link.port,
    safeMode: link.safeMode,
    connected: link.connected,
    blenderVersion: link.blenderVersion,
    addonVersion: link.addonVersion,
    protocolVersion: link.protocolVersion,
    lastError: link.lastError,
    lastCheckedAt: link.lastCheckedAt
  }
}

/** Cook / 作业入口：等探活完成再读状态，避免首次拿到 connected:false 空缓存 */
export async function getBlenderMcpInfoFresh(): Promise<McpBlenderBridgeInfo> {
  await probeBlenderAddon()
  return getBlenderMcpInfo()
}

/** 设置面板：应用 Blender 配置（落盘 + 断开重连 + 立即探活），并回一份带端点的完整状态 */
export async function applyBlenderMcpSettings(
  input: McpBlenderRestartInput
): Promise<McpBlenderBridgeInfo> {
  await restartBlenderMcp(input)
  return getBlenderMcpInfo()
}
/**
 * 启动工具服务。
 *
 * @param preferredPort 调用方（设置面板热重启）指定的期望端口，仅作第一个候选；实际端口一律
 *   以绑定结果为准（见 mcpConfigPayloadFor）。
 */
export async function startMcpServer(preferredPort?: number): Promise<void> {
  if (server) return
  // 只有拿到单实例锁的主实例才有资格起工具服务、写 mcp.json（入口 src/main/index.ts 在 ready
  // 之前就 requestSingleInstanceLock()）。
  //
  // 为什么必须挡这一下：单实例锁的输家（同 userData 下已有实例在跑）照样会跑完 whenReady ——
  // 它发现首选端口被占着，就顺延到下一个空闲端口、把 mcp.json 覆盖成自己的 pid + 端口，随后
  // app.quit() 生效、进程退出。于是文件指向一个已死进程和没人监听的端口，外部客户端照它连接
  // 必然失败（实机复现：文件 {port:43111,pid:25344}，真正在听的却是 43110 的另一个实例）。
  // 拿不到锁 = 本进程注定退出：不起服务，也绝不覆盖别人写好的连接信息。
  if (!app.hasSingleInstanceLock()) {
    console.warn(
      '[mcp] 本进程未持有单实例锁（同 userData 下已有实例在运行），跳过工具服务启动，不写 mcp.json'
    )
    return
  }
  // 录制自动收尾（到时长/字节上限、或窗口被关）也要出对话预览卡：
  // 那条路径没有工具调用在等返回值，所以由服务层回调进来补一次旁路活动。
  setScreenRecordFinishListener((result) => {
    if (!result.ok) return
    void runGenActivity(
      'screen_record_stop',
      '界面录制',
      undefined,
      async () => result,
      (r) => ({ relativePath: r.relativePath })
    )
  })
  const stored = readStoredMcpConfig()
  mcpServerVersion = String(updateService.getCurrentVersion())
  initMcpAuditDir()
  // token 持久复用：HTTP 直连模式下客户端配置的 header 才能保持有效；
  // 要重置可删除 mcp.json 后重启应用。进程内已有的 token 优先——设置面板换 token 时是先把新值
  // 交给本函数，不能被文件里的旧 token 盖回去。
  mcpToken = mcpToken || stored.token || randomUUID()
  // 端口偏好：优先调用方指定的端口，其次上次真正绑上的端口（HTTP 直连配置不变），再扫默认段
  const preferred = preferredPort || Number(process.env.AIAE_MCP_PORT) || stored.port
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
      // 端口取 socket 的既成事实：候选端口顺延过、期望端口落空时，文件也必须说出真正在听的端口；
      // pid 记的是本进程（就是这个监听 socket 的持有者），客户端排查时不会指向空处。
      const payload = server
        ? mcpConfigPayloadFor(server, mcpToken, process.pid, updateService.getCurrentVersion())
        : null
      if (payload) {
        mcpConfigPath = mcpConfigFile()
        mkdirSync(app.getPath('userData'), { recursive: true })
        writeFileSync(mcpConfigPath, JSON.stringify(payload, null, 2))
      } else {
        // 理论上不可达（TCP 监听成功必有端口）。宁可服务照跑、不写文件，也不能往文件里塞一个
        // 没验证过的端口，把外部客户端指到没人监听的地方。
        mcpConfigPath = ''
        console.error('[mcp] 监听 socket 没有可公布的 TCP 端口，已跳过写 mcp.json')
      }
      console.log(
        `[mcp] tool server ready at http://127.0.0.1:${mcpPort} (config: ${mcpConfigPath || '未写'})`
      )
      console.log(
        `[mcp] blender tools at http://127.0.0.1:${port}${BLENDER_MCP_PATH}` +
          '（addon 连接按需建立，无需子进程）'
      )
      return
    }
  }
  console.error(`[mcp] 候选端口均被占用（${candidates.join(', ')}），工具服务未启动`)
}

/** 关闭运行中的 MCP 服务（保留 mcp.json：token 跨重启复用，端口偏好也在下次启动时被读到） */
async function closeMcpServer(): Promise<void> {
  if (!server) return
  // 先断 addon 连接：Blender 工具面挂在同一个 server 上，避免它比 server 活得久
  stopBlenderMcp()
  // 第三方会话同理：并进来的 stdio 子进程不能比 server 活得久，否则重启会留下孤儿进程
  closeAllExternalMcpSessions()
  externalMcpHandlers.clear()
  externalMcpHandlerConfig.clear()
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
  // token 与期望端口都在进程内交给 startMcpServer，不再"先落盘再启动"：
  // 那时 nextPort 还只是期望值，写进 mcp.json 就等于对外公布一个尚未绑定（甚至可能绑不上）的
  // 端口——候选顺延或全部被占时，文件说的就是假地址，外部客户端照它连必然失败。
  // 文件只由 startMcpServer 在绑定成功后按 socket 实际端口写一次。
  mcpToken = nextToken
  await closeMcpServer()
  await startMcpServer(nextPort)
  return getMcpServerInfo()
}

export function stopMcpServer(): void {
  if (!server) return
  stopBlenderMcp()
  // 关掉第三方会话：不关的话并进来的 stdio 子进程会变成孤儿，应用退出后仍留在系统里
  closeAllExternalMcpSessions()
  externalMcpHandlers.clear()
  externalMcpHandlerConfig.clear()
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
  // 应用退出：保留 mcp.json——token 跨重启稳定，桥 / HTTP 直连配置持续有效。
  // 文件描述的是**最近一次成功绑定**：进程退出后 port/pid 就成了历史记录（桥会先探活再连，
  // 拿不到就提示"应用没启动或端口变了"），这里不删也不改，避免把 token 一起丢掉。
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

  if (url === '/mcp') {
    await serveMcpEndpoint(req, res, handleMcpProtocolMessage)
    return
  }

  /**
   * Blender 工具面：与主工具面同端口、不同路径。
   * 用路径而不是独立端口/独立 token/独立进程，是为了让「端口被占用 / token 过期 /
   * 子进程没起来」这三类旧故障整体消失（旧实现各有一份，排查要串联三处日志）。
   */
  if (url === BLENDER_MCP_PATH) {
    if (!blenderMcpEnabled()) {
      sendJson(res, 403, { ok: false, error: 'Blender 工具面已在设置中禁用' })
      return
    }
    await serveMcpEndpoint(req, res, handleBlenderMcpProtocolMessage)
    return
  }

  /**
   * 第三方 MCP 服务中转：`/mcp/ext/<id>`，与 Blender 工具面同一个套路（同端口、按路径分流）。
   *
   * 走应用自己的端点而不是让 dsh 直连外部服务，是为了让模式护栏与工具命名空间
   * 都留在应用侧（见 externalMcpHandlerFor 的说明）。
   */
  const externalId = externalMcpIdFromPath(url)
  if (externalId) {
    const found = settingsService.get().externalMcp.find((item) => item.id === externalId)
    const configured = found ? normalizeExternalMcpServer(found) : null
    if (!configured) {
      sendJson(res, 404, { ok: false, error: `未配置的外部 MCP 服务：${externalId}` })
      return
    }
    if (!configured.enabled) {
      sendJson(res, 403, { ok: false, error: `外部 MCP 服务「${configured.name}」已停用` })
      return
    }
    await serveMcpEndpoint(req, res, externalMcpHandlerFor(configured))
    return
  }

  sendJson(res, 404, { ok: false, error: `未知端点：${req.method} ${url}` })
}

/**
 * MCP streamable HTTP 端点的公共管道：POST 单条 JSON-RPC；通知回 202；GET/DELETE 不支持。
 * `/mcp`（应用工具面）与 `/mcp/blender`（Blender 工具面）共用，只差一个协议处理器。
 */
async function serveMcpEndpoint(
  req: IncomingMessage,
  res: ServerResponse,
  handler: (message: unknown, ctx: McpRequestContext) => Promise<Record<string, unknown> | null>
): Promise<void> {
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
    sendJson(res, 400, {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'JSON 解析失败' }
    })
    return
  }
  // 客户端断开连接即视为取消：中止进行中的长任务（如 workflow_plan、长时间 Blender 命令）
  const controller = new AbortController()
  const onClose = (): void => {
    if (!res.writableEnded) controller.abort()
  }
  req.on('close', onClose)
  try {
    const response = await handler(message, {
      signal: controller.signal,
      ...requestModeContext(req)
    })
    if (!response) {
      res.writeHead(202, { 'Content-Type': 'application/json' })
      res.end()
      return
    }
    sendJson(res, 200, response)
  } finally {
    req.off('close', onClose)
  }
}

/** 供测试注入：当前 token（仅测试用途） */
export const __mcpServerTest = {
  getToolNames: () => TOOL_DEFS.map((tool) => tool.name),
  randomToken: randomUUID
}
