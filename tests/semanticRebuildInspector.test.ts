import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 语义重建节点的**界面接线**守卫。
 *
 * 节点在引擎里能跑，但界面没接线的话用户既看不到成片、也改不了参数（实测踩过：
 * 面板一片空白、双击只弹一句"还没运行"）。这里钉住三段接线：
 * 1. inspector 注册表把 `semantic.rebuild` 指到语义检查器；
 * 2. 检查器里有模式 / 模型 / 上限 / 音轨字幕 / 画面参数，并能写回节点；
 * 3. 双击重建节点优先看**成片**。
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

  it('检查器给出模式 / 模型 / 上限 / 音轨字幕 / 画面参数，且写回节点', () => {
    for (const token of [
      'isRebuild',
      'rebuildMode',
      'rebuildModelOptions',
      'rebuildMaxShots',
      'rebuildKeepAudio',
      'rebuildBurnSubtitles',
      'rebuildResolution',
      'rebuildAspectRatio'
    ]) {
      expect(inspector, token).toContain(token)
    }
    // 写回：参数进 patch（不是只改本地 ref）
    expect(inspector).toMatch(/function persistRebuild\(\): void \{[\s\S]{0,700}?patch\(\{/)
    expect(inspector).toContain('rebuildMode: rebuildMode.value')
    expect(inspector).toContain("generateModel: parsed?.model ?? ''")
    // 选中节点变化时同步到表单
    expect(inspector).toMatch(
      /const same = current\.id === loadedNodeId\.value[\s\S]{0,200}?loadConfig\(current\)/
    )
    // 注意：要锚定**调用点**（syncRebuildFromNode 的定义也在附近，只写函数名会被定义蒙过去）
    expect(inspector).toMatch(/syncRebuildFromNode\(\)\n\s*selectedRulePacks\.value/)
    // 视频模型（不是文本模型）
    expect(inspector).toContain("loadGenerateModelOptions('video')")
    // 提示词在编译节点上改：给一句指路
    expect(inspector).toContain("t('graph.inspector.semantic.rebuildPromptPointer')")
  })

  it('双击重建节点优先看成片（没有成片才回落）', () => {
    expect(card).toMatch(
      /props\.node\.typeId === 'semantic\.rebuild'[\s\S]{0,400}?resolveBuiltVideoRelativePath\(props\.runState\?\.outputs\)/
    )
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
   * 「编译 → 微调 → 重建」要能闭环：编译节点上必须能开"用模型写提示词"、
   * 也必须能按镜头人工覆盖提示词（否则人工微调只能改代码）。
   */
  it('编译节点能开模型写提示词、也能人工覆盖（写回节点参数）', () => {
    expect(inspector).toContain('useLlmForPrompts')
    expect(inspector).toContain('promptOverridesJson')
    expect(inspector).toContain("t('graph.inspector.semantic.promptsWithModel')")
    expect(inspector).toContain("t('graph.inspector.semantic.promptOverridesHint')")
    // 写回：两个值都要进 patch（不是只改本地 ref）
    expect(inspector).toMatch(
      /function persistCompile\(\): void \{[\s\S]{0,300}?semanticLlm: useLlmForPrompts\.value[\s\S]{0,160}?promptOverridesJson: promptOverridesJson\.value/
    )
    // 选中节点变化时回填（否则显示上一个节点的覆盖内容）
    expect(inspector).toMatch(
      /useLlmForPrompts\.value = p\.semanticLlm === true[\s\S]{0,200}?typeof p\.promptOverridesJson === 'string'/
    )
  })
})
