import type { AppSettings, AssetFolder, AssetInfo, AssetType, ProjectConfig } from './domain'
import type { WorkspaceToolbarItem } from './workspaceToolbar'
import type { TimelineExportInput, TimelineExportResult } from './graph'
import type {
  CatalogModel,
  GenerateImageInput,
  GenerateImageResult,
  GenerateSpeechInput,
  GenerateSpeechResult,
  GenerateTextInput,
  GenerateTextResult,
  GenerateVideoInput,
  GenerateVideoResult,
  GenerateModel3dInput,
  GenerateModel3dResult,
  ListModelsInput,
  ModelProviderKindMeta
} from './modelProvider'
import type { ObjectStorageKindMeta } from './objectStorage'

export const IpcChannels = {
  // Project
  PROJECT_CREATE: 'project:create',
  PROJECT_OPEN: 'project:open',
  PROJECT_SAVE: 'project:save',
  PROJECT_GET_RECENT: 'project:get-recent',
  PROJECT_REMOVE_RECENT: 'project:remove-recent',
  PROJECT_CLOSE: 'project:close',
  DIALOG_SELECT_DIRECTORY: 'dialog:select-directory',
  DIALOG_SELECT_PROJECT: 'dialog:select-project',
  DIALOG_SELECT_FILES: 'dialog:select-files',

  // Assets
  ASSET_LIST: 'asset:list',
  ASSET_IMPORT: 'asset:import',
  ASSET_REIMPORT: 'asset:reimport',
  ASSET_CREATE: 'asset:create',
  ASSET_DELETE: 'asset:delete',
  ASSET_RENAME: 'asset:rename',
  ASSET_UPDATE: 'asset:update',
  ASSET_ATTACH_FILE: 'asset:attach-file',
  ASSET_GET_FILE_URL: 'asset:get-file-url',
  ASSET_GET_PREVIEW_URL: 'asset:get-preview-url',
  /** 将文本写回资产旁挂文件（剧本 txt 等） */
  ASSET_WRITE_TEXT: 'asset:write-text',
  ASSET_SHOW_IN_FOLDER: 'asset:show-in-folder',
  ASSET_SHOW_FOLDER: 'asset:show-folder',
  VIDEO_DETECT_KEYFRAMES: 'video:detect-keyframes',
  /** 将选中资产的原始媒体文件复制到系统剪贴板 */
  ASSET_COPY_ORIGINAL_FILES: 'asset:copy-original-files',
  /** 主进程写系统剪贴板文本（脱离主窗口的弹窗无文档焦点时 navigator.clipboard 不可用） */
  CLIPBOARD_WRITE_TEXT: 'clipboard:write-text',
  ASSET_FIND_REFERENCES: 'asset:find-references',

  ASSET_PACKAGE_EXPORT: 'asset-package:export',
  ASSET_PACKAGE_IMPORT: 'asset-package:import',
  ASSET_PACKAGE_PREVIEW: 'asset-package:preview',

  // Asset folders
  FOLDER_LIST: 'folder:list',
  FOLDER_CREATE: 'folder:create',
  FOLDER_RENAME: 'folder:rename',
  FOLDER_DELETE: 'folder:delete',

  // Generation
  GEN_TEXT: 'gen:text',
  GEN_IMAGE: 'gen:image',
  GEN_VIDEO: 'gen:video',
  GEN_SPEECH: 'gen:speech',
  GEN_MODEL3D: 'gen:model3d',
  /** AI 自由构图：仅规划预览，不落盘 */
  GEN_AI_WORKFLOW_PLAN: 'gen:ai-workflow-plan',
  /** AI 自由构图：确认 GraphPlan 后落盘 */
  GEN_AI_WORKFLOW_COMMIT: 'gen:ai-workflow-commit',
  /** 持久化视频任务列表 */
  VIDEO_JOB_LIST: 'video-job:list',
  VIDEO_JOB_GET: 'video-job:get',
  VIDEO_JOB_CANCEL: 'video-job:cancel',
  /** 主进程推送：视频任务状态变更 */
  VIDEO_JOB_UPDATED: 'video-job:updated',

  // Model catalog
  MODELS_LIST: 'models:list',
  /** 主进程 Cordis 已装载的提供商 kind 目录 */
  PROVIDERS_LIST_KINDS: 'providers:list-kinds',
  /** 主进程 Cordis 已装载的对象存储 kind 目录 */
  OBJECT_STORAGE_LIST_KINDS: 'object-storage:list-kinds',

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',

  // App version & updates
  APP_GET_VERSION: 'app:get-version',
  UPDATE_CHECK: 'update:check',
  UPDATE_INSTALL: 'update:install',
  /** 主进程推送：更新状态 */
  UPDATE_EVENT: 'update:event',

  // Editor autosave shadow documents
  AUTOSAVE_WRITE: 'autosave:write',
  AUTOSAVE_LIST: 'autosave:list',
  AUTOSAVE_READ: 'autosave:read',
  AUTOSAVE_DISCARD: 'autosave:discard',

  // Declarative external extensions
  PLUGIN_LIST: 'plugin:list',

  /** 将图执行产物 dataUrl 写入图片输出目录（默认 Output/images） */
  GRAPH_SAVE_RUN_MEDIA: 'graph:save-run-media',
  /** 将图执行产物文本写入剧本输出目录（默认 Assets/{资产名}/Texts） */
  GRAPH_SAVE_RUN_TEXT: 'graph:save-run-text',
  /** 读取工程内相对路径文本文件（agent-state.json 等） */
  PROJECT_READ_FILE: 'project:read-file',
  /** 写入工程内相对路径文本文件（agent-state.json 等） */
  PROJECT_WRITE_FILE: 'project:write-file',
  /** 删除图执行产物及对应缩略图（允许的图片输出目录内） */
  GRAPH_DELETE_RUN_MEDIA: 'graph:delete-run-media',
  /** 用工程内相对路径媒体挂到资产上 */
  ASSET_ATTACH_RELATIVE: 'asset:attach-relative',
  /** 将工程内媒体读成 data URL（视频/音频参考等） */
  ASSET_MEDIA_DATA_URL: 'asset:media-data-url',
  /** 将工程内参考视频上传到对象存储并返回可访问 URL */
  OBJECT_STORAGE_UPLOAD_MEDIA: 'object-storage:upload-media',

  // Save arbitrary text to a user-chosen path
  DIALOG_SAVE_TEXT_FILE: 'dialog:save-text-file',
  // Save binary (e.g. video) to a user-chosen path
  DIALOG_SAVE_BINARY_FILE: 'dialog:save-binary-file',
  /** 选择目录后批量写入多个二进制文件 */
  DIALOG_SAVE_BINARY_FILES_TO_DIRECTORY: 'dialog:save-binary-files-to-directory',

  /** 成片时间线导出 */
  TIMELINE_EXPORT: 'timeline:export',
  /** 主进程推送：成片导出进度 0~1 */
  TIMELINE_EXPORT_PROGRESS: 'timeline:export-progress',

  /** 广告变体：导出入选单元格的生成图到用户选择目录 */
  AD_VARIANT_EXPORT: 'ad-variant:export',

  /** 主进程推送：资产已写入（多窗口同步） */
  ASSET_UPDATED: 'asset:updated',

  /** MCP：主进程派发工作流运行请求（main → 渲染层） */
  MCP_TASK_RUN: 'mcp:task-run',
  /** MCP：渲染层回报任务受理 / 终态（渲染层 → 主进程） */
  MCP_TASK_REPORT: 'mcp:task-report',
  /** MCP：主进程派发图编辑操作批（main → 渲染层） */
  MCP_GRAPH_EDIT: 'mcp:graph-edit',
  /** MCP：渲染层回报图编辑结果（渲染层 → 主进程） */
  MCP_GRAPH_EDIT_RESULT: 'mcp:graph-edit-result',
  /** MCP：渲染层查询工具服务状态（端口 / token / 接入命令，设置界面展示） */
  MCP_GET_INFO: 'mcp:get-info',
  /** MCP：设置界面应用端口 / 重置 token 修改并重启工具服务 */
  MCP_RESTART: 'mcp:restart',
  /** MCP：主进程推送旁路生成活动（生成中 / 完成 / 失败，任务列表与执行日志可见） */
  MCP_ACTIVITY_UPDATED: 'mcp:activity-updated',
  /** MCP：主进程清空旁路生成活动（工程关闭时） */
  MCP_ACTIVITY_CLEARED: 'mcp:activity-cleared',
  /** MCP：主进程派发 agent 的 ask_user 提问（main → 渲染层，展示选项列表供用户选择） */
  MCP_ASK_USER: 'mcp:ask-user',
  /** MCP：渲染层回报用户对 ask_user 提问的选择（渲染层 → 主进程） */
  MCP_ASK_USER_RESPONSE: 'mcp:ask-user-response',
  /** MCP：渲染层查询当前旁路生成活动列表 */
  MCP_ACTIVITY_LIST: 'mcp:activity-list',
  /** Harness：查询 DeepSeek Harness (dsh) 接入状态（Node / dsh / MCP / 密钥） */
  HARNESS_STATUS: 'harness:status',
  /** Harness：运行一次对话任务（main 进程 spawn dsh） */
  HARNESS_RUN: 'harness:run',
  /** Harness：中止当前任务 */
  HARNESS_ABORT: 'harness:abort',
  /** Harness：删除会话在磁盘上的持久化记录（对应前端 ChatSession.id） */
  HARNESS_DELETE_SESSION: 'harness:delete-session',
  /** Harness：查询 dsh 自定义技能目录信息（路径 / 文件清单 / 内置技能数） */
  SKILLS_GET_INFO: 'skills:get-info',
  /** Harness：在系统文件管理器中打开 dsh 自定义技能目录 */
  SKILLS_OPEN_DIR: 'skills:open-dir',
  /** Harness：写入一个示例 SKILL.md 模板（同名已存在则跳过） */
  SKILLS_WRITE_TEMPLATE: 'skills:write-template',
  /** Skills：查询内置技能模板库（应用内置 GraphSkill 提炼的可复用模板清单） */
  SKILLS_LIST_TEMPLATES: 'skills:list-templates',
  /** Skills：把内置技能模板导出为技能目录中的 .example 模板文件（同名跳过） */
  SKILLS_EXPORT_TEMPLATE: 'skills:export-template',
  /** Skills：查询本次会话可用的技能清单（内置快照 + 用户自定义，供对话技能调试视图） */
  SKILLS_GET_SESSION: 'skills:get-session',
  /** Skills：把用户自定义 .md 技能反向导入为应用 GraphSkill（双向同步工具） */
  SKILLS_IMPORT_TO_GRAPH: 'skills:import-to-graph',
  /** Harness：任务事件流（main → 渲染层，assistant / status / tool / done / error） */
  HARNESS_EVENT: 'harness:event'
} as const

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels]

export interface CreateProjectInput {
  name: string
  parentDir: string
}

export interface OpenProjectResult {
  rootPath: string
  config: ProjectConfig
  assets: AssetInfo[]
  folders: AssetFolder[]
}

export interface ImportAssetsInput {
  filePaths: string[]
  folderId?: string | null
}

export interface ImportAssetsResult {
  imported: AssetInfo[]
  skipped: { path: string; reason: string }[]
}

export interface ReimportAssetsInput {
  assetIds: string[]
  /** 若提供，优先修复该目录子树下的 `.folder.json` / 孤儿媒体元数据（可无资产） */
  folderId?: string | null
}

export interface ReimportAssetsResult {
  reimported: AssetInfo[]
  skipped: { id: string; name: string; reason: string }[]
  /** 修复后的完整目录列表 */
  folders: AssetFolder[]
}

export interface CreateAssetInput {
  type: AssetType
  name?: string
  folderId?: string | null
  prompt?: string
  notes?: string
  genParams?: Record<string, unknown>
  /** 脚本资产：为 true 时不自动创建首个分镜（由草稿保存流程写入） */
}

/** AI 自由构图：规划输入（可含图/视频默认模型与预设骨架） */
export interface PlanAiWorkflowInput {
  prompt: string
  model?: string
  providerInstanceId?: string
  imageModel?: string
  imageProviderInstanceId?: string
  videoModel?: string
  videoProviderInstanceId?: string
  /** 统一宽高比：写入所有图片/视频生成节点 */
  generateAspectRatio?: string
  presetId?: string
  /** true：只用预设固化拓扑，不调用文本模型 */
  useSeedOnly?: boolean
  seedPlan?: {
    title?: string
    nodes: Array<{
      key: string
      typeId: string
      title?: string
      params?: Record<string, unknown>
    }>
    edges: Array<{
      from: string
      to: string
      fromPort?: string
      toPort?: string
    }>
  }
}

export interface GraphPlanPreviewDto {
  title: string
  nodes: Array<{ key: string; typeId: string; title: string }>
  edges: Array<{ from: string; to: string; fromPort?: string; toPort?: string }>
}

/** AI 规划时的模型调用明细（写入执行日志） */
export interface PlanAiWorkflowApiCall {
  model: string
  request: {
    prompt?: string
    system?: string
    model?: string
    providerInstanceId?: string
  }
  response?: {
    text?: string
    model?: string
  }
  error?: string
  startedAt: number
  durationMs: number
}

export interface PlanAiWorkflowResult {
  ok: boolean
  plan?: PlanAiWorkflowInput['seedPlan'] & { title?: string }
  title?: string
  preview?: GraphPlanPreviewDto
  warnings: string[]
  error?: string
  /** 本次规划发起的模型调用（含重试）；模板直出时为空 */
  apiCalls?: PlanAiWorkflowApiCall[]
}

export interface CommitAiWorkflowInput {
  plan: NonNullable<PlanAiWorkflowResult['plan']>
  folderId?: string | null
  /** 资产显示名；缺省用计划 title */
  name?: string
  imageModel?: string
  imageProviderInstanceId?: string
  videoModel?: string
  videoProviderInstanceId?: string
  /** 统一宽高比：写入所有图片/视频生成节点 */
  generateAspectRatio?: string
}

export interface CommitAiWorkflowResult {
  ok: boolean
  assetId?: string
  title?: string
  warnings: string[]
  error?: string
}

export interface CreateFolderInput {
  name?: string
  parentId?: string | null
}

/** 删除目录：默认上移内容；deleteContents 则连同资产一并删除 */
export interface DeleteFolderInput {
  folderId: string
  mode?: 'hoist' | 'deleteContents'
}

export interface AttachAssetFileInput {
  assetId: string
  filePath: string
}

/** 写回剧本等文本旁挂文件 */
export interface WriteAssetTextInput {
  assetId: string
  content: string
}

/** MCP：主进程 → 渲染层，请求运行宿主资产工作流 */
export interface McpTaskRunPayload {
  mcpTaskId: string
  assetId: string
}

export type McpTaskReportPhase = 'accepted' | 'finished' | 'failed'

/** MCP：渲染层 → 主进程，回报受理与终态（含图任务 id 供界面查看） */
export interface McpTaskReportPayload {
  mcpTaskId: string
  phase: McpTaskReportPhase
  taskId?: string
  status?: 'done' | 'error' | 'stopped'
  error?: string
}

/** MCP：旁路生成活动类型（generate_* 等不进入工作流任务系统的直接生成） */
export type McpActivityTool =
  | 'generate_image'
  | 'generate_video'
  | 'generate_speech'
  | 'generate_model3d'

export type McpActivityStatus = 'running' | 'done' | 'error'

/** MCP：一次旁路生成活动的界面可见记录（主进程维护，事件推送给渲染层） */
export interface McpActivity {
  id: string
  tool: McpActivityTool
  title: string
  model?: string
  status: McpActivityStatus
  startedAt: number
  finishedAt?: number
  assetId?: string
  relativePath?: string
  error?: string
}

/** MCP：单条图编辑操作（见 shared/graph/mcpGraphEdit） */
export type McpGraphEditOp =
  | {
      op: 'node_upsert'
      nodeId?: string
      typeId: string
      title?: string
      params?: Record<string, unknown>
      x?: number
      y?: number
    }
  | {
      op: 'node_update'
      nodeId: string
      title?: string
      params?: Record<string, unknown>
    }
  | { op: 'node_delete'; nodeId: string }
  | {
      op: 'edge_connect'
      fromNodeId: string
      toNodeId: string
      fromPort?: string
      toPort?: string
    }
  | { op: 'edge_delete'; fromNodeId: string; toNodeId: string }

/** MCP：主进程 → 渲染层，请求对宿主资产图应用一批编辑操作 */
export interface McpGraphEditPayload {
  requestId: string
  assetId: string
  ops: McpGraphEditOp[]
}

/** MCP：渲染层 → 主进程，图编辑结果 */
export interface McpGraphEditResultPayload {
  requestId: string
  ok: boolean
  applied?: string[]
  warnings?: string[]
  error?: string
}

/** MCP：主进程 → 渲染层，agent 通过 ask_user 工具向用户提问（渲染层展示选项列表） */
export interface AskUserQuestion {
  requestId: string
  question: string
  /** 可选选项（建议 2–6 项）；缺省时渲染层提供默认按钮（继续 / 取消） */
  options?: string[]
  /** 附加说明（可选） */
  hint?: string
}

/** MCP：渲染层 → 主进程，用户对 ask_user 提问的选择 */
export interface AskUserAnswer {
  requestId: string
  /** 用户选中的选项文本；用户取消 / 超时 / 会话已结束为 null */
  answer: string | null
}

/** MCP：工具服务当前状态（设置界面展示接入信息用） */
export interface McpServerInfo {
  running: boolean
  /** 实际监听端口（应用在 43110–43119 中扫描） */
  port: number
  /** Bearer token；跨重启持久复用 */
  token: string
  /** 应用侧连接信息文件绝对路径（mcp.json，勿手改） */
  configPath: string
  /** 工具服务 HTTP 端点，如 http://127.0.0.1:43110/mcp */
  endpoint: string
}

/** Harness：DeepSeek Harness (dsh) 接入状态（Chat 面板顶部状态条展示） */
export interface HarnessStatus {
  /** 执行 dsh 所用 Node 版本（应用内置 Node 优先，显示为「内置」） */
  nodeVersion: string
  /** Node 版本是否满足 dsh 建议 */
  nodeOk: boolean
  /** dsh 是否已可用（内置运行体/本地安装，或 npx 已缓存） */
  dshReady: boolean
  /** 应用 MCP 工具服务是否在运行 */
  mcpRunning: boolean
  /** 应用 MCP 工具服务端点（仅展示） */
  mcpEndpoint?: string
  /** 是否已配置 DeepSeek 文本模型密钥 */
  /** 是否已配置可用文本模型 provider（DeepSeek 或任意 OpenAI 兼容文本 provider） */
  hasDeepseekKey: boolean
  /** 人话提示（缺 Node / 缺密钥 / MCP 未启动等） */
  message?: string
  /** dsh 工作区目录：当前打开的工程根目录；未打开工程时为 undefined（回退应用数据目录） */
  workspace?: string
}

/** Chat 面板的 agent 交互模式（类似 Cursor 的 Craft / Ask / Plan） */
export type ChatMode = 'craft' | 'ask' | 'plan'

/** Harness：一次对话任务输入（渲染层 → 主进程） */
export interface HarnessRunInput {
  /** 用户发给 agent 的任务文本 */
  task: string
  /**
   * 可选：agent 交互模式。
   * - craft：完整 agent，可调用工具并生成资产（默认）
   * - ask：仅回答问题，不调用工具 / 不修改任何文件
   * - plan：先输出执行计划并用 ask_user 请求用户确认，确认后才动手
   */
  mode?: ChatMode
  /**
   * 可选：会话 id（对应前端 ChatSession.id）。
   * dsh 据此「有则恢复、无则创建」持久化会话——多轮对话是真实消息序列
   * （含工具调用历史），模型通过会话恢复天然记住之前的聊天内容。
   */
  sessionId?: string
  /** 可选：dsh 使用的模型 id（默认取 provider 的默认文本模型） */
  model?: string
  /** 可选：所选模型所属的 provider 实例 id（默认 DeepSeek 或首个可用文本 provider） */
  providerId?: string
}

/** Harness：任务启动结果 */
export interface HarnessRunResult {
  started: boolean
  message?: string
}

/** Skills：dsh 技能目录中的一个文件 */
export interface DshSkillsFile {
  fileName: string
  /** builtin=应用内置技能快照生成；custom=用户自定义技能(.md)；template=示例模板 */
  kind: 'builtin' | 'custom' | 'template'
}

/** Skills：dsh 技能目录信息（渲染层设置页展示用） */
export interface DshSkillsInfo {
  /** skills 目录绝对路径 */
  dirPath: string
  /** 内置技能数量（由应用自动管理） */
  builtinCount: number
  /** 目录下文件清单（不含 manifest） */
  files: DshSkillsFile[]
}

/** Skills：写入示例模板结果 */
export interface DshSkillsTemplateResult {
  /** 写入（或已存在）的文件路径 */
  filePath: string
  /** true = 同名文件已存在、本次跳过未覆盖；false = 新写入 */
  skipped: boolean
}

/** Skills：内置技能模板库条目（应用内置 GraphSkill 提炼的可复用模板） */
export interface SkillTemplate {
  /** GraphSkill id */
  id: string
  /** 建议的 dsh 技能文件名（kebab-case，不含 .md） */
  name: string
  titleZh: string
  titleEn: string
  description: string
  /** 渲染后的 SKILL.md 完整内容 */
  content: string
}

/** Skills：会话中一个可用技能（对话技能调试视图展示） */
export interface SessionSkill {
  /** dsh 技能名（文件名去 .md） */
  name: string
  /** builtin=应用内置技能快照；custom=用户自定义 .md 技能 */
  kind: 'builtin' | 'custom'
  titleZh?: string
  titleEn?: string
  description: string
}

/** Skills：自定义 .md 技能反向导入 GraphSkill 的结果 */
export interface SkillImportResult {
  imported: string[]
  skipped: { name: string; reason: string }[]
}

/** Harness：任务事件流（main → 渲染层） */
export type HarnessEvent =
  | { type: 'assistant'; text: string }
  | { type: 'status'; text: string }
  | {
      type: 'tool'
      /** 工具调用实例 ID（dsh 的 callId）：同一工具多次调用可区分；旧数据可能缺失 */
      id?: string
      name: string
      state: 'start' | 'done' | 'error'
      detail?: string
    }
  | { type: 'reasoning'; text: string }
  | { type: 'final'; text: string }
  | { type: 'done'; runId: string }
  | { type: 'error'; message: string }
  | {
      /**
       * 首次启动解压内置 dsh 运行体的进度（安装包只带 zip，首次使用前解压到用户数据目录）。
       * 渲染层收到 progress = 1 时应重新拉取 harness 状态（getHarnessStatus）。
       */
      type: 'unpack'
      /** 已解压文件数 */
      count: number
      /** 总文件数 */
      total: number
    }
  | {
      /**
       * Harness provider 报告的最新一次 LLM 请求的真实输入上下文 token。
       * 多轮会话下是最近一次请求的完整输入（含缓存命中/写入）；无该事件时渲染层回退本地估算。
       */
      type: 'context'
      /** 当前上下文已用 token 数 */
      used: number
    }

/** MCP：设置界面提交的配置修改（重启时应用） */
export interface McpRestartInput {
  /** 期望端口；写入 mcp.json 作为下次启动偏好，重启后生效（被占用时自动顺延） */
  port?: number
  /** true 时生成新 token 并写回 mcp.json，旧 token 立即作废 */
  resetToken?: boolean
  /** 自定义 token（8–128 位、不含空白）；提供时优先于 resetToken */
  token?: string
}

export interface AttachAssetRelativeInput {
  assetId: string
  /** 工程内相对路径（如 Output/images/xxx.png） */
  relativePath: string
}

export interface SaveGraphRunMediaInput {
  /** data: URL，或 http(s) 远程媒体地址（由主进程下载落盘） */
  dataUrl: string
  /** 文件名主干（如「节点名_时间」）；扩展名由 MIME 决定 */
  key: string
  /** 相对工程根的输出目录；缺省 Assets/Generated/Images */
  outputDir?: string
}

export interface SaveGraphRunTextInput {
  /** 剧本文本正文 */
  content: string
  /** 文件名主干（如「节点名_时间」）；扩展名固定 .txt */
  key: string
  /** 相对工程根的输出目录；缺省 Assets/Generated/Texts */
  outputDir?: string
}

export type {
  ExportAssetPackageInput,
  ExportAssetPackageResult,
  ImportAssetPackageInput,
  ImportAssetPackageResult,
  PreviewAssetPackageResult
} from './assetPackage/types'

export type AutosaveKind = 'asset'

export interface AutosaveEntry {
  kind: AutosaveKind
  id: string
  relativePath: string
  savedAt: string
  canonicalUpdatedAt?: string
}

export interface AutosaveManifest {
  version: 1
  updatedAt: string
  entries: AutosaveEntry[]
}

export interface AutosaveWriteInput {
  kind: AutosaveKind
  id: string
  payload: AssetInfo
  canonicalUpdatedAt?: string
}

export interface AutosaveFilter {
  kind?: AutosaveKind
  id?: string
}

export interface ExternalPluginManifest {
  id: string
  version: string
  apiVersion: 1
  displayName: string
  permissions?: Array<
    'workspace.read' | 'workspace.write' | 'filesystem.read' | 'generation.run'
  >
  contributions?: {
    toolbarItems?: WorkspaceToolbarItem[]
  }
}

export interface SaveTextFileInput {
  content: string
  /** 另存为对话框的默认文件名 / 路径 */
  defaultPath?: string
  filters?: { name: string; extensions: string[] }[]
}

export interface SaveBinaryFileInput {
  /** 文件二进制（IPC 传 Uint8Array / Buffer） */
  data: Uint8Array
  defaultPath?: string
  filters?: { name: string; extensions: string[] }[]
}

export interface SaveBinaryFilesToDirectoryInput {
  files: Array<{
    /** 文件名；可用 `/` 表示相对子目录（如 `分组/01-层.png`） */
    fileName: string
    data: Uint8Array
  }>
}

export interface SaveBinaryFilesToDirectoryResult {
  directory: string
  written: number
}

/** 广告变体导出：单个待复制文件（工程内相对路径 → 目标文件名） */
export interface ExportAdVariantFileInput {
  relativePath: string
  fileName: string
}

export interface ExportAdVariantsInput {
  items: ExportAdVariantFileInput[]
}

export interface ExportAdVariantsResult {
  ok: boolean
  directory?: string
  copied?: number
  skipped?: number
  canceled?: boolean
  error?: string
}

export interface StudioApi {
  createProject: (input: CreateProjectInput) => Promise<OpenProjectResult>
  openProject: (projectJsonPath: string) => Promise<OpenProjectResult>
  saveProject: (config: ProjectConfig) => Promise<void>
  getRecentProjects: () => Promise<string[]>
  /** 仅从最近列表移除，不删除工程文件 */
  removeRecentProject: (projectJsonPath: string) => Promise<string[]>
  closeProject: () => Promise<void>
  selectDirectory: () => Promise<string | null>
  selectProject: () => Promise<string | null>
  selectFiles: (filters?: { name: string; extensions: string[] }[]) => Promise<string[]>
  /** 主进程写系统剪贴板文本（弹窗/脱离窗口等无文档焦点场景的可靠路径） */
  writeClipboardText: (text: string) => Promise<void>

  listAssets: () => Promise<AssetInfo[]>
  importAssets: (input: ImportAssetsInput) => Promise<ImportAssetsResult>
  /** 重新导入：从工程磁盘上的媒体文件刷新资产元数据与缓存（类似 Unity Reimport） */
  reimportAssets: (input: ReimportAssetsInput) => Promise<ReimportAssetsResult>
  createAsset: (input: CreateAssetInput) => Promise<AssetInfo>
  /** 创建剧集并预置剧本/世界/场/分镜宿主节点与连线 */
  deleteAsset: (assetId: string) => Promise<void>
  renameAsset: (assetId: string, name: string) => Promise<AssetInfo>
  updateAsset: (asset: AssetInfo) => Promise<AssetInfo>
  attachAssetFile: (input: AttachAssetFileInput) => Promise<AssetInfo>
  attachAssetRelative: (input: AttachAssetRelativeInput) => Promise<AssetInfo>
  getAssetFileUrl: (relativePath: string) => Promise<string>
  /** 预览级 URL（图片缩略图 / 视频首帧）；列表/节点卡应优先使用 */
  getAssetPreviewUrl: (relativePath: string) => Promise<string>
  /** 将文本写回资产旁挂文件（剧本 txt），并刷新 updatedAt */
  writeAssetText: (input: WriteAssetTextInput) => Promise<AssetInfo>
  /** 将工程内媒体读成 data URL，供生成 API 参考素材使用 */
  getAssetMediaDataUrl: (relativePath: string) => Promise<string>
  /**
   * 将工程内参考视频上传到已配置的对象存储（TOS），返回公网/预签名 URL。
   * 上传过程日志在主进程与返回的 logs 中。
   */
  uploadMediaToObjectStorage: (relativePath: string) => Promise<{
    url: string
    objectKey: string
    bytes: number
    sourceLabel: string
    logs: Array<{ level: 'info' | 'warn' | 'error'; message: string; ts: number }>
  }>
  /** 在系统文件管理器中显示资产对应文件（媒体或 meta） */
  showAssetInFolder: (assetId: string) => Promise<void>
  /** 在系统文件管理器中打开目录对应的真实磁盘文件夹 */
  showFolderInFolder: (folderId: string) => Promise<void>
  /** 用主进程 ffprobe 探测视频关键帧时间（秒）；无 ffprobe 或失败时返回 null */
  detectVideoKeyframes: (relativePath: string) => Promise<number[] | null>
  /** 复制选中资产的原始媒体文件到系统剪贴板（非缩略图） */
  copyAssetOriginalFiles: (
    assetIds: string[]
  ) => Promise<{ copied: number; mode: 'files' | 'text' }>
  findAssetReferences: (
    assetIds: string[]
  ) => Promise<import('./assetReferences').FindAssetReferencesResult>

  exportAssetPackage: (
    input: import('./assetPackage/types').ExportAssetPackageInput
  ) => Promise<import('./assetPackage/types').ExportAssetPackageResult>
  previewAssetPackage: (
    packPath?: string
  ) => Promise<import('./assetPackage/types').PreviewAssetPackageResult | null>
  importAssetPackage: (
    input?: import('./assetPackage/types').ImportAssetPackageInput
  ) => Promise<import('./assetPackage/types').ImportAssetPackageResult>

  listFolders: () => Promise<AssetFolder[]>
  createFolder: (input: CreateFolderInput) => Promise<AssetFolder>
  renameFolder: (folderId: string, name: string) => Promise<AssetFolder>
  deleteFolder: (input: DeleteFolderInput | string) => Promise<void>

  generateText: (input: GenerateTextInput) => Promise<GenerateTextResult>
  generateImage: (input: GenerateImageInput) => Promise<GenerateImageResult & { assetId?: string }>
  generateVideo: (
    input: GenerateVideoInput & { name?: string }
  ) => Promise<GenerateVideoResult>
  generateSpeech: (input: GenerateSpeechInput) => Promise<GenerateSpeechResult>
  generateModel3d: (input: GenerateModel3dInput) => Promise<GenerateModel3dResult>
  /** AI 自由构图：仅规划预览 */
  planAiWorkflow: (input: PlanAiWorkflowInput) => Promise<PlanAiWorkflowResult>
  /** AI 自由构图：确认计划后落盘 */
  commitAiWorkflow: (input: CommitAiWorkflowInput) => Promise<CommitAiWorkflowResult>
  listVideoJobs: () => Promise<import('./videoJob').VideoJobRecord[]>
  getVideoJob: (localJobId: string) => Promise<import('./videoJob').VideoJobRecord | null>
  cancelVideoJob: (localJobId: string) => Promise<import('./videoJob').VideoJobRecord | null>
  listModels: (input: ListModelsInput) => Promise<CatalogModel[]>
  listProviderKinds: () => Promise<ModelProviderKindMeta[]>
  listObjectStorageKinds: () => Promise<ObjectStorageKindMeta[]>

  getSettings: () => Promise<AppSettings>
  setSettings: (settings: AppSettings) => Promise<AppSettings>

  getAppVersion: () => Promise<string>
  checkForUpdates: () => Promise<import('./update').AppUpdateCheckResult>
  installUpdate: () => Promise<{ ok: boolean; message?: string }>
  onUpdateEvent: (callback: (event: import('./update').AppUpdateEvent) => void) => () => void

  writeAutosave: (input: AutosaveWriteInput) => Promise<AutosaveEntry>
  listAutosaves: () => Promise<AutosaveManifest>
  readAutosave: (filter: Required<AutosaveFilter>) => Promise<AssetInfo | null>
  discardAutosave: (filter?: AutosaveFilter) => Promise<void>
  listPlugins: () => Promise<ExternalPluginManifest[]>

  saveGraphRunMedia: (input: SaveGraphRunMediaInput) => Promise<string>
  /** 将图执行剧本文本写入输出目录 */
  saveGraphRunText: (input: SaveGraphRunTextInput) => Promise<string>
  /** 读取工程内相对路径文本文件；不存在返回 null */
  readProjectFile: (relativePath: string) => Promise<string | null>
  /** 写入工程内相对路径文本文件；路径越界返回 false */
  writeProjectFile: (input: { relativePath: string; content: string }) => Promise<boolean>
  /** 删除图执行产物原图及缩略图 */
  deleteGraphRunMedia: (relativePath: string) => Promise<void>

  /** 弹出另存为对话框，将文本保存为文件；取消时返回 null */
  saveTextFile: (input: SaveTextFileInput) => Promise<string | null>

  /** 弹出另存为对话框，将二进制保存为文件；取消时返回 null */
  saveBinaryFile: (input: SaveBinaryFileInput) => Promise<string | null>

  /** 选择目录后批量写入文件；取消时返回 null */
  saveBinaryFilesToDirectory: (
    input: SaveBinaryFilesToDirectoryInput
  ) => Promise<SaveBinaryFilesToDirectoryResult | null>

  /** 导出成片时间线为 MP4（需本机 ffmpeg） */
  exportScriptTimeline: (input: TimelineExportInput) => Promise<TimelineExportResult>

  /** 导出入选广告变体的生成图到用户选择目录 */
  exportAdVariants: (input: ExportAdVariantsInput) => Promise<ExportAdVariantsResult>

  /** 订阅成片导出进度（0~1） */
  onTimelineExportProgress: (callback: (payload: { progress: number }) => void) => () => void

  /** 订阅资产落盘更新（多窗口同步内存中的 assets） */
  onAssetUpdated: (callback: (asset: AssetInfo) => void) => () => void

  /** 订阅持久化视频任务状态 */
  onVideoJobUpdated: (
    callback: (job: import('./videoJob').VideoJobRecord) => void
  ) => () => void

  /** MCP：订阅主进程派发的工作流运行请求（渲染层受理后经 reportMcpTask 回报） */
  onMcpTaskRun: (callback: (payload: McpTaskRunPayload) => void) => () => void

  /** MCP：渲染层回报任务受理 / 终态 */
  reportMcpTask: (payload: McpTaskReportPayload) => Promise<boolean>

  /** MCP：订阅主进程派发的图编辑操作批 */
  onMcpGraphEdit: (callback: (payload: McpGraphEditPayload) => void) => () => void

  /** MCP：渲染层回报图编辑结果 */
  reportMcpGraphEdit: (payload: McpGraphEditResultPayload) => Promise<boolean>

  /** MCP：订阅 agent 通过 ask_user 工具发起的提问（渲染层展示选项列表，经 answerAskUser 回传） */
  onAskUser: (callback: (question: AskUserQuestion) => void) => () => void

  /** MCP：回传用户对 ask_user 提问的选择 */
  answerAskUser: (payload: AskUserAnswer) => Promise<boolean>

  /** MCP：查询工具服务状态（端口 / token / 接入命令；未启动时返回 null） */
  getMcpInfo: () => Promise<McpServerInfo | null>

  /** MCP：应用端口 / 重置 token 修改并重启工具服务，返回重启后的状态 */
  restartMcpServer: (input: McpRestartInput) => Promise<McpServerInfo | null>

  /** MCP：订阅旁路生成活动更新（生成中 / 完成 / 失败） */
  onMcpActivityUpdated: (callback: (activity: McpActivity) => void) => () => void

  /** MCP：订阅旁路生成活动清空（工程关闭时） */
  onMcpActivityCleared: (callback: () => void) => () => void

  /** MCP：查询当前旁路生成活动列表 */
  listMcpActivities: () => Promise<McpActivity[]>

  /** Harness：查询 DeepSeek Harness 接入状态 */
  getHarnessStatus: () => Promise<HarnessStatus>

  /** Harness：运行一次对话任务（事件通过 onHarnessEvent 推送） */
  runHarnessTask: (input: HarnessRunInput) => Promise<HarnessRunResult>

  /** Harness：中止当前任务 */
  abortHarnessTask: () => Promise<void>

  /** Skills：查询 dsh 自定义技能目录信息 */
  getDshSkillsInfo: () => Promise<DshSkillsInfo>

  /** Skills：在系统文件管理器中打开 dsh 技能目录（不存在则先创建） */
  openDshSkillsDir: () => Promise<void>

  /** Skills：写入一个示例 SKILL.md 模板（同名已存在则跳过） */
  writeDshSkillsTemplate: () => Promise<DshSkillsTemplateResult>

  /** Skills：查询内置技能模板库（应用内置 GraphSkill 提炼的可复用模板） */
  listSkillTemplates: () => Promise<SkillTemplate[]>

  /** Skills：把内置技能模板导出为技能目录中的 .example 模板文件（同名跳过） */
  exportSkillTemplate: (id: string) => Promise<DshSkillsTemplateResult>

  /** Skills：查询本次会话可用技能清单（内置快照 + 用户自定义，供对话技能调试视图） */
  getSessionSkills: () => Promise<SessionSkill[]>

  /** Skills：把用户自定义 .md 技能反向导入为应用 GraphSkill（双向同步工具） */
  importCustomSkillsToGraph: () => Promise<SkillImportResult>

  /** Harness：删除会话在磁盘上的持久化记录（对应前端 ChatSession.id，删完不可恢复） */
  deleteHarnessSession: (sessionId: string) => Promise<void>

  /** Harness：订阅任务事件流 */
  onHarnessEvent: (callback: (event: HarnessEvent) => void) => () => void

  /** 从拖放/选择的 File 对象解析本地绝对路径（Electron webUtils） */
  getPathForFile: (file: File) => string
}
