/** 对象存储提供商配置（设置页；可扩展多云） */

export type ObjectStorageProviderKind = 'volcengine-tos'

export const OBJECT_STORAGE_PROVIDER_KINDS: ReadonlyArray<{
  id: ObjectStorageProviderKind
  label: string
}> = [
  {
    id: 'volcengine-tos',
    label: '火山引擎 TOS'
  }
]

/** 火山引擎 TOS 常用地域与 Endpoint（公网），见官方「地域及访问域名」 */
export const VOLCENGINE_TOS_REGION_PRESETS: ReadonlyArray<{
  region: string
  endpoint: string
  label: string
}> = [
  {
    region: 'cn-beijing',
    endpoint: 'https://tos-cn-beijing.volces.com',
    label: '华北2（北京）'
  },
  {
    region: 'cn-shanghai',
    endpoint: 'https://tos-cn-shanghai.volces.com',
    label: '华东2（上海）'
  },
  {
    region: 'cn-guangzhou',
    endpoint: 'https://tos-cn-guangzhou.volces.com',
    label: '华南1（广州）'
  },
  {
    region: 'cn-chengdu',
    endpoint: 'https://tos-cn-chengdu.volces.com',
    label: '西南1（成都）'
  },
  {
    region: 'cn-hongkong',
    endpoint: 'https://tos-cn-hongkong.volces.com',
    label: '中国香港'
  }
]

/** 火山引擎 TOS 客户端参数（与官方 SDK 初始化字段对齐） */
export interface VolcengineTosParams {
  /** Access Key ID */
  accessKeyId: string
  /** Secret Access Key */
  accessKeySecret: string
  /** 地域，如 cn-beijing */
  region: string
  /** Endpoint，如 https://tos-cn-beijing.volces.com */
  endpoint: string
  /** 默认存储桶 */
  bucket: string
  /** 可选：自定义公网访问域名 / CDN 前缀（不含尾斜杠） */
  publicBaseUrl: string
}

export interface ObjectStorageProviderInstance {
  id: string
  providerKind: ObjectStorageProviderKind
  label: string
  enabled: boolean
  /** 当前仅 volcengine-tos；后续可按 kind 扩展联合类型 */
  tos: VolcengineTosParams
}

export interface ObjectStorageSettings {
  providers: ObjectStorageProviderInstance[]
}

export function createEmptyVolcengineTosParams(): VolcengineTosParams {
  const preset = VOLCENGINE_TOS_REGION_PRESETS[0]
  return {
    accessKeyId: '',
    accessKeySecret: '',
    region: preset.region,
    endpoint: preset.endpoint,
    bucket: '',
    publicBaseUrl: ''
  }
}

export function createEmptyObjectStorageSettings(): ObjectStorageSettings {
  return { providers: [] }
}

export function createObjectStorageProvider(
  kind: ObjectStorageProviderKind = 'volcengine-tos',
  overrides?: Partial<ObjectStorageProviderInstance>
): ObjectStorageProviderInstance {
  const meta =
    OBJECT_STORAGE_PROVIDER_KINDS.find((p) => p.id === kind) ?? OBJECT_STORAGE_PROVIDER_KINDS[0]
  const base: ObjectStorageProviderInstance = {
    id: newLocalId(),
    providerKind: kind,
    label: meta.label,
    enabled: true,
    tos: createEmptyVolcengineTosParams()
  }
  if (!overrides) return base
  return normalizeObjectStorageProvider({ ...base, ...overrides })
}

export function normalizeObjectStorageSettings(raw?: unknown): ObjectStorageSettings {
  if (!raw || typeof raw !== 'object') return createEmptyObjectStorageSettings()
  const providers = (raw as { providers?: unknown }).providers
  if (!Array.isArray(providers)) return createEmptyObjectStorageSettings()
  return {
    providers: providers.map((item) =>
      normalizeObjectStorageProvider((item ?? {}) as Partial<ObjectStorageProviderInstance>)
    )
  }
}

export function applyVolcengineTosRegionPreset(
  tos: VolcengineTosParams,
  region: string
): VolcengineTosParams {
  const preset = VOLCENGINE_TOS_REGION_PRESETS.find((p) => p.region === region)
  if (!preset) return { ...tos, region }
  return {
    ...tos,
    region: preset.region,
    endpoint: preset.endpoint
  }
}

function newLocalId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    /* fall through */
  }
  return `oss-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function normalizeVolcengineTosParams(raw?: Partial<VolcengineTosParams> | null): VolcengineTosParams {
  const empty = createEmptyVolcengineTosParams()
  if (!raw || typeof raw !== 'object') return empty
  const region =
    typeof raw.region === 'string' && raw.region.trim() ? raw.region.trim() : empty.region
  const preset = VOLCENGINE_TOS_REGION_PRESETS.find((p) => p.region === region)
  let endpoint =
    typeof raw.endpoint === 'string' && raw.endpoint.trim()
      ? raw.endpoint.trim().replace(/\/$/, '')
      : (preset?.endpoint ?? empty.endpoint)
  if (!/^https?:\/\//i.test(endpoint)) {
    endpoint = `https://${endpoint}`
  }
  return {
    accessKeyId: typeof raw.accessKeyId === 'string' ? raw.accessKeyId : '',
    accessKeySecret: typeof raw.accessKeySecret === 'string' ? raw.accessKeySecret : '',
    region,
    endpoint,
    bucket: typeof raw.bucket === 'string' ? raw.bucket.trim() : '',
    publicBaseUrl:
      typeof raw.publicBaseUrl === 'string' ? raw.publicBaseUrl.trim().replace(/\/$/, '') : ''
  }
}

function normalizeObjectStorageProvider(
  item: Partial<ObjectStorageProviderInstance>
): ObjectStorageProviderInstance {
  const kind: ObjectStorageProviderKind =
    item.providerKind === 'volcengine-tos' ? 'volcengine-tos' : 'volcengine-tos'
  const meta = OBJECT_STORAGE_PROVIDER_KINDS.find((p) => p.id === kind)!
  return {
    id: typeof item.id === 'string' && item.id ? item.id : newLocalId(),
    providerKind: kind,
    label: typeof item.label === 'string' && item.label ? item.label : meta.label,
    enabled: item.enabled !== false,
    tos: normalizeVolcengineTosParams(item.tos)
  }
}

/** 取首个已启用且填齐必填项的对象存储提供商 */
export function pickActiveObjectStorage(
  settings: ObjectStorageSettings
): ObjectStorageProviderInstance | null {
  for (const provider of settings.providers) {
    if (!provider.enabled) continue
    if (provider.providerKind !== 'volcengine-tos') continue
    const { accessKeyId, accessKeySecret, region, endpoint, bucket } = provider.tos
    if (
      accessKeyId.trim() &&
      accessKeySecret.trim() &&
      region.trim() &&
      endpoint.trim() &&
      bucket.trim()
    ) {
      return provider
    }
  }
  return null
}
