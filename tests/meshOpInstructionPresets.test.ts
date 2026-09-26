import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  listInstructionPresets,
  type InstructionPresetKind
} from '../src/shared/graph/instructionPresets'

/**
 * 3D 分组节点的指令预设：
 * - 吃文本的节点（拆分点名 / 动画组合 / 贴图材质）必须有预设；
 * - 指令框只是「部件名列表」或没有输入的节点保持无预设，但**预设按钮必须隐藏**，
 *   不能留一个点了没反应的按钮（曾经就是 `v-if="presetKind"` 而菜单要 presets.length）。
 */
const CARD = readFileSync(resolve('src/renderer/src/components/GraphNodeCard.vue'), 'utf8')
const EDITOR = readFileSync(
  resolve('src/renderer/src/components/GraphInstructionMentionEditor.vue'),
  'utf8'
)

const WITH_PRESETS: InstructionPresetKind[] = ['modelSegment', 'modelRetarget', 'modelTexture']
const WITHOUT_PRESETS: InstructionPresetKind[] = [
  'modelMeshComplete',
  'modelRetopology',
  'modelRigCheck',
  'modelConvert'
]

describe('3D 节点指令预设', () => {
  it('吃文本的三个节点都有预设，且体量够用', () => {
    for (const kind of WITH_PRESETS) {
      const presets = listInstructionPresets(kind)
      expect(presets.length, `${kind} 缺预设`).toBeGreaterThanOrEqual(6)
      for (const preset of presets) {
        expect(preset.body.trim().length, `${kind}.${preset.id} body 为空`).toBeGreaterThan(0)
        expect(preset.titleKey).toMatch(/^graph\.inspector\.generate\.presets\./)
      }
      // 同一 kind 内 id 不重复
      expect(new Set(presets.map((p) => p.id)).size).toBe(presets.length)
    }
  })

  it('部件名 / 无输入的四类节点保持无预设（按钮隐藏）', () => {
    for (const kind of WITHOUT_PRESETS) {
      expect(listInstructionPresets(kind), `${kind} 不该有预设`).toEqual([])
    }
    // 预设是按需动态加载的（点按钮才 import）：按钮判定绝不能依赖 presets.length，
    // 否则「点开才加载」与「加载了才显示」互锁，所有节点的预设按钮都会消失。
    expect(EDITOR).toMatch(/v-if="presetKind"\n\s+ref="presetBtnEl"/)
    expect(EDITOR).not.toMatch(/v-if="presetKind && presets\.length"/)
    // 空预设改为在菜单里给一行说明，而不是让菜单不出现
    expect(EDITOR).toMatch(/v-if="menuOpen"/)
    expect(EDITOR).toMatch(/preset-empty/)
    expect(EDITOR).toMatch(/graph\.inspector\.generate\.presets\.empty/)
    expect(EDITOR).not.toMatch(
      /await ensurePresetsLoaded\(\)\n\s+if \(!presets\.value\.length\) return/
    )
  })

  it('每个预设的 titleKey 在两种语言里都有文案', () => {
    const locales = ['zh-CN', 'en-US'] as const
    const sources = Object.fromEntries(
      locales.map((locale) => [
        locale,
        readFileSync(resolve(`src/renderer/src/i18n/locales/${locale}.ts`), 'utf8')
      ])
    ) as Record<(typeof locales)[number], string>

    const kinds: InstructionPresetKind[] = [...WITH_PRESETS, 'modelRigSkin', 'modelPose']
    for (const kind of kinds) {
      for (const preset of listInstructionPresets(kind)) {
        const key = preset.titleKey.split('.').pop()!
        for (const locale of locales) {
          expect(sources[locale], `${locale} 缺 ${preset.titleKey}`).toMatch(
            new RegExp(`\\b${key}:\\s*['"]`)
          )
        }
      }
    }
  })

  it('动作库型供应商的重定向不给预设（避免写入它不认的 preset:xxx）', () => {
    expect(CARD).toMatch(/const effectivePresetKind = computed/)
    expect(CARD).toMatch(/meshOpCaps\(selectedProviderKind\.value\)\?\.retargetIds === 'library'/)
    expect(CARD).not.toMatch(/:preset-kind="instructionKind"/)
    expect((CARD.match(/:preset-kind="effectivePresetKind"/g) ?? []).length).toBe(2)
  })

  it('预设菜单标题覆盖三个新 kind', () => {
    for (const key of ['titleModelSegment', 'titleModelRetarget', 'titleModelTexture']) {
      expect(EDITOR, `编辑器缺 ${key}`).toMatch(new RegExp(`presets\\.${key}`))
      for (const locale of ['zh-CN', 'en-US']) {
        const file = resolve(`src/renderer/src/i18n/locales/${locale}.ts`)
        expect(existsSync(file)).toBe(true)
        expect(readFileSync(file, 'utf8'), `${locale} 缺 ${key}`).toMatch(
          new RegExp(`${key}:\\s*['"]`)
        )
      }
    }
  })
})
