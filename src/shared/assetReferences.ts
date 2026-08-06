/**
 * 工程内资产引用查找（Find References）。
 * 基于 collectAssetGuids，扫描其他资产文档。
 */

import { collectAssetGuids } from './assetRef'
import type { AssetInfo } from './domain'

export type AssetReferenceSite =
  | {
      kind: 'asset'
      assetId: string
      assetName: string
      assetType: AssetInfo['type']
    }

export interface AssetReferenceHit {
  /** 被引用的目标资产 id */
  targetId: string
  site: AssetReferenceSite
}

export interface FindAssetReferencesResult {
  hits: AssetReferenceHit[]
}

/**
 * 在给定资产集合中查找对 `targetIds` 的引用。
 * - 不把「即将删除集合」内的资产当作引用源（互相引用随删一并消失）
 */
export function findAssetReferencesInProject(
  targetIds: readonly string[],
  assets: readonly AssetInfo[]
): FindAssetReferencesResult {
  const targets = new Set(targetIds.filter(Boolean))
  if (!targets.size) return { hits: [] }

  const hits: AssetReferenceHit[] = []

  for (const asset of assets) {
    if (targets.has(asset.id)) continue
    for (const guid of collectAssetGuids(asset)) {
      if (!targets.has(guid) || guid === asset.id) continue
      hits.push({
        targetId: guid,
        site: {
          kind: 'asset',
          assetId: asset.id,
          assetName: asset.name,
          assetType: asset.type
        }
      })
    }
  }

  return { hits }
}

/** 去重后的引用源摘要（按 site 身份），用于 UI 提示 */
export function summarizeReferenceSites(hits: readonly AssetReferenceHit[]): AssetReferenceSite[] {
  const seen = new Set<string>()
  const sites: AssetReferenceSite[] = []
  for (const hit of hits) {
    const key = `asset:${hit.site.assetId}`
    if (seen.has(key)) continue
    seen.add(key)
    sites.push(hit.site)
  }
  return sites
}
