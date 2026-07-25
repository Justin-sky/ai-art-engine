/**
 * 主题样式契约 + 跨主题易碎 UI 审计。
 * 目标：在 dark/light 下找出硬编码色、暗色 fallback、缩放角标等 chrome 问题。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const MAIN_CSS = join(ROOT, 'src/renderer/src/styles/main.css')
const SETTINGS_SERVICE = join(ROOT, 'src/main/services/settingsService.ts')
const RENDERER_SRC = join(ROOT, 'src/renderer/src')

const WHITE_RGBA_RE =
  /rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*(0?\.\d+|1(?:\.0+)?)\s*\)/gi

/** 暗色向硬编码 fallback：变量缺失时浅色主题会错 */
const DARK_FALLBACK_RE =
  /var\(\s*--(bg|bg-panel|bg-elevated|bg-hover|bg-input|border|text|text-muted|graph-node-bg|graph-preview-bg)\s*,\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\))\s*\)/g

const RESIZE_CHROME_FILES = [
  'components/GraphNodeResizeHandle.vue',
  'components/ExpandableTextarea.vue',
  'components/RefMentionTextarea.vue',
  'components/GraphInstructionMentionEditor.vue',
  'components/ShotTable.vue',
  'styles/main.css'
] as const

/** 叠在媒体上的编辑手柄：硬编码白可接受为「媒体叠层」，但仍单独列出 */
const MEDIA_OVERLAY_RESIZE_FILES = new Set([
  'components/CropEditorDialog.vue',
  'components/ExpandEditorDialog.vue',
  'components/RedrawEditorDialog.vue',
  'components/GridSplitEditorDialog.vue',
  'components/MediaPreviewPlayer.vue'
])

type ThemeVars = Map<string, string>

type ThemeIssue = {
  severity: 'error' | 'warn'
  kind:
    | 'resize-chrome'
    | 'white-wash-surface'
    | 'dark-only-fallback'
    | 'fixed-theme-chrome'
    | 'media-overlay-hardcoded'
  file: string
  detail: string
}

function read(path: string): string {
  return readFileSync(path, 'utf8')
}

function extractThemeBlock(css: string, selectorHint: string): string {
  const normalized = css.replace(/\r\n/g, '\n')
  const start = normalized.indexOf(selectorHint)
  if (start < 0) throw new Error(`missing theme block: ${selectorHint}`)
  const brace = normalized.indexOf('{', start)
  let depth = 0
  for (let i = brace; i < normalized.length; i++) {
    const ch = normalized[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return normalized.slice(brace + 1, i)
    }
  }
  throw new Error(`unclosed theme block: ${selectorHint}`)
}

function parseCssVars(block: string): ThemeVars {
  const vars: ThemeVars = new Map()
  const re = /--([a-z0-9-]+)\s*:\s*([^;]+);/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(block))) {
    vars.set(m[1]!, m[2]!.trim())
  }
  return vars
}

function walkFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walkFiles(full, out)
    else if (/\.(vue|css)$/.test(name)) out.push(full)
  }
  return out
}

function relRenderer(abs: string): string {
  return relative(RENDERER_SRC, abs).replace(/\\/g, '/')
}

function styleSections(source: string): string {
  // Vue SFC：只审 <style>；纯 CSS 整文件
  const styles: string[] = []
  const re = /<style\b[^>]*>([\s\S]*?)<\/style>/gi
  let m: RegExpExecArray | null
  let found = false
  while ((m = re.exec(source))) {
    found = true
    styles.push(m[1]!)
  }
  return found ? styles.join('\n') : source
}

function lineNo(text: string, index: number): number {
  return text.slice(0, index).split(/\r?\n/).length
}

function collectIssues(): ThemeIssue[] {
  const issues: ThemeIssue[] = []
  const files = walkFiles(RENDERER_SRC)

  // 1) 图节点缩放角标：必须跟主题，禁止硬编码白斜纹
  const handlePath = join(RENDERER_SRC, 'components/GraphNodeResizeHandle.vue')
  const handleCss = styleSections(read(handlePath))
  if (WHITE_RGBA_RE.test(handleCss) || /#fff(?:fff)?\b/i.test(handleCss)) {
    issues.push({
      severity: 'error',
      kind: 'resize-chrome',
      file: 'components/GraphNodeResizeHandle.vue',
      detail:
        '右下角缩放柄使用硬编码白色斜纹；浅色主题节点底为白时几乎不可见。应改用 --text-muted / color-mix 等主题 token（对齐 textarea::-webkit-resizer）'
    })
  }
  WHITE_RGBA_RE.lastIndex = 0

  // 2) textarea / 全局 resizer：必须引用主题变量
  for (const rel of RESIZE_CHROME_FILES) {
    const abs = join(RENDERER_SRC, rel)
    const css = styleSections(read(abs))
    if (!css.includes('::-webkit-resizer')) continue
    const blocks = css.split(/::-webkit-resizer\s*\{/)
    for (let i = 1; i < blocks.length; i++) {
      const body = blocks[i]!.slice(0, blocks[i]!.indexOf('}'))
      const usesTheme =
        /var\(--(bg|bg-input|bg-panel|bg-elevated|text-muted|shot-card|resizer-grip)/.test(body) ||
        /color-mix\([^)]*var\(--/.test(body)
      if (!usesTheme) {
        issues.push({
          severity: 'error',
          kind: 'resize-chrome',
          file: rel,
          detail:
            '::-webkit-resizer 未使用主题 CSS 变量（--bg / --bg-input / --resizer-grip 等）'
        })
      }
      if (WHITE_RGBA_RE.test(body) || /#fff(?:fff)?\b/i.test(body)) {
        issues.push({
          severity: 'error',
          kind: 'resize-chrome',
          file: rel,
          detail: '::-webkit-resizer 含硬编码白色，浅色主题会失效'
        })
      }
      WHITE_RGBA_RE.lastIndex = 0
    }
  }

  // 3) 固定不跟主题的 chrome
  const mainCss = read(MAIN_CSS)
  const flyer = mainCss.match(/\.graph-task-flyer\s*\{[\s\S]*?\}/)?.[0] ?? ''
  if (/background:\s*rgba\(30,\s*40,\s*56/.test(flyer) || /color:\s*#9ec5ff/.test(flyer)) {
    issues.push({
      severity: 'error',
      kind: 'fixed-theme-chrome',
      file: 'styles/main.css',
      detail: '.graph-task-flyer 使用固定深蓝底/字色，浅色主题下突兀；应改用 --accent / --bg-elevated 等'
    })
  }

  // 4) 扫描组件样式：白洗表面 + 暗色 fallback + 媒体叠层白手柄
  for (const abs of files) {
    const rel = relRenderer(abs)
    if (rel === 'styles/main.css') continue // 主题定义本身含 dark 白网格等
    const raw = read(abs)
    const css = styleSections(raw)

    // 暗色 fallback
    let fm: RegExpExecArray | null
    DARK_FALLBACK_RE.lastIndex = 0
    const seenFallback = new Set<string>()
    while ((fm = DARK_FALLBACK_RE.exec(css))) {
      const token = fm[0]!
      if (seenFallback.has(token)) continue
      seenFallback.add(token)
      const fallback = fm[2]!.trim().toLowerCase()
      // 明显偏暗的 hex / 近黑 rgba 才报
      const isDarkHex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(fallback)
        ? (() => {
            const h = fallback.slice(1)
            const full =
              h.length === 3
                ? h
                    .split('')
                    .map((c) => c + c)
                    .join('')
                : h.slice(0, 6)
            const r = parseInt(full.slice(0, 2), 16)
            const g = parseInt(full.slice(2, 4), 16)
            const b = parseInt(full.slice(4, 6), 16)
            return (r + g + b) / 3 < 120
          })()
        : /rgba?\(\s*\d{1,2}\s*,/.test(fallback)
      if (!isDarkHex) continue
      issues.push({
        severity: 'warn',
        kind: 'dark-only-fallback',
        file: rel,
        detail: `暗色硬编码 fallback「${token}」（L${lineNo(css, fm.index)}）；变量缺失时浅色会错，建议去掉 fallback 或改用中性值`
      })
    }

    // 硬编码白叠色（surface）
    WHITE_RGBA_RE.lastIndex = 0
    let wm: RegExpExecArray | null
    const seenWhite = new Set<string>()
    while ((wm = WHITE_RGBA_RE.exec(css))) {
      const alpha = Number(wm[1])
      // 忽略接近不透明的纯白大面积（少见）；关注 0.02–0.5 的「微亮」叠色
      if (!(alpha > 0 && alpha <= 0.5)) continue
      const snippet = css.slice(Math.max(0, wm.index - 40), wm.index + wm[0]!.length + 20)
      // 已用主题变量包裹的 fallback 归 dark-only；这里仍记 white-wash
      const key = `${rel}:${lineNo(css, wm.index)}:${wm[0]}`
      if (seenWhite.has(key)) continue
      seenWhite.add(key)

      if (MEDIA_OVERLAY_RESIZE_FILES.has(rel)) {
        issues.push({
          severity: 'warn',
          kind: 'media-overlay-hardcoded',
          file: rel,
          detail: `媒体叠层硬编码白 L${lineNo(css, wm.index)}: ${wm[0]}（亮图上可能看不见）`
        })
        continue
      }

      // 缩放柄已在 resize-chrome 专项覆盖
      if (rel === 'components/GraphNodeResizeHandle.vue') continue

      // var(--token, rgba(255…)) 归 dark-only / fallback，不重复记 white-wash
      const before = css.slice(Math.max(0, wm.index - 80), wm.index)
      if (/var\(\s*--[\w-]+\s*,\s*$/.test(before.replace(/\s+/g, ' '))) continue

      issues.push({
        severity: 'error',
        kind: 'white-wash-surface',
        file: rel,
        detail: `硬编码白叠色 L${lineNo(css, wm.index)}: ${wm[0]}；浅色主题几乎无对比。附近: ${snippet.replace(/\s+/g, ' ').trim()}`
      })
    }
  }

  return issues
}

function formatIssues(issues: ThemeIssue[]): string {
  if (!issues.length) return '(none)'
  const byKind = new Map<string, ThemeIssue[]>()
  for (const issue of issues) {
    const list = byKind.get(issue.kind) ?? []
    list.push(issue)
    byKind.set(issue.kind, list)
  }
  const lines: string[] = [`共 ${issues.length} 处主题样式问题：`, '']
  for (const [kind, list] of byKind) {
    lines.push(`## ${kind} (${list.length})`)
    for (const issue of list) {
      lines.push(`- [${issue.severity}] ${issue.file}: ${issue.detail}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

describe('theme CSS contract (main.css)', () => {
  const css = read(MAIN_CSS).replace(/\r\n/g, '\n')
  const dark = parseCssVars(extractThemeBlock(css, "[data-theme='dark']"))
  const light = parseCssVars(extractThemeBlock(css, "[data-theme='light']"))

  /** 结构 token 只在 :root/dark 声明一次即可；色板必须两套都有 */
  const STRUCTURAL = new Set(['radius', 'font', 'mono'])

  it('light overrides every dark color token (structural tokens may stay on :root)', () => {
    const darkColorKeys = [...dark.keys()].filter((k) => !STRUCTURAL.has(k)).sort()
    const lightKeys = [...light.keys()].sort()
    const missingInLight = darkColorKeys.filter((k) => !light.has(k))
    const extraInLight = lightKeys.filter((k) => !dark.has(k))
    expect({ missingInLight, extraInLight }, 'dark/light 色板变量应对齐').toEqual({
      missingInLight: [],
      extraInLight: []
    })
  })

  it('structural tokens exist on dark/:root', () => {
    for (const key of STRUCTURAL) {
      expect(dark.get(key), key).toBeTruthy()
    }
  })

  it('core chrome tokens differ between dark and light (not copy-paste same palette)', () => {
    for (const key of ['bg', 'bg-panel', 'text', 'border', 'graph-node-bg', 'bg-input'] as const) {
      expect(dark.get(key), key).toBeTruthy()
      expect(light.get(key), key).toBeTruthy()
      expect(light.get(key), `${key} should change in light`).not.toBe(dark.get(key))
    }
  })

  it('textarea::-webkit-resizer background matches global textarea background token', () => {
    const css = read(MAIN_CSS).replace(/\r\n/g, '\n')
    const controlRule =
      css.match(/input,\ntextarea,\nselect \{\n  background: var\(--bg\);[\s\S]*?\n\}/)?.[0] ?? ''
    const resizerRule = css.match(/textarea::-webkit-resizer\s*\{[\s\S]*?\}/)?.[0] ?? ''
    expect(controlRule.length).toBeGreaterThan(0)
    expect(controlRule).toMatch(/background:\s*var\(--bg\)/)
    // 缩放柄必须同源，禁止再用 --bg-input（浅色主题白角块）
    expect(resizerRule).toMatch(/background-color:\s*var\(--bg\)/)
    expect(resizerRule).not.toMatch(/background-color:\s*var\(--bg-input\)/)
    expect(resizerRule).toMatch(/background-image:\s*var\(--resizer-grip\)/)
  })

  it('window chromeColorsForTheme stay aligned with main.css tokens', () => {
    const service = read(SETTINGS_SERVICE)
    expect(service).toMatch(/background:\s*light\s*\?\s*'#f0f2f5'\s*:\s*'#141516'/)
    expect(service).toMatch(/overlay:\s*light\s*\?\s*'#ffffff'\s*:\s*'#1c1e21'/)
    expect(service).toMatch(/symbol:\s*light\s*\?\s*'#1a1d21'\s*:\s*'#e8eaed'/)
    expect(dark.get('bg')?.toLowerCase()).toBe('#141516')
    expect(light.get('bg')?.toLowerCase()).toBe('#f0f2f5')
    expect(dark.get('bg-panel')?.toLowerCase()).toBe('#1c1e21')
    expect(light.get('bg-panel')?.toLowerCase()).toBe('#ffffff')
    expect(dark.get('text')?.toLowerCase()).toBe('#e8eaed')
    expect(light.get('text')?.toLowerCase()).toBe('#1a1d21')
  })
})

describe('theme chrome safety audit', () => {
  it('has no critical chrome debt (resize grips / fixed flyer)', () => {
    const critical = collectIssues().filter(
      (i) => i.kind === 'resize-chrome' || i.kind === 'fixed-theme-chrome'
    )
    expect(critical, formatIssues(critical)).toEqual([])
  })

  it('has no white-wash surface styles', () => {
    const wash = collectIssues().filter((i) => i.kind === 'white-wash-surface')
    expect(wash, formatIssues(wash)).toEqual([])
  })

  it('has no dark-only CSS var fallbacks', () => {
    const fallbacks = collectIssues().filter((i) => i.kind === 'dark-only-fallback')
    expect(fallbacks, formatIssues(fallbacks)).toEqual([])
  })

  it('has no media-overlay hardcoded white rgba', () => {
    const media = collectIssues().filter((i) => i.kind === 'media-overlay-hardcoded')
    expect(media, formatIssues(media)).toEqual([])
  })
})
