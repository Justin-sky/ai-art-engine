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
  MoveFolderInput,
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
  CommitAiWorkflowInput,
  ProjectScanOutputsInput,
  InstalledWorkflowRecordView,
  ExportWorkflowToMarketInput,
  ScreenRecordStartInput
} from '@shared/ipc'
import type { GitFileDiffInput } from '@shared/git'
import type { TimelineExportInput, TimelineTransitionPreviewInput } from '@shared/graph'
import { assetPackageService } from './services/assetPackageService'
import { openGameplayDocument, releaseGameplayDocument } from './studioGameplayProtocol'
import type {
  GenerateImageInput,
  GenerateMusicInput,
  GenerateSpeechInput,
  GenerateTextInput,
  GenerateVideoInput,
  GenerateModel3dInput,
  ListModelsInput,
  SpeechVoiceLabelsInput,
  GenerateSoundEffectInput
} from '@shared/modelProvider'
import { listRegisteredObjectStorageKinds, listRegisteredProviderKinds } from './runtime'
import { projectService } from './services/projectService'
import { readGitFileDiff, readGitStatus } from './services/gitService'
import { scanProjectOutputFiles } from './services/outputScanService'
import { exportScriptTimeline } from './services/timelineExportService'
import { renderTimelineTransitionPreview } from './services/timelineTransitionPreviewService'
import { exportAdVariants } from './services/adVariantExportService'
import { videoJobService } from './services/videoJobService'
import { mcpActivityService } from './services/mcpActivityService'
import { getFfmpegRuntimeStatus, installFfmpeg } from './services/ffmpegInstallService'
import {
  abortHarnessTask,
  deleteHarnessSession,
  exportSkillTemplate,
  getDshSkillsInfo,
  getHarnessStatus,
  getSessionSkills,
  handleApprovalResponse,
  handleAskUserResponse,
  importCustomSkillsToGraph,
  listSkillTemplates,
  openDshSkillsDir,
  prewarmHarness,
  runHarnessJobWait,
  runHarnessTask,
  writeDshSkillsTemplate
} from './services/deepseekHarnessService'
import {
  cleanupBlenderDshJob,
  evaluateBlenderDshJob,
  finalizeBlenderDshJob,
  prepareBlenderDshJob
} from './services/blenderDshJobService'
import { buildGamePlayProject } from './services/gamePlayBuildService'
import { settingsService } from './services/settingsService'
import { updateService } from './services/updateService'
import {
  applyBlenderMcpSettings,
  getBlenderMcpInfoFresh,
  getMcpServerInfo,
  receiveAskUserAnswer,
  restartMcpServer
} from './services/mcpServerService'
import { runBlenderTool } from './services/blenderMcpService'
import { blenderToolSpec } from '@shared/blenderMcp'
import { modelProviderFacade, toMediaUrl } from './services/modelProviders'
import { YOLO_CATALOG_ALL } from '@shared/yoloCatalog'
import {
  cancelYoloModelDownload,
  chooseYoloModelDir,
  deleteYoloModel,
  downloadYoloModel,
  setYoloModelDir
} from './yolo/yoloModelManager'
import { yoloService } from './yolo/yoloService'
import type { YoloInferenceInput } from '@shared/yolo'
import { commitAiWorkflow, planAiWorkflow } from './services/graphPlanService'
import { uploadProjectMedia } from './services/objectStorageUploadService'
import { getBuiltinSearchProvider } from './plugins/searchProviders'
import { autosaveRepository } from './repositories/autosaveRepository'
import { pluginRepository } from './repositories/pluginRepository'
import { dialogService } from './services/dialogService'
import { openMarketplaceWindow } from './services/marketplaceWindow'
import {
  normalizeExternalMcpServer,
  externalMcpUnusableReason,
  namespaceExternalMcpTool,
  type ExternalMcpServer
} from '@shared/externalMcp'
import { describeExternalMcpError, probeExternalMcpServer } from './services/externalMcpClient'
import {
  fetchWorkflowCatalog,
  fetchWorkflowCover,
  installWorkflow,
  listInstalledWorkflowDetails,
  readInstalledWorkflowPlan,
  resetWorkflowMarketCache,
  uninstallWorkflow
} from './services/workflowMarketService'
import type { WorkflowSkillManifest } from '@shared/workflowMarket'
import { exportWorkflowToMarket } from './services/workflowExportService'
import {
  screenRecordingStatus,
  startScreenRecording,
  stepScreenRecording,
  stopScreenRecording
} from './services/screenRecordService'
import type { ScreenRecordStepInput } from '@shared/screenRecord'
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
  handle(IpcChannels.GAMEPLAY_OPEN_DOCUMENT, (html: string) =>
    openGameplayDocument(String(html ?? ''))
  )
  handle(IpcChannels.GAMEPLAY_RELEASE_DOCUMENT, (urlOrId: string) => {
    releaseGameplayDocument(String(urlOrId ?? ''))
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
  handle(IpcChannels.TIMELINE_TRANSITION_PREVIEW, (input: TimelineTransitionPreviewInput) =>
    renderTimelineTransitionPreview(input)
  )
  handle(IpcChannels.AD_VARIANT_EXPORT, (input: ExportAdVariantsInput) => exportAdVariants(input))

  // 应用界面录制（教学视频的素材来源）：录制主体在主进程，渲染层只负责 HUD 显示
  handle(IpcChannels.SCREEN_RECORD_START, (input?: ScreenRecordStartInput) =>
    startScreenRecording(input)
  )
  handle(IpcChannels.SCREEN_RECORD_STEP, (input: ScreenRecordStepInput) =>
    stepScreenRecording(input)
  )
  handle(IpcChannels.SCREEN_RECORD_STOP, () => stopScreenRecording())
  handle(IpcChannels.SCREEN_RECORD_STATUS, () => screenRecordingStatus())

  handle(IpcChannels.ASSET_LIST, () => projectService.listAssets())
  handle(IpcChannels.ASSET_IMPORT, async (input: ImportAssetsInput) => {
    const jobId = input.jobId?.trim()
    return projectService.importAssets(input.filePaths, input.folderId ?? null, {
      // 只有带了 jobId 的作业才推事件：拖入文件夹的进度条据此对账，多窗口互不串台
      onProgress: jobId
        ? (progress) =>
            broadcastToAllWindows(IpcChannels.ASSET_IMPORT_PROGRESS, { ...progress, jobId })
        : undefined
    })
  })
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
  handle(IpcChannels.ASSET_DELETE, (assetId: string) => {
    // 资产库面板删除也要广播 ASSET_REMOVED：此前只有 MCP asset_delete 路径广播，
    // 渲染层（对话产物卡上的「已保存」状态、编辑窗关闭）会一直拿着已不存在的资产引用。
    // 删除前先拿一次目标路径，载荷里带 `{ id, path }`（详见 shared/ipc.ts ASSET_REMOVED）。
    const target = projectService.listAssets().find((item) => item.id === assetId)
    projectService.deleteAsset(assetId)
    if (target) {
      broadcastToAllWindows(IpcChannels.ASSET_REMOVED, {
        id: assetId,
        path: target.relativePath
      })
    }
  })
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
  // 文件缺失是预期状态（用户删/移文件、清缓存、拷贝工程不带缓存）：getAssetFileUrl 返回 null，
  // 不再抛 E_ASSET_FILE_MISSING。若在这里抛，handler 的 catch 会把它升级成未处理异常，
  // 日志反复刷「Error occurred in handler for 'asset:get-file-url'」，界面也拿不到可降级的结果。
  handle(IpcChannels.ASSET_GET_FILE_URL, (relativePath: string) =>
    projectService.getAssetFileUrl(relativePath)
  )
  handle(IpcChannels.ASSET_GET_PREVIEW_URL, (relativePath: string) =>
    projectService.getAssetPreviewUrl(relativePath)
  )
  handle(
    IpcChannels.ASSET_SAVE_MODEL_THUMBNAIL,
    async (input: import('@shared/ipc').SaveModelThumbnailInput) => {
      const result = await projectService.saveModelThumbnail(input)
      if (result.asset) broadcastToAllWindows(IpcChannels.ASSET_UPDATED, result.asset)
      return result
    }
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
  handle(IpcChannels.ASSET_OPEN_WITH_DEFAULT_APP, (relativePath: string) =>
    projectService.openAssetWithDefaultApp(relativePath)
  )
  handle(IpcChannels.ASSET_SHOW_FOLDER, (folderId: string) =>
    projectService.showFolderInFolder(folderId)
  )
  handle(IpcChannels.VIDEO_DETECT_KEYFRAMES, (relativePath: string) =>
    projectService.detectVideoKeyframes(relativePath)
  )
  handle(IpcChannels.VIDEO_EXTRACT_FRAMES, (input: { relativePath: string; count: number }) =>
    projectService.extractVideoFrames(input.relativePath, input.count)
  )
  handle(
    IpcChannels.VIDEO_GRAB_TIMESTAMPS,
    (input: { relativePath: string; timestamps: number[]; options?: { width?: number } }) =>
      projectService.grabVideoFramesAtTimestamps(
        input.relativePath,
        input.timestamps,
        input.options
      )
  )
  handle(IpcChannels.VIDEO_BEAT_ANALYZE, (assetId: string) =>
    projectService.analyzeVideoBeats(assetId)
  )
  handle(IpcChannels.FFMPEG_INSTALL, () => installFfmpeg())
  handle(IpcChannels.FFMPEG_STATUS, () => getFfmpegRuntimeStatus())
  handle(IpcChannels.AUDIO_SEPARATE, (relativePath: string) =>
    projectService.separateAudio(relativePath)
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
  handle(IpcChannels.FOLDER_CREATE, (input: CreateFolderInput) =>
    projectService.createFolder(input)
  )
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
  handle(IpcChannels.FOLDER_MOVE, (input: MoveFolderInput) =>
    projectService.moveFolder(input.folderId, input.newParentId ?? null)
  )

  handle(IpcChannels.GEN_TEXT, (input: GenerateTextInput) =>
    modelProviderFacade.generateText(input)
  )
  handle(
    IpcChannels.GEN_DECISIONS,
    (input: import('@shared/modelProvider').GenerateDecisionsInput) =>
      modelProviderFacade.generateDecisions(input)
  )
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
  /**
   * 语音合成 → 工程声音资产。
   *
   * 必须走 generateSpeechAsset 而不是 generateSpeech：后者的返回类型里
   * **没有 assetId / relativePath**（落盘与资产登记都由 Asset 版本完成），
   * 图节点拿到这样的结果会直接报「语音合成未返回资产」。
   * 与下面的 GEN_MUSIC 用 generateMusicAsset 是同一个道理。
   */
  handle(IpcChannels.GEN_SPEECH, async (input: GenerateSpeechInput) => {
    const result = await modelProviderFacade.generateSpeechAsset(input)
    const asset = projectService.listAssets().find((item) => item.id === result.assetId)
    if (asset) broadcastToAllWindows(IpcChannels.ASSET_UPDATED, asset)
    return result
  })
  handle(IpcChannels.GEN_MUSIC, async (input: GenerateMusicInput & { name?: string }) => {
    const result = await modelProviderFacade.generateMusicAsset(input)
    const asset = projectService.listAssets().find((item) => item.id === result.assetId)
    if (asset) broadcastToAllWindows(IpcChannels.ASSET_UPDATED, asset)
    return result
  })
  handle(IpcChannels.GEN_SOUND_EFFECT, async (input: GenerateSoundEffectInput) => {
    const result = await modelProviderFacade.generateSoundEffectAsset(input)
    const asset = projectService.listAssets().find((item) => item.id === result.assetId)
    if (asset) broadcastToAllWindows(IpcChannels.ASSET_UPDATED, asset)
    return result
  })
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
  handle(
    IpcChannels.GEN_SPATIAL_WORLD,
    async (input: import('@shared/modelProvider').GenerateSpatialWorldInput) => {
      const result = await modelProviderFacade.generateSpatialWorld(input)
      const asset = projectService.listAssets().find((item) => item.id === result.assetId)
      if (asset) broadcastToAllWindows(IpcChannels.ASSET_UPDATED, asset)
      return result
    }
  )
  handle(
    IpcChannels.GEN_SPATIAL_WORLD_EXPORT,
    async (input: import('@shared/modelProvider').ExportWorldInput) => {
      const result = await modelProviderFacade.exportWorld(input)
      // PLY 泼溅导出不登记资产，没有可广播的 asset
      const asset = result.assetId
        ? projectService.listAssets().find((item) => item.id === result.assetId)
        : undefined
      if (asset) broadcastToAllWindows(IpcChannels.ASSET_UPDATED, asset)
      return result
    }
  )
  handle(IpcChannels.GEN_SPATIAL_WORLD_RECOVER_ID, (input: { nodeId?: string; assetId?: string }) =>
    modelProviderFacade.recoverSpatialWorldId(input)
  )
  handle(
    IpcChannels.RIG_MODEL3D,
    async (input: import('@shared/modelProvider').RigModel3dInput) => {
      const result = await modelProviderFacade.rigModel3d(input)
      const asset = projectService.listAssets().find((item) => item.id === result.assetId)
      if (asset) broadcastToAllWindows(IpcChannels.ASSET_UPDATED, asset)
      return result
    }
  )
  handle(
    IpcChannels.SEGMENT_MODEL3D,
    async (input: import('@shared/modelProvider').SegmentModel3dInput) => {
      const result = await modelProviderFacade.segmentModel3d(input)
      const asset = projectService.listAssets().find((item) => item.id === result.assetId)
      if (asset) broadcastToAllWindows(IpcChannels.ASSET_UPDATED, asset)
      return result
    }
  )
  handle(
    IpcChannels.POST_PROCESS_MODEL3D,
    async (input: import('@shared/modelProvider').Model3dPostProcessInput) => {
      const result = await modelProviderFacade.postProcessModel3d(input)
      // 绑骨检查无产物，不广播资产更新
      if (result.op !== 'rigCheck') {
        const asset = projectService.listAssets().find((item) => item.id === result.assetId)
        if (asset) broadcastToAllWindows(IpcChannels.ASSET_UPDATED, asset)
      }
      return result
    }
  )
  handle(
    IpcChannels.LIST_MODEL3D_ANIMATIONS,
    (input: import('@shared/modelProvider').ListModel3dAnimationsInput) =>
      modelProviderFacade.listModel3dAnimations(input)
  )
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
      providerKind: input.providerKind,
      apiStyle: input.apiStyle
    })
  )
  handle(IpcChannels.LIST_SPEECH_VOICE_LABELS, (input: SpeechVoiceLabelsInput) =>
    modelProviderFacade.listSpeechVoiceLabels(input.providerInstanceId, {
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
      nativeBaseUrl: input.nativeBaseUrl,
      providerKind: input.providerKind,
      apiStyle: input.apiStyle
    })
  )
  handle(IpcChannels.LIST_ALL_AUDIO_MODELS, (input: SpeechVoiceLabelsInput) =>
    modelProviderFacade.listAllAudioModels(input.providerInstanceId, {
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
      nativeBaseUrl: input.nativeBaseUrl,
      providerKind: input.providerKind,
      apiStyle: input.apiStyle
    })
  )

  handle(IpcChannels.SETTINGS_GET, () => settingsService.get())
  handle(IpcChannels.SETTINGS_SET, (settings: AppSettings) => {
    /**
     * 记住了改之前的市场源：改了源就必须清市场缓存。
     *
     * `resetWorkflowMarketCache()` 的注释一直写着「设置里改了源地址后清缓存」，但**从来没有
     * 任何调用点**（死导出）—— 于是换源之后内存里还是旧源的目录与封面，
     * 看起来像「换了地址却没生效」。
     */
    const previousSource = settingsService.get().workflowMarket?.source ?? ''
    const saved = settingsService.set(settings)
    if ((saved.workflowMarket?.source ?? '') !== previousSource) resetWorkflowMarketCache()
    // 广播给所有窗口：插件市场是独立窗口，它保存后主窗口必须知道 ——
    // 编辑器偏好与生成模型下拉都是按窗口缓存的，不广播就会一直用旧值。
    broadcastToAllWindows(IpcChannels.SETTINGS_UPDATED, saved)
    return saved
  })

  // 工作流市场（远端 ai-art-engine-workflow）
  handle(IpcChannels.WORKFLOW_MARKET_FETCH, (input?: { force?: boolean }) =>
    fetchWorkflowCatalog(input)
  )
  handle(IpcChannels.WORKFLOW_MARKET_COVER, (id: string) => fetchWorkflowCover(id))
  handle(
    IpcChannels.WORKFLOW_MARKET_INSTALL,
    (input: {
      id: string
      acceptMissingTypes?: boolean
      skill?: WorkflowSkillManifest
      skillScriptsConsent?: boolean
    }) => installWorkflow(input)
  )
  handle(IpcChannels.WORKFLOW_MARKET_UNINSTALL, (id: string) => uninstallWorkflow({ id }))
  handle(IpcChannels.WORKFLOW_MARKET_INSTALLED, (): InstalledWorkflowRecordView[] =>
    listInstalledWorkflowDetails()
  )
  handle(IpcChannels.WORKFLOW_MARKET_BUNDLE, (id: string) => readInstalledWorkflowPlan(id))
  handle(IpcChannels.WORKFLOW_EXPORT_TO_MARKET, (input: ExportWorkflowToMarketInput) =>
    exportWorkflowToMarket(input)
  )

  // 插件市场窗口（单例：已开着则聚焦）
  handle(IpcChannels.MARKETPLACE_OPEN_WINDOW, () => {
    openMarketplaceWindow()
  })

  /**
   * 探测外部 MCP 服务（添加时的预检 / 卡片上的测试连接）。
   * 有意不落盘：设置由渲染层经 setSettings 保存，这条只负责「能不能连上、有哪些工具」。
   * 失败返回 ok:false 而不是抛错 —— 连不上是配置阶段的常态，原因要能稳定显示在卡片上。
   */
  handle(IpcChannels.MCP_EXTERNAL_PROBE, async (input: ExternalMcpServer) => {
    const server = normalizeExternalMcpServer(input)
    if (!server) {
      return { ok: false, error: 'invalidId', reasonKey: 'marketplace.ext.invalidIdShort' }
    }
    const unusable = externalMcpUnusableReason(server)
    if (unusable) {
      // 配置不全：原因是可翻译的键，交给渲染层出文案
      return { ok: false, error: unusable, reasonKey: `marketplace.ext.${unusable}` }
    }
    try {
      const { tools } = await probeExternalMcpServer(server)
      return {
        ok: true,
        // 名字加命名空间前缀：与 dsh 实际看到的工具名一致，用户对照时不会困惑
        tools: tools.map((tool) => ({
          name: namespaceExternalMcpTool(server.id, tool.name),
          ...(tool.description ? { description: tool.description } : {})
        }))
      }
    } catch (err) {
      return { ok: false, ...describeExternalMcpError(err) }
    }
  })

  // 联网搜索：测试指定 provider 连通性（按 providerKind 取内置 adapter 做一次轻量探测）
  handle(IpcChannels.SEARCH_TEST_CONNECTION, async (input: { id?: string } | undefined) => {
    if (!input || typeof input.id !== 'string' || !input.id) {
      throw new Error('search provider id is required')
    }
    const provider = settingsService.get().search.providers.find((p) => p.id === input.id)
    if (!provider) throw new Error(`search provider not found: ${input.id}`)
    const adapter = getBuiltinSearchProvider(provider.providerKind)
    if (!adapter) throw new Error(`search adapter not registered: ${provider.providerKind}`)
    await adapter.assertAuth(provider)
  })

  // Local vision (YOLO)
  handle(IpcChannels.YOLO_STATUS, () => yoloService.status())
  handle(IpcChannels.YOLO_DETECT, (input: YoloInferenceInput) => yoloService.detect(input))
  handle(IpcChannels.YOLO_SEGMENT, (input: YoloInferenceInput) => yoloService.segment(input))
  handle(IpcChannels.YOLO_POSE, (input: YoloInferenceInput) => yoloService.pose(input))
  handle(IpcChannels.YOLO_FACE, (input: YoloInferenceInput) => yoloService.face(input))
  handle(IpcChannels.YOLO_OPEN_MODEL_DIR, () => yoloService.openModelDir())
  handle(IpcChannels.YOLO_MODEL_CATALOG, () => YOLO_CATALOG_ALL)
  // sourceUrl 可选：人脸两段式托管在本仓 Release，渲染层把最终地址传下来（主进程白名单校验）
  handle(IpcChannels.YOLO_MODEL_DOWNLOAD, (modelId: string, sourceUrl?: string) =>
    downloadYoloModel(modelId, sourceUrl)
  )
  handle(IpcChannels.YOLO_MODEL_DOWNLOAD_CANCEL, () => cancelYoloModelDownload())
  handle(IpcChannels.YOLO_MODEL_DELETE, (modelId: string) => deleteYoloModel(modelId))
  handle(IpcChannels.YOLO_MODEL_DIR_CHOOSE, () => chooseYoloModelDir())
  handle(IpcChannels.YOLO_MODEL_DIR_SET, (dir: string) => setYoloModelDir(dir))

  handle(IpcChannels.MCP_GET_INFO, () => getMcpServerInfo())
  handle(IpcChannels.MCP_RESTART, (input: import('@shared/ipc').McpRestartInput) =>
    restartMcpServer(input)
  )
  handle(IpcChannels.MCP_BLENDER_GET_INFO, (input?: { probe?: boolean }) =>
    input?.probe ? getBlenderMcpInfoFresh() : (getMcpServerInfo()?.blenderBridge ?? null)
  )
  handle(IpcChannels.MCP_BLENDER_RESTART, (input: import('@shared/ipc').McpBlenderRestartInput) =>
    applyBlenderMcpSettings(input)
  )
  handle(
    IpcChannels.MCP_BLENDER_RUN_TOOL,
    async (input: import('@shared/ipc').RunBlenderMcpToolInput) => {
      // 名字白名单：与协议层（dsh / 外部 Agent）走同一张 BLENDER_TOOLS 表，避免 UI 侧拿到任何
      // 「handler(**kwargs) 多传一个键就 TypeError」的工具而误调到 addon 内部未导出命令。
      const spec = blenderToolSpec(input?.name ?? '')
      if (!spec) return { error: `Unknown Blender tool: ${input?.name ?? ''}` }
      return runBlenderTool(spec, input?.args ?? {})
    }
  )
  handle(IpcChannels.MCP_ACTIVITY_LIST, () => mcpActivityService.list())

  handle(IpcChannels.GIT_STATUS, () => readGitStatus())
  handle(IpcChannels.GIT_FILE_DIFF, (input: GitFileDiffInput) => readGitFileDiff(input))
  handle(IpcChannels.PROJECT_SCAN_OUTPUTS, (input: ProjectScanOutputsInput) => ({
    files: scanProjectOutputFiles(input)
  }))

  handle(IpcChannels.HARNESS_STATUS, () => getHarnessStatus())
  handle(IpcChannels.HARNESS_RUN, (input: import('@shared/ipc').HarnessRunInput) =>
    runHarnessTask(input)
  )
  handle(IpcChannels.HARNESS_RUN_WAIT, (input: import('@shared/ipc').HarnessJobWaitInput) =>
    runHarnessJobWait(input)
  )
  handle(
    IpcChannels.BLENDER_DSH_PREPARE,
    (input: import('@shared/ipc').PrepareBlenderDshJobInput) => prepareBlenderDshJob(input)
  )
  handle(
    IpcChannels.BLENDER_DSH_EVALUATE,
    (input: import('@shared/ipc').EvaluateBlenderDshJobInput) => evaluateBlenderDshJob(input)
  )
  handle(
    IpcChannels.BLENDER_DSH_FINALIZE,
    (input: import('@shared/ipc').FinalizeBlenderDshJobInput) => finalizeBlenderDshJob(input)
  )
  handle(IpcChannels.BLENDER_DSH_CLEANUP, (jobId: string) => cleanupBlenderDshJob(jobId))
  handle(IpcChannels.GAMEPLAY_BUILD, (input: import('@shared/ipc').BuildGamePlayProjectInput) =>
    buildGamePlayProject(input)
  )
  handle(IpcChannels.HARNESS_ABORT, () => abortHarnessTask())
  handle(IpcChannels.HARNESS_PREWARM, () => prewarmHarness())
  handle(IpcChannels.HARNESS_DELETE_SESSION, (sessionId: string) => deleteHarnessSession(sessionId))
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

  /**
   * 审批决定回传：写回答文件，dsh 侧的应答插件读到后才会放行（仅一次）。
   * 返回 false = 这条请求已作废（本轮结束 / 进程已换），界面据此把卡片标为失效。
   */
  handle(IpcChannels.MCP_APPROVAL_RESPONSE, (payload: import('@shared/ipc').ApprovalAnswer) =>
    handleApprovalResponse(payload)
  )

  handle(IpcChannels.APP_GET_VERSION, () => updateService.getCurrentVersion())
  handle(IpcChannels.UPDATE_CHECK, () => updateService.checkForUpdates())
  handle(IpcChannels.UPDATE_INSTALL, () => updateService.quitAndInstall())

  handle(IpcChannels.AUTOSAVE_WRITE, (input: AutosaveWriteInput) =>
    autosaveRepository.write(projectService.getRoot(), input)
  )
  handle(IpcChannels.AUTOSAVE_LIST, () => autosaveRepository.list(projectService.getRoot()))
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
  handle(IpcChannels.PROJECT_WRITE_FILE, (input: { relativePath: string; content: string }) =>
    projectService.writeProjectFile(input)
  )
  handle(IpcChannels.PROJECT_FILE_EXISTS, (relativePath: string) =>
    projectService.checkProjectFileExists(relativePath)
  )
  handle(IpcChannels.GRAPH_DELETE_RUN_MEDIA, (relativePath: string) =>
    projectService.deleteGraphRunMedia(relativePath)
  )
}
