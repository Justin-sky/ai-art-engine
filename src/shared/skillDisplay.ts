/**
 * dsh 技能文件的**展示元数据**（纯逻辑，供主进程与市场卡片共用）。
 *
 * ## 为什么需要它
 *
 * 技能快照文件本身信息很全 —— 每个 `SKILL.md` 都有 frontmatter `description` 与正文，
 * 内置项在 `listGraphSkills()` 里还带着 `titleZh` / `titleEn` / `usageZh` 等。
 * 但界面只拿到 `fileName` + `kind` 两个字段，于是：
 *
 * - 卡片标题只能是 `system-image` 这种 **id 风格**的文件名主干（看着像节点）
 * - 展开详情对所有技能都是同一句通用提示（**详情全都一样**）
 *
 * 这里负责把「文件名 → 可展示的标题与描述」这段推导收成单一来源。
 *
 * ## 双语字段的取值口径
 *
 * 标题优先取中文（应用默认中文，`titleZh` 就是给人看的名字）；描述取
 * `${en} — ${zh}` 的形式，与 dsh 技能文件的 frontmatter 生成口径**完全一致**
 *（见 deepseekHarnessService.renderDshSkillMd），这样界面上看到的就是 Agent 看到的。
 */

/** 技能文件在界面上的展示信息 */
export interface SkillDisplayInfo {
  /** 展示标题；取不到时回落到文件名主干 */
  title: string
  /** 展示描述；取不到时留空（调用方不渲染这一行） */
  description?: string
}

/** 内置技能推导所需的最小字段（避免把整套 GraphSkill 拉进来） */
export interface BuiltinSkillLike {
  id: string
  titleZh: string
  titleEn: string
}

/**
 * GraphSkill id → dsh 技能文件名主干（kebab-case）。
 *
 * 与主进程 `toDshSkillName` 必须同一口径 —— 两处不一致就会「内置项反查不到」，
 * 表现是文件明明在目录里却显示成 id 风格的名字。本函数是该规则的**单一来源**：
 * 主进程改为引用这里，而不是各自维护一份。
 */
export function dshSkillNameOf(id: string): string {
  return id
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * 文件名 → 不含扩展名的主干（`system-image.md` → `system-image`）。
 *
 * 整名就是扩展名的（`.md`）会剥成空串 —— 这时**保留原名**：空标题在界面上是一张
 * 没有名字的卡片，比显示 `.md` 更难理解。
 */
export function skillFileStem(fileName: string): string {
  const stem = fileName.replace(/\.[^.]+$/, '')
  return stem || fileName
}

/** 去掉扩展名后的展示回落值：把 kebab-case 还原成可读的短语 */
export function humanizeSkillStem(stem: string): string {
  return stem.replace(/[-_]+/g, ' ').trim() || stem
}

/**
 * 内置技能：按 dsh 技能名索引，产出展示信息。
 *
 * 同一个技能名重复出现时**首个生效**（与 `listGraphSkills` 顺序一致，后来的覆盖不了
 * 已经登记的名字，避免注册顺序变化让界面文字跳来跳去）。
 */
export function builtinSkillDisplayMap(
  skills: readonly BuiltinSkillLike[]
): Map<string, SkillDisplayInfo> {
  const map = new Map<string, SkillDisplayInfo>()
  for (const skill of skills) {
    const name = dshSkillNameOf(skill.id)
    if (!name || map.has(name)) continue
    const titleZh = skill.titleZh?.trim()
    const titleEn = skill.titleEn?.trim()
    // 描述口径与 dsh 技能文件 frontmatter 一致：`English — 中文`
    const description =
      titleEn && titleZh ? `${titleEn} — ${titleZh}` : titleZh || titleEn || undefined
    map.set(name, {
      title: titleZh || titleEn || humanizeSkillStem(name),
      ...(description ? { description } : {})
    })
  }
  return map
}

/**
 * 解析自定义 `.md` 技能的 YAML frontmatter（只取本应用需要的两个字段）。
 *
 * 刻意不引 YAML 库：技能文件的 frontmatter 是我们自己生成的固定两行
 *（`name` / `description`），外加用户手写时的简单键值。为此拉一个解析器不划算，
 * 而且解析失败只会影响一行展示文字，不值得让它有抛错的机会。
 *
 * 用法兼容两种写法：`description: "x"` 与 `description: x`（引号可选，成对才剥）。
 */
export function parseSkillFrontmatter(content: string): {
  name?: string
  description?: string
} {
  // frontmatter 必须紧贴文件开头：`---` 起、`---` 止
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content)
  if (!match) return {}
  const out: { name?: string; description?: string } = {}
  for (const line of match[1]!.split(/\r?\n/)) {
    const colon = line.indexOf(':')
    if (colon <= 0) continue
    const key = line.slice(0, colon).trim().toLowerCase()
    if (key !== 'name' && key !== 'description') continue
    let value = line.slice(colon + 1).trim()
    // 成对引号才剥：`"a"` → a；`"a` 保持原样，避免手写不完整时吃掉内容
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1)
    } else if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1)
    }
    if (key === 'name') out.name = value.trim() || undefined
    else out.description = value.trim() || undefined
  }
  return out
}

/** 技能正文里第一段有意义的文字（跳过标题、小节标题、引用与代码块） */
export function firstSkillParagraph(content: string): string | undefined {
  // 先丢掉 frontmatter，否则会把 `name:` 那两行当成正文
  const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
  const lines = body.split(/\r?\n/)
  const collected: string[] = []
  let inCode = false
  for (const raw of lines) {
    const line = raw.trim()
    if (line.startsWith('```')) {
      inCode = !inCode
      continue
    }
    if (inCode) continue
    // 标题 / 小节标题 / 引用 / 列表符号都不是「一段话」，跳过
    if (!line || line.startsWith('#') || line.startsWith('>') || line.startsWith('-')) {
      if (collected.length) break
      continue
    }
    collected.push(line)
  }
  const text = collected.join(' ').trim()
  return text || undefined
}

/**
 * 单个技能文件的展示信息。
 *
 * 取值优先级：
 * 1. **内置项**用 GraphSkill 的标题（最准确，与 Agent 看到的一致）
 * 2. 自定义 `.md` 用 frontmatter 的 `description`
 * 3. 都取不到时用正文首段兜底（用户手写的技能常常只有正文没写 description）
 * 4. 再取不到就只显示标题，不编造描述
 */
export function skillDisplayInfo(input: {
  fileName: string
  kind: 'builtin' | 'custom' | 'template'
  builtin: ReadonlyMap<string, SkillDisplayInfo>
  /** 文件内容；读取失败时传 undefined */
  content?: string
}): SkillDisplayInfo {
  const stem = skillFileStem(input.fileName)
  if (input.kind === 'builtin') {
    const found = input.builtin.get(stem)
    if (found) return found
  }
  const fallbackTitle = humanizeSkillStem(stem)
  if (!input.content) return { title: fallbackTitle }
  const front = parseSkillFrontmatter(input.content)
  const description = front.description || firstSkillParagraph(input.content)
  return {
    title: fallbackTitle,
    ...(description ? { description } : {})
  }
}
