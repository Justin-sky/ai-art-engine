import axios from 'axios'
import type {
  DecisionRequestInput,
  DecisionResponse,
  GenerateImageInput,
  GenerateImageResult,
  GenerateModel3dInput,
  GenerateModel3dJob,
  GenerateSpeechInput,
  GenerateSpeechResult,
  GenerateTextInput,
  GenerateTextResult,
  ModelProviderInstance
} from '@shared/modelProvider'
import { resolveTypeSafeSystemOneUrl } from '@shared/modelProvider'
import type { ModelProviderAdapter, VideoPollResult } from '../types'
import { PROVIDER_ERRORS, type ModalityKind } from '../catalog'
import { fail } from '@shared/errors/appError'
import { createProviderHttpClient, formatAuthError, isAuthFailure, readHttpError } from '../http'
import { normalizeDecisionResponse } from '../decisions'

/**
 * TypeSafe（Jev / System One）直连适配器。
 *
 * 与 OpenRouter 的区别只在**端点、鉴权与响应外层**，请求组装 / 答案归一化 / 阈值判定
 * 全部复用 `./decisions` 与 `@shared/decisionQuestion`（两家的 noul / choice / score
 * 原语与答案字段实测一致，见各自 OpenAPI）。
 *
 * 本提供商**只做决策判定**：它是决策模型厂商，没有文本 / 图片 / 视频生成能力，
 * 所以除 `decisions` 外的目录一律返回空，其余生成入口一律抛「不支持」。
 */

/** `GET /v1/models` 的一行（TypeSafe 用 name / description / release_date） */
interface TypeSafeModelRow {
  id: string
  name: string
  description?: string
  releaseDate?: string
}

/** `GET /v1/models` 的返回：`{ models: [...] }`（也兼容裸数组 / `data`） */
function asModelRows(body: unknown): TypeSafeModelRow[] {
  const rows = Array.isArray(body)
    ? body
    : body && typeof body === 'object'
      ? ((): unknown[] => {
          const record = body as Record<string, unknown>
          if (Array.isArray(record.models)) return record.models
          if (Array.isArray(record.data)) return record.data
          return []
        })()
      : []
  return rows
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object')
    .map((row) => {
      const name = typeof row.name === 'string' ? row.name : String(row.id ?? '')
      return {
        id: name,
        name,
        description: typeof row.description === 'string' ? row.description : undefined,
        releaseDate: typeof row.release_date === 'string' ? row.release_date : undefined
      }
    })
    .filter((row) => row.id.trim().length > 0)
}

/**
 * 决策模型厂商没有这些生成能力：按动作精确报告，别一律说成「视频生成」。
 *
 * 返回**被拒绝的 Promise** 而不是直接 throw：这些方法签名都返回 Promise，
 * 同步抛出会让调用方在 `.catch()` / `rejects` 断言里接不到。
 */
function unsupported(kind: ModalityKind): Promise<never> {
  return Promise.reject(
    fail(PROVIDER_ERRORS.unsupportedModality, {
      kind,
      name: { zh: 'TypeSafe（决策模型）', en: 'TypeSafe (decision models)' }
    })
  )
}

export const typeSafeAdapter: ModelProviderAdapter = {
  kind: 'typesafe',

  async assertAuth(provider) {
    if (!provider.apiKey.trim()) throw fail(PROVIDER_ERRORS.missingApiKey)
    const client = createProviderHttpClient(provider)
    try {
      await client.get('/v1/models', { timeout: 20_000 })
    } catch (err) {
      const status = axios.isAxiosError(err) ? err.response?.status : undefined
      const raw = await readHttpError(err)
      if (isAuthFailure(status, raw)) {
        throw fail(PROVIDER_ERRORS.invalidApiKeyListModels, {
          detail: formatAuthError(raw, provider)
        })
      }
      throw fail(PROVIDER_ERRORS.connectionTestFailed, { detail: formatAuthError(raw, provider) })
    }
  },

  async fetchCatalog(provider, modality) {
    // 决策模型厂商只提供决策目录；其它模态返回空，避免列表里出现无关模型
    if (modality !== 'decisions') return []
    const client = createProviderHttpClient(provider)
    try {
      const { data } = await client.get('/v1/models')
      return asModelRows(data).map((m) => ({
        id: m.id,
        name: m.name || m.id,
        description: m.description,
        modality: 'decisions' as const,
        capabilities: m.releaseDate ? { release_date: m.releaseDate } : {}
      }))
    } catch (err) {
      throw fail(PROVIDER_ERRORS.actionFailed, {
        action: 'listModels',
        detail: await readHttpError(err)
      })
    }
  },

  /**
   * System One（`POST /v1/systemone`）。与 OpenRouter 的 `/alpha/decisions` 同协议：
   * 请求 `{ model, state, questions }`、响应按问题名返回 typed answer。
   */
  async generateDecisions(
    provider: ModelProviderInstance,
    modelId: string,
    input: DecisionRequestInput
  ): Promise<DecisionResponse> {
    const client = createProviderHttpClient(provider)
    const body: Record<string, unknown> = {
      model: modelId,
      state: input.state,
      questions: input.questions
    }
    try {
      const { data } = await client.post<unknown>(
        resolveTypeSafeSystemOneUrl(provider.baseUrl),
        body
      )
      return normalizeDecisionResponse(data, modelId)
    } catch (err) {
      throw fail(PROVIDER_ERRORS.actionFailed, {
        action: 'decisionsGenerate',
        detail: await readHttpError(err)
      })
    }
  },

  // TypeSafe 只有决策判定能力：这些入口按动作精确拒绝，避免被误当成通用网关
  generateText(
    _provider: ModelProviderInstance,
    _modelId: string,
    _input: GenerateTextInput
  ): Promise<GenerateTextResult> {
    return unsupported('text')
  },

  generateImage(
    _provider: ModelProviderInstance,
    _modelId: string,
    _input: GenerateImageInput
  ): Promise<GenerateImageResult> {
    return unsupported('image')
  },

  submitVideo(_provider: ModelProviderInstance, _modelId: string, _input: never): Promise<never> {
    return unsupported('video')
  },

  pollVideo(): Promise<VideoPollResult> {
    return unsupported('video')
  },

  generateSpeech(
    _provider: ModelProviderInstance,
    _modelId: string,
    _input: GenerateSpeechInput
  ): Promise<GenerateSpeechResult> {
    return unsupported('speech')
  },

  submitModel3d(
    _provider: ModelProviderInstance,
    _modelId: string,
    _input: GenerateModel3dInput
  ): Promise<GenerateModel3dJob> {
    return unsupported('video')
  },

  pollModel3d(): Promise<VideoPollResult> {
    return unsupported('video')
  }
}
