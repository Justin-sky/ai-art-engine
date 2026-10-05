import { readonly, ref } from 'vue'
import type { AppSettings } from '@shared/domain'
import {
  STAGE_CONTROL_DEFAULTS,
  normalizeStageControls,
  type StageControlPreferences
} from '@shared/domain'

const autoSaveEnabled = ref(false)
const autoSaveIntervalSec = ref(30)
const appTheme = ref<'dark' | 'light'>('dark')

/**
 * 3D 视口（导演台）操控灵敏度。
 *
 * 用 `ref` 而不是普通对象：设置页保存时会再次调 `applyEditorPreferences`，
 * 导演台读到的是**最新值**，所以拖动滑块后无需重开视口 —— 下一次拖拽 / 推拉就生效。
 * 导演侧请用 `stageControlPreferences.xxx.value` 读当前值（不要解构成常量）。
 */
const stageControlPreferences = ref<StageControlPreferences>({ ...STAGE_CONTROL_DEFAULTS })

export const editorPreferences = {
  autoSaveEnabled: readonly(autoSaveEnabled),
  autoSaveIntervalSec: readonly(autoSaveIntervalSec)
}

/** 3D 视口灵敏度（响应式；见上方说明，别把 `.value` 缓存到模块级常量里） */
export const stageControls = readonly(stageControlPreferences)

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
  // 灵敏度按区间钳制：手改过 settings.json 的脏值不该让视口「拖不动」
  stageControlPreferences.value = normalizeStageControls(settings.editor?.stage)
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
