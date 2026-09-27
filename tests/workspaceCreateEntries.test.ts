import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  WORKSPACE_TOOLBAR_EXCLUDED_ASSET_TYPES,
  WORKSPACE_TOOLBAR_ITEMS,
  listWorkspaceToolbarItems
} from '../src/shared/workspaceToolbar'
import { MCP_CREATABLE_ASSET_TYPES, isMcpCreatableAssetType } from '../src/shared/mcpAssetWrite'

/**
 * 两条与「新建」有关的约定：
 *
 * 1. `gamePlay` 不再有任何手工新建入口——游戏由对话里的 `gameplay_*` 工具链生成并自动登记，
 *    手工建出来的空壳没有编辑器能挂上真实游戏（三个入口共用同一份条目清单，所以清单即真相）；
 * 2. 2D 动作资产没有独立编辑页，三个「新建」入口都必须走 `createMotion2dActionAsset`
 *    （建好 + 选中 + 资产库定位 + 预览弹窗），否则点击看起来毫无反应。
 */
function readSrc(...parts: string[]): string {
  return readFileSync(resolve('src', ...parts), 'utf8')
}

describe('新建菜单条目', () => {
  it('可玩 HTML 不在条目清单里（工具栏与资产右键菜单共用这一份）', () => {
    expect(WORKSPACE_TOOLBAR_ITEMS.some((item) => item.assetType === 'gamePlay')).toBe(false)
    expect(WORKSPACE_TOOLBAR_EXCLUDED_ASSET_TYPES).toContain('gamePlay')
    for (const options of [{ toolbar: true }, { assetMenu: true }]) {
      const types = listWorkspaceToolbarItems(undefined, options).map((item) => item.assetType)
      expect(types).not.toContain('gamePlay')
      // 其它入口不受影响（回归护栏：别把整份清单误删）
      expect(types).toContain('image')
      expect(types).toContain('motion2d')
      expect(types).toContain('voice')
    }
  })

  it('即使条目清单里被塞回 gamePlay 也会被排除（排除是按类型而非按条目）', () => {
    const injected = listWorkspaceToolbarItems(
      [
        ...WORKSPACE_TOOLBAR_ITEMS,
        { id: 'gamePlayInjected', assetType: 'gamePlay', openOnCreate: true }
      ],
      { toolbar: true }
    ).map((item) => item.assetType)
    expect(injected).not.toContain('gamePlay')
  })

  it('MCP asset_create 也不再允许建可玩 HTML（白名单注释与实现一致）', () => {
    expect(isMcpCreatableAssetType('gamePlay')).toBe(false)
    expect(MCP_CREATABLE_ASSET_TYPES).not.toContain('gamePlay')
    // motion2d 仍可建：它有一条真实的写入路径（stage.2d 节点对话框保存 / 载入）
    expect(isMcpCreatableAssetType('motion2d')).toBe(true)
  })

  it('asset_create 的工具描述把「改用对话链路」写清楚了', () => {
    const src = readSrc('main', 'services', 'mcpServerService.ts')
    expect(src).toMatch(/可玩 HTML（gamePlay）不在其中/)
    expect(src).toMatch(/gameplay_prepare_project → 写 src\/\*\* → gameplay_build/)
  })
})

describe('2D 动作新建入口', () => {
  it('三个入口都走统一入口 createMotion2dActionAsset', () => {
    for (const file of [
      ['renderer', 'src', 'components', 'WorkspaceToolbar.vue'],
      ['renderer', 'src', 'components', 'WorkspaceMain.vue'],
      ['renderer', 'src', 'components', 'AssetBrowser.vue']
    ] as const) {
      const src = readSrc(...file)
      expect(src, `${file.join('/')} 未接统一入口`).toMatch(/createMotion2dActionAsset\(/)
      expect(src, `${file.join('/')} 未判 motion2d`).toMatch(/assetType === 'motion2d'/)
    }
  })

  it('统一入口本身给出可见反馈：选中 + 资产库定位 + 预览弹窗', () => {
    const src = readSrc('renderer', 'src', 'composables', 'useAssetCreation.ts')
    const fn = src.slice(src.indexOf('async function createMotion2dActionAsset'))
    expect(fn).toMatch(/createAsset\('motion2d'/)
    expect(fn).toMatch(/openEditor: false/)
    expect(fn).toMatch(/workspace\.selectAsset\(asset\.id\)/)
    expect(fn).toMatch(/workspace\.revealAssetInBrowser\(asset\.id\)/)
    expect(fn).toMatch(
      /openMotion2dActionPreviewDialog\(\{ assetId: asset\.id, title: asset\.name \}\)/
    )
  })

  it('草稿路径不再吞掉 2D 动作（onCreate 里 motion2d 分支必须在 deferSave 之前）', () => {
    const src = readSrc('renderer', 'src', 'components', 'WorkspaceToolbar.vue')
    // 只看 onCreate 内部：createFreeCanvas 也有一个 deferSave 分支，别被它带偏
    const body = src.slice(src.indexOf('async function onCreate'))
    const motion2d = body.indexOf("assetType === 'motion2d'")
    const draft = body.indexOf('if (props.deferSave)')
    expect(motion2d).toBeGreaterThan(-1)
    expect(draft).toBeGreaterThan(-1)
    expect(motion2d).toBeLessThan(draft)
  })
})
