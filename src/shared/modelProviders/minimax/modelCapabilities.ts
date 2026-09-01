import type { CatalogModel, ModelModality } from '@shared/modelProvider'
import catalog from './modelCapabilities.json'

export interface MiniMaxModelEntry {
  id: string
  name: string
  modality: 'text' | 'image' | 'video' | 'audio'
  profile: string
}

export interface MiniMaxModelCapabilitiesCatalog {
  meta: {
    console: string
    docs: string[]
    note: string
  }
  models: MiniMaxModelEntry[]
  profiles: Record<
    string,
    {
      modality: 'text' | 'image' | 'video' | 'audio'
      label: string
      capabilities: Record<string, unknown>
    }
  >
}

const data = catalog as MiniMaxModelCapabilitiesCatalog

export function getMiniMaxModelCapabilitiesCatalog(): MiniMaxModelCapabilitiesCatalog {
  return data
}

function profileCapabilities(profileId: string): Record<string, unknown> | null {
  const profile = data.profiles[profileId]
  if (!profile?.capabilities) return null
  return { ...profile.capabilities }
}

/** 按模型 id 解析静态能力；未收录时按型号/模态启发式回退 */
export function resolveMiniMaxModelCapabilities(
  modelId: string,
  modality?: 'text' | 'image' | 'video' | 'audio'
): Record<string, unknown> | null {
  const id = modelId.trim()
  const entry = data.models.find((m) => m.id === id)
  if (entry) return profileCapabilities(entry.profile)

  const mod =
    modality ??
    (/hailuo|t2v|i2v|MiniMax-H\d/i.test(id)
      ? 'video'
      : /image-/i.test(id)
        ? 'image'
        : /voice|speech|tts/i.test(id)
          ? 'audio'
          : /music/i.test(id)
            ? 'audio'
            : 'text')

  if (mod === 'text' || /^MiniMax-M/i.test(id)) return profileCapabilities('text-base')
  if (mod === 'audio') {
    return /music/i.test(id)
      ? profileCapabilities('audio-music')
      : profileCapabilities('audio-voice-design')
  }
  if (mod === 'image') {
    return profileCapabilities(/live/i.test(id) ? 'image-live' : 'image-base')
  }
  if (/MiniMax-H\d/i.test(id)) return profileCapabilities('video-h3')
  if (/hailuo-02/i.test(id)) return profileCapabilities('video-hailuo-02')
  if (/fast/i.test(id)) return profileCapabilities('video-hailuo-23-fast')
  return profileCapabilities('video-hailuo-23')
}

/** 设置页「拉取模型」：返回静态目录 */
export function listMiniMaxCatalogModels(modality: ModelModality): CatalogModel[] {
  if (modality !== 'text' && modality !== 'image' && modality !== 'video' && modality !== 'audio') {
    return []
  }
  return data.models
    .filter((m) => m.modality === modality)
    .map((m) => ({
      id: m.id,
      name: m.name,
      modality,
      capabilities: resolveMiniMaxModelCapabilities(m.id, modality) ?? undefined
    }))
}

/** 远程 /models 条目是否应归入文本目录（排除视频/语音/图片/音乐） */
export function isMiniMaxTextCatalogId(modelId: string): boolean {
  const id = modelId.trim()
  if (!id) return false
  if (/hailuo|speech|tts|image-|music-|voice|T2V|I2V|S2V|MiniMax-H\d/i.test(id)) return false
  return /^MiniMax-M/i.test(id) || /abab|minimax/i.test(id)
}
