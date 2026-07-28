import { app, shell } from 'electron'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'fs'
import { basename, dirname, extname, join, relative, resolve, sep } from 'path'
import { pathToFileURL } from 'url'
import { randomBytes, randomUUID } from 'crypto'
import {
  DEFAULT_RESOLUTION,
  ASSET_IMAGE_OUTPUT_KIND_DIR,
  ASSET_TEXT_OUTPUT_KIND_DIR,
  createEmptyShot,
  createDefaultDirectorStage,
  assetTypeLabel,
  defaultAssetName,
  isImportableFileRefAssetType,
  isPoseModelAsset,
  isScreenplayAsset,
  normalizeProjectRelativeDir,
  resolveUniqueAssetName,
  resolveMediaOutputDir,
  withImportedMediaRefParams,
  isDraftAssetId,
  type AssetFolder,
  type AssetInfo,
  type AssetType,
  type ProjectConfig,
  type Shot
} from '@shared/domain'
import { createDefaultScopedGraph, buildSeriesStarterGraph } from '@shared/graph'
import type {
  AttachAssetFileInput,
  AttachAssetRelativeInput,
  CreateAssetInput,
  CreateFolderInput,
  CreateProjectInput,
  CreateSeriesWithStarterInput,
  CreateShotInput,
  OpenProjectResult,
  SaveGraphRunMediaInput,
  SaveGraphRunTextInput,
  SyncScriptShotsInput,
  WriteAssetTextInput
} from '@shared/ipc'
import { renameReplaceSync } from '../persistence/atomicRename'
import { settingsService } from './settingsService'
import { autosaveRepository } from '../repositories/autosaveRepository'
import { shotRepository } from '../repositories/shotRepository'
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

function assertInsideProject(root: string, target: string): string {
  const resolvedRoot = resolve(root) + sep
  const resolvedTarget = resolve(target)
  if (!resolvedTarget.startsWith(resolvedRoot) && resolvedTarget !== resolve(root)) {
    throw new Error('路径越界：操作必须在工程目录内')
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
    if (!this.rootPath) throw new Error('未打开工程')
    return this.rootPath
  }

  getConfig(): ProjectConfig {
    if (!this.config) throw new Error('未打开工程')
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
    if (!safeName) throw new Error('工程名不能为空')

    const root = join(input.parentDir, safeName)
    if (existsSync(root)) throw new Error('目标目录已存在')

    projectRepository.ensureScaffold(root)

    const ts = nowIso()
    const config: ProjectConfig = {
      id: randomUUID(),
      name: safeName,
      version: PROJECT_ASSET_LAYOUT_VERSION,
      resolution: { ...DEFAULT_RESOLUTION },
      fps: 24,
      createdAt: ts,
      updatedAt: ts,
      shotIds: []
    }

    projectRepository.write(root, config)

    this.rootPath = root
    this.config = config

    this.createSeriesWithStarter({ name: defaultAssetName('canvas', settingsService.get().language) })

    const projectJson = join(root, 'project.json')
    settingsService.addRecent(projectJson)

    return {
      rootPath: root,
      config: this.getConfig(),
      assets: this.listAssets(),
      folders: [],
      shots: this.listShots()
    }
  }

  openProject(projectJsonPath: string): OpenProjectResult {
    const abs = resolve(projectJsonPath)
    if (!existsSync(abs) || basename(abs) !== 'project.json') {
      throw new Error('无效的工程文件')
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
      folders: this.listFolders(),
      shots: this.listShots()
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
      folders: this.listFolders(),
      shots: this.listShots()
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
    } else if (input.type === 'script') {
      asset.genParams = {
        shotIds: [],
        graphJson: createDefaultScopedGraph('scriptAsset', 'script')
      }
    }
    if (input.type === 'canvas' && !asset.genParams?.graphJson) {
      asset.genParams = {
        ...(asset.genParams ?? {}),
        graphJson: createDefaultScopedGraph('canvasAsset', 'canvas')
      }
    }
    if (input.type === 'world' && !asset.genParams?.graphJson) {
      asset.genParams = {
        ...(asset.genParams ?? {}),
        graphJson: createDefaultScopedGraph('worldAsset', 'world')
      }
    }
    if (input.type === 'narrative' && !asset.genParams?.graphJson) {
      asset.genParams = {
        ...(asset.genParams ?? {}),
        graphJson: createDefaultScopedGraph('narrativeAsset', 'narrative')
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
    this.writeAsset(asset)
    if (input.type === 'script' && !input.skipScriptBootstrap) {
      this.createShot({ title: '分镜', scriptAssetId: id })
      return this.readAsset(id)
    }
    return asset
  }

  /** 创建剧集，并预置剧本 / 世界元素 / 叙事单元 / 分镜宿主节点与连线 */
  createSeriesWithStarter(input: CreateSeriesWithStarterInput = {}): AssetInfo {
    const parentFolderId = input.folderId ?? null
    const language = settingsService.get().language
    const seriesName = input.name?.trim() || defaultAssetName('canvas', language)
    const childTypes = ['screenplay', 'world', 'narrative', 'script'] as const

    const childName = (type: (typeof childTypes)[number]): string => {
      const override = input.childNames?.[type]?.trim()
      if (override) return override
      return `${seriesName}${assetTypeLabel(type, language)}`
    }
    const childFolderName = (type: (typeof childTypes)[number]): string => {
      const override = input.childFolderNames?.[type]?.trim()
      if (override) return override
      return assetTypeLabel(type, language)
    }

    /** 当前目录下按类型名找或建子目录（不建剧集名外层目录） */
    const ensureTypeFolder = (type: (typeof childTypes)[number]): string => {
      const name = childFolderName(type)
      const existing = this.listFolders().find(
        (folder) =>
          (folder.parentId ?? null) === parentFolderId && folder.name.trim() === name
      )
      if (existing) return existing.id
      return this.createFolder({ name, parentId: parentFolderId }).id
    }

    const children = {} as Record<(typeof childTypes)[number], AssetInfo>
    for (const type of childTypes) {
      children[type] = this.createAsset({
        type,
        folderId: ensureTypeFolder(type),
        name: childName(type)
      })
    }

    return this.createAsset({
      type: 'canvas',
      folderId: parentFolderId,
      name: seriesName,
      genParams: {
        graphJson: buildSeriesStarterGraph({
          screenplay: children.screenplay,
          world: children.world,
          narrative: children.narrative,
          script: children.script
        })
      }
    })
  }

  private appendShotToScript(scriptAssetId: string, shotId: string): void {
    const asset = this.readAsset(scriptAssetId)
    const raw = asset.genParams?.shotIds
    const ids = Array.isArray(raw) ? raw.map(String) : []
    if (!ids.includes(shotId)) ids.push(shotId)
    asset.genParams = { ...asset.genParams, shotIds: ids }
    asset.updatedAt = nowIso()
    this.writeAsset(asset)
  }

  private removeShotFromScript(scriptAssetId: string, shotId: string): void {
    try {
      const asset = this.readAsset(scriptAssetId)
      const raw = asset.genParams?.shotIds
      const ids = Array.isArray(raw) ? raw.map(String).filter((id) => id !== shotId) : []
      asset.genParams = { ...asset.genParams, shotIds: ids }
      asset.updatedAt = nowIso()
      this.writeAsset(asset)
    } catch {
      // script asset may already be deleted
    }
  }

  deleteAsset(assetId: string): void {
    const root = this.getRoot()
    const asset = this.readAsset(assetId)
    const type = asset.type === ('act' as AssetType) ? 'script' : asset.type
    if (type === 'script') {
      const raw = asset.genParams?.shotIds
      const shotIds = Array.isArray(raw) ? [...raw.map(String)] : []
      for (const shotId of shotIds) {
        this.deleteShot(shotId)
      }
    }
    autosaveRepository.discard(root, { kind: 'asset', id: assetId })
    assetRepository.removeMetadata(root, assetId)
  }

  findAssetReferences(assetIds: string[]): FindAssetReferencesResult {
    return findAssetReferencesInProject(assetIds, this.listAssets(), this.listShots())
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
      throw new Error(`文件类型与资产类型不匹配（需要 ${assetTypeLabel(asset.type, settingsService.get().language)}）`)
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
        skipped.push({ id: assetId, name: assetId, reason: '资产不存在' })
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
      throw new Error('姿势资产没有可重新导入的媒体文件')
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
      throw new Error('没有可重新导入的媒体文件')
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
    if (!existsSync(abs)) throw new Error('文件不存在')

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
      throw new Error('仅剧本资产支持文本写回')
    }
    const relativePath = asset.relativePath?.trim()
    if (!relativePath) {
      throw new Error('该剧本没有旁挂文本文件')
    }
    if (!isTextFilePath(relativePath)) {
      throw new Error('旁挂文件不是可编辑的文本类型')
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
    if (!asset) throw new Error('资产不存在')

    let abs: string | null = null
    if (asset.relativePath) {
      const mediaAbs = assertInsideProject(root, join(root, asset.relativePath))
      if (existsSync(mediaAbs)) abs = mediaAbs
    }
    if (!abs) {
      const metaAbs = scan.metaAbsByAssetId.get(assetId)
      if (metaAbs && existsSync(metaAbs)) abs = metaAbs
    }
    if (!abs) throw new Error('磁盘上找不到该资产文件')
    shell.showItemInFolder(abs)
  }

  /**
   * 将选中资产的原始媒体文件复制到系统剪贴板（非缩略图）。
   * 可粘贴到资源管理器等支持文件粘贴的目标。
   */
  async copyAssetOriginalFiles(assetIds: string[]): Promise<{ copied: number; mode: 'files' | 'text' }> {
    const ids = [...new Set(assetIds.map((id) => id?.trim()).filter(Boolean))]
    if (!ids.length) throw new Error('未选择资产')

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
    if (!absPaths.length) throw new Error('没有可复制的原始资产文件')

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

  // ---- Shots ----

  listShots(): Shot[] {
    return shotRepository.list(this.getRoot(), this.getConfig().shotIds)
  }

  getShot(shotId: string): Shot | null {
    return shotRepository.read(this.getRoot(), shotId)
  }

  createShot(input?: CreateShotInput): Shot {
    const config = this.getConfig()
    const ts = nowIso()
    const scriptAssetId = input?.scriptAssetId
    const scopedShots = scriptAssetId
      ? config.shotIds
          .map((id) => this.getShot(id))
          .filter((s): s is Shot => {
            if (!s) return false
            return s.scriptAssetId === scriptAssetId
          })
      : []
    const base = createEmptyShot(
      input?.title ?? `分镜 ${scriptAssetId ? scopedShots.length + 1 : config.shotIds.length + 1}`,
      config.resolution
    )
    const shot: Shot = {
      ...base,
      id: randomUUID(),
      scriptAssetId,
      createdAt: ts,
      updatedAt: ts
    }
    shotRepository.write(this.getRoot(), shot)
    config.shotIds.push(shot.id)
    this.saveConfig(config)
    if (scriptAssetId) this.appendShotToScript(scriptAssetId, shot.id)
    return shot
  }

  updateShot(shot: Shot): Shot {
    shot.updatedAt = nowIso()
    shotRepository.write(this.getRoot(), shot)
    autosaveRepository.discard(this.getRoot(), { kind: 'shot', id: shot.id })
    return shot
  }

  deleteShot(shotId: string): void {
    const config = this.getConfig()
    const shot = this.getShot(shotId)
    shotRepository.remove(this.getRoot(), shotId)
    autosaveRepository.discard(this.getRoot(), { kind: 'shot', id: shotId })
    config.shotIds = config.shotIds.filter((id) => id !== shotId)
    this.saveConfig(config)
    if (shot?.scriptAssetId) {
      this.removeShotFromScript(shot.scriptAssetId, shotId)
    }
  }

  /** 资产包导入：按已定 id 写入分镜并登记到工程（不改 genParams.shotIds） */
  registerImportedShots(shots: Shot[]): void {
    if (!shots.length) return
    const root = this.getRoot()
    const config = this.getConfig()
    const known = new Set(config.shotIds)
    for (const shot of shots) {
      shotRepository.write(root, shot)
      if (!known.has(shot.id)) {
        config.shotIds.push(shot.id)
        known.add(shot.id)
      }
    }
    this.saveConfig(config)
  }

  unregisterImportedShots(shotIds: string[]): void {
    if (!shotIds.length) return
    const root = this.getRoot()
    const config = this.getConfig()
    for (const shotId of shotIds) {
      shotRepository.remove(root, shotId)
      autosaveRepository.discard(root, { kind: 'shot', id: shotId })
    }
    const remove = new Set(shotIds)
    config.shotIds = config.shotIds.filter((id) => !remove.has(id))
    this.saveConfig(config)
  }

  reorderShots(shotIds: string[]): void {
    const config = this.getConfig()
    const set = new Set(config.shotIds)
    if (shotIds.length !== set.size || shotIds.some((id) => !set.has(id))) {
      throw new Error('分镜排序列表无效')
    }
    config.shotIds = shotIds
    this.saveConfig(config)
  }

  /**
   * 一次落盘同步某剧本下的分镜：写入有序列表、删除多余项、更新 config / genParams.shotIds。
   * 供打开分镜表格时导入拆分 JSON，避免逐条 IPC。
   */
  syncScriptShots(input: SyncScriptShotsInput): Shot[] {
    const scriptAssetId = input.scriptAssetId?.trim()
    if (!scriptAssetId) throw new Error('缺少剧本资产')
    const ordered = Array.isArray(input.orderedShots) ? input.orderedShots : []
    const root = this.getRoot()
    const config = this.getConfig()
    const ts = nowIso()

    const nextIds = ordered.map((shot) => {
      if (!shot?.id?.trim()) throw new Error('分镜缺少 id')
      return shot.id
    })
    const nextIdSet = new Set(nextIds)
    if (nextIdSet.size !== nextIds.length) throw new Error('分镜 id 重复')

    const previousIds = (() => {
      try {
        const asset = this.readAsset(scriptAssetId)
        const raw = asset.genParams?.shotIds
        if (Array.isArray(raw) && raw.length) return raw.map(String)
      } catch {
        // fall through
      }
      return config.shotIds
        .map((id) => this.getShot(id))
        .filter((s): s is Shot => !!s && s.scriptAssetId === scriptAssetId)
        .map((s) => s.id)
    })()

    for (const shotId of previousIds) {
      if (nextIdSet.has(shotId)) continue
      shotRepository.remove(root, shotId)
      autosaveRepository.discard(root, { kind: 'shot', id: shotId })
    }

    const written: Shot[] = []
    for (const raw of ordered) {
      const shot: Shot = {
        ...raw,
        scriptAssetId,
        updatedAt: ts,
        createdAt: raw.createdAt?.trim() || ts
      }
      shotRepository.write(root, shot)
      autosaveRepository.discard(root, { kind: 'shot', id: shot.id })
      written.push(shot)
    }

    const removeSet = new Set(previousIds.filter((id) => !nextIdSet.has(id)))
    const known = new Set(config.shotIds.filter((id) => !removeSet.has(id)))
    for (const id of nextIds) {
      if (!known.has(id)) {
        config.shotIds.push(id)
        known.add(id)
      }
    }
    config.shotIds = config.shotIds.filter((id) => !removeSet.has(id))
    this.saveConfig(config)

    const asset = this.readAsset(scriptAssetId)
    asset.genParams = { ...asset.genParams, shotIds: nextIds }
    asset.updatedAt = ts
    this.writeAsset(asset)

    return written
  }

  /** Save canvas PNG under Thumbnails and return relative path */
  saveCanvasPng(shotId: string, dataUrl: string): string {
    const root = this.getRoot()
    const match = /^data:image\/png;base64,(.+)$/.exec(dataUrl)
    if (!match) throw new Error('无效的 PNG data URL')
    const buf = Buffer.from(match[1], 'base64')
    const rel = `Thumbnails/${shotId}.png`
    const abs = assertInsideProject(root, join(root, rel))
    writeFileSync(abs, buf)
    return rel.replace(/\\/g, '/')
  }

  /**
   * 将图执行产物写入指定输出目录（默认 `Assets/{资产名}/Images/`），
   * 并在 Assets/ 下登记旁挂 `.asset.json`，返回工程相对路径。
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
    const outDir =
      normalizeProjectRelativeDir(input.outputDir) ||
      `Assets/Generated/${ASSET_IMAGE_OUTPUT_KIND_DIR}`
    const dirAbs = assertInsideProject(root, join(root, outDir))
    mkdirSync(dirAbs, { recursive: true })
    if (outDir === 'Assets' || outDir.startsWith('Assets/')) {
      ensureAssetRelativeFolderChain(root, outDir)
    }
    const fileName = uniqueFileName(dirAbs, `${safeStem}${ext}`)
    const relativePath = `${outDir}/${fileName}`.replace(/\\/g, '/')
    const abs = assertInsideProject(root, join(root, relativePath))
    writeFileSync(abs, buf)

    const assetType = assetTypeFromMime(mime)
    let asset: AssetInfo | null = null
    if (assetType && (outDir === 'Assets' || outDir.startsWith('Assets/'))) {
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

  /**
   * 将图执行剧本正文写入指定输出目录（默认 `Assets/{资产名}/Texts/`），
   * 并在 Assets/ 下登记旁挂 `.asset.json`，返回工程相对路径。
   */
  async saveGraphRunText(
    input: SaveGraphRunTextInput
  ): Promise<{ relativePath: string; asset: AssetInfo | null }> {
    const root = this.getRoot()
    const content = input.content ?? ''
    const safeStem = normalizePathSegment(input.key || 'screenplay')
    const outDir =
      normalizeProjectRelativeDir(input.outputDir) ||
      `Assets/Generated/${ASSET_TEXT_OUTPUT_KIND_DIR}`
    const dirAbs = assertInsideProject(root, join(root, outDir))
    mkdirSync(dirAbs, { recursive: true })
    if (outDir === 'Assets' || outDir.startsWith('Assets/')) {
      ensureAssetRelativeFolderChain(root, outDir)
    }
    const fileName = uniqueFileName(dirAbs, `${safeStem}.txt`)
    const relativePath = `${outDir}/${fileName}`.replace(/\\/g, '/')
    const abs = assertInsideProject(root, join(root, relativePath))
    writeFileSync(abs, content, 'utf-8')

    let asset: AssetInfo | null = null
    if (outDir === 'Assets' || outDir.startsWith('Assets/')) {
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
    sourceShotId?: string
  }): AssetInfo {
    const root = this.getRoot()
    const abs = assertInsideProject(root, join(root, params.relativePath))
    if (!existsSync(abs)) throw new Error('媒体文件不存在')
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
      sourceShotId: params.sourceShotId,
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
      throw new Error(`资产元数据写入失败: ${metaFileNameForMedia(mediaName)}`)
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
    if (!existsSync(abs)) throw new Error('媒体文件不存在')
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

  /** Register a generated video asset into the resolved Videos output dir */
  registerGeneratedVideo(params: {
    shotId: string
    sourceFilePath: string
    prompt: string
  }): AssetInfo {
    return this.attachExternalGeneratedFile({
      type: 'video',
      sourceFilePath: params.sourceFilePath,
      name: `Gen_${shotShort(params.shotId)}`,
      prompt: params.prompt,
      sourceShotId: params.shotId
    })
  }

  /**
   * 将外部生成的文件登记为工程资产。
   * 主文件写入 `outputDir`（缺省：视频 → Assets/{name}/Videos，其它 → Assets/），
   * 与图片 `saveGraphRunMedia` 一致，不再双写根目录副本。
   */
  attachExternalGeneratedFile(params: {
    type: AssetType
    sourceFilePath: string
    name: string
    prompt?: string
    sourceShotId?: string
    /** @deprecated 已忽略；主文件直接写入 outputDir */
    alsoCopyToOutput?: boolean
    /** 主落盘目录（相对工程根） */
    outputDir?: string
  }): AssetInfo {
    const root = this.getRoot()
    const ext = extname(params.sourceFilePath) || (params.type === 'video' ? '.mp4' : '.png')
    const explicitDir = normalizeProjectRelativeDir(params.outputDir)
    const destDirRel =
      explicitDir ||
      (params.type === 'video'
        ? resolveMediaOutputDir({
            hostFolderDir: 'Assets',
            hostAssetName: params.name,
            kind: 'video'
          })
        : params.type === 'voice'
          ? resolveMediaOutputDir({
              hostFolderDir: 'Assets',
              hostAssetName: params.name,
              kind: 'voice'
            })
          : 'Assets')
    const dirAbs = assertInsideProject(root, join(root, destDirRel))
    mkdirSync(dirAbs, { recursive: true })
    if (destDirRel === 'Assets' || destDirRel.startsWith('Assets/')) {
      ensureAssetRelativeFolderChain(root, destDirRel)
    }

    const fileName = uniqueFileName(
      dirAbs,
      `${normalizePathSegment(params.name)}${ext}`
    )
    const destAbs = join(dirAbs, fileName)
    copyFileSync(params.sourceFilePath, destAbs)
    const relativePath = toPosix(relative(root, destAbs))
    return this.registerExistingMediaAsAsset({
      relativePath,
      type: params.type,
      name: params.name,
      prompt: params.prompt,
      sourceShotId: params.sourceShotId
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

function shotShort(id: string): string {
  return id.slice(0, 8)
}

function assetTypeFromMime(mime: string): AssetType | null {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'voice'
  return null
}

export const projectService = new ProjectService()
