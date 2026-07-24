import { describe, expect, it } from 'vitest'
import { listRefMentionOptions, type AssetType } from '../src/shared/domain'

describe('shot reference mention options', () => {
  it('inserts readable labels while keeping @ tokens for menu lookup', () => {
    const names = new Map([['character-1', '林默']])
    const types = new Map<string, AssetType>([['character-1', 'image']])

    const options = listRefMentionOptions(
      [{ role: 'character', assetId: 'character-1', refIndex: 1 }],
      [],
      names,
      types
    )

    expect(options).toEqual([
      {
        token: '@1',
        label: '参考1·Image·林默',
        kind: 'visual',
        insertText: '[参考1·Image·林默]'
      }
    ])
  })
})
