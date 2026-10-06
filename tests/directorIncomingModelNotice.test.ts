import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { reasonNotPlaceable } from '../src/renderer/src/features/director/incomingModelIssue'

/**
 * 导演台 `in-model`「接了线却什么都没显示」的**可见诊断**。
 *
 * 起因：`createModelObject` 有两条**静默返回 null** 的路径，界面上不给任何提示 ——
 * 用户只看到空的导演台，根本不知道是资产没入库、是动画资产不能当网格放，
 * 还是上游压根没产出。这类问题此前只能靠翻代码排查（为此我查了两轮）。
 *
 * 组件依赖 three.js / Electron 测不了，所以：
 * 1. 原因判定抽成纯函数（本文件直接测）
 * 2. 接线用源码级断言（与本仓其它视图测试同一手法）
 */
const SCENE = readFileSync(
  resolve('src/renderer/src/features/director/useDirectorStageScene.ts'),
  'utf8'
)
const SHELL = readFileSync(
  resolve('src/renderer/src/components/DirectorStageShellInner.vue'),
  'utf8'
)

describe('reasonNotPlaceable：复用共享判定，不各写一份 kind 检查', () => {
  it('动画片段资产判为 notPlaceable', () => {
    // 字段是 genParams.modelKind（见 @shared/domain 的 readModelAssetKind）
    expect(reasonNotPlaceable({ type: 'model', genParams: { modelKind: 'animation' } })).toBe(
      'notPlaceable'
    )
  })

  it('姿势资产判为 notPlaceable', () => {
    expect(reasonNotPlaceable({ type: 'model', genParams: { modelKind: 'pose' } })).toBe(
      'notPlaceable'
    )
  })

  it('普通模型可以放（返回 null）', () => {
    expect(reasonNotPlaceable({ type: 'model', genParams: {} })).toBeNull()
    expect(reasonNotPlaceable({ type: 'model' })).toBeNull()
    expect(reasonNotPlaceable({ type: 'model', genParams: { modelKind: 'model' } })).toBeNull()
  })

  it('非 model 类型不会被误判（共享函数要求 type === model）', () => {
    expect(reasonNotPlaceable({ type: 'image', genParams: { modelKind: 'animation' } })).toBeNull()
  })

  it('判定来自 @shared/domain 的既有函数（避免两处口径漂移）', () => {
    const src = readFileSync(
      resolve('src/renderer/src/features/director/incomingModelIssue.ts'),
      'utf8'
    )
    expect(src).toContain('isAnimationModelAsset')
    expect(src).toContain('isPoseModelAsset')
    // 不该自己再解析 kind / modelKind
    expect(src).not.toMatch(/genParams\?\.\s*(model)?[Kk]ind/)
  })
})

describe('useDirectorStageScene 的失败路径必须留下原因', () => {
  it('两条静默 return null 都先写 notice', () => {
    // ① 资产不在库 + 无文件路径
    expect(SCENE).toMatch(
      /if \(!model\?\.relativePath\) \{[\s\S]{0,220}incomingModelNotice\.value = \{ kind: 'missingPath'/
    )
    // ② 动画 / 姿势资产：原因由纯函数判定，这里只写提示
    expect(SCENE).toMatch(
      /const notPlaceable = reasonNotPlaceable\(model\)[\s\S]{0,220}incomingModelNotice\.value = \{ kind: notPlaceable/
    )
  })

  it('上游解析不出候选时，接线了才报 noCandidate', () => {
    expect(SCENE).toMatch(
      /if \(!incomingList\.length\) \{[\s\S]{0,400}incomingModelNotice\.value = hasIncomingModelEdge\(\)/
    )
    expect(SCENE).toMatch(/kind: 'noCandidate'/)
  })

  it('hasIncomingModelEdge 只看 in-model 端口', () => {
    expect(SCENE).toMatch(/function hasIncomingModelEdge[\s\S]{0,600}DIRECTOR_MODEL_IN_PORT/)
  })

  it('成功接上时清掉上一次的提示（失败原因不该跟着到下一次）', () => {
    expect(SCENE).toMatch(
      /async function applyIncomingModel[\s\S]{0,260}incomingModelNotice\.value = null/
    )
  })

  it('notice 暴露给界面（否则组件拿不到）', () => {
    expect(SCENE).toMatch(/return \{\s*\n\s*error,\s*\n\s*incomingModelNotice,/)
  })
})

describe('DirectorStageShellInner 把原因显示出来', () => {
  it('渲染在视口内（画面为空时用户不会去看底栏）', () => {
    expect(SHELL).toMatch(/class="incoming-model-notice"/)
    expect(SHELL).toMatch(/v-if="incomingModelNoticeText"/)
  })

  it('三种原因各自映射到一个 i18n 键', () => {
    for (const key of ['noCandidate', 'missingPath', 'notPlaceable']) {
      expect(SHELL).toContain(`director.incomingModel.${key}`)
    }
  })

  it('文案走 i18n，不硬编码', () => {
    expect(SHELL).toContain('t(key)')
  })
})

describe('i18n：三种原因中英都有', () => {
  it('zh-CN / en-US 的 director.incomingModel 三条齐全', () => {
    const zh = readFileSync(resolve('src/renderer/src/i18n/locales/zh-CN.ts'), 'utf8')
    const en = readFileSync(resolve('src/renderer/src/i18n/locales/en-US.ts'), 'utf8')
    for (const key of ['noCandidate', 'missingPath', 'notPlaceable']) {
      const pattern = new RegExp(`incomingModel: \\{[\\s\\S]{0,900}${key}:`, 's')
      expect(zh, `zh 缺 ${key}`).toMatch(pattern)
      expect(en, `en 缺 ${key}`).toMatch(pattern)
    }
  })
})
