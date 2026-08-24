import { describe, expect, it } from 'vitest'
import {
  BUILD_SCENE_FUNCTION_NAME,
  buildSceneBlockoutSystemPrompt,
  buildSceneBlockoutUserPrompt,
  isLikelyEquirectangularSize,
  panoramaAzimuthToWorld,
  parseAiSceneBlockoutCall,
  photoSpaceToStageWorld,
  resolveBlockoutWorldPosition
} from '../src/renderer/src/features/director/aiSceneBlockout'

const validObject = {
  name: '桌子',
  primitive: 'box',
  color: '#8A7A66',
  position: { x: 0, y: 0.4, z: -2 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1.6, y: 0.8, z: 0.9 }
}

describe('aiSceneBlockout', () => {
  it('parses plain function-call JSON', () => {
    const raw = JSON.stringify({
      name: BUILD_SCENE_FUNCTION_NAME,
      arguments: { summary: '室内一角', objects: [validObject] }
    })
    const call = parseAiSceneBlockoutCall(raw)
    expect(call).not.toBeNull()
    expect(call?.arguments.summary).toBe('室内一角')
    expect(call?.arguments.objects).toHaveLength(1)
    expect(call?.arguments.objects[0]).toMatchObject({
      name: '桌子',
      primitive: 'box',
      color: '#8a7a66'
    })
  })

  it('parses code-fenced and OpenAI tool_calls forms', () => {
    const fenced = '```json\n' + JSON.stringify({ objects: [validObject] }) + '\n```'
    expect(parseAiSceneBlockoutCall(fenced)?.arguments.objects).toHaveLength(1)

    const toolCalls = JSON.stringify({
      tool_calls: [
        {
          function: {
            name: BUILD_SCENE_FUNCTION_NAME,
            arguments: JSON.stringify({ objects: [validObject] })
          }
        }
      ]
    })
    expect(parseAiSceneBlockoutCall(toolCalls)?.arguments.objects).toHaveLength(1)
  })

  it('drops unknown primitives and normalizes bad numbers/colors', () => {
    const raw = JSON.stringify({
      objects: [
        validObject,
        { name: 'bad', primitive: 'teapot', position: { x: 1, y: 1, z: 1 } },
        { name: 'no-scale', primitive: 'sphere', position: { x: 'NaN', y: 2, z: 3 } }
      ]
    })
    const call = parseAiSceneBlockoutCall(raw)
    expect(call?.arguments.objects).toHaveLength(2)
    const sphere = call?.arguments.objects[1]
    expect(sphere?.primitive).toBe('sphere')
    expect(sphere?.position.x).toBe(0)
    expect(sphere?.color).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('rejects wrong function names and empty payloads', () => {
    expect(parseAiSceneBlockoutCall('')).toBeNull()
    expect(parseAiSceneBlockoutCall('not json at all')).toBeNull()
    expect(
      parseAiSceneBlockoutCall(JSON.stringify({ name: 'other_fn', arguments: { objects: [validObject] } }))
    ).toBeNull()
    expect(parseAiSceneBlockoutCall(JSON.stringify({ objects: [] }))).toBeNull()
  })

  it('system prompt lists the local primitive catalog', () => {
    const prompt = buildSceneBlockoutSystemPrompt('zh-CN')
    for (const primitive of [
      'box',
      'sphere',
      'capsule',
      'cone',
      'pyramid',
      'cylinder',
      'tube',
      'prism',
      'hemisphere',
      'torus',
      'arch',
      'tetrahedron',
      'octahedron',
      'icosphere',
      'wedge',
      'disc',
      'ring',
      'plane',
      'quad'
    ]) {
      expect(prompt).toContain(primitive)
    }
    expect(prompt).toContain(BUILD_SCENE_FUNCTION_NAME)
  })

  it('user prompt includes instruction, image count and panorama radius', () => {
    const prompt = buildSceneBlockoutUserPrompt({
      instruction: '还原室内布局',
      imageCount: 3,
      mode: 'panorama',
      panoramaRadius: 500,
      panoramaYawDeg: 15
    })
    expect(prompt).toContain('还原室内布局')
    expect(prompt).toContain('3')
    expect(prompt).toContain('500')
    expect(prompt).toContain('Layout mode: panorama')
    expect(prompt).toContain(BUILD_SCENE_FUNCTION_NAME)

    const perspective = buildSceneBlockoutUserPrompt({
      instruction: '按照片构图',
      imageCount: 1,
      mode: 'perspective'
    })
    expect(perspective).toContain('Layout mode: perspective')
    expect(perspective).toContain('perspective photos')
    expect(perspective).toContain('Round arches = arch')
    expect(perspective).toContain('Circular spires = cone')
    expect(perspective).not.toContain('azimuthDeg')
  })

  it('maps panorama image center to -X and right side to -Z', () => {
    const center = panoramaAzimuthToWorld(0, 0, 3, 0)
    expect(center.x).toBeCloseTo(-3, 5)
    expect(center.z).toBeCloseTo(0, 5)
    const right = panoramaAzimuthToWorld(90, 0, 3, 0)
    expect(right.x).toBeCloseTo(0, 5)
    expect(right.z).toBeCloseTo(-3, 5)
  })

  it('twists photo-space xyz so "in front" lands on panorama center', () => {
    const world = photoSpaceToStageWorld({ x: 0, y: 0.4, z: -2 }, 0)
    expect(world.x).toBeCloseTo(-2, 5)
    expect(world.y).toBeCloseTo(0.4, 5)
    expect(world.z).toBeCloseTo(0, 5)
  })

  it('prefers azimuth+distance when resolving panorama world position', () => {
    const pos = resolveBlockoutWorldPosition(
      {
        name: '窗',
        primitive: 'box',
        color: '#808080',
        position: { x: 0, y: 1.2, z: -2 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        azimuthDeg: 0,
        distance: 4
      },
      { mode: 'panorama', panoramaYawDeg: 0 }
    )
    expect(pos.x).toBeCloseTo(-4, 5)
    expect(pos.y).toBeCloseTo(1.2, 5)
    expect(pos.z).toBeCloseTo(0, 5)
  })

  it('keeps perspective xyz in camera space and maps 0° azimuth to -Z', () => {
    expect(
      resolveBlockoutWorldPosition(
        {
          name: '桌',
          primitive: 'box',
          color: '#808080',
          position: { x: 0, y: 0.4, z: -3 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 }
        },
        { mode: 'perspective' }
      )
    ).toEqual({ x: 0, y: 0.4, z: -3 })

    const front = resolveBlockoutWorldPosition(
      {
        name: '灯',
        primitive: 'sphere',
        color: '#808080',
        position: { x: 0, y: 1.6, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        azimuthDeg: 0,
        distance: 5
      },
      { mode: 'perspective' }
    )
    expect(front.x).toBeCloseTo(0, 5)
    expect(front.y).toBeCloseTo(1.6, 5)
    expect(front.z).toBeCloseTo(-5, 5)

    const right = resolveBlockoutWorldPosition(
      {
        name: '椅',
        primitive: 'box',
        color: '#808080',
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        azimuthDeg: 90,
        distance: 5
      },
      { mode: 'perspective' }
    )
    expect(right.x).toBeCloseTo(5, 5)
    expect(right.z).toBeCloseTo(0, 5)
  })

  it('twists panorama xyz so photo-forward lands on image center', () => {
    const world = resolveBlockoutWorldPosition(
      {
        name: '墙',
        primitive: 'box',
        color: '#808080',
        position: { x: 0, y: 0, z: -3 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 }
      },
      { mode: 'panorama', panoramaYawDeg: 0 }
    )
    expect(world.x).toBeCloseTo(-3, 5)
    expect(world.z).toBeCloseTo(0, 5)
  })

  it('treats ~2:1 as 360 and rejects common perspective ratios', () => {
    expect(isLikelyEquirectangularSize(2048, 1024)).toBe(true)
    expect(isLikelyEquirectangularSize(4096, 2048)).toBe(true)
    expect(isLikelyEquirectangularSize(1920, 1080)).toBe(false)
    expect(isLikelyEquirectangularSize(1024, 1024)).toBe(false)
    expect(isLikelyEquirectangularSize(4, 2)).toBe(false)
  })

  it('system prompt describes perspective by default and 360 when requested', () => {
    const perspective = buildSceneBlockoutSystemPrompt('en-US')
    expect(perspective).toContain('perspective photo')
    expect(perspective).toContain('build_scene')
    expect(perspective).toContain('cone')
    expect(perspective).toContain('colonnade')
    expect(perspective).toContain('arch only')
    expect(perspective).toContain('cone only')
    expect(perspective).toContain('never prism')
    expect(perspective).not.toContain('azimuthDeg')

    const pano = buildSceneBlockoutSystemPrompt('en-US', 'panorama')
    expect(pano).toContain('equirectangular')
    expect(pano).toContain('azimuthDeg')
    expect(pano).toContain('360')

    const zhPano = buildSceneBlockoutSystemPrompt('zh-CN', 'panorama')
    expect(zhPano).toContain('360')
    expect(zhPano).toContain('azimuthDeg')
  })
})
