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
  MCP_GRAPH_EDIT_SCOPE,
  getNodeCapability,
  getNodeType,
  introspectNodeType,
  listAddableNodeTypes,
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
import { sniffImageMimeFromBytes } from '@shared/media/imageMimeSniff'
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
  getObjectStoragePublicBaseUrl,
  pickActiveObjectStorage
} from '@shared/objectStorage'
import {
  type DecisionEvidenceItem,
  type GenerateDecisionsInput,
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
import { extractWebArticleWithHeadlessBrowser } from './webArticleExtractService'
import { broadcastToAllWindows } from '../broadcast'
import {
  fetchSkillCatalog,
  installSkillFromMarket,
  listInstalledWorkflowDetails,
  uninstallSkillFromMarket
} from './skillMarketService'
import {
  buildStudioNodeCapabilitiesBridge,
  discoverInstalledClaudeSkills
} from './claudeSkillRuntime'
import {
  inspectGitHubSkillSource,
  installGitHubSkills,
  listInstalledGitHubSkillRecords,
  searchOnlineSkills,
  uninstallSkillByName,
  type OnlineSkillSearchItem
} from './githubSkillInstaller'
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
/** 纳入并发闸门的工具（同步等待的耗时生成） */
const GATED_TOOLS = new Set(['task_run', 'decide', 'tutorial_compose'])

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
    name: 'web_extract_article',
    title: '无头浏览器抓取技术文章图文',
    description:
      '在应用主进程内启动本地无头 Chromium 浏览器渲染指定网页 URL（支持掘金、知乎、微信公众号、CSDN、Medium、技术文档站及动态 SPA 页面），自动触发懒加载滚动，按阅读顺序提取文章标题、章节正文、代码块与原位配图上下文，并将文章内的架构图/流程图/代码截图/配图自动下载落盘到当前工程 `Cache/imports/` 目录下。返回结构化 `markdown`（内含 `@Cache/imports/...` 引用）与 `images` 列表（每项含 `relativePath`、`sectionHeading`、`caption`、`contextText`）。提取出的 `relativePath` 可直接作为画布节点的锁定图片素材（`typeId: "asset.image", locked: true, params: { sourceRelativePath: relativePath }`）连入 `output.timeline` 成片时间线，或作为 `asset.video` / `asset.image` 的 `firstFrameImageUrl` / `referenceImageUrls` 参考图生成短视频。',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: '目标网页或技术文章 URL（http:// 或 https://）'
        },
        maxImages: {
          type: 'number',
          description: '最多提取并下载到工程 Cache/imports/ 的文章配图数量（默认 8，上限 16）'
        },
        capturePageScreenshot: {
          type: 'boolean',
          description: '是否额外截取网页首屏高清快照存入 Cache/imports/（默认 false）'
        }
      },
      required: ['url']
    },
    handler: async (args) => {
      assertProjectOpen()
      const url = readString(args, 'url')
      const maxImages = optionalNumber(args, 'maxImages')
      const capturePageScreenshot =
        typeof args.capturePageScreenshot === 'boolean' ? args.capturePageScreenshot : undefined
      const extracted = await runGenActivity(
        'asset_import',
        `无头浏览器抓取文章图文：${url.slice(0, 60)}`,
        undefined,
        async () =>
          extractWebArticleWithHeadlessBrowser({
            url,
            ...(maxImages !== undefined ? { maxImages } : {}),
            ...(capturePageScreenshot !== undefined ? { capturePageScreenshot } : {})
          }),
        (res) => {
          const relativePaths = res.images
            .map((img) => img.relativePath)
            .filter((p): p is string => !!p?.trim())
          if (res.pageScreenshotRelativePath) {
            relativePaths.push(res.pageScreenshotRelativePath)
          }
          return {
            relativePath: relativePaths[0],
            relativePaths
          }
        },
        undefined,
        undefined,
        url
      )
      const imagePaths = extracted.images.map((img) => img.relativePath)
      const visualImages = readVisualCheckImagesForRelativePaths(imagePaths, 3)
      return {
        url: extracted.url,
        title: extracted.title,
        siteName: extracted.siteName,
        author: extracted.author,
        description: extracted.description,
        renderedByHeadlessBrowser: extracted.renderedByHeadlessBrowser,
        markdown: extracted.markdown,
        images: extracted.images,
        ...(extracted.pageScreenshotRelativePath
          ? { pageScreenshotRelativePath: extracted.pageScreenshotRelativePath }
          : {}),
        ...(visualImages.length > 0 ? { mcpImages: visualImages } : {})
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
    name: 'semantic_analyze_video',
    title: '语义分析视频',
    description:
      '对视频资产跑 Semantic Timeline 切镜分析（媒体事实 + 场景切镜 + 关键帧），写入工程 Semantic/<id>/。返回 timelineId 与镜头列表。完整事件/转写需后续步骤。',
    inputSchema: {
      type: 'object',
      properties: {
        assetId: { type: 'string', description: '视频资产 id' },
        vocabulary: {
          type: 'string',
          description: '节拍词表 id，默认 commerce.v1'
        },
        transcribe: {
          type: 'boolean',
          description: '是否调转写模型拿话语证据（默认 true；失败降级并写入 notes）'
        }
      },
      required: ['assetId']
    },
    handler: async (args) => {
      assertProjectOpen()
      const assetId = readString(args, 'assetId')
      const vocabulary = optionalString(args, 'vocabulary') || 'commerce.v1'
      const asset = findAssetOrThrow(assetId)
      if (asset.type !== 'video') throw new Error('assetId must be a video asset')
      const { semanticAnalyzeForGraph } = await import('./semanticTimeline/graphBridge')
      const result = await semanticAnalyzeForGraph({
        sourceAssetId: assetId,
        vocabulary,
        transcribe: args.transcribe !== false,
        separateAudio: true,
        detectEntities: true
      })
      return {
        timelineId: result.timeline.id,
        method: result.method,
        durationSec: result.timeline.evidence.mediaFacts.durationSec,
        fps: result.timeline.evidence.mediaFacts.fps,
        shotCount: result.shots.length,
        eventCount: result.timeline.events.length,
        beatCount: result.timeline.beats.length,
        entityCount: result.timeline.entities.length,
        utteranceCount: result.utterances.length,
        notes: result.notes,
        shots: result.shots.map((s) => ({
          id: s.id,
          start: s.range.start,
          end: s.range.end
        }))
      }
    }
  },
  {
    name: 'semantic_timeline_read',
    title: '读取语义时间线',
    description:
      '读取 Semantic/<timelineId>/timeline.json 摘要：事件、节拍、实体、意图数量与列表。',
    inputSchema: {
      type: 'object',
      properties: {
        timelineId: { type: 'string', description: '语义时间线 id（stl.…）' },
        assetId: {
          type: 'string',
          description: '或传视频资产 id（读其 semanticTimelineId）'
        }
      }
    },
    handler: async (args) => {
      assertProjectOpen()
      const { loadSemanticTimeline } = await import('./semanticTimeline/SemanticTimelineService')
      const root = projectService.getRoot()
      let timelineId = optionalString(args, 'timelineId')
      if (!timelineId) {
        const assetId = optionalString(args, 'assetId')
        if (!assetId) throw new Error('timelineId or assetId required')
        const meta = findAssetOrThrow(assetId)
        timelineId = meta.semanticTimelineId
        if (!timelineId) {
          throw new Error('asset has no semanticTimelineId; run semantic_analyze_video first')
        }
      }
      const doc = loadSemanticTimeline(root, timelineId)
      if (!doc) throw new Error('semantic timeline not found')
      return {
        id: doc.id,
        schema: doc.schema,
        source: doc.source,
        eventCount: doc.events.length,
        beatCount: doc.beats.length,
        entityCount: doc.entities.length,
        intentCount: doc.intents.length,
        events: doc.events.map((e) => ({
          id: e.id,
          label: e.label,
          start: e.timeRange.start,
          end: e.timeRange.end,
          evidence: e.evidence
        })),
        beats: doc.beats.map((b) => ({
          id: b.id,
          type: b.type,
          start: b.timeRange.start,
          end: b.timeRange.end
        }))
      }
    }
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
      '在剧本资产的时间线上增删改片段或一键套用成片模板，支持六类指令按 operations 顺序执行：add（铺素材上轨；每枚给 track 与 durationSec，assetId 会自动补媒体路径与标题，缺 startSec 时自动排到该轨轨尾、多枚依次紧接；若带 transitionType 会自动与前一片段重叠建立转场）/ update（按片段 id 改字段：特效 visualEffect / 滤镜 filterPreset / 12 项色彩调节 / 40 种转场 transitionType / 运镜 cameraMotion / 补间动效 tweenIn·Out·Loop / 关键帧 keyframes / 画面裁剪 cropX·Y·Width·Height / 变速 speed / 音量 / 淡入淡出 / 字幕文本 / 画中画位置；主视频轨片段改 transitionType 或 transitionInSec 时会自动与前一片段建立重叠并涟漪平移后续片段；传 null 表示清除该字段）/ batchUpdate（按 track 或 clipIds 批量更新片段属性，如全轨统一加滤镜、特效、调色或转场）/ applyTemplate（一键套用 12 套剪映风格成片模板 templateId，自动注入特效/滤镜/调色/运镜/转场/字幕预设）/ remove（按 id 删）/ subtitles（把 transcribe_audio 的分段铺成字幕，按配音片段的取段起点对齐；默认替换该配音区间上的旧字幕，mode=append 则只追加）。还可传顶层 settings 修改导出画幅、帧率、字幕样式、混音闪避等全局设置。默认 apply=true 直接生效并实时同步打开的时间线编辑器。',
    inputSchema: {
      type: 'object',
      properties: {
        assetId: { type: 'string', description: '剧本资产 id' },
        nodeId: { type: 'string', description: '时间线节点 id（缺省默认时间线）' },
        operations: {
          type: 'array',
          description: '按顺序执行的编辑指令（若仅修改顶层 settings 可传空数组）',
          items: {
            type: 'object',
            properties: {
              op: {
                type: 'string',
                enum: ['add', 'update', 'batchUpdate', 'applyTemplate', 'remove', 'subtitles'],
                description: '指令类型'
              },
              clips: {
                type: 'array',
                description:
                  'add：要铺的片段。每项需含 track（video / overlay / voice / subtitle / music / sfx）与 durationSec，可用 assetId 或工程内相对路径 relativePath 指定媒体，startSec 缺省排到该轨轨尾；也支持 visualEffect / filterPreset / transitionType / cameraMotion / volume 等全部片段字段',
                items: { type: 'object' }
              },
              gapSec: {
                type: 'number',
                description: 'add：片段之间（以及与轨内既有内容之间）留的空隙秒数，默认 0'
              },
              clipId: { type: 'string', description: 'update：要改的片段 id' },
              track: {
                type: 'string',
                enum: ['video', 'overlay', 'voice', 'subtitle', 'music', 'sfx'],
                description:
                  'batchUpdate：要批量更新的目标轨道（省略且未传 clipIds 时对全部片段生效）'
              },
              templateId: {
                type: 'string',
                description:
                  'applyTemplate：成片模板 ID（high-energy-beat / black-gold-cinema / cyber-neon-drama / fuji-vlog / hk-retro-memory / japanese-fresh-album / noir-documentary / vhs-retro-tape / anime-opening / peach-fashion-lookbook / dune-epic-trailer / vaporwave-party）'
              },
              patch: {
                type: 'object',
                description:
                  'update / batchUpdate：要改的字段（传 null 表示清除）。支持：' +
                  '【特效】visualEffect（none / rgb-glitch / bad-tv / neon-edge / cyber-matrix / pixel-mosaic / camera-shake / earthquake / beat-pulse / soul-out / strobe-flash / pendulum-swing / zoom-burst / dreamy-bloom / gold-sparkle / sunset-leak / neon-halo / blur-focus / tilt-shift / vhs-retro / old-film / dv-cam / posterize-pop / negative-invert / cinema-letterbox / bw-spotlight / thermal-vision / night-vision / split-2h / split-3v / split-4grid）、effectIntensity（0~100）；' +
                  '【滤镜】filterPreset（none / black-gold / teal-orange / cyberpunk / blade-runner / dune-sand / matrix-green / noir-bw / fuji-classic / kodak-portra / agfa-vista / polaroid-fade / hk-retro / vintage-sepia / cream-skin / peach-oolong / cold-porcelain / japanese-fresh / kamakura-sea / emerald-forest / sunset-glow / golden-autumn / nordic-cold / anime-vivid / morandi-gray / vaporwave）、filterIntensity（0~100）；' +
                  '【转场】transitionType（none / dissolve / fade / fadeout / fadein / flash / fadegrays / hblur / distance / smoothleft / smoothright / smoothup / smoothdown / slideleft / slideright / slideup / slidedown / wipeleft / wiperight / wipeup / wipedown / wipetl / wipetr / wipebl / wipebr / circleopen / circleclose / rectcrop / radial / zoomin / pixelize / horzopen / horzclose / vertopen / vertclose / hlslice / hrslice / vuslice / vdslice / squeezeh / squeezev / diagtl / diagbr）、transitionInSec、transitionOutSec；' +
                  '【12项色彩调节】brightness（-0.5~0.5）、contrast（0.5~2）、saturation（0~3）、vibrance（-100~100）、temperature（-100~100）、tint（-100~100）、highlights（-100~100）、shadows（-100~100）、sharpen（0~100）、vignette（0~100）、fade（0~100）、grain（0~100）；' +
                  '【运镜与动效】cameraMotion（none / ken-burns-in / ken-burns-out / pan-left / pan-right / pan-up / pan-down / drift-up-right / handheld-subtle）、tweenIn、tweenInDurationSec、tweenInEase、tweenOut、tweenOutDurationSec、tweenOutEase、tweenLoop、tweenLoopSpeedHz、tweenLoopIntensity、keyframes；' +
                  '【裁剪与几何】cropX（0~0.95）、cropY（0~0.95）、cropWidth（0.05~1）、cropHeight（0.05~1）、overlayX、overlayY、overlayWidth、overlayHeight、overlayRotation、opacity；' +
                  '【时间与音频字幕】startSec、durationSec、sourceOffsetSec、speed（0.25~4）、freezeTailSec（0~30）、volume（0~1）、fadeInSec、fadeOutSec、text、title、textColor、fontSize、stickerId、stickerColor。'
              },
              clipIds: {
                type: 'array',
                items: { type: 'string' },
                description: 'remove / batchUpdate：目标片段 id 列表'
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
        settings: {
          type: 'object',
          description:
            '可选：合并更新成片时间线全局设置（exportWidth / exportHeight / exportFps / exportVideoBitrateKbps / scaleMode(contain|cover|blur) / subtitleFontSize / subtitleYOffset / subtitleColor / subtitleBorderColor / subtitleBorderWidth / subtitleBoxEnabled / subtitleBoxColor / subtitleBoxOpacity / subtitleMotion / mixMasterGain / mixBassGainDb / mixTrebleGainDb / mixCompression / mixAutoDucking / mixDuckingRatio / mixLoudnorm / watermarkEnabled / watermarkSrc / watermarkOpacity / watermarkScale / watermarkPosition）'
        },
        apply: {
          type: 'boolean',
          description:
            '是否写回时间线（默认 true 直接生效并同步打开的时间线编辑器；传 false 仅预演不落盘）'
        }
      },
      required: ['assetId', 'operations']
    },
    handler: async (args) => {
      assertProjectOpen()
      const assetId = readString(args, 'assetId')
      const nodeId = optionalString(args, 'nodeId')
      const { asset, doc } = readTimelineDoc(assetId, nodeId)
      const hasSettingsPatch = Boolean(
        args.settings && typeof args.settings === 'object' && !Array.isArray(args.settings)
      )
      const rows = readTimelineEditRows(args.operations, hasSettingsPatch)
      // 同一批编辑共用一份 id 工厂：新增片段与字幕片段不会撞名
      const makeClipId = mcpClipIdFactory()
      const operations = buildTimelineEditOperations(rows, doc, makeClipId)
      const result = applyTimelineEdits(doc, operations, { makeClipId })
      if (hasSettingsPatch) {
        result.document = {
          ...result.document,
          settings: {
            ...(result.document.settings ?? {}),
            ...(args.settings as Record<string, unknown>)
          }
        }
      }
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
      const changed = result.added + result.updated + result.removed > 0 || hasSettingsPatch
      if (args.apply === false || !changed) {
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
      '列出当前工程的资产库文件夹（id / 名称 / 父级），asset_create / asset_import 等工具的 folderId 参数从这里取。',
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
    title: '运行画布节点 / 工作流',
    description:
      '在左侧画布上实时运行宿主画布或子图资产的节点（自动打开/聚焦画布，在画布节点上实时显示运行转圈、执行进度日志，生成完成后实时把预览画面/视频/音频/3D模型更新到节点上，同时在对话流弹出产物预览卡）。\n' +
      '- `assetId` 可选：省略或传 `"current"` 时自动使用最近一次 `graph_edit` 编辑的画布或工程内当前画布（若工程尚无画布会自动新建默认自由画布）；\n' +
      '- `nodeId` / `nodeIds` 可选：传入时只精准执行目标节点及其未就绪的上游依赖；省略时优先执行最近一次 `graph_edit` 创建/修改的节点（若无则执行整张图）；\n' +
      '- `wait` 默认 `true`：阻塞等待画布节点执行完成，并直接返回生成的工程相对路径 `relativePaths` 与视觉预览图 `mcpImages`（无需再调 `task_status` 轮询）；仅在需要后台异步跑时传 `wait: false`。',
    inputSchema: {
      type: 'object',
      properties: {
        assetId: {
          type: 'string',
          description: '可选：宿主画布/子图资产 id（省略或传 "current" 自动取最近编辑或当前画布）'
        },
        nodeId: {
          type: 'string',
          description: '可选：指定要执行的单个画布节点 id（及其未就绪上游依赖）'
        },
        nodeIds: {
          type: 'array',
          items: { type: 'string' },
          description:
            '可选：指定要执行的画布节点 id 列表（省略时默认执行最近一次 graph_edit 修改的节点）'
        },
        wait: {
          type: 'boolean',
          description:
            '可选：是否等待画布节点执行完成并直接返回产物与视觉自检图（默认 true；传 false 则受理后立即返回 mcpTaskId）'
        }
      },
      required: []
    },
    handler: async (args, ctx) => {
      assertProjectOpen()
      const asset = resolveOrEnsureCanvasAsset(optionalString(args, 'assetId'), {
        autoCreateCanvas: false
      })
      const graphJson = (asset?.genParams as Record<string, unknown> | undefined)?.graphJson as
        GraphDocument | undefined
      if (!asset || !graphJson || !Array.isArray(graphJson.nodes)) {
        throw new Error('资产不存在或不含图文档（请先通过 graph_edit 在画布中创建或修改节点）')
      }
      const assetId = asset.id
      const explicitNodeIds = [
        ...(optionalString(args, 'nodeId') ? [optionalString(args, 'nodeId')!.trim()] : []),
        ...readStringList(args, 'nodeIds')
      ].filter(Boolean)
      const requestedNodeIds = explicitNodeIds.length
        ? [...new Set(explicitNodeIds)]
        : lastMcpGraphEditTarget?.assetId === assetId && lastMcpGraphEditTarget.nodeIds.length
          ? [...lastMcpGraphEditTarget.nodeIds]
          : []
      const waitForCompletion = args.wait !== false
      const mcpTaskId = randomUUID()
      pendingMcpTaskReports.delete(mcpTaskId)
      // 登记为界面可见的旁路活动：终点由渲染层回报本轮产物相对路径后收尾，
      // 任务列表 / 执行日志 / AI 对话流三处共用这一条记录出预览
      pendingMcpTaskActivities.set(
        mcpTaskId,
        mcpActivityService.begin({
          tool: 'task_run',
          title: `画布执行 · ${asset.name}`,
          detail: requestedNodeIds.length
            ? `实时执行画布节点 (${requestedNodeIds.join(', ')})`
            : '按拓扑序实时执行画布节点',
          assetId
        })
      )
      broadcastToAllWindows(IpcChannels.MCP_TASK_RUN, {
        mcpTaskId,
        assetId,
        ...(requestedNodeIds.length ? { nodeIds: requestedNodeIds } : {})
      })

      if (!waitForCompletion) {
        for (let i = 0; i < 20; i++) {
          await sleep(300)
          const report = pendingMcpTaskReports.get(mcpTaskId)
          if (report?.phase === 'accepted') {
            return {
              mcpTaskId,
              taskId: report.taskId ?? null,
              assetId,
              nodeIds: requestedNodeIds,
              state: 'running'
            }
          }
          if (report?.phase === 'finished') {
            if (report.status === 'error') {
              throw new Error(report.error ?? '画布节点执行失败')
            }
            const relativePaths = report.relativePaths ?? []
            const visualImages = readVisualCheckImagesForRelativePaths(relativePaths, 3)
            return {
              mcpTaskId,
              taskId: report.taskId ?? null,
              assetId,
              nodeIds: requestedNodeIds,
              phase: 'finished',
              state: report.status ?? 'done',
              status: report.status ?? 'done',
              relativePath: relativePaths[0] ?? null,
              relativePaths,
              ...(visualImages.length ? { mcpImages: visualImages } : {})
            }
          }
          if (report?.phase === 'failed') {
            throw new Error(report.error ?? '任务受理失败')
          }
        }
        return {
          mcpTaskId,
          assetId,
          nodeIds: requestedNodeIds,
          state: 'dispatched',
          note: '界面未确认受理（可能界面非最新版本）；可稍后用 task_status 查询'
        }
      }

      // 默认等待画布节点执行完成（最长 30 分钟，每 300ms 检查一次终态与取消信号）
      const maxWaitMs = 30 * 60 * 1000
      const startedWaitAt = Date.now()
      let acceptedSeen = false
      while (Date.now() - startedWaitAt < maxWaitMs) {
        if (ctx?.signal?.aborted) {
          throw new Error('调用已取消')
        }
        await sleep(300)
        const report = pendingMcpTaskReports.get(mcpTaskId)
        if (!report) {
          if (!acceptedSeen && Date.now() - startedWaitAt > 10_000) {
            return {
              mcpTaskId,
              assetId,
              nodeIds: requestedNodeIds,
              state: 'dispatched',
              note: '界面未确认受理；可稍后用 task_status 查询'
            }
          }
          continue
        }
        if (report.phase === 'accepted') {
          acceptedSeen = true
          continue
        }
        if (report.phase === 'failed') {
          throw new Error(report.error ?? '画布任务受理失败')
        }
        if (report.phase === 'finished') {
          if (report.status === 'error') {
            throw new Error(report.error ?? '画布节点执行失败')
          }
          const relativePaths = report.relativePaths ?? []
          const visualImages = readVisualCheckImagesForRelativePaths(relativePaths, 3)
          return {
            mcpTaskId,
            taskId: report.taskId ?? null,
            assetId,
            nodeIds: requestedNodeIds,
            phase: 'finished',
            state: report.status ?? 'done',
            status: report.status ?? 'done',
            relativePath: relativePaths[0] ?? null,
            relativePaths,
            ...(visualImages.length ? { mcpImages: visualImages } : {})
          }
        }
      }
      throw new Error('等待画布节点执行完成超时，可用 task_status 继续查询')
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
      if (
        report.phase === 'finished' &&
        Array.isArray(report.relativePaths) &&
        report.relativePaths.length
      ) {
        const visualImages = readVisualCheckImagesForRelativePaths(report.relativePaths, 3)
        if (visualImages.length) {
          return { ...report, mcpImages: visualImages }
        }
      }
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
      '列出能被 graph_edit 添加到宿主资产子图的节点类型（与 graph_edit 的 node_upsert 校验同一白名单，含影视制作工作台 / 2D 舞台 / 宫格切分 / 图标包等新节点）：typeId、名称、分类、端口（连线时 fromPort / toPort 用的 id）与可选默认参数。用于外部 Agent 自发现可建节点，避免用猜的 typeId 被 graph_edit 跳过。需要影视 / 短剧 / 分镜创作时查 `film.workbench` 与 `film.shot`：`text.plain` → `film.workbench` 一站式完成分镜拆解、导演审核、角色/场景设定图与各镜头关键帧/视频拍摄（参数见 filmStoryboard / filmCast / filmRenderMode / filmWorkbenchRunMode）；需按镜展开节点链或单镜精修时用 `film.workbench` → `film.shot`（out→in，out-cast→in-cast，参数 filmShotRef）→ `asset.image`（out→in-text，out-refs→in-image）→ `asset.video`（out-motion→in-text）。需要 2D 帧动画 / GIF 动图时查 `anim.2d`：一张按行列分格的序列图（sprite sheet）从 in 端口接入，按 animRows / animCols 逐格切成帧 PNG；animGifFps（1–24，默认 0 = 只切帧）> 0 时额外经 out-gif 端口产出 GIF 动图并落盘为工程资产；动作预设与自定义描述见 animPresetId / animInstruction。只读操作，无需打开工程。需要 SVG 矢量图 / 矢量动画（不是位图）时查 `svg.gen` 与 `svg.anim`：`svg.gen` 用文本模型把描述画成 SVG 源码并落盘为工程 .svg 资产（in 接文本指令、in-image 接参考图照图生矢量，自带 SVG 系统提示词）；要帧序列 / GIF 就把它接到 `svg.anim` 的 in 端口（端口类型 svg）烘焙：含 SMIL 动效出多帧 PNG（out / out-all）+ GIF（out-gif），静态 SVG 只出 1 帧、不产 GIF（动效须写在 SVG 自身的 <animate> / <animateTransform> / <set> 里，CSS @keyframes 与 <animateMotion> 不参与求值）。关键参数：svgGenWidth / svgGenHeight（16–2048，默认 512）、svgGenBackground、svgFrames（2–60，默认 12）、svgDurationSec（0 = 自动探测动画周期，上限 30 秒），用 includeParams 查询。',
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
      const types = matched.map((def) => {
        const cap = getNodeCapability(def.typeId)
        const usage = cap?.usageZh || cap?.usageEn || undefined
        const schema = includeParams || Boolean(typeId) ? introspectNodeType(def.typeId) : undefined
        return {
          typeId: def.typeId,
          label: def.label,
          category: def.category,
          ...(def.assetType ? { assetType: def.assetType } : {}),
          ...(def.description ? { description: def.description } : {}),
          ...(usage ? { usage } : {}),
          ports: def.ports.map((port) => ({
            id: port.id,
            direction: port.direction,
            dataType: port.dataType,
            multiple: port.multiple === true,
            ...(port.label ? { label: port.label } : {})
          })),
          ...(includeParams ? { params: def.defaultParams() } : {}),
          ...(schema
            ? {
                editablePaths: schema.flatPaths,
                shorthandMap: schema.shorthandMap,
                ...(schema.presets.length ? { presets: schema.presets } : {}),
                ...(schema.diveKind ? { diveKind: schema.diveKind } : {})
              }
            : {})
        }
      })
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
      '读取一个已落盘的宿主资产图的结构：节点（id / 类型 / 标题）与连线清单，供 graph_edit 前确认节点 id，或 task_run 前了解图内容。只读操作，图在编辑器中打开时也可调用。省略 assetId 时自动读取当前画布资产。',
    inputSchema: {
      type: 'object',
      properties: {
        assetId: {
          type: 'string',
          description: '可选：宿主资产 id（省略或传 "current" 自动读取当前画布）'
        },
        includeParams: {
          type: 'boolean',
          description: 'true 时附带每个节点的完整参数（默认只返回结构摘要）'
        }
      },
      required: []
    },
    handler: (args) => {
      assertProjectOpen()
      const asset = resolveOrEnsureCanvasAsset(optionalString(args, 'assetId'), {
        autoCreateCanvas: false
      })
      const graphJson = (asset?.genParams as Record<string, unknown> | undefined)?.graphJson as
        GraphDocument | undefined
      if (!asset || !graphJson || !Array.isArray(graphJson.nodes)) {
        throw new Error('资产不存在或不含图文档（仅支持宿主资产子图）')
      }
      const includeParams = args.includeParams === true
      return {
        assetId: asset.id,
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
    title: '编辑画布节点图 / 3D 导演台 / 检查器',
    description:
      '对左侧打开或工程内的宿主画布、任意节点 Dive 视图、3D 导演台（director.stage）以及右侧检查器（Inspector）应用实时编辑操作（**所有图片/视频/配音/对话/音效/音乐/3D模型/空间世界生成与加工任务均须通过本工具创建或修改画布节点，再调用 `task_run` 在画布上实时执行**）：\n' +
      '1. **画布节点创建、修改与连线操作**：`node_upsert` / `node_add` / `node_update`（或 `update_params`） / `apply_preset` / `node_delete` / `edge_connect` / `edge_delete` / `node_select` / `group_add` / `group_update` / `group_delete` / `auto_layout`。\n' +
      '   - 常用生成节点 `typeId`：\n' +
      '     * 图片生成：`asset.image`（`params: { prompt, aspectRatio, model, providerInstanceId, count, generateTransparentBg, referenceImageUrls }`，默认开启透明背景 `generateTransparentBg: true`——支持透明的模型生成透明图、不支持的模型生成不透明图且生图后不做去背景处理；明确要求非透明场景背景时传 `false`）\n' +
      '     * 视频生成：`asset.video`（`params: { prompt, aspectRatio, duration, generateAudio, model, providerInstanceId, firstFrameImageUrl, lastFrameImageUrl, referenceImageUrls }`）\n' +
      '     * 语音/配音：`voice.tts` 或 `asset.voice`（`params: { prompt, voice, voiceProfile, model, providerInstanceId }`）\n' +
      '     * 多说话人对话：`voice.dialogue`（`params: { script, voices, voice, voiceProfile, model, providerInstanceId }`）\n' +
      '     * 音效生成：`audio.sfx`（`params: { prompt, loop, durationSeconds, promptInfluence, model, providerInstanceId }`）\n' +
      '     * 音乐/BGM 生成：`audio.music`（`params: { prompt, lyrics, instrumental, model, providerInstanceId }`）\n' +
      '     * 3D 模型生成与加工：`asset.model3d`（`params: { prompt, style, model, providerInstanceId, referenceImageUrls }`）、`model3d.rig`（骨骼蒙皮）、`model3d.segment`（部件拆分）、`model3d.postProcess`（重拓扑/补全/重定向/格式转换）\n' +
      '     * 空间世界生成与导出：`spatialWorld.generate`（`params: { prompt, model, seed, panoMode, disableRecaption, referenceImageUrls, referenceVideoUrl }`）、`spatialWorld.export`（导出 HQ GLB 网格或 PLY 泼溅）\n' +
      '   - 在 `params` 中传入 `referenceImageUrls` / `firstFrameImageUrl` / `lastFrameImageUrl` / `referenceVideoUrl` 时，系统会自动在画布上创建锁定的上游参考媒体节点并连线到对应端口；\n' +
      '   - 省略 `assetId` 时自动作用于当前左侧打开的画布（若工程尚无画布会自动创建并打开默认自由画布）；返回值包含 `assetId` 与本次触达的 `nodeIds`，可直接传给 `task_run` 执行。\n' +
      '2. **3D 导演台实时操作**：当左侧打开了 3D 导演台 / 3D 分镜预演时，可直接在 `ops` 中传入 3D 舞台操作：`object_update` / `hide_object` / `show_object` / `lock_object` / `unlock_object` / `object_add` / `object_delete` / `object_duplicate` / `object_copy` / `object_paste` / `object_select` / `camera_update` / `camera_add` / `camera_delete` / `lighting_preset` / `environment_update` / `viewport_update` / `ai_blocking` / `cinemachine_pack` / `storyboard_previz` / `capture_shot` / `anim_control`；\n' +
      '3. **全局工程检查器 / 资产检查器 / 当前检查器通用操作**：`project_globals_update`、`asset_update`、`inspector_update`。',
    inputSchema: {
      type: 'object',
      properties: {
        assetId: {
          type: 'string',
          description:
            '可选：宿主资产 id（缺省自动取当前左侧活动窗口 / Dive 视图所在画布；工程无画布时自动创建）'
        },
        nodeId: {
          type: 'string',
          description: '可选：目标节点 id（缺省自动取当前 Dive 节点或画布选中节点）'
        },
        hostId: {
          type: 'string',
          description:
            '可选：精确指定打开中的图宿主 hostId（如世界要素子图 `asset:<id>:element:characters`）'
        },
        openEditor: {
          type: 'boolean',
          description: '是否自动打开/聚焦该画布编辑器并实时展示变化（默认 true）'
        },
        autoLayout: {
          type: 'boolean',
          description: '缺省：新建节点或新连线后自动布局。true 强制布局；false 保留坐标（精细摆位）'
        },
        ops: {
          type: 'array',
          description:
            '编辑操作批，按顺序执行（画布节点操作、Dive 节点深层参数修改、3D 导演台操作、Inspector 检查器操作均可混排）',
          items: {
            type: 'object',
            properties: {
              op: {
                type: 'string',
                enum: [
                  'node_upsert',
                  'node_add',
                  'node_update',
                  'update_params',
                  'apply_preset',
                  'node_delete',
                  'edge_connect',
                  'edge_add',
                  'edge_delete',
                  'node_select',
                  'group_add',
                  'group_update',
                  'group_delete',
                  'auto_layout',
                  'inspector_update',
                  'project_globals_update',
                  'asset_update',
                  'semantic_timeline_edit',
                  'object_update',
                  'pose_update',
                  'set_action',
                  'switch_action',
                  'play_clip',
                  'sequence_actions',
                  'hide_object',
                  'show_object',
                  'lock_object',
                  'unlock_object',
                  'object_add',
                  'object_delete',
                  'object_duplicate',
                  'object_copy',
                  'object_paste',
                  'object_select',
                  'camera_update',
                  'camera_add',
                  'camera_delete',
                  'lighting_preset',
                  'environment_update',
                  'viewport_update',
                  'ai_blocking',
                  'cinemachine_pack',
                  'storyboard_previz',
                  'capture_shot',
                  'anim_control'
                ]
              },
              nodeId: { type: 'string' },
              typeId: {
                type: 'string',
                description:
                  'node_upsert / node_add 必填，如 asset.image / asset.video / voice.tts / audio.sfx / audio.music / asset.model3d / spatialWorld.generate / text.plain'
              },
              title: { type: 'string' },
              preset: {
                type: 'string',
                description: '一键预设 ID 或名称（如 natural / studio / rembrandt / 4koma 等）'
              },
              locked: { type: 'boolean', description: '节点或 3D 对象锁定状态' },
              params: {
                type: 'object',
                description:
                  '节点参数（与节点现有参数深度智能合并）。支持简写属性（prompt / instruction / systemPrompt / model / providerInstanceId / aspectRatio / resolution / count / duration / seed / voice / voices / loop / lyrics / instrumental / style / referenceImageUrls / firstFrameImageUrl / lastFrameImageUrl / referenceVideoUrl）、深层点路径与 JSON 字符串透明合并'
              },
              fromNodeId: { type: 'string' },
              toNodeId: { type: 'string' },
              fromPort: { type: 'string' },
              toPort: { type: 'string' },
              groupId: { type: 'string' },
              nodeIds: { type: 'array', items: { type: 'string' } },
              objectId: { type: 'string', description: '3D 舞台对象 id（也可传 name 按名称匹配）' },
              cameraId: { type: 'string', description: '3D 舞台机位 id（也可传 name 按名称匹配）' },
              name: { type: 'string', description: '3D 对象/机位名称（如 "林小满"）或资产新名称' },
              newName: { type: 'string', description: '3D 对象/机位重命名后的新名称' },
              visible: {
                type: 'boolean',
                description: '3D 对象/机位显隐（false=隐藏，true=显示）'
              },
              nameVisible: { type: 'boolean', description: '3D 头顶名称标签是否显示' },
              color: {
                type: 'string',
                description: '颜色（支持 HEX 如 "#ef4444" 或中英文颜色名如 "红色"）'
              },
              position: { type: 'object' },
              positionDelta: { type: 'object' },
              rotationDeg: { type: 'object' },
              rotationDeltaDeg: { type: 'object' },
              scale: {},
              uniformScale: { type: 'number' },
              parentId: { type: ['string', 'null'] },
              parentName: { type: 'string' },
              posePreset: { type: 'string' },
              poseEditMode: { type: 'string', enum: ['fk', 'ik'] },
              bonePose: { type: 'object' },
              ikEffectors: { type: 'object' },
              resetPose: { type: 'boolean' },
              textures: { type: 'object' },
              light: { type: 'object' },
              fov: { type: 'number' },
              focalLengthMm: { type: 'number' },
              aperture: { type: 'number' },
              focusDistance: { type: 'number' },
              dollyZoomLock: { type: 'boolean' },
              handheldShake: { type: 'object' },
              cinemachine: { type: 'object' },
              skyColor: { type: 'string' },
              lightingPreset: { type: 'string' },
              ground: { type: 'object' },
              environment: { type: 'object' },
              sceneWorld: { type: 'object' },
              viewMode: { type: 'string' },
              shadingMode: { type: 'string' },
              aspectRatio: { type: 'string' },
              compositionGuide: { type: 'string' },
              capturePass: { type: 'string' },
              transformMode: { type: 'string' },
              stageEditMode: { type: 'string' },
              viewOrientation: { type: 'string' }
            },
            required: ['op']
          }
        }
      },
      required: ['ops']
    },
    handler: async (args) => {
      assertProjectOpen()
      const rawAssetIdArg = optionalString(args, 'assetId') ?? ''
      const normalizedRawAssetId =
        rawAssetIdArg === 'current' || rawAssetIdArg === 'active' ? '' : rawAssetIdArg
      const hostId = optionalString(args, 'hostId')
      const nodeId = optionalString(args, 'nodeId')
      const autoLayout =
        args.autoLayout === true ? true : args.autoLayout === false ? false : undefined
      const rawOps = Array.isArray(args.ops)
        ? args.ops
        : Array.isArray(args.operations)
          ? args.operations
          : []
      if (!rawOps.length) {
        throw new Error('缺少编辑操作数组「ops」')
      }
      const hasGraphNodeOp = rawOps.some((item) => {
        if (!item || typeof item !== 'object') return false
        const op = String((item as Record<string, unknown>).op ?? '').trim()
        return (
          op === 'node_upsert' ||
          op === 'node_add' ||
          op === 'node_update' ||
          op === 'update_params' ||
          op === 'apply_preset' ||
          op === 'node_delete' ||
          op === 'edge_connect' ||
          op === 'edge_add' ||
          op === 'edge_delete' ||
          op === 'node_select' ||
          op === 'group_add' ||
          op === 'group_update' ||
          op === 'group_delete' ||
          op === 'auto_layout'
        )
      })
      const openEditor = args.openEditor !== undefined ? args.openEditor === true : hasGraphNodeOp
      const asset = normalizedRawAssetId
        ? projectService.listAssets().find((item) => item.id === normalizedRawAssetId)
        : resolveOrEnsureCanvasAsset('', { autoCreateCanvas: hasGraphNodeOp })
      const assetId = normalizedRawAssetId || asset?.id || ''
      if (normalizedRawAssetId && hasGraphNodeOp) {
        const genParams = asset?.genParams as Record<string, unknown> | undefined
        const graphJson = genParams?.graphJson as GraphDocument | undefined
        const hasElementGraphs = Boolean(
          hostId || genParams?.elementGraphs || genParams?.elementGraphsByNodeId
        )
        if (!asset || ((!graphJson || !Array.isArray(graphJson.nodes)) && !hasElementGraphs)) {
          throw new Error('资产不存在或不含图文档（graph_edit 节点操作需指向宿主画布资产）')
        }
      }
      const requestId = randomUUID()
      pendingMcpGraphEditResults.delete(requestId)
      broadcastToAllWindows(IpcChannels.MCP_GRAPH_EDIT, {
        requestId,
        assetId,
        ...(nodeId ? { nodeId } : {}),
        ...(hostId ? { hostId } : {}),
        ops: rawOps,
        ...(openEditor ? { openEditor: true } : { openEditor: false }),
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
            const resolvedAssetId = report.assetId || assetId
            const touchedNodeIds = report.nodeIds ?? []
            if (resolvedAssetId) {
              lastMcpGraphEditTarget = {
                assetId: resolvedAssetId,
                nodeIds: touchedNodeIds
              }
            }
            return {
              assetId: resolvedAssetId || null,
              nodeIds: touchedNodeIds,
              applied: report.applied ?? [],
              warnings: report.warnings ?? []
            }
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
    name: 'director_stage_read',
    title: '读取 3D 导演台 / 分镜白模预演舞台',
    description:
      '读取左侧当前打开（或指定资产+节点）的 3D 导演台 / 3D 分镜白模预演（director.stage）完整状态：包括所有 3D 对象（角色白模 character / 几何道具 primitive / 灯光 light / 模型 model / 空物体 empty 的 id、名称、显隐 visible、锁定 locked、坐标 position、角度制旋转 rotationDeg、缩放 scale、颜色 color、姿态与灯光参数）、所有机位（cameras 的 id、名称、显隐、position、target、fov、focalLengthMm、光圈 aperture、Cinemachine 配置）、环境与天光（skyColor、ground、lightingPreset、environment）、动画轨道（animation）及视口设置（viewMode、shadingMode、aspectRatio）。缺省自动读取当前左侧打开的 3D 导演台。',
    inputSchema: {
      type: 'object',
      properties: {
        assetId: {
          type: 'string',
          description: '可选：宿主资产 id（缺省自动取当前左侧打开的 3D 导演台或活动资产）'
        },
        nodeId: {
          type: 'string',
          description: '可选：director.stage 节点 id（缺省自动取当前活动导演台节点）'
        }
      }
    },
    handler: async (args) => {
      assertProjectOpen()
      return await runRenderJob('director-stage-read', {
        ...(optionalString(args, 'assetId') ? { assetId: optionalString(args, 'assetId') } : {}),
        ...(optionalString(args, 'nodeId') ? { nodeId: optionalString(args, 'nodeId') } : {})
      })
    }
  },
  {
    name: 'director_stage_edit',
    title: '实时修改 3D 导演台 / 分镜白模预演舞台',
    description:
      '对左侧当前打开（或指定资产+节点）的 3D 导演台 / 3D 分镜白模预演（director.stage）执行实时编辑，3D 画面、层级列表、检查器与持久化数据同步生效！支持通过对象的 `name`（如 `"林小满"`）或 `objectId`（如 `"sb-actor:林小满"`）精准定位，省略目标时默认作用于当前检查器选中的对象或活动机位。操作类型 `op` 包括：\n' +
      '- `object_update`（或 `pose_update` / `set_action` / `switch_action` / `play_clip` / `sequence_actions` / `hide_object` / `show_object` / `lock_object` / `unlock_object`）：按 `name` 或 `objectId` 修改对象的显隐（`visible: false/true`）、锁定（`locked`）、名称标签显隐（`nameVisible`）、改名（`newName`）、父级挂载（`parentId` / `parentName`）、颜色（`color: "#rrggbb"` 或 `"红色"`/`"蓝色"` 等颜色名）、材质贴图（`textures`）、位置（`position: {x,y,z}` 或相对位移 `positionDelta: {x,y,z}`）、旋转角度（`rotationDeg: {x,y,z}` 或相对旋转 `rotationDeltaDeg: {x,y,z}`）、缩放（`scale: {x,y,z}` 或 `uniformScale`）、全身生活姿态预设（`posePreset` 支持 38 种全身/手势/视线预设或中文名，如 `"body.sitChair"`/`"端坐"`、`"body.sitCrossLegs"`/`"翘二郎腿"`、`"body.sitSlumped"`/`"瘫坐"`、`"body.sitFloor"`/`"盘腿坐"`、`"body.jump"`/`"跳跃"`、`"body.run"`/`"奔跑"`、`"body.sprint"`/`"冲刺"`、`"body.walk"`/`"行走"`、`"body.crouch"`/`"蹲下"`、`"body.kneel"`/`"单膝跪地"`、`"body.lieDown"`/`"平躺"`、`"body.leanWall"`/`"斜靠"`、`"body.bow"`/`"鞠躬"`、`"body.wave"`/`"挥手"`、`"body.cheer"`/`"欢呼"`、`"body.dance"`/`"跳舞"`、`"body.stretch"`/`"伸懒腰"`、`"body.think"`/`"思考"`、`"body.phone"`/`"看手机"`、`"body.drink"`/`"举杯"`、`"body.combatGuard"`/`"格斗"`、`"body.kick"`/`"侧踢"`、`"hand.clap"`/`"鼓掌"`，或 `resetPose: true`）、骨骼动画片段切换与编排（`clip` / `animationClip` 支持 24 种内置动作片段或中文名：`Idle`/`Walk`/`Run`/`Sprint`/`Jump`/`Sit`/`SitFloor`/`Crouch`/`Kneel`/`LieDown`/`Wave`/`Bow`/`Clap`/`Cheer`/`Dance`/`Talk`/`Think`/`PhoneLook`/`Stretch`/`LookAround`/`Drink`/`PushUp`/`Fall`/`Action`，或传 `skeletonClips: [{clip, start, end, speed, crossFadeSec}]` 编排多段连续动作序列）、FK/IK 模式（`poseEditMode: "fk"|"ik"`）、骨骼局部角度（`bonePose`）、IK 末端坐标（`ikEffectors`）、灯光参数（`light: {type, intensity, distance, angle, penumbra, decay, shadowMapSize}`）；\n' +
      '- `object_add` / `object_delete` / `object_duplicate` / `object_copy` / `object_paste` / `object_select`：新建、删除、复制粘贴或选中聚焦 3D 对象；\n' +
      '- `camera_update` / `camera_add` / `camera_delete`：修改机位位置 `position`、目标 `target`、旋转 `rotationDeg`、视角 `fov`、焦距 `focalLengthMm`、光圈 `aperture`、对焦距离 `focusDistance`、希区柯克变焦锁 `dollyZoomLock`、手持晃动 `handheldShake`、智能跟拍 `cinemachine`（`bodyMode`, `followTargetName`, `aimMode`, `lookAtTargetName`, `aimTargetPart`, `screenCompositionPreset`, `noisePreset`, `triggerImpulse` 等）、机位预设 `presetId`、重置 `resetViewer`、显隐 `visible` 或激活 `setActive: true`；\n' +
      '- `lighting_preset` / `environment_update`：切换布光预设、天空色 `skyColor`、全景图 `panoramaAssetId`/`panoramaName`/`panoramaVisible`/`panoramaYaw`/`panoramaRadius`、场景整体缩放平移旋转 `sceneWorld`、地面 `ground`、环境雾与暗影捕手 `environment`；\n' +
      '- `viewport_update`：切换视角 `viewMode`、编辑模式 `stageEditMode`（`"scene"`/`"animation"`）、变换工具 `transformMode`（`"translate"`/`"rotate"`/`"scale"`）、着色模式 `shadingMode`、画幅比 `aspectRatio`、构图线 `compositionGuide`、抓拍通道 `capturePass`、对齐视图 `moveToView`/`alignWithView`/`alignViewToSelected`、正交方向 `viewOrientation`（`"front"`/`"back"`/`"left"`/`"right"`/`"top"`/`"bottom"`）、Gizmo 显隐与灵敏度 `stageControls`；\n' +
      '- `ai_blocking` / `cinemachine_pack` / `storyboard_previz` / `capture_shot` / `anim_control`：AI 场面调度、机位包、分镜预演、抓拍快照与动画时间轴控制。',
    inputSchema: {
      type: 'object',
      properties: {
        assetId: {
          type: 'string',
          description: '可选：宿主资产 id（缺省自动取当前左侧打开的 3D 导演台）'
        },
        nodeId: {
          type: 'string',
          description: '可选：director.stage 节点 id（缺省自动取当前活动导演台节点）'
        },
        ops: {
          type: 'array',
          description: '按顺序执行的 3D 舞台修改操作列表',
          items: {
            type: 'object',
            properties: {
              op: {
                type: 'string',
                enum: [
                  'object_update',
                  'pose_update',
                  'set_action',
                  'switch_action',
                  'play_clip',
                  'sequence_actions',
                  'hide_object',
                  'show_object',
                  'lock_object',
                  'unlock_object',
                  'object_add',
                  'object_delete',
                  'object_duplicate',
                  'object_copy',
                  'object_paste',
                  'object_select',
                  'camera_update',
                  'camera_add',
                  'camera_delete',
                  'lighting_preset',
                  'environment_update',
                  'viewport_update',
                  'ai_blocking',
                  'cinemachine_pack',
                  'storyboard_previz',
                  'capture_shot',
                  'anim_control'
                ]
              },
              objectId: { type: 'string', description: '目标对象 id（也可只传 name 按名称匹配）' },
              cameraId: { type: 'string', description: '目标机位 id（也可只传 name 按名称匹配）' },
              name: {
                type: 'string',
                description:
                  '目标对象/机位名称（如 "林小满"），或在 object_add / camera_add 中作为新建名称'
              },
              newName: { type: 'string', description: '重命名后的新名称' },
              kind: {
                type: 'string',
                description:
                  'object_add 类型（character / primitive / light / camera / empty / model）或筛选类型'
              },
              visible: { type: 'boolean', description: '显隐状态（false=隐藏，true=显示）' },
              locked: { type: 'boolean', description: '锁定状态' },
              nameVisible: { type: 'boolean', description: '3D 头顶名称标签是否显示' },
              color: {
                type: 'string',
                description: '颜色（支持 HEX 如 "#f97316" 或中英文名如 "红色"）'
              },
              parentId: { type: ['string', 'null'] },
              parentName: { type: 'string' },
              position: {
                type: 'object',
                description: '世界坐标 { x, y, z }（可只传部分轴）',
                properties: {
                  x: { type: 'number' },
                  y: { type: 'number' },
                  z: { type: 'number' }
                }
              },
              positionDelta: {
                type: 'object',
                description: '相对位移增量 { x, y, z }',
                properties: {
                  x: { type: 'number' },
                  y: { type: 'number' },
                  z: { type: 'number' }
                }
              },
              rotationDeg: {
                type: 'object',
                description: '角度制旋转 { x, y, z }（单位：度）',
                properties: {
                  x: { type: 'number' },
                  y: { type: 'number' },
                  z: { type: 'number' }
                }
              },
              rotationDeltaDeg: {
                type: 'object',
                description: '相对旋转增量 { x, y, z }（单位：度）',
                properties: {
                  x: { type: 'number' },
                  y: { type: 'number' },
                  z: { type: 'number' }
                }
              },
              scale: {
                description: '缩放 { x, y, z } 或统一缩放数值',
                oneOf: [
                  { type: 'number' },
                  {
                    type: 'object',
                    properties: {
                      x: { type: 'number' },
                      y: { type: 'number' },
                      z: { type: 'number' }
                    }
                  }
                ]
              },
              uniformScale: { type: 'number' },
              mannequinPreset: {
                type: 'string',
                enum: ['humanoid', 'chibi', 'quadruped']
              },
              primitive: { type: 'string' },
              lightType: {
                type: 'string',
                enum: ['directional', 'point', 'spot']
              },
              light: { type: 'object' },
              textures: { type: 'object' },
              posePreset: {
                type: 'string',
                description:
                  '姿态预设 ID 或中文名（如 body.sitChair / 端坐 / body.jump / 跳跃 / body.run / 奔跑 / body.crouch / 蹲下 / body.kneel / 单膝跪地 / body.lieDown / 平躺 / body.dance / 跳舞 / body.phone / 看手机 / body.drink / 举杯 等 38 种预设）'
              },
              clip: {
                type: 'string',
                description:
                  '骨骼动画片段名或中文名（Idle / Walk / Run / Sprint / Jump / Sit / SitFloor / Crouch / Kneel / LieDown / Wave / Bow / Clap / Cheer / Dance / Talk / Think / PhoneLook / Stretch / LookAround / Drink / PushUp / Fall / Action）'
              },
              animationClip: {
                type: 'string',
                description: '同 clip，切换角色当前骨骼动画片段'
              },
              skeletonClips: {
                type: 'array',
                description:
                  '为角色编排多段连续骨骼动作时间轴序列 [{ clip, start, end, speed?, loop?, crossFadeSec? }]',
                items: {
                  type: 'object',
                  properties: {
                    clip: { type: 'string' },
                    start: { type: 'number' },
                    end: { type: 'number' },
                    duration: { type: 'number' },
                    speed: { type: 'number' },
                    loop: { type: 'boolean' },
                    crossFadeSec: { type: 'number' }
                  }
                }
              },
              poseEditMode: { type: 'string', enum: ['fk', 'ik'] },
              selectedPoseBone: { type: ['string', 'null'] },
              selectedIkChainId: { type: ['string', 'null'] },
              ikEffectors: { type: 'object' },
              poseAssetId: { type: 'string' },
              poseAssetName: { type: 'string' },
              savePoseAssetName: { type: 'string' },
              resetPose: { type: 'boolean', description: '重置人偶骨骼姿态为默认 T/A-Pose' },
              bonePose: {
                type: 'object',
                description: '按骨骼名设置旋转角度 { [boneName]: {x,y,z} }'
              },
              target: {
                type: 'object',
                description: '机位注视目标点 { x, y, z }',
                properties: {
                  x: { type: 'number' },
                  y: { type: 'number' },
                  z: { type: 'number' }
                }
              },
              fov: { type: 'number', description: '机位垂直视角 FOV（度）' },
              focalLengthMm: { type: 'number', description: '等效焦距（mm，如 24/35/50/85）' },
              aperture: { type: 'number', description: '光圈 f 值（如 1.4 / 2.8 / 5.6）' },
              focusDistance: { type: 'number', description: '对焦距离（米）' },
              dollyZoomLock: { type: 'boolean' },
              handheldShake: { type: 'object' },
              cinemachine: { type: 'object' },
              resetViewer: { type: 'boolean' },
              setActive: { type: 'boolean', description: '设为当前活动机位' },
              focus: { type: 'boolean', description: '选中同时将视口镜头聚焦到该对象' },
              presetId: { type: 'string', description: '灯光预设 ID 或机位预设 ID' },
              skyColor: { type: 'string', description: '天空背景色 HEX 或颜色名' },
              panoramaAssetId: { type: ['string', 'null'] },
              panoramaName: { type: 'string' },
              clearPanorama: { type: 'boolean' },
              panoramaVisible: { type: 'boolean' },
              panoramaYaw: { type: 'number' },
              panoramaRadius: { type: 'number' },
              sceneWorld: { type: 'object' },
              ground: { type: 'object', description: '地面与网格设置' },
              environment: { type: 'object', description: '环境雾与暗影捕手设置' },
              viewMode: { type: 'string', enum: ['director', 'camera'] },
              stageEditMode: { type: 'string', enum: ['scene', 'animation'] },
              transformMode: { type: 'string', enum: ['translate', 'rotate', 'scale'] },
              cameraPreviewOpen: { type: 'boolean' },
              shadingMode: {
                type: 'string',
                enum: ['lit', 'shaded', 'clay', 'unlit', 'wireframe', 'matcap', 'normal']
              },
              aspectRatio: {
                type: 'string',
                enum: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9']
              },
              compositionGuide: { type: 'string' },
              capturePass: { type: 'string' },
              moveToView: { type: 'boolean' },
              alignWithView: { type: 'boolean' },
              alignViewToSelected: { type: 'boolean' },
              viewOrientation: { type: 'string' },
              gizmoSize: { type: 'number' },
              sceneLabelsVisible: { type: 'boolean' },
              cameraGizmosVisible: { type: 'boolean' },
              pathGizmosVisible: { type: 'boolean' },
              lightGizmosVisible: { type: 'boolean' },
              gridGizmoVisible: { type: 'boolean' },
              selectionBoundsVisible: { type: 'boolean' },
              captureLabelsVisible: { type: 'boolean' },
              captureCameraLabelsVisible: { type: 'boolean' },
              stageControls: { type: 'object' },
              prompt: { type: 'string', description: 'ai_blocking 自然语言场面调度描述' },
              packId: { type: 'string' },
              sceneId: { type: 'string' },
              shotId: { type: 'string' },
              captureAndWriteBack: { type: 'boolean' },
              allCameras: { type: 'boolean' },
              firstLastPair: { type: 'boolean' },
              cutTrackStoryboard: { type: 'boolean' },
              action: {
                type: 'string',
                enum: [
                  'play',
                  'pause',
                  'stop',
                  'seek',
                  'add_track',
                  'remove_track',
                  'add_keyframe',
                  'remove_keyframe',
                  'add_cut_segment',
                  'set_skeleton_clip',
                  'add_skeleton_clip',
                  'clear_skeleton_clips',
                  'export_video'
                ]
              },
              start: { type: 'number', description: '片段起始时间（秒）' },
              end: { type: 'number', description: '片段结束时间（秒）' },
              speed: { type: 'number', description: '骨骼动画片段倍速（默认 1）' },
              crossFadeSec: { type: 'number', description: '动作切换平滑过渡秒数（默认 0.25）' },
              time: { type: 'number' },
              duration: { type: 'number' },
              loop: { type: 'boolean' },
              playbackRate: { type: 'number' }
            }
          }
        }
      },
      required: []
    },
    handler: async (args) => {
      assertProjectOpen()
      return await runRenderJob('director-stage-edit', args)
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
    name: 'models_list',
    title: '可用模型列表',
    description:
      '列出应用设置中已启用的模型提供商与各模态（text/image/video/audio/model3d/world/decisions）勾选的模型。画布生成节点的 params.model / params.providerInstanceId 参数从这里取；world 是 World Labs Marble 空间世界（spatialWorld.generate 节点用）；decisions 是 OpenRouter 决策模型（decide 工具或 decisions.judge 节点用）。',
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
      '查询对象存储配置状态：是否已配置、当前启用的提供商与桶、公网地址。画布 3D 生成节点（asset.model3d）与视频生成节点（asset.video）连接本地参考图时需要对象存储转公网 URL，图片生成节点（asset.image）则不依赖；调用前可用本工具确认。',
    inputSchema: { type: 'object', properties: {} },
    handler: () => {
      const providers = settingsService.get().objectStorage.providers
      const active = pickActiveObjectStorage({ providers })
      return {
        configured: providers.some((p) => p.enabled),
        enabled: active != null,
        provider: active ? { kind: active.providerKind, label: active.label } : null,
        bucket: active ? getObjectStorageBucket(active) : null,
        publicBaseUrl: active ? getObjectStoragePublicBaseUrl(active) : null,
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
  },
  // ── 技能发现、联网搜索与 GitHub 技能安装 ──────────────────────────────────────
  {
    name: 'skill_list',
    title: '已安装技能列表',
    description:
      '列出当前已安装的全部技能（含 Claude Code / GitHub 技能、工程级 .claude/skills 与官方技能市场包）：返回技能名（可通过 `/技能名` 调用）、描述、来源地址、是否含可执行脚本或画布工作流模板及 SKILL.md 路径。只读操作，无需打开工程。',
    inputSchema: {
      type: 'object',
      properties: {
        includeInstructions: {
          type: 'boolean',
          description: '可选：是否一并返回每个技能 SKILL.md 的正文指令（默认 false）'
        }
      }
    },
    handler: async (args) => {
      const includeInstructions = args.includeInstructions === true
      const workspaceRoot = projectService.isOpen() ? projectService.getRoot() : undefined
      const discovered = discoverInstalledClaudeSkills({
        ...(workspaceRoot ? { workspaceRoot } : {})
      })
      const ghRecords = new Map(listInstalledGitHubSkillRecords().map((r) => [r.name, r]))
      const marketRecords = new Map(
        listInstalledWorkflowDetails()
          .filter((w) => w.skillName)
          .map((w) => [w.skillName as string, w])
      )
      const skills = discovered.map((entry) => {
        const gh = ghRecords.get(entry.name)
        const wf = marketRecords.get(entry.name)
        return {
          name: entry.name,
          slashCommand: `/${entry.name}`,
          description: entry.frontmatter.description,
          scope: entry.scope,
          source: gh ? 'github' : wf ? 'market' : entry.scope,
          ...(gh ? { sourceUrl: gh.sourceUrl, repo: `${gh.owner}/${gh.repo}`, ref: gh.ref } : {}),
          ...(wf ? { marketId: wf.id, workflowTitle: wf.title } : {}),
          hasScripts: entry.hasScripts,
          hasWorkflow: entry.hasWorkflow || Boolean(wf),
          extraFiles: entry.extraFiles,
          skillDir: entry.dirPath,
          skillFilePath: entry.skillFilePath,
          ...(includeInstructions ? { instructions: entry.body } : {})
        }
      })
      return {
        total: skills.length,
        skills,
        ...(includeInstructions
          ? { studioNodeCapabilitiesBridge: buildStudioNodeCapabilitiesBridge() }
          : {})
      }
    }
  },
  {
    name: 'skill_search',
    title: '在线搜索技能',
    description:
      '按关键词或主题联网搜索可安装的 AI 技能（同时检索：① Claude Code 官方精选技能库 anthropics/skills、② AIArtEngine 官方技能市场、③ GitHub 公开仓库并自动核验 SKILL.md）。' +
      '当用户让你「上网搜一个某某技能并安装」或询问「有哪些技能可用」时调用。返回每个候选技能的 `name`、`description`、`url`（GitHub 地址）或 `marketId`（官方市场 ID）、`hasScripts` 与 `installed` 状态，接着可直接调 `skill_install` 安装。',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            '搜索关键词（支持中文或英文，如 "mcp"、"pdf"、"frontend design"、"短剧"、"图标"、"blender"）'
        },
        limit: {
          type: 'number',
          description: '最大返回条数（默认 12，上限 25）'
        }
      },
      required: ['query']
    },
    handler: async (args) => {
      const query = readString(args, 'query')
      const rawLimit = optionalNumber(args, 'limit')
      const limit = Math.max(1, Math.min(rawLimit ?? 12, 25))
      const activityId = mcpActivityService.begin({
        tool: 'skill_search',
        title: `搜索在线技能 · ${query}`,
        detail: '正在检索 GitHub 技能仓库与官方技能市场…'
      })
      try {
        const [onlineRes, catalogRes] = await Promise.all([
          searchOnlineSkills({ query, limit }),
          fetchSkillCatalog().catch(() => null)
        ])
        const merged: OnlineSkillSearchItem[] = []
        const seenKeys = new Set<string>()

        if (catalogRes && catalogRes.ok && Array.isArray(catalogRes.entries)) {
          const qLower = query.toLowerCase().trim()
          const tokens = qLower.split(/[\s,，、/|-]+/).filter(Boolean)
          const isBroadQuery =
            !tokens.length ||
            ['all', 'market', 'skill', 'skills', '技能', '工作流', '推荐', '热门'].includes(qLower)
          for (const entry of catalogRes.entries) {
            const skillName = entry.skill?.name ?? `wf-${entry.id}`
            const haystack = [
              entry.id,
              skillName,
              entry.title,
              entry.summary,
              entry.skill?.description ?? '',
              ...(entry.tags ?? [])
            ]
              .join(' ')
              .toLowerCase()
            const matched =
              isBroadQuery ||
              haystack.includes(qLower) ||
              tokens.some((tok) => haystack.includes(tok))
            if (!matched) continue
            const key = `market:${entry.id}`
            seenKeys.add(key)
            seenKeys.add(`name:${skillName}`)
            merged.push({
              name: skillName,
              title: entry.title,
              description: entry.skill?.description || entry.summary,
              source: 'market',
              marketId: entry.id,
              hasScripts: Boolean(entry.skill?.files?.some((f) => f.path.startsWith('scripts/'))),
              hasWorkflow: true,
              installed: Boolean(entry.installed)
            })
          }
        }

        for (const item of onlineRes.items) {
          const key = item.url ? `url:${item.url.toLowerCase()}` : `name:${item.name}`
          if (seenKeys.has(key) || seenKeys.has(`name:${item.name}`)) continue
          seenKeys.add(key)
          seenKeys.add(`name:${item.name}`)
          merged.push(item)
        }

        const finalItems = merged.slice(0, limit)
        mcpActivityService.end(activityId, { ok: true })
        return {
          ok: true,
          query,
          total: finalItems.length,
          items: finalItems,
          hint: '可使用 skill_install({ url }) 安装 GitHub 技能，或使用 skill_install({ marketId }) 安装官方市场技能。若目标技能 hasScripts 为 true 且需要安装可执行脚本，请先用 ask_user 征得用户同意后再传 allowScripts: true。'
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        mcpActivityService.end(activityId, { ok: false, error: message })
        throw err
      }
    }
  },
  {
    name: 'skill_inspect_github',
    title: '预检 GitHub 技能地址',
    description:
      '解析并预检一个 GitHub 技能地址（支持仓库根地址 `https://github.com/owner/repo`、子目录 `https://github.com/owner/repo/tree/main/skills/xxx`、单文件 `.../blob/.../SKILL.md` 或 `raw.githubusercontent.com/...`），列出该地址下发现的全部 SKILL.md 技能包、描述、是否含 `scripts/` 可执行脚本及是否已安装。只读操作。',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'GitHub 仓库 / 子目录 / SKILL.md URL'
        }
      },
      required: ['url']
    },
    handler: async (args) => {
      const url = readString(args, 'url')
      const res = await inspectGitHubSkillSource({ url })
      if (!res.ok || !res.skills) {
        throw new Error(
          res.error
            ? `GitHub 技能预检失败（${res.reasonKey ?? 'error'}）：${res.error}`
            : `未在该 GitHub 地址下发现合法的 SKILL.md 技能包（reason: ${res.reasonKey ?? 'noSkillsFound'}）`
        )
      }
      return {
        ok: true,
        source: res.source,
        total: res.skills.length,
        skills: res.skills.map((s) => ({
          name: s.name,
          slashCommand: `/${s.name}`,
          description: s.description,
          repoSubpath: s.repoSubpath,
          version: s.version,
          author: s.author,
          license: s.license,
          hasScripts: s.hasScripts,
          scriptFiles: s.scriptFiles,
          hasWorkflow: s.hasWorkflow,
          fileCount: s.files.length,
          installed: s.installed
        }))
      }
    }
  },
  {
    name: 'skill_install',
    title: '安装技能（GitHub URL 或官方市场）',
    description:
      '从 GitHub 技能 URL（`url`）或官方技能市场（`marketId`）安装技能到本机 `$DSH_HOME/skills/<name>/SKILL.md`。' +
      '支持直接传入用户给出的 GitHub 仓库/子目录/SKILL.md 链接，或传入 `skill_search` 搜索到的 `url` / `marketId`。' +
      '若一个 GitHub 仓库包含多个技能，可通过 `skillNames` 指定要安装的子集（省略则全部安装）。' +
      '安全准则：默认不安装 `scripts/` 目录下的可执行脚本（仅安装 SKILL.md 与 references/ 文档）；若技能包含 `scripts/` 且确实需要执行随包脚本，请先询问用户确认后再传 `allowScripts: true`。' +
      '安装成功后会在返回结果中直接附带已安装技能的完整 `instructions`（SKILL.md 正文）与 `skillDir`，你在当前对话轮次即可立即按该技能指南执行，无需重启会话！',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description:
            'GitHub 技能地址（仓库根 URL、/tree/<branch>/<subpath>、/blob/.../SKILL.md 或 raw.githubusercontent.com URL；与 marketId 二选一）'
        },
        marketId: {
          type: 'string',
          description: '官方技能市场条目 ID（来自 skill_search 返回的 marketId；与 url 二选一）'
        },
        skillNames: {
          type: 'array',
          items: { type: 'string' },
          description:
            '可选：当 GitHub 仓库内包含多个技能时，指定只安装这些技能名（省略则安装该 URL 下的全部技能）'
        },
        allowScripts: {
          type: 'boolean',
          description:
            '可选：是否允许安装 scripts/ 目录下的可执行脚本（默认 false，需用户明示同意后方可设为 true）'
        }
      }
    },
    handler: async (args) => {
      const url = optionalString(args, 'url')
      const marketId = optionalString(args, 'marketId')
      const skillNames = readStringList(args, 'skillNames')
      const allowScripts = args.allowScripts === true

      if (!url && !marketId) {
        throw new Error('请提供 GitHub 技能地址 `url` 或官方市场 `marketId`')
      }

      const label = url || marketId || 'skill'
      const activityId = mcpActivityService.begin({
        tool: 'skill_install',
        title: `安装技能 · ${skillNames.length ? skillNames.join(', ') : label}`,
        detail: url ? `从 GitHub 安装：${url}` : `从官方技能市场安装：${marketId}`
      })

      try {
        let installedNames: string[] = []
        let skippedScriptsFor: string[] = []

        if (marketId && !url) {
          const catalog = await fetchSkillCatalog()
          if (!catalog.ok || !catalog.entries) {
            throw new Error(`获取官方技能市场目录失败：${catalog.reasonKey ?? 'network'}`)
          }
          const normalizedId = marketId.replace(/^\/+/, '').replace(/^wf-/, '')
          const entry = catalog.entries.find(
            (item) =>
              item.id === marketId ||
              item.id === normalizedId ||
              item.skill?.name === marketId ||
              item.skill?.name === `wf-${normalizedId}`
          )
          if (!entry) {
            throw new Error(`未在官方技能市场找到条目：${marketId}`)
          }
          const res = await installSkillFromMarket({
            id: entry.id,
            skill: entry.skill,
            skillScriptsConsent: allowScripts,
            scriptConsent: allowScripts,
            semanticPacks: entry.semanticPacks
          })
          if (!res.ok) {
            throw new Error(
              `安装市场技能「${entry.id}」失败（${res.reasonKey ?? 'error'}）${res.error ? `：${res.error}` : ''}`
            )
          }
          const installedSkillName = entry.skill?.name ?? `wf-${entry.id}`
          installedNames = [installedSkillName]
          const hasScriptsInManifest = Boolean(
            entry.skill?.files?.some((f) => f.path.startsWith('scripts/'))
          )
          if (hasScriptsInManifest && !allowScripts) {
            skippedScriptsFor = [installedSkillName]
          }
        } else if (url) {
          const res = await installGitHubSkills({
            url,
            ...(skillNames.length ? { skillNames } : {}),
            skillScriptsConsent: allowScripts
          })
          if (!res.ok) {
            throw new Error(
              `从 GitHub 安装技能失败（${res.reasonKey ?? 'error'}）${res.error ? `：${res.error}` : ''}`
            )
          }
          installedNames = res.installed
          skippedScriptsFor = res.skippedScriptsFor ?? []
        }

        const workspaceRoot = projectService.isOpen() ? projectService.getRoot() : undefined
        const allInstalled = discoverInstalledClaudeSkills({
          ...(workspaceRoot ? { workspaceRoot } : {})
        })
        const installedDetails = installedNames.map((name) => {
          const found = allInstalled.find((item) => item.name === name)
          return {
            name,
            slashCommand: `/${name}`,
            description: found?.frontmatter.description ?? '',
            skillDir: found?.dirPath ?? '',
            skillFilePath: found?.skillFilePath ?? '',
            hasScripts: found?.hasScripts ?? false,
            hasWorkflow: found?.hasWorkflow ?? false,
            extraFiles: found?.extraFiles ?? [],
            instructions: found?.body ?? ''
          }
        })

        mcpActivityService.end(activityId, { ok: true })

        return {
          ok: true,
          installed: installedNames,
          slashCommands: installedNames.map((n) => `/${n}`),
          ...(skippedScriptsFor.length
            ? {
                skippedScriptsFor,
                scriptsNote: `技能 ${skippedScriptsFor.join(', ')} 含有 scripts/ 可执行脚本，本次已默认跳过脚本仅安装 SKILL.md 与参考文档。若需要运行随包脚本，请用 ask_user 征得用户同意后以 allowScripts: true 重新调用 skill_install。`
              }
            : {}),
          skills: installedDetails,
          studioNodeCapabilitiesBridge: buildStudioNodeCapabilitiesBridge(),
          hint: '技能已安装落盘，且上方 skills[].instructions 已包含完整的 SKILL.md 指南，同时 studioNodeCapabilitiesBridge 已提供本项目全部内置画布节点与工具能力，你可在本轮立即结合该技能规范与项目节点能力继续完成任务；用户也可在输入框通过 /技能名 随时调用。'
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        mcpActivityService.end(activityId, { ok: false, error: message })
        throw err
      }
    }
  },
  {
    name: 'skill_uninstall',
    title: '卸载技能',
    description: '按技能名卸载已安装的技能包（支持传入技能名如 `mcp-builder` 或 `/mcp-builder`）。',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: '要卸载的技能名（如 "mcp-builder" 或 "/mcp-builder"）'
        }
      },
      required: ['name']
    },
    handler: async (args) => {
      const rawName = readString(args, 'name').trim().replace(/^\/+/, '')
      if (!rawName) throw new Error('请提供要卸载的技能名称')
      const marketMatch = listInstalledWorkflowDetails().find(
        (w) => w.id === rawName || w.skillName === rawName
      )
      if (marketMatch) {
        const wfRes = uninstallSkillFromMarket({ id: marketMatch.id })
        if (!wfRes.ok) {
          throw new Error(`卸载市场技能失败：${wfRes.error ?? wfRes.reasonKey ?? 'removeFailed'}`)
        }
        return {
          ok: true,
          uninstalled: rawName,
          marketId: marketMatch.id
        }
      }
      const res = uninstallSkillByName(rawName)
      if (!res.ok) {
        throw new Error(`卸载技能「${rawName}」失败：${res.error ?? 'removeFailed'}`)
      }
      return {
        ok: true,
        uninstalled: rawName
      }
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

/** 最近一次通过 graph_edit 操作的画布资产与触达节点列表：供紧接着的 task_run / graph_read 缺省复用 */
let lastMcpGraphEditTarget: { assetId: string; nodeIds: string[] } | null = null

/**
 * 解析或按需创建当前工程的宿主画布资产：
 * - 若显式传入 assetId（且非 current / active），按 id 查找；
 * - 若缺省，优先复用最近一次 graph_edit 触达的画布资产，其次选工程内已有的自由画布（canvas）或任意含 graphJson 的宿主资产；
 * - 若工程内尚无任何画布资产且 autoCreateCanvas=true，自动新建并广播一个自由画布资产，确保无需预建即可直接在画布上建节点并实时执行。
 */
function resolveOrEnsureCanvasAsset(
  rawAssetId: string | undefined,
  options?: { autoCreateCanvas?: boolean }
): AssetInfo | undefined {
  const trimmed = rawAssetId?.trim() ?? ''
  if (trimmed && trimmed !== 'current' && trimmed !== 'active') {
    return findAssetOrThrow(trimmed)
  }
  const assets = projectService.listAssets()
  const hasGraphDoc = (item: AssetInfo | undefined): item is AssetInfo => {
    if (!item) return false
    const graphJson = (item.genParams as Record<string, unknown> | undefined)?.graphJson as
      GraphDocument | undefined
    return Boolean(graphJson && Array.isArray(graphJson.nodes))
  }
  if (lastMcpGraphEditTarget?.assetId) {
    const recent = assets.find((item) => item.id === lastMcpGraphEditTarget?.assetId)
    if (hasGraphDoc(recent)) return recent
  }
  const canvasAssets = assets
    .filter((item) => item.type === 'canvas' && hasGraphDoc(item))
    .sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')))
  if (canvasAssets.length) return canvasAssets[0]

  const anyGraphHost = assets
    .filter((item) => hasGraphDoc(item))
    .sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')))
  if (anyGraphHost.length) return anyGraphHost[0]

  if (options?.autoCreateCanvas) {
    const created = projectService.createAsset({ type: 'canvas' })
    broadcastToAllWindows(IpcChannels.ASSET_UPDATED, created)
    return created
  }
  return undefined
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
  const hidden = new Set(doc.hiddenTracks ?? [])
  const visibleClips = doc.clips.filter((c) => !hidden.has(c.track))
  return {
    clips: visibleClips.map(toExportClip),
    durationSec: contentEndSecOfTimeline(visibleClips),
    ...(extra?.defaultFileName ? { defaultFileName: extra.defaultFileName } : {}),
    ...(extra?.targetPath ? { targetPath: extra.targetPath } : {}),
    ...(settings.playbackRate ? { playbackRate: settings.playbackRate } : {}),
    ...(settings.exportWidth ? { width: settings.exportWidth } : {}),
    ...(settings.exportHeight ? { height: settings.exportHeight } : {}),
    ...(settings.exportFps ? { fps: settings.exportFps } : {}),
    ...(settings.exportVideoBitrateKbps
      ? { videoBitrateKbps: settings.exportVideoBitrateKbps }
      : {}),
    ...(settings.scaleMode ? { scaleMode: settings.scaleMode } : {}),
    ...(settings.subtitleFontSize ? { subtitleFontSize: settings.subtitleFontSize } : {}),
    ...(settings.subtitleYOffset != null ? { subtitleYOffset: settings.subtitleYOffset } : {}),
    ...(settings.subtitleColor ? { subtitleColor: settings.subtitleColor } : {}),
    ...(settings.subtitleBorderColor ? { subtitleBorderColor: settings.subtitleBorderColor } : {}),
    ...(settings.subtitleBorderWidth != null
      ? { subtitleBorderWidth: settings.subtitleBorderWidth }
      : {}),
    ...(settings.subtitleBoxEnabled != null
      ? { subtitleBoxEnabled: settings.subtitleBoxEnabled }
      : {}),
    ...(settings.subtitleBoxColor ? { subtitleBoxColor: settings.subtitleBoxColor } : {}),
    ...(settings.subtitleBoxOpacity != null
      ? { subtitleBoxOpacity: settings.subtitleBoxOpacity }
      : {}),
    ...(settings.subtitleMotion != null
      ? {
          subtitleMotion:
            settings.subtitleMotion === true || settings.subtitleMotion === 'fade' ? 'fade' : 'none'
        }
      : {}),
    ...(settings.mixGains ? { mixGains: settings.mixGains } : {}),
    ...(settings.mixMasterGain != null ? { mixMasterGain: settings.mixMasterGain } : {}),
    ...(settings.mixBassGainDb != null ? { mixBassGainDb: settings.mixBassGainDb } : {}),
    ...(settings.mixTrebleGainDb != null ? { mixTrebleGainDb: settings.mixTrebleGainDb } : {}),
    ...(settings.mixCompression != null ? { mixCompression: settings.mixCompression } : {}),
    ...(settings.mixAutoDucking != null ? { mixAutoDucking: settings.mixAutoDucking } : {}),
    ...(settings.mixDuckingRatio != null ? { mixDuckingRatio: settings.mixDuckingRatio } : {}),
    ...(settings.mixLoudnorm != null ? { mixLoudnorm: settings.mixLoudnorm } : {}),
    ...(settings.watermarkEnabled && settings.watermarkSrc
      ? { watermarkSrc: settings.watermarkSrc }
      : {}),
    ...(settings.watermarkOpacity != null ? { watermarkOpacity: settings.watermarkOpacity } : {}),
    ...(settings.watermarkScale != null ? { watermarkScale: settings.watermarkScale } : {}),
    ...(settings.watermarkPosition === 'br' ||
    settings.watermarkPosition === 'bl' ||
    settings.watermarkPosition === 'tr' ||
    settings.watermarkPosition === 'tl'
      ? { watermarkPosition: settings.watermarkPosition }
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
  const rel =
    clip.relativePath?.trim() ||
    (clip.assetId
      ? projectService
          .listAssets()
          .find((a) => a.id === clip.assetId)
          ?.relativePath?.trim()
      : undefined)
  return {
    track: clip.track,
    title: clip.title,
    startSec: clip.startSec,
    durationSec: clip.durationSec,
    ...(rel ? { relativePath: rel } : {}),
    ...(clip.text ? { text: clip.text } : {}),
    ...(clip.textColor ? { textColor: clip.textColor } : {}),
    ...(clip.fontSize != null ? { fontSize: clip.fontSize } : {}),
    ...(clip.sourceOffsetSec != null ? { sourceOffsetSec: clip.sourceOffsetSec } : {}),
    ...(clip.speed != null ? { speed: clip.speed } : {}),
    ...(clip.freezeTailSec != null ? { freezeTailSec: clip.freezeTailSec } : {}),
    ...(clip.brightness != null ? { brightness: clip.brightness } : {}),
    ...(clip.contrast != null ? { contrast: clip.contrast } : {}),
    ...(clip.saturation != null ? { saturation: clip.saturation } : {}),
    ...(clip.vibrance != null ? { vibrance: clip.vibrance } : {}),
    ...(clip.temperature != null ? { temperature: clip.temperature } : {}),
    ...(clip.tint != null ? { tint: clip.tint } : {}),
    ...(clip.highlights != null ? { highlights: clip.highlights } : {}),
    ...(clip.shadows != null ? { shadows: clip.shadows } : {}),
    ...(clip.sharpen != null ? { sharpen: clip.sharpen } : {}),
    ...(clip.vignette != null ? { vignette: clip.vignette } : {}),
    ...(clip.fade != null ? { fade: clip.fade } : {}),
    ...(clip.grain != null ? { grain: clip.grain } : {}),
    ...(clip.filterPreset ? { filterPreset: clip.filterPreset } : {}),
    ...(clip.filterIntensity != null ? { filterIntensity: clip.filterIntensity } : {}),
    ...(clip.visualEffect ? { visualEffect: clip.visualEffect } : {}),
    ...(clip.effectIntensity != null ? { effectIntensity: clip.effectIntensity } : {}),
    ...(clip.volume != null ? { volume: clip.volume } : {}),
    ...(clip.fadeInSec != null ? { fadeInSec: clip.fadeInSec } : {}),
    ...(clip.fadeOutSec != null ? { fadeOutSec: clip.fadeOutSec } : {}),
    ...(clip.overlayX != null ? { overlayX: clip.overlayX } : {}),
    ...(clip.overlayY != null ? { overlayY: clip.overlayY } : {}),
    ...(clip.overlayWidth != null ? { overlayWidth: clip.overlayWidth } : {}),
    ...(clip.overlayHeight != null ? { overlayHeight: clip.overlayHeight } : {}),
    ...(clip.overlayRotation != null ? { overlayRotation: clip.overlayRotation } : {}),
    ...(clip.cropX != null ? { cropX: clip.cropX } : {}),
    ...(clip.cropY != null ? { cropY: clip.cropY } : {}),
    ...(clip.cropWidth != null ? { cropWidth: clip.cropWidth } : {}),
    ...(clip.cropHeight != null ? { cropHeight: clip.cropHeight } : {}),
    ...(clip.opacity != null ? { opacity: clip.opacity } : {}),
    ...(clip.tweenIn ? { tweenIn: clip.tweenIn } : {}),
    ...(clip.tweenInDurationSec != null ? { tweenInDurationSec: clip.tweenInDurationSec } : {}),
    ...(clip.tweenInEase ? { tweenInEase: clip.tweenInEase } : {}),
    ...(clip.tweenOut ? { tweenOut: clip.tweenOut } : {}),
    ...(clip.tweenOutDurationSec != null ? { tweenOutDurationSec: clip.tweenOutDurationSec } : {}),
    ...(clip.tweenOutEase ? { tweenOutEase: clip.tweenOutEase } : {}),
    ...(clip.tweenLoop ? { tweenLoop: clip.tweenLoop } : {}),
    ...(clip.tweenLoopSpeedHz != null ? { tweenLoopSpeedHz: clip.tweenLoopSpeedHz } : {}),
    ...(clip.tweenLoopIntensity != null ? { tweenLoopIntensity: clip.tweenLoopIntensity } : {}),
    ...(clip.cameraMotion ? { cameraMotion: clip.cameraMotion } : {}),
    ...(clip.keyframes?.length ? { keyframes: clip.keyframes } : {}),
    ...(clip.stickerId ? { stickerId: clip.stickerId } : {}),
    ...(clip.stickerColor ? { stickerColor: clip.stickerColor } : {}),
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
const TIMELINE_EDIT_OPS = [
  'add',
  'update',
  'batchUpdate',
  'applyTemplate',
  'remove',
  'subtitles'
] as const

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
function readTimelineEditRows(value: unknown, allowEmpty = false): Record<string, unknown>[] {
  if (!Array.isArray(value) || !value.length) {
    if (allowEmpty && Array.isArray(value)) return []
    throw new Error(
      `缺少编辑指令「operations」：至少给一条 { op: ${TIMELINE_EDIT_OPS.map((o) => `"${o}"`).join(' | ')} }`
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
    if (row.op === 'batchUpdate') {
      const patch = row.patch
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
        throw new Error(`${label}（batchUpdate）缺少 patch 对象：把要批量改的字段放进去`)
      }
      const track = typeof row.track === 'string' && row.track.trim() ? row.track.trim() : undefined
      const clipIds = readStringList(row, 'clipIds')
      operations.push({
        op: 'batchUpdate',
        ...(track ? { track: track as ScriptTimelineTrackKind } : {}),
        ...(clipIds.length ? { clipIds } : {}),
        patch: patch as TimelineClipPatch
      })
      return
    }
    if (row.op === 'applyTemplate') {
      const templateId = typeof row.templateId === 'string' ? row.templateId.trim() : ''
      if (!templateId) {
        throw new Error(`${label}（applyTemplate）缺少 templateId`)
      }
      operations.push({ op: 'applyTemplate', templateId })
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
    case 'invalid-template':
      return `${failure.op} ${target}：未知的成片模板 ID`
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

/** 单张视觉自检图最大体积（4MB），避免超大原图撑爆 MCP 响应体 */
const VISUAL_SELF_CRITIQUE_MAX_BYTES = 4 * 1024 * 1024

/**
 * 阶段二：视觉多模态自检闭环（Visual Self-Critique Loop）。
 * 把工程内刚生成的图片（如 `generate_image` 或 `task_run` 产物）转成 data URL 放进 `mcpImages`，
 * 由 `splitToolImages` 自动拆成 MCP `image` content block 回传给支持视觉输入的大模型，
 * 让 Agent 真正「睁眼看画面」发现构图/穿模/文字崩坏并自主调参重绘。
 */
export function readVisualCheckImagesForRelativePaths(
  relativePaths: ReadonlyArray<string | undefined | null>,
  maxImages = 3
): string[] {
  if (!projectService.isOpen()) return []
  let root: string
  try {
    root = projectService.getRoot()
  } catch {
    return []
  }
  const out: string[] = []
  for (const raw of relativePaths) {
    if (out.length >= maxImages) break
    const rel = typeof raw === 'string' ? normalizeProjectRelativePath(raw) : null
    if (!rel) continue
    const lower = rel.toLowerCase()
    const extMime = lower.endsWith('.png')
      ? 'image/png'
      : lower.endsWith('.webp')
        ? 'image/webp'
        : lower.endsWith('.jpg') || lower.endsWith('.jpeg')
          ? 'image/jpeg'
          : lower.endsWith('.gif')
            ? 'image/gif'
            : null
    if (!extMime) continue
    try {
      const abs = join(root, rel)
      if (!existsSync(abs)) continue
      const stat = statSync(abs)
      if (!stat.isFile() || stat.size <= 0 || stat.size > VISUAL_SELF_CRITIQUE_MAX_BYTES) continue
      const buf = readFileSync(abs)
      const mime = sniffImageMimeFromBytes(buf) ?? extMime
      out.push(`data:${mime};base64,${buf.toString('base64')}`)
    } catch {
      /* 单张读取失败忽略，不影响主工具返回 */
    }
  }
  return out
}

let canvasTaskSettledHook: ((report: McpTaskReportPayload) => void) | null = null

export function setCanvasTaskSettledHook(
  hook: ((report: McpTaskReportPayload) => void) | null
): void {
  canvasTaskSettledHook = hook
}

export interface McpToolSettledEvent {
  tool: string
  args: Record<string, unknown>
  result?: unknown
}

let mcpToolSettledHook: ((event: McpToolSettledEvent) => void) | null = null

export function setMcpToolSettledHook(hook: ((event: McpToolSettledEvent) => void) | null): void {
  mcpToolSettledHook = hook
}

/**
 * task_run 终态收尾：把渲染层回报的本轮产物写进旁路活动
 * （relativePath 供单产物消费方，relativePaths 供对话流出多张预览卡）。
 * 受理失败 / 停止等异常路径同样收尾，避免活动一直挂在「运行中」。
 */
function settleMcpTaskActivity(report: McpTaskReportPayload): void {
  const activityId = pendingMcpTaskActivities.get(report.mcpTaskId)
  if (activityId) {
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
  if (canvasTaskSettledHook) {
    try {
      canvasTaskSettledHook(report)
    } catch {
      /* ignore hook error */
    }
  }
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
    if (mcpToolSettledHook) {
      try {
        mcpToolSettledHook({ tool: name, args, result })
      } catch {
        /* ignore hook error */
      }
    }
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
      const existing = pendingMcpTaskReports.get(payload.mcpTaskId)
      // 防重入保护：若该 mcpTaskId 已被受理（accepted + taskId）或已进入终态（finished），
      // 忽略来自重复监听器无匹配 taskId 的冲突失败回报（如「该图已有进行中的同目标任务」），
      // 避免把正在运行的真实任务覆盖成 failed 并提前关闭 McpActivity。
      if (
        existing &&
        (existing.phase === 'finished' ||
          (existing.phase === 'accepted' &&
            payload.phase === 'failed' &&
            (!payload.taskId || payload.taskId !== existing.taskId)))
      ) {
        return true
      }
      const mergedPaths = Array.from(
        new Set(
          [...(existing?.relativePaths ?? []), ...(payload.relativePaths ?? [])].filter(
            (path): path is string => typeof path === 'string' && !!path.trim()
          )
        )
      )
      const nextPayload: McpTaskReportPayload = {
        ...existing,
        ...payload,
        ...(mergedPaths.length ? { relativePaths: mergedPaths } : {})
      }
      pendingMcpTaskReports.set(payload.mcpTaskId, nextPayload)
      if (payload.phase === 'accepted') {
        const activityId = pendingMcpTaskActivities.get(payload.mcpTaskId)
        if (activityId && mergedPaths.length) {
          mcpActivityService.update(activityId, {
            relativePath: mergedPaths[0],
            relativePaths: mergedPaths
          })
        }
      } else {
        // 终态（成功或失败）保留一段可查询时间后自动回收，避免 Map 无限增长
        settleMcpTaskActivity(nextPayload)
        scheduleTaskReportCleanup(payload.mcpTaskId)
      }
    }
    return true
  })
  ipcMain.handle(
    IpcChannels.MCP_GRAPH_EDIT_RESULT,
    (_event, payload: McpGraphEditResultPayload) => {
      if (payload && typeof payload.requestId === 'string') {
        if (pendingMcpGraphEditResults.has(payload.requestId)) {
          return true
        }
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
