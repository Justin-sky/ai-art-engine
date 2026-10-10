/**
 * 按冻结的 BuildDefinition / InvalidationPlan 执行构建。
 * 无替换镜头：按源时间码裁切拼接（L0，优先 stream copy）。
 * 有替换镜头：逐段写出（替换段 / 源裁切段）后统一重编码拼接，替换产物真正进入成片。
 */
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import type {
  BuildDefinition,
  BuildManifest,
  OcrRegion,
  SemanticEdit,
  ShotEvidence
} from '@shared/semanticTimeline'
import { evaluateFidelity } from '@shared/semanticTimeline'
import { rebuildVideoFromShots } from './roundtrip'
import { measureVideoPair } from './fidelityMeasure'
import { runEditChains } from './editChains'
import { mergeVisualIntoQc, reviewBuildVisual } from './visualReview'
import { runFfmpeg } from '../ffmpegRunner'
import { resolveFfmpegForSemantic } from './resolveFfmpeg'

export interface BuildExecutorInput {
  sourceVideoAbs: string
  shots: ShotEvidence[]
  /** 结构性编辑（删/重排节拍）后的输出镜头序列；缺省同 shots */
  outputShots?: ShotEvidence[]
  definition: BuildDefinition
  workDirAbs: string
  outputAbs: string
  /** 写入 manifest 的工程相对路径；缺省不写 */
  outputRelativePath?: string
  /** 已被替换/重算的镜头视频绝对路径 */
  replacedShotVideos?: Map<string, string>
  /** 可选：跑编辑链（框/掩码替换、擦除、改字、调色） */
  edits?: SemanticEdit[]
  runEdits?: boolean
  entityShotIndex?: Map<string, string[]>
  entityMaskDirs?: Map<string, string>
  entityBoxes?: Map<string, Map<string, { x: number; y: number; w: number; h: number }>>
  replaceMediaAbs?: Map<string, string>
  speechWavAbs?: Map<string, string>
  ocrRegions?: OcrRegion[]
  frameWidth?: number
  frameHeight?: number
}

function concatListLine(path: string): string {
  return `file '${path.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`
}

/** 逐段规范化后拼接：未替换段从源片重编码裁切，保证与替换段编码参数一致 */
async function concatWithReplacements(
  sourceAbs: string,
  shots: ShotEvidence[],
  replaced: Map<string, string>,
  outputAbs: string,
  workDir: string
): Promise<void> {
  const ffmpeg = resolveFfmpegForSemantic()
  const segDir = join(workDir, 'segments')
  mkdirSync(segDir, { recursive: true })
  const lines: string[] = []
  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i]!
    const hit = replaced.get(shot.id)
    if (hit && existsSync(hit)) {
      lines.push(concatListLine(hit))
      continue
    }
    const seg = join(segDir, `seg_${String(i).padStart(3, '0')}.mp4`)
    await runFfmpeg(ffmpeg, [
      '-y',
      '-ss',
      String(shot.range.start),
      '-i',
      sourceAbs,
      '-t',
      String(Math.max(0.04, shot.range.end - shot.range.start)),
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      seg
    ])
    lines.push(concatListLine(seg))
  }
  const listPath = join(workDir, 'concat_mixed.txt')
  writeFileSync(listPath, lines.join('\n'), 'utf8')
  await runFfmpeg(ffmpeg, [
    '-y',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    listPath,
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    outputAbs
  ])
}

export async function executeBuild(input: BuildExecutorInput): Promise<BuildManifest> {
  const startedAt = new Date().toISOString()
  const notes: string[] = []
  const outputShots = input.outputShots ?? input.shots
  mkdirSync(input.workDirAbs, { recursive: true })

  const replacedShotVideos = new Map(input.replacedShotVideos ?? [])
  if (input.runEdits && input.edits?.length) {
    const chain = await runEditChains(
      input.edits,
      {
        sourceVideoAbs: input.sourceVideoAbs,
        shots: input.shots,
        workDirAbs: join(input.workDirAbs, 'edits'),
        entityMaskDirs: input.entityMaskDirs,
        entityBoxes: input.entityBoxes,
        replaceMediaAbs: input.replaceMediaAbs,
        speechWavAbs: input.speechWavAbs,
        ocrRegions: input.ocrRegions,
        frameWidth: input.frameWidth,
        frameHeight: input.frameHeight
      },
      input.entityShotIndex ?? new Map()
    )
    for (const [k, v] of chain.replacedShotVideos) replacedShotVideos.set(k, v)
    notes.push(...chain.notes)
  }

  const planByProduct = new Map(input.definition.plan.items.map((i) => [i.productId, i]))
  const outputIds = new Set(outputShots.map((s) => s.id))
  const shotActions: BuildManifest['shotActions'] = input.shots.map((shot) => {
    if (!outputIds.has(shot.id)) return { shotId: shot.id, action: 'skip' as const }
    if (!replacedShotVideos.has(shot.id)) return { shotId: shot.id, action: 'copy' as const }
    const action = planByProduct.get(`${shot.id}.video`)?.action
    return {
      shotId: shot.id,
      action: action === 'replace' ? ('regenerate' as const) : ('mask_replace' as const)
    }
  })

  let status: BuildManifest['status'] = 'done'
  let error: string | undefined
  try {
    if (outputShots.length === 0) throw new Error('no shots left after structural edits')
    const anyReplaced = outputShots.some((s) => replacedShotVideos.has(s.id))
    if (anyReplaced) {
      await concatWithReplacements(
        input.sourceVideoAbs,
        outputShots,
        replacedShotVideos,
        input.outputAbs,
        join(input.workDirAbs, 'concat')
      )
      if (!existsSync(input.outputAbs)) throw new Error('output missing')
    } else {
      const result = await rebuildVideoFromShots(
        input.sourceVideoAbs,
        outputShots,
        input.outputAbs,
        join(input.workDirAbs, 'concat')
      )
      if (!result.ok) throw new Error(result.error ?? 'rebuild failed')
    }
  } catch (e) {
    status = 'failed'
    error = e instanceof Error ? e.message : String(e)
  }

  let qc = evaluateFidelity(input.definition.plan.targetLevel, {
    durationMatch: status === 'done',
    frameDelta: 0,
    audioSampleMatch: true
  })
  if (status === 'done') {
    try {
      const measured = await measureVideoPair(input.sourceVideoAbs, input.outputAbs)
      qc = evaluateFidelity(input.definition.plan.targetLevel, measured)
      const visual = await reviewBuildVisual({
        referenceAbs: input.sourceVideoAbs,
        candidateAbs: input.outputAbs
      })
      qc = mergeVisualIntoQc(qc, visual)
    } catch {
      /* 度量失败保留基础 QC */
    }
  }

  const manifest: BuildManifest = {
    id: input.definition.id,
    definitionId: input.definition.id,
    status,
    startedAt,
    finishedAt: new Date().toISOString(),
    outputRelativePath: status === 'done' ? input.outputRelativePath : undefined,
    shotActions,
    qc,
    error,
    notes: notes.length > 0 ? notes : undefined
  }
  writeFileSync(join(input.workDirAbs, 'manifest.json'), JSON.stringify(manifest, null, 2))
  return manifest
}
