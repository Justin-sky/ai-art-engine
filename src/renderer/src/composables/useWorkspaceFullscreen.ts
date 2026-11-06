import { computed, ref } from 'vue'

/**
 * 全局工作区（主画布 / 子图画布 / 全部 Dive 视图）一键全屏状态。
 *
 * 双层协同机制：
 * 1. `isWorkspaceFullscreen`：在应用内将中心工作区（画布或当前 Dive 栈顶视图）最大化铺满，
 *    临时隐藏顶部工具条、左右侧边栏（资产 / 参数 / AI 对话 / 快捷轨）与外层标签栏，
 *    且不写入持久化 Dock 布局，退出全屏后像素级恢复原有分栏宽度；
 * 2. `isNativeHtmlFullscreen`：在支持浏览器/Electron 原生全屏的手势下同步调用
 *    `document.documentElement.requestFullscreen()`，进入显示器级无边框全屏并自动隐藏顶栏；
 *    用户在原生全屏下按 `Esc` 退出时，通过 `fullscreenchange` 自动同步还原工作区布局。
 */
const workspaceFullscreenRef = ref(false)
const nativeHtmlFullscreenRef = ref(false)
let listenersInstalled = false

function syncNativeFullscreenState(): void {
  if (typeof document === 'undefined') return
  const active = Boolean(document.fullscreenElement)
  const wasActive = nativeHtmlFullscreenRef.value
  nativeHtmlFullscreenRef.value = active
  // 用户按 Esc 退出了浏览器/OS 原生全屏时，同步退出工作区沉浸态
  if (wasActive && !active && workspaceFullscreenRef.value) {
    workspaceFullscreenRef.value = false
  }
}

export function installWorkspaceFullscreenListeners(): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return () => {}
  }
  if (listenersInstalled) {
    return () => {}
  }
  listenersInstalled = true
  nativeHtmlFullscreenRef.value = Boolean(document.fullscreenElement)

  const onFullscreenChange = (): void => {
    syncNativeFullscreenState()
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'F11') {
      event.preventDefault()
      toggleWorkspaceFullscreen()
      return
    }
    // 若仅处于窗口内工作区全屏（例如未进入原生全屏），按 Esc 在无弹窗/输入框焦点时也可退出
    if (
      event.key === 'Escape' &&
      workspaceFullscreenRef.value &&
      !nativeHtmlFullscreenRef.value &&
      !event.defaultPrevented
    ) {
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) {
        return
      }
      if (document.querySelector('[role="dialog"], .studio-prompt-backdrop, .modal-backdrop')) {
        return
      }
      event.preventDefault()
      exitWorkspaceFullscreen()
    }
  }

  document.addEventListener('fullscreenchange', onFullscreenChange)
  window.addEventListener('keydown', onKeyDown)

  return () => {
    document.removeEventListener('fullscreenchange', onFullscreenChange)
    window.removeEventListener('keydown', onKeyDown)
    listenersInstalled = false
  }
}

export function enterWorkspaceFullscreen(options?: { requestBrowserFullscreen?: boolean }): void {
  workspaceFullscreenRef.value = true
  const wantNative = options?.requestBrowserFullscreen ?? true
  if (
    wantNative &&
    typeof document !== 'undefined' &&
    !document.fullscreenElement &&
    typeof document.documentElement?.requestFullscreen === 'function'
  ) {
    void document.documentElement.requestFullscreen().catch(() => {
      // 无用户手势或宿主禁用原生全屏时，自动降级保留窗口内 100% 沉浸全屏
    })
  }
}

export function exitWorkspaceFullscreen(): void {
  workspaceFullscreenRef.value = false
  if (
    typeof document !== 'undefined' &&
    document.fullscreenElement &&
    typeof document.exitFullscreen === 'function'
  ) {
    void document.exitFullscreen().catch(() => {})
  }
}

export function toggleWorkspaceFullscreen(options?: {
  requestBrowserFullscreen?: boolean
}): boolean {
  if (workspaceFullscreenRef.value) {
    exitWorkspaceFullscreen()
    return false
  }
  enterWorkspaceFullscreen(options)
  return true
}

export function useWorkspaceFullscreen() {
  return {
    isWorkspaceFullscreen: computed(() => workspaceFullscreenRef.value),
    isNativeHtmlFullscreen: computed(() => nativeHtmlFullscreenRef.value),
    enterWorkspaceFullscreen,
    exitWorkspaceFullscreen,
    toggleWorkspaceFullscreen
  }
}
