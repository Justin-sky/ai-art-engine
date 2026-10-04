import { describe, expect, it } from 'vitest'
import { createNodeFromType, runGraph } from '../src/shared/graph'
import { portraitSourceHash } from '../src/shared/graph/execute/portrait'
import {
  PORTRAIT_FACES_VERSION,
  PORTRAIT_TIER_PHRASES,
  canonicalFaceTemplate,
  normalizePortraitRetouch,
  resolvePortraitRetouchSystemPrompt,
  type PortraitFaceAnalysis,
  type PortraitFacesPayload,
  type PortraitRetouchState
} from '../src/shared/graph'

/**
 * `image.portrait` 执行器契约（v2：像素活全部交给图片模型）。
 *
 * 这个节点**只剩一条执行路径**：`ctx.generateImage({ prompt, inputReferences })`。
 * 本地不再有烘焙钩子，所以测试锁的是**接线与决策**而不是任何像素结果：
 *
 * 1. 没有上游图 → `GRAPH_PROCESS_NO_INPUT`；没注入 `ctx.generateImage` → 能力错误，
 *    **绝不透传上游原图**（静默交付一张没修过的图比报错难查得多）；
 * 2. 提示词 = 系统提示词 + `\n\n` + 由 `params.portraitRetouch` 档位合成的正文；
 *    全默认档位合成不出任何正文时 → `GRAPH_PROCESS_EMPTY_PROMPT`，且不调模型；
 * 3. 人脸关键点缓存在 `params.portraitFaces`，按 `portraitSourceHash(sourceUrl)` + 版本失效；
 *    检测器抛错一律降级为「没有人脸」：依赖人脸的组整组不进提示词，但整张图照常出；
 * 4. 落盘后回写 `portraitBakedRelativePath` / `portraitPrompt` / `portraitIdPhotoPlan`
 *    （没选证件照规格时后者必须显式回写 `null`）；
 * 5. 证件照：`inspectImageSize` → `planIdPhoto` → 每张模型图过一遍
 *    `composePortraitIdPhoto`；拼版非空时额外落第二张图库项；
 *    几何能力缺失或抛错都不影响主图落盘。
 */

const SOURCE_URL = 'data:image/png;base64,AAAA'
const SOURCE_URL_B = 'data:image/png;base64,BBBB'
/** resolveImageUrls 解析后的可用 URL：用来证明 inputReferences 拿的是「解析结果」而不是原始 dataUrl */
const RESOLVED_SOURCE_URL = 'https://cdn.test/assets/portrait-source.png'
const MODEL_IMAGE = 'data:image/png;base64,MODEL'
const ID_PHOTO_CROPPED = 'data:image/png;base64,IDCROP'
const ID_PHOTO_SHEET = 'data:image/png;base64,IDSHEET'

/** 期望片段直接从执行器用的那张片段表取，避免测试硬编码 UI 文案 */
const SHARPEN_CLAUSE = PORTRAIT_TIER_PHRASES.sharpness?.standard ?? ''
const SKIN_CLAUSE = PORTRAIT_TIER_PHRASES.skinSmoothing?.standard ?? ''

/** `texture` 组不依赖人脸 → 用它保证提示词非空；`skin` 组依赖人脸 → 用它观察 needs 门禁 */
function retouchWithClause(overrides: Partial<PortraitRetouchState> = {}) {
  return normalizePortraitRetouch({ sharpness: 'standard', ...overrides })
}

function faceAnalysis(): PortraitFaceAnalysis {
  return {
    schema: 'canonical68',
    landmarks: canonicalFaceTemplate(),
    box: { x: 0.3, y: 0.2, w: 0.4, h: 0.5 },
    score: 0.97,
    modelId: 'test-face'
  }
}

function cachedFaces(sourceHash: string, version = PORTRAIT_FACES_VERSION): PortraitFacesPayload {
  return {
    v: version,
    sourceHash,
    faces: [faceAnalysis()],
    picked: 0,
    at: '2026-10-03T00:00:00.000Z'
  }
}

function buildGraph() {
  const src = createNodeFromType('asset.image', { x: 0, y: 0 }, { id: 'src', title: '原图' })
  const node = createNodeFromType('image.portrait', { x: 240, y: 0 }, { id: 'portrait' })
  return { src, node }
}

function doneImage(dataUrl: string) {
  return {
    status: 'done',
    outputs: { out: { kind: 'image', id: dataUrl, dataUrl, createdAt: '', relativePath: '' } }
  }
}

interface GenerateImageArgs {
  prompt: string
  model?: string
  providerInstanceId?: string
  resolution?: string
  quality?: string
  n?: number
  inputReferences?: string[]
}

interface IdPhotoSheetArgs {
  cols: number
  rows: number
  cellWidth: number
  cellHeight: number
  gapPx: number
  width: number
  height: number
  count: number
}

interface ComposeIdPhotoArgs {
  sourceDataUrl: string
  crop: { x: number; y: number; w: number; h: number }
  outputWidth: number
  outputHeight: number
  sheet: IdPhotoSheetArgs | null
}

type RunStub = ReturnType<typeof buildStub>

function buildStub() {
  const saved: Array<{ key: string; dataUrl: string }> = []
  const patches: Array<{ nodeId: string; params?: Record<string, unknown> }> = []
  const generateCalls: GenerateImageArgs[] = []
  const detectCalls: string[] = []
  const inspectCalls: string[] = []
  const idPhotoCalls: ComposeIdPhotoArgs[] = []
  const logs: string[] = []

  let generateResult: { images: string[]; model: string } = {
    images: [MODEL_IMAGE],
    model: 'test-image-model'
  }
  let idPhotoResult: { dataUrl: string; sheetDataUrl: string | null } = {
    dataUrl: ID_PHOTO_CROPPED,
    sheetDataUrl: null
  }

  const stub = {
    stepDelayMs: 1,
    resolveImageUrls: async (items: Array<{ dataUrl?: string }>) =>
      items.map((item) => item.dataUrl ?? ''),
    generateImage: async (input: GenerateImageArgs) => {
      generateCalls.push(input)
      return generateResult
    },
    detectPortraitFaces: async ({ sourceDataUrl }: { sourceDataUrl: string }) => {
      detectCalls.push(sourceDataUrl)
      return [faceAnalysis()]
    },
    inspectImageSize: async ({ sourceDataUrl }: { sourceDataUrl: string }) => {
      inspectCalls.push(sourceDataUrl)
      return { width: 1200, height: 1600 }
    },
    composePortraitIdPhoto: async (input: ComposeIdPhotoArgs) => {
      idPhotoCalls.push(input)
      return idPhotoResult
    },
    saveRunMedia: async (input: { dataUrl: string; key: string }) => {
      saved.push({ key: input.key, dataUrl: input.dataUrl })
      return `Assets/Portrait/${input.key}.png`
    },
    onNodePatch: (nodeId: string, patch: { params?: Record<string, unknown> }) => {
      patches.push({ nodeId, params: patch.params })
    },
    onLog: (_nodeId: string, message: string) => {
      logs.push(message)
    }
  }

  return {
    stub,
    saved,
    patches,
    generateCalls,
    detectCalls,
    inspectCalls,
    idPhotoCalls,
    logs,
    setGenerateResult: (value: typeof generateResult) => {
      generateResult = value
    },
    setIdPhotoResult: (value: typeof idPhotoResult) => {
      idPhotoResult = value
    }
  }
}

/** 单张上游图的 standard 跑法（与旧用例同形：createNodeFromType + runGraph + priorNodeStates） */
async function runPortrait(
  run: RunStub,
  nodeParams?: Record<string, unknown>,
  stubOverride?: Record<string, unknown>
) {
  const { src, node } = buildGraph()
  if (nodeParams) Object.assign(node.params, nodeParams)
  return {
    node,
    result: await runGraph(
      {
        nodes: [src, node],
        edges: [{ id: 'e1', source: src.id, target: node.id, sourcePort: 'out', targetPort: 'in' }],
        viewport: { x: 0, y: 0, zoom: 1 }
      },
      {
        ...run.stub,
        ...stubOverride,
        targetNodeId: node.id,
        onlyTargetNode: true,
        priorNodeStates: { [src.id]: doneImage(SOURCE_URL) }
      } as never
    )
  }
}

/** 最后一次回写 patch 里带某字段的那一条（执行器会分多次 patch） */
function patchWith(run: RunStub, key: string): Record<string, unknown> {
  const hit = [...run.patches].reverse().find((entry) => entry.params && key in entry.params)
  return hit?.params ?? {}
}

describe('image.portrait 执行器（全部走图片模型）', () => {
  it('无上游图时报 GRAPH_PROCESS_NO_INPUT，且从不调用图片模型', async () => {
    const run = buildStub()
    const { src, node } = buildGraph()
    const result = await runGraph(
      {
        nodes: [src, node],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 }
      },
      {
        ...run.stub,
        targetNodeId: node.id,
        onlyTargetNode: true
      } as never
    )

    expect(result.ok).toBe(false)
    expect(String(result.error)).toContain('GRAPH_PROCESS_NO_INPUT')
    expect(run.generateCalls).toHaveLength(0)
    expect(run.saved).toHaveLength(0)
  })

  it('未注入 ctx.generateImage 时明确报能力错误，绝不透传上游原图', async () => {
    const run = buildStub()
    const { node, result } = await runPortrait(run, undefined, { generateImage: undefined })

    expect(result.ok).toBe(false)
    // 文案来自 SHARED_ERRORS.capabilityImageGenerate（zh 面）
    expect(String(result.error)).toContain('未注入图片生成能力')

    const state = result.states[node.id]
    expect(state?.status).toBe('error')
    // 透传的实现会把上游 dataUrl 塞进 outputs —— 这里必须什么都没有
    expect(state?.outputs).toBeUndefined()
    expect(JSON.stringify(state?.outputs ?? {})).not.toContain(SOURCE_URL)
    expect(JSON.stringify(node.params.portraitBakedRelativePath ?? '')).not.toContain(SOURCE_URL)
    expect(run.saved).toHaveLength(0)
  })

  it('正常出图：提示词含档位正文与系统提示词、参考图为解析后的上游 URL、回写产物路径与 portraitPrompt', async () => {
    const run = buildStub()
    expect(SHARPEN_CLAUSE).not.toBe('')
    const { node, result } = await runPortrait(
      run,
      {
        portraitRetouch: retouchWithClause(),
        generateModel: 'custom-image-model',
        generateProviderInstanceId: 'provider-1'
      },
      { resolveImageUrls: async () => [RESOLVED_SOURCE_URL] }
    )

    expect(result.ok, result.error).toBe(true)
    expect(run.generateCalls).toHaveLength(1)
    const call = run.generateCalls[0]!
    const systemPrompt = resolvePortraitRetouchSystemPrompt(undefined, undefined)

    // 提示词 = 系统提示词 + \n\n + 档位正文；正文片段来自当前档位配置
    expect(call.prompt).toContain(SHARPEN_CLAUSE)
    expect(call.prompt.startsWith(systemPrompt)).toBe(true)
    expect(call.prompt).toContain(`${systemPrompt}\n\n`)
    expect(call.prompt.endsWith(SHARPEN_CLAUSE)).toBe(true)

    // 参考图是 resolveImageUrls 的结果，而不是上游原始 dataUrl
    expect(call.inputReferences).toEqual([RESOLVED_SOURCE_URL])
    expect(call.n).toBe(1)
    expect(call.quality).toBe('high')
    // 模型 / 提供商来自节点参数，输出尺寸偏好来自档位
    expect(call.model).toBe('custom-image-model')
    expect(call.providerInstanceId).toBe('provider-1')
    // export.outputSize 默认 2K
    expect(call.resolution).toBe('2K')

    // 模型图落盘一张
    expect(run.saved.map((entry) => entry.dataUrl)).toEqual([MODEL_IMAGE])

    // 回写：产物路径 + **实际发给模型的那条提示词**（含系统提示词），便于事后核对
    const patch = patchWith(run, 'portraitBakedRelativePath')
    expect(String(patch.portraitBakedRelativePath)).toMatch(/\.png$/)
    expect(node.params.portraitBakedRelativePath).toBe(patch.portraitBakedRelativePath)
    expect(patch.portraitPrompt).toBe(call.prompt)
    expect(String(patch.portraitPrompt)).toContain(systemPrompt)
    expect(String(patch.portraitPrompt)).toContain(SHARPEN_CLAUSE)
    expect(node.params.portraitPrompt).toBe(patch.portraitPrompt)
    expect(node.params.portraitRetouch?.sharpness).toBe('standard')
    expect(patch.portraitRetouch).toBeDefined()

    // 出口带物化相对路径
    const out = result.states[node.id]?.outputs?.out
    expect(out && out.kind === 'image' ? out.relativePath : '').toMatch(/\.png$/)
  })

  it('未选证件照规格时不碰几何能力，portraitIdPhotoPlan 显式回写 null', async () => {
    const run = buildStub()
    const { node, result } = await runPortrait(run, { portraitRetouch: retouchWithClause() })

    expect(result.ok, result.error).toBe(true)
    expect(run.inspectCalls).toHaveLength(0)
    expect(run.idPhotoCalls).toHaveLength(0)

    const patch = patchWith(run, 'portraitIdPhotoPlan')
    expect('portraitIdPhotoPlan' in patch).toBe(true)
    expect(patch.portraitIdPhotoPlan).toBeNull()
    expect(node.params.portraitIdPhotoPlan).toBeNull()
  })

  describe('人脸关键点', () => {
    it('首次运行检测一次并把 portraitFaces（源图指纹 + 版本）写回 params', async () => {
      const run = buildStub()
      const { node, result } = await runPortrait(run, { portraitRetouch: retouchWithClause() })

      expect(result.ok, result.error).toBe(true)
      expect(run.detectCalls).toEqual([SOURCE_URL])

      const patch = patchWith(run, 'portraitFaces')
      const payload = patch.portraitFaces as PortraitFacesPayload
      expect(payload.v).toBe(PORTRAIT_FACES_VERSION)
      expect(payload.sourceHash).toBe(portraitSourceHash(SOURCE_URL))
      expect(payload.faces).toHaveLength(1)
      expect(payload.picked).toBe(0)
      expect(node.params.portraitFaces?.sourceHash).toBe(portraitSourceHash(SOURCE_URL))
    })

    it('缓存指纹与版本一致时不再检测，依赖人脸的档位照常进提示词', async () => {
      const run = buildStub()
      expect(SKIN_CLAUSE).not.toBe('')
      const { result } = await runPortrait(run, {
        portraitRetouch: retouchWithClause({ skinSmoothing: 'standard' }),
        portraitFaces: cachedFaces(portraitSourceHash(SOURCE_URL))
      })

      expect(result.ok, result.error).toBe(true)
      expect(run.detectCalls).toHaveLength(0)
      expect(run.generateCalls).toHaveLength(1)
      expect(run.generateCalls[0]!.prompt).toContain(SKIN_CLAUSE)
      expect(run.generateCalls[0]!.prompt).toContain(SHARPEN_CLAUSE)
    })

    it('缓存版本过期时失效并重新检测', async () => {
      const run = buildStub()
      const { result } = await runPortrait(run, {
        portraitRetouch: retouchWithClause(),
        portraitFaces: cachedFaces(portraitSourceHash(SOURCE_URL), PORTRAIT_FACES_VERSION - 1)
      })

      expect(result.ok, result.error).toBe(true)
      expect(run.detectCalls).toHaveLength(1)
    })

    it('源图指纹不一致时失效并重新检测', async () => {
      const run = buildStub()
      const { result } = await runPortrait(run, {
        portraitRetouch: retouchWithClause(),
        portraitFaces: cachedFaces('old-hash')
      })

      expect(result.ok, result.error).toBe(true)
      expect(run.detectCalls).toHaveLength(1)
    })

    it('检测器抛错时降级为「没有人脸」：整图照常出，依赖人脸的组整组不进提示词', async () => {
      const run = buildStub()
      const { result } = await runPortrait(
        run,
        { portraitRetouch: retouchWithClause({ skinSmoothing: 'standard' }) },
        {
          detectPortraitFaces: async () => {
            throw new Error('face detector offline')
          }
        }
      )

      expect(result.ok, result.error).toBe(true)
      expect(run.generateCalls).toHaveLength(1)
      const prompt = run.generateCalls[0]!.prompt
      expect(prompt).toContain(SHARPEN_CLAUSE)
      expect(prompt).not.toContain(SKIN_CLAUSE)

      // 没有人脸 → 不写回 portraitFaces（避免把「检测失败」缓存成「这张图没有脸」）
      expect(run.patches.some((entry) => entry.params && 'portraitFaces' in entry.params)).toBe(
        false
      )
      expect(run.saved.map((entry) => entry.dataUrl)).toEqual([MODEL_IMAGE])
    })
  })

  it('全默认档位合成不出正文时报 GRAPH_PROCESS_EMPTY_PROMPT，且不调用图片模型', async () => {
    const run = buildStub()
    // 默认节点参数：portraitRetouch 全为 off / 空 → buildPortraitPrompt 的 main 为空串
    const { node, result } = await runPortrait(run)

    expect(result.ok).toBe(false)
    expect(String(result.error)).toContain('GRAPH_PROCESS_EMPTY_PROMPT')
    expect(result.states[node.id]?.status).toBe('error')
    expect(run.generateCalls).toHaveLength(0)
    expect(run.saved).toHaveLength(0)
  })

  it('多张上游图 = 逐张调用图片模型，各自以本张为唯一参考图', async () => {
    const run = buildStub()
    const first = createNodeFromType('asset.image', { x: 0, y: 0 }, { id: 'first' })
    const second = createNodeFromType('asset.image', { x: 0, y: 200 }, { id: 'second' })
    const node = createNodeFromType('image.portrait', { x: 240, y: 0 }, { id: 'portrait' })
    Object.assign(node.params, { portraitRetouch: retouchWithClause() })

    const result = await runGraph(
      {
        nodes: [first, second, node],
        edges: [
          { id: 'e1', source: first.id, target: node.id, sourcePort: 'out', targetPort: 'in' },
          { id: 'e2', source: second.id, target: node.id, sourcePort: 'out', targetPort: 'in' }
        ],
        viewport: { x: 0, y: 0, zoom: 1 }
      },
      {
        ...run.stub,
        targetNodeId: node.id,
        onlyTargetNode: true,
        priorNodeStates: {
          [first.id]: doneImage(SOURCE_URL),
          [second.id]: doneImage(SOURCE_URL_B)
        }
      } as never
    )

    expect(result.ok, result.error).toBe(true)
    expect(run.generateCalls).toHaveLength(2)
    expect(run.generateCalls.map((call) => call.inputReferences)).toEqual([
      [SOURCE_URL],
      [SOURCE_URL_B]
    ])
    expect(run.generateCalls.every((call) => call.n === 1)).toBe(true)
    // 两张模型图各自落盘
    expect(run.saved).toHaveLength(2)
  })

  describe('局部回贴（只改对应部位）', () => {
    const SCOPED_IMAGE = 'data:image/png;base64,SCOPED'

    interface ScopeArgs {
      sourceDataUrl: string
      generatedDataUrl: string
      mask: { face: boolean; person: boolean; regions: unknown[] }
      landmarks?: ReadonlyArray<readonly [number, number]> | null
    }

    function scopeStub() {
      const calls: ScopeArgs[] = []
      let applied = true
      const stub = {
        composePortraitScopedRetouch: async (input: ScopeArgs) => {
          calls.push(input)
          return {
            dataUrl: applied ? SCOPED_IMAGE : input.generatedDataUrl,
            applied,
            coverRatio: 0.18,
            notes: applied ? [] : ['face landmarks unavailable']
          }
        }
      }
      return { calls, stub, setApplied: (value: boolean) => (applied = value) }
    }

    it('默认（开关=local）：模型整图结果按脸/人物蒙版贴回，落盘的是回贴结果', async () => {
      const run = buildStub()
      const scope = scopeStub()
      const { result } = await runPortrait(
        run,
        {
          // texture 组不依赖人脸 → 提示词非空；显式给了缓存关键点，脸部蒙版可用
          portraitRetouch: retouchWithClause(),
          portraitFaces: cachedFaces(portraitSourceHash(SOURCE_URL))
        },
        scope.stub
      )

      expect(result.ok, result.error).toBe(true)
      expect(scope.calls).toHaveLength(1)
      const call = scope.calls[0]!
      expect(call.generatedDataUrl).toBe(MODEL_IMAGE)
      expect(call.sourceDataUrl).toBe(SOURCE_URL)
      // texture 属于面部范围
      expect(call.mask.face).toBe(true)
      expect(call.mask.person).toBe(false)
      expect(call.landmarks?.length).toBeGreaterThan(0)
      // 回贴结果才是交付像素
      expect(run.saved.map((entry) => entry.dataUrl)).toEqual([SCOPED_IMAGE])
      expect(run.logs.some((line) => line.includes('scoped retouch applied'))).toBe(true)
    })

    it('身形档位 → 蒙版要人物（分割），日志写清罩了哪儿', async () => {
      const run = buildStub()
      const scope = scopeStub()
      const { result } = await runPortrait(
        run,
        { portraitRetouch: retouchWithClause({ waistSlim: 'strong' }) },
        scope.stub
      )

      expect(result.ok, result.error).toBe(true)
      expect(scope.calls[0]?.mask.person).toBe(true)
      // 提示词里还带着质感档位（面部范围）→ 日志要如实写「脸 + 人物」
      expect(scope.calls[0]?.mask.face).toBe(true)
      expect(run.logs.some((line) => line.includes('scoped retouch applied (face+person'))).toBe(
        true
      )
    })

    it('面板开关设为 global：不调用回贴，直接用模型整图结果', async () => {
      const run = buildStub()
      const scope = scopeStub()
      const { result } = await runPortrait(
        run,
        { portraitRetouch: retouchWithClause(), portraitScopeMode: 'global' },
        scope.stub
      )

      expect(result.ok, result.error).toBe(true)
      expect(scope.calls).toHaveLength(0)
      expect(run.saved.map((entry) => entry.dataUrl)).toEqual([MODEL_IMAGE])
      expect(run.logs.some((line) => line.includes('scoped retouch off (switch)'))).toBe(true)
    })

    it('全局项（调色 / 换背景）在场：整体放弃蒙版并说明原因，否则全局效果会被裁掉', async () => {
      const run = buildStub()
      const scope = scopeStub()
      const { result } = await runPortrait(
        run,
        { portraitRetouch: retouchWithClause({ lutId: 'fuji' }) },
        scope.stub
      )

      expect(result.ok, result.error).toBe(true)
      expect(scope.calls).toHaveLength(0)
      expect(run.saved.map((entry) => entry.dataUrl)).toEqual([MODEL_IMAGE])
      expect(run.logs.some((line) => line.includes('scoped retouch off (global request)'))).toBe(
        true
      )
    })

    it('回贴能力没给出可用蒙版（applied:false）：沿用整张结果并记录降级原因', async () => {
      const run = buildStub()
      const scope = scopeStub()
      scope.setApplied(false)
      const { result } = await runPortrait(
        run,
        { portraitRetouch: retouchWithClause() },
        scope.stub
      )

      expect(result.ok, result.error).toBe(true)
      expect(run.saved.map((entry) => entry.dataUrl)).toEqual([MODEL_IMAGE])
      expect(run.logs.some((line) => line.includes('face landmarks unavailable'))).toBe(true)
    })

    it('证件照规格在场：整图语义，不套蒙版（裁切框依赖完整构图）', async () => {
      const run = buildStub()
      const scope = scopeStub()
      const { result } = await runPortrait(
        run,
        { portraitRetouch: retouchWithClause({ idPhotoSpecId: 'oneInch' }) },
        scope.stub
      )

      expect(result.ok, result.error).toBe(true)
      expect(scope.calls).toHaveLength(0)
      expect(run.logs.some((line) => line.includes('scoped retouch off (idPhoto request)'))).toBe(
        true
      )
    })
  })

  describe('证件照', () => {
    const idPhotoParams = (sheet: boolean) => ({
      portraitRetouch: retouchWithClause({
        idPhotoSpecId: 'oneInch',
        idPhotoBg: 'blue',
        idPhotoSheet: sheet
      })
    })

    it('未开拼版：按规格算出的裁切框与像素尺寸交给几何能力，主图落盘并回写规格', async () => {
      const run = buildStub()
      run.setIdPhotoResult({ dataUrl: ID_PHOTO_CROPPED, sheetDataUrl: null })
      const { node, result } = await runPortrait(run, idPhotoParams(false))

      expect(result.ok, result.error).toBe(true)
      // 量尺寸走的是解析后的上游参考图
      expect(run.inspectCalls).toEqual([SOURCE_URL])
      expect(run.idPhotoCalls).toHaveLength(1)
      const call = run.idPhotoCalls[0]!

      // 25×35mm @ 默认 300dpi
      expect(call.outputWidth).toBe(295)
      expect(call.outputHeight).toBe(413)
      expect(call.sourceDataUrl).toBe(MODEL_IMAGE)
      expect(call.sheet).toBeNull()
      expect(call.crop.x).toBeGreaterThanOrEqual(0)
      expect(call.crop.y).toBeGreaterThanOrEqual(0)
      expect(call.crop.w).toBeGreaterThan(0)
      expect(call.crop.h).toBeGreaterThan(0)
      expect(call.crop.x + call.crop.w).toBeLessThanOrEqual(1.000001)
      expect(call.crop.y + call.crop.h).toBeLessThanOrEqual(1.000001)

      // 主图用几何能力的输出（而不是模型原图）落盘
      expect(run.saved.map((entry) => entry.dataUrl)).toEqual([ID_PHOTO_CROPPED])
      expect(node.params.portraitIdPhotoPlan?.specId).toBe('oneInch')
      expect(node.params.portraitIdPhotoPlan?.outputWidth).toBe(call.outputWidth)
      expect(node.params.portraitIdPhotoPlan?.outputHeight).toBe(call.outputHeight)
      expect(node.params.portraitIdPhotoPlan?.crop).toEqual(call.crop)
      expect(node.params.portraitIdPhotoPlan?.sheet).toBeNull()
      // 同一次 Cook 也要通过 patch 即时回写（UI 不等落盘）
      expect(patchWith(run, 'portraitIdPhotoPlan').portraitIdPhotoPlan).not.toBeUndefined()
    })

    it('开启拼版：plan.sheet 非空，拼版图作为第二条图库项落盘', async () => {
      const run = buildStub()
      run.setIdPhotoResult({ dataUrl: ID_PHOTO_CROPPED, sheetDataUrl: ID_PHOTO_SHEET })
      const { node, result } = await runPortrait(run, idPhotoParams(true))

      expect(result.ok, result.error).toBe(true)
      expect(run.idPhotoCalls).toHaveLength(1)
      const call = run.idPhotoCalls[0]!
      expect(call.sheet).not.toBeNull()
      const sheet = call.sheet!
      expect(sheet.cellWidth).toBe(call.outputWidth)
      expect(sheet.cellHeight).toBe(call.outputHeight)
      expect(sheet.count).toBe(sheet.cols * sheet.rows)
      expect(sheet.count).toBeGreaterThan(1)

      expect(run.saved.map((entry) => entry.dataUrl)).toEqual([ID_PHOTO_CROPPED, ID_PHOTO_SHEET])
      expect((node.params.generatedImages ?? []).length).toBe(2)
      // 主图（第一张）才是回写进 portraitBakedRelativePath 的那张
      expect(String(node.params.portraitBakedRelativePath)).toBe(
        String(patchWith(run, 'portraitBakedRelativePath').portraitBakedRelativePath)
      )
      expect(node.params.portraitIdPhotoPlan?.sheet?.count).toBe(sheet.count)
      expect(node.params.portraitIdPhotoPlan?.sheet?.paper).toBe('fiveInch')
    })

    it('几何能力抛错时整图仍然成功，模型图原样落盘', async () => {
      const run = buildStub()
      const { result } = await runPortrait(run, idPhotoParams(true), {
        composePortraitIdPhoto: async () => {
          throw new Error('canvas offline')
        }
      })

      expect(result.ok, result.error).toBe(true)
      expect(run.saved.map((entry) => entry.dataUrl)).toEqual([MODEL_IMAGE])
    })

    it('几何能力未注入时整图仍然成功，模型图原样落盘', async () => {
      const run = buildStub()
      const { result } = await runPortrait(run, idPhotoParams(true), {
        composePortraitIdPhoto: undefined
      })

      expect(result.ok, result.error).toBe(true)
      expect(run.saved.map((entry) => entry.dataUrl)).toEqual([MODEL_IMAGE])
      expect(run.inspectCalls).toHaveLength(1)
    })
  })

  describe('提示词细节：负面词与背景虚化', () => {
    it('档位推到「强」时负面提示词随正文一起发给模型', async () => {
      const run = buildStub()
      const { result } = await runPortrait(run, {
        portraitRetouch: normalizePortraitRetouch({ skinSmoothing: 'max' })
      })

      expect(result.ok, result.error).toBe(true)
      const prompt = run.generateCalls[0]!.prompt
      // 负面提示词没有独立的 API 字段，与 imageEdit 同口径拼在正文之后
      expect(prompt).toContain('负面提示')
      expect(prompt).toContain('塑料感')
    })

    it('档位温和时不塞无谓的负面词（避免削弱模型对正向诉求的执行力）', async () => {
      const run = buildStub()
      const { result } = await runPortrait(run, {
        portraitRetouch: retouchWithClause()
      })

      expect(result.ok, result.error).toBe(true)
      expect(run.generateCalls[0]!.prompt).not.toContain('负面提示')
    })

    it('「仅虚化背景」也能出图：虚化不需要人像分割，且不再是空提示词', async () => {
      const run = buildStub()
      const { result } = await runPortrait(run, {
        portraitRetouch: normalizePortraitRetouch({ bgMode: 'blur', bgBlur: 'standard' })
      })

      expect(result.ok, result.error).toBe(true)
      expect(run.generateCalls[0]!.prompt).toContain('背景')
    })
  })
})
