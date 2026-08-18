import type {
  CatalogModel,
  GenerateImageInput,
  GenerateImageResult,
  GenerateSpeechInput,
  GenerateSpeechResult,
  GenerateTextInput,
  GenerateTextResult,
  GenerateVideoInput,
  GenerateVideoJob,
  ModelModality,
  ModelProviderInstance,
  ModelProviderKind
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
}
