import { describe, expect, it } from 'vitest'
import {
  isAssetMetaFileName,
  mediaNameFromMetaFileName,
  metaFileNameForDocument,
  metaFileNameForMedia,
  PROJECT_ASSET_LAYOUT_VERSION
} from '../src/shared/assetStorage/layout'

describe('assetStorage layout', () => {
  it('uses layout version 2', () => {
    expect(PROJECT_ASSET_LAYOUT_VERSION).toBe(2)
  })

  it('derives media companion meta names', () => {
    expect(metaFileNameForMedia('Hero.png')).toBe('Hero.png.asset.json')
    expect(isAssetMetaFileName('Hero.png.asset.json')).toBe(true)
    expect(mediaNameFromMetaFileName('Hero.png.asset.json')).toBe('Hero.png')
  })

  it('names document metas by type', () => {
    expect(metaFileNameForDocument('Opening', 'script')).toBe('Opening.script.asset.json')
    expect(mediaNameFromMetaFileName('Opening.script.asset.json')).toBe('Opening.script')
  })
})
