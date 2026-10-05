import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BUILTIN_NODE_TYPES } from '../src/shared/graph/builtins'

/**
 * 阶段二新增节点的接线。
 *
 * 这两个节点是**同一资产类型（voice）的变体**，只换了生成端点，
 * 所以接线里最容易出错的不是端口而是**执行路由**：
 * `asset.dialogue` 的 assetType 也是 voice，host 若先判 voice 就会把
 * 整篇对话稿当单说话人 TTS 念出来（而不是走 Text to Dialogue）。
 * 这条守卫就是钉住路由顺序。
 */
describe('多说话人对话 / 音效节点', () => {
  it('两个节点类型都已注册，且都输出声音资产', () => {
    for (const typeId of ['asset.dialogue', 'asset.sfx'] as const) {
      const matches = BUILTIN_NODE_TYPES.filter((d) => d.typeId === typeId)
      expect(matches, typeId).toHaveLength(1)
      const def = matches[0]!
      expect(def.category, typeId).toBe('asset')
      expect(def.assetType, typeId).toBe('voice')
      expect(def.addable, typeId).toBe(true)
      // 有音频输出口，才能接声音输出 / 选择节点
      expect(
        def.ports.some((p) => p.direction === 'out'),
        typeId
      ).toBe(true)
      // 有执行器：缺了就会退回引擎透传
      expect(typeof def.execute, typeId).toBe('function')
    }
  })

  it('host 路由先判 dialogue 再判 voice（否则对话稿会被当单说话人念出来）', () => {
    const host = readFileSync('src/shared/graph/execute/host.ts', 'utf8')
    const dialogueAt = host.indexOf("node.typeId === 'asset.dialogue'")
    const voiceAt = host.indexOf("node.typeId === 'asset.voice'")
    expect(dialogueAt).toBeGreaterThanOrEqual(0)
    expect(voiceAt).toBeGreaterThanOrEqual(0)
    expect(dialogueAt).toBeLessThan(voiceAt)
    expect(host).toContain('executeDialogueGenerateNode(ctx)')
    // 音效**不**走 host 路由：它由节点 def 的 execute 直接派发（见下一例）
    expect(host).not.toContain('executeSoundEffectNode')
  })

  it('节点 def 的 execute 按 typeId 派发到各自的执行器', () => {
    const builtins = readFileSync('src/shared/graph/builtins.ts', 'utf8')
    expect(builtins).toContain("variant.typeId === 'asset.dialogue'")
    expect(builtins).toContain('executeDialogueGenerateNode(ctx)')
    expect(builtins).toContain('executeSoundEffectNode(ctx)')
    // 两个节点都由同一份变体定义生成，端口与声音节点一致
    expect(builtins).toContain("typeId: 'asset.dialogue'")
    expect(builtins).toContain("typeId: 'asset.sfx'")
  })

  it('对话节点缺音色时给出可定位的报错（点名第几段 / 哪个说话人）', () => {
    const src = readFileSync('src/shared/graph/execute/generateMedia.ts', 'utf8')
    // 报错必须带上段号与说话人，否则长对话稿没法排查
    expect(src).toContain('SHARED_ERRORS.dialogueVoiceMissing')
    expect(src).toContain('missingVoiceAt.map((index) => index + 1).join')
    // 对话与音效都不拼系统提示词（TTS / 音效会把指令也念进去 / 生成进音频）
    const dialogueBlock = src.slice(
      src.indexOf('export async function executeDialogueGenerateNode'),
      src.indexOf('export async function executeSoundEffectNode')
    )
    expect(dialogueBlock).not.toContain('resolveVoiceSystemPrompt')
  })

  it('音效节点在没有音效能力时退回声音节点，不阻断整图', () => {
    const src = readFileSync('src/shared/graph/execute/generateMedia.ts', 'utf8')
    const block = src.slice(src.indexOf('export async function executeSoundEffectNode'))
    expect(block).toContain('if (!ctx.generateSoundEffect) return executeVoiceGenerateNode(ctx)')
    expect(block).toContain('ctx.generateSoundEffect(')
  })

  it('两条 IPC 通道都通了：音效生成与全量音频目录', () => {
    const ipc = readFileSync('src/shared/ipc.ts', 'utf8')
    expect(ipc).toContain("GEN_SOUND_EFFECT: 'gen:sfx'")
    expect(ipc).toContain("LIST_ALL_AUDIO_MODELS: 'models:audio-all'")
    expect(ipc).toContain('generateSoundEffect: (')
    const preload = readFileSync('src/preload/index.ts', 'utf8')
    expect(preload).toContain('IpcChannels.GEN_SOUND_EFFECT')
    expect(preload).toContain('IpcChannels.LIST_ALL_AUDIO_MODELS')
    const mainIpc = readFileSync('src/main/ipc.ts', 'utf8')
    expect(mainIpc).toContain('generateSoundEffectAsset')
  })

  it('音效落盘走 sfx 目录（与 BGM 的 music 目录分开）', () => {
    const facade = readFileSync('src/main/services/modelProviders/facade.ts', 'utf8')
    const block = facade.slice(facade.indexOf('async generateSoundEffectAsset'))
    expect(block).toContain("kind: 'sfx'")
    // 与音乐同形：两种取回方式都要支持
    expect(block).toContain('result.filePath')
    expect(block).toContain('result.downloadUrl')
  })
})
