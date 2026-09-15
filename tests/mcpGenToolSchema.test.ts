import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 对话生成类工具（generate_image / generate_video / generate_model3d / generate_speech /
 * generate_music）已统一为「落 Cache、不入资产库」的工作流：inputSchema 不再接受 outputDir
 * （Assets/ 例外入口）也不再接受 folderId（settle 入库的口），透传参数经
 * cacheOnlyGenExtraParams 再剥一道，堵住 extraParams 夹带 + harness 缓存旧 schema 时
 * 顶层字段的泄漏。同时 asset_import 拒绝收编**工程内任意素材**（Cache/、Output/、
 * Assets/ 等都不行），仅放行工程外的本机素材。本测试通过源码片段解析验证这些约束，
 * 避免出现「agent 误以为还能直接入库 → 又在对话流里出两张卡」的回归。
 */
const SRC = readFileSync(resolve('src/main/services/mcpServerService.ts'), 'utf8')

function extractInputSchemaBlock(toolName: string): string {
  const marker = `name: '${toolName}',`
  const toolStart = SRC.indexOf(marker)
  expect(toolStart, `找不到工具 ${toolName} 的定义`).toBeGreaterThanOrEqual(0)
  const inputStart = SRC.indexOf('inputSchema:', toolStart)
  expect(inputStart).toBeGreaterThanOrEqual(0)
  const braceStart = SRC.indexOf('{', inputStart)
  let depth = 1
  let i = braceStart + 1
  for (; i < SRC.length; i++) {
    const ch = SRC[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) break
    }
  }
  return SRC.slice(braceStart, i + 1)
}

function extractToolBlock(toolName: string): string {
  const marker = `name: '${toolName}',`
  const start = SRC.indexOf(marker)
  expect(start).toBeGreaterThanOrEqual(0)
  // 找下一个工具的起点（缩进 2 空格 + `  {`），找不到就吃到文件末
  const nextTool = SRC.indexOf('\n  {\n', start + marker.length)
  const end = nextTool > 0 ? nextTool : SRC.length
  return SRC.slice(start, end)
}

const GEN_TOOLS = [
  'generate_image',
  'generate_video',
  'generate_model3d',
  'generate_speech',
  'generate_music'
] as const

describe('MCP 对话生成工具 inputSchema 收紧', () => {
  it('generate_image：不再含 outputDir / folderId', () => {
    const schema = extractInputSchemaBlock('generate_image')
    expect(schema).not.toMatch(/['"]?outputDir['"]?\s*:/)
    expect(schema).not.toMatch(/['"]?folderId['"]?\s*:/)
  })

  it('generate_video：不再含 outputDir / folderId', () => {
    const schema = extractInputSchemaBlock('generate_video')
    expect(schema).not.toMatch(/['"]?outputDir['"]?\s*:/)
    expect(schema).not.toMatch(/['"]?folderId['"]?\s*:/)
  })

  it('generate_model3d：不再含 folderId', () => {
    const schema = extractInputSchemaBlock('generate_model3d')
    expect(schema).not.toMatch(/['"]?folderId['"]?\s*:/)
  })

  it('generate_speech / generate_music：不再含 outputDir / folderId', () => {
    for (const toolName of ['generate_speech', 'generate_music']) {
      const schema = extractInputSchemaBlock(toolName)
      expect(schema, `${toolName} 仍暴露 outputDir`).not.toMatch(/['"]?outputDir['"]?\s*:/)
      expect(schema, `${toolName} 仍暴露 folderId`).not.toMatch(/['"]?folderId['"]?\s*:/)
    }
  })

  it('工具描述已切到 Cache-only + 引导 agent 走「保存到资产库」按钮', () => {
    const cacheDirs: Record<string, RegExp> = {
      generate_image: /Cache\/Images/,
      generate_video: /Cache\/Videos/,
      generate_model3d: /Cache\/Models/,
      generate_speech: /Cache\/Voices/,
      generate_music: /Cache\/Music/
    }
    for (const [toolName, cacheDir] of Object.entries(cacheDirs)) {
      const block = extractToolBlock(toolName)
      expect(block, `${toolName} 描述未指出缓存目录`).toMatch(cacheDir)
      expect(block, `${toolName} 描述未引导「保存到资产库」`).toMatch(/保存到资产库/)
    }
  })
})

describe('MCP 对话生成工具 handler 不再 settle 入库', () => {
  it('五个生成工具的 settle 钩子都置 undefined', () => {
    for (const toolName of GEN_TOOLS) {
      const block = extractToolBlock(toolName)
      // runGenActivity 的第四个位置（settle 钩子）现在被显式置 undefined
      // 形如 ",\n        undefined,\n"，紧跟在 describe 回调之后
      expect(block, `${toolName} handler 没有把 settle 钩子置 undefined`).toMatch(
        /,\s*\n\s*undefined,\s*\n/
      )
    }
  })

  it('五个生成工具都改用 cacheOnlyGenExtraParams（堵住 extraParams 夹带 outputDir）', () => {
    for (const toolName of GEN_TOOLS) {
      const block = extractToolBlock(toolName)
      expect(block, `${toolName} 未改用 cacheOnlyGenExtraParams`).toMatch(
        /\.\.\.cacheOnlyGenExtraParams\(args\)/
      )
      expect(block, `${toolName} 仍残留 extraParamsOf 直接展开`).not.toMatch(
        /\.\.\.extraParamsOf\(args\)/
      )
    }
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
