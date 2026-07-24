import { execFile } from 'child_process'
import { promisify } from 'util'
import { clipboard } from 'electron'
import { platform } from 'os'

const execFileAsync = promisify(execFile)

function escapePowerShellSingleQuoted(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

async function copyFilePathsWindows(paths: string[]): Promise<void> {
  const list = paths.map(escapePowerShellSingleQuoted).join(',\n')
  const script = `
Add-Type -AssemblyName System.Windows.Forms
$files = New-Object System.Collections.Specialized.StringCollection
@(
${list}
) | ForEach-Object { [void]$files.Add($_) }
[System.Windows.Forms.Clipboard]::SetFileDropList($files)
`
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-STA', '-NonInteractive', '-EncodedCommand', encoded],
    { windowsHide: true }
  )
}

async function copyFilePathsDarwin(paths: string[]): Promise<void> {
  const urlExprs = paths
    .map((p) => `(current application's NSURL's fileURLWithPath:${JSON.stringify(p)})`)
    .join(', ')
  const script = `
use framework "AppKit"
use framework "Foundation"
property this : a reference to current application
set pb to this's NSPasteboard's generalPasteboard()
pb's clearContents()
set theUrls to {${urlExprs}}
pb's writeObjects:theUrls
`
  await execFileAsync('osascript', ['-e', script])
}

/**
 * 将本地文件路径写入系统剪贴板（可作为文件粘贴到资源管理器等）。
 * 返回 `files` 表示已写入文件拖放列表；`text` 表示仅写入路径文本。
 */
export async function copyFilePathsToClipboard(paths: string[]): Promise<'files' | 'text'> {
  const unique = [...new Set(paths.map((p) => p.trim()).filter(Boolean))]
  if (!unique.length) throw new Error('没有可复制的文件路径')

  const os = platform()
  try {
    if (os === 'win32') {
      await copyFilePathsWindows(unique)
      return 'files'
    }
    if (os === 'darwin') {
      await copyFilePathsDarwin(unique)
      return 'files'
    }
  } catch {
    clipboard.writeText(unique.join('\n'))
    return 'text'
  }

  clipboard.writeText(unique.join('\n'))
  return 'text'
}
