import { createI18n } from 'vue-i18n'
import mxEnUS from '@renderer/i18n/locales/mx.en-US'
import mxZhCN from '@renderer/i18n/locales/mx.zh-CN'
import playgroundEnUS from '@renderer/i18n/locales/playground.en-US'
import playgroundZhCN from '@renderer/i18n/locales/playground.zh-CN'

export type PlaygroundLocale = 'zh-CN' | 'en-US'

const LANG_STORAGE_KEY = 'aiae.playground.lang'

export function resolveInitialPlaygroundLocale(): PlaygroundLocale {
  if (typeof window === 'undefined') return 'zh-CN'
  try {
    const params = new URLSearchParams(window.location.search)
    const urlLang = (params.get('lang') || '').trim().toLowerCase()
    if (urlLang === 'en' || urlLang === 'en-us') return 'en-US'
    if (urlLang === 'zh' || urlLang === 'zh-cn') return 'zh-CN'

    const saved = (localStorage.getItem(LANG_STORAGE_KEY) || '').trim()
    if (saved === 'en-US' || saved === 'zh-CN') return saved

    const nav = (navigator.language || '').toLowerCase()
    if (nav && !nav.startsWith('zh')) return 'en-US'
  } catch {
    // ignore storage errors
  }
  return 'zh-CN'
}

export const playgroundI18n = createI18n({
  legacy: false,
  locale: resolveInitialPlaygroundLocale(),
  fallbackLocale: 'en-US',
  messages: {
    'zh-CN': {
      mx: mxZhCN,
      playground: playgroundZhCN
    },
    'en-US': {
      mx: mxEnUS,
      playground: playgroundEnUS
    }
  }
})

export function setPlaygroundLocale(next: PlaygroundLocale): void {
  playgroundI18n.global.locale.value = next
  if (typeof document !== 'undefined') {
    document.documentElement.lang = next === 'en-US' ? 'en' : 'zh-CN'
  }
  try {
    localStorage.setItem(LANG_STORAGE_KEY, next)
    const url = new URL(window.location.href)
    if (next === 'en-US') {
      url.searchParams.set('lang', 'en')
    } else {
      url.searchParams.delete('lang')
    }
    window.history.replaceState(null, '', url.toString())
  } catch {
    // ignore history/storage errors
  }
}
