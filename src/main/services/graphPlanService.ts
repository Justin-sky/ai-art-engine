import {
  applyDefaultGenerateModels,
  buildGraphPlanCatalog,
  buildGraphPlanPreview,
  cloneGraphPlan,
  getAiWorkflowPresetPlan,
  hasAiWorkflowPresetPlan,
  materializeGraphPlan,
  parseGraphPlanJson,
  type GraphPlan,
  type GraphPlanMediaModelDefaults,
  type GraphPlanPreview
} from '@shared/graph'
import { openRouterClient } from './openRouterClient'
import { projectService } from './projectService'
import type { AssetInfo } from '@shared/domain'

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

export interface PlanAiWorkflowResult {
  ok: boolean
  plan?: GraphPlan
  title?: string
  preview?: GraphPlanPreview
  warnings: string[]
  error?: string
}

export interface CommitAiWorkflowInput extends GraphPlanMediaModelDefaults {
  plan: GraphPlan
  folderId?: string | null
}

export interface CommitAiWorkflowResult {
  ok: boolean
  assetId?: string
  title?: string
  warnings: string[]
  error?: string
}

/** @deprecated 兼容旧 IPC：规划并立即落盘 */
export interface GenerateAiWorkflowInput extends PlanAiWorkflowInput {
  folderId?: string | null
}

export interface GenerateAiWorkflowResult extends CommitAiWorkflowResult {}

function catalogPromptBlock(): string {
  const catalog = buildGraphPlanCatalog('canvasAsset')
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
3. 边的 from/to 使用节点 key；端口 dataType 必须兼容（image≠images，除非单数接复数口）。
4. 不要编造 assetId；不要填写 generateModel / generateProviderInstanceId（由客户端注入）。
5. 可用 params 仅限：text, generateInstruction, generateSystemPrompt, generateAspectRatio, generateResolution, generateQuality, generateDuration, generateCount, generateFrameMode, generateAudio, notes, label, inputDataType。
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
    scope: 'canvasAsset',
    assetType: 'canvas'
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
  input: PlanAiWorkflowInput
): Promise<string> {
  const result = await openRouterClient.generateText({
    prompt: userPrompt,
    system,
    model: input.model,
    providerInstanceId: input.providerInstanceId
  })
  return result.text
}

/**
 * 自然语言 / 种子模板 → GraphPlan（不落盘）
 */
export async function planAiWorkflow(input: PlanAiWorkflowInput): Promise<PlanAiWorkflowResult> {
  const prompt = input.prompt?.trim() || ''
  const seed = resolveSeedPlan(input)

  if (input.useSeedOnly) {
    if (!seed) {
      return { ok: false, warnings: [], error: '当前预设没有固化模板' }
    }
    const plan = withMediaDefaults(seed, input)
    const materialized = tryMaterialize(plan)
    if (!materialized.ok) {
      return {
        ok: false,
        warnings: materialized.warnings,
        error: materialized.error || '模板无法物化'
      }
    }
    return {
      ok: true,
      plan,
      title: materialized.title,
      preview: buildGraphPlanPreview(plan),
      warnings: materialized.warnings
    }
  }

  if (!prompt && !seed) {
    return { ok: false, warnings: [], error: '请输入工作流描述或选择预设模板' }
  }

  const system = buildSystemPrompt(seed)
  const userPrompt =
    prompt ||
    '请基于种子 GraphPlan 输出完整计划（可按常见业务略作润色 title 与 params）。'

  let planText = ''
  try {
    planText = await requestPlan(userPrompt, system, input)
  } catch (err) {
    return {
      ok: false,
      warnings: [],
      error: err instanceof Error ? err.message : String(err)
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
        input
      )
      plan = parseGraphPlanJson(planText)
    } catch (err2) {
      return {
        ok: false,
        warnings: [],
        error: err2 instanceof Error ? err2.message : String(err2)
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
        input
      )
      plan = withMediaDefaults(parseGraphPlanJson(planText), input)
      materialized = tryMaterialize(plan)
      warnings = [...materialized.warnings]
    } catch (err) {
      return {
        ok: false,
        warnings,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  }

  if (!materialized.ok || !materialized.document) {
    return {
      ok: false,
      warnings,
      error: materialized.error || '无法物化工作流'
    }
  }

  return {
    ok: true,
    plan,
    title: materialized.title,
    preview: buildGraphPlanPreview(plan),
    warnings
  }
}

/**
 * 确认后的 GraphPlan → 新建 canvas 资产
 */
export async function commitAiWorkflow(
  input: CommitAiWorkflowInput
): Promise<CommitAiWorkflowResult> {
  if (!projectService.isOpen()) {
    return { ok: false, warnings: [], error: '请先打开工程' }
  }
  if (!input.plan?.nodes?.length) {
    return { ok: false, warnings: [], error: '没有可创建的工作流计划' }
  }

  const plan = withMediaDefaults(cloneGraphPlan(input.plan), input)
  const materialized = tryMaterialize(plan)
  if (!materialized.ok || !materialized.document) {
    return {
      ok: false,
      warnings: materialized.warnings,
      error: materialized.error || '无法物化工作流'
    }
  }

  const title = materialized.title || 'AI Workflow'
  let asset: AssetInfo
  try {
    asset = projectService.createAsset({
      type: 'canvas',
      folderId: input.folderId ?? null,
      name: title,
      genParams: {
        graphJson: toPlainDocument(materialized.document)
      }
    })
  } catch (err) {
    return {
      ok: false,
      warnings: materialized.warnings,
      error: err instanceof Error ? err.message : String(err)
    }
  }

  return {
    ok: true,
    assetId: asset.id,
    title: asset.name,
    warnings: materialized.warnings
  }
}

/**
 * 兼容：规划并立即落盘
 */
export async function generateAiWorkflow(
  input: GenerateAiWorkflowInput
): Promise<GenerateAiWorkflowResult> {
  const planned = await planAiWorkflow(input)
  if (!planned.ok || !planned.plan) {
    return {
      ok: false,
      warnings: planned.warnings,
      error: planned.error
    }
  }
  return commitAiWorkflow({
    plan: planned.plan,
    folderId: input.folderId,
    imageModel: input.imageModel,
    imageProviderInstanceId: input.imageProviderInstanceId,
    videoModel: input.videoModel,
    videoProviderInstanceId: input.videoProviderInstanceId
  })
}
