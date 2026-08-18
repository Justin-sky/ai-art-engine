import { Service, type Context } from '@cordisjs/core'
import {
  MODEL_PROVIDER_KINDS,
  type ModelProviderKind,
  type ModelProviderKindMeta
} from '@shared/modelProvider'
import type {
  ObjectStorageKindMeta,
  ObjectStorageProviderKind
} from '@shared/objectStorage'
import type { ModelProviderAdapter } from '../services/modelProviders/types'
import type { ObjectStorageAdapter } from '../services/objectStorage/types'

function bind(ctx: Context, setup: () => () => void): () => void {
  return ctx.effect(setup)
}

type ProviderEntry = {
  adapter: ModelProviderAdapter
  meta: ModelProviderKindMeta
}

type StorageEntry = {
  adapter: ObjectStorageAdapter
  meta: ObjectStorageKindMeta
}

export class ProvidersHub extends Service {
  private readonly entries = new Map<ModelProviderKind, ProviderEntry>()

  constructor(ctx: Context) {
    super(ctx, 'providers', true)
  }

  register(adapter: ModelProviderAdapter, meta?: ModelProviderKindMeta): () => void {
    const resolved =
      meta ?? MODEL_PROVIDER_KINDS.find((item) => item.id === adapter.kind)
    if (!resolved) {
      throw new Error(
        `Unknown model provider kind: ${adapter.kind}. Add it to MODEL_PROVIDER_KINDS or pass meta.`
      )
    }
    return bind(this.ctx, () => {
      this.entries.set(adapter.kind, { adapter, meta: resolved })
      return () => {
        this.entries.delete(adapter.kind)
      }
    })
  }

  get(kind: ModelProviderKind | undefined | null): ModelProviderAdapter {
    if (kind && this.entries.has(kind)) return this.entries.get(kind)!.adapter
    const fallback = this.entries.get('openrouter')
    if (fallback) return fallback.adapter
    const first = this.entries.values().next().value
    if (first) return first.adapter
    throw new Error('No model provider adapters are registered')
  }

  has(kind: ModelProviderKind): boolean {
    return this.entries.has(kind)
  }

  /** 已登记插件的目录（插入顺序），不是静态表的 filter。 */
  listKinds(): ModelProviderKindMeta[] {
    return [...this.entries.values()].map((entry) => entry.meta)
  }
}

export class StorageHub extends Service {
  private readonly entries = new Map<ObjectStorageProviderKind, StorageEntry>()

  constructor(ctx: Context) {
    super(ctx, 'storage', true)
  }

  register(adapter: ObjectStorageAdapter, meta: ObjectStorageKindMeta): () => void {
    return bind(this.ctx, () => {
      this.entries.set(adapter.kind, { adapter, meta })
      return () => {
        this.entries.delete(adapter.kind)
      }
    })
  }

  get(kind: ObjectStorageProviderKind): ObjectStorageAdapter {
    const entry = this.entries.get(kind)
    if (!entry) throw new Error(`No object storage adapter for ${kind}`)
    return entry.adapter
  }

  has(kind: ObjectStorageProviderKind): boolean {
    return this.entries.has(kind)
  }

  listKinds(): ObjectStorageKindMeta[] {
    return [...this.entries.values()].map((entry) => entry.meta)
  }
}
