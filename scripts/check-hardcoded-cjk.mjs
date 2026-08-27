#!/usr/bin/env node
/**
 * 硬编码中文守卫：扫描 src/**​/*.{ts,vue}，剥离注释后检测残留中日韩表意文字。
 *
 * - 剥离注释时跟踪引号态（' "` 模板串、${} 插值嵌套），避免误伤 URL 等；
 * - 行内追加注释 `cjk-ok` 可显式豁免该行；
 * - 豁免清单 scripts/cjk-allowlist.json（按文件存被豁免行），随迁移批次收缩；
 * - 默认 warn（--report 查看汇总）；`--enforce` 或配置文件 mode:"enforce" 时发现违例退出码 1。
 *
 * 已知双语域数据目录集中在脚本内 EXEMPT 文件清单。
 */
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))
export const PROJECT_ROOT = path.resolve(__dirname, '..')
const SRC_ROOT = path.join(PROJECT_ROOT, 'src')
const ALLOWLIST_PATH = path.join(PROJECT_ROOT, 'scripts', 'cjk-allowlist.json')

/** 双语域数据：AI 提示词 / 预设内容 / 双语错误目录本身，不走 vue-i18n（团队既定约定） */
const EXEMPT_FILES = new Set([
  'src/shared/errors/catalog.ts',
  'src/main/errors/messages.ts',
  'src/main/services/modelProviders/catalog.ts',
  'src/shared/graph/agentPrompts.ts',
  'src/shared/graph/episodeAgentPrompts.ts',
  'src/shared/graph/instructionPresets.ts',
  'src/shared/graph/systemPromptSchemes.ts',
  'src/shared/graph/emotionPad.ts',
  'src/renderer/src/features/director/aiSceneBlockout.ts',
  'src/renderer/src/features/director/aiPosePresets.ts'
])
const EXEMPT_DIR_PARTS = [['src', 'renderer', 'src', 'i18n', 'locales']]

const CJK_RE = /[㐀-鿿豈-﫿]/
const SUPPRESS_RE = /\bcjk-ok\b/
/** code 态里 / 之后允许正则字面量启动的前导字符（运算符/开括号等；标识符与 ) ] 引号后视为除法或调用） */
const REGEX_PRECEDERS = new Set([
  '(', '[', '{', ',', ';', ':', '!', '?', '&', '|', '+', '-', '*', '%', '^', '~', '<', '>', '='
])
const REGEX_KEYWORD_RE =
  /\b(?:return|typeof|instanceof|case|do|else|new|delete|void|in|of|yield|await|throw)$/

/**
 * 从 start（'/' 处）预扫描一个可能跨过引号的正则字面量，返回闭 '/' 的下一个下标。
 * 不允许跨行、')' 提前出现视为非正则（除法误判保护）；找不到闭合返回 -1。
 * 注意：'[...]' 字符类内的 '/' 与引号不参与结构判断。
 */
function regexSpanEnd(text, start) {
  let j = start + 1
  let inClass = false
  while (j < text.length) {
    const c = text[j]
    if (c === '\n' || c === '\r') return -1
    if (c === '\\') {
      j += 2
      continue
    }
    if (inClass) {
      if (c === ']') inClass = false
    } else if (c === '[') inClass = true
    else if (c === '/') return j + 1
    else if (c === ')') return -1
    j++
  }
  return -1
}
/** 双语表定义起点：defErr / defErrSimple（含跨行泛型，如 defErr<{...}\n}>）——初始化整段是对照数据本身 */
const DEF_OPEN_RE = /\bdefErr(?:Simple)?\b[^()]*\(/
/** 行级双语数据：{ zh:'…', en:'…' } 对字面量（同语言中立载荷，属域数据） */
const BI_PAIR_RE = /\bzh\s*:\s*['"`]/
/** 行级双语数据：pickXxxBi('中文', 'English') 两参选择器 */
const BI_PICK_RE = /\bpick\w*Bi\s*\(/

function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    const st = fs.statSync(full)
    if (st.isDirectory()) {
      walk(full, out)
    } else if (/\.(ts|vue)$/.test(name)) {
      out.push(full)
    }
  }
}

/** 判断 code 态中刚消费的尾部上下文后紧跟的 '/' 是否应按正则字面量启动解析（防除法误判） */
function nextStartsRegex(codeTail) {
  if (!codeTail) return true
  const last = codeTail.slice(-1)
  if (REGEX_PRECEDERS.has(last)) return true
  if (/[A-Za-z0-9_$]/.test(last)) {
    const m = codeTail.match(/(?:[A-Za-z0-9_$]+)$/)
    if (m && REGEX_KEYWORD_RE.test(codeTail)) {
      const beforeIdx = codeTail.length - m[0].length - 1
      const before = beforeIdx >= 0 ? codeTail[beforeIdx] : ''
      return !/[A-Za-z0-9_$]/.test(before)
    }
    return false
  }
  return false // ')'、']'、引号之后是除法或属性调用
}

/**
 * 剥离代码注释并保持字符串内容可见。返回各行的"有效文本"数组（与原行对齐）。
 * - 处理 // 、<!-- -->（.vue 模板）、多行块注释；
 * - 引号态跨行跟踪，模板串内 ${} 进入表达式重置引号跟踪，配平后回到外层模板；
 * - 正则字面量做预扫描跳过：其内的引号不改变引号态，但内容保持可见上报
 *   （正则耦合文案本就应当迁移，跳过仅防止污染后续引号态）。
 */
export function stripCommentsPerLine(text) {
  const out = []
  let cur = ''
  let codeTail = '' // 最近若干 code 态字符（引号态判定用）
  /** 栈帧：code | s | d | t | comment-line | comment-block | comment-html */
  const stack = [{ kind: 'code', braces: 0 }]
  const seeCodeChar = (c) => {
    codeTail = (codeTail + c).slice(-24)
  }

  const top = () => stack[stack.length - 1]
  const emitLine = () => {
    out.push(cur.replace(/\s+/g, ' ').trim())
    cur = ''
  }

  let i = 0
  const n = text.length

  while (i < n) {
    const frame = top()
    const ch = text[i]

    // ── 注释态：只等结束标记 ──
    if (frame.kind === 'comment-line') {
      if (ch === '\n') {
        stack.pop()
        emitLine()
      }
      i++
      continue
    }
    if (frame.kind === 'comment-block') {
      if (ch === '\n') emitLine()
      if (ch === '*' && text[i + 1] === '/') {
        stack.pop()
        i += 2
      } else {
        i++
      }
      continue
    }
    if (frame.kind === 'comment-html') {
      if (ch === '\n') emitLine()
      if (ch === '-' && text.slice(i, i + 3) === '-->') {
        stack.pop()
        i += 3
      } else {
        i++
      }
      continue
    }

    // ── code 态帧 ──
    if (ch === '\n') {
      emitLine()
      i++
      continue
    }
    if (frame.kind === 's' || frame.kind === 'd') {
      if (ch === '\\') {
        cur += text.slice(i, i + 2)
        i += 2
        continue
      }
      if ((frame.kind === 's' && ch === "'") || (frame.kind === 'd' && ch === '"')) {
        stack.pop()
      }
      cur += ch
      i++
      continue
    }
    if (frame.kind === 't') {
      if (ch === '\\') {
        cur += text.slice(i, i + 2)
        i += 2
        continue
      }
      if (ch === '`') {
        stack.pop()
        cur += ch
        i++
        continue
      }
      if (ch === '$' && text[i + 1] === '{') {
        stack.push({ kind: 'code', braces: 0 })
        cur += '${'
        i += 2
        continue
      }
      cur += ch
      i++
      continue
    }

    // frame.kind === 'code'：可能在模板表达式内或顶层；注释/字符串起始仅在此识别
    if (ch === '/' && text[i + 1] === '/') {
      stack.push({ kind: 'comment-line' })
      i += 2
      continue
    }
    if (ch === '/' && text[i + 1] === '*') {
      stack.push({ kind: 'comment-block' })
      i += 2
      continue
    }
    if (ch === '<' && text.slice(i, i + 4) === '<!--') {
      stack.push({ kind: 'comment-html' })
      i += 4
      continue
    }
    if (ch === '/' && nextStartsRegex(codeTail)) {
      const end = regexSpanEnd(text, i)
      if (end > 0) {
        let stop = end
        while (stop < text.length && /[a-z]/.test(text[stop])) stop++ // 标志位 gimsuy…
        cur += text.slice(i, stop) // 正则内容保持可见（其内 CJK 如实上报）
        seeCodeChar('/')
        i = stop
        continue
      }
    }
    if (ch === "'" ) { stack.push({ kind: 's' }); seeCodeChar(ch); cur += ch; i++; continue }
    if (ch === '"' ) { stack.push({ kind: 'd' }); seeCodeChar(ch); cur += ch; i++; continue }
    if (ch === '`' ) { stack.push({ kind: 't' }); seeCodeChar(ch); cur += ch; i++; continue }
    if (ch === '{') {
      frame.braces++
      seeCodeChar(ch)
      cur += ch
      i++
      continue
    }
    if (ch === '}') {
      if (frame.braces === 0 && stack.length > 1 && stack[stack.length - 2].kind === 't') {
        // 回到外层模板串
        stack.pop()
        cur += ch
        i++
        continue
      }
      if (frame.braces > 0) frame.braces--
      seeCodeChar(ch)
      cur += ch
      i++
      continue
    }
    seeCodeChar(ch)
    cur += ch
    i++
  }
  if (cur.length) out.push(cur.replace(/\s+/g, ' ').trim())
  return out
}

/**
 * 标记双语表定义区间覆盖的行号集合（0 基）。
 * 在剥离后的文本上定位 defErr/defErrSimple( 起点，按括号配平（含 4000 字符兜底窗）
 * 找到闭合右括号，区间内所有行都是中英对照数据，不计违例。
 */
export function bilingualDefLineIndexes(stripped) {
  const suppressed = new Set()
  let offset = 0
  // 预生成每行 [start,end) 区间
  const spans = stripped.map((l) => {
    const s = offset
    offset += l.length + 1
    return [s, offset - 1]
  })
  const full = stripped.join('\n')
  for (let i = 0; i < full.length; ) {
    DEF_OPEN_RE.lastIndex = 0
    const m = DEF_OPEN_RE.exec(full.slice(i))
    if (!m || m.index === undefined) break
    const openAt = i + m.index + m[0].length - 1 // '(' 位置
    let depth = 1
    let j = openAt + 1
    while (j < full.length && depth > 0 && j - openAt < 4000) {
      if (full[j] === '(') depth++
      else if (full[j] === ')') depth--
      j++
    }
    for (let li = 0; li < spans.length; li++) {
      const [s, e] = spans[li]
      if (e > openAt && s < j) suppressed.add(li)
    }
    i = Math.max(j, openAt + 1)
  }
  return suppressed
}

/** 扫描单文件，返回违例行 [{line, text}]；suppressed/cjk-ok/双语表定义行不计入 */
export function scanText(text) {
  const rawLines = text.split(/\r?\n/)
  const stripped = stripCommentsPerLine(text)
  const defSuppressed = bilingualDefLineIndexes(stripped)
  const hits = []
  stripped.forEach((content, idx) => {
    const raw = rawLines[idx] ?? ''
    if (!CJK_RE.test(content)) return
    if (SUPPRESS_RE.test(raw)) return
    // 双语数据行：zh/en 成对字面量 或 pickXxxBi(...) 选择器（域数据约定，与 defErr 表同级）
    const hasEnPair = /\ben\s*:\s*['"`]/.test(content)
    if (hasEnPair && BI_PAIR_RE.test(content)) return
    if (BI_PICK_RE.test(content)) return
    if (defSuppressed.has(idx)) return
    hits.push({ line: idx + 1, text: content })
  })
  return hits
}

function rel(p) {
  return path.relative(PROJECT_ROOT, p).replace(/\\/g, '/')
}

export function collectSources() {
  const files = []
  walk(SRC_ROOT, files)
  return files.filter((f) => {
    const r = rel(f)
    if (EXEMPT_FILES.has(r)) return false
    if (EXEMPT_DIR_PARTS.some((parts) => r.split('/').slice(0, parts.length).join('/') === parts.join('/')))
      return false
    return true
  })
}

function loadAllowlist() {
  try {
    return JSON.parse(fs.readFileSync(ALLOWLIST_PATH, 'utf8'))
  } catch {
    return { mode: 'warn', files: {} }
  }
}

/** 豁免匹配规则：整行（规范化后）严格相等——行一旦被迁移改写即自动失效，保证可收缩 */
export function isAllowlisted(entryList, text) {
  return entryList.some((e) => e === text)
}

export function run({ json = false } = {}) {
  const cfg = loadAllowlist()
  const enforce = process.argv.includes('--enforce') || cfg.mode === 'enforce'
  const results = []

  for (const f of collectSources()) {
    const r = rel(f)
    const allowed = (cfg.files?.[r] ?? [])
    let text
    try {
      text = fs.readFileSync(f, 'utf8')
    } catch {
      continue
    }
    for (const hit of scanText(text)) {
      if (isAllowlisted(allowed, hit.text)) continue
      results.push({ file: r, line: hit.line, text: hit.text })
    }
  }

  if (json || process.argv.includes('--json')) {
    console.log(JSON.stringify(results, null, 2))
  } else {
    for (const v of results) console.log(`${v.file}:${v.line}: ${v.text}`)
    const label = enforce ? 'violations (blocking)' : 'violations (warn)'
    console.log(`check-hardcoded-cjk: ${results.length} ${label}`)
  }

  if (enforce && results.length > 0) process.exitCode = 1
  return results
}

if (process.argv[1] && path.resolve(process.argv[1]) === url.fileURLToPath(import.meta.url)) {
  run()
}
