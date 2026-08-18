import type { ModelProviderKind, ModelProviderKindMeta } from '@shared/modelProvider'
import type { ObjectStorageKindMeta, ObjectStorageProviderKind } from '@shared/objectStorage'
import type { ModelProviderAdapter } from '../services/modelProviders/types'
import type { ObjectStorageAdapter } from '../services/objectStorage/types'
import { useMainContext } from './start'

export function getProviderAdapter(kind: ModelProviderKind | undefined | null): ModelProviderAdapter {
  return useMainContext().providers.get(kind)
}

export function listRegisteredProviderKinds(): ModelProviderKindMeta[] {
  return useMainContext().providers.listKinds()
}

export function getObjectStorageAdapter(kind: ObjectStorageProviderKind): ObjectStorageAdapter {
  return useMainContext().storage.get(kind)
}

export function listRegisteredObjectStorageKinds(): ObjectStorageKindMeta[] {
  return useMainContext().storage.listKinds()
}
