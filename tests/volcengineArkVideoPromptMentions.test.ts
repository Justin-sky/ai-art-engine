import { describe, expect, it } from 'vitest'
import { rewriteAtMentionsForVolcengineArkVideoPrompt } from '../src/shared/modelProviders/volcengineArk/videoPromptMentions'

describe('rewriteAtMentionsForVolcengineArkVideoPrompt', () => {
  it('maps mixed @n to 图片/视频/音频 by kind', () => {
    expect(
      rewriteAtMentionsForVolcengineArkVideoPrompt('用@1，跟@2，听@3', {
        inputReferences: [
          { kind: 'image_url' },
          { kind: 'video_url' },
          { kind: 'audio_url' }
        ]
      })
    ).toBe('用图片1，跟视频1，听音频1')
  })

  it('does not rewrite emails', () => {
    expect(
      rewriteAtMentionsForVolcengineArkVideoPrompt('contact user@123.com', {
        inputReferences: [{ kind: 'image_url' }]
      })
    ).toBe('contact user@123.com')
  })

  it('falls back to 图片n when refs are empty', () => {
    expect(rewriteAtMentionsForVolcengineArkVideoPrompt('参考@2')).toBe('参考图片2')
  })

  it('leaves bare 图n untouched', () => {
    expect(rewriteAtMentionsForVolcengineArkVideoPrompt('图1与图片2')).toBe('图1与图片2')
  })
})
