import { ipcMain } from 'electron'
import { IpcChannels } from '@shared/ipc'
import type { AppSettings, ProjectConfig, Shot, AssetInfo } from '@shared/domain'
import type {
  AttachAssetFileInput,
  AttachAssetRelativeInput,
  CreateAssetInput,
  CreateFolderInput,
  CreateProjectInput,
  CreateShotInput,
  SyncScriptShotsInput,
  DeleteFolderInput,
  ImportAssetsInput,
  ReimportAssetsInput,
  AutosaveFilter,
  AutosaveWriteInput,
  SaveTextFileInput,
  SaveBinaryFileInput,
  SaveBinaryFilesToDirectoryInput,
  SaveGraphRunMediaInput,
  SaveGraphRunTextInput,
  ExportAssetPackageInput,
  ImportAssetPackageInput,
  WriteAssetTextInput
} from '@shared/ipc'
import { assetPackageService } from './services/assetPackageService'
import type {
  GenerateImageInput,
  GenerateSpeechInput,
  GenerateTextInput,
  GenerateVideoInput,
  ListModelsInput
} from '@shared/modelProvider'
import { projectService } from './services/projectService'
import { videoJobService } from './services/videoJobService'
import { settingsService } from './services/settingsService'
import { updateService } from './services/updateService'
import { openRouterClient, toMediaUrl } from './services/openRouterClient'
import { uploadProjectMediaToTos } from './services/tosUploadService'
import { autosaveRepository } from './repositories/autosaveRepository'
import { pluginRepository } from './repositories/pluginRepository'
import { dialogService } from './services/dialogService'
import { broadcastToAllWindows } from './broadcast'
import { broadcastStagePreview, closeStageWindow, openStageWindow } from './stageWindow'
import {
  closeShotTableWindow,
  openShotTableWindow
} from './shotTableWindow'
import {
  closeWorldTableWindow,
  openWorldTableWindow
} from './worldTableWindow'
import {
  closeShotPreviewWindow,
  getShotPreviewPayload,
  openShotPreviewWindow
} from './shotPreviewWindow'

function handle<T>(channel: string, fn: (...args: never[]) => Promise<T> | T): void {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return await fn(...(args as never[]))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[IPC ${channel}]`, message)
      throw new Error(message)
    }
  })
}

export function registerIpcHandlers(): void {
  handle(IpcChannels.DIALOG_SELECT_DIRECTORY, () => projectService.selectDirectory())
  handle(IpcChannels.DIALOG_SELECT_PROJECT, () => projectService.selectProject())
  handle(IpcChannels.DIALOG_SELECT_FILES, (filters?: { name: string; extensions: string[] }[]) =>
    projectService.selectFiles(filters)
  )
  handle(IpcChannels.DIALOG_SAVE_TEXT_FILE, (input: SaveTextFileInput) =>
    dialogService.saveTextFile(input)
  )
  handle(IpcChannels.DIALOG_SAVE_BINARY_FILE, (input: SaveBinaryFileInput) =>
    dialogService.saveBinaryFile(input)
  )
  handle(
    IpcChannels.DIALOG_SAVE_BINARY_FILES_TO_DIRECTORY,
    (input: SaveBinaryFilesToDirectoryInput) => dialogService.saveBinaryFilesToDirectory(input)
  )

  handle(IpcChannels.PROJECT_CREATE, (input: CreateProjectInput) =>
    projectService.createProject(input)
  )
  handle(IpcChannels.PROJECT_OPEN, (projectJsonPath: string) => {
    const result = projectService.openProject(projectJsonPath)
    videoJobService.resumePending()
    return result
  })
  handle(IpcChannels.PROJECT_SAVE, (config: ProjectConfig) => {
    projectService.saveConfig(config)
  })
  handle(IpcChannels.PROJECT_GET_RECENT, () => settingsService.getRecent())
  handle(IpcChannels.PROJECT_REMOVE_RECENT, (projectJsonPath: string) =>
    settingsService.removeRecent(projectJsonPath)
  )
  handle(IpcChannels.PROJECT_CLOSE, () => {
    videoJobService.stopAllTimers()
    closeShotTableWindow()
    closeWorldTableWindow()
    projectService.closeProject()
  })
  handle(IpcChannels.PROJECT_GET_STATE, () => projectService.getOpenProjectState())

  handle(IpcChannels.WINDOW_OPEN_STAGE, (directorAssetId: string, processingNodeId?: string) =>
    openStageWindow(directorAssetId, processingNodeId)
  )
  handle(IpcChannels.WINDOW_CLOSE_STAGE, (directorAssetId?: string, processingNodeId?: string) =>
    closeStageWindow(directorAssetId, processingNodeId)
  )
  handle(
    IpcChannels.STAGE_SEND_PREVIEW,
    (directorAssetId: string, previewUrl: string, processingNodeId?: string) => {
      broadcastStagePreview(directorAssetId, previewUrl, processingNodeId)
    }
  )
  handle(IpcChannels.WINDOW_OPEN_SHOT_PREVIEW, (dataUrl: string) => openShotPreviewWindow(dataUrl))
  handle(IpcChannels.WINDOW_CLOSE_SHOT_PREVIEW, () => closeShotPreviewWindow())
  handle(IpcChannels.SHOT_PREVIEW_GET, () => getShotPreviewPayload())
  handle(IpcChannels.WINDOW_OPEN_SHOT_TABLE, (scriptAssetId: string) =>
    openShotTableWindow(scriptAssetId)
  )
  handle(IpcChannels.WINDOW_CLOSE_SHOT_TABLE, (scriptAssetId?: string) =>
    closeShotTableWindow(scriptAssetId)
  )
  handle(IpcChannels.WINDOW_OPEN_WORLD_TABLE, (worldAssetId: string) =>
    openWorldTableWindow(worldAssetId)
  )
  handle(IpcChannels.WINDOW_CLOSE_WORLD_TABLE, (worldAssetId?: string) =>
    closeWorldTableWindow(worldAssetId)
  )

  handle(IpcChannels.ASSET_LIST, () => projectService.listAssets())
  handle(IpcChannels.ASSET_IMPORT, (input: ImportAssetsInput) =>
    projectService.importAssets(input.filePaths, input.folderId ?? null)
  )
  handle(IpcChannels.ASSET_REIMPORT, (input: ReimportAssetsInput) => {
    const result = projectService.reimportAssets(input.assetIds ?? [], {
      folderId: input.folderId
    })
    const reimported = result.reimported ?? []
    for (const asset of reimported) {
      broadcastToAllWindows(IpcChannels.ASSET_UPDATED, asset)
    }
    return {
      reimported,
      skipped: result.skipped ?? [],
      folders: result.folders ?? []
    }
  })
  handle(IpcChannels.ASSET_CREATE, (input: CreateAssetInput) => projectService.createAsset(input))
  handle(IpcChannels.ASSET_DELETE, (assetId: string) => projectService.deleteAsset(assetId))
  handle(IpcChannels.ASSET_FIND_REFERENCES, (assetIds: string[]) =>
    projectService.findAssetReferences(assetIds)
  )
  handle(IpcChannels.ASSET_RENAME, (assetId: string, name: string) =>
    projectService.renameAsset(assetId, name)
  )
  handle(IpcChannels.ASSET_UPDATE, (asset: AssetInfo) => {
    const updated = projectService.updateAsset(asset)
    broadcastToAllWindows(IpcChannels.ASSET_UPDATED, updated)
    return updated
  })
  handle(IpcChannels.ASSET_ATTACH_FILE, (input: AttachAssetFileInput) => {
    const updated = projectService.attachAssetFile(input)
    broadcastToAllWindows(IpcChannels.ASSET_UPDATED, updated)
    return updated
  })
  handle(IpcChannels.ASSET_ATTACH_RELATIVE, (input: AttachAssetRelativeInput) => {
    const updated = projectService.attachAssetRelative(input)
    broadcastToAllWindows(IpcChannels.ASSET_UPDATED, updated)
    return updated
  })
  handle(IpcChannels.ASSET_GET_FILE_URL, (relativePath: string) =>
    projectService.getAssetFileUrl(relativePath)
  )
  handle(IpcChannels.ASSET_GET_PREVIEW_URL, (relativePath: string) =>
    projectService.getAssetPreviewUrl(relativePath)
  )
  handle(IpcChannels.ASSET_WRITE_TEXT, (input: WriteAssetTextInput) => {
    const updated = projectService.writeAssetText(input)
    broadcastToAllWindows(IpcChannels.ASSET_UPDATED, updated)
    return updated
  })
  handle(IpcChannels.ASSET_MEDIA_DATA_URL, (relativePath: string) =>
    toMediaUrl(relativePath, projectService.getRoot())
  )
  handle(IpcChannels.OBJECT_STORAGE_UPLOAD_MEDIA, async (relativePath: string) => {
    const uploaded = await uploadProjectMediaToTos(relativePath)
    return {
      url: uploaded.url,
      objectKey: uploaded.objectKey,
      bytes: uploaded.bytes,
      sourceLabel: uploaded.sourceLabel,
      logs: uploaded.logs
    }
  })
  handle(IpcChannels.ASSET_SHOW_IN_FOLDER, (assetId: string) =>
    projectService.showAssetInFolder(assetId)
  )
  handle(IpcChannels.ASSET_COPY_ORIGINAL_FILES, (assetIds: string[]) =>
    projectService.copyAssetOriginalFiles(assetIds)
  )

  handle(IpcChannels.ASSET_PACKAGE_EXPORT, (input: ExportAssetPackageInput) =>
    assetPackageService.exportPackage(input)
  )
  handle(IpcChannels.ASSET_PACKAGE_PREVIEW, (packPath?: string) =>
    assetPackageService.previewPackage(packPath)
  )
  handle(IpcChannels.ASSET_PACKAGE_IMPORT, (input?: ImportAssetPackageInput) =>
    assetPackageService.importPackage(input ?? {})
  )

  handle(IpcChannels.FOLDER_LIST, () => projectService.listFolders())
  handle(IpcChannels.FOLDER_CREATE, (input: CreateFolderInput) => projectService.createFolder(input))
  handle(IpcChannels.FOLDER_RENAME, (folderId: string, name: string) =>
    projectService.renameFolder(folderId, name)
  )
  handle(IpcChannels.FOLDER_DELETE, (input: DeleteFolderInput | string) => {
    if (typeof input === 'string') {
      projectService.deleteFolder(input)
      return
    }
    projectService.deleteFolder(input.folderId, { mode: input.mode })
  })

  handle(IpcChannels.SHOT_LIST, () => projectService.listShots())
  handle(IpcChannels.SHOT_GET, (shotId: string) => projectService.getShot(shotId))
  handle(IpcChannels.SHOT_CREATE, (input?: CreateShotInput) => projectService.createShot(input))
  handle(IpcChannels.SHOT_UPDATE, (shot: Shot) => projectService.updateShot(shot))
  handle(IpcChannels.SHOT_DELETE, (shotId: string) => projectService.deleteShot(shotId))
  handle(IpcChannels.SHOT_REORDER, (shotIds: string[]) => projectService.reorderShots(shotIds))
  handle(IpcChannels.SHOT_SYNC_SCRIPT, (input: SyncScriptShotsInput) =>
    projectService.syncScriptShots(input)
  )

  handle(IpcChannels.GEN_TEXT, (input: GenerateTextInput) => openRouterClient.generateText(input))
  // 图节点执行需要 images 内容；落盘资产请走 generateImageAsset 专用路径
  handle(IpcChannels.GEN_IMAGE, (input: GenerateImageInput) =>
    openRouterClient.generateImage(input)
  )
  handle(IpcChannels.GEN_VIDEO, async (input: GenerateVideoInput & { name?: string }) => {
    const result = await openRouterClient.generateVideo(input)
    const asset = projectService.listAssets().find((item) => item.id === result.assetId)
    if (asset) broadcastToAllWindows(IpcChannels.ASSET_UPDATED, asset)
    return result
  })
  handle(IpcChannels.GEN_SPEECH, (input: GenerateSpeechInput) =>
    openRouterClient.generateSpeech(input)
  )
  handle(IpcChannels.VIDEO_JOB_LIST, () => videoJobService.list())
  handle(IpcChannels.VIDEO_JOB_GET, (localJobId: string) => videoJobService.get(localJobId))
  handle(IpcChannels.VIDEO_JOB_CANCEL, (localJobId: string) => videoJobService.cancel(localJobId))
  handle(IpcChannels.MODELS_LIST, (input: ListModelsInput) =>
    openRouterClient.listModels(input.modality, input.providerInstanceId, {
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
      providerKind: input.providerKind
    })
  )

  handle(IpcChannels.SETTINGS_GET, () => settingsService.get())
  handle(IpcChannels.SETTINGS_SET, (settings: AppSettings) => settingsService.set(settings))

  handle(IpcChannels.APP_GET_VERSION, () => updateService.getCurrentVersion())
  handle(IpcChannels.UPDATE_CHECK, () => updateService.checkForUpdates())
  handle(IpcChannels.UPDATE_INSTALL, () => updateService.quitAndInstall())

  handle(IpcChannels.AUTOSAVE_WRITE, (input: AutosaveWriteInput) =>
    autosaveRepository.write(projectService.getRoot(), input)
  )
  handle(IpcChannels.AUTOSAVE_LIST, () =>
    autosaveRepository.list(projectService.getRoot())
  )
  handle(IpcChannels.AUTOSAVE_READ, (filter: Required<AutosaveFilter>) =>
    autosaveRepository.read(projectService.getRoot(), filter)
  )
  handle(IpcChannels.AUTOSAVE_DISCARD, (filter?: AutosaveFilter) =>
    autosaveRepository.discard(projectService.getRoot(), filter)
  )
  handle(IpcChannels.PLUGIN_LIST, () => pluginRepository.list())

  handle(IpcChannels.CANVAS_SAVE_PNG, (shotId: string, dataUrl: string) =>
    projectService.saveCanvasPng(shotId, dataUrl)
  )
  handle(IpcChannels.GRAPH_SAVE_RUN_MEDIA, async (input: SaveGraphRunMediaInput) => {
    const result = await projectService.saveGraphRunMedia(input)
    if (result.asset) {
      broadcastToAllWindows(IpcChannels.ASSET_UPDATED, result.asset)
    }
    return result.relativePath
  })
  handle(IpcChannels.GRAPH_SAVE_RUN_TEXT, async (input: SaveGraphRunTextInput) => {
    const result = await projectService.saveGraphRunText(input)
    if (result.asset) {
      broadcastToAllWindows(IpcChannels.ASSET_UPDATED, result.asset)
    }
    return result.relativePath
  })
  handle(IpcChannels.GRAPH_DELETE_RUN_MEDIA, (relativePath: string) =>
    projectService.deleteGraphRunMedia(relativePath)
  )
}
