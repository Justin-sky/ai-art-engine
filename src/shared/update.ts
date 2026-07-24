/** 应用更新事件（主进程 → 渲染进程） */
export type AppUpdateEvent =
  | { type: 'checking' }
  | { type: 'available'; version: string }
  | { type: 'not-available'; version: string }
  | { type: 'progress'; percent: number; transferred: number; total: number }
  | { type: 'downloaded'; version: string }
  | { type: 'error'; message: string }
  | { type: 'disabled'; message: string }

export interface AppUpdateCheckResult {
  /** 开发模式或未打包时为 false */
  enabled: boolean
  /** 是否已发起检查（打包环境） */
  started: boolean
  currentVersion: string
  message?: string
}
