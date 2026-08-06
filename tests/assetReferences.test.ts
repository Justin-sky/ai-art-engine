import { describe, expect, it } from 'vitest'
import { tagAssetRef } from '../src/shared/assetRef'
import {
  findAssetReferencesInProject,
  summarizeReferenceSites
} from '../src/shared/assetReferences'
import type { AssetInfo } from '../src/shared/domain'

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

function asset(partial: Partial<AssetInfo> & Pick<AssetInfo, 'id' | 'name'>): AssetInfo {
  return {
    type: 'image',
    relativePath: '',
    version: 1,
    createdAt: '',
    updatedAt: '',
    ...partial
  }
}

describe('findAssetReferencesInProject', () => {
  it('finds refs from other assets', () => {
    const assets = [
      asset({ id: A, name: 'Hero' }),
      asset({
        id: B,
        name: 'Workflow',
        type: 'script',
        genParams: { graphJson: { nodes: [{ assetId: A }] } }
      })
    ]
    const { hits } = findAssetReferencesInProject([A], assets)
    expect(hits.map((h) => h.site.kind)).toEqual(['asset'])
    const sites = summarizeReferenceSites(hits)
    expect(sites).toHaveLength(1)
  })

  it('ignores refs from assets being deleted together', () => {
    const assets = [
      asset({ id: A, name: 'A', genParams: { modelAssetId: B } }),
      asset({ id: B, name: 'B' })
    ]
    const { hits } = findAssetReferencesInProject([A, B], assets)
    expect(hits).toEqual([])
  })

  it('finds tagged AssetRef', () => {
    const assets = [
      asset({ id: A, name: 'A' }),
      asset({
        id: C,
        name: 'C',
        genParams: { ref: tagAssetRef(A) }
      })
    ]
    const { hits } = findAssetReferencesInProject([A], assets)
    expect(hits).toHaveLength(1)
    expect(hits[0].site).toMatchObject({ kind: 'asset', assetId: C })
  })
})
