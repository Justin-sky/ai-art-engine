import { describe, expect, it } from 'vitest'
import { isAipackageAssetType, AIPACKAGE_ASSET_TYPES } from '../src/shared/assetPackage/types'

describe('aipackage asset types', () => {
  it('includes media and workflow document types', () => {
    expect(isAipackageAssetType('image')).toBe(true)
    expect(isAipackageAssetType('script')).toBe(true)
    expect(isAipackageAssetType('canvas')).toBe(true)
    expect(isAipackageAssetType('screenplay')).toBe(true)
    expect(isAipackageAssetType('motion')).toBe(true)
    expect(AIPACKAGE_ASSET_TYPES.has('video')).toBe(true)
  })
})
