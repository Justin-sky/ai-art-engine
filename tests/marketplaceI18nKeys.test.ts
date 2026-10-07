import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import zhCN from '../src/renderer/src/i18n/locales/zh-CN'
import enUS from '../src/renderer/src/i18n/locales/en-US'
import {
  EXTERNAL_MCP_CONFIG_REASONS,
  createDefaultExternalMcpServer,
  externalMcpUnusableReason,
  isUsableHttpUrl
} from '../src/shared/externalMcp'
import { searchPlaceholderKey } from '../src/renderer/src/features/marketplace/buildMarketplaceCards'

/**
 * 插件市场的 i18n 键**完备性**守卫。
 *
 * 起因是一个真实缺陷：`draftToExternalMcpServer` 会返回 `missingUrl`，而 locale 里
 * 只加了 `invalidUrl` 与 `missingCommand` —— 于是用户在「服务地址」留空时看到的
 * 是键名本身（`marketplace.ext.missingUrl`），而不是「请填写服务地址」。
 * vue-i18n 只打一条 warn 就回退，界面照常渲染，所以肉眼很容易漏掉。
 *
 * 这里不逐个列举键名（那样加一种原因还会漏），而是**从产出侧反查**：
 * 代码能产出的每一个原因键，都必须在两个 locale 里真的有对应文案。
 */

const zh = zhCN as Record<string, unknown>
const en = enUS as Record<string, unknown>

/** 按 `a.b.c` 取值；不存在返回 undefined */
function lookup(source: Record<string, unknown>, path: string): unknown {
  let node: unknown = source
  for (const part of path.split('.')) {
    if (!node || typeof node !== 'object') return undefined
    node = (node as Record<string, unknown>)[part]
  }
  return node
}

/** 把叶子键全部摊平成 `a.b.c` 清单，用于反向查漏 */
function leafKeys(source: Record<string, unknown>, prefix = ''): string[] {
  const out: string[] = []
  for (const [key, value] of Object.entries(source)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      out.push(...leafKeys(value as Record<string, unknown>, path))
    } else {
      out.push(path)
    }
  }
  return out
}

const zhLeaves = new Set(leafKeys(zh))
const enLeaves = new Set(leafKeys(en))
const CLIENT_SOURCE = readFileSync(
  resolve('src/renderer/src/components/marketplace/ExternalMcpConfig.vue'),
  'utf8'
)
const DIALOG_SOURCE = readFileSync(
  resolve('src/renderer/src/components/marketplace/ExternalMcpAddDialog.vue'),
  'utf8'
)

describe('配置层原因键：代码产出的每一个都必须有文案', () => {
  it('EXTERNAL_MCP_CONFIG_REASONS 覆盖 externalMcpUnusableReason 的全部返回值', () => {
    const produced = new Set<string>()
    // http 缺地址 / 地址非法 / 命令缺失，三种分支各走一遍
    for (const server of [
      createDefaultExternalMcpServer('http'),
      { ...createDefaultExternalMcpServer('http'), url: 'nope' },
      createDefaultExternalMcpServer('stdio')
    ]) {
      const reason = externalMcpUnusableReason(server)
      if (reason) produced.add(reason)
    }
    // 三种原因都要被走一遍（漏一种说明这个断言本身没意义）
    expect(produced.size).toBe(3)
    for (const reason of produced) {
      expect(EXTERNAL_MCP_CONFIG_REASONS).toContain(reason)
    }
  })

  it('每个配置层原因键在两个 locale 里都有文案', () => {
    for (const reason of EXTERNAL_MCP_CONFIG_REASONS) {
      const key = `marketplace.ext.${reason}`
      expect(typeof lookup(zh, key), `zh 缺 ${key}`).toBe('string')
      expect(typeof lookup(en, key), `en 缺 ${key}`).toBe('string')
    }
  })

  it('**空地址**也有自己的文案（这次漏的就是它）', () => {
    expect(typeof lookup(zh, 'marketplace.ext.missingUrl')).toBe('string')
    expect(typeof lookup(en, 'marketplace.ext.missingUrl')).toBe('string')
    // 且与「地址非法」不是同一句：两种情况给用户的下一步动作不同
    expect(lookup(zh, 'marketplace.ext.missingUrl')).not.toBe(
      lookup(zh, 'marketplace.ext.invalidUrl')
    )
  })

  it('isUsableHttpUrl 判为非法的输入，走的是 invalidUrl 而不是其它原因', () => {
    expect(isUsableHttpUrl('nope')).toBe(false)
    expect(
      externalMcpUnusableReason({ ...createDefaultExternalMcpServer('http'), url: 'nope' })
    ).toBe('invalidUrl')
  })
})

describe('连接层原因键：主进程会回传的键都必须有文案', () => {
  /**
   * 主进程的 `EXTERNAL_MCP_REASON` 是另一组键（渲染层拼成 `marketplace.ext.reason.*`）。
   * 同样从源码反查，避免两边再次漂移。
   */
  const CLIENT_TS = readFileSync(resolve('src/main/services/externalMcpClient.ts'), 'utf8')

  it('externalMcpClient 里声明的每个 reason 都有对应文案', () => {
    const block = CLIENT_TS.match(/EXTERNAL_MCP_REASON = \{([\s\S]*?)\} as const/)
    expect(block, '没找到 EXTERNAL_MCP_REASON 定义').not.toBeNull()
    const values = [...block![1]!.matchAll(/:\s*'([^']+)'/g)].map((m) => m[1]!)
    expect(values.length).toBeGreaterThan(5)
    for (const value of values) {
      const key = `marketplace.ext.reason.${value}`
      expect(typeof lookup(zh, key), `zh 缺 ${key}`).toBe('string')
      expect(typeof lookup(en, key), `en 缺 ${key}`).toBe('string')
    }
  })
})

describe('动态拼出的 i18n 键也必须存在', () => {
  /**
   * 组件里有几处键是**函数产出**的（不是模板里的静态字面量），静态扫描看不到：
   * `searchPlaceholderKey(category)`、`marketplace.ext.${reason}` 等。
   * 这里按产出侧逐个断言，堵住「代码会请求但文案没加」这类只打 warn 的静默缺口。
   */
  it('四个页签的搜索占位文案都在', () => {
    for (const category of ['all', 'mcp', 'skills', 'plugins'] as const) {
      const key = searchPlaceholderKey(category)
      expect(typeof lookup(zh, key), `zh 缺 ${key}`).toBe('string')
      expect(typeof lookup(en, key), `en 缺 ${key}`).toBe('string')
    }
  })

  it('搜索占位不再残留旧的那句扁平字符串', () => {
    // 改了一半的典型症状：加了新结构但旧键还留着（两者并存会让人不知道哪个在生效）
    // 现在 searchPlaceholder 必须是「按页签分组」的对象，本身不能是字符串
    expect(typeof lookup(zh, 'marketplace.searchPlaceholder')).toBe('object')
    expect(typeof lookup(en, 'marketplace.searchPlaceholder')).toBe('object')
  })

  it('搜索框有无障碍标签（视觉上只有占位，读屏器读不到占位）', () => {
    expect(typeof lookup(zh, 'marketplace.searchAria')).toBe('string')
    expect(typeof lookup(en, 'marketplace.searchAria')).toBe('string')
  })
})

describe('组件里拼出的 i18n 键都在 locale 里', () => {
  it('两个 MCP 组件引用的 marketplace.* 键全部存在', () => {
    const missing: string[] = []
    for (const source of [CLIENT_SOURCE, DIALOG_SOURCE]) {
      // 只取静态字面量键；模板里拼出来的键由上面两组「从产出侧反查」的断言覆盖
      for (const match of source.matchAll(/t\(\s*'(marketplace\.[a-zA-Z0-9_.]+)'/g)) {
        const key = match[1]!
        if (lookup(zh, key) === undefined) missing.push(`zh ${key}`)
        if (lookup(en, key) === undefined) missing.push(`en ${key}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('两个 locale 的 marketplace 子树键集合一致（防止只补一边）', () => {
    const zhMarket = new Set(
      [...zhLeaves].filter((key) => key.startsWith('marketplace.')).map((k) => k)
    )
    const enMarket = new Set(
      [...enLeaves].filter((key) => key.startsWith('marketplace.')).map((k) => k)
    )
    expect([...zhMarket].filter((key) => !enMarket.has(key))).toEqual([])
    expect([...enMarket].filter((key) => !zhMarket.has(key))).toEqual([])
  })
})
