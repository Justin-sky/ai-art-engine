/**
 * 主窗口引用：**只放一个可读引用**，避免服务反向 import `src/main/index.ts`。
 *
 * `index.ts` 是入口（它 import 各家服务）；服务若为了拿主窗口而 import 回来就成了循环依赖，
 * 而界面录制必须知道「录哪个窗口」。这里只做一件事：入口创建窗口后登记，服务按需读取。
 * 与 `dshPaths`、`setWorldMetaJobResolver` 是同一个套路：把跨层的那个点收成一个纯小模块。
 */
import type { BrowserWindow } from 'electron'

let mainWindowRef: BrowserWindow | null = null

/** 入口创建主窗口后调用（窗口销毁时传 null 或由读取侧判 isDestroyed） */
export function setMainWindowRef(win: BrowserWindow | null): void {
  mainWindowRef = win
}

/** 取主窗口；已销毁时返回 null（调用方负责给出可读原因） */
export function getMainWindowRef(): BrowserWindow | null {
  if (!mainWindowRef || mainWindowRef.isDestroyed()) return null
  return mainWindowRef
}
