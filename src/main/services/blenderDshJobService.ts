import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join, relative } from 'path'
import { randomUUID } from 'crypto'
import {
  ASSET_MODEL_OUTPUT_KIND_DIR,
  normalizeProjectRelativeDir,
  resolveCacheOutputRoot
} from '@shared/domain'
import {
  BLENDER_JOB_READBACK_CODE,
  blenderExecuteStdout,
  blenderJobOverlayReady,
  buildBlenderJobBrief,
  mergeBlenderJobOverlay,
  parseBlenderJobMetaLine,
  parseBlenderJobResult,
  type BlenderDshJobKind,
  type BlenderJobResult
} from '@shared/blenderDshJob'
import { blenderToolSpec } from '@shared/blenderMcp'
import type {
  FinalizeBlenderDshJobInput,
  PrepareBlenderDshJobInput,
  PrepareBlenderDshJobResult
} from '@shared/ipc'
import { uniqueFileName } from '../repositories/assetTreeStore'
import { runBlenderTool } from './blenderMcpService'
import { projectService } from './projectService'

const JOB_ROOT = 'Cache/BlenderJobs'

function toPosix(path: string): string {
  return path.replace(/\\/g, '/')
}

function jobDir(root: string, jobId: string): string {
  return join(root, JOB_ROOT, jobId)
}

export function prepareBlenderDshJob(input: PrepareBlenderDshJobInput): PrepareBlenderDshJobResult {
  const root = projectService.getRoot()
  const source = String(input.sourceRelativePath ?? '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
  if (!source || source.includes('..')) throw new Error('GRAPH_MODEL_DSH_NO_MODEL')
  const sourceAbs = join(root, source)
  if (!existsSync(sourceAbs)) throw new Error('GRAPH_MODEL_DSH_NO_MODEL')

  const jobId = randomUUID()
  const dir = jobDir(root, jobId)
  mkdirSync(dir, { recursive: true })
  const inputAbs = join(dir, 'input.glb')
  const outputAbs = join(dir, 'output.glb')
  const resultAbs = join(dir, 'result.json')
  const briefAbs = join(dir, 'brief.md')
  copyFileSync(sourceAbs, inputAbs)
  writeFileSync(
    briefAbs,
    buildBlenderJobBrief({
      kind: input.kind,
      instruction: input.instruction,
      locale: input.locale,
      inputAbs,
      outputAbs,
      resultAbs,
      skillId: input.skillId
    }),
    'utf8'
  )
  return { jobId, inputAbs, outputAbs, resultAbs, briefAbs }
}

async function readBlenderJobScene(kind: BlenderDshJobKind): Promise<BlenderJobResult | undefined> {
  const spec = blenderToolSpec('execute_blender_code')
  if (!spec) return undefined
  try {
    const outcome = await runBlenderTool(spec, { code: BLENDER_JOB_READBACK_CODE })
    if (outcome.error) return undefined
    return parseBlenderJobMetaLine(blenderExecuteStdout(outcome.result), kind)
  } catch {
    return undefined
  }
}

async function exportJobGlb(outputAbs: string): Promise<boolean> {
  const spec = blenderToolSpec('export_scene')
  if (!spec) return existsSync(outputAbs)
  try {
    const outcome = await runBlenderTool(spec, { filepath: outputAbs, format: 'glb' })
    if (outcome.error) return existsSync(outputAbs)
  } catch {
    return existsSync(outputAbs)
  }
  return existsSync(outputAbs)
}

export async function finalizeBlenderDshJob(input: FinalizeBlenderDshJobInput): Promise<{
  relativePath: string
  result: BlenderJobResult
}> {
  const root = projectService.getRoot()
  const dir = jobDir(root, input.jobId)
  const outputAbs = join(dir, 'output.glb')
  const resultAbs = join(dir, 'result.json')
  const kind = input.kind as BlenderDshJobKind
  let parsed: BlenderJobResult = {
    ok: false,
    kind,
    error: 'GRAPH_MODEL_DSH_RESULT'
  }
  if (existsSync(resultAbs)) {
    try {
      parsed = parseBlenderJobResult(readFileSync(resultAbs, 'utf8'), kind)
    } catch {
      parsed = { ok: false, kind, error: 'GRAPH_MODEL_DSH_RESULT' }
    }
  }

  const needOverlay = !blenderJobOverlayReady(kind, parsed)
  const needFile = !existsSync(outputAbs)
  if (needOverlay || needFile) {
    const fromBlender = await readBlenderJobScene(kind)
    parsed = mergeBlenderJobOverlay(parsed, fromBlender)
    if (blenderJobOverlayReady(kind, parsed) && (needOverlay || needFile)) {
      await exportJobGlb(outputAbs)
      try {
        writeFileSync(resultAbs, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8')
      } catch {
        /* job dir is ephemeral */
      }
    }
  }

  if (!existsSync(outputAbs)) {
    return {
      relativePath: '',
      result: { ...parsed, ok: false, error: parsed.error || 'GRAPH_MODEL_DSH_EXPORT' }
    }
  }
  const cacheRoot = resolveCacheOutputRoot(projectService.getConfig()?.cacheOutputDir)
  const outDir =
    normalizeProjectRelativeDir(`${cacheRoot}/${ASSET_MODEL_OUTPUT_KIND_DIR}`) ||
    `Cache/${ASSET_MODEL_OUTPUT_KIND_DIR}`
  const destDirAbs = join(root, outDir)
  mkdirSync(destDirAbs, { recursive: true })
  const fileName = uniqueFileName(destDirAbs, `${input.key || 'model'}.glb`)
  const destAbs = join(destDirAbs, fileName)
  copyFileSync(outputAbs, destAbs)
  const relativePath = toPosix(relative(root, destAbs))
  return {
    relativePath,
    result: { ...parsed, exportedPath: parsed.exportedPath || destAbs }
  }
}

export function cleanupBlenderDshJob(jobId: string): void {
  const id = String(jobId ?? '').trim()
  if (!id || id.includes('..') || id.includes('/') || id.includes('\\')) return
  const root = projectService.getRoot()
  const dir = jobDir(root, id)
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
}
