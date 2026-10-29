/**
 * 音频生成提供商的「账号级」不可用记录（额度耗尽 / 免费套餐不开放 / 欠费）。
 *
 * 为什么需要：「一句话生成游戏」按「配置了音效 / 音乐模型就用 AI」决定是否插入 AI 音频节点，
 * 但配置了不等于能用——ElevenLabs 免费账号调音乐接口直接 403「not available for free users」，
 * 额度用完的账号调音效报「exceeds your quota」。这类失败重试也必然失败，
 * 每次生成都白调一次、节点报红。记录下来后，后续生成直接改用程序化合成并说明原因。
 *
 * 只记账号级失败（按错误文案识别）；网络抖动 / 超时等瞬时错误不记，避免误把可用的模型关掉。
 * 同一提供商成功生成一次即清除；记录 6 小时后过期（用户可能已充值 / 升级）。
 */

export type AudioGenerationKind = 'sfx' | 'music'

interface UnavailableRecord {
  providerId: string
  reason: string
  at: number
}

const RECORD_TTL_MS = 6 * 60 * 60 * 1000

const records = new Map<AudioGenerationKind, UnavailableRecord>()

/** 账号级失败：额度 / 套餐 / 计费。只看文案，不依赖具体提供商的错误码 */
const ACCOUNT_LEVEL_FAILURE_RE =
  /quota|credits? remaining|not enough credits|insufficient (credits|balance|funds)|free (users|tier|plan)|paid plan|upgrade (your|to)|subscription|billing|payment required|exceeds your/i

export function isAccountLevelAudioFailure(message: string): boolean {
  return ACCOUNT_LEVEL_FAILURE_RE.test(String(message ?? ''))
}

/** 记录一次失败；不是账号级失败时忽略。返回是否记录 */
export function recordAudioProviderFailure(
  kind: AudioGenerationKind,
  providerId: string,
  message: string,
  now: number = Date.now()
): boolean {
  if (!isAccountLevelAudioFailure(message)) return false
  records.set(kind, {
    providerId,
    reason: String(message).replace(/\s+/g, ' ').trim().slice(0, 200),
    at: now
  })
  return true
}

/** 同一提供商成功生成后清除记录 */
export function recordAudioProviderSuccess(kind: AudioGenerationKind, providerId: string): void {
  const prev = records.get(kind)
  if (prev && prev.providerId === providerId) records.delete(kind)
}

/** 该类音频当前是否已知不可用；返回原因（可用时返回 null） */
export function audioProviderUnavailableReason(
  kind: AudioGenerationKind,
  now: number = Date.now()
): string | null {
  const record = records.get(kind)
  if (!record) return null
  if (now - record.at > RECORD_TTL_MS) {
    records.delete(kind)
    return null
  }
  return record.reason
}

/** 测试用：清空记录 */
export function resetAudioProviderHealth(): void {
  records.clear()
}
