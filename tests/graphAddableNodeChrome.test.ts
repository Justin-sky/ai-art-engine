/**
 * 可添加节点的「卡片壳 / 菜单分组 / 文案」防回归。
 *
 * ## 为什么新工具节点总误用 note 卡？
 *
 * `category` 只有 `asset | output | note` 三档——**几乎所有加工/工具节点都必须 `category: 'note'`**。
 * 但 `card: 'note'` 是另一回事：它会选中 `GraphNoteCard`（记事本壳，双击开记事本）。
 * 文档示例与插件模板常写 `card: 'note'`，Agent/新人把 category 与 card 当成同义词，就会反复踩坑。
 *
 * 正确对照：`video.framePull` → `category: 'note'` + `card: 'media'`。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createI18n } from 'vue-i18n'
import zhCN from '../src/renderer/src/i18n/locales/zh-CN'
import enUS from '../src/renderer/src/i18n/locales/en-US'
import { BUILTIN_NODE_TYPES, ensureBuiltinNodeTypes } from '../src/shared/graph/builtins'
import { resolveGraphTypeLabel } from '../src/renderer/src/features/graph/model/graphNodeDisplayTitle'

/** 真正该用记事本卡的 typeId */
const NOTE_CARD_ALLOWLIST = new Set([
  'note.text',
  'play.script',
  'graph.input.slot',
  'graph.boundary.input',
  'graph.boundary.output'
])

/**
 * 故意留在根菜单的 typeId（NodeGraphEditor 注释：上游接口槽 / 宿主边界 / 束结等）。
 * 新的业务工具节点**不要**往这里加——应进 CONTEXT_MENU_RESOURCE_GROUPS。
 */
const ROOT_MENU_ALLOWLIST = new Set([
  'decisions.judge',
  'media.bundle',
  'graph.input.slot',
  'graph.boundary.input',
  'graph.boundary.output'
])

const EDITOR = resolve('src/renderer/src/components/NodeGraphEditor.vue')

function groupsBlock(): string {
  const src = readFileSync(EDITOR, 'utf8')
  const start = src.indexOf('const CONTEXT_MENU_RESOURCE_GROUPS')
  expect(start).toBeGreaterThan(-1)
  const end = src.indexOf('* 剧集 Agent 流水线手动创建预设', start)
  expect(end).toBeGreaterThan(start)
  return src.slice(start, end)
}

function groupedTypeIds(): Set<string> {
  return new Set(
    [...groupsBlock().matchAll(/'([a-z][a-zA-Z0-9]*\.[a-zA-Z0-9.]+)'/g)].map((m) => m[1]!)
  )
}

describe('可添加节点 chrome 约定', () => {
  ensureBuiltinNodeTypes()
  const addable = BUILTIN_NODE_TYPES.filter((d) => d.addable)

  it('工具节点不得误用 card: note（除非在记事本白名单）', () => {
    const offenders = addable
      .filter((d) => d.card === 'note' && !NOTE_CARD_ALLOWLIST.has(d.typeId))
      .map((d) => d.typeId)
    expect(
      offenders,
      'category=note ≠ card=note。工具节点请用 card: media（参考 video.framePull）'
    ).toEqual([])
  })

  it('业务工具节点必须进右键资源分组（禁止再散落根菜单）', () => {
    const grouped = groupedTypeIds()
    const missing = addable
      .map((d) => d.typeId)
      .filter((id) => !grouped.has(id) && !ROOT_MENU_ALLOWLIST.has(id))
      .sort()
    expect(missing, '请把 typeId 写进 NodeGraphEditor.vue 的 CONTEXT_MENU_RESOURCE_GROUPS').toEqual(
      []
    )
  })

  it('每个可添加节点的展示名都能经 resolveGraphTypeLabel 解析（中英）', () => {
    for (const locale of ['zh-CN', 'en-US'] as const) {
      const messages = locale === 'zh-CN' ? zhCN : enUS
      const i18n = createI18n({
        legacy: false,
        locale,
        messages: { [locale]: messages }
      })
      const t = i18n.global.t as (key: string, params?: Record<string, unknown>) => string
      const te = i18n.global.te as (key: string) => boolean
      const bad: string[] = []
      for (const def of addable) {
        const label = resolveGraphTypeLabel(def.typeId, t, te)
        if (!label || label === def.typeId) bad.push(`${locale}:${def.typeId}`)
      }
      expect(bad, '缺 graph.types.* 或 asset.type.* 回退文案').toEqual([])
    }
  })
})
