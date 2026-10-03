import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BUILTIN_NODE_TYPES, getNodePorts, listAddableNodeTypes } from '../src/shared/graph'

/**
 * `image.portrait` 的 dive 接线完整性（源码文本断言）。
 *
 * 为什么用文本断言而不是行为测试：dive 工具视图的接线散在 6 个文件的十余处
 * （两处联合类型、viewRegistry、模板分支、三个 switch、openers、graphDialogsApi ×2、
 * 卡片双击与两处预览白名单），而**没有任何运行时测试覆盖它们** —— 漏一处的表现是
 * 「双击没反应」「进去白屏」「打开即被弹回」，全都不报错。历史上
 * `EditorDiveNodeToolHost` 的 `toolOpen` 漏写就是这样静默坏掉的。
 *
 * 这些断言锁的是「接线没被删」而不是具体实现，改动实现时同步改断言即可。
 */

const ROOT = join(__dirname, '..')
const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8')

describe('image.portrait dive 接线', () => {
  it('节点类型已注册且可添加（右键菜单 / MCP graph_node_types 同源）', () => {
    const def = BUILTIN_NODE_TYPES.find((item) => item.typeId === 'image.portrait')
    expect(def, 'image.portrait 未注册').toBeTruthy()
    expect(def?.addable).toBe(true)
    expect(def?.inspectorId).toBe('studio.graph.portrait')
    expect(String(def?.description ?? '').length).toBeGreaterThan(20)
    expect(listAddableNodeTypes().some((item) => item.typeId === 'image.portrait')).toBe(true)
    const ports = getNodePorts('image.portrait').map((port) => `${port.id}:${port.direction}`)
    // 图片节点在注册表里会被补上标准输入槽（in-image），输出走图库口
    expect(ports).toContain('in-image:in')
    expect(ports).toContain('out:out')
  })

  it('editorDive 的两处联合类型都认这个 viewId', () => {
    const source = read('src/renderer/src/features/graph/model/editorDive.ts')
    expect(source).toMatch(/EditorDiveViewId =[\s\S]*?'node\.portrait'/)
    // Extract 白名单：漏写会被 vue-tsc 挡住，但这里也锁一道
    expect(source).toMatch(/EditorDiveNodeToolViewId = Extract<[\s\S]*?'node\.portrait'/)
  })

  it('EditorDiveChildHost 注册了视图组件', () => {
    const source = read('src/renderer/src/components/EditorDiveChildHost.vue')
    expect(source).toMatch(/'node\.portrait': defineAsyncComponent/)
  })

  it('EditorDiveNodeToolHost 的五个分支齐全（模板 + toolOpen + closeCurrent + flush）', () => {
    const source = read('src/renderer/src/components/dive/EditorDiveNodeToolHost.vue')
    expect(source).toMatch(/viewId === 'node\.portrait'/)
    expect(source).toContain('PortraitEditorDialog')
    expect(source).toMatch(/case 'node\.portrait':\s*\n\s*return current\.portrait\.open/)
    expect(source).toMatch(/case 'node\.portrait':\s*\n\s*current\.closePortrait\(\)/)
    expect(source).toMatch(/case 'node\.portrait':\s*\n\s*current\.flushPortrait\(\)/)
  })

  it('GraphEditorDialogsApi 有 portrait 状态块与全部方法', () => {
    const source = read('src/renderer/src/features/graph/ui/graphEditorDialogsKey.ts')
    expect(source).toMatch(
      /portrait: \{[\s\S]*?aiRunning: boolean[\s\S]*?aiError: string[\s\S]*?\n  \}/
    )
    for (const method of [
      'closePortrait: () => void',
      'previewPortrait: (payload: unknown) => void',
      'savePortrait: (payload: unknown) => void',
      'flushPortrait: () => void',
      'runPortraitAi: (payload: unknown) => void'
    ]) {
      expect(source, `缺少 ${method}`).toContain(method)
    }
  })

  it('NodeGraphEditor 注册了 openers 与 graphDialogsApi 两处', () => {
    const source = read('src/renderer/src/components/NodeGraphEditor.vue')
    expect(source).toContain("'node.portrait': (nodeId) => onPortraitOpen(nodeId)")
    expect(source).toMatch(/^\s{2}portrait,$/m)
    for (const name of [
      'closePortrait,',
      'previewPortrait,',
      'savePortrait,',
      'flushPortrait,',
      'runPortraitAi,'
    ]) {
      expect(source, `graphDialogsApi 缺少 ${name}`).toContain(name)
    }
    expect(source).toMatch(/async function onPortraitOpen\(/)
    // 实时预览 + 撤销记录（dive 回退前 flush 补记）
    expect(source).toMatch(/function flushPortrait\(\)/)
    expect(source).toContain("recordGraphChange('portrait', before)")
  })

  it('节点卡片的双击、提示与两处预览白名单都接上了', () => {
    const source = read('src/renderer/src/components/GraphNodeCard.vue')
    expect(source).toMatch(
      /isPortraitEditorNode\(props\.node\)\) \{\s*\n\s*await diveNodeTool\('node\.portrait'/
    )
    expect(source).toContain("t('graph.portrait.hint')")
    // 预览图渲染白名单 + selectImagePreview 依赖白名单（缺一卡片就没有缩略图）
    expect(source.match(/isPortraitEditorNode\(/g)?.length ?? 0).toBeGreaterThanOrEqual(4)
  })

  it('渲染层部署了能力缝实现并在两条运行通路都注入', () => {
    const bake = read('src/renderer/src/features/graph/model/portraitBake.ts')
    expect(bake).toContain('export async function bakePortraitRetouch')
    expect(bake).toContain('export async function detectPortraitFaces')
    for (const file of [
      'src/renderer/src/features/graph/controllers/useGraphRunSession.ts',
      'src/renderer/src/stores/graphTasks.ts'
    ]) {
      const source = read(file)
      expect(source, `${file} 未注入 bakePortraitRetouch`).toContain('bakePortraitRetouch,')
      expect(source, `${file} 未注入 detectPortraitFaces`).toContain('detectPortraitFaces,')
    }
  })

  it('执行器缺能力缝时明确报错（不透传上游）', () => {
    const source = read('src/shared/graph/execute/portrait.ts')
    expect(source).toContain('capabilityPortraitBake')
    expect(source).toMatch(/if \(!ctx\.bakePortraitRetouch\)/)
  })
})
