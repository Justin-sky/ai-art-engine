import type { GenerateVideoInput } from '@shared/modelProvider'
import { normalizeVideoInputReference } from '@shared/modelProvider'
import { ensureRemoteMediaUrl, deleteTosUploads, type TosUploadResult } from '../tosUploadService'
import { projectService } from '../projectService'

/** 参考视频：本地/data URL → TOS 远程 URL；图片/音频保持原样（或已是 http） */
export async function prepareVideoInputReferencesForApi(
  input: GenerateVideoInput
): Promise<{ input: GenerateVideoInput; tosUploads: TosUploadResult[] }> {
  const refs = input.inputReferences ?? []
  if (!refs.length) return { input, tosUploads: [] }

  const tosUploads: TosUploadResult[] = []
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
      if (uploaded) tosUploads.push(uploaded)
      nextRefs.push({ kind: 'video_url', url })
    }
  } catch (err) {
    await deleteTosUploads(tosUploads)
    throw err
  }

  return {
    input: { ...input, inputReferences: nextRefs },
    tosUploads
  }
}
