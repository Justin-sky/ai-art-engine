/**
 * Git 变更预览服务（只读）。
 *
 * 用途：AI 对话中展示「这一轮 agent 到底改了工程里的哪些文件、改了什么」。
 *
 * 约束与取舍：
 * - 只跑只读子命令（rev-parse / status / diff），绝不写仓库（不 add / commit / stash）；
 * - 一律 execFile 直调、不经 shell，且路径只接受工程内相对路径并二次 resolve 校验，
 *   外部传入的路径无法越出工程目录；
 * - 找不到 git、不在仓库内、命令失败都作为**正常结果**返回（GitStatusResult.reason），
 *   不抛异常——对话卡只做展示，不该因为预览失败打断会话；
 * - `core.quotepath=false` 关掉路径转义，中文 / 空格路径原样送出；
 * - `GIT_TERMINAL_PROMPT=0` + `GIT_OPTIONAL_LOCKS=0`：预览是旁路行为，
 *   不允许弹凭据输入、也不抢仓库锁（避免干扰用户同时在跑的 git 操作）。
 */
import { execFile } from 'child_process'
import { createHash } from 'crypto'
import { readFileSync, statSync } from 'fs'
import { resolve, sep } from 'path'
import { promisify } from 'util'
import {
  buildUntrackedDiff,
  isSafeRelativePath,
  mergeGitChangeFiles,
  parseGitNumstat,
  parseGitStatusPorcelain,
  type GitFileDiffInput,
  type GitFileDiffResult,
  type GitNumstat,
  type GitReason,
  type GitStatusResult
} from '@shared/git'
import { projectService } from './projectService'

const execFileAsync = promisify(execFile)
/** 单条 git 命令超时（大仓库 status 可能偏慢，但不应拖住对话） */
const GIT_TIMEOUT_MS = 8_000
const GIT_MAX_BUFFER = 8 * 1024 * 1024
/** 单文件 diff 文本上限（超出截断并提示，避免大文件把 IPC / localStorage 撑爆） */
const DIFF_MAX_CHARS = 240_000
/** 未跟踪文件读取上限（超过按二进制/过大处理） */
const UNTRACKED_MAX_BYTES = 512 * 1024
/** 指纹内联计算的体积上限：超过改用「体积 + mtime」近似（避免读大媒体文件） */
const FINGERPRINT_INLINE_MAX_BYTES = 4 * 1024 * 1024

/** git 可执行文件探测结果缓存（undefined = 尚未探测） */
let gitBinCache: string | null | undefined

function gitArgs(args: string[]): string[] {
  return ['-c', 'core.quotepath=false', ...args]
}

async function ensureGitBin(): Promise<string | null> {
  if (gitBinCache !== undefined) return gitBinCache
  const candidates = [
    process.env.GIT_PATH?.trim() ?? '',
    'git',
    ...(process.platform === 'win32'
      ? ['git.exe', 'C:\\Program Files\\Git\\cmd\\git.exe', 'C:\\Program Files (x86)\\Git\\cmd\\git.exe']
      : [])
  ].filter(Boolean)
  for (const bin of candidates) {
    try {
      await execFileAsync(bin, ['--version'], { timeout: 4_000, windowsHide: true })
      gitBinCache = bin
      return bin
    } catch {
      // 试下一个候选（未安装 / 路径失效）
    }
  }
  gitBinCache = null
  return null
}

async function runGit(
  args: string[],
  cwd: string
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const bin = await ensureGitBin()
  if (!bin) return { ok: false, stdout: '', stderr: 'git-not-found' }
  try {
    const { stdout, stderr } = await execFileAsync(bin, args, {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_MAX_BUFFER,
      windowsHide: true,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GIT_OPTIONAL_LOCKS: '0',
        GIT_PAGER: 'cat',
        GIT_EDITOR: 'true'
      }
    })
    return { ok: true, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') }
  } catch (err) {
    const failure = err as { stdout?: string; stderr?: string; message?: string }
    return {
      ok: false,
      stdout: String(failure.stdout ?? ''),
      stderr: String(failure.stderr ?? failure.message ?? '')
    }
  }
}

/** 工程内相对路径 → 绝对路径；越界返回 null（第一道闸在调用方 isSafeRelativePath） */
function resolveInside(root: string, relPath: string): string | null {
  const rootAbs = resolve(root)
  const abs = resolve(rootAbs, relPath)
  if (abs !== rootAbs && !abs.startsWith(rootAbs + sep)) return null
  return abs
}

/**
 * 工作区内容指纹：只用于判断「两次采集之间文件是否变化」。
 * 文本以内联 sha1 精确比对；超大文件（媒体）退化为体积 + mtime，避免读几十 MB。
 */
function fingerprintFile(abs: string): string {
  try {
    const stat = statSync(abs)
    if (!stat.isFile()) return ''
    if (stat.size > FINGERPRINT_INLINE_MAX_BYTES) {
      return `big:${stat.size}:${Math.round(stat.mtimeMs)}`
    }
    return createHash('sha1').update(readFileSync(abs)).digest('hex')
  } catch {
    return ''
  }
}

/** 读取文本文件（超限截断）；二进制（含 NUL）或不可读返回 null */
function readTextFileLimited(abs: string, maxBytes: number): string | null {
  try {
    const stat = statSync(abs)
    if (!stat.isFile()) return null
    const buffer = readFileSync(abs)
    const slice = buffer.subarray(0, maxBytes)
    if (slice.includes(0)) return null
    return slice.toString('utf8')
  } catch {
    return null
  }
}

/** 未跟踪文件没有 numstat：按行数补一个「全部新增」的统计 */
function untrackedStat(abs: string): GitNumstat {
  const text = readTextFileLimited(abs, UNTRACKED_MAX_BYTES)
  if (text === null) return { additions: 0, deletions: 0, binary: true }
  const lines = text.split('\n')
  if (lines.length && lines[lines.length - 1] === '') lines.pop()
  return { additions: lines.length, deletions: 0, binary: false }
}

/**
 * 采集当前工程的 git 变更（相对 HEAD，含未跟踪文件，遵守 .gitignore）。
 * 路径以工程根为基准（`--relative`），因此工程位于仓库子目录时也能直接展示。
 */
export async function readGitStatus(): Promise<GitStatusResult> {
  const base: GitStatusResult = {
    available: true,
    isRepo: false,
    repoRoot: '',
    branch: '',
    files: [],
    reason: 'no-project'
  }
  if (!projectService.isOpen()) return base
  const root = projectService.getRoot()
  if (!(await ensureGitBin())) return { ...base, available: false, reason: 'no-git' }

  const inside = await runGit(gitArgs(['rev-parse', '--is-inside-work-tree']), root)
  if (!inside.ok || inside.stdout.trim() !== 'true') {
    return { ...base, available: true, reason: 'not-a-repo' }
  }

  const topLevel = await runGit(gitArgs(['rev-parse', '--show-toplevel']), root)
  const repoRoot = topLevel.ok ? topLevel.stdout.trim() || root : root
  const head = await runGit(gitArgs(['rev-parse', '--abbrev-ref', 'HEAD']), root)
  const branch = head.ok ? head.stdout.trim() : ''

  const statusRes = await runGit(
    gitArgs(['status', '--porcelain=v1', '-z', '--untracked-files=all', '--relative']),
    root
  )
  if (!statusRes.ok) {
    return {
      ...base,
      isRepo: true,
      repoRoot,
      branch,
      reason: 'failed',
      message: statusRes.stderr.trim()
    }
  }
  const entries = parseGitStatusPorcelain(statusRes.stdout)

  // numstat 只覆盖已跟踪文件；空仓库（无 HEAD）时整体失败，此时全部按未跟踪补统计
  const statsRes = await runGit(gitArgs(['diff', '--numstat', 'HEAD', '--relative']), root)
  const stats: Map<string, GitNumstat> = statsRes.ok ? parseGitNumstat(statsRes.stdout) : new Map()

  const fingerprints = new Map<string, string>()
  for (const entry of entries) {
    if (entry.status === 'deleted') {
      fingerprints.set(entry.path, '')
      continue
    }
    const abs = resolveInside(root, entry.path)
    if (!abs) continue
    fingerprints.set(entry.path, fingerprintFile(abs))
    if (entry.status === 'untracked' && !stats.has(entry.path)) {
      stats.set(entry.path, untrackedStat(abs))
    }
  }

  return {
    available: true,
    isRepo: true,
    repoRoot,
    branch,
    files: mergeGitChangeFiles(entries, stats, fingerprints),
    reason: ''
  }
}

/**
 * 单个文件的统一 diff（相对 HEAD）。
 * 未跟踪文件 git 无法输出 diff，改由主进程读全文合成「新文件全新增」，
 * 这样对话卡里点开任何文件都能看到内容。
 */
export async function readGitFileDiff(input: GitFileDiffInput): Promise<GitFileDiffResult> {
  const path = String(input?.path ?? '').trim()
  const empty: GitFileDiffResult = { path, diff: '', truncated: false, binary: false }
  if (!projectService.isOpen() || !isSafeRelativePath(path)) return empty
  const root = projectService.getRoot()
  const abs = resolveInside(root, path)
  if (!abs) return empty
  if (!(await ensureGitBin())) return empty

  const res = await runGit(
    gitArgs(['diff', '--no-color', '--no-ext-diff', '-U3', 'HEAD', '--', path]),
    root
  )
  let diff = res.ok ? res.stdout : ''
  const binary = /^Binary files .* differ$/m.test(diff)
  if (!diff.trim()) {
    // HEAD 里没有该文件（未跟踪 / 尚未提交的新文件）：读工作区内容合成 diff
    const text = readTextFileLimited(abs, UNTRACKED_MAX_BYTES)
    if (text !== null && text.trim()) diff = buildUntrackedDiff(path, text)
  }

  const truncated = diff.length > DIFF_MAX_CHARS
  return {
    path,
    diff: truncated ? diff.slice(0, DIFF_MAX_CHARS) : diff,
    truncated,
    binary
  }
}

/** 供测试 / 诊断：清掉 git 可执行文件探测缓存 */
export function resetGitBinCache(): void {
  gitBinCache = undefined
}

/** 类型再导出，便于主进程其他模块引用（避免各自 import @shared/git） */
export type { GitReason }
