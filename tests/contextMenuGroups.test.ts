import { describe, expect, it } from 'vitest'
import {
  CONTEXT_MENU_NESTED_CHILD_GROUP_IDS,
  CONTEXT_MENU_NESTED_PARENT_ID,
  contextMenuResourceGroupIcon,
  nestContextMenuResourceGroups,
  type ContextMenuResourceGroup
} from '../src/renderer/src/features/graph/contextMenuGroups'
import { listAddableNodeTypes } from '../src/shared/graph'

type TestItem = { typeId: string }

function group(id: string, typeIds: string[]): ContextMenuResourceGroup<TestItem> {
  return {
    id,
    label: `label:${id}`,
    icon: `icon:${id}`,
    items: typeIds.map((typeId) => ({ typeId }))
  }
}

/** 影视三个阶段分组 + 两组无关分组（顺序模拟组件里按名称排好的清单） */
function fixture(): Array<ContextMenuResourceGroup<TestItem>> {
  return [
    group('image', ['asset.image', 'image.select']),
    group('filmShoot', ['film.render', 'film.shot']),
    group('filmPre', ['asset.screenplay', 'film.breakdown', 'film.review']),
    group('filmArt', ['film.cast']),
    group('ad', ['image.adVariants'])
  ]
}

function idsOf(groups: ReadonlyArray<{ id: string }>): string[] {
  return groups.map((g) => g.id)
}

describe('nestContextMenuResourceGroups', () => {
  it('把影视节点直接平铺收进影视分组（去掉二级分组）', () => {
    const nested = nestContextMenuResourceGroups(fixture(), { label: '影视', icon: '🎦' })

    expect(idsOf(nested)).toEqual(['image', 'ad', CONTEXT_MENU_NESTED_PARENT_ID])

    const parent = nested[2]
    expect(parent.label).toBe('影视')
    expect(parent.icon).toBe('🎦')
    expect(parent.children).toBeUndefined()
    expect(parent.items.map((item) => item.typeId)).toEqual([
      'asset.screenplay',
      'film.breakdown',
      'film.review',
      'film.cast',
      'film.render',
      'film.shot'
    ])
  })

  it('影视组内节点顺序固定为 前期 → 美术 → 拍摄，不跟随输入顺序', () => {
    const shuffled = [...fixture()].reverse()
    const nested = nestContextMenuResourceGroups(shuffled, { label: '影视', icon: '🎦' })
    const parent = nested[nested.length - 1]

    expect(parent.children).toBeUndefined()
    expect(parent.items.map((item) => item.typeId)).toEqual([
      'asset.screenplay',
      'film.breakdown',
      'film.review',
      'film.cast',
      'film.render',
      'film.shot'
    ])
  })

  it('直接传入 filmTv 分组时原样保留节点顺序且无二级分组', () => {
    const nested = nestContextMenuResourceGroups(
      [
        group('image', ['asset.image']),
        group('filmTv', ['asset.novel', 'asset.screenplay', 'film.workbench'])
      ],
      { label: '影视', icon: '🎦' }
    )
    const parent = nested[nested.length - 1]

    expect(parent.id).toBe(CONTEXT_MENU_NESTED_PARENT_ID)
    expect(parent.children).toBeUndefined()
    expect(parent.items.map((item) => item.typeId)).toEqual([
      'asset.novel',
      'asset.screenplay',
      'film.workbench'
    ])
  })

  it('无关分组保持原有顺序与内容', () => {
    const nested = nestContextMenuResourceGroups(fixture(), { label: '影视', icon: '🎦' })

    expect(nested[0].items.map((item) => item.typeId)).toEqual(['asset.image', 'image.select'])
    expect(nested[1].items.map((item) => item.typeId)).toEqual(['image.adVariants'])
  })

  it('只命中部分影视节点时，直接平铺在影视分组下', () => {
    const nested = nestContextMenuResourceGroups(
      [group('image', ['asset.image']), group('filmArt', ['film.cast'])],
      { label: '影视', icon: '🎦' }
    )
    const parent = nested[nested.length - 1]

    expect(nested.length).toBe(2)
    expect(parent.children).toBeUndefined()
    expect(parent.items.map((item) => item.typeId)).toEqual(['film.cast'])
  })

  it('影视节点全部落空时影视分组不出现', () => {
    const nested = nestContextMenuResourceGroups([group('image', ['asset.image'])], {
      label: '影视',
      icon: '🎦'
    })

    expect(idsOf(nested)).toEqual(['image'])
    expect(nested.some((g) => g.id === CONTEXT_MENU_NESTED_PARENT_ID)).toBe(false)
  })

  it('清单为空时不产生影视分组', () => {
    expect(nestContextMenuResourceGroups([], { label: '影视', icon: '🎦' })).toEqual([])
  })

  it('阶段分组图标互不相同，且不与组内节点图标撞', () => {
    const icons = CONTEXT_MENU_NESTED_CHILD_GROUP_IDS.map(contextMenuResourceGroupIcon)
    expect(new Set(icons).size).toBe(icons.length)
    const nodeIcons = new Set(
      listAddableNodeTypes('workflow')
        .filter((def) => def.typeId.startsWith('film.') || def.typeId === 'asset.screenplay')
        .map((def) => def.icon)
    )
    for (const icon of icons) expect(nodeIcons.has(icon)).toBe(false)
  })
})
