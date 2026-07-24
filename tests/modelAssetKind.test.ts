import { describe, expect, it } from 'vitest'
import {
  assetDisplayIcon,
  detectModelPreviewMeta,
  isAnimationModelAsset,
  MODEL_ANIMATION_ICON,
  ASSET_TYPE_ICONS,
  readModelAssetKind
} from '../src/shared/domain'

describe('model animation asset kind', () => {
  it('detects animation-only meta', () => {
    expect(detectModelPreviewMeta(false, true, 1).animationOnly).toBe(true)
    expect(detectModelPreviewMeta(true, true, 1).animationOnly).toBe(false)
    expect(detectModelPreviewMeta(false, true, 0).animationOnly).toBe(false)
    expect(detectModelPreviewMeta(false, false, 1).animationOnly).toBe(false)
  })

  it('reads modelKind from genParams', () => {
    expect(readModelAssetKind({ modelKind: 'animation' })).toBe('animation')
    expect(readModelAssetKind({})).toBe('model')
    expect(
      isAnimationModelAsset({ type: 'model', genParams: { modelKind: 'animation' } })
    ).toBe(true)
    expect(isAnimationModelAsset({ type: 'model', genParams: {} })).toBe(false)
  })

  it('uses animation clip icon for animation models', () => {
    expect(
      assetDisplayIcon({ type: 'model', genParams: { modelKind: 'animation' } })
    ).toBe(MODEL_ANIMATION_ICON)
    expect(assetDisplayIcon({ type: 'model', genParams: {} })).toBe(ASSET_TYPE_ICONS.model)
  })
})
