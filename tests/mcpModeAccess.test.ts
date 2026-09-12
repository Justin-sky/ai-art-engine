import { describe, expect, it } from 'vitest'
import {
  accessHeaders,
  denialReasonForTool,
  isCancelAnswer,
  isChatMode,
  isToolVisible,
  normalizeChatMode,
  toolAccessOf,
  type McpAccessView
} from '../src/shared/mcpModeAccess'

describe('对话模式的 MCP 工具授权分级（shared）', () => {
  it('模式归一化：合法值原样返回，非法 / 缺省 / 非字符串按 craft', () => {
    expect(normalizeChatMode('ask')).toBe('ask')
    expect(normalizeChatMode('plan')).toBe('plan')
    expect(normalizeChatMode('craft')).toBe('craft')
    // 外部客户端乱传的头不能让服务进入未知状态：一律落到 craft（不额外限制）
    expect(normalizeChatMode('Craft')).toBe('craft')
    expect(normalizeChatMode('hacker')).toBe('craft')
    expect(normalizeChatMode(undefined)).toBe('craft')
    expect(normalizeChatMode(null)).toBe('craft')
    expect(normalizeChatMode(3)).toBe('craft')

    expect(isChatMode('plan')).toBe(true)
    expect(isChatMode('plan ')).toBe(false)
  })

  it('工具副作用分级：只读 / 生成类逐条登记，未登记的一律按 write（安全侧兜底）', () => {
    expect(toolAccessOf('asset_read_file')).toBe('read')
    expect(toolAccessOf('graph_read')).toBe('read')
    expect(toolAccessOf('timeline_preview')).toBe('read')
    expect(toolAccessOf('asset_qc')).toBe('read')
    // Plan 模式要靠它拿确认，必须可见
    expect(toolAccessOf('ask_user')).toBe('read')

    expect(toolAccessOf('generate_image')).toBe('generate')
    expect(toolAccessOf('generate_video')).toBe('generate')
    expect(toolAccessOf('workflow_plan')).toBe('generate')
    // 转写走 ASR 模型、消耗额度，与生成同类
    expect(toolAccessOf('transcribe_audio')).toBe('generate')

    expect(toolAccessOf('graph_edit')).toBe('write')
    expect(toolAccessOf('task_run')).toBe('write')
    expect(toolAccessOf('asset_delete')).toBe('write')
    // 新增工具忘登记也不会变成越权口子：默认 write
    expect(toolAccessOf('brand_new_tool')).toBe('write')
  })

  it('无模式声明（外部 Agent / stdio 桥）不做任何限制', () => {
    const view: McpAccessView = {}
    for (const access of ['read', 'write', 'generate'] as const) {
      expect(isToolVisible(access, view)).toBe(true)
      expect(denialReasonForTool(access, view)).toBeNull()
    }
  })

  it('craft：工具全可见、调全放行', () => {
    const view: McpAccessView = { mode: 'craft' }
    expect(isToolVisible('generate', view)).toBe(true)
    expect(isToolVisible('write', view)).toBe(true)
    expect(denialReasonForTool('write', view)).toBeNull()
  })

  it('ask：工具面全空，且连只读调用也拒（persona 说了不算，这里说了算）', () => {
    const view: McpAccessView = { mode: 'ask' }
    for (const access of ['read', 'write', 'generate'] as const) {
      expect(isToolVisible(access, view)).toBe(false)
      expect(denialReasonForTool(access, view)).toContain('Ask 模式')
    }
    // 拒绝文案要给模型下一步：切到 Craft / Plan
    expect(denialReasonForTool('write', view)).toContain('Craft')
  })

  it('plan 未确认：只放只读，写 / 生成类不可见且被拒', () => {
    const view: McpAccessView = { mode: 'plan', confirmed: false }
    expect(isToolVisible('read', view)).toBe(true)
    expect(denialReasonForTool('read', view)).toBeNull()

    for (const access of ['write', 'generate'] as const) {
      expect(isToolVisible(access, view)).toBe(false)
      expect(denialReasonForTool(access, view)).toContain('ask_user_question')
    }
  })

  it('plan 已确认（用户点了 Proceed）：写 / 生成类随即放行', () => {
    const view: McpAccessView = { mode: 'plan', confirmed: true }
    expect(isToolVisible('write', view)).toBe(true)
    expect(isToolVisible('generate', view)).toBe(true)
    expect(denialReasonForTool('generate', view)).toBeNull()
  })

  it('plan 缺 confirmed 字段按未确认处理（登记表里查不到 runId 时也不能越权）', () => {
    const view: McpAccessView = { mode: 'plan' }
    expect(isToolVisible('write', view)).toBe(false)
    expect(denialReasonForTool('write', view)).not.toBeNull()
  })

  it('取消语义：null / Cancel / 取消 视为未确认，Proceed / 继续 视为确认', () => {
    for (const answer of [null, undefined, '', 'Cancel', '取消', '停止执行', 'No', '放弃这一步']) {
      expect(isCancelAnswer(answer)).toBe(true)
    }
    for (const answer of ['Proceed', '继续', 'Adjust plan', '按这个计划做']) {
      expect(isCancelAnswer(answer)).toBe(false)
    }
  })

  it('模式头载荷：值一律是字符串（dsh-mcp-client 的 headers schema 只收 string）', () => {
    // 曾经踩过的坑：runId 以数字写进 cordis.patch.yml，YAML 把它解析成 number，
    // mcp-client 配置校验失败 → 整棵插件树加载失败，面板上表现为每次发消息都「异常退出」。
    const headers = accessHeaders('ask', '7')
    expect(headers).toEqual({ 'x-aiart-mode': 'ask', 'x-aiart-run-id': '7' })
    for (const value of Object.values(headers)) expect(typeof value).toBe('string')
    // 传数字也必须收成字符串（类型上不设防的调用点在这里兜底）
    expect(accessHeaders('plan', 42 as unknown as string)['x-aiart-run-id']).toBe('42')
  })
})
