import { isAnimationModelAsset, isPoseModelAsset, type AssetInfo } from '@shared/domain'

/**
 * 导演台 `in-model` 端口「接了线却什么都没出现」的原因判定。
 *
 * 为什么要单独做这件事：`createModelObject` 有两条**静默返回 null** 的路径，
 * 界面上不给任何提示 —— 用户只看到"导演台空的"，根本不知道是资产没入库、
 * 是动画资产不能当网格放，还是上游根本没产出。这类问题此前只能靠翻代码排查。
 *
 * 判定复用 `@shared/domain` 的 `isAnimationModelAsset` / `isPoseModelAsset`，
 * 不再各写一份 kind 判断（两套口径漂移正是这个仓库反复踩的坑）。
 */

/** `in-model` 上接了线但没能实例化的原因 */
export type DirectorIncomingModelIssue =
  /** 上游节点没解析出任何候选（运行态没留住、也没有可用的模型资产） */
  | 'noCandidate'
  /** 有候选，但资产不在资产库、又没有可用文件路径 → 拿不到文件 */
  | 'missingPath'
  /** 候选是动画片段 / 姿势资产：它们不是网格，按设计不能放到舞台上 */
  | 'notPlaceable'

/** 判定「为什么这个模型放不到舞台上」；能放则返回 null */
export function reasonNotPlaceable(
  model: Pick<AssetInfo, 'type' | 'genParams'>
): DirectorIncomingModelIssue | null {
  if (isAnimationModelAsset(model) || isPoseModelAsset(model)) return 'notPlaceable'
  return null
}
