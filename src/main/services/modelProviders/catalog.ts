import { defErr, defErrSimple, type BiDef } from '@shared/errors/appError'

/**
 * modelProviders 各 adapter 共用的错误条目（仅 main 进程使用）。
 * 高重复句式集中于此；个性文案直接在调用点用 fail(defErr(...)) 内联。
 * `action` 参数取 ProviderAction 语义键，各语言格式化器自行映射措辞。
 */
export const PROVIDER_ERRORS = {
  missingApiKey: defErrSimple('provider.missingApiKey', '请先填写 API Key', 'API Key is required'),
  unsupported3d: defErrSimple(
    'provider.unsupported3d',
    '该提供商暂不支持 3D 模型生成',
    'This provider does not support 3D model generation yet'
  ),
  unsupportedModality: defErr<{ kind: ModalityKind; name: { zh: string; en: string } }>(
    'provider.unsupportedModality',
    ({ kind, name }) => `${name.zh}当前不支持${MODALITY_ZH[kind]}`,
    ({ kind, name }) => `${name.en} does not support ${MODALITY_EN[kind]}`
  ),
  invalidApiKeyListModels: defErr<{ detail: string }>(
    'provider.invalidApiKeyListModels',
    ({ detail }) => `API Key 无效，已禁止拉取模型：${detail}`,
    ({ detail }) => `Invalid API Key, blocked from listing models: ${detail}`
  ),
  noActiveProvider: defErr<{ modality: string }>(
    'provider.noActiveProvider',
    ({ modality }) => `未配置可用的 ${modality} 模型提供商（需 API Key 或本地服务，并勾选至少一个模型）`,
    ({ modality }) =>
      `No available ${modality} provider configured (needs an API key or a local service with at least one model enabled)`
  ),
  connectionTestFailed: defErr<{ detail: string }>(
    'provider.connectionTestFailed',
    ({ detail }) => `连接测试失败：${detail}`,
    ({ detail }) => `Connection test failed: ${detail}`
  ),
  actionFailed: defErr<{ action: ProviderAction; detail: string }>(
    'provider.actionFailed',
    ({ action, detail }) => `${ACTION_ZH[action]}失败: ${detail}`,
    ({ action, detail }) => `${ACTION_EN[action]} failed: ${detail}`
  ),
  noVideoTaskId: defErrSimple('provider.noVideoTaskId', '未返回视频任务 id', 'No video task id returned'),
  noImageTaskId: defErrSimple('provider.noImageTaskId', '未返回图片任务 id', 'No image task id returned'),
  imageTimeout: defErrSimple(
    'provider.imageTimeout',
    '图片生成超时：任务仍未完成',
    'Image generation timed out: task still unfinished'
  ),
  videoResultNoUrl: defErrSimple(
    'provider.videoResultNoUrl',
    '视频任务已完成但未返回下载地址',
    'Video task finished but returned no download URL'
  ),
  imageResultNoUrl: defErrSimple(
    'provider.imageResultNoUrl',
    '图片任务已完成但未返回 URL',
    'Image task finished but returned no URL'
  ),
  noImageResult: defErrSimple('provider.noImageResult', '模型未返回图片', 'The model returned no image'),
  noAudioResult: defErrSimple(
    'provider.noAudioResult',
    '模型未返回音频数据',
    'The model returned no audio data'
  )
} satisfies Record<string, BiDef<never> | BiDef<undefined>>

export type ModalityKind = 'video' | 'voice' | 'speech' | 'image'

const MODALITY_ZH: Record<ModalityKind, string> = {
  video: '视频生成',
  voice: '语音生成',
  speech: '语音合成',
  image: '图片生成'
}
const MODALITY_EN: Record<ModalityKind, string> = {
  video: 'video generation',
  voice: 'voice generation',
  speech: 'speech synthesis',
  image: 'image generation'
}

/** 通用动作语义键：图片生成 / 提交视频 / 轮询任务 / 连接测试 / 拉取模型列表… */
export type ProviderAction =
  | 'listModels'
  | 'imageGenerate'
  | 'imageEditSubmit'
  | 'videoSubmit'
  | 'videoPolling'
  | 'connectionTest'
  | 'transcribe'

const ACTION_ZH: Record<ProviderAction, string> = {
  listModels: '拉取模型列表',
  imageGenerate: '图片生成',
  imageEditSubmit: '提交图片编辑',
  videoSubmit: '提交视频生成',
  videoPolling: '轮询视频任务',
  connectionTest: '连接测试',
  transcribe: '音频转写'
}
const ACTION_EN: Record<ProviderAction, string> = {
  listModels: 'Listing models',
  imageGenerate: 'Image generation',
  imageEditSubmit: 'Submitting image edit',
  videoSubmit: 'Submitting video generation',
  videoPolling: 'Polling video task',
  connectionTest: 'Connection test',
  transcribe: 'Audio transcription'
}
