import type { AppSettings, AssetFolder, AssetInfo, AssetType, ProjectConfig, Shot } from './domain'
import type { WorldElementKind } from './graph/worldElementParse'
import type { WorkspaceToolbarItem } from './workspaceToolbar'
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
  ListModelsInput
} from './modelProvider'

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
  /** 将选中资产的原始媒体文件复制到系统剪贴板 */
  ASSET_COPY_ORIGINAL_FILES: 'asset:copy-original-files',
  ASSET_FIND_REFERENCES: 'asset:find-references',

  ASSET_PACKAGE_EXPORT: 'asset-package:export',
  ASSET_PACKAGE_IMPORT: 'asset-package:import',
  ASSET_PACKAGE_PREVIEW: 'asset-package:preview',

  // Asset folders
  FOLDER_LIST: 'folder:list',
  FOLDER_CREATE: 'folder:create',
  FOLDER_RENAME: 'folder:rename',
  FOLDER_DELETE: 'folder:delete',

  // Shots
  SHOT_LIST: 'shot:list',
  SHOT_GET: 'shot:get',
  SHOT_CREATE: 'shot:create',
  SHOT_UPDATE: 'shot:update',
  SHOT_DELETE: 'shot:delete',
  SHOT_REORDER: 'shot:reorder',
  /** 批量同步某剧本下的分镜列表（一次落盘） */
  SHOT_SYNC_SCRIPT: 'shot:sync-script',

  // Generation
  GEN_TEXT: 'gen:text',
  GEN_IMAGE: 'gen:image',
  GEN_VIDEO: 'gen:video',
  GEN_SPEECH: 'gen:speech',
  /** 持久化视频任务列表 */
  VIDEO_JOB_LIST: 'video-job:list',
  VIDEO_JOB_GET: 'video-job:get',
  VIDEO_JOB_CANCEL: 'video-job:cancel',
  /** 主进程推送：视频任务状态变更 */
  VIDEO_JOB_UPDATED: 'video-job:updated',

  // Model catalog
  MODELS_LIST: 'models:list',

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

  // Canvas export
  CANVAS_SAVE_PNG: 'canvas:save-png',
  /** 将图执行产物 dataUrl 写入图片输出目录（默认 Output/images） */
  GRAPH_SAVE_RUN_MEDIA: 'graph:save-run-media',
  /** 将图执行产物文本写入剧本输出目录（默认 Assets/{资产名}/Texts） */
  GRAPH_SAVE_RUN_TEXT: 'graph:save-run-text',
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

  // Independent stage window
  PROJECT_GET_STATE: 'project:get-state',
  WINDOW_OPEN_STAGE: 'window:open-stage',
  WINDOW_CLOSE_STAGE: 'window:close-stage',
  STAGE_SEND_PREVIEW: 'stage:send-preview',
  WINDOW_OPEN_SHOT_PREVIEW: 'window:open-shot-preview',
  WINDOW_CLOSE_SHOT_PREVIEW: 'window:close-shot-preview',
  SHOT_PREVIEW_GET: 'shot-preview:get',
  WINDOW_OPEN_SHOT_EDITOR: 'window:open-shot-editor',
  WINDOW_CLOSE_SHOT_EDITOR: 'window:close-shot-editor',
  WINDOW_OPEN_SHOT_TABLE: 'window:open-shot-table',
  WINDOW_CLOSE_SHOT_TABLE: 'window:close-shot-table',
  WINDOW_OPEN_WORLD_EDITOR: 'window:open-world-editor',
  WINDOW_CLOSE_WORLD_EDITOR: 'window:close-world-editor',
  WINDOW_OPEN_WORLD_TABLE: 'window:open-world-table',
  WINDOW_CLOSE_WORLD_TABLE: 'window:close-world-table',

  /** 主进程推送：资产已写入（多窗口同步） */
  ASSET_UPDATED: 'asset:updated'
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
  shots: Shot[]
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
  skipScriptBootstrap?: boolean
}

export interface CreateShotInput {
  title?: string
  scriptAssetId?: string
}

/** 批量同步剧本分镜：写入有序列表并删除多余项 */
export interface SyncScriptShotsInput {
  scriptAssetId: string
  orderedShots: Shot[]
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

export type AutosaveKind = 'shot' | 'asset'

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
  payload: Shot | AssetInfo
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
    fileName: string
    data: Uint8Array
  }>
}

export interface SaveBinaryFilesToDirectoryResult {
  directory: string
  written: number
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

  listAssets: () => Promise<AssetInfo[]>
  importAssets: (input: ImportAssetsInput) => Promise<ImportAssetsResult>
  /** 重新导入：从工程磁盘上的媒体文件刷新资产元数据与缓存（类似 Unity Reimport） */
  reimportAssets: (input: ReimportAssetsInput) => Promise<ReimportAssetsResult>
  createAsset: (input: CreateAssetInput) => Promise<AssetInfo>
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

  listShots: () => Promise<Shot[]>
  getShot: (shotId: string) => Promise<Shot | null>
  createShot: (input?: CreateShotInput) => Promise<Shot>
  updateShot: (shot: Shot) => Promise<Shot>
  deleteShot: (shotId: string) => Promise<void>
  reorderShots: (shotIds: string[]) => Promise<void>
  syncScriptShots: (input: SyncScriptShotsInput) => Promise<Shot[]>

  generateText: (input: GenerateTextInput) => Promise<GenerateTextResult>
  generateImage: (input: GenerateImageInput) => Promise<GenerateImageResult & { assetId?: string }>
  generateVideo: (
    input: GenerateVideoInput & { name?: string }
  ) => Promise<GenerateVideoResult>
  generateSpeech: (input: GenerateSpeechInput) => Promise<GenerateSpeechResult>
  listVideoJobs: () => Promise<import('./videoJob').VideoJobRecord[]>
  getVideoJob: (localJobId: string) => Promise<import('./videoJob').VideoJobRecord | null>
  cancelVideoJob: (localJobId: string) => Promise<import('./videoJob').VideoJobRecord | null>
  listModels: (input: ListModelsInput) => Promise<CatalogModel[]>

  getSettings: () => Promise<AppSettings>
  setSettings: (settings: AppSettings) => Promise<AppSettings>

  getAppVersion: () => Promise<string>
  checkForUpdates: () => Promise<import('./update').AppUpdateCheckResult>
  installUpdate: () => Promise<{ ok: boolean; message?: string }>
  onUpdateEvent: (callback: (event: import('./update').AppUpdateEvent) => void) => () => void

  writeAutosave: (input: AutosaveWriteInput) => Promise<AutosaveEntry>
  listAutosaves: () => Promise<AutosaveManifest>
  readAutosave: (filter: Required<AutosaveFilter>) => Promise<Shot | AssetInfo | null>
  discardAutosave: (filter?: AutosaveFilter) => Promise<void>
  listPlugins: () => Promise<ExternalPluginManifest[]>

  saveCanvasPng: (shotId: string, dataUrl: string) => Promise<string>
  saveGraphRunMedia: (input: SaveGraphRunMediaInput) => Promise<string>
  /** 将图执行剧本文本写入输出目录 */
  saveGraphRunText: (input: SaveGraphRunTextInput) => Promise<string>
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

  /** 读取主进程当前已打开工程快照（独立窗口用） */
  getOpenProjectState: () => Promise<OpenProjectResult | null>

  /** 打开/聚焦导演台舞台独立窗口（可指定加工节点以打开独立场景） */
  openStageWindow: (
    directorAssetId: string,
    processingNodeId?: string
  ) => Promise<{ ok: true }>

  /** 关闭舞台独立窗口；不传 id 则关闭全部；传资产 id 不传节点则关闭该资产全部舞台窗 */
  closeStageWindow: (
    directorAssetId?: string,
    processingNodeId?: string
  ) => Promise<{ ok: true }>

  /** 舞台窗口把预览图回传给主窗口 */
  sendStagePreview: (
    directorAssetId: string,
    previewUrl: string,
    processingNodeId?: string
  ) => Promise<void>

  /** 订阅舞台预览更新（主窗口） */
  onStagePreview: (
    callback: (payload: {
      directorAssetId: string
      previewUrl: string
      processingNodeId?: string | null
    }) => void
  ) => () => void

  /** 订阅舞台窗口关闭（主窗口） */
  onStageClosed: (
    callback: (payload: {
      directorAssetId: string
      processingNodeId?: string | null
    }) => void
  ) => () => void

  /** 订阅舞台窗口关闭请求（舞台窗口：OS 关窗前先保存） */
  onStageCloseRequest: (
    callback: (payload: {
      directorAssetId: string
      processingNodeId?: string | null
    }) => void
  ) => () => void

  /** 订阅资产落盘更新（多窗口同步内存中的 assets） */
  onAssetUpdated: (callback: (asset: AssetInfo) => void) => () => void

  /** 订阅持久化视频任务状态 */
  onVideoJobUpdated: (
    callback: (job: import('./videoJob').VideoJobRecord) => void
  ) => () => void

  /** 打开/聚焦截图预览独立窗口 */
  openShotPreviewWindow: (dataUrl: string) => Promise<{ ok: true }>

  /** 关闭截图预览独立窗口 */
  closeShotPreviewWindow: () => Promise<{ ok: true }>

  /** 截图预览窗口读取当前待显示图片 */
  getShotPreviewPayload: () => Promise<{ dataUrl: string } | null>

  /** 订阅截图预览内容更新（预览窗口） */
  onShotPreviewSet: (callback: (payload: { dataUrl: string }) => void) => () => void

  /** 打开/聚焦分镜编辑独立窗口 */
  openShotEditorWindow: (scriptAssetId: string) => Promise<{ ok: true }>

  /** 关闭分镜编辑独立窗口；不传 id 则关闭全部 */
  closeShotEditorWindow: (scriptAssetId?: string) => Promise<{ ok: true }>

  /** 订阅分镜编辑窗口关闭（主窗口） */
  onShotEditorClosed: (
    callback: (payload: { scriptAssetId: string }) => void
  ) => () => void

  /** 订阅分镜编辑窗口关闭请求（OS 关窗前先保存） */
  onShotEditorCloseRequest: (
    callback: (payload: { scriptAssetId: string }) => void
  ) => () => void

  /** 打开/聚焦分镜表格独立窗口 */
  openShotTableWindow: (scriptAssetId: string) => Promise<{ ok: true }>

  /** 关闭分镜表格独立窗口；不传 id 则关闭全部 */
  closeShotTableWindow: (scriptAssetId?: string) => Promise<{ ok: true }>

  /** 订阅分镜表格窗口关闭（主窗口） */
  onShotTableClosed: (
    callback: (payload: { scriptAssetId: string }) => void
  ) => () => void

  /** 订阅分镜表格窗口关闭请求（OS 关窗前先保存） */
  onShotTableCloseRequest: (
    callback: (payload: { scriptAssetId: string }) => void
  ) => () => void

  /** 打开/聚焦世界元素编辑独立窗口 */
  openWorldEditorWindow: (
    worldAssetId: string,
    tab?: WorldElementKind
  ) => Promise<{ ok: true }>

  /** 关闭世界元素编辑独立窗口；不传 id 则关闭全部 */
  closeWorldEditorWindow: (worldAssetId?: string) => Promise<{ ok: true }>

  /** 订阅世界元素编辑窗口关闭（主窗口） */
  onWorldEditorClosed: (
    callback: (payload: { worldAssetId: string }) => void
  ) => () => void

  /** 订阅世界元素编辑窗口关闭请求（OS 关窗前先保存） */
  onWorldEditorCloseRequest: (
    callback: (payload: { worldAssetId: string }) => void
  ) => () => void

  /** 订阅世界元素编辑窗口切换 Tab */
  onWorldEditorSetTab: (
    callback: (payload: { tab: WorldElementKind; worldAssetId?: string }) => void
  ) => () => void

  /** 打开/聚焦世界元素表格独立窗口 */
  openWorldTableWindow: (worldAssetId: string) => Promise<{ ok: true }>

  /** 关闭世界元素表格独立窗口；不传 id 则关闭全部 */
  closeWorldTableWindow: (worldAssetId?: string) => Promise<{ ok: true }>

  /** 订阅世界元素表格窗口关闭（主窗口） */
  onWorldTableClosed: (
    callback: (payload: { worldAssetId: string }) => void
  ) => () => void

  /** 订阅世界元素表格窗口关闭请求（OS 关窗前先保存） */
  onWorldTableCloseRequest: (
    callback: (payload: { worldAssetId: string }) => void
  ) => () => void

  /** 从拖放/选择的 File 对象解析本地绝对路径（Electron webUtils） */
  getPathForFile: (file: File) => string
}
