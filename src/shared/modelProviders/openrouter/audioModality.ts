/**
 * OpenRouter 音频类模型的分类（纯函数，便于单测）。
 *
 * OpenRouter 用 `output_modalities` 把可生成的音频分成两组，含义不同：
 * - `speech`：**语音合成（TTS）**，条目带 `supported_voices`（如微软 MAI-Voice 有 97 个音色）
 * - `audio` ：**音乐生成**与对话式音频，条目 `supported_voices` 为 null
 *
 * 所以「音乐」不能靠 `supported_voices` 判（音乐模型本来就没音色），
 * 要看条目本身。实测 2026-10 的 `output_modalities=audio` 共 4 条：
 * - `google/lyria-3-pro-preview` / `google/lyria-3-clip-preview`：Google Lyria 3，
 *   音乐生成（按曲计价），走 `POST /api/v1/audio/speech`，`supported_parameters`
 *   含 `response_format` 且**不含**工具类参数
 * - `openai/gpt-audio` / `-mini`：对话式音频模型（输入 `text+audio`、带 `tools` /
 *   `tool_choice`），既不是 TTS 也不是音乐
 */
export interface OpenRouterAudioModelLike {
  id?: unknown
  architecture?: { input_modalities?: unknown; output_modalities?: unknown } | null
  supported_parameters?: unknown
  supported_voices?: unknown
}

function outputModalities(model: OpenRouterAudioModelLike): string[] {
  const raw = model.architecture?.output_modalities
  return Array.isArray(raw) ? raw.filter((m): m is string => typeof m === 'string') : []
}

function inputModalities(model: OpenRouterAudioModelLike): string[] {
  const raw = model.architecture?.input_modalities
  return Array.isArray(raw) ? raw.filter((m): m is string => typeof m === 'string') : []
}

function supportedParameters(model: OpenRouterAudioModelLike): string[] {
  const raw = model.supported_parameters
  return Array.isArray(raw) ? raw.filter((p): p is string => typeof p === 'string') : []
}

/** 语音合成（TTS）：`output_modalities` 含 `speech` */
export function isOpenRouterSpeechModel(model: OpenRouterAudioModelLike): boolean {
  return outputModalities(model).includes('speech')
}

/**
 * 音乐生成模型：输出 `audio`（非 `speech`）、不吃工具调用（排除对话式音频）、
 * 且带 `response_format`（`/audio/speech` 那个端点要求的能力）。
 */
export function isOpenRouterMusicModel(model: OpenRouterAudioModelLike): boolean {
  const out = outputModalities(model)
  if (!out.includes('audio') || out.includes('speech')) return false
  const params = supportedParameters(model)
  if (params.includes('tools') || params.includes('tool_choice')) return false
  if (!params.includes('response_format')) return false
  // Lyria 这类音乐模型还能吃参考图（text+image→text+audio），但不是必要条件
  void inputModalities(model)
  return true
}
