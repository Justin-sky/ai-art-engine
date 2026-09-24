import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join, relative as pathRelative } from 'path'
import { randomUUID } from 'crypto'
import {
  BLOCKOUT_JOB_ROOT,
  MAX_BLOCKOUT_DSH_REFS,
  buildBlockoutJobBrief,
  parseBlockoutJobResult,
  validateBlockoutJobDelivery,
  type BlockoutJobResult
} from '@shared/blockoutDshJob'
import type {
  PrepareBlockoutDshJobInput,
  PrepareBlockoutDshJobResult,
  ValidateBlockoutDshJobInput,
  ValidateBlockoutDshJobResult
} from '@shared/ipc'
import { projectService } from './projectService'

function toPosix(path: string): string {
  return path.replace(/\\/g, '/')
}

function jobDir(root: string, jobId: string): string {
  return join(root, BLOCKOUT_JOB_ROOT, jobId)
}

function writeDataUrlImage(absPath: string, dataUrl: string): void {
  const trimmed = dataUrl.trim()
  const m = /^data:([^;,]+)?(;base64)?,([\s\S]+)$/i.exec(trimmed)
  if (!m) {
    throw new Error('BLOCKOUT_REF_NOT_DATA_URL')
  }
  const isBase64 = (m[2] || '').toLowerCase().includes('base64')
  const payload = m[3] || ''
  const buf = isBase64
    ? Buffer.from(payload, 'base64')
    : Buffer.from(decodeURIComponent(payload), 'utf8')
  writeFileSync(absPath, buf)
}

export function prepareBlockoutDshJob(
  input: PrepareBlockoutDshJobInput
): PrepareBlockoutDshJobResult {
  const root = projectService.getRoot()
  const jobId = randomUUID()
  const dir = jobDir(root, jobId)
  const refsAbs = join(dir, 'refs')
  const resultAbs = join(dir, 'result.json')
  const briefAbs = join(dir, 'brief.md')
  mkdirSync(refsAbs, { recursive: true })

  const images = (input.images ?? [])
    .map((u) => u.trim())
    .filter(Boolean)
    .slice(0, MAX_BLOCKOUT_DSH_REFS)
  if (!images.length) throw new Error('BLOCKOUT_NO_IMAGES')

  const refRelativePaths: string[] = []
  images.forEach((dataUrl, i) => {
    const mime = /^data:([^;,]+)/i.exec(dataUrl.trim())?.[1]?.toLowerCase() ?? 'image/png'
    const ext =
      mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : mime.includes('webp') ? 'webp' : 'png'
    const fileName = `${i}.${ext}`
    const abs = join(refsAbs, fileName)
    writeDataUrlImage(abs, dataUrl)
    refRelativePaths.push(toPosix(pathRelative(root, abs)))
  })

  const layoutMode: 'perspective' | 'panorama' =
    input.layoutMode === 'panorama' ? 'panorama' : 'perspective'
  const briefInput = {
    instruction: input.instruction,
    locale: input.locale,
    layoutMode,
    systemPrompt: input.systemPrompt,
    userPrompt: input.userPrompt,
    resultAbs,
    briefAbs,
    refRelativePaths
  } as const
  writeFileSync(briefAbs, buildBlockoutJobBrief(briefInput), 'utf8')
  writeFileSync(resultAbs, JSON.stringify({ ok: false, error: 'pending' }, null, 2), 'utf8')

  return {
    jobId,
    resultAbs,
    briefAbs,
    refRelativePaths,
    jobRelativeDir: toPosix(pathRelative(root, dir))
  }
}

export function readBlockoutJobResult(resultAbs: string): BlockoutJobResult | null {
  if (!existsSync(resultAbs)) return null
  try {
    return parseBlockoutJobResult(readFileSync(resultAbs, 'utf8'))
  } catch {
    return null
  }
}

export function validatePreparedBlockoutJob(
  input: ValidateBlockoutDshJobInput
): ValidateBlockoutDshJobResult {
  const result = readBlockoutJobResult(input.resultAbs)
  const err = validateBlockoutJobDelivery(result)
  if (err) return { ok: false, error: err }
  return {
    ok: true,
    summary: result?.summary,
    resultText: readFileSync(input.resultAbs, 'utf8')
  }
}
