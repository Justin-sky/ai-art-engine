import { describe, expect, it } from 'vitest'
import playgroundEnUS from '../src/renderer/src/i18n/locales/playground.en-US'
import playgroundZhCN from '../src/renderer/src/i18n/locales/playground.zh-CN'
import { playgroundI18n } from '../src/playground/i18n'

function collectLeafKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = []
  for (const [k, v] of Object.entries(obj)) {
    const next = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      keys.push(...collectLeafKeys(v as Record<string, unknown>, next))
    } else {
      keys.push(next)
    }
  }
  return keys.sort()
}

describe('Online Playground i18n locales', () => {
  it('maintains 1:1 key parity between zh-CN and en-US', () => {
    const zhKeys = collectLeafKeys(playgroundZhCN as unknown as Record<string, unknown>)
    const enKeys = collectLeafKeys(playgroundEnUS as unknown as Record<string, unknown>)
    expect(zhKeys).toEqual(enKeys)
    expect(zhKeys.length).toBeGreaterThan(30)
  })

  it('compiles all playground.* messages in both locales without missing placeholders', () => {
    const keys = collectLeafKeys(playgroundZhCN as unknown as Record<string, unknown>)
    for (const loc of ['zh-CN', 'en-US'] as const) {
      playgroundI18n.global.locale.value = loc
      for (const key of keys) {
        const rendered = playgroundI18n.global.t(`playground.${key}`, {
          file: 'demo.gd',
          title: 'Demo'
        })
        expect(typeof rendered).toBe('string')
        expect(rendered.length).toBeGreaterThan(0)
        expect(rendered).not.toBe(`playground.${key}`)
      }
    }
  })
})
