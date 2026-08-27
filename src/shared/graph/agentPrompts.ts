/**
 * 通用 Agent 提示词编排层：与具体业务域解耦的双语 Agent 包、质检审核包构建器与结论解析。
 * 领域专用的「分镜师/动画师/导演」文案（见 episodeAgentPrompts.ts）只是本层的具体实例。
 */

/** 通用双语 Agent 提示词包（规划 / 生成 / 质检角色共用） */
export interface AgentPromptPack {
  systemPromptZh: string
  systemPromptEn: string
  instructionZh: string
  instructionEn: string
}

/** 流水线中的三类 Agent 角色 */
export type AgentRole = 'planner' | 'generator' | 'reviewer'

/** 通用质检审核框架（领域无关）：只判定、不修改产物 */
export const AGENT_REVIEW_FRAMEWORK_ZH = `你是一名资深质检审核员，负责拿原始输入和上一阶段产物作为依据，对当前产物做专业级审核；不是只看格式，也不是只挑错。你只判定并给出原因，绝不修改产物。

审核维度：
1. 完整性：是否覆盖目标任务的全部要求；是否丢失关键内容、约束或必要字段。
2. 一致性：跨产物/跨批次的主体、风格、命名、关系是否连贯一致。
3. 结构与规范：字段、格式、层级是否齐全且符合约定。
4. 逻辑与合理性：内容、时序、因果是否成立。
5. 可执行性：是否可直接进入下游处理，是否存在会导致下游失败的缺陷。`

export const AGENT_REVIEW_FRAMEWORK_EN = `You are a senior quality reviewer. Use the original input and prior-stage artifacts as your reference, and review the current artifact professionally; not format-checking alone. Only judge and give reasons — never edit the artifact.

Review dimensions:
1. Completeness: does it cover all requirements of the target task; are key content, constraints, or required fields missing?
2. Consistency: subject, style, naming, and relationships stay coherent across artifacts/batches.
3. Structure & spec: fields, format, and hierarchy are complete and follow the convention.
4. Logic & reasonableness: content, timeline, and causality hold up.
5. Executability: it can proceed to downstream processing with no defect that would break it.`

/** 通用质检通过标准（领域无关） */
export const AGENT_PASS_STANDARD_ZH = `通过标准（必须遵守，禁止默认 PASS）：
1. 只有同时满足以下条件才可 PASS：
   - 五项维度中没有 1~2 分的“不达标”项；
   - 五项维度平均分 >= 4.0；
   - 本阶段所有“硬性必须项”全部通过。
2. 出现任一情况必须 FAIL：
   - 结构残缺：缺字段、缺内容、缺必要项；
   - 与原始输入或上一阶段产物存在事实冲突；
   - 主体、风格、命名或关系连续性被破坏；
   - 内容或时序明显违反逻辑；
   - 会导致下游处理失败。
3. 3 分表示“勉强可用但存在专业瑕疵”：不要轻易 PASS；只有该瑕疵不影响整体质量、连续性与下游处理，且你已在审核清单中注明时，才可 PASS。
4. FAIL 时列 2~3 条最关键的、可执行的原因，逐条指出产物位置和修改方式；禁止空泛批评。`

export const AGENT_PASS_STANDARD_EN = `Passing standard (mandatory, do NOT default to PASS):
1. PASS only when ALL of the following hold:
   - No dimension scores 1–2 ("not acceptable").
   - Average score across the five dimensions is >= 4.0.
   - Every "hard requirement" in this stage's checklist passes.
2. FAIL whenever any of the following is true:
   - Structural incompleteness: missing fields, content, or required items.
   - Factual conflicts with the original input or prior-stage artifacts.
   - Broken continuity in subject, style, naming, or relationships.
   - Content or timeline clearly violates logic.
   - The artifact would break downstream processing.
3. A score of 3 means "barely usable but professionally flawed": do not PASS lightly. PASS only when the flaw does not affect overall quality, continuity, or downstream processing, and you have noted it in the review checklist.
4. On FAIL, list 2–3 critical, actionable reasons, each pointing to the artifact location and how to fix it. No vague criticism.`

/** 通用审核包构建输入 */
export interface BuildAgentReviewPackInput {
  /** 本阶段硬性检查清单（逐条） */
  checkZh: string
  checkEn: string
  /** 审核对象名 */
  targetZh: string
  targetEn: string
  /** 上游语境说明（@n 与上一阶段产物的对应关系） */
  contextZh: string
  contextEn: string
  /** 审核框架覆盖（缺省用通用五维框架） */
  frameworkZh?: string
  frameworkEn?: string
  /** 通过标准覆盖（缺省用通用通过标准） */
  passStandardZh?: string
  passStandardEn?: string
}

/** 组装一个阶段级质检审核提示词包（人设 + 本阶段检查项 + 可解析输出协议） */
export function buildAgentReviewPack(input: BuildAgentReviewPackInput): AgentPromptPack {
  const frameworkZh = input.frameworkZh ?? AGENT_REVIEW_FRAMEWORK_ZH
  const frameworkEn = input.frameworkEn ?? AGENT_REVIEW_FRAMEWORK_EN
  const passZh = input.passStandardZh ?? AGENT_PASS_STANDARD_ZH
  const passEn = input.passStandardEn ?? AGENT_PASS_STANDARD_EN

  return {
    systemPromptZh: `${frameworkZh}

${passZh}

审核对象：${input.targetZh}。硬性检查清单：
${input.checkZh}

输出协议（必须严格，供状态机解析）：
先输出简短「## 审核清单」，逐项给出 1~5 分与一句话；然后单独一行输出结论。
## 结论: PASS
或
## 结论: FAIL (原因: <可执行的修改原因1>；<原因2>)`,
    systemPromptEn: `${frameworkEn}

${passEn}

Review target: ${input.targetEn}. Hard requirement checklist:
${input.checkEn}

Output protocol (strict, machine-parseable):
First emit a short "## 审核清单" with a 1–5 score and one sentence per item; then a single conclusion line.
## 结论: PASS
or
## 结论: FAIL (原因: <actionable reason 1>；<reason 2>)`,
    instructionZh: `请以质检审核员身份审核上方连接的产物。${input.contextZh} 请对照原始输入与上一阶段产物逐项比对。严格按通过标准：五项无 1~2 分且平均 >=4 才 PASS，否则 FAIL。输出 ## 结论: PASS 或 ## 结论: FAIL (原因: …)。`,
    instructionEn: `Review the upstream artifacts as quality reviewer. ${input.contextEn} Compare against the original input and prior-stage artifacts. Strictly follow the passing standard: PASS only when no dimension is 1–2 and the average is >=4; otherwise FAIL. Output ## 结论: PASS or ## 结论: FAIL (原因: …).`
  }
}

/** 按界面语言选择系统提示词或指令 */
export function pickAgentPrompt(
  pack: AgentPromptPack,
  locale: string | undefined,
  field: 'systemPrompt' | 'instruction'
): string {
  const english = (locale ?? '').toLowerCase().startsWith('en')
  if (field === 'systemPrompt') return english ? pack.systemPromptEn : pack.systemPromptZh
  return english ? pack.instructionEn : pack.instructionZh
}

/**
 * 解析质检结论：`## 结论: PASS` 或 `## 结论: FAIL (原因: …)`。
 * 兼容全角标点、下一行原因、审核清单前置等形态；无结论返回 null。
 */
export function parseAgentVerdict(
  text: string
): { result: 'PASS' | 'FAIL'; reason: string } | null {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!.trim()
    const match = /^##\s*结论\s*[:：]\s*(PASS|FAIL)\b/i.exec(line)
    if (!match) continue
    const result = match[1]!.toUpperCase() === 'PASS' ? 'PASS' : 'FAIL'
    let reason = ''
    if (result === 'FAIL') {
      const normalized = line.replace(/（/g, '(').replace(/）/g, ')')
      const inline = /\(原因\s*[:：]\s*([\s\S]*)\)/i.exec(normalized)
      if (inline) {
        reason = inline[1]!.trim()
      } else {
        const reasonLines: string[] = []
        for (let next = index + 1; next < lines.length; next++) {
          const nextLine = lines[next]!.trim()
          if (/^##\s*/.test(nextLine)) break
          if (!nextLine) continue
          reasonLines.push(nextLine)
          if (reasonLines.length >= 3) break
        }
        reason = reasonLines
          .join(' ')
          .replace(/^[-*]\s*/, '')
          .replace(/^原因\s*[:：]\s*/i, '')
          .trim()
      }
    }
    return { result, reason }
  }
  return null
}
