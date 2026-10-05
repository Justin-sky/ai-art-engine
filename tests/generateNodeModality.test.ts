import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { generateNodeModality, usesVoiceProfile } from '../src/shared/graph/generateNodeModality'

/**
 * 生成节点该读哪个模态的模型。
 *
 * 这条链上踩过两次同类坑：对话 / 音效 / 音乐三个节点都是**声音资产的变体**，
 * `assetType` 一律是 `voice`，所以任何「按 assetType 判模态」的写法都会把它们
 * 当成 TTS。
 *
 * 用户实际报过：**音乐节点的模型下拉里是 TTS 模型**
 * —— 因为音乐节点沿用声音节点的 `instructionKind`（'voice'），
 * 而 modality 映射把 'voice' 直接翻译成 'audio'。
 */
describe('generateNodeModality', () => {
  it('音乐节点读 music 模态（它 assetType 也是 voice）', () => {
    expect(generateNodeModality({ typeId: 'asset.music', assetType: 'voice' })).toBe('music')
  })

  it('对话与音效用声音模态的模型（各自另有选择器）', () => {
    expect(generateNodeModality({ typeId: 'asset.dialogue', assetType: 'voice' })).toBe('audio')
    expect(generateNodeModality({ typeId: 'asset.sfx', assetType: 'voice' })).toBe('audio')
    // 纯声音节点仍是音频
    expect(generateNodeModality({ typeId: 'asset.voice', assetType: 'voice' })).toBe('audio')
  })

  it('其它资产类型按其自身模态', () => {
    expect(generateNodeModality({ typeId: 'asset.image', assetType: 'image' })).toBe('image')
    expect(generateNodeModality({ typeId: 'asset.video', assetType: 'video' })).toBe('video')
    expect(generateNodeModality({ typeId: 'asset.model3d', assetType: 'model3d' })).toBe('model3d')
    expect(generateNodeModality({ assetType: 'spatialWorld' })).toBe('spatialWorld')
    // 未知 / 加工节点：文本是安全默认（与卡片既有行为一致）
    expect(generateNodeModality({ typeId: 'note.text', assetType: 'text' })).toBe('text')
    expect(generateNodeModality({})).toBe('text')
  })

  it('变体节点的判断必须排在 assetType=voice 之前（否则又被当成 TTS）', () => {
    // 顺序敏感的证明：两个入参只有 typeId 不同，结果必须不同
    const voice = { assetType: 'voice' as const }
    expect(generateNodeModality({ ...voice, typeId: 'asset.music' })).not.toBe(
      generateNodeModality({ ...voice, typeId: 'asset.voice' })
    )
  })
})

/**
 * 角色音色档案（generateSpeechCharacter）该不该出现在这个节点上。
 *
 * 只有走语音合成的节点才会用到它：`facade.generateSpeech` 里的 `applyVoiceProfile`
 * 会把档案解析成 voice / referenceAudio。`generateMusic` **不解析档案**
 * （`GenerateMusicInput` 连 voiceProfile 字段都没有），音效端点也不吃音色 ——
 * 在这两类节点上放这个下拉，用户选了不会生效。
 */
describe('usesVoiceProfile', () => {
  it('音乐与音效节点不显示角色音色（选了不生效）', () => {
    expect(usesVoiceProfile({ typeId: 'asset.music', assetType: 'voice' })).toBe(false)
    expect(usesVoiceProfile({ typeId: 'asset.sfx', assetType: 'voice' })).toBe(false)
  })

  it('声音与多说话人对话节点显示（对话按说话人绑的音色也来自档案体系）', () => {
    expect(usesVoiceProfile({ typeId: 'asset.voice', assetType: 'voice' })).toBe(true)
    expect(usesVoiceProfile({ typeId: 'asset.dialogue', assetType: 'voice' })).toBe(true)
  })

  it('非声音资产一律不显示', () => {
    expect(usesVoiceProfile({ typeId: 'asset.image', assetType: 'image' })).toBe(false)
    expect(usesVoiceProfile({})).toBe(false)
  })
})

/**
 * 源码级守卫：两处 UI 都必须把音乐节点路由到 music 模态。
 *
 * 这段判定原先在 GraphNodeCard 与 ShotNodeInspector 里各写了一遍 `'audio'`，
 * 就是漏改的来源；纯函数解决「判什么」，这里守「有没有用」。
 */
describe('模态路由的接线', () => {
  it('GraphNodeCard：音乐节点在 voice 分支之前返回 music', () => {
    const src = readFileSync('src/renderer/src/components/GraphNodeCard.vue', 'utf8')
    const start = src.indexOf('const instructionModality = computed')
    const block = src.slice(start, src.indexOf('const instructionPlaceholder', start))
    // 定位**语句**而不是注释里的提及
    const musicAt = block.indexOf("if (isMusicNode.value) return 'music'")
    const voiceAt = block.indexOf("if (instructionKind.value === 'voice')")
    expect(musicAt, '音乐分支缺失').toBeGreaterThanOrEqual(0)
    expect(voiceAt, 'voice 分支缺失').toBeGreaterThanOrEqual(0)
    expect(musicAt, '音乐分支必须在 voice 之前，否则音乐下拉会拿到 TTS 模型').toBeLessThan(voiceAt)
  })

  it('ShotNodeInspector：生成模型加载走统一判定，不再硬编码 audio', () => {
    const src = readFileSync('src/renderer/src/components/ShotNodeInspector.vue', 'utf8')
    // 声音分支与 isVoice 的 watch 都必须用统一判定
    expect(src).toContain('loadModels(generateNodeModality(current), preferred)')
    expect(src).toContain('loadModels(generateNodeModality(current), selectedModelKey.value)')
    // 不得再出现「声音节点一律 loadModels('audio')」的写法
    expect(src).not.toContain("if (yes) void loadModels('audio'")
    expect(src).not.toContain(
      '// 声音节点没有系统提示词字段（TTS 会把指令一起念出来），只加载音频模型'
    )
  })

  it('ShotNodeInspector：角色音色行由 usesVoiceProfile 决定，不再按 assetType 手写排除', () => {
    const src = readFileSync('src/renderer/src/components/ShotNodeInspector.vue', 'utf8')
    expect(src).toContain('v-if="showsVoiceProfile"')
    expect(src).toContain('usesVoiceProfile(node.value)')
    // 旧的按 assetType / typeId 手写排除的写法（漏掉音乐就是这个原因）
    expect(src).not.toContain('v-if="isVoice && !isSoundEffect"')
  })
})
