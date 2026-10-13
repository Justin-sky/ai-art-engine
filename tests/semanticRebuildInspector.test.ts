import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 语义重建节点的**界面接线**守卫。
 *
 * 节点在引擎里能跑，但界面没接线的话用户既看不到成片、也改不了参数（实测踩过：
 * 面板一片空白、双击只弹一句"还没运行"）。这里钉住三段接线：
 * 1. inspector 注册表把 `semantic.rebuild` 指到语义检查器；
 * 2. 检查器里有模式 / 上限 / 直通 / 配音 / 音轨字幕，并能写回节点；成片在检查器里预览；
 * 3. 双击重建节点打开**指令面板**（选视频模型与画面参数）。
 */
const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8')

const builtins = read('src/renderer/src/inspector/builtins.ts')
const inspector = read('src/renderer/src/components/SemanticTimelineInspector.vue')
const card = read('src/renderer/src/components/GraphNodeCard.vue')

describe('语义重建节点的界面接线', () => {
  it('inspector 注册表指向语义检查器', () => {
    expect(builtins).toMatch(
      /id: 'studio\.graph\.semanticRebuild',\s*\n\s*component: SemanticTimelineInspector,\s*\n\s*nodeTypeId: 'semantic\.rebuild'/
    )
  })

  it('检查器给出模式 / 上限 / 直通开关 / 配音 / 音轨字幕 / 成片预览，且写回节点', () => {
    for (const token of [
      'isRebuild',
      'rebuildMode',
      'rebuildModelOptions',
      'rebuildModelLabel',
      'rebuildMaxShots',
      'rebuildRegenerateAll',
      'rebuildKeepAudio',
      'rebuildBurnSubtitles',
      'rebuildDub',
      'dubModelKey',
      'rebuildPreviewUrl',
      'rebuildLastReport'
    ]) {
      expect(inspector, token).toContain(token)
    }
    // 写回：参数进 patch（不是只改本地 ref）
    expect(inspector).toMatch(/function persistRebuild\(\): void \{[\s\S]{0,700}?patch\(\{/)
    expect(inspector).toContain('rebuildMode: rebuildMode.value')
    expect(inspector).toContain('rebuildRegenerateAll: rebuildRegenerateAll.value')
    // 视频模型由指令面板写：检查器的 persistRebuild 不能再写 generateModel（两处写会互相覆盖）
    const persistBody =
      /function persistRebuild\(\): void \{([\s\S]*?)\n\}/.exec(inspector)?.[1] ?? ''
    expect(persistBody).not.toContain('generateModel')
    // 成片预览：读视频输出口 / 上次成片参数
    expect(inspector).toContain("outputs?.['out-video']")
    expect(inspector).toContain('rebuildLastOutput')
    // 选中节点变化时同步到表单
    expect(inspector).toMatch(
      /const same = current\.id === loadedNodeId\.value[\s\S]{0,200}?loadConfig\(current\)/
    )
    // 注意：要锚定**调用点**（syncRebuildFromNode 的定义也在附近，只写函数名会被定义蒙过去）
    expect(inspector).toMatch(/syncRebuildFromNode\(\)\n\}/)
    // 视频模型（不是文本模型）
    expect(inspector).toContain("loadGenerateModelOptions('video')")
    // 内容 / 提示词在分析节点的修改面板里改：给一句指路
    expect(inspector).toContain("t('graph.inspector.semantic.rebuildPromptPointer')")
  })

  it('双击重建节点打开指令面板（视频模型 + 画面参数），帧模式由计划决定故隐藏', () => {
    expect(card).toMatch(
      /if \(props\.node\.typeId === 'semantic\.rebuild'\) \{\s*instructionOpen\.value = !instructionOpen\.value\s*return/
    )
    // 指令面板以视频模态打开（模型下拉是视频模型）
    expect(card).toMatch(/case 'semantic\.rebuild':\s*return 'video'/)
    expect(card).toContain("node.typeId === 'semantic.rebuild'\"")
  })

  /**
   * 声明顺序守卫（TDZ）：`watch(..., { immediate: true })` 会在 **setup 期间同步**跑回填，
   * 而 `const` 不提升 —— 回填链条读到的 ref 只要声明在 watcher 后面，就是
   * `Cannot access 'X' before initialization`，整个检查器只剩一句「渲染失败」（实测踩过：
   * `rebuildMode` 一组状态原本写在 watcher 下方）。
   */
  it('同步回填读到的 ref 都声明在 immediate watcher 之前，不会 TDZ', () => {
    const scriptSetup = /<script setup[^>]*>([\s\S]*?)<\/script>/.exec(inspector)?.[1] ?? ''
    expect(scriptSetup, '找不到 <script setup>').not.toBe('')

    // 注释里也会出现 `{ immediate: true }` 这种示例文本，先按等长空格抹掉注释再判位置，
    // 否则边界会落在注释上（本守卫第一版就踩了这个坑）。
    const code = scriptSetup
      .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
      .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length))

    // 同步回填的边界：第一个 `{ immediate: true }`
    const syncBoundaryAt = code.search(/\{\s*immediate:\s*true/)
    expect(syncBoundaryAt, '找不到 immediate watcher').toBeGreaterThan(-1)

    // 同步链条：watch 回调 → loadConfig → syncRebuildFromNode（都是函数声明，会被提升）
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

    // 这些绑定必须在 watcher 之前以顶层 `const/let` 声明过
    const late = [...readNames].filter((name) => {
      const decl = new RegExp(`^(?:const|let)\\s+${name}\\b`, 'm').exec(code)
      return !decl || decl.index > syncBoundaryAt
    })
    expect(late, `这些 ref 声明在 immediate watcher 之后（会 TDZ）：${late.join(', ')}`).toEqual([])
  })

  /**
   * 编译节点：双击开**指令面板**（文本模型 + 用模型写提示词 + 规则包 + 编译要求），
   * 不再进 dive 的逐镜提示词页签 —— 逐镜修改只有一个入口（分析节点 dive 的修改面板）。
   */
  it('编译节点双击开指令面板；设置在面板里写，检查器只显示', () => {
    expect(card).toMatch(
      /if \(props\.node\.typeId === 'semantic\.compile'\) \{\s*instructionOpen\.value = !instructionOpen\.value\s*return/
    )
    expect(card).toMatch(/case 'semantic\.compile':\s*return 'semanticCompile'/)
    // 面板附加控件：用模型写提示词 + 规则包，写回节点参数
    expect(card).toContain('<SemanticCompileControls')
    expect(card).toContain('persistCompileParams({ semanticLlm: $event })')
    expect(card).toContain('persistCompileParams({ rulePackIds: $event })')
    // 不再把编译节点当作 dive 的可写目标
    expect(card).not.toContain('editorNodeId')
    // 检查器：编译只写原视频路径（其余由指令面板写，避免两处写互相覆盖）
    const persistBody =
      /function persistCompile\(\): void \{([\s\S]*?)\n\}/.exec(inspector)?.[1] ?? ''
    expect(persistBody).toContain('sourceRelativePath')
    expect(persistBody).not.toContain('semanticLlm')
    expect(persistBody).not.toContain('promptOverridesJson')
    expect(inspector).toContain('compileSettingsLabel')
    expect(inspector).toContain("t('graph.inspector.semantic.compileEditPointer')")
  })
})
