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
  /** 因未传 skillScriptsConsent=true 而跳过安装 scripts/ 目录的技能名列表（SKILL.md 与文档仍已正常安装） */
  skippedScriptsFor?: string[]
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

export interface OnlineSkillSearchItem {
  /** 技能名（kebab-case，安装后可通过 /<name> 调用） */
  name: string
  /** 展示标题 */
  title: string
  /** 技能描述 */
  description: string
  /** 来源：github（Claude Code / GitHub 技能）或 market（官方工作流/技能市场） */
  source: 'github' | 'market'
  /** GitHub 安装地址（可直接传给 skill_install 的 url） */
  url?: string
  /** GitHub 仓库标识（owner/repo） */
  repo?: string
  /** GitHub Star 数（若来自 GitHub 搜索） */
  stars?: number
  /** 官方技能市场条目 ID（可直接传给 skill_install 的 marketId） */
  marketId?: string
  /** 是否包含可执行脚本 scripts/ */
  hasScripts: boolean
  /** 是否包含画布工作流模板 workflow.json */
  hasWorkflow: boolean
  /** 当前本机是否已安装 */
  installed: boolean
}

export interface OnlineSkillSearchResult {
  ok: boolean
  query: string
  items: OnlineSkillSearchItem[]
  error?: string
}

const GITHUB_RECORDS_FILE = '.installed-github-skills.json'
const GITHUB_SKILL_META_FILE = '.aiart-github-skill.json'
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

async function fetchWithTimeout(
  url: string,
  acceptJson = false,
  timeoutMs = FETCH_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
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
  const skippedScriptsFor: string[] = []
  const records = listInstalledGitHubSkillRecords(skillsRoot)

  for (const skill of targets) {
    const targetDir = join(skillsRoot, skill.name)
    const stagingDir = `${targetDir}.staging-${Date.now()}`
    try {
      rmSync(stagingDir, { recursive: true, force: true })
      mkdirSync(stagingDir, { recursive: true })

      if (skill.hasScripts && !allowScripts) {
        skippedScriptsFor.push(skill.name)
      }

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

      const installedAt = new Date().toISOString()
      writeFileSync(
        join(stagingDir, GITHUB_SKILL_META_FILE),
        `${JSON.stringify(
          {
            owner: source.owner,
            repo: source.repo,
            resolvedRef: source.resolvedRef,
            repoSubpath: skill.repoSubpath,
            sourceUrl: source.canonicalUrl,
            installedAt,
            ...(skill.version ? { version: skill.version } : {}),
            hasScripts: scriptsInstalled
          },
          null,
          2
        )}\n`,
        'utf8'
      )

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
        installedAt,
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
        ...(skippedScriptsFor.length ? { skippedScriptsFor } : {}),
        reasonKey: 'download',
        error: err instanceof Error ? err.message : String(err)
      }
    }
  }

  writeInstalledGitHubSkillRecords(records, skillsRoot)
  return {
    ok: true,
    installed: installedNames,
    ...(skippedScriptsFor.length ? { skippedScriptsFor } : {})
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

/**
 * 精选 Claude Code 官方与社区高频技能索引（anthropics/skills）：
 * 支持中英文语义关键词即时检索，即使 GitHub 搜索 API 受限也能精准命中并返回一键安装地址。
 */
const CURATED_CLAUDE_SKILLS: ReadonlyArray<{
  name: string
  title: string
  description: string
  keywords: string[]
  repo: string
  url: string
  hasScripts: boolean
}> = [
  {
    name: 'frontend-design',
    title: 'Frontend Design (前端界面设计)',
    description:
      'Create distinctive, production-grade frontend interfaces with high design quality (HTML/CSS/React/Vue UI design).',
    keywords: [
      'frontend',
      'ui',
      'web',
      'design',
      'css',
      'react',
      'vue',
      '前端',
      '界面',
      '网页设计'
    ],
    repo: 'anthropics/skills',
    url: 'https://github.com/anthropics/skills/tree/main/skills/frontend-design',
    hasScripts: false
  },
  {
    name: 'canvas-design',
    title: 'Canvas Design (海报与视觉平面设计)',
    description:
      'Create visual art, posters, and graphic layouts in PNG and PDF documents using design philosophy.',
    keywords: ['canvas', 'poster', 'graphic', 'art', 'visual', '海报', '平面设计', '视觉', '排版'],
    repo: 'anthropics/skills',
    url: 'https://github.com/anthropics/skills/tree/main/skills/canvas-design',
    hasScripts: false
  },
  {
    name: 'algorithmic-art',
    title: 'Algorithmic Art (算法与生成艺术)',
    description:
      'Create algorithmic and generative art using p5.js with seeded randomness and interactive parameter exploration.',
    keywords: [
      'algorithmic',
      'generative',
      'p5js',
      'shader',
      'particle',
      '算法艺术',
      '生成艺术',
      '粒子'
    ],
    repo: 'anthropics/skills',
    url: 'https://github.com/anthropics/skills/tree/main/skills/algorithmic-art',
    hasScripts: false
  },
  {
    name: 'mcp-builder',
    title: 'MCP Server Builder (MCP 工具服务开发)',
    description:
      'Guide for creating high-quality MCP (Model Context Protocol) servers in TypeScript or Python.',
    keywords: ['mcp', 'server', 'tool', 'agent', 'protocol', '插件', '工具开发'],
    repo: 'anthropics/skills',
    url: 'https://github.com/anthropics/skills/tree/main/skills/mcp-builder',
    hasScripts: true
  },
  {
    name: 'skill-creator',
    title: 'Skill Creator (Claude 技能创建向导)',
    description:
      'Guide for creating effective Claude Code skills (SKILL.md frontmatter, workflows, and bundled resources).',
    keywords: ['skill', 'creator', 'template', 'claude', '技能', '编写技能', '创建技能'],
    repo: 'anthropics/skills',
    url: 'https://github.com/anthropics/skills/tree/main/skills/skill-creator',
    hasScripts: true
  },
  {
    name: 'webapp-testing',
    title: 'WebApp Testing (Web 应用自动化测试)',
    description:
      'Toolkit for interacting with and testing web applications using Playwright and browser automation.',
    keywords: ['test', 'testing', 'playwright', 'webapp', 'e2e', 'qa', '测试', '自动化测试'],
    repo: 'anthropics/skills',
    url: 'https://github.com/anthropics/skills/tree/main/skills/webapp-testing',
    hasScripts: true
  },
  {
    name: 'web-artifacts-builder',
    title: 'Web Artifacts Builder (复杂交互组件构建)',
    description:
      'Suite of tools for creating elaborate multi-component HTML/React/Tailwind/shadcn web artifacts.',
    keywords: ['artifact', 'react', 'tailwind', 'shadcn', 'interactive', '交互组件', '微应用'],
    repo: 'anthropics/skills',
    url: 'https://github.com/anthropics/skills/tree/main/skills/web-artifacts-builder',
    hasScripts: true
  },
  {
    name: 'theme-factory',
    title: 'Theme Factory (主题配色与字体工厂)',
    description:
      'Toolkit for styling documents, slides, reports, and HTML landing pages with curated color and font themes.',
    keywords: ['theme', 'color', 'palette', 'font', 'style', '主题', '配色', '字体', '风格'],
    repo: 'anthropics/skills',
    url: 'https://github.com/anthropics/skills/tree/main/skills/theme-factory',
    hasScripts: false
  },
  {
    name: 'pptx',
    title: 'PPTX Presentation (演示文稿制作与解析)',
    description:
      'Presentation creation, editing, and analysis for .pptx slide decks, layouts, and speaker notes.',
    keywords: ['ppt', 'pptx', 'slide', 'presentation', 'deck', '幻灯片', '演示文稿', '课件'],
    repo: 'anthropics/skills',
    url: 'https://github.com/anthropics/skills/tree/main/skills/pptx',
    hasScripts: true
  },
  {
    name: 'pdf',
    title: 'PDF Toolkit (PDF 提取/合并/生成)',
    description:
      'Comprehensive PDF manipulation toolkit for extracting text/tables, creating PDFs, merging/splitting, and forms.',
    keywords: ['pdf', 'document', 'report', 'extract', '文档', '报告'],
    repo: 'anthropics/skills',
    url: 'https://github.com/anthropics/skills/tree/main/skills/pdf',
    hasScripts: true
  },
  {
    name: 'docx',
    title: 'DOCX Word Document (Word 文档生成与修订)',
    description:
      'Document creation, editing, tracked changes, comments, and formatting for .docx Word files.',
    keywords: ['docx', 'word', 'doc', 'document', '文档', '排版'],
    repo: 'anthropics/skills',
    url: 'https://github.com/anthropics/skills/tree/main/skills/docx',
    hasScripts: true
  },
  {
    name: 'xlsx',
    title: 'XLSX Spreadsheet (Excel 表格与数据分析)',
    description:
      'Spreadsheet creation, formulas, financial modeling, and data analysis for .xlsx and CSV files.',
    keywords: ['xlsx', 'excel', 'csv', 'spreadsheet', 'table', '表格', '数据', '报表'],
    repo: 'anthropics/skills',
    url: 'https://github.com/anthropics/skills/tree/main/skills/xlsx',
    hasScripts: true
  },
  {
    name: 'doc-coauthoring',
    title: 'Doc Co-Authoring (结构化文档与方案共创)',
    description:
      'Structured workflow for co-authoring documentation, proposals, technical specs, and PRDs.',
    keywords: ['doc', 'prd', 'spec', 'proposal', 'writing', '方案', '策划', '文档写作', '需求文档'],
    repo: 'anthropics/skills',
    url: 'https://github.com/anthropics/skills/tree/main/skills/doc-coauthoring',
    hasScripts: false
  },
  {
    name: 'brand-guidelines',
    title: 'Brand Guidelines (品牌视觉规范)',
    description: 'Applies consistent brand colors, typography, and visual identity guidelines.',
    keywords: ['brand', 'guideline', 'identity', 'logo', '品牌', '视觉规范', 'VI'],
    repo: 'anthropics/skills',
    url: 'https://github.com/anthropics/skills/tree/main/skills/brand-guidelines',
    hasScripts: false
  },
  {
    name: 'slack-gif-creator',
    title: 'GIF Creator (动图与表情包生成)',
    description: 'Toolkit for creating animated GIFs optimized for chat and social platforms.',
    keywords: ['gif', 'animation', 'emoji', 'sticker', '动图', '表情包', '动画'],
    repo: 'anthropics/skills',
    url: 'https://github.com/anthropics/skills/tree/main/skills/slack-gif-creator',
    hasScripts: true
  }
]

function matchScoreForTokens(
  haystack: string,
  tokens: string[],
  itemKeywords: readonly string[] = [],
  rawQueryLower = ''
): number {
  if (tokens.length === 0 && !rawQueryLower) return 1
  const lower = haystack.toLowerCase()
  let score = 0
  for (const token of tokens) {
    if (lower.includes(token)) score += 2
  }
  if (rawQueryLower) {
    for (const kw of itemKeywords) {
      const kwLower = kw.toLowerCase()
      if (kwLower.length >= 2 && rawQueryLower.includes(kwLower)) {
        score += 3
      }
    }
  }
  return score
}

const ZH_TO_GITHUB_SEARCH_TERMS: ReadonlyArray<[RegExp, string]> = [
  [/前端|界面|网页|组件|ui/i, 'frontend ui design'],
  [/海报|平面|视觉|排版/i, 'canvas design poster'],
  [/算法|生成艺术|粒子|着色器/i, 'generative art p5js'],
  [/mcp|插件|工具服务/i, 'mcp server'],
  [/测试|自动化/i, 'webapp testing playwright'],
  [/ppt|幻灯片|演示文稿|课件/i, 'pptx presentation'],
  [/pdf|报告/i, 'pdf toolkit'],
  [/word|文档|排版/i, 'docx document'],
  [/excel|表格|数据|报表/i, 'xlsx spreadsheet'],
  [/动图|表情包|动画|gif/i, 'gif animation'],
  [/品牌|视觉规范|logo/i, 'brand guidelines'],
  [/主题|配色|字体/i, 'theme palette'],
  [/分镜|短剧|影视|剧本|电影/i, 'storyboard film script'],
  [/3d|建模|骨骼|blender/i, 'blender 3d']
]

/**
 * 在线搜索可安装的技能（支持中英文关键词与自然语言整句）：
 * 1. 检索精选 Claude Code 官方技能库（`anthropics/skills` 等）；
 * 2. 检索 GitHub 公共仓库（`api.github.com/search/repositories`），并对高相关仓库自动探测 `SKILL.md`；
 * 3. 返回可直接传入 `skill_install` 的 `url` 与技能详情。
 */
export async function searchOnlineSkills(input: {
  query: string
  limit?: number
  skillsRoot?: string
}): Promise<OnlineSkillSearchResult> {
  const rawQuery = String(input?.query ?? '').trim()
  const rawQueryLower = rawQuery.toLowerCase()
  const limit = Math.min(30, Math.max(1, Number(input?.limit) || 12))
  const skillsRoot = input?.skillsRoot ?? dshSkillsDir()

  const cleanedQuery = rawQueryLower
    .replace(
      /帮我|请|主动|上网|联网|在线|搜索|搜一下|搜个|搜|查找|找一个|找个|找|安装|装上|装一下|装个|导入|添加|一个|一下|关于|相关的?|有没有|的|技能|skill|skills/gi,
      ' '
    )
    .trim()

  const tokens = (cleanedQuery || rawQueryLower)
    .split(/[\s,，、/|]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)

  const results: OnlineSkillSearchItem[] = []
  const seenUrls = new Set<string>()

  // 1. 匹配内置精选 Claude Code 技能索引（支持双向子串匹配，兼容中文无空格长句）
  const scoredCurated = CURATED_CLAUDE_SKILLS.map((item) => {
    const haystack = [item.name, item.title, item.description, ...item.keywords].join(' ')
    const score = matchScoreForTokens(
      haystack,
      tokens,
      [item.name, ...item.keywords],
      rawQueryLower
    )
    return { item, score }
  })
    .filter((entry) => (tokens.length === 0 && !rawQueryLower) || entry.score > 0)
    .sort((a, b) => b.score - a.score)

  for (const { item } of scoredCurated) {
    seenUrls.add(item.url.toLowerCase())
    results.push({
      name: item.name,
      title: item.title,
      description: item.description,
      source: 'github',
      url: item.url,
      repo: item.repo,
      hasScripts: item.hasScripts,
      hasWorkflow: false,
      installed: existsSync(join(skillsRoot, item.name, 'SKILL.md'))
    })
  }

  // 2. 联网搜索 GitHub 公共仓库并探测其中的 SKILL.md
  if (rawQuery) {
    try {
      const englishTokens = tokens.filter((t) => /^[a-z0-9._-]+$/i.test(t))
      const mappedTerms: string[] = []
      for (const [pattern, enTerms] of ZH_TO_GITHUB_SEARCH_TERMS) {
        if (pattern.test(rawQueryLower)) mappedTerms.push(enTerms)
      }
      const searchTerms =
        englishTokens.length > 0
          ? englishTokens.join(' ')
          : mappedTerms.length > 0
            ? mappedTerms[0]
            : cleanedQuery || rawQuery
      const ghQuery = `${searchTerms} claude skill in:name,description,readme`
      const searchUrl = `https://api.github.com/search/repositories?q=${encodeURIComponent(ghQuery)}&sort=stars&order=desc&per_page=5`
      const resp = await fetchWithTimeout(searchUrl, true, 8_000)
      if (resp.ok) {
        const data = (await resp.json()) as {
          items?: Array<{
            full_name?: string
            html_url?: string
            description?: string | null
            stargazers_count?: number
          }>
        }
        const repos = (data.items ?? []).filter(
          (
            r
          ): r is {
            full_name: string
            html_url: string
            description?: string | null
            stargazers_count?: number
          } => typeof r?.full_name === 'string' && typeof r?.html_url === 'string'
        )

        // 并发探测前 4 个候选仓库中的 SKILL.md
        const topRepos = repos.slice(0, 4)
        await Promise.all(
          topRepos.map(async (repo) => {
            try {
              const inspected = await inspectGitHubSkillSource({
                url: repo.html_url,
                skillsRoot
              })
              if (!inspected.ok || !inspected.skills?.length || !inspected.source) return
              const { owner, repo: repoName, resolvedRef } = inspected.source
              const matchedSkills = inspected.skills.filter((s) =>
                tokens.length === 0
                  ? true
                  : matchScoreForTokens(
                      `${s.name} ${s.description}`,
                      tokens,
                      [s.name],
                      rawQueryLower
                    ) > 0
              )
              const chosen = (matchedSkills.length > 0 ? matchedSkills : inspected.skills).slice(
                0,
                4
              )
              for (const skill of chosen) {
                const installUrl = skill.repoSubpath
                  ? `https://github.com/${owner}/${repoName}/tree/${resolvedRef}/${skill.repoSubpath}`
                  : `https://github.com/${owner}/${repoName}`
                if (seenUrls.has(installUrl.toLowerCase())) continue
                seenUrls.add(installUrl.toLowerCase())
                results.push({
                  name: skill.name,
                  title: `${skill.name} (${owner}/${repoName})`,
                  description: skill.description || repo.description || 'GitHub Claude Code Skill',
                  source: 'github',
                  url: installUrl,
                  repo: `${owner}/${repoName}`,
                  ...(typeof repo.stargazers_count === 'number'
                    ? { stars: repo.stargazers_count }
                    : {}),
                  hasScripts: skill.hasScripts,
                  hasWorkflow: skill.hasWorkflow,
                  installed: skill.installed
                })
              }
            } catch {
              // 单个仓库探测失败不阻塞整体搜索
            }
          })
        )
      }
    } catch {
      // GitHub 搜索失败时仍返回精选匹配结果
    }
  }

  return {
    ok: true,
    query: rawQuery,
    items: results.slice(0, limit)
  }
}
