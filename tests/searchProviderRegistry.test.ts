import { describe, expect, it } from 'vitest'
import {
  builtinSearchProviderKinds,
  getBuiltinSearchProvider,
  listBuiltinSearchProviders
} from '../src/main/plugins/searchProviders'
import { SEARCH_PROVIDER_KINDS } from '../src/shared/searchProvider'

describe('searchProviders registry', () => {
  it('builtinSearchProviderKinds 与 SEARCH_PROVIDER_KINDS 顺序一致', () => {
    expect([...builtinSearchProviderKinds]).toEqual(SEARCH_PROVIDER_KINDS.map((m) => m.id))
  })

  it('每个 kind 都能通过 getBuiltinSearchProvider 取到适配器', () => {
    for (const kind of builtinSearchProviderKinds) {
      const adapter = getBuiltinSearchProvider(kind)
      expect(adapter).toBeDefined()
      expect(adapter!.kind).toBe(kind)
      expect(typeof adapter!.assertAuth).toBe('function')
      expect(typeof adapter!.search).toBe('function')
    }
  })

  it('未知 kind 返回 undefined', () => {
    // @ts-expect-error 故意传非法 kind
    expect(getBuiltinSearchProvider('non-existent')).toBeUndefined()
  })

  it('listBuiltinSearchProviders 返回全量适配器', () => {
    const list = listBuiltinSearchProviders()
    expect(list.length).toBe(builtinSearchProviderKinds.length)
    expect(list.map((a) => a.kind)).toEqual([...builtinSearchProviderKinds])
  })

  it('mock 与 deepseek-search 都暴露 search 方法', () => {
    expect(typeof getBuiltinSearchProvider('mock-search')!.search).toBe('function')
    expect(typeof getBuiltinSearchProvider('deepseek-search')!.search).toBe('function')
  })

  it('mock-search 暴露 fetch；deepseek-search 不暴露 fetch', () => {
    expect(typeof getBuiltinSearchProvider('mock-search')!.fetch).toBe('function')
    expect(getBuiltinSearchProvider('deepseek-search')!.fetch).toBeUndefined()
  })

  it('tavily / brave / serpapi 三家真实搜索都注册并暴露 search 方法', () => {
    const kinds = ['tavily', 'brave', 'serpapi'] as const
    for (const kind of kinds) {
      const adapter = getBuiltinSearchProvider(kind)
      expect(adapter).toBeDefined()
      expect(adapter!.kind).toBe(kind)
      expect(typeof adapter!.search).toBe('function')
      expect(typeof adapter!.assertAuth).toBe('function')
      // 真搜索 adapter 默认不实现 fetch（沙箱网络未放通）
      expect(adapter!.fetch).toBeUndefined()
    }
  })

  it('SEARCH_PROVIDER_KINDS 中五家 kind 全部能在 registry 取到', () => {
    const metaIds = SEARCH_PROVIDER_KINDS.map((m) => m.id)
    expect(metaIds).toContain('deepseek-search')
    expect(metaIds).toContain('tavily')
    expect(metaIds).toContain('brave')
    expect(metaIds).toContain('serpapi')
    expect(metaIds).toContain('mock-search')
    for (const id of metaIds) {
      expect(getBuiltinSearchProvider(id)).toBeDefined()
    }
  })
})
