import { isNavigationFailure, useRouter } from 'vue-router'

/**
 * 打开设置浮层并定位到指定 tab（App.vue 以 route.name === 'settings' 渲染设置页）。
 * 供缺 ffmpeg 等功能调用点把用户引导到「设置 → ffmpeg 工具」等页面。
 */
export function useSettingsPanelNavigator(): {
  openSettingsPanel: (tab?: string) => Promise<void>
} {
  const router = useRouter()
  const openSettingsPanel = async (tab?: string): Promise<void> => {
    try {
      await router.push({ name: 'settings', query: tab ? { tab } : undefined })
    } catch (error) {
      if (isNavigationFailure(error)) return
      throw error
    }
  }
  return { openSettingsPanel }
}
