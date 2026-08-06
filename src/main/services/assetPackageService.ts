import { app, dialog } from 'electron'
import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, extname, isAbsolute, join, relative } from 'path'
import type { AssetFolder, AssetInfo } from '@shared/domain'
import { isDraftAssetId, resolveUniqueAssetName } from '@shared/domain'
import { collectAssetGuids, remapAssetGuids } from '@shared/assetRef'
import {
  collectRelativePathStrings,
  isPackableGeneratedRelativePath,
  normalizePackableRelativePath
} from '@shared/assetPackage/generatedOutputs'
import {
  buildAssetPathname,
  folderPathname,
  normalizePathSegment,
  pathnameDepth,
  uniquifyPathnames
} from '@shared/assetPackage/pathname'
import {
  isAipackageAssetType,
  AIPACKAGE_EXTENSION,
  type AssetPackageAssetMeta,
  type AssetPackageFolderMeta,
  type ExportAssetPackageInput,
  type ExportAssetPackageResult,
  type ImportAssetPackageInput,
  type ImportAssetPackageItemReport,
  type ImportAssetPackageResult,
  type PreviewAssetPackageResult
} from '@shared/assetPackage/types'
import { expandImportSelection } from '@shared/assetPackage/tree'
import { collectFolderSubtreeIds, normalizeFolders } from '@shared/folderTree'
import { toPosix } from '@shared/assetStorage/layout'
import {
  readAipackageArchive,
  previewAipackageArchive,
  sha256Buffer,
  sha256Json,
  writeAipackageArchive,
  type PackedGeneratedFile,
  type PackedPackageEntry
} from '../repositories/assetPackageArchive'
import { assetRepository } from '../repositories/assetRepository'
import { folderRepository } from '../repositories/folderRepository'
import { resolveFolderDirAbs, uniqueFileName } from '../repositories/assetTreeStore'
import { runTransactionSync } from '../persistence/transactionRunner'
import { projectService } from './projectService'

function nowIso(): string {
  return new Date().toISOString()
}

function portableAsset(asset: AssetInfo): AssetPackageAssetMeta['asset'] {
  return {
    type: asset.type,
    name: asset.name,
    prompt: asset.prompt,
    notes: asset.notes,
    genParams: asset.genParams ? structuredClone(asset.genParams) : undefined,
    version: asset.version,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt
  }
}

function portableFingerprint(
  asset: AssetInfo,
  payloadSha: string
): string {
  return sha256Json({
    asset: portableAsset(asset),
    payloadSha
  })
}

function extFromRelativePath(relativePath: string): string {
  return extname(relativePath) || ''
}

function resolveSafeProjectFile(root: string, relativePosix: string): string | null {
  const safe = normalizePackableRelativePath(relativePosix)
  if (!safe) return null
  const abs = join(root, ...safe.split('/').filter(Boolean))
  const rel = relative(root, abs)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null
  return abs
}

function collectExportDependencies(
  seedIds: Iterable<string>,
  byId: Map<string, AssetInfo>
): { exportIds: Set<string>; dependencyIds: Set<string>; skipped: { id: string; reason: string }[] } {
  const exportIds = new Set(seedIds)
  const dependencyIds = new Set<string>()
  const skipped: { id: string; reason: string }[] = []
  let changed = true
  while (changed) {
    changed = false
    for (const id of [...exportIds]) {
      const asset = byId.get(id)
      if (!asset) continue
      const guids = new Set(collectAssetGuids(asset.genParams ?? {}))
      for (const dep of guids) {
        if (isDraftAssetId(dep) || dep === id) continue
        if (!byId.has(dep)) {
          skipped.push({ id: dep, reason: 'missing-dependency' })
          continue
        }
        if (!exportIds.has(dep)) {
          exportIds.add(dep)
          dependencyIds.add(dep)
          changed = true
        }
      }
    }
  }
  return { exportIds, dependencyIds, skipped }
}

class AssetPackageService {
  async exportPackage(input: ExportAssetPackageInput): Promise<ExportAssetPackageResult> {
    const root = projectService.getRoot()
    const assets = projectService.listAssets()
    const folders = normalizeFolders(projectService.listFolders())
    const byId = new Map(assets.map((a) => [a.id, a]))
    const folderById = new Map(folders.map((f) => [f.id, f]))

    const skipped: ExportAssetPackageResult['skipped'] = []
    const selectedAssetIds = new Set<string>()
    const structuralFolderIds = new Set<string>()

    for (const id of input.folderIds ?? []) {
      if (!folderById.has(id)) {
        skipped.push({ id, reason: 'folder-not-found' })
        continue
      }
      for (const fid of collectFolderSubtreeIds(folders, id)) {
        structuralFolderIds.add(fid)
      }
      for (const asset of assets) {
        if (asset.folderId && structuralFolderIds.has(asset.folderId)) {
          selectedAssetIds.add(asset.id)
        }
      }
    }

    for (const id of input.assetIds ?? []) {
      if (isDraftAssetId(id)) {
        skipped.push({ id, reason: 'draft' })
        continue
      }
      if (!byId.has(id)) {
        skipped.push({ id, reason: 'not-found' })
        continue
      }
      selectedAssetIds.add(id)
    }

    const includeDeps = input.includeDependencies !== false
    let exportAssetIds = new Set(selectedAssetIds)
    let dependencyIds = new Set<string>()

    if (includeDeps) {
      const expanded = collectExportDependencies(exportAssetIds, byId)
      exportAssetIds = expanded.exportIds
      dependencyIds = expanded.dependencyIds
      skipped.push(...expanded.skipped)
    }

    for (const id of [...exportAssetIds]) {
      const asset = byId.get(id)!
      if (!isAipackageAssetType(asset.type)) {
        exportAssetIds.delete(id)
        dependencyIds.delete(id)
        skipped.push({ id, reason: `unsupported-type:${asset.type}` })
      }
    }

    for (const id of exportAssetIds) {
      let folderId = byId.get(id)?.folderId ?? null
      while (folderId) {
        structuralFolderIds.add(folderId)
        folderId = folderById.get(folderId)?.parentId ?? null
      }
    }

    if (exportAssetIds.size === 0 && structuralFolderIds.size === 0) {
      throw new Error('没有可导出的资产')
    }

    const pathPlan: { guid: string; pathname: string }[] = []
    for (const fid of structuralFolderIds) {
      pathPlan.push({ guid: fid, pathname: folderPathname(folders, fid) })
    }
    for (const id of exportAssetIds) {
      pathPlan.push({ guid: id, pathname: buildAssetPathname(folders, byId.get(id)!) })
    }
    const pathByGuid = uniquifyPathnames(pathPlan)

    const packed: PackedPackageEntry[] = []

    for (const fid of [...structuralFolderIds].sort(
      (a, b) => pathnameDepth(pathByGuid.get(a)!) - pathnameDepth(pathByGuid.get(b)!)
    )) {
      const folder = folderById.get(fid)!
      const meta: AssetPackageFolderMeta = {
        schemaVersion: 1,
        guid: fid,
        kind: 'folder',
        folder: {
          name: folder.name,
          createdAt: folder.createdAt,
          updatedAt: folder.updatedAt
        },
        parentGuid: folder.parentId ?? null
      }
      packed.push({
        guid: fid,
        pathname: pathByGuid.get(fid)!,
        meta,
        payload: Buffer.alloc(0),
        role: 'structural'
      })
    }

    for (const id of exportAssetIds) {
      const asset = byId.get(id)!
      let payload = Buffer.alloc(0)
      let extension = ''
      let mode: 'binary' | 'empty' = 'empty'
      if (asset.relativePath) {
        const abs = join(root, asset.relativePath)
        if (!existsSync(abs)) {
          skipped.push({ id, reason: 'missing-media' })
          continue
        }
        payload = readFileSync(abs)
        extension = extFromRelativePath(asset.relativePath)
        mode = 'binary'
      }
      const deps = includeDeps
        ? [
            ...collectAssetGuids(asset.genParams ?? {})
          ].filter((g) => g !== id)
        : []
      const meta: AssetPackageAssetMeta = {
        schemaVersion: 1,
        guid: id,
        kind: 'asset',
        asset: portableAsset(asset),
        folderGuid: asset.folderId ?? null,
        payload: {
          mode,
          extension,
          size: payload.length,
          sha256: sha256Buffer(payload)
        },
        dependencies: [...new Set(deps)]
      }
      packed.push({
        guid: id,
        pathname: pathByGuid.get(id)!,
        meta,
        payload,
        role: selectedAssetIds.has(id)
          ? 'selected'
          : dependencyIds.has(id)
            ? 'dependency'
            : 'selected'
      })
    }

    const generated: PackedGeneratedFile[] = []
    if (input.includeGeneratedOutputs) {
      const cacheRoot = projectService.getConfig()?.cacheOutputDir
      const alreadyPayload = new Set(
        [...exportAssetIds]
          .map((id) => normalizePackableRelativePath(byId.get(id)?.relativePath))
          .filter(Boolean)
      )
      const pathSet = new Set<string>()
      for (const id of exportAssetIds) {
        const asset = byId.get(id)
        if (!asset) continue
        collectRelativePathStrings(asset.genParams ?? {}, pathSet)
      }
      for (const rel of pathSet) {
        if (!isPackableGeneratedRelativePath(rel, cacheRoot)) continue
        if (alreadyPayload.has(rel)) continue
        const abs = resolveSafeProjectFile(root, rel)
        if (!abs || !existsSync(abs)) {
          skipped.push({ id: rel, reason: 'missing-generated' })
          continue
        }
        generated.push({ relativePath: rel, data: readFileSync(abs) })
      }
    }

    const defaultName =
      (input.defaultName?.trim() || 'assets').replace(/[<>:"/\\|?*]/g, '_') || 'assets'
    const save = await dialog.showSaveDialog({
      title: '导出资产包',
      defaultPath: `${defaultName}.${AIPACKAGE_EXTENSION}`,
      filters: [{ name: 'AIArtEngine Asset Package', extensions: [AIPACKAGE_EXTENSION] }],
      properties: ['createDirectory', 'showOverwriteConfirmation']
    })
    if (save.canceled || !save.filePath) {
      return { path: null, exportedAssets: 0, exportedFolders: 0, exportedGenerated: 0, skipped }
    }
    let outPath = save.filePath
    if (!outPath.toLowerCase().endsWith(`.${AIPACKAGE_EXTENSION}`)) {
      outPath = `${outPath}.${AIPACKAGE_EXTENSION}`
    }

    await writeAipackageArchive(outPath, {
      name: defaultName,
      appVersion: app.getVersion(),
      entries: packed,
      generated
    })

    return {
      path: outPath,
      exportedAssets: packed.filter((e) => e.meta.kind === 'asset').length,
      exportedFolders: packed.filter((e) => e.meta.kind === 'folder').length,
      exportedGenerated: generated.length,
      skipped
    }
  }

  async previewPackage(packPath?: string): Promise<PreviewAssetPackageResult | null> {
    let path = packPath
    if (!path) {
      const opened = await dialog.showOpenDialog({
        title: '导入资产包',
        properties: ['openFile'],
        filters: [{ name: 'AIArtEngine Asset Package', extensions: [AIPACKAGE_EXTENSION] }]
      })
      if (opened.canceled || !opened.filePaths[0]) return null
      path = opened.filePaths[0]
    }
    const { manifest, entries } = await previewAipackageArchive(path)
    return {
      packPath: path,
      name: manifest.name,
      entries: entries.map((entry) => {
        if (entry.meta.kind === 'folder') {
          return {
            guid: entry.guid,
            kind: 'folder' as const,
            pathname: entry.pathname,
            name: entry.meta.folder.name,
            parentGuid: entry.meta.parentGuid ?? null,
            role: entry.role
          }
        }
        return {
          guid: entry.guid,
          kind: 'asset' as const,
          pathname: entry.pathname,
          name: entry.meta.asset.name,
          parentGuid: entry.meta.folderGuid ?? null,
          assetType: entry.meta.asset.type,
          role: entry.role,
          dependencies: entry.meta.dependencies ?? []
        }
      })
    }
  }

  async importPackage(input: ImportAssetPackageInput): Promise<ImportAssetPackageResult> {
    const root = projectService.getRoot()
    let packPath = input.packPath
    if (!packPath) {
      const opened = await dialog.showOpenDialog({
        title: '导入资产包',
        properties: ['openFile'],
        filters: [{ name: 'AIArtEngine Asset Package', extensions: [AIPACKAGE_EXTENSION] }]
      })
      if (opened.canceled || !opened.filePaths[0]) {
        return {
          canceled: true,
          importedAssets: 0,
          importedFolders: 0,
          reusedFolders: 0,
          reused: 0,
          remapped: 0,
          restoredGenerated: 0,
          items: []
        }
      }
      packPath = opened.filePaths[0]
    }

    const { entries: allEntries, generated: packedGenerated } = await readAipackageArchive(packPath)
    let entries = allEntries

    if (input.selectedGuids && input.selectedGuids.length > 0) {
      const previewEntries = allEntries.map((entry) => {
        if (entry.meta.kind === 'folder') {
          return {
            guid: entry.guid,
            kind: 'folder' as const,
            pathname: entry.pathname,
            name: entry.meta.folder.name,
            parentGuid: entry.meta.parentGuid ?? null,
            role: entry.role
          }
        }
        return {
          guid: entry.guid,
          kind: 'asset' as const,
          pathname: entry.pathname,
          name: entry.meta.asset.name,
          parentGuid: entry.meta.folderGuid ?? null,
          assetType: entry.meta.asset.type,
          role: entry.role,
          dependencies: entry.meta.dependencies ?? []
        }
      })
      const allowed = expandImportSelection(
        previewEntries,
        new Set(input.selectedGuids),
        input.includeDependencies !== false
      )
      entries = allEntries.filter((e) => allowed.has(e.guid))
      if (entries.length === 0) {
        throw new Error('未选择可导入的条目')
      }
    }

    const existingAssets = projectService.listAssets()
    const existingFolders = normalizeFolders(projectService.listFolders())
    const assetById = new Map(existingAssets.map((a) => [a.id, a]))
    const folderById = new Map(existingFolders.map((f) => [f.id, f]))

    const destinationFolderId = input.destinationFolderId ?? null
    if (destinationFolderId && !folderById.has(destinationFolderId)) {
      throw new Error('目标文件夹不存在')
    }

    const guidMap = new Map<string, string>()
    const items: ImportAssetPackageItemReport[] = []

    type Plan =
      | {
          kind: 'folder'
          action: 'preserve' | 'reuse' | 'remap'
          sourceGuid: string
          targetGuid: string
          meta: AssetPackageFolderMeta
          pathname: string
        }
      | {
          kind: 'asset'
          action: 'preserve' | 'reuse' | 'remap'
          sourceGuid: string
          targetGuid: string
          meta: AssetPackageAssetMeta
          payload: Buffer
          pathname: string
        }

    const plans: Plan[] = []

    const folderEntries = entries
      .filter((e) => e.meta.kind === 'folder')
      .sort((a, b) => pathnameDepth(a.pathname) - pathnameDepth(b.pathname))
    const assetEntries = entries.filter((e) => e.meta.kind === 'asset')

    for (const entry of folderEntries) {
      const meta = entry.meta as AssetPackageFolderMeta
      const existing = folderById.get(meta.guid)
      if (!existing) {
        guidMap.set(meta.guid, meta.guid)
        plans.push({
          kind: 'folder',
          action: 'preserve',
          sourceGuid: meta.guid,
          targetGuid: meta.guid,
          meta,
          pathname: entry.pathname
        })
        items.push({
          guid: meta.guid,
          kind: 'folder',
          action: 'preserve',
          pathname: entry.pathname
        })
        continue
      }
      const same =
        existing.name === meta.folder.name &&
        (existing.parentId ?? null) === (meta.parentGuid ?? null)
      if (same) {
        guidMap.set(meta.guid, meta.guid)
        plans.push({
          kind: 'folder',
          action: 'reuse',
          sourceGuid: meta.guid,
          targetGuid: meta.guid,
          meta,
          pathname: entry.pathname
        })
        items.push({
          guid: meta.guid,
          kind: 'folder',
          action: 'reuse',
          pathname: entry.pathname
        })
        continue
      }
      const newGuid = randomUUID()
      guidMap.set(meta.guid, newGuid)
      plans.push({
        kind: 'folder',
        action: 'remap',
        sourceGuid: meta.guid,
        targetGuid: newGuid,
        meta,
        pathname: entry.pathname
      })
      items.push({
        guid: meta.guid,
        kind: 'folder',
        action: 'remap',
        newGuid,
        pathname: entry.pathname
      })
    }

    for (const entry of assetEntries) {
      const meta = entry.meta as AssetPackageAssetMeta
      if (!isAipackageAssetType(meta.asset.type)) {
        throw new Error(`不支持导入资产类型: ${meta.asset.type}`)
      }
      const existing = assetById.get(meta.guid)
      if (!existing) {
        const existingByScan = assetRepository.listRaw(root).some((a) => a.id === meta.guid)
        const maybeMedia = meta.payload.extension
          ? join(root, 'Assets', `${meta.guid}${meta.payload.extension}`)
          : null
        if (existingByScan || (maybeMedia && existsSync(maybeMedia))) {
          const newGuid = randomUUID()
          guidMap.set(meta.guid, newGuid)
          plans.push({
            kind: 'asset',
            action: 'remap',
            sourceGuid: meta.guid,
            targetGuid: newGuid,
            meta,
            payload: entry.payload,
            pathname: entry.pathname
          })
          items.push({
            guid: meta.guid,
            kind: 'asset',
            action: 'remap',
            newGuid,
            pathname: entry.pathname
          })
          continue
        }
        guidMap.set(meta.guid, meta.guid)
        plans.push({
          kind: 'asset',
          action: 'preserve',
          sourceGuid: meta.guid,
          targetGuid: meta.guid,
          meta,
          payload: entry.payload,
          pathname: entry.pathname
        })
        items.push({
          guid: meta.guid,
          kind: 'asset',
          action: 'preserve',
          pathname: entry.pathname
        })
        continue
      }

      let existingPayloadSha = sha256Buffer(Buffer.alloc(0))
      if (existing.relativePath) {
        const abs = join(root, existing.relativePath)
        if (existsSync(abs)) existingPayloadSha = sha256Buffer(readFileSync(abs))
      }
      const payloadSha = sha256Buffer(entry.payload)
      const same =
        portableFingerprint(existing, existingPayloadSha) ===
        sha256Json({
          asset: meta.asset,
          payloadSha
        })
      if (same) {
        guidMap.set(meta.guid, meta.guid)
        plans.push({
          kind: 'asset',
          action: 'reuse',
          sourceGuid: meta.guid,
          targetGuid: meta.guid,
          meta,
          payload: entry.payload,
          pathname: entry.pathname
        })
        items.push({
          guid: meta.guid,
          kind: 'asset',
          action: 'reuse',
          pathname: entry.pathname
        })
        continue
      }

      const newGuid = randomUUID()
      guidMap.set(meta.guid, newGuid)
      plans.push({
        kind: 'asset',
        action: 'remap',
        sourceGuid: meta.guid,
        targetGuid: newGuid,
        meta,
        payload: entry.payload,
        pathname: entry.pathname
      })
      items.push({
        guid: meta.guid,
        kind: 'asset',
        action: 'remap',
        newGuid,
        pathname: entry.pathname
      })
    }

    const remappedAssetMetas = new Map<string, AssetPackageAssetMeta>()

    for (const plan of plans) {
      if (plan.kind !== 'asset' || plan.action === 'reuse') continue
      const mappedFolder =
        plan.meta.folderGuid == null
          ? null
          : (guidMap.get(plan.meta.folderGuid) ?? plan.meta.folderGuid)
      let safeGen = plan.meta.asset.genParams
        ? remapAssetGuids(plan.meta.asset.genParams, guidMap)
        : undefined

      remappedAssetMetas.set(plan.targetGuid, {
        ...plan.meta,
        guid: plan.targetGuid,
        folderGuid: mappedFolder,
        asset: {
          ...plan.meta.asset,
          genParams: safeGen
        },
        dependencies: plan.meta.dependencies.map((d) => guidMap.get(d) ?? d)
      })
    }

    const steps: Array<{ label: string; forward: () => void; rollback: () => void }> = []

    const resolveParentForFolder = (meta: AssetPackageFolderMeta): string | null => {
      if (meta.parentGuid == null) return destinationFolderId
      return guidMap.get(meta.parentGuid) ?? meta.parentGuid
    }

    for (const plan of plans) {
      if (plan.kind !== 'folder' || plan.action === 'reuse') continue
      const targetGuid = plan.targetGuid
      const parentId = resolveParentForFolder(plan.meta)
      const siblingNames = [...folderById.values()]
        .filter((f) => (f.parentId ?? null) === parentId)
        .map((f) => f.name)
      for (const p of plans) {
        if (p.kind !== 'folder' || p.action === 'reuse' || p.targetGuid === targetGuid) continue
        if (resolveParentForFolder(p.meta) === parentId) siblingNames.push(p.meta.folder.name)
      }
      const name = resolveUniqueAssetName(plan.meta.folder.name, siblingNames)
      const ts = nowIso()
      const folder: AssetFolder = {
        id: targetGuid,
        name,
        parentId,
        createdAt: plan.meta.folder.createdAt || ts,
        updatedAt: ts
      }
      steps.push({
        label: `folder:${targetGuid}`,
        forward: () => {
          folderRepository.create(root, folder)
          folderById.set(folder.id, folder)
        },
        rollback: () => {
          try {
            folderRepository.remove(root, folder.id)
          } catch {
            /* ignore */
          }
          folderById.delete(folder.id)
        }
      })
    }

    for (const plan of plans) {
      if (plan.kind !== 'asset' || plan.action === 'reuse') continue
      const meta = remappedAssetMetas.get(plan.targetGuid) ?? {
        ...plan.meta,
        guid: plan.targetGuid
      }
      const folderId =
        meta.folderGuid == null
          ? destinationFolderId
          : (guidMap.get(meta.folderGuid) ?? meta.folderGuid)
      const siblingNames = [...assetById.values()]
        .filter((a) => (a.folderId ?? null) === folderId)
        .map((a) => a.name)
      const name = resolveUniqueAssetName(meta.asset.name, siblingNames)
      const ts = nowIso()
      const extension = meta.payload.extension || ''
      const payload = plan.payload

      steps.push({
        label: `asset:${plan.targetGuid}`,
        forward: () => {
          let relativePath = ''
          if (meta.payload.mode === 'binary' && extension) {
            const dirAbs = resolveFolderDirAbs(root, folderId)
            const fileName = uniqueFileName(
              dirAbs,
              `${normalizePathSegment(name)}${extension}`
            )
            const mediaAbs = join(dirAbs, fileName)
            writeFileSync(mediaAbs, payload)
            relativePath = toPosix(relative(root, mediaAbs))
          }
          const asset: AssetInfo = {
            id: plan.targetGuid,
            type: meta.asset.type,
            name,
            relativePath,
            folderId,
            prompt: meta.asset.prompt ?? '',
            notes: meta.asset.notes ?? '',
            genParams: meta.asset.genParams,
            version: meta.asset.version || 1,
            createdAt: meta.asset.createdAt || ts,
            updatedAt: ts
          }
          if (relativePath && (meta.asset.type === 'image' || meta.asset.type === 'video')) {
            asset.thumbnailPath = projectService.planAndScheduleImageThumbnail(relativePath)
          }
          assetRepository.write(root, asset)
          assetById.set(asset.id, asset)
        },
        rollback: () => {
          try {
            assetRepository.removeMetadata(root, plan.targetGuid)
          } catch {
            /* ignore */
          }
          assetById.delete(plan.targetGuid)
        }
      })
    }

    runTransactionSync(steps)

    let restoredGenerated = 0
    const cacheRoot = projectService.getConfig().cacheOutputDir
    for (const file of packedGenerated) {
      if (!isPackableGeneratedRelativePath(file.relativePath, cacheRoot)) continue
      const abs = resolveSafeProjectFile(root, file.relativePath)
      if (!abs) continue
      if (existsSync(abs)) continue
      mkdirSync(dirname(abs), { recursive: true })
      writeFileSync(abs, file.data)
      restoredGenerated += 1
    }

    return {
      canceled: false,
      importedAssets: items.filter((i) => i.kind === 'asset' && i.action !== 'reuse').length,
      importedFolders: items.filter((i) => i.kind === 'folder' && i.action !== 'reuse').length,
      reusedFolders: items.filter((i) => i.kind === 'folder' && i.action === 'reuse').length,
      reused: items.filter((i) => i.action === 'reuse').length,
      remapped: items.filter((i) => i.action === 'remap').length,
      restoredGenerated,
      items
    }
  }
}

export const assetPackageService = new AssetPackageService()
