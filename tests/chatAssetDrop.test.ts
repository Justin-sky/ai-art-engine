import { describe, expect, it } from 'vitest'
import type { AssetInfo } from '../src/shared/domain'
import {
  STUDIO_ASSET_DRAG_MIME,
  STUDIO_ASSET_ID_DRAG_MIME,
  STUDIO_ASSET_IDS_DRAG_MIME
} from '../src/shared/studioDragMime'
import {
  canAcceptChatDropTransfer,
  classifyDroppedExternalMediaFile,
  inferChatMediaAssetType,
  isChatDroppableAsset,
  isStudioAssetDragTransfer,
  resolveChatDropOutputDir,
  resolveDroppedChatAssetPaths,
  type ChatDragTransferLike
} from '../src/renderer/src/features/chat/chatAssetDrop'

function makeAsset(
  id: string,
  type: AssetInfo['type'],
  relativePath: string,
  name = id
): AssetInfo {
  return {
    id,
    name,
    type,
    relativePath,
    tags: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
}

function makeTransfer(
  data: Record<string, string>,
  extra?: Partial<ChatDragTransferLike>
): ChatDragTransferLike {
  return {
    types: Object.keys(data),
    getData: (fmt: string) => data[fmt] ?? '',
    ...extra
  }
}

describe('chatAssetDrop (Asset Window -> AI Chat drag & drop)', () => {
  const imgAsset = makeAsset('img-1', 'image', 'Assets\\Images\\hero.png', 'hero.png')
  const vidAsset = makeAsset('vid-1', 'video', 'Assets/Videos/intro.mp4', 'intro.mp4')
  const voiceAsset = makeAsset('voc-1', 'voice', 'Assets\\Voices\\bgm.mp3', 'bgm.mp3')
  const modelAsset = makeAsset('mdl-1', 'model3d', 'Assets/Models/knight.glb', 'knight.glb')
  const canvasAsset = makeAsset('cvs-1', 'canvas', 'Assets/Canvases/main.canvas.asset.json', 'main')
  const projectAssets = [imgAsset, vidAsset, voiceAsset, modelAsset, canvasAsset]

  it('recognizes image, video, voice, and 3D model assets as droppable and rejects canvas assets', () => {
    expect(isChatDroppableAsset(imgAsset)).toBe(true)
    expect(isChatDroppableAsset(vidAsset)).toBe(true)
    expect(isChatDroppableAsset(voiceAsset)).toBe(true)
    expect(isChatDroppableAsset(modelAsset)).toBe(true)
    expect(isChatDroppableAsset(canvasAsset)).toBe(false)
    expect(isChatDroppableAsset(makeAsset('empty', 'image', '   '))).toBe(false)
  })

  it('resolves single image, video, or voice asset dropped from AssetBrowser via MIME', () => {
    for (const [asset, expected] of [
      [imgAsset, 'Assets/Images/hero.png'],
      [vidAsset, 'Assets/Videos/intro.mp4'],
      [voiceAsset, 'Assets/Voices/bgm.mp3']
    ] as const) {
      const transfer = makeTransfer({
        [STUDIO_ASSET_DRAG_MIME]: JSON.stringify(asset),
        [STUDIO_ASSET_IDS_DRAG_MIME]: JSON.stringify([asset.id]),
        'text/plain': asset.id
      })
      expect(
        resolveDroppedChatAssetPaths({
          transfer,
          draggingAsset: asset,
          draggingAssetIds: [asset.id],
          projectAssets
        })
      ).toEqual([expected])
    }
  })

  it('resolves multi-selected image + video + voice assets in selection order and filters non-media', () => {
    const transfer = makeTransfer({
      [STUDIO_ASSET_DRAG_MIME]: JSON.stringify(imgAsset),
      [STUDIO_ASSET_IDS_DRAG_MIME]: JSON.stringify([
        imgAsset.id,
        canvasAsset.id,
        vidAsset.id,
        voiceAsset.id,
        imgAsset.id
      ])
    })
    expect(
      resolveDroppedChatAssetPaths({
        transfer,
        draggingAsset: imgAsset,
        draggingAssetIds: [imgAsset.id, canvasAsset.id, vidAsset.id, voiceAsset.id],
        projectAssets
      })
    ).toEqual(['Assets/Images/hero.png', 'Assets/Videos/intro.mp4', 'Assets/Voices/bgm.mp3'])
  })

  it('falls back to workspace draggingAssetIds / draggingAsset when cross-panel dataTransfer custom MIME is empty', () => {
    const emptyTransfer: ChatDragTransferLike = { types: ['Files'], getData: () => '' }
    expect(
      isStudioAssetDragTransfer(emptyTransfer, imgAsset, [imgAsset.id, vidAsset.id, voiceAsset.id])
    ).toBe(true)
    expect(
      resolveDroppedChatAssetPaths({
        transfer: emptyTransfer,
        draggingAsset: imgAsset,
        draggingAssetIds: [imgAsset.id, vidAsset.id, voiceAsset.id],
        projectAssets
      })
    ).toEqual(['Assets/Images/hero.png', 'Assets/Videos/intro.mp4', 'Assets/Voices/bgm.mp3'])

    // Single draggingAsset fallback when IDs array is absent
    expect(
      resolveDroppedChatAssetPaths({
        transfer: emptyTransfer,
        draggingAsset: voiceAsset,
        draggingAssetIds: [],
        projectAssets: []
      })
    ).toEqual(['Assets/Voices/bgm.mp3'])

    // Single STUDIO_ASSET_ID_DRAG_MIME fallback
    const idOnlyTransfer = makeTransfer({ [STUDIO_ASSET_ID_DRAG_MIME]: vidAsset.id })
    expect(
      resolveDroppedChatAssetPaths({
        transfer: idOnlyTransfer,
        projectAssets
      })
    ).toEqual(['Assets/Videos/intro.mp4'])
  })

  it('validates dragover acceptance accurately for media assets, non-media studio drags, plain text drags, and external files', () => {
    // Media studio drag -> accept
    expect(
      canAcceptChatDropTransfer({
        transfer: { types: [STUDIO_ASSET_DRAG_MIME] },
        draggingAsset: vidAsset,
        draggingAssetIds: [vidAsset.id],
        projectAssets
      })
    ).toBe(true)

    // Non-media studio drag (e.g., canvas) -> reject highlight
    expect(
      canAcceptChatDropTransfer({
        transfer: { types: [STUDIO_ASSET_DRAG_MIME] },
        draggingAsset: canvasAsset,
        draggingAssetIds: [canvasAsset.id],
        projectAssets
      })
    ).toBe(false)

    // Plain text selection drag inside composer -> do not intercept
    expect(
      canAcceptChatDropTransfer({
        transfer: { types: ['text/plain', 'text/html'] },
        projectAssets
      })
    ).toBe(false)

    // External OS media file -> accept
    expect(
      canAcceptChatDropTransfer({
        transfer: {
          types: ['Files'],
          items: [{ kind: 'file', type: 'audio/mpeg' }]
        },
        projectAssets
      })
    ).toBe(true)

    // External OS unsupported non-media file -> reject
    expect(
      canAcceptChatDropTransfer({
        transfer: {
          types: ['Files'],
          items: [{ kind: 'file', type: 'application/pdf' }]
        },
        projectAssets
      })
    ).toBe(false)
  })

  it('infers media asset types and external drop output directories for image, video, and voice', () => {
    expect(inferChatMediaAssetType('Assets/Images/a.webp')).toBe('image')
    expect(inferChatMediaAssetType('Assets/Videos/clip.mov')).toBe('video')
    expect(inferChatMediaAssetType('Assets/Voices/narration.wav')).toBe('voice')
    expect(inferChatMediaAssetType('Assets/Models/mesh.glb')).toBe('model3d')

    expect(classifyDroppedExternalMediaFile({ name: 'a.png', type: 'image/png' })).toBe('image')
    expect(classifyDroppedExternalMediaFile({ name: 'b.mp4', type: 'video/mp4' })).toBe('video')
    expect(classifyDroppedExternalMediaFile({ name: 'c.wav', type: '' })).toBe('voice')
    expect(
      classifyDroppedExternalMediaFile({ name: 'doc.pdf', type: 'application/pdf' })
    ).toBeNull()

    expect(resolveChatDropOutputDir('image')).toBe('Assets/Images/Paste')
    expect(resolveChatDropOutputDir('video')).toBe('Assets/Videos/Drop')
    expect(resolveChatDropOutputDir('voice')).toBe('Assets/Voices/Drop')
  })
})
