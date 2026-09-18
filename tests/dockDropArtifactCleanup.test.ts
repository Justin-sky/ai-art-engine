import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DockviewApi } from 'dockview-vue'
import {
  handleSidePanelLayoutMaybeStacked,
  handleSidePanelMoved,
  noteSidePanelWillStackDrop,
  registerSidePanelDockApi
} from '../src/renderer/src/editor/workbench/sidePanelCollapse'

/** 最小 DOM 替身：只实现 clearDockviewDropOverlays 用到的查询 / 移除 / classList */
class FakeNode {
  readonly classes: string[]
  private parent: FakeNode | null = null
  private readonly children: FakeNode[] = []
  removed = false

  constructor(...classes: string[]) {
    this.classes = [...classes]
  }

  append(child: FakeNode): FakeNode {
    child.parent = this
    this.children.push(child)
    return child
  }

  get classList() {
    return {
      remove: (name: string): void => {
        const at = this.classes.indexOf(name)
        if (at >= 0) this.classes.splice(at, 1)
      }
    }
  }

  remove(): void {
    this.removed = true
    if (!this.parent) return
    const at = this.parent.children.indexOf(this)
    if (at >= 0) this.parent.children.splice(at, 1)
  }

  querySelectorAll(selector: string): FakeNode[] {
    const wanted = selector.replace(/^\./, '')
    const hits: FakeNode[] = []
    for (const child of this.children) {
      if (child.classes.includes(wanted)) hits.push(child)
      hits.push(...child.querySelectorAll(selector))
    }
    return hits
  }

  querySelector(selector: string): FakeNode | null {
    return this.querySelectorAll(selector)[0] ?? null
  }
}

type Box = { left: number; top: number; width: number; height: number }

type FakePanelOptions = {
  id: 'assets' | 'inspector'
  groupId: string
  width: number
  box: Box
  calls: string[]
}

function fakeDropTarget(calls: string[], label: string) {
  return {
    setTargetZones: (zones: string[]): void => {
      calls.push(`${label}:zones:${zones.join(',')}`)
    },
    setOverlayModel: (): void => {
      calls.push(`${label}:overlay`)
    }
  }
}

/** 只实现 handleSidePanelMoved / configureSidePanelStackDropTargets 触及的 API 面 */
function fakeSidePanel(options: FakePanelOptions) {
  const { id, groupId, calls } = options
  const groupApi = {
    boundingBox: options.box,
    width: options.width,
    setConstraints: (): void => {
      calls.push(`${id}:group:setConstraints`)
    },
    setSize: (): void => {
      calls.push(`${id}:group:setSize`)
    }
  }
  const api = {
    id,
    width: options.width,
    group: {
      id: groupId,
      api: groupApi,
      model: {
        contentContainer: {
          dropTarget: fakeDropTarget(calls, `${id}:content`),
          pointerDropTarget: fakeDropTarget(calls, `${id}:pointer`)
        }
      },
      panels: [] as Array<{ id: string }>
    },
    setConstraints: (): void => {
      calls.push(`${id}:setConstraints`)
    },
    setSize: (): void => {
      calls.push(`${id}:setSize`)
    },
    setActive: (): void => {
      calls.push(`${id}:setActive`)
    },
    onDidDimensionsChange: () => ({ dispose: () => undefined })
  }
  const group = api.group
  group.panels = [{ id }]
  return { id, api, group }
}

function fakeDock(panels: Record<string, unknown>): DockviewApi {
  return { getPanel: (id: string) => panels[id] } as unknown as DockviewApi
}

const STACKED_GEOMETRY = {
  assets: { left: 1200, top: 0, width: 400, height: 400 },
  inspector: { left: 1200, top: 420, width: 400, height: 400 }
}

let studioDock: FakeNode
let frames: Array<() => void>

function flushAnimationFrames(): void {
  for (let i = 0; i < 8 && frames.length > 0; i++) {
    const pending = frames
    frames = []
    for (const cb of pending) cb()
  }
}

beforeEach(() => {
  studioDock = new FakeNode('studio-dock')
  frames = []
  const globals = globalThis as unknown as Record<string, unknown>
  globals.document = {
    querySelector: (selector: string) => (selector === '.studio-dock' ? studioDock : null)
  }
  globals.requestAnimationFrame = (cb: (time: number) => void) => {
    frames.push(() => cb(0))
    return frames.length
  }
  globals.window = {
    innerWidth: 1600,
    setTimeout: (cb: () => void, ms: number) => setTimeout(cb, ms)
  }
})

afterEach(() => {
  registerSidePanelDockApi(null)
  const globals = globalThis as unknown as Record<string, unknown>
  delete globals.document
  delete globals.requestAnimationFrame
  delete globals.window
})

function buildStackedDock(calls: string[], widths: { assets: number; inspector: number }) {
  const assets = fakeSidePanel({
    id: 'assets',
    groupId: 'group-assets',
    width: widths.assets,
    box: STACKED_GEOMETRY.assets,
    calls
  })
  const inspector = fakeSidePanel({
    id: 'inspector',
    groupId: 'group-inspector',
    width: widths.inspector,
    box: STACKED_GEOMETRY.inspector,
    calls
  })
  return { dock: fakeDock({ assets, inspector }), assets, inspector }
}

describe('handleSidePanelMoved 落点覆盖层收尾', () => {
  it('AI 对话等普通页签拖到侧栏上时清掉落点灰框，且不做侧栏列宽归一', () => {
    const calls: string[] = []
    const { dock, assets } = buildStackedDock(calls, { assets: 380, inspector: 380 })
    const stale = studioDock.append(new FakeNode('dv-drop-target-container'))
    const marked = studioDock.append(new FakeNode('dv-drop-target'))

    handleSidePanelMoved(dock, 'chat')

    expect(stale.removed).toBe(true)
    expect(marked.classes).not.toContain('dv-drop-target')
    // 侧栏落点配置被重新断言（group location 变更会重置 zones）
    expect(calls).toContain('assets:content:zones:top,bottom,center')
    expect(calls).toContain('assets:content:overlay')
    // 普通页签不参与侧栏列宽归一，也不做防御性激活
    expect(calls.filter((call) => call.includes('setConstraints'))).toEqual([])
    expect(calls.filter((call) => call.includes('setSize'))).toEqual([])
    expect(calls.filter((call) => call.endsWith(':setActive'))).toEqual([])
    expect(assets.api.group.panels).toEqual([{ id: 'assets' }])
  })

  it('dockview 在下一帧重建的覆盖层同样被清掉', () => {
    const calls: string[] = []
    const { dock } = buildStackedDock(calls, { assets: 380, inspector: 380 })

    handleSidePanelMoved(dock, 'chat')
    const rebuilt = studioDock.append(new FakeNode('dv-drop-target-container'))
    flushAnimationFrames()

    expect(rebuilt.removed).toBe(true)
  })
})

describe('noteSidePanelWillStackDrop 只服务侧栏互拖', () => {
  it('普通页签拖到侧栏上不武装列宽归一，侧栏互拖仍然归一', () => {
    const calls: string[] = []
    const { dock, assets, inspector } = buildStackedDock(calls, { assets: 380, inspector: 380 })

    // 1) AI 对话拖到资产下方：willDrop 时不武装归一窗口，落位后列宽再被加成 1 列也不修正
    noteSidePanelWillStackDrop(dock, 'bottom', assets.group, 'chat')
    assets.api.width = 800
    inspector.api.width = 800
    handleSidePanelLayoutMaybeStacked(dock)
    flushAnimationFrames()
    expect(calls.filter((call) => call.includes('setSize'))).toEqual([])

    // 2) 侧栏互拖：同样记下叠放前宽度、同样出现「两栏被加成 1 列」，必须归一
    assets.api.width = 380
    inspector.api.width = 380
    noteSidePanelWillStackDrop(dock, 'bottom', assets.group, 'assets')
    assets.api.width = 800
    inspector.api.width = 800
    handleSidePanelLayoutMaybeStacked(dock)
    flushAnimationFrames()
    expect(calls.some((call) => call.endsWith(':group:setSize'))).toBe(true)
    expect(calls.some((call) => call.endsWith(':setConstraints'))).toBe(true)
  })
})
