import { describe, expect, it } from 'vitest'
import {
  applyCharacterReferenceUrls,
  characterReferenceImagesFromResults,
  characterRefsFromCatalog,
  resolveCharacterReferenceUrls
} from '../src/shared/graph'
import type { WorldEntityRef } from '../src/shared/domain'

describe('characterReferenceImagesFromResults', () => {
  it('collects only 角色 entries with name + imageUrl', () => {
    const results = [
      { type: '角色', name: '小明', imageUrl: 'https://x/ming.png' },
      { type: '场景', name: '街道', imageUrl: 'https://x/street.png' },
      { type: '角色', name: '', imageUrl: 'https://x/empty.png' },
      { type: '角色', name: '小红', imageUrl: '' }
    ]
    expect(characterReferenceImagesFromResults(results)).toEqual([
      { name: '小明', imageUrl: 'https://x/ming.png' }
    ])
  })

  it('dedups by normalized name (first hit wins)', () => {
    const results = [
      { type: '角色', name: '小 明', imageUrl: 'https://x/ming1.png' },
      { type: '角色', name: '小明', imageUrl: 'https://x/ming2.png' }
    ]
    expect(characterReferenceImagesFromResults(results)).toEqual([
      { name: '小 明', imageUrl: 'https://x/ming1.png' }
    ])
  })

  it('treats undefined type as non-character', () => {
    const results = [{ name: '小明', imageUrl: 'https://x/ming.png' }]
    expect(characterReferenceImagesFromResults(results)).toEqual([])
  })
})

describe('resolveCharacterReferenceUrls', () => {
  const images = [{ name: '小明', imageUrl: 'https://x/ming.png' }]

  it('prefers the ref own imageUrl over name match', () => {
    const refs: WorldEntityRef[] = [
      { name: '小明', imageUrl: 'https://x/own.png' }
    ]
    expect(resolveCharacterReferenceUrls(refs, images)).toEqual(['https://x/own.png'])
  })

  it('falls back to name match when ref lacks imageUrl', () => {
    const refs: WorldEntityRef[] = [{ name: '小明' }]
    expect(resolveCharacterReferenceUrls(refs, images)).toEqual(['https://x/ming.png'])
  })

  it('dedups and preserves reference order', () => {
    const refs: WorldEntityRef[] = [
      { name: '小明' },
      { name: '小明', imageUrl: 'https://x/ming.png' },
      { name: '小红' }
    ]
    expect(resolveCharacterReferenceUrls(refs, images)).toEqual(['https://x/ming.png'])
  })

  it('caps to the max limit', () => {
    const many = [
      { name: '小明', imageUrl: 'https://x/a.png' },
      { name: '小红', imageUrl: 'https://x/b.png' },
      { name: '小刚', imageUrl: 'https://x/c.png' }
    ]
    expect(resolveCharacterReferenceUrls(many, [], 2)).toEqual([
      'https://x/a.png',
      'https://x/b.png'
    ])
  })
})

describe('characterRefsFromCatalog', () => {
  it('expands catalog into refs with imageUrl', () => {
    const catalog = [
      { name: '小明', imageUrl: 'https://x/ming.png' },
      { name: '小红', imageUrl: 'https://x/hong.png' }
    ]
    expect(characterRefsFromCatalog(catalog)).toEqual([
      { name: '小明', imageUrl: 'https://x/ming.png' },
      { name: '小红', imageUrl: 'https://x/hong.png' }
    ])
  })

  it('caps to the max limit', () => {
    const catalog = [
      { name: '小明', imageUrl: 'https://x/a.png' },
      { name: '小红', imageUrl: 'https://x/b.png' },
      { name: '小刚', imageUrl: 'https://x/c.png' }
    ]
    expect(characterRefsFromCatalog(catalog, 2)).toEqual([
      { name: '小明', imageUrl: 'https://x/a.png' },
      { name: '小红', imageUrl: 'https://x/b.png' }
    ])
  })
})

describe('applyCharacterReferenceUrls', () => {
  const images = [{ name: '小明', imageUrl: 'https://x/ming.png' }]

  it('fills imageUrl onto refs that lack it, leaving existing ones', () => {
    const refs: WorldEntityRef[] = [
      { name: '小明' },
      { name: '小红', imageUrl: 'https://x/red.png' },
      { name: '小刚' }
    ]
    expect(applyCharacterReferenceUrls(refs, images)).toEqual([
      { name: '小明', imageUrl: 'https://x/ming.png' },
      { name: '小红', imageUrl: 'https://x/red.png' },
      { name: '小刚' }
    ])
  })
})
