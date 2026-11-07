import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 视频重制节点（`semantic.rebuild`）界面接线守卫：
 * 1. inspector 注册表指向 `SemanticTimelineInspector`；
 * 2. 检查器提供三种重制策略（`remakeStrategy`）、锚点首帧生成开关（`rebuildGenerateAnchors`）、
 *    实时执行预估（`remakeLiveEstimate`）、数量上限、音轨/字幕/配音与成片预览，并写回节点；
 * 3. 双击重建节点打开视频指令面板，旧重制规划附属控件已彻底移除。
 */
const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8')

const builtins = read('src/renderer/src/inspector/builtins.ts')
const inspector = read('src/renderer/src/components/SemanticTimelineInspector.vue')
const card = read('src/renderer/src/components/GraphNodeCard.vue')

describe('视频重制节点的界面接线', () => {
  it('inspector 注册表指向语义检查器', () => {
    expect(builtins).toMatch(
      /id: 'studio\.graph\.semanticRebuild',\s*\n\s*component: SemanticTimelineInspector,\s*\n\s*nodeTypeId: 'semantic\.rebuild'/
    )
  })

  it('检查器给出三种重制策略 / 锚点开关 / 实时预估 / 上限 / 配音 / 成片预览，且写回节点', () => {
    for (const token of [
      'isRebuild',
      'remakeStrategy',
      'rebuildGenerateAnchors',
      'remakeLiveEstimate',
      'planRemakeExecution',
      'rebuildModelOptions',
      'rebuildModelLabel',
      'rebuildMaxShots',
      'rebuildKeepAudio',
      'rebuildBurnSubtitles',
      'rebuildDub',
      'dubModelKey',
      'rebuildPreviewUrl',
      'rebuildLastReport'
    ]) {
      expect(inspector, token).toContain(token)
    }
    expect(inspector).toMatch(/function persistRebuild\(\): void \{[\s\S]{0,900}?patch\(\{/)
    expect(inspector).toContain('remakeStrategy: remakeStrategy.value')
    expect(inspector).toContain('rebuildGenerateAnchors: rebuildGenerateAnchors.value')
    // 视频模型由指令面板写：检查器的 persistRebuild 不能再写 generateModel
    const persistBody =
      /function persistRebuild\(\): void \{([\s\S]*?)\n\}/.exec(inspector)?.[1] ?? ''
    expect(persistBody).not.toContain('generateModel')
    expect(inspector).toContain("outputs?.['out-video']")
    expect(inspector).toContain('rebuildLastOutput')
    expect(inspector).toMatch(
      /const same = current\.id === loadedNodeId\.value[\s\S]{0,200}?loadConfig\(current\)/
    )
    expect(inspector).toMatch(/syncRebuildFromNode\(\)\n\}/)
    expect(inspector).toContain("loadGenerateModelOptions('video')")
    expect(inspector).toContain("t('graph.inspector.semantic.rebuildPromptPointer')")
  })

  it('双击重建节点打开指令面板（视频模型 + 画面参数）', () => {
    expect(card).toMatch(
      /if \(props\.node\.typeId === 'semantic\.rebuild'\) \{\s*instructionOpen\.value = !instructionOpen\.value\s*return/
    )
    expect(card).toMatch(/case 'semantic\.rebuild':\s*return 'video'/)
    expect(card).toContain("node.typeId === 'semantic.rebuild'\"")
  })

  it('同步回填读到的 ref 都声明在 immediate watcher 之前，不会 TDZ', () => {
    const scriptSetup = /<script setup[^>]*>([\s\S]*?)<\/script>/.exec(inspector)?.[1] ?? ''
    expect(scriptSetup, '找不到 <script setup>').not.toBe('')

    const code = scriptSetup
      .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
      .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length))

    const syncBoundaryAt = code.search(/\{\s*immediate:\s*true/)
    expect(syncBoundaryAt, '找不到 immediate watcher').toBeGreaterThan(-1)

    const readNames = new Set<string>()
    for (const fn of ['loadConfig', 'syncRebuildFromNode']) {
      const open = new RegExp(`function\\s+${fn}\\s*\\(`).exec(code)
      expect(open, `找不到 ${fn}`).toBeTruthy()
      const bodyOpen = code.indexOf('{', open!.index)
      let depth = 0
      let bodyEnd = bodyOpen
      for (let i = bodyOpen; i < code.length; i++) {
        if (code[i] === '{') depth++
        else if (code[i] === '}') {
          depth--
          if (depth === 0) {
            bodyEnd = i
            break
          }
        }
      }
      const body = code.slice(bodyOpen, bodyEnd)
      for (const m of body.matchAll(/\b([a-z][\w$]*)\.value\b/g)) readNames.add(m[1])
    }
    expect(readNames.size).toBeGreaterThan(0)

    const late = [...readNames].filter((name) => {
      const decl = new RegExp(`^(?:const|let)\\s+${name}\\b`, 'm').exec(code)
      return !decl || decl.index > syncBoundaryAt
    })
    expect(late, `这些 ref 声明在 immediate watcher 之后（会 TDZ）：${late.join(', ')}`).toEqual([])
  })

  it('旧重制规划控件已彻底移除，不再残留规则包或词表表单', () => {
    expect(
      existsSync(join(process.cwd(), 'src/renderer/src/components/SemanticCompileControls.vue'))
    ).toBe(false)
    expect(card).not.toContain('SemanticCompileControls')
    expect(inspector).not.toContain('rulePackIds')
    expect(inspector).not.toContain('vocabulary')
  })
})
