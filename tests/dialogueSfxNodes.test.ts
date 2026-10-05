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

  it('host 路由：dialogue 与 sfx 都必须排在 voice 之前', () => {
    const host = readFileSync('src/shared/graph/execute/host.ts', 'utf8')
    const dialogueAt = host.indexOf("node.typeId === 'asset.dialogue'")
    const sfxAt = host.indexOf("node.typeId === 'asset.sfx'")
    const voiceAt = host.indexOf("node.typeId === 'asset.voice'")
    expect(dialogueAt).toBeGreaterThanOrEqual(0)
    expect(sfxAt).toBeGreaterThanOrEqual(0)
    expect(voiceAt).toBeGreaterThanOrEqual(0)
    // 两者的 assetType 都是 voice：先判 voice 就会把对话稿当单说话人念、
    // 把音效描述当台词念（踩过后者）
    expect(dialogueAt).toBeLessThan(voiceAt)
    expect(sfxAt).toBeLessThan(voiceAt)
    expect(host).toContain('executeDialogueGenerateNode(ctx)')
    expect(host).toContain('executeSoundEffectNode(ctx)')
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

  it('音效节点在没有音效能力时**明确报错**，不回退到声音节点', () => {
    const src = readFileSync('src/shared/graph/execute/generateMedia.ts', 'utf8')
    const block = src.slice(src.indexOf('export async function executeSoundEffectNode'))
    // 静默回退会把音效描述「念」一遍，产出听起来成功但其实完全不对的语音
    expect(block).not.toContain('return executeVoiceGenerateNode(ctx)')
    expect(block).toContain('throw fail(SHARED_ERRORS.soundEffectUnsupported)')
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

  it('音效节点的提供商下拉**保留**，但模型固定成唯一取值', () => {
    const card = readFileSync('src/renderer/src/components/GraphNodeCard.vue', 'utf8')
    // 下拉同时是「选提供商实例」的入口（key 是 providerId::model），
    // 多 Key / 多账号时删掉它就等于没得选 —— 所以必须保留
    expect(card).not.toContain('v-if="!isSoundEffectNode"')
    expect(card).toContain('buildSoundEffectOptions(await loadAllProviders())')
    // 固定模型+每提供商一项由纯函数负责（单测见 generateModelOptions.test.ts）
    expect(card).toContain('const isSoundEffectNode = computed')
    // 音色选择器仍必须排除音效节点（音效没有「音色」这个概念）
    const selectBlock = card.slice(
      card.indexOf('const showSpeechVoice = computed'),
      card.indexOf('const speechVoice = computed')
    )
    expect(selectBlock).toContain('!isSoundEffectNode.value')
    // 有音效专用的指令占位文案（否则仍写着「描述要生成的声音/视频」那套）
    expect(card).toContain("t('graph.inspector.generate.sfxInstructionPlaceholder')")
    // 下拉标题点明「模型固定」，免得又像在选 TTS 模型
    expect(card).toContain("t('graph.inspector.generate.soundEffectProvider')")
  })

  it('音效请求恒用唯一 model_id（节点上的 TTS 模型不会透传成坏请求）', () => {
    // 请求体构造层不接受外部 modelId：SDK 的类型是字面量 SfxModelId，
    // 被坏值覆盖就是上游 400
    const voice = readFileSync('src/shared/modelProviders/elevenlabs/voice.ts', 'utf8')
    const start = voice.indexOf('export function buildElevenSoundRequest')
    // 只取这一个函数体（到下一个顶层 export 为止），否则会把别的函数的 input.modelId 算进来
    const nextExport = voice.indexOf('\nexport ', start + 1)
    const block = voice.slice(start, nextExport > start ? nextExport : undefined)
    expect(block).toContain('modelId: ELEVEN_SOUND_MODEL')
    expect(block).not.toContain('input.modelId')
    // 适配器也不认入参 modelId
    const adapter = readFileSync('src/main/services/modelProviders/elevenlabs/adapter.ts', 'utf8')
    const sfxStart = adapter.indexOf('async generateSoundEffect')
    const sfxBlock = adapter.slice(sfxStart, adapter.indexOf('submitModel3d', sfxStart))
    expect(sfxBlock).toContain('_modelId')
    expect(sfxBlock).toContain('model: ELEVEN_SOUND_MODEL')
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
