import { describe, expect, it } from 'vitest'
import {
  applyShotParamsDropMaterialization,
  collectImagesFromVisualGraph,
  collectVideosFromShotWorkflowGraph,
  connectShotVideoReference,
  createDefaultScopedGraph,
  createNodeFromType,
  createShotParamsNodeForShot,
  findShotVisualImageNode,
  findShotWorkflowVideoNode,
  getVideoFrameAssetId,
  mergeVisualOutputGenRefs,
  materializeShotGenRefsOnVideoGraph,
  shotToImageAggregateRow,
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
  it('collects images from visual runStates output', () => {
    const doc = createDefaultScopedGraph('visual')
    const output = doc.nodes.find((n) => n.typeId === 'output.image')!
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

  it('collects videos from shotWorkflow runStates output', () => {
    const doc = createDefaultScopedGraph('shotWorkflow')
    const output = doc.nodes.find((n) => n.typeId === 'output.video')!
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

  it('prefers video output node over upstream generatedVideos', () => {
    const doc = createDefaultScopedGraph('shotWorkflow')
    const video = doc.nodes.find((n) => n.typeId === 'asset.video')!
    const output = doc.nodes.find((n) => n.typeId === 'output.video')!
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
      [output.id]: {
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
    expect(videos.map((item) => item.relativePath)).toEqual(['Output/videos/from-output.mp4'])
  })

  it('falls back to upstream video gens when video output is empty', () => {
    const doc = createDefaultScopedGraph('shotWorkflow')
    const videoA = doc.nodes.find((n) => n.typeId === 'asset.video')!
    const output = doc.nodes.find((n) => n.typeId === 'output.video')!
    const videoB = createNodeFromType('asset.video', { x: 100, y: 280 }, { id: 'video-gen-b' })
    doc.nodes.push(videoB)
    doc.edges.push({
      id: 'edge-vb-out',
      source: videoB.id,
      target: output.id,
      sourcePort: 'out',
      targetPort: 'in'
    })
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
    const videos = collectVideosFromShotWorkflowGraph(doc)
    expect(videos.map((item) => item.relativePath).sort()).toEqual([
      'Output/videos/from-a.mp4',
      'Output/videos/from-b.mp4'
    ])
  })

  it('falls back to asset.image generatedImages when output is empty', () => {
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
      ]
    }
    const images = collectImagesFromVisualGraph(doc)
    expect(images).toHaveLength(1)
    expect(images[0]?.relativePath).toBe('Assets/shots/from-gen.png')
  })

  it('prefers image output node over upstream generatedImages', () => {
    const doc = createDefaultScopedGraph('visual')
    const image = doc.nodes.find((n) => n.typeId === 'asset.image')!
    const output = doc.nodes.find((n) => n.typeId === 'output.image')!
    image.params = {
      ...image.params,
      generatedImages: [
        {
          id: IMG1,
          dataUrl: '',
          relativePath: 'Assets/shots/a.png',
          createdAt: new Date().toISOString()
        },
        {
          id: IMG2,
          dataUrl: '',
          relativePath: 'Assets/shots/b.png',
          createdAt: new Date().toISOString()
        }
      ]
    }
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

  it('collects merged images from image output when multiple gens are linked', () => {
    const doc = createDefaultScopedGraph('visual')
    const output = doc.nodes.find((n) => n.typeId === 'output.image')!
    const imageB = createNodeFromType('asset.image', { x: 100, y: 280 }, { id: 'image-gen-b' })
    doc.nodes.push(imageB)
    doc.edges.push({
      id: 'edge-b-out',
      source: imageB.id,
      target: output.id,
      sourcePort: 'out',
      targetPort: 'in'
    })
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

  it('falls back to upstream gens when image output is empty', () => {
    const doc = createDefaultScopedGraph('visual')
    const imageA = doc.nodes.find((n) => n.typeId === 'asset.image')!
    const output = doc.nodes.find((n) => n.typeId === 'output.image')!
    const imageB = createNodeFromType('asset.image', { x: 100, y: 280 }, { id: 'image-gen-b' })
    doc.nodes.push(imageB)
    doc.edges.push({
      id: 'edge-b-out',
      source: imageB.id,
      target: output.id,
      sourcePort: 'out',
      targetPort: 'in'
    })
    imageA.params = {
      ...imageA.params,
      generatedImages: [
        {
          id: IMG1,
          dataUrl: '',
          relativePath: 'Assets/shots/from-a.png',
          createdAt: new Date().toISOString()
        }
      ]
    }
    imageB.params = {
      ...imageB.params,
      generatedImages: [
        {
          id: IMG2,
          dataUrl: '',
          relativePath: 'Assets/shots/from-b.png',
          createdAt: new Date().toISOString()
        }
      ]
    }
    const images = collectImagesFromVisualGraph(doc)
    expect(images.map((item) => item.relativePath).sort()).toEqual([
      'Assets/shots/from-a.png',
      'Assets/shots/from-b.png'
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

  it('materializes first image as first frame and rest as references', () => {
    let graph = createDefaultScopedGraph('shotWorkflow')
    graph = materializeShotGenRefsOnVideoGraph(graph, [
      { id: IMG1, type: 'image', name: 'A' },
      { id: IMG2, type: 'image', name: 'B' }
    ])
    expect(getVideoFrameAssetId(graph, VIDEO_FIRST_FRAME_PORT_ID)).toBe(IMG1)
    const video = findShotWorkflowVideoNode(graph)!
    const imageSources = graph.edges
      .filter((e) => e.target === video.id && e.targetPort === 'in-image')
      .map((e) => graph.nodes.find((n) => n.id === e.source)?.assetId)
    expect(imageSources).toContain(IMG2)
  })

  it('drag materialization creates image refs and links shotParams text', () => {
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
    expect(getVideoFrameAssetId(graph, VIDEO_FIRST_FRAME_PORT_ID)).toBe(IMG1)
    expect(graph.nodes.some((n) => n.assetId === IMG2 && n.params.assetRef === true)).toBe(true)
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
