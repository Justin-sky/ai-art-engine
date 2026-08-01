import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { IpcChannels, type StudioApi } from '@shared/ipc'
import type { AppSettings, AssetInfo, ProjectConfig, Shot } from '@shared/domain'
import type {
  AttachAssetFileInput,
  AttachAssetRelativeInput,
  CreateAssetInput,
  CreateFolderInput,
  CreateProjectInput,
  CreateSeriesWithStarterInput,
  ImportAssetsInput,
  ReimportAssetsInput,
  CreateShotInput,
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

  listAssets: () => ipcRenderer.invoke(IpcChannels.ASSET_LIST),
  importAssets: (input: ImportAssetsInput) => ipcRenderer.invoke(IpcChannels.ASSET_IMPORT, input),
  reimportAssets: (input: ReimportAssetsInput) =>
    ipcRenderer.invoke(IpcChannels.ASSET_REIMPORT, input),
  createAsset: (input: CreateAssetInput) => ipcRenderer.invoke(IpcChannels.ASSET_CREATE, input),
  createSeriesWithStarter: (input: CreateSeriesWithStarterInput) =>
    ipcRenderer.invoke(IpcChannels.ASSET_CREATE_SERIES, input),
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

  listShots: () => ipcRenderer.invoke(IpcChannels.SHOT_LIST),
  getShot: (shotId: string) => ipcRenderer.invoke(IpcChannels.SHOT_GET, shotId),
  createShot: (input?: CreateShotInput) => ipcRenderer.invoke(IpcChannels.SHOT_CREATE, input),
  updateShot: (shot: Shot) => ipcRenderer.invoke(IpcChannels.SHOT_UPDATE, shot),
  deleteShot: (shotId: string) => ipcRenderer.invoke(IpcChannels.SHOT_DELETE, shotId),
  reorderShots: (shotIds: string[]) => ipcRenderer.invoke(IpcChannels.SHOT_REORDER, shotIds),
  syncScriptShots: (input) => ipcRenderer.invoke(IpcChannels.SHOT_SYNC_SCRIPT, input),

  generateText: (input) => ipcRenderer.invoke(IpcChannels.GEN_TEXT, input),
  generateImage: (input) => ipcRenderer.invoke(IpcChannels.GEN_IMAGE, input),
  generateVideo: (input) => ipcRenderer.invoke(IpcChannels.GEN_VIDEO, input),
  generateSpeech: (input) => ipcRenderer.invoke(IpcChannels.GEN_SPEECH, input),
  generateAiWorkflow: (input) => ipcRenderer.invoke(IpcChannels.GEN_AI_WORKFLOW, input),
  listVideoJobs: () => ipcRenderer.invoke(IpcChannels.VIDEO_JOB_LIST),
  getVideoJob: (localJobId) => ipcRenderer.invoke(IpcChannels.VIDEO_JOB_GET, localJobId),
  cancelVideoJob: (localJobId) => ipcRenderer.invoke(IpcChannels.VIDEO_JOB_CANCEL, localJobId),
  listModels: (input) => ipcRenderer.invoke(IpcChannels.MODELS_LIST, input),

  getSettings: () => ipcRenderer.invoke(IpcChannels.SETTINGS_GET),
  setSettings: (settings: AppSettings) => ipcRenderer.invoke(IpcChannels.SETTINGS_SET, settings),

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

  saveCanvasPng: (shotId: string, dataUrl: string) =>
    ipcRenderer.invoke(IpcChannels.CANVAS_SAVE_PNG, shotId, dataUrl),
  saveGraphRunMedia: (input: SaveGraphRunMediaInput) =>
    ipcRenderer.invoke(IpcChannels.GRAPH_SAVE_RUN_MEDIA, input),
  saveGraphRunText: (input: SaveGraphRunTextInput) =>
    ipcRenderer.invoke(IpcChannels.GRAPH_SAVE_RUN_TEXT, input),
  deleteGraphRunMedia: (relativePath: string) =>
    ipcRenderer.invoke(IpcChannels.GRAPH_DELETE_RUN_MEDIA, relativePath),

  saveTextFile: (input: SaveTextFileInput) =>
    ipcRenderer.invoke(IpcChannels.DIALOG_SAVE_TEXT_FILE, input),
  saveBinaryFile: (input: SaveBinaryFileInput) =>
    ipcRenderer.invoke(IpcChannels.DIALOG_SAVE_BINARY_FILE, input),
  saveBinaryFilesToDirectory: (input) =>
    ipcRenderer.invoke(IpcChannels.DIALOG_SAVE_BINARY_FILES_TO_DIRECTORY, input),

  exportScriptTimeline: (input) => ipcRenderer.invoke(IpcChannels.TIMELINE_EXPORT, input),
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
