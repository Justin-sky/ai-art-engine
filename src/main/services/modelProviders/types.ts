import type {
  CatalogModel,
  GenerateImageInput,
  GenerateImageResult,
  GenerateModel3dInput,
  GenerateModel3dJob,
  GenerateSpeechInput,
  GenerateSpeechResult,
  GenerateTextInput,
  GenerateTextResult,
  GenerateVideoInput,
  GenerateVideoJob,
  ModelModality,
  ModelProviderInstance,
  ModelProviderKind,
  TranscribeAudioInput,
  TranscribeAudioResult
} from '@shared/modelProvider'

export type VideoPollResult = {
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
  progress: number
  error?: string
  downloadUrl?: string
}

/**
 * 单一模型供应商适配器。
 * 新增厂商：实现本接口 → Cordis `createProviderPlugin`（kind 目录随插件登记）
 * → shared MODEL_PROVIDER_KINDS 加一项（设置落盘 / 规范化）。
 */
export interface ModelProviderAdapter {
  readonly kind: ModelProviderKind
  assertAuth(provider: ModelProviderInstance): Promise<void>
  fetchCatalog(provider: ModelProviderInstance, modality: ModelModality): Promise<CatalogModel[]>
  generateText(
    provider: ModelProviderInstance,
    modelId: string,
    input: GenerateTextInput
  ): Promise<GenerateTextResult>
  generateImage(
    provider: ModelProviderInstance,
    modelId: string,
    input: GenerateImageInput
  ): Promise<GenerateImageResult>
  submitVideo(
    provider: ModelProviderInstance,
    modelId: string,
    input: GenerateVideoInput
  ): Promise<GenerateVideoJob>
  pollVideo(
    provider: ModelProviderInstance,
    job: { jobId: string; pollingUrl: string }
  ): Promise<VideoPollResult>
  generateSpeech(
    provider: ModelProviderInstance,
    modelId: string,
    input: GenerateSpeechInput
  ): Promise<GenerateSpeechResult>
  /**
   * 音频转写（语音识别）。可选：未实现时「配音转字幕」会提示该提供商不支持。
   * 输入 absPath 已由门面解析为绝对路径。
   */
  transcribeAudio?(
    provider: ModelProviderInstance,
    modelId: string,
    input: TranscribeAudioInput
  ): Promise<TranscribeAudioResult>
  submitModel3d(
    provider: ModelProviderInstance,
    modelId: string,
    input: GenerateModel3dInput
  ): Promise<GenerateModel3dJob>
  pollModel3d(
    provider: ModelProviderInstance,
    job: { jobId: string; pollingUrl: string }
  ): Promise<VideoPollResult>
}
