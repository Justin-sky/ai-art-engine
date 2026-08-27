import type { AdVariantMatrix } from './adVariantMatrix'
import { normalizeAdVariantMatrix } from './adVariantMatrix'

/** 广告变体矩阵在 genParams 中的存储键 */
export const AD_VARIANT_MATRIX_PARAM_KEY = 'adVariantMatrix'

export function readAdVariantMatrixFromGenParams(
  genParams?: Record<string, unknown> | null
): AdVariantMatrix | null {
  const raw = genParams?.[AD_VARIANT_MATRIX_PARAM_KEY]
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  return normalizeAdVariantMatrix(raw as Partial<AdVariantMatrix>)
}

export function withAdVariantMatrix(
  genParams: Record<string, unknown> | null | undefined,
  matrix: AdVariantMatrix
): Record<string, unknown> {
  return {
    ...(genParams ?? {}),
    [AD_VARIANT_MATRIX_PARAM_KEY]: matrix
  }
}
