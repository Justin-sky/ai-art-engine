/**
 * 媒体质检（导演 PASS/FAIL）数据模型与提示词构建：给生成结果（图片/视频）加视觉质检节点。
 * 复用通用 Agent 质检层（agentPrompts.ts）的框架 / 通过标准 / 结论解析；本文件只补「媒体域」
 * 的硬性检查清单与参数回标辅助。保持纯函数、无渲染环境依赖，结论回标存 GraphNodeParams。
 */
import {
  buildAgentReviewPack,
  parseAgentVerdict,
  type AgentPromptPack
} from './agentPrompts'

/** 媒体质检结论（与通用 parseAgentVerdict 同构，语义化命名） */
export interface MediaReviewVerdict {
  result: 'PASS' | 'FAIL'
  reason: string
}

/** 媒体质检硬性检查清单（图片/视频通用，逐条） */
export const MEDIA_REVIEW_CHECKLIST_ZH = `1. 主体与指令一致：画面主体、数量、身份是否与生成指令一致，无错乱/缺失/多余主体。
2. 结构完整：无缺肢、多余肢体、五官/手指畸形、文字乱码、拼接痕迹、水印。
3. 构图与可读性：主体清晰可辨、无严重遮挡/裁切/糊脸，能直接用于下游。
4. 风格与一致性：风格、色调、角色形象与参考图/上一阶段产物一致。
5. 可执行性：分辨率/画幅可用，无会破坏下游合成或投放的缺陷。`

export const MEDIA_REVIEW_CHECKLIST_EN = `1. Subject–instruction match: subject, count, and identity match the generation instruction; no missing/extra/substituted subjects.
2. Structural integrity: no missing limbs, extra limbs, malformed face/hands, garbled text, seams, or watermarks.
3. Composition & readability: subject is clearly legible, no severe occlusion/cropping/blur; usable downstream.
4. Style & consistency: style, tone, and character appearance match the reference/prior-stage artifact.
5. Executability: usable resolution/aspect ratio; no defect that would break downstream compositing or delivery.`

export interface BuildMediaReviewPackInput {
  /** 审核对象名（缺省「生成结果」） */
  targetZh?: string
  targetEn?: string
  /** 上游语境说明（@n 与参考/上一阶段产物的对应关系） */
  contextZh?: string
  contextEn?: string
  /** 硬性检查清单覆盖 */
  checkZh?: string
  checkEn?: string
  /** 审核框架覆盖（缺省用通用五维框架） */
  frameworkZh?: string
  frameworkEn?: string
  /** 通过标准覆盖（缺省用通用通过标准） */
  passStandardZh?: string
  passStandardEn?: string
}

/** 组装媒体质检审核包（人设 + 媒体检查项 + 可解析输出协议） */
export function buildMediaReviewPack(input: BuildMediaReviewPackInput = {}): AgentPromptPack {
  return buildAgentReviewPack({
    targetZh: input.targetZh ?? '生成结果',
    targetEn: input.targetEn ?? 'generated media',
    contextZh: input.contextZh ?? '',
    contextEn: input.contextEn ?? '',
    checkZh: input.checkZh ?? MEDIA_REVIEW_CHECKLIST_ZH,
    checkEn: input.checkEn ?? MEDIA_REVIEW_CHECKLIST_EN,
    ...(input.frameworkZh !== undefined ? { frameworkZh: input.frameworkZh } : {}),
    ...(input.frameworkEn !== undefined ? { frameworkEn: input.frameworkEn } : {}),
    ...(input.passStandardZh !== undefined ? { passStandardZh: input.passStandardZh } : {}),
    ...(input.passStandardEn !== undefined ? { passStandardEn: input.passStandardEn } : {})
  })
}

/** 解析质检结论：`## 结论: PASS` 或 `## 结论: FAIL (原因: …)`；无结论返回 null */
export function parseMediaReviewVerdict(text: string): MediaReviewVerdict | null {
  return parseAgentVerdict(text)
}

/** 质检结论 → 节点参数回标片段（mediaReviewStatus / mediaReviewReason / mediaReviewPending） */
export function mediaReviewParamsFromVerdict(verdict: MediaReviewVerdict): {
  mediaReviewStatus: 'PASS' | 'FAIL'
  mediaReviewReason: string
  mediaReviewPending: boolean
} {
  return {
    mediaReviewStatus: verdict.result,
    mediaReviewReason: verdict.reason,
    mediaReviewPending: false
  }
}

/** 已审核缓存文案（无完整审核清单时兜底展示结论） */
export function mediaReviewCachedText(status: string, reason: string): string {
  if (status === 'PASS') return '质检结论: PASS'
  return `质检结论: FAIL${reason ? ` — ${reason}` : ''}`
}

/* ────────────────────────────── 质检模型选择 ────────────────────────────── */

export interface ReviewModelSelection {
  model?: string
  providerInstanceId?: string
  /** 是否用了专用质检模型；false 表示回退到生成模型（UI 应提示用户配置） */
  dedicated: boolean
}

/**
 * 解析质检所用模型：优先节点专用质检模型，回退生成模型以兼容旧图。
 * 返工节点历史上把「图像模型」同时用于生图与质检，导致质检结论不可信；
 * 引入 reviewModel 后两者解耦，dedicated=false 时 UI 应显式告警。
 */
export function resolveReviewModel(params: {
  reviewModel?: string
  reviewProviderInstanceId?: string
  generateModel?: string
  generateProviderInstanceId?: string
}): ReviewModelSelection {
  const model = params.reviewModel?.trim()
  if (model) {
    const provider = params.reviewProviderInstanceId?.trim()
    return { model, ...(provider ? { providerInstanceId: provider } : {}), dedicated: true }
  }
  const fallback = params.generateModel?.trim()
  const fallbackProvider = params.generateProviderInstanceId?.trim()
  return {
    ...(fallback ? { model: fallback } : {}),
    ...(fallbackProvider ? { providerInstanceId: fallbackProvider } : {}),
    dedicated: false
  }
}

/* ────────────────────────────── 输入身份判定 ────────────────────────────── */

/** 质检输入角色：reference=比对基准（不评分），artifact=待审产物（评分并判定） */
export type MediaReviewRole = 'reference' | 'artifact'

/**
 * 判定每张输入图的角色。
 * 改造前所有上游图片被拉平后一股脑塞给模型，模型无从知道该拿谁跟谁比，
 * 「与参考图一致」这条硬性检查实际无法执行。此处显式区分并在提示词中标注。
 */
export function resolveMediaReviewRoles(
  count: number,
  referenceCount?: number
): MediaReviewRole[] {
  if (!Number.isFinite(count) || count <= 0) return []
  const total = Math.floor(count)
  let refs: number
  if (
    typeof referenceCount === 'number' &&
    Number.isFinite(referenceCount) &&
    referenceCount >= 0
  ) {
    refs = Math.round(referenceCount)
  } else {
    refs = total > 1 ? 1 : 0
  }
  // 至少保留一张作为审核对象
  refs = Math.max(0, Math.min(refs, total - 1))
  return Array.from({ length: total }, (_, index) =>
    index < refs ? ('reference' as const) : ('artifact' as const)
  )
}

/* ────────────────────────────── 五维评分解析 ────────────────────────────── */

export interface MediaReviewScoreItem {
  name: string
  score: number
}

export interface MediaReviewScores {
  items: MediaReviewScoreItem[]
  /** 各项均分（保留两位）；无有效项时为 0 */
  average: number
}

/** 审核清单行：`1. 完整性：4 — 说明` / `- Consistency: 4/5 — note` */
const REVIEW_SCORE_LINE_RE =
  /^(?:[-*]\s*|\d+\s*[.)、]\s*)?(.{1,28}?)\s*[:：]\s*([1-5])\s*(?:\/\s*5|分|points?)?\b/i // cjk-ok 正则需匹配模型输出的中文标点与「分」字

/**
 * 解析「## 审核清单」段落内的逐项打分。
 * 提示词要求模型逐项给 1~5 分，此前这些分数未被解析落库，
 * 导致「平均分 >= 4 才 PASS」的阈值形同虚设；落库后可用于展示与选优。
 */
export function parseMediaReviewScores(text: string): MediaReviewScores | null {
  if (!text?.trim()) return null
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const items: MediaReviewScoreItem[] = []
  let inChecklist = false
  for (const raw of lines) {
    const line = raw.trim()
    if (/^##\s*/.test(line)) {
      inChecklist = /^##\s*(?:审核清单|checklist|review\s+checklist)/i.test(line) // cjk-ok 正则需匹配中英文小标题
      continue
    }
    if (!inChecklist || !line) continue
    const match = REVIEW_SCORE_LINE_RE.exec(line)
    if (!match) continue
    items.push({ name: match[1]!.trim(), score: Number(match[2]) })
  }
  if (!items.length) return null
  const sum = items.reduce((acc, item) => acc + item.score, 0)
  return { items, average: Math.round((sum / items.length) * 100) / 100 }
}

export function serializeMediaReviewScores(scores: MediaReviewScores): string {
  return `${JSON.stringify(scores, null, 2)}\n`
}

export function parseMediaReviewScoresParam(raw: string | null | undefined): MediaReviewScores | null {
  if (!raw?.trim()) return null
  try {
    const parsed = JSON.parse(raw) as Partial<MediaReviewScores>
    if (!Array.isArray(parsed.items)) return null
    const items = parsed.items.filter(
      (item): item is MediaReviewScoreItem =>
        !!item && typeof item.name === 'string' && typeof item.score === 'number'
    )
    if (!items.length) return null
    return { items, average: typeof parsed.average === 'number' ? parsed.average : 0 }
  } catch {
    return null
  }
}

/* ────────────────────────────── 客观校验 ────────────────────────────── */

export type MediaObjectiveIssueCode =
  | 'count-mismatch'
  | 'aspect-ratio-mismatch'
  | 'resolution-too-low'

export interface MediaObjectiveIssue {
  code: MediaObjectiveIssueCode
  /** 英文技术描述，供注入返工提示词；界面展示由 i18n 按 code 翻译 */
  detail: string
}

export interface MediaObjectiveInput {
  /** 期望图片张数（生成节点 n）；缺省不校验 */
  expectedCount?: number
  actualCount?: number
  /** 期望宽高比（如 "16:9"）；缺省不校验 */
  expectedAspectRatio?: string
  actualAspectRatio?: string
  /** 最小边长下限（px）；缺省不校验 */
  minEdge?: number
  actualWidth?: number
  actualHeight?: number
}

/** 宽高比容差：生成侧存在取整误差，过严会误判 */
const ASPECT_RATIO_TOLERANCE = 0.02

function parseAspectRatio(value: string | undefined): number | null {
  if (!value) return null
  const match = /^\s*(\d+(?:\.\d+)?)\s*[:x／]\s*(\d+(?:\.\d+)?)\s*$/i.exec(value)
  if (!match) return null
  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || height === 0) return null
  return width / height
}

/**
 * 程序侧客观校验：数量 / 宽高比 / 分辨率下限。
 * 这些指标不该花视觉模型的调用去判，前置拦截可省下一整轮生图 + 质检。
 */
export function checkMediaObjective(input: MediaObjectiveInput): MediaObjectiveIssue[] {
  const issues: MediaObjectiveIssue[] = []

  if (
    typeof input.expectedCount === 'number' &&
    Number.isFinite(input.expectedCount) &&
    typeof input.actualCount === 'number' &&
    input.actualCount !== input.expectedCount
  ) {
    issues.push({
      code: 'count-mismatch',
      detail: `expected ${input.expectedCount}, got ${input.actualCount}`
    })
  }

  const expectedRatio = parseAspectRatio(input.expectedAspectRatio)
  const actualRatio = parseAspectRatio(input.actualAspectRatio)
  if (expectedRatio !== null && actualRatio !== null) {
    if (Math.abs(expectedRatio - actualRatio) > ASPECT_RATIO_TOLERANCE) {
      issues.push({
        code: 'aspect-ratio-mismatch',
        detail: `expected ${input.expectedAspectRatio}, got ${input.actualAspectRatio}`
      })
    }
  }

  if (typeof input.minEdge === 'number' && Number.isFinite(input.minEdge) && input.minEdge > 0) {
    const width = input.actualWidth ?? 0
    const height = input.actualHeight ?? 0
    if (width > 0 && height > 0) {
      const shortEdge = Math.min(width, height)
      if (shortEdge < input.minEdge) {
        issues.push({
          code: 'resolution-too-low',
          detail: `min edge ${input.minEdge}px, got ${shortEdge}px (${width}x${height})`
        })
      }
    }
  }

  return issues
}

export function serializeMediaObjectiveIssues(issues: readonly MediaObjectiveIssue[]): string {
  return `${JSON.stringify(issues, null, 2)}\n`
}

export function parseMediaObjectiveIssues(
  raw: string | null | undefined
): MediaObjectiveIssue[] {
  if (!raw?.trim()) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item): item is MediaObjectiveIssue =>
        !!item &&
        typeof item === 'object' &&
        typeof (item as MediaObjectiveIssue).code === 'string' &&
        typeof (item as MediaObjectiveIssue).detail === 'string'
    )
  } catch {
    return []
  }
}
