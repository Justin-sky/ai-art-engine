import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 拖进画面的 3D 模型没有应用内编辑器：双击**不作响应**。
 *
 * 以前的 bug：模型资产不被 `isImportedRefAsset` 认成引用（`isImportedMediaRefAsset` 只覆盖
 * 图/声/视/剧本），于是双击落进「宿主资产 dive」分支错误地调 `diveAsset`，打开一个空编辑器。
 * 组件在 node 环境渲染不了，按仓库既有做法做源码守卫（先剥注释，免得假通过）。
 */
const source = readFileSync(
  join(process.cwd(), 'src/renderer/src/components/GraphNodeCard.vue'),
  'utf8'
).replace(/\/\*[\s\S]*?\*\//g, '')

describe('3D 模型节点双击不作响应', () => {
  it('有无应用内编辑器的判断：model / motion2d 没有', () => {
    expect(source).toContain('const assetHasInAppEditor = computed(')
    expect(source).toContain("type !== 'model' && type !== 'motion2d'")
  })

  it('宿主资产 dive 分支受 assetHasInAppEditor 把关（模型不会误开 diveAsset）', () => {
    expect(source).toContain(
      'if (isAssetRef.value && !isImportedRefAsset.value && assetHasInAppEditor.value) {'
    )
    expect(source).toMatch(
      /isAssetRef\.value && !isImportedRefAsset\.value && assetHasInAppEditor\.value[\s\S]*?diveAsset/
    )
  })

  it('可下钻宿主（📦 徽标）也要求有编辑器：模型不显示下钻入口', () => {
    expect(source).toMatch(/canDiveIntoHost = computed\([\s\S]{0,220}assetHasInAppEditor\.value/)
  })
})
