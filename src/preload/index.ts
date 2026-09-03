import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { IpcChannels, type StudioApi } from '@shared/ipc'
import type { AppSettings, AssetInfo, ProjectConfig } from '@shared/domain'
import type { AskUserAnswer, AskUserQuestion, McpGraphEditResultPayload, McpGraphEditPayload, McpTaskReportPayload, McpTaskRunPayload } from '@shared/ipc'
import type {
  AttachAssetFileInput,
  AttachAssetRelativeInput,
  CreateAssetInput,
  CreateFolderInput,
  CreateProjectInput,
  ImportAssetsInput,
  ReimportAssetsInput,
  AutosaveFilter,
  AutosaveWriteInput,
  SaveTextFileInput,
  SaveBinaryFileInput,
  SaveGraphRunMediaInput,
  SaveGraphRunTextInput,
  DeleteFolderInput
} from '@shared/ipc'

const api: StudioApi = {
  createProject: (input: CreateProjectInput) => ipcRenderer.invoke(IpcChannels.PROJECT_CREATE, input),
  openProject: (projectJsonPath: string) => ipcRenderer.invoke(IpcChannels.PROJECT_OPEN, projectJsonPath),
  saveProject: (config: ProjectConfig) => ipcRenderer.invoke(IpcChannels.PROJECT_SAVE, config),
  getRecentProjects: () => ipcRenderer.invoke(IpcChannels.PROJECT_GET_RECENT),
  removeRecentProject: (projectJsonPath: string) =>
    ipcRenderer.invoke(IpcChannels.PROJECT_REMOVE_RECENT, projectJsonPath),
  closeProject: () => ipcRenderer.invoke(IpcChannels.PROJECT_CLOSE),
  selectDirectory: () => ipcRenderer.invoke(IpcChannels.DIALOG_SELECT_DIRECTORY),
  selectProject: () => ipcRenderer.invoke(IpcChannels.DIALOG_SELECT_PROJECT),
  selectFiles: (filters?) => ipcRenderer.invoke(IpcChannels.DIALOG_SELECT_FILES, filters),
  writeClipboardText: (text: string) =>
    ipcRenderer.invoke(IpcChannels.CLIPBOARD_WRITE_TEXT, text),

  listAssets: () => ipcRenderer.invoke(IpcChannels.ASSET_LIST),
  importAssets: (input: ImportAssetsInput) => ipcRenderer.invoke(IpcChannels.ASSET_IMPORT, input),
  reimportAssets: (input: ReimportAssetsInput) =>
    ipcRenderer.invoke(IpcChannels.ASSET_REIMPORT, input),
  createAsset: (input: CreateAssetInput) => ipcRenderer.invoke(IpcChannels.ASSET_CREATE, input),
  deleteAsset: (assetId: string) => ipcRenderer.invoke(IpcChannels.ASSET_DELETE, assetId),
  findAssetReferences: (assetIds: string[]) =>
    ipcRenderer.invoke(IpcChannels.ASSET_FIND_REFERENCES, assetIds),
  renameAsset: (assetId: string, name: string) =>
    ipcRenderer.invoke(IpcChannels.ASSET_RENAME, assetId, name),
  updateAsset: (asset: AssetInfo) => ipcRenderer.invoke(IpcChannels.ASSET_UPDATE, asset),
  attachAssetFile: (input: AttachAssetFileInput) =>
    ipcRenderer.invoke(IpcChannels.ASSET_ATTACH_FILE, input),
  attachAssetRelative: (input: AttachAssetRelativeInput) =>
    ipcRenderer.invoke(IpcChannels.ASSET_ATTACH_RELATIVE, input),
  saveProjectAsset: (input) => ipcRenderer.invoke(IpcChannels.ASSET_SAVE_PROJECT_FILE, input),
  getAssetFileUrl: (relativePath: string) =>
    ipcRenderer.invoke(IpcChannels.ASSET_GET_FILE_URL, relativePath),
  getAssetPreviewUrl: (relativePath: string) =>
    ipcRenderer.invoke(IpcChannels.ASSET_GET_PREVIEW_URL, relativePath),
  writeAssetText: (input) => ipcRenderer.invoke(IpcChannels.ASSET_WRITE_TEXT, input),
  getAssetMediaDataUrl: (relativePath: string) =>
    ipcRenderer.invoke(IpcChannels.ASSET_MEDIA_DATA_URL, relativePath),
  uploadMediaToObjectStorage: (relativePath: string) =>
    ipcRenderer.invoke(IpcChannels.OBJECT_STORAGE_UPLOAD_MEDIA, relativePath),
  showAssetInFolder: (assetId: string) =>
    ipcRenderer.invoke(IpcChannels.ASSET_SHOW_IN_FOLDER, assetId),
  showFolderInFolder: (folderId: string) =>
    ipcRenderer.invoke(IpcChannels.ASSET_SHOW_FOLDER, folderId),
  detectVideoKeyframes: (relativePath: string) =>
    ipcRenderer.invoke(IpcChannels.VIDEO_DETECT_KEYFRAMES, relativePath),
  extractVideoFrames: (relativePath: string, count: number) =>
    ipcRenderer.invoke(IpcChannels.VIDEO_EXTRACT_FRAMES, { relativePath, count }),
  separateAudio: (relativePath: string) =>
    ipcRenderer.invoke(IpcChannels.AUDIO_SEPARATE, relativePath),
  copyAssetOriginalFiles: (assetIds: string[]) =>
    ipcRenderer.invoke(IpcChannels.ASSET_COPY_ORIGINAL_FILES, assetIds),

  exportAssetPackage: (input) => ipcRenderer.invoke(IpcChannels.ASSET_PACKAGE_EXPORT, input),
  previewAssetPackage: (packPath?) =>
    ipcRenderer.invoke(IpcChannels.ASSET_PACKAGE_PREVIEW, packPath),
  importAssetPackage: (input) =>
    ipcRenderer.invoke(IpcChannels.ASSET_PACKAGE_IMPORT, input ?? {}),

  listFolders: () => ipcRenderer.invoke(IpcChannels.FOLDER_LIST),
  createFolder: (input: CreateFolderInput) => ipcRenderer.invoke(IpcChannels.FOLDER_CREATE, input),
  renameFolder: (folderId: string, name: string) =>
    ipcRenderer.invoke(IpcChannels.FOLDER_RENAME, folderId, name),
  deleteFolder: (input: DeleteFolderInput | string) =>
    ipcRenderer.invoke(
      IpcChannels.FOLDER_DELETE,
      typeof input === 'string' ? { folderId: input, mode: 'hoist' as const } : input
    ),

  generateText: (input) => ipcRenderer.invoke(IpcChannels.GEN_TEXT, input),
  generateImage: (input) => ipcRenderer.invoke(IpcChannels.GEN_IMAGE, input),
  generateVideo: (input) => ipcRenderer.invoke(IpcChannels.GEN_VIDEO, input),
  generateSpeech: (input) => ipcRenderer.invoke(IpcChannels.GEN_SPEECH, input),
  generateMusic: (input) => ipcRenderer.invoke(IpcChannels.GEN_MUSIC, input),
  generateModel3d: (input) => ipcRenderer.invoke(IpcChannels.GEN_MODEL3D, input),
  transcribeAudio: (input) => ipcRenderer.invoke(IpcChannels.TRANSCRIBE_AUDIO, input),
  planAiWorkflow: (input) => ipcRenderer.invoke(IpcChannels.GEN_AI_WORKFLOW_PLAN, input),
  commitAiWorkflow: (input) => ipcRenderer.invoke(IpcChannels.GEN_AI_WORKFLOW_COMMIT, input),
  listVideoJobs: () => ipcRenderer.invoke(IpcChannels.VIDEO_JOB_LIST),
  getVideoJob: (localJobId) => ipcRenderer.invoke(IpcChannels.VIDEO_JOB_GET, localJobId),
  cancelVideoJob: (localJobId) => ipcRenderer.invoke(IpcChannels.VIDEO_JOB_CANCEL, localJobId),
  listModels: (input) => ipcRenderer.invoke(IpcChannels.MODELS_LIST, input),
  listProviderKinds: () => ipcRenderer.invoke(IpcChannels.PROVIDERS_LIST_KINDS),
  listObjectStorageKinds: () => ipcRenderer.invoke(IpcChannels.OBJECT_STORAGE_LIST_KINDS),

  getSettings: () => ipcRenderer.invoke(IpcChannels.SETTINGS_GET),
  setSettings: (settings: AppSettings) => ipcRenderer.invoke(IpcChannels.SETTINGS_SET, settings),

  getYoloStatus: () => ipcRenderer.invoke(IpcChannels.YOLO_STATUS),
  yoloDetect: (input) => ipcRenderer.invoke(IpcChannels.YOLO_DETECT, input),
  yoloSegment: (input) => ipcRenderer.invoke(IpcChannels.YOLO_SEGMENT, input),
  yoloPose: (input) => ipcRenderer.invoke(IpcChannels.YOLO_POSE, input),
  openYoloModelDir: () => ipcRenderer.invoke(IpcChannels.YOLO_OPEN_MODEL_DIR),

  getAppVersion: () => ipcRenderer.invoke(IpcChannels.APP_GET_VERSION),
  checkForUpdates: () => ipcRenderer.invoke(IpcChannels.UPDATE_CHECK),
  installUpdate: () => ipcRenderer.invoke(IpcChannels.UPDATE_INSTALL),
  onUpdateEvent: (callback) => {
    const listener = (
      _event: unknown,
      payload: import('@shared/update').AppUpdateEvent
    ): void => {
      callback(payload)
    }
    ipcRenderer.on(IpcChannels.UPDATE_EVENT, listener)
    return () => ipcRenderer.removeListener(IpcChannels.UPDATE_EVENT, listener)
  },

  writeAutosave: (input: AutosaveWriteInput) =>
    ipcRenderer.invoke(IpcChannels.AUTOSAVE_WRITE, input),
  listAutosaves: () => ipcRenderer.invoke(IpcChannels.AUTOSAVE_LIST),
  readAutosave: (filter: Required<AutosaveFilter>) =>
    ipcRenderer.invoke(IpcChannels.AUTOSAVE_READ, filter),
  discardAutosave: (filter?: AutosaveFilter) =>
    ipcRenderer.invoke(IpcChannels.AUTOSAVE_DISCARD, filter),
  listPlugins: () => ipcRenderer.invoke(IpcChannels.PLUGIN_LIST),

  saveGraphRunMedia: (input: SaveGraphRunMediaInput) =>
    ipcRenderer.invoke(IpcChannels.GRAPH_SAVE_RUN_MEDIA, input),
  saveGraphRunText: (input: SaveGraphRunTextInput) =>
    ipcRenderer.invoke(IpcChannels.GRAPH_SAVE_RUN_TEXT, input),
  readProjectFile: (relativePath: string) =>
    ipcRenderer.invoke(IpcChannels.PROJECT_READ_FILE, relativePath),
  writeProjectFile: (input: { relativePath: string; content: string }) =>
    ipcRenderer.invoke(IpcChannels.PROJECT_WRITE_FILE, input),
  deleteGraphRunMedia: (relativePath: string) =>
    ipcRenderer.invoke(IpcChannels.GRAPH_DELETE_RUN_MEDIA, relativePath),

  saveTextFile: (input: SaveTextFileInput) =>
    ipcRenderer.invoke(IpcChannels.DIALOG_SAVE_TEXT_FILE, input),
  saveBinaryFile: (input: SaveBinaryFileInput) =>
    ipcRenderer.invoke(IpcChannels.DIALOG_SAVE_BINARY_FILE, input),
  saveBinaryFilesToDirectory: (input) =>
    ipcRenderer.invoke(IpcChannels.DIALOG_SAVE_BINARY_FILES_TO_DIRECTORY, input),

  exportScriptTimeline: (input) => ipcRenderer.invoke(IpcChannels.TIMELINE_EXPORT, input),
  exportAdVariants: (input) => ipcRenderer.invoke(IpcChannels.AD_VARIANT_EXPORT, input),
  onTimelineExportProgress: (callback) => {
    const listener = (_event: unknown, payload: { progress: number }): void => {
      callback(payload)
    }
    ipcRenderer.on(IpcChannels.TIMELINE_EXPORT_PROGRESS, listener)
    return () => ipcRenderer.removeListener(IpcChannels.TIMELINE_EXPORT_PROGRESS, listener)
  },
  onAssetUpdated: (callback) => {
    const listener = (_event: unknown, asset: AssetInfo): void => {
      callback(asset)
    }
    ipcRenderer.on(IpcChannels.ASSET_UPDATED, listener)
    return () => ipcRenderer.removeListener(IpcChannels.ASSET_UPDATED, listener)
  },
  onVideoJobUpdated: (callback) => {
    const listener = (
      _event: unknown,
      job: import('@shared/videoJob').VideoJobRecord
    ): void => {
      callback(job)
    }
    ipcRenderer.on(IpcChannels.VIDEO_JOB_UPDATED, listener)
    return () => ipcRenderer.removeListener(IpcChannels.VIDEO_JOB_UPDATED, listener)
  },
  onMcpTaskRun: (callback) => {
    const listener = (_event: unknown, payload: McpTaskRunPayload): void => {
      callback(payload)
    }
    ipcRenderer.on(IpcChannels.MCP_TASK_RUN, listener)
    return () => ipcRenderer.removeListener(IpcChannels.MCP_TASK_RUN, listener)
  },
  reportMcpTask: (payload: McpTaskReportPayload) =>
    ipcRenderer.invoke(IpcChannels.MCP_TASK_REPORT, payload),
  onMcpGraphEdit: (callback) => {
    const listener = (_event: unknown, payload: McpGraphEditPayload): void => {
      callback(payload)
    }
    ipcRenderer.on(IpcChannels.MCP_GRAPH_EDIT, listener)
    return () => ipcRenderer.removeListener(IpcChannels.MCP_GRAPH_EDIT, listener)
  },
  reportMcpGraphEdit: (payload: McpGraphEditResultPayload) =>
    ipcRenderer.invoke(IpcChannels.MCP_GRAPH_EDIT_RESULT, payload),
  onAskUser: (callback) => {
    const listener = (_event: unknown, question: AskUserQuestion): void => {
      callback(question)
    }
    ipcRenderer.on(IpcChannels.MCP_ASK_USER, listener)
    return () => ipcRenderer.removeListener(IpcChannels.MCP_ASK_USER, listener)
  },
  answerAskUser: (payload: AskUserAnswer) =>
    ipcRenderer.invoke(IpcChannels.MCP_ASK_USER_RESPONSE, payload),
  getMcpInfo: () => ipcRenderer.invoke(IpcChannels.MCP_GET_INFO),
  restartMcpServer: (input) => ipcRenderer.invoke(IpcChannels.MCP_RESTART, input),
  onMcpActivityUpdated: (callback) => {
    const listener = (_event: unknown, activity: import('@shared/ipc').McpActivity): void => {
      callback(activity)
    }
    ipcRenderer.on(IpcChannels.MCP_ACTIVITY_UPDATED, listener)
    return () => ipcRenderer.removeListener(IpcChannels.MCP_ACTIVITY_UPDATED, listener)
  },
  onMcpActivityCleared: (callback) => {
    const listener = (): void => {
      callback()
    }
    ipcRenderer.on(IpcChannels.MCP_ACTIVITY_CLEARED, listener)
    return () => ipcRenderer.removeListener(IpcChannels.MCP_ACTIVITY_CLEARED, listener)
  },
  listMcpActivities: () => ipcRenderer.invoke(IpcChannels.MCP_ACTIVITY_LIST),

  getHarnessStatus: () => ipcRenderer.invoke(IpcChannels.HARNESS_STATUS),
  runHarnessTask: (input) => ipcRenderer.invoke(IpcChannels.HARNESS_RUN, input),
  deleteHarnessSession: (sessionId, agentId) =>
    ipcRenderer.invoke(IpcChannels.HARNESS_DELETE_SESSION, sessionId, agentId),
  abortHarnessTask: (agentId) => ipcRenderer.invoke(IpcChannels.HARNESS_ABORT, agentId),
  listAgents: () => ipcRenderer.invoke(IpcChannels.AGENT_LIST),
  saveAgentConfig: (config) => ipcRenderer.invoke(IpcChannels.AGENT_SAVE_CONFIG, config),
  removeAgent: (agentId) => ipcRenderer.invoke(IpcChannels.AGENT_REMOVE, agentId),
  forwardToAgent: (input) => ipcRenderer.invoke(IpcChannels.AGENT_FORWARD, input),
  listAgentPipes: () => ipcRenderer.invoke(IpcChannels.AGENT_PIPE_LIST),
  cancelAgentPipe: (pipeId) => ipcRenderer.invoke(IpcChannels.AGENT_PIPE_CANCEL, pipeId),
  onAgentForward: (callback) => {
    const listener = (
      _event: unknown,
      payload: import('@shared/ipc').AgentForwardEvent
    ): void => {
      callback(payload)
    }
    ipcRenderer.on(IpcChannels.AGENT_FORWARD_EVENT, listener)
    return () => ipcRenderer.removeListener(IpcChannels.AGENT_FORWARD_EVENT, listener)
  },
  runOrchestrator: (input) => ipcRenderer.invoke(IpcChannels.ORCHESTRATOR_RUN, input),
  planOrchestrator: (input) => ipcRenderer.invoke(IpcChannels.ORCHESTRATOR_PLAN, input),
  listOrchestratorJobs: () => ipcRenderer.invoke(IpcChannels.ORCHESTRATOR_LIST),
  abortOrchestratorJob: (jobId) => ipcRenderer.invoke(IpcChannels.ORCHESTRATOR_ABORT, jobId),
  rerunOrchestratorJob: (jobId) => ipcRenderer.invoke(IpcChannels.ORCHESTRATOR_RERUN, jobId),
  rerunOrchestratorNode: (jobId, nodeId) =>
    ipcRenderer.invoke(IpcChannels.ORCHESTRATOR_RERUN_NODE, jobId, nodeId),
  onOrchestratorEvent: (callback) => {
    const listener = (
      _event: unknown,
      payload: import('@shared/ipc').OrchestratorJobEvent
    ): void => {
      callback(payload)
    }
    ipcRenderer.on(IpcChannels.ORCHESTRATOR_EVENT, listener)
    return () => ipcRenderer.removeListener(IpcChannels.ORCHESTRATOR_EVENT, listener)
  },
  getDshSkillsInfo: () => ipcRenderer.invoke(IpcChannels.SKILLS_GET_INFO),
  openDshSkillsDir: () => ipcRenderer.invoke(IpcChannels.SKILLS_OPEN_DIR),
  writeDshSkillsTemplate: () => ipcRenderer.invoke(IpcChannels.SKILLS_WRITE_TEMPLATE),
  listSkillTemplates: () => ipcRenderer.invoke(IpcChannels.SKILLS_LIST_TEMPLATES),
  exportSkillTemplate: (id) => ipcRenderer.invoke(IpcChannels.SKILLS_EXPORT_TEMPLATE, id),
  getSessionSkills: () => ipcRenderer.invoke(IpcChannels.SKILLS_GET_SESSION),
  importCustomSkillsToGraph: () => ipcRenderer.invoke(IpcChannels.SKILLS_IMPORT_TO_GRAPH),
  onHarnessEvent: (callback) => {
    const listener = (
      _event: unknown,
      payload: import('@shared/ipc').HarnessEvent
    ): void => {
      callback(payload)
    }
    ipcRenderer.on(IpcChannels.HARNESS_EVENT, listener)
    return () => ipcRenderer.removeListener(IpcChannels.HARNESS_EVENT, listener)
  },
  /** Electron 35+ 拖放文件需通过 webUtils 获取本地路径 */
  getPathForFile: (file: File) => webUtils.getPathForFile(file)
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
  } catch (error) {
    console.error('[preload] expose electron failed', error)
  }
  try {
    contextBridge.exposeInMainWorld('studio', api)
  } catch (error) {
    console.error('[preload] expose studio failed', error)
  }
} else {
  // @ts-expect-error fallback
  window.electron = electronAPI
  // @ts-expect-error fallback
  window.studio = api
}
