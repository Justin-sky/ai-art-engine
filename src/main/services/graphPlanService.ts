import {
  buildGraphPlanCatalog,
  materializeGraphPlan,
  parseGraphPlanJson,
  type GraphDocument,
  type GraphPlan
} from '@shared/graph'
import { openRouterClient } from './openRouterClient'
import { projectService } from './projectService'
import type { AssetInfo } from '@shared/domain'

export interface GenerateAiWorkflowInput {
  prompt: string
  folderId?: string | null
  /** 可选：覆盖默认文本模型 */
  model?: string
  providerInstanceId?: string
}

export interface GenerateAiWorkflowResult {
  ok: boolean
  assetId?: string
  title?: string
  warnings: string[]
  error?: string
}

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

function buildSystemPrompt(): string {
  return `你是节点图画布编排助手。根据用户需求输出一个 GraphPlan JSON（不要 Markdown，不要解释）。

规则：
1. 只使用下列 catalog 中的 typeId，禁止编造类型。
2. 节点数 4～12；形成从输入到输出的完整数据流。
3. 边的 from/to 使用节点 key；端口 dataType 必须兼容（image≠images，除非单数接复数口）。
4. 不要编造 assetId；模型相关 params 可省略。
5. 可用 params 仅限：text, generateInstruction, generateAspectRatio, generateResolution, generateDuration, generateCount, generateFrameMode, generateAudio, notes, label, inputDataType。
6. 常见链：play.script / 文本优化 → asset.image 图生 → asset.video 视频生成；或分镜相关节点。
7. 输出严格为此 JSON 形状：
{"title":"短标题","nodes":[{"key":"a","typeId":"...","title":"可选","params":{}}],"edges":[{"from":"a","to":"b","fromPort":"out","toPort":"in"}]}

可用节点 catalog：
${catalogPromptBlock()}`
}

function toPlainDocument(doc: GraphDocument): GraphDocument {
  return JSON.parse(JSON.stringify(doc)) as GraphDocument
}

async function requestPlan(
  userPrompt: string,
  system: string,
  input: GenerateAiWorkflowInput
): Promise<string> {
  const result = await openRouterClient.generateText({
    prompt: userPrompt,
    system,
    model: input.model,
    providerInstanceId: input.providerInstanceId
  })
  return result.text
}

function tryMaterialize(plan: GraphPlan): ReturnType<typeof materializeGraphPlan> {
  return materializeGraphPlan(plan, {
    scope: 'canvasAsset',
    assetType: 'canvas'
  })
}

/**
 * 自然语言 → GraphPlan → 新建 canvas 资产（含 graphJson）
 */
export async function generateAiWorkflow(
  input: GenerateAiWorkflowInput
): Promise<GenerateAiWorkflowResult> {
  const prompt = input.prompt?.trim()
  if (!prompt) {
    return { ok: false, warnings: [], error: '请输入工作流描述' }
  }
  if (!projectService.isOpen()) {
    return { ok: false, warnings: [], error: '请先打开工程' }
  }

  const system = buildSystemPrompt()
  let warnings: string[] = []
  let planText = ''

  try {
    planText = await requestPlan(prompt, system, input)
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
        `${prompt}\n\n上次输出无法解析：${parseError}\n请只输出合法 JSON GraphPlan。`,
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

  let materialized = tryMaterialize(plan)
  warnings = [...materialized.warnings]

  if (!materialized.ok || !materialized.document) {
    try {
      planText = await requestPlan(
        `${prompt}\n\n上次物化失败：${materialized.error || '无可用节点'}\n警告：${warnings.join('；') || '无'}\n请修正 typeId 与连线后重新输出完整 GraphPlan JSON。`,
        system,
        input
      )
      plan = parseGraphPlanJson(planText)
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
      warnings,
      error: err instanceof Error ? err.message : String(err)
    }
  }

  return {
    ok: true,
    assetId: asset.id,
    title: asset.name,
    warnings
  }
}
