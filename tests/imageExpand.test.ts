import { describe, expect, it } from 'vitest'
import {
  buildExpandPrompt,
  clampExpandParamsToCapabilities,
  contentAspectFromExpand,
  expandMarginsToAnchors,
  normalizeImageExpand,
  parseAspectRatioString
} from '../src/shared/graph'

describe('imageExpand', () => {
  it('normalizes expand margins and ignores legacy anchors', () => {
    expect(normalizeImageExpand()).toMatchObject({
      expandLeft: 0,
      expandRight: 0.5,
      expandTop: 0.5,
      expandBottom: 0,
      aspectId: 'original'
    })
    expect(
      normalizeImageExpand({
        expandLeft: 0.25,
        expandRight: 0.25,
        expandTop: 0,
        expandBottom: 0.5
      })
    ).toMatchObject({
      expandLeft: 0.25,
      expandRight: 0.25,
      expandTop: 0,
      expandBottom: 0.5
    })
    // 旧锚点字段不再升级，缺 expand* 时回落默认
    expect(
      normalizeImageExpand({
        anchorX: 0,
        anchorY: 1 / 3,
        anchorW: 2 / 3,
        anchorH: 2 / 3
      } as never)
    ).toMatchObject({
      expandLeft: 0,
      expandRight: 0.5,
      expandTop: 0.5,
      expandBottom: 0
    })
  })

  it('converts margins to anchors for preview layout', () => {
    const margins = { expandLeft: 0, expandRight: 0.5, expandTop: 0.5, expandBottom: 0 }
    const anchors = expandMarginsToAnchors(margins)
    expect(anchors.anchorW).toBeCloseTo(2 / 3)
    expect(anchors.anchorH).toBeCloseTo(2 / 3)
    expect(anchors.anchorX).toBeCloseTo(0)
    expect(anchors.anchorY).toBeCloseTo(1 / 3)
  })

  it('parses aspect ratio strings', () => {
    expect(parseAspectRatioString('16:9')).toBeCloseTo(16 / 9)
  })

  it('computes content aspect from margins', () => {
    expect(contentAspectFromExpand(normalizeImageExpand(), 1)).toBeCloseTo(1.5 / 1.5)
    expect(
      contentAspectFromExpand(
        normalizeImageExpand({ expandLeft: 0, expandRight: 1, expandTop: 0, expandBottom: 0 }),
        1
      )
    ).toBeCloseTo(2)
  })

  it('clamps params to model capabilities', () => {
    const clamped = clampExpandParamsToCapabilities(
      normalizeImageExpand({ aspectId: '21:9', resolution: '8K', count: 9 }),
      {
        aspectRatios: ['1:1', '16:9'],
        resolutions: ['1K', '2K'],
        counts: [1, 2]
      }
    )
    expect(clamped.aspectId).toBe('original')
    expect(clamped.resolution).toBe('2K')
    expect(clamped.count).toBe(1)
  })

  it('builds outpaint prompt', () => {
    const p = buildExpandPrompt(
      normalizeImageExpand({ expandLeft: 0, expandRight: 0.5, expandTop: 0.5, expandBottom: 0 })
    )
    expect(p).toContain('Outpaint')
    expect(p).toContain('right')
    expect(p).toContain('top')
  })
})
