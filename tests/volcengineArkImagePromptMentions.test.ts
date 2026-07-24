import { describe, expect, it } from 'vitest'
import { rewriteAtMentionsForVolcengineArkImagePrompt } from '../src/shared/modelProviders/volcengineArk/imagePromptMentions'

describe('rewriteAtMentionsForVolcengineArkImagePrompt', () => {
  it('rewrites @n to 图n', () => {
    expect(rewriteAtMentionsForVolcengineArkImagePrompt('参考@1「水彩」画风，强度0.75')).toBe(
      '参考图1「水彩」画风，强度0.75'
    )
    expect(rewriteAtMentionsForVolcengineArkImagePrompt('用 @2 和 @10')).toBe('用 图2 和 图10')
  })

  it('does not rewrite email-like tokens', () => {
    expect(rewriteAtMentionsForVolcengineArkImagePrompt('contact user@123.com please')).toBe(
      'contact user@123.com please'
    )
  })
})
