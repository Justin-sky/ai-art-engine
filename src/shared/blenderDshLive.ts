import type { HarnessEvent } from './ipc'

export type BlenderDshLivePhase =
  | 'probe'
  | 'prepare'
  | 'queued'
  | 'start'
  | 'skill'
  | 'inspect'
  | 'blender'
  | 'screenshot'
  | 'export'
  | 'write'
  | 'finalize'
  | 'error'

function blobOf(event: HarnessEvent): string {
  if (event.type === 'status') return event.text
  if (event.type === 'error') return event.message
  if (event.type === 'tool') {
    return `${event.name} ${event.detail ?? ''} ${event.args ?? ''}`
  }
  return ''
}

export function shortToolName(name: string): string {
  return name.replace(/^mcp__blender__/, '').replace(/^mcp__/, '')
}

/** 从脚本碎片判断在干什么，不回传源码 */
export function actionFromBlenderCode(code: string): BlenderDshLivePhase | 'import' | null {
  const blob = code.toLowerCase()
  if (!blob.trim()) return null
  if (
    blob.includes('screenshot') ||
    blob.includes('viewport') ||
    blob.includes('img = bpy') ||
    blob.includes('render.render') ||
    blob.includes('opengl')
  ) {
    return 'screenshot'
  }
  if (blob.includes('export_scene') || blob.includes('output.glb') || blob.includes('gltf_export')) {
    return 'export'
  }
  if (blob.includes('result.json')) return 'write'
  if (
    blob.includes('armatures.new') ||
    blob.includes('edit_bones') ||
    blob.includes('parent_set') ||
    blob.includes('armature_auto')
  ) {
    return 'blender'
  }
  if (blob.includes('import_scene') || blob.includes('gltf(') || blob.includes('input.glb')) {
    return 'import'
  }
  if (blob.includes('bpy.data.objects') && !blob.includes('armature')) return 'inspect'
  return null
}

export function phaseFromHarnessEvent(event: HarnessEvent): BlenderDshLivePhase | null {
  if (event.type === 'error') return 'error'
  if (event.type === 'status') {
    const text = event.text.toLowerCase()
    if (text.includes('排队') || text.includes('queue')) return 'queued' // cjk-ok（匹配 dsh 状态）
    if (text.includes('export') || text.includes('导出')) return 'export' // cjk-ok（匹配 dsh 状态）
    if (text.includes('screenshot') || text.includes('截图')) return 'screenshot' // cjk-ok（匹配 dsh 状态）
    if (text.includes('启动') || text.includes('harness') || text.includes('dsh')) return 'start' // cjk-ok（匹配 dsh 状态）
    return null
  }
  if (event.type !== 'tool') return null

  const name = event.name.toLowerCase()
  if (name === 'dsh-agent') return event.state === 'start' ? 'start' : null
  if (name === 'skill' || name.includes('skill')) return 'skill'
  if (name.includes('viewport') || name.includes('screenshot')) return 'screenshot'
  if (name.includes('export')) return 'export'
  if (name.includes('scene_info') || name.includes('object_info')) return 'inspect'

  const blob = blobOf(event)
  const fromCode = actionFromBlenderCode(blob)
  if (fromCode === 'import') return 'inspect'
  if (fromCode) return fromCode
  if (name.includes('execute_blender') || name.includes('blender')) return 'blender'
  return null
}

const ACTION_LABEL: Record<string, string> = {
  inspect: 'inspect',
  import: 'import',
  blender: 'rig',
  screenshot: 'screenshot',
  export: 'export',
  write: 'result.json'
}

/** 执行日志一行：只记工具名 + 短动作，不落 Python */
export function summarizeHarnessLogLine(event: HarnessEvent): string | null {
  if (event.type === 'error') {
    const message = event.message.trim()
    return message ? message.slice(0, 200) : 'error'
  }
  if (event.type === 'status') {
    const text = event.text.trim().replace(/\s+/g, ' ')
    if (!text) return null
    return text.slice(0, 160)
  }
  if (event.type !== 'tool') return null
  const name = shortToolName(event.name)
  const action = actionFromBlenderCode(`${event.detail ?? ''} ${event.args ?? ''}`)
  const hint = action ? ACTION_LABEL[action] ?? action : ''
  const state = event.state
  return hint ? `${name} ${state} · ${hint}` : `${name} ${state}`
}
