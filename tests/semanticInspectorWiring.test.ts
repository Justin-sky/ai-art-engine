import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 语义 dive「轨道选中 / 复刻规划编辑 → 右侧检查器与落盘」的接线守卫。
 */
const read = (rel: string): string =>
  readFileSync(join(process.cwd(), rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')

const dive = read('src/renderer/src/components/dive/EditorDiveSemanticTimelineView.vue')
const editor = read('src/renderer/src/components/SemanticTimelineEditor.vue')
const panels = read('src/renderer/src/components/dive/SemanticBreakdownWorkspacePanels.vue')
const inspector = read(
  'src/renderer/src/components/semanticInspector/SemanticSelectionInspector.vue'
)

describe('语义 dive 检查器接线', () => {
  it('单一编辑入口：轨道与复刻规划面板的修改均上抛到 dive 的 applyEdit', () => {
    expect(
      existsSync(join(process.cwd(), 'src/renderer/src/components/SemanticEditPanel.vue'))
    ).toBe(false)
    expect(dive).not.toContain('SemanticEditPanel')
    expect(dive).toMatch(/<SemanticTimelineEditor[\s\S]*?@edit="applyEdit"/)
    expect(dive).toMatch(/<SemanticBreakdownWorkspacePanels[\s\S]*?@edit="applyEdit"/)
    expect(panels).toContain("op: 'unit.prompt'")
    expect(editor).toMatch(/<SemanticSelectionInspector[\s\S]*?@edit="onEdit"/)
    expect(editor).toContain("emit('edit', input)")
  })

  it('实体替换的参考图候选只来自分析节点「参考图」端口，不列资产库', () => {
    expect(dive).toContain('SEMANTIC_REFERENCE_IMAGES_PORT_ID')
    expect(dive).toContain('candidatesFromSourceNode(')
    expect(dive).not.toContain('project.assets')
    expect(dive).not.toContain('useProjectStore')
  })

  it('三类核心对象由检查器分发到各自表单，旧事件/节拍/意图表单已彻底移除', () => {
    for (const form of ['ShotForm', 'DialogueForm', 'EntityForm']) {
      expect(inspector, `缺少 ${form}`).toContain(`<${form}`)
    }
    for (const removed of ['EventForm', 'BeatForm', 'IntentForm']) {
      expect(inspector).not.toContain(removed)
      expect(
        existsSync(
          join(process.cwd(), `src/renderer/src/components/semanticInspector/${removed}.vue`)
        )
      ).toBe(false)
    }
  })

  it('镜头轨、合批单元轨与台词轨均可点选', () => {
    expect(editor).toContain('@click="selectShot(shot)"')
    expect(editor).toContain('@click="selectUnitBlock(ub)"')
    expect(editor).toContain('@click="selectDialogue(line)"')
    expect(editor).toContain('dirty: diff.dirtyShots.has(shot.id)')
    expect(editor).toContain('dirty: diff.dirtyDialogue.has(line.id)')
  })

  it('落盘串行且只存最新；失败时从磁盘重载，不回滚到旧快照', () => {
    expect(dive).toContain('saveChain = saveChain.then(')
    expect(dive).toContain('if (saveQueued) return')
    expect(dive).toContain('const disk = await readDiskTimeline(doc.id)')
    expect(dive).not.toContain('timeline.value = before')
  })

  it('键盘：输入控件里不拦截；Delete 在镜头删除与恢复间切换', () => {
    expect(editor).toContain('@keydown="onKeydown"')
    expect(editor).toContain(
      'target?.closest(\'input, textarea, select, [contenteditable="true"]\')'
    )
    expect(editor).toContain("op: s.item.removed ? 'shot.restore' : 'shot.remove'")
  })
})
