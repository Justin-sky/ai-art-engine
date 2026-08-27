/** 表格 / 目录 JSON 审核状态（场、世界元素等通用） */
export const REVIEW_STATUS_OPTIONS = ['unreviewed', 'reviewed'] as const
export type ReviewStatus = (typeof REVIEW_STATUS_OPTIONS)[number]
export const DEFAULT_REVIEW_STATUS: ReviewStatus = 'unreviewed'

/**
 * 旧版状态值 → 规范英文 id（仅供测试 / 文档说明用途）。
 * 历史文档以中文「未审核 / 已审核」持久化；所有读取路径必须经过
 * normalizeReviewStatus 归一化，写入路径会重新归一化实现惰性迁移。
 */
export const LEGACY_REVIEW_STATUS: Record<string, ReviewStatus> = {
  未审核: 'unreviewed', // cjk-ok 旧版中文持久化值（只读兼容，不再写入）
  已审核: 'reviewed', // cjk-ok 旧版中文持久化值（只读兼容，不再写入）
  approved: 'reviewed',
  pending: 'unreviewed',
  review: 'unreviewed'
}

/** 判定是否「已审核」：对任意历史值 / 规范值都成立 */
export function isReviewedStatus(value: unknown): boolean {
  return normalizeReviewStatus(value) === 'reviewed'
}

export function normalizeReviewStatus(value: unknown): ReviewStatus {
  if (typeof value !== 'string') return DEFAULT_REVIEW_STATUS
  const raw = value.trim().toLowerCase()
  if (!raw) return DEFAULT_REVIEW_STATUS
  if (
    raw === '已审核' || // cjk-ok 旧值兼容
    raw === 'reviewed' ||
    raw === 'approved'
  ) {
    return 'reviewed'
  }
  if (
    raw === '未审核' || // cjk-ok 旧值兼容
    raw === 'unreviewed' ||
    raw === 'pending' ||
    raw === 'review'
  ) {
    return 'unreviewed'
  }
  return DEFAULT_REVIEW_STATUS
}
