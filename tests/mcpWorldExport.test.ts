import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = readFileSync(resolve('src/main/services/mcpServerService.ts'), 'utf8')
const FACADE = readFileSync(resolve('src/main/services/modelProviders/facade.ts'), 'utf8')
const SMART_PATCH = readFileSync(resolve('src/shared/graph/smartPatch.ts'), 'utf8')
const MCP_GRAPH_EDIT = readFileSync(resolve('src/shared/graph/mcpGraphEdit.ts'), 'utf8')

function toolBlock(toolName: string): string {
  const marker = `name: '${toolName}',`
  const start = SRC.indexOf(marker)
  expect(start, `找不到工具 ${toolName} 的定义`).toBeGreaterThanOrEqual(0)

  const nextTool = SRC.indexOf("name: '", start + marker.length)
  const arrayEnd = SRC.indexOf('\n]\n', start + marker.length)
  const candidates = [nextTool, arrayEnd].filter((n) => n > 0)
  const end = candidates.length ? Math.min(...candidates) : SRC.length
  return SRC.slice(start, end)
}

describe('空间世界生成与导出统一走画布节点（spatialWorld.generate / spatialWorld.export）', () => {
  it('已移除旧直调工具 generate_world / export_spatial_world', () => {
    expect(SRC).not.toContain("name: 'generate_world',")
    expect(SRC).not.toContain("name: 'export_spatial_world',")
  })

  it('graph_edit 引导使用 spatialWorld.generate 与 spatialWorld.export 节点', () => {
    const graphEdit = toolBlock('graph_edit')
    expect(graphEdit).toContain('spatialWorld.generate')
    expect(graphEdit).toContain('spatialWorld.export')
  })

  it('smartPatch 支持 spatialWorld 节点参数（seed / panoMode / disableRecaption / model）', () => {
    expect(SMART_PATCH).toContain('merged.spatialWorldSeed')
    expect(SMART_PATCH).toContain('merged.spatialWorldPanoMode')
    expect(SMART_PATCH).toContain('merged.spatialWorldDisableRecaption')
    expect(SMART_PATCH).toContain('merged.spatialWorldModel')
  })

  it('mcpGraphEdit 支持将 referenceImageUrls / referenceVideoUrl 自动连线到 spatialWorld 节点', () => {
    expect(MCP_GRAPH_EDIT).toContain("targetNode.typeId === 'asset.spatialWorld'")
    expect(MCP_GRAPH_EDIT).toContain('referenceVideoUrl')
  })
})

describe('源路径缺失时的报错文案', () => {
  it('facade 的错误同时给出两条参数路径', () => {
    expect(FACADE).toMatch(/spatialWorldAssetId \/ sourceRelativePath/)
  })
})

describe('世界附加产物：活动与对话卡的接线', () => {
  const chatPanel = readFileSync(resolve('src/renderer/src/components/ChatPanel.vue'), 'utf8')

  it('McpActivity 与活动服务都支持 relatedPaths', () => {
    const ipc = readFileSync(resolve('src/shared/ipc.ts'), 'utf8')
    const service = readFileSync(resolve('src/main/services/mcpActivityService.ts'), 'utf8')
    expect(ipc).toMatch(/relatedPaths\?: string\[\]/)
    expect(service).toContain('relatedPaths')
    expect(service).toMatch(/relatedPaths: relatedPaths\?\.length/)
  })

  it('ChatPanel 把附件折叠进第一张卡，而不是逐条出卡', () => {
    expect(chatPanel).toContain('activity.relatedPaths')
    expect(chatPanel).toMatch(/index === 0 \? attachments : \[\]/)
  })
})
