import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BUILTIN_NODE_TYPES, getNodePorts, listAddableNodeTypes } from '../src/shared/graph'

/**
 * `image.transform`（图片变换）的注册与 dive 接线（源码文本断言）。
 *
 * 为什么用文本断言：一个「本地像素 + dive 编辑器」节点要在**十余处**接线
 * （节点定义 / 分组菜单 / 两个联合类型 / viewRegistry / 宿主模板 / toolOpen 与 closeCurrent /
 * 面包屑 flush / dialogs API / 编辑器 openers 与 dialogs 对象 / 卡片双击与两处预览白名单 /
 * 能力缝三处），而**没有任何运行时测试覆盖**它们 —— 漏一处的表现是「菜单里没有」
 * 「双击没反应」「进去白屏」，全都不报错。历史上 AI 增强/预设面板就是这样静默消失的。
 */

const ROOT = join(__dirname, '..')
const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8')

describe('image.transform 节点注册', () => {
  it('已注册、可添加、端口正确（右键菜单与 MCP graph_node_types 同源）', () => {
    const def = BUILTIN_NODE_TYPES.find((item) => item.typeId === 'image.transform')
    expect(def, 'image.transform 未注册').toBeTruthy()
    expect(def?.addable).toBe(true)
    expect(def?.deletable).toBe(true)
    expect(def?.inspectorId).toBe('studio.graph.transform')
    // 纯本地节点：不参与生成、不调模型
    expect(def?.contributeToGeneration).toBe(false)
    expect(String(def?.description ?? '').length).toBeGreaterThan(20)
    expect(listAddableNodeTypes().some((item) => item.typeId === 'image.transform')).toBe(true)

    const ports = getNodePorts('image.transform').map((port) => `${port.id}:${port.direction}`)
    expect(ports).toContain('in-image:in')
    expect(ports).toContain('out:out')
  })

  it('出现在「图片编辑」分组菜单里（拼错 id 就等于菜单里没有）', () => {
    const editor = read('src/renderer/src/components/NodeGraphEditor.vue')
    const group = /id: 'imageEdit',\s*\n\s*typeIds: \[([\s\S]*?)\]/.exec(editor)?.[1] ?? ''
    expect(group, '找不到 imageEdit 分组声明').toBeTruthy()
    expect(group).toContain("'image.transform'")
    // 与裁剪 / 抠图这些同类本地节点排在一起
    expect(group).toContain("'image.crop'")
  })

  it('中英文案齐全（graph.types.image.transform 是界面上的节点名）', () => {
    for (const [file, expected] of [
      ['zh-CN.ts', '图片变换'],
      ['en-US.ts', 'Image transform']
    ] as const) {
      const locale = read(`src/renderer/src/i18n/locales/${file}`)
      // 注意：i18n 里不止一个 `types:` 块（端口类型 / 资产类型也有），必须挑「节点类型」那一个 ——
      // 用 `portraitTexture:` 这个只可能出现在节点名里的键定位（踩过：误匹配端口类型块，报假失败）
      const block =
        [...locale.matchAll(/types: \{([\s\S]*?)\n {4}\}/g)]
          .map((match) => match[1]!)
          .find((text) => text.includes('portraitTexture:')) ?? ''
      expect(block, `${file} 找不到节点类型名块`).toBeTruthy()
      expect(block, `${file} 缺 transform 节点名`).toContain(`transform: '${expected}'`)
      expect(locale, `${file} 缺 transform 节点提示`).toMatch(/transform: \{[\s\S]*?hint:/)
    }
  })
})

describe('image.transform dive 接线', () => {
  it('editorDive 的两处联合类型 + viewRegistry 都认这个 viewId', () => {
    const dive = read('src/renderer/src/features/graph/model/editorDive.ts')
    expect(dive).toMatch(/EditorDiveViewId =[\s\S]*?'node\.transform'/)
    expect(dive).toMatch(/EditorDiveNodeToolViewId = Extract<[\s\S]*?'node\.transform'/)

    const childHost = read('src/renderer/src/components/EditorDiveChildHost.vue')
    expect(childHost).toMatch(/'node\.transform': defineAsyncComponent/)
  })

  it('宿主四个分支齐全（模板 + toolOpen + closeCurrent + 面包屑 flush）', () => {
    const host = read('src/renderer/src/components/dive/EditorDiveNodeToolHost.vue')
    expect(host).toMatch(/viewId === 'node\.transform'/)
    expect(host).toContain('ImageTransformEditorDialog')
    expect(host).toMatch(/case 'node\.transform':\s*\n\s*return current\.transform\.open/)
    expect(host).toMatch(/case 'node\.transform':\s*\n\s*current\.closeTransform\(\)/)
    expect(host).toMatch(/case 'node\.transform':\s*\n\s*current\.flushTransform\(\)/)
    expect(host).toContain('@update="api.previewTransform as never"')
    expect(host).toContain('@save="api.saveTransform as never"')
  })

  it('dialogs API 有 transform 状态块与四个方法', () => {
    const key = read('src/renderer/src/features/graph/ui/graphEditorDialogsKey.ts')
    expect(key).toMatch(/transform: \{[\s\S]*?setup: ImageTransformState \| null[\s\S]*?\n  \}/)
    for (const method of [
      'closeTransform: () => void',
      'previewTransform: (payload: unknown) => void',
      'saveTransform: (payload: unknown) => void',
      'flushTransform: () => void'
    ]) {
      expect(key, `缺少 ${method}`).toContain(method)
    }
  })

  it('编辑器侧：opener / 四个处理函数 / dialogs 对象两处 / 撤销命令', () => {
    const editor = read('src/renderer/src/components/NodeGraphEditor.vue')
    expect(editor).toContain("'node.transform': (nodeId) => onTransformOpen(nodeId)")
    expect(editor).toMatch(/async function onTransformOpen\(/)
    expect(editor).toMatch(/function closeTransform\(/)
    expect(editor).toMatch(/function previewTransform\(/)
    expect(editor).toMatch(/function saveTransform\(/)
    expect(editor).toMatch(/function flushTransform\(/)
    expect(editor).toContain("recordGraphChange('transform', before)")
    // 实时预览必须取开窗快照做 before，否则 before≈after 会被判等跳过
    expect(editor).toMatch(/const before = transform\.historyBefore \?\? buildGraphJson\(\)/)
    expect(editor).toMatch(/^\s{2}transform,$/m)
    for (const name of [
      'closeTransform,',
      'previewTransform,',
      'saveTransform,',
      'flushTransform,'
    ]) {
      expect(editor, `graphDialogsApi 缺少 ${name}`).toContain(name)
    }
  })

  it('卡片双击进 dive：nodeRole 判定 + 双击分支 + 提示语 + 两处预览白名单', () => {
    const role = read('src/shared/graph/nodeRole.ts')
    expect(role).toMatch(/export function isTransformEditorNode\([\s\S]*?'image\.transform'/)

    const card = read('src/renderer/src/components/GraphNodeCard.vue')
    expect(card).toContain("await diveNodeTool('node.transform', title)")
    expect(card).toContain("t('graph.transform.hint')")
    // 两处白名单（卡片预览 + 视口预览）都要带上，否则双击后画面空白
    const whitelistHits = card.match(/isTransformEditorNode\(/g) ?? []
    expect(whitelistHits.length).toBeGreaterThanOrEqual(4)
  })
})

describe('image.transform 能力缝与「单一真相」', () => {
  it('能力缝三处接线完整（类型声明 + 引擎中转 + 两个 run path 注入）', () => {
    const types = read('src/shared/graph/execute/types.ts')
    expect(types).toMatch(/composeImageTransformCanvas\?: \(input: \{/)
    expect(types).toMatch(
      /composeImageTransformCanvas\?: NodeExecuteContext\['composeImageTransformCanvas'\]/
    )

    const engine = read('src/shared/graph/execute/engine.ts')
    expect(engine).toContain('composeImageTransformCanvas: options.composeImageTransformCanvas')

    for (const file of [
      'src/renderer/src/features/graph/controllers/useGraphRunSession.ts',
      'src/renderer/src/stores/graphTasks.ts'
    ]) {
      const source = read(file)
      expect(source, `${file} 缺少注入`).toContain('composeImageTransformCanvas')
      expect(source, `${file} 没从 model 引入`).toMatch(
        /import \{ composeImageTransformCanvas \} from '.*composeImageTransformCanvas'/
      )
    }
  })

  it('执行器：调能力缝 → 失败用专属错误码 → 打同口径日志 → 按图库口径落盘', () => {
    const executor = read('src/shared/graph/execute/imageLocal.ts')
    const fn =
      /export async function executeImageTransformNode\([\s\S]*?\n\}\n/.exec(executor)?.[0] ?? ''
    expect(fn, '找不到 executeImageTransformNode').toBeTruthy()
    expect(fn).toContain('readImageTransformFromNode(ctx.node.params)')
    expect(fn).toContain('ctx.composeImageTransformCanvas({')
    expect(fn).toContain('SHARED_ERRORS.imageTransformEmpty')
    expect(fn).toContain('describeImageTransform(planImageTransform(')
    expect(fn).toContain('materializeGeneratedBatch')
    expect(fn).toContain('commitGeneratedImages')
    expect(fn).toContain('imageTransform: state')
    // 缺注入时透传（离线可用），不抛错
    expect(fn).toContain('passthrough:0')
  })

  it('预览与出图共用同一份几何与同一个绘制函数（否则会出现「预览和出图不一样」）', () => {
    const canvas = read('src/renderer/src/features/graph/model/composeImageTransformCanvas.ts')
    expect(canvas).toContain('export function drawImageTransformPlan(')
    expect(canvas).toContain('planImageTransform(sourceWidth, sourceHeight, state)')

    const dialog = read('src/renderer/src/components/ImageTransformEditorDialog.vue')
    expect(dialog).toContain('planImageTransform(')
    expect(dialog).toMatch(
      /import \{ drawImageTransformPlan \} from '\.\.\/features\/graph\/model\/composeImageTransformCanvas'/
    )
    expect(dialog).toContain('drawImageTransformPlan(ctx, img, current, scale)')
  })

  it('错误码中英双语齐全（catalog 走 defErrSimple）', () => {
    const catalog = read('src/shared/errors/catalog.ts')
    expect(catalog).toContain('imageTransformEmpty: defErrSimple(')
    expect(catalog).toContain("'graphExec.imageTransform.empty'")
  })
})
