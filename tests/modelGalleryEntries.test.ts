import { describe, expect, it } from 'vitest'
import { buildGalleryEntries } from '../src/renderer/src/features/graph/model/modelGalleryEntries'

/**
 * 图库列表合成：本节点产物 + 额外产物（空间世界随世界免费返回的 SPZ / 全景图）。
 *
 * 关键区别：额外产物**不是本节点 Cook 出来的**，只能看，不能被选成出口、也不能被删 ——
 * 弄错就会把上游世界的产物从本节点出口里删掉。
 */
describe('buildGalleryEntries', () => {
  it('keeps own outputs selectable and extras read-only', () => {
    const entries = buildGalleryEntries({
      own: [
        { id: 'gen-model:1', relativePath: 'Cache/Models/a.glb' },
        { id: 'gen-model:2', relativePath: 'Cache/Models/b.glb' }
      ],
      extras: [
        { key: 'world-extra:splats:Cache/Models/a.spz', relativePath: 'Cache/Models/a.spz' },
        { key: 'world-extra:pano:Cache/Models/a.png', relativePath: 'Cache/Models/a.png' }
      ]
    })
    expect(entries.map((entry) => [entry.key, entry.selectable])).toEqual([
      ['gen-model:1', true],
      ['gen-model:2', true],
      ['world-extra:splats:Cache/Models/a.spz', false],
      ['world-extra:pano:Cache/Models/a.png', false]
    ])
    expect(entries.every((entry) => entry.relativePath.trim())).toBe(true)
  })

  it('drops entries without a usable path (empty gallery still renders extras)', () => {
    const entries = buildGalleryEntries({
      own: [{ id: 'gen-model:1' }, { relativePath: 'Cache/Models/b.glb' }],
      extras: [
        { key: 'x', relativePath: '   ' },
        { key: 'y', relativePath: 'Cache/Models/y.spz', label: 'SPZ' }
      ]
    })
    // 没有 relativePath 的产物在画廊里没有任何可展示的东西
    expect(entries.map((entry) => entry.key)).toEqual(['y'])
    expect(entries[0]!.label).toBe('SPZ')
  })

  it('returns an empty list when there is nothing to show', () => {
    expect(buildGalleryEntries({ own: [] })).toEqual([])
    expect(buildGalleryEntries({ own: [], extras: [] })).toEqual([])
  })
})
