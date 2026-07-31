import { describe, expect, it } from 'vitest'
import {
  applyShotParamsDropMaterialization,
  collectImagesFromVisualGraph,
  collectVideosFromShotWorkflowGraph,
  collectVideosFromVideoGenNodes,
  connectShotVideoReference,
  createDefaultScopedGraph,
  createNodeFromType,
  createShotParamsNodeForShot,
  findShotVisualImageNode,
  findShotWorkflowVideoNode,
  getVideoFrameAssetId,
  listImageAssetsFromShotEntity,
  mergeVisualOutputGenRefs,
  isShotEntitiesSelectNode,
  materializeShotGenRefsOnVideoGraph,
  materializeShotBoundEntityRefsOnGraph,
  parseShotEntities,
  GraphPortType,
  parseVideoEntities,
  runGraph,
  shotToImageAggregateRow,
  stringifyShotEntities,
  stringifyVideoEntities,
  VIDEO_FIRST_FRAME_PORT_ID
} from '../src/shared/graph'
import { createEmptyShot, type Shot } from '../src/shared/domain'
import { ensureBuiltinNodeTypes } from '../src/shared/graph/builtinState'

ensureBuiltinNodeTypes()

const IMG1 = '11111111-1111-4111-8111-111111111101'
const IMG2 = '22222222-2222-4222-8222-222222222202'
const KEEP = '33333333-3333-4333-8333-333333333303'

function shotWithId(id: string, patch?: Partial<Shot>): Shot {
  return {
    ...createEmptyShot('Test'),
    id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...patch
  }
}

describe('shot visual bridge', () => {
  it('collects images from visual asset.image runStates', () => {
    const doc = createDefaultScopedGraph('visual')
    const output = doc.nodes.find((n) => n.typeId === 'asset.image')!
    doc.runStates = {
      [output.id]: {
        status: 'done',
        outputs: {
          out: {
            kind: 'output',
            outputKind: 'image',
            images: [
              {
                id: 'img-1',
                dataUrl: '',
                relativePath: 'Assets/shots/a.png'
              }
            ]
          }
        }
      }
    }
    const images = collectImagesFromVisualGraph(doc)
    expect(images).toHaveLength(1)
    expect(images[0]?.relativePath).toBe('Assets/shots/a.png')
  })

  it('collects videos from shotWorkflow asset.video runStates', () => {
    const doc = createDefaultScopedGraph('shotWorkflow')
    const output = doc.nodes.find((n) => n.typeId === 'asset.video')!
    doc.runStates = {
      [output.id]: {
        status: 'done',
        outputs: {
          out: {
            kind: 'videos',
            items: [
              {
                id: 'vid-1',
                relativePath: 'Output/videos/a.mp4'
              }
            ]
          }
        }
      }
    }
    const videos = collectVideosFromShotWorkflowGraph(doc)
    expect(videos).toHaveLength(1)
    expect(videos[0]?.relativePath).toBe('Output/videos/a.mp4')
  })

  it('does not treat image preview on video boundary as completed video', () => {
    const doc = createDefaultScopedGraph('shotWorkflow')
    const bout = doc.nodes.find((n) => n.typeId === 'graph.boundary.output')!
    bout.params = {
      ...bout.params,
      previewRelativePath: 'Cache/Images/shot-thumb.jpg'
    }
    expect(collectVideosFromShotWorkflowGraph(doc)).toEqual([])
  })

  it('prefers generatedVideos params over runStates output', () => {
    const doc = createDefaultScopedGraph('shotWorkflow')
    const video = doc.nodes.find((n) => n.typeId === 'asset.video')!
    video.params = {
      ...video.params,
      generatedVideos: [
        {
          id: 'v-a',
          relativePath: 'Output/videos/from-gen.mp4',
          createdAt: new Date().toISOString()
        }
      ]
    }
    doc.runStates = {
      [video.id]: {
        status: 'done',
        outputs: {
          out: {
            kind: 'videos',
            items: [{ id: 'v-out', relativePath: 'Output/videos/from-output.mp4' }]
          }
        }
      }
    }
    const videos = collectVideosFromShotWorkflowGraph(doc)
    expect(videos.map((item) => item.relativePath)).toEqual(['Output/videos/from-gen.mp4'])
  })

  it('collects all done video gen nodes', () => {
    const doc = createDefaultScopedGraph('shotWorkflow')
    const videoA = doc.nodes.find((n) => n.typeId === 'asset.video')!
    const videoB = createNodeFromType('asset.video', { x: 100, y: 280 }, { id: 'video-gen-b' })
    doc.nodes.push(videoB)
    videoA.params = {
      ...videoA.params,
      generatedVideos: [
        {
          id: 'v-a',
          relativePath: 'Output/videos/from-a.mp4',
          createdAt: new Date().toISOString()
        }
      ]
    }
    videoB.params = {
      ...videoB.params,
      generatedVideos: [
        {
          id: 'v-b',
          relativePath: 'Output/videos/from-b.mp4',
          createdAt: new Date().toISOString()
        }
      ]
    }
    doc.runStates = {
      [videoA.id]: { status: 'done', outputs: {} },
      [videoB.id]: { status: 'done', outputs: {} }
    }
    const videos = collectVideosFromVideoGenNodes(doc)
    expect(videos.map((item) => item.relativePath).sort()).toEqual([
      'Output/videos/from-a.mp4',
      'Output/videos/from-b.mp4'
    ])
  })

  it('falls back to asset.video runStates when generatedVideos are absent', () => {
    const doc = createDefaultScopedGraph('shotWorkflow')
    const video = doc.nodes.find((n) => n.typeId === 'asset.video')!
    doc.runStates = {
      [video.id]: {
        status: 'done',
        outputs: {
          out: {
            kind: 'videos',
            items: [{ id: 'v-out', relativePath: 'Output/videos/from-output.mp4' }]
          }
        }
      }
    }
    expect(collectVideosFromVideoGenNodes(doc).map((item) => item.relativePath)).toEqual([
      'Output/videos/from-output.mp4'
    ])
    expect(collectVideosFromShotWorkflowGraph(doc).map((item) => item.relativePath)).toEqual([
      'Output/videos/from-output.mp4'
    ])
  })

  it('skips incomplete boundary when upstream has no usable image', () => {
    const doc = createDefaultScopedGraph('visual')
    const image = doc.nodes.find((n) => n.typeId === 'asset.image')!
    doc.runStates = {
      [image.id]: {
        status: 'running',
        outputs: {}
      }
    }
    expect(collectImagesFromVisualGraph(doc)).toEqual([])
  })

  it('soft-collects boundary from upstream gallery even when gen is still running', () => {
    const doc = createDefaultScopedGraph('visual')
    const image = doc.nodes.find((n) => n.typeId === 'asset.image')!
    image.params = {
      ...image.params,
      generatedImages: [
        {
          id: IMG1,
          dataUrl: '',
          relativePath: 'Assets/shots/from-gen.png',
          createdAt: new Date().toISOString()
        }
      ],
      selectedImageId: IMG1
    }
    doc.runStates = {
      [image.id]: {
        status: 'running',
        outputs: {}
      }
    }
    expect(collectImagesFromVisualGraph(doc).map((item) => item.relativePath)).toEqual([
      'Assets/shots/from-gen.png'
    ])
  })

  it('collects only done image result node runStates via boundary', () => {
    const doc = createDefaultScopedGraph('visual')
    const output = doc.nodes.find((n) => n.typeId === 'asset.image')!
    doc.runStates = {
      [output.id]: {
        status: 'done',
        outputs: {
          out: {
            kind: 'output',
            outputKind: 'image',
            images: [{ id: IMG2, dataUrl: '', relativePath: 'Assets/shots/b.png' }]
          }
        }
      }
    }
    const images = collectImagesFromVisualGraph(doc)
    expect(images.map((item) => item.relativePath)).toEqual(['Assets/shots/b.png'])
  })

  it('collects merged images from an asset.image runState via boundary', () => {
    const doc = createDefaultScopedGraph('visual')
    const output = doc.nodes.find((n) => n.typeId === 'asset.image')!
    doc.runStates = {
      [output.id]: {
        status: 'done',
        outputs: {
          out: {
            kind: 'output',
            outputKind: 'image',
            images: [
              { id: IMG1, dataUrl: '', relativePath: 'Assets/shots/from-a.png' },
              { id: IMG2, dataUrl: '', relativePath: 'Assets/shots/from-b.png' }
            ]
          }
        }
      }
    }
    const images = collectImagesFromVisualGraph(doc)
    expect(images.map((item) => item.relativePath)).toEqual([
      'Assets/shots/from-a.png',
      'Assets/shots/from-b.png'
    ])
  })

  it('soft-collects primary boundary upstream gallery without requiring runStates done', () => {
    const doc = createDefaultScopedGraph('visual')
    const imageA = doc.nodes.find((n) => n.typeId === 'asset.image')!
    imageA.params = {
      ...imageA.params,
      generatedImages: [
        {
          id: IMG1,
          dataUrl: '',
          relativePath: 'Assets/shots/from-a.png',
          createdAt: new Date().toISOString()
        }
      ],
      selectedImageId: IMG1
    }
    expect(collectImagesFromVisualGraph(doc).map((item) => item.relativePath)).toEqual([
      'Assets/shots/from-a.png'
    ])
  })

  it('merges visual output assets into style genRefs', () => {
    const next = mergeVisualOutputGenRefs(
      [{ role: 'character', assetId: KEEP, refIndex: 1 }],
      [IMG1, IMG2],
      'style'
    )
    expect(next.some((r) => r.assetId === KEEP && r.role === 'character')).toBe(true)
    expect(next.filter((r) => r.role === 'style').map((r) => r.assetId)).toEqual([IMG1, IMG2])
  })

  it('creates image refs and connects them to video in-image', () => {
    let graph = createDefaultScopedGraph('shotWorkflow')
    graph = materializeShotGenRefsOnVideoGraph(graph, [
      { id: IMG1, type: 'image', name: 'A' },
      { id: IMG2, type: 'image', name: 'B' }
    ])
    const video = findShotWorkflowVideoNode(graph)!
    expect(getVideoFrameAssetId(graph, VIDEO_FIRST_FRAME_PORT_ID)).toBeNull()
    const refs = graph.nodes.filter((n) => n.assetId === IMG1 || n.assetId === IMG2)
    expect(refs).toHaveLength(2)
    expect(refs[0]?.position.y).not.toBe(refs[1]?.position.y)
    const imageSources = graph.edges
      .filter((e) => e.target === video.id && e.targetPort === 'in-image')
      .map((e) => graph.nodes.find((n) => n.id === e.source)?.assetId)
    expect(imageSources).toEqual(expect.arrayContaining([IMG1, IMG2]))
  })

  it('drag materialization creates image refs, links shotParams text and video in-image', () => {
    const shot = shotWithId('shot-1', {
      genRefs: [
        { role: 'style', assetId: IMG1, refIndex: 1 },
        { role: 'style', assetId: IMG2, refIndex: 2 }
      ]
    })
    let graph = createDefaultScopedGraph('shotWorkflow')
    const params = createShotParamsNodeForShot(shot, { x: 40, y: 40 })
    graph.nodes.push(params)
    graph = applyShotParamsDropMaterialization(graph, params, shot, (id) => ({
      id,
      type: 'image',
      name: id
    }))
    const video = findShotWorkflowVideoNode(graph)!
    expect(
      graph.edges.some(
        (e) =>
          e.source === params.id && e.target === video.id && e.targetPort === 'in-text'
      )
    ).toBe(true)
    expect(getVideoFrameAssetId(graph, VIDEO_FIRST_FRAME_PORT_ID)).toBeNull()
    const refs = graph.nodes.filter(
      (n) => (n.assetId === IMG1 || n.assetId === IMG2) && n.params.assetRef === true
    )
    expect(refs).toHaveLength(2)
    expect(refs[0]?.position.y).not.toBe(refs[1]?.position.y)
    const imageSources = graph.edges
      .filter((e) => e.target === video.id && e.targetPort === 'in-image')
      .map((e) => graph.nodes.find((n) => n.id === e.source)?.assetId)
    expect(imageSources).toEqual(expect.arrayContaining([IMG1, IMG2]))
  })

  it('listImageAssetsFromShotEntity prefers style genRefs then entity urls', () => {
    const shot = shotWithId('shot-entity-1', {
      genRefs: [
        { role: 'character', assetId: KEEP, refIndex: 1 },
        { role: 'style', assetId: IMG1, refIndex: 2 }
      ]
    })
    const fromStyle = listImageAssetsFromShotEntity(shot, (id) => ({
      id,
      type: 'image',
      name: id
    }))
    expect(fromStyle.map((a) => a.id)).toEqual([IMG1])

    const shotNoStyle = shotWithId('shot-entity-2', {
      genRefs: [{ role: 'character', assetId: KEEP, refIndex: 1 }]
    })
    const fromUrls = listImageAssetsFromShotEntity(
      shotNoStyle,
      (id) => ({ id, type: 'image', name: id }),
      {
        entityImageUrls: ['Assets/shots/from-entity.png'],
        resolveAssetByRelativePath: (path) =>
          path === 'Assets/shots/from-entity.png'
            ? { id: IMG2, type: 'image', name: 'E', relativePath: path }
            : null
      }
    )
    expect(fromUrls.map((a) => a.id)).toEqual([IMG2])
  })

  it('visual drag materialization links shotParams and genRefs to asset.image', () => {
    const shot = shotWithId('shot-visual-1', {
      genRefs: [
        { role: 'style', assetId: IMG1, refIndex: 1 },
        { role: 'style', assetId: IMG2, refIndex: 2 }
      ]
    })
    let graph = createDefaultScopedGraph('visual')
    const params = createShotParamsNodeForShot(shot, { x: 40, y: 40 })
    graph.nodes.push(params)
    graph = applyShotParamsDropMaterialization(
      graph,
      params,
      shot,
      (id) => ({ id, type: 'image', name: id }),
      'image'
    )
    const image = findShotVisualImageNode(graph)!
    expect(
      graph.edges.some(
        (e) =>
          e.source === params.id && e.target === image.id && e.targetPort === 'in-text'
      )
    ).toBe(true)
    const imageSources = graph.edges
      .filter((e) => e.target === image.id && e.targetPort === 'in-image')
      .map((e) => graph.nodes.find((n) => n.id === e.source)?.assetId)
    expect(imageSources).toEqual(expect.arrayContaining([IMG1, IMG2]))
  })

  it('materializes storyboard binding images onto visual graph', () => {
    const shot = shotWithId('shot-bind-visual', {
      storyboard: {
        visualDescription: '',
        shotSize: '',
        lighting: '',
        dialogue: '',
        soundFx: '',
        cameraMove: '',
        finalPrompt: '',
        characters: [{ name: '老人', type: '角色', imageUrl: 'Assets/chars/old-man.png' }],
        scenes: [{ name: '公园', type: '场景', imageUrl: 'Assets/scenes/park.png' }],
        props: [{ name: '旧书', type: '道具', imageUrl: 'Assets/props/book.png' }],
        weapons: []
      }
    })
    const assetsByPath: Record<string, { id: string; type: 'image'; name: string; relativePath: string }> = {
      'Assets/chars/old-man.png': {
        id: IMG1,
        type: 'image',
        name: '老人',
        relativePath: 'Assets/chars/old-man.png'
      },
      'Assets/scenes/park.png': {
        id: IMG2,
        type: 'image',
        name: '公园',
        relativePath: 'Assets/scenes/park.png'
      },
      'Assets/props/book.png': {
        id: KEEP,
        type: 'image',
        name: '旧书',
        relativePath: 'Assets/props/book.png'
      }
    }
    let graph = createDefaultScopedGraph('visual')
    graph = materializeShotBoundEntityRefsOnGraph(
      graph,
      shot,
      'image',
      () => null,
      { resolveAssetByRelativePath: (path) => assetsByPath[path] ?? null }
    )
    const image = findShotVisualImageNode(graph)!
    const refs = graph.edges
      .filter((e) => e.target === image.id && e.targetPort === 'in-image')
      .map((e) => graph.nodes.find((n) => n.id === e.source))
    expect(refs).toHaveLength(3)
    expect(refs.every((n) => n?.typeId === 'graph.boundary.input')).toBe(true)
    expect(refs.map((n) => n?.title).sort()).toEqual(['公园', '旧书', '老人'])
    expect(refs.map((n) => n?.params.previewRelativePath).sort()).toEqual([
      'Assets/chars/old-man.png',
      'Assets/props/book.png',
      'Assets/scenes/park.png'
    ])
  })

  it('materializes cache-only binding images as boundary image inputs', async () => {
    const rel = 'Cache/Images/新建剧集世界元素_年轻女子_20260728-183159584.png'
    const shot = shotWithId('shot-bind-cache', {
      storyboard: {
        visualDescription: '',
        shotSize: '',
        lighting: '',
        dialogue: '',
        soundFx: '',
        cameraMove: '',
        finalPrompt: '',
        characters: [{ name: '年轻女子', type: '角色', imageUrl: rel }],
        scenes: [],
        props: [],
        weapons: []
      }
    })
    let graph = createDefaultScopedGraph('visual')
    graph = materializeShotBoundEntityRefsOnGraph(graph, shot, 'image', () => null, {
      resolveAssetByRelativePath: () => null
    })
    const image = findShotVisualImageNode(graph)!
    const ref = graph.nodes.find(
      (n) =>
        n.typeId === 'graph.boundary.input' &&
        n.params.hostBoundaryPort?.dataType === 'image' &&
        n.params.previewRelativePath === rel
    )
    expect(ref, 'boundary image input').toBeDefined()
    expect(ref!.title).toBe('年轻女子')
    expect(
      graph.edges.some(
        (e) => e.source === ref!.id && e.target === image.id && e.targetPort === 'in-image'
      )
    ).toBe(true)

    // 再次物化不重复建节点
    const again = materializeShotBoundEntityRefsOnGraph(graph, shot, 'image', () => null, {
      resolveAssetByRelativePath: () => null
    })
    expect(
      again.nodes.filter((n) => n.params.previewRelativePath === rel)
    ).toHaveLength(1)

    // 边界输入执行时直接输出该图路径
    const result = await runGraph(
      { nodes: [ref!], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
      {
        stepDelayMs: 1,
        targetNodeId: ref!.id
      }
    )
    expect(result.ok, result.error).toBe(true)
    expect(result.states[ref!.id]?.outputs?.out).toMatchObject({
      kind: 'image',
      relativePath: rel
    })
  })

  it('materializes storyboard binding images onto video graph', () => {
    const shot = shotWithId('shot-bind-video', {
      storyboard: {
        visualDescription: '',
        shotSize: '',
        lighting: '',
        dialogue: '',
        soundFx: '',
        cameraMove: '',
        finalPrompt: '',
        characters: [{ name: '女子', type: '角色', imageUrl: 'Assets/chars/woman.png' }],
        scenes: [],
        props: [],
        weapons: []
      }
    })
    let graph = createDefaultScopedGraph('shotWorkflow')
    graph = materializeShotBoundEntityRefsOnGraph(
      graph,
      shot,
      'video',
      () => null,
      {
        resolveAssetByRelativePath: (path) =>
          path === 'Assets/chars/woman.png'
            ? { id: IMG1, type: 'image', name: '女子', relativePath: path }
            : null
      }
    )
    const video = findShotWorkflowVideoNode(graph)!
    const source = graph.nodes.find(
      (n) =>
        n.typeId === 'graph.boundary.input' &&
        n.params.previewRelativePath === 'Assets/chars/woman.png'
    )
    expect(source?.title).toBe('女子')
    expect(
      graph.edges.some(
        (e) =>
          e.source === source?.id &&
          e.target === video.id &&
          e.targetPort === 'in-image'
      )
    ).toBe(true)
  })

  it('video boundary inputs include shot thumbnail and entity bindings', () => {
    const shot = shotWithId('shot-thumb-first', {
      title: '客厅建置',
      thumbnailPath: 'Cache/Images/shot-final-with-person.jpg',
      storyboard: {
        visualDescription: '',
        shotSize: '',
        lighting: '',
        dialogue: '',
        soundFx: '',
        cameraMove: '',
        finalPrompt: '',
        characters: [],
        scenes: [
          {
            name: '老旧公寓客厅',
            type: '场景',
            imageUrl: 'Cache/Images/world-empty-room.jpg'
          }
        ],
        props: [],
        weapons: []
      }
    })
    let graph = createDefaultScopedGraph('shotWorkflow')
    graph = materializeShotBoundEntityRefsOnGraph(graph, shot, 'video', () => null, {
      entityImageUrls: ['Cache/Images/world-empty-room.jpg']
    })
    const paths = graph.nodes
      .filter((n) => n.typeId === 'graph.boundary.input')
      .map((n) => n.params.previewRelativePath)
    expect(paths).toEqual([
      'Cache/Images/shot-final-with-person.jpg',
      'Cache/Images/world-empty-room.jpg'
    ])
    const video = findShotWorkflowVideoNode(graph)!
    expect(
      graph.edges.some(
        (e) =>
          e.target === video.id &&
          e.targetPort === 'in-image' &&
          graph.nodes.some(
            (n) =>
              n.id === e.source &&
              n.params.previewRelativePath === 'Cache/Images/shot-final-with-person.jpg'
          )
      )
    ).toBe(true)
    expect(
      graph.edges.some(
        (e) =>
          e.target === video.id &&
          e.targetPort === 'in-image' &&
          graph.nodes.some(
            (n) =>
              n.id === e.source &&
              n.params.previewRelativePath === 'Cache/Images/world-empty-room.jpg'
          )
      )
    ).toBe(true)
  })

  it('video merges upper shotEntities with storyboard bindings when no thumbnail/style', () => {
    const shot = shotWithId('shot-upper-entities', {
      storyboard: {
        visualDescription: '',
        shotSize: '',
        lighting: '',
        dialogue: '',
        soundFx: '',
        cameraMove: '',
        finalPrompt: '',
        characters: [{ name: '旧图', type: '角色', imageUrl: 'Assets/chars/old.png' }],
        scenes: [],
        props: [],
        weapons: []
      }
    })
    let graph = createDefaultScopedGraph('shotWorkflow')
    graph = materializeShotBoundEntityRefsOnGraph(graph, shot, 'video', () => null, {
      entityImageUrls: ['Cache/Images/from-shot-image-gen.png']
    })
    const paths = graph.nodes
      .filter((n) => n.typeId === 'graph.boundary.input')
      .map((n) => n.params.previewRelativePath)
      .sort()
    expect(paths).toEqual([
      'Assets/chars/old.png',
      'Cache/Images/from-shot-image-gen.png'
    ])
  })

  it('video dual-path: shotEntities catalog + select, current-shot images wire to video', () => {
    const shot = shotWithId('shot-a', {
      title: '镜1',
      thumbnailPath: 'Cache/Images/shot-thumb.jpg',
      storyboard: {
        visualDescription: '',
        shotSize: '',
        lighting: '',
        dialogue: '',
        soundFx: '',
        cameraMove: '',
        finalPrompt: '',
        characters: [{ name: '角色甲', type: '角色', imageUrl: 'Cache/Images/char-a.png' }],
        scenes: [],
        props: [],
        weapons: []
      }
    })
    let graph = createDefaultScopedGraph('shotWorkflow')
    graph = materializeShotBoundEntityRefsOnGraph(graph, shot, 'video', () => null, {
      shotEntitiesCatalog: [
        { id: 'shot-a', name: '镜A', imageUrls: ['Cache/Images/ent-a.png'] },
        { id: 'shot-b', name: '镜B', imageUrls: ['Cache/Images/ent-b.png'] }
      ],
      wireShotEntitiesToSelect: true,
      selectNodeTitle: '选择分镜实体',
      entityImageUrls: ['Cache/Images/ent-a.png']
    })
    const video = findShotWorkflowVideoNode(graph)!
    const catalogBounds = graph.nodes.filter(
      (n) =>
        n.typeId === 'graph.boundary.input' &&
        n.params.hostBoundaryPort?.dataType === GraphPortType.shotEntities
    )
    expect(catalogBounds).toHaveLength(1)
    expect(catalogBounds[0]?.title).toBe('分镜实体')
    expect(parseShotEntities(catalogBounds[0]?.params.text)).toHaveLength(2)
    const picker = graph.nodes.find((n) => isShotEntitiesSelectNode(n))
    expect(picker?.title).toBe('选择分镜实体')
    expect(
      graph.edges.some(
        (e) =>
          e.source === catalogBounds[0]?.id &&
          e.target === picker?.id &&
          (e.targetPort ?? 'in') === 'in'
      )
    ).toBe(true)
    expect(
      graph.edges.some(
        (e) =>
          e.source === catalogBounds[0]?.id &&
          e.target === video.id &&
          e.targetPort === 'in-image'
      )
    ).toBe(false)
    expect(graph.edges.some((e) => e.source === picker?.id && e.target === video.id)).toBe(false)

    const boundImage = graph.nodes.find(
      (n) =>
        n.typeId === 'graph.boundary.input' &&
        n.params.hostBoundaryPort?.dataType === GraphPortType.image &&
        n.params.previewRelativePath === 'Cache/Images/ent-a.png'
    )
    const thumb = graph.nodes.find(
      (n) => n.params.previewRelativePath === 'Cache/Images/shot-thumb.jpg'
    )
    expect(boundImage).toBeDefined()
    expect(
      graph.edges.some(
        (e) => e.source === boundImage?.id && e.target === video.id && e.targetPort === 'in-image'
      )
    ).toBe(true)
    expect(
      graph.edges.some(
        (e) => e.source === thumb?.id && e.target === video.id && e.targetPort === 'in-image'
      )
    ).toBe(true)
  })

  it('aggregate row includes imageAssetIds from genRefs', () => {
    const shot = shotWithId('shot-2', {
      title: 'Rain',
      genRefs: [{ role: 'style', assetId: IMG1, refIndex: 1 }]
    })
    const row = shotToImageAggregateRow(shot, 0)
    expect(row.title).toBe('Rain')
    expect(row.imageAssetIds).toEqual([IMG1])
  })
})

describe('connectShotVideoReference still works', () => {
  it('links image ref to video in-image', () => {
    let graph = createDefaultScopedGraph('shotWorkflow')
    graph = connectShotVideoReference(graph, {
      id: IMG1,
      type: 'image',
      name: 'Ref'
    })
    const video = findShotWorkflowVideoNode(graph)!
    expect(
      graph.edges.some((e) => e.target === video.id && e.targetPort === 'in-image')
    ).toBe(true)
    expect(graph.nodes.some((n) => n.assetId === IMG1)).toBe(true)
  })
})

describe('shot entities catalog', () => {
  it('round-trips shot entity results', () => {
    const text = stringifyShotEntities([
      { id: 's1', name: '镜A', imageUrls: ['Assets/a.png', 'Assets/b.png'] }
    ])
    expect(parseShotEntities(text)).toEqual([
      { id: 's1', name: '镜A', imageUrls: ['Assets/a.png', 'Assets/b.png'] }
    ])
    expect(parseShotEntities('[{"id":"x","name":"Y","imageUrls":[]}]')).toEqual([])
  })
})

describe('video entities catalog', () => {
  it('round-trips video entity results', () => {
    const text = stringifyVideoEntities([
      { id: 's1', name: '镜A', videoUrls: ['Output/a.mp4', 'Output/b.mp4'] }
    ])
    expect(parseVideoEntities(text)).toEqual([
      { id: 's1', name: '镜A', videoUrls: ['Output/a.mp4', 'Output/b.mp4'] }
    ])
    expect(parseVideoEntities('[{"id":"x","name":"Y","videos":["Output/c.mp4"]}]')).toEqual([
      { id: 'x', name: 'Y', videoUrls: ['Output/c.mp4'] }
    ])
    expect(parseVideoEntities('[{"id":"x","name":"Y","videoUrls":[]}]')).toEqual([])
  })
})
