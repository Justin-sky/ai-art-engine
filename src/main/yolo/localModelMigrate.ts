/**
 * 把旧的平面模型目录收进 local-models/{yolo,face,sam2}。
 * 目标里已有同名文件时保留目标，不覆盖。
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
  type Dirent
} from 'fs'
import { dirname, join, resolve } from 'path'
import {
  FACE_MODEL_SUBDIR,
  LEGACY_LOCAL_MODELS_DIR_NAME,
  looseOnnxBucket,
  SAM2_MODEL_SUBDIR,
  YOLO_MODEL_SUBDIR
} from '@shared/localModelLayout'

const BUNDLED_MANIFEST = '.bundled-models.json'

export function migrateLocalModelLayout(userData: string, modelRoot: string): void {
  const legacy = join(userData, LEGACY_LOCAL_MODELS_DIR_NAME)
  if (resolve(legacy) !== resolve(modelRoot)) absorbLegacy(legacy, modelRoot)
  flattenLooseOnnx(modelRoot)
}

function absorbLegacy(legacy: string, modelRoot: string): void {
  if (!existsSync(legacy)) return
  mkdirSync(modelRoot, { recursive: true })
  for (const entry of list(legacy)) {
    if (!entry.isFile()) continue
    const bucket = looseOnnxBucket(entry.name)
    if (!bucket) continue
    moveFile(join(legacy, entry.name), join(modelRoot, bucket, entry.name))
  }
  moveOnnxDir(join(legacy, YOLO_MODEL_SUBDIR), join(modelRoot, YOLO_MODEL_SUBDIR))
  moveOnnxDir(join(legacy, FACE_MODEL_SUBDIR), join(modelRoot, FACE_MODEL_SUBDIR))
  moveOnnxDir(join(legacy, SAM2_MODEL_SUBDIR), join(modelRoot, SAM2_MODEL_SUBDIR), true)
  mergeManifest(join(legacy, BUNDLED_MANIFEST), join(modelRoot, BUNDLED_MANIFEST))
  removeIfEmpty(join(legacy, SAM2_MODEL_SUBDIR))
  removeIfEmpty(join(legacy, YOLO_MODEL_SUBDIR))
  removeIfEmpty(join(legacy, FACE_MODEL_SUBDIR))
  removeIfEmpty(legacy)
}

function flattenLooseOnnx(modelRoot: string): void {
  if (!existsSync(modelRoot)) return
  for (const entry of list(modelRoot)) {
    if (!entry.isFile()) continue
    const bucket = looseOnnxBucket(entry.name)
    if (!bucket) continue
    moveFile(join(modelRoot, entry.name), join(modelRoot, bucket, entry.name))
  }
}

function moveOnnxDir(from: string, to: string, anyFile = false): void {
  if (!existsSync(from)) return
  for (const entry of list(from)) {
    if (!entry.isFile()) continue
    if (!anyFile && !entry.name.toLowerCase().endsWith('.onnx')) continue
    moveFile(join(from, entry.name), join(to, entry.name))
  }
}

function moveFile(src: string, dest: string): void {
  if (resolve(src) === resolve(dest) || existsSync(dest) || !existsSync(src)) return
  mkdirSync(dirname(dest), { recursive: true })
  try {
    renameSync(src, dest)
  } catch {
    copyFileSync(src, dest)
    unlinkSync(src)
  }
}

function mergeManifest(fromPath: string, toPath: string): void {
  const from = readManifest(fromPath)
  if (!existsSync(fromPath) && from.length === 0) return
  const merged = [...new Set([...readManifest(toPath), ...from])]
  if (merged.length > 0) {
    mkdirSync(dirname(toPath), { recursive: true })
    writeFileSync(toPath, JSON.stringify(merged))
  }
  if (existsSync(fromPath) && resolve(fromPath) !== resolve(toPath)) unlinkSync(fromPath)
}

function readManifest(path: string): string[] {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown
    return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function list(dir: string): Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

function removeIfEmpty(dir: string): void {
  try {
    if (list(dir).length === 0) rmSync(dir, { recursive: true })
  } catch {
    /* 目录仍被占用时留到下次启动 */
  }
}
