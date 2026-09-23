import { afterEach, describe, expect, it } from 'vitest'
import {
  clearActiveHarnessRunState,
  resolveHarnessAwareAccessView,
  setActiveHarnessRunState,
  type HarnessRunAccessState
} from '../src/shared/harnessActiveRunAccess'
import { denialReasonForTool, isToolVisible } from '../src/shared/mcpModeAccess'

describe('常驻 harness active-run 授权视图', () => {
  afterEach(() => {
    clearActiveHarnessRunState()
  })

  it('无 active-run 时回退 headers；无 headers 则外部客户端无限制', () => {
    const map = new Map<string, HarnessRunAccessState>()
    expect(resolveHarnessAwareAccessView(undefined, map)).toEqual({})
    expect(isToolVisible('write', resolveHarnessAwareAccessView(undefined, map))).toBe(true)

    map.set('9', { mode: 'plan', confirmed: false })
    const view = resolveHarnessAwareAccessView({ mode: 'plan', runId: '9' }, map)
    expect(view).toEqual({ mode: 'plan', confirmed: false })
    expect(denialReasonForTool('generate', view)).toContain('Plan')
  })

  it('active-run 优先于 sticky headers（常驻进程冻住的 craft/0）', () => {
    const map = new Map<string, HarnessRunAccessState>()
    map.set('42', { mode: 'ask', confirmed: false })
    setActiveHarnessRunState('42', 'ask')
    const view = resolveHarnessAwareAccessView({ mode: 'craft', runId: '0' }, map)
    expect(view).toEqual({ mode: 'ask', confirmed: false })
    expect(isToolVisible('read', view)).toBe(false)
    expect(denialReasonForTool('read', view)).toContain('Ask')
  })

  it('Plan 确认后同一 runId 放行写/生成', () => {
    const map = new Map<string, HarnessRunAccessState>()
    map.set('7', { mode: 'plan', confirmed: true })
    setActiveHarnessRunState('7', 'plan')
    const view = resolveHarnessAwareAccessView({ mode: 'craft', runId: '0' }, map)
    expect(view.confirmed).toBe(true)
    expect(denialReasonForTool('write', view)).toBeNull()
    expect(denialReasonForTool('generate', view)).toBeNull()
  })

  it('clear 后恢复 headers 语义', () => {
    const map = new Map<string, HarnessRunAccessState>()
    setActiveHarnessRunState('1', 'ask')
    clearActiveHarnessRunState()
    expect(resolveHarnessAwareAccessView({ mode: 'craft', runId: '1' }, map)).toEqual({
      mode: 'craft',
      confirmed: false
    })
  })
})
