import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 对话生成已彻底统一为「画布节点优先（graph_edit + task_run 全程实时更新）」：
 * 1. 旧的 12 个直接调 API 的生成/加工 MCP 工具已全部移除，不保留兼容代码；
 * 2. graph_edit 与 task_run 支持缺省 assetId 自动定位/新建当前画布、自动连线参考媒体节点、
 *    同步等待画布节点执行完成并回传 relativePaths 与视觉自检图 mcpImages；
 * 3. asset_import 仍然拒绝收编工程内任意素材（Cache/、Output/、Assets/），只放行工程外素材。
 */
const SRC = readFileSync(resolve('src/main/services/mcpServerService.ts'), 'utf8')

function extractToolBlock(toolName: string): string {
  const marker = `name: '${toolName}',`
  const start = SRC.indexOf(marker)
  expect(start, `找不到工具 ${toolName} 的定义`).toBeGreaterThanOrEqual(0)
  const nextTool = SRC.indexOf("name: '", start + marker.length)
  const arrayEnd = SRC.indexOf('\n]\n', start + marker.length)
  const candidates = [nextTool, arrayEnd].filter((n) => n > 0)
  const end = candidates.length ? Math.min(...candidates) : SRC.length
  return SRC.slice(start, end)
}

const REMOVED_DIRECT_API_TOOLS = [
  'generate_image',
  'generate_video',
  'generate_model3d',
  'generate_speech',
  'generate_dialogue',
  'generate_sound_effect',
  'generate_music',
  'generate_world',
  'export_spatial_world',
  'rig_model3d',
  'segment_model3d',
  'post_process_model3d'
] as const

describe('彻底移除直接调 API 的旧生成工具，统一走画布节点（graph_edit + task_run）', () => {
  it.each(REMOVED_DIRECT_API_TOOLS)('已移除旧直调工具 %s', (toolName) => {
    expect(SRC).not.toContain(`name: '${toolName}',`)
  })

  it('graph_edit 引导创建/修改画布生成节点并自动打开编辑器实时展示', () => {
    const block = extractToolBlock('graph_edit')
    expect(block).toContain('asset.image')
    expect(block).toContain('asset.video')
    expect(block).toContain('voice.tts')
    expect(block).toContain('voice.dialogue')
    expect(block).toContain('audio.sfx')
    expect(block).toContain('audio.music')
    expect(block).toContain('asset.model3d')
    expect(block).toContain('spatialWorld.generate')
    expect(block).toContain('resolveOrEnsureCanvasAsset')
  })

  it('task_run 支持按 nodeId / nodeIds 在画布上实时执行并默认等待完成返回产物与视觉自检图', () => {
    const block = extractToolBlock('task_run')
    expect(block).toContain('resolveOrEnsureCanvasAsset')
    expect(block).toContain('requestedNodeIds')
    expect(block).toContain('readVisualCheckImagesForRelativePaths')
    expect(block).toContain('mcpImages: visualImages')
  })
})

describe('MCP asset_import 拒绝工程内任意素材', () => {
  it('handler 用 isProjectInternalPath 拦截并给出引导文案', () => {
    const block = extractToolBlock('asset_import')
    expect(block).toMatch(/isProjectInternalPath\(/)
    expect(block).toMatch(/projectGeneratedOutputImportError\(/)
  })

  it('工具描述明确只收编工程外素材', () => {
    const block = extractToolBlock('asset_import')
    expect(block).toMatch(/Cache\//)
    expect(block).toMatch(/Output\//)
    expect(block).toMatch(/只收编工程外的本机素材/)
  })
})
