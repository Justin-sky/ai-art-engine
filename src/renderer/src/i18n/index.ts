import { createI18n } from 'vue-i18n'
import { setAppErrorLocaleResolver } from '@shared/errors/appError'
import type { AppSettings } from '@shared/domain'
import enUS from './locales/en-US'
import zhCN from './locales/zh-CN'

export type AppLocale = AppSettings['language']

export const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  fallbackLocale: 'en-US',
  messages: {
    'zh-CN': zhCN,
    'en-US': enUS
  }
})

/** appError 消息语言跟随 vue-i18n（shared/execute 在渲染进程抛错也按界面语言输出） */
setAppErrorLocaleResolver(() => i18n.global.locale.value)

export function setAppLocale(locale: AppLocale): void {
  i18n.global.locale.value = locale
}

export async function initLocaleFromSettings(): Promise<AppLocale> {
  try {
    if (typeof window.studio?.getSettings !== 'function') {
      setAppLocale('zh-CN')
      return 'zh-CN'
    }
    const settings = await window.studio.getSettings()
    const locale = settings.language ?? 'zh-CN'
    setAppLocale(locale)
    return locale
  } catch {
    setAppLocale('zh-CN')
    return 'zh-CN'
  }
}

export default i18n
