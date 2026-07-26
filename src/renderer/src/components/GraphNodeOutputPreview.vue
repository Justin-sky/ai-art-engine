<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { isDraftAssetId, type AssetInfo, type AssetType } from '@shared/domain'
import {
  isAudioFilePath,
  isImageFilePath,
  isTextFilePath,
  isVideoFilePath
} from '@shared/import'
import {
  flattenImagesValues,
  resolveNodeTextContent,
  type GraphNode,
  type GraphValue
} from '@shared/graph'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'
import { graphRunHosts } from '../features/graph/model/graphRunHosts'
import { useProjectStore } from '../stores/project'
import { useWorkspaceStore } from '../stores/workspace'
import { useStudioI18n } from '../composables/useStudioI18n'
import GraphTextNotepadDialog from './GraphTextNotepadDialog.vue'
import MediaPreviewPlayer from './MediaPreviewPlayer.vue'
import { openFullImagePreview } from '../features/media/openFullImagePreview'
import { resolveAssetText } from '../features/media/resolveAssetText'

export type PreviewMediaKind = 'image' | 'video' | 'audio' | 'text'

export type PreviewItem = {
  key: string
  kind: PreviewMediaKind
  src?: string
  text?: string
  /** 文本落盘路径；有值时预览按路径读正文（对齐图片 relativePath） */
  relativePath?: string
  label?: string
  /** 可在资产窗口定位时的工程资产 id */
  assetId?: string
}

const props = defineProps<{
  node: GraphNode
  hostId: string
}>()

const { t } = useStudioI18n()
const project = useProjectStore()
const workspace = useWorkspaceStore()

const resolvedSrc = ref<Record<string, string>>({})
const resolvedText = ref<Record<string, string>>({})
const loading = ref(false)
let resolveToken = 0

const runOut = computed((): GraphValue | undefined => {
  // 触发对 runStates / 资产列表 / 节点参数写回的依赖
  void project.assets.length
  void graphEditorHosts.revision.value
  const states = graphRunHosts.get(props.hostId)?.runStates
  const nodeId = props.node.id
  const state = states?.[nodeId]
  // 逐字段触达，确保 status/outputs 变更能刷新预览
  void state?.status
  return state?.outputs?.out
})

function isSoundType(type: AssetType | undefined): boolean {
  return type === 'voice'
}

function assetPreviewKind(type: AssetType | undefined): PreviewMediaKind | null {
  if (!type) return null
  if (type === 'image' || type === 'canvas') return 'image'
  if (type === 'video') return 'video'
  if (isSoundType(type)) return 'audio'
  if (type === 'screenplay' || type === 'script') return 'text'
  return null
}

function assetById(id: string | undefined): AssetInfo | undefined {
  if (!id) return undefined
  return project.assets.find((a) => a.id === id)
}

function normalizeRelPath(path: string | undefined | null): string {
  return path?.trim().replace(/\\/g, '/') || ''
}

function assetIdByRelativePath(relativePath: string | undefined | null): string | undefined {
  const target = normalizeRelPath(relativePath)
  if (!target) return undefined
  const hit = project.assets.find((asset) => {
    if (isDraftAssetId(asset.id)) return false
    return (
      normalizeRelPath(asset.relativePath) === target ||
      normalizeRelPath(asset.thumbnailPath) === target
    )
  })
  return hit?.id
}

function revealableAssetId(assetId: string | undefined): string | undefined {
  const id = assetId?.trim()
  if (!id || isDraftAssetId(id)) return undefined
  return project.assets.some((asset) => asset.id === id) ? id : undefined
}

function revealInAssets(assetId: string | undefined): void {
  const id = revealableAssetId(assetId)
  if (!id) return
  workspace.selectAsset(id)
  workspace.revealAssetInBrowser(id)
}

function imageItemSrc(item: { id?: string; dataUrl?: string; relativePath?: string }): string {
  if (item.relativePath?.trim()) return `rel:${item.relativePath}`
  if (item.dataUrl?.trim()) return item.dataUrl
  return ''
}

function isImageDataUrl(dataUrl: string): boolean {
  return /^data:image\//i.test(dataUrl)
}

/** 视频口若拿到图片路径/ data URL，降级为图片预览，避免 <video> 报「编码不受支持」 */
function pushVideoLikeItem(
  into: PreviewItem[],
  id: string | undefined,
  relativePath: string | undefined,
  dataUrl: string | undefined
): void {
  const rel = relativePath?.trim()
  const data = dataUrl?.trim()
  if (!rel && !data) return
  if (rel && isImageFilePath(rel)) {
    into.push({
      key: id?.trim() || rel,
      kind: 'image',
      src: `rel:${rel}`,
      assetId: revealableAssetId(id) ?? assetIdByRelativePath(rel)
    })
    return
  }
  if (!rel && data && isImageDataUrl(data)) {
    into.push({
      key: id?.trim() || data.slice(0, 64),
      kind: 'image',
      src: data,
      assetId: revealableAssetId(id)
    })
    return
  }
  if (rel && !isVideoFilePath(rel) && !isAudioFilePath(rel)) {
    // 非媒体扩展名：不塞进播放器
    return
  }
  into.push({
    key: id?.trim() || rel || data!.slice(0, 64),
    kind: 'video',
    src: rel ? `rel:${rel}` : data,
    assetId: revealableAssetId(id) ?? assetIdByRelativePath(rel)
  })
}

function mediaKindFromNode(node: GraphNode): PreviewMediaKind | null {
  if (node.typeId === 'script.shotImageGen') return 'image'
  if (node.typeId === 'script.shotVideoGen') return 'video'
  if (
    node.category === 'output' &&
    (node.typeId === 'output.text' || node.params.outputKind === 'text')
  ) {
    return 'text'
  }
  const outputKind = node.params.outputKind
  if (node.category === 'output' && outputKind) {
    if (outputKind === 'image') return 'image'
    if (outputKind === 'video') return 'video'
    if (outputKind === 'voice') return 'audio'
  }
  return assetPreviewKind(node.assetType)
}

function collectFromValue(value: GraphValue | undefined, into: PreviewItem[]): void {
  if (!value) return
  if (value.kind === 'image') {
    const src = imageItemSrc(value)
    if (!src) return
    into.push({
      key: value.id?.trim() || src.slice(0, 64),
      kind: 'image',
      src,
      assetId: revealableAssetId(value.id) ?? assetIdByRelativePath(value.relativePath)
    })
    return
  }
  if (value.kind === 'images') {
    for (const [index, item] of value.items.entries()) {
      const src = imageItemSrc(item)
      if (!src) continue
      into.push({
        key: item.id?.trim() || `img:${index}:${src.slice(0, 48)}`,
        kind: 'image',
        src,
        assetId: revealableAssetId(item.id) ?? assetIdByRelativePath(item.relativePath)
      })
    }
    return
  }
  if (value.kind === 'video') {
    pushVideoLikeItem(into, value.id, value.relativePath, value.dataUrl)
    return
  }
  if (value.kind === 'videos') {
    for (const [index, item] of value.items.entries()) {
      pushVideoLikeItem(
        into,
        item.id?.trim() || `vid:${index}`,
        item.relativePath,
        item.dataUrl
      )
    }
    return
  }
  if (value.kind === 'text' && value.text.trim()) {
    into.push({ key: `text:${value.text.slice(0, 32)}`, kind: 'text', text: value.text })
    return
  }
  if (value.kind === 'texts') {
    for (const [index, item] of value.items.entries()) {
      const text = item.text?.trim() ?? ''
      const rel = item.relativePath?.trim()
      if (!text && !rel) continue
      into.push({
        key: item.id?.trim() || `texts:${index}:${(text || rel || '').slice(0, 32)}`,
        kind: 'text',
        text,
        ...(rel ? { relativePath: rel } : {})
      })
    }
    return
  }
  if (value.kind === 'voices') {
    for (const [index, item] of value.items.entries()) {
      pushLocalMediaPreview(into, item.id?.trim() || `voices:${index}`, 'audio', {
        relativePath: item.relativePath,
        assetId: item.id,
        label: undefined
      })
    }
    return
  }
  if (value.kind === 'asset') {
    const kind = assetPreviewKind(value.assetType)
    if (kind === 'text') {
      const asset = assetById(value.assetId)
      const text =
        (typeof asset?.prompt === 'string' && asset.prompt.trim()) ||
        (typeof asset?.notes === 'string' && asset.notes.trim()) ||
        ''
      if (text) {
        into.push({
          key: `asset-text:${value.assetId}`,
          kind: 'text',
          text,
          label: value.title,
          assetId: revealableAssetId(value.assetId)
        })
      }
      return
    }
    if (kind) {
      const rel = value.relativePath?.trim()
      into.push({
        key: `asset:${value.assetId}`,
        kind,
        src: rel ? `rel:${rel}` : `asset:${value.assetId}`,
        label: value.title || value.label,
        assetId: revealableAssetId(value.assetId)
      })
    }
    return
  }
  if (value.kind === 'output') {
    for (const item of value.items) collectFromValue(item, into)
    for (const [index, item] of (value.images ?? []).entries()) {
      const src = imageItemSrc(item)
      if (!src) continue
      into.push({
        key: item.id?.trim() || `out-img:${index}`,
        kind: 'image',
        src,
        assetId: revealableAssetId(item.id) ?? assetIdByRelativePath(item.relativePath)
      })
    }
    for (const [index, item] of (value.videos ?? []).entries()) {
      pushVideoLikeItem(
        into,
        item.id?.trim() || `out-vid:${index}`,
        item.relativePath,
        item.dataUrl
      )
    }
    for (const [index, item] of (value.voices ?? []).entries()) {
      pushLocalMediaPreview(into, item.id?.trim() || `out-voices:${index}`, 'audio', {
        relativePath: item.relativePath,
        assetId: item.id
      })
    }
    if (value.texts?.length) {
      for (const [index, item] of value.texts.entries()) {
        const text = item.text?.trim() ?? ''
        const rel = item.relativePath?.trim()
        if (!text && !rel) continue
        into.push({
          key: item.id?.trim() || `out-texts:${index}:${(text || rel || '').slice(0, 32)}`,
          kind: 'text',
          text,
          ...(rel ? { relativePath: rel } : {})
        })
      }
    } else {
      for (const [index, note] of value.notes.entries()) {
        const text = note.text.trim()
        if (!text) continue
        into.push({ key: `output-notes:${index}:${text.slice(0, 32)}`, kind: 'text', text: note.text })
      }
    }
  }
}

function pushLocalMediaPreview(
  into: PreviewItem[],
  key: string,
  kind: PreviewMediaKind | null,
  opts: { dataUrl?: string; relativePath?: string; assetId?: string; label?: string }
): void {
  if (!kind || kind === 'text') return
  const assetId =
    revealableAssetId(opts.assetId) ?? assetIdByRelativePath(opts.relativePath)
  const rel = opts.relativePath?.trim()
  if (rel) {
    if (kind === 'video' && isImageFilePath(rel)) {
      into.push({ key, kind: 'image', src: `rel:${rel}`, label: opts.label, assetId })
      return
    }
    if (kind === 'video' && !isVideoFilePath(rel)) return
    if (kind === 'audio' && !isAudioFilePath(rel)) return
    into.push({ key, kind, src: `rel:${rel}`, label: opts.label, assetId })
    return
  }
  if (kind === 'image' && opts.dataUrl?.trim()) {
    into.push({ key, kind, src: opts.dataUrl, label: opts.label, assetId })
    return
  }
  if (kind === 'video' && opts.dataUrl?.trim() && isImageDataUrl(opts.dataUrl)) {
    into.push({ key, kind: 'image', src: opts.dataUrl, label: opts.label, assetId })
    return
  }
  if (opts.assetId?.trim()) {
    into.push({
      key,
      kind,
      src: `asset:${opts.assetId}`,
      label: opts.label,
      assetId
    })
  }
}

function collectFallback(into: PreviewItem[]): void {
  void graphEditorHosts.revision.value
  void project.assets.length
  // 优先读宿主上的活节点，避免 Inspector 传入的 props.node 快照过期
  const node = graphEditorHosts.getNode(props.hostId, props.node.id) ?? props.node
  const runState = graphRunHosts.get(props.hostId)?.runStates?.[node.id]
  void runState?.status
  const textContent = resolveNodeTextContent(node, runState)
  if (textContent?.text.trim()) {
    into.push({ key: 'node-text', kind: 'text', text: textContent.text })
  }

  const nodeMediaKind = mediaKindFromNode(node)
  const hasImageGallery =
    !!(node.params.generatedImages ?? []).length || !!(node.params.cameraShots ?? []).length

  if (hasImageGallery || nodeMediaKind === 'image' || nodeMediaKind == null) {
    const imageItems = flattenImagesValues(
      node.params.generatedImages?.length
        ? [
            {
              kind: 'images' as const,
              items: node.params.generatedImages
                .filter((s) => s.dataUrl?.trim() || s.relativePath?.trim())
                .map((s) => ({
                  id: s.id,
                  dataUrl: s.dataUrl || '',
                  createdAt: s.createdAt,
                  relativePath: s.relativePath
                }))
            }
          ]
        : node.params.cameraShots?.length
          ? [
              {
                kind: 'images' as const,
                items: node.params.cameraShots
                  .filter((s) => s.dataUrl?.trim() || s.relativePath?.trim())
                  .map((s) => ({
                    id: s.id,
                    dataUrl: s.dataUrl || '',
                    createdAt: s.createdAt,
                    relativePath: s.relativePath
                  }))
              }
            ]
          : nodeMediaKind === 'image' &&
              (node.params.previewDataUrl || node.params.previewRelativePath)
            ? [
                {
                  kind: 'image' as const,
                  dataUrl: node.params.previewDataUrl || '',
                  relativePath: node.params.previewRelativePath
                }
              ]
            : []
    )
    for (const [index, item] of imageItems.entries()) {
      const src = imageItemSrc(item)
      if (!src) continue
      into.push({
        key: item.id?.trim() || `fallback-img:${index}`,
        kind: 'image',
        src,
        assetId: revealableAssetId(item.id) ?? assetIdByRelativePath(item.relativePath)
      })
    }
  }

  if (nodeMediaKind === 'audio' && (node.params.generatedVoices ?? []).length) {
    for (const [index, item] of (node.params.generatedVoices ?? []).entries()) {
      pushLocalMediaPreview(into, item.id?.trim() || `fallback-audio:${index}`, 'audio', {
        relativePath: item.relativePath,
        assetId: item.id,
        label: node.title
      })
    }
  } else if (nodeMediaKind === 'video' && (node.params.generatedVideos ?? []).length) {
    for (const [index, item] of (node.params.generatedVideos ?? []).entries()) {
      pushLocalMediaPreview(into, item.id?.trim() || `fallback-video:${index}`, 'video', {
        relativePath: item.relativePath,
        dataUrl: item.dataUrl,
        assetId: item.id,
        label: node.title
      })
    }
  } else if (nodeMediaKind === 'video' || nodeMediaKind === 'audio') {
    pushLocalMediaPreview(into, `node-preview:${node.id}`, nodeMediaKind, {
      relativePath: node.params.previewRelativePath,
      assetId: node.assetId,
      label: node.title
    })
  }

  if ((node.params.generatedTexts ?? []).length) {
    for (const [index, item] of (node.params.generatedTexts ?? []).entries()) {
      const text = item.text?.trim() ?? ''
      const rel = item.relativePath?.trim()
      if (!text && !rel) continue
      into.push({
        key: item.id?.trim() || `fallback-text:${index}`,
        kind: 'text',
        text,
        ...(rel ? { relativePath: rel } : {})
      })
    }
  }

  if (node.assetId && node.assetType) {
    const kind = assetPreviewKind(node.assetType)
    if (kind === 'text') {
      // 剧本 / 分镜引用：只认旁挂 txt/md；元数据 .asset.json 不当正文
      if (!into.some((item) => item.kind === 'text' && item.text?.trim())) {
        const asset = assetById(node.assetId)
        const rel = asset?.relativePath?.trim() || ''
        into.push({
          key: `bound-text:${node.assetId}`,
          kind: 'text',
          relativePath: rel && isTextFilePath(rel) ? rel : undefined,
          label: node.title,
          assetId: node.assetId
        })
      }
    } else if (kind) {
      into.push({
        key: `bound:${node.assetId}`,
        kind,
        src: `asset:${node.assetId}`,
        label: node.title,
        assetId: revealableAssetId(node.assetId)
      })
    }
  }

  // 输出节点：已有本地媒体预览时不再叠加上游，避免同一批媒体翻倍
  if (node.category === 'output') {
    const hasLocalMedia =
      into.some((item) => item.kind !== 'text') ||
      !!node.params.cameraShots?.length ||
      !!node.params.previewDataUrl?.trim() ||
      !!node.params.previewRelativePath?.trim()
    if (!hasLocalMedia) {
      collectUpstreamPreview(props.hostId, node.id, into, new Set([node.id]))
    }
  }
}

function pushNodeLocalPreview(source: GraphNode, into: PreviewItem[]): void {
  // 累计图库优先于当次 runStates（out 可能只含本批）
  if ((source.params.generatedImages ?? []).length) {
    for (const [index, item] of (source.params.generatedImages ?? []).entries()) {
      const src = imageItemSrc(item)
      if (!src) continue
      into.push({
        key: item.id?.trim() || `up-gen:${source.id}:${index}`,
        kind: 'image',
        src,
        assetId: revealableAssetId(item.id) ?? assetIdByRelativePath(item.relativePath)
      })
    }
    return
  }
  if ((source.params.generatedVideos ?? []).length) {
    for (const [index, item] of (source.params.generatedVideos ?? []).entries()) {
      pushLocalMediaPreview(into, item.id?.trim() || `up-gen-video:${source.id}:${index}`, 'video', {
        relativePath: item.relativePath,
        dataUrl: item.dataUrl,
        assetId: item.id
      })
    }
    return
  }

  // 优先用上游节点本次 run 的输出（视频生成会产出 asset + relativePath）
  const upstreamOut = graphRunHosts.get(props.hostId)?.runStates?.[source.id]?.outputs?.out
  if (upstreamOut) {
    const before = into.length
    collectFromValue(upstreamOut, into)
    if (into.length > before) return
  }

  // 生成节点：优先用 generatedTexts / voices，避免再叠一层 previewDataUrl 重复
  if ((source.params.generatedTexts ?? []).length) {
    for (const [index, item] of (source.params.generatedTexts ?? []).entries()) {
      const text = item.text?.trim() ?? ''
      const rel = item.relativePath?.trim()
      if (!text && !rel) continue
      into.push({
        key: item.id?.trim() || `up-gen-text:${source.id}:${index}`,
        kind: 'text',
        text,
        ...(rel ? { relativePath: rel } : {})
      })
    }
    return
  }
  if ((source.params.generatedVoices ?? []).length) {
    for (const [index, item] of (source.params.generatedVoices ?? []).entries()) {
      pushLocalMediaPreview(
        into, item.id?.trim() || `up-gen-audio:${source.id}:${index}`, 'audio',
        {
          relativePath: item.relativePath,
          assetId: item.id
        }
      )
    }
    return
  }
  if ((source.params.cameraShots ?? []).length) {
    for (const [index, shot] of (source.params.cameraShots ?? []).entries()) {
      const src = imageItemSrc(shot)
      if (!src) continue
      into.push({
        key: shot.id?.trim() || `up-shot:${source.id}:${index}`,
        kind: 'image',
        src,
        assetId: revealableAssetId(shot.id) ?? assetIdByRelativePath(shot.relativePath)
      })
    }
    return
  }

  const mediaKind = mediaKindFromNode(source) ?? assetPreviewKind(source.assetType)
  const previewRel = source.params.previewRelativePath?.trim()
  const previewData = source.params.previewDataUrl?.trim()
  if (mediaKind === 'video') {
    pushVideoLikeItem(into, `up-preview:${source.id}`, previewRel, previewData)
  } else {
    const previewSrc = imageItemSrc({
      dataUrl: previewData,
      relativePath: previewRel
    })
    if (previewSrc) {
      const kind =
        mediaKind === 'audio' || mediaKind === 'image' ? mediaKind : 'image'
      if (kind === 'audio' && previewRel && !isAudioFilePath(previewRel)) {
        /* skip non-audio preview path */
      } else {
        into.push({
          key: `up-preview:${source.id}`,
          kind,
          src: previewSrc,
          assetId:
            revealableAssetId(source.assetId) ?? assetIdByRelativePath(previewRel)
        })
      }
    }
  }
  if (!source.assetId || !source.assetType) return
  const kind = assetPreviewKind(source.assetType)
  if (kind === 'text') {
    const asset = assetById(source.assetId)
    const text =
      (typeof asset?.prompt === 'string' && asset.prompt.trim()) ||
      (typeof asset?.notes === 'string' && asset.notes.trim()) ||
      ''
    if (text) {
      into.push({
        key: `up-text:${source.assetId}`,
        kind: 'text',
        text,
        label: source.title,
        assetId: revealableAssetId(source.assetId)
      })
      return
    }
    const rel = asset?.relativePath?.trim() || ''
    into.push({
      key: `up-text:${source.assetId}`,
      kind: 'text',
      relativePath: rel && isTextFilePath(rel) ? rel : undefined,
      label: source.title,
      assetId: source.assetId
    })
    return
  }
  if (kind) {
    into.push({
      key: `up-asset:${source.assetId}`,
      kind,
      src: `asset:${source.assetId}`,
      label: source.title,
      assetId: revealableAssetId(source.assetId)
    })
  }
}

function collectUpstreamPreview(
  hostId: string,
  nodeId: string,
  into: PreviewItem[],
  visited: Set<string>
): void {
  const incoming = graphEditorHosts.listIncomingEdges(hostId, nodeId)
  for (const edge of incoming) {
    if (visited.has(edge.sourceNodeId)) continue
    visited.add(edge.sourceNodeId)
    const source = graphEditorHosts.getNode(hostId, edge.sourceNodeId)
    if (!source) continue
    pushNodeLocalPreview(source, into)
    collectUpstreamPreview(hostId, source.id, into, visited)
  }
}

function isShotAggregatePreviewNode(typeId: string | undefined): boolean {
  return typeId === 'script.shotImageGen' || typeId === 'script.shotVideoGen'
}

function appendNodeTextPreview(into: PreviewItem[]): void {
  if (into.some((item) => item.kind === 'text' && item.text?.trim())) return
  const node = graphEditorHosts.getNode(props.hostId, props.node.id) ?? props.node
  const runState = graphRunHosts.get(props.hostId)?.runStates?.[node.id]
  void runState?.status
  const textContent = resolveNodeTextContent(node, runState)
  const text = textContent?.text?.trim() || node.params.text?.trim() || ''
  if (!text) return
  into.push({ key: 'node-text', kind: 'text', text })
}

const items = computed((): PreviewItem[] => {
  // 依赖资产列表，避免 generate 后 refreshAssets 前 resolve 失败而不再重试
  void project.assets.length
  void graphEditorHosts.revision.value
  const list: PreviewItem[] = []
  const node = graphEditorHosts.getNode(props.hostId, props.node.id) ?? props.node
  // 累计图库优先：runStates.out 可能只含本批新图，重开后会被误当成「只有一张」
  const hasGallery =
    !!(node.params.generatedImages ?? []).length ||
    !!(node.params.generatedVideos ?? []).length ||
    !!(node.params.generatedVoices ?? []).length ||
    !!(node.params.generatedTexts ?? []).length ||
    !!(node.params.cameraShots ?? []).length
  if (hasGallery) {
    collectFallback(list)
  } else {
    collectFromValue(runOut.value, list)
    if (!list.length) {
      collectFallback(list)
    } else if (isShotAggregatePreviewNode(props.node.typeId)) {
      appendNodeTextPreview(list)
    }
  }
  if (hasGallery && isShotAggregatePreviewNode(props.node.typeId)) {
    appendNodeTextPreview(list)
  }
  // 去重
  const seen = new Set<string>()
  return list.filter((item) => {
    if (seen.has(item.key)) return false
    seen.add(item.key)
    return true
  })
})

const mediaItems = computed(() => items.value.filter((item) => item.kind !== 'text'))
const textItems = computed(() => items.value.filter((item) => item.kind === 'text'))

const layoutKind = computed(() => {
  const list = items.value
  if (!list.length) return 'empty'
  const hasMedia = mediaItems.value.length > 0
  const hasText = textItems.value.length > 0
  if (hasMedia && hasText) return 'mixed'
  if (list.every((i) => i.kind === 'text')) {
    // 剧本生成 / 剧本输出：文本数组用网格预览；其它单段文本仍用竖向堆叠
    const preferTextGrid =
      props.node.typeId === 'output.text' ||
      props.node.params.outputKind === 'text' ||
      (props.node.typeId === 'asset.screenplay' && props.node.params.assetRef !== true) ||
      list.length > 1
    return preferTextGrid ? 'grid' : 'text'
  }
  if (list.length === 1) return 'single'
  return 'grid'
})

const hasPreview = computed(() => items.value.length > 0)

const primaryRevealAssetId = computed(() => {
  for (const item of items.value) {
    const id = revealableAssetId(item.assetId)
    if (id) return id
  }
  return ''
})

async function resolveAssetSrc(assetId: string): Promise<string> {
  const asset = assetById(assetId)
  if (!asset?.relativePath) return ''
  try {
    if (asset.type === 'video') {
      if (!isVideoFilePath(asset.relativePath)) return ''
      return await window.studio.getAssetFileUrl(asset.relativePath)
    }
    if (isSoundType(asset.type)) {
      if (!isAudioFilePath(asset.relativePath)) return ''
      return await window.studio.getAssetFileUrl(asset.relativePath)
    }
    return await window.studio.getAssetPreviewUrl(asset.relativePath)
  } catch {
    return ''
  }
}

async function resolveRelSrc(
  relativePath: string,
  kind: PreviewMediaKind
): Promise<string> {
  try {
    if (kind === 'video') {
      if (!isVideoFilePath(relativePath)) return ''
      return await window.studio.getAssetFileUrl(relativePath)
    }
    if (kind === 'audio') {
      if (!isAudioFilePath(relativePath)) return ''
      return await window.studio.getAssetFileUrl(relativePath)
    }
    return await window.studio.getAssetPreviewUrl(relativePath)
  } catch {
    return ''
  }
}

async function resolveTextBody(item: PreviewItem): Promise<string> {
  if (item.text?.trim()) return item.text
  const assetId = item.assetId?.trim()
  if (assetId) {
    return (await resolveAssetText(assetId))?.trim() ?? ''
  }
  const relativePath = item.relativePath?.trim()
  if (relativePath && isTextFilePath(relativePath)) {
    try {
      const url = await window.studio.getAssetFileUrl(relativePath)
      if (!url) return ''
      const res = await fetch(url)
      if (!res.ok) return ''
      return await res.text()
    } catch {
      return ''
    }
  }
  return ''
}

function displayText(item: PreviewItem): string {
  return resolvedText.value[item.key] || item.text || item.relativePath || ''
}

async function resolveItems(): Promise<void> {
  const token = ++resolveToken
  const next: Record<string, string> = {}
  const nextText: Record<string, string> = {}
  const pendingMedia = items.value.filter(
    (item) => item.src?.startsWith('asset:') || item.src?.startsWith('rel:')
  )
  const pendingText = items.value.filter(
    (item) =>
      item.kind === 'text' &&
      !item.text?.trim() &&
      (!!item.relativePath?.trim() || !!item.assetId?.trim())
  )
  loading.value = pendingMedia.length > 0 || pendingText.length > 0
  await Promise.all([
    ...pendingMedia.map(async (item) => {
      if (item.src!.startsWith('asset:')) {
        const assetId = item.src!.slice('asset:'.length)
        const url = await resolveAssetSrc(assetId)
        if (url) next[item.key] = url
        return
      }
      const relativePath = item.src!.slice('rel:'.length)
      const url = await resolveRelSrc(relativePath, item.kind)
      if (url) next[item.key] = url
    }),
    ...pendingText.map(async (item) => {
      const body = await resolveTextBody(item)
      if (body) nextText[item.key] = body
    })
  ])
  if (token !== resolveToken) return
  // keep direct data/http urls
  for (const item of items.value) {
    if (item.src && !item.src.startsWith('asset:') && !item.src.startsWith('rel:')) {
      next[item.key] = item.src
    }
    if (item.kind === 'text' && item.text?.trim()) {
      nextText[item.key] = item.text
    }
  }
  resolvedSrc.value = next
  resolvedText.value = nextText
  loading.value = false
}

watch(
  items,
  () => {
    void resolveItems()
  },
  { immediate: true, deep: true }
)

onBeforeUnmount(() => {
  resolveToken += 1
})

function displaySrc(item: PreviewItem): string {
  return resolvedSrc.value[item.key] ||
    (item.src?.startsWith('asset:') || item.src?.startsWith('rel:') ? '' : item.src || '')
}

const notepadOpen = ref(false)
const notepadText = ref('')
const notepadTitle = computed(() => {
  const nodeTitle = props.node.title?.trim()
  const base = nodeTitle || t('graph.inspector.outputPreview')
  return `${base} · ${t('graph.inspector.outputPreview')}`
})
const textOpenHint = computed(() => t('graph.notepad.openHint'))

function openTextNotepad(item: PreviewItem | string | undefined): void {
  if (typeof item === 'string' || item == null) {
    notepadText.value = item?.trim() ? item : ''
    notepadOpen.value = true
    return
  }
  notepadText.value = displayText(item)
  notepadOpen.value = true
}

function closeTextNotepad(): void {
  notepadOpen.value = false
  notepadText.value = ''
}

async function openImageFull(item: PreviewItem): Promise<void> {
  if (item.kind !== 'image' || !item.src) return
  if (item.src.startsWith('rel:')) {
    await openFullImagePreview({ relativePath: item.src.slice('rel:'.length) })
    return
  }
  if (item.src.startsWith('asset:')) {
    const asset = assetById(item.src.slice('asset:'.length))
    await openFullImagePreview({ relativePath: asset?.relativePath })
    return
  }
  await openFullImagePreview({ dataUrl: item.src })
}

const imagePreviewHint = computed(() => t('graph.selectImage.previewHint'))
</script>

<template>
  <section v-if="hasPreview" class="output-preview" :aria-label="t('graph.inspector.outputPreview')">
    <div class="section-head">
      <span class="section-title">{{ t('graph.inspector.outputPreview') }}</span>
      <div class="section-actions">
        <span v-if="items.length > 1" class="section-count">
          {{ t('graph.inspector.outputPreviewCount', { n: items.length }) }}
        </span>
        <button
          v-if="primaryRevealAssetId && layoutKind !== 'grid'"
          type="button"
          class="reveal-btn"
          :title="t('graph.inspector.revealInAssets')"
          :aria-label="t('graph.inspector.revealInAssets')"
          @click="revealInAssets(primaryRevealAssetId)"
        >
          <span class="icon-reveal" aria-hidden="true" />
        </button>
      </div>
    </div>

    <p v-if="loading" class="hint">{{ t('graph.inspector.outputPreviewLoading') }}</p>

    <div v-else-if="layoutKind === 'text'" class="text-stack">
      <pre
        v-for="item in items"
        :key="item.key"
        class="text-body interactive"
        :title="textOpenHint"
        @dblclick="openTextNotepad(item)"
      >{{ displayText(item) }}</pre>
    </div>

    <div v-else-if="layoutKind === 'mixed'" class="mixed-stack">
      <div v-if="mediaItems.length === 1" class="single">
        <template v-for="item in mediaItems" :key="item.key">
          <img
            v-if="item.kind === 'image' && displaySrc(item)"
            :src="displaySrc(item)"
            alt=""
            loading="lazy"
            decoding="async"
            class="preview-image interactive"
            :title="imagePreviewHint"
            @dblclick="openImageFull(item)"
          />
          <MediaPreviewPlayer
            v-else-if="(item.kind === 'video' || item.kind === 'audio') && displaySrc(item)"
            :kind="item.kind === 'audio' ? 'voice' : 'video'"
            :src="displaySrc(item)"
          />
          <p v-else class="hint">{{ t('graph.inspector.outputPreviewMissing') }}</p>
        </template>
      </div>
      <div v-else class="media-grid">
        <div
          v-for="(item, index) in mediaItems"
          :key="item.key"
          class="media-card"
          :data-kind="item.kind"
        >
          <button
            v-if="revealableAssetId(item.assetId)"
            type="button"
            class="reveal-btn card-reveal"
            :title="t('graph.inspector.revealInAssets')"
            :aria-label="t('graph.inspector.revealInAssets')"
            @click.stop="revealInAssets(item.assetId)"
          >
            <span class="icon-reveal" aria-hidden="true" />
          </button>
          <img
            v-if="item.kind === 'image' && displaySrc(item)"
            :src="displaySrc(item)"
            alt=""
            loading="lazy"
            decoding="async"
            class="preview-image interactive"
            :title="imagePreviewHint"
            @dblclick="openImageFull(item)"
          />
          <MediaPreviewPlayer
            v-else-if="(item.kind === 'video' || item.kind === 'audio') && displaySrc(item)"
            class="grid-player"
            :kind="item.kind === 'audio' ? 'voice' : 'video'"
            :src="displaySrc(item)"
          />
          <p v-else class="hint">{{ t('graph.inspector.outputPreviewMissing') }}</p>
          <span class="media-index">{{ index + 1 }}</span>
        </div>
      </div>
      <div class="text-stack aggregate-json">
        <span class="aggregate-label">{{ t('graph.inspector.aggregateJson') }}</span>
        <pre
          v-for="item in textItems"
          :key="item.key"
          class="text-body interactive"
          :title="textOpenHint"
          @dblclick="openTextNotepad(item)"
        >{{ displayText(item) }}</pre>
      </div>
    </div>

    <div v-else-if="layoutKind === 'single'" class="single">
      <template v-for="item in items" :key="item.key">
        <img
          v-if="item.kind === 'image' && displaySrc(item)"
          :src="displaySrc(item)"
          alt=""
          loading="lazy"
          decoding="async"
          class="preview-image interactive"
          :title="imagePreviewHint"
          @dblclick="openImageFull(item)"
        />
        <MediaPreviewPlayer
          v-else-if="(item.kind === 'video' || item.kind === 'audio') && displaySrc(item)"
          :kind="item.kind === 'audio' ? 'voice' : 'video'"
          :src="displaySrc(item)"
        />
        <pre
          v-else-if="item.kind === 'text'"
          class="text-body interactive"
          :title="textOpenHint"
          @dblclick="openTextNotepad(item)"
        >{{ displayText(item) }}</pre>
        <p v-else class="hint">{{ t('graph.inspector.outputPreviewMissing') }}</p>
      </template>
    </div>

    <div v-else class="media-grid">
      <div v-for="(item, index) in items" :key="item.key" class="media-card" :data-kind="item.kind">
        <button
          v-if="revealableAssetId(item.assetId)"
          type="button"
          class="reveal-btn card-reveal"
          :title="t('graph.inspector.revealInAssets')"
          :aria-label="t('graph.inspector.revealInAssets')"
          @click.stop="revealInAssets(item.assetId)"
        >
          <span class="icon-reveal" aria-hidden="true" />
        </button>
        <img
          v-if="item.kind === 'image' && displaySrc(item)"
          :src="displaySrc(item)"
          alt=""
          loading="lazy"
          decoding="async"
          class="preview-image interactive"
          :title="imagePreviewHint"
          @dblclick="openImageFull(item)"
        />
        <MediaPreviewPlayer
          v-else-if="(item.kind === 'video' || item.kind === 'audio') && displaySrc(item)"
          class="grid-player"
          :kind="item.kind === 'audio' ? 'voice' : 'video'"
          :src="displaySrc(item)"
        />
        <div v-else-if="item.kind === 'audio'" class="audio-card">
          <span class="audio-glyph" aria-hidden="true">♪</span>
          <p class="hint">{{ t('graph.inspector.outputPreviewMissing') }}</p>
        </div>
        <pre
          v-else-if="item.kind === 'text'"
          class="text-body compact interactive"
          :title="textOpenHint"
          @dblclick="openTextNotepad(item)"
        >{{ displayText(item) }}</pre>
        <p v-else class="hint">{{ t('graph.inspector.outputPreviewMissing') }}</p>
        <span class="media-index">{{ index + 1 }}</span>
      </div>
    </div>

    <GraphTextNotepadDialog
      :open="notepadOpen"
      :title="notepadTitle"
      :text="notepadText"
      :editable="false"
      @close="closeTextNotepad"
    />
  </section>
</template>

<style scoped>
.output-preview {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.section-title {
  font-size: 11px;
  color: var(--text-muted);
  letter-spacing: 0.04em;
}

.section-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.section-count {
  font-size: 11px;
  color: var(--text-muted);
}

.reveal-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-elevated);
  color: var(--text-muted);
  cursor: pointer;
  flex-shrink: 0;
}

.reveal-btn:hover {
  color: var(--text);
  border-color: var(--accent);
  background: var(--bg-hover);
}

.reveal-btn.card-reveal {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 2;
  background: color-mix(in srgb, var(--bg-elevated) 88%, transparent);
}

.icon-reveal {
  position: relative;
  width: 11px;
  height: 9px;
  box-sizing: border-box;
  border: 1.5px solid currentColor;
  border-radius: 1px 1px 2px 2px;
}

.icon-reveal::before {
  content: '';
  position: absolute;
  left: -1.5px;
  top: -3px;
  width: 5px;
  height: 2.5px;
  border: 1.5px solid currentColor;
  border-bottom: none;
  border-radius: 1px 1px 0 0;
  background: transparent;
}

.icon-reveal::after {
  content: '';
  position: absolute;
  right: -1px;
  bottom: -1px;
  width: 5px;
  height: 5px;
  border-right: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
  transform: rotate(-45deg);
}

.hint {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
}

.single {
  border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  border-radius: 8px;
  overflow: hidden;
  background: var(--graph-preview-bg);
}

.single img {
  display: block;
  width: 100%;
  max-height: 240px;
  object-fit: contain;
  background: var(--graph-preview-bg);
}

.preview-image.interactive {
  cursor: zoom-in;
}

.single :deep(.media-preview-player) {
  width: 100%;
}

.media-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
  gap: 8px;
}

.media-grid:has(.media-card[data-kind='text']) {
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
}

.media-card {
  position: relative;
  border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  border-radius: 8px;
  overflow: hidden;
  background: var(--graph-preview-bg);
  aspect-ratio: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.media-card img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  background: var(--graph-preview-bg);
}

.media-card[data-kind='video'] {
  aspect-ratio: 16 / 10;
}

.media-card[data-kind='audio'],
.media-card[data-kind='text'] {
  aspect-ratio: auto;
  min-height: 96px;
  box-sizing: border-box;
}

.media-card[data-kind='text'] {
  padding: 8px;
}

.media-card :deep(.media-preview-player.video) {
  width: 100%;
  height: 100%;
  max-height: none;
}

.media-card :deep(.media-preview-player.video .media-el) {
  width: 100%;
  height: 100%;
  max-height: none;
  object-fit: cover;
}

.media-card :deep(.media-preview-player.audio) {
  width: 100%;
  min-height: 96px;
}

.audio-card {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 8px;
}

.audio-glyph {
  font-size: 22px;
  color: var(--text-muted);
}

.media-index {
  position: absolute;
  left: 6px;
  top: 6px;
  font-size: 10px;
  line-height: 1;
  padding: 3px 5px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
}

.text-stack {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mixed-stack {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}

.aggregate-json {
  gap: 6px;
}

.aggregate-label {
  font-size: 11px;
  color: var(--text-muted);
  letter-spacing: 0.04em;
}

.aggregate-json .text-body {
  max-height: 280px;
}

.text-body {
  margin: 0;
  padding: 10px;
  max-height: 220px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 12px;
  line-height: 1.45;
  color: var(--text);
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 8px;
}

.text-body.interactive {
  cursor: pointer;
}

.text-body.interactive:hover {
  border-color: color-mix(in srgb, var(--accent, #6ea8fe) 45%, var(--border));
}

.text-body.compact {
  max-height: 140px;
  width: 100%;
  font-size: 11px;
}
</style>
