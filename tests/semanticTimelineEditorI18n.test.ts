import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BUILTIN_VOCABULARIES } from '../src/shared/semanticTimeline'
import enUS from '../src/renderer/src/i18n/locales/en-US'
import zhCN from '../src/renderer/src/i18n/locales/zh-CN'

/**
 * 语义时间线编辑器（dive）的界面国际化守卫。
 *
 * 起因：轨道上的 `hook` / `Story` / `Production` / `Evidence` / `camera` 这些是**界面上**的英文，
 * 中文界面下不该出现（`hook` 是内置词表的节拍类型名，属数据但可映射）。
 */
const source = readFileSync(
  join(process.cwd(), 'src/renderer/src/components/SemanticTimelineEditor.vue'),
  'utf8'
)

function leaf(locale: unknown, path: string[]): unknown {
  let node: unknown = locale
  for (const key of path) {
    if (!node || typeof node !== 'object') return undefined
    node = (node as Record<string, unknown>)[key]
  }
  return node
}

describe('SemanticTimelineEditor 国际化', () => {
  it('界面文案全部走 t()，不留硬编码英文', () => {
    // 层的标题、轨道名、证据面板、空态、缩放按钮都不该再写字面量
    for (const literal of [
      '>Story<',
      '>Character / Entity<',
      '>Production<',
      '>No entities<',
      '>Evidence<',
      'title="Zoom in"',
      'title="Zoom out"',
      'title="Reset zoom"',
      'pixelEditable:'
    ]) {
      expect(source, `仍残留硬编码：${literal}`).not.toContain(literal)
    }
    expect(source).toContain("t('graph.semanticTimeline.layerStory')")
    expect(source).toContain("t('graph.semanticTimeline.layerProduction')")
    expect(source).toContain("t('graph.semanticTimeline.trackEvents')")
    expect(source).toContain("t('graph.semanticTimeline.evidence')")
    expect(source).toContain("t('graph.semanticTimeline.noEntities')")
    expect(source).toContain('beatLabel(')
  })

  it('制作层四个轨道名来自 i18n（camera/audio/text/vfx 只在代码里做 id）', () => {
    for (const key of ['trackCamera', 'trackAudio', 'trackText', 'trackVfx']) {
      expect(source).toContain(`t('graph.semanticTimeline.${key}')`)
    }
    expect(source).not.toContain("['camera', 'audio', 'text', 'vfx']")
  })

  it('内置词表的每个节拍类型在两套文案里都有名字（含中文，不再显示 hook）', () => {
    for (const vocabulary of BUILTIN_VOCABULARIES) {
      for (const beat of vocabulary.beats) {
        for (const [name, locale] of [
          ['zh-CN', zhCN],
          ['en-US', enUS]
        ] as const) {
          const value = leaf(locale, ['graph', 'semanticTimeline', 'beat', beat.type])
          expect(
            typeof value === 'string' && value.trim().length > 0,
            `${name} 缺少 ${beat.type} 的节拍名`
          ).toBe(true)
        }
      }
    }
    // 中文名不能等于英文 id（否则等于没翻译）
    expect(leaf(zhCN, ['graph', 'semanticTimeline', 'beat', 'hook'])).toBe('钩子')
    expect(leaf(enUS, ['graph', 'semanticTimeline', 'beat', 'hook'])).toBe('Hook')
  })

  it('市场包自定义类型回退为原始 id（用 te 判断 key 是否存在）', () => {
    expect(source).toContain('te(key) ? t(key) : type')
  })
})
