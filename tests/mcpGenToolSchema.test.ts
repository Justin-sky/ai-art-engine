import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 对话生成类工具（generate_image / generate_video / generate_model3d）已统一为
 * 「落 Cache、不入资产库」的工作流：inputSchema 不再接受 outputDir（Assets/ 例外入口）
 * 也不再接受 folderId（settle 入库的口）。本测试通过源码片段解析验证这点，
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

  it('工具描述已切到 Cache-only + 引导 agent 走「保存到资产库」按钮', () => {
    const imageBlock = extractToolBlock('generate_image')
    const videoBlock = extractToolBlock('generate_video')
    const modelBlock = extractToolBlock('generate_model3d')
    expect(imageBlock).toMatch(/Cache\/Images/)
    expect(videoBlock).toMatch(/Cache\/Videos/)
    expect(modelBlock).toMatch(/Cache\/Models/)
    expect(imageBlock).toMatch(/保存到资产库/)
    expect(videoBlock).toMatch(/保存到资产库/)
    expect(modelBlock).toMatch(/保存到资产库/)
  })
})

describe('MCP 对话生成工具 handler 不再 settle 入库', () => {
  it('generate_image / generate_video / generate_model3d 的 settle 钩子置 undefined', () => {
    for (const toolName of ['generate_image', 'generate_video', 'generate_model3d']) {
      const block = extractToolBlock(toolName)
      // runGenActivity 的第四个位置（settle 钩子）现在被显式置 undefined
      // 形如 ",\n        undefined,\n"，紧跟在 describe 回调之后
      expect(
        block,
        `${toolName} handler 没有把 settle 钩子置 undefined`
      ).toMatch(/,\s*\n\s*undefined,\s*\n/)
    }
  })
})