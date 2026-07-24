import { createHash, randomUUID } from 'crypto'
import { readFileSync, writeFileSync } from 'fs'
import JSZip from 'jszip'
import type {
  AssetPackageManifest,
  AssetPackageMeta
} from '@shared/assetPackage/types'
import {
  AIPACKAGE_FORMAT,
  AIPACKAGE_FORMAT_VERSION
} from '@shared/assetPackage/types'

export function sha256Buffer(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

export function sha256Json(value: unknown): string {
  return sha256Buffer(Buffer.from(JSON.stringify(value), 'utf8'))
}

export interface PackedPackageEntry {
  guid: string
  pathname: string
  meta: AssetPackageMeta
  payload: Buffer
  role: AssetPackageManifest['entries'][number]['role']
}

export async function writeAipackageArchive(
  filePath: string,
  input: {
    name: string
    appVersion: string
    entries: PackedPackageEntry[]
  }
): Promise<AssetPackageManifest> {
  const zip = new JSZip()
  const manifest: AssetPackageManifest = {
    format: AIPACKAGE_FORMAT,
    formatVersion: AIPACKAGE_FORMAT_VERSION,
    packageId: randomUUID(),
    name: input.name,
    createdAt: new Date().toISOString(),
    createdWith: { app: 'AIArtEngine', version: input.appVersion },
    entries: []
  }

  for (const entry of input.entries) {
    const metaJson = JSON.stringify(entry.meta, null, 2)
    const payloadSha = sha256Buffer(entry.payload)
    const metaSha = sha256Buffer(Buffer.from(metaJson, 'utf8'))
    const folder = zip.folder(entry.guid)
    if (!folder) throw new Error('无法创建包条目')
    folder.file('pathname', entry.pathname)
    folder.file('asset', entry.payload)
    folder.file('asset.meta', metaJson)
    manifest.entries.push({
      guid: entry.guid,
      kind: entry.meta.kind,
      pathname: entry.pathname,
      role: entry.role,
      payloadSha256: payloadSha,
      metaSha256: metaSha,
      payloadSize: entry.payload.length
    })
  }

  zip.file('manifest.json', JSON.stringify(manifest, null, 2))
  const content = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  })
  writeFileSync(filePath, content)
  return manifest
}

export interface ReadPackageEntry {
  guid: string
  pathname: string
  meta: AssetPackageMeta
  payload: Buffer
  role: AssetPackageManifest['entries'][number]['role']
}

export async function readAipackageArchive(filePath: string): Promise<{
  manifest: AssetPackageManifest
  entries: ReadPackageEntry[]
}> {
  const raw = readFileSync(filePath)
  // Soft zip-bomb guard: reject absurd ratios later via entry sizes
  if (raw.length > 2 * 1024 * 1024 * 1024) {
    throw new Error('资产包过大')
  }
  const zip = await JSZip.loadAsync(raw)
  const manifestFile = zip.file('manifest.json')
  if (!manifestFile) throw new Error('缺少 manifest.json')
  const manifest = JSON.parse(await manifestFile.async('string')) as AssetPackageManifest
  if (manifest.format !== AIPACKAGE_FORMAT) {
    throw new Error(`未知资产包格式: ${String(manifest.format)}`)
  }
  if (manifest.formatVersion !== AIPACKAGE_FORMAT_VERSION) {
    throw new Error(`不支持的资产包版本: ${manifest.formatVersion}`)
  }
  if (!Array.isArray(manifest.entries) || manifest.entries.length === 0) {
    throw new Error('资产包条目为空')
  }
  if (manifest.entries.length > 50_000) {
    throw new Error('资产包条目过多')
  }

  const entries: ReadPackageEntry[] = []
  for (const listed of manifest.entries) {
    const pathnameFile = zip.file(`${listed.guid}/pathname`)
    const metaFile = zip.file(`${listed.guid}/asset.meta`)
    const assetFile = zip.file(`${listed.guid}/asset`)
    if (!pathnameFile || !metaFile || !assetFile) {
      throw new Error(`包条目不完整: ${listed.guid}`)
    }
    const pathname = (await pathnameFile.async('string')).split(/\r?\n/)[0]?.trim() ?? ''
    const metaText = await metaFile.async('string')
    const payload = Buffer.from(await assetFile.async('uint8array'))
    if (pathname !== listed.pathname) {
      throw new Error(`pathname 与 manifest 不一致: ${listed.guid}`)
    }
    if (sha256Buffer(payload) !== listed.payloadSha256) {
      throw new Error(`payload 校验失败: ${listed.guid}`)
    }
    if (sha256Buffer(Buffer.from(metaText, 'utf8')) !== listed.metaSha256) {
      throw new Error(`meta 校验失败: ${listed.guid}`)
    }
    if (payload.length !== listed.payloadSize) {
      throw new Error(`payload 大小不一致: ${listed.guid}`)
    }
    if (payload.length > 512 * 1024 * 1024) {
      throw new Error(`单条目过大: ${listed.guid}`)
    }
    const meta = JSON.parse(metaText) as AssetPackageMeta
    if (meta.guid !== listed.guid || meta.kind !== listed.kind) {
      throw new Error(`meta 与 manifest 不一致: ${listed.guid}`)
    }
    entries.push({
      guid: listed.guid,
      pathname: listed.pathname,
      meta,
      payload,
      role: listed.role
    })
  }

  return { manifest, entries }
}

/** 仅读 pathname + meta，用于导入前勾选预览（不读 payload） */
export async function previewAipackageArchive(filePath: string): Promise<{
  manifest: AssetPackageManifest
  entries: Array<{
    guid: string
    pathname: string
    meta: AssetPackageMeta
    role: AssetPackageManifest['entries'][number]['role']
  }>
}> {
  const raw = readFileSync(filePath)
  if (raw.length > 2 * 1024 * 1024 * 1024) {
    throw new Error('资产包过大')
  }
  const zip = await JSZip.loadAsync(raw)
  const manifestFile = zip.file('manifest.json')
  if (!manifestFile) throw new Error('缺少 manifest.json')
  const manifest = JSON.parse(await manifestFile.async('string')) as AssetPackageManifest
  if (manifest.format !== AIPACKAGE_FORMAT) {
    throw new Error(`未知资产包格式: ${String(manifest.format)}`)
  }
  if (manifest.formatVersion !== AIPACKAGE_FORMAT_VERSION) {
    throw new Error(`不支持的资产包版本: ${manifest.formatVersion}`)
  }
  if (!Array.isArray(manifest.entries) || manifest.entries.length === 0) {
    throw new Error('资产包条目为空')
  }

  const entries: Array<{
    guid: string
    pathname: string
    meta: AssetPackageMeta
    role: AssetPackageManifest['entries'][number]['role']
  }> = []

  for (const listed of manifest.entries) {
    const pathnameFile = zip.file(`${listed.guid}/pathname`)
    const metaFile = zip.file(`${listed.guid}/asset.meta`)
    if (!pathnameFile || !metaFile) {
      throw new Error(`包条目不完整: ${listed.guid}`)
    }
    const pathname = (await pathnameFile.async('string')).split(/\r?\n/)[0]?.trim() ?? ''
    const meta = JSON.parse(await metaFile.async('string')) as AssetPackageMeta
    if (meta.guid !== listed.guid || meta.kind !== listed.kind) {
      throw new Error(`meta 与 manifest 不一致: ${listed.guid}`)
    }
    entries.push({
      guid: listed.guid,
      pathname,
      meta,
      role: listed.role
    })
  }

  return { manifest, entries }
}
