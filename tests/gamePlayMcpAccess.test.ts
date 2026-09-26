import { describe, expect, it } from 'vitest'
import { denialReasonForTool, isToolVisible, toolAccessOf } from '../src/shared/mcpModeAccess'

/**
 * 可玩 HTML 三个工具的授权分级：入参来自模型、代价是一次 npm 构建，所以
 * `gameplay_build` 必须按生成类收口（Plan 模式确认前不可用、Ask 模式不可见），
 * `gameplay_job_status` 必须是只读（Plan 模式规划阶段也要能轮询）。
 * 这条约束写在这里而不是只写在工具描述里——模式是硬约束，不是提示词。
 */
describe('gameplay 工具的 MCP 模式分级', () => {
  it('prepare = write / build = generate / status = read', () => {
    expect(toolAccessOf('gameplay_prepare_project')).toBe('write')
    expect(toolAccessOf('gameplay_build')).toBe('generate')
    expect(toolAccessOf('gameplay_job_status')).toBe('read')
  })

  it('Ask 模式下三个工具都不可见', () => {
    for (const name of ['gameplay_prepare_project', 'gameplay_build', 'gameplay_job_status']) {
      expect(isToolVisible(toolAccessOf(name), { mode: 'ask' })).toBe(false)
      expect(denialReasonForTool(toolAccessOf(name), { mode: 'ask' })).toBeTruthy()
    }
  })

  it('Plan 模式未确认时只有 status 可见，确认后三者都放行', () => {
    expect(isToolVisible(toolAccessOf('gameplay_job_status'), { mode: 'plan' })).toBe(true)
    expect(isToolVisible(toolAccessOf('gameplay_build'), { mode: 'plan' })).toBe(false)
    expect(isToolVisible(toolAccessOf('gameplay_prepare_project'), { mode: 'plan' })).toBe(false)
    expect(denialReasonForTool(toolAccessOf('gameplay_build'), { mode: 'plan' })).toBeTruthy()

    for (const name of ['gameplay_prepare_project', 'gameplay_build', 'gameplay_job_status']) {
      expect(isToolVisible(toolAccessOf(name), { mode: 'plan', confirmed: true })).toBe(true)
      expect(denialReasonForTool(toolAccessOf(name), { mode: 'plan', confirmed: true })).toBeNull()
    }
  })

  it('外部客户端（无模式头）不受限', () => {
    expect(isToolVisible(toolAccessOf('gameplay_build'), {})).toBe(true)
    expect(toolAccessOf('gameplay_build')).toBe('generate')
  })
})
