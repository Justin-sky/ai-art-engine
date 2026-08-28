import { app, shell } from 'electron'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'fs'
import { basename, dirname, extname, join, relative, resolve, sep } from 'path'
import { pathToFileURL } from 'url'
import { randomBytes, randomUUID } from 'crypto'
import { detectVideoKeyframes } from './ffprobeService'
import {
  DEFAULT_RESOLUTION,
  ASSET_IMAGE_OUTPUT_KIND_DIR,
  ASSET_TEXT_OUTPUT_KIND_DIR,
  createDefaultDirectorStage,
  assetTypeLabel,
  defaultAssetName,
  isImportableFileRefAssetType,
  isPoseModelAsset,
  isScreenplayAsset,
  isUnderAssetLibraryDir,
  isUnderCacheOutputDir,
  normalizeProjectRelativeDir,
  resolveCacheOutputRoot,
  resolveUniqueAssetName,
  resolveMediaOutputDir,
  withImportedMediaRefParams,
  isDraftAssetId,
  type AssetFolder,
  type AssetInfo,
  type AssetType,
  type ProjectConfig
} from '@shared/domain'
import {
  assetTypeToGraphScope,
  buildCanvasStarterGraph,
  createDefaultScopedGraph,
  defaultHostInterfaceForAssetType,
  ensureBoundaryProxyNodes,
  HOST_INTERFACE_SCHEMA_VERSION,
  isAssetRefInputHostType,
  resolveAssetProcessingTypeId,
  resolveInputLinkHeadTypeIds,
  sanitizeHostInterface,
  type GraphDocument
} from '@shared/graph'
import type {
  AttachAssetFileInput,
  AttachAssetRelativeInput,
  CreateAssetInput,
  CreateFolderInput,
  CreateProjectInput,
  OpenProjectResult,
  SaveGraphRunMediaInput,
  SaveGraphRunTextInput,
  WriteAssetTextInput
} from '@shared/ipc'
import { renameReplaceSync } from '../persistence/atomicRename'
import { fail, defErr, defErrSimple } from '@shared/errors/appError'
import { MAIN_ERRORS } from '../errors/messages'
import { settingsService } from './settingsService'
import { autosaveRepository } from '../repositories/autosaveRepository'
import { assetRepository } from '../repositories/assetRepository'
import { projectRepository } from '../repositories/projectRepository'
import { folderRepository } from '../repositories/folderRepository'
import { collectFolderSubtreeIds } from '@shared/folderTree'
import {
  findAssetReferencesInProject,
  type FindAssetReferencesResult
} from '@shared/assetReferences'
import {
  ASSET_META_SUFFIX,
  FOLDER_META_NAME,
  PROJECT_ASSET_LAYOUT_VERSION,
  mediaNameFromMetaFileName,
  metaFileNameForMedia,
  toPosix
} from '@shared/assetStorage/layout'
import { readJsonFile, writeJsonAtomic } from '../repositories/jsonFile'
import { normalizePathSegment } from '@shared/assetPackage/pathname'
import { dialogService } from './dialogService'
import { copyFileAtomic, removeIfExists } from '../persistence/binaryStore'
import { runTransactionSync } from '../persistence/transactionRunner'
import {
  ensureAssetRelativeFolderChain,
  moveAssetBetweenFolders,
  repairAssetFolderMetas,
  resolveFolderDirAbs,
  scanAssetTree,
  uniqueFileName
} from '../repositories/assetTreeStore'

import {
  detectImportAssetType,
  isAttachCompatible,
  isAudioFilePath,
  isImageFilePath,
  isImportablePath,
  isModelFilePath,
  isTextFilePath,
  isVideoFilePath
} from '@shared/import'
import {
  peekExistingImageThumbnail,
  plannedThumbnailPath,
  removeImageAndThumbnail,
  scheduleEnsureThumbnail,
  warnThumbnailOnce
} from './thumbnailService'
import { isRealThumbnailPath } from '@shared/media/thumbnailPath'
import { resolveMediaBytesFromUrl } from './resolveMediaBytesFromUrl'
import { copyFilePathsToClipboard } from './clipboardFileCopy'

function nowIso(): string {
  return new Date().toISOString()
}

// ── 本服务个性错误（双语条目；跨服务共性条目见 errors/messages.ts）──
const E_PROJECT_EMPTY_NAME = defErrSimple(
  'project.emptyName',
  '工程名不能为空',
  'Project name cannot be empty'
)
const E_PROJECT_TARGET_DIR_EXISTS = defErrSimple(
  'project.targetDirExists',
  '目标目录已存在',
  'The target directory already exists'
)
const E_PROJECT_INVALID_FILE = defErrSimple(
  'project.invalidFile',
  '无效的工程文件',
  'Invalid project file'
)
/** expected 为 assetTypeLabel 输出，已按设置语言本地化 */
const E_PROJECT_ASSET_TYPE_MISMATCH = defErr<{ expected: string }>(
  'project.assetTypeMismatch',
  ({ expected }) => `文件类型与资产类型不匹配（需要 ${expected}）`,
  ({ expected }) => `File type does not match asset type (expects ${expected})`
)
const E_PROJECT_POSE_NO_REIMPORT_MEDIA = defErrSimple(
  'project.poseNoReimportableMedia',
  '姿势资产没有可重新导入的媒体文件',
  'Pose assets have no media file to reimport'
)
const E_PROJECT_NO_REIMPORT_MEDIA = defErrSimple(
  'project.noReimportableMedia',
  '没有可重新导入的媒体文件',
  'No media file available for reimport'
)
const E_ASSET_FILE_MISSING = defErrSimple('asset.fileMissing', '文件不存在', 'File not found')
const E_TEXT_WRITEBACK_SCREENPLAY_ONLY = defErrSimple(
  'project.textWritebackScreenplayOnly',
  '仅剧本资产支持文本写回',
  'Only screenplay assets support text write-back'
)
const E_SCREENPLAY_NO_SIDECAR_TEXT = defErrSimple(
  'project.screenplayNoSidecarText',
  '该剧本没有旁挂文本文件',
  'This screenplay has no sidecar text file'
)
const E_SIDECAR_NOT_EDITABLE_TEXT = defErrSimple(
  'project.sidecarNotEditableText',
  '旁挂文件不是可编辑的文本类型',
  'The sidecar file is not an editable text type'
)
const E_ASSET_FILE_MISSING_ON_DISK = defErrSimple(
  'project.assetFileMissingOnDisk',
  '磁盘上找不到该资产文件',
  'Asset file not found on disk'
)
const E_FOLDER_MISSING_ON_DISK = defErrSimple(
  'project.folderMissingOnDisk',
  '磁盘上找不到该目录',
  'Folder not found on disk'
)
const E_SHELL_OPEN_FOLDER_FAILED = defErr<{ detail: string }>(
  'fs.shellOpenFolderFailed',
  ({ detail }) => `打开文件夹失败: ${detail}`,
  ({ detail }) => `Failed to open folder: ${detail}`
)
const E_NO_ASSETS_SELECTED = defErrSimple(
  'project.noAssetsSelected',
  '未选择资产',
  'No assets selected'
)
const E_NO_ORIGINAL_FILES_TO_COPY = defErrSimple(
  'project.noOriginalFilesToCopy',
  '没有可复制的原始资产文件',
  'No original asset files to copy'
)
const E_META_WRITE_FAILED = defErr<{ name: string }>(
  'project.metaWriteFailed',
  ({ name }) => `资产元数据写入失败: ${name}`,
  ({ name }) => `Failed to write asset metadata: ${name}`
)

/** 可宿主资产：写入 hostInterface + schemaVersion，并为内图确保 boundary proxy */
function finalizeHostableAssetGenParams(
  type: AssetType,
  genParams: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!isAssetRefInputHostType(type)) return genParams
  const base = { ...(genParams ?? {}) }
  const rawIface = base.hostInterface
  let iface = sanitizeHostInterface(rawIface)
  if (!iface.inputs.length && !iface.outputs.length) {
    iface = defaultHostInterfaceForAssetType(type)
  }
  const graphJson = base.graphJson
  if (graphJson && typeof graphJson === 'object' && Array.isArray((graphJson as GraphDocument).nodes)) {
    const scope = assetTypeToGraphScope(type)
    base.graphJson = ensureBoundaryProxyNodes(graphJson as GraphDocument, iface, {
      autoLinkHeadTypeIds: resolveInputLinkHeadTypeIds(
        scope,
        type,
        resolveAssetProcessingTypeId(scope, type)
      )
    })
  }
  base.hostInterface = iface
  if (typeof base.schemaVersion !== 'number' || !Number.isFinite(base.schemaVersion)) {
    base.schemaVersion = HOST_INTERFACE_SCHEMA_VERSION
  }
  return base
}

function assertInsideProject(root: string, target: string): string {
  const resolvedRoot = resolve(root) + sep
  const resolvedTarget = resolve(target)
  if (!resolvedTarget.startsWith(resolvedRoot) && resolvedTarget !== resolve(root)) {
    throw fail(MAIN_ERRORS.pathOutsideProject)
  }
  return resolvedTarget
}

function detectAssetType(filePath: string): AssetType {
  return detectImportAssetType(filePath)
}

class ProjectService {
  private rootPath: string | null = null
  private config: ProjectConfig | null = null

  getRoot(): string {
    if (!this.rootPath) throw fail(MAIN_ERRORS.noProject)
    return this.rootPath
  }

  getConfig(): ProjectConfig {
    if (!this.config) throw fail(MAIN_ERRORS.noProject)
    return this.config
  }

  isOpen(): boolean {
    return !!this.rootPath && !!this.config
  }

  async selectDirectory(): Promise<string | null> {
    return dialogService.selectDirectory()
  }

  async selectProject(): Promise<string | null> {
    return dialogService.selectProject()
  }

  async selectFiles(
    filters?: { name: string; extensions: string[] }[]
  ): Promise<string[]> {
    return dialogService.selectFiles(filters)
  }

  createProject(input: CreateProjectInput): OpenProjectResult {
    const safeName = input.name.trim().replace(/[<>:"/\\|?*]/g, '_')
    if (!safeName) throw fail(E_PROJECT_EMPTY_NAME)

    const root = join(input.parentDir, safeName)
    if (existsSync(root)) throw fail(E_PROJECT_TARGET_DIR_EXISTS)

    projectRepository.ensureScaffold(root)

    const ts = nowIso()
    const config: ProjectConfig = {
      id: randomUUID(),
      name: safeName,
      version: PROJECT_ASSET_LAYOUT_VERSION,
      resolution: { ...DEFAULT_RESOLUTION },
      fps: 24,
      createdAt: ts,
      updatedAt: ts
    }

    projectRepository.write(root, config)

    this.rootPath = root
    this.config = config

    // 新工程默认创建自由画布
    this.createAsset({
      type: 'canvas',
      name: defaultAssetName('canvas', settingsService.get().language),
      genParams: { canvasKind: 'free', graphJson: buildCanvasStarterGraph() }
    })

    const projectJson = join(root, 'project.json')
    settingsService.addRecent(projectJson)

    return {
      rootPath: root,
      config: this.getConfig(),
      assets: this.listAssets(),
      folders: []
    }
  }

  openProject(projectJsonPath: string): OpenProjectResult {
    const abs = resolve(projectJsonPath)
    if (!existsSync(abs) || basename(abs) !== 'project.json') {
      throw fail(E_PROJECT_INVALID_FILE)
    }
    const root = dirname(abs)
    const config = projectRepository.read(root)
    this.rootPath = root
    this.config = config
    settingsService.addRecent(abs)

    const assets = this.listAssets()
    this.scheduleMissingThumbnails(assets)

    return {
      rootPath: root,
      config: this.config,
      assets,
      folders: this.listFolders()
    }
  }

  closeProject(): void {
    this.rootPath = null
    this.config = null
  }

  /** 供独立窗口读取当前已打开工程，不重复走 open 流程。 */
  getOpenProjectState(): OpenProjectResult | null {
    if (!this.rootPath || !this.config) return null
    return {
      rootPath: this.rootPath,
      config: this.config,
      assets: this.listAssets(),
      folders: this.listFolders()
    }
  }

  saveConfig(config: ProjectConfig): void {
    const root = this.getRoot()
    config.updatedAt = nowIso()
    this.config = config
    projectRepository.write(root, config)
  }

  // ---- Assets ----

  listAssets(): AssetInfo[] {
    return assetRepository.list(this.getRoot())
  }

  importAssets(
    filePaths: string[],
    folderId: string | null = null
  ): { imported: AssetInfo[]; skipped: { path: string; reason: string }[] } {
    const imported: AssetInfo[] = []
    const skipped: { path: string; reason: string }[] = []
    if (folderId) this.readFolder(folderId)

    for (const src of filePaths) {
      try {
        imported.push(this.importOneMediaFile(src, folderId))
      } catch (err) {
        skipped.push({
          path: src,
          reason: err instanceof Error ? err.message : String(err)
        })
      }
    }

    return { imported, skipped }
  }

  private importOneMediaFile(src: string, folderId: string | null): AssetInfo {
    const root = this.getRoot()
    if (folderId) this.readFolder(folderId)
    const dirAbs = resolveFolderDirAbs(root, folderId)
    const type = detectAssetType(src)
    const id = randomUUID()
    const ext = extname(src).toLowerCase()
    const base = normalizePathSegment(basename(src, ext) || type)
    const fileName = uniqueFileName(dirAbs, `${base}${ext}`)
    const dest = join(dirAbs, fileName)
    const ts = nowIso()
    const relativePath = toPosix(relative(root, dest))
    const asset: AssetInfo = {
      id,
      type,
      name: basename(src, ext),
      relativePath,
      folderId,
      version: 1,
      createdAt: ts,
      updatedAt: ts
    }

    if (type === 'image' || type === 'video') {
      asset.thumbnailPath = this.planAndScheduleImageThumbnail(asset.relativePath)
    }
    // 图/声/视/剧本文件导入：引用资产，不提供节点图编辑器
    if (isImportableFileRefAssetType(type)) {
      asset.genParams = withImportedMediaRefParams()
    }

    runTransactionSync([
      {
        label: 'copy imported media',
        forward: () => copyFileAtomic(src, dest),
        rollback: () => removeIfExists(dest)
      },
      {
        label: 'write asset metadata',
        forward: () => assetRepository.write(root, asset),
        rollback: () => assetRepository.removeMetadata(root, asset.id)
      }
    ])
    return asset
  }

  createAsset(input: CreateAssetInput): AssetInfo {
    const folderId = input.folderId ?? null
    if (folderId) this.readFolder(folderId)

    const id = randomUUID()
    const ts = nowIso()
    const baseName = input.name?.trim() || defaultAssetName(input.type, settingsService.get().language)
    const siblingNames = this.listAssets()
      .filter((a) => (a.folderId ?? null) === folderId)
      .map((a) => a.name)
    const asset: AssetInfo = {
      id,
      type: input.type,
      name: resolveUniqueAssetName(baseName, siblingNames),
      relativePath: '',
      folderId,
      prompt: input.prompt?.trim() ?? '',
      notes: input.notes?.trim() ?? '',
      version: 1,
      createdAt: ts,
      updatedAt: ts
    }
    if (input.genParams && typeof input.genParams === 'object') {
      asset.genParams = { ...input.genParams }
    }
    if (input.type === 'canvas') {
      if (!asset.genParams?.graphJson) {
        asset.genParams = {
          ...(asset.genParams ?? {}),
          graphJson: createDefaultScopedGraph('canvasAsset', 'canvas')
        }
      }
      // 未显式标记时：空白 createAsset 视为自由画布；剧集起步会写入 canvasKind: 'series'
      const kind = asset.genParams?.canvasKind
      if (kind !== 'free' && kind !== 'series') {
        asset.genParams = { ...(asset.genParams ?? {}), canvasKind: 'free' }
      }
    }
    if (input.type === 'world' && !asset.genParams?.graphJson) {
      asset.genParams = {
        ...(asset.genParams ?? {}),
        graphJson: createDefaultScopedGraph('worldAsset', 'world')
      }
    }
    if (input.type === 'beat' && !asset.genParams?.graphJson) {
      asset.genParams = {
        ...(asset.genParams ?? {}),
        graphJson: createDefaultScopedGraph('beatAsset', 'beat')
      }
    }
    if (input.type === 'subgraph' && !asset.genParams?.graphJson) {
      asset.genParams = {
        ...(asset.genParams ?? {}),
        graphJson: createDefaultScopedGraph('subgraphAsset', 'subgraph')
      }
    }
    if (input.type === 'motion' && !asset.genParams?.stage) {
      asset.genParams = { ...(asset.genParams ?? {}), stage: createDefaultDirectorStage() }
    }
    // 新建图/视/声/剧本：默认「生成节点 → 输出节点」（导入引用文件不走此处）
    if (!asset.genParams?.graphJson) {
      if (input.type === 'image' || input.type === 'video' || input.type === 'voice') {
        asset.genParams = {
          ...(asset.genParams ?? {}),
          graphJson: createDefaultScopedGraph('workflow', input.type)
        }
      } else if (input.type === 'screenplay') {
        asset.genParams = {
          ...(asset.genParams ?? {}),
          graphJson: createDefaultScopedGraph('screenplayAsset', 'screenplay')
        }
      }
    }
    // 可宿主类型统一 HDA：hostInterface + boundary 内图
    if (isAssetRefInputHostType(input.type)) {
      asset.genParams = finalizeHostableAssetGenParams(input.type, asset.genParams)
    }
    this.writeAsset(asset)
    return asset
  }

  deleteAsset(assetId: string): void {
    const root = this.getRoot()
    autosaveRepository.discard(root, { kind: 'asset', id: assetId })
    assetRepository.removeMetadata(root, assetId)
  }

  findAssetReferences(assetIds: string[]): FindAssetReferencesResult {
    return findAssetReferencesInProject(assetIds, this.listAssets())
  }

  renameAsset(assetId: string, name: string): AssetInfo {
    const asset = this.readAsset(assetId)
    asset.name = name.trim() || asset.name
    asset.updatedAt = nowIso()
    this.writeAsset(asset)
    return asset
  }

  updateAsset(asset: AssetInfo): AssetInfo {
    const root = this.getRoot()
    const previous = this.readAsset(asset.id)
    const prevFolder = previous.folderId ?? null
    const nextFolder = asset.folderId ?? null
    let next = { ...asset, updatedAt: nowIso() }
    if (prevFolder !== nextFolder) {
      next = moveAssetBetweenFolders(root, next, nextFolder)
    } else {
      this.writeAsset(next)
    }
    autosaveRepository.discard(root, { kind: 'asset', id: asset.id })
    return next
  }

  attachAssetFile(input: AttachAssetFileInput): AssetInfo {
    const asset = this.readAsset(input.assetId)
    const root = this.getRoot()
    const detected = detectAssetType(input.filePath)

    if (!isAttachCompatible(asset.type, detected, input.filePath)) {
      throw fail(E_PROJECT_ASSET_TYPE_MISMATCH, {
        expected: assetTypeLabel(asset.type, settingsService.get().language)
      })
    }

    const previous = { ...asset, genParams: asset.genParams ? { ...asset.genParams } : undefined }
    const oldAbs = asset.relativePath
      ? assertInsideProject(root, join(root, asset.relativePath))
      : null
    const dirAbs = resolveFolderDirAbs(root, asset.folderId ?? null)
    const ext = extname(input.filePath).toLowerCase()
    const desired = `${normalizePathSegment(asset.name)}${ext}`
    const fileName = uniqueFileName(dirAbs, desired)
    const destination = join(dirAbs, fileName)
    const backup =
      oldAbs && oldAbs === destination && existsSync(oldAbs)
        ? `${oldAbs}.${process.pid}.backup`
        : null
    if (backup && oldAbs) copyFileSync(oldAbs, backup)
    asset.relativePath = toPosix(relative(root, destination))
    if (detected === 'image' || detected === 'video') {
      asset.thumbnailPath = this.planAndScheduleImageThumbnail(asset.relativePath)
    }
    asset.updatedAt = nowIso()
    try {
      runTransactionSync([
        {
          label: 'replace asset media',
          forward: () => copyFileAtomic(input.filePath, destination),
          rollback: () => {
            if (backup) copyFileAtomic(backup, destination)
            else if (destination !== oldAbs) removeIfExists(destination)
          }
        },
        {
          label: 'update asset metadata',
          forward: () => this.writeAsset(asset),
          rollback: () => this.writeAsset(previous)
        }
      ])
    } finally {
      if (backup) removeIfExists(backup)
    }
    if (oldAbs && oldAbs !== destination) removeIfExists(oldAbs)
    return asset
  }

  /**
   * 重新导入：刷新媒体路径/缩略图，并自动修复范围内
   * 缺失/损坏的 `.folder.json` 与媒体旁挂 `.asset.json`（类似 Unity Reimport）。
   */
  reimportAssets(
    assetIds: string[],
    options?: { folderId?: string | null }
  ): {
    reimported: AssetInfo[]
    skipped: { id: string; name: string; reason: string }[]
    folders: AssetFolder[]
  } {
    const root = this.getRoot()
    // 先修目录元数据，再扫树，避免孤儿/损坏目录被跳过
    let repairRel = 'Assets'
    if (options?.folderId) {
      const prelim = scanAssetTree(root)
      const dirAbs = prelim.dirAbsByFolderId.get(options.folderId)
      if (dirAbs) repairRel = toPosix(relative(root, dirAbs))
    }
    repairAssetFolderMetas(root, repairRel)

    // 为无旁挂元数据的媒体文件补登记 `.asset.json`
    const adopted = this.repairOrphanMediaMetas(root, repairRel)

    const scan = scanAssetTree(root)
    const reimported: AssetInfo[] = [...adopted]
    const skipped: { id: string; name: string; reason: string }[] = []
    const seen = new Set<string>(adopted.map((item) => item.id))

    for (const assetId of assetIds) {
      if (!assetId || seen.has(assetId)) continue
      seen.add(assetId)
      const asset = scan.assets.find((item) => item.id === assetId)
      if (!asset) {
        skipped.push({ id: assetId, name: assetId, reason: fail(MAIN_ERRORS.assetNotFound).message })
        continue
      }
      try {
        reimported.push(this.reimportOneAsset(root, scan, asset))
      } catch (err) {
        skipped.push({
          id: asset.id,
          name: asset.name,
          reason: err instanceof Error ? err.message : String(err)
        })
      }
    }

    return {
      reimported,
      skipped,
      folders: folderRepository.list(root) ?? []
    }
  }

  /**
   * 扫描目录树：为缺少（或损坏）旁挂 `.asset.json` 的图/视/音/模型文件补写元数据。
   */
  private repairOrphanMediaMetas(root: string, relativeDir: string): AssetInfo[] {
    const posix = normalizeProjectRelativeDir(relativeDir) || 'Assets'
    if (posix !== 'Assets' && !posix.startsWith('Assets/')) return []
    const startAbs = join(root, ...posix.split('/'))
    if (!existsSync(startAbs)) return []

    const scan = scanAssetTree(root)
    const claimedByRel = new Map<string, AssetInfo>()
    for (const asset of scan.assets) {
      const rel = asset.relativePath?.replace(/\\/g, '/').trim()
      if (rel) claimedByRel.set(rel, asset)
    }

    const adopted: AssetInfo[] = []
    const walk = (dirAbs: string): void => {
      let entries: string[]
      try {
        entries = readdirSync(dirAbs)
      } catch {
        return
      }
      for (const name of entries) {
        if (name === FOLDER_META_NAME || name.startsWith('.')) continue
        if (name.endsWith(ASSET_META_SUFFIX)) continue
        const abs = join(dirAbs, name)
        let st
        try {
          st = statSync(abs)
        } catch {
          continue
        }
        if (st.isDirectory()) {
          walk(abs)
          continue
        }
        if (!st.isFile() || !isImportablePath(abs)) continue

        const metaAbs = join(dirAbs, metaFileNameForMedia(name))
        if (existsSync(metaAbs)) {
          try {
            readJsonFile(metaAbs)
            continue
          } catch {
            try {
              rmSync(metaAbs)
            } catch {
              /* ignore */
            }
          }
        }

        const relativePath = toPosix(relative(root, abs))
        const existing = claimedByRel.get(relativePath)
        try {
          if (existing) {
            const refreshed = this.reimportOneAsset(root, scan, existing)
            adopted.push(refreshed)
            claimedByRel.set(relativePath, refreshed)
          } else {
            const type = detectAssetType(abs)
            const registered = this.registerExistingMediaAsAsset({
              relativePath,
              type,
              name: basename(abs, extname(abs)) || name
            })
            adopted.push(registered)
            claimedByRel.set(relativePath, registered)
          }
        } catch (err) {
          console.warn('[reimport] repair media meta failed', relativePath, err)
        }
      }
    }

    walk(startAbs)
    return adopted
  }

  private reimportOneAsset(
    root: string,
    scan: ReturnType<typeof scanAssetTree>,
    asset: AssetInfo
  ): AssetInfo {
    if (isPoseModelAsset(asset)) {
      throw fail(E_PROJECT_POSE_NO_REIMPORT_MEDIA)
    }

    const metaAbs = scan.metaAbsByAssetId.get(asset.id)
    let mediaAbs: string | null = null
    if (metaAbs) {
      const mediaLeaf = mediaNameFromMetaFileName(basename(metaAbs))
      if (mediaLeaf) {
        const companion = join(dirname(metaAbs), mediaLeaf)
        if (existsSync(companion)) mediaAbs = companion
      }
    }
    if (!mediaAbs && asset.relativePath) {
      const claimed = assertInsideProject(root, join(root, asset.relativePath))
      if (existsSync(claimed)) mediaAbs = claimed
    }
    if (!mediaAbs) {
      throw fail(E_PROJECT_NO_REIMPORT_MEDIA)
    }

    const relativePath = toPosix(relative(root, mediaAbs))
    const next: AssetInfo = {
      ...asset,
      relativePath,
      folderId: this.folderIdForDirAbs(root, dirname(mediaAbs)) ?? asset.folderId ?? null,
      updatedAt: nowIso()
    }
    if (next.type === 'image' || next.type === 'video') {
      next.thumbnailPath = this.planAndScheduleImageThumbnail(relativePath)
    }
    // 强制重写旁挂，修复缺失/损坏的 `.asset.json`
    const sidecarAbs = join(dirname(mediaAbs), metaFileNameForMedia(basename(mediaAbs)))
    writeJsonAtomic(sidecarAbs, next)
    assetRepository.write(root, next)
    return next
  }

  getAssetFileUrl(relativePath: string): string {
    const root = this.getRoot()
    const abs = assertInsideProject(root, join(root, relativePath))
    if (!existsSync(abs)) throw fail(E_ASSET_FILE_MISSING)

    const mtime = statSync(abs).mtimeMs
    // 图/音/视/文本统一走 studio-media，避免 base64 撑爆内存，并支持 fetch
    if (
      isImageFilePath(abs) ||
      isAudioFilePath(abs) ||
      isVideoFilePath(abs) ||
      isModelFilePath(abs) ||
      isTextFilePath(abs)
    ) {
      return `studio-media://local/?path=${encodeURIComponent(abs)}&t=${mtime}`
    }

    return pathToFileURL(abs).href
  }

  /** 将记事本正文写回剧本旁挂 txt/md，并刷新资产 updatedAt */
  writeAssetText(input: WriteAssetTextInput): AssetInfo {
    const asset = this.readAsset(input.assetId)
    if (!isScreenplayAsset(asset.type)) {
      throw fail(E_TEXT_WRITEBACK_SCREENPLAY_ONLY)
    }
    const relativePath = asset.relativePath?.trim()
    if (!relativePath) {
      throw fail(E_SCREENPLAY_NO_SIDECAR_TEXT)
    }
    if (!isTextFilePath(relativePath)) {
      throw fail(E_SIDECAR_NOT_EDITABLE_TEXT)
    }
    const root = this.getRoot()
    const abs = assertInsideProject(root, join(root, relativePath))
    const temporary = `${abs}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
    writeFileSync(temporary, input.content ?? '', 'utf-8')
    try {
      renameReplaceSync(temporary, abs)
    } catch (error) {
      try {
        rmSync(temporary, { force: true })
      } catch {
        /* ignore */
      }
      throw error
    }
    const next: AssetInfo = { ...asset, updatedAt: nowIso() }
    this.writeAsset(next)
    return next
  }

  /**
   * 预览级 URL：
   * - 图片：缩略图已就绪则返回 thumb，否则立刻返回原图并后台生成；
   * - 视频：缩略图已就绪则返回首帧 PNG；否则等待系统提取首帧后再返回（无法用视频 URL 作 img）。
   * - 源文件缺失时返回空串（预览场景常见，避免 IPC 刷错）。
   */
  async getAssetPreviewUrl(relativePath: string): Promise<string> {
    const root = this.getRoot()
    const abs = assertInsideProject(root, join(root, relativePath))
    if (!existsSync(abs)) return ''
    const posix = relativePath.replace(/\\/g, '/')
    if (posix.startsWith('.aiartengine/thumbs/')) {
      return this.getAssetFileUrl(posix)
    }

    if (isVideoFilePath(abs)) {
      const existing = peekExistingImageThumbnail(root, posix)
      if (existing) return this.getAssetFileUrl(existing)
      try {
        const thumbRel = await scheduleEnsureThumbnail(root, posix)
        return this.getAssetFileUrl(thumbRel)
      } catch (err) {
        warnThumbnailOnce(posix, err)
        throw err instanceof Error ? err : new Error(String(err))
      }
    }

    if (!isImageFilePath(abs)) {
      return this.getAssetFileUrl(relativePath)
    }
    const existing = peekExistingImageThumbnail(root, posix)
    if (existing) return this.getAssetFileUrl(existing)
    void scheduleEnsureThumbnail(root, posix).catch((err) => {
      warnThumbnailOnce(posix, err)
    })
    return this.getAssetFileUrl(relativePath)
  }

  /** 导入/挂载后规划并异步生成缩略图，返回应写入资产的 thumbnailPath */
  planAndScheduleImageThumbnail(relativePath: string): string {
    const root = this.getRoot()
    const planned = plannedThumbnailPath(relativePath)
    void scheduleEnsureThumbnail(root, relativePath).catch((err) => {
      console.warn('[thumbnail] async generate failed', relativePath, err)
    })
    return planned
  }

  /** 打开工程后为缺真缩略图的图片 / 视频资产排队生成 */
  scheduleMissingThumbnails(assets: AssetInfo[]): void {
    const root = this.getRoot()
    for (const asset of assets) {
      if (asset.type !== 'image' && asset.type !== 'video') continue
      const rel = asset.relativePath?.trim()
      if (!rel) continue
      if (isRealThumbnailPath(asset.thumbnailPath, rel)) {
        const thumbAbs = join(root, asset.thumbnailPath!)
        if (existsSync(thumbAbs)) continue
      }
      void scheduleEnsureThumbnail(root, rel)
        .then((thumbRel) => {
          if (asset.thumbnailPath === thumbRel) return
          try {
            const latest = this.readAsset(asset.id)
            if (
              (latest.type !== 'image' && latest.type !== 'video') ||
              latest.relativePath !== rel
            ) {
              return
            }
            if (isRealThumbnailPath(latest.thumbnailPath, rel)) {
              const abs = join(root, latest.thumbnailPath!)
              if (existsSync(abs)) return
            }
            latest.thumbnailPath = thumbRel
            latest.updatedAt = nowIso()
            this.writeAsset(latest)
          } catch {
            /* asset may be gone */
          }
        })
        .catch(() => {
          /* logged in schedule */
        })
    }
  }

  /** 在系统文件管理器中定位资产文件（优先媒体，否则旁挂 meta） */
  showAssetInFolder(assetId: string): void {
    const root = this.getRoot()
    const scan = scanAssetTree(root)
    const asset = scan.assets.find((item) => item.id === assetId)
    if (!asset) throw fail(MAIN_ERRORS.assetNotFound)

    let abs: string | null = null
    if (asset.relativePath) {
      const mediaAbs = assertInsideProject(root, join(root, asset.relativePath))
      if (existsSync(mediaAbs)) abs = mediaAbs
    }
    if (!abs) {
      const metaAbs = scan.metaAbsByAssetId.get(assetId)
      if (metaAbs && existsSync(metaAbs)) abs = metaAbs
    }
    if (!abs) throw fail(E_ASSET_FILE_MISSING_ON_DISK)
    shell.showItemInFolder(abs)
  }

  /** 在系统文件管理器中打开目录对应的真实磁盘文件夹 */
  async showFolderInFolder(folderId: string): Promise<void> {
    const root = this.getRoot()
    const dirAbs = resolveFolderDirAbs(root, folderId)
    if (!existsSync(dirAbs)) throw fail(E_FOLDER_MISSING_ON_DISK)
    const error = await shell.openPath(dirAbs)
    // shell.openPath 返回的是 OS 原生错误字符串，作为 detail 嵌入句式
    if (error) throw fail(E_SHELL_OPEN_FOLDER_FAILED, { detail: error })
  }

  /** 探测视频关键帧时间（秒）；无 ffprobe / 文件缺失时返回 null */
  async detectVideoKeyframes(relativePath: string): Promise<number[] | null> {
    const root = this.getRoot()
    if (!relativePath?.trim()) return null
    const abs = assertInsideProject(root, join(root, relativePath.trim()))
    if (!existsSync(abs)) return null
    return detectVideoKeyframes(abs)
  }

  /**
   * 将选中资产的原始媒体文件复制到系统剪贴板（非缩略图）。
   * 可粘贴到资源管理器等支持文件粘贴的目标。
   */
  async copyAssetOriginalFiles(assetIds: string[]): Promise<{ copied: number; mode: 'files' | 'text' }> {
    const ids = [...new Set(assetIds.map((id) => id?.trim()).filter(Boolean))]
    if (!ids.length) throw fail(E_NO_ASSETS_SELECTED)

    const root = this.getRoot()
    const scan = scanAssetTree(root)
    const absPaths: string[] = []
    for (const assetId of ids) {
      if (isDraftAssetId(assetId)) continue
      const asset = scan.assets.find((item) => item.id === assetId)
      if (!asset?.relativePath) continue
      const mediaAbs = assertInsideProject(root, join(root, asset.relativePath))
      if (existsSync(mediaAbs)) absPaths.push(mediaAbs)
    }
    if (!absPaths.length) throw fail(E_NO_ORIGINAL_FILES_TO_COPY)

    const mode = await copyFilePathsToClipboard(absPaths)
    return { copied: absPaths.length, mode }
  }

  // ---- Folders ----

  listFolders(): AssetFolder[] {
    return folderRepository.list(this.getRoot())
  }

  createFolder(input: CreateFolderInput): AssetFolder {
    const parentId = input.parentId ?? null
    if (parentId) this.readFolder(parentId)

    const id = randomUUID()
    const ts = nowIso()
    const folder: AssetFolder = {
      id,
      name: input.name?.trim() || 'New Folder',
      parentId,
      createdAt: ts,
      updatedAt: ts
    }
    folderRepository.create(this.getRoot(), folder)
    return folderRepository.read(this.getRoot(), id)
  }

  renameFolder(folderId: string, name: string): AssetFolder {
    return folderRepository.rename(this.getRoot(), folderId, name)
  }

  deleteFolder(folderId: string, options?: { mode?: 'hoist' | 'deleteContents' }): void {
    const root = this.getRoot()
    this.readFolder(folderId)
    const folders = this.listFolders()
    const subtreeIds = collectFolderSubtreeIds(folders, folderId)
    const mode = options?.mode ?? 'hoist'

    if (mode === 'deleteContents') {
      const subtree = new Set(subtreeIds)
      const assets = this.listAssets().filter(
        (asset) => asset.folderId != null && subtree.has(asset.folderId)
      )
      for (const asset of assets) {
        this.deleteAsset(asset.id)
      }
      folderRepository.removeRecursive(root, folderId)
      return
    }

    for (const id of subtreeIds) {
      folderRepository.remove(root, id)
    }
  }

  private readFolder(folderId: string): AssetFolder {
    return folderRepository.read(this.getRoot(), folderId)
  }

  private readAsset(assetId: string): AssetInfo {
    return assetRepository.read(this.getRoot(), assetId)
  }

  private writeAsset(asset: AssetInfo): void {
    assetRepository.write(this.getRoot(), asset)
  }

  /**
   * 将图执行产物写入指定输出目录（默认 `Cache/Images/`）。
   * 落在 Assets/ 下时登记旁挂 `.asset.json`；Cache/ 下仅写文件不进资产库。
   * `dataUrl` 可为 data: 或 http(s)（主进程下载，避免渲染进程 CORS）。
   */
  async saveGraphRunMedia(
    input: SaveGraphRunMediaInput
  ): Promise<{ relativePath: string; asset: AssetInfo | null }> {
    const root = this.getRoot()
    const { buf, mime } = await resolveMediaBytesFromUrl(input.dataUrl)

    let ext = '.bin'
    if (mime.includes('png')) ext = '.png'
    else if (mime.includes('jpeg') || mime.includes('jpg')) ext = '.jpg'
    else if (mime.includes('webp')) ext = '.webp'
    else if (mime.includes('gif')) ext = '.gif'
    else if (mime.includes('mp4')) ext = '.mp4'
    else if (mime.includes('webm')) ext = '.webm'
    else if (mime.includes('mpeg') || mime.includes('mp3')) ext = '.mp3'
    else if (mime.includes('wav')) ext = '.wav'
    else if (mime.includes('ogg')) ext = '.ogg'

    const safeStem = normalizePathSegment(input.key || 'generate')
    const cacheRoot = resolveCacheOutputRoot(this.config?.cacheOutputDir)
    const outDir =
      normalizeProjectRelativeDir(input.outputDir) ||
      `${cacheRoot}/${ASSET_IMAGE_OUTPUT_KIND_DIR}`
    const dirAbs = assertInsideProject(root, join(root, outDir))
    mkdirSync(dirAbs, { recursive: true })
    const underLibrary = isUnderAssetLibraryDir(outDir)
    const underCache = isUnderCacheOutputDir(outDir, this.config?.cacheOutputDir)
    if (underLibrary && !underCache) {
      ensureAssetRelativeFolderChain(root, outDir)
    }
    const fileName = uniqueFileName(dirAbs, `${safeStem}${ext}`)
    const relativePath = `${outDir}/${fileName}`.replace(/\\/g, '/')
    const abs = assertInsideProject(root, join(root, relativePath))
    writeFileSync(abs, buf)

    const assetType = assetTypeFromMime(mime)
    let asset: AssetInfo | null = null
    if (assetType && underLibrary && !underCache) {
      asset = this.registerExistingMediaAsAsset({
        relativePath,
        type: assetType,
        name: basename(fileName, ext) || safeStem
      })
    } else if (mime.startsWith('image/')) {
      void scheduleEnsureThumbnail(root, relativePath).catch((err) => {
        console.warn('[thumbnail] graph output thumb failed', relativePath, err)
      })
    }
    return { relativePath, asset }
  }

  /** 读取工程内相对路径文本文件；不存在返回 null */
  async readProjectFile(relativePath: string): Promise<string | null> {
    const root = this.getRoot()
    const clean = String(relativePath ?? '')
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
    if (!clean || clean.includes('..')) return null
    const abs = assertInsideProject(root, join(root, clean))
    if (!existsSync(abs)) return null
    return readFileSync(abs, 'utf-8')
  }

  /** 写入工程内相对路径文本文件；路径越界返回 false */
  async writeProjectFile(input: {
    relativePath: string
    content: string
  }): Promise<boolean> {
    try {
      const root = this.getRoot()
      const clean = String(input?.relativePath ?? '')
        .replace(/\\/g, '/')
        .replace(/^\/+/, '')
      if (!clean || clean.includes('..')) return false
      const abs = assertInsideProject(root, join(root, clean))
      mkdirSync(dirname(abs), { recursive: true })
      writeFileSync(abs, String(input?.content ?? ''), 'utf-8')
      return true
    } catch {
      return false
    }
  }

  /**
   * 将图执行剧本正文写入指定输出目录（默认 `Cache/Texts/`）。
   * Assets/ 下登记旁挂；Cache/ 下仅写文件。
   */
  async saveGraphRunText(
    input: SaveGraphRunTextInput
  ): Promise<{ relativePath: string; asset: AssetInfo | null }> {
    const root = this.getRoot()
    const content = input.content ?? ''
    const safeStem = normalizePathSegment(input.key || 'screenplay')
    const cacheRoot = resolveCacheOutputRoot(this.config?.cacheOutputDir)
    const outDir =
      normalizeProjectRelativeDir(input.outputDir) ||
      `${cacheRoot}/${ASSET_TEXT_OUTPUT_KIND_DIR}`
    const dirAbs = assertInsideProject(root, join(root, outDir))
    mkdirSync(dirAbs, { recursive: true })
    const underLibrary = isUnderAssetLibraryDir(outDir)
    const underCache = isUnderCacheOutputDir(outDir, this.config?.cacheOutputDir)
    if (underLibrary && !underCache) {
      ensureAssetRelativeFolderChain(root, outDir)
    }
    const fileName = uniqueFileName(dirAbs, `${safeStem}.txt`)
    const relativePath = `${outDir}/${fileName}`.replace(/\\/g, '/')
    const abs = assertInsideProject(root, join(root, relativePath))
    writeFileSync(abs, content, 'utf-8')

    let asset: AssetInfo | null = null
    if (underLibrary && !underCache) {
      asset = this.registerExistingMediaAsAsset({
        relativePath,
        type: 'screenplay',
        name: basename(fileName, '.txt') || safeStem,
        prompt: content.slice(0, 2000)
      })
    }
    return { relativePath, asset }
  }

  /** 为已落盘媒体写入旁挂 `.asset.json`（图产物 / 视频生成共用） */
  private registerExistingMediaAsAsset(params: {
    relativePath: string
    type: AssetType
    name: string
    prompt?: string
  }): AssetInfo {
    const root = this.getRoot()
    const abs = assertInsideProject(root, join(root, params.relativePath))
    if (!existsSync(abs)) throw fail(MAIN_ERRORS.fileNotFound)
    const dirAbs = dirname(abs)
    const relDir = toPosix(relative(root, dirAbs)) || 'Assets'
    if (relDir === 'Assets' || relDir.startsWith('Assets/')) {
      ensureAssetRelativeFolderChain(root, relDir)
    }
    const folderId = this.folderIdForDirAbs(root, dirAbs)
    const mediaName = basename(abs)
    const ts = nowIso()
    const asset: AssetInfo = {
      id: randomUUID(),
      type: params.type,
      name: params.name,
      relativePath: toPosix(params.relativePath),
      folderId,
      prompt: params.prompt,
      version: 1,
      createdAt: ts,
      updatedAt: ts
    }
    if (params.type === 'image' || params.type === 'video') {
      asset.thumbnailPath = this.planAndScheduleImageThumbnail(asset.relativePath)
    }
    if (isImportableFileRefAssetType(params.type)) {
      asset.genParams = withImportedMediaRefParams()
    }
    // 先直接写旁挂，保证视频等媒体即使 folderId 异常也有元数据
    const metaAbs = join(dirAbs, metaFileNameForMedia(mediaName))
    writeJsonAtomic(metaAbs, asset)
    try {
      assetRepository.write(root, asset)
    } catch (err) {
      console.warn('[asset] registerExistingMediaAsAsset writeAssetToTree failed; sidecar kept', metaAbs, err)
    }
    if (!existsSync(metaAbs)) {
      throw fail(E_META_WRITE_FAILED, { name: metaFileNameForMedia(mediaName) })
    }
    return asset
  }

  private folderIdForDirAbs(root: string, dirAbs: string): string | null {
    const scan = scanAssetTree(root)
    const destResolved = resolve(dirAbs)
    for (const [fid, abs] of scan.dirAbsByFolderId) {
      if (resolve(abs) === destResolved) return fid
    }
    return null
  }

  /**
   * 删除图执行产物（允许当前图片输出目录及默认历史目录），并同步清理缩略图 / 旁挂元数据。
   */
  deleteGraphRunMedia(relativePath: string): void {
    const root = this.getRoot()
    const posix = relativePath.replace(/\\/g, '/').trim()
    if (!posix) return
    // 允许工程内任意相对路径（防穿越由 assertInsideProject 保证）
    const abs = assertInsideProject(root, join(root, posix))
    removeImageAndThumbnail(root, posix)
    // 旁挂 .asset.json（图/视频/剧本生成共用）
    try {
      const sidecarAbs = join(dirname(abs), metaFileNameForMedia(basename(abs)))
      removeIfExists(sidecarAbs)
    } catch {
      /* ignore */
    }
  }

  /** 用工程内已有相对路径媒体挂到资产（图执行结果物化后写回宿主；不拷贝，避免落到资产同级） */
  attachAssetRelative(input: AttachAssetRelativeInput): AssetInfo {
    const root = this.getRoot()
    const asset = this.readAsset(input.assetId)
    const abs = assertInsideProject(root, join(root, input.relativePath))
    if (!existsSync(abs)) throw fail(MAIN_ERRORS.fileNotFound)
    const posix = toPosix(relative(root, abs))
    asset.relativePath = posix
    if (asset.type === 'image' || asset.type === 'canvas') {
      asset.thumbnailPath = this.planAndScheduleImageThumbnail(posix)
    }
    asset.updatedAt = nowIso()
    this.writeAsset(asset)
    autosaveRepository.discard(root, { kind: 'asset', id: asset.id })
    return asset
  }

  /**
   * 将外部生成的文件写入工程：默认视频/语音 → Cache/{Videos|Voices}，其它 → Assets/。
   * Cache/ 下只落盘、返回内存 AssetInfo（不写 `.asset.json`）；Assets/ 下登记进库。
   */
  attachExternalGeneratedFile(params: {
    type: AssetType
    sourceFilePath: string
    name: string
    prompt?: string
    /** 主落盘目录（相对工程根） */
    outputDir?: string
  }): AssetInfo {
    const root = this.getRoot()
    const ext = extname(params.sourceFilePath) || (params.type === 'video' ? '.mp4' : '.png')
    const explicitDir = normalizeProjectRelativeDir(params.outputDir)
    const cacheRoot = this.config?.cacheOutputDir
    const destDirRel =
      explicitDir ||
      (params.type === 'video'
        ? resolveMediaOutputDir({ cacheOutputDir: cacheRoot, kind: 'video' })
        : params.type === 'voice'
          ? resolveMediaOutputDir({ cacheOutputDir: cacheRoot, kind: 'voice' })
          : params.type === 'model'
            ? resolveMediaOutputDir({ cacheOutputDir: cacheRoot, kind: 'model' })
            : 'Assets')
    const dirAbs = assertInsideProject(root, join(root, destDirRel))
    mkdirSync(dirAbs, { recursive: true })
    const underLibrary = isUnderAssetLibraryDir(destDirRel)
    const underCache = isUnderCacheOutputDir(destDirRel, cacheRoot)
    if (underLibrary && !underCache) {
      ensureAssetRelativeFolderChain(root, destDirRel)
    }

    const fileName = uniqueFileName(
      dirAbs,
      `${normalizePathSegment(params.name)}${ext}`
    )
    const destAbs = join(dirAbs, fileName)
    copyFileSync(params.sourceFilePath, destAbs)
    const relativePath = toPosix(relative(root, destAbs))
    if (underCache) {
      const ts = nowIso()
      return {
        id: randomUUID(),
        type: params.type,
        name: params.name,
        relativePath,
        folderId: null,
        prompt: params.prompt,
        version: 1,
        createdAt: ts,
        updatedAt: ts
      }
    }
    return this.registerExistingMediaAsAsset({
      relativePath,
      type: params.type,
      name: params.name,
      prompt: params.prompt
    })
  }

  getDefaultProjectParent(): string {
    const settings = settingsService.get()
    if (settings.defaultProjectPath && existsSync(settings.defaultProjectPath)) {
      return settings.defaultProjectPath
    }
    return app.getPath('documents')
  }
}

function assetTypeFromMime(mime: string): AssetType | null {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'voice'
  return null
}

export const projectService = new ProjectService()
