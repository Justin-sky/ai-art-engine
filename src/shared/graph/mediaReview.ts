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
