import { describe, expect, it } from 'vitest'
import { rewriteAtMentionsForImagePrompt } from '../src/shared/modelProviders/imagePromptMentions'

describe('rewriteAtMentionsForImagePrompt', () => {
  it('rewrites @n mentions to 图n for image reference alignment', () => {
    expect(rewriteAtMentionsForImagePrompt('参考@1「水彩」画风，强度0.75')).toBe(
      '参考图1「水彩」画风，强度0.75'
    )
    expect(rewriteAtMentionsForImagePrompt('用 @2 和 @10')).toBe('用 图2 和 图10')
  })

  it('does not touch email-like tokens', () => {
    expect(rewriteAtMentionsForImagePrompt('contact user@123.com please')).toBe(
      'contact user@123.com please'
    )
  })

  it('returns falsy input unchanged', () => {
    expect(rewriteAtMentionsForImagePrompt('')).toBe('')
  })
})
