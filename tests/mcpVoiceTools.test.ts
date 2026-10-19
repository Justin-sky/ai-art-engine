import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildDialogueInputs,
  dialogueSpeakers,
  normalizeDialogueVoiceMap,
  parseDialogueScript
} from '../src/shared/graph/dialogueScript'

const SRC = readFileSync(resolve('src/main/services/mcpServerService.ts'), 'utf8')
const SMART_PATCH_SRC = readFileSync(resolve('src/shared/graph/smartPatch.ts'), 'utf8')
const HARNESS_SRC = readFileSync(resolve('src/main/services/deepseekHarnessService.ts'), 'utf8')

describe('对话解析（图节点共用）', () => {
  it('按行解析「说话人: 台词」，中英文冒号都认', () => {
    const lines = parseDialogueScript('A: 你终于来了。\nB：路上堵车。')
    expect(lines.map((l) => l.speaker)).toEqual(['A', 'B'])
    expect(lines.map((l) => l.text)).toEqual(['你终于来了。', '路上堵车。'])
  })

  it('没有冒号的行沿用上一段的说话人（旁白 / 连续独白）', () => {
    const lines = parseDialogueScript('A: 第一句\n又一句\nB: 换人了')
    expect(lines.map((l) => l.speaker)).toEqual(['A', 'A', 'B'])
  })

  it('说话人去重保持出现顺序', () => {
    const lines = parseDialogueScript('A: 1\nB: 2\nA: 3')
    expect(dialogueSpeakers(lines)).toEqual(['A', 'B'])
  })

  it('空值 / 非字符串的音色映射被丢掉', () => {
    expect(
      normalizeDialogueVoiceMap({ A: ' v1 ', B: '', C: 123 as unknown as string, '  ': 'x' })
    ).toEqual({ A: 'v1' })
    expect(normalizeDialogueVoiceMap(null)).toEqual({})
    expect(normalizeDialogueVoiceMap(['A'])).toEqual({})
  })

  it('每段都带音色；缺音色的段落标出索引（用于"点名第几段"）', () => {
    const lines = parseDialogueScript('A: 1\nB: 2\nC: 3')
    const ok = buildDialogueInputs(lines, { A: 'va', B: 'vb', C: 'vc' })
    expect(ok.inputs.map((i) => i.voice)).toEqual(['va', 'vb', 'vc'])
    expect(ok.missingVoiceAt).toEqual([])

    const missing = buildDialogueInputs(lines, { A: 'va', C: 'vc' })
    expect(missing.missingVoiceAt).toEqual([1])
    expect(missing.inputs.map((i) => i.text)).toEqual(['1', '3'])
  })

  it('兜底音色能补上没绑定说话人的段', () => {
    const lines = parseDialogueScript('A: 1\nB: 2')
    const { inputs, missingVoiceAt } = buildDialogueInputs(lines, { A: 'va' }, 'fallback')
    expect(missingVoiceAt).toEqual([])
    expect(inputs.map((i) => i.voice)).toEqual(['va', 'fallback'])
  })
})

describe('声音与音效节点通过画布 graph_edit + task_run 驱动', () => {
  it('已移除旧直调工具 generate_speech / generate_dialogue / generate_sound_effect / generate_music', () => {
    for (const toolName of [
      'generate_speech',
      'generate_dialogue',
      'generate_sound_effect',
      'generate_music'
    ]) {
      expect(SRC).not.toContain(`name: '${toolName}',`)
    }
  })

  it('smartPatch 支持 voice / voiceProfile / voices / loop / lyrics / instrumental 等简写映射', () => {
    expect(SMART_PATCH_SRC).toContain('merged.generateSpeechVoice = incoming.voice')
    expect(SMART_PATCH_SRC).toContain('merged.generateDialogueVoices')
    expect(SMART_PATCH_SRC).toContain('merged.generateSoundLoop = incoming.loop')
    expect(SMART_PATCH_SRC).toContain('merged.generateMusicLyrics = incoming.lyrics')
    expect(SMART_PATCH_SRC).toContain('merged.generateMusicInstrumental = incoming.instrumental')
  })

  it('系统提示区分配音（voice.tts）、对话（voice.dialogue）、音效（audio.sfx）、音乐（audio.music）', () => {
    expect(HARNESS_SRC).toContain('voice.tts')
    expect(HARNESS_SRC).toContain('voice.dialogue')
    expect(HARNESS_SRC).toContain('audio.sfx')
    expect(HARNESS_SRC).toContain('audio.music')
    expect(HARNESS_SRC).toMatch(
      /Never satisfy a sound-effect or ambience request with `voice\.tts`/
    )
  })
})
