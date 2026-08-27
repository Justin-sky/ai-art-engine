import { describe, expect, it } from 'vitest'
import zh from '../src/renderer/src/i18n/locales/zh-CN'
import en from '../src/renderer/src/i18n/locales/en-US'

function flatten(obj: unknown, prefix = '', out: Record<string, unknown> = {}) {
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object') flatten(v, key, out)
    else out[key] = v
  }
  return out
}

describe('locale parity', () => {
  it('zh-CN 与 en-US 键集合完全一致', () => {
    const z = flatten(zh)
    const e = flatten(en)
    expect(Object.keys(z).filter((k) => !(k in e))).toEqual([])
    expect(Object.keys(e).filter((k) => !(k in z))).toEqual([])
  })
})
