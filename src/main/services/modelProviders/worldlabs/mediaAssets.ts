import axios from 'axios'
import type { GenerateSpatialWorldMediaAsset, ModelProviderInstance } from '@shared/modelProvider'
import { fail, defErr, defErrSimple, isAppError } from '@shared/errors/appError'
import { createWorldlabsHttpClient, readWorldlabsHttpError } from './http'

/**
 * World Labs 托管媒体上传（官方 media-asset 流程）：
 *
 *   1. `POST /marble/v1/media-assets:prepare_upload` { file_name, kind, extension? }
 *      → { media_asset: { media_asset_id }, upload_info: { upload_url, upload_method, required_headers } }
 *   2. `PUT <upload_url>`（带 required_headers 与 Content-Type）上传原始字节
 *   3. 生成世界时用 `image_prompt/video_prompt: { source: 'media_asset', media_asset_id }`
 *
 * 走这条路时**不需要用户配置对象存储**（TOS / OSS / COS）：参考文件直接进 World Labs 托管存储，
 * 也避开了 `source: 'uri'` 那种「服务端无 cookie / referer 抓取」被防盗链拒掉的坑。
 */

const E_WORLDLABS_MEDIA_PREPARE_FAILED = defErr<{ detail: string }>(
  'provider.worldlabs.mediaPrepareFailed',
  ({ detail }) => `创建 World Labs 媒体资产失败: ${detail}`,
  ({ detail }) => `Creating the World Labs media asset failed: ${detail}`
)
const E_WORLDLABS_MEDIA_NO_UPLOAD_URL = defErrSimple(
  'provider.worldlabs.mediaNoUploadUrl',
  'World Labs 未返回媒体上传地址',
  'World Labs returned no media upload URL'
)
const E_WORLDLABS_MEDIA_UPLOAD_FAILED = defErr<{ detail: string }>(
  'provider.worldlabs.mediaUploadFailed',
  ({ detail }) => `上传媒体到 World Labs 失败: ${detail}`,
  ({ detail }) => `Uploading the media to World Labs failed: ${detail}`
)

/** prepare_upload 响应（只取用得到的字段） */
type PrepareUploadResponse = {
  media_asset?: { media_asset_id?: string | null } | null
  upload_info?: {
    upload_url?: string | null
    upload_method?: string | null
    required_headers?: Record<string, string> | null
  } | null
}

export interface WorldlabsMediaUploadInput {
  provider: ModelProviderInstance
  /** 原始文件字节 */
  bytes: Buffer
  kind: GenerateSpatialWorldMediaAsset['kind']
  /** 文件名（官方上限 64 字符，超出按后缀保留截断） */
  fileName: string
  /** 扩展名，不带点（jpg / png / mp4…） */
  extension?: string
  /** 上传用的 MIME（同时作为 `Content-Type`） */
  contentType?: string
}

/** 文件名裁剪到官方 64 字符上限，保留扩展名 */
export function trimMediaFileName(fileName: string): string {
  const name = (fileName || 'reference').replace(/[\\/]/g, '_').trim() || 'reference'
  if (name.length <= 64) return name
  const dot = name.lastIndexOf('.')
  const ext = dot > 0 && name.length - dot <= 8 ? name.slice(dot) : ''
  return `${name.slice(0, 64 - ext.length)}${ext}`
}

/**
 * 上传一份参考媒体到 World Labs 托管存储，返回可写进 world_prompt 的 media_asset_id。
 * prepare 与 PUT 分开报错：前者是鉴权 / 参数问题，后者是签名地址过期或网络问题。
 */
export async function uploadWorldlabsMediaAsset(
  input: WorldlabsMediaUploadInput
): Promise<GenerateSpatialWorldMediaAsset> {
  const client = createWorldlabsHttpClient(input.provider)

  let prepared: PrepareUploadResponse['upload_info']
  let mediaAssetId = ''
  try {
    const { data } = await client.post<PrepareUploadResponse>(
      '/marble/v1/media-assets:prepare_upload',
      {
        file_name: trimMediaFileName(input.fileName),
        kind: input.kind,
        ...(input.extension ? { extension: input.extension.replace(/^\./, '') } : {})
      }
    )
    mediaAssetId = data?.media_asset?.media_asset_id?.trim() ?? ''
    prepared = data?.upload_info
  } catch (err) {
    if (isAppError(err)) throw err
    throw fail(E_WORLDLABS_MEDIA_PREPARE_FAILED, {
      detail: await readWorldlabsHttpError(err)
    })
  }

  const uploadUrl = prepared?.upload_url?.trim() ?? ''
  if (!uploadUrl || !mediaAssetId) {
    throw fail(E_WORLDLABS_MEDIA_NO_UPLOAD_URL)
  }

  const contentType = input.contentType?.trim() || 'application/octet-stream'
  const headers: Record<string, string> = {
    ...(prepared?.required_headers ?? {}),
    'Content-Type': contentType
  }
  const method = (prepared?.upload_method || 'PUT').toLowerCase()

  try {
    // 签名地址自带鉴权：用裸 axios，**不带** WLT-Api-Key（也不需要 provider 的 baseURL）
    await axios.request({
      url: uploadUrl,
      method,
      data: input.bytes,
      headers,
      timeout: 300_000,
      maxBodyLength: Infinity,
      maxContentLength: Infinity
    })
  } catch (err) {
    throw fail(E_WORLDLABS_MEDIA_UPLOAD_FAILED, {
      detail: await readWorldlabsHttpError(err)
    })
  }

  return {
    kind: input.kind,
    id: mediaAssetId,
    sourceLabel: input.fileName
  }
}
