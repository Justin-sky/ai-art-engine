/**
 * Calibrated 11-class production taxonomy classifier, Bayesian evidence fusion,
 * scene-group consistency voting, lighting/grade interpreters, and audio source attribution.
 *
 * Ported & adapted from `rea-video` (`classify.py`, `aspects/lighting.py`, `aspects/grade.py`,
 * `sound_source.py`) in pure TypeScript so both main process and renderer Dive UI can run
 * instant `<5ms` re-evaluation without re-decoding video.
 */
import {
  AI_EDIT_META,
  BASE_PRODUCTION_LABELS,
  PRODUCTION_LABEL_META,
  type AudioForensicAnalysis,
  type BreakdownLang,
  type CodeRenderStyleKind,
  type ContainerProvenance,
  type GradeAspectMeasured,
  type LightingAspectMeasured,
  type ProductionBaseLabel,
  type ShotAiEditDetection,
  type ShotBaseClassification,
  type ShotForensicFeatures,
  type SoundSourceVerdict,
  type WholeVideoAnalysis
} from './reaTypes'

const EPS = 1e-6

function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo
  return Math.max(lo, Math.min(hi, v))
}

function r3(v: number): number {
  return Number(clamp(v, -1e6, 1e6).toFixed(3))
}

function normalizeProbs(
  raw: Partial<Record<ProductionBaseLabel, number>>
): Record<ProductionBaseLabel, number> {
  const out = {} as Record<ProductionBaseLabel, number>
  let sum = 0
  for (const label of BASE_PRODUCTION_LABELS) {
    const v = Math.max(0, Number(raw[label] ?? 0))
    out[label] = v
    sum += v
  }
  if (sum <= EPS) {
    const uniform = 1 / BASE_PRODUCTION_LABELS.length
    for (const label of BASE_PRODUCTION_LABELS) out[label] = r3(uniform)
    return out
  }
  for (const label of BASE_PRODUCTION_LABELS) {
    out[label] = r3(out[label] / sum)
  }
  return out
}

function topTwo(
  probs: Record<ProductionBaseLabel, number>
): [{ label: ProductionBaseLabel; prob: number }, { label: ProductionBaseLabel; prob: number }] {
  const sorted = [...BASE_PRODUCTION_LABELS]
    .map((label) => ({ label, prob: probs[label] ?? 0 }))
    .sort((a, b) => b.prob - a.prob)
  return [sorted[0]!, sorted[1] ?? { label: sorted[0]!.label, prob: 0 }]
}

/** Bhattacharyya distance between two normalized histograms (0 = identical, 1 = disjoint). */
export function hsvBhattacharyyaDistance(
  a: readonly number[] | undefined,
  b: readonly number[] | undefined
): number {
  if (!a?.length || !b?.length || a.length !== b.length) return 1
  let sumA = 0
  let sumB = 0
  for (let i = 0; i < a.length; i += 1) {
    sumA += Math.max(0, a[i]!)
    sumB += Math.max(0, b[i]!)
  }
  if (sumA <= EPS || sumB <= EPS) return 1
  let bc = 0
  for (let i = 0; i < a.length; i += 1) {
    bc += Math.sqrt((Math.max(0, a[i]!) / sumA) * (Math.max(0, b[i]!) / sumB))
  }
  return clamp(Math.sqrt(Math.max(0, 1 - Math.min(1, bc))), 0, 1)
}

export interface DeterministicScoreResult {
  probs: Record<ProductionBaseLabel, number>
  detWeight: number
  evidenceZh: string[]
  evidenceEn: string[]
  hardFrozen: boolean
  hardPlanarZoomPan: boolean
}

/**
 * Stage A: Score all 11 base production labels from deterministic signal forensics + container provenance.
 */
export function scoreDeterministicShot(
  forensics: ShotForensicFeatures | undefined,
  provenance: ContainerProvenance | undefined,
  durationSec: number
): DeterministicScoreResult {
  const f = forensics ?? {}
  const p = provenance
  const evidenceZh: string[] = []
  const evidenceEn: string[] = []

  // Mild uninformative prior across photographic & graphic classes
  const scores: Record<ProductionBaseLabel, number> = {
    live_action: 0.24,
    ai_video: 0.2,
    avatar: 0.05,
    cg_3d: 0.07,
    code_render: 0.09,
    screen_capture: 0.07,
    still_motion: 0.07,
    static_hold: 0.06,
    anim_2d: 0.06,
    stop_motion: 0.03,
    film_footage: 0.06
  }

  let detWeight = 1.0
  const transcode = Boolean(p?.platformTranscode)
  if (transcode) {
    detWeight *= 0.8
    evidenceZh.push(`检测到平台重编码（${p!.platformTranscode}），高频噪点权重下调`) // cjk-ok
    evidenceEn.push(`Platform transcode (${p!.platformTranscode}) detected; noise cues discounted`)
  }

  // 1. Container provenance cues
  const aigcLabel = p?.aigcImplicitLabel?.label?.trim()
  if (aigcLabel === '1') {
    scores.ai_video *= 3.4
    scores.avatar *= 2.2
    scores.cg_3d *= 1.5
    scores.live_action *= 0.35
    detWeight = Math.max(detWeight, 1.35)
    const producer = p?.aigcImplicitLabel?.contentProducer || 'GB 45438'
    evidenceZh.push(`容器带 AIGC 隐式标识 Label=1（生成合成，来源：${producer}）`) // cjk-ok
    evidenceEn.push(`Container carries GB 45438 AIGC implicit label=1 (${producer})`)
  } else if (aigcLabel === '2' || aigcLabel === '3') {
    scores.ai_video *= 1.8
    scores.avatar *= 1.6
    evidenceZh.push(`容器带 AIGC 隐式标识 Label=${aigcLabel}`) // cjk-ok
    evidenceEn.push(`Container carries AIGC implicit label=${aigcLabel}`)
  }

  if (p?.generatorHint) {
    scores.ai_video *= 3.0
    scores.avatar *= 1.8
    scores.live_action *= 0.4
    detWeight = Math.max(detWeight, 1.3)
    evidenceZh.push(`容器签名命中生成工具：${p.generatorHint}`) // cjk-ok
    evidenceEn.push(`Container signature matches AI generator: ${p.generatorHint}`)
  }

  if (p?.make || p?.model) {
    const cam = [p.make, p.model].filter(Boolean).join(' ')
    scores.live_action *= 2.4
    scores.ai_video *= 0.55
    evidenceZh.push(`容器携带拍摄设备元数据：${cam}`) // cjk-ok
    evidenceEn.push(`Camera hardware metadata present: ${cam}`)
  }

  if (p?.editorHint && /remotion/i.test(p.editorHint)) {
    scores.code_render *= 3.5
    evidenceZh.push(`编码器签名命中代码渲染框架：${p.editorHint}`) // cjk-ok
    evidenceEn.push(`Encoder signature matches code renderer: ${p.editorHint}`)
  } else if (p?.editorHint && /blender|cinema\s*4d|unreal|houdini/i.test(p.editorHint)) {
    scores.cg_3d *= 3.2
    evidenceZh.push(`编码器签名命中 3D 渲染器：${p.editorHint}`) // cjk-ok
    evidenceEn.push(`Encoder signature matches 3D renderer: ${p.editorHint}`)
  }

  // 2. Temporal freeze & rigid Ken Burns invariants
  const meanDiff = f.meanFrameDiff ?? 4.0
  const dupRatio = f.dupRatio ?? 0
  const hardFrozen =
    durationSec >= 0.35 && (meanDiff < 0.75 || (dupRatio >= 0.92 && meanDiff < 1.35))
  if (hardFrozen) {
    scores.static_hold *= 14.0
    scores.code_render *= 1.3
    scores.screen_capture *= 1.1
    scores.live_action *= 0.02
    scores.ai_video *= 0.02
    scores.avatar *= 0.02
    scores.still_motion *= 0.08
    detWeight = 1.6
    evidenceZh.push(
      `帧间均差 ${meanDiff.toFixed(2)}、重复帧占比 ${(dupRatio * 100).toFixed(0)}%，画面静止` // cjk-ok
    )
    evidenceEn.push(
      `Mean frame diff ${meanDiff.toFixed(2)}, duplicate ratio ${(dupRatio * 100).toFixed(0)}% (frozen frame)`
    )
  }

  const kbScore = f.kenburnsScore ?? 0
  const zoomRate = Math.abs(f.zoomPerSec ?? 0)
  const panRate = f.panPxPerSec ?? 0
  const hardPlanarZoomPan =
    !hardFrozen &&
    f.cameraMotionKind === 'planar_zoom_pan' &&
    kbScore >= 0.82 &&
    (zoomRate >= 0.012 || panRate >= 0.018)
  if (hardPlanarZoomPan) {
    scores.still_motion *= 9.5
    scores.live_action *= 0.08
    scores.avatar *= 0.05
    scores.ai_video *= 0.22
    detWeight = Math.max(detWeight, 1.45)
    evidenceZh.push(
      `刚性平面推拉拟合度 ${(kbScore * 100).toFixed(0)}%（缩放 ${((f.zoomPerSec ?? 0) * 100).toFixed(1)}%/s，平移 ${(panRate * 100).toFixed(1)}%/s），无三维视差` // cjk-ok
    )
    evidenceEn.push(
      `Rigid planar zoom/pan fit ${(kbScore * 100).toFixed(0)}% (zoom ${((f.zoomPerSec ?? 0) * 100).toFixed(1)}%/s, pan ${(panRate * 100).toFixed(1)}%/s), zero parallax`
    )
  }

  // 3. Spatial flat blocks, axis-aligned UI edges, palette95, vector fills
  const flatRatio = f.flatRatio ?? 0
  const axisEdge = f.axisEdgeRatio ?? 0
  const palette95 = f.palette95 ?? 120
  const vectorFill = f.vectorFill ?? 0
  const fineLight = f.fineLight ?? 0
  const fineDark = f.fineDark ?? 0

  if (flatRatio >= 0.52 && axisEdge >= 0.58) {
    scores.screen_capture *= 4.6
    scores.code_render *= 3.8
    scores.live_action *= 0.15
    scores.ai_video *= 0.18
    detWeight = Math.max(detWeight, 1.25)
    evidenceZh.push(
      `大面积纯色块 ${(flatRatio * 100).toFixed(0)}% + 横平竖直边缘 ${(axisEdge * 100).toFixed(0)}%，符合 UI/录屏或版式动画特征` // cjk-ok
    )
    evidenceEn.push(
      `High flat-block share ${(flatRatio * 100).toFixed(0)}% + axis-aligned edges ${(axisEdge * 100).toFixed(0)}% (UI / screen or MG layout)`
    )
  } else if (flatRatio >= 0.42 || palette95 <= 36 || vectorFill >= 0.35) {
    scores.code_render *= 3.2
    scores.anim_2d *= 2.4
    scores.screen_capture *= 1.8
    scores.live_action *= 0.35
    evidenceZh.push(
      `95% 色彩桶仅 ${palette95} 个、纯色占比 ${(flatRatio * 100).toFixed(0)}%，偏向图形/2D 渲染` // cjk-ok
    )
    evidenceEn.push(
      `Compact palette95=${palette95}, flat ratio ${(flatRatio * 100).toFixed(0)}% (graphic / 2D render)`
    )
  }

  if (fineLight >= 0.08 && palette95 <= 64) {
    scores.anim_2d *= 2.5
    scores.code_render *= 1.6
    evidenceZh.push(`检测到浅底深色均匀线稿特征（fineLight=${fineLight.toFixed(2)}）`) // cjk-ok
    evidenceEn.push(`Clean dark lineart on light ground (fineLight=${fineLight.toFixed(2)})`)
  }
  if (fineDark >= 0.08 && (f.darkShare ?? 0) >= 0.35) {
    scores.code_render *= 2.4
    evidenceZh.push(`暗底高亮细粒子/线框特征（fineDark=${fineDark.toFixed(2)}）`) // cjk-ok
    evidenceEn.push(
      `Bright fine strokes/particles on dark ground (fineDark=${fineDark.toFixed(2)})`
    )
  }

  // 4. Sensor noise vs synthetic smoothness + camera shake + pulldown
  const noiseSigma = f.noiseSigma
  if (noiseSigma !== undefined && flatRatio < 0.45 && !hardFrozen) {
    if (noiseSigma >= 2.1 && !transcode) {
      scores.live_action *= 1.9
      scores.film_footage *= 1.5
      scores.ai_video *= 0.65
      evidenceZh.push(`高频传感器噪点 σ=${noiseSigma.toFixed(2)}，符合实拍感光特征`) // cjk-ok
      evidenceEn.push(
        `High-frequency sensor noise sigma=${noiseSigma.toFixed(2)} favors camera footage`
      )
    } else if (noiseSigma <= 0.85 && (f.flatLit ?? flatRatio) < 0.35) {
      scores.ai_video *= 1.85
      scores.cg_3d *= 1.75
      scores.avatar *= 1.4
      if (!transcode) {
        scores.live_action *= 0.68
        evidenceZh.push(`画面纹理平滑无传感器底噪（σ=${noiseSigma.toFixed(2)}），偏向生成或渲染`) // cjk-ok
        evidenceEn.push(
          `Clean synthetic texture with low sensor grain (sigma=${noiseSigma.toFixed(2)})`
        )
      }
    }
  }

  if (f.cameraMotionKind === 'handheld_like' && (f.signFlipRate ?? 0) >= 0.28) {
    scores.live_action *= 1.85
    scores.still_motion *= 0.25
    evidenceZh.push(
      `高频微抖动（方向翻转率 ${((f.signFlipRate ?? 0) * 100).toFixed(0)}%），符合手持实拍` // cjk-ok
    )
    evidenceEn.push(
      `Natural handheld micro-jitter (sign-flip ${((f.signFlipRate ?? 0) * 100).toFixed(0)}%)`
    )
  } else if (
    f.cameraMotionKind === 'static_with_subject_motion' &&
    f.aspects?.framing?.subjectKind === 'face'
  ) {
    scores.avatar *= 2.1
    scores.live_action *= 1.3
    evidenceZh.push(`机位完全静止而人物局部运动，符合固定机位口播或数字人特征`) // cjk-ok
    evidenceEn.push(
      `Locked background with localized face motion (talking head / avatar candidate)`
    )
  }

  if (f.pulldown) {
    scores.film_footage *= 2.8
    scores.anim_2d *= 1.9
    scores.stop_motion *= 1.7
    evidenceZh.push(`检测到帧率抽帧节律（${f.pulldown} pulldown）`) // cjk-ok
    evidenceEn.push(`Detected ${f.pulldown} frame cadence / pulldown`)
  } else if (!hardFrozen && dupRatio >= 0.35 && dupRatio <= 0.72 && meanDiff >= 2.0) {
    scores.anim_2d *= 1.9
    scores.stop_motion *= 2.2
    evidenceZh.push(`定格/抽帧运动节律（重复帧 ${(dupRatio * 100).toFixed(0)}%：一拍二/一拍三）`) // cjk-ok
    evidenceEn.push(
      `Stepped animation cadence on twos/threes (dup ratio ${(dupRatio * 100).toFixed(0)}%)`
    )
  }

  if ((f.letterbox ?? 0) >= 0.12) {
    scores.film_footage *= 2.1
    evidenceZh.push(`上下遮幅黑边占比 ${((f.letterbox ?? 0) * 100).toFixed(0)}%`) // cjk-ok
    evidenceEn.push(`Cinematic letterbox matte (${((f.letterbox ?? 0) * 100).toFixed(0)}%)`)
  }

  const probs = normalizeProbs(scores)
  if (evidenceZh.length === 0) {
    const [top] = topTwo(probs)
    evidenceZh.push(`基础像素与时序统计倾向 ${PRODUCTION_LABEL_META[top.label].zh}`) // cjk-ok
    evidenceEn.push(
      `Baseline spatial/temporal statistics lean toward ${PRODUCTION_LABEL_META[top.label].en}`
    )
  }

  return {
    probs,
    detWeight,
    evidenceZh,
    evidenceEn,
    hardFrozen,
    hardPlanarZoomPan
  }
}

export interface FuseShotInput {
  forensics?: ShotForensicFeatures
  provenance?: ContainerProvenance
  durationSec: number
  vlmProbs?: Partial<Record<ProductionBaseLabel, number>>
  vlmEvidence?: string[]
  vlmAiEdits?: ShotAiEditDetection[]
  reviewOverrideLabel?: ProductionBaseLabel
  lang?: BreakdownLang
}

/**
 * Stage B: Calibrated Bayesian log-pool fusion (`det_p^(0.6 * detW) * vlm_p^0.7`)
 * with hard physical invariants and explicit dispute/uncertainty honesty caps.
 */
export function fuseShotClassification(input: FuseShotInput): ShotBaseClassification {
  const lang = input.lang ?? 'zh'
  const det = scoreDeterministicShot(input.forensics, input.provenance, input.durationSec)
  const detEvidence = lang === 'en' ? det.evidenceEn : det.evidenceZh

  // Human / agent explicit review override wins deterministically
  if (
    input.reviewOverrideLabel &&
    (BASE_PRODUCTION_LABELS as readonly string[]).includes(input.reviewOverrideLabel)
  ) {
    const label = input.reviewOverrideLabel
    const probs = {} as Record<ProductionBaseLabel, number>
    for (const k of BASE_PRODUCTION_LABELS) probs[k] = k === label ? 0.96 : 0.004
    const norm = normalizeProbs(probs)
    return {
      label,
      probs: norm,
      confidence: 0.96,
      decidedBy: 'review_override',
      reviewOverrideLabel: label,
      ...(input.vlmProbs ? { vlmProbs: input.vlmProbs } : {}),
      ...(input.vlmEvidence?.length ? { vlmEvidence: input.vlmEvidence } : {}),
      ...(input.vlmAiEdits?.length ? { aiEdits: input.vlmAiEdits } : {}),
      evidence: [
        lang === 'en'
          ? `Manually confirmed as ${PRODUCTION_LABEL_META[label].en}`
          : `人工/复核确认为「${PRODUCTION_LABEL_META[label].zh}」`, // cjk-ok
        ...detEvidence.slice(0, 3)
      ]
    }
  }

  const hasVlm =
    !!input.vlmProbs && Object.values(input.vlmProbs).some((v) => typeof v === 'number' && v > 0.01)

  if (!hasVlm) {
    const [first, second] = topTwo(det.probs)
    const margin = first.prob - second.prob
    const uncertain = first.prob < 0.48 || margin < 0.12
    const confidence = r3(
      clamp(
        uncertain ? Math.min(0.65, first.prob + 0.12) : Math.min(0.88, first.prob + 0.18),
        0.25,
        0.9
      )
    )
    return {
      label: first.label,
      probs: det.probs,
      confidence,
      decidedBy: 'deterministic',
      ...(uncertain ? { uncertain: true } : {}),
      ...(input.vlmAiEdits?.length ? { aiEdits: input.vlmAiEdits } : {}),
      evidence: detEvidence
    }
  }

  const vlmNorm = normalizeProbs(input.vlmProbs!)
  const [detTop] = topTwo(det.probs)
  const [vlmTop] = topTwo(vlmNorm)

  // Log-linear Bayesian pool with hard invariant masks
  const pooled: Partial<Record<ProductionBaseLabel, number>> = {}
  const detExp = 0.6 * det.detWeight
  const vlmExp = 0.7
  for (const label of BASE_PRODUCTION_LABELS) {
    const dp = Math.max(0.005, det.probs[label] ?? 0.005)
    const vp = Math.max(0.005, vlmNorm[label] ?? 0.005)
    let p = Math.pow(dp, detExp) * Math.pow(vp, vlmExp)
    if (det.hardFrozen && (label === 'ai_video' || label === 'live_action' || label === 'avatar')) {
      p *= 0.02
    }
    if (det.hardPlanarZoomPan && (label === 'live_action' || label === 'avatar')) {
      p *= 0.05
    }
    pooled[label] = p
  }

  const fusedProbs = normalizeProbs(pooled)
  const [first, second] = topTwo(fusedProbs)
  const disputed =
    detTop.label !== vlmTop.label &&
    detTop.prob >= 0.42 &&
    vlmTop.prob >= 0.45 &&
    !det.hardFrozen &&
    !det.hardPlanarZoomPan
  const uncertain = disputed || first.prob < 0.46 || first.prob - second.prob < 0.1
  let confidence = clamp(first.prob + (1 - second.prob) * 0.15, 0.3, 0.96)
  if (disputed || uncertain) confidence = Math.min(confidence, 0.7)

  const combinedEvidence: string[] = []
  if (input.vlmEvidence?.length) {
    for (const item of input.vlmEvidence.slice(0, 3)) {
      if (item?.trim()) combinedEvidence.push(`VLM: ${item.trim()}`)
    }
  }
  for (const item of detEvidence.slice(0, 3)) {
    combinedEvidence.push(item)
  }
  if (disputed) {
    combinedEvidence.unshift(
      lang === 'en'
        ? `Disputed: signal forensics lean ${PRODUCTION_LABEL_META[detTop.label].en} (${Math.round(detTop.prob * 100)}%) vs VLM ${PRODUCTION_LABEL_META[vlmTop.label].en} (${Math.round(vlmTop.prob * 100)}%)`
        : `存在分歧：信号取证倾向「${PRODUCTION_LABEL_META[detTop.label].shortZh}」(${Math.round(detTop.prob * 100)}%)，VLM 倾向「${PRODUCTION_LABEL_META[vlmTop.label].shortZh}」(${Math.round(vlmTop.prob * 100)}%)` // cjk-ok
    )
  }

  return {
    label: first.label,
    probs: fusedProbs,
    confidence: r3(confidence),
    decidedBy: 'vlm_fused',
    ...(disputed ? { disputed: true } : {}),
    ...(uncertain ? { uncertain: true } : {}),
    vlmProbs: vlmNorm,
    ...(input.vlmEvidence?.length ? { vlmEvidence: input.vlmEvidence } : {}),
    ...(input.vlmAiEdits?.length ? { aiEdits: input.vlmAiEdits } : {}),
    evidence: combinedEvidence
  }
}

/**
 * Group-first scene consistency smoothing:
 * Shots sharing near-identical HSV histograms (e.g., recurring talking-head setup or same AI scene)
 * pool weak/borderline probabilities toward the scene cluster's majority photographic class,
 * unless a shot has a manual override or is a frozen/Ken Burns frame.
 */
export function applySceneGroupConsistency<
  T extends {
    id: string
    durationSec: number
    forensics?: ShotForensicFeatures
    base: ShotBaseClassification
  }
>(shots: T[], lang: BreakdownLang = 'zh'): T[] {
  if (shots.length < 2) return shots
  const groups: number[][] = []
  const visited = new Set<number>()

  for (let i = 0; i < shots.length; i += 1) {
    if (visited.has(i)) continue
    const histI = shots[i]!.forensics?.hsvHist
    if (!histI?.length) continue
    const cluster = [i]
    visited.add(i)
    for (let j = i + 1; j < shots.length; j += 1) {
      if (visited.has(j)) continue
      const histJ = shots[j]!.forensics?.hsvHist
      if (hsvBhattacharyyaDistance(histI, histJ) <= 0.28) {
        cluster.push(j)
        visited.add(j)
      }
    }
    if (cluster.length >= 2) groups.push(cluster)
  }

  if (groups.length === 0) return shots
  const out = shots.map((s) => ({ ...s, base: { ...s.base } }))

  for (const cluster of groups) {
    const movable = cluster.filter((idx) => {
      const b = out[idx]!.base
      return (
        b.decidedBy !== 'review_override' && b.label !== 'static_hold' && b.label !== 'still_motion'
      )
    })
    if (movable.length < 2) continue

    const weightByLabel = new Map<ProductionBaseLabel, number>()
    for (const idx of movable) {
      const item = out[idx]!
      const w = Math.max(0.3, item.durationSec) * item.base.confidence
      weightByLabel.set(item.base.label, (weightByLabel.get(item.base.label) ?? 0) + w)
    }
    const sorted = [...weightByLabel.entries()].sort((a, b) => b[1] - a[1])
    const totalW = sorted.reduce((acc, kv) => acc + kv[1], 0)
    const [winnerLabel, winnerW] = sorted[0]!
    if (winnerW / Math.max(EPS, totalW) < 0.65) continue

    for (const idx of movable) {
      const cur = out[idx]!.base
      if (cur.label === winnerLabel || cur.confidence >= 0.78) continue
      const candidateProb = cur.probs[winnerLabel] ?? 0
      if (candidateProb < 0.22) continue
      const blended = { ...cur.probs }
      blended[winnerLabel] = (blended[winnerLabel] ?? 0) + 0.35
      const norm = normalizeProbs(blended)
      out[idx]!.base = {
        ...cur,
        label: winnerLabel,
        probs: norm,
        confidence: r3(Math.min(0.76, Math.max(cur.confidence, norm[winnerLabel] ?? 0.6))),
        evidence: [
          ...cur.evidence,
          lang === 'en'
            ? `Aligned with visually matching scene group (${PRODUCTION_LABEL_META[winnerLabel].en})`
            : `与同场景切镜组保持一致（归入「${PRODUCTION_LABEL_META[winnerLabel].shortZh}」）` // cjk-ok
        ]
      }
    }
  }

  return out
}

// ─── Lighting & Color Grade Interpreters (`rea_video/aspects`) ────────────────

const OUTDOOR_KEYWORDS = [
  '户外', // cjk-ok
  '室外', // cjk-ok
  '街', // cjk-ok
  '公园', // cjk-ok
  '海边', // cjk-ok
  '山', // cjk-ok
  'outdoor',
  'outside',
  'exterior',
  'street',
  'park',
  'beach'
]

export function interpretLightingSetup(
  measured: LightingAspectMeasured | undefined,
  grade: GradeAspectMeasured | undefined,
  locationHint?: string,
  lang: BreakdownLang = 'zh'
): LightingAspectMeasured | undefined {
  if (!measured || measured.ratio == null) return measured
  const r = measured.ratio
  const tb = measured.topBottom ?? 1.0
  const tr = measured.transition
  const warm = measured.warmth ?? 0
  const subjLuma = measured.subjectLuma ?? 128
  const bgLuma = measured.bgLuma
  const darkShare = measured.darkShare ?? 0
  const loc = (locationHint ?? '').toLowerCase()
  const outdoor =
    OUTDOOR_KEYWORDS.some((k) => loc.includes(k)) &&
    !loc.includes('室内') && // cjk-ok
    !loc.includes('indoor')
  const lowLight = (subjLuma < 95 && darkShare > 0.25) || (bgLuma != null && bgLuma < 35)
  const hard = tr != null && tr <= 0.16

  const sideZh = measured.keySide === 'left' ? '画面左侧' : '画面右侧' // cjk-ok
  const sideEn = measured.keySide === 'left' ? 'frame left' : 'frame right'

  const keyDirection =
    r < 1.35
      ? lang === 'en'
        ? 'Frontal flat light'
        : '正面平光（两侧亮度接近）' // cjk-ok
      : r < 2.5
        ? lang === 'en'
          ? `${sideEn}, 45° key`
          : `${sideZh} 45° 斜前主光` // cjk-ok
        : lang === 'en'
          ? `${sideEn} side key`
          : `${sideZh}侧光（高反差）` // cjk-ok

  const quality =
    tr == null
      ? r < 1.35
        ? lang === 'en'
          ? 'Soft light'
          : '柔光' // cjk-ok
        : lang === 'en'
          ? 'Medium'
          : '中等柔度' // cjk-ok
      : tr >= 0.32
        ? lang === 'en'
          ? 'Soft diffused light'
          : '柔光（明暗过渡宽）' // cjk-ok
        : hard
          ? lang === 'en'
            ? 'Hard directional light'
            : '硬光（阴影边界清晰）' // cjk-ok
          : lang === 'en'
            ? 'Medium-soft light'
            : '中等柔光' // cjk-ok

  const colorTemp =
    warm > 14
      ? lang === 'en'
        ? 'Warm (~3000–4000K)'
        : '偏暖（约 3000–4000K）' // cjk-ok
      : warm < 4
        ? lang === 'en'
          ? 'Cool / daylight'
          : '偏冷（日光/冷白 LED）' // cjk-ok
        : lang === 'en'
          ? 'Neutral (~5000K)'
          : '中性色温（约 5000K）' // cjk-ok

  let setupKey = 'key_fill'
  let setupName = lang === 'en' ? 'Three-quarter key + fill' : '侧前方主光 + 补光（标准布光）' // cjk-ok
  let setupDetail =
    lang === 'en'
      ? 'Key light at 45° front-side with opposite bounce/fill lifting shadows'
      : '主光置于主体 45° 侧前方略高处，另一侧用反光板或辅光提亮暗部' // cjk-ok
  let gear =
    lang === 'en'
      ? ['LED + softbox at 45° front-side', 'Bounce card or dim fill on shadow side']
      : ['LED 主灯 + 柔光箱置于 45° 侧前方', '暗部侧放置白色反光板或低功率辅光'] // cjk-ok

  if (outdoor && !lowLight && bgLuma != null && bgLuma - subjLuma > 25) {
    setupKey = 'outdoor_backlit'
    setupName =
      lang === 'en' ? 'Outdoor backlight / golden hour' : '户外逆光（天空/太阳在主体后方）' // cjk-ok
    setupDetail =
      lang === 'en'
        ? 'Sun or bright sky behind subject creating hair/shoulder rim; front lifted via bounce'
        : '太阳或亮天空位于主体后方勾出轮廓，正面靠反光板或补光提亮' // cjk-ok
    gear =
      lang === 'en'
        ? ['Shoot backlit with low sun', 'Front bounce board or fill LED']
        : ['逆光机位对准主体并允许背景微过曝', '镜头侧使用反光板或补光灯提亮面部'] // cjk-ok
  } else if (outdoor && !lowLight && (r >= 2.0 || hard)) {
    setupKey = 'outdoor_sun'
    setupName = lang === 'en' ? 'Outdoor direct sun (hard light)' : '户外直射阳光（硬光）' // cjk-ok
    setupDetail =
      lang === 'en'
        ? 'Direct sunlight casting crisp shadows and strong contrast'
        : '晴天阳光直射主体，阴影边缘清晰、明暗反差大' // cjk-ok
    gear =
      lang === 'en'
        ? ['Angle subject 45° to sun', 'White bounce card to soften deep shadows']
        : ['让阳光位于主体侧前方 45°，避开正午顶光', '暗部用白卡/反光板适度回补'] // cjk-ok
  } else if (outdoor && !lowLight) {
    setupKey = 'outdoor_soft'
    setupName = lang === 'en' ? 'Outdoor overcast / open shade' : '户外阴天/背阴处柔光' // cjk-ok
    setupDetail =
      lang === 'en'
        ? 'Open sky acts as a giant soft source with minimal hard shadows'
        : '阴天或建筑背阴处，整片天空充当大面积柔光源' // cjk-ok
    gear =
      lang === 'en'
        ? ['Open shade facing open sky', 'Optional bottom bounce for catchlight']
        : ['站在阴影处面朝开阔天空拍摄', '可选下方反光板补充眼神光'] // cjk-ok
  } else if (
    bgLuma != null &&
    bgLuma < 22 &&
    !measured.pointLights &&
    subjLuma >= 100 &&
    darkShare > 0.4
  ) {
    setupKey = 'low_key'
    setupName = lang === 'en' ? 'Low-key studio lighting' : '低调束光（主体单亮、背景压黑）' // cjk-ok
    setupDetail =
      lang === 'en'
        ? 'Gridded key illuminates only the subject while background stays unlit'
        : '带蜂巢/束光附件的主光只照亮主体，背景远离墙面保持全黑' // cjk-ok
    gear =
      lang === 'en'
        ? ['LED + gridded softbox', 'Black backdrop or deep room separation']
        : ['LED + 带格栅柔光箱侧前打光', '黑色背景布或拉大主体与背景距离'] // cjk-ok
  } else if ((grade?.meanL ?? 0) > 68 && (grade?.darkShare ?? 1) < 0.03 && r < 1.6) {
    setupKey = 'high_key'
    setupName = lang === 'en' ? 'High-key bright lighting' : '高调明亮布光（美妆/产品风）' // cjk-ok
    setupDetail =
      lang === 'en'
        ? 'Bright, shadowless wrap lighting on both subject and light backdrop'
        : '主体与浅色背景均充分打亮，暗部几乎完全填平' // cjk-ok
    gear =
      lang === 'en'
        ? ['Dual large softboxes at 45°', 'Dedicated backdrop light on white ground']
        : ['左右双柔光箱 45° 均匀平铺', '独立背景灯打亮白底/浅色墙面'] // cjk-ok
  } else if ((grade?.brightSat ?? 0) > 0.5 && (grade?.hueBins ?? 0) >= 2 && !lowLight) {
    setupKey = 'colored_ambient'
    setupName = lang === 'en' ? 'Colored RGB / neon ambient' : '彩色氛围光（RGB 灯棒/霓虹）' // cjk-ok
    setupDetail =
      lang === 'en'
        ? 'Dual-hue RGB accents on background/rim paired with clean key on subject'
        : '侧后方使用双色对比 RGB 灯棒/灯带洗墙或勾边，正面保留干净主光' // cjk-ok
    gear =
      lang === 'en'
        ? ['Clean soft key light on subject', '2x RGB tube lights (e.g. cyan + magenta) behind']
        : ['正面小柔光箱保证主体肤色/固有色干净', '侧后方两支 RGB 灯管做冷暖/蓝粉对比勾边'] // cjk-ok
  } else if (lowLight) {
    setupKey = 'ambient_low_light'
    setupName = lang === 'en' ? 'Low-light practical ambient' : '夜景/弱光环境光' // cjk-ok
    setupDetail =
      lang === 'en'
        ? 'Lit primarily by practicals, screens, or street lights in low-light setting'
        : '主要由环境可见光源（台灯、屏幕、路灯）照亮' // cjk-ok
    gear =
      lang === 'en'
        ? ['Fast aperture / night mode', 'Small dim warm pocket LED near camera']
        : ['大光圈镜头或夜景模式拍摄', '机位旁可补一盏低亮度口袋暖光灯'] // cjk-ok
  } else if (r < 1.35) {
    setupKey = 'soft_front'
    setupName = lang === 'en' ? 'Soft frontal / ring light' : '正面柔光（环形灯/窗光）' // cjk-ok
    setupDetail =
      lang === 'en'
        ? 'Large frontal light source behind camera producing even illumination'
        : '大面积柔光源位于镜头正后方（环形灯、柔光平板或面朝窗户）' // cjk-ok
    gear =
      lang === 'en'
        ? ['18-inch ring light or diffused panel behind camera']
        : ['18 寸环形灯或带柔光罩平板灯置于镜头正后方略高处'] // cjk-ok
  } else if (r >= 2.5) {
    setupKey = 'hard_side'
    setupName =
      lang === 'en' ? 'High-contrast side key (Rembrandt)' : '单侧强反差布光（伦勃朗/侧光）' // cjk-ok
    setupDetail =
      lang === 'en'
        ? 'Single key at 60–90° side angle with minimal fill for dramatic falloff'
        : '单灯置于侧面 60–90°，不补光或用黑旗吸光以强化明暗层次' // cjk-ok
    gear =
      lang === 'en'
        ? ['Single key light at 60–90° side', 'Negative fill / black card on shadow side']
        : ['单盏柔光箱置于主体侧面 60–90°', '暗部侧不设补光或加黑卡压暗'] // cjk-ok
  }

  if (tb < 0.85) {
    setupDetail +=
      lang === 'en'
        ? '; lower half brighter (desk/screen bounce)'
        : '；主体下半部偏亮（存在桌面反光或屏幕底光）' // cjk-ok
  }

  return {
    ...measured,
    setupKey,
    setupName,
    setupDetail,
    keyDirection,
    quality,
    colorTemp,
    gear
  }
}

export function interpretColorGrade(
  measured: GradeAspectMeasured | undefined,
  lang: BreakdownLang = 'zh'
): GradeAspectMeasured | undefined {
  if (!measured || measured.sat == null) return measured
  const sat = measured.sat
  const con = measured.contrast ?? 0.2
  const black = measured.black ?? 5
  const meanL = measured.meanL ?? 50
  const meanB = measured.meanB ?? 6
  const lifted = black > 12
  const splitTealOrange = (measured.shadowB ?? 0) < -5 && (measured.highlightB ?? 0) > 8

  let lookKey: NonNullable<GradeAspectMeasured['lookKey']> = 'natural'
  let look = lang === 'en' ? 'Natural true-to-life color' : '自然原色（接近直出）' // cjk-ok

  if (sat < 0.06) {
    lookKey = 'monochrome'
    look = lang === 'en' ? 'Black & white / monochrome' : '黑白/单色调' // cjk-ok
  } else if (splitTealOrange) {
    lookKey = 'teal_orange'
    look = lang === 'en' ? 'Teal & orange cinematic split' : '青橙电影感（暗部偏青、高光偏暖）' // cjk-ok
  } else if (lifted && meanL > 55 && sat < 0.3) {
    lookKey = 'airy_japanese'
    look =
      lang === 'en' ? 'Airy low-contrast film (lifted blacks)' : '日系清新（明亮低饱和、黑位抬高）' // cjk-ok
  } else if (lifted && meanB > 12) {
    lookKey = 'vintage_film'
    look = lang === 'en' ? 'Warm vintage film (faded blacks)' : '复古胶片（黑位抬高、整体偏暖）' // cjk-ok
  } else if (meanL < 35 && sat < 0.3) {
    lookKey = 'dark_cinematic'
    look = lang === 'en' ? 'Moody desaturated dark grade' : '暗调低饱和（冷峻电影感）' // cjk-ok
  } else if (sat > 0.45 && con > 0.2) {
    lookKey = 'vivid'
    look = lang === 'en' ? 'Vivid high-saturation commercial' : '高饱和鲜艳商业调色' // cjk-ok
  }

  return {
    ...measured,
    lookKey,
    look
  }
}

/** Infer code/template render sub-style from deterministic spatial features. */
export function inferCodeRenderStyle(f: ShotForensicFeatures | undefined): CodeRenderStyleKind {
  if (!f) return 'ui'
  if ((f.fineDark ?? 0) >= 0.08 && (f.darkShare ?? 0) >= 0.4) return 'particles'
  if ((f.fineLight ?? 0) >= 0.08) return 'lineart'
  if ((f.aspects?.grade?.brightSat ?? 0) >= 0.55 && (f.darkShare ?? 0) >= 0.35) return 'neon'
  if ((f.axisEdgeRatio ?? 0) >= 0.62 && (f.flatRatio ?? 0) >= 0.48) return 'ui'
  if ((f.vectorFill ?? 0) >= 0.38 && (f.palette95 ?? 100) > 40) return 'gradient'
  if ((f.palette95 ?? 100) <= 18 && (f.flatRatio ?? 0) >= 0.6) return 'type'
  if ((f.axisEdgeRatio ?? 0) >= 0.48) return 'data'
  return 'shapes'
}

// ─── Multi-Track Sound Source Attribution (`rea_video/sound_source.py`) ──────

function normalizeDict(raw: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {}
  const sum = Object.values(raw).reduce((a, b) => a + Math.max(0, b), 0)
  if (sum <= EPS) return raw
  for (const [k, v] of Object.entries(raw)) out[k] = r3(Math.max(0, v) / sum)
  return out
}

export function classifySoundSources(input: {
  audio: AudioForensicAnalysis
  aiVideoShare: number
  liveActionShare: number
  avatarShare: number
  wholeVideo?: WholeVideoAnalysis
  lang?: BreakdownLang
}): NonNullable<AudioForensicAnalysis['soundSources']> {
  const { audio, aiVideoShare, liveActionShare, avatarShare, wholeVideo } = input
  const resets = Boolean(audio.perClipAudio?.resetsAtCuts)
  const summariesZh: string[] = []
  const summariesEn: string[] = []

  let voiceVerdict: SoundSourceVerdict | undefined
  if (audio.voice.present) {
    const raw: Record<string, number> = {
      tts: 0.36,
      human_recording: 0.38,
      ai_video_native: 0.26
    }
    const evZh: string[] = []
    const evEn: string[] = []
    if (resets && aiVideoShare >= 0.4) {
      raw.ai_video_native *= 3.2
      raw.tts *= 0.6
      evZh.push(
        `切镜处底噪跳变 ${audio.perClipAudio!.atCutsDb.toFixed(1)}dB（镜内 ${audio.perClipAudio!.withinShotsDb.toFixed(1)}dB），声音随生成的每段视频原生自带` // cjk-ok
      )
      evEn.push(
        `Noise floor jumps ${audio.perClipAudio!.atCutsDb.toFixed(1)}dB at cuts vs ${audio.perClipAudio!.withinShotsDb.toFixed(1)}dB within shots (per-clip AI native audio)`
      )
    } else if (audio.perClipAudio && !resets) {
      raw.ai_video_native *= 0.35
      evZh.push(`人声/底噪跨切镜连续，属后期整条铺设的配音轨`) // cjk-ok
      evEn.push(`Continuous audio bed across cuts indicates post-laid voice track`)
    }
    if ((audio.voice.pitchCv ?? 0.18) < 0.11) {
      raw.tts *= 2.1
      evZh.push(
        `基频波动较小（CV=${(audio.voice.pitchCv ?? 0.1).toFixed(2)}），韵律平稳偏 TTS 合成` // cjk-ok
      )
      evEn.push(
        `Low pitch variation (CV=${(audio.voice.pitchCv ?? 0.1).toFixed(2)}) leans toward TTS`
      )
    } else if (liveActionShare >= 0.5 && !resets) {
      raw.human_recording *= 1.9
      evZh.push(`实拍占比 ${(liveActionShare * 100).toFixed(0)}% 且基频自然起伏，倾向真人实录`) // cjk-ok
      evEn.push(`Live-action dominance with natural pitch contour favors human recording`)
    }
    if (avatarShare >= 0.35) {
      raw.tts *= 1.8
    }
    if (wholeVideo?.narration?.type === 'tts') {
      raw.tts *= 2.4
      evZh.push(`全片语义分析判定旁白为 TTS 合成音色`) // cjk-ok
      evEn.push(`Whole-video pass identified TTS narration`)
    } else if (wholeVideo?.narration?.type === 'human') {
      raw.human_recording *= 2.2
    }

    const probs = normalizeDict(raw)
    const top = Object.entries(probs).sort((a, b) => b[1] - a[1])[0]!
    const labelMap: Record<string, { zh: string; en: string }> = {
      tts: { zh: 'TTS 语音合成', en: 'TTS synthesis' }, // cjk-ok
      human_recording: { zh: '真人实录配音', en: 'Human recording' }, // cjk-ok
      ai_video_native: { zh: '视频模型原生直出语音', en: 'AI video native audio' } // cjk-ok
    }
    const meta = labelMap[top[0]] ?? { zh: top[0], en: top[0] }
    voiceVerdict = {
      source: top[0],
      sourceZh: meta.zh,
      sourceEn: meta.en,
      probs,
      confidence: top[1],
      evidence: (input.lang === 'en' ? evEn : evZh).slice(0, 4),
      howToConfirm:
        input.lang === 'en'
          ? ['Listen for breath intake before clauses and room reverb continuity across cuts']
          : ['细听句首换气声，并检查切镜瞬间混响尾音是否被硬截断'] // cjk-ok
    }
    summariesZh.push(`人声：${meta.zh} (${Math.round(top[1] * 100)}%)`) // cjk-ok
    summariesEn.push(`Voice: ${meta.en} (${Math.round(top[1] * 100)}%)`)
  }

  let musicVerdict: SoundSourceVerdict | undefined
  if (audio.music.present) {
    const raw: Record<string, number> = {
      existing_library: 0.48,
      ai_generated: 0.28,
      popular_song: 0.24
    }
    const evZh: string[] = []
    const evEn: string[] = []
    if ((audio.music.beatSyncedCutRatio ?? 0) >= 0.45) {
      raw.existing_library *= 1.6
      raw.popular_song *= 1.5
      evZh.push(
        `${Math.round((audio.music.beatSyncedCutRatio ?? 0) * 100)}% 切镜踩在音乐节拍网格上（卡点剪辑）` // cjk-ok
      )
      evEn.push(
        `${Math.round((audio.music.beatSyncedCutRatio ?? 0) * 100)}% of cuts land on the musical beat grid`
      )
    }
    if (audio.music.ending === 'hard_cut') {
      raw.existing_library *= 1.4
      raw.popular_song *= 1.4
      evZh.push(`片尾音乐被硬切断，常见于剪辑软件直接截取现成曲库/热门 BGM`) // cjk-ok
      evEn.push(`Music cuts off hard at tail, typical of trimmed library/commercial tracks`)
    }
    if (resets && aiVideoShare >= 0.6) {
      raw.ai_generated *= 2.0
      evZh.push(`音乐纹理随镜头切换跳变，可能含视频模型原生背景乐`) // cjk-ok
      evEn.push(`Musical bed shifts across cuts alongside AI video clips`)
    }
    const probs = normalizeDict(raw)
    const top = Object.entries(probs).sort((a, b) => b[1] - a[1])[0]!
    const labelMap: Record<string, { zh: string; en: string }> = {
      existing_library: { zh: '剪辑曲库/罐头配乐', en: 'Royalty-free / editor library BGM' }, // cjk-ok
      ai_generated: { zh: 'AI 生成音乐 (Suno/Udio/原生)', en: 'AI-generated music' }, // cjk-ok
      popular_song: { zh: '商业/热门歌曲片段', en: 'Commercial / popular track' } // cjk-ok
    }
    const meta = labelMap[top[0]] ?? { zh: top[0], en: top[0] }
    musicVerdict = {
      source: top[0],
      sourceZh: meta.zh,
      sourceEn: meta.en,
      probs,
      confidence: top[1],
      evidence: (input.lang === 'en' ? evEn : evZh).slice(0, 4),
      howToConfirm:
        input.lang === 'en'
          ? ['Run audio fingerprint / Shazam on the separated accompaniment stem']
          : ['对分离出的伴奏轨（instrumental.wav）做听歌识曲以确认具体曲名'] // cjk-ok
    }
    summariesZh.push(`配乐：${meta.zh} (${Math.round(top[1] * 100)}%)`) // cjk-ok
    summariesEn.push(`Music: ${meta.en} (${Math.round(top[1] * 100)}%)`)
  }

  let sfxVerdict: SoundSourceVerdict | undefined
  if (audio.sfx.present && audio.sfx.events.length > 0) {
    const cutSynced = audio.sfx.events.filter(
      (e) => e.syncedTo === 'cut' || e.syncedTo === 'text_pop'
    ).length
    const syncRatio = cutSynced / audio.sfx.events.length
    const raw: Record<string, number> = {
      library_editor: syncRatio >= 0.4 ? 0.68 : 0.4,
      ai_native: resets && aiVideoShare >= 0.5 ? 0.45 : 0.2,
      live_sync: liveActionShare >= 0.5 && !resets ? 0.45 : 0.15
    }
    const probs = normalizeDict(raw)
    const top = Object.entries(probs).sort((a, b) => b[1] - a[1])[0]!
    const labelMap: Record<string, { zh: string; en: string }> = {
      library_editor: { zh: '后期剪辑音效库贴片', en: 'Post-production editor SFX' }, // cjk-ok
      ai_native: { zh: '视频模型原生环境音效', en: 'AI video native SFX' }, // cjk-ok
      live_sync: { zh: '现场同期声', en: 'Live sync sound' } // cjk-ok
    }
    const meta = labelMap[top[0]] ?? { zh: top[0], en: top[0] }
    sfxVerdict = {
      source: top[0],
      sourceZh: meta.zh,
      sourceEn: meta.en,
      probs,
      confidence: top[1],
      evidence: [
        input.lang === 'en'
          ? `${audio.sfx.events.length} transient SFX hits (${cutSynced} aligned to cuts/overlays)`
          : `检出 ${audio.sfx.events.length} 处瞬态音效（其中 ${cutSynced} 处对齐切镜/花字弹出）` // cjk-ok
      ],
      howToConfirm:
        input.lang === 'en'
          ? ['Check whether transient hits repeat identical waveform envelopes (editor preset)']
          : ['对比多处转场音效波形是否完全一致（剪映/PR 预设音效特征）'] // cjk-ok
    }
    summariesZh.push(`音效：${meta.zh}`) // cjk-ok
    summariesEn.push(`SFX: ${meta.en}`)
  }

  return {
    summaryZh: summariesZh.join('；') || '未检出明显人声或配乐特征', // cjk-ok
    summaryEn: summariesEn.join('; ') || 'No prominent voice or music stems detected',
    ...(voiceVerdict ? { voice: voiceVerdict } : {}),
    ...(musicVerdict ? { music: musicVerdict } : {}),
    ...(sfxVerdict ? { sfx: sfxVerdict } : {})
  }
}

export function formatAiEditLabel(
  kind: ShotAiEditDetection['kind'],
  lang: BreakdownLang = 'zh'
): string {
  const meta = AI_EDIT_META[kind]
  return meta ? (lang === 'en' ? meta.en : meta.zh) : kind
}
