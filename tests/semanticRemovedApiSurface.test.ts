import { describe, expect, it } from 'vitest'
import * as semanticBarrel from '../src/shared/semanticTimeline'
import * as timelineService from '../src/main/services/semanticTimeline/SemanticTimelineService'

/**
 * 「编辑时代」API 面守卫。
 *
 * 旧管线（按编辑列表裁剪原片 → 失效计划 → 冻结构建）整条已删除，这些符号不该再从
 * 语义库 barrel / 主进程服务里导出。**为什么要有这条守卫**：删除是渐进的（节点 → 执行器 →
 * 库），漏掉一个导出不会报错、也没人会发现，于是死 API 一直挂在导出面上被人误用。
 * 这里把已删清单钉住；将来真要恢复其中某个能力，必须**显式删掉本清单里那一行** ——
 * 让"重新引入"成为一个有意识的动作，而不是顺手加回来。
 *
 * 只断言**运行时值**（函数 / 常量）：纯类型（如 `SemanticBuildRequest`）在
 * `import *` 里根本不存在，断言它们恒真，等于没测。
 */
const REMOVED_FROM_BARREL = [
  // 编辑草稿规范化与结构化表单（消费者：旧 edit/variant 节点、SemanticEditPanel、MCP 四个工具）
  'normalizeSemanticEdits',
  'summarizeSemanticEdits',
  'sampleSemanticEdit',
  'readEditDrafts',
  'writeEditDrafts',
  'addEditDraft',
  'updateEditDraft',
  'removeEditDraft',
  'STRUCTURED_EDIT_KINDS',
  'applyStructuralEdits',
  'buildEntityShotIndex',
  // 编辑 schema 校验（只被上面的规范化与测试用）
  'assertValidEdit',
  // 失效规划 / 冻结构建（planner.ts 已删）
  'planInvalidation',
  'freezeBuildDefinition',
  'summarizeInvalidationPlan',
  'timelineVersionHash',
  'createEditId',
  // 变体配方展开（配方节点已删）
  'listRecipes',
  'findRecipe',
  'instantiateRecipe',
  'expandVariantMatrix',
  'fillTemplate',
  'expandRecipeEditMatrix',
  // 旧触发节点的事件标签解析
  'parseEventLabels',
  // 保真度量（qc.ts 已删：原消费者 visualReview 已随之删除，生产侧无消费者）
  'evaluateFidelity',
  'L1_PSNR_MIN',
  'L1_SSIM_MIN',
  // builds/<buildId>/manifest.json 的布局辅助
  'manifestPath',
  'buildDir',
  'BUILDS_DIR',
  'MANIFEST_FILE'
] as const

const REMOVED_FROM_TIMELINE_SERVICE = [
  'saveBuildManifest',
  'resolveTimelineDir',
  'loadOcrRegions',
  'projectSemanticRoot'
] as const

describe('编辑时代 API 已从导出面移除', () => {
  it('语义库 barrel 不再导出编辑 / 规划 / 构建 / 配方 / 保真度量 / 触发标签 API', () => {
    const present = REMOVED_FROM_BARREL.filter(
      (name) => (semanticBarrel as Record<string, unknown>)[name] !== undefined
    )
    expect(present, `这些符号不该再导出：${present.join(', ')}`).toEqual([])
  })

  it('主进程语义服务不再导出构建清单 / 构建目录辅助', () => {
    const present = REMOVED_FROM_TIMELINE_SERVICE.filter(
      (name) => (timelineService as Record<string, unknown>)[name] !== undefined
    )
    expect(present, `这些符号不该再导出：${present.join(', ')}`).toEqual([])
  })

  /**
   * 自检：barrel 与服务的导出必须是**真的被读到**（否则 `import *` 拿到空对象，
   * 上面的断言会恒真 —— 守卫变成摆设）。这里顺手钉住几个**必须还在**的导出。
   */
  it('导出面确实读到了内容，新管线 API 仍在（防止守卫恒真）', () => {
    const barrelKeys = Object.keys(semanticBarrel)
    expect(barrelKeys.length).toBeGreaterThan(20)
    for (const name of [
      'buildPromptPlan',
      'applyPromptOverrides',
      'parsePromptPlan',
      'summarizePromptPlan',
      'planRebuildClips',
      'collectRulePacks',
      'validateSemanticTimeline',
      'parseSemanticPack'
    ]) {
      expect(typeof (semanticBarrel as Record<string, unknown>)[name], `缺少 ${name}`).not.toBe(
        'undefined'
      )
    }
    const serviceKeys = Object.keys(timelineService)
    expect(serviceKeys.length).toBeGreaterThan(5)
    for (const name of [
      'analyzeSemanticTimeline',
      'loadSemanticTimeline',
      'saveSemanticTimeline'
    ]) {
      expect(typeof (timelineService as Record<string, unknown>)[name], `缺少 ${name}`).not.toBe(
        'undefined'
      )
    }
  })
})
