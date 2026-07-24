import type { StudioApi } from '@shared/ipc'
import type { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  interface Window {
    electron: ElectronAPI
    studio: StudioApi
  }
}

export {}
