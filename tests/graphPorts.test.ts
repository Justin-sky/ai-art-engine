import { describe, expect, it } from 'vitest'
import {
  canConnectNodes,
  createAssetGraphNode,
  createNodeFromType,
  getNodePorts,
  GRAPH_PORT_DATA_TYPES,
  GraphPortType,
  isGraphPortDataType
} from '../src/shared/graph'

describe('GraphPortType', () => {
  it('exposes the basic port types as a single source of truth', () => {
    expect(GRAPH_PORT_DATA_TYPES).toEqual([
      GraphPortType.image,
      GraphPortType.images,
      GraphPortType.voice,
      GraphPortType.voices,
      GraphPortType.video,
      GraphPortType.videos,
      GraphPortType.text,
      GraphPortType.texts,
      GraphPortType.model
    ])
    expect(isGraphPortDataType('image')).toBe(true)
    expect(isGraphPortDataType('videos')).toBe(true)
    expect(isGraphPortDataType('texts')).toBe(true)
    expect(isGraphPortDataType('voices')).toBe(true)
    expect(isGraphPortDataType('camera')).toBe(false)
  })
})

describe('asset reference ports', () => {
  const dragTypes = [
    'screenplay',
    'motion',
    'image',
    'video',
    'voice'
  ] as const

  const dragGuids: Record<(typeof dragTypes)[number], string> = {
    screenplay: '00000000-0000-4000-8000-000000000001',
    motion: '00000000-0000-4000-8000-000000000002',
    image: '00000000-0000-4000-8000-000000000003',
    video: '00000000-0000-4000-8000-000000000004',
    voice: '00000000-0000-4000-8000-000000000005'
  }

  for (const type of dragTypes) {
    it(`${type} drag node has only output port`, () => {
      const node = createAssetGraphNode(dragGuids[type], type, type, { x: 0, y: 0 })
      const ports = getNodePorts(node)
      expect(ports.every((p) => p.direction === 'out')).toBe(true)
      expect(ports.length).toBeGreaterThan(0)
    })
  }
})

describe('port type matching', () => {
  const playScript = createNodeFromType('play.script', { x: 0, y: 0 })

  it('connects play.script (text) to screenplay processing', () => {
    const screenplay = createNodeFromType('asset.screenplay', { x: 100, y: 0 })
    const motion = createNodeFromType('asset.motion', { x: 100, y: 80 })
    expect(canConnectNodes(playScript, screenplay)).toBe(true)
    expect(canConnectNodes(playScript, motion, { targetPort: 'in-text' })).toBe(false)
  })

  it('connects play.script (text) to audio processing text input', () => {
    const processing = createNodeFromType('asset.voice', { x: 100, y: 0 })
    expect(canConnectNodes(playScript, processing)).toBe(true)
    expect(canConnectNodes(playScript, processing, { targetPort: 'in-text' })).toBe(true)
  })

  it('connects image ref to audio processing image input', () => {
    const processing = createNodeFromType('asset.voice', { x: 100, y: 0 })
    const imageRef = createAssetGraphNode(
      '00000000-0000-4000-8000-000000000031',
      'image',
      'Img',
      { x: 0, y: 0 }
    )
    expect(canConnectNodes(imageRef, processing)).toBe(true)
    expect(canConnectNodes(imageRef, processing, { targetPort: 'in-image' })).toBe(true)
  })

  it('connects play.script (text) to image generate text input', () => {
    const image = createNodeFromType('asset.image', { x: 100, y: 0 })
    expect(canConnectNodes(playScript, image)).toBe(true)
    expect(canConnectNodes(playScript, image, { targetPort: 'in-text' })).toBe(true)
  })

  it('connects play.script (text) to video generate text input', () => {
    const video = createNodeFromType('asset.video', { x: 100, y: 0 })
    expect(canConnectNodes(playScript, video)).toBe(true)
    expect(canConnectNodes(playScript, video, { targetPort: 'in-text' })).toBe(true)
  })

  it('connects image, video and audio refs to video generate inputs', () => {
    const video = createNodeFromType('asset.video', { x: 100, y: 0 })
    const imageRef = createAssetGraphNode(
      '00000000-0000-4000-8000-000000000021',
      'image',
      'Img',
      { x: 0, y: 0 }
    )
    const videoRef = createAssetGraphNode(
      '00000000-0000-4000-8000-000000000022',
      'video',
      'Vid',
      { x: 0, y: 40 }
    )
    const timbreRef = createAssetGraphNode(
      '00000000-0000-4000-8000-000000000023',
      'voice',
      'voice',
      { x: 0, y: 80 }
    )
    expect(canConnectNodes(imageRef, video)).toBe(true)
    expect(canConnectNodes(videoRef, video)).toBe(true)
    expect(canConnectNodes(timbreRef, video)).toBe(true)
    expect(canConnectNodes(imageRef, video, { targetPort: 'in-image' })).toBe(true)
    expect(canConnectNodes(videoRef, video, { targetPort: 'in-video' })).toBe(true)
    expect(canConnectNodes(timbreRef, video, { targetPort: 'in-voice' })).toBe(true)
  })

  it('screenplay processing accepts play.script and screenplay asset refs', () => {
    const screenplay = createNodeFromType('asset.screenplay', { x: 100, y: 0 })
    const screenplayRef = createAssetGraphNode(
      '00000000-0000-4000-8000-000000000301',
      'screenplay',
      'Script',
      { x: 0, y: 0 }
    )
    expect(canConnectNodes(playScript, screenplay)).toBe(true)
    expect(canConnectNodes(screenplayRef, screenplay)).toBe(true)
  })

  it('screenplay generate outputs texts and screenplay output accepts texts without out port', () => {
    const screenplay = createNodeFromType('asset.screenplay', { x: 100, y: 0 })
    const screenplayRef = createAssetGraphNode(
      '00000000-0000-4000-8000-000000000302',
      'screenplay',
      'Script',
      { x: 0, y: 0 }
    )
    const screenplayOut = createNodeFromType('output.text', { x: 200, y: 0 })
    expect(getNodePorts(screenplay).map((p) => [p.direction, p.dataType])).toEqual([
      ['in', GraphPortType.text],
      ['out', GraphPortType.texts]
    ])
    expect(getNodePorts(screenplayRef).map((p) => [p.direction, p.dataType])).toEqual([
      ['out', GraphPortType.text]
    ])
    expect(getNodePorts(screenplayOut).map((p) => [p.direction, p.dataType])).toEqual([
      ['in', GraphPortType.texts]
    ])
    expect(canConnectNodes(screenplay, screenplayOut)).toBe(true)
    // 引用仍为单文本，不能直接连剧本输出（文本数组）
    expect(canConnectNodes(screenplayRef, screenplayOut)).toBe(false)
  })

  it('same media types connect', () => {
    const imageRef = createAssetGraphNode('00000000-0000-4000-8000-000000000301', 'image', 'Img', {
      x: 0,
      y: 0
    })
    const imageGenerate = createNodeFromType('asset.image', { x: 100, y: 0 })
    const imageOut = createNodeFromType('output.image', { x: 200, y: 0 })
    // 引用：单图；生成：文本+图片入口 / 出数组；图片输出：入数组
    expect(getNodePorts(imageRef).map((p) => [p.direction, p.dataType])).toEqual([
      ['out', GraphPortType.image]
    ])
    expect(getNodePorts(imageGenerate).map((p) => [p.direction, p.id, p.dataType])).toEqual([
      ['in', 'in-text', GraphPortType.text],
      ['in', 'in-image', GraphPortType.image],
      ['out', 'out', GraphPortType.images]
    ])
    expect(getNodePorts(imageOut).map((p) => [p.direction, p.dataType])).toEqual([
      ['in', GraphPortType.images]
    ])
    expect(canConnectNodes(imageRef, imageGenerate)).toBe(true)
    expect(canConnectNodes(imageRef, imageGenerate, { targetPort: 'in-image' })).toBe(true)
    expect(canConnectNodes(imageGenerate, imageOut)).toBe(true)
    // 引用仍为单图，不能直接连图片输出（数组）
    expect(canConnectNodes(imageRef, imageOut)).toBe(false)
  })

  it('audio generate outputs voices and audio output accepts voices without out port', () => {
    const audio = createNodeFromType('asset.voice', { x: 100, y: 0 })
    const timbreRef = createAssetGraphNode(
      '00000000-0000-4000-8000-000000000303',
      'voice',
      'Voice',
      { x: 0, y: 0 }
    )
    const timbreOut = createNodeFromType('output.voice', { x: 200, y: 0 })
    expect(getNodePorts(audio).map((p) => [p.direction, p.id, p.dataType])).toEqual([
      ['in', 'in-text', GraphPortType.text],
      ['in', 'in-image', GraphPortType.image],
      ['out', 'out', GraphPortType.voices]
    ])
    expect(getNodePorts(timbreRef).map((p) => [p.direction, p.dataType])).toEqual([
      ['out', GraphPortType.voice]
    ])
    expect(getNodePorts(timbreOut).map((p) => [p.direction, p.dataType])).toEqual([
      ['in', GraphPortType.voices]
    ])
    expect(canConnectNodes(audio, timbreOut)).toBe(true)
    expect(canConnectNodes(timbreRef, timbreOut)).toBe(false)
    expect(canConnectNodes(timbreRef, audio, { targetPort: 'in-image' })).toBe(false)
  })
})
