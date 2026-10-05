import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BUILTIN_NODE_TYPES } from '../src/shared/graph/builtins'
import { isNodeAddableInScope } from '../src/shared/graph'

/**
 * 右键菜单「声音」分组。
 *
 * 分组直接声明在 `NodeGraphEditor.vue` 里，没有独立常量模块可导入、也没有类型
 * 能约束「哪个 typeId 归在哪一组」，所以按源码扫描守住结构约定。
 *
 * 背景：多说话人对话与音效是**声音资产的变体节点**（同一 AssetType、同一产物类型），
 * 归组前它们会落进根菜单（rootAddableMenuItems 兜底），与「声音生成」分散在两处。
 */
const EDITOR = resolve('src/renderer/src/components/NodeGraphEditor.vue')

function editorSource(): string {
  return readFileSync(EDITOR, 'utf8')
}

/** 截取 CONTEXT_MENU_RESOURCE_GROUPS 声明块（到剧集预设声明为止） */
function groupsBlock(): string {
  const src = editorSource()
  const start = src.indexOf('const CONTEXT_MENU_RESOURCE_GROUPS')
  expect(start, '未找到 CONTEXT_MENU_RESOURCE_GROUPS').toBeGreaterThan(-1)
  const end = src.indexOf('* 剧集 Agent 流水线手动创建预设', start)
  expect(end, '未找到分组清单结尾锚点').toBeGreaterThan(start)
  return src.slice(start, end)
}

/** 取某一组的 typeIds：容忍多行数组写法 */
function voiceGroupTypeIds(): string[] {
  const block = groupsBlock()
  const start = block.indexOf("id: 'voice'")
  expect(start, '未找到 voice 分组').toBeGreaterThan(-1)
  const arrayStart = block.indexOf('[', start)
  const arrayEnd = block.indexOf(']', arrayStart)
  return [...block.slice(arrayStart, arrayEnd).matchAll(/'([^']+)'/g)].map((m) => m[1]!)
}

describe('右键菜单声音分组', () => {
  it('三个生成节点与声音选择同组（对话 / 音效 / 音乐不再散在根菜单）', () => {
    expect(voiceGroupTypeIds()).toEqual([
      'asset.voice',
      'asset.dialogue',
      'asset.sfx',
      'asset.music',
      'voice.select'
    ])
  })

  it('归组后它们不再落进根菜单：每个新节点都必须在某个分组里', () => {
    // rootAddableMenuItems 的兜底条件是「不在 CONTEXT_MENU_GROUPED_TYPE_IDS 内」，
    // 该集合由分组表 flatMap 而来 —— 所以进了分组就等于离开根菜单
    const grouped = new Set(
      [...groupsBlock().matchAll(/'([a-z][a-zA-Z0-9]*\.[a-zA-Z0-9.]+)'/g)].map((m) => m[1]!)
    )
    for (const typeId of ['asset.dialogue', 'asset.sfx', 'asset.music']) {
      expect(grouped.has(typeId), `${typeId} 未归入任何分组`).toBe(true)
    }
  })

  it('两个节点在默认策略下可添加（否则分组里也看不到它们）', () => {
    for (const typeId of ['asset.dialogue', 'asset.sfx', 'asset.music'] as const) {
      const def = BUILTIN_NODE_TYPES.find((d) => d.typeId === typeId)
      expect(def?.addable, typeId).toBe(true)
      expect(isNodeAddableInScope('workflow', typeId), typeId).toBe(true)
    }
  })
})
