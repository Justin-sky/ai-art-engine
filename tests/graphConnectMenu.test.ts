import { describe, expect, it, beforeEach } from 'vitest'
import {
  canConnectToNodeType,
  createNodeFromType,
  createParamsForScope,
  ensureBuiltinNodeTypes,
  getNodePorts,
  listAddableNodeTypes,
  resetGraphPolicyForTests,
  typeDefAcceptsDataType,
  typeDefProvidesDataType,
  GraphPortType
} from '../src/shared/graph'

describe('connect menu type filter', () => {
  beforeEach(() => {
    resetGraphPolicyForTests()
    ensureBuiltinNodeTypes()
  })

  it('from text out only lists text-accepting addable types', () => {
    const source = createNodeFromType('play.script', { x: 0, y: 0 })
    const addable = listAddableNodeTypes('directorAsset')
    const allowed = addable.filter((def) =>
      canConnectToNodeType(source, def, {
        sourcePort: 'out',
        dataType: GraphPortType.text,
        typeParams: createParamsForScope('directorAsset', def.typeId)
      })
    )
    const ids = allowed.map((d) => d.typeId).sort()
    expect(ids).toContain('asset.screenplay')
    expect(ids).toContain('prompt.optimize')
    expect(ids).toContain('asset.video')
    expect(ids).toContain('asset.image')
    expect(ids).not.toContain('image.toPrompt')
    expect(ids).not.toContain('asset.motion')
    expect(ids).not.toContain('note.text')
  })

  it('from image out lists image-to-prompt among image-accepting types', () => {
    const source = createNodeFromType('asset.image', { x: 0, y: 0 }, {
      assetId: '00000000-0000-4000-8000-000000000031',
      assetType: 'image',
      params: { assetRef: true }
    })
    const addable = listAddableNodeTypes('directorAsset')
    const allowed = addable.filter((def) =>
      canConnectToNodeType(source, def, {
        sourcePort: 'out',
        dataType: GraphPortType.image,
        typeParams: createParamsForScope('directorAsset', def.typeId)
      })
    )
    const ids = allowed.map((d) => d.typeId)
    expect(ids).toContain('image.toPrompt')
    expect(ids).toContain('asset.image')
    expect(ids).toContain('asset.video')
    expect(ids).not.toContain('prompt.optimize')
    expect(ids).not.toContain('asset.screenplay')
  })

  it('video generate node accepts text, image, video and audio inputs', () => {
    const video = createNodeFromType('asset.video', { x: 0, y: 0 })
    const ports = getNodePorts(video).filter((p) => p.direction === 'in')
    expect(ports.map((p) => [p.id, p.dataType])).toEqual([
      ['in-text', GraphPortType.text],
      ['in-image', GraphPortType.image],
      ['in-video', GraphPortType.video],
      ['in-voice', GraphPortType.voice]
    ])
    expect(typeDefAcceptsDataType(
      listAddableNodeTypes('directorAsset').find((d) => d.typeId === 'asset.video')!,
      GraphPortType.text
    )).toBe(true)
    expect(typeDefAcceptsDataType(
      listAddableNodeTypes('directorAsset').find((d) => d.typeId === 'asset.video')!,
      GraphPortType.image
    )).toBe(true)
    expect(typeDefAcceptsDataType(
      listAddableNodeTypes('directorAsset').find((d) => d.typeId === 'asset.video')!,
      GraphPortType.video
    )).toBe(true)
    expect(typeDefAcceptsDataType(
      listAddableNodeTypes('directorAsset').find((d) => d.typeId === 'asset.video')!,
      GraphPortType.voice
    )).toBe(true)
  })

  it('image generate node accepts text and image inputs', () => {
    const image = createNodeFromType('asset.image', { x: 0, y: 0 })
    const ports = getNodePorts(image).filter((p) => p.direction === 'in')
    expect(ports.map((p) => [p.id, p.dataType])).toEqual([
      ['in-text', GraphPortType.text],
      ['in-image', GraphPortType.image]
    ])
    expect(typeDefAcceptsDataType(
      listAddableNodeTypes('directorAsset').find((d) => d.typeId === 'asset.image')!,
      GraphPortType.text
    )).toBe(true)
    expect(typeDefAcceptsDataType(
      listAddableNodeTypes('directorAsset').find((d) => d.typeId === 'asset.image')!,
      GraphPortType.image
    )).toBe(true)
  })

  it('director motion node has no input ports', () => {
    const target = createNodeFromType('asset.motion', { x: 0, y: 0 })
    expect(getNodePorts(target).filter((p) => p.direction === 'in')).toEqual([])
  })

  it('typeDef helpers: motion provides images and videos (no inputs)', () => {
    const motion = listAddableNodeTypes('directorAsset').find((d) => d.typeId === 'asset.motion')!
    expect(typeDefAcceptsDataType(motion, GraphPortType.text)).toBe(false)
    expect(typeDefAcceptsDataType(motion, GraphPortType.model)).toBe(false)
    expect(typeDefAcceptsDataType(motion, GraphPortType.image)).toBe(false)
    expect(typeDefAcceptsDataType(motion, GraphPortType.video)).toBe(false)
    // 方形口 out-shots / out-actions：复数类型，与单数 image/video 严格不相通
    expect(typeDefProvidesDataType(motion, GraphPortType.images)).toBe(true)
    expect(typeDefProvidesDataType(motion, GraphPortType.videos)).toBe(true)
    expect(typeDefProvidesDataType(motion, GraphPortType.image)).toBe(false)
    expect(typeDefProvidesDataType(motion, GraphPortType.video)).toBe(false)
  })
})
