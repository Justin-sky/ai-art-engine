import { describe, expect, it } from 'vitest'
import {
  SEARCH_PROVIDER_KINDS,
  createEmptySearchSettings,
  createSearchProviderInstance,
  normalizeSearchProviderInstance,
  normalizeSearchSettings
} from '../src/shared/searchProvider'

describe('createEmptySearchSettings', () => {
  it('returns an empty providers array', () => {
    const s = createEmptySearchSettings()
    expect(Array.isArray(s.providers)).toBe(true)
    expect(s.providers).toHaveLength(0)
  })
})

describe('createSearchProviderInstance', () => {
  it('uses the kind meta defaultBaseUrl and label when not overridden', () => {
    const meta = SEARCH_PROVIDER_KINDS.find((p) => p.id === 'tavily')!
    const p = createSearchProviderInstance('tavily')
    expect(p.providerKind).toBe('tavily')
    expect(p.baseUrl).toBe(meta.defaultBaseUrl)
    expect(p.label).toBe(meta.label)
    expect(p.apiKey).toBe('')
    expect(p.enabled).toBe(true)
  })

  it('generates a unique id per instance', () => {
    const a = createSearchProviderInstance('brave')
    const b = createSearchProviderInstance('brave')
    expect(a.id).not.toBe(b.id)
    expect(a.id.length).toBeGreaterThan(0)
  })

  it('applies overrides for any field', () => {
    const p = createSearchProviderInstance('serpapi', {
      apiKey: 'sk-1',
      label: 'custom',
      baseUrl: 'https://proxy.example.com',
      enabled: false
    })
    expect(p.apiKey).toBe('sk-1')
    expect(p.label).toBe('custom')
    expect(p.baseUrl).toBe('https://proxy.example.com')
    expect(p.enabled).toBe(false)
  })

  it('未知 kind 时不抛错：providerKind 原样保留，label / baseUrl 用第一个 builtin kind 兜底（保证 UI 可用）', () => {
    const firstMeta = SEARCH_PROVIDER_KINDS[0]!
    const p = createSearchProviderInstance('not-a-real-kind' as unknown as 'tavily')
    expect(p.providerKind).toBe('not-a-real-kind')
    expect(p.label).toBe(firstMeta.label)
    expect(p.baseUrl).toBe(firstMeta.defaultBaseUrl)
  })
})

describe('normalizeSearchProviderInstance', () => {
  it('kind 不在 SEARCH_PROVIDER_KINDS 中时返回 null', () => {
    expect(
      normalizeSearchProviderInstance({
        id: 'x',
        providerKind: 'fake' as unknown as 'tavily',
        apiKey: '',
        baseUrl: '',
        enabled: true
      })
    ).toBeNull()
  })

  it('providerKind 字段非字符串时返回 null', () => {
    expect(
      normalizeSearchProviderInstance({
        id: 'x',
        providerKind: undefined as unknown as 'tavily',
        apiKey: '',
        baseUrl: '',
        enabled: true
      })
    ).toBeNull()
  })

  it('baseUrl 为空字符串时不做 fallback：保留为空字符串（fallback 仅在 createInstance 时发生）', () => {
    const p = normalizeSearchProviderInstance({
      id: 'b1',
      providerKind: 'brave',
      apiKey: '',
      baseUrl: '',
      enabled: true
    })
    expect(p).not.toBeNull()
    expect(p!.baseUrl).toBe('')
  })

  it('用户填的 baseUrl 会被 normalize 末尾斜杠（trimBaseUrl 同款规则）', () => {
    const p = normalizeSearchProviderInstance({
      id: 't1',
      providerKind: 'tavily',
      apiKey: 'tvly-x',
      baseUrl: 'https://proxy.example.com/',
      enabled: true
    })
    expect(p!.baseUrl).toBe('https://proxy.example.com')
  })

  it('label 为空字符串时回落到该 kind 的 default label', () => {
    const meta = SEARCH_PROVIDER_KINDS.find((p) => p.id === 'serpapi')!
    const p = normalizeSearchProviderInstance({
      id: 's1',
      providerKind: 'serpapi',
      apiKey: '',
      baseUrl: '',
      enabled: true
    })
    expect(p!.label).toBe(meta.label)
  })

  it('缺 id 时自动生成新 id（不抛错）', () => {
    const p = normalizeSearchProviderInstance({
      providerKind: 'tavily',
      apiKey: '',
      baseUrl: '',
      enabled: true
    })
    expect(p).not.toBeNull()
    expect(typeof p!.id).toBe('string')
    expect(p!.id.length).toBeGreaterThan(0)
  })

  it('enabled 缺省或非布尔值时默认为 true', () => {
    const a = normalizeSearchProviderInstance({
      id: 'a',
      providerKind: 'serpapi',
      apiKey: '',
      baseUrl: '',
      enabled: undefined as unknown as boolean
    })
    const b = normalizeSearchProviderInstance({
      id: 'b',
      providerKind: 'serpapi',
      apiKey: '',
      baseUrl: '',
      enabled: 'yes' as unknown as boolean
    })
    expect(a!.enabled).toBe(true)
    expect(b!.enabled).toBe(true)
  })

  it('enabled=false 显式保留', () => {
    const p = normalizeSearchProviderInstance({
      id: 'd',
      providerKind: 'brave',
      apiKey: '',
      baseUrl: '',
      enabled: false
    })
    expect(p!.enabled).toBe(false)
  })

  it('apiKey 缺省时为空字符串（非 undefined）', () => {
    const p = normalizeSearchProviderInstance({
      id: 'k',
      providerKind: 'tavily',
      apiKey: undefined as unknown as string,
      baseUrl: '',
      enabled: true
    })
    expect(p!.apiKey).toBe('')
  })
})

describe('normalizeSearchSettings', () => {
  it('undefined / null / 非对象入参都返回 empty', () => {
    expect(normalizeSearchSettings()).toEqual(createEmptySearchSettings())
    expect(normalizeSearchSettings('garbage')).toEqual(createEmptySearchSettings())
    expect(normalizeSearchSettings(null)).toEqual(createEmptySearchSettings())
  })

  it('providers 非数组时返回 empty', () => {
    expect(normalizeSearchSettings({ providers: 'nope' as unknown as [] })).toEqual(
      createEmptySearchSettings()
    )
  })

  it('保留合法 provider；丢弃 providerKind 不在 KINDS 中的条目', () => {
    const s = normalizeSearchSettings({
      providers: [
        {
          id: 'p1',
          providerKind: 'tavily',
          apiKey: 'k',
          baseUrl: 'https://api.tavily.com',
          enabled: true
        },
        { id: 'p2', providerKind: 'fake', apiKey: '', baseUrl: '', enabled: true }
      ]
    })
    expect(s.providers).toHaveLength(1)
    expect(s.providers[0]!.id).toBe('p1')
  })

  it('保留合法 provider；丢弃 providerKind 缺失的条目', () => {
    const s = normalizeSearchSettings({
      providers: [
        {
          id: 'p1',
          providerKind: 'tavily',
          apiKey: '',
          baseUrl: '',
          enabled: true
        },
        { id: 'p2', apiKey: '', baseUrl: '', enabled: true }
      ]
    })
    expect(s.providers).toHaveLength(1)
    expect(s.providers[0]!.id).toBe('p1')
  })

  it('保留 provider 顺序', () => {
    const s = normalizeSearchSettings({
      providers: [
        { id: '1', providerKind: 'deepseek-search', apiKey: '', baseUrl: '', enabled: true },
        { id: '2', providerKind: 'tavily', apiKey: '', baseUrl: '', enabled: true },
        { id: '3', providerKind: 'brave', apiKey: '', baseUrl: '', enabled: true }
      ]
    })
    expect(s.providers.map((p) => p.providerKind)).toEqual(['deepseek-search', 'tavily', 'brave'])
  })
})
