import { describe, expect, it } from 'vitest'
import {
  actionFromBlenderCode,
  phaseFromHarnessEvent,
  shortToolName,
  summarizeHarnessLogLine
} from '../src/shared/blenderDshLive'

describe('phaseFromHarnessEvent', () => {
  it('maps queue / start status and tool names', () => {
    expect(phaseFromHarnessEvent({ type: 'status', text: '排队等待 dsh…' })).toBe('queued')
    expect(phaseFromHarnessEvent({ type: 'status', text: '正在启动 DeepSeek Harness…' })).toBe(
      'start'
    )
    expect(phaseFromHarnessEvent({ type: 'tool', name: 'dsh-agent', state: 'start' })).toBe('start')
    expect(phaseFromHarnessEvent({ type: 'tool', name: 'skill', state: 'start' })).toBe('skill')
    expect(phaseFromHarnessEvent({ type: 'tool', name: 'get_scene_info', state: 'start' })).toBe(
      'inspect'
    )
    expect(
      phaseFromHarnessEvent({ type: 'tool', name: 'get_viewport_screenshot', state: 'start' })
    ).toBe('screenshot')
    expect(phaseFromHarnessEvent({ type: 'tool', name: 'export_scene', state: 'start' })).toBe(
      'export'
    )
    expect(
      phaseFromHarnessEvent({
        type: 'tool',
        name: 'mcp__blender__execute_blender_code',
        state: 'start',
        args: 'bpy.ops.export_scene.gltf(filepath="output.glb")'
      })
    ).toBe('export')
    expect(phaseFromHarnessEvent({ type: 'error', message: 'boom' })).toBe('error')
    expect(phaseFromHarnessEvent({ type: 'assistant', text: 'hello' })).toBeNull()
  })

  it('treats custom render scripts as screenshot, not generic blender', () => {
    expect(actionFromBlenderCode('import bpy\nimg = bpy.data.images.new("s", 8, 8)')).toBe(
      'screenshot'
    )
    expect(actionFromBlenderCode('arm_data = bpy.data.armatures.new("Rig")')).toBe('blender')
  })

  it('summarizes tool lines without python source', () => {
    expect(shortToolName('mcp__blender__execute_blender_code')).toBe('execute_blender_code')
    const line = summarizeHarnessLogLine({
      type: 'tool',
      name: 'mcp__blender__execute_blender_code',
      state: 'start',
      detail: 'import bpy, math\nfrom mathutils import Vector\nimg = bpy.data.images.new("x", 4, 4)'
    })
    expect(line).toBe('execute_blender_code start · screenshot')
    expect(line).not.toContain('import bpy')
    expect(
      summarizeHarnessLogLine({
        type: 'tool',
        name: 'mcp__blender__execute_blender_code',
        state: 'done'
      })
    ).toBe('execute_blender_code done')
  })
})
