import type { Context } from '@cordisjs/core'
import {
  OBJECT_STORAGE_PROVIDER_KINDS,
  type ObjectStorageKindMeta
} from '@shared/objectStorage'
import type { ObjectStorageAdapter } from '../services/objectStorage/types'
import { tosAdapter } from '../services/objectStorage/tos'
import { ossAdapter } from '../services/objectStorage/oss'
import { cosAdapter } from '../services/objectStorage/cos'

function resolveStorageMeta(
  adapter: ObjectStorageAdapter,
  meta?: ObjectStorageKindMeta
): ObjectStorageKindMeta {
  if (meta) {
    if (meta.id !== adapter.kind) {
      throw new Error(`Object storage meta id ${meta.id} does not match adapter ${adapter.kind}`)
    }
    return meta
  }
  const found = OBJECT_STORAGE_PROVIDER_KINDS.find((item) => item.id === adapter.kind)
  if (!found) {
    throw new Error(
      `Unknown object storage kind: ${adapter.kind}. Add it to OBJECT_STORAGE_PROVIDER_KINDS or pass meta.`
    )
  }
  return found
}

export function createStoragePlugin(adapter: ObjectStorageAdapter, meta?: ObjectStorageKindMeta) {
  const resolved = resolveStorageMeta(adapter, meta)
  return {
    name: `storage.${adapter.kind}`,
    inject: ['storage'],
    apply(ctx: Context): void {
      ctx.storage.register(adapter, resolved)
    }
  }
}

export const builtinStoragePlugins = [
  createStoragePlugin(tosAdapter),
  createStoragePlugin(ossAdapter),
  createStoragePlugin(cosAdapter)
] as const
