import { BrowserWindow } from 'electron'

/** 向所有渲染进程广播事件（多窗口资产同步等）。 */
export function broadcastToAllWindows(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload)
    }
  }
}
