import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join, relative as pathRelative } from 'path'
import { randomUUID } from 'crypto'
import {
  ASSET_MODEL_OUTPUT_KIND_DIR,
  normalizeProjectRelativeDir,
  resolveCacheOutputRoot
} from '@shared/domain'
import {
  BLENDER_JOB_READBACK_CODE,
  BLENDER_RIG_QA_CODE,
  blenderExecuteStdout,
  blenderJobOverlayReady,
  buildBlenderJobBrief,
  isRigQaPass,
  mergeBlenderJobOverlay,
  parseBlenderJobMetaLine,
  parseBlenderJobResult,
  parseRigQaReport,
  type BlenderDshJobKind,
  type BlenderJobResult
} from '@shared/blenderDshJob'
import {
  AIAE_RIG_QA_PREFIX,
  BLENDER_RIG_PREPARE_EXPORT_CODE,
  RIG_QA_COMMAND_TIMEOUT_MS,
  RIG_QA_TRANSIENT_RETRIES_PER_EVAL,
  isTransientBlenderError,
  isTransientRigQa,
  parsePrefixedJson,
  transientQaBackoffMs,
  type RigQaReport
} from '@shared/blenderRigSkinPipeline'
import { blenderToolSpec } from '@shared/blenderMcp'
import type {
  EvaluateBlenderDshJobInput,
  EvaluateBlenderDshJobResult,
  FinalizeBlenderDshJobInput,
  PrepareBlenderDshJobInput,
  PrepareBlenderDshJobResult
} from '@shared/ipc'
import { uniqueFileName } from '../repositories/assetTreeStore'
import { probeBlenderAddon, resetBlenderMcpConnection, runBlenderTool } from './blenderMcpService'
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
  mkdirSync(join(dir, 'qa'), { recursive: true })
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
      skillId: input.skillId,
      briefAbs
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function qaExecFail(attempt: number, message: string): RigQaReport {
  const transient = isTransientBlenderError(message)
  return {
    pass: false,
    attempt,
    fingerprint: transient ? `transient:${message.slice(0, 80)}` : `err:${message}`,
    boneCount: 0,
    requiredBonesOk: false,
    parentChainOk: false,
    vertexGroupCount: 0,
    unweightedRatio: 1,
    maxInfluences: 0,
    weightSumError: 1,
    zeroInfluenceBones: [],
    deformMeshes: [],
    bones: [],
    poseMetrics: [],
    fails: [
      {
        code: transient ? 'QA_TRANSIENT' : 'QA_EXEC',
        message
      }
    ],
    notes: transient
      ? ['Blender MCP connection dropped during QA; app will retry before treating as skin failure']
      : []
  }
}

async function runRigQaCode(attempt: number): Promise<RigQaReport | undefined> {
  const spec = blenderToolSpec('execute_blender_code')
  if (!spec) return undefined
  let lastFail: RigQaReport | undefined
  for (let tryIndex = 0; tryIndex < RIG_QA_TRANSIENT_RETRIES_PER_EVAL; tryIndex++) {
    try {
      if (tryIndex > 0) {
        // Blender 主线程可能仍在消化上一轮重 QA；强制丢弃半死 TCP 后再探活
        resetBlenderMcpConnection()
        await sleep(transientQaBackoffMs(tryIndex))
        await probeBlenderAddon().catch(() => undefined)
        await sleep(Math.min(400 * tryIndex, 2000))
      }
      const outcome = await runBlenderTool(
        spec,
        { code: BLENDER_RIG_QA_CODE },
        { timeoutMs: RIG_QA_COMMAND_TIMEOUT_MS }
      )
      if (outcome.error) {
        lastFail = qaExecFail(attempt, outcome.error)
        if (!isTransientRigQa(lastFail)) return lastFail
        continue
      }
      const stdout = blenderExecuteStdout(outcome.result)
      const parsed =
        parsePrefixedJson(stdout, AIAE_RIG_QA_PREFIX) ?? parsePrefixedJson(stdout, 'AIAE_RIG_QA:')
      const qa = parseRigQaReport(parsed, attempt)
      if (qa) return qa
      lastFail = qaExecFail(attempt, 'QA marker missing from Blender stdout')
      return lastFail
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      lastFail = qaExecFail(attempt, message)
      if (!isTransientRigQa(lastFail)) return lastFail
    }
  }
  return lastFail
}

async function captureQaScreenshots(
  jobId: string,
  attempt: number
): Promise<{ abs: string[]; relative: string[] }> {
  const root = projectService.getRoot()
  // 必须落在 job 目录之外：run 结束 cleanupBlenderDshJob 会整夹删除 BlenderJobs/{id}
  const cacheRoot = resolveCacheOutputRoot(projectService.getConfig()?.cacheOutputDir)
  const shotOut =
    normalizeProjectRelativeDir(`${cacheRoot}/RigQa/${jobId}`) || `Cache/RigQa/${jobId}`
  const dir = join(root, shotOut)
  mkdirSync(dir, { recursive: true })
  const spec = blenderToolSpec('get_viewport_screenshot')
  if (!spec) return { abs: [], relative: [] }
  const abs: string[] = []
  const relative: string[] = []
  try {
    const outcome = await runBlenderTool(spec, { max_size: 800 })
    const images = outcome.images ?? []
    let i = 0
    for (const img of images) {
      const data = typeof img.data === 'string' ? img.data : ''
      if (!data) continue
      const fileName = `attempt-${attempt}-${i + 1}.png`
      const fileAbs = join(dir, fileName)
      writeFileSync(fileAbs, Buffer.from(data, 'base64'))
      abs.push(fileAbs)
      relative.push(toPosix(pathRelative(root, fileAbs)))
      i += 1
    }
  } catch {
    /* screenshot is best-effort */
  }
  return { abs, relative }
}

function enrichRigMetaFromQa(base: BlenderJobResult, qa: RigQaReport): BlenderJobResult {
  // 瞬时 QA 失败时不要用空 bone 列表覆盖场景里已有的骨架元数据
  const keepSceneMeta = isTransientRigQa(qa) || qa.bones.length === 0
  const bones = qa.bones.map((b) => b.name)
  const vertexGroups = bones.filter((name) => !qa.zeroInfluenceBones.includes(name))
  const rigMeta = keepSceneMeta
    ? {
        armature: base.rigMeta?.armature || 'Armature',
        bones: base.rigMeta?.bones?.length ? base.rigMeta.bones : bones,
        vertexGroups: base.rigMeta?.vertexGroups?.length ? base.rigMeta.vertexGroups : vertexGroups,
        ...(base.rigMeta?.presetId ? { presetId: base.rigMeta.presetId } : {}),
        ...(base.rigMeta?.boneGeom?.length
          ? { boneGeom: base.rigMeta.boneGeom }
          : qa.bones.length
            ? { boneGeom: qa.bones }
            : {}),
        ...(base.rigMeta?.deformMeshes?.length
          ? { deformMeshes: base.rigMeta.deformMeshes }
          : qa.deformMeshes.length
            ? { deformMeshes: qa.deformMeshes }
            : {})
      }
    : {
        armature: base.rigMeta?.armature || 'Armature',
        bones: bones.length ? bones : base.rigMeta?.bones || [],
        vertexGroups: vertexGroups.length ? vertexGroups : base.rigMeta?.vertexGroups || [],
        ...(base.rigMeta?.presetId ? { presetId: base.rigMeta.presetId } : {}),
        ...(qa.bones.length ? { boneGeom: qa.bones } : {}),
        ...(qa.deformMeshes.length ? { deformMeshes: qa.deformMeshes } : {})
      }
  return {
    ...base,
    kind: 'rig',
    rigMeta,
    rigQa: qa,
    ok: isRigQaPass(qa),
    ...(isRigQaPass(qa)
      ? {}
      : {
          error: isTransientRigQa(qa) ? 'GRAPH_MODEL_RIG_MCP' : 'GRAPH_MODEL_RIG_QA'
        })
  }
}

export async function evaluateBlenderDshJob(
  input: EvaluateBlenderDshJobInput
): Promise<EvaluateBlenderDshJobResult> {
  const attempt = Math.max(1, Math.floor(input.attempt || 1))
  const fromScene = await readBlenderJobScene('rig')
  const qa = await runRigQaCode(attempt)
  let screenshotRelativePaths: string[] = []
  if (input.captureScreenshots !== false) {
    const shots = await captureQaScreenshots(input.jobId, attempt)
    screenshotRelativePaths = shots.relative
  }
  if (!qa) {
    return {
      result: {
        ok: false,
        kind: 'rig',
        error: 'GRAPH_MODEL_RIG_QA',
        ...(fromScene?.rigMeta ? { rigMeta: fromScene.rigMeta } : {})
      },
      screenshotRelativePaths
    }
  }
  qa.screenshots = screenshotRelativePaths
  qa.attempt = attempt
  let result = enrichRigMetaFromQa(
    fromScene || { ok: false, kind: 'rig', error: 'GRAPH_MODEL_RIG_QA' },
    qa
  )
  const root = projectService.getRoot()
  const resultAbs = join(jobDir(root, input.jobId), 'result.json')
  try {
    writeFileSync(resultAbs, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  } catch {
    /* ephemeral */
  }
  return { result, screenshotRelativePaths }
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

async function prepareRigExport(): Promise<void> {
  const spec = blenderToolSpec('execute_blender_code')
  if (!spec) return
  try {
    await runBlenderTool(spec, { code: BLENDER_RIG_PREPARE_EXPORT_CODE })
  } catch {
    /* best effort */
  }
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

  if (kind === 'rig' && input.requireRigQaPass !== false) {
    if (!parsed.rigQa || !isRigQaPass(parsed.rigQa)) {
      return {
        relativePath: '',
        result: {
          ...parsed,
          ok: false,
          error: parsed.error || 'GRAPH_MODEL_RIG_QA'
        }
      }
    }
    await prepareRigExport()
  }

  const needOverlay = !blenderJobOverlayReady(kind, parsed)
  const needFile = !existsSync(outputAbs)
  if (needOverlay || needFile) {
    if (kind !== 'rig') {
      const fromBlender = await readBlenderJobScene(kind)
      parsed = mergeBlenderJobOverlay(parsed, fromBlender)
    }
    if (kind === 'rig' || blenderJobOverlayReady(kind, parsed) || needFile) {
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

  // Persist QA screenshots under a cook-key name when present (already outside BlenderJobs)
  const stableQaRel: string[] = []
  if (parsed.rigQa?.screenshots?.length) {
    const shotOut = normalizeProjectRelativeDir(`${cacheRoot}/RigQa`) || 'Cache/RigQa'
    const shotAbsDir = join(root, shotOut)
    mkdirSync(shotAbsDir, { recursive: true })
    for (const rel of parsed.rigQa.screenshots) {
      const src = join(root, rel)
      if (!existsSync(src)) continue
      const base = uniqueFileName(
        shotAbsDir,
        `${input.key || 'rig'}-${rel.split('/').pop() || 'qa.png'}`
      )
      const dest = join(shotAbsDir, base)
      if (toPosix(pathRelative(root, src)) !== toPosix(pathRelative(root, dest))) {
        copyFileSync(src, dest)
      }
      stableQaRel.push(toPosix(pathRelative(root, dest)))
    }
    if (stableQaRel.length && parsed.rigQa) {
      parsed = {
        ...parsed,
        rigQa: { ...parsed.rigQa, screenshots: stableQaRel },
        qa: { screenshots: stableQaRel, notes: parsed.qa?.notes }
      }
    }
  }

  const relativePath = toPosix(pathRelative(root, destAbs))
  return {
    relativePath,
    result: { ...parsed, exportedPath: parsed.exportedPath || destAbs, ok: true }
  }
}

export function cleanupBlenderDshJob(jobId: string): void {
  const id = String(jobId ?? '').trim()
  if (!id || id.includes('..') || id.includes('/') || id.includes('\\')) return
  const root = projectService.getRoot()
  const dir = jobDir(root, id)
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
}
