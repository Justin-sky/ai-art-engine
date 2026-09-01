/**
 * 项目级 Agent 记忆（ROADMAP 5.2）：
 * 跨会话记住项目偏好（风格 / 机位 / 角色一致性 / 其它），沉淀为工程根
 * `.aiartengine/memory.md`，随对话注入（persona system prompt）并可由 Agent
 * 通过 MCP 工具 `project_memory_*` 读写。
 *
 * 本模块为纯函数（不依赖 node fs / 渲染层），便于测试；
 * 落盘与对话注入由 main 侧（projectService / deepseekHarnessService / mcpServerService）负责。
 */

import type { ProjectConfig } from './domain'

/** 记忆文件在工程内的相对路径 */
export const PROJECT_MEMORY_RELATIVE_PATH = '.aiartengine/memory.md'

/** 注入对话时的内容上限（超出截断，避免撑爆 system prompt） */
export const PROJECT_MEMORY_INJECT_LIMIT = 4000

/** 写入时的内容上限（防止 Agent 写入超大内容） */
export const PROJECT_MEMORY_WRITE_LIMIT = 20_000

export const PROJECT_MEMORY_SECTIONS = [
  { id: 'style', zh: '风格偏好', en: 'Style' },
  { id: 'camera', zh: '机位 / 镜头偏好', en: 'Camera & framing' },
  { id: 'character', zh: '角色一致性', en: 'Character consistency' },
  { id: 'other', zh: '其它偏好', en: 'Other preferences' }
] as const

export type ProjectMemorySectionId = (typeof PROJECT_MEMORY_SECTIONS)[number]['id']

export function memorySectionTitle(id: ProjectMemorySectionId): { zh: string; en: string } {
  const def = PROJECT_MEMORY_SECTIONS.find((item) => item.id === id)
  return def ? { zh: def.zh, en: def.en } : { zh: '其它偏好', en: 'Other preferences' }
}

/** 文件标题行（双语并列，不依赖运行语言） */
function heading(title: { zh: string; en: string }): string {
  return `## ${title.zh} / ${title.en}`
}

/** 项目信息行（双语并列） */
function infoLine(label: { zh: string; en: string }, value: string): string {
  return `- ${label.zh} / ${label.en}: ${value}`
}

const LBL_PROJECT_NAME = { zh: '项目名称', en: 'Project name' }
const LBL_RESOLUTION = { zh: '画幅', en: 'Resolution' }
const LBL_FPS = { zh: '帧率', en: 'FPS' }
const LBL_SEED = { zh: '随机种子', en: 'Random seed' }
const LBL_STYLE_PRESET = { zh: '风格预设', en: 'Style preset' }
const LBL_STYLE_REFS = { zh: '风格参考图', en: 'Style reference images' }
const HEADER_TITLE = { zh: '项目记忆', en: 'Project Memory' }
const HEADER_PROJECT_INFO = { zh: '项目信息', en: 'Project info' }
const MEMORY_INTRO = [
  { zh: '跨会话沉淀的项目偏好（风格 / 机位 / 角色一致性 / 其它）；AI 对话会自动加载本文件，Agent 可随时用 project_memory_append 补充。', en: 'Persistent project preferences (style / camera / character / other); the AI chat auto-loads this file, agents may append via project_memory_append.' },
  { zh: '由工程配置自动初始化；修改后下一轮对话立即生效。', en: 'Initialized from the project config; edits take effect on the next chat turn.' }
]

/** 由工程配置生成初始记忆基线（记忆文件不存在时调用） */
export function buildInitialMemoryContent(config: ProjectConfig): string {
  const lines: string[] = []
  lines.push(`# ${HEADER_TITLE.zh} / ${HEADER_TITLE.en}`)
  lines.push('')
  for (const intro of MEMORY_INTRO) {
    lines.push(`> ${intro.zh} / ${intro.en}`)
  }
  lines.push('')
  lines.push(heading(HEADER_PROJECT_INFO))
  lines.push('')
  lines.push(infoLine(LBL_PROJECT_NAME, config.name || '-'))
  if (config.resolution) {
    lines.push(infoLine(LBL_RESOLUTION, `${config.resolution.w}x${config.resolution.h}`))
  }
  if (typeof config.fps === 'number') {
    lines.push(infoLine(LBL_FPS, String(config.fps)))
  }
  if (typeof config.generateSeed === 'number') {
    lines.push(infoLine(LBL_SEED, String(config.generateSeed)))
  }
  if (config.stylePreset?.trim()) {
    lines.push(infoLine(LBL_STYLE_PRESET, config.stylePreset.trim()))
  }
  const refCount = config.styleImages?.length ?? 0
  if (refCount > 0) {
    lines.push(infoLine(LBL_STYLE_REFS, `${refCount}`))
  }
  lines.push('')
  for (const section of PROJECT_MEMORY_SECTIONS) {
    lines.push(heading(section))
    lines.push('')
  }
  return lines.join('\n').replace(/\n+$/g, '\n')
}

export interface MemorySectionEntry {
  id: ProjectMemorySectionId
  title: string
  lines: string[]
}

/**
 * 解析记忆文件：返回各 section 的条目行（仅识别 `- ` / `* ` 前缀行；
 * 未识别的行如「项目信息」与说明块忽略）。
 */
export function parseMemorySections(content: string): MemorySectionEntry[] {
  const rows = String(content ?? '').split(/\r?\n/)
  const results: MemorySectionEntry[] = []
  let current: MemorySectionEntry | null = null
  for (const raw of rows) {
    const line = raw.trimEnd()
    if (line.startsWith('## ')) {
      const def = PROJECT_MEMORY_SECTIONS.find((s) => {
        const expected = heading(s)
        const loose = s.zh
        return line === expected || line.includes(loose)
      })
      current = def
        ? { id: def.id, title: line, lines: [] }
        : null
      if (current) results.push(current)
      continue
    }
    if (!current) continue
    const match = /^\s*[-*]\s+(.+)$/.exec(line)
    if (match) current.lines.push(match[1].trim())
  }
  return results
}

/**
 * 向指定 section 追加一条记忆；section 不存在时按定义补建。
 * 返回新的完整内容；content 为空时视为空记忆文档。
 */
export function appendMemorySection(
  content: string,
  sectionId: ProjectMemorySectionId,
  entry: string
): string {
  const line = String(entry ?? '').trim()
  if (!line) return content
  const rows = String(content ?? '').split(/\r?\n/)
  const target = heading(memorySectionTitle(sectionId))

  let sectionIndex = -1
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].trim() === target || rows[i].includes(memorySectionTitle(sectionId).zh)) {
      sectionIndex = i
      break
    }
  }

  if (sectionIndex >= 0) {
    // 在 section 内最后一条目之后插入；无条目则在标题行后插入
    let insertAt = sectionIndex + 1
    let lastEntry = -1
    for (let i = sectionIndex + 1; i < rows.length; i++) {
      const t = rows[i].trim()
      if (t.startsWith('## ')) break
      if (/^[-*]\s+/.test(t)) lastEntry = i
    }
    if (lastEntry >= 0) insertAt = lastEntry + 1
    rows.splice(insertAt, 0, `- ${line}`)
    return rows.join('\n')
  }

  // 无该 section：文档末尾追加（空文档先去尾空行）
  const trimmed = rows.join('\n').trimEnd()
  const suffix = trimmed ? '\n\n' : ''
  return `${trimmed}${suffix}${target}\n- ${line}\n`
}
