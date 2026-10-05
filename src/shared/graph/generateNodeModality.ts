import type { ModelModality } from '../modelProvider'

/** 生成节点的模型选择器要读哪个模态的目录 */
export type GenerateNodeModality = Extract<
  ModelModality,
  'text' | 'image' | 'video' | 'audio' | 'music' | 'model3d' | 'spatialWorld' | 'decisions'
>

/** 判定所需的节点身份：只看 typeId（assetType 对这几个变体节点都是 voice） */
export interface GenerateNodeIdentity {
  typeId?: string | null
  assetType?: string | null
}

/**
 * 「这个节点该从哪个模态取模型」的**唯一事实来源**。
 *
 * 为什么必须收口：对话 / 音效 / 音乐三个节点都是**声音资产的变体**，
 * `assetType` 一律是 `voice`，所以任何「按 assetType 判模态」的写法都会把它们
 * 统统当成 TTS。踩过的坑：
 * - 音乐节点的模型下拉里出现的是 TTS 模型（它其实是 music 模态）
 * - 音效节点同理
 *
 * 判断顺序很关键：**变体节点必须在 `assetType === 'voice'` 之前判**。
 */
export function generateNodeModality(node: GenerateNodeIdentity): GenerateNodeModality {
  // 音乐是独立模态：模型来自 music 目录（MiniMax music-* / 百炼 fun-music-* /
  // ElevenLabs music_* / OpenRouter 的 Google Lyria）
  if (node.typeId === 'asset.music') return 'music'
  // 对话与音效**不按 modality 取模型**：
  // - 对话用声音模态的 TTS 模型（多说话人只是换个端点）
  // - 音效的模型是唯一取值，选的是提供商实例（见 buildSoundEffectOptions）
  // 这里给 audio 只作为安全默认，两个节点各自另有选择器。
  if (node.typeId === 'asset.dialogue' || node.typeId === 'asset.sfx') return 'audio'

  switch (node.assetType) {
    case 'image':
      return 'image'
    case 'video':
      return 'video'
    case 'voice':
      return 'audio'
    case 'model3d':
      return 'model3d'
    case 'spatialWorld':
      return 'spatialWorld'
    default:
      return 'text'
  }
}

/**
 * 该生成节点是否**真的会用到「角色音色档案」**（generateSpeechCharacter）。
 *
 * 只有走语音合成的节点才会：`facade.generateSpeech` 里 `applyVoiceProfile`
 * 会把档案解析成 voice / referenceAudio。
 * `generateMusic` **不解析档案**（`GenerateMusicInput` 都没有 voiceProfile 字段），
 * 音效端点也不吃音色 —— 在这两类节点上放这个下拉，用户选了不会生效。
 */
export function usesVoiceProfile(node: GenerateNodeIdentity): boolean {
  if (node.typeId === 'asset.music' || node.typeId === 'asset.sfx') return false
  return node.assetType === 'voice'
}
