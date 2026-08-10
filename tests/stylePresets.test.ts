import { describe, expect, it } from 'vitest'
import {
  DEFAULT_STYLE_IMAGE_WEIGHT,
  MAX_STYLE_IMAGES,
  appendStyleImagesReferencePrompt,
  buildStyleImagesReferencePrompt,
  clampStyleImageWeight,
  normalizeProjectStyleImages,
  portMentionIndex,
  resolveGenerateStyleImages,
  resolveStylePresetCategory,
  resolveStyleMentionReserveCount,
  styleImagesToPresetText,
  styleImagesToStrengthText,
  type ProjectStyleImage
} from '../src/shared/domain'

describe('normalizeProjectStyleImages', () => {
  it('keeps library and custom entries, drops invalid, fills weight', () => {
    const input: ProjectStyleImage[] = [
      { id: 'a', name: '电影感', libraryId: 'cinematic', weight: 0.4 },
      { id: 'b', name: '坏的', weight: 1 },
      { id: 'c', name: '自定义', dataUrl: 'data:image/png;base64,xx', weight: 2 }
    ]
    expect(normalizeProjectStyleImages(input)).toEqual([
      { id: 'a', name: '电影感', libraryId: 'cinematic', weight: 0.4 },
      { id: 'c', name: '自定义', dataUrl: 'data:image/png;base64,xx', weight: 1 }
    ])
  })

  it('defaults missing weight', () => {
    const input = [
      { id: 'a', name: '电影感', libraryId: 'cinematic' }
    ] as ProjectStyleImage[]
    expect(normalizeProjectStyleImages(input)[0]?.weight).toBe(DEFAULT_STYLE_IMAGE_WEIGHT)
  })

  it('clamps to max', () => {
    const input = Array.from({ length: 6 }, (_, i) => ({
      id: `s${i}`,
      name: `n${i}`,
      libraryId: `lib${i}`,
      weight: DEFAULT_STYLE_IMAGE_WEIGHT
    }))
    expect(normalizeProjectStyleImages(input)).toHaveLength(MAX_STYLE_IMAGES)
  })
})

describe('clampStyleImageWeight', () => {
  it('clamps and rounds', () => {
    expect(clampStyleImageWeight(-1)).toBe(0)
    expect(clampStyleImageWeight(1.2)).toBe(1)
    expect(clampStyleImageWeight(0.333)).toBe(0.33)
    expect(clampStyleImageWeight(undefined)).toBe(DEFAULT_STYLE_IMAGE_WEIGHT)
  })
})

describe('styleImagesToPresetText', () => {
  it('joins names', () => {
    expect(
      styleImagesToPresetText([
        { id: '1', name: '水彩', libraryId: 'watercolor', weight: 0.75 },
        { id: '2', name: '油画', libraryId: 'oil-painting', weight: 0.5 }
      ])
    ).toBe('水彩、油画')
  })
})

describe('styleImagesToStrengthText', () => {
  it('joins names with percent weights', () => {
    expect(
      styleImagesToStrengthText([
        { id: '1', name: '水彩', libraryId: 'watercolor', weight: 0.75 },
        { id: '2', name: '油画', libraryId: 'oil-painting', weight: 0.5 }
      ])
    ).toBe('水彩(75%)、油画(50%)')
  })
})

describe('buildStyleImagesReferencePrompt', () => {
  it('builds @n + strength clauses aligned with image array order', () => {
    const line = buildStyleImagesReferencePrompt([
      { id: '1', name: '水彩', libraryId: 'watercolor', weight: 0.75 },
      { id: '2', name: '油画', libraryId: 'oil-painting', weight: 0.5 }
    ])
    expect(line).toContain('参考@1「水彩」画风，强度0.75')
    expect(line).toContain('参考@2「油画」画风，强度0.5')
    expect(line).toContain('仅借鉴画风')
    expect(line).toContain('严禁迁移')
    expect(line).toContain('人脸')
    // 约束句里不应再写字面量 @n（易与真实 @1/@2 混淆）
    expect(line).not.toMatch(/@n\b/)
  })

  it('includes library detail prompt with the style image @n', () => {
    const line = buildStyleImagesReferencePrompt([
      {
        id: '1',
        name: '水彩',
        libraryId: 'watercolor',
        weight: 0.75,
        prompt: '透明叠色与湿边晕染，纸纹清晰'
      }
    ])
    expect(line).toContain('参考@1「水彩」画风，强度0.75')
    expect(line).toContain('画风要点：透明叠色与湿边晕染，纸纹清晰')
  })

  it('supports english locale', () => {
    const line = buildStyleImagesReferencePrompt(
      [{ id: '1', name: 'Watercolor', libraryId: 'watercolor', weight: 0.75 }],
      { locale: 'en-US' }
    )
    expect(line).toContain('use @1 ("Watercolor") for style only, strength 0.75')
    expect(line).toContain('Do not copy faces')
    expect(line).toContain('identity')
    expect(line).not.toMatch(/@n\b/)
  })
})

describe('appendStyleImagesReferencePrompt', () => {
  it('appends after user prompt without expanding @n', () => {
    expect(
      appendStyleImagesReferencePrompt('一只猫', [
        { id: '1', name: '水彩', libraryId: 'watercolor', weight: 0.8 }
      ])
    ).toContain('一只猫\n\n参考@1「水彩」画风，强度0.8')
  })
})

describe('resolveStyleMentionReserveCount / portMentionIndex', () => {
  it('counts style slots for @n offset', () => {
    expect(
      resolveStyleMentionReserveCount(
        { styleImagesUseGlobal: true },
        [
          { id: '1', name: 'a', libraryId: 'a', weight: 0.75 },
          { id: '2', name: 'b', libraryId: 'b', weight: 0.5 }
        ]
      )
    ).toBe(2)
    expect(portMentionIndex(0, 2)).toBe(3)
  })
})

describe('resolveGenerateStyleImages', () => {
  const globalStyles: ProjectStyleImage[] = [
    { id: 'g1', name: '电影感', libraryId: 'cinematic', weight: 0.7 }
  ]
  const localStyles: ProjectStyleImage[] = [
    { id: 'l1', name: '水彩', libraryId: 'watercolor', weight: 0.5 }
  ]

  it('defaults to global styles', () => {
    expect(resolveGenerateStyleImages({}, globalStyles)).toEqual(globalStyles)
    expect(
      resolveGenerateStyleImages({ styleImagesUseGlobal: true, styleImages: localStyles }, globalStyles)
    ).toEqual(globalStyles)
  })

  it('uses local when global disabled; empty local yields empty', () => {
    expect(
      resolveGenerateStyleImages(
        { styleImagesUseGlobal: false, styleImages: localStyles },
        globalStyles
      )
    ).toEqual(localStyles)
    expect(
      resolveGenerateStyleImages({ styleImagesUseGlobal: false, styleImages: [] }, globalStyles)
    ).toEqual([])
  })
})

describe('resolveStylePresetCategory', () => {
  it('resolves ui category from id prefix and explicit category', () => {
    expect(resolveStylePresetCategory({ id: 'ui-screen-01' })).toBe('ui')
    expect(resolveStylePresetCategory({ id: 'anything', category: 'ui' })).toBe('ui')
    expect(resolveStylePresetCategory({ id: 'character-hyper-real-photo' })).toBe('character')
    expect(resolveStylePresetCategory({ id: 'scene-anything' })).toBe('scene')
  })
})
