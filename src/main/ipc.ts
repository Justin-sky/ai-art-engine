import { clipboard, ipcMain } from 'electron'
import { IpcChannels } from '@shared/ipc'
import type { AppSettings, ProjectConfig, AssetInfo } from '@shared/domain'
import type {
  AttachAssetFileInput,
  AttachAssetRelativeInput,
  CreateAssetInput,
  CreateFolderInput,
  CreateProjectInput,
  DeleteFolderInput,
  ImportAssetsInput,
  ReimportAssetsInput,
  SaveProjectAssetInput,
  AutosaveFilter,
  AutosaveWriteInput,
  SaveTextFileInput,
  SaveBinaryFileInput,
  SaveBinaryFilesToDirectoryInput,
  SaveGraphRunMediaInput,
  SaveGraphRunTextInput,
  ExportAssetPackageInput,
  ExportAdVariantsInput,
  ImportAssetPackageInput,
  WriteAssetTextInput,
  PlanAiWorkflowInput,
  CommitAiWorkflowInput
} from '@shared/ipc'
import type { TimelineExportInput } from '@shared/graph'
import { assetPackageService } from './services/assetPackageService'
import type {
  GenerateImageInput,
  GenerateSpeechInput,
  GenerateTextInput,
  GenerateVideoInput,
  GenerateModel3dInput,
  ListModelsInput
} from '@shared/modelProvider'
import { listRegisteredObjectStorageKinds, listRegisteredProviderKinds } from './runtime'
import { projectService } from './services/projectService'
import { exportScriptTimeline } from './services/timelineExportService'
import { exportAdVariants } from './services/adVariantExportService'
import { videoJobService } from './services/videoJobService'
import { mcpActivityService } from './services/mcpActivityService'
import {
  abortHarnessTask,
  deleteHarnessSession,
  exportSkillTemplate,
  getDshSkillsInfo,
  getHarnessStatus,
  getSessionSkills,
  handleAskUserResponse,
  importCustomSkillsToGraph,
  listSkillTemplates,
  openDshSkillsDir,
  runHarnessTask,
  writeDshSkillsTemplate
} from './services/deepseekHarnessService'
import { settingsService } from './services/settingsService'
import { updateService } from './services/updateService'
import {
  getMcpServerInfo,
  receiveAskUserAnswer,
  restartMcpServer
} from './services/mcpServerService'
import { modelProviderFacade, toMediaUrl } from './services/modelProviders'
import {
  commitAiWorkflow,
  planAiWorkflow
} from './services/graphPlanService'
import { uploadProjectMedia } from './services/objectStorageUploadService'
import { autosaveRepository } from './repositories/autosaveRepository'
import { pluginRepository } from './repositories/pluginRepository'
import { dialogService } from './services/dialogService'
import { broadcastToAllWindows } from './broadcast'

function handle<T>(channel: string, fn: (...args: never[]) => Promise<T> | T): void {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return await fn(...(args as never[]))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const code = err instanceof Error && 'code' in err ? String(err.code) : '-'
      // code 便于日志检索；用户可见消息保持原样透传
      console.error(`[IPC ${channel}] code=${code}`, message)
      throw new Error(message)
    }
  })
}

export function registerIpcHandlers(): void {
  handle(IpcChannels.CLIPBOARD_WRITE_TEXT, (text: string) => {
    clipboard.writeText(String(text ?? ''))
  })

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
    mcpActivityService.clear()
    projectService.closeProject()
  })

  handle(IpcChannels.TIMELINE_EXPORT, (input: TimelineExportInput) => exportScriptTimeline(input))
  handle(IpcChannels.AD_VARIANT_EXPORT, (input: ExportAdVariantsInput) => exportAdVariants(input))

  handle(IpcChannels.ASSET_LIST, () => projectService.listAssets())
  handle(IpcChannels.ASSET_IMPORT, (input: ImportAssetsInput) =>
    projectService.importAssets(input.filePaths, input.folderId ?? null)
  )
  handle(IpcChannels.ASSET_SAVE_PROJECT_FILE, (input: SaveProjectAssetInput) => {
    const asset = projectService.saveProjectAsset(input)
    broadcastToAllWindows(IpcChannels.ASSET_UPDATED, asset)
    return asset
  })
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
    const uploaded = await uploadProjectMedia(relativePath)
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
  handle(IpcChannels.ASSET_SHOW_FOLDER, (folderId: string) =>
    projectService.showFolderInFolder(folderId)
  )
  handle(IpcChannels.VIDEO_DETECT_KEYFRAMES, (relativePath: string) =>
    projectService.detectVideoKeyframes(relativePath)
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

  handle(IpcChannels.GEN_TEXT, (input: GenerateTextInput) => modelProviderFacade.generateText(input))
  handle(IpcChannels.GEN_AI_WORKFLOW_PLAN, (input: PlanAiWorkflowInput) => planAiWorkflow(input))
  handle(IpcChannels.GEN_AI_WORKFLOW_COMMIT, async (input: CommitAiWorkflowInput) => {
    const result = await commitAiWorkflow(input)
    if (result.ok && result.assetId) {
      const asset = projectService.listAssets().find((item) => item.id === result.assetId)
      if (asset) broadcastToAllWindows(IpcChannels.ASSET_UPDATED, asset)
    }
    return result
  })
  // 图节点执行需要 images 内容；落盘资产请走 generateImageAsset 专用路径
  handle(IpcChannels.GEN_IMAGE, (input: GenerateImageInput) =>
    modelProviderFacade.generateImage(input)
  )
  handle(IpcChannels.GEN_VIDEO, async (input: GenerateVideoInput & { name?: string }) => {
    const result = await modelProviderFacade.generateVideo(input)
    const asset = projectService.listAssets().find((item) => item.id === result.assetId)
    if (asset) broadcastToAllWindows(IpcChannels.ASSET_UPDATED, asset)
    return result
  })
  handle(IpcChannels.GEN_SPEECH, (input: GenerateSpeechInput) =>
    modelProviderFacade.generateSpeech(input)
  )
  handle(
    IpcChannels.TRANSCRIBE_AUDIO,
    (input: import('@shared/modelProvider').TranscribeAudioInput) =>
      modelProviderFacade.transcribeAudio(input)
  )
  handle(IpcChannels.GEN_MODEL3D, async (input: GenerateModel3dInput) => {
    const result = await modelProviderFacade.generateModel3d(input)
    const asset = projectService.listAssets().find((item) => item.id === result.assetId)
    if (asset) broadcastToAllWindows(IpcChannels.ASSET_UPDATED, asset)
    return result
  })
  handle(IpcChannels.VIDEO_JOB_LIST, () => videoJobService.list())
  handle(IpcChannels.VIDEO_JOB_GET, (localJobId: string) => videoJobService.get(localJobId))
  handle(IpcChannels.VIDEO_JOB_CANCEL, (localJobId: string) => videoJobService.cancel(localJobId))
  handle(IpcChannels.PROVIDERS_LIST_KINDS, () => listRegisteredProviderKinds())
  handle(IpcChannels.OBJECT_STORAGE_LIST_KINDS, () => listRegisteredObjectStorageKinds())
  handle(IpcChannels.MODELS_LIST, (input: ListModelsInput) =>
    modelProviderFacade.listModels(input.modality, input.providerInstanceId, {
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
      nativeBaseUrl: input.nativeBaseUrl,
      providerKind: input.providerKind
    })
  )

  handle(IpcChannels.SETTINGS_GET, () => settingsService.get())
  handle(IpcChannels.SETTINGS_SET, (settings: AppSettings) => settingsService.set(settings))

  handle(IpcChannels.MCP_GET_INFO, () => getMcpServerInfo())
  handle(IpcChannels.MCP_RESTART, (input: import('@shared/ipc').McpRestartInput) =>
    restartMcpServer(input)
  )
  handle(IpcChannels.MCP_ACTIVITY_LIST, () => mcpActivityService.list())

  handle(IpcChannels.HARNESS_STATUS, () => getHarnessStatus())
  handle(IpcChannels.HARNESS_RUN, (input: import('@shared/ipc').HarnessRunInput) =>
    runHarnessTask(input)
  )
  handle(IpcChannels.HARNESS_ABORT, () => abortHarnessTask())
  handle(IpcChannels.HARNESS_DELETE_SESSION, (sessionId: string) =>
    deleteHarnessSession(sessionId)
  )
  handle(IpcChannels.SKILLS_GET_INFO, () => getDshSkillsInfo())
  handle(IpcChannels.SKILLS_OPEN_DIR, () => openDshSkillsDir())
  handle(IpcChannels.SKILLS_WRITE_TEMPLATE, () => writeDshSkillsTemplate())
  handle(IpcChannels.SKILLS_LIST_TEMPLATES, () => listSkillTemplates())
  handle(IpcChannels.SKILLS_EXPORT_TEMPLATE, (id: string) => exportSkillTemplate(id))
  handle(IpcChannels.SKILLS_GET_SESSION, () => getSessionSkills())
  handle(IpcChannels.SKILLS_IMPORT_TO_GRAPH, () => importCustomSkillsToGraph())

  // ask_user 用户选择回传：按 requestId 前缀分流。
  // - harness:  → dsh 原生 ask_user_question（runner 经 answerFile 等待）
  // - 其他（mcp: 或自建 ask_user 工具）→ MCP 服务侧等待轮询
  handle(IpcChannels.MCP_ASK_USER_RESPONSE, (payload: import('@shared/ipc').AskUserAnswer) => {
    if (payload && typeof payload.requestId === 'string') {
      if (payload.requestId.startsWith('harness:')) {
        handleAskUserResponse(payload)
      } else {
        receiveAskUserAnswer(payload)
      }
    }
    return true
  })

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
  handle(IpcChannels.AUTOSAVE_DISCARD, (filter?: AutosaveFilter) => {
    // 丢弃自动保存是纯清理动作：无工程时无可清理，按 no-op 成功处理而非报错
    if (!projectService.isOpen()) return
    autosaveRepository.discard(projectService.getRoot(), filter)
  })
  handle(IpcChannels.PLUGIN_LIST, () => pluginRepository.list())

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
  handle(IpcChannels.PROJECT_READ_FILE, (relativePath: string) =>
    projectService.readProjectFile(relativePath)
  )
  handle(
    IpcChannels.PROJECT_WRITE_FILE,
    (input: { relativePath: string; content: string }) =>
      projectService.writeProjectFile(input)
  )
  handle(IpcChannels.GRAPH_DELETE_RUN_MEDIA, (relativePath: string) =>
    projectService.deleteGraphRunMedia(relativePath)
  )
}
