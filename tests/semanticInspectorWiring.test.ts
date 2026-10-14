import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 语义 dive「轨道选中 → 右侧检查器编辑」的接线守卫。
 * 组件在 node 环境渲染不了（无 jsdom），按仓库既有做法做源码守卫；注释先剥掉，免得假通过。
 */
const read = (rel: string): string =>
  readFileSync(join(process.cwd(), rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')

const dive = read('src/renderer/src/components/dive/EditorDiveSemanticTimelineView.vue')
const editor = read('src/renderer/src/components/SemanticTimelineEditor.vue')
const inspector = read(
  'src/renderer/src/components/semanticInspector/SemanticSelectionInspector.vue'
)

describe('语义 dive 检查器接线', () => {
  it('单一编辑入口：全量修改面板已下线，修改经编辑器上抛到 dive 应用', () => {
    expect(
      existsSync(join(process.cwd(), 'src/renderer/src/components/SemanticEditPanel.vue'))
    ).toBe(false)
    expect(dive).not.toContain('SemanticEditPanel')
    expect(dive).toMatch(/<SemanticTimelineEditor[\s\S]*?@edit="applyEdit"/)
    expect(editor).toMatch(/<SemanticSelectionInspector[\s\S]*?@edit="onEdit"/)
    expect(editor).toContain("emit('edit', input)")
  })

  it('实体替换的参考图候选只来自分析节点「参考图」端口，不列资产库', () => {
    expect(dive).toContain('SEMANTIC_REFERENCE_IMAGES_PORT_ID')
    expect(dive).toContain('candidatesFromSourceNode(')
    expect(dive).not.toContain('project.assets')
    expect(dive).not.toContain('useProjectStore')
  })

  it('六类对象都由检查器分发到各自表单', () => {
    for (const form of [
      'ShotForm',
      'DialogueForm',
      'EventForm',
      'BeatForm',
      'IntentForm',
      'EntityForm'
    ]) {
      expect(inspector, `缺少 ${form}`).toContain(`<${form}`)
    }
  })

  it('镜头轨与台词轨可点选（重建的直接单位）', () => {
    expect(editor).toContain('@click="selectShot(shot)"')
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

  it('键盘：输入控件里不拦截；Delete 对事件 / 意图只请求确认，不直接删', () => {
    expect(editor).toContain('@keydown="onKeydown"')
    expect(editor).toContain(
      'target?.closest(\'input, textarea, select, [contenteditable="true"]\')'
    )
    expect(editor).toContain('armDelete.value += 1')
    expect(editor).not.toMatch(/op: 'event\.remove'/)
  })
})
