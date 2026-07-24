import { readonly, ref } from 'vue'
import type { AppSettings } from '@shared/domain'

const autoSaveEnabled = ref(false)
const autoSaveIntervalSec = ref(30)
const appTheme = ref<'dark' | 'light'>('dark')

export const editorPreferences = {
  autoSaveEnabled: readonly(autoSaveEnabled),
  autoSaveIntervalSec: readonly(autoSaveIntervalSec)
}

export const themePreference = readonly(appTheme)

/** 将主题应用到 document（CSS 变量靠 [data-theme]） */
export function applyAppTheme(theme: 'dark' | 'light'): void {
  const next = theme === 'light' ? 'light' : 'dark'
  appTheme.value = next
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = next
  }
}

export function applyEditorPreferences(settings: AppSettings): void {
  autoSaveEnabled.value = !!settings.editor?.autoSaveEnabled
  autoSaveIntervalSec.value = Math.min(
    3600,
    Math.max(1, Math.round(settings.editor?.autoSaveIntervalSec || 30))
  )
  applyAppTheme(settings.theme === 'light' ? 'light' : 'dark')
}

export async function initEditorPreferences(): Promise<void> {
  try {
    if (typeof window.studio?.getSettings !== 'function') return
    applyEditorPreferences(await window.studio.getSettings())
  } catch (error) {
    console.warn('[preferences] init skipped:', error)
  }
}
