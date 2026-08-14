import { describe, expect, it } from 'vitest'
import {
  applyGraphSkill,
  getGraphSkill,
  hashPromptForLog,
  listGraphSkills
} from '../src/shared/graph'

describe('graphSkills', () => {
  it('lists episode and system skills', () => {
    const ids = listGraphSkills().map((skill) => skill.id)
    expect(ids).toContain('episode.breakdown')
    expect(ids).toContain('episode.beatboard')
    expect(ids).toContain('episode.review.motion')
    expect(ids).toContain('system.image')
    expect(ids).not.toContain('screenplay.create')
  })

  it('applies episode skill into node params', () => {
    const params = applyGraphSkill('episode.breakdown')
    expect(params.skillId).toBe('episode.breakdown')
    expect(params.generateSystemPrompt).toContain('分镜师')
    expect(params.generateInstruction).toContain('节拍拆解表')
    expect(getGraphSkill('episode.breakdown')?.parse).toBe('beatBreakdown')
  })

  it('interpolates grid vars without touching typeId', () => {
    const params = applyGraphSkill('episode.image.grid4', { vars: { group: 3 } })
    expect(params.skillId).toBe('episode.image.grid4')
    expect(params.generateInstruction).toContain('第 3 组')
    expect(params.generateSystemPrompt).toBeUndefined()
  })

  it('hashes prompt text stably for logs only', () => {
    expect(hashPromptForLog('hello', 'sys')).toBe(hashPromptForLog('hello', 'sys'))
    expect(hashPromptForLog('hello')).not.toBe(hashPromptForLog('hello!'))
  })
})
