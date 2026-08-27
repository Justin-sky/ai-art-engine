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
import { fail, defErr, defErrSimple } from '@shared/errors/appError'
import { MAIN_ERRORS } from '../errors/messages'

// ── 资产包完整性个性条目（共性家族见 errors/messages.ts）──
const E_PACKAGE_CREATE_ENTRY_FAILED = defErrSimple(
  'assetPackage.createEntryFailed',
  '无法创建包条目',
  'Failed to create the package entry'
)
const E_PACKAGE_PATHNAME_MISMATCH = defErr<{ guid: string }>(
  'assetPackage.pathnameMismatch',
  ({ guid }) => `pathname 与 manifest 不一致: ${guid}`,
  ({ guid }) => `pathname does not match manifest: ${guid}`
)
const E_PACKAGE_PAYLOAD_CHECKSUM_FAILED = defErr<{ guid: string }>(
  'assetPackage.payloadChecksumFailed',
  ({ guid }) => `payload 校验失败: ${guid}`,
  ({ guid }) => `Payload checksum mismatch: ${guid}`
)
const E_PACKAGE_META_CHECKSUM_FAILED = defErr<{ guid: string }>(
  'assetPackage.metaChecksumFailed',
  ({ guid }) => `meta 校验失败: ${guid}`,
  ({ guid }) => `Meta checksum mismatch: ${guid}`
)
const E_PACKAGE_PAYLOAD_SIZE_MISMATCH = defErr<{ guid: string }>(
  'assetPackage.payloadSizeMismatch',
  ({ guid }) => `payload 大小不一致: ${guid}`,
  ({ guid }) => `Payload size does not match manifest: ${guid}`
)
const E_PACKAGE_ENTRY_TOO_LARGE = defErr<{ guid: string }>(
  'assetPackage.entryTooLarge',
  ({ guid }) => `单条目过大: ${guid}`,
  ({ guid }) => `Entry is too large: ${guid}`
)
const E_PACKAGE_INVALID_GENERATED_PATH = defErr<{ path: string }>(
  'assetPackage.invalidGeneratedPath',
  ({ path }) => `非法生成产物路径: ${path}`,
  ({ path }) => `Invalid generated-output path: ${path}`
)
const E_PACKAGE_MISSING_GENERATED_FILE = defErr<{ path: string }>(
  'assetPackage.missingGeneratedFile',
  ({ path }) => `缺少生成产物: ${path}`,
  ({ path }) => `Missing generated output: ${path}`
)
const E_PACKAGE_GENERATED_SIZE_MISMATCH = defErr<{ path: string }>(
  'assetPackage.generatedSizeMismatch',
  ({ path }) => `生成产物大小不一致: ${path}`,
  ({ path }) => `Generated output size does not match manifest: ${path}`
)
const E_PACKAGE_GENERATED_TOO_LARGE = defErr<{ path: string }>(
  'assetPackage.generatedTooLarge',
  ({ path }) => `生成产物过大: ${path}`,
  ({ path }) => `Generated output is too large: ${path}`
)
const E_PACKAGE_GENERATED_CHECKSUM_FAILED = defErr<{ path: string }>(
  'assetPackage.generatedChecksumFailed',
  ({ path }) => `生成产物校验失败: ${path}`,
  ({ path }) => `Generated output checksum mismatch: ${path}`
)

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

export interface PackedGeneratedFile {
  relativePath: string
  data: Buffer
}

export async function writeAipackageArchive(
  filePath: string,
  input: {
    name: string
    appVersion: string
    entries: PackedPackageEntry[]
    generated?: PackedGeneratedFile[]
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
    if (!folder) throw fail(E_PACKAGE_CREATE_ENTRY_FAILED)
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

  const generated = input.generated ?? []
  if (generated.length) {
    const generatedFiles: NonNullable<AssetPackageManifest['generatedFiles']> = []
    for (const file of generated) {
      const sha = sha256Buffer(file.data)
      zip.file(`generated/${file.relativePath}`, file.data)
      generatedFiles.push({
        relativePath: file.relativePath,
        sha256: sha,
        size: file.data.length
      })
    }
    manifest.generatedFiles = generatedFiles
    zip.file('generated.json', JSON.stringify(generatedFiles, null, 2))
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
  generated: PackedGeneratedFile[]
}> {
  const raw = readFileSync(filePath)
  // Soft zip-bomb guard: reject absurd ratios later via entry sizes
  if (raw.length > 2 * 1024 * 1024 * 1024) {
    throw fail(MAIN_ERRORS.packageTooLarge)
  }
  const zip = await JSZip.loadAsync(raw)
  const manifestFile = zip.file('manifest.json')
  if (!manifestFile) throw fail(MAIN_ERRORS.packageMissingManifest)
  const manifest = JSON.parse(await manifestFile.async('string')) as AssetPackageManifest
  if (manifest.format !== AIPACKAGE_FORMAT) {
    throw fail(MAIN_ERRORS.packageUnknownFormat, { format: String(manifest.format) })
  }
  if (manifest.formatVersion !== AIPACKAGE_FORMAT_VERSION) {
    throw fail(MAIN_ERRORS.packageUnsupportedVersion, { version: String(manifest.formatVersion) })
  }
  if (!Array.isArray(manifest.entries) || manifest.entries.length === 0) {
    throw fail(MAIN_ERRORS.packageEmptyEntries)
  }
  if (manifest.entries.length > 50_000) {
    throw fail(MAIN_ERRORS.packageTooManyEntries)
  }

  const entries: ReadPackageEntry[] = []
  for (const listed of manifest.entries) {
    const pathnameFile = zip.file(`${listed.guid}/pathname`)
    const metaFile = zip.file(`${listed.guid}/asset.meta`)
    const assetFile = zip.file(`${listed.guid}/asset`)
    if (!pathnameFile || !metaFile || !assetFile) {
      throw fail(MAIN_ERRORS.packageIncompleteEntry, { guid: listed.guid })
    }
    const pathname = (await pathnameFile.async('string')).split(/\r?\n/)[0]?.trim() ?? ''
    const metaText = await metaFile.async('string')
    const payload = Buffer.from(await assetFile.async('uint8array'))
    if (pathname !== listed.pathname) {
      throw fail(E_PACKAGE_PATHNAME_MISMATCH, { guid: listed.guid })
    }
    if (sha256Buffer(payload) !== listed.payloadSha256) {
      throw fail(E_PACKAGE_PAYLOAD_CHECKSUM_FAILED, { guid: listed.guid })
    }
    if (sha256Buffer(Buffer.from(metaText, 'utf8')) !== listed.metaSha256) {
      throw fail(E_PACKAGE_META_CHECKSUM_FAILED, { guid: listed.guid })
    }
    if (payload.length !== listed.payloadSize) {
      throw fail(E_PACKAGE_PAYLOAD_SIZE_MISMATCH, { guid: listed.guid })
    }
    if (payload.length > 512 * 1024 * 1024) {
      throw fail(E_PACKAGE_ENTRY_TOO_LARGE, { guid: listed.guid })
    }
    const meta = JSON.parse(metaText) as AssetPackageMeta
    if (meta.guid !== listed.guid || meta.kind !== listed.kind) {
      throw fail(MAIN_ERRORS.packageMetaMismatch, { guid: listed.guid })
    }
    entries.push({
      guid: listed.guid,
      pathname: listed.pathname,
      meta,
      payload,
      role: listed.role
    })
  }

  const generated: PackedGeneratedFile[] = []
  const listedGenerated = Array.isArray(manifest.generatedFiles) ? manifest.generatedFiles : []
  if (listedGenerated.length > 50_000) {
    throw fail(MAIN_ERRORS.packageTooManyOutputs)
  }
  for (const item of listedGenerated) {
    const relativePath = String(item.relativePath ?? '')
      .trim()
      .replace(/\\/g, '/')
    if (!relativePath || relativePath.includes('..') || relativePath.startsWith('/')) {
      throw fail(E_PACKAGE_INVALID_GENERATED_PATH, { path: relativePath })
    }
    const file = zip.file(`generated/${relativePath}`)
    if (!file) throw fail(E_PACKAGE_MISSING_GENERATED_FILE, { path: relativePath })
    const data = Buffer.from(await file.async('uint8array'))
    if (data.length !== item.size) {
      throw fail(E_PACKAGE_GENERATED_SIZE_MISMATCH, { path: relativePath })
    }
    if (data.length > 512 * 1024 * 1024) {
      throw fail(E_PACKAGE_GENERATED_TOO_LARGE, { path: relativePath })
    }
    if (sha256Buffer(data) !== item.sha256) {
      throw fail(E_PACKAGE_GENERATED_CHECKSUM_FAILED, { path: relativePath })
    }
    generated.push({ relativePath, data })
  }

  return { manifest, entries, generated }
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
    throw fail(MAIN_ERRORS.packageTooLarge)
  }
  const zip = await JSZip.loadAsync(raw)
  const manifestFile = zip.file('manifest.json')
  if (!manifestFile) throw fail(MAIN_ERRORS.packageMissingManifest)
  const manifest = JSON.parse(await manifestFile.async('string')) as AssetPackageManifest
  if (manifest.format !== AIPACKAGE_FORMAT) {
    throw fail(MAIN_ERRORS.packageUnknownFormat, { format: String(manifest.format) })
  }
  if (manifest.formatVersion !== AIPACKAGE_FORMAT_VERSION) {
    throw fail(MAIN_ERRORS.packageUnsupportedVersion, { version: String(manifest.formatVersion) })
  }
  if (!Array.isArray(manifest.entries) || manifest.entries.length === 0) {
    throw fail(MAIN_ERRORS.packageEmptyEntries)
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
      throw fail(MAIN_ERRORS.packageIncompleteEntry, { guid: listed.guid })
    }
    const pathname = (await pathnameFile.async('string')).split(/\r?\n/)[0]?.trim() ?? ''
    const meta = JSON.parse(await metaFile.async('string')) as AssetPackageMeta
    if (meta.guid !== listed.guid || meta.kind !== listed.kind) {
      throw fail(MAIN_ERRORS.packageMetaMismatch, { guid: listed.guid })
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
