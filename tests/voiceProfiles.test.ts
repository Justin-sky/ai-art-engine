import { describe, expect, it } from 'vitest'
import {
  deleteVoiceProfile,
  findVoiceProfile,
  normalizeVoiceProfiles,
  resolveVoiceProfileParams,
  serializeVoiceProfiles,
  upsertVoiceProfile,
  VOICE_PROFILES_RELATIVE_PATH,
  voiceProfilesToMarkdown,
  type VoiceProfile
} from '../src/shared/voiceProfiles'

function profile(character: string, extra: Partial<VoiceProfile> = {}): VoiceProfile {
  return { character, updatedAt: '2026-01-01T00:00:00.000Z', ...extra }
}

describe('voiceProfiles', () => {
  it('相对路径固定为 .aiartengine/voiceProfiles.json', () => {
    expect(VOICE_PROFILES_RELATIVE_PATH).toBe('.aiartengine/voiceProfiles.json')
  })

  it('normalizeVoiceProfiles 容错且去重', () => {
    expect(normalizeVoiceProfiles(null)).toEqual([])
    expect(normalizeVoiceProfiles({})).toEqual([])
    expect(normalizeVoiceProfiles({ profiles: 'x' })).toEqual([])
    const list = normalizeVoiceProfiles({
      profiles: [
        profile('小明', { voice: ' S_001 ', description: ' 低沉 ' }),
        profile('小明', { voice: 'S_002' }),
        profile('', { voice: 'S_003' }),
        profile('   ', { voice: 'S_004' })
      ]
    })
    expect(list).toHaveLength(1)
    expect(list[0]!.character).toBe('小明')
    expect(list[0]!.voice).toBe('S_001')
    expect(list[0]!.description).toBe('低沉')
  })

  it('upsert 新增与更新', () => {
    const a = upsertVoiceProfile([], { character: '小红', voice: 'S_10' })
    expect(a).toHaveLength(1)
    const b = upsertVoiceProfile(a, { character: '小红', description: '清脆' })
    expect(b).toHaveLength(1)
    expect(b[0]!.voice).toBe('S_10')
    expect(b[0]!.description).toBe('清脆')
    const c = upsertVoiceProfile(a, { character: '小刚' })
    expect(c).toHaveLength(2)
  })

  it('delete 删除指定角色', () => {
    const list = [
      profile('A', { voice: 'S_1' }),
      profile('B', { voice: 'S_2' })
    ]
    const next = deleteVoiceProfile(list, 'A')
    expect(next.map((p) => p.character)).toEqual(['B'])
    expect(deleteVoiceProfile(list, '')).toEqual(list)
  })

  it('resolveVoiceProfileParams：档案与显式入参优先级', () => {
    const p = profile('小明', { voice: 'S_001', referenceAudio: 'audio/ref.wav' })
    expect(resolveVoiceProfileParams(p, {})).toEqual({
      voice: 'S_001',
      referenceAudio: 'audio/ref.wav'
    })
    expect(resolveVoiceProfileParams(p, { voice: 'S_999' })).toEqual({
      voice: 'S_999',
      referenceAudio: 'audio/ref.wav'
    })
    expect(resolveVoiceProfileParams(undefined, { voice: 'S_5' })).toEqual({ voice: 'S_5' })
    expect(resolveVoiceProfileParams(undefined, {})).toEqual({})
  })

  it('findVoiceProfile 按角色名匹配', () => {
    const list = [profile('主角', { voice: 'S_7' })]
    expect(findVoiceProfile(list, '主角')?.voice).toBe('S_7')
    expect(findVoiceProfile(list, '配角')).toBeUndefined()
    expect(findVoiceProfile(list, '')).toBeUndefined()
  })

  it('serialize / toMarkdown 往返', () => {
    const list = [profile('主角', { voice: 'S_7', referenceAudio: 'a/b.mp3' })]
    const round = normalizeVoiceProfiles(JSON.parse(serializeVoiceProfiles(list)))
    expect(round).toEqual(list)
    const md = voiceProfilesToMarkdown(list)
    expect(md).toContain('主角')
    expect(md).toContain('S_7')
    expect(voiceProfilesToMarkdown([])).toContain('暂无角色音色档案')
  })
})
