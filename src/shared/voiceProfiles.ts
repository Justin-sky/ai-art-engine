/**
 * 角色音色档案（ROADMAP 5.2）：工程级「角色 → 音色」映射，持久化于
 * `.aiartengine/voiceProfiles.json`，供语音生成按角色复用音色（跨镜头一致配音）
 * 与参考音频克隆（few-shot voice clone）。
 *
 * 本模块为纯函数（不依赖 node fs / 渲染层），便于测试；
 * 落盘与对话注入由 main 侧（projectService / mcpServerService / facade）负责。
 */

export const VOICE_PROFILES_RELATIVE_PATH = '.aiartengine/voiceProfiles.json'

export interface VoiceProfile {
  /** 角色名（唯一键） */
  character: string
  /** 已购/已设计的音色 id（MiniMax voice_id / 方舟 speaker_id）；二选一 */
  voice?: string
  /** 音色描述（用于 voice_design 或给 Agent 参考） */
  description?: string
  /** 克隆参考音频：工程内相对路径或 http(s) URL（10-30s 人声） */
  referenceAudio?: string
  updatedAt: string
}

export interface VoiceProfilesFile {
  version: 1
  profiles: VoiceProfile[]
}

export function normalizeVoiceProfiles(raw: unknown): VoiceProfile[] {
  if (!raw || typeof raw !== 'object') return []
  const file = raw as Partial<VoiceProfilesFile>
  if (!Array.isArray(file.profiles)) return []
  const seen = new Set<string>()
  const out: VoiceProfile[] = []
  for (const item of file.profiles) {
    if (!item || typeof item !== 'object') continue
    const p = item as Partial<VoiceProfile>
    const character = String(p.character ?? '').trim()
    if (!character || seen.has(character)) continue
    seen.add(character)
    out.push({
      character,
      ...(typeof p.voice === 'string' && p.voice.trim() ? { voice: p.voice.trim() } : {}),
      ...(typeof p.description === 'string' && p.description.trim()
        ? { description: p.description.trim() }
        : {}),
      ...(typeof p.referenceAudio === 'string' && p.referenceAudio.trim()
        ? { referenceAudio: p.referenceAudio.trim() }
        : {}),
      updatedAt: typeof p.updatedAt === 'string' ? p.updatedAt : new Date().toISOString()
    })
  }
  return out
}

export function serializeVoiceProfiles(profiles: VoiceProfile[]): string {
  const file: VoiceProfilesFile = { version: 1, profiles }
  return JSON.stringify(file, null, 2)
}

export function findVoiceProfile(
  profiles: VoiceProfile[],
  character: string | undefined | null
): VoiceProfile | undefined {
  const key = String(character ?? '').trim()
  if (!key) return undefined
  return profiles.find((p) => p.character === key)
}

export function upsertVoiceProfile(
  profiles: VoiceProfile[],
  input: {
    character: string
    voice?: string
    description?: string
    referenceAudio?: string
  }
): VoiceProfile[] {
  const character = String(input.character ?? '').trim()
  if (!character) return profiles
  const existing = findVoiceProfile(profiles, character)
  const next: VoiceProfile = {
    character,
    ...(String(input.voice ?? '').trim() ? { voice: input.voice!.trim() } : {}),
    ...(String(input.description ?? '').trim() ? { description: input.description!.trim() } : {}),
    ...(String(input.referenceAudio ?? '').trim()
      ? { referenceAudio: input.referenceAudio!.trim() }
      : {}),
    updatedAt: new Date().toISOString()
  }
  if (existing) {
    return profiles.map((p) => (p.character === character ? { ...p, ...next } : p))
  }
  return [...profiles, next]
}

export function deleteVoiceProfile(
  profiles: VoiceProfile[],
  character: string | undefined | null
): VoiceProfile[] {
  const key = String(character ?? '').trim()
  if (!key) return profiles
  return profiles.filter((p) => p.character !== key)
}

/** 按角色解析实际语音参数：优先显式入参，其次档案 */
export function resolveVoiceProfileParams(
  profile: VoiceProfile | undefined,
  explicit: { voice?: string; referenceAudio?: string }
): { voice?: string; referenceAudio?: string } {
  return {
    ...(profile?.voice || explicit.voice ? { voice: explicit.voice || profile?.voice } : {}),
    ...(profile?.referenceAudio || explicit.referenceAudio
      ? { referenceAudio: explicit.referenceAudio || profile?.referenceAudio }
      : {})
  }
}

const EMPTY_NOTE = { zh: '暂无角色音色档案', en: 'No voice profiles yet' }

/** 注入对话 / 展示用摘要（Markdown 列表） */
export function voiceProfilesToMarkdown(profiles: VoiceProfile[]): string {
  if (!profiles.length) return `（${EMPTY_NOTE.zh} / ${EMPTY_NOTE.en}）`
  return profiles
    .map((p) => {
      const parts = [p.character]
      if (p.voice) parts.push(`voice=${p.voice}`)
      if (p.referenceAudio) parts.push(`clone=${p.referenceAudio}`)
      if (p.description) parts.push(`desc="${p.description}"`)
      return `- ${parts.join(' | ')}`
    })
    .join('\n')
}
