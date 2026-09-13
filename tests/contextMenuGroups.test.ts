import { describe, expect, it } from 'vitest'
import {
  CONTEXT_MENU_NESTED_CHILD_GROUP_IDS,
  CONTEXT_MENU_NESTED_PARENT_ID,
  nestContextMenuResourceGroups,
  type ContextMenuResourceGroup
} from '../src/renderer/src/features/graph/contextMenuGroups'

type TestItem = { typeId: string }

function group(id: string, typeIds: string[]): ContextMenuResourceGroup<TestItem> {
  return {
    id,
    label: `label:${id}`,
    icon: `icon:${id}`,
    items: typeIds.map((typeId) => ({ typeId }))
  }
}

/** 影视相关四组 + 两组无关分组（顺序模拟组件里按名称排好的清单） */
function fixture(): Array<ContextMenuResourceGroup<TestItem>> {
  return [
    group('image', ['asset.image', 'image.select']),
    group('beat', ['asset.beat', 'beat.table']),
    group('screenplay', ['asset.screenplay']),
    group('world', ['asset.world', 'world.table']),
    group('episode', ['episode.anchorSelect', 'episode.cellSelect']),
    group('ad', ['image.adVariants'])
  ]
}

function idsOf(groups: ReadonlyArray<{ id: string }>): string[] {
  return groups.map((g) => g.id)
}

describe('nestContextMenuResourceGroups', () => {
  it('把剧本 / 剧集 / 世界元素 / 场 收进影视父级，根菜单不再平铺', () => {
    const nested = nestContextMenuResourceGroups(fixture(), { label: '影视', icon: '🎞️' })

    expect(idsOf(nested)).toEqual(['image', 'ad', CONTEXT_MENU_NESTED_PARENT_ID])

    const parent = nested[2]
    expect(parent.label).toBe('影视')
    expect(parent.icon).toBe('🎞️')
    // 父级只作入口，自身不放节点
    expect(parent.items).toEqual([])
    expect(idsOf(parent.children ?? [])).toEqual([...CONTEXT_MENU_NESTED_CHILD_GROUP_IDS])
  })

  it('二级顺序固定为 剧本 → 剧集 → 世界元素 → 场，不跟随输入顺序', () => {
    const shuffled = [...fixture()].reverse()
    const nested = nestContextMenuResourceGroups(shuffled, { label: '影视', icon: '🎞️' })
    const parent = nested[nested.length - 1]

    expect(parent.children?.map((g) => g.label)).toEqual([
      'label:screenplay',
      'label:episode',
      'label:world',
      'label:beat'
    ])
  })

  it('子分组节点清单与图标原样保留，未被改写', () => {
    const nested = nestContextMenuResourceGroups(fixture(), { label: '影视', icon: '🎞️' })
    const parent = nested[nested.length - 1]
    const screenplay = parent.children?.find((g) => g.id === 'screenplay')
    const beat = parent.children?.find((g) => g.id === 'beat')

    expect(screenplay?.items).toEqual([{ typeId: 'asset.screenplay' }])
    expect(beat?.icon).toBe('icon:beat')
    expect(beat?.items.map((item) => item.typeId)).toEqual(['asset.beat', 'beat.table'])
    expect(beat?.children).toBeUndefined()
  })

  it('无关分组保持原有顺序与内容', () => {
    const nested = nestContextMenuResourceGroups(fixture(), { label: '影视', icon: '🎞️' })

    expect(nested[0].items.map((item) => item.typeId)).toEqual(['asset.image', 'image.select'])
    expect(nested[1].items.map((item) => item.typeId)).toEqual(['image.adVariants'])
  })

  it('只命中部分子分组时，父级下只挂存在的分组', () => {
    const nested = nestContextMenuResourceGroups(
      [group('image', ['asset.image']), group('world', ['asset.world'])],
      { label: '影视', icon: '🎞️' }
    )
    const parent = nested[nested.length - 1]

    expect(nested.length).toBe(2)
    expect(idsOf(parent.children ?? [])).toEqual(['world'])
  })

  it('四个子分组全部落空时父级不出现', () => {
    const nested = nestContextMenuResourceGroups([group('image', ['asset.image'])], {
      label: '影视',
      icon: '🎞️'
    })

    expect(idsOf(nested)).toEqual(['image'])
    expect(nested.some((g) => g.id === CONTEXT_MENU_NESTED_PARENT_ID)).toBe(false)
  })

  it('清单为空时不产生父级', () => {
    expect(nestContextMenuResourceGroups([], { label: '影视', icon: '🎞️' })).toEqual([])
  })
})
