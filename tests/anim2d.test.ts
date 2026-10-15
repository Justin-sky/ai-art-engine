import { describe, expect, it } from 'vitest'
import {
  ANIM2D_GIF_FPS_MAX,
  ANIM2D_GIF_FPS_OFF,
  ANIM2D_PRESETS,
  ANIM_KEY_COLOR_DEFAULT,
  anim2dCellKeys,
  animGifFpsToNodePatch,
  animKeyColorToNodePatch,
  buildAnim2dGridInstruction,
  buildAnim2dInnerGraph,
  buildAnimKeyColorPrompt,
  normalizeAnim2dState,
  normalizeAnimGifFps,
  normalizeAnimKeyColor,
  readAnim2dFromNode,
  readAnimGifFpsFromNode,
  readAnimKeyColorFromNode,
  resolveAnim2dPreset,
  ANIM2D_GRID_PRESETS,
  buildAnimViewStylePrompt,
  buildAnimVideoRestyleInstruction,
  computeVideoFrameTimestamps,
  normalizeAnimVideoRange,
  readAnimGenModeFromNode,
  readAnimStabilizeFromNode,
  readAnimEdgeInsetFromNode,
  readAnimPlayModeFromNode,
  readAnimDisabledCellsFromNode,
  normalizeAnimKeyThreshold,
  createNodeFromType,
  getNodePorts
} from '../src/shared/graph'

describe('anim2d state', () => {
  it('normalizes rows/cols into clamped defaults', () => {
    expect(normalizeAnim2dState({ rows: 2, cols: 6 })).toEqual({ rows: 2, cols: 6 })
    expect(normalizeAnim2dState({ rows: 0, cols: 99 })).toEqual({ rows: 1, cols: 6 })
    expect(normalizeAnim2dState({})).toEqual({ rows: 1, cols: 4 })
    expect(readAnim2dFromNode({ animRows: 3, animCols: 2 })).toEqual({ rows: 3, cols: 2 })
  })

  it('builds row-major cell keys', () => {
    expect(anim2dCellKeys(2, 3)).toEqual(['1-1', '1-2', '1-3', '2-1', '2-2', '2-3'])
  })

  it('provides grid presets with recommended aspect ratios', () => {
    expect(ANIM2D_GRID_PRESETS.length).toBeGreaterThanOrEqual(5)
    expect(ANIM2D_GRID_PRESETS.find((p) => p.id === '1x4')?.aspectRatio).toBe('16:9')
    expect(ANIM2D_GRID_PRESETS.find((p) => p.id === '3x3')?.aspectRatio).toBe('1:1')
  })

  it('normalizes stabilize, edgeInset, playMode, disabledCells, and keyThreshold', () => {
    expect(readAnimStabilizeFromNode({ animStabilize: 'ground' })).toBe('ground')
    expect(readAnimStabilizeFromNode({ animStabilize: 'center' })).toBe('center')
    expect(readAnimStabilizeFromNode({})).toBe('off')
    expect(readAnimEdgeInsetFromNode({ animEdgeInset: 4 })).toBe(4)
    expect(readAnimEdgeInsetFromNode({})).toBe('auto')
    expect(readAnimPlayModeFromNode({ animPlayMode: 'pingpong' })).toBe('pingpong')
    expect(readAnimPlayModeFromNode({})).toBe('loop')
    expect(readAnimDisabledCellsFromNode({ animDisabledCells: ['1-2', '2-1'] })).toEqual([
      '1-2',
      '2-1'
    ])
    expect(normalizeAnimKeyThreshold(60)).toBe(60)
  })

  it('normalizes animGenMode, video trim range, and computes uniform video timestamps', () => {
    expect(readAnimGenModeFromNode({ animGenMode: 'video-sheet' })).toBe('video-sheet')
    expect(readAnimGenModeFromNode({ animGenMode: 'video-restyle' })).toBe('video-restyle')
    expect(readAnimGenModeFromNode({ animGenMode: 'frames-sheet' })).toBe('frames-sheet')
    expect(readAnimGenModeFromNode({})).toBe('auto')

    expect(normalizeAnimVideoRange(0.2, 0.8)).toEqual({ startRatio: 0.2, endRatio: 0.8 })
    expect(normalizeAnimVideoRange(0.7, 0.3)).toEqual({ startRatio: 0.7, endRatio: 0.75 })

    const ts = computeVideoFrameTimestamps(4, 4, { startRatio: 0.25, endRatio: 0.75 })
    expect(ts).toHaveLength(4)
    expect(ts[0]).toBeCloseTo(1, 2)
    expect(ts[3]).toBeCloseTo(3, 2)

    expect(buildAnimVideoRestyleInstruction(2, 4, 'zh-CN')).toContain('2×4')
    expect(buildAnimVideoRestyleInstruction(2, 4, 'en-US')).toContain('2×4')
  })

  it('builds camera view and art style lock prompts', () => {
    const promptZh = buildAnimViewStylePrompt('side', 'pixel', 'zh-CN')
    expect(promptZh).toContain('横版')
    expect(promptZh).toContain('像素')
    const promptEn = buildAnimViewStylePrompt('iso', 'cel', 'en-US')
    expect(promptEn).toContain('isometric')
    expect(promptEn).toContain('cel-shaded')
  })
})

describe('anim2d key color (特效透明化)', () => {
  it('normalizes black/white/auto', () => {
    expect(normalizeAnimKeyColor('black')).toBe('black')
    expect(normalizeAnimKeyColor('white')).toBe('white')
    expect(normalizeAnimKeyColor('auto')).toBe('auto')
    expect(normalizeAnimKeyColor('green')).toBe(ANIM_KEY_COLOR_DEFAULT)
    expect(normalizeAnimKeyColor(undefined)).toBe(ANIM_KEY_COLOR_DEFAULT)
    expect(readAnimKeyColorFromNode({ animKeyColor: 'white' })).toBe('white')
    expect(readAnimKeyColorFromNode({ animKeyColor: 'auto' })).toBe('auto')
    expect(readAnimKeyColorFromNode({})).toBe('')
  })

  it('round-trips node patch', () => {
    expect(animKeyColorToNodePatch('black')).toEqual({ animKeyColor: 'black' })
    expect(animKeyColorToNodePatch('nope')).toEqual({ animKeyColor: '' })
  })

  it('builds empty prompt for no key', () => {
    expect(buildAnimKeyColorPrompt('')).toBe('')
  })

  it('builds zh/en prompts for black & white', () => {
    const zhBlack = buildAnimKeyColorPrompt('black')
    expect(zhBlack).toContain('纯黑色')
    const zhWhite = buildAnimKeyColorPrompt('white', 'zh-CN')
    expect(zhWhite).toContain('纯白色')
    const enBlack = buildAnimKeyColorPrompt('black', 'en-US')
    expect(enBlack).toContain('pure black')
    const enWhite = buildAnimKeyColorPrompt('white', 'en')
    expect(enWhite).toContain('pure white')
  })
})

describe('anim2d presets', () => {
  it('resolves known presets across all 6 categories (including turnaround, expression, tile) and rejects unknown', () => {
    expect(resolveAnim2dPreset('walk')?.id).toBe('walk')
    expect(resolveAnim2dPreset('dash')?.id).toBe('dash')
    expect(resolveAnim2dPreset('vfxSlash')?.id).toBe('vfxSlash')
    expect(resolveAnim2dPreset('dir4')?.recommendedGrid).toEqual({
      rows: 1,
      cols: 4,
      aspectRatio: '16:9'
    })
    expect(resolveAnim2dPreset('walk4Dir')?.recommendedGrid).toEqual({
      rows: 4,
      cols: 4,
      aspectRatio: '1:1'
    })
    expect(resolveAnim2dPreset('expr6')?.category).toBe('expression')
    expect(resolveAnim2dPreset('autotile3x3')?.category).toBe('tile')
    expect(resolveAnim2dPreset('nope')).toBeUndefined()
    expect(ANIM2D_PRESETS.length).toBe(20)
  })

  it('builds grid instruction mentioning rows x cols', () => {
    const zh = buildAnim2dGridInstruction(2, 4)
    expect(zh).toContain('2×4')
    expect(zh).toContain('8 帧')
    const en = buildAnim2dGridInstruction(1, 4, 'en-US')
    expect(en).toContain('4 frames')
  })
})

describe('anim2d gif output', () => {
  it('normalizes gif fps (0 = off) with upper clamp', () => {
    expect(normalizeAnimGifFps(undefined)).toBe(ANIM2D_GIF_FPS_OFF)
    expect(normalizeAnimGifFps(0)).toBe(ANIM2D_GIF_FPS_OFF)
    expect(normalizeAnimGifFps(-4)).toBe(ANIM2D_GIF_FPS_OFF)
    expect(normalizeAnimGifFps('8')).toBe(8)
    expect(normalizeAnimGifFps(99)).toBe(ANIM2D_GIF_FPS_MAX)
    expect(readAnimGifFpsFromNode({ animGifFps: 12 })).toBe(12)
    expect(readAnimGifFpsFromNode({})).toBe(ANIM2D_GIF_FPS_OFF)
  })

  it('round-trips gif fps node patch', () => {
    expect(animGifFpsToNodePatch(6)).toEqual({ animGifFps: 6 })
    expect(animGifFpsToNodePatch('nope')).toEqual({ animGifFps: ANIM2D_GIF_FPS_OFF })
  })
})

describe('anim2d inner graph', () => {
  it('wires input boundary → frame.animGen → output boundary', () => {
    const doc = buildAnim2dInnerGraph({ rows: 2, cols: 4 }, 'walk', '', 'zh-CN')
    expect(doc.nodes.map((n) => n.typeId)).toContain('frame.animGen')
    expect(doc.edges.length).toBe(2)
    const gen = doc.nodes.find((n) => n.typeId === 'frame.animGen')
    expect(gen?.params?.animRows).toBe(2)
    expect(gen?.params?.animCols).toBe(4)
    expect(gen?.params?.animPresetId).toBe('walk')
  })

  it('streamlines 2D group output ports with distinct semantic labelKeys', () => {
    const alignPorts = getNodePorts(createNodeFromType('image.align', { x: 0, y: 0 })).filter(
      (p) => p.direction === 'out'
    )
    expect(alignPorts.map((p) => [p.id, p.labelKey])).toEqual([['out', 'graph.port.alignedSprite']])

    const stagePorts = getNodePorts(createNodeFromType('stage.2d', { x: 0, y: 0 })).filter(
      (p) => p.direction === 'out'
    )
    expect(stagePorts.map((p) => [p.id, p.labelKey])).toEqual([
      ['out', 'graph.port.stageImage'],
      ['out-frames', 'graph.port.actionFrames'],
      ['out-sheet', 'graph.port.spriteSheet']
    ])

    const animPorts = getNodePorts(createNodeFromType('anim.2d', { x: 0, y: 0 })).filter(
      (p) => p.direction === 'out'
    )
    expect(animPorts.map((p) => [p.id, p.labelKey])).toEqual([
      ['out', 'graph.port.frame'],
      ['out-all', 'graph.port.frames'],
      ['out-gif', 'graph.port.gif']
    ])

    const genPorts = getNodePorts(createNodeFromType('frame.animGen', { x: 0, y: 0 })).filter(
      (p) => p.direction === 'out'
    )
    expect(genPorts.map((p) => [p.id, p.labelKey])).toEqual([
      ['out', 'graph.port.spriteSheet'],
      ['out-all', 'graph.port.spriteSheetAll']
    ])
  })
})
