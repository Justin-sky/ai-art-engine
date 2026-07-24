import { describe, expect, it } from 'vitest'
import { resolveAssetPreviewMediaPath } from '../src/shared/graph/assetPreviewPath'
import type { AssetInfo } from '../src/shared/domain'

function baseAsset(partial: Partial<AssetInfo> & Pick<AssetInfo, 'id' | 'type'>): AssetInfo {
  return {
    name: 'A',
    relativePath: '',
    version: 1,
    createdAt: '',
    updatedAt: '',
    ...partial
  }
}

describe('resolveAssetPreviewMediaPath', () => {
  it('prefers own relativePath when thumb is legacy fake', () => {
    const asset = baseAsset({
      id: '1',
      type: 'image',
      relativePath: 'Assets/a.png',
      thumbnailPath: 'Assets/a.png'
    })
    expect(resolveAssetPreviewMediaPath(asset)).toBe('Assets/a.png')
  })

  it('prefers real thumbnail path when present', () => {
    const asset = baseAsset({
      id: '1',
      type: 'image',
      relativePath: 'Assets/a.png',
      thumbnailPath: '.aiartengine/thumbs/Assets/a.png.png'
    })
    expect(resolveAssetPreviewMediaPath(asset)).toBe('.aiartengine/thumbs/Assets/a.png.png')
  })

  it('reads materialized runState image path from graphJson', () => {
    const asset = baseAsset({
      id: 'host',
      type: 'image',
      genParams: {
        graphJson: {
          nodes: [{ id: 'image-output', category: 'output', typeId: 'output.image', position: { x: 0, y: 0 }, params: {} }],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
          runStates: {
            'image-output': {
              status: 'done',
              outputs: {
                out: {
                  kind: 'image',
                  dataUrl: '',
                  relativePath: '.aiartengine/graph-outputs/out.png'
                }
              }
            }
          }
        }
      }
    })
    expect(resolveAssetPreviewMediaPath(asset)).toBe('.aiartengine/graph-outputs/out.png')
  })

  it('falls back to referenced asset media in graph', () => {
    const host = baseAsset({
      id: 'host',
      type: 'image',
      genParams: {
        graphJson: {
          nodes: [
            {
              id: 'n1',
              category: 'asset',
              typeId: 'asset.image',
              assetId: 'other',
              assetType: 'image',
              position: { x: 0, y: 0 },
              params: { assetRef: true }
            }
          ],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 }
        }
      }
    })
    const other = baseAsset({
      id: 'other',
      type: 'image',
      relativePath: 'Assets/other.png'
    })
    expect(resolveAssetPreviewMediaPath(host, [host, other])).toBe('Assets/other.png')
  })
})
