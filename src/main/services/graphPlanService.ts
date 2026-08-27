import {
  applyDefaultGenerateModels,
  buildGraphPlanCatalog,
  buildGraphPlanPreview,
  cloneGraphPlan,
  getAiWorkflowPresetPlan,
  hasAiWorkflowPresetPlan,
  inferHostInterfaceFromGraph,
  materializeGraphPlan,
  parseGraphPlanJson,
  type GraphPlan,
  type GraphPlanMediaModelDefaults,
  type GraphPlanPreview
} from '@shared/graph'
import { modelProviderFacade } from './modelProviders'
import { fail, defErrSimple } from '@shared/errors/appError'
import { projectService } from './projectService'
import type { AssetInfo } from '@shared/domain'

// ── AI 规划管线个性错误（result.error 字段直接展示；模型输出内容不做翻译）──
const E_GRAPHPLAN_SELECT_TEXT_MODEL = defErrSimple(
  'graphPlan.selectTextModel',
  '请选择文本模型',
  'Select a text model first'
)
const E_GRAPHPLAN_EMPTY_MODEL_RESPONSE = defErrSimple(
  'graphPlan.emptyModelResponse',
  '模型未返回有效内容',
  'Model returned no valid content'
)
const E_GRAPHPLAN_PRESET_NO_TEMPLATE = defErrSimple(
  'graphPlan.presetNoSeedTemplate',
  '当前预设没有固化模板',
  'This preset has no seed template'
)
const E_GRAPHPLAN_SEED_NOT_MATERIALIZABLE = defErrSimple(
  'graphPlan.seedNotMaterializable',
  '模板无法物化',
  'The seed template could not be materialized'
)
const E_GRAPHPLAN_PROMPT_REQUIRED = defErrSimple(
  'graphPlan.promptRequired',
  '请输入工作流描述或选择预设模板',
  'Enter a workflow description or pick a preset template'
)
const E_GRAPHPLAN_NOT_MATERIALIZABLE = defErrSimple(
  'graphPlan.notMaterializable',
  '无法物化工作流',
  'Could not materialize the workflow'
)
const E_GRAPHPLAN_OPEN_PROJECT_FIRST = defErrSimple(
  'graphPlan.openProjectFirst',
  '请先打开工程',
  'Open a project first'
)
const E_GRAPHPLAN_NOTHING_TO_COMMIT = defErrSimple(
  'graphPlan.nothingToCommit',
  '没有可创建的工作流计划',
  'No workflow plan to commit'
)

export interface PlanAiWorkflowInput extends GraphPlanMediaModelDefaults {
  prompt: string
  /** 文本模型（AI 规划） */
  model?: string
  providerInstanceId?: string
  /** 预设 id：注入固化骨架 */
  presetId?: string
  /** 直接使用种子计划，不调用模型 */
  useSeedOnly?: boolean
  seedPlan?: GraphPlan
}

/** AI 规划时的模型调用明细（写入执行日志） */
export interface PlanAiWorkflowApiCall {
  model: string
  request: {
    prompt?: string
    system?: string
    model?: string
    providerInstanceId?: string
  }
  response?: {
    text?: string
    model?: string
  }
  error?: string
  startedAt: number
  durationMs: number
}

export interface PlanAiWorkflowResult {
  ok: boolean
  plan?: GraphPlan
  title?: string
  preview?: GraphPlanPreview
  warnings: string[]
  error?: string
  /** 本次规划发起的模型调用（含重试）；模板直出时为空 */
  apiCalls?: PlanAiWorkflowApiCall[]
}

export interface CommitAiWorkflowInput extends GraphPlanMediaModelDefaults {
  plan: GraphPlan
  folderId?: string | null
  /** 资产显示名；缺省用计划 title */
  name?: string
}

export interface CommitAiWorkflowResult {
  ok: boolean
  assetId?: string
  title?: string
  warnings: string[]
  error?: string
}

function catalogPromptBlock(): string {
  const catalog = buildGraphPlanCatalog('subgraphAsset')
  const lines = catalog.map((entry) => {
    const ports = entry.ports
      .map((p) => `${p.direction}:${p.id}:${p.dataType}`)
      .join(', ')
    return `- ${entry.typeId} (${entry.label}) [${ports}]`
  })
  return lines.join('\n')
}

const FEW_SHOT_EXAMPLE = `示例（游戏买量骨架）：
{"title":"游戏买量","nodes":[{"key":"script","typeId":"play.script","title":"旁白","params":{"text":"卖点文案"}},{"key":"img","typeId":"asset.image","title":"关键帧","params":{"generateInstruction":"竖屏关键帧"}},{"key":"vid","typeId":"asset.video","title":"视频","params":{"generateDuration":15,"generateAspectRatio":"9:16"}},{"key":"note","typeId":"note.text","title":"备注","params":{"text":"剪辑说明"}}],"edges":[{"from":"script","to":"img"},{"from":"img","to":"vid"}]}`

function buildSystemPrompt(seedPlan?: GraphPlan | null): string {
  const seedBlock = seedPlan
    ? `\n8. 必须基于下列种子 GraphPlan 调整（可改 title/params/增删少量节点，但保持主数据流）：\n${JSON.stringify(seedPlan)}`
    : ''
  return `你是节点图画布编排助手。根据用户需求输出一个 GraphPlan JSON（不要 Markdown，不要解释）。

规则：
1. 只使用下列 catalog 中的 typeId，禁止编造类型。
2. 节点数 4～12；形成从输入到输出的完整数据流。
3. 边的 from/to 使用节点 key；端口 dataType 必须相同（image≠images，单数不能进复数口）。
4. 不要编造 assetId；不要填写 generateModel / generateProviderInstanceId（由客户端注入）。
5. 可用 params 仅限：text, generateInstruction, generateSystemPrompt, generateAspectRatio, generateResolution, generateQuality, generateDuration, generateCount, generateSeed, generateSeedUseGlobal, generateFrameMode, generateAudio, notes, label, inputDataType。
6. 常见链：play.script / prompt.optimize → asset.image → asset.video；备注用 note.text。
7. 输出严格为此 JSON 形状：
{"title":"短标题","nodes":[{"key":"a","typeId":"...","title":"可选","params":{}}],"edges":[{"from":"a","to":"b","fromPort":"out","toPort":"in"}]}
${FEW_SHOT_EXAMPLE}${seedBlock}

可用节点 catalog：
${catalogPromptBlock()}`
}

function toPlainDocument<T>(doc: T): T {
  return JSON.parse(JSON.stringify(doc)) as T
}

function resolveSeedPlan(input: PlanAiWorkflowInput): GraphPlan | null {
  if (input.seedPlan && Array.isArray(input.seedPlan.nodes)) {
    return cloneGraphPlan(input.seedPlan)
  }
  if (input.presetId && hasAiWorkflowPresetPlan(input.presetId)) {
    return getAiWorkflowPresetPlan(input.presetId)
  }
  return null
}

function withMediaDefaults(plan: GraphPlan, input: GraphPlanMediaModelDefaults): GraphPlan {
  return applyDefaultGenerateModels(plan, input)
}

function tryMaterialize(plan: GraphPlan) {
  return materializeGraphPlan(plan, {
    scope: 'subgraphAsset',
    assetType: 'subgraph'
  })
}

function needsRepair(
  materialized: ReturnType<typeof materializeGraphPlan>,
  plan: GraphPlan
): boolean {
  if (!materialized.ok || !materialized.document) return true
  const unknown = materialized.warnings.some((w) => w.includes('未知或不可添加类型'))
  const badEdge = materialized.warnings.some((w) => w.includes('端口不兼容') || w.includes('不存在的节点'))
  const noEdges = plan.nodes.length >= 2 && plan.edges.length === 0
  return unknown || badEdge || noEdges
}

async function requestPlan(
  userPrompt: string,
  system: string,
  input: PlanAiWorkflowInput,
  apiCalls: PlanAiWorkflowApiCall[]
): Promise<string> {
  const model = input.model?.trim() || ''
  if (!model) {
    throw fail(E_GRAPHPLAN_SELECT_TEXT_MODEL)
  }
  const startedAt = Date.now()
  const request = {
    prompt: userPrompt,
    system,
    model,
    providerInstanceId: input.providerInstanceId
  }
  let recorded = false
  try {
    const result = await modelProviderFacade.generateText({
      prompt: userPrompt,
      system,
      model,
      providerInstanceId: input.providerInstanceId
    })
    const text = result.text?.trim() || ''
    const endedAt = Date.now()
    apiCalls.push({
      model: result.model || model,
      request,
      response: text ? { text, model: result.model || model } : undefined,
      error: text ? undefined : fail(E_GRAPHPLAN_EMPTY_MODEL_RESPONSE).message,
      startedAt,
      durationMs: Math.max(0, endedAt - startedAt)
    })
    recorded = true
    if (!text) {
      throw fail(E_GRAPHPLAN_EMPTY_MODEL_RESPONSE)
    }
    return text
  } catch (err) {
    if (!recorded) {
      const endedAt = Date.now()
      apiCalls.push({
        model,
        request,
        error: err instanceof Error ? err.message : String(err),
        startedAt,
        durationMs: Math.max(0, endedAt - startedAt)
      })
    }
    throw err
  }
}

/**
 * 自然语言 / 种子模板 → GraphPlan（不落盘）
 */
export async function planAiWorkflow(input: PlanAiWorkflowInput): Promise<PlanAiWorkflowResult> {
  const prompt = input.prompt?.trim() || ''
  const seed = resolveSeedPlan(input)
  const apiCalls: PlanAiWorkflowApiCall[] = []

  if (input.useSeedOnly) {
    if (!seed) {
      return { ok: false, warnings: [], error: fail(E_GRAPHPLAN_PRESET_NO_TEMPLATE).message, apiCalls }
    }
    const plan = withMediaDefaults(seed, input)
    const materialized = tryMaterialize(plan)
    if (!materialized.ok) {
      return {
        ok: false,
        warnings: materialized.warnings,
        error: materialized.error || fail(E_GRAPHPLAN_SEED_NOT_MATERIALIZABLE).message,
        apiCalls
      }
    }
    return {
      ok: true,
      plan,
      title: materialized.title,
      preview: buildGraphPlanPreview(plan),
      warnings: materialized.warnings,
      apiCalls
    }
  }

  if (!prompt && !seed) {
    return { ok: false, warnings: [], error: fail(E_GRAPHPLAN_PROMPT_REQUIRED).message, apiCalls }
  }

  const system = buildSystemPrompt(seed)
  const userPrompt =
    prompt ||
    '请基于种子 GraphPlan 输出完整计划（可按常见业务略作润色 title 与 params）。'

  let planText = ''
  try {
    planText = await requestPlan(userPrompt, system, input, apiCalls)
  } catch (err) {
    return {
      ok: false,
      warnings: [],
      error: err instanceof Error ? err.message : String(err),
      apiCalls
    }
  }

  let plan: GraphPlan
  try {
    plan = parseGraphPlanJson(planText)
  } catch (err) {
    const parseError = err instanceof Error ? err.message : String(err)
    try {
      planText = await requestPlan(
        `${userPrompt}\n\n上次输出无法解析：${parseError}\n请只输出合法 JSON GraphPlan。`,
        system,
        input,
        apiCalls
      )
      plan = parseGraphPlanJson(planText)
    } catch (err2) {
      return {
        ok: false,
        warnings: [],
        error: err2 instanceof Error ? err2.message : String(err2),
        apiCalls
      }
    }
  }

  plan = withMediaDefaults(plan, input)
  let materialized = tryMaterialize(plan)
  let warnings = [...materialized.warnings]

  if (needsRepair(materialized, plan)) {
    try {
      planText = await requestPlan(
        `${userPrompt}\n\n上次计划存在问题：${materialized.error || '结构需修正'}\n警告：${warnings.join('；') || '无'}\n请修正 typeId 与连线后重新输出完整 GraphPlan JSON。`,
        system,
        input,
        apiCalls
      )
      plan = withMediaDefaults(parseGraphPlanJson(planText), input)
      materialized = tryMaterialize(plan)
      warnings = [...materialized.warnings]
    } catch (err) {
      return {
        ok: false,
        warnings,
        error: err instanceof Error ? err.message : String(err),
        apiCalls
      }
    }
  }

  if (!materialized.ok || !materialized.document) {
    return {
      ok: false,
      warnings,
      error: materialized.error || fail(E_GRAPHPLAN_NOT_MATERIALIZABLE).message,
      apiCalls
    }
  }

  return {
    ok: true,
    plan,
    title: materialized.title,
    preview: buildGraphPlanPreview(plan),
    warnings,
    apiCalls
  }
}

/**
 * 确认后的 GraphPlan → 新建 subgraph 宿主资产
 */
export async function commitAiWorkflow(
  input: CommitAiWorkflowInput
): Promise<CommitAiWorkflowResult> {
  if (!projectService.isOpen()) {
    return { ok: false, warnings: [], error: fail(E_GRAPHPLAN_OPEN_PROJECT_FIRST).message }
  }
  if (!input.plan?.nodes?.length) {
    return { ok: false, warnings: [], error: fail(E_GRAPHPLAN_NOTHING_TO_COMMIT).message }
  }

  const plan = withMediaDefaults(cloneGraphPlan(input.plan), input)
  const materialized = tryMaterialize(plan)
  if (!materialized.ok || !materialized.document) {
    return {
      ok: false,
      warnings: materialized.warnings,
      error: materialized.error || fail(E_GRAPHPLAN_NOT_MATERIALIZABLE).message
    }
  }

  const title =
    (typeof input.name === 'string' && input.name.trim()) ||
    materialized.title ||
    'AI Workflow'
  const hostInterface = inferHostInterfaceFromGraph(materialized.document)
  let asset: AssetInfo
  try {
    asset = projectService.createAsset({
      type: 'subgraph',
      folderId: input.folderId ?? null,
      name: title,
      genParams: {
        graphJson: toPlainDocument(materialized.document),
        hostInterface: toPlainDocument(hostInterface)
      }
    })
  } catch (err) {
    return {
      ok: false,
      warnings: materialized.warnings,
      error: err instanceof Error ? err.message : String(err)
    }
  }

  // 用宿主资产 id 隔离 agent-state.json，避免多个工作流共用 ep01 串历史 FAIL
  const scopedDoc = bindEpisodeScopeKey(materialized.document, asset.id)
  if (scopedDoc) {
    try {
      projectService.updateAsset({
        ...asset,
        genParams: {
          ...(asset.genParams ?? {}),
          graphJson: toPlainDocument(scopedDoc),
          hostInterface: toPlainDocument(hostInterface)
        }
      })
    } catch {
      // 创建已成功；scope 绑定失败时仍返回资产，UI 侧会以 hostAssetId 兜底
    }
  }

  return {
    ok: true,
    assetId: asset.id,
    title: asset.name,
    warnings: materialized.warnings
  }
}

/** 将剧集流水线节点的 episodeScopeKey 绑定为宿主资产 id */
function bindEpisodeScopeKey(
  document: NonNullable<ReturnType<typeof materializeGraphPlan>['document']>,
  scopeKey: string
): typeof document | null {
  const key = scopeKey.trim()
  if (!key) return null
  let touched = false
  const nodes = document.nodes.map((node) => {
    const params = node.params
    if (!params) return node
    const needsScope =
      typeof params.episodeScopeKey === 'string' ||
      typeof params.episodeStep === 'string' ||
      typeof params.episodeReviewTarget === 'string'
    if (!needsScope) return node
    touched = true
    return {
      ...node,
      params: {
        ...params,
        episodeScopeKey: key
      }
    }
  })
  return touched ? { ...document, nodes } : null
}
