import { describe, expect, it } from 'vitest'
import {
  applyGraphSkill,
  getGraphSkill,
  hashPromptForLog,
  listGraphSkills,
  registerGraphSkill
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

  it('overlays a skill and restores the builtin on dispose', () => {
    const builtin = getGraphSkill('episode.breakdown')
    expect(builtin).toBeTruthy()
    const overlay = { ...builtin!, titleZh: '插件覆盖' }
    const dispose = registerGraphSkill(overlay)
    expect(getGraphSkill('episode.breakdown')?.titleZh).toBe('插件覆盖')
    dispose()
    expect(getGraphSkill('episode.breakdown')).toBe(builtin)
  })

  it('registers a new skill and removes it on dispose', () => {
    const dispose = registerGraphSkill({
      id: 'plugin.test.skill',
      kind: 'system',
      titleZh: '测试技能',
      titleEn: 'Test skill'
    })
    expect(getGraphSkill('plugin.test.skill')?.titleZh).toBe('测试技能')
    expect(listGraphSkills().some((skill) => skill.id === 'plugin.test.skill')).toBe(true)
    dispose()
    expect(getGraphSkill('plugin.test.skill')).toBeUndefined()
    expect(listGraphSkills().some((skill) => skill.id === 'plugin.test.skill')).toBe(false)
  })
})
