/**
 * 2D 帧动画 Inspector「导出 GIF」接线契约。
 *
 * 导出不再是「悄悄落到固定目录」：点按钮先弹资源库目录选择（`SaveAssetDialog`），
 * 确认后才合成并入库。这里锁住三段最容易被改错的接线：
 * 1. 按钮只负责打开对话框，点击时不动磁盘；
 * 2. 确认回调走「合成 → 缓存暂存 → 复制进所选资源库目录并登记 → 刷新素材库」；
 * 3. 中英双语键齐备，且上一版「另存到任意目录」的接线已清干净。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const inspector = readFileSync(
  resolve(__dirname, '../src/renderer/src/components/Anim2dInspector.vue'),
  'utf8'
)

/** 截取 `function <name>(` 到函数体收尾（顶格 `}`）之间的源码 */
function bodyOf(name: string): string {
  const start = inspector.indexOf(`function ${name}(`)
  expect(start, `${name} 应存在于 Anim2dInspector.vue`).toBeGreaterThanOrEqual(0)
  const end = inspector.indexOf('\n}', start)
  expect(end).toBeGreaterThan(start)
  return inspector.slice(start, end)
}

describe('anim2d inspector: 导出 GIF 时选择资源库目录', () => {
  it('按钮打开保存对话框，点击时不动磁盘', () => {
    expect(inspector).toContain('@click="exportGif"')
    expect(inspector).toContain('<SaveAssetDialog')
    expect(inspector).toContain(':open="gifSaveOpen"')
    expect(inspector).toContain('@confirm="onGifSaveConfirm"')

    const body = bodyOf('exportGif')
    expect(body).toContain('gifSaveOpen.value = true')
    expect(body).not.toContain('saveGraphRunMedia')
    expect(body).not.toContain('saveProjectAsset')
  })

  it('确认回调：合成 → 缓存暂存 → 复制进所选目录 → 刷新素材库', () => {
    const body = bodyOf('onGifSaveConfirm')
    const composeIdx = body.indexOf('composeGifFromCells')
    const stageIdx = body.indexOf('saveGraphRunMedia')
    const saveIdx = body.indexOf('saveProjectAsset')
    const refreshIdx = body.indexOf('scheduleRefreshLibrary')
    expect(composeIdx).toBeGreaterThanOrEqual(0)
    expect(stageIdx).toBeGreaterThan(composeIdx)
    expect(saveIdx).toBeGreaterThan(stageIdx)
    expect(refreshIdx).toBeGreaterThan(saveIdx)
    // 目标目录来自对话框选中的资产库文件夹，不是写死的路径
    expect(body).toContain('folderId: payload.folderId')
    // 暂存必须落在缓存目录，避免「刚导出就凭空多出一份资产」
    expect(body).toContain('resolveCacheOutputRoot')
  })

  it('取消不落盘、保存中不可关窗', () => {
    const body = bodyOf('closeGifSave')
    expect(body).toContain('gifSaving.value')
    expect(body).toContain('gifSaveOpen.value = false')
  })

  it('上一版「另存到任意目录」的接线已清干净', () => {
    expect(inspector).not.toContain('exportGifToDirectory')
    expect(inspector).not.toContain('saveBinaryFilesToDirectory')
    expect(inspector).not.toContain('anim-export-to')
  })
})

describe('anim2d GIF 导出文案（中英）', () => {
  for (const [locale, file] of [
    ['zh-CN', '../src/renderer/src/i18n/locales/zh-CN.ts'],
    ['en-US', '../src/renderer/src/i18n/locales/en-US.ts']
  ] as const) {
    it(`${locale} 新键齐备且旧键已删`, () => {
      const text = readFileSync(resolve(__dirname, file), 'utf8')
      for (const key of ['exportGifHint:', 'exportGifTitle:', 'exportGifSubtitle:']) {
        expect(text).toContain(`      ${key}`)
      }
      for (const gone of [
        'exportGifTo:',
        'exportGifToDone:',
        'exportGifToCanceled:',
        'exportGifToHint:'
      ]) {
        expect(text).not.toContain(gone)
      }
    })
  }
})
