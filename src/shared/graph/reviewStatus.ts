/** 表格 / 目录 JSON 审核状态（场、世界元素等通用） */
export const REVIEW_STATUS_OPTIONS = ['未审核', '已审核'] as const
export type ReviewStatus = (typeof REVIEW_STATUS_OPTIONS)[number]
export const DEFAULT_REVIEW_STATUS: ReviewStatus = '未审核'

export function normalizeReviewStatus(value: unknown): ReviewStatus {
  if (value === '已审核' || value === 'reviewed' || value === 'approved') return '已审核'
  return DEFAULT_REVIEW_STATUS
}
