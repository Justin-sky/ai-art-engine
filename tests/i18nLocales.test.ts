/**
 * i18n 文案守卫：拦住「源码里用了某个 key、但文案里没有」这类只在运行期 console 报警的问题。
 *
 * 起因：FfmpegPanel 用了 t('settings.ffmpeg.installDir')，两套文案都没定义——
 * typecheck / 单测 / check:cjk 全绿，只有打开设置面板时才刷 "Not found key" 告警。
 *
 * 三条断言：
 * 1. zh-CN / en-US 的 key 路径集合完全一致（双向查漏：少键、多键都报）；
 * 2. src/renderer/src 里字面量写死的 t('a.b.c') 必须在两套文案里都能解析（动态拼接的 key 跳过）；
 * 3. 两套文案都不允许空叶子（漏填翻译最常见的形态）。
 *
 * 只扫渲染进程源码：主进程 / shared 的文案走 appError 语言目录，不经 vue-i18n。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import enUS from '../src/renderer/src/i18n/locales/en-US'
import zhCN from '../src/renderer/src/i18n/locales/zh-CN'

const RENDERER_ROOT = resolve(__dirname, '../src/renderer/src')
const PROJECT_ROOT = resolve(__dirname, '..')

/**
 * 没有任何地方 import 的孤立组件：其中的 key 即使缺失也到不了界面（不会产生 console 告警），
 * 所以不参与扫描。**一旦接线就把它从这里删掉**，让守卫重新管起来。
 *
 * Stage2dAutoCutDialog.vue：自动拆件的编辑对话框，功能已被 Stage2dNodeToolDialog 的
 * 内置 autoCutWholeLayer 流程取代（stage2d.autoCutEdit* 一族 key 两套文案都没有）。
 */
const UNREFERENCED_FILES = new Set(['src/renderer/src/components/Stage2dAutoCutDialog.vue'])

/** 有意留空的叶子：key 存在但默认值为空是有语义的（自定义预设＝清空描述后自行填写） */
const EMPTY_LEAF_ALLOWLIST = new Set(['aiWorkflow.presets.custom.prompt'])

/** 收集全部路径：叶子（字符串 / 数字）与容器（对象 / 数组）都收，t() 对两者都可解析 */
function collectPaths(value: unknown, prefix = '', out = new Set<string>()): Set<string> {
  if (value !== null && typeof value === 'object') {
    if (prefix) out.add(prefix)
    if (Array.isArray(value)) {
      value.forEach((item, index) =>
        collectPaths(item, prefix ? `${prefix}.${index}` : `${index}`, out)
      )
    } else {
      for (const [key, item] of Object.entries(value)) {
        collectPaths(item, prefix ? `${prefix}.${key}` : key, out)
      }
    }
    return out
  }
  if (prefix) out.add(prefix)
  return out
}

function collectEmptyLeaves(value: unknown, prefix = '', out: string[] = []): string[] {
  if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      collectEmptyLeaves(item, prefix ? `${prefix}.${key}` : key, out)
    }
    return out
  }
  if (typeof value === 'string' && value.trim() === '' && prefix) out.push(prefix)
  return out
}

/** 只认「全 ASCII 标识符 + 至少一段点号」的 key：排除 t('ffmpeg') 这类非文案调用 */
const KEY_LITERAL_RE = /\bt\(\s*'([A-Za-z][\w-]*(?:\.[\w-]+)+)'/g

/**
 * 注释里的示例 key 不算引用（URL 里的 // 不会被误判成注释，因为那种 key 过不了 KEY_LITERAL_RE）。
 * 块注释按原换行数替换成空行，保证报错行号与源码一致。
 */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => '\n'.repeat((comment.match(/\n/g) ?? []).length))
    .replace(/\/\/[^\n]*/g, '')
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.(ts|vue)$/.test(entry.name)) out.push(full)
  }
  return out
}

function collectUsedKeys(): { key: string; where: string }[] {
  const found: { key: string; where: string }[] = []
  for (const file of walk(RENDERER_ROOT)) {
    const rel = relative(PROJECT_ROOT, file).replace(/\\/g, '/')
    if (UNREFERENCED_FILES.has(rel)) continue
    const lines = stripComments(readFileSync(file, 'utf8')).split(/\r?\n/)
    lines.forEach((line, index) => {
      for (const match of line.matchAll(KEY_LITERAL_RE)) {
        found.push({ key: match[1], where: `${rel}:${index + 1}` })
      }
    })
  }
  return found
}

const zhPaths = collectPaths(zhCN)
const enPaths = collectPaths(enUS)
const used = collectUsedKeys()

describe('i18n 文案守卫', () => {
  it('扫到了两套文案与渲染进程源码（守卫本身没失效）', () => {
    expect(zhPaths.size).toBeGreaterThan(500)
    expect(enPaths.size).toBeGreaterThan(500)
    expect(used.length).toBeGreaterThan(500)
  })

  it('zh-CN / en-US 的 key 路径完全一致', () => {
    const onlyZh = [...zhPaths].filter((key) => !enPaths.has(key)).sort()
    const onlyEn = [...enPaths].filter((key) => !zhPaths.has(key)).sort()
    expect({ onlyZh, onlyEn }).toEqual({ onlyZh: [], onlyEn: [] })
  })

  it('源码里字面量引用的 key 在两套文案里都能解析', () => {
    const missing = used
      .filter(({ key }) => !zhPaths.has(key) || !enPaths.has(key))
      .map(({ key, where }) => `${key}  (${where})`)
      .sort()
    expect([...new Set(missing)]).toEqual([])
  })

  it('两套文案都没有空叶子（有意留空的登记在 EMPTY_LEAF_ALLOWLIST）', () => {
    const empty = (value: unknown): string[] =>
      collectEmptyLeaves(value).filter((key) => !EMPTY_LEAF_ALLOWLIST.has(key))
    expect({ zh: empty(zhCN), en: empty(enUS) }).toEqual({ zh: [], en: [] })
  })
})
