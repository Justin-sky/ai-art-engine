import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PRODUCTION_LABEL_META } from '../src/shared/semanticTimeline'
import { trackLabelKey } from '../src/renderer/src/features/graph/model/semanticTimelineView'
import enUS from '../src/renderer/src/i18n/locales/en-US'
import zhCN from '../src/renderer/src/i18n/locales/zh-CN'

const source = readFileSync(
  join(process.cwd(), 'src/renderer/src/components/SemanticTimelineEditor.vue'),
  'utf8'
)
const inspectorSource = readFileSync(
  join(
    process.cwd(),
    'src/renderer/src/components/semanticInspector/SemanticSelectionInspector.vue'
  ),
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
    for (const literal of [
      '>Character / Entity<',
      '>No entities<',
      '>Evidence<',
      'title="Zoom in"',
      'title="Zoom out"',
      'title="Reset zoom"',
      'pixelEditable:'
    ]) {
      expect(source, `仍残留硬编码：${literal}`).not.toContain(literal)
    }
    expect(source).toContain("t('graph.semanticTimeline.layerFootage')")
    expect(source).toContain("t('graph.semanticTimeline.layerEntity')")
    expect(source).toContain("t('graph.semanticTimeline.trackShots')")
    expect(source).toContain("t('graph.semanticTimeline.trackUnits')")
    expect(source).toContain("t('graph.semanticTimeline.trackDialogue')")
    expect(source).toContain("t('graph.semanticTimeline.trackOverlays')")
    expect(inspectorSource).toContain("t('graph.semanticTimeline.evidence')")
    expect(source).toContain("t('graph.semanticTimeline.noEntities')")
  })

  it('轨道与层 id 映射在两套语言包里完整对称', () => {
    for (const id of ['shots', 'units', 'dialogue', 'overlays', 'footage', 'entity']) {
      const key = trackLabelKey(id)
      expect(key, `${id} 缺少映射`).toBeTruthy()
      for (const [name, locale] of [
        ['zh-CN', zhCN],
        ['en-US', enUS]
      ] as const) {
        const value = leaf(locale, ['graph', 'semanticTimeline', key!])
        expect(typeof value === 'string' && value.trim().length > 0, `${name} 缺少 ${key}`).toBe(
          true
        )
      }
    }
  })

  it('11 类基础镜头标签与三种重制策略在两套文案及元数据里完整对齐', () => {
    expect(Object.keys(PRODUCTION_LABEL_META)).toHaveLength(11)
    for (const [key, meta] of Object.entries(PRODUCTION_LABEL_META)) {
      expect(meta.shortZh.trim().length, `${key} 缺少中文短标签`).toBeGreaterThan(0)
      expect(meta.shortEn.trim().length, `${key} 缺少英文短标签`).toBeGreaterThan(0)
    }
    for (const key of [
      'remakeStrategy',
      'remakeStrategyFidelity',
      'remakeStrategyAdapt',
      'remakeStrategyEdit',
      'rebuildGenerateAnchors'
    ]) {
      expect(typeof leaf(zhCN, ['graph', 'inspector', 'semantic', key])).toBe('string')
      expect(typeof leaf(enUS, ['graph', 'inspector', 'semantic', key])).toBe('string')
    }
  })
})
