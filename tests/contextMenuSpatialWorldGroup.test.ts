import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BUILTIN_NODE_TYPES } from '../src/shared/graph/builtins'
import { contextMenuResourceGroupIcon } from '../src/renderer/src/features/graph/contextMenuGroups'
import enUS from '../src/renderer/src/i18n/locales/en-US'
import zhCN from '../src/renderer/src/i18n/locales/zh-CN'

/**
 * 「空间世界」右键分组：空间世界生成（`asset.spatialWorld`）单独成组，不再挂在「3D」分组下。
 *
 * 分组清单直接声明在 `NodeGraphEditor.vue` 里，没有独立常量模块可导入，所以按源码扫描守卫：
 * 组内成员、与「3D」分组不重叠、分组图标不与组内节点撞图标、文案键两侧语言都齐全。
 */
const EDITOR = resolve('src/renderer/src/components/NodeGraphEditor.vue')

function editorSource(): string {
  return readFileSync(EDITOR, 'utf8')
}

/** 截取 CONTEXT_MENU_RESOURCE_GROUPS 声明块（到下一段声明为止） */
function groupsBlock(): string {
  const src = editorSource()
  const start = src.indexOf('const CONTEXT_MENU_RESOURCE_GROUPS')
  expect(start, '未找到 CONTEXT_MENU_RESOURCE_GROUPS').toBeGreaterThan(-1)
  const end = src.indexOf('* 剧集 Agent 流水线手动创建预设', start)
  expect(end, '未找到分组清单结尾锚点').toBeGreaterThan(start)
  return src.slice(start, end)
}

function typeIdsOf(id: string): string[] {
  const group = new RegExp(`id: '${id}',\\s*typeIds: \\[([^\\]]*)\\]`).exec(groupsBlock())?.[1]
  expect(group, `分组 ${id} 不存在`).toBeDefined()
  return [...(group ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]!)
}

function readMessage(messages: unknown, key: string): string | null {
  let cursor: unknown = messages
  for (const part of key.split('.')) {
    if (!cursor || typeof cursor !== 'object') return null
    cursor = (cursor as Record<string, unknown>)[part]
  }
  return typeof cursor === 'string' && cursor.trim() ? cursor : null
}

describe('右键菜单「空间世界」分组', () => {
  it('空间世界分组收空间世界生成 + 空间世界导出', () => {
    expect(typeIdsOf('spatialWorld')).toEqual(['asset.spatialWorld', 'spatialWorld.export'])
  })

  it('空间世界生成不再出现在「3D」分组里（避免同一条目挂两组）', () => {
    const model3d = typeIdsOf('model3d')
    expect(model3d).toContain('asset.model3d')
    expect(model3d).not.toContain('asset.spatialWorld')
  })

  it('分组图标与组内节点图标不同（分组 🌍 与节点 🌍 撞车就分不清层级）', () => {
    const nodeIcon =
      BUILTIN_NODE_TYPES.find((def) => def.typeId === 'asset.spatialWorld')?.icon ?? ''
    expect(nodeIcon).toBe('🌍')
    const groupIcon = contextMenuResourceGroupIcon('spatialWorld')
    expect(groupIcon).not.toBe(nodeIcon)
    // 「世界元素」分组用的是资产图标 🤺，也不要撞
    expect(groupIcon).not.toBe(BUILTIN_NODE_TYPES.find((d) => d.typeId === 'asset.world')?.icon)
  })

  it('分组文案键在中英两语言里都有（否则回落到原始 id）', () => {
    const key = 'graph.context.groups.spatialWorld'
    expect(readMessage(zhCN, key)).toBe('空间世界')
    expect(readMessage(enUS, key)).toBe('Spatial world')
  })
})
