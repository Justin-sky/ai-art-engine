import type { GenerateVideoInput } from '@shared/modelProvider'
import { normalizeVideoInputReference } from '@shared/modelProvider'
import { ensureRemoteMediaUrl, deleteUploads, type ObjectStorageUploadResult } from '../objectStorageUploadService'
import { projectService } from '../projectService'

/** 参考视频：本地/data URL → 对象存储远程 URL；图片/音频保持原样（或已是 http） */
export async function prepareVideoInputReferencesForApi(
  input: GenerateVideoInput
): Promise<{ input: GenerateVideoInput; uploads: ObjectStorageUploadResult[] }> {
  const refs = input.inputReferences ?? []
  if (!refs.length) return { input, uploads: [] }

  const uploads: ObjectStorageUploadResult[] = []
  const nextRefs: GenerateVideoInput['inputReferences'] = []
  const root = projectService.isOpen() ? projectService.getRoot() : undefined

  try {
    for (let i = 0; i < refs.length; i++) {
      const normalized = normalizeVideoInputReference(refs[i]!)
      if (normalized.kind !== 'video_url') {
        nextRefs.push(normalized)
        continue
      }
      const { url, uploaded } = await ensureRemoteMediaUrl(normalized.url, {
        sourceLabel: `video-ref-${i + 1}`,
        projectRoot: root
      })
      if (uploaded) uploads.push(uploaded)
      nextRefs.push({ kind: 'video_url', url })
    }
  } catch (err) {
    await deleteUploads(uploads)
    throw err
  }

  return {
    input: { ...input, inputReferences: nextRefs },
    uploads
  }
}
