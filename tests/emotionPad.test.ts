import { describe, expect, it } from 'vitest'
import {
  DEFAULT_EMOTION_PAD,
  EMOTION_GRID,
  emotionPadToNodePatch,
  getEmotionCell,
  normalizeEmotionPad,
  resolveEmotionOutputPrompt
} from '../src/shared/graph'

describe('emotionPad', () => {
  it('defaults to center neutral cell', () => {
    expect(normalizeEmotionPad()).toEqual(DEFAULT_EMOTION_PAD)
    expect(getEmotionCell(DEFAULT_EMOTION_PAD).label).toBe('情绪中性')
  })

  it('matches screenshot cell for distant mid arousal', () => {
    expect(getEmotionCell({ gridX: 4, gridY: 2 }).label).toBe('隐忍愠怒')
  })

  it('has full 5x5 table', () => {
    expect(EMOTION_GRID).toHaveLength(5)
    for (const row of EMOTION_GRID) expect(row).toHaveLength(5)
  })

  it('clamps out-of-range indices', () => {
    expect(normalizeEmotionPad({ gridX: 99, gridY: -3 })).toEqual({
      gridX: 4,
      gridY: 0
    })
  })

  it('builds output prompt with label and english fragment', () => {
    const prompt = resolveEmotionOutputPrompt({ gridX: 4, gridY: 2 })
    expect(prompt).toContain('隐忍愠怒')
    expect(prompt).toContain('suppressed anger')
  })

  it('writes node patch', () => {
    const patch = emotionPadToNodePatch({ gridX: 0, gridY: 4 })
    expect(patch.emotionLabel).toBe('狂热亲近')
    expect(patch.emotionPrompt).toContain('狂热亲近')
  })
})
