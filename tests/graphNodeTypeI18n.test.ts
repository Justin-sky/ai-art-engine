import { describe, expect, it } from 'vitest'
import { BUILTIN_NODE_TYPES } from '../src/shared/graph/builtins'
import { listInstructionPresets } from '../src/shared/graph/instructionPresets'
import enUS from '../src/renderer/src/i18n/locales/en-US'
import zhCN from '../src/renderer/src/i18n/locales/zh-CN'

/**
 * 界面里的节点类型名走 `graph.types.<typeId>`（`useStudioI18n.graphTypeLabel` /
 * `resolveGraphTypeLabel`，未命中回退原始 typeId，界面上就会出现 `svg.anim` 这种字样），
 * 而节点定义里的 `label` / `defaultTitle` 只是库存标题、不参与该展示路径。
 * 这里按 typeId 的每一段逐级下钻，确保新增节点类型时中英文案同步补齐。
 */
function readTypeLabel(messages: unknown, typeId: string): string | null {
  let cursor: unknown = (messages as { graph?: { types?: unknown } } | null)?.graph?.types
  for (const part of typeId.split('.')) {
    if (!cursor || typeof cursor !== 'object') return null
    cursor = (cursor as Record<string, unknown>)[part]
  }
  return typeof cursor === 'string' && cursor.trim() ? cursor : null
}

describe('内置节点类型的 graph.types 文案', () => {
  it('每个可展示的节点类型在中英文案里都能查到（asset.* 走单列分支，不在此列）', () => {
    const missing: string[] = []
    for (const def of BUILTIN_NODE_TYPES) {
      // asset.* 走 graph.types.asset.<kind> 分支；带 presentation.defaultTitleKey 的节点
      // （输入槽 / 子图边界等）由专属文案键展示，都不经 graph.types.<typeId>
      if (def.typeId.startsWith('asset.')) continue
      if (def.presentation?.defaultTitleKey) continue
      if (!readTypeLabel(zhCN, def.typeId)) missing.push(`zh:${def.typeId}`)
      if (!readTypeLabel(enUS, def.typeId)) missing.push(`en:${def.typeId}`)
    }
    expect(missing).toEqual([])
  })

  it('SVG 烘焙节点在中英文案里都有类型名', () => {
    expect(readTypeLabel(zhCN, 'svg.anim')).toBe('SVG 烘焙')
    expect(readTypeLabel(enUS, 'svg.anim')).toBe('SVG Bake')
  })
})

function readMessage(messages: unknown, key: string): string | null {
  let cursor: unknown = messages
  for (const part of key.split('.')) {
    if (!cursor || typeof cursor !== 'object') return null
    cursor = (cursor as Record<string, unknown>)[part]
  }
  return typeof cursor === 'string' && cursor.trim() ? cursor : null
}

/**
 * 双击卡片展开的「生成指令」面板：占位提示词由 GraphNodeCard 按 instructionKind 分派，
 * 漏分支会静默落到剧本扩写的默认文案（svg.gen 就曾显示「扩写为完整故事脚本」）。
 */
describe('生成指令面板的占位提示词与预设', () => {
  it('svg.gen 有专属占位提示词，且与默认剧本文案不同', () => {
    const key = 'graph.inspector.generate.svgGenInstructionPlaceholder'
    const zh = readMessage(zhCN, key)
    const en = readMessage(enUS, key)
    expect(zh).toContain('矢量')
    expect(en).toContain('vector')
    expect(zh).not.toBe(readMessage(zhCN, 'graph.inspector.generate.instructionPlaceholder'))
  })

  it('svg.gen 的指令预设标题键在中英文案里都能查到', () => {
    const presets = listInstructionPresets('svgGen')
    expect(presets.length).toBeGreaterThan(0)
    const missing: string[] = []
    for (const preset of presets) {
      if (!readMessage(zhCN, preset.titleKey)) missing.push(`zh:${preset.titleKey}`)
      if (!readMessage(enUS, preset.titleKey)) missing.push(`en:${preset.titleKey}`)
    }
    expect(missing).toEqual([])
  })
})
