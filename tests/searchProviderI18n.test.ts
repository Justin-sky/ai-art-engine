import { describe, expect, it } from 'vitest'
import zhCN from '../src/renderer/src/i18n/locales/zh-CN'
import enUS from '../src/renderer/src/i18n/locales/en-US'

/**
 * 校验设置 UI 真正用到的所有 search.* 翻译 key 在中英两套里都存在且值非空；
 * 缺一个 key 都会让 search tab 渲染出空字符串或回退到 key 原文。
 */
describe('settings.search i18n completeness', () => {
  const requiredKeys = [
    'title',
    'hint',
    'providerDeepseek',
    'providerTavily',
    'providerBrave',
    'providerSerpapi',
    'providerMock',
    'capabilitiesLabel',
    'emptyResult',
    'testConnection',
    'testOk',
    'testFailed',
    'addProvider',
    'add',
    'enabled',
    'remove',
    'label',
    'apiKey',
    'apiKeyPlaceholder',
    'baseUrl',
    'baseUrlPlaceholder',
    'emptyProviders',
    'collapseProvider',
    'expandProvider',
    'getKeyHint'
  ] as const

  it.each(requiredKeys)('zh-CN has settings.search.%s', (k) => {
    expect(zhCN.settings.search[k as keyof typeof zhCN.settings.search]).toBeTruthy()
  })

  it.each(requiredKeys)('en-US has settings.search.%s', (k) => {
    expect(enUS.settings.search[k as keyof typeof enUS.settings.search]).toBeTruthy()
  })

  it('zh-CN 与 en-US capabilities 子对象都含 search / fetch', () => {
    expect(zhCN.settings.search.capabilities.search).toBeTruthy()
    expect(zhCN.settings.search.capabilities.fetch).toBeTruthy()
    expect(enUS.settings.search.capabilities.search).toBeTruthy()
    expect(enUS.settings.search.capabilities.fetch).toBeTruthy()
  })

  it('settings.section.search 在两套里都存在', () => {
    expect(zhCN.settings.section.search).toBeTruthy()
    expect(enUS.settings.section.search).toBeTruthy()
  })

  it('settings.objectStorage 的 showSecret / hideSecret（被 panel 复用）存在', () => {
    expect(zhCN.settings.objectStorage.showSecret).toBeTruthy()
    expect(zhCN.settings.objectStorage.hideSecret).toBeTruthy()
    expect(enUS.settings.objectStorage.showSecret).toBeTruthy()
    expect(enUS.settings.objectStorage.hideSecret).toBeTruthy()
  })
})
