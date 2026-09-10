/**
 * Git 变更预览：共享契约 + 纯解析层。
 *
 * 主进程只负责「跑 git 只读命令 + 读文件指纹」，所有格式解析、变更筛选都是
 * 纯函数放在这里，便于离线单测（不依赖本机是否装 git / 是否有仓库）。
 *
 * 数据来源：
 * - `git status --porcelain=v1 -z --relative`：变更文件集合与状态；
 * - `git diff --numstat HEAD --relative`：逐文件增删行数（二进制为 `-`）；
 * - 工作区文件内容指纹（主进程计算）：判断「这一轮运行到底改动了哪些文件」。
 */

/** 单个文件的变更类型（与 git status 的 XY 两位归类结果一致） */
export type GitFileStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked'
  | 'conflicted'

/** `git status` 单条记录（-z 格式解析结果） */
export interface GitStatusEntry {
  /** 相对工程根的 posix 路径（新路径） */
  path: string
  status: GitFileStatus
  /** rename / copy 的来源路径 */
  oldPath?: string
}

/** 逐文件增删统计（来自 numstat；未跟踪文件由主进程按行数补） */
export interface GitNumstat {
  additions: number
  deletions: number
  /** 二进制改动（numstat 行为 `-\t-`） */
  binary: boolean
}

/** 参与预览的单个变更文件 */
export interface GitChangeFile {
  /** 相对工程根的 posix 路径 */
  path: string
  status: GitFileStatus
  additions: number
  deletions: number
  /**
   * 工作区内容指纹（主进程读文件得出，已删除文件为空串）。
   * 只用于前后两次采集的「是否变化」对比，不对外表达内容。
   */
  hash: string
  oldPath?: string
  binary?: boolean
}

/** 采集结果：不可用 / 非仓库都通过 available + reason 表达，不抛异常（UI 直接展示） */
export interface GitStatusResult {
  /** 本机是否找到可用的 git 可执行文件 */
  available: boolean
  /** 当前工程是否位于 git 工作树内 */
  isRepo: boolean
  /** 仓库根绝对路径（非仓库为空串） */
  repoRoot: string
  /** 当前分支（detached 时为空串） */
  branch: string
  /** 变更文件（相对工程根，遵守 .gitignore；含未跟踪文件） */
  files: GitChangeFile[]
  /** 不可用原因（`no-project` / `no-git` / `not-a-repo` / `failed`；正常为空串） */
  reason: GitReason | ''
  /** 失败详情（供卡片提示，可能为空） */
  message?: string
}

export type GitReason = 'no-project' | 'no-git' | 'not-a-repo' | 'failed'

/** diff 请求：只接受工程内相对路径（主进程再做一次越界校验） */
export interface GitFileDiffInput {
  path: string
}

export interface GitFileDiffResult {
  path: string
  /** 统一 diff 文本（未跟踪文件为合成的「全新增」diff；二进制为空） */
  diff: string
  /** 是否因体积被截断 */
  truncated: boolean
  /** 二进制改动（无文本差异可看） */
  binary: boolean
}

export type GitDiffLineType = 'meta' | 'hunk' | 'add' | 'del' | 'context'

export interface GitDiffLine {
  type: GitDiffLineType
  text: string
}

/**
 * 解析 `git status --porcelain=v1 -z`。
 *
 * -z 记录形如 `XY <path>\0`；rename / copy 时紧随其后是一个**单独**的 NUL 字段
 * 存放原始路径（`R  new\0old\0`）。`--untracked-files=all` 下 `??` 同样出现，
 * 未跟踪目录会被展开为逐文件。
 */
export function parseGitStatusPorcelain(stdout: string): GitStatusEntry[] {
  const entries: GitStatusEntry[] = []
  /** 等待读取「原始路径」的条目下标（rename / copy 才有） */
  let awaitingOldPathIndex = -1

  for (const raw of stdout.split('\0')) {
    if (!raw) continue
    if (awaitingOldPathIndex >= 0) {
      entries[awaitingOldPathIndex]!.oldPath = raw
      awaitingOldPathIndex = -1
      continue
    }
    if (raw.length < 4) continue
    const x = raw[0]!
    const y = raw[1]!
    const path = raw.slice(3)
    if (!path) continue
    entries.push({ path, status: classifyGitStatus(x, y) })
    if (x === 'R' || x === 'C') awaitingOldPathIndex = entries.length - 1
  }
  return entries
}

/** 由 porcelain 的 XY 两位归类为单一状态（索引态 X + 工作区态 Y） */
export function classifyGitStatus(x: string, y: string): GitFileStatus {
  if (x === '?' && y === '?') return 'untracked'
  // 冲突（unmerged）优先于 D / A：`DD` / `AA` / `U?` 都属冲突
  if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) {
    return 'conflicted'
  }
  if (x === 'R') return 'renamed'
  if (x === 'C') return 'copied'
  if (x === 'D' || y === 'D') return 'deleted'
  if (x === 'A') return 'added'
  return 'modified'
}

/**
 * 解析 `git diff --numstat` 输出。
 * 行格式为 `添加行数\t删除行数\t路径`；二进制改动两列为 `-`。
 */
export function parseGitNumstat(stdout: string): Map<string, GitNumstat> {
  const map = new Map<string, GitNumstat>()
  for (const line of stdout.split('\n')) {
    if (!line) continue
    const parts = line.split('\t')
    if (parts.length < 3) continue
    const addRaw = parts[0]!
    const delRaw = parts[1]!
    const pathRaw = parts.slice(2).join('\t').replace(/^"(.*)"$/, '$1')
    const binary = addRaw === '-' || delRaw === '-'
    map.set(normalizeNumstatPath(pathRaw), {
      additions: binary ? 0 : Number.parseInt(addRaw, 10) || 0,
      deletions: binary ? 0 : Number.parseInt(delRaw, 10) || 0,
      binary
    })
  }
  return map
}

/**
 * numstat 的路径字段在 rename / copy 时会被折叠：
 * `old => new`、`dir/{a => b}/file`、`{old => new}/file` 三种形态统一还原为新路径。
 */
export function normalizeNumstatPath(raw: string): string {
  const text = raw.trim()
  if (!text.includes('=>')) return text
  const braced = text.match(/^(.*)\{(.*) => (.*)\}(.*)$/)
  if (braced) {
    return `${braced[1]}${braced[3]}${braced[4]}`.replace(/\/{2,}/g, '/')
  }
  const segments = text.split('=>')
  return segments[segments.length - 1]!.trim()
}

/**
 * 合并 status 与逐文件统计，得到可直接渲染的变更清单（按路径排序，稳定展示顺序）。
 * 未跟踪文件没有 numstat，调用方把行数并按同一 key 塞进 stats 即可。
 */
export function mergeGitChangeFiles(
  entries: GitStatusEntry[],
  stats: ReadonlyMap<string, GitNumstat>,
  fingerprints: ReadonlyMap<string, string>
): GitChangeFile[] {
  return entries
    .map((entry) => {
      const stat = stats.get(entry.path)
      return {
        path: entry.path,
        status: entry.status,
        additions: stat?.additions ?? 0,
        deletions: stat?.deletions ?? 0,
        hash: fingerprints.get(entry.path) ?? '',
        ...(entry.oldPath ? { oldPath: entry.oldPath } : {}),
        ...(stat?.binary ? { binary: true } : {})
      }
    })
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

/**
 * 相对上一份指纹快照筛出「这一轮真正变化」的文件。
 * 快照里没有记录（首次采集）或指纹不同（含新删除文件 hash 由非空变空）都算变化。
 */
export function selectChangedFiles(
  previous: ReadonlyMap<string, string>,
  files: GitChangeFile[]
): GitChangeFile[] {
  return files.filter((file) => previous.get(file.path) !== file.hash)
}

/** 由文件清单生成指纹快照（供下一次对比） */
export function fingerprintMap(files: GitChangeFile[]): Map<string, string> {
  return new Map(files.map((file) => [file.path, file.hash]))
}

/**
 * 解析统一 diff 为可逐行染色的结构。
 * `+++` / `---` / `diff --git` 等文件头属于 meta，不会被误判为增删行。
 */
export function parseUnifiedDiff(text: string): GitDiffLine[] {
  const lines: GitDiffLine[] = []
  const rawLines = text.split('\n')
  // 统一 diff 末尾必然带一个换行：整体去掉最后一个空元素即可，行内保留原始内容
  if (rawLines.length && rawLines[rawLines.length - 1] === '') rawLines.pop()
  for (const raw of rawLines) {
    const line = raw.replace(/\r$/, '')
    lines.push({ type: classifyDiffLine(line), text: line })
  }
  return lines
}

function classifyDiffLine(line: string): GitDiffLineType {
  if (line.startsWith('@@')) return 'hunk'
  if (
    line.startsWith('diff ') ||
    line.startsWith('index ') ||
    line.startsWith('--- ') ||
    line.startsWith('+++ ') ||
    line.startsWith('new file') ||
    line.startsWith('deleted file') ||
    line.startsWith('old mode') ||
    line.startsWith('new mode') ||
    line.startsWith('similarity index') ||
    line.startsWith('rename from') ||
    line.startsWith('rename to') ||
    line.startsWith('copy from') ||
    line.startsWith('copy to') ||
    line.startsWith('Binary files') ||
    line.startsWith('\\ No newline')
  ) {
    return 'meta'
  }
  if (line.startsWith('+')) return 'add'
  if (line.startsWith('-')) return 'del'
  return 'context'
}

/**
 * 合成未跟踪文件的 diff（git 无法对未跟踪文件输出统一 diff）：
 * 统一按「新文件 + 全文新增」表达，与已跟踪文件的新增展示一致。
 */
export function buildUntrackedDiff(path: string, text: string): string {
  const lines = text.split('\n')
  if (lines.length && lines[lines.length - 1] === '') lines.pop()
  return [
    `diff --git a/${path} b/${path}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${path}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((line) => `+${line.replace(/\r$/, '')}`)
  ].join('\n')
}

/**
 * 校验渲染层传来的相对路径：必须是工程内相对路径、不得越界。
 * 主进程还会再 resolve 一次做绝对路径校验，这里是第一道闸。
 */
export function isSafeRelativePath(path: string): boolean {
  const posix = path.trim().replace(/\\/g, '/')
  if (!posix || posix.startsWith('/') || /^[a-zA-Z]:/.test(posix)) return false
  if (posix.includes('\0')) return false
  return !posix.split('/').some((segment) => segment === '..')
}
