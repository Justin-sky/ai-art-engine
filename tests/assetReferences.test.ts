import { describe, expect, it } from 'vitest'
import { tagAssetRef } from '../src/shared/assetRef'
import {
  findAssetReferencesInProject,
  summarizeReferenceSites
} from '../src/shared/assetReferences'
import type { AssetInfo, Shot } from '../src/shared/domain'

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const SCRIPT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const SHOT = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'

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

function shot(partial: Partial<Shot> & Pick<Shot, 'id' | 'title'>): Shot {
  return {
    status: 'draft',
    prompt: '',
    createdAt: '',
    updatedAt: '',
    ...partial
  } as Shot
}

describe('findAssetReferencesInProject', () => {
  it('finds refs from other assets and shots', () => {
    const assets = [
      asset({ id: A, name: 'Hero' }),
      asset({
        id: B,
        name: 'Workflow',
        type: 'script',
        genParams: { graphJson: { nodes: [{ assetId: A }] } }
      })
    ]
    const shots = [
      shot({
        id: SHOT,
        title: 'Opening',
        scriptAssetId: SCRIPT,
        genRefs: [{ assetId: A, role: 'character', refIndex: 1 }]
      })
    ]
    const { hits } = findAssetReferencesInProject([A], assets, shots)
    expect(hits.map((h) => h.site.kind).sort()).toEqual(['asset', 'shot'])
    const sites = summarizeReferenceSites(hits)
    expect(sites).toHaveLength(2)
  })

  it('ignores refs from assets being deleted together', () => {
    const assets = [
      asset({ id: A, name: 'A', genParams: { modelAssetId: B } }),
      asset({ id: B, name: 'B' })
    ]
    const { hits } = findAssetReferencesInProject([A, B], assets, [])
    expect(hits).toEqual([])
  })

  it('ignores shots owned by a script being deleted', () => {
    const assets = [asset({ id: SCRIPT, name: 'Script', type: 'script' }), asset({ id: A, name: 'Hero' })]
    const shots = [
      shot({
        id: SHOT,
        title: 'Owned',
        scriptAssetId: SCRIPT,
        genRefs: [{ assetId: A, role: 'character', refIndex: 1 }]
      })
    ]
    // 删脚本会级联删分镜 → 分镜上的引用不提示
    expect(findAssetReferencesInProject([SCRIPT], assets, shots).hits).toEqual([])
    // 只删图片、脚本保留 → 分镜引用应提示
    expect(findAssetReferencesInProject([A], assets, shots).hits).toHaveLength(1)
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
    const { hits } = findAssetReferencesInProject([A], assets, [])
    expect(hits).toHaveLength(1)
    expect(hits[0].site).toMatchObject({ kind: 'asset', assetId: C })
  })
})
