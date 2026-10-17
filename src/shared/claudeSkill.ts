/**
 * Claude Code 技能规范（Agent Skills Spec）完整解析、归一化、变量插值、
 * 动态上下文注入（!`command`）、工具白名单（allowed-tools）、Hooks 与 GitHub 源解析。
 *
 * 设计目标：
 * 1. 完整支持 Claude Code Skill 的全部 frontmatter 属性与运行时特性：
 *    - name, description, argument-hint, disable-model-invocation, user-invocable,
 *      allowed-tools, model, context (inline | fork), agent, hooks (PreToolUse / PostToolUse / Stop),
 *      when_to_use / whenToUse, version, license, author, metadata
 *    - 参数与环境变量插值：$ARGUMENTS, $ARGUMENTS[n], $0..$9, ${CLAUDE_SKILL_DIR}, ${SKILL_DIR},
 *      ${CLAUDE_SESSION_ID}, ${WORKSPACE_ROOT}
 *    - 动态上下文注入：!`command` 预处理命令提取与替换
 * 2. 与 @deepseek-ai/dsh-skill-filesystem 100% 兼容：
 *    落盘到 $DSH_HOME/skills/<name>/SKILL.md 时自动补齐缺省 name / description，
 *    并将驼峰调用开关转换为 kebab-case（disable-model-invocation / user-invocable）。
 */

export type ClaudeSkillContextMode = 'inline' | 'fork'

export interface ClaudeSkillHookCommand {
  type: 'command'
  command: string
  timeout?: number
}

export interface ClaudeSkillHookMatcher {
  /** 工具名匹配模式（如 "Bash"、"Edit|Write"、"*"）；省略表示匹配全部 */
  matcher?: string
  hooks: ClaudeSkillHookCommand[]
}

export interface ClaudeSkillHooks {
  PreToolUse?: ClaudeSkillHookMatcher[]
  PostToolUse?: ClaudeSkillHookMatcher[]
  Stop?: ClaudeSkillHookMatcher[]
}

export interface ClaudeSkillFrontmatter {
  /** 技能唯一标识（小写字母、数字、连字符，最长 64 字符） */
  name: string
  /** 技能用途与触发时机描述（省略时取正文首段） */
  description: string
  /** 斜杠命令自动补全时的参数提示，如 "[issue-number]" 或 "[filename] [format]" */
  argumentHint?: string
  /** true 时禁止模型自动调用，仅允许用户通过 /name 显式触发（默认 false） */
  disableModelInvocation: boolean
  /** false 时从 / 菜单隐藏，仅允许模型自动触发（默认 true） */
  userInvocable: boolean
  /** 技能激活期间无需审批即可调用的工具白名单（如 ["Read", "Grep", "Bash(git *)"]） */
  allowedTools: string[]
  /** 技能激活时覆盖使用的模型 ID */
  model?: string
  /** 执行上下文模式：inline（主对话内联）或 fork（独立子代理隔离执行） */
  context: ClaudeSkillContextMode
  /** context: fork 时的子代理类型（如 Explore / Plan / general-purpose） */
  agent?: string
  /** 技能生命周期内绑定的 Hooks */
  hooks?: ClaudeSkillHooks
  /** 补充触发场景说明 */
  whenToUse?: string
  /** 版本号 */
  version?: string
  /** 许可证 */
  license?: string
  /** 作者信息 */
  author?: string
  /** 扩展键值元数据 */
  metadata?: Record<string, string>
}

export interface ParsedClaudeSkill {
  frontmatter: ClaudeSkillFrontmatter
  /** 去除 YAML frontmatter 后的 Markdown 正文 */
  body: string
  /** 原始完整文本 */
  raw: string
  /** 正文中包含的 !`command` 动态上下文命令列表 */
  dynamicCommands: string[]
}

export interface ClaudeSkillInterpolationVars {
  /** 用户在 `/skill-name <rawArgs>` 中传入的原始参数串 */
  rawArgs?: string
  /** 技能所在目录绝对路径（映射为 ${CLAUDE_SKILL_DIR} 与 ${SKILL_DIR}） */
  skillDir?: string
  /** 当前会话 ID（映射为 ${CLAUDE_SESSION_ID}） */
  sessionId?: string
  /** 当前工程根目录（映射为 ${WORKSPACE_ROOT}） */
  workspaceRoot?: string
}

export interface SlashSkillCommandMatch {
  skillName: string
  rawArgs: string
  argv: string[]
}

export interface GitHubSkillSourceRef {
  owner: string
  repo: string
  /** 分支 / tag / commit；未指定时为 undefined（由调用方查询默认分支或按 main/master 探测） */
  ref?: string
  /** 仓库内相对子路径（不含首尾 `/`；指向技能目录或仓库子目录） */
  subpath: string
  /** 规范化后的源显示地址 */
  canonicalUrl: string
}

const VALID_SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * 将任意字符串规整为合法的 Claude Code / dsh 技能名（kebab-case，最长 64 字符）。
 */
export function sanitizeClaudeSkillName(raw: string, fallback = 'custom-skill'): string {
  const cleaned = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64)
    .replace(/-$/g, '')
  if (cleaned && VALID_SKILL_NAME_RE.test(cleaned)) return cleaned
  return fallback
}

export function isValidClaudeSkillName(name: string): boolean {
  return (
    typeof name === 'string' &&
    name.length >= 1 &&
    name.length <= 64 &&
    VALID_SKILL_NAME_RE.test(name)
  )
}

/**
 * 从 Markdown 正文中提取第一段非标题文本，作为省略 description 时的默认描述（遵循 Claude Code 规范）。
 */
export function extractFirstParagraphDescription(
  body: string,
  fallback = 'Claude Code Skill'
): string {
  const lines = String(body ?? '')
    .replace(/\r\n/g, '\n')
    .split('\n')
  const paragraphLines: string[] = []
  let inFence = false

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (line.startsWith('```')) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    if (!line) {
      if (paragraphLines.length > 0) break
      continue
    }
    if (line.startsWith('#')) {
      continue
    }
    paragraphLines.push(line)
  }

  const joined = paragraphLines.join(' ').replace(/\s+/g, ' ').trim()
  if (joined) return joined.slice(0, 280)

  // 若没有普通段落，退回首个标题文本
  for (const rawLine of lines) {
    const m = /^#+\s+(.+)$/.exec(rawLine.trim())
    if (m?.[1]?.trim()) return m[1].trim().slice(0, 280)
  }
  return fallback
}

/**
 * 解析 allowed-tools 字段（支持逗号分隔字符串、空白分隔字符串或字符串数组）。
 * 注意保留括号内的空格，如 `Bash(git *)`, `Bash(npm run *)`。
 */
export function parseAllowedTools(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw
      .flatMap((item) => (typeof item === 'string' ? splitAllowedToolsString(item) : []))
      .filter(Boolean)
  }
  if (typeof raw === 'string') {
    return splitAllowedToolsString(raw)
  }
  return []
}

function splitAllowedToolsString(input: string): string[] {
  const result: string[] = []
  let current = ''
  let depth = 0
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    if (ch === '(') {
      depth++
      current += ch
    } else if (ch === ')') {
      depth = Math.max(0, depth - 1)
      current += ch
    } else if (depth === 0 && (ch === ',' || ch === '\n')) {
      const trimmed = current.trim()
      if (trimmed) result.push(trimmed)
      current = ''
    } else if (depth === 0 && /\s/.test(ch)) {
      const trimmed = current.trim()
      if (trimmed) result.push(trimmed)
      current = ''
    } else {
      current += ch
    }
  }
  const tail = current.trim()
  if (tail) result.push(tail)
  return result
}

/**
 * 轻量但完备的 Frontmatter + YAML 解析器（无需在渲染层引入 Node 专属依赖，同时支持嵌套列表/对象）。
 */
function splitFrontmatterBlock(rawContent: string): { yamlBlock: string | null; body: string } {
  const normalized = String(rawContent ?? '').replace(/\r\n/g, '\n')
  if (!normalized.startsWith('---\n') && normalized !== '---') {
    return { yamlBlock: null, body: normalized }
  }
  const match = /^---\n([\s\S]*?)\n---(?:\n([\s\S]*))?$/.exec(normalized)
  if (!match) {
    return { yamlBlock: null, body: normalized }
  }
  return {
    yamlBlock: match[1] ?? '',
    body: (match[2] ?? '').trim()
  }
}

function unquoteYamlScalar(raw: string): string {
  const trimmed = raw.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function parseYamlBoolean(raw: unknown, defaultValue: boolean): boolean {
  if (typeof raw === 'boolean') return raw
  if (typeof raw === 'string') {
    const lower = raw.trim().toLowerCase()
    if (lower === 'true' || lower === 'yes') return true
    if (lower === 'false' || lower === 'no') return false
  }
  return defaultValue
}

/**
 * 解析 YAML frontmatter 文本为键值记录（支持标量、多行块 `|`/`>`、行内数组 `[a, b]`、缩进列表 `- item`、
 * 以及 hooks / metadata 等嵌套结构）。
 */
export function parseSimpleFrontmatterMap(yamlText: string): Record<string, unknown> {
  const lines = yamlText.replace(/\r\n/g, '\n').split('\n')
  const result: Record<string, unknown> = {}
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      i++
      continue
    }
    const topMatch = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line)
    if (!topMatch) {
      i++
      continue
    }
    const key = topMatch[1]
    const rest = topMatch[2].trim()

    // 多行块标量 | 或 >
    if (rest === '|' || rest === '>' || rest === '|-' || rest === '>-') {
      const fold = rest.startsWith('>')
      const blockLines: string[] = []
      i++
      let baseIndent: number | null = null
      while (i < lines.length) {
        const nextLine = lines[i]
        if (nextLine.trim() === '') {
          blockLines.push('')
          i++
          continue
        }
        const indentMatch = /^(\s+)/.exec(nextLine)
        if (!indentMatch) break
        const indent = indentMatch[1].length
        if (baseIndent === null) baseIndent = indent
        if (indent < baseIndent) break
        blockLines.push(nextLine.slice(baseIndent))
        i++
      }
      result[key] = fold
        ? blockLines.join(' ').replace(/\s+/g, ' ').trim()
        : blockLines.join('\n').trim()
      continue
    }

    // 行内数组 [a, b, c]
    if (rest.startsWith('[') && rest.endsWith(']')) {
      const inner = rest.slice(1, -1).trim()
      result[key] = inner
        ? inner
            .split(',')
            .map((s) => unquoteYamlScalar(s))
            .filter(Boolean)
        : []
      i++
      continue
    }

    // 下一行是缩进块（列表或嵌套对象）
    if (!rest) {
      i++
      const nestedLines: string[] = []
      while (i < lines.length) {
        const nextLine = lines[i]
        if (nextLine.trim() === '' || nextLine.trim().startsWith('#')) {
          nestedLines.push(nextLine)
          i++
          continue
        }
        if (!/^\s+/.test(nextLine)) break
        nestedLines.push(nextLine)
        i++
      }
      const nonEmpty = nestedLines.filter((l) => l.trim() && !l.trim().startsWith('#'))
      if (nonEmpty.length === 0) {
        result[key] = ''
      } else if (nonEmpty[0].trim().startsWith('-')) {
        // 简单列表
        const listItems: string[] = []
        for (const nl of nonEmpty) {
          const m = /^\s*-\s*(.+)$/.exec(nl)
          if (m?.[1]) listItems.push(unquoteYamlScalar(m[1]))
        }
        result[key] = listItems
      } else if (key === 'hooks') {
        result[key] = parseHooksYamlBlock(nestedLines)
      } else {
        // 简单子键值映射（如 metadata / author）
        const subMap: Record<string, string> = {}
        for (const nl of nonEmpty) {
          const m = /^\s+([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(nl)
          if (m) {
            subMap[m[1]] = unquoteYamlScalar(m[2])
          }
        }
        result[key] = subMap
      }
      continue
    }

    // 普通单行标量
    const scalar = unquoteYamlScalar(rest)
    if (scalar === 'true') result[key] = true
    else if (scalar === 'false') result[key] = false
    else result[key] = scalar
    i++
  }

  return result
}

function parseHooksYamlBlock(lines: string[]): ClaudeSkillHooks {
  const hooks: ClaudeSkillHooks = {}
  let currentEvent: keyof ClaudeSkillHooks | null = null
  let currentMatcher: ClaudeSkillHookMatcher | null = null

  for (const rawLine of lines) {
    const trimmed = rawLine.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const eventMatch = /^\s{2,4}(PreToolUse|PostToolUse|Stop)\s*:\s*$/.exec(rawLine)
    if (eventMatch) {
      currentEvent = eventMatch[1] as keyof ClaudeSkillHooks
      hooks[currentEvent] = hooks[currentEvent] ?? []
      currentMatcher = null
      continue
    }
    if (!currentEvent) continue

    const matcherMatch = /^\s*-\s*matcher\s*:\s*(.+)$/.exec(rawLine)
    if (matcherMatch) {
      currentMatcher = {
        matcher: unquoteYamlScalar(matcherMatch[1]),
        hooks: []
      }
      hooks[currentEvent]!.push(currentMatcher)
      continue
    }

    const commandMatch = /^\s*-?\s*command\s*:\s*(.+)$/.exec(rawLine)
    if (commandMatch) {
      if (!currentMatcher) {
        currentMatcher = { hooks: [] }
        hooks[currentEvent]!.push(currentMatcher)
      }
      currentMatcher.hooks.push({
        type: 'command',
        command: unquoteYamlScalar(commandMatch[1])
      })
    }
  }
  return hooks
}

/**
 * 提取正文中的动态上下文注入命令：!`command`
 * （跳过 ``` 围栏代码块内部的内容，避免把示例代码误当成预处理命令）。
 */
export function extractDynamicContextCommands(markdownBody: string): string[] {
  const commands: string[] = []
  const lines = String(markdownBody ?? '')
    .replace(/\r\n/g, '\n')
    .split('\n')
  let inFence = false

  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const re = /!\x60([^\x60\n]+)\x60/g
    let match: RegExpExecArray | null
    while ((match = re.exec(line)) !== null) {
      const cmd = match[1].trim()
      if (cmd && !commands.includes(cmd)) {
        commands.push(cmd)
      }
    }
  }
  return commands
}

/**
 * 将正文中的 !`command` 替换为命令的实际输出。
 */
export function replaceDynamicContextCommands(
  markdownBody: string,
  outputsByCommand:
    ReadonlyMap<string, string> | Record<string, string> | ((cmd: string) => string | undefined)
): string {
  const lookup = (cmd: string): string | undefined => {
    if (typeof outputsByCommand === 'function') return outputsByCommand(cmd)
    return outputsByCommand instanceof Map ? outputsByCommand.get(cmd) : outputsByCommand[cmd]
  }

  const lines = String(markdownBody ?? '')
    .replace(/\r\n/g, '\n')
    .split('\n')
  let inFence = false
  const outLines = lines.map((line) => {
    if (line.trim().startsWith('```')) {
      inFence = !inFence
      return line
    }
    if (inFence) return line
    return line.replace(/!\x60([^\x60\n]+)\x60/g, (full, rawCmd: string) => {
      const cmd = rawCmd.trim()
      const replaced = lookup(cmd)
      return replaced !== undefined ? replaced : full
    })
  })
  return outLines.join('\n')
}

/**
 * 解析完整 Claude Code SKILL.md 内容。
 */
export function parseClaudeSkillMarkdown(
  rawContent: string,
  fallbackName = 'custom-skill'
): ParsedClaudeSkill {
  const { yamlBlock, body } = splitFrontmatterBlock(rawContent)
  const rawMap = yamlBlock ? parseSimpleFrontmatterMap(yamlBlock) : {}

  const rawName = typeof rawMap.name === 'string' ? rawMap.name : fallbackName
  const name = sanitizeClaudeSkillName(rawName, sanitizeClaudeSkillName(fallbackName))

  const rawDescription = typeof rawMap.description === 'string' ? rawMap.description.trim() : ''
  const description = rawDescription || extractFirstParagraphDescription(body, name)

  const argumentHintRaw = rawMap['argument-hint'] ?? rawMap.argumentHint
  const argumentHint =
    typeof argumentHintRaw === 'string' && argumentHintRaw.trim()
      ? argumentHintRaw.trim()
      : undefined

  // 支持 disable-model-invocation / disableModelInvocation / modelInvocable
  let disableModelInvocation = false
  if (rawMap['disable-model-invocation'] !== undefined) {
    disableModelInvocation = parseYamlBoolean(rawMap['disable-model-invocation'], false)
  } else if (rawMap.disableModelInvocation !== undefined) {
    disableModelInvocation = parseYamlBoolean(rawMap.disableModelInvocation, false)
  } else if (rawMap.modelInvocable !== undefined) {
    disableModelInvocation = !parseYamlBoolean(rawMap.modelInvocable, true)
  }

  let userInvocable = true
  if (rawMap['user-invocable'] !== undefined) {
    userInvocable = parseYamlBoolean(rawMap['user-invocable'], true)
  } else if (rawMap.userInvocable !== undefined) {
    userInvocable = parseYamlBoolean(rawMap.userInvocable, true)
  }

  const allowedTools = parseAllowedTools(rawMap['allowed-tools'] ?? rawMap.allowedTools)

  const model =
    typeof rawMap.model === 'string' && rawMap.model.trim() ? rawMap.model.trim() : undefined

  const rawContext = typeof rawMap.context === 'string' ? rawMap.context.trim().toLowerCase() : ''
  const context: ClaudeSkillContextMode = rawContext === 'fork' ? 'fork' : 'inline'

  const agent =
    typeof rawMap.agent === 'string' && rawMap.agent.trim() ? rawMap.agent.trim() : undefined

  const whenRaw = rawMap.whenToUse ?? rawMap.when_to_use
  const whenToUse = typeof whenRaw === 'string' && whenRaw.trim() ? whenRaw.trim() : undefined

  const version =
    typeof rawMap.version === 'string' && rawMap.version.trim() ? rawMap.version.trim() : undefined

  const license =
    typeof rawMap.license === 'string' && rawMap.license.trim() ? rawMap.license.trim() : undefined

  let author: string | undefined
  if (typeof rawMap.author === 'string' && rawMap.author.trim()) {
    author = rawMap.author.trim()
  } else if (rawMap.author && typeof rawMap.author === 'object' && !Array.isArray(rawMap.author)) {
    const a = rawMap.author as Record<string, string>
    if (a.name) author = a.name
  }

  const hooks =
    rawMap.hooks && typeof rawMap.hooks === 'object' && !Array.isArray(rawMap.hooks)
      ? (rawMap.hooks as ClaudeSkillHooks)
      : undefined

  const metadata =
    rawMap.metadata && typeof rawMap.metadata === 'object' && !Array.isArray(rawMap.metadata)
      ? (rawMap.metadata as Record<string, string>)
      : undefined

  return {
    frontmatter: {
      name,
      description,
      ...(argumentHint ? { argumentHint } : {}),
      disableModelInvocation,
      userInvocable,
      allowedTools,
      ...(model ? { model } : {}),
      context,
      ...(agent ? { agent } : {}),
      ...(hooks ? { hooks } : {}),
      ...(whenToUse ? { whenToUse } : {}),
      ...(version ? { version } : {}),
      ...(license ? { license } : {}),
      ...(author ? { author } : {}),
      ...(metadata ? { metadata } : {})
    },
    body,
    raw: rawContent,
    dynamicCommands: extractDynamicContextCommands(body)
  }
}

function escapeYamlDoubleQuoted(value: string): string {
  return JSON.stringify(value.replace(/\r\n/g, '\n'))
}

/**
 * 将任意 Claude Code 技能或外部 SKILL.md 归一化为同时兼容
 * `@deepseek-ai/dsh-skill-filesystem` 与 `ClaudeSkillRuntime` 的标准 `SKILL.md` 文本。
 */
export function normalizeClaudeSkillMarkdown(
  rawContent: string,
  fallbackName = 'custom-skill'
): string {
  const parsed = parseClaudeSkillMarkdown(rawContent, fallbackName)
  const fm = parsed.frontmatter
  const yamlLines: string[] = [
    '---',
    `name: ${fm.name}`,
    `description: ${escapeYamlDoubleQuoted(fm.description)}`
  ]
  if (fm.argumentHint) {
    yamlLines.push(`argument-hint: ${escapeYamlDoubleQuoted(fm.argumentHint)}`)
  }
  if (fm.disableModelInvocation) {
    yamlLines.push('disable-model-invocation: true')
  }
  if (!fm.userInvocable) {
    yamlLines.push('user-invocable: false')
  }
  if (fm.allowedTools.length > 0) {
    yamlLines.push(`allowed-tools: ${escapeYamlDoubleQuoted(fm.allowedTools.join(', '))}`)
  }
  if (fm.model) {
    yamlLines.push(`model: ${escapeYamlDoubleQuoted(fm.model)}`)
  }
  if (fm.context === 'fork') {
    yamlLines.push('context: fork')
  }
  if (fm.agent) {
    yamlLines.push(`agent: ${escapeYamlDoubleQuoted(fm.agent)}`)
  }
  if (fm.whenToUse) {
    yamlLines.push(`whenToUse: ${escapeYamlDoubleQuoted(fm.whenToUse)}`)
  }
  if (fm.version) {
    yamlLines.push(`version: ${escapeYamlDoubleQuoted(fm.version)}`)
  }
  if (fm.license) {
    yamlLines.push(`license: ${escapeYamlDoubleQuoted(fm.license)}`)
  }
  if (fm.author) {
    yamlLines.push(`author: ${escapeYamlDoubleQuoted(fm.author)}`)
  }
  if (fm.hooks && Object.keys(fm.hooks).length > 0) {
    yamlLines.push('hooks:')
    for (const eventName of ['PreToolUse', 'PostToolUse', 'Stop'] as const) {
      const matchers = fm.hooks[eventName]
      if (!matchers?.length) continue
      yamlLines.push(`  ${eventName}:`)
      for (const m of matchers) {
        if (m.matcher) {
          yamlLines.push(`    - matcher: ${escapeYamlDoubleQuoted(m.matcher)}`)
          for (const h of m.hooks) {
            yamlLines.push(`      command: ${escapeYamlDoubleQuoted(h.command)}`)
          }
        } else {
          for (const h of m.hooks) {
            yamlLines.push(`    - command: ${escapeYamlDoubleQuoted(h.command)}`)
          }
        }
      }
    }
  }
  if (fm.metadata && Object.keys(fm.metadata).length > 0) {
    yamlLines.push('metadata:')
    for (const [k, v] of Object.entries(fm.metadata)) {
      if (typeof v === 'string') {
        yamlLines.push(`  ${k}: ${escapeYamlDoubleQuoted(v)}`)
      }
    }
  }
  yamlLines.push('---', '')
  return `${yamlLines.join('\n')}${parsed.body.trim()}\n`
}

/**
 * 将原始参数字符串拆分为位置参数数组（支持单引号与双引号包裹含空格的参数）。
 */
export function splitSkillArguments(rawArgs: string): string[] {
  const input = String(rawArgs ?? '').trim()
  if (!input) return []
  const args: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    if (quote) {
      if (ch === '\\' && i + 1 < input.length && input[i + 1] === quote) {
        current += quote
        i++
      } else if (ch === quote) {
        quote = null
      } else {
        current += ch
      }
    } else if (ch === '"' || ch === "'") {
      quote = ch
    } else if (/\s/.test(ch)) {
      if (current.length > 0) {
        args.push(current)
        current = ''
      }
    } else {
      current += ch
    }
  }
  if (current.length > 0) args.push(current)
  return args
}

/**
 * 对技能正文执行 Claude Code 规范的参数与环境变量插值：
 * - `$ARGUMENTS[n]` → 第 n 个位置参数（0-based）
 * - `$0` .. `$9` → 第 n 个位置参数简写
 * - `$ARGUMENTS` → 完整原始参数串
 * - `${CLAUDE_SKILL_DIR}` / `${SKILL_DIR}` → 技能目录绝对路径（统一正斜杠）
 * - `${CLAUDE_SESSION_ID}` → 当前会话 ID
 * - `${WORKSPACE_ROOT}` → 当前工程根目录
 * - 若原正文不含任何 `$ARGUMENTS` / `$0..$9` 占位符且 `rawArgs` 非空，
 *   按 Claude Code 规范在末尾追加 `\n\nARGUMENTS: <rawArgs>`。
 */
export function interpolateClaudeSkillPrompt(
  body: string,
  vars: ClaudeSkillInterpolationVars
): string {
  const rawArgs = String(vars.rawArgs ?? '').trim()
  const argv = splitSkillArguments(rawArgs)
  const skillDir = String(vars.skillDir ?? '').replace(/\\/g, '/')
  const sessionId = String(vars.sessionId ?? '')
  const workspaceRoot = String(vars.workspaceRoot ?? '').replace(/\\/g, '/')

  const hadArgumentPlaceholder = /\$ARGUMENTS(?:\[\d+\])?/.test(body) || /\$[0-9](?!\d)/.test(body)

  let output = body
    .replace(/\$\{CLAUDE_SKILL_DIR\}/g, skillDir)
    .replace(/\$\{SKILL_DIR\}/g, skillDir)
    .replace(/\$\{CLAUDE_SESSION_ID\}/g, sessionId)
    .replace(/\$\{WORKSPACE_ROOT\}/g, workspaceRoot)
    .replace(/\$ARGUMENTS\[(\d+)\]/g, (_m, idxStr: string) => {
      const idx = Number.parseInt(idxStr, 10)
      return argv[idx] ?? ''
    })
    .replace(/\$ARGUMENTS\b/g, rawArgs)
    .replace(/\$([0-9])(?!\d)/g, (_m, idxStr: string) => {
      const idx = Number.parseInt(idxStr, 10)
      return argv[idx] ?? ''
    })

  if (!hadArgumentPlaceholder && rawArgs) {
    output = `${output.trimEnd()}\n\nARGUMENTS: ${rawArgs}`
  }

  return output
}

/**
 * 解析用户输入开头的 `/skill-name [args...]` 斜杠命令。
 */
export function parseSlashSkillCommand(taskText: string): SlashSkillCommandMatch | null {
  const trimmed = String(taskText ?? '').trim()
  if (!trimmed.startsWith('/')) return null
  const match = /^\/([a-zA-Z0-9][a-zA-Z0-9_-]{0,63})(?:\s+([\s\S]*))?$/.exec(trimmed)
  if (!match) return null
  const skillName = match[1].toLowerCase()
  const rawArgs = (match[2] ?? '').trim()
  return {
    skillName,
    rawArgs,
    argv: splitSkillArguments(rawArgs)
  }
}

/**
 * Claude Code 工具名到 dsh / MCP 工具名的映射表。
 */
const CLAUDE_TOOL_ALIASES: Record<string, string[]> = {
  read: ['read', 'read_file', 'view_file', 'fs_read', 'cat'],
  write: ['write', 'write_file', 'write_to_file', 'fs_write'],
  edit: ['edit', 'edit_file', 'replace_file_content', 'multi_edit', 'str_replace'],
  glob: ['glob', 'find_by_name', 'list_dir', 'ls'],
  grep: ['grep', 'grep_search', 'search', 'ripgrep'],
  bash: ['bash', 'shell', 'sh', 'exec', 'run_command', 'command', 'terminal'],
  websearch: ['websearch', 'web_search', 'search_web'],
  webfetch: ['webfetch', 'web_fetch', 'read_url_content', 'fetch']
}

function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`, 'i')
}

/**
 * 判断某个正在请求审批的工具调用是否命中技能的 `allowed-tools` 白名单。
 *
 * 支持：
 * - `"Read"`, `"Edit"`, `"Bash"` 等 Claude Code 标准工具名及别名
 * - `"Bash(git *)"`, `"Bash(npm run *)"`, `"Bash(python *)"` 等带命令前缀/通配符的作用域规则
 * - `"mcp__*"` 等通配工具名
 */
export function matchesAllowedTool(
  allowedTools: readonly string[],
  toolName: string,
  commandOrDetail?: string
): boolean {
  if (!allowedTools || allowedTools.length === 0) return false
  const normalizedTool = String(toolName ?? '')
    .trim()
    .toLowerCase()
  if (!normalizedTool) return false

  for (const rawRule of allowedTools) {
    const rule = rawRule.trim()
    if (!rule) continue

    const scopedMatch = /^([A-Za-z0-9_*-]+)\((.+)\)$/.exec(rule)
    if (scopedMatch) {
      const ruleTool = scopedMatch[1].trim().toLowerCase()
      const argPattern = scopedMatch[2].trim()
      if (!toolNameMatchesRule(normalizedTool, ruleTool)) continue
      if (argPattern === '*') return true
      const detail = String(commandOrDetail ?? '').trim()
      if (!detail) continue
      // 提取 JSON 参数中的 command 字段或直接匹配字符串
      const candidates = [detail]
      try {
        const parsed = JSON.parse(detail) as Record<string, unknown>
        if (typeof parsed.command === 'string') candidates.push(parsed.command.trim())
        if (typeof parsed.cmd === 'string') candidates.push(parsed.cmd.trim())
      } catch {
        // detail 不是 JSON，直接按原文匹配
      }
      const re = wildcardToRegExp(argPattern.includes('*') ? argPattern : `${argPattern}*`)
      if (candidates.some((c) => re.test(c))) return true
      continue
    }

    if (toolNameMatchesRule(normalizedTool, rule.toLowerCase())) {
      return true
    }
  }
  return false
}

function toolNameMatchesRule(actualToolLower: string, ruleToolLower: string): boolean {
  if (ruleToolLower === '*') return true
  if (actualToolLower === ruleToolLower) return true
  const aliases = CLAUDE_TOOL_ALIASES[ruleToolLower]
  if (aliases && aliases.includes(actualToolLower)) return true
  if (ruleToolLower.includes('*')) {
    return wildcardToRegExp(ruleToolLower).test(actualToolLower)
  }
  return false
}

/**
 * 解析 GitHub 技能地址，支持：
 * 1. 仓库根地址：`https://github.com/owner/repo`
 * 2. 子目录地址：`https://github.com/owner/repo/tree/<ref>/<subpath>`
 * 3. 单文件地址：`https://github.com/owner/repo/blob/<ref>/<subpath>/SKILL.md`
 * 4. Raw 地址：`https://raw.githubusercontent.com/owner/repo/<ref>/<subpath>/SKILL.md`
 * 5. 简写：`owner/repo` 或 `owner/repo/path/to/skill#branch`
 */
export function parseGitHubSkillSourceUrl(input: string): GitHubSkillSourceRef | null {
  const raw = String(input ?? '').trim()
  if (!raw) return null

  // 1. raw.githubusercontent.com/<owner>/<repo>/<ref>/<path...>
  const rawGhMatch =
    /^https?:\/\/raw\.githubusercontent\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/([^/]+)(?:\/(.*))?$/i.exec(
      raw
    )
  if (rawGhMatch) {
    const owner = rawGhMatch[1]
    const repo = rawGhMatch[2].replace(/\.git$/i, '')
    const ref = decodeURIComponent(rawGhMatch[3])
    const subpath = cleanSkillSubpath(rawGhMatch[4] ?? '')
    if (!isValidGitHubIdent(owner) || !isValidGitHubIdent(repo) || subpath === null) return null
    return {
      owner,
      repo,
      ref,
      subpath,
      canonicalUrl: buildCanonicalGitHubUrl(owner, repo, ref, subpath)
    }
  }

  // 2. https://github.com/<owner>/<repo>[/tree|blob/<ref>/<subpath>]
  const ghUrlMatch =
    /^https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:\/(tree|blob)\/([^/#?]+)(?:\/([^#?]*))?)?\/?(?:#([^\s]+))?(?:\?.*)?$/i.exec(
      raw
    )
  if (ghUrlMatch) {
    const owner = ghUrlMatch[1]
    const repo = ghUrlMatch[2]
    const ref = ghUrlMatch[4]
      ? decodeURIComponent(ghUrlMatch[4])
      : ghUrlMatch[6]
        ? decodeURIComponent(ghUrlMatch[6])
        : undefined
    const subpath = cleanSkillSubpath(ghUrlMatch[5] ?? '')
    if (!isValidGitHubIdent(owner) || !isValidGitHubIdent(repo) || subpath === null) return null
    return {
      owner,
      repo,
      ...(ref ? { ref } : {}),
      subpath,
      canonicalUrl: buildCanonicalGitHubUrl(owner, repo, ref, subpath)
    }
  }

  // 3. 简写：owner/repo[/subpath][#ref]
  const shorthandMatch =
    /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\/([^#?]+))?(?:#([^\s]+))?$/.exec(raw)
  if (shorthandMatch && !raw.includes('://')) {
    const owner = shorthandMatch[1]
    const repo = shorthandMatch[2].replace(/\.git$/i, '')
    const subpath = cleanSkillSubpath(shorthandMatch[3] ?? '')
    const ref = shorthandMatch[4]?.trim() || undefined
    if (!isValidGitHubIdent(owner) || !isValidGitHubIdent(repo) || subpath === null) return null
    return {
      owner,
      repo,
      ...(ref ? { ref } : {}),
      subpath,
      canonicalUrl: buildCanonicalGitHubUrl(owner, repo, ref, subpath)
    }
  }

  return null
}

function isValidGitHubIdent(part: string): boolean {
  return Boolean(part && part !== '.' && part !== '..' && !part.includes('..'))
}

function cleanSkillSubpath(rawSubpath: string): string | null {
  const trimmed = rawSubpath
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .replace(/(?:^|\/)SKILL\.md$/i, '')
    .replace(/^\/+|\/+$/g, '')
  if (!trimmed) return ''
  const segments = trimmed.split('/').filter(Boolean)
  if (segments.some((s) => s === '.' || s === '..')) return null
  return segments.join('/')
}

function buildCanonicalGitHubUrl(
  owner: string,
  repo: string,
  ref: string | undefined,
  subpath: string
): string {
  const base = `https://github.com/${owner}/${repo}`
  if (!ref && !subpath) return base
  const branch = ref || 'main'
  return subpath ? `${base}/tree/${branch}/${subpath}` : `${base}/tree/${branch}`
}
