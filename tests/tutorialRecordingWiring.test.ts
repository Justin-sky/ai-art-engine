import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getGraphSkill } from '../src/shared/graph'
import { toolAccessOf } from '../src/shared/mcpModeAccess'
import { TUTORIAL_UI_IDS } from '../src/shared/tutorialUi'

/**
 * 教学视频管道接线守卫：Skill + MCP 工具 + HUD 短 title + 关键 data-tutorial-id。
 */

const ROOT = resolve(__dirname, '..')
const read = (p: string): string => readFileSync(resolve(ROOT, p), 'utf8')

const MCP = read('src/main/services/mcpServerService.ts')
const IPC = read('src/shared/ipc.ts')
const HUD = read('src/renderer/src/components/RecordingHud.vue')
const GRAPH = read('src/renderer/src/components/NodeGraphEditor.vue')
const NODE_CARD = read('src/renderer/src/components/GraphNodeCard.vue')
const COMPOSE = read('src/main/services/tutorialComposeService.ts')
const PERSONA = read('src/main/services/deepseekHarnessService.ts')
const DIVE_HOST = read('src/renderer/src/components/EditorDiveChildHost.vue')
const DIVE_BAR = read('src/renderer/src/components/EditorDiveBar.vue')
const NOTEPAD = read('src/renderer/src/components/GraphTextNotepadDialog.vue')
const SFW = read('src/renderer/src/components/StudioFloatingWindow.vue')

describe('教学视频：GraphSkill tutorial.recording', () => {
  it('内置技能存在且 usage 写全链路', () => {
    const skill = getGraphSkill('tutorial.recording')
    expect(skill?.kind).toBe('tutorial')
    for (const token of [
      'screen_record_start',
      'screen_record_step',
      'screen_record_stop',
      'screen_record_wait',
      'tutorial_compose',
      'doDblClick',
      'doContextMenu',
      'fillText',
      'graph-instruction-input',
      'graph-notepad',
      'graph-dive',
      'graph-dive-view-',
      'graph-ctx-type-',
      'graph-run',
      'graph-idle',
      '口播=画面'
    ]) {
      expect(skill?.usageZh, `usageZh 缺 ${token}`).toContain(token)
    }
    for (const token of [
      'screen_record_start',
      'screen_record_step',
      'screen_record_stop',
      'screen_record_wait',
      'tutorial_compose',
      'doDblClick',
      'doContextMenu',
      'fillText',
      'graph-idle',
      'SAY=SHOW'
    ]) {
      expect(skill?.usageEn, `usageEn 缺 ${token}`).toContain(token)
    }
  })
})

describe('教学视频：MCP 工具与访问等级', () => {
  it('tutorial_compose / ui_bounds / ui_click 已登记', () => {
    for (const name of ['tutorial_compose', 'ui_bounds', 'ui_click']) {
      expect(MCP, `缺工具 ${name}`).toContain(`name: '${name}'`)
    }
    expect(toolAccessOf('ui_bounds')).toBe('read')
    expect(toolAccessOf('ui_click')).toBe('write')
    expect(toolAccessOf('tutorial_compose')).toBe('generate')
    expect(IPC).toContain("| 'tutorial_compose'")
  })

  it('graph_edit 支持 openEditor / autoLayout / node_select', () => {
    const at = MCP.indexOf("name: 'graph_edit'")
    const block = MCP.slice(at, at + 3200)
    expect(block).toContain('openEditor')
    expect(block).toContain('autoLayout')
    expect(block).toContain("'node_select'")
    expect(IPC).toContain('openEditor?: boolean')
    expect(IPC).toContain('autoLayout?: boolean')
    expect(IPC).toContain("| { op: 'node_select'; nodeId: string }")
  })

  it('screen_record_step 支持可见交互（click/dblclick/contextmenu/fill）', () => {
    const at = MCP.indexOf("name: 'screen_record_step'")
    const block = MCP.slice(at, at + 6500)
    expect(block).toContain('doClick')
    expect(block).toContain('doDblClick')
    expect(block).toContain('doContextMenu')
    expect(block).toContain('fillText')
    expect(block).toContain('clickTutorialUi')
    expect(block).toContain('fillTutorialUi')
    expect(block).toContain('graph-run')
  })

  it('screen_record_wait 可等到 graph-idle', () => {
    expect(MCP).toContain("name: 'screen_record_wait'")
    const at = MCP.indexOf("name: 'screen_record_wait'")
    const block = MCP.slice(at, at + 2000)
    expect(block).toContain('graph-idle')
    expect(block).toContain('queryGraphIsRunning')
  })
})

describe('教学视频：旁白 / HUD / 字幕不叠字', () => {
  it('HUD 渲染详细 caption 字卡', () => {
    expect(HUD).toContain('class="hud-title"')
    expect(HUD).toContain('class="hud-caption"')
  })

  it('compose 铺 subtitle 轨且用 narration', () => {
    expect(COMPOSE).toContain("track: 'subtitle'")
    expect(COMPOSE).toContain("track: 'voice'")
    expect(COMPOSE).toContain('narration')
  })

  it('skill 要求可见改参 / 等结果 / 禁止静默冒充', () => {
    const skill = getGraphSkill('tutorial.recording')
    expect(skill?.usageZh).toContain('task_run')
    expect(skill?.usageZh).toContain('doDblClick')
    expect(skill?.usageZh).toContain('screen_record_wait')
    expect(skill?.usageZh).toContain('graph-instruction-input')
    expect(skill?.usageZh).toContain('graph-ctx-type-')
    expect(skill?.usageEn).toContain('doDblClick')
    expect(skill?.usageEn).toContain('SAY=SHOW')
    expect(skill?.usageEn).toContain('screen_record_wait')
  })
})

describe('教学视频：data-tutorial-id 最小集合', () => {
  it('图编辑器 / 节点卡 / 指令面板打上稳定 id；右键菜单走派生规则', () => {
    for (const id of ['graph-canvas', 'graph-toolbar', 'graph-run', 'graph-ctx-menu'] as const) {
      expect(GRAPH, `NodeGraphEditor 缺 data-tutorial-id=${id}`).toContain(
        `data-tutorial-id="${id}"`
      )
    }
    expect(GRAPH).toContain('tutorialCtxTypeId')
    expect(GRAPH).toContain('tutorialCtxGroupId')
    expect(NODE_CARD).toContain(
      ':data-tutorial-id="selected ? \'graph-selected-node\' : undefined"'
    )
    expect(NODE_CARD).toContain('data-tutorial-id="graph-instruction-panel"')
    expect(TUTORIAL_UI_IDS).toContain('graph-selected-node')
    expect(TUTORIAL_UI_IDS).toContain('graph-instruction-input')
    expect(TUTORIAL_UI_IDS).toContain('graph-gen-params')
    expect(TUTORIAL_UI_IDS).toContain('graph-model-select')
    expect(TUTORIAL_UI_IDS).toContain('graph-dive')
    expect(TUTORIAL_UI_IDS).toContain('graph-notepad')
  })

  it('dive / 记事本 / 浮窗挂上教学锚点', () => {
    expect(DIVE_HOST).toContain('data-tutorial-id="graph-dive"')
    expect(DIVE_HOST).toContain('tutorialDiveViewId')
    expect(DIVE_BAR).toContain('data-tutorial-id="graph-dive-bar"')
    expect(DIVE_BAR).toContain('data-tutorial-id="graph-dive-up"')
    expect(NOTEPAD).toContain('tutorial-id="graph-notepad"')
    expect(NOTEPAD).toContain('data-tutorial-id="graph-notepad-input"')
    expect(SFW).toContain('tutorialFloatingIdKey')
    expect(SFW).toContain('resolvedTutorialId')
  })
})

describe('教学视频：persona 挂钩', () => {
  it('harness persona 提到 tutorial-recording 与 tutorial_compose', () => {
    expect(PERSONA).toContain('tutorial-recording')
    expect(PERSONA).toContain('tutorial_compose')
  })
})
