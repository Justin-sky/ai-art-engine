import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildDialogueInputs,
  dialogueSpeakers,
  normalizeDialogueVoiceMap,
  parseDialogueScript
} from '../src/shared/graph/dialogueScript'

/**
 * 多说话人对话与音效这两个**声音节点**此前只在图节点 / IPC 层有，MCP 工具层没有
 * （`generate_speech` / `generate_music` 有，`asset.dialogue` / `asset.sfx` 没有）。
 * 本次补上 `generate_dialogue` 与 `generate_sound_effect`。
 *
 * 这条测试分两部分：
 * 1. 对话链路的**纯函数行为**（MCP handler 与图节点共用同一批函数）
 * 2. 两个工具在 MCP 服务里的**接线约束**（源码级，因为主进程服务依赖 Electron 单例，
 *    无法在此环境实例化 —— 与 tests/mcpGenToolSchema.test.ts 同一手法）
 */
const SRC = readFileSync(resolve('src/main/services/mcpServerService.ts'), 'utf8')

/** 取某个工具的完整定义块 */
function toolBlock(toolName: string): string {
  const marker = `name: '${toolName}',`
  const start = SRC.indexOf(marker)
  expect(start, `找不到工具 ${toolName} 的定义`).toBeGreaterThanOrEqual(0)
  const next = SRC.indexOf('\n  {\n', start + marker.length)
  return SRC.slice(start, next > 0 ? next : SRC.length)
}

describe('对话解析（MCP 与图节点共用）', () => {
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

    // B 没配音色、也没有兜底 → 只有第 2 段（索引 1）缺
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

describe('generate_dialogue 的接线', () => {
  const block = toolBlock('generate_dialogue')

  it('暴露 script / voices / voice / voiceProfile', () => {
    for (const key of ['script', 'voices', 'voice:', 'voiceProfile']) {
      expect(block, `缺少 ${key}`).toContain(key)
    }
    expect(block).toMatch(/required: \['script'\]/)
  })

  it('走 generateSpeechAsset 并传 dialogue 数组（一次合成整段，不逐句调）', () => {
    expect(block).toContain('modelProviderFacade.generateSpeechAsset(input)')
    expect(block).toMatch(/dialogue: inputs/)
  })

  it('复用共享纯函数，不重写解析', () => {
    expect(block).toContain('parseDialogueScript(script)')
    expect(block).toContain('normalizeDialogueVoiceMap(args.voices)')
    expect(block).toContain('buildDialogueInputs(lines, voiceBySpeaker, fallbackVoice)')
  })

  it('缺音色报 dialogueVoiceMissing 并点名段号与说话人；空脚本报 dialogueEmpty', () => {
    expect(block).toContain('SHARED_ERRORS.dialogueEmpty')
    expect(block).toContain('SHARED_ERRORS.dialogueVoiceMissing')
    expect(block).toMatch(/lines: missingVoiceAt\.map\(\(index\) => index \+ 1\)\.join/)
    expect(block).toMatch(/speakers: speakers\.join/)
  })

  it('活动名用 generate_dialogue（界面卡片与并发可见性靠它）', () => {
    expect(block).toContain("'generate_dialogue'")
  })
})

describe('generate_sound_effect 的接线', () => {
  const block = toolBlock('generate_sound_effect')

  it('暴露 prompt / loop / durationSeconds / promptInfluence', () => {
    for (const key of ['prompt', 'loop', 'durationSeconds', 'promptInfluence']) {
      expect(block, `缺少 ${key}`).toContain(key)
    }
    expect(block).toMatch(/required: \['prompt'\]/)
  })

  it('schema 里写明规范范围（0.5–30 与 0–1）', () => {
    expect(block).toMatch(/0\.5–30/)
    expect(block).toMatch(/0–1/)
  })

  it('走 generateSoundEffectAsset（按能力解析提供商的既有链路）', () => {
    expect(block).toContain('modelProviderFacade.generateSoundEffectAsset(input)')
  })

  it('不在 handler 重复夹数值 —— 上游 buildElevenSoundRequest 是唯一夹紧点', () => {
    // 重复夹一次只会让两处规则有机会漂移。
    // 断言"没有调用"，而不是"没提到" —— 注释里会解释为什么不再夹，那不算违规。
    expect(block).not.toMatch(/clampNumber\s*\(/)
    expect(block).not.toMatch(/Math\.min\(\s*30/)
    expect(block).not.toMatch(/Math\.max\(\s*0\.5/)
  })

  it('活动名用 generate_sound_effect', () => {
    expect(block).toContain("'generate_sound_effect'")
  })
})

describe('两个新工具都遵守对话生成工具的既有约定', () => {
  it('description 指出缓存目录并引导 agent 走「保存到资产库」按钮', () => {
    expect(toolBlock('generate_dialogue')).toMatch(/Cache\/Voices/)
    expect(toolBlock('generate_sound_effect')).toMatch(/Cache\/Sfx/)
    for (const name of ['generate_dialogue', 'generate_sound_effect']) {
      expect(toolBlock(name), `${name} 未引导「保存到资产库」`).toMatch(/保存到资产库/)
    }
  })

  it('都不暴露 outputDir / folderId（Cache-only 工作流）', () => {
    for (const name of ['generate_dialogue', 'generate_sound_effect']) {
      const b = toolBlock(name)
      expect(b, `${name} 仍暴露 outputDir`).not.toMatch(/['"]?outputDir['"]?\s*:/)
      expect(b, `${name} 仍暴露 folderId`).not.toMatch(/['"]?folderId['"]?\s*:/)
    }
  })

  it('都比对话生成工具多一步：没有把 settle 钩子置为入库（保持 Cache-only）', () => {
    for (const name of ['generate_dialogue', 'generate_sound_effect']) {
      expect(toolBlock(name), `${name} 的 settle 钩子不是 undefined`).toMatch(
        /,\s*\n\s*undefined,\s*\n/
      )
    }
  })

  it('都经 cacheOnlyGenExtraParams 剥掉夹带的入库参数', () => {
    for (const name of ['generate_dialogue', 'generate_sound_effect']) {
      expect(toolBlock(name)).toContain('...cacheOnlyGenExtraParams(args)')
    }
  })
})

describe('活动名已登记（否则 runGenActivity 传新名字会类型报错）', () => {
  const ipc = readFileSync(resolve('src/shared/ipc.ts'), 'utf8')

  it('McpActivityTool 含 generate_dialogue / generate_sound_effect', () => {
    expect(ipc).toContain("| 'generate_dialogue'")
    expect(ipc).toContain("| 'generate_sound_effect'")
  })
})
