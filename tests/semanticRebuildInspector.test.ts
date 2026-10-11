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
})
