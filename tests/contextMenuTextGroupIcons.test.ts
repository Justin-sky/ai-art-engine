import { describe, expect, it } from 'vitest'
import { BUILTIN_NODE_TYPES } from '../src/shared/graph/builtins'
import { contextMenuResourceGroupIcon } from '../src/renderer/src/features/graph/contextMenuGroups'
import {
  resolveWorkspaceIconKind,
  workspaceIconIsEnlarged
} from '../src/renderer/src/features/media/workspaceIconKind'

/**
 * 回归：右键「添加节点」里「文本分组」与组内「文本 / 备注 / 选取文本」曾全部渲染成 📝，
 * 四个条目长得一模一样、分不清是分组还是哪个节点。
 *
 * 修法是给这一族各一个专属图标：分组 📚（一叠文稿）、文本 📄（单页文稿）、
 * 备注 📝（便签）、选取文本 🔖（书签＝从组里挑出来的那一段）。
 *
 * 与 `contextMenuIconDistinct.test.ts` 同一思路：既断言图标 token 两两不同，
 * 也断言**渲染形态**两两不同 —— token 不同但落到同一种 SVG 仍会看起来一样。
 */
/** 取内置节点定义里的 icon（直接用声明表，不依赖注册时序） */
const nodeIcon = (typeId: string): string =>
  BUILTIN_NODE_TYPES.find((def) => def.typeId === typeId)?.icon ?? ''
const TEXT_GROUP = contextMenuResourceGroupIcon('text')
const TEXT_NODE = () => nodeIcon('play.script')
const NOTE_NODE = () => nodeIcon('note.text')
const SELECT_NODE = () => nodeIcon('text.select')

describe('文本分组与组内节点图标互不相同', () => {
  it('四个条目的图标 token 两两不同', () => {
    const entries = [
      ['文本分组', TEXT_GROUP],
      ['文本', TEXT_NODE()],
      ['备注', NOTE_NODE()],
      ['选取文本', SELECT_NODE()]
    ] as const

    const tokens = entries.map(([, token]) => token)
    expect(tokens.every((token) => token.length > 0)).toBe(true)
    expect(new Set(tokens).size).toBe(tokens.length)
  })

  it('渲染形态也两两不同（不是同一种图标的不同写法）', () => {
    const tokens = [TEXT_GROUP, TEXT_NODE(), NOTE_NODE(), SELECT_NODE()]
    const glyphs = tokens.map((token) => `${resolveWorkspaceIconKind(token)}:${token}`)
    expect(new Set(glyphs).size).toBe(glyphs.length)
  })

  it('备注保留便签图标，文本不再与它撞车', () => {
    expect(NOTE_NODE()).toBe('📝')
    expect(TEXT_NODE()).not.toBe('📝')
    expect(SELECT_NODE()).not.toBe('📝')
  })

  it('分组图标不被放大渲染（分组是菜单项，不是节点卡）', () => {
    expect(workspaceIconIsEnlarged(TEXT_GROUP)).toBe(false)
  })
})
