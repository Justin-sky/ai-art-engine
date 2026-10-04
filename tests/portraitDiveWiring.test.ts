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
      'runPortrait: (payload: unknown) => void',
      'selectPortraitVersion: (layerId: string) => void',
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
      'runPortrait,',
      'selectPortraitVersion,',
      'flushPortrait,',
      'runPortraitAi,'
    ]) {
      expect(source, `graphDialogsApi 缺少 ${name}`).toContain(name)
    }
    expect(source).toMatch(/async function onPortraitOpen\(/)
    // 编辑器内「保存并出图」+ 撤销记录（dive 回退前 flush 补记）
    expect(source).toMatch(/async function runPortrait\(/)
    expect(source).toMatch(/function flushPortrait\(\)/)
    expect(source).toContain("recordGraphChange('portrait', before)")
  })

  it('「保存并出图」的 run 必须带载荷、且不得先 save（否则关窗后静默空跑）', () => {
    const dialog = read('src/renderer/src/components/PortraitEditorDialog.vue')
    // run 事件声明成带载荷，宿主才有参数可用
    expect(dialog).toMatch(/run: \[payload: PortraitEditorPayload\]/)

    const emitRun = /function emitRun\(\)[\s\S]*?\n\}/.exec(dialog)
    expect(emitRun, 'emitRun 不见了').toBeTruthy()
    expect(emitRun![0]).toContain("emit('run', buildPayload())")
    // 曾经的线上问题：先 emit('save') 会立刻关窗并把 portrait.nodeId 清空，
    // 紧接着的 run 在宿主里找不到节点 → 只关窗不出图。
    expect(emitRun![0]).not.toContain("emit('save', buildPayload())")
    // 不带载荷的 run 事件在整个组件里都不该出现
    expect(dialog).not.toMatch(/emit\('run'\)/)

    // dive 宿主把 run 直接接到 runPortrait（载荷原样传过去）
    const diveHost = read('src/renderer/src/components/dive/EditorDiveNodeToolHost.vue')
    expect(diveHost).toContain('@run="api.runPortrait as never"')

    // 宿主：有载荷就落盘，没载荷也继续出图 —— 但绝不静默返回
    const host = read('src/renderer/src/components/NodeGraphEditor.vue')
    expect(host).toMatch(/async function runPortrait\(payload\?: PortraitEditorPayload\)/)
    expect(host).toContain('if (payload) applyPortraitParams(payload)')
    expect(host).toMatch(/async function runPortrait[\s\S]*?await guardedRunNodeOnly\(nodeId\)/)
  })

  it('「保存并出图」不关窗：原地显示进度，跑完把产物换到左边预览', () => {
    const host = read('src/renderer/src/components/NodeGraphEditor.vue')
    const runPortrait = /async function runPortrait\([\s\S]*?\n\}/.exec(host)
    expect(runPortrait, 'runPortrait 不见了').toBeTruthy()
    // 不许再弹回上一级：关窗只由关闭按钮 / 面包屑负责
    expect(runPortrait![0]).not.toContain('closePortrait()')
    // 跑图期间的状态位，以及成功后的结果回填
    expect(runPortrait![0]).toContain('portrait.runRunning = true')
    expect(runPortrait![0]).toContain('portrait.runError =')
    expect(runPortrait![0]).toContain('await showPortraitRunResult(nodeId, previousSourceUrl)')
    expect(host).toMatch(/async function showPortraitRunResult\(/)
    expect(host).toContain('params.portraitBakedRelativePath')
    // 出图前那张成为「对比原图」的对象（开窗时底图 = 上游原图，按钮本来是灰的）
    expect(host).toContain('portrait.upstreamUrl = previousSourceUrl')
    // 状态位要进宿主状态块与 dialogs API（dive 宿主从这里读）
    expect(host).toMatch(/runRunning: false,/)
    expect(host).toMatch(/runError: '',/)
    const api = read('src/renderer/src/features/graph/ui/graphEditorDialogsKey.ts')
    expect(api).toMatch(
      /portrait: \{[\s\S]*?runRunning: boolean[\s\S]*?runError: string[\s\S]*?\n  \}/
    )

    const diveHost = read('src/renderer/src/components/dive/EditorDiveNodeToolHost.vue')
    expect(diveHost).toContain(':run-running="api.portrait.runRunning"')
    expect(diveHost).toContain(':run-error="api.portrait.runError"')

    const dialog = read('src/renderer/src/components/PortraitEditorDialog.vue')
    // 两个新 props 与默认值
    expect(dialog).toContain('runRunning?: boolean')
    expect(dialog).toContain('runError?: string')
    expect(dialog).toContain('runRunning: false,')
    // 画面上沿的状态胶囊 + 底边按钮转进度态（不关窗，用户看得见）
    expect(dialog).toContain('class="stage-busy"')
    expect(dialog).toContain("t('graph.portrait.runRunning')")
    expect(dialog).toContain(':disabled="!sourceUrl || runRunning"')
    expect(dialog).toContain('if (props.runRunning) return')
    expect(dialog).toContain("t('graph.portrait.runFailed', { message: runError })")

    for (const file of ['zh-CN', 'en-US']) {
      const locale = read(`src/renderer/src/i18n/locales/${file}.ts`)
      expect(locale, `${file} 缺 runRunning`).toContain('runRunning:')
      expect(locale, `${file} 缺 runFailed`).toContain('runFailed:')
    }
  })

  it('进编辑器默认显示「当前输出」，没有输出才退回输入原图', () => {
    const host = read('src/renderer/src/components/NodeGraphEditor.vue')
    const base = /async function resolvePortraitBaseUrl\([\s\S]*?\n\}\n/.exec(host)
    expect(base, 'resolvePortraitBaseUrl 不见了').toBeTruthy()
    const body = base![0]

    // 当前输出（previewRelativePath / previewDataUrl，与输出预览选中的同一张）
    expect(body).toContain('resolvePortraitOutputUrl(nodeId)')
    expect(host).toMatch(
      /function readPortraitPreviewPointer\([\s\S]*?params\.previewRelativePath[\s\S]*?params\.previewDataUrl/
    )
    expect(host).toMatch(
      /async function resolvePortraitOutputUrl\([\s\S]*?resolveAssetFileUrl\(relativePath\)/
    )

    // 兜底链：AI 版本（比当前输出更新时）→ 上次产物 → 上游原图
    expect(body).toContain('portraitAiLayerIsNewerThanOutput(nodeId)')
    expect(body).toContain('resolvePortraitLayerUrl()')
    expect(body).toContain('await resolvePortraitBakedUrl(nodeId)')
    expect(body).toContain('resolveNodeEditorSourceUrl(nodeId, { preferUpstream: true })')
    // 上游只作最后一级：它在函数体里必须排在产物之后
    expect(body.indexOf('await resolvePortraitBakedUrl(nodeId)')).toBeLessThan(
      body.indexOf('resolveNodeEditorSourceUrl(nodeId, { preferUpstream: true })')
    )
    // AI 版本与当前输出都可能是「最新那张」：按时间取新的，否则总有一边看着像丢了
    expect(host).toMatch(/function portraitAiLayerIsNewerThanOutput\([\s\S]*?\)\?\.at/)
    expect(host).toMatch(
      /function portraitAiLayerIsNewerThanOutput\([\s\S]*?generatedImages[\s\S]*?createdAt/
    )

    // 产物取的是执行器写回的那个参数
    expect(host).toMatch(
      /async function resolvePortraitBakedUrl\([\s\S]*?params\.portraitBakedRelativePath/
    )

    // 开窗时就走这一档
    expect(host).toMatch(/const url = await resolvePortraitBaseUrl\(nodeId\)/)

    // 版本切换走「明确选择」：选上游就显示上游，不会被产物顶掉
    const version = /async function selectPortraitVersion\([\s\S]*?\n\}/.exec(host)
    expect(version, 'selectPortraitVersion 不见了').toBeTruthy()
    expect(version![0]).toContain('await resolvePortraitVersionUrl(portrait.nodeId)')
  })

  it('Inspector 输出预览里换选中图，编辑器左边跟着换', () => {
    const host = read('src/renderer/src/components/NodeGraphEditor.vue')
    // 预览指针 = 输出预览写回的那两个参数（graphGalleryOutput 的 commitImages）
    expect(host).toMatch(
      /function readPortraitPreviewPointer\([\s\S]*?params\.previewRelativePath[\s\S]*?params\.previewDataUrl/
    )
    // 有 dataUrl 直接用，否则按 relativePath 换 studio-media 地址（与开窗解析共用同一个 helper）
    expect(host).toMatch(
      /async function resolvePortraitOutputUrl\([\s\S]*?resolveAssetFileUrl\(relativePath\)/
    )
    expect(host).toMatch(
      /function syncPortraitStageFromNodePreview\([\s\S]*?await resolvePortraitOutputUrl\(nodeId\)/
    )
    // 换图前那张成为「对比原图」的对象（已有真上游时不覆盖）
    expect(host).toMatch(
      /function syncPortraitStageFromNodePreview\([\s\S]*?if \(!portrait\.upstreamUrl && previousSourceUrl\)[\s\S]*?portrait\.upstreamUrl = previousSourceUrl/
    )
    // 参数写回靠 revision 感知
    expect(host).toMatch(
      /function portraitPreviewPointerKey\([\s\S]*?graphEditorHosts\.revision\.value/
    )
    // 只盯预览指针（不是整个 params），版本切换 / 实时编辑不会误触发
    expect(host).toMatch(/watch\(portraitPreviewPointerKey,/)
    // 开窗那一下指针本来就会变，不算换图：否则会把刚解析好的底图（含显式选中的 AI 版本）顶掉
    expect(host).toMatch(/if \(!key \|\| key === portraitPreviewBaseline\) return/)
    expect(host).toMatch(/portraitPreviewBaseline = portraitPreviewPointerKey\(\)/)
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

  it('渲染层部署了几何能力缝实现并在两条运行通路都注入', () => {
    const capabilities = read('src/renderer/src/features/graph/model/portraitCapabilities.ts')
    expect(capabilities).toContain('export async function composePortraitIdPhoto')
    expect(capabilities).toContain('export async function detectPortraitFaces')
    expect(capabilities).toContain('export async function inspectImageSize')
    // 局部回贴也是能力缝：执行器只发「蒙版构成」，画蒙版与合成留在渲染层
    expect(capabilities).toContain('export async function composePortraitScopedRetouch')
    for (const file of [
      'src/renderer/src/features/graph/controllers/useGraphRunSession.ts',
      'src/renderer/src/stores/graphTasks.ts'
    ]) {
      const source = read(file)
      expect(source, `${file} 未注入 composePortraitIdPhoto`).toContain('composePortraitIdPhoto,')
      expect(source, `${file} 未注入 detectPortraitFaces`).toContain('detectPortraitFaces,')
      expect(source, `${file} 未注入 inspectImageSize`).toContain('inspectImageSize,')
      expect(source, `${file} 未注入 composePortraitScopedRetouch`).toContain(
        'composePortraitScopedRetouch,'
      )
    }
    // 执行器侧要把它从 run options 接进 ctx（engine 是显式字段表，漏一行能力就永远不生效）
    expect(read('src/shared/graph/execute/engine.ts')).toContain(
      'composePortraitScopedRetouch: options.composePortraitScopedRetouch,'
    )
  })

  it('局部回贴开关：面板勾选项 → 载荷 → 节点参数 → 执行器', () => {
    const dialog = read('src/renderer/src/components/PortraitEditorDialog.vue')
    expect(dialog).toContain("scopeMode?: 'local' | 'global'")
    expect(dialog).toContain("scopeMode: 'local',")
    expect(dialog).toContain('onScopeModeChange')
    expect(dialog).toContain("t('graph.portrait.scopeLocal')")
    expect(dialog).toContain("t('graph.portrait.scopeLocalHint')")
    expect(dialog).toMatch(/scopeMode: props\.scopeMode === 'global' \? 'global' : 'local'/)

    const host = read('src/renderer/src/components/NodeGraphEditor.vue')
    expect(host).toMatch(/portraitScopeMode: payload\.scopeMode/)
    expect(host).toMatch(
      /portrait\.scopeMode = node\.params\.portraitScopeMode === 'global' \? 'global' : 'local'/
    )
    expect(host).toMatch(
      /if \(payload\?\.scopeMode !== undefined\) portrait\.scopeMode = payload\.scopeMode/
    )

    const diveHost = read('src/renderer/src/components/dive/EditorDiveNodeToolHost.vue')
    expect(diveHost).toContain(':scope-mode="api.portrait.scopeMode"')

    // 节点参数与执行器口径：只有显式 'global' 才整图
    expect(read('src/shared/graph/types.ts')).toContain("portraitScopeMode?: 'local' | 'global'")
    const executor = read('src/shared/graph/execute/portrait.ts')
    expect(executor).toContain("ctx.node.params.portraitScopeMode !== 'global'")
    expect(executor).toContain('portraitScopePlan(state)')

    for (const file of ['zh-CN', 'en-US']) {
      const locale = read(`src/renderer/src/i18n/locales/${file}.ts`)
      expect(locale, `${file} 缺 scopeLocal`).toContain('scopeLocal:')
      expect(locale, `${file} 缺 scopeLocalHint`).toContain('scopeLocalHint:')
    }
  })

  it('执行器只走图片模型：缺 generateImage 时明确报错（不透传上游）', () => {
    const source = read('src/shared/graph/execute/portrait.ts')
    expect(source).toContain('capabilityImageGenerate')
    expect(source).toMatch(/if \(!ctx\.generateImage\)/)
    // 本地像素实现已删除：执行器不得再引用烘焙能力
    expect(source).not.toContain('bakePortraitRetouch')
    expect(source).toContain('buildPortraitPrompt')
  })

  /**
   * 编辑器源图是 `studio-media://` 地址，只有以 CORS 模式取图才不会把 canvas 标记为
   * 跨源污染 —— 漏了这一行，证件照裁切与提示词预览都会抛 SecurityError。
   * 锁住读像素的加载器。
   */
  it('读像素的源图加载器都声明了 crossOrigin（否则 canvas 被跨源污染）', () => {
    for (const file of [
      'src/renderer/src/features/graph/model/portraitCapabilities.ts',
      'src/renderer/src/features/graph/portraitQualityPreview.ts',
      'src/renderer/src/features/yolo/api.ts'
    ]) {
      expect(read(file), `${file} 缺少 crossOrigin="anonymous"`).toContain(
        "crossOrigin = 'anonymous'"
      )
    }
  })
})
