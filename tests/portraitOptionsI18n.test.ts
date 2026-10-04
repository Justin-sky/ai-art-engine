import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PORTRAIT_PARAM_SPECS } from '@shared/graph'
import enUS from '../src/renderer/src/i18n/locales/en-US'
import zhCN from '../src/renderer/src/i18n/locales/zh-CN'

/**
 * 人像参数的「具名选项」文案覆盖：`graph.portrait.options.<选项值>`。
 *
 * 曾经的线上问题：编辑器里维护了一份「哪些字段要翻译」的白名单，漏登记了证件照规格，
 * 于是下拉框里显示 `oneInch` / `socialSecurity` 这种裸令牌，既不报错也不显眼。
 * 这里按 spec 全量扫一遍：任何新增枚举选项只要忘了加中英文案就会红。
 */

type LocaleShape = { graph: { portrait: { options: Record<string, string> } } }

const LOCALES: Array<[string, LocaleShape]> = [
  ['zh-CN', zhCN as unknown as LocaleShape],
  ['en-US', enUS as unknown as LocaleShape]
]

const ROOT = join(__dirname, '..')
const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8')

describe('人像处理具名选项文案', () => {
  it('每个枚举 spec 的每个选项都有中英文案', () => {
    const enumSpecs = PORTRAIT_PARAM_SPECS.filter((spec) => spec.kind === 'enum')
    expect(enumSpecs.length, '没扫到枚举 spec，断言可能失效').toBeGreaterThan(0)

    const missing: string[] = []
    for (const [name, locale] of LOCALES) {
      const options = locale.graph.portrait.options ?? {}
      for (const spec of enumSpecs) {
        for (const option of spec.options) {
          if (!options[option]) {
            missing.push(`${name}: graph.portrait.options.${option}（${spec.key}）`)
          }
        }
      }
    }
    expect(missing, `缺这些选项文案：\n${missing.join('\n')}`).toEqual([])
  })

  it('证件照规格的每个取值都有文案（这次的回归点）', () => {
    const spec = PORTRAIT_PARAM_SPECS.find((item) => item.key === 'idPhotoSpecId')
    expect(spec, 'idPhotoSpecId 不在 spec 表里').toBeTruthy()
    for (const [name, locale] of LOCALES) {
      const options = locale.graph.portrait.options ?? {}
      for (const option of spec!.options) {
        expect(options[option], `${name} 缺 ${option}`).toBeTruthy()
      }
    }
  })

  it('编辑器不再维护「要翻译的字段」白名单，改用 te() 探测', () => {
    const dialog = read('src/renderer/src/components/PortraitEditorDialog.vue')
    expect(dialog).not.toContain('OPTION_LABEL_KEYS')
    expect(dialog).toContain('const { t, te } = useStudioI18n()')
    const label = /function optionLabel\([\s\S]*?\n\}/.exec(dialog)
    expect(label, 'optionLabel 不见了').toBeTruthy()
    expect(label![0]).toContain('te(key)')
    // 没有文案的值原样显示，绝不把 key 路径当文案渲染出来
    expect(label![0]).toContain(': option')
    // 具名选项这一处必须走 optionLabel（而不是直接渲染裸令牌）
    expect(dialog).toContain('{{ optionLabel(option) }}')
  })
})
