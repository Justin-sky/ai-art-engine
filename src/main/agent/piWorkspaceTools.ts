import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, isAbsolute, join, relative, resolve as resolvePath } from 'node:path'
import { sniffImageMimeFromBytes } from '@shared/media/imageMimeSniff'
import {
  prepareLooseToolArguments,
  type RuntimeAgentTool,
  type RuntimeToolResult
} from './piModelResolver'
import {
  compactImageBufferForAgentVision,
  sanitizeInlineBinaryAndDataUrls,
  VISION_HARD_MAX_RAW_BYTES
} from './piPayloadGuard'

const MAX_READ_LINES = 2000
const DEFAULT_READ_LINES = 500
const MAX_READ_BYTES = 140 * 1024
const MAX_BASH_OUTPUT_CHARS = 64_000
const DEFAULT_BASH_TIMEOUT_MS = 120_000
const MAX_BASH_TIMEOUT_MS = 600_000

const IGNORED_SEARCH_DIRS = new Set([
  '.git',
  'node_modules',
  'out',
  'dist',
  '.next',
  '.nuxt',
  '__pycache__',
  '.venv',
  'venv',
  'Library',
  'Temp',
  'Obj',
  'Logs'
])

const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.bmp',
  '.ico',
  '.mp4',
  '.mov',
  '.webm',
  '.avi',
  '.mkv',
  '.mp3',
  '.wav',
  '.ogg',
  '.m4a',
  '.flac',
  '.glb',
  '.gltf',
  '.fbx',
  '.obj',
  '.stl',
  '.zip',
  '.7z',
  '.rar',
  '.tar',
  '.gz',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.onnx',
  '.wasm',
  '.psd',
  '.ttf',
  '.otf',
  '.woff',
  '.woff2',
  '.pdf'
])

const IMAGE_EXTENSIONS: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
}

function resolveTargetAbs(rawPath: string, workspaceRoot: string): string {
  const trimmed = rawPath.trim().replace(/^@/, '')
  if (!trimmed) return resolvePath(workspaceRoot)
  return isAbsolute(trimmed) ? resolvePath(trimmed) : resolvePath(workspaceRoot, trimmed)
}

function globToRegExp(glob: string): RegExp {
  const normalized = glob.replace(/\\/g, '/').trim()
  let regex = '^'
  let i = 0
  while (i < normalized.length) {
    const ch = normalized[i]
    if (ch === '*') {
      if (normalized[i + 1] === '*') {
        if (normalized[i + 2] === '/') {
          regex += '(?:.*/)?'
          i += 3
          continue
        }
        regex += '.*'
        i += 2
        continue
      }
      regex += '[^/]*'
      i += 1
      continue
    }
    if (ch === '?') {
      regex += '[^/]'
      i += 1
      continue
    }
    if (ch === '{') {
      const close = normalized.indexOf('}', i)
      if (close > i) {
        const parts = normalized
          .slice(i + 1, close)
          .split(',')
          .map((p) => p.replace(/[.+^$|()[\]\\]/g, '\\$&'))
        regex += `(?:${parts.join('|')})`
        i = close + 1
        continue
      }
    }
    if ('+^$.|()[]\\'.includes(ch)) {
      regex += `\\${ch}`
    } else {
      regex += ch
    }
    i += 1
  }
  regex += '$'
  return new RegExp(regex, 'i')
}

function truncateMiddle(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const half = Math.floor((maxChars - 120) / 2)
  return `${text.slice(0, half)}\n\n... [输出过长，中间已省略 ${text.length - half * 2} 字符] ...\n\n${text.slice(-half)}`
}

function killProcessTree(pid: number | undefined): void {
  if (!pid || pid <= 0) return
  if (process.platform === 'win32') {
    try {
      const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true
      })
      killer.unref()
    } catch {
      /* ignore */
    }
    return
  }
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      /* ignore */
    }
  }
}

export interface WorkspaceToolsOptions {
  getWorkspaceRoot: () => string
}

/**
 * 构建 5 个高内聚进程内工作区原生工具：`read`、`write`、`edit`、`search`、`bash`。
 * 所有子进程调用强制 `windowsHide: true`，绝不弹出闪烁黑框。
 */
export function createPiWorkspaceTools(opts: WorkspaceToolsOptions): RuntimeAgentTool[] {
  const readTool: RuntimeAgentTool = {
    name: 'read',
    label: '读取文件或目录 (Read)',
    description:
      'Read a text file (with 1-based line numbers), inspect a local image file (PNG/JPEG/WebP/GIF), or list entries of a directory inside the workspace.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Workspace-relative or absolute path to the file or directory.'
        },
        offset: {
          type: 'integer',
          description: 'Optional 1-based starting line number for text files (default: 1).'
        },
        limit: {
          type: 'integer',
          description: 'Optional max number of lines to read (default: 500, max: 2000).'
        }
      },
      required: ['path']
    },
    prepareArguments: (raw) => prepareLooseToolArguments(raw),
    execute: async (_callId, params: Record<string, unknown>): Promise<RuntimeToolResult> => {
      const workspaceRoot = opts.getWorkspaceRoot()
      const rawPath = String(params.path ?? params.file_path ?? '').trim()
      if (!rawPath) {
        return {
          content: [{ type: 'text', text: '缺少必填参数 path' }],
          details: null,
          isError: true
        }
      }
      const absPath = resolveTargetAbs(rawPath, workspaceRoot)
      if (!existsSync(absPath)) {
        return {
          content: [{ type: 'text', text: `路径不存在：${absPath}` }],
          details: null,
          isError: true
        }
      }
      const stat = statSync(absPath)
      if (stat.isDirectory()) {
        const entries = readdirSync(absPath, { withFileTypes: true })
          .slice(0, 400)
          .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
        return {
          content: [
            {
              type: 'text',
              text: `目录 ${absPath}（共 ${entries.length} 项）：\n${entries.join('\n')}`
            }
          ],
          details: { path: absPath, count: entries.length }
        }
      }

      const ext = extname(absPath).toLowerCase()
      if (ext in IMAGE_EXTENSIONS && stat.size <= 15 * 1024 * 1024) {
        const bytes = readFileSync(absPath)
        const rawMimeType = sniffImageMimeFromBytes(bytes) ?? IMAGE_EXTENSIONS[ext]
        const compacted = compactImageBufferForAgentVision(bytes, rawMimeType)
        if (compacted.buffer.byteLength > VISION_HARD_MAX_RAW_BYTES) {
          return {
            content: [
              {
                type: 'text',
                text: `图片文件体积较大（${stat.size} bytes）且当前运行环境无法完成像素缩放，已省略内联 base64 数据以防上下文超限：${absPath}`
              }
            ],
            details: { path: absPath, mimeType: rawMimeType, bytes: stat.size }
          }
        }
        return {
          content: [
            {
              type: 'text',
              text: `已读取图片文件：${absPath} (${compacted.mimeType}, 原始 ${stat.size} bytes${compacted.compacted ? `，视觉压缩后 ${compacted.buffer.byteLength} bytes` : ''})`
            },
            {
              type: 'image',
              data: compacted.buffer.toString('base64'),
              mimeType: compacted.mimeType
            }
          ],
          details: { path: absPath, mimeType: compacted.mimeType, bytes: stat.size }
        }
      }

      if (stat.size > 8 * 1024 * 1024) {
        return {
          content: [
            {
              type: 'text',
              text: `文件体积过大（${(stat.size / 1024 / 1024).toFixed(2)} MB），请改用 search 工具按关键词定位。`
            }
          ],
          details: null,
          isError: true
        }
      }

      const rawText = readFileSync(absPath, 'utf8')
      const lines = rawText.split(/\r?\n/)
      const startLine = Math.max(1, Math.trunc(Number(params.offset ?? 1) || 1))
      const limit = Math.min(
        MAX_READ_LINES,
        Math.max(1, Math.trunc(Number(params.limit ?? DEFAULT_READ_LINES) || DEFAULT_READ_LINES))
      )
      const endLine = Math.min(lines.length, startLine + limit - 1)
      const slice = sanitizeInlineBinaryAndDataUrls(
        lines
          .slice(startLine - 1, endLine)
          .map((line, idx) => `${startLine + idx}: ${line}`)
          .join('\n')
      )

      const capped =
        slice.length > MAX_READ_BYTES
          ? `${slice.slice(0, MAX_READ_BYTES)}\n... [单次读取字节已截断，可通过 offset 分段读取]`
          : slice
      const header = `文件 ${absPath}（显示第 ${startLine}-${endLine} 行，共 ${lines.length} 行）`
      return {
        content: [{ type: 'text', text: `${header}\n${capped}` }],
        details: { path: absPath, startLine, endLine, totalLines: lines.length }
      }
    }
  }

  const writeTool: RuntimeAgentTool = {
    name: 'write',
    label: '写入文件 (Write)',
    description:
      'Create a new text file or overwrite an existing file with UTF-8 content (parent directories are created automatically). Never write generated media or .canvas.asset.json directly.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Workspace-relative or absolute file path.'
        },
        content: {
          type: 'string',
          description: 'Complete UTF-8 text content to write.'
        }
      },
      required: ['path', 'content']
    },
    prepareArguments: (raw) => prepareLooseToolArguments(raw),
    execute: async (_callId, params: Record<string, unknown>): Promise<RuntimeToolResult> => {
      const workspaceRoot = opts.getWorkspaceRoot()
      const rawPath = String(params.path ?? params.file_path ?? '').trim()
      if (!rawPath) {
        return {
          content: [{ type: 'text', text: '缺少必填参数 path' }],
          details: null,
          isError: true
        }
      }
      const absPath = resolveTargetAbs(rawPath, workspaceRoot)
      const content = String(params.content ?? '')
      mkdirSync(dirname(absPath), { recursive: true })
      writeFileSync(absPath, content, 'utf8')
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              ok: true,
              path: absPath,
              bytes: Buffer.byteLength(content, 'utf8')
            })
          }
        ],
        details: { path: absPath }
      }
    }
  }

  const editTool: RuntimeAgentTool = {
    name: 'edit',
    label: '精确编辑文件 (Edit)',
    description:
      'Perform exact string replacement in an existing UTF-8 file. Pass `path`, `oldText` (exact target snippet including indentation), and `newText`.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Workspace-relative or absolute file path.'
        },
        oldText: {
          type: 'string',
          description: 'Exact existing text to replace.'
        },
        newText: {
          type: 'string',
          description: 'Replacement text.'
        },
        replaceAll: {
          type: 'boolean',
          description: 'Replace every occurrence when true (default: false).'
        }
      },
      required: ['path', 'oldText', 'newText']
    },
    prepareArguments: (raw) => {
      const obj = prepareLooseToolArguments(raw)
      return {
        ...obj,
        path: obj.path ?? obj.file_path,
        oldText: obj.oldText ?? obj.old_string ?? obj.old_str,
        newText: obj.newText ?? obj.new_string ?? obj.new_str,
        replaceAll: obj.replaceAll ?? obj.replace_all
      }
    },
    execute: async (_callId, params: Record<string, unknown>): Promise<RuntimeToolResult> => {
      const workspaceRoot = opts.getWorkspaceRoot()
      const rawPath = String(params.path ?? '').trim()
      const oldText = typeof params.oldText === 'string' ? params.oldText : ''
      const newText = typeof params.newText === 'string' ? params.newText : ''
      const replaceAll = Boolean(params.replaceAll)

      if (!rawPath || !oldText) {
        return {
          content: [{ type: 'text', text: 'edit 需要非空的 path 与 oldText 参数' }],
          details: null,
          isError: true
        }
      }
      const absPath = resolveTargetAbs(rawPath, workspaceRoot)
      if (!existsSync(absPath)) {
        return {
          content: [{ type: 'text', text: `文件不存在：${absPath}` }],
          details: null,
          isError: true
        }
      }
      const source = readFileSync(absPath, 'utf8')
      const hasCrLf = source.includes('\r\n')
      const normalizedSource = source.replace(/\r\n/g, '\n')
      const normalizedOld = oldText.replace(/\r\n/g, '\n')
      const normalizedNew = newText.replace(/\r\n/g, '\n')

      const occurrences = normalizedSource.split(normalizedOld).length - 1
      if (occurrences === 0) {
        return {
          content: [
            {
              type: 'text',
              text: `未在 ${absPath} 中找到完全匹配的 oldText，请先用 read 核对目标行缩进与上下文。`
            }
          ],
          details: null,
          isError: true
        }
      }
      if (occurrences > 1 && !replaceAll) {
        return {
          content: [
            {
              type: 'text',
              text: `oldText 在 ${absPath} 中出现了 ${occurrences} 次；请补充上下文使其唯一，或显式传 replaceAll: true。`
            }
          ],
          details: null,
          isError: true
        }
      }

      const replaced = replaceAll
        ? normalizedSource.split(normalizedOld).join(normalizedNew)
        : normalizedSource.replace(normalizedOld, normalizedNew)
      const finalContent = hasCrLf ? replaced.replace(/\n/g, '\r\n') : replaced
      writeFileSync(absPath, finalContent, 'utf8')
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              ok: true,
              path: absPath,
              replacements: replaceAll ? occurrences : 1
            })
          }
        ],
        details: { path: absPath, replacements: replaceAll ? occurrences : 1 }
      }
    }
  }

  const searchTool: RuntimeAgentTool = {
    name: 'search',
    label: '检索文件与内容 (Glob + Grep)',
    description:
      'Unified fast file & content search inside the workspace (or specified directory). Pass `filePattern` (glob like "**/*.ts" or "*config*") to find files, `query` (regex or literal substring) to grep file contents, or both.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Optional text or regular expression to search inside files.'
        },
        filePattern: {
          type: 'string',
          description: 'Optional glob or filename filter (e.g. "**/*.json", "*.cs", "*hero*").'
        },
        path: {
          type: 'string',
          description:
            'Optional subdirectory or file path to scope the search (defaults to workspace root).'
        },
        caseSensitive: {
          type: 'boolean',
          description: 'Case-sensitive content match (default: false).'
        },
        maxResults: {
          type: 'integer',
          description: 'Maximum matches to return (default: 80, max: 200).'
        }
      }
    },
    prepareArguments: (raw) => {
      const obj = prepareLooseToolArguments(raw)
      return {
        ...obj,
        filePattern: obj.filePattern ?? obj.glob ?? obj.pattern_file,
        query: obj.query ?? obj.pattern
      }
    },
    execute: async (
      _callId,
      params: Record<string, unknown>,
      signal
    ): Promise<RuntimeToolResult> => {
      const workspaceRoot = opts.getWorkspaceRoot()
      const rootAbs = params.path
        ? resolveTargetAbs(String(params.path), workspaceRoot)
        : resolvePath(workspaceRoot)
      if (!existsSync(rootAbs)) {
        return {
          content: [{ type: 'text', text: `搜索路径不存在：${rootAbs}` }],
          details: null,
          isError: true
        }
      }

      const rawQuery = typeof params.query === 'string' ? params.query.trim() : ''
      const rawFilePattern = typeof params.filePattern === 'string' ? params.filePattern.trim() : ''
      const maxResults = Math.min(
        200,
        Math.max(1, Math.trunc(Number(params.maxResults ?? 80) || 80))
      )
      const caseSensitive = Boolean(params.caseSensitive)

      const fileRegex = rawFilePattern
        ? globToRegExp(
            rawFilePattern.includes('/') || rawFilePattern.includes('*')
              ? rawFilePattern
              : `*${rawFilePattern}*`
          )
        : null

      let contentRegex: RegExp | null = null
      if (rawQuery) {
        const flags = caseSensitive ? '' : 'i'
        try {
          contentRegex = new RegExp(rawQuery, flags)
        } catch {
          contentRegex = new RegExp(rawQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags)
        }
      }

      const hits: string[] = []
      let scannedFiles = 0

      const walk = (dir: string): void => {
        if (signal?.aborted || hits.length >= maxResults || scannedFiles >= 8000) return
        let entries
        try {
          entries = readdirSync(dir, { withFileTypes: true })
        } catch {
          return
        }
        for (const entry of entries) {
          if (signal?.aborted || hits.length >= maxResults) return
          if (entry.name.endsWith('.canvas.asset.json')) continue
          const full = join(dir, entry.name)
          if (entry.isDirectory()) {
            if (IGNORED_SEARCH_DIRS.has(entry.name)) continue
            walk(full)
            continue
          }
          if (!entry.isFile()) continue
          const relPosix = relative(rootAbs, full).replace(/\\/g, '/')
          if (fileRegex && !fileRegex.test(relPosix) && !fileRegex.test(entry.name)) {
            continue
          }
          if (!contentRegex) {
            hits.push(relPosix)
            continue
          }
          const ext = extname(entry.name).toLowerCase()
          if (BINARY_EXTENSIONS.has(ext)) continue
          scannedFiles += 1
          try {
            const st = statSync(full)
            if (st.size > 2 * 1024 * 1024) continue
            const lines = readFileSync(full, 'utf8').split(/\r?\n/)
            for (let i = 0; i < lines.length; i++) {
              if (contentRegex.test(lines[i])) {
                hits.push(`${relPosix}:${i + 1}: ${lines[i].slice(0, 240)}`)
                if (hits.length >= maxResults) break
              }
            }
          } catch {
            /* skip unreadable */
          }
        }
      }

      const rootStat = statSync(rootAbs)
      if (rootStat.isFile()) {
        const lines = readFileSync(rootAbs, 'utf8').split(/\r?\n/)
        for (let i = 0; i < lines.length; i++) {
          if (!contentRegex || contentRegex.test(lines[i])) {
            hits.push(`${rootAbs}:${i + 1}: ${lines[i].slice(0, 240)}`)
            if (hits.length >= maxResults) break
          }
        }
      } else {
        walk(rootAbs)
      }

      return {
        content: [
          {
            type: 'text',
            text:
              hits.length > 0
                ? `在 ${rootAbs} 中找到 ${hits.length} 条结果：\n${hits.join('\n')}`
                : `在 ${rootAbs} 中未找到匹配项。`
          }
        ],
        details: { root: rootAbs, hitCount: hits.length }
      }
    }
  }

  const bashTool: RuntimeAgentTool = {
    name: 'bash',
    label: '终端命令执行 (Shell)',
    description:
      'Execute a non-interactive shell command (PowerShell on Windows, bash on macOS/Linux) in the project workspace with hidden console window. Never launch browsers (msedge/chrome) or edit .canvas.asset.json.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Command string to execute.'
        },
        cwd: {
          type: 'string',
          description: 'Optional working directory (defaults to current workspace root).'
        },
        timeoutMs: {
          type: 'integer',
          description: 'Optional timeout in milliseconds (default: 120000, max: 600000).'
        }
      },
      required: ['command']
    },
    prepareArguments: (raw) => prepareLooseToolArguments(raw),
    execute: async (
      _callId,
      params: Record<string, unknown>,
      signal
    ): Promise<RuntimeToolResult> => {
      const workspaceRoot = opts.getWorkspaceRoot()
      const command = String(params.command ?? '').trim()
      if (!command) {
        return {
          content: [{ type: 'text', text: 'command 不能为空' }],
          details: null,
          isError: true
        }
      }
      const cwd = params.cwd
        ? resolveTargetAbs(String(params.cwd), workspaceRoot)
        : resolvePath(workspaceRoot)
      const timeoutMs = Math.min(
        MAX_BASH_TIMEOUT_MS,
        Math.max(
          1000,
          Math.trunc(Number(params.timeoutMs ?? DEFAULT_BASH_TIMEOUT_MS) || DEFAULT_BASH_TIMEOUT_MS)
        )
      )

      const isWin = process.platform === 'win32'
      const shellBin = isWin ? 'powershell.exe' : '/bin/bash'
      const shellArgs = isWin
        ? [
            '-NoLogo',
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-Command',
            `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ${command}`
          ]
        : ['-lc', command]

      return await new Promise<RuntimeToolResult>((resolve) => {
        let stdout = ''
        let stderr = ''
        let timedOut = false
        let settled = false

        const child = spawn(shellBin, shellArgs, {
          cwd: existsSync(cwd) ? cwd : workspaceRoot,
          env: { ...process.env },
          windowsHide: true,
          detached: !isWin,
          stdio: ['ignore', 'pipe', 'pipe']
        })

        const finish = (exitCode: number | null, errText?: string): void => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          if (signal) signal.removeEventListener('abort', onAbort)

          const combined = [stdout.trimEnd(), stderr.trimEnd(), errText?.trim()]
            .filter(Boolean)
            .join('\n')
          const output = truncateMiddle(combined || '(无输出)', MAX_BASH_OUTPUT_CHARS)
          const isError =
            timedOut || Boolean(signal?.aborted) || (exitCode !== 0 && exitCode !== null)
          const prefix = timedOut
            ? `[命令执行超时（>${timeoutMs}ms），已终止进程树]\n`
            : signal?.aborted
              ? '[命令已被中止]\n'
              : exitCode !== 0
                ? `[退出码: ${exitCode}]\n`
                : ''
          resolve({
            content: [{ type: 'text', text: `${prefix}${output}` }],
            details: { exitCode, timedOut },
            isError
          })
        }

        const onAbort = (): void => {
          killProcessTree(child.pid)
          finish(130)
        }

        const timer = setTimeout(() => {
          timedOut = true
          killProcessTree(child.pid)
          finish(124)
        }, timeoutMs)

        if (signal?.aborted) {
          onAbort()
          return
        }
        if (signal) {
          signal.addEventListener('abort', onAbort, { once: true })
        }

        child.stdout?.setEncoding('utf8')
        child.stderr?.setEncoding('utf8')
        child.stdout?.on('data', (chunk: string) => {
          if (stdout.length < MAX_BASH_OUTPUT_CHARS * 2) stdout += chunk
        })
        child.stderr?.on('data', (chunk: string) => {
          if (stderr.length < MAX_BASH_OUTPUT_CHARS * 2) stderr += chunk
        })
        child.on('error', (err) => finish(1, err.message))
        child.on('close', (code) => finish(code))
      })
    }
  }

  return [readTool, writeTool, editTool, searchTool, bashTool]
}
