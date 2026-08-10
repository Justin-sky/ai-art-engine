/**
 * 把文本写入系统剪贴板。
 *
 * 优先走主进程 `clipboard.writeText`（IPC）：Chromium 的 `navigator.clipboard`
 * 要求文档获得焦点，记事本等脱离主窗口的 about:blank 弹窗经常不满足，会静默失败。
 * 主进程路径不依赖渲染进程焦点；IPC 不可用时依次回退到
 * `navigator.clipboard.writeText` 与 `document.execCommand('copy')`。
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  const value = text ?? ''
  if (!value) return false

  if (window.studio?.writeClipboardText) {
    try {
      await window.studio.writeClipboardText(value)
      return true
    } catch {
      // 回退到渲染层方案
    }
  }

  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    // 回退到 execCommand
  }

  try {
    const helper = document.createElement('textarea')
    helper.value = value
    helper.setAttribute('readonly', '')
    helper.style.position = 'fixed'
    helper.style.left = '-9999px'
    helper.style.top = '0'
    helper.style.opacity = '0'
    document.body.appendChild(helper)
    helper.select()
    helper.setSelectionRange(0, value.length)
    const ok = document.execCommand('copy')
    helper.remove()
    return ok
  } catch {
    return false
  }
}
