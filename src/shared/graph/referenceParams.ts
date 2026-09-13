import { DEFAULT_MAX_INPUT_REFERENCES } from './imageGenerateParams'
import type { GraphNodeParams } from './types'
import { normalizeProjectStyleImages, type ProjectStyleImage } from '../stylePresets'

/**
 * 参考图类参数（styleImages / styleImagesUseGlobal / styleReferenceSubject / characterRefs）
 * 的可用性校验：放行 ≠ 可用。
 *
 * 两个写参入口共用，避免同一批键两套口径：
 * - GraphPlan 物化（materializeGraphPlan 的 ALLOWED_PARAM_KEYS 放行后调用）；
 * - MCP graph_edit（applyGraphEditOps 合并 op.params 后调用）。
 *
 * 为什么必须校验：风格图条目只有带 libraryId（风格库 id）或 data: 开头的 dataUrl 才解析得出
 * 参考图（见 renderer resolveStyleImageUrls）；角色引用只有带 imageUrl 才注入得进
 * inputReferences（执行侧 resolveCharacterReferenceUrls 的名字回退目录为空，只写名字解析不出来）。
 * 这里就地丢弃不可解析的值并告警，挡住两种最坏的假成功：
 * - 风格图非空却一张都解析不出 → 运行期抛 STYLE_IMAGES_LOAD_FAILED；
 * - styleImagesUseGlobal=false 但本地风格图为空 → 静默丢掉全局风格，产物没风格还报成功。
 */

/** 生成节点直接读取、但没有任何节点类型在 defaultParams 里声明的参考图参数键 */
export const REFERENCE_PARAM_KEYS = [
  'styleImages',
  'styleImagesUseGlobal',
  'styleReferenceSubject',
  'characterRefs'
] as const

/**
 * @param params 待校验参数（graph_edit 场景传「与节点现有 params 合并后」的值）
 * @param nodeLabel 告警里的节点标识（物化用计划里的 key，graph_edit 用 nodeId）
 */
export function sanitizeReferenceParams(
  params: Partial<GraphNodeParams>,
  nodeLabel: string,
  warnings: string[]
): Partial<GraphNodeParams> {
  const next = { ...params } as Record<string, unknown>

  const rawStyleImages = next.styleImages
  if (rawStyleImages !== undefined) {
    if (!Array.isArray(rawStyleImages)) {
      warnings.push(`节点「${nodeLabel}」styleImages 需要数组，已忽略`) // cjk-ok
      delete next.styleImages
    } else {
      const normalized = normalizeProjectStyleImages(rawStyleImages as ProjectStyleImage[])
      if (normalized.length < rawStyleImages.length) {
        warnings.push(
          `节点「${nodeLabel}」styleImages 丢弃 ${rawStyleImages.length - normalized.length} 条不可解析的风格图（条目须带 libraryId 或 data: 开头的 dataUrl）` // cjk-ok
        )
      }
      if (normalized.length) next.styleImages = normalized
      else delete next.styleImages
    }
  }

  if (next.styleImagesUseGlobal !== undefined && typeof next.styleImagesUseGlobal !== 'boolean') {
    warnings.push(`节点「${nodeLabel}」styleImagesUseGlobal 需要布尔值，已忽略`) // cjk-ok
    delete next.styleImagesUseGlobal
  }

  const subject = next.styleReferenceSubject
  if (subject !== undefined && subject !== 'default' && subject !== 'ui') {
    warnings.push(`节点「${nodeLabel}」styleReferenceSubject 只能是 default / ui，已忽略`) // cjk-ok
    delete next.styleReferenceSubject
  }

  const localStyleCount = Array.isArray(next.styleImages) ? next.styleImages.length : 0
  if (next.styleImagesUseGlobal === false && !localStyleCount) {
    warnings.push(
      `节点「${nodeLabel}」styleImagesUseGlobal=false 但本地风格图为空，已回落使用工程全局风格` // cjk-ok
    )
    delete next.styleImagesUseGlobal
  }

  const rawCharacterRefs = next.characterRefs
  if (rawCharacterRefs !== undefined) {
    if (!Array.isArray(rawCharacterRefs)) {
      warnings.push(`节点「${nodeLabel}」characterRefs 需要数组，已忽略`) // cjk-ok
      delete next.characterRefs
    } else {
      const refs: NonNullable<GraphNodeParams['characterRefs']> = []
      for (const raw of rawCharacterRefs) {
        if (!raw || typeof raw !== 'object') continue
        const row = raw as Record<string, unknown>
        const imageUrl = typeof row.imageUrl === 'string' ? row.imageUrl.trim() : ''
        if (!imageUrl) continue
        const name = typeof row.name === 'string' && row.name.trim() ? row.name.trim() : imageUrl
        refs.push({ name, imageUrl })
        if (refs.length >= DEFAULT_MAX_INPUT_REFERENCES) break
      }
      if (refs.length < rawCharacterRefs.length) {
        warnings.push(
          `节点「${nodeLabel}」characterRefs 丢弃 ${rawCharacterRefs.length - refs.length} 条无 imageUrl 的角色引用（只写名字解析不出参考图，请在节点检查器里绑定角色）` // cjk-ok
        )
      }
      if (refs.length) next.characterRefs = refs
      else delete next.characterRefs
    }
  }

  return next as Partial<GraphNodeParams>
}
