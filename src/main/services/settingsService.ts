import { BrowserWindow, type BrowserWindowConstructorOptions } from 'electron'
import Store from 'electron-store'
import { DEFAULT_SETTINGS, type AppSettings } from '@shared/domain'
import { normalizeModelsSettings } from '@shared/modelProvider'
import { normalizeObjectStorageSettings } from '@shared/objectStorage'

export type WindowChromeColors = {
  background: string
  overlay: string
  symbol: string
}

function chromeColorsForTheme(theme: 'dark' | 'light'): WindowChromeColors {
  const light = theme === 'light'
  return {
    background: light ? '#f0f2f5' : '#141516',
    overlay: light ? '#ffffff' : '#1c1e21',
    symbol: light ? '#1a1d21' : '#e8eaed'
  }
}

function applyChromeToWindow(win: BrowserWindow, chrome: WindowChromeColors): void {
  if (win.isDestroyed()) return
  win.setBackgroundColor(chrome.background)
  if (process.platform !== 'win32') return
  try {
    win.setTitleBarOverlay({
      color: chrome.overlay,
      symbolColor: chrome.symbol,
      height: 40
    })
  } catch {
    /* 未启用 overlay 的窗口忽略 */
  }
}

type StoreSchema = {
  settings: AppSettings
  recentProjects: string[]
}

class SettingsService {
  private store: Store<StoreSchema> | null = null

  init(): void {
    this.store = new Store<StoreSchema>({
      name: 'aiartengine-settings',
      defaults: {
        settings: DEFAULT_SETTINGS,
        recentProjects: [] as string[]
      }
    })
  }

  private ensure(): Store<StoreSchema> {
    if (!this.store) this.init()
    return this.store!
  }

  get(): AppSettings {
    const saved = this.ensure().get('settings') as Partial<AppSettings>
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      editor: {
        ...DEFAULT_SETTINGS.editor,
        ...(saved.editor ?? {})
      },
      models: normalizeModelsSettings(saved.models ?? DEFAULT_SETTINGS.models),
      objectStorage: normalizeObjectStorageSettings(
        saved.objectStorage ?? DEFAULT_SETTINGS.objectStorage
      ),
      seedance: {
        ...DEFAULT_SETTINGS.seedance,
        ...(saved.seedance ?? {})
      },
      llm: {
        ...DEFAULT_SETTINGS.llm,
        ...(saved.llm ?? {})
      },
      yolo: {
        ...DEFAULT_SETTINGS.yolo,
        ...(saved.yolo ?? {})
      }
    }
  }

  set(settings: AppSettings): AppSettings {
    const normalized: AppSettings = {
      ...settings,
      editor: {
        autoSaveEnabled: !!settings.editor?.autoSaveEnabled,
        autoSaveIntervalSec: Math.min(
          3600,
          Math.max(1, Math.round(settings.editor?.autoSaveIntervalSec || 30))
        )
      },
      models: normalizeModelsSettings(settings.models),
      objectStorage: normalizeObjectStorageSettings(settings.objectStorage),
      yolo: {
        ...DEFAULT_SETTINGS.yolo,
        ...(settings.yolo ?? {})
      }
    }
    this.ensure().set('settings', normalized)
    this.syncWindowChrome()
    return normalized
  }

  windowChromeColors(): WindowChromeColors {
    return chromeColorsForTheme(this.get().theme === 'light' ? 'light' : 'dark')
  }

  /** 创建窗口时用的标题栏 / 底色选项（随当前主题） */
  windowChromeOptions(): Pick<
    BrowserWindowConstructorOptions,
    'backgroundColor' | 'titleBarStyle' | 'trafficLightPosition' | 'titleBarOverlay'
  > {
    const chrome = this.windowChromeColors()
    return {
      backgroundColor: chrome.background,
      titleBarStyle: 'hidden',
      ...(process.platform === 'darwin'
        ? { trafficLightPosition: { x: 14, y: 12 } }
        : {
            titleBarOverlay: {
              color: chrome.overlay,
              symbolColor: chrome.symbol,
              height: 40
            }
          })
    }
  }

  /** 按当前设置同步窗口底色 / Win 标题栏叠加色 */
  syncWindowChrome(): void {
    const chrome = this.windowChromeColors()
    for (const win of BrowserWindow.getAllWindows()) {
      applyChromeToWindow(win, chrome)
    }
  }

  /** 新建窗口时立即套用主题标题栏色 */
  applyChromeToWindow(win: BrowserWindow): void {
    applyChromeToWindow(win, this.windowChromeColors())
  }

  getRecent(): string[] {
    return this.ensure().get('recentProjects')
  }

  addRecent(projectJsonPath: string): void {
    const list = this.getRecent().filter((p) => p !== projectJsonPath)
    list.unshift(projectJsonPath)
    this.ensure().set('recentProjects', list.slice(0, 12))
  }

  removeRecent(projectJsonPath: string): string[] {
    const list = this.getRecent().filter((p) => p !== projectJsonPath)
    this.ensure().set('recentProjects', list)
    return list
  }
}

export const settingsService = new SettingsService()
