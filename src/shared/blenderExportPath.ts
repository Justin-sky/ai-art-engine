import {
  isUnderAssetLibraryDir,
  isUnderCacheOutputDir,
  normalizeProjectRelativeDir,
  toProjectRelativeDir
} from './domain'

const JOB_PREFIX = 'Cache/BlenderJobs/'

export type BlenderExportTarget =
  | { action: 'keep'; relativePath: string; isJob: boolean }
  | { action: 'remap'; fileName: string }

function posixFileName(path: string): string {
  const posix = path.replace(/\\/g, '/').replace(/\/+$/, '')
  const base = posix.slice(posix.lastIndexOf('/') + 1).trim()
  return base || 'export.glb'
}

function ensureExportFileName(name: string): string {
  if (/\.(glb|gltf|fbx|obj|usd|stl)$/i.test(name)) return name
  return `${name.replace(/\.[^.]+$/, '') || 'export'}.glb`
}

/**
 * 对话里 Blender 导出必须落 Cache，才能出预览卡并让用户「保存到资产库」。
 * 图节点作业目录 Cache/BlenderJobs 原样保留。
 */
export function classifyBlenderExportTarget(input: {
  requestedPath: string
  projectRoot: string
  cacheOutputDir?: string | null
}): BlenderExportTarget {
  const fileName = ensureExportFileName(posixFileName(input.requestedPath))
  const relative = toProjectRelativeDir(input.requestedPath, input.projectRoot)
  const posix = normalizeProjectRelativeDir(relative)
  if (!posix) return { action: 'remap', fileName }
  if (posix === 'Cache/BlenderJobs' || posix.startsWith(JOB_PREFIX)) {
    return { action: 'keep', relativePath: posix, isJob: true }
  }
  if (
    isUnderCacheOutputDir(posix, input.cacheOutputDir) &&
    !isUnderAssetLibraryDir(posix)
  ) {
    return { action: 'keep', relativePath: posix, isJob: false }
  }
  return { action: 'remap', fileName }
}
