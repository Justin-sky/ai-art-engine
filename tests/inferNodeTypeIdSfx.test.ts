import { describe, expect, it } from 'vitest'
import { inferNodeTypeId } from '../src/shared/graph/registry'

/**
 * 音效 / 对话 / 音乐都是 voice 资产的变体。
 *
 * 踩过：renderer 产物过期、registry 里还没有 `asset.sfx` 时，
 * `inferNodeTypeId` 按 `assetType: 'voice'` 兜底成 `asset.voice`，
 * Cook 就会走 TTS 把「雷声」念出来。
 */
describe('inferNodeTypeId 声音变体', () => {
  it('registry 未注册时仍保留 asset.sfx / dialogue / music，不降成 asset.voice', () => {
    for (const typeId of ['asset.sfx', 'asset.dialogue', 'asset.music'] as const) {
      expect(
        inferNodeTypeId({
          typeId,
          category: 'asset',
          assetType: 'voice',
          params: {}
        }),
        typeId
      ).toBe(typeId)
    }
  })

  it('普通声音节点仍可从 assetType 推出 asset.voice', () => {
    expect(
      inferNodeTypeId({
        category: 'asset',
        assetType: 'voice',
        params: {}
      })
    ).toBe('asset.voice')
  })
})
