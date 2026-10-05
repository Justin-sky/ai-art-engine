/**
 * OpenRouter 音乐生成。
 *
 * 与 TTS 共用 `POST /audio/speech`（OpenRouter 没有 `/v1/music`：
 * 实测 `/audio/generations`、`/audio/music`、`/v1/music` 全是 404），
 * 差别只在**不发 `voice`**：
 *
 * - 音乐模型（Google Lyria 3）的 `supported_voices` 是 null，它不吃音色
 * - 而 `output_modalities=audio`（音乐）与 `=speech`（TTS）同属音频域，
 *   facade 的默认音色兜底 `resolveDefaultVoice` 会去**同一个 audio 模态**的音色目录里
 *   挑第一个 —— 那是微软 TTS 的音色名（如 `cs-CZ-Grant:MAI-Voice-2.1-Flash`），
 *   塞给 Lyria 就是坏请求。实测给无音色模型发音色会回
 *   `speaker ... not found in speaker_map`，所以必须在这里挡掉。
 *
 * 音乐模型吃的是编曲描述：把它当 `input` 发即可；歌词用换行拼在描述后
 * （OpenRouter 的音乐条目没有独立的 lyrics 字段，`supported_parameters` 里
 * 也没有歌词项）。
 */
export function buildOpenRouterMusicInput(input: {
  prompt: string
  lyrics?: string
  instrumental?: boolean
}): { input: string } {
  const parts = [input.prompt.trim()]
  const lyrics = input.lyrics?.trim()
  // 纯音乐时不附歌词；有歌词就并进同一条文本（没有独立字段可放）
  if (lyrics && input.instrumental === false) parts.push(lyrics)
  return { input: parts.filter(Boolean).join('\n\n') }
}
