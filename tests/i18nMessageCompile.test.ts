import { describe, expect, it } from 'vitest'
import { createI18n } from 'vue-i18n'
import zhCN from '../src/renderer/src/i18n/locales/zh-CN'
import enUS from '../src/renderer/src/i18n/locales/en-US'

/**
 * 所有 i18n 文案都必须能**编译**。
 *
 * 背景（实测踩到）：`editsJsonPlaceholder` 里直接写了 JSON 示例
 * `[{"kind":"replaceEntity",…}]` —— vue-i18n 把 `{…}` 当插值占位符，
 * 编译时抛 `Invalid token in placeholder`，而这条文案在检查器里被 `t()` 用到，
 * **整个检查器面板就不渲染了**（用户看到"选中节点 inspector 没有显示"）。
 *
 * 花括号要写成字面量：`{'[{"kind":…}]'}`（或用 `{'{'}` 逐个转义）。
 */

function leaves(value: unknown, prefix = ''): Array<{ key: string; text: string }> {
  if (typeof value === 'string') return [{ key: prefix, text: value }]
  if (!value || typeof value !== 'object') return []
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    leaves(child, prefix ? `${prefix}.${key}` : key)
  )
}

describe('i18n 文案可编译（花括号必须转义）', () => {
  for (const [name, messages] of [
    ['zh-CN', zhCN],
    ['en-US', enUS]
  ] as const) {
    it(`${name}：每条文案都能 t() 出来`, () => {
      const items = leaves(messages)
      expect(items.length).toBeGreaterThan(100)
      const i18n = createI18n({
        legacy: false,
        locale: name,
        fallbackLocale: name,
        missingWarn: false,
        fallbackWarn: false,
        messages: { [name]: messages as Record<string, unknown> }
      })
      const t = i18n.global.t as (key: string) => string
      const failures: string[] = []
      for (const item of items) {
        try {
          const out = t(item.key)
          // 键没解析出来（返回原 key）说明文案树里有问题
          if (out === item.key) failures.push(`${item.key} → 未解析`)
        } catch (e) {
          failures.push(`${item.key} → ${e instanceof Error ? e.message : String(e)}`)
        }
      }
      expect(failures, failures.join('\n')).toEqual([])
    })
  }

  it('转义后的文案要原样渲染出花括号与 @（不是转义语法本身）', () => {
    const i18n = createI18n({
      legacy: false,
      locale: 'zh-CN',
      fallbackLocale: 'zh-CN',
      missingWarn: false,
      fallbackWarn: false,
      messages: { 'zh-CN': zhCN as Record<string, unknown> }
    })
    const t = i18n.global.t as (key: string, named?: Record<string, unknown>) => string
    // 编译节点的提示词覆盖占位符：JSON 要原样出现
    const placeholder = t('graph.inspector.semantic.promptOverridesPlaceholder')
    expect(placeholder).toContain('{"shot.001.0"')
    expect(placeholder.endsWith('}')).toBe(true)
    // 人脸模型来源提示里的 @ 路径要原样出现
    expect(t('settings.yoloModels.faceSourceMissing')).toContain('@shared/yoloCatalog')
    // 带插值的 @ 文案：@ 是字面量，{fps} 仍然插值
    const gif = t('graph.anim2d.runGifDone', { path: 'a.gif', frames: 3, fps: 12 })
    expect(gif).toContain('@ 12')
    expect(gif).toContain('3 帧')
  })
})
