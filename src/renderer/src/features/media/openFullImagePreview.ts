import { useWorkspaceStore } from '../../stores/workspace'

function detectMediaKind(url: string, relativePath?: string | null): 'image' | 'video' | 'audio' {
  const path = `${relativePath || ''} ${url}`.toLowerCase()
  if (/\.(mp4|webm|mov|mkv)(\?|$)/i.test(path) || path.includes('video')) return 'video'
  if (/\.(mp3|wav|ogg|m4a|aac|flac)(\?|$)/i.test(path) || path.includes('audio')) return 'audio'
  if (url.startsWith('data:video')) return 'video'
  if (url.startsWith('data:audio')) return 'audio'
  return 'image'
}

/**
 * Inspector / 列表缩略图双击：进入统一 dive 媒体预览。
 * 优先 relativePath（getAssetFileUrl → studio-media 原图），否则 dataUrl。
 */
export async function openFullImagePreview(source: {
  dataUrl?: string | null
  relativePath?: string | null
  title?: string | null
}): Promise<void> {
  const workspace = useWorkspaceStore()
  const rootKey = workspace.activeDiveRootKey?.trim()
  const relativePath = source.relativePath?.trim() || ''
  let url = source.dataUrl?.trim() || ''

  if (relativePath && !url) {
    try {
      url = (await window.studio.getAssetFileUrl(relativePath)) || ''
    } catch {
      url = ''
    }
  }

  if (!url && !relativePath) return

  const mediaKind = detectMediaKind(url || relativePath, relativePath)
  if (rootKey) {
    workspace.diveIntoView(
      rootKey,
      {
        viewId: 'media.preview',
        mediaKind,
        url: url || relativePath,
        relativePath: relativePath || undefined,
        title: source.title?.trim() || undefined
      },
      source.title?.trim() || undefined
    )
    return
  }

  // 无活跃 dive 根时仍尽量解析 URL，供调试；正式预览依赖编辑器 dive
  if (!url && relativePath) {
    try {
      url = (await window.studio.getAssetFileUrl(relativePath)) || ''
    } catch {
      /* ignore */
    }
  }
  if (url) {
    console.warn('[openFullImagePreview] no active dive root; preview skipped')
  }
}

/** 资产管理：导入引用类图/声/视双击预览（剧本 txt 不走此窗） */
export async function openImportedMediaRefPreview(asset: {
  type?: string | null
  relativePath?: string | null
  name?: string | null
}): Promise<void> {
  if (asset.type === 'screenplay') return
  const relativePath = asset.relativePath?.trim()
  if (!relativePath) return
  await openFullImagePreview({ relativePath, title: asset.name })
}
