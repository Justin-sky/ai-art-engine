import { stripJsonCodeFence } from './jsonFence'

export interface UiScreenPromptItem {
  id: string
  title: string
  prompt: string
}

function slugify(raw: string, index: number): string {
  const base = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return `ui-${base || `screen-${index + 1}`}`
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * 解析 UI 界面拆分模型输出：JSON 数组，每项含 title + prompt（或纯字符串）。
 */
export function parseUiScreenPrompts(raw: string): UiScreenPromptItem[] {
  const text = stripJsonCodeFence(raw)
  if (!text) return []

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    // 容错：截取首个 [...] 再试
    const start = text.indexOf('[')
    const end = text.lastIndexOf(']')
    if (start < 0 || end <= start) return []
    try {
      parsed = JSON.parse(text.slice(start, end + 1))
    } catch {
      return []
    }
  }

  if (!Array.isArray(parsed)) return []

  const seen = new Set<string>()
  const items: UiScreenPromptItem[] = []
  for (let i = 0; i < parsed.length; i += 1) {
    const row = parsed[i]
    let title = ''
    let prompt = ''
    let id = ''
    if (typeof row === 'string') {
      prompt = row.trim()
      title = `界面 ${i + 1}`
    } else if (row && typeof row === 'object') {
      const obj = row as Record<string, unknown>
      title = asString(obj.title) || asString(obj.name) || asString(obj.screen) || `界面 ${i + 1}`
      prompt =
        asString(obj.prompt) ||
        asString(obj.text) ||
        asString(obj.content) ||
        asString(obj.description)
      id = asString(obj.id)
    }
    if (!prompt) continue
    let nextId = id || slugify(title, i)
    if (seen.has(nextId)) nextId = `${nextId}-${i + 1}`
    seen.add(nextId)
    items.push({ id: nextId, title, prompt })
  }
  return items
}
