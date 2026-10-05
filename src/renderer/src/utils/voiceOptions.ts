/**
 * 音色候选的排序与筛选。
 *
 * 为什么需要：`supported_voices` 是**真实存在且可能很长**的列表 ——
 * 实测 OpenRouter 的 `microsoft/mai-voice-2.1` 有 97 个音色、`deepgram/aura-2` 90 个。
 * 原样丢进 datalist，中文用户要在 `pt-PT-*` / `ru-RU-*` 里翻半天才找到 `zh-CN-*`。
 *
 * 音色 id 的常见命名（各家约定俗成，但不保证）：
 *   `zh-CN-Mei:MAI-Voice-2.1`（语言-地区-名字[:模型]）
 *   `aura-2-agathe-fr`（……语言在尾部）
 *   `af_alloy`（Kokoro：语言+口音前缀）
 *   `English_expressive_narrator`（MiniMax：英文语言名开头）
 *   `eve` / `Zephyr`（无语言信息）
 */

/** 从音色 id 里尽力识别语言标签；识别不出返回 null */
export function voiceLanguageTag(voiceId: string): string | null {
  const id = voiceId.trim()
  if (!id) return null

  // zh-CN-Mei / en-US-Harper:MAI-Voice-2.1 —— BCP-47 风格出现在开头。
  // 用「后面不是字母」代替 \b：实测 \b 在 `_` 前后不匹配（Node 上 `\benglish\b` 对
  // `English_expressive_narrator` 返回 null），而音色 id 的分隔符恰恰多是 `_`
  const head = /^([a-z]{2})-([A-Z]{2})(?![A-Za-z])/.exec(id)
  if (head) return `${head[1].toLowerCase()}-${head[2].toLowerCase()}`

  // English_expressive_narrator —— 整词英文语言名开头。
  // 必须排在 Kokoro 前缀规则**之前**：否则 `En` 会被当成语言+口音前缀。
  // `(?![a-z])` 同时挡掉 Englishman 这类「恰好多几个字母」的误判
  const word =
    /^(english|chinese|japanese|korean|french|german|spanish|italian|portuguese|russian)(?![a-z])/i.exec(
      id
    )
  if (word) {
    const map: Record<string, string> = {
      english: 'en',
      chinese: 'zh',
      japanese: 'ja',
      korean: 'ko',
      french: 'fr',
      german: 'de',
      spanish: 'es',
      italian: 'it',
      portuguese: 'pt',
      russian: 'ru'
    }
    return map[word[1].toLowerCase()] ?? null
  }

  // aura-2-agathe-fr / en_paul_sad —— 语言码出现在末尾（两字母，前后是分隔符）
  const tail = /[-_]([a-z]{2})$/.exec(id)
  if (tail) return tail[1]

  // af_alloy（Kokoro 的 语言+口音 前缀：af/am/bf/bm/ef/ff/hf/hm/if/im/jf/jm/pf/pm/zf/zm）
  const kokoro = /^([a-z])([a-z])_/.exec(id)
  if (kokoro) return `${kokoro[1]}${kokoro[2]}`

  return null
}

/** 应用语言（如 zh-CN）的主语言码（zh） */
export function primaryLanguage(locale: string): string {
  return locale.trim().toLowerCase().split(/[-_]/)[0] ?? ''
}

/**
 * 把与当前语言相关的音色排到前面，其余保持原顺序。
 *
 * 只排序不过滤：不隐藏任何音色（用户可能就是要配外语角色），
 * 只是让最可能用到的先出现。列表本身不改动、不去重。
 */
export function sortVoicesForLocale(voices: string[], locale: string): string[] {
  const want = primaryLanguage(locale)
  if (!want) return [...voices]
  const mine: string[] = []
  const rest: string[] = []
  for (const voice of voices) {
    const tag = voiceLanguageTag(voice)
    if (tag && (tag === want || tag.startsWith(want))) mine.push(voice)
    else rest.push(voice)
  }
  return [...mine, ...rest]
}
