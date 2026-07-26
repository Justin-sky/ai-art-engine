import { describe, expect, it } from 'vitest'
import { formatProviderErrorForLog } from '../src/renderer/src/features/graph/model/formatProviderErrorForLog'

describe('formatProviderErrorForLog', () => {
  it('appends OpenRouter allowed-providers troubleshooting hint', () => {
    const raw =
      '图片生成失败: No allowed providers are available for the selected model.'
    const next = formatProviderErrorForLog(raw, 'zh-CN')
    expect(next).toContain(raw)
    expect(next).toContain('Allowed Providers')
    expect(next).toContain('排查')
  })

  it('returns original message for unrelated errors', () => {
    expect(formatProviderErrorForLog('timeout', 'zh-CN')).toBe('timeout')
  })
})
