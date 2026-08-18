import type {
  ObjectStorageProviderInstance,
  ObjectStorageProviderKind
} from '@shared/objectStorage'

/**
 * 单一对象存储适配器。
 * 新增云厂商：实现本接口 → Cordis `createStoragePlugin` → shared OBJECT_STORAGE_PROVIDER_KINDS 加一项。
 */
export interface ObjectStorageAdapter {
  readonly kind: ObjectStorageProviderKind
  uploadFile(
    provider: ObjectStorageProviderInstance,
    absPath: string,
    objectKey: string
  ): Promise<string>
  uploadBuffer(
    provider: ObjectStorageProviderInstance,
    buffer: Buffer,
    objectKey: string
  ): Promise<string>
  deleteObject(
    provider: ObjectStorageProviderInstance,
    bucket: string,
    key: string
  ): Promise<void>
}
