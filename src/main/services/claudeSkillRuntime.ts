import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  interpolateClaudeSkillPrompt,
  matchesAllowedTool,
  parseClaudeSkillMarkdown,
  parseSlashSkillCommand,
  replaceDynamicContextCommands,
  type ClaudeSkillFrontmatter,
  type ClaudeSkillHookMatcher,
  type ClaudeSkillHooks
} from '@shared/claudeSkill'
import { dshSkillsDir } from './dshPaths'

/** 历史版本生成的内置节点快照清单文件名（升级后自动清理） */
const LEGACY_DSH_SKILLS_MANIFEST = '.aiart-skill-manifest.json'

export interface InstalledClaudeSkillEntry {
  /** 技能唯一标识（kebab-case） */
  name: string
  /** 技能所在目录（目录型技能为 `<root>/<name>`，单文件技能为 `<root>`） */
  dirPath: string
  /** SKILL.md 或 <name>.md 的绝对路径 */
  skillFilePath: string
  /** 来源作用域：market/personal ($DSH_HOME/skills) 或 project (.claude/skills, .agents/skills) */
  scope: 'personal' | 'project'
  /** 存储形态：bundle（目录型 `<name>/SKILL.md`）或 file（单文件 `<name>.md`） */
  layout: 'bundle' | 'file'
  /** 解析后的完整 Claude Code frontmatter */
  frontmatter: ClaudeSkillFrontmatter
  /** Markdown 正文（不含 frontmatter） */
  body: string
  /** 是否包含 scripts/ 目录或可执行脚本 */
  hasScripts: boolean
  /** 技能目录内是否附带 workflow.json（可一键新建画布工作流） */
  hasWorkflow: boolean
  /** 除 SKILL.md 外的附属文件数量 */
  extraFileCount: number
  /** 附属文件相对路径列表（如 references/api.md, scripts/run.py） */
  extraFiles: string[]
}

export interface ActiveSkillTurnContext {
  skillName: string
  skillDir: string
  allowedTools: string[]
  hooks?: ClaudeSkillHooks
  modelOverride?: string
  contextMode: 'inline' | 'fork'
  agent?: string
  isolatedSessionId?: string
}

export interface PreprocessSkillInvocationResult {
  matched: boolean
  /** 展开后的最终任务提示词（未命中斜杠技能时为原 taskText） */
  taskText: string
  /** 命中的技能运行时上下文（供本轮模型覆盖、allowed-tools 自动放行、Hooks 与 fork 会话使用） */
  activeSkill?: ActiveSkillTurnContext
}

/**
 * 清理旧版本写入 `$DSH_HOME/skills` 的 40+ 内置节点 `.md` 快照文件。
 * 仅删除 `.aiart-skill-manifest.json` 中记录的旧自动生成文件及清单自身，绝不触碰用户或市场安装的技能。
 */
export function cleanupLegacyDshSkills(skillsDir = dshSkillsDir()): void {
  try {
    if (!existsSync(skillsDir)) return
    const manifestPath = join(skillsDir, LEGACY_DSH_SKILLS_MANIFEST)
    if (!existsSync(manifestPath)) return
    const raw = JSON.parse(readFileSync(manifestPath, 'utf8') || '[]') as
      string[] | { files?: unknown }
    const previous = Array.isArray(raw)
      ? raw
      : Array.isArray(raw?.files)
        ? (raw.files as string[])
        : []
    for (const file of previous) {
      if (
        typeof file !== 'string' ||
        !file.endsWith('.md') ||
        file.includes('/') ||
        file.includes('\\')
      ) {
        continue
      }
      const target = join(skillsDir, file)
      if (existsSync(target)) {
        rmSync(target, { force: true })
      }
    }
    rmSync(manifestPath, { force: true })
  } catch (error) {
    console.warn('[aiart] cleanupLegacyDshSkills failed:', error)
  }
}

/**
 * 递归统计技能包目录内的附属文件（不含 SKILL.md 自身）。
 */
function scanSkillBundleExtraFiles(
  bundleDir: string,
  relPrefix = ''
): {
  hasScripts: boolean
  hasWorkflow: boolean
  extraFiles: string[]
} {
  let hasScripts = false
  let hasWorkflow = false
  const extraFiles: string[] = []

  let entries
  try {
    entries = readdirSync(bundleDir, { withFileTypes: true })
  } catch {
    return { hasScripts, hasWorkflow, extraFiles }
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name
    if (!relPrefix && entry.name === 'SKILL.md') continue
    if (!relPrefix && entry.name === 'workflow.json') {
      hasWorkflow = true
    }
    if (entry.isDirectory()) {
      if (!relPrefix && entry.name === 'scripts') {
        hasScripts = true
      }
      const sub = scanSkillBundleExtraFiles(join(bundleDir, entry.name), relPath)
      if (sub.hasScripts) hasScripts = true
      extraFiles.push(...sub.extraFiles)
    } else if (entry.isFile()) {
      if (relPrefix.startsWith('scripts/') || relPrefix === 'scripts') {
        hasScripts = true
      }
      extraFiles.push(relPath)
    }
  }
  return { hasScripts, hasWorkflow, extraFiles }
}

/**
 * 扫描单个技能根目录（如 `$DSH_HOME/skills` 或 `<workspace>/.claude/skills`）。
 */
function scanSkillRoot(
  rootDir: string,
  scope: 'personal' | 'project',
  seenNames: Set<string>
): InstalledClaudeSkillEntry[] {
  if (!existsSync(rootDir)) return []
  const results: InstalledClaudeSkillEntry[] = []

  let entries
  try {
    entries = readdirSync(rootDir, { withFileTypes: true })
  } catch {
    return []
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue

    if (entry.isDirectory()) {
      const bundleDir = join(rootDir, entry.name)
      const skillMdPath = join(bundleDir, 'SKILL.md')
      if (!existsSync(skillMdPath)) continue
      try {
        const raw = readFileSync(skillMdPath, 'utf8')
        const parsed = parseClaudeSkillMarkdown(raw, entry.name)
        const name = parsed.frontmatter.name
        if (seenNames.has(name)) continue
        seenNames.add(name)
        const extras = scanSkillBundleExtraFiles(bundleDir)
        results.push({
          name,
          dirPath: bundleDir,
          skillFilePath: skillMdPath,
          scope,
          layout: 'bundle',
          frontmatter: parsed.frontmatter,
          body: parsed.body,
          hasScripts: extras.hasScripts,
          hasWorkflow: extras.hasWorkflow,
          extraFileCount: extras.extraFiles.length,
          extraFiles: extras.extraFiles
        })
      } catch {
        // 单个损坏技能包不阻塞整体扫描
      }
      continue
    }

    if (entry.isFile() && entry.name.endsWith('.md')) {
      const filePath = join(rootDir, entry.name)
      const stem = entry.name.replace(/\.md$/i, '')
      try {
        const raw = readFileSync(filePath, 'utf8')
        const parsed = parseClaudeSkillMarkdown(raw, stem)
        const name = parsed.frontmatter.name
        if (seenNames.has(name)) continue
        seenNames.add(name)
        results.push({
          name,
          dirPath: rootDir,
          skillFilePath: filePath,
          scope,
          layout: 'file',
          frontmatter: parsed.frontmatter,
          body: parsed.body,
          hasScripts: false,
          hasWorkflow: false,
          extraFileCount: 0,
          extraFiles: []
        })
      } catch {
        // ignore
      }
    }
  }

  return results
}

/**
 * 发现当前可用的全部 Claude Code / dsh 技能：
 * 优先级遵循 Claude Code 规范：工程级（`.claude/skills`、`.agents/skills`） > 个人/市场级（`$DSH_HOME/skills`）。
 */
export function discoverInstalledClaudeSkills(options?: {
  personalSkillsDir?: string
  workspaceRoot?: string
}): InstalledClaudeSkillEntry[] {
  const personalDir = options?.personalSkillsDir ?? dshSkillsDir()
  cleanupLegacyDshSkills(personalDir)

  const seenNames = new Set<string>()
  const all: InstalledClaudeSkillEntry[] = []

  const workspace = options?.workspaceRoot?.trim()
  if (workspace && existsSync(workspace)) {
    try {
      if (statSync(workspace).isDirectory()) {
        all.push(...scanSkillRoot(join(workspace, '.claude', 'skills'), 'project', seenNames))
        all.push(...scanSkillRoot(join(workspace, '.agents', 'skills'), 'project', seenNames))
      }
    } catch {
      // ignore
    }
  }

  all.push(...scanSkillRoot(personalDir, 'personal', seenNames))
  return all.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * 执行技能中的 `!`command`` 动态上下文预处理命令。
 */
function executeDynamicContextCommands(
  commands: readonly string[],
  envVars: { skillDir: string; workspaceRoot: string; sessionId: string }
): Map<string, string> {
  const outputs = new Map<string, string>()
  const shellCmd = process.platform === 'win32' ? 'powershell.exe' : 'sh'
  const buildArgs = (cmd: string): string[] =>
    process.platform === 'win32' ? ['-NoProfile', '-NonInteractive', '-Command', cmd] : ['-c', cmd]

  for (const cmd of commands) {
    try {
      const res = spawnSync(shellCmd, buildArgs(cmd), {
        cwd:
          envVars.workspaceRoot && existsSync(envVars.workspaceRoot)
            ? envVars.workspaceRoot
            : envVars.skillDir,
        encoding: 'utf8',
        timeout: 15_000,
        windowsHide: true,
        env: {
          ...process.env,
          CLAUDE_SKILL_DIR: envVars.skillDir,
          SKILL_DIR: envVars.skillDir,
          WORKSPACE_ROOT: envVars.workspaceRoot,
          CLAUDE_SESSION_ID: envVars.sessionId
        }
      })
      const stdout = (res.stdout ?? '').trim()
      const stderr = (res.stderr ?? '').trim()
      if (res.status === 0) {
        outputs.set(cmd, stdout || '(empty output)')
      } else {
        outputs.set(cmd, stdout || stderr || `(command exited with code ${res.status ?? -1})`)
      }
    } catch (error) {
      outputs.set(
        cmd,
        `(command failed: ${error instanceof Error ? error.message : String(error)})`
      )
    }
  }
  return outputs
}

/**
 * 预处理用户输入的 `/skill-name [args...]` 调用：
 * - 查找已安装技能（支持个人级 `$DSH_HOME/skills` 与工程级 `.claude/skills`）
 * - 执行参数插值（`$ARGUMENTS`、`$ARGUMENTS[n]`、`$0..$9`、`${CLAUDE_SKILL_DIR}` 等）
 * - 执行动态上下文注入（`!`command``）
 * - 构建 `context: fork` 子代理指令与独立会话 ID
 * - 返回 `allowedTools`、`modelOverride`、`hooks` 供本轮对话生命周期使用
 */
export function preprocessSkillInvocation(options: {
  taskText: string
  sessionId?: string
  workspaceRoot?: string
  personalSkillsDir?: string
  enableDynamicCommands?: boolean
}): PreprocessSkillInvocationResult {
  const slash = parseSlashSkillCommand(options.taskText)
  if (!slash) {
    return { matched: false, taskText: options.taskText }
  }

  const skills = discoverInstalledClaudeSkills({
    personalSkillsDir: options.personalSkillsDir,
    workspaceRoot: options.workspaceRoot
  })
  const matchedSkill = skills.find(
    (s) =>
      s.name.toLowerCase() === slash.skillName.toLowerCase() &&
      s.frontmatter.userInvocable !== false
  )
  if (!matchedSkill) {
    return { matched: false, taskText: options.taskText }
  }

  const sessionId = options.sessionId?.trim() || ''
  const workspaceRoot = options.workspaceRoot?.trim() || ''

  // 1. 变量与位置参数插值
  let expandedBody = interpolateClaudeSkillPrompt(matchedSkill.body, {
    rawArgs: slash.rawArgs,
    skillDir: matchedSkill.dirPath,
    sessionId,
    workspaceRoot
  })

  // 2. 动态上下文命令 !`cmd` 注入
  if (options.enableDynamicCommands !== false) {
    const parsedAfterInterp = parseClaudeSkillMarkdown(expandedBody, matchedSkill.name)
    if (parsedAfterInterp.dynamicCommands.length > 0) {
      const outputs = executeDynamicContextCommands(parsedAfterInterp.dynamicCommands, {
        skillDir: matchedSkill.dirPath,
        workspaceRoot,
        sessionId
      })
      expandedBody = replaceDynamicContextCommands(expandedBody, outputs)
    }
  }

  // 3. 组装技能指令头（告知 Agent 技能根目录，便于按相对路径读取 references/ 或执行 scripts/）
  const headerLines = [
    `[Claude Code Skill Active: /${matchedSkill.name}]`,
    `Skill Directory: ${matchedSkill.dirPath.replace(/\\/g, '/')}`
  ]
  if (matchedSkill.frontmatter.context === 'fork') {
    const agentType = matchedSkill.frontmatter.agent || 'general-purpose'
    headerLines.push(
      `Execution Context: fork (isolated subagent role: ${agentType})`,
      agentType.toLowerCase() === 'explore'
        ? 'Subagent Constraint: Read-only exploration mode. Focus on analyzing files and answering thoroughly without modifying project files.'
        : agentType.toLowerCase() === 'plan'
          ? 'Subagent Constraint: Architecture & planning mode. Produce a structured implementation or creative plan.'
          : 'Subagent Constraint: Execute this skill self-containedly and return the complete result.'
    )
  }

  const finalTaskText = `${headerLines.join('\n')}\n\n${expandedBody.trim()}`
  const isolatedSessionId =
    matchedSkill.frontmatter.context === 'fork'
      ? `fork-${matchedSkill.name}-${Date.now()}`
      : undefined

  return {
    matched: true,
    taskText: finalTaskText,
    activeSkill: {
      skillName: matchedSkill.name,
      skillDir: matchedSkill.dirPath,
      allowedTools: matchedSkill.frontmatter.allowedTools,
      hooks: matchedSkill.frontmatter.hooks,
      modelOverride: matchedSkill.frontmatter.model,
      contextMode: matchedSkill.frontmatter.context,
      agent: matchedSkill.frontmatter.agent,
      ...(isolatedSessionId ? { isolatedSessionId } : {})
    }
  }
}

/**
 * 检查当前激活技能的 `allowed-tools` 是否自动放行该工具调用。
 */
export function shouldAutoApproveSkillTool(
  activeSkill: ActiveSkillTurnContext | null | undefined,
  toolName: string,
  detail?: string
): boolean {
  if (!activeSkill || !activeSkill.allowedTools.length) return false
  return matchesAllowedTool(activeSkill.allowedTools, toolName, detail)
}

/**
 * 运行技能生命周期绑定的 Hooks（PreToolUse / PostToolUse / Stop）。
 */
export function runSkillLifecycleHooks(
  activeSkill: ActiveSkillTurnContext | null | undefined,
  event: keyof ClaudeSkillHooks,
  context: {
    toolName?: string
    toolArgs?: string
    workspaceRoot?: string
  }
): void {
  const matchers: ClaudeSkillHookMatcher[] | undefined = activeSkill?.hooks?.[event]
  if (!matchers || matchers.length === 0) return

  const toolName = context.toolName ?? ''
  const shellCmd = process.platform === 'win32' ? 'powershell.exe' : 'sh'
  const buildArgs = (cmd: string): string[] =>
    process.platform === 'win32' ? ['-NoProfile', '-NonInteractive', '-Command', cmd] : ['-c', cmd]

  for (const matcher of matchers) {
    if (matcher.matcher && matcher.matcher !== '*' && toolName) {
      try {
        const re = new RegExp(`^(?:${matcher.matcher})$`, 'i')
        if (!re.test(toolName)) continue
      } catch {
        if (matcher.matcher.toLowerCase() !== toolName.toLowerCase()) continue
      }
    }
    for (const hook of matcher.hooks) {
      if (hook.type !== 'command' || !hook.command.trim()) continue
      try {
        spawnSync(shellCmd, buildArgs(hook.command), {
          cwd:
            context.workspaceRoot && existsSync(context.workspaceRoot)
              ? context.workspaceRoot
              : activeSkill?.skillDir,
          timeout: (hook.timeout ?? 10) * 1000,
          windowsHide: true,
          env: {
            ...process.env,
            CLAUDE_SKILL_DIR: activeSkill?.skillDir ?? '',
            SKILL_DIR: activeSkill?.skillDir ?? '',
            CLAUDE_TOOL_NAME: toolName,
            CLAUDE_TOOL_ARGS: context.toolArgs ?? ''
          }
        })
      } catch (error) {
        console.warn(`[aiart] skill hook (${event}) failed:`, error)
      }
    }
  }
}
