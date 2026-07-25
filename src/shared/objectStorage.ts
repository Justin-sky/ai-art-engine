/** 对象存储提供商配置（设置页；可扩展多云） */

export type ObjectStorageProviderKind = 'volcengine-tos' | 'aliyun-oss' | 'tencent-cos'

export const OBJECT_STORAGE_PROVIDER_KINDS: ReadonlyArray<{
  id: ObjectStorageProviderKind
  label: string
}> = [
  { id: 'volcengine-tos', label: '火山引擎 TOS' },
  { id: 'aliyun-oss', label: '阿里云 OSS' },
  { id: 'tencent-cos', label: '腾讯云 COS' }
]

/** 火山引擎 TOS 常用地域与 Endpoint（公网） */
export const VOLCENGINE_TOS_REGION_PRESETS: ReadonlyArray<{
  region: string
  endpoint: string
  label: string
}> = [
  { region: 'cn-beijing', endpoint: 'https://tos-cn-beijing.volces.com', label: '华北2（北京）' },
  { region: 'cn-shanghai', endpoint: 'https://tos-cn-shanghai.volces.com', label: '华东2（上海）' },
  { region: 'cn-guangzhou', endpoint: 'https://tos-cn-guangzhou.volces.com', label: '华南1（广州）' },
  { region: 'cn-chengdu', endpoint: 'https://tos-cn-chengdu.volces.com', label: '西南1（成都）' },
  { region: 'cn-hongkong', endpoint: 'https://tos-cn-hongkong.volces.com', label: '中国香港' }
]

/** 阿里云 OSS 常用地域 */
export const ALIYUN_OSS_REGION_PRESETS: ReadonlyArray<{
  region: string
  endpoint: string
  label: string
}> = [
  { region: 'oss-cn-hangzhou', endpoint: 'https://oss-cn-hangzhou.aliyuncs.com', label: '华东1（杭州）' },
  { region: 'oss-cn-shanghai', endpoint: 'https://oss-cn-shanghai.aliyuncs.com', label: '华东2（上海）' },
  { region: 'oss-cn-beijing', endpoint: 'https://oss-cn-beijing.aliyuncs.com', label: '华北2（北京）' },
  { region: 'oss-cn-shenzhen', endpoint: 'https://oss-cn-shenzhen.aliyuncs.com', label: '华南1（深圳）' },
  { region: 'oss-cn-hongkong', endpoint: 'https://oss-cn-hongkong.aliyuncs.com', label: '中国香港' }
]

/** 腾讯云 COS 常用地域 */
export const TENCENT_COS_REGION_PRESETS: ReadonlyArray<{
  region: string
  label: string
}> = [
  { region: 'ap-guangzhou', label: '华南（广州）' },
  { region: 'ap-shanghai', label: '华东（上海）' },
  { region: 'ap-beijing', label: '华北（北京）' },
  { region: 'ap-chengdu', label: '西南（成都）' },
  { region: 'ap-hongkong', label: '中国香港' }
]

export interface VolcengineTosParams {
  accessKeyId: string
  accessKeySecret: string
  region: string
  endpoint: string
  bucket: string
  publicBaseUrl: string
}

export interface AliyunOssParams {
  accessKeyId: string
  accessKeySecret: string
  /** 如 oss-cn-hangzhou */
  region: string
  /** 如 https://oss-cn-hangzhou.aliyuncs.com */
  endpoint: string
  bucket: string
  publicBaseUrl: string
}

export interface TencentCosParams {
  /** SecretId */
  secretId: string
  /** SecretKey */
  secretKey: string
  /** 如 ap-guangzhou */
  region: string
  /** 桶名，通常为 BucketName-APPID */
  bucket: string
  publicBaseUrl: string
}

export interface ObjectStorageProviderInstance {
  id: string
  providerKind: ObjectStorageProviderKind
  label: string
  enabled: boolean
  tos: VolcengineTosParams
  oss: AliyunOssParams
  cos: TencentCosParams
}

export interface ObjectStorageSettings {
  providers: ObjectStorageProviderInstance[]
}

export function createEmptyVolcengineTosParams(): VolcengineTosParams {
  const preset = VOLCENGINE_TOS_REGION_PRESETS[0]!
  return {
    accessKeyId: '',
    accessKeySecret: '',
    region: preset.region,
    endpoint: preset.endpoint,
    bucket: '',
    publicBaseUrl: ''
  }
}

export function createEmptyAliyunOssParams(): AliyunOssParams {
  const preset = ALIYUN_OSS_REGION_PRESETS[0]!
  return {
    accessKeyId: '',
    accessKeySecret: '',
    region: preset.region,
    endpoint: preset.endpoint,
    bucket: '',
    publicBaseUrl: ''
  }
}

export function createEmptyTencentCosParams(): TencentCosParams {
  const preset = TENCENT_COS_REGION_PRESETS[0]!
  return {
    secretId: '',
    secretKey: '',
    region: preset.region,
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
    OBJECT_STORAGE_PROVIDER_KINDS.find((p) => p.id === kind) ?? OBJECT_STORAGE_PROVIDER_KINDS[0]!
  const base: ObjectStorageProviderInstance = {
    id: newLocalId(),
    providerKind: kind,
    label: meta.label,
    enabled: true,
    tos: createEmptyVolcengineTosParams(),
    oss: createEmptyAliyunOssParams(),
    cos: createEmptyTencentCosParams()
  }
  if (!overrides) return base
  return normalizeObjectStorageProvider({ ...base, ...overrides })
}

export function normalizeObjectStorageSettings(raw?: unknown): ObjectStorageSettings {
  if (!raw || typeof raw !== 'object') return createEmptyObjectStorageSettings()
  const providers = (raw as { providers?: unknown }).providers
  if (!Array.isArray(providers)) return createEmptyObjectStorageSettings()
  const next = {
    providers: providers.map((item) =>
      normalizeObjectStorageProvider((item ?? {}) as Partial<ObjectStorageProviderInstance>)
    )
  }
  ensureSingleEnabledObjectStorage(next)
  return next
}

/**
 * 对象存储同时只允许启用一个提供商：保留第一个已启用的，其余强制关闭。
 * 可传入 preferredId，优先保留该实例（若其当前为启用）。
 */
export function ensureSingleEnabledObjectStorage(
  settings: ObjectStorageSettings,
  preferredId?: string | null
): void {
  const preferred =
    preferredId && settings.providers.some((p) => p.id === preferredId && p.enabled)
      ? preferredId
      : null
  let kept: string | null = preferred
  if (!kept) {
    kept = settings.providers.find((p) => p.enabled)?.id ?? null
  }
  for (const provider of settings.providers) {
    provider.enabled = kept != null && provider.id === kept
  }
}

/** 启用指定提供商并关闭其它（设置页互斥开关） */
export function enableOnlyObjectStorageProvider(
  settings: ObjectStorageSettings,
  providerId: string
): void {
  for (const provider of settings.providers) {
    provider.enabled = provider.id === providerId
  }
}

export function applyVolcengineTosRegionPreset(
  tos: VolcengineTosParams,
  region: string
): VolcengineTosParams {
  const preset = VOLCENGINE_TOS_REGION_PRESETS.find((p) => p.region === region)
  if (!preset) return { ...tos, region }
  return { ...tos, region: preset.region, endpoint: preset.endpoint }
}

export function applyAliyunOssRegionPreset(
  oss: AliyunOssParams,
  region: string
): AliyunOssParams {
  const preset = ALIYUN_OSS_REGION_PRESETS.find((p) => p.region === region)
  if (!preset) return { ...oss, region }
  return { ...oss, region: preset.region, endpoint: preset.endpoint }
}

export function applyTencentCosRegionPreset(
  cos: TencentCosParams,
  region: string
): TencentCosParams {
  return { ...cos, region }
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

function ensureHttpsEndpoint(endpoint: string, fallback: string): string {
  let value = endpoint.trim().replace(/\/$/, '') || fallback
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`
  return value
}

function normalizeVolcengineTosParams(raw?: Partial<VolcengineTosParams> | null): VolcengineTosParams {
  const empty = createEmptyVolcengineTosParams()
  if (!raw || typeof raw !== 'object') return empty
  const region =
    typeof raw.region === 'string' && raw.region.trim() ? raw.region.trim() : empty.region
  const preset = VOLCENGINE_TOS_REGION_PRESETS.find((p) => p.region === region)
  return {
    accessKeyId: typeof raw.accessKeyId === 'string' ? raw.accessKeyId : '',
    accessKeySecret: typeof raw.accessKeySecret === 'string' ? raw.accessKeySecret : '',
    region,
    endpoint: ensureHttpsEndpoint(
      typeof raw.endpoint === 'string' ? raw.endpoint : '',
      preset?.endpoint ?? empty.endpoint
    ),
    bucket: typeof raw.bucket === 'string' ? raw.bucket.trim() : '',
    publicBaseUrl:
      typeof raw.publicBaseUrl === 'string' ? raw.publicBaseUrl.trim().replace(/\/$/, '') : ''
  }
}

function normalizeAliyunOssParams(raw?: Partial<AliyunOssParams> | null): AliyunOssParams {
  const empty = createEmptyAliyunOssParams()
  if (!raw || typeof raw !== 'object') return empty
  const region =
    typeof raw.region === 'string' && raw.region.trim() ? raw.region.trim() : empty.region
  const preset = ALIYUN_OSS_REGION_PRESETS.find((p) => p.region === region)
  return {
    accessKeyId: typeof raw.accessKeyId === 'string' ? raw.accessKeyId : '',
    accessKeySecret: typeof raw.accessKeySecret === 'string' ? raw.accessKeySecret : '',
    region,
    endpoint: ensureHttpsEndpoint(
      typeof raw.endpoint === 'string' ? raw.endpoint : '',
      preset?.endpoint ?? empty.endpoint
    ),
    bucket: typeof raw.bucket === 'string' ? raw.bucket.trim() : '',
    publicBaseUrl:
      typeof raw.publicBaseUrl === 'string' ? raw.publicBaseUrl.trim().replace(/\/$/, '') : ''
  }
}

function normalizeTencentCosParams(raw?: Partial<TencentCosParams> | null): TencentCosParams {
  const empty = createEmptyTencentCosParams()
  if (!raw || typeof raw !== 'object') return empty
  return {
    secretId: typeof raw.secretId === 'string' ? raw.secretId : '',
    secretKey: typeof raw.secretKey === 'string' ? raw.secretKey : '',
    region:
      typeof raw.region === 'string' && raw.region.trim() ? raw.region.trim() : empty.region,
    bucket: typeof raw.bucket === 'string' ? raw.bucket.trim() : '',
    publicBaseUrl:
      typeof raw.publicBaseUrl === 'string' ? raw.publicBaseUrl.trim().replace(/\/$/, '') : ''
  }
}

function normalizeProviderKind(raw: unknown): ObjectStorageProviderKind {
  if (raw === 'aliyun-oss') return 'aliyun-oss'
  if (raw === 'tencent-cos') return 'tencent-cos'
  return 'volcengine-tos'
}

function normalizeObjectStorageProvider(
  item: Partial<ObjectStorageProviderInstance>
): ObjectStorageProviderInstance {
  const kind = normalizeProviderKind(item.providerKind)
  const meta = OBJECT_STORAGE_PROVIDER_KINDS.find((p) => p.id === kind)!
  return {
    id: typeof item.id === 'string' && item.id ? item.id : newLocalId(),
    providerKind: kind,
    label: typeof item.label === 'string' && item.label ? item.label : meta.label,
    enabled: item.enabled !== false,
    tos: normalizeVolcengineTosParams(item.tos),
    oss: normalizeAliyunOssParams(item.oss),
    cos: normalizeTencentCosParams(item.cos)
  }
}

function isTosReady(provider: ObjectStorageProviderInstance): boolean {
  const { accessKeyId, accessKeySecret, region, endpoint, bucket } = provider.tos
  return Boolean(
    accessKeyId.trim() &&
      accessKeySecret.trim() &&
      region.trim() &&
      endpoint.trim() &&
      bucket.trim()
  )
}

function isOssReady(provider: ObjectStorageProviderInstance): boolean {
  const { accessKeyId, accessKeySecret, region, bucket } = provider.oss
  return Boolean(
    accessKeyId.trim() && accessKeySecret.trim() && region.trim() && bucket.trim()
  )
}

function isCosReady(provider: ObjectStorageProviderInstance): boolean {
  const { secretId, secretKey, region, bucket } = provider.cos
  return Boolean(secretId.trim() && secretKey.trim() && region.trim() && bucket.trim())
}

/** 取首个已启用且填齐必填项的对象存储提供商 */
export function pickActiveObjectStorage(
  settings: ObjectStorageSettings
): ObjectStorageProviderInstance | null {
  for (const provider of settings.providers) {
    if (!provider.enabled) continue
    if (provider.providerKind === 'volcengine-tos' && isTosReady(provider)) return provider
    if (provider.providerKind === 'aliyun-oss' && isOssReady(provider)) return provider
    if (provider.providerKind === 'tencent-cos' && isCosReady(provider)) return provider
  }
  return null
}

export function getObjectStorageBucket(provider: ObjectStorageProviderInstance): string {
  if (provider.providerKind === 'aliyun-oss') return provider.oss.bucket.trim()
  if (provider.providerKind === 'tencent-cos') return provider.cos.bucket.trim()
  return provider.tos.bucket.trim()
}
