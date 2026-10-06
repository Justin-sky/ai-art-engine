/**
 * 多说话人对话稿的解析（ElevenLabs Text to Dialogue）。
 *
 * 端点要的是结构化输入 `inputs: [{ text, voice_id }]`，而图里的指令框只能给文本，
 * 所以约定一种**行式写法**（与剧本对白同形，作者一眼就懂）：
 *
 *   A: 你终于来了。
 *   B: 路上堵车。
 *   你终于来了。            ← 没有冒号 → 沿用上一段的说话人
 *
 * 只在**行首**认「短前缀 + 冒号」，避免把正文里的冒号当说话人：
 * 前缀必须是 1–24 个非冒号非换行字符，且不含标点。
 */

/** 一段台词：说话人（可选）+ 正文 */
export interface DialogueLine {
  /** 说话人标签；解析不出来时为 undefined（沿用上一段） */
  speaker?: string
  text: string
}

/**
 * 行首「说话人：」前缀。
 *
 * 前缀不含任何标点（中英文都算）—— 否则「你好，世界: 台词」会被当成
 * 一个叫「你好，世界」的说话人，把正文首句吃掉。
 * 长度上限 24 字：说话人名不会更长，同时挡住「整句正文 + 冒号」的情况。
 */
const SPEAKER_PREFIX =
  /^([^\s:：。！？；，、,.!?;、"'"“”()（）\[\]【】《》〈〉…—\-]{1,24})\s*[:：]\s*(.*)$/

/**
 * 把指令框文本解析成对话行。
 *
 * 空行忽略；没有说话人的行沿用上一段的说话人（连续独白/旁白常见）。
 * 整段都解析不出说话人时，返回的行都没有 speaker —— 调用方据此判断
 * 「这只是一段普通台词」并退回单说话人 TTS。
 */
export function parseDialogueScript(raw: string): DialogueLine[] {
  const out: DialogueLine[] = []
  let lastSpeaker: string | undefined
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const match = SPEAKER_PREFIX.exec(line)
    if (match) {
      const speaker = match[1]!.trim()
      const text = match[2]!.trim()
      lastSpeaker = speaker
      // `A:`（只有前缀没有台词）视为空段，跳过但保留说话人上下文
      if (text) out.push({ speaker, text })
      continue
    }
    out.push({ ...(lastSpeaker ? { speaker: lastSpeaker } : {}), text: line })
  }
  return out
}

/** 对话里出现的说话人（按首次出现顺序，去重） */
export function dialogueSpeakers(lines: DialogueLine[]): string[] {
  const seen: string[] = []
  for (const line of lines) {
    if (line.speaker && !seen.includes(line.speaker)) seen.push(line.speaker)
  }
  return seen
}

/**
 * 说话人 → 音色的映射：丢掉空值与非法项。
 *
 * 放在这里而不是执行器里，是因为**图节点与 MCP 工具都要用它**：
 * 两边各写一份的话，宽容度会慢慢漂移（一边认全角冒号另一边不认这类）。
 *
 * @param raw 节点参数 `generateDialogueVoices` 或 MCP 工具入参 `voices`
 */
export function normalizeDialogueVoiceMap(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, string> = {}
  for (const [speaker, voice] of Object.entries(raw as Record<string, unknown>)) {
    const key = speaker.trim()
    if (!key || typeof voice !== 'string') continue
    const value = voice.trim()
    if (value) out[key] = value
  }
  return out
}

/**
 * 把解析出的行映射成端点的 `inputs`。
 *
 * @param voiceBySpeaker 说话人 → 音色 id（来自节点参数；单说话人节点用 `fallbackVoice`）
 * @param fallbackVoice  没匹配到说话人时的音色（如只有一种音色时的整体配音）
 * @returns 每段都带 voice_id 的输入；缺音色的段落直接标出索引，便于调用方报错
 */
export function buildDialogueInputs(
  lines: DialogueLine[],
  voiceBySpeaker: Record<string, string>,
  fallbackVoice?: string
): { inputs: Array<{ text: string; voice: string }>; missingVoiceAt: number[] } {
  const inputs: Array<{ text: string; voice: string }> = []
  const missingVoiceAt: number[] = []
  lines.forEach((line, index) => {
    const voice =
      (line.speaker ? voiceBySpeaker[line.speaker]?.trim() : '') || fallbackVoice?.trim()
    if (!voice) {
      missingVoiceAt.push(index)
      return
    }
    inputs.push({ text: line.text, voice })
  })
  return { inputs, missingVoiceAt }
}
