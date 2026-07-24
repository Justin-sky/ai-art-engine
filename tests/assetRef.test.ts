import { describe, expect, it } from 'vitest'
import {
  ASSET_REF_TYPE,
  collectAssetGuids,
  readAssetGuid,
  remapAssetGuids,
  syncNodeAssetRefFields,
  tagAssetRef,
  upgradeLegacyAssetRefs
} from '../src/shared/assetRef'
import { createAssetGraphNode } from '../src/shared/graph/create'
import { normalizeGraph } from '../src/shared/graph/normalize'

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

describe('assetRef', () => {
  it('tags and reads GUID', () => {
    const ref = tagAssetRef(A)
    expect(ref).toEqual({ $type: ASSET_REF_TYPE, guid: A })
    expect(readAssetGuid(ref)).toBe(A)
    expect(readAssetGuid(A)).toBe(A)
    expect(readAssetGuid({ guid: A })).toBe(A)
  })

  it('collects tagged refs and legacy key strings', () => {
    const doc = {
      prompt: `see ${A} in text`,
      selectedImageId: A,
      genRefs: [{ assetId: A, role: 'character' }],
      stage: {
        linkedPanoramaAssetId: B,
        objects: [{ modelAssetId: C }]
      },
      nested: { ref: tagAssetRef(A) }
    }
    const guids = collectAssetGuids(doc).sort()
    expect(guids).toEqual([A, B, C].sort())
  })

  it('does not treat non-ref keys or non-uuid strings as refs', () => {
    expect(
      collectAssetGuids({
        shotIds: [A],
        folderId: A,
        notes: A,
        assetId: 'not-a-uuid'
      })
    ).toEqual([])
  })

  it('remaps only asset ref sites', () => {
    const map = new Map([[A, B]])
    const input = {
      notes: A,
      selectedImageId: A,
      genRefs: [{ assetId: A }],
      node: { assetRef: tagAssetRef(A) }
    }
    const out = remapAssetGuids(input, map)
    expect(out.notes).toBe(A)
    expect(out.selectedImageId).toBe(A)
    expect(out.genRefs[0].assetId).toBe(B)
    expect(out.node.assetRef.guid).toBe(B)
  })

  it('upgrades legacy bare GUID fields to TaggedAssetRef', () => {
    const legacy = {
      genRefs: [{ assetId: A }],
      modelAssetId: B
    }
    const upgraded = upgradeLegacyAssetRefs(legacy)
    expect(upgraded.genRefs[0].assetId).toEqual(tagAssetRef(A))
    expect(upgraded.modelAssetId).toEqual(tagAssetRef(B))
  })

  it('syncNodeAssetRefFields hydrates from either side', () => {
    expect(syncNodeAssetRefFields({ assetId: A })).toEqual({
      assetId: A,
      assetRef: tagAssetRef(A)
    })
    expect(syncNodeAssetRefFields({ assetRef: tagAssetRef(B) })).toEqual({
      assetId: B,
      assetRef: tagAssetRef(B)
    })
  })

  it('createAssetGraphNode dual-writes assetId and assetRef', () => {
    const node = createAssetGraphNode(A, 'image', 'Hero', { x: 0, y: 0 })
    expect(node.assetId).toBe(A)
    expect(node.assetRef).toEqual(tagAssetRef(A))
  })

  it('normalizeGraph hydrates assetRef from legacy assetId', () => {
    const graph = normalizeGraph({
      nodes: [
        {
          id: 'n1',
          category: 'asset',
          assetId: A,
          assetType: 'image',
          position: { x: 0, y: 0 },
          params: { assetRef: true }
        }
      ],
      edges: [],
      groups: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    })
    const node = graph.nodes.find((n) => n.id === 'n1')
    expect(node?.assetId).toBe(A)
    expect(node?.assetRef).toEqual(tagAssetRef(A))
  })

  it('normalizeGraph sets params.assetRef when only assetId is present', () => {
    const graph = normalizeGraph({
      nodes: [
        {
          id: 'n-voice',
          category: 'asset',
          assetId: A,
          assetType: 'voice',
          position: { x: 0, y: 0 },
          params: {}
        }
      ],
      edges: [],
      groups: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    })
    const node = graph.nodes.find((n) => n.id === 'n-voice')
    expect(node?.params.assetRef).toBe(true)
    expect(node?.assetRef).toEqual(tagAssetRef(A))
  })
})
