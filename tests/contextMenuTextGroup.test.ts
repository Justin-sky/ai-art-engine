import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 右键菜单的资源分组直接声明在 `NodeGraphEditor.vue` 里，没有独立的常量模块可导入，
 * 也没有类型能约束「哪个 typeId 归在哪一组」，因此这里按源码扫描守住两条结构性约定：
 *
 * 1. 文本类节点（文本 / 选取文本 / 备注 / 提示词优化 / 图片反推提示词）都在「文本」分组下；
 * 2. 不再存在独立的「提示词」分组——组 id、分组清单与文案键三处都要清干净，
 *    否则会出现「空分组」（items 为空被 filter 掉，但 id / 文案残留）或孤立文案键。
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
  const block = groupsBlock()
  const group = new RegExp(`id: '${id}',\\s*typeIds: \\[([^\\]]*)\\]`).exec(block)?.[1]
  expect(group, `分组 ${id} 不存在`).toBeDefined()
  return [...(group ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]!)
}

describe('右键菜单文本分组', () => {
  it('文本分组收齐文本 / 备注 / 提示词三类节点', () => {
    expect(typeIdsOf('text')).toEqual([
      'play.script',
      'text.select',
      'note.text',
      'prompt.optimize',
      'image.toPrompt'
    ])
  })

  it('提示词分组已删除（组清单 / id 联合类型 / 标签与图标分支都不再提 prompt）', () => {
    expect(groupsBlock()).not.toMatch(/id: 'prompt'/)
    expect(editorSource()).not.toMatch(/'prompt'/)
    expect(editorSource()).not.toMatch(/group\.id === 'prompt'/)
  })

  it('孤立文案键同步删除（两侧语言都不留 groups.prompt）', () => {
    for (const file of ['zh-CN.ts', 'en-US.ts']) {
      const src = readFileSync(resolve('src/renderer/src/i18n/locales', file), 'utf8')
      const block = /groups: \{([^}]*)\}/.exec(src)?.[1] ?? ''
      expect(block, `${file} 的 graph.context.groups`).not.toMatch(/\bprompt:/)
    }
  })
})
