import { describe, expect, it } from 'vitest'
import {
  AI_POSE_FUNCTION_NAME,
  buildAiPoseSystemPrompt,
  buildAiPoseUserPrompt,
  inferBoneRole,
  mapAiPoseDegreesToBonePose,
  parseAiPoseFunctionCall
} from '../src/renderer/src/features/director/aiPoseParse'

describe('aiPoseParse', () => {
  it('parses function-call JSON', () => {
    const call = parseAiPoseFunctionCall(
      JSON.stringify({
        name: AI_POSE_FUNCTION_NAME,
        arguments: {
          mode: 'merge',
          bones: { 'mixamorig:LeftArm': { x: 10, y: -20, z: 0 } }
        }
      })
    )
    expect(call?.name).toBe(AI_POSE_FUNCTION_NAME)
    expect(call?.arguments.mode).toBe('merge')
    expect(call?.arguments.bones['mixamorig:LeftArm']).toEqual({ x: 10, y: -20, z: 0 })
  })

  it('parses bare bones object and fenced markdown', () => {
    const call = parseAiPoseFunctionCall(`\`\`\`json
{"bones":{"Hips":{"x":0,"y":15,"z":0}}}
\`\`\``)
    expect(call?.arguments.mode).toBe('replace')
    expect(call?.arguments.bones.Hips).toEqual({ x: 0, y: 15, z: 0 })
  })

  it('maps normalized bone names and converts degrees to radians', () => {
    const mapped = mapAiPoseDegreesToBonePose(
      { LeftArm: { x: 90, y: 0, z: 0 } },
      ['mixamorig:LeftArm', 'mixamorig:RightArm']
    )
    expect(mapped.matched).toBe(1)
    expect(mapped.bonePose['mixamorig:LeftArm']?.x).toBeCloseTo(Math.PI / 2, 5)
  })

  it('infers humanoid bone roles for Mixamo-like names', () => {
    expect(inferBoneRole('mixamorig:Hips')).toBe('hips')
    expect(inferBoneRole('mixamorig:LeftArm')).toBe('l_upperarm')
    expect(inferBoneRole('mixamorig:RightForeArm')).toBe('r_forearm')
    expect(inferBoneRole('mixamorig:LeftUpLeg')).toBe('l_thigh')
    expect(inferBoneRole('mixamorig:RightLeg')).toBe('r_shin')
  })

  it('system prompt keeps compact function-call rules', () => {
    const zh = buildAiPoseSystemPrompt('zh-CN')
    expect(zh).toContain('apply_bone_pose')
    expect(zh).toContain('局部欧拉')
    expect(zh).not.toContain('构图流程')
    const en = buildAiPoseSystemPrompt('en-US')
    expect(en).toContain('function-call')
    expect(en).not.toContain('Construction order')
  })

  it('user prompt includes role hints', () => {
    const prompt = buildAiPoseUserPrompt({
      instruction: '走路',
      bones: [
        { name: 'mixamorig:Hips', parent: null, rotationDeg: { x: 0, y: 0, z: 0 } },
        { name: 'mixamorig:LeftArm', parent: 'mixamorig:LeftShoulder', rotationDeg: { x: 0, y: 0, z: 0 } }
      ]
    })
    expect(prompt).toContain('"role": "hips"')
    expect(prompt).toContain('"role": "l_upperarm"')
    expect(prompt).toContain('mode=replace')
  })
})
