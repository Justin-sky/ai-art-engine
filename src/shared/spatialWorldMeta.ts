/**
 * 空间世界（World Labs Marble）产物在**工程数据里**的身份与附件契约。
 *
 * 为什么要有这个模块：世界的 `world_id` 与两份附件（`.spz` 高斯泼溅 / 360 全景）
 * 原先**只存在于图的节点参数里**（运行态），而资产记录里什么都没有 ——
 * 于是重启应用、或只从对话卡里把产物保存到资产库之后：
 *
 * - 「空间世界导出」拿不到 world_id，**再也导不出网格**（导出端点只认它）
 * - 泼溅与全景留在 `Cache/`，既不是资产库资产、也没有任何记录说明它们属于这个世界
 *
 * 这个模块是「哪些字段、什么形状」的单一来源；节点参数与资产 `genParams` 共用它。
 */

/** 随世界一起落盘的一份附件（高斯泼溅 / 360 全景） */
export interface SpatialWorldExtra {
  /** `splats`（SPZ 高斯泼溅）/ `pano`（360 全景图） */
  kind: string
  relativePath: string
  /**
   * 已登记为资产时的 id。
   *
   * 泼溅下载后会登记为模型资产（这样导演台能直接拿它做泼溅渲染，不必再跑一次付费的
   * PLY 导出）；此时把 id 一起记下来，下游不必再按路径反查。
   */
  assetId?: string
}

/** 世界相关字段（节点参数与资产 genParams 共用同一组键名） */
export interface SpatialWorldMeta {
  /** World Labs 的 `World.id`：**空间世界导出端点只认它** */
  spatialWorldId?: string
  /** 随世界落盘的附件清单 */
  spatialWorldExtras?: SpatialWorldExtra[]
}

/**
 * 把世界身份与附件合并进一份参数对象（不改原对象）。
 *
 * - 只写**有值**的字段，避免用空值覆盖已有的可用信息
 * - `spatialWorldId` 以新值为准（重新生成后就是新的世界）
 * - `spatialWorldExtras` 同样以新值为准，但**新值为空时保留旧值** ——
 *   附件下载失败（CDN 5xx）不该把上一次成功记录的路径抹掉
 */
export function mergeSpatialWorldMeta<T extends Record<string, unknown>>(
  base: T | undefined,
  meta: SpatialWorldMeta
): T & SpatialWorldMeta {
  const next: Record<string, unknown> = { ...(base ?? {}) }
  const id = meta.spatialWorldId?.trim()
  if (id) next.spatialWorldId = id
  const extras = (meta.spatialWorldExtras ?? []).filter((item) => !!item?.relativePath?.trim())
  if (extras.length) next.spatialWorldExtras = extras
  return next as T & SpatialWorldMeta
}

/** 从参数里读世界 id（缺失或空白返回 undefined） */
export function readSpatialWorldId(
  params: Record<string, unknown> | undefined | null
): string | undefined {
  const raw = params?.spatialWorldId
  return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined
}

/** 从参数里读附件清单（丢掉没有 relativePath 的条目） */
export function readSpatialWorldExtras(
  params: Record<string, unknown> | undefined | null
): SpatialWorldExtra[] {
  const raw = params?.spatialWorldExtras
  if (!Array.isArray(raw)) return []
  const out: SpatialWorldExtra[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const entry = item as { kind?: unknown; relativePath?: unknown; assetId?: unknown }
    const relativePath = typeof entry.relativePath === 'string' ? entry.relativePath.trim() : ''
    if (!relativePath) continue
    out.push({
      kind: typeof entry.kind === 'string' ? entry.kind : 'extra',
      relativePath,
      ...(typeof entry.assetId === 'string' && entry.assetId.trim()
        ? { assetId: entry.assetId.trim() }
        : {})
    })
  }
  return out
}

/** 一条世界任务记录里与本模块相关的部分（主进程的 VideoJobRecord 结构上满足它） */
export interface SpatialWorldJobLike {
  kind?: string
  assetId?: string
  relativePath?: string
  resourceId?: string
  extras?: Array<{ kind: string; relativePath?: string; assetId?: string }>
}

/**
 * 从任务记录里找出**属于这个世界产物**的那条，并抽出它的身份与附件。
 *
 * 用途：把 `Cache/` 里的世界产物保存进资产库时，附件（泼溅 / 全景）与 `world_id`
 * 一开始只记在任务记录里（资产记录要等附件下载完才写）。先按资产 id 匹配
 *（主产物登记后即写进记录），再退回按相对路径匹配。
 */
export function findWorldMetaByJob(
  jobs: readonly SpatialWorldJobLike[],
  target: { assetId?: string; relativePath?: string }
): SpatialWorldMeta | null {
  const assetId = target.assetId?.trim()
  const relativePath = target.relativePath?.trim()
  const job =
    jobs.find((item) => item.kind === 'spatialWorld' && !!assetId && item.assetId === assetId) ??
    jobs.find(
      (item) => item.kind === 'spatialWorld' && !!relativePath && item.relativePath === relativePath
    )
  if (!job) return null
  const extras = (job.extras ?? [])
    .filter((item) => !!item.relativePath?.trim())
    .map((item) => ({
      kind: item.kind,
      relativePath: item.relativePath!.trim(),
      ...(item.assetId?.trim() ? { assetId: item.assetId.trim() } : {})
    }))
  const meta: SpatialWorldMeta = {
    ...(job.resourceId?.trim() ? { spatialWorldId: job.resourceId.trim() } : {}),
    ...(extras.length ? { spatialWorldExtras: extras } : {})
  }
  return meta.spatialWorldId || meta.spatialWorldExtras?.length ? meta : null
}
