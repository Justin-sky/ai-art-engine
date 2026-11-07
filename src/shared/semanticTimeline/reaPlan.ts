/**
 * Multi-route remake planner (`R01..R21`), DP Generation-Unit batcher (`G1..Gk`),
 * Shooting Setups (`S1..Sk`), Code Render Specs (`C1..Ck`), Local FFmpeg Motion Units (`K1..Kk`),
 * and instant `<5ms` `finalizeSemanticBreakdown()` re-evaluator.
 *
 * Ported & adapted from `rea-video` (`plan.py`, `production.py`, `entities.py`, `pipeline.py`).
 */
import { shotSignature } from './migrate'
import { keyframeProjectPath } from './storage'
import {
  applySceneGroupConsistency,
  classifySoundSources,
  fuseShotClassification,
  hsvBhattacharyyaDistance,
  inferCodeRenderStyle,
  interpretColorGrade,
  interpretLightingSetup
} from './reaClassify'
import {
  PRODUCTION_LABEL_META,
  type AudioForensicAnalysis,
  type BreakdownAnalysis,
  type BreakdownLang,
  type BreakdownSummary,
  type CastCharacterSpec,
  type CastPropSpec,
  type CastSceneSpec,
  type CodeCompositionSpec,
  type CodeRenderStyleKind,
  type ContainerProvenance,
  type GenerationUnit,
  type LocalMotionUnit,
  type ProductionBaseLabel,
  type ReaProductionPlan,
  type ShotReplicationRoute,
  type ShootingSetup,
  type WholeVideoAnalysis
} from './reaTypes'
import type { DialogueLine, Entity, EntityKind, SemanticShot, SemanticTimeline } from './types'

const MAX_UNIT_DURATION_SEC = 15.0
const MAX_SHOTS_PER_UNIT = 4
const MAX_INSERT_BRIDGE_SEC = 3.5
const SCENE_HIST_THRESHOLD = 0.36

export const CODE_STYLE_RECIPES: Record<CodeRenderStyleKind, { zh: string; en: string }> = {
  particles: {
    zh: 'Canvas 2D / Three.js 粒子场：暗色背景 + 加法混色粒子发射器 + 缓动镜头漂移', // cjk-ok
    en: 'Canvas 2D / Three.js particle system on dark ground with additive glow & gentle drift'
  },
  lineart: {
    zh: 'SVG stroke-dasharray / Remotion 路径描边动画：浅色底板 + 均匀矢量线条逐步绘制', // cjk-ok
    en: 'SVG stroke-dasharray / Remotion path-draw animation on clean light ground'
  },
  procedural: {
    zh: 'GLSL Fragment Shader / WebGL 程序化噪声与几何场渲染', // cjk-ok
    en: 'GLSL fragment shader / WebGL procedural field animation'
  },
  neon: {
    zh: 'CSS/SVG 多层 drop-shadow 辉光矢量图形 + 暗底高饱和双色描边动画', // cjk-ok
    en: 'SVG/CSS multi-pass neon glow strokes on dark ground'
  },
  data: {
    zh: 'Remotion / D3 / ECharts 数据可视化组件：柱状/折线/数字滚动弹性插值动画', // cjk-ok
    en: 'Remotion / D3 animated chart & counter layout with spring interpolation'
  },
  ui: {
    zh: 'HTML/CSS + Remotion 界面组件模板：圆角卡片、阴影、光标点击与高亮弹入', // cjk-ok
    en: 'HTML/CSS + Remotion UI card layout with cursor/highlight spring transitions'
  },
  gradient: {
    zh: 'CSS Mesh Gradient / Canvas 流体渐变背景 + 居中排版动效', // cjk-ok
    en: 'Animated mesh gradient backdrop with clean centered typography'
  },
  type: {
    zh: 'Remotion 动力学大字排版（Kinetic Typography）：按词卡点缩放/滑入与高对比色块切换', // cjk-ok
    en: 'Remotion kinetic typography: beat-synced word pop/slide on stark color blocks'
  },
  shapes: {
    zh: 'Remotion / Motion Canvas 扁平几何图形（MG 动画）：色块拼贴与弹性关键帧转场', // cjk-ok
    en: 'Remotion / Motion Canvas flat geometric motion graphics with spring easing'
  }
}

const FRAMING_SIZE_ZH: Record<string, string> = {
  ecu: '大特写', // cjk-ok
  cu: '特写', // cjk-ok
  mcu: '近景', // cjk-ok
  ms: '中景', // cjk-ok
  fs: '全景', // cjk-ok
  ls: '远景' // cjk-ok
}

const FRAMING_SIZE_EN: Record<string, string> = {
  ecu: 'extreme close-up',
  cu: 'close-up',
  mcu: 'medium close-up',
  ms: 'medium shot',
  fs: 'full shot',
  ls: 'wide shot'
}

function r2(n: number): number {
  return Number((Number.isFinite(n) ? n : 0).toFixed(2))
}

function shotDuration(shot: SemanticShot): number {
  return Math.max(0.1, (shot.range?.end ?? 0) - (shot.range?.start ?? 0))
}

function shotIndexLabel(index: number): string {
  return `#${index + 1}`
}

/** Synthesize positive-only first-frame image prompt and motion+end-state video prompt. */
export function buildReaShotPrompts(input: {
  shot: SemanticShot
  entities: Entity[]
  castByEntityId: Map<string, CastCharacterSpec | CastPropSpec>
  aspectRatioLabel: string
  lang: BreakdownLang
}): { imagePrompt: string; videoPrompt: string; referenceTags: string[] } {
  const { shot, entities, castByEntityId, aspectRatioLabel, lang } = input
  const sep = lang === 'en' ? ', ' : '，'
  const referenceTags: string[] = []

  // 1. Cast / Subject appearance with `@图片` reference locking
  const subjectParts: string[] = []
  const actionParts: string[] = []
  for (const sub of shot.subjects ?? []) {
    if (!sub?.name?.trim()) continue
    const castSpec = sub.entityId ? castByEntityId.get(sub.entityId) : undefined
    const ent = sub.entityId ? entities.find((e) => e.id === sub.entityId) : undefined
    const tag = castSpec?.refTag
    if (tag && !referenceTags.includes(tag)) referenceTags.push(tag)
    const look =
      castSpec && 'look' in castSpec && castSpec.look
        ? `（${castSpec.look}）`
        : ent?.replacement?.instruction
          ? `（${ent.replacement.instruction}）`
          : ''
    const subjectName = tag ? `${tag} ${sub.name.trim()}${look}` : `${sub.name.trim()}${look}`
    subjectParts.push(subjectName)
    if (sub.action?.trim()) {
      actionParts.push(
        lang === 'en'
          ? `${sub.name.trim()} ${sub.action.trim()}`
          : `${sub.name.trim()}${sub.action.trim()}`
      )
    }
  }

  const framingCode = shot.forensics?.aspects?.framing?.shotSize
  const shotSize =
    shot.camera?.shotSize?.trim() ||
    (framingCode
      ? lang === 'en'
        ? FRAMING_SIZE_EN[framingCode]
        : FRAMING_SIZE_ZH[framingCode]
      : '')
  const angle = shot.camera?.angle?.trim() || ''
  const camMove =
    shot.camera?.motion?.trim() ||
    (shot.forensics?.aspects?.camera?.move === 'push_in'
      ? lang === 'en'
        ? 'slow push-in'
        : '镜头平稳推进' // cjk-ok
      : shot.forensics?.aspects?.camera?.move === 'pull_out'
        ? lang === 'en'
          ? 'slow pull-out'
          : '镜头平稳拉远' // cjk-ok
        : shot.forensics?.aspects?.camera?.move === 'pan_track'
          ? lang === 'en'
            ? 'smooth pan/track'
            : '镜头平滑横移跟拍' // cjk-ok
          : lang === 'en'
            ? 'steady camera'
            : '固定稳拍机位') // cjk-ok

  const visDesc = shot.visual?.description?.trim() || ''
  const lighting =
    shot.visual?.lighting?.trim() ||
    shot.forensics?.aspects?.lighting?.setupName ||
    shot.forensics?.aspects?.lighting?.keyDirection ||
    ''
  const grade = shot.visual?.grade?.trim() || shot.forensics?.aspects?.grade?.look || ''
  const style = shot.visual?.style?.trim() || ''

  const imageParts = [
    aspectRatioLabel,
    shotSize,
    angle,
    subjectParts.join(lang === 'en' ? ' and ' : '与'), // cjk-ok
    visDesc,
    lighting,
    grade,
    style
  ].filter(Boolean)

  const imagePrompt =
    imageParts.join(sep) ||
    (lang === 'en'
      ? `${aspectRatioLabel}, clean cinematic frame`
      : `${aspectRatioLabel}，清晰电影感构图`) // cjk-ok

  if (shot.promptOverride?.trim()) {
    return {
      imagePrompt,
      videoPrompt: shot.promptOverride.trim(),
      referenceTags
    }
  }

  // Positive-only video prompt: initial frame anchor + motion process + end state + camera movement
  const motionProcess =
    actionParts.join(sep) ||
    visDesc ||
    (lang === 'en'
      ? 'subject moves naturally with coherent physics and stable identity'
      : '主体动作自然连贯，保持人物与环境细节稳定一致') // cjk-ok
  const endState =
    lang === 'en' ? 'settling smoothly into a clear ending pose' : '动作自然收束并稳定落幅' // cjk-ok

  const videoParts = [
    referenceTags.length ? referenceTags.join(' ') : '',
    shotSize,
    angle,
    motionProcess,
    endState,
    camMove,
    lighting,
    grade,
    style
  ].filter(Boolean)

  return {
    imagePrompt,
    videoPrompt: videoParts.join(sep),
    referenceTags
  }
}

/** Route a single shot to its `rea-video` replication rule (`R01..R21`) and executor. */
export function planShotReplication(input: {
  shot: SemanticShot
  entities: Entity[]
  castByEntityId: Map<string, CastCharacterSpec | CastPropSpec>
  aspectRatioLabel: string
  lang: BreakdownLang
}): ShotReplicationRoute {
  const { shot, lang } = input
  const label: ProductionBaseLabel = shot.base?.label ?? 'live_action'
  const prompts = buildReaShotPrompts(input)
  const notes: string[] = []

  const hasRealMaterial = (shot.material?.items ?? []).some((it) => it.realMaterial === true)
  if (hasRealMaterial) {
    notes.push(
      lang === 'en'
        ? 'Contains embedded real material (UI/footage/product) — supply real asset rather than generating'
        : '含内嵌真实素材（实操界面/实拍商品/原片），需提供真实素材替换，不可直接让视频模型凭空生成' // cjk-ok
    )
  }

  switch (label) {
    case 'static_hold':
      return {
        ruleId: 'R08-static-hold',
        executor: 'local_ffmpeg',
        mode: 'static_hold',
        imagePrompt: prompts.imagePrompt,
        videoPrompt: prompts.videoPrompt,
        remakeNotes: [
          lang === 'en'
            ? 'Zero-cost local FFmpeg static hold from keyframe (0 video model calls)'
            : '本地 FFmpeg 单张关键帧静帧直出（0 视频模型调用，字迹/细节零损耗）', // cjk-ok
          ...notes
        ]
      }

    case 'still_motion': {
      const z = ((shot.forensics?.zoomPerSec ?? 0) * 100).toFixed(1)
      const p = ((shot.forensics?.panPxPerSec ?? 0) * 100).toFixed(1)
      return {
        ruleId: 'R07-still-kenburns',
        executor: 'local_ffmpeg',
        mode: 'ken_burns',
        imagePrompt: prompts.imagePrompt,
        videoPrompt: prompts.videoPrompt,
        remakeNotes: [
          lang === 'en'
            ? `Zero-cost local FFmpeg Ken Burns render (zoom ${z}%/s, pan ${p}%/s)`
            : `本地 FFmpeg 复刻刚性推拉（缩放 ${z}%/s，平移 ${p}%/s，无需调视频生成模型）`, // cjk-ok
          ...notes
        ]
      }
    }

    case 'ai_video':
      return {
        ruleId: shot.keyframes?.last ? 'R02-ai-first-last' : 'R03-ai-i2v',
        executor: 'video_gen',
        mode: shot.keyframes?.last ? 'first_last_frame' : 'image_to_video',
        imagePrompt: prompts.imagePrompt,
        videoPrompt: prompts.videoPrompt,
        remakeNotes: notes
      }

    case 'cg_3d':
      return {
        ruleId: 'R05-cg3d-gen',
        executor: 'video_gen',
        mode: shot.keyframes?.last ? 'first_last_frame' : 'image_to_video',
        imagePrompt: prompts.imagePrompt,
        videoPrompt: prompts.videoPrompt,
        remakeNotes: [
          lang === 'en'
            ? 'Replicate via 3D-styled first/last-frame AI video generation or Blender scene'
            : '通过 3D 渲染风格首尾帧生成复刻（高精度工业结构建议 Blender 渲染）', // cjk-ok
          ...notes
        ]
      }

    case 'anim_2d':
      return {
        ruleId: 'R09-anim2d-gen',
        executor: 'video_gen',
        mode: shot.keyframes?.last ? 'first_last_frame' : 'image_to_video',
        imagePrompt: prompts.imagePrompt,
        videoPrompt: prompts.videoPrompt,
        remakeNotes: notes
      }

    case 'avatar':
      return {
        ruleId: 'R04-avatar-tts',
        executor: 'avatar_tts',
        mode: 'reference_video',
        imagePrompt: prompts.imagePrompt,
        videoPrompt: prompts.videoPrompt,
        remakeNotes: [
          lang === 'en'
            ? 'Drive portrait + TTS audio via lip-sync / talking-head model'
            : '使用人物定妆参考图 + TTS 配音走数字人/对口型管线驱动', // cjk-ok
          ...notes
        ]
      }

    case 'code_render': {
      const codeStyle = inferCodeRenderStyle(shot.forensics)
      return {
        ruleId: 'R06-code-render',
        executor: 'code_render',
        codeStyle,
        imagePrompt: prompts.imagePrompt,
        videoPrompt: prompts.videoPrompt,
        remakeNotes: [
          lang === 'en' ? CODE_STYLE_RECIPES[codeStyle].en : CODE_STYLE_RECIPES[codeStyle].zh,
          ...notes
        ]
      }
    }

    case 'screen_capture':
      return {
        ruleId: 'R10-screen-capture',
        executor: 'screen_record',
        imagePrompt: prompts.imagePrompt,
        videoPrompt: prompts.videoPrompt,
        remakeNotes: [
          lang === 'en'
            ? 'Real software/screen recording — re-record on target UI or keep source clip'
            : '真实软件界面录屏——需在目标软件实操重录或保留原片，切勿喂给视频模型（文字必乱）', // cjk-ok
          ...notes
        ]
      }

    case 'stop_motion':
      return {
        ruleId: 'R11-stop-motion',
        executor: 'reshoot',
        mode: 'image_to_video',
        imagePrompt: prompts.imagePrompt,
        videoPrompt: prompts.videoPrompt,
        remakeNotes: notes
      }

    case 'film_footage':
      return {
        ruleId: 'R12-film-clip',
        executor: 'passthrough',
        imagePrompt: prompts.imagePrompt,
        videoPrompt: prompts.videoPrompt,
        remakeNotes: [
          lang === 'en'
            ? 'Source film/broadcast clip — cut from licensed source material'
            : '影视/番剧成片片段——需从对应原片素材裁切替换', // cjk-ok
          ...notes
        ]
      }

    case 'live_action':
    default:
      return {
        ruleId: 'R01-live-action',
        executor: 'reshoot',
        mode: 'first_last_frame',
        imagePrompt: prompts.imagePrompt,
        videoPrompt: prompts.videoPrompt,
        remakeNotes: [
          lang === 'en'
            ? 'Live-action shot — reshoot per Shooting Setup (or use masked first-frame + I2V for local element replacement)'
            : '实拍镜头——按机位布光方案重拍（若仅做局部换人/换商品，可走首帧掩码重绘 + 图生视频）', // cjk-ok
          ...notes
        ]
      }
  }
}

/** DP split of a same-scene generative shot run into units of <=15s and <=4 shots (`rea_video/production.py`). */
function splitGenerativeRun(shots: SemanticShot[]): SemanticShot[][] {
  const n = shots.length
  if (n === 0) return []
  if (n === 1) return [shots]

  const dpCost = new Array<number>(n + 1).fill(Number.POSITIVE_INFINITY)
  const dpNext = new Array<number>(n + 1).fill(n)
  dpCost[n] = 0

  for (let i = n - 1; i >= 0; i -= 1) {
    let dur = 0
    for (let j = i; j < Math.min(n, i + MAX_SHOTS_PER_UNIT); j += 1) {
      dur += shotDuration(shots[j]!)
      if (j > i && dur > MAX_UNIT_DURATION_SEC) break
      // Prefer compact multi-shot calls around 6–12s without tiny 1-shot orphans
      const idealPenalty = Math.abs(dur - 9.0) * 0.08
      const cost = 1.0 + idealPenalty + dpCost[j + 1]!
      if (cost < dpCost[i]!) {
        dpCost[i] = cost
        dpNext[i] = j + 1
      }
    }
  }

  const chunks: SemanticShot[][] = []
  let idx = 0
  while (idx < n) {
    const end = Math.max(idx + 1, dpNext[idx]!)
    chunks.push(shots.slice(idx, end))
    idx = end
  }
  return chunks
}

function formatAspectRatio(w: number, h: number): string {
  if (!w || !h) return '16:9'
  const ratio = w / h
  if (Math.abs(ratio - 9 / 16) < 0.08) return '9:16 竖屏' // cjk-ok
  if (Math.abs(ratio - 16 / 9) < 0.08) return '16:9 横屏' // cjk-ok
  if (Math.abs(ratio - 1) < 0.08) return '1:1 方画幅' // cjk-ok
  if (Math.abs(ratio - 3 / 4) < 0.08) return '3:4 竖画幅' // cjk-ok
  if (Math.abs(ratio - 4 / 3) < 0.08) return '4:3 横画幅' // cjk-ok
  return `${w}×${h}`
}

/** Derive cross-shot Cast (`characters`, `scenes`, `props`) from entities + wholeVideo + HSV clusters. */
export function deriveTimelineCast(
  doc: SemanticTimeline,
  shots: SemanticShot[],
  existingWhole?: WholeVideoAnalysis
): NonNullable<WholeVideoAnalysis['cast']> {
  const existingCast = existingWhole?.cast
  const characters: CastCharacterSpec[] = []
  const props: CastPropSpec[] = []
  let refIdx = 1

  const personEntities = (doc.entities ?? []).filter((e) => e.kind === 'person')
  for (const ent of personEntities) {
    const shotIds = (ent.appearances ?? []).map((a) => a.shotId)
    const matched = existingCast?.characters?.find(
      (c) => c.entityId === ent.id || c.name === ent.name
    )
    characters.push({
      id: matched?.id ?? `C${characters.length + 1}`,
      entityId: ent.id,
      name: ent.name,
      kind: matched?.kind ?? 'human',
      look: matched?.look || ent.replacement?.instruction || '保持统一服装、发型与面部特征一致', // cjk-ok
      role: matched?.role,
      voice: matched?.voice,
      refTag: `@图片${refIdx++}`, // cjk-ok
      shotIds
    })
  }
  if (characters.length === 0 && existingCast?.characters?.length) {
    for (const c of existingCast.characters) {
      characters.push({
        ...c,
        refTag: c.refTag || `@图片${refIdx++}` // cjk-ok
      })
    }
  }

  const propEntities = (doc.entities ?? []).filter(
    (e) => e.kind === 'product' || e.kind === 'object' || e.kind === 'logo'
  )
  for (const ent of propEntities) {
    const shotIds = (ent.appearances ?? []).map((a) => a.shotId)
    const matched = existingCast?.props?.find((p) => p.entityId === ent.id || p.name === ent.name)
    props.push({
      id: matched?.id ?? `P${props.length + 1}`,
      entityId: ent.id,
      name: ent.name,
      note: matched?.note ?? ent.replacement?.instruction,
      realMaterial: matched?.realMaterial ?? (ent.kind === 'product' || ent.kind === 'logo'),
      refTag: `@图片${refIdx++}`, // cjk-ok
      shotIds
    })
  }

  // Scene clustering via HSV histogram similarity
  const scenes: CastSceneSpec[] = existingCast?.scenes?.length ? [...existingCast.scenes] : []
  if (scenes.length === 0 && shots.length > 0) {
    const assigned = new Set<string>()
    for (let i = 0; i < shots.length; i += 1) {
      const s = shots[i]!
      if (assigned.has(s.id)) continue
      const groupIds = [s.id]
      assigned.add(s.id)
      for (let j = i + 1; j < shots.length; j += 1) {
        const other = shots[j]!
        if (assigned.has(other.id)) continue
        if (
          s.forensics?.hsvHist?.length &&
          other.forensics?.hsvHist?.length &&
          hsvBhattacharyyaDistance(s.forensics.hsvHist, other.forensics.hsvHist) <=
            SCENE_HIST_THRESHOLD
        ) {
          groupIds.push(other.id)
          assigned.add(other.id)
        }
      }
      const light = s.forensics?.aspects?.lighting?.setupName || s.visual?.lighting || ''
      const grade = s.forensics?.aspects?.grade?.look || s.visual?.grade || ''
      scenes.push({
        id: `SC${scenes.length + 1}`,
        where: s.visual?.description || `场景 ${scenes.length + 1}`, // cjk-ok
        look: [light, grade].filter(Boolean).join(' · ') || '统一环境光线与色调', // cjk-ok
        shotIds: groupIds
      })
    }
  }

  return { characters, scenes, props }
}

/** Compile the complete `rea-video` Production & Remake Plan (`G1..Gk`, `S1..Sk`, `C1..Ck`, `K1..Kk`). */
export function buildReaProductionPlan(input: {
  doc: SemanticTimeline
  shots: SemanticShot[]
  cast: NonNullable<WholeVideoAnalysis['cast']>
  mode?: 'fidelity' | 'adapt'
  lang?: BreakdownLang
}): { plan: ReaProductionPlan; unitByShotId: Map<string, string> } {
  const { doc, shots, cast } = input
  const lang = input.lang ?? 'zh'
  const hasReplacements = (doc.entities ?? []).some((e) =>
    Boolean(e.replacement?.references?.length || e.replacement?.instruction?.trim())
  )
  const mode: 'fidelity' | 'adapt' = input.mode ?? (hasReplacements ? 'adapt' : 'fidelity')
  const activeShots = shots.filter((s) => !s.removed)
  const unitByShotId = new Map<string, string>()
  const aspectLabel = formatAspectRatio(doc.source.width, doc.source.height)

  const sceneByShot = new Map<string, CastSceneSpec>()
  for (const sc of cast.scenes) {
    for (const sid of sc.shotIds) sceneByShot.set(sid, sc)
  }

  // 1. Group generative shots (`video_gen`) into Generation Units `G1..Gk`, bridging short UI/static inserts
  const units: GenerationUnit[] = []
  let i = 0
  while (i < activeShots.length) {
    const cur = activeShots[i]!
    if (cur.replication?.executor !== 'video_gen') {
      i += 1
      continue
    }
    const runShots: SemanticShot[] = [cur]
    const bridgedInserts: string[] = []
    const baseSceneId = sceneByShot.get(cur.id)?.id
    let j = i + 1
    while (j < activeShots.length) {
      const cand = activeShots[j]!
      if (cand.replication?.executor === 'video_gen') {
        const sameScene =
          (baseSceneId && sceneByShot.get(cand.id)?.id === baseSceneId) ||
          hsvBhattacharyyaDistance(cur.forensics?.hsvHist, cand.forensics?.hsvHist) <=
            SCENE_HIST_THRESHOLD
        if (!sameScene) break
        runShots.push(cand)
        j += 1
        continue
      }
      // Check if cand is a short non-generative insert (`code_render`/`screen_capture`/`local_ffmpeg`) followed by same scene
      const candDur = shotDuration(cand)
      const after = activeShots[j + 1]
      if (
        candDur <= MAX_INSERT_BRIDGE_SEC &&
        after &&
        after.replication?.executor === 'video_gen' &&
        ((baseSceneId && sceneByShot.get(after.id)?.id === baseSceneId) ||
          hsvBhattacharyyaDistance(cur.forensics?.hsvHist, after.forensics?.hsvHist) <=
            SCENE_HIST_THRESHOLD)
      ) {
        bridgedInserts.push(cand.id)
        runShots.push(after)
        j += 2
        continue
      }
      break
    }
    i = j

    for (const subRun of splitGenerativeRun(runShots)) {
      const unitId = `G${units.length + 1}`
      for (const s of subRun) unitByShotId.set(s.id, unitId)
      const sc = sceneByShot.get(subRun[0]!.id)
      const sceneHeader = [aspectLabel, sc?.where, sc?.look].filter(Boolean).join(' · ')
      const refSet = new Set<string>()
      const perShotPrompts = subRun.map((s, idx) => {
        const imgP = s.replication?.imagePrompt || ''
        const vidP = s.replication?.videoPrompt || ''
        for (const m of `${imgP} ${vidP}`.match(/@图片\d+/g) ?? []) refSet.add(m) // cjk-ok
        return {
          shotId: s.id,
          durationSec: r2(shotDuration(s)),
          imagePrompt: imgP,
          videoPrompt:
            subRun.length > 1
              ? `[镜头${idx + 1} ${shotDuration(s).toFixed(1)}s] ${vidP}` // cjk-ok
              : vidP
        }
      })
      const totalDur = r2(subRun.reduce((acc, s) => acc + shotDuration(s), 0))
      const firstShot = subRun[0]!
      const combinedVideoPrompt = [
        sceneHeader ? `【统一场景设定】${sceneHeader}` : '', // cjk-ok
        ...perShotPrompts.map((p) => p.videoPrompt)
      ]
        .filter(Boolean)
        .join('；')

      const override = doc.breakdown?.unitPromptOverrides?.[unitId]
      const finalImagePrompt = override?.imagePrompt?.trim()
        ? override.imagePrompt.trim()
        : (firstShot.replication?.imagePrompt ?? '')
      const finalVideoPrompt = override?.videoPrompt?.trim()
        ? override.videoPrompt.trim()
        : combinedVideoPrompt
      const userEditedPrompt = Boolean(
        override?.imagePrompt?.trim() || override?.videoPrompt?.trim()
      )

      units.push({
        id: unitId,
        shotIds: subRun.map((s) => s.id),
        ...(bridgedInserts.length ? { bridgedInsertShotIds: bridgedInserts } : {}),
        sceneHeader,
        conditioningMode:
          firstShot.replication?.mode === 'first_last_frame'
            ? 'first_last_frame'
            : 'image_to_video',
        referenceTags: [...refSet],
        durationSec: totalDur,
        imagePrompt: finalImagePrompt,
        videoPrompt: finalVideoPrompt,
        ...(userEditedPrompt ? { userEditedPrompt: true } : {}),
        perShotPrompts,
        estimatedApiCalls: 1
      })
    }
  }

  // 2. Group filmed shots (`reshoot`) into Shooting Setups `S1..Sk`
  const shootingSetups: ShootingSetup[] = []
  const reshootMap = new Map<string, SemanticShot[]>()
  for (const s of activeShots) {
    if (s.replication?.executor !== 'reshoot') continue
    const scId = sceneByShot.get(s.id)?.id ?? 'SC1'
    const size = s.camera?.shotSize || s.forensics?.aspects?.framing?.shotSize || 'ms'
    const sup = s.forensics?.aspects?.camera?.support || 'fixed'
    const key = `${scId}|${size}|${sup}`
    const arr = reshootMap.get(key) ?? []
    arr.push(s)
    reshootMap.set(key, arr)
  }
  for (const group of reshootMap.values()) {
    const id = `S${shootingSetups.length + 1}`
    for (const s of group) unitByShotId.set(s.id, id)
    const lead = group[0]!
    const sc = sceneByShot.get(lead.id)
    const li = lead.forensics?.aspects?.lighting
    const sizeCode = lead.forensics?.aspects?.framing?.shotSize
    shootingSetups.push({
      id,
      shotIds: group.map((s) => s.id),
      sceneLabel:
        sc?.where ||
        (lang === 'en'
          ? `Location ${shootingSetups.length + 1}`
          : `实拍场景 ${shootingSetups.length + 1}`), // cjk-ok
      shotSize:
        lead.camera?.shotSize ||
        (sizeCode
          ? lang === 'en'
            ? FRAMING_SIZE_EN[sizeCode]
            : FRAMING_SIZE_ZH[sizeCode]
          : undefined),
      cameraSupport: lead.forensics?.aspects?.camera?.support,
      lightingSetup: li?.setupName,
      lightingDetail: li?.setupDetail,
      gear: li?.gear ?? [],
      aiFallbackPrompt: lead.replication?.videoPrompt
    })
  }

  // 3. Group `code_render` shots into Code Compositions `C1..Ck`
  const codeSpecs: CodeCompositionSpec[] = []
  const codeMap = new Map<CodeRenderStyleKind, SemanticShot[]>()
  for (const s of activeShots) {
    if (s.replication?.executor !== 'code_render') continue
    const st = s.replication.codeStyle ?? 'ui'
    const arr = codeMap.get(st) ?? []
    arr.push(s)
    codeMap.set(st, arr)
  }
  for (const [style, group] of codeMap.entries()) {
    const id = `C${codeSpecs.length + 1}`
    for (const s of group) unitByShotId.set(s.id, id)
    const palette = [...new Set(group.flatMap((s) => s.forensics?.dominantHexPalette ?? []))].slice(
      0,
      6
    )
    const textTracks = [
      ...new Set(
        group.flatMap((s) => (s.layers ?? []).map((l) => l.text?.trim() ?? '').filter(Boolean))
      )
    ]
    codeSpecs.push({
      id,
      shotIds: group.map((s) => s.id),
      codeStyle: style,
      durationSec: r2(group.reduce((acc, s) => acc + shotDuration(s), 0)),
      palette,
      textTracks,
      recipeZh: CODE_STYLE_RECIPES[style].zh,
      recipeEn: CODE_STYLE_RECIPES[style].en
    })
  }

  // 4. Local FFmpeg Ken Burns / Static Hold Units `K1..Kk`
  const localUnits: LocalMotionUnit[] = []
  for (const s of activeShots) {
    if (s.replication?.executor !== 'local_ffmpeg') continue
    const id = `K${localUnits.length + 1}`
    unitByShotId.set(s.id, id)
    const kfRel = s.keyframes?.first ?? s.keyframes?.middle
    localUnits.push({
      id,
      shotId: s.id,
      mode: s.replication.mode === 'ken_burns' ? 'ken_burns' : 'static_hold',
      durationSec: r2(shotDuration(s)),
      anchorKeyframePath: kfRel ? keyframeProjectPath(doc.id, kfRel) : undefined,
      zoomPerSec: s.forensics?.zoomPerSec ?? 0,
      panPxPerSec: s.forensics?.panPxPerSec ?? 0,
      panDirDeg: s.forensics?.panDirDeg ?? 0
    })
  }

  // 5. Real user assets checklist
  const userAssetsNeeded: ReaProductionPlan['userAssetsNeeded'] = []
  for (const s of activeShots) {
    if (s.base?.label === 'screen_capture') {
      userAssetsNeeded.push({
        shotId: s.id,
        kind: lang === 'en' ? 'Screen recording' : '真实录屏素材', // cjk-ok
        description:
          s.visual?.description ||
          (lang === 'en' ? 'Software UI operation clip' : '软件/网页实操录屏片段') // cjk-ok
      })
    } else if (s.base?.label === 'film_footage') {
      userAssetsNeeded.push({
        shotId: s.id,
        kind: lang === 'en' ? 'Source film clip' : '原片影视片段', // cjk-ok
        description:
          s.visual?.description ||
          (lang === 'en' ? 'Original broadcast/film footage' : '对应影视原片裁切素材') // cjk-ok
      })
    }
    for (const item of s.material?.items ?? []) {
      if (item.realMaterial === true) {
        userAssetsNeeded.push({
          shotId: s.id,
          kind: item.kind,
          description: item.description
        })
      }
    }
  }

  const partsZh: string[] = []
  const partsEn: string[] = []
  if (units.length) {
    partsZh.push(
      `${units.length} 个 AI 生成单元（共 ${units.reduce((a, u) => a + u.shotIds.length, 0)} 镜）` // cjk-ok
    )
    partsEn.push(`${units.length} AI generation unit(s)`)
  }
  if (shootingSetups.length) {
    partsZh.push(`${shootingSetups.length} 组实拍机位方案`) // cjk-ok
    partsEn.push(`${shootingSetups.length} shooting setup(s)`)
  }
  if (codeSpecs.length) {
    partsZh.push(`${codeSpecs.length} 组代码/模板渲染工程`) // cjk-ok
    partsEn.push(`${codeSpecs.length} code composition(s)`)
  }
  if (localUnits.length) {
    partsZh.push(`${localUnits.length} 镜本地 FFmpeg 零成本推拉/静帧`) // cjk-ok
    partsEn.push(`${localUnits.length} zero-cost local FFmpeg unit(s)`)
  }

  return {
    plan: {
      mode,
      units,
      shootingSetups,
      codeSpecs,
      localUnits,
      userAssetsNeeded,
      summaryZh: partsZh.join(' + ') || '原片直通还原', // cjk-ok
      summaryEn: partsEn.join(' + ') || 'Direct passthrough'
    },
    unitByShotId
  }
}

export interface FinalizeBreakdownOptions {
  provenance?: ContainerProvenance
  audioAnalysis?: AudioForensicAnalysis
  wholeVideo?: Partial<WholeVideoAnalysis>
  vlmStatus?: BreakdownSummary['vlmStatus']
  storyboardRelativePath?: string
  reportRelativePath?: string
  mode?: 'fidelity' | 'adapt'
  lang?: BreakdownLang
  /** 当视觉模型未产出实体时，是否基于确定性人脸肤色/HSV聚类与口播台词兜底生成实体轨道 */
  synthesizeFallbackEntities?: boolean
}

function entitySlug(text: string): string {
  const cleaned = text
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^\p{L}\p{N}-]+/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
  return cleaned.slice(0, 24) || 'entity'
}

function uniqueEntityId(base: string, used: Set<string>): string {
  let id = base
  let n = 2
  while (used.has(id)) id = `${base}-${n++}`
  used.add(id)
  return id
}

const PLACEHOLDER_SUBJECT_NAMES = new Set([
  'none',
  'n/a',
  'null',
  'unknown',
  'empty',
  '无', // cjk-ok
  '空镜', // cjk-ok
  '无主体', // cjk-ok
  '未知' // cjk-ok
])

function resolveFlexibleShotId(
  raw: string,
  activeShots: SemanticShot[],
  byShotId: Map<string, SemanticShot>
): string | undefined {
  const s = raw.trim()
  if (!s) return undefined
  if (byShotId.has(s)) return s
  const idxMatch = /^(?:#|s)?(\d+)$/i.exec(s)
  if (idxMatch) {
    const idx = Number(idxMatch[1])
    if (idx >= 1 && idx <= activeShots.length) return activeShots[idx - 1]?.id
  }
  const unpadded = /^shot\.0*(\d+)$/i.exec(s)
  if (unpadded) {
    const padded = `shot.${unpadded[1]!.padStart(4, '0')}`
    if (byShotId.has(padded)) return padded
  }
  return undefined
}

function syncEntitiesAndSubjects<T extends SemanticShot>(input: {
  entities: Entity[]
  shots: T[]
  dialogue: DialogueLine[]
  wholeVideo: WholeVideoAnalysis
  synthesizeFallback: boolean
  lang: BreakdownLang
}): { entities: Entity[]; shots: T[] } {
  const { dialogue, wholeVideo, synthesizeFallback, lang } = input
  const entities: Entity[] = input.entities.map((e) => ({
    ...e,
    appearances: [...(e.appearances ?? [])]
  }))
  const usedIds = new Set(entities.map((e) => e.id))
  const shots = input.shots.map((s) => ({
    ...s,
    subjects: [...(s.subjects ?? []).map((sub) => ({ ...sub }))]
  }))
  const activeShots = shots.filter((s) => !s.removed)
  const byShotId = new Map(activeShots.map((s) => [s.id, s]))
  const shotOrder = new Map(activeShots.map((s, idx) => [s.id, idx]))

  const upsert = (kind: EntityKind, rawName: string, rawShotIds: string[]): Entity | undefined => {
    const name = rawName.trim()
    if (!name || PLACEHOLDER_SUBJECT_NAMES.has(name.toLowerCase())) return undefined
    const validIds = [
      ...new Set(
        rawShotIds
          .map((id) => resolveFlexibleShotId(id, activeShots, byShotId))
          .filter((id): id is string => Boolean(id))
      )
    ].sort((a, b) => (shotOrder.get(a) ?? 0) - (shotOrder.get(b) ?? 0))
    if (validIds.length === 0) return undefined

    let target = entities.find(
      (e) => e.kind === kind && e.name.trim().toLowerCase() === name.toLowerCase()
    )
    if (!target) {
      target = {
        id: uniqueEntityId(`ent.${kind}.${entitySlug(name)}`, usedIds),
        kind,
        name,
        appearances: [],
        pixelEditable: false
      }
      entities.push(target)
    }
    const have = new Set(target.appearances.map((a) => a.shotId))
    for (const sid of validIds) {
      if (have.has(sid)) continue
      const shot = byShotId.get(sid)
      if (!shot) continue
      target.appearances.push({ shotId: sid, range: shot.range })
      have.add(sid)
    }
    target.appearances.sort(
      (a, b) => (shotOrder.get(a.shotId) ?? 0) - (shotOrder.get(b.shotId) ?? 0)
    )
    return target
  }

  // 1. VLM wholeVideo.cast → entities + subject bindings
  const propNameSet = new Set(
    (wholeVideo.cast?.props ?? []).map((p) => p.name.trim().toLowerCase()).filter(Boolean)
  )
  for (const ch of wholeVideo.cast?.characters ?? []) {
    if (!ch.name?.trim()) continue
    let targetShots = ch.shotIds ?? []
    if (targetShots.length === 0) {
      targetShots = activeShots
        .filter((s) =>
          s.subjects.some((sub) => sub.name.toLowerCase().includes(ch.name.trim().toLowerCase()))
        )
        .map((s) => s.id)
      if (targetShots.length === 0 && activeShots.length === 1) {
        targetShots = [activeShots[0]!.id]
      }
    }
    const ent = upsert('person', ch.name, targetShots)
    if (ent) {
      ch.entityId = ent.id
      ch.shotIds = ent.appearances.map((a) => a.shotId)
      for (const ap of ent.appearances) {
        const sh = byShotId.get(ap.shotId)
        if (!sh) continue
        const existingSub = sh.subjects.find(
          (sub) =>
            sub.entityId === ent.id || sub.name.trim().toLowerCase() === ent.name.toLowerCase()
        )
        if (existingSub) {
          existingSub.entityId = ent.id
        } else if (sh.origin !== 'user' && !sh.locked) {
          sh.subjects.push({ entityId: ent.id, name: ent.name })
        }
      }
    }
  }

  for (const pr of wholeVideo.cast?.props ?? []) {
    if (!pr.name?.trim()) continue
    const kind: EntityKind = pr.realMaterial ? 'product' : 'object'
    const targetShots = pr.shotIds?.length
      ? pr.shotIds
      : activeShots.length === 1
        ? [activeShots[0]!.id]
        : []
    const ent = upsert(kind, pr.name, targetShots)
    if (ent) {
      pr.entityId = ent.id
      pr.shotIds = ent.appearances.map((a) => a.shotId)
    }
  }

  // 2. Per-shot subjects & realMaterials → entities
  for (const shot of activeShots) {
    for (const sub of shot.subjects) {
      if (sub.entityId) {
        const linked = entities.find((e) => e.id === sub.entityId)
        if (linked && !linked.appearances.some((a) => a.shotId === shot.id)) {
          linked.appearances.push({ shotId: shot.id, range: shot.range })
          linked.appearances.sort(
            (a, b) => (shotOrder.get(a.shotId) ?? 0) - (shotOrder.get(b.shotId) ?? 0)
          )
        }
        continue
      }
      const rawName = sub.name?.trim()
      if (!rawName) continue
      const kind: EntityKind = propNameSet.has(rawName.toLowerCase()) ? 'product' : 'person'
      const ent = upsert(kind, rawName, [shot.id])
      if (ent) sub.entityId = ent.id
    }

    for (const mat of shot.material?.items ?? []) {
      const desc = mat.description?.trim()
      if (!desc) continue
      if (mat.kind === 'product') upsert('product', desc, [shot.id])
      else if (mat.kind === 'logo_brand') upsert('logo', desc, [shot.id])
      else if (mat.kind === 'real_person') upsert('person', desc, [shot.id])
    }
  }

  // 3. Deterministic forensic fallback when no VLM entities exist
  if (synthesizeFallback && entities.length === 0 && activeShots.length > 0) {
    const portraitShots = activeShots.filter((s) => {
      const label = s.base?.label
      const framingObj = s.forensics?.aspects?.framing
      const framing = framingObj?.shotSize ?? ''
      if (label === 'avatar') return true
      if (framingObj?.subjectKind === 'face') return true
      if (
        label === 'live_action' &&
        ['ecu', 'cu', 'mcu', 'ms'].includes(framing) &&
        (framingObj?.area ?? 0) >= 0.08
      ) {
        return true
      }
      return false
    })

    if (portraitShots.length > 0) {
      const clusters: T[][] = []
      for (const s of portraitShots) {
        let matchedCluster: T[] | undefined
        for (const cl of clusters) {
          const anchor = cl[0]!
          if (
            anchor.forensics?.hsvHist?.length &&
            s.forensics?.hsvHist?.length &&
            hsvBhattacharyyaDistance(anchor.forensics.hsvHist, s.forensics.hsvHist) <= 0.38
          ) {
            matchedCluster = cl
            break
          }
        }
        if (matchedCluster) matchedCluster.push(s)
        else if (clusters.length < 4) clusters.push([s])
        else clusters[clusters.length - 1]!.push(s)
      }

      clusters.forEach((cl, idx) => {
        const name =
          clusters.length === 1
            ? lang === 'en'
              ? 'On-camera Person'
              : '出镜人物' // cjk-ok
            : lang === 'en'
              ? `Person ${idx + 1}`
              : `出镜人物 ${idx + 1}` // cjk-ok
        const ent = upsert(
          'person',
          name,
          cl.map((s) => s.id)
        )
        if (ent) {
          for (const s of cl) {
            if (s.subjects.length === 0 && s.origin !== 'user' && !s.locked) {
              s.subjects.push({ entityId: ent.id, name: ent.name })
            }
          }
        }
      })
    }

    if (dialogue.length > 0) {
      const bySpeaker = new Map<string, DialogueLine[]>()
      for (const line of dialogue) {
        if (!line.text?.trim()) continue
        const key = line.speaker?.trim() || '__default__'
        const arr = bySpeaker.get(key) ?? []
        arr.push(line)
        bySpeaker.set(key, arr)
      }
      for (const [spk, lines] of bySpeaker.entries()) {
        const hitShotIds = activeShots
          .filter((s) =>
            lines.some((l) => s.range.end > l.range.start && s.range.start < l.range.end)
          )
          .map((s) => s.id)
        const targetIds = hitShotIds.length > 0 ? hitShotIds : [activeShots[0]!.id]
        const name =
          spk === '__default__'
            ? lang === 'en'
              ? 'Voiceover / Host'
              : '口播人声' // cjk-ok
            : lang === 'en'
              ? `Speaker ${spk}`
              : `说话人 ${spk}` // cjk-ok
        upsert('voice', name, targetIds)
      }
    }

    if (entities.length === 0) {
      const sceneClusters: T[][] = []
      for (const s of activeShots) {
        let matched: T[] | undefined
        for (const cl of sceneClusters) {
          const anchor = cl[0]!
          if (
            anchor.forensics?.hsvHist?.length &&
            s.forensics?.hsvHist?.length &&
            hsvBhattacharyyaDistance(anchor.forensics.hsvHist, s.forensics.hsvHist) <=
              SCENE_HIST_THRESHOLD
          ) {
            matched = cl
            break
          }
        }
        if (matched) matched.push(s)
        else if (sceneClusters.length < 3) sceneClusters.push([s])
        else sceneClusters[sceneClusters.length - 1]!.push(s)
      }
      sceneClusters.forEach((cl, idx) => {
        const name =
          sceneClusters.length === 1
            ? lang === 'en'
              ? 'Primary Scene'
              : '主画面场景' // cjk-ok
            : lang === 'en'
              ? `Scene ${idx + 1}`
              : `画面场景 ${idx + 1}` // cjk-ok
        upsert(
          'background',
          name,
          cl.map((s) => s.id)
        )
      })
    }
  }

  return { entities, shots }
}

/**
 * Pure, instant `<5ms` breakdown & remake finalizer (`rea_video/pipeline.py:finalize`).
 * Safe to call after initial deterministic forensics, after VLM enrichment, and after any user edit!
 */
export function finalizeSemanticBreakdown(
  doc: SemanticTimeline,
  options: FinalizeBreakdownOptions = {}
): SemanticTimeline {
  const lang = options.lang ?? 'zh'
  const prev = doc.breakdown
  const provenance: ContainerProvenance = options.provenance ?? prev?.provenance ?? { evidence: [] }
  const rawShots = doc.shots ?? []
  const cleanBefore = new Set<string>()
  if (doc.baseline?.shots) {
    for (const s of rawShots) {
      if (doc.baseline.shots[s.id] && doc.baseline.shots[s.id] === shotSignature(doc, s)) {
        cleanBefore.add(s.id)
      }
    }
  }
  const totalDuration = Math.max(
    0.1,
    rawShots.reduce((acc, s) => acc + (s.removed ? 0 : shotDuration(s)), 0) || doc.source.duration
  )

  // 1. Fuse per-shot base classification & interpret measured shooting aspects
  const fused = rawShots.map((shot) => {
    const dur = shotDuration(shot)
    const grade = interpretColorGrade(shot.forensics?.aspects?.grade, lang)
    const lighting = interpretLightingSetup(
      shot.forensics?.aspects?.lighting,
      grade,
      shot.visual?.description,
      lang
    )
    const forensics = shot.forensics
      ? {
          ...shot.forensics,
          ...(shot.forensics.aspects || lighting || grade
            ? {
                aspects: {
                  ...shot.forensics.aspects,
                  ...(lighting ? { lighting } : {}),
                  ...(grade ? { grade } : {})
                }
              }
            : {})
        }
      : undefined

    const base = fuseShotClassification({
      forensics,
      provenance,
      durationSec: dur,
      vlmProbs: shot.base?.vlmProbs,
      vlmEvidence: shot.base?.vlmEvidence,
      vlmAiEdits: shot.base?.aiEdits,
      reviewOverrideLabel: shot.base?.reviewOverrideLabel,
      lang
    })

    // Backfill structured camera/visual from deterministic measurements only when empty and not user-edited
    const framingCode = forensics?.aspects?.framing?.shotSize
    const camera =
      shot.origin === 'user' || shot.locked
        ? shot.camera
        : {
            ...shot.camera,
            ...(shot.camera?.shotSize
              ? {}
              : framingCode
                ? {
                    shotSize:
                      lang === 'en' ? FRAMING_SIZE_EN[framingCode] : FRAMING_SIZE_ZH[framingCode]
                  }
                : {})
          }
    const visual =
      shot.origin === 'user' || shot.locked
        ? shot.visual
        : {
            ...shot.visual,
            ...(shot.visual?.lighting
              ? {}
              : lighting?.setupName
                ? { lighting: lighting.setupName }
                : {}),
            ...(shot.visual?.grade ? {} : grade?.look ? { grade: grade.look } : {}),
            ...(shot.visual?.palette?.length
              ? {}
              : forensics?.dominantHexPalette?.length
                ? { palette: forensics.dominantHexPalette.slice(0, 5) }
                : {})
          }

    return {
      ...shot,
      ...(forensics ? { forensics } : {}),
      camera,
      visual,
      base,
      durationSec: dur
    }
  })

  // 2. Scene-group consistency smoothing
  const smoothed = applySceneGroupConsistency(fused, lang)

  // 3. Sync VLM / deterministic entities, derive Cast & Route every shot
  const mergedWhole: WholeVideoAnalysis = {
    ...(prev?.wholeVideo ?? {}),
    ...(options.wholeVideo ?? {}),
    openQuestions: []
  }
  const { entities: syncedEntities, shots: syncedShots } = syncEntitiesAndSubjects({
    entities: doc.entities ?? [],
    shots: smoothed,
    dialogue: doc.dialogue ?? [],
    wholeVideo: mergedWhole,
    synthesizeFallback: Boolean(options.synthesizeFallbackEntities),
    lang
  })
  const workingDoc: SemanticTimeline = {
    ...doc,
    entities: syncedEntities
  }
  const cast = deriveTimelineCast(workingDoc, syncedShots, mergedWhole)
  mergedWhole.cast = cast

  const castByEntityId = new Map<string, CastCharacterSpec | CastPropSpec>()
  for (const ch of cast.characters) if (ch.entityId) castByEntityId.set(ch.entityId, ch)
  for (const pr of cast.props) if (pr.entityId) castByEntityId.set(pr.entityId, pr)
  const aspectRatioLabel = formatAspectRatio(doc.source.width, doc.source.height)

  const routedShots: SemanticShot[] = syncedShots.map(({ durationSec: _d, ...s }) => ({
    ...s,
    replication: planShotReplication({
      shot: s,
      entities: syncedEntities,
      castByEntityId,
      aspectRatioLabel,
      lang
    })
  }))

  // 4. Build Production Plan & attach unitIds back onto each shot
  const { plan: productionPlan, unitByShotId } = buildReaProductionPlan({
    doc: workingDoc,
    shots: routedShots,
    cast,
    mode: options.mode ?? prev?.productionPlan?.mode,
    lang
  })
  const finalShots: SemanticShot[] = routedShots.map((s) => {
    const unitId = unitByShotId.get(s.id)
    return unitId && s.replication ? { ...s, replication: { ...s.replication, unitId } } : s
  })

  // 5. Compute Production Mix, Verdict, Audio Source Attribution & Open Questions
  const secByLabel = new Map<ProductionBaseLabel, number>()
  const transitions: Record<string, number> = {}
  let weightedConfSum = 0
  let activeDurSum = 0
  let hasReviewOverride = false
  let hasVlm = Boolean(options.vlmStatus?.used ?? prev?.summary?.vlmStatus?.used)

  finalShots.forEach((s, idx) => {
    if (s.removed) return
    const dur = shotDuration(s)
    activeDurSum += dur
    const label = s.base?.label ?? 'live_action'
    secByLabel.set(label, (secByLabel.get(label) ?? 0) + dur)
    weightedConfSum += dur * (s.base?.confidence ?? 0.6)
    if (s.base?.decidedBy === 'review_override') hasReviewOverride = true
    if (s.base?.decidedBy === 'vlm_fused') hasVlm = true
    if (idx > 0) {
      const tr = s.transitionIn || 'cut'
      transitions[tr] = (transitions[tr] ?? 0) + 1
    }
  })

  const denom = Math.max(0.1, activeDurSum || totalDuration)
  const productionMix = [...secByLabel.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, sec]) => ({
      label,
      labelZh: PRODUCTION_LABEL_META[label].zh,
      labelEn: PRODUCTION_LABEL_META[label].en,
      seconds: r2(sec),
      ratio: Number((sec / denom).toFixed(3))
    }))

  const aiShare =
    (secByLabel.get('ai_video') ?? 0) / denom +
    (secByLabel.get('cg_3d') ?? 0) / denom +
    (secByLabel.get('anim_2d') ?? 0) / denom
  const liveShare = (secByLabel.get('live_action') ?? 0) / denom
  const avatarShare = (secByLabel.get('avatar') ?? 0) / denom

  let audioAnalysis = options.audioAnalysis ?? prev?.audioAnalysis
  if (audioAnalysis && audioAnalysis.hasAudio) {
    audioAnalysis = {
      ...audioAnalysis,
      soundSources: classifySoundSources({
        audio: audioAnalysis,
        aiVideoShare: aiShare,
        liveActionShare: liveShare,
        avatarShare,
        wholeVideo: mergedWhole,
        lang
      })
    }
  }

  // Honest open questions
  const openQuestions: string[] = []
  finalShots.forEach((s, idx) => {
    if (s.removed) return
    if (s.base?.disputed) {
      openQuestions.push(
        lang === 'en'
          ? `Shot ${shotIndexLabel(idx)} (${s.range.start.toFixed(1)}–${s.range.end.toFixed(1)}s): forensics and VLM disagree — please verify production type`
          : `镜头 ${shotIndexLabel(idx)}（${s.range.start.toFixed(1)}–${s.range.end.toFixed(1)}s）信号取证与 VLM 判定存在分歧，建议人工复核类型` // cjk-ok
      )
    } else if (s.base?.uncertain) {
      openQuestions.push(
        lang === 'en'
          ? `Shot ${shotIndexLabel(idx)} (${s.range.start.toFixed(1)}–${s.range.end.toFixed(1)}s): low classification margin (${Math.round((s.base.confidence ?? 0.5) * 100)}%)`
          : `镜头 ${shotIndexLabel(idx)}（${s.range.start.toFixed(1)}–${s.range.end.toFixed(1)}s）置信度偏低（${Math.round((s.base.confidence ?? 0.5) * 100)}%），待确认` // cjk-ok
      )
    }
    for (const m of s.material?.items ?? []) {
      if (m.realMaterial === null) {
        openQuestions.push(
          lang === 'en'
            ? `Shot ${shotIndexLabel(idx)}: confirm whether "${m.description}" is a real physical/recorded asset`
            : `镜头 ${shotIndexLabel(idx)}：需确认「${m.description}」是否为真实商品/录屏素材` // cjk-ok
        )
      }
    }
  })
  if (provenance.platformTranscode && !hasVlm) {
    openQuestions.push(
      lang === 'en'
        ? `Platform re-encoding (${provenance.platformTranscode}) smoothed high-frequency grain; enable VLM pass for higher-confidence AI vs live-action separation`
        : `源视频经平台重编码（${provenance.platformTranscode}）抹平了部分传感器噪点，建议开启「大模型深度拆解」提升实拍与 AI 视频的区分度` // cjk-ok
    )
  }
  mergedWhole.openQuestions = openQuestions

  const verdictZh =
    productionMix
      .slice(0, 3)
      .map((m) => `${PRODUCTION_LABEL_META[m.label].shortZh} ${Math.round(m.ratio * 100)}%`)
      .join(' + ') || '未检出有效镜头' // cjk-ok
  const verdictEn =
    productionMix
      .slice(0, 3)
      .map((m) => `${PRODUCTION_LABEL_META[m.label].shortEn} ${Math.round(m.ratio * 100)}%`)
      .join(' + ') || 'No active shots'

  const activeCount = finalShots.filter((s) => !s.removed).length
  const decidedBy: BreakdownSummary['decidedBy'] = hasReviewOverride
    ? 'deterministic+vlm+review'
    : hasVlm
      ? 'deterministic+vlm'
      : 'deterministic'

  const vlmStatus: BreakdownSummary['vlmStatus'] = {
    used: hasVlm,
    ...(prev?.summary?.vlmStatus ?? {}),
    ...(options.vlmStatus ?? {})
  }

  const unitPromptOverrides = prev?.unitPromptOverrides
  const breakdown: BreakdownAnalysis = {
    version: 'rea-breakdown@1',
    provenance,
    ...(audioAnalysis ? { audioAnalysis } : {}),
    wholeVideo: mergedWhole,
    summary: {
      verdict: verdictZh,
      verdictEn,
      confidence: Number((weightedConfSum / denom).toFixed(3)),
      decidedBy,
      vlmStatus,
      shotCount: activeCount,
      avgShotSec: activeCount > 0 ? r2(denom / activeCount) : 0,
      transitions,
      productionMix,
      storyboardRelativePath:
        options.storyboardRelativePath ?? prev?.summary?.storyboardRelativePath,
      reportRelativePath: options.reportRelativePath ?? prev?.summary?.reportRelativePath
    },
    productionPlan,
    ...(unitPromptOverrides && Object.keys(unitPromptOverrides).length
      ? { unitPromptOverrides }
      : {})
  }

  const nextDoc: SemanticTimeline = {
    ...doc,
    entities: syncedEntities,
    shots: finalShots,
    breakdown
  }
  if (nextDoc.baseline?.shots && cleanBefore.size > 0) {
    const syncedShots = { ...nextDoc.baseline.shots }
    for (const s of finalShots) {
      if (cleanBefore.has(s.id)) {
        syncedShots[s.id] = shotSignature(nextDoc, s)
      }
    }
    return {
      ...nextDoc,
      baseline: {
        ...nextDoc.baseline,
        shots: syncedShots
      }
    }
  }
  return nextDoc
}
