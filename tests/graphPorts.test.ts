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
      GraphPortType.voice,
      GraphPortType.video,
      GraphPortType.text,
      GraphPortType.model
    ])
    expect(isGraphPortDataType('image')).toBe(true)
    expect(isGraphPortDataType('video')).toBe(true)
    expect(isGraphPortDataType('text')).toBe(true)
    expect(isGraphPortDataType('voice')).toBe(true)
    expect(isGraphPortDataType('images')).toBe(false)
    expect(isGraphPortDataType('texts')).toBe(false)
    expect(isGraphPortDataType('camera')).toBe(false)
  })
})

describe('asset reference ports', () => {
  const mediaDragTypes = ['motion', 'image', 'video', 'voice'] as const

  const mediaGuids: Record<(typeof mediaDragTypes)[number], string> = {
    motion: '00000000-0000-4000-8000-000000000002',
    image: '00000000-0000-4000-8000-000000000003',
    video: '00000000-0000-4000-8000-000000000004',
    voice: '00000000-0000-4000-8000-000000000005'
  }

  for (const type of mediaDragTypes) {
    it(`${type} imported/ref drag node has only output port`, () => {
      const node = createAssetGraphNode(mediaGuids[type], type, type, { x: 0, y: 0 })
      const ports = getNodePorts(node)
      expect(ports.every((p) => p.direction === 'out')).toBe(true)
      expect(ports.length).toBeGreaterThan(0)
    })
  }

  it('image/video/voice host drag nodes keep processing inputs', () => {
    const image = createAssetGraphNode(
      '00000000-0000-4000-8000-000000000021',
      'image',
      'Image',
      { x: 0, y: 0 },
      { assetHost: true }
    )
    const voice = createAssetGraphNode(
      '00000000-0000-4000-8000-000000000022',
      'voice',
      'Voice',
      { x: 0, y: 0 },
      { assetHost: true }
    )
    const video = createAssetGraphNode(
      '00000000-0000-4000-8000-000000000023',
      'video',
      'Video',
      { x: 0, y: 0 },
      { assetHost: true }
    )

    expect(getNodePorts(image).map((p) => `${p.id}:${p.dataType}:${p.direction}`)).toEqual([
      'in-text:text:in',
      'in-image:image:in',
      'out:image:out'
    ])
    expect(getNodePorts(voice).map((p) => `${p.id}:${p.dataType}:${p.direction}`)).toEqual([
      'in-text:text:in',
      'in-image:image:in',
      'out:voice:out'
    ])
    expect(getNodePorts(video).map((p) => `${p.id}:${p.dataType}:${p.direction}`)).toEqual([
      'in-text:text:in',
      'in-image:image:in',
      'in-video:video:in',
      'in-voice:voice:in',
      'out:video:out'
    ])
  })

  it('series host drag nodes keep text/image inputs', () => {
    const screenplay = createAssetGraphNode(
      '00000000-0000-4000-8000-000000000011',
      'screenplay',
      'Screenplay',
      { x: 0, y: 0 },
      { assetHost: true }
    )
    const world = createAssetGraphNode(
      '00000000-0000-4000-8000-000000000012',
      'world',
      'World',
      { x: 0, y: 0 },
      { assetHost: true }
    )
    const narrative = createAssetGraphNode(
      '00000000-0000-4000-8000-000000000013',
      'narrative',
      'Narrative',
      { x: 0, y: 0 },
      { assetHost: true }
    )
    const script = createAssetGraphNode(
      '00000000-0000-4000-8000-000000000014',
      'script',
      'Shot',
      { x: 0, y: 0 },
      { assetHost: true }
    )

    expect(getNodePorts(screenplay).map((p) => `${p.id}:${p.dataType}:${p.direction}`)).toEqual([
      'in:text:in',
      'out:text:out'
    ])
    expect(getNodePorts(world).map((p) => `${p.id}:${p.dataType}:${p.direction}`)).toEqual([
      'in:text:in',
      'out:image:out'
    ])
    expect(getNodePorts(narrative).map((p) => `${p.id}:${p.dataType}:${p.direction}`)).toEqual([
      'in:text:in',
      'out:text:out'
    ])
    expect(getNodePorts(script).map((p) => `${p.id}:${p.dataType}:${p.direction}`)).toEqual([
      'in-text:text:in',
      'in-image:image:in',
      'out:text:out'
    ])
  })
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

  it('screenplay generate and output use singular text with multiple', () => {
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
      ['out', GraphPortType.text]
    ])
    expect(getNodePorts(screenplayRef).map((p) => [p.direction, p.dataType])).toEqual([
      ['out', GraphPortType.text]
    ])
    expect(getNodePorts(screenplayOut).map((p) => [p.direction, p.dataType])).toEqual([
      ['in', GraphPortType.text]
    ])
    expect(canConnectNodes(screenplay, screenplayOut)).toBe(true)
    // 统一单数后：引用也可直连文本输出
    expect(canConnectNodes(screenplayRef, screenplayOut)).toBe(true)
  })

  it('same media types connect', () => {
    const imageRef = createAssetGraphNode('00000000-0000-4000-8000-000000000301', 'image', 'Img', {
      x: 0,
      y: 0
    })
    const imageGenerate = createNodeFromType('asset.image', { x: 100, y: 0 })
    const imageOut = createNodeFromType('output.image', { x: 200, y: 0 })
    expect(getNodePorts(imageRef).map((p) => [p.direction, p.dataType])).toEqual([
      ['out', GraphPortType.image]
    ])
    expect(getNodePorts(imageGenerate).map((p) => [p.direction, p.id, p.dataType])).toEqual([
      ['in', 'in-text', GraphPortType.text],
      ['in', 'in-image', GraphPortType.image],
      ['out', 'out', GraphPortType.image]
    ])
    expect(getNodePorts(imageOut).map((p) => [p.direction, p.dataType])).toEqual([
      ['in', GraphPortType.image]
    ])
    expect(canConnectNodes(imageRef, imageGenerate)).toBe(true)
    expect(canConnectNodes(imageRef, imageGenerate, { targetPort: 'in-image' })).toBe(true)
    expect(canConnectNodes(imageGenerate, imageOut)).toBe(true)
    // 统一单数后：引用也可直连图片输出
    expect(canConnectNodes(imageRef, imageOut)).toBe(true)
  })

  it('audio generate and output use singular voice with multiple', () => {
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
      ['out', 'out', GraphPortType.voice]
    ])
    expect(getNodePorts(timbreRef).map((p) => [p.direction, p.dataType])).toEqual([
      ['out', GraphPortType.voice]
    ])
    expect(getNodePorts(timbreOut).map((p) => [p.direction, p.dataType])).toEqual([
      ['in', GraphPortType.voice]
    ])
    expect(canConnectNodes(audio, timbreOut)).toBe(true)
    expect(canConnectNodes(timbreRef, timbreOut)).toBe(true)
    expect(canConnectNodes(timbreRef, audio, { targetPort: 'in-image' })).toBe(false)
  })
})
