import { describe, expect, it } from 'vitest'
import {
  AI_WORKFLOW_PRESET_IDS,
  getAiWorkflowPresetPlan,
  listNodeTypes,
  materializeGraphPlan,
  type GraphDocument,
  type GraphPlan
} from '../src/shared/graph'
import { nodeTypesOfPlan } from '../src/shared/workflowMarket'
import {
  RESERVED_WORKFLOW_EXPORT_IDS,
  WORKFLOW_EXPORT_COVER_FILE_NAME,
  WORKFLOW_EXPORT_ID_MAX,
  WORKFLOW_EXPORT_LIMITS,
  WorkflowExportUnknownTypesError,
  buildMarketWorkflowBundle,
  documentToPlan,
  documentToPlanReport,
  filterExportParams,
  isLocalAssetRefParamKey,
  normalizeWorkflowExportMeta,
  normalizeWorkflowTags,
  planKeyStem,
  readPngSize,
  serializeWorkflowJson,
  validateExportWorkflowId,
  workflowMarketIdOfPreset,
  type WorkflowExportMeta
} from '../src/shared/workflowExport'
import { getNodeType } from '../src/shared/graph/registry'

/**
 * 「导出为市场工作流」的核心行为测试。
 *
 * 这里盯的是**发布出去的那个对象**：key 稳定唯一、端口不丢、运行时写回字段不进包、
 * `requires.nodeTypes` 与 plan 同源。任何一条错了，产物都是「市场 CI 能过 / 用户装上却不对」
 * 或「CI 直接拒」这两类最难查的形态。
 */

/** 用内置预设物化一张真实图（比手搓节点对象更能反映线上形态） */
function materializePreset(presetId: string): GraphDocument {
  const plan = getAiWorkflowPresetPlan(presetId as never)
  expect(plan, presetId).toBeTruthy()
  const result = materializeGraphPlan(plan as GraphPlan, {
    scope: 'subgraphAsset',
    assetType: 'subgraph'
  })
  expect(result.ok, result.error).toBe(true)
  return result.document as GraphDocument
}

function nodeOf(doc: GraphDocument, typeId: string) {
  const node = doc.nodes.find((item) => item.typeId === typeId)
  expect(node, `${typeId} 不在物化结果里`).toBeTruthy()
  return node!
}

describe('documentToPlan: key 与结构', () => {
  it('key 可读、唯一，且同一张图每次导出都相同（稳定）', () => {
    const doc = materializePreset('anim2dGif')
    const first = documentToPlan(doc)
    const second = documentToPlan(doc)

    expect(first.nodes.map((node) => node.key)).toEqual(second.nodes.map((node) => node.key))
    expect(new Set(first.nodes.map((node) => node.key)).size).toBe(first.nodes.length)
    // typeId 主干 + 序号：asset.image → image1、anim.2d → anim2d1、note.text → note1
    expect(first.nodes.map((node) => node.key)).toEqual(
      first.nodes.map((node) => `${planKeyStem(node.typeId)}1`)
    )
  })

  it('同类型多节点按出现顺序编号，不撞 key', () => {
    const doc = materializePreset('characterSheet')
    const plan = documentToPlan(doc)
    const imageKeys = plan.nodes.filter((node) => node.typeId === 'asset.image').map((n) => n.key)

    expect(imageKeys.length).toBeGreaterThan(1)
    expect(imageKeys).toEqual(['image1', 'image2', 'image3'])
  })

  it('连线保留 fromPort / toPort（多出口节点不写端口会被物化猜错口）', () => {
    const doc = materializePreset('anim2dGif')
    const plan = documentToPlan(doc)
    const source = plan.nodes.find((node) => node.typeId === 'asset.image')!
    const target = plan.nodes.find((node) => node.typeId === 'anim.2d')!

    expect(plan.edges).toContainEqual({
      from: source.key,
      to: target.key,
      fromPort: 'out',
      toPort: 'in'
    })
  })

  it('标题带到 plan，节点标题保留；无标题时不写 title 字段', () => {
    const doc = materializePreset('anim2dGif')
    const plan = documentToPlan(doc, { title: '我的画布' })

    expect(plan.title).toBe('我的画布')
    expect(
      plan.nodes.every((node) => typeof node.title === 'string' && node.title.length > 0)
    ).toBe(true)
    expect(documentToPlan(doc).title).toBeUndefined()
  })

  it('宿主引用 / 边界 / 输出节点不出现在 plan 里（别人机器上复现不了）', () => {
    const doc = materializePreset('anim2dGif')
    // 模拟：加一个宿主实例节点与一条指向它的连线
    doc.nodes.push({
      id: 'host-node',
      typeId: 'asset.image',
      category: 'asset',
      params: { assetHost: true, generateInstruction: '宿主实例' },
      position: { x: 0, y: 0 }
    })
    doc.edges.push({
      id: 'edge-host',
      source: doc.nodes[0]!.id,
      target: 'host-node',
      sourcePort: 'out',
      targetPort: 'in'
    })

    const report = documentToPlanReport(doc)
    expect(report.diagnostics.skippedNodes.some((item) => item.reason === 'hostBound')).toBe(true)
    // 宿主节点本身不进 plan：它的 assetId 指向本工程的另一个资产，别人机器上并不存在
    const docImages = doc.nodes.filter((node) => node.typeId === 'asset.image').length
    const planImages = report.plan.nodes.filter((node) => node.typeId === 'asset.image').length
    expect(planImages).toBe(docImages - 1)
    expect(report.diagnostics.droppedEdges).toBe(1)
    expect(report.warnings.some((note) => note.reasonKey === 'skippedNodes')).toBe(true)
    expect(report.warnings.some((note) => note.reasonKey === 'droppedEdges')).toBe(true)
  })
})

describe('documentToPlan: 参数过滤（运行时写回字段必须进不了包）', () => {
  it('丢弃 generatedImages / animGifRelativePath / animGifFrameCount / animGridImage', () => {
    const doc = materializePreset('anim2dGif')
    const anim = nodeOf(doc, 'anim.2d')
    const image = nodeOf(doc, 'asset.image')

    // 模拟「刚跑过一轮」：这些字段是执行期写回的，不是工作流内容
    Object.assign(anim.params, {
      animGifRelativePath: 'Cache/Images/anim.gif',
      animGifFrameCount: 12,
      animGridImage: { relativePath: 'Cache/Images/grid.png' },
      animAssetId: 'asset-123'
    })
    Object.assign(image.params, {
      generatedImages: [{ relativePath: 'Cache/Images/1.png' }],
      episodeReviewStatus: 'PASS'
    })

    const plan = documentToPlan(doc)
    const animOut = plan.nodes.find((node) => node.typeId === 'anim.2d')!
    const imageOut = plan.nodes.find((node) => node.typeId === 'asset.image')!

    for (const key of ['animGifRelativePath', 'animGifFrameCount', 'animGridImage']) {
      expect(animOut.params, key).not.toHaveProperty(key)
    }
    expect(imageOut.params).not.toHaveProperty('generatedImages')
    expect(imageOut.params).not.toHaveProperty('episodeReviewStatus')
    // 声明过、但存的是本工程资产 GUID 的参数同样不能出包（换台机器就是悬空引用）
    expect(animOut.params).not.toHaveProperty('animAssetId')
  })

  it('本工程资产引用参数按键名形态过滤并单独上报（不混进「未声明」那一类）', () => {
    const doc = materializePreset('anim2dGif')
    Object.assign(nodeOf(doc, 'anim.2d').params, { animAssetId: 'asset-123' })

    const report = documentToPlanReport(doc)
    expect(report.diagnostics.localRefParamKeys).toContain('animAssetId')
    expect(report.diagnostics.droppedParamKeys).not.toContain('animAssetId')
    expect(report.warnings.some((note) => note.reasonKey === 'localRefParams')).toBe(true)
    expect(isLocalAssetRefParamKey('poseSourceAssetId')).toBe(true)
    expect(isLocalAssetRefParamKey('generateModel')).toBe(false)
  })

  it('保留节点类型声明过的参数与全局通用参数（text / generateInstruction）', () => {
    const doc = materializePreset('anim2dGif')
    const anim = nodeOf(doc, 'anim.2d')
    const note = nodeOf(doc, 'note.text')
    Object.assign(anim.params, {
      animRows: 2,
      animCols: 4,
      animPresetId: 'walk',
      animInstruction: '角色侧面行走循环',
      animKeyColor: '#00ff00',
      animGifFps: 12
    })
    note.params.text = '出图说明'

    const plan = documentToPlan(doc)
    const animOut = plan.nodes.find((node) => node.typeId === 'anim.2d')!
    const noteOut = plan.nodes.find((node) => node.typeId === 'note.text')!

    expect(animOut.params).toMatchObject({
      animRows: 2,
      animCols: 4,
      animPresetId: 'walk',
      animInstruction: '角色侧面行走循环',
      animKeyColor: '#00ff00',
      animGifFps: 12
    })
    expect(noteOut.params).toEqual({ text: '出图说明' })
  })

  it('空串 / 空数组 / 空对象一律不写进发布包，且不误报为「被丢弃」', () => {
    const def = getNodeType('anim.2d')!
    const { params, dropped, localRefs } = filterExportParams(
      {
        animKeyColor: '',
        animInstruction: '   ',
        animRows: 1,
        animGifFps: 0,
        animAssetId: '',
        styleImages: [],
        imageGridSplit: {},
        somethingRuntime: { a: 1 }
      },
      def
    )

    expect(params).toEqual({ animRows: 1, animGifFps: 0 })
    expect(dropped).toEqual(['somethingRuntime'])
    // 空值的资产引用不算「被丢掉」：它本来就没内容
    expect(localRefs).toEqual([])
  })

  it('被丢弃的参数会在 warnings 里如实上报（静默丢弃＝假成功）', () => {
    const doc = materializePreset('anim2dGif')
    Object.assign(nodeOf(doc, 'anim.2d').params, { animGifRelativePath: 'Cache/x.gif' })

    const report = documentToPlanReport(doc)
    const note = report.warnings.find((item) => item.reasonKey === 'droppedParams')
    expect(note).toBeTruthy()
    expect(String(note!.params?.keys)).toContain('animGifRelativePath')
    expect(report.diagnostics.droppedParamKeys).toContain('animGifRelativePath')
  })
})

describe('validateExportWorkflowId', () => {
  it('接受普通 kebab-case', () => {
    expect(validateExportWorkflowId('my-workflow-2')).toEqual({ ok: true })
  })

  it('拒绝空 / 形态非法 / 过长', () => {
    expect(validateExportWorkflowId('')).toEqual({ ok: false, reasonKey: 'idRequired' })
    expect(validateExportWorkflowId('My_Workflow')).toEqual({ ok: false, reasonKey: 'idFormat' })
    expect(validateExportWorkflowId('a'.repeat(WORKFLOW_EXPORT_ID_MAX + 1))).toEqual({
      ok: false,
      reasonKey: 'idTooLong',
      params: { max: WORKFLOW_EXPORT_ID_MAX }
    })
  })

  it('拒绝与内置预设撞名的 id，并说清是哪一个（官方那 15 条由预设导出生成）', () => {
    const result = validateExportWorkflowId('game-ua-video')
    expect(result.ok).toBe(false)
    expect(result).toMatchObject({
      reasonKey: 'idPresetReserved',
      params: { presetId: 'game-ua-video' }
    })
    expect(validateExportWorkflowId('anim2d-gif').ok).toBe(false)
    expect(validateExportWorkflowId('short-drama9').ok).toBe(false)
  })

  it('预设 id 清单是从 AI_WORKFLOW_PRESET_IDS 派生的，且排除了 custom', () => {
    expect(RESERVED_WORKFLOW_EXPORT_IDS).toEqual(
      AI_WORKFLOW_PRESET_IDS.filter((id) => id !== 'custom').map(workflowMarketIdOfPreset)
    )
    expect(RESERVED_WORKFLOW_EXPORT_IDS).not.toContain('custom')
    expect(workflowMarketIdOfPreset('anim2dGif')).toBe('anim2d-gif')
  })
})

describe('normalizeWorkflowExportMeta', () => {
  const base = {
    id: 'canvas-export',
    title: '画布导出',
    titleEn: 'Canvas export',
    summary: '一句话说清产出什么',
    category: 'utility',
    tags: '竖屏, 广告 ,竖屏',
    version: '0.1.0',
    authorName: 'Tester',
    authorUrl: 'https://github.com/tester',
    license: 'CC-BY-4.0'
  }

  it('归一化出工作流包要的形状（tags 去空去重、titleEn 省略空值）', () => {
    const result = normalizeWorkflowExportMeta({ ...base, titleEn: '  ' })
    expect(result.ok).toBe(true)
    const meta = (result as { ok: true; meta: WorkflowExportMeta }).meta
    expect(meta.tags).toEqual(['竖屏', '广告'])
    expect(meta.titleEn).toBeUndefined()
    expect(meta.author).toEqual({ name: 'Tester', url: 'https://github.com/tester' })
  })

  it('逐字段拒绝：简介超长 / 非 semver / 分类不在枚举里 / 缺署名 / 缺许可', () => {
    expect(normalizeWorkflowExportMeta({ ...base, summary: 'x'.repeat(61) })).toMatchObject({
      ok: false,
      reasonKey: 'summaryTooLong',
      params: { max: WORKFLOW_EXPORT_LIMITS.summaryMax }
    })
    expect(normalizeWorkflowExportMeta({ ...base, version: '1.0' })).toMatchObject({
      ok: false,
      reasonKey: 'versionInvalid'
    })
    expect(normalizeWorkflowExportMeta({ ...base, category: 'nope' })).toMatchObject({
      ok: false,
      reasonKey: 'categoryInvalid'
    })
    expect(normalizeWorkflowExportMeta({ ...base, authorName: '' })).toMatchObject({
      ok: false,
      reasonKey: 'authorRequired'
    })
    expect(normalizeWorkflowExportMeta({ ...base, license: ' ' })).toMatchObject({
      ok: false,
      reasonKey: 'licenseRequired'
    })
    // id 的拒绝原样透传
    expect(normalizeWorkflowExportMeta({ ...base, id: 'game-ua-video' })).toMatchObject({
      ok: false,
      reasonKey: 'idPresetReserved'
    })
  })

  it('标签拆分：数组 / 逗号串 / 空白分隔都认', () => {
    expect(normalizeWorkflowTags(['a', ' a ', '', 'b'])).toEqual(['a', 'b'])
    expect(normalizeWorkflowTags('a,b  c')).toEqual(['a', 'b', 'c'])
    expect(normalizeWorkflowTags(undefined)).toEqual([])
  })
})

describe('buildMarketWorkflowBundle', () => {
  function bundle(presetId = 'anim2dGif', appMinVersion?: string) {
    const doc = materializePreset(presetId)
    const plan = documentToPlan(doc, { title: '画布导出' })
    const meta = normalizeWorkflowExportMeta({
      id: 'canvas-export',
      title: '画布导出',
      titleEn: 'Canvas export',
      summary: '一句话说清产出什么',
      category: 'utility',
      tags: 'a,b',
      version: '0.1.0',
      authorName: 'Tester',
      license: 'CC-BY-4.0'
    })
    expect(meta.ok).toBe(true)
    return buildMarketWorkflowBundle({
      meta: (meta as { ok: true; meta: WorkflowExportMeta }).meta,
      plan,
      nodeTypes: listNodeTypes().map((def) => def.typeId),
      appMinVersion
    })
  }

  it('市场必填字段齐备，且 requires.nodeTypes 与 plan 派生结果逐字一致', () => {
    const file = bundle()

    expect(file.schemaVersion).toBe(1)
    expect(file.id).toBe('canvas-export')
    expect(file.title).toBe('画布导出')
    expect(file.titleEn).toBe('Canvas export')
    expect(file.summary.length).toBeGreaterThan(0)
    expect(file.category).toBe('utility')
    expect(file.tags).toEqual(['a', 'b'])
    expect(file.version).toBe('0.1.0')
    expect(file.author.name).toBe('Tester')
    expect(file.license).toBe('CC-BY-4.0')
    // 封面：市场校验器要求包内存在 cover.png，缺图直接判「缺少封面」
    expect(file.cover).toBe(WORKFLOW_EXPORT_COVER_FILE_NAME)
    expect(file.requires.nodeTypes).toEqual(nodeTypesOfPlan(file.plan))
    expect(file.requires.nodeTypes.length).toBeGreaterThan(0)
    // plan 引用的类型都必须真实注册（否则市场校验器按「未知节点类型」拒）
    const known = new Set(listNodeTypes().map((def) => def.typeId))
    for (const typeId of file.requires.nodeTypes) expect(known.has(typeId), typeId).toBe(true)
  })

  it('appMinVersion 给了才写（缺省不写空串）', () => {
    expect(bundle('anim2dGif', '7.1.3').requires.appMinVersion).toBe('7.1.3')
    expect(bundle('anim2dGif', '  ').requires.appMinVersion).toBeUndefined()
  })

  it('plan 引用了未知节点类型时抛错，而不是发布一个注定被 CI 拒的包', () => {
    const plan = documentToPlan(materializePreset('anim2dGif'))
    expect(() =>
      buildMarketWorkflowBundle({
        meta: {
          id: 'canvas-export',
          title: 't',
          summary: 's',
          category: 'utility',
          tags: [],
          version: '0.1.0',
          author: { name: 'a' },
          license: 'MIT'
        },
        plan,
        nodeTypes: []
      })
    ).toThrow(WorkflowExportUnknownTypesError)
    expect(() =>
      buildMarketWorkflowBundle({
        meta: {
          id: 'canvas-export',
          title: 't',
          summary: 's',
          category: 'utility',
          tags: [],
          version: '0.1.0',
          author: { name: 'a' },
          license: 'MIT'
        },
        plan,
        nodeTypes: []
      })
    ).toThrow(/unknown node types/)
  })

  it('序列化成仓库风格：2 空格缩进、结尾换行、LF、无 BOM、中文按字面量', () => {
    const text = serializeWorkflowJson(bundle())

    expect(text.endsWith('}\n')).toBe(true)
    expect(text).not.toContain('\r')
    expect(text.startsWith('\uFEFF')).toBe(false)
    expect(text).toContain('\n  "schemaVersion": 1,')
    expect(text).toContain('\n    "nodes": [')
    // 中文不能被转成 \uXXXX（仓库里其它 workflow.json 都是字面量）
    expect(text).toContain('画布导出')
    expect(text).not.toMatch(/\\u[0-9a-fA-F]{4}/)
    expect(JSON.parse(text).id).toBe('canvas-export')
  })
})

describe('readPngSize', () => {
  function pngHeader(width: number, height: number): Uint8Array {
    const bytes = new Uint8Array(24)
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
    bytes.set([0x00, 0x00, 0x00, 0x0d], 8)
    bytes.set([0x49, 0x48, 0x44, 0x52], 12)
    const view = new DataView(bytes.buffer)
    view.setUint32(16, width)
    view.setUint32(20, height)
    return bytes
  }

  it('读出 IHDR 里的宽高', () => {
    expect(readPngSize(pngHeader(800, 450))).toEqual({ width: 800, height: 450 })
  })

  it('不是 PNG / 长度不足时返回 null（调用方据此只给软提示）', () => {
    expect(readPngSize(pngHeader(800, 450).slice(0, 12))).toBeNull()
    const jpeg = new Uint8Array(24)
    jpeg.set([0xff, 0xd8, 0xff, 0xe0], 0)
    expect(readPngSize(jpeg)).toBeNull()
  })
})
