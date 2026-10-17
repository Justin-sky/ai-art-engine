import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { dirname, join } from 'node:path'
import {
  isValidClaudeSkillName,
  normalizeClaudeSkillMarkdown,
  parseClaudeSkillMarkdown,
  parseGitHubSkillSourceUrl,
  sanitizeClaudeSkillName,
  type GitHubSkillSourceRef
} from '@shared/claudeSkill'
import { dshSkillsDir } from './dshPaths'

export interface GitHubDiscoveredSkill {
  name: string
  description: string
  /** 技能在 GitHub 仓库中的相对子路径（空字符串表示仓库根目录） */
  repoSubpath: string
  version?: string
  author?: string
  license?: string
  argumentHint?: string
  userInvocable: boolean
  disableModelInvocation: boolean
  allowedTools: string[]
  model?: string
  context: 'inline' | 'fork'
  agent?: string
  hasScripts: boolean
  hasWorkflow: boolean
  files: Array<{ path: string; sizeBytes?: number }>
  scriptFiles: Array<{ path: string; sizeBytes?: number }>
  installed: boolean
}

export interface GitHubSkillInspectResult {
  ok: boolean
  source?: GitHubSkillSourceRef & { resolvedRef: string }
  skills?: GitHubDiscoveredSkill[]
  reasonKey?: string
  error?: string
}

export interface InstallGitHubSkillsInput {
  url: string
  /** 指定要安装的技能名列表；省略或为空时安装该地址发现的全部技能 */
  skillNames?: string[]
  /** 用户是否明示同意安装 scripts/ 目录下的可执行脚本 */
  skillScriptsConsent?: boolean
}

export interface InstallGitHubSkillsResult {
  ok: boolean
  installed: string[]
  reasonKey?: string
  error?: string
}

export interface InstalledGitHubSkillRecord {
  name: string
  sourceUrl: string
  owner: string
  repo: string
  ref: string
  repoSubpath: string
  installedAt: string
  version?: string
  hasScripts: boolean
}

const GITHUB_RECORDS_FILE = '.installed-github-skills.json'
const FETCH_TIMEOUT_MS = 20_000
const MAX_SKILL_FILE_BYTES = 2 * 1024 * 1024

function githubRecordsPath(skillsRoot = dshSkillsDir()): string {
  return join(skillsRoot, GITHUB_RECORDS_FILE)
}

export function listInstalledGitHubSkillRecords(
  skillsRoot = dshSkillsDir()
): InstalledGitHubSkillRecord[] {
  try {
    const file = githubRecordsPath(skillsRoot)
    if (!existsSync(file)) return []
    const raw = JSON.parse(readFileSync(file, 'utf8')) as unknown
    if (!Array.isArray(raw)) return []
    return raw.filter(
      (item): item is InstalledGitHubSkillRecord =>
        !!item &&
        typeof item === 'object' &&
        typeof (item as InstalledGitHubSkillRecord).name === 'string' &&
        existsSync(join(skillsRoot, (item as InstalledGitHubSkillRecord).name, 'SKILL.md'))
    )
  } catch {
    return []
  }
}

function writeInstalledGitHubSkillRecords(
  records: InstalledGitHubSkillRecord[],
  skillsRoot = dshSkillsDir()
): void {
  try {
    mkdirSync(skillsRoot, { recursive: true })
    writeFileSync(githubRecordsPath(skillsRoot), `${JSON.stringify(records, null, 2)}\n`, 'utf8')
  } catch (err) {
    console.warn('[githubSkillInstaller] failed to write records:', err)
  }
}

/**
 * 校验技能包内部文件相对路径安全性：
 * 支持 Claude Code 技能常见的多级目录：
 * - `SKILL.md`, `workflow.json`, `LICENSE*`, `README.md`, `*.md`（同级说明文档）
 * - `references/**`, `scripts/**`, `assets/**`, `examples/**`, `templates/**`
 */
export function isAllowedClaudeSkillBundleRelPath(relPath: string): boolean {
  if (!relPath || relPath.length > 240) return false
  if (relPath.includes('\\') || relPath.includes('\0')) return false
  if (relPath.startsWith('/') || /^[a-zA-Z]:/.test(relPath)) return false
  const segments = relPath.split('/')
  if (segments.some((s) => !s || s === '.' || s === '..' || s.startsWith('.git'))) return false
  if (segments.length === 1) {
    const file = segments[0]
    return (
      file === 'SKILL.md' ||
      file === 'workflow.json' ||
      /^LICENSE(?:\.[A-Za-z0-9]+)?$/i.test(file) ||
      /^[A-Za-z0-9_.-]+\.md$/i.test(file)
    )
  }
  const topDir = segments[0]
  return ['references', 'scripts', 'assets', 'examples', 'templates'].includes(topDir)
}

async function fetchWithTimeout(url: string, acceptJson = false): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'AIArtEngine-SkillMarket/1.0',
        ...(acceptJson ? { Accept: 'application/vnd.github+json' } : {})
      }
    })
  } finally {
    clearTimeout(timer)
  }
}

interface GitTreeItem {
  path: string
  type: 'blob' | 'tree'
  size?: number
}

/**
 * 获取 GitHub 仓库的递归文件树与实际分支名。
 * 若 GitHub API 触发限流，则自动回退到直接探测 raw.githubusercontent.com 上的 `SKILL.md`。
 */
async function resolveGitHubTree(parsed: GitHubSkillSourceRef): Promise<{
  resolvedRef: string
  tree: GitTreeItem[]
}> {
  const candidateRefs: string[] = []
  if (parsed.ref) {
    candidateRefs.push(parsed.ref)
  } else {
    // 尝试查询仓库默认分支
    try {
      const repoResp = await fetchWithTimeout(
        `https://api.github.com/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}`,
        true
      )
      if (repoResp.ok) {
        const meta = (await repoResp.json()) as { default_branch?: string }
        if (typeof meta.default_branch === 'string' && meta.default_branch.trim()) {
          candidateRefs.push(meta.default_branch.trim())
        }
      }
    } catch {
      // ignore and try main / master
    }
    if (!candidateRefs.includes('main')) candidateRefs.push('main')
    if (!candidateRefs.includes('master')) candidateRefs.push('master')
  }

  for (const ref of candidateRefs) {
    try {
      const treeUrl = `https://api.github.com/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/git/trees/${encodeURIComponent(ref)}?recursive=1`
      const resp = await fetchWithTimeout(treeUrl, true)
      if (resp.ok) {
        const data = (await resp.json()) as { tree?: unknown[] }
        if (Array.isArray(data.tree)) {
          const items: GitTreeItem[] = []
          for (const rawItem of data.tree) {
            if (!rawItem || typeof rawItem !== 'object') continue
            const obj = rawItem as Record<string, unknown>
            if (typeof obj.path !== 'string') continue
            if (obj.type !== 'blob' && obj.type !== 'tree') continue
            items.push({
              path: obj.path,
              type: obj.type,
              ...(typeof obj.size === 'number' ? { size: obj.size } : {})
            })
          }
          return { resolvedRef: ref, tree: items }
        }
      }
    } catch {
      // try next ref or raw fallback
    }
  }

  // Fallback: 当 GitHub API 不可用或限流时，直接探测 raw.githubusercontent.com 上的 SKILL.md
  for (const ref of candidateRefs) {
    const skillMdRel = parsed.subpath ? `${parsed.subpath}/SKILL.md` : 'SKILL.md'
    const rawUrl = buildRawGitHubUrl(parsed.owner, parsed.repo, ref, skillMdRel)
    try {
      const resp = await fetchWithTimeout(rawUrl)
      if (resp.ok) {
        return {
          resolvedRef: ref,
          tree: [{ path: skillMdRel, type: 'blob' }]
        }
      }
    } catch {
      // continue
    }
  }

  throw new Error('Failed to access GitHub repository or branch')
}

function buildRawGitHubUrl(owner: string, repo: string, ref: string, repoRelPath: string): string {
  const encodedPath = repoRelPath
    .split('/')
    .filter(Boolean)
    .map((seg) => encodeURIComponent(seg))
    .join('/')
  return `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(ref)}/${encodedPath}`
}

/**
 * 探测 GitHub 地址中包含的 Claude Code 技能清单。
 */
export async function inspectGitHubSkillSource(input: {
  url: string
  skillsRoot?: string
}): Promise<GitHubSkillInspectResult> {
  const parsed = parseGitHubSkillSourceUrl(input?.url ?? '')
  if (!parsed) {
    return { ok: false, reasonKey: 'invalidGitHubUrl' }
  }

  const skillsRoot = input.skillsRoot ?? dshSkillsDir()

  let resolvedRef: string
  let tree: GitTreeItem[]
  try {
    const res = await resolveGitHubTree(parsed)
    resolvedRef = res.resolvedRef
    tree = res.tree
  } catch (err) {
    return {
      ok: false,
      reasonKey: 'network',
      error: err instanceof Error ? err.message : String(err)
    }
  }

  const prefix = parsed.subpath ? `${parsed.subpath}/` : ''
  const blobs = tree.filter(
    (item) =>
      item.type === 'blob' &&
      (!prefix || item.path === parsed.subpath || item.path.startsWith(prefix))
  )

  // 找出所有 SKILL.md 所在的目录（repoSubpath）
  const skillDirs: string[] = []
  for (const blob of blobs) {
    if (blob.path === 'SKILL.md') {
      skillDirs.push('')
    } else if (blob.path.endsWith('/SKILL.md')) {
      const dir = blob.path.slice(0, -'/SKILL.md'.length)
      // 跳过深层无关嵌套（最多支持距过滤根 3 层，如 skills/<category>/<name>/SKILL.md）
      const relToSubpath = prefix && dir.startsWith(prefix) ? dir.slice(prefix.length) : dir
      const depth = relToSubpath ? relToSubpath.split('/').length : 0
      if (depth <= 3) {
        skillDirs.push(dir)
      }
    }
  }

  if (skillDirs.length === 0) {
    return {
      ok: false,
      reasonKey: 'noSkillsFound',
      source: { ...parsed, resolvedRef }
    }
  }

  // 限制单次探测最多并发拉取前 30 个 SKILL.md，避免超大仓库卡顿
  const targetDirs = skillDirs.slice(0, 30)
  const discovered: GitHubDiscoveredSkill[] = []

  await Promise.all(
    targetDirs.map(async (skillRepoDir) => {
      const skillMdRepoPath = skillRepoDir ? `${skillRepoDir}/SKILL.md` : 'SKILL.md'
      const rawUrl = buildRawGitHubUrl(parsed.owner, parsed.repo, resolvedRef, skillMdRepoPath)
      try {
        const resp = await fetchWithTimeout(rawUrl)
        if (!resp.ok) return
        const rawText = await resp.text()
        const folderFallback = skillRepoDir
          ? skillRepoDir.split('/').pop() || parsed.repo
          : parsed.repo
        const parsedSkill = parseClaudeSkillMarkdown(rawText, folderFallback)
        const dirPrefix = skillRepoDir ? `${skillRepoDir}/` : ''

        const files: Array<{ path: string; sizeBytes?: number }> = []
        const scriptFiles: Array<{ path: string; sizeBytes?: number }> = []
        let hasWorkflow = false

        for (const blob of blobs) {
          if (dirPrefix && !blob.path.startsWith(dirPrefix)) continue
          const relPath = dirPrefix ? blob.path.slice(dirPrefix.length) : blob.path
          if (!isAllowedClaudeSkillBundleRelPath(relPath)) continue
          const entry = {
            path: relPath,
            ...(typeof blob.size === 'number' && blob.size > 0 ? { sizeBytes: blob.size } : {})
          }
          files.push(entry)
          if (relPath.startsWith('scripts/')) {
            scriptFiles.push(entry)
          }
          if (relPath === 'workflow.json') {
            hasWorkflow = true
          }
        }

        if (!files.some((f) => f.path === 'SKILL.md')) {
          files.unshift({ path: 'SKILL.md', sizeBytes: Buffer.byteLength(rawText, 'utf8') })
        }

        const fm = parsedSkill.frontmatter
        const installed = existsSync(join(skillsRoot, fm.name, 'SKILL.md'))

        discovered.push({
          name: fm.name,
          description: fm.description,
          repoSubpath: skillRepoDir,
          ...(fm.version ? { version: fm.version } : {}),
          ...(fm.author ? { author: fm.author } : {}),
          ...(fm.license ? { license: fm.license } : {}),
          ...(fm.argumentHint ? { argumentHint: fm.argumentHint } : {}),
          userInvocable: fm.userInvocable,
          disableModelInvocation: fm.disableModelInvocation,
          allowedTools: fm.allowedTools,
          ...(fm.model ? { model: fm.model } : {}),
          context: fm.context,
          ...(fm.agent ? { agent: fm.agent } : {}),
          hasScripts: scriptFiles.length > 0,
          hasWorkflow,
          files,
          scriptFiles,
          installed
        })
      } catch {
        // ignore single skill fetch failure
      }
    })
  )

  if (discovered.length === 0) {
    return {
      ok: false,
      reasonKey: 'noSkillsFound',
      source: { ...parsed, resolvedRef }
    }
  }

  discovered.sort((a, b) => a.name.localeCompare(b.name))
  return {
    ok: true,
    source: { ...parsed, resolvedRef },
    skills: discovered
  }
}

/**
 * 从 GitHub 地址直接下载并安装一个或多个 Claude Code 技能到 `$DSH_HOME/skills/<name>`。
 */
export async function installGitHubSkills(
  input: InstallGitHubSkillsInput & { skillsRoot?: string }
): Promise<InstallGitHubSkillsResult> {
  const skillsRoot = input.skillsRoot ?? dshSkillsDir()
  const inspectResult = await inspectGitHubSkillSource({
    url: input.url,
    skillsRoot
  })
  if (!inspectResult.ok || !inspectResult.skills?.length || !inspectResult.source) {
    return {
      ok: false,
      installed: [],
      reasonKey: inspectResult.reasonKey ?? 'noSkillsFound',
      error: inspectResult.error
    }
  }

  const wantedNames =
    Array.isArray(input.skillNames) && input.skillNames.length > 0
      ? new Set(input.skillNames.map((n) => sanitizeClaudeSkillName(n)))
      : null

  const targets = wantedNames
    ? inspectResult.skills.filter((s) => wantedNames.has(s.name))
    : inspectResult.skills

  if (targets.length === 0) {
    return {
      ok: false,
      installed: [],
      reasonKey: 'noSkillsFound'
    }
  }

  const allowScripts = input.skillScriptsConsent === true
  const source = inspectResult.source
  const installedNames: string[] = []
  const records = listInstalledGitHubSkillRecords(skillsRoot)

  for (const skill of targets) {
    const targetDir = join(skillsRoot, skill.name)
    const stagingDir = `${targetDir}.staging-${Date.now()}`
    try {
      rmSync(stagingDir, { recursive: true, force: true })
      mkdirSync(stagingDir, { recursive: true })

      let scriptsInstalled = false
      for (const file of skill.files) {
        if (!isAllowedClaudeSkillBundleRelPath(file.path)) continue
        const isScript = file.path.startsWith('scripts/')
        if (isScript && !allowScripts) continue
        if (file.sizeBytes && file.sizeBytes > MAX_SKILL_FILE_BYTES) continue

        const repoRelPath = skill.repoSubpath ? `${skill.repoSubpath}/${file.path}` : file.path
        const fileUrl = buildRawGitHubUrl(
          source.owner,
          source.repo,
          source.resolvedRef,
          repoRelPath
        )
        const resp = await fetchWithTimeout(fileUrl)
        if (!resp.ok) {
          if (file.path === 'SKILL.md') {
            throw new Error(`Failed to fetch SKILL.md (${resp.status})`)
          }
          continue
        }
        const buf = Buffer.from(await resp.arrayBuffer())
        if (buf.byteLength > MAX_SKILL_FILE_BYTES) continue

        const destPath = join(stagingDir, file.path)
        mkdirSync(dirname(destPath), { recursive: true })
        if (file.path === 'SKILL.md') {
          const normalized = normalizeClaudeSkillMarkdown(buf.toString('utf8'), skill.name)
          writeFileSync(destPath, normalized, 'utf8')
        } else {
          writeFileSync(destPath, buf)
        }
        if (isScript) scriptsInstalled = true
      }

      if (!existsSync(join(stagingDir, 'SKILL.md'))) {
        throw new Error('SKILL.md missing after download')
      }

      mkdirSync(skillsRoot, { recursive: true })
      rmSync(targetDir, { recursive: true, force: true })
      renameSync(stagingDir, targetDir)
      installedNames.push(skill.name)

      const nextIdx = records.findIndex((r) => r.name === skill.name)
      const record: InstalledGitHubSkillRecord = {
        name: skill.name,
        sourceUrl: source.canonicalUrl,
        owner: source.owner,
        repo: source.repo,
        ref: source.resolvedRef,
        repoSubpath: skill.repoSubpath,
        installedAt: new Date().toISOString(),
        ...(skill.version ? { version: skill.version } : {}),
        hasScripts: scriptsInstalled
      }
      if (nextIdx >= 0) records[nextIdx] = record
      else records.push(record)
    } catch (err) {
      rmSync(stagingDir, { recursive: true, force: true })
      return {
        ok: false,
        installed: installedNames,
        reasonKey: 'download',
        error: err instanceof Error ? err.message : String(err)
      }
    }
  }

  writeInstalledGitHubSkillRecords(records, skillsRoot)
  return {
    ok: true,
    installed: installedNames
  }
}

/**
 * 卸载一个已安装的技能（支持目录型技能包 `<name>/` 与单文件 `<name>.md`）。
 */
export function uninstallSkillByName(
  rawName: string,
  skillsRoot = dshSkillsDir()
): { ok: boolean; error?: string } {
  const trimmed = String(rawName ?? '')
    .trim()
    .replace(/\.md$/i, '')
  if (!isValidClaudeSkillName(trimmed)) {
    return { ok: false, error: 'Invalid skill name' }
  }
  try {
    const bundleDir = join(skillsRoot, trimmed)
    if (existsSync(bundleDir) && statSync(bundleDir).isDirectory()) {
      rmSync(bundleDir, { recursive: true, force: true })
    }
    const flatFile = join(skillsRoot, `${trimmed}.md`)
    if (existsSync(flatFile) && statSync(flatFile).isFile()) {
      rmSync(flatFile, { force: true })
    }
    const records = listInstalledGitHubSkillRecords(skillsRoot).filter((r) => r.name !== trimmed)
    writeInstalledGitHubSkillRecords(records, skillsRoot)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
