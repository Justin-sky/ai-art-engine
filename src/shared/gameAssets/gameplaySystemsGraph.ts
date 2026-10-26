/**
 * 复杂游戏玩法系统图谱：天赋技能树（DAG）、合成建造配方（Crafting）、任务链（Quests）与敌人 AI 状态机/行为树（FSM/BT）纯函数层。
 *
 * 解决非平面关系型游戏设计需求：
 * 1. 天赋技能树 DAG（`skillTree`）：支持前置节点列表 `prerequisiteIds`、无环拓扑检测 `validateSkillTreeDag`；
 * 2. 物品合成与建造系统（`craftingRecipes`）：工作台、多材料消耗、产物与制造耗时；
 * 3. 任务与成就状态链（`quests`）：多目标进度、前置任务、奖励列表；
 * 4. 敌人与 Boss AI 有限状态机与行为树（`aiBehaviors`）：状态列表、条件转移边（如 `hp_ratio < 0.5` 进入二阶段狂暴）；
 * 5. 自动生成可视化 Mermaid 图表（`mermaidDiagram`），供策划与程序直接审阅技能树与 AI 状态流转。
 */

export interface SkillTreeNode {
  id: string
  name: string
  tier: number
  maxRank: number
  costPoints: number
  prerequisiteIds: string[]
  statModifiers: Record<string, number>
  iconAsset?: string
  description: string
}

export interface CraftingIngredient {
  itemId: string
  count: number
}

export interface CraftingRecipe {
  id: string
  name: string
  station: string
  ingredients: CraftingIngredient[]
  resultItemId: string
  resultCount: number
  craftTimeSec: number
  unlockCondition?: string
}

export interface QuestObjective {
  type: 'kill' | 'collect' | 'talk' | 'reach' | 'craft'
  targetId: string
  requiredCount: number
  description: string
}

export interface QuestNode {
  id: string
  title: string
  category: 'main' | 'side' | 'bounty' | 'achievement'
  prerequisiteQuestIds: string[]
  objectives: QuestObjective[]
  rewardGold: number
  rewardExp: number
  rewardItemIds: string[]
  nextQuestId?: string
}

export interface AiStateTransition {
  fromState: string
  toState: string
  condition: string
  priority: number
}

export interface EnemyAiBehaviorGraph {
  id: string
  enemyName: string
  initialState: string
  states: Array<{
    stateId: string
    animClip: string
    moveSpeedMultiplier: number
    actionType:
      | 'idle'
      | 'patrol'
      | 'chase'
      | 'melee_attack'
      | 'ranged_attack'
      | 'aoe_skill'
      | 'enrage'
      | 'flee'
    cooldownSec?: number
  }>
  transitions: AiStateTransition[]
}

export interface SkillTreeValidationResult {
  valid: boolean
  missingPrerequisiteRefs: Array<{ nodeId: string; missingId: string }>
  cycleNodeIds: string[]
  topologicalOrder: string[]
}

export interface GameplaySystemsInput {
  systemName?: string
  skillTree?: Partial<SkillTreeNode>[]
  craftingRecipes?: Partial<CraftingRecipe>[]
  quests?: Partial<QuestNode>[]
  aiBehaviors?: Partial<EnemyAiBehaviorGraph>[]
}

export interface GameplaySystemsBundle {
  schemaVersion: 1
  systemName: string
  skillTree: SkillTreeNode[]
  skillTreeValidation: SkillTreeValidationResult
  craftingRecipes: CraftingRecipe[]
  quests: QuestNode[]
  aiBehaviors: EnemyAiBehaviorGraph[]
  /** 可视化技能树与 AI 状态机 Mermaid 流程图 */
  mermaidDiagram: string
  jsonText: string
}

/**
 * 校验技能树是否为合法有向无环图（DAG），检测悬空前置引用与循环依赖。
 */
export function validateSkillTreeDag(nodes: SkillTreeNode[]): SkillTreeValidationResult {
  const byId = new Map<string, SkillTreeNode>()
  for (const n of nodes) byId.set(n.id, n)

  const missingPrerequisiteRefs: Array<{ nodeId: string; missingId: string }> = []
  const inDegree = new Map<string, number>()
  const adj = new Map<string, string[]>()

  for (const n of nodes) {
    inDegree.set(n.id, 0)
    adj.set(n.id, [])
  }

  for (const n of nodes) {
    for (const pre of n.prerequisiteIds) {
      if (!byId.has(pre)) {
        missingPrerequisiteRefs.push({ nodeId: n.id, missingId: pre })
        continue
      }
      adj.get(pre)!.push(n.id)
      inDegree.set(n.id, (inDegree.get(n.id) ?? 0) + 1)
    }
  }

  const queue: string[] = []
  for (const [id, deg] of inDegree.entries()) {
    if (deg === 0) queue.push(id)
  }

  const topologicalOrder: string[] = []
  while (queue.length > 0) {
    const curr = queue.shift()!
    topologicalOrder.push(curr)
    for (const next of adj.get(curr) ?? []) {
      const nextDeg = (inDegree.get(next) ?? 1) - 1
      inDegree.set(next, nextDeg)
      if (nextDeg === 0) queue.push(next)
    }
  }

  const cycleNodeIds = nodes.map((n) => n.id).filter((id) => !topologicalOrder.includes(id))

  return {
    valid: missingPrerequisiteRefs.length === 0 && cycleNodeIds.length === 0,
    missingPrerequisiteRefs,
    cycleNodeIds,
    topologicalOrder
  }
}

export function buildGameplaySystemsBundle(
  input: GameplaySystemsInput = {}
): GameplaySystemsBundle {
  const systemName = (input.systemName || 'core_gameplay_systems').trim() || 'core_gameplay_systems'

  const skillTree: SkillTreeNode[] = (input.skillTree ?? []).map((n, idx) => ({
    id: (n.id || `talent_${idx + 1}`).trim(),
    name: (n.name || `Talent_${idx + 1}`).trim(),
    tier: Math.max(1, Math.round(n.tier ?? 1)),
    maxRank: Math.max(1, Math.round(n.maxRank ?? 5)),
    costPoints: Math.max(1, Math.round(n.costPoints ?? 1)),
    prerequisiteIds: Array.isArray(n.prerequisiteIds) ? n.prerequisiteIds.map(String) : [],
    statModifiers: n.statModifiers ?? { atk_pct: 0.05 },
    iconAsset: n.iconAsset,
    description: (n.description || '').trim()
  }))

  const skillTreeValidation = validateSkillTreeDag(skillTree)

  const craftingRecipes: CraftingRecipe[] = (input.craftingRecipes ?? []).map((r, idx) => ({
    id: (r.id || `recipe_${idx + 1}`).trim(),
    name: (r.name || `Recipe_${idx + 1}`).trim(),
    station: (r.station || 'anvil').trim(),
    ingredients: Array.isArray(r.ingredients)
      ? r.ingredients.map((ing) => ({
          itemId: String(ing.itemId || 'item_ore'),
          count: Math.max(1, Math.round(Number(ing.count ?? 1)))
        }))
      : [],
    resultItemId: (r.resultItemId || `item_${idx + 1}`).trim(),
    resultCount: Math.max(1, Math.round(r.resultCount ?? 1)),
    craftTimeSec: Math.max(0, Number(r.craftTimeSec ?? 2.0)),
    unlockCondition: r.unlockCondition
  }))

  const quests: QuestNode[] = (input.quests ?? []).map((q, idx) => ({
    id: (q.id || `quest_${idx + 1}`).trim(),
    title: (q.title || `Quest_${idx + 1}`).trim(),
    category: q.category ?? 'main',
    prerequisiteQuestIds: Array.isArray(q.prerequisiteQuestIds)
      ? q.prerequisiteQuestIds.map(String)
      : [],
    objectives: Array.isArray(q.objectives) ? q.objectives : [],
    rewardGold: Math.max(0, Math.round(q.rewardGold ?? 100)),
    rewardExp: Math.max(0, Math.round(q.rewardExp ?? 50)),
    rewardItemIds: Array.isArray(q.rewardItemIds) ? q.rewardItemIds.map(String) : [],
    nextQuestId: q.nextQuestId
  }))

  const aiBehaviors: EnemyAiBehaviorGraph[] = (input.aiBehaviors ?? []).map((b, idx) => ({
    id: (b.id || `ai_${idx + 1}`).trim(),
    enemyName: (b.enemyName || `Boss_${idx + 1}`).trim(),
    initialState: (b.initialState || 'idle').trim(),
    states:
      Array.isArray(b.states) && b.states.length > 0
        ? b.states
        : [
            { stateId: 'idle', animClip: 'idle', moveSpeedMultiplier: 0, actionType: 'idle' },
            { stateId: 'chase', animClip: 'run', moveSpeedMultiplier: 1.0, actionType: 'chase' },
            {
              stateId: 'attack',
              animClip: 'attack',
              moveSpeedMultiplier: 0,
              actionType: 'melee_attack',
              cooldownSec: 1.5
            },
            {
              stateId: 'enrage',
              animClip: 'skill',
              moveSpeedMultiplier: 1.4,
              actionType: 'enrage',
              cooldownSec: 8.0
            }
          ],
    transitions:
      Array.isArray(b.transitions) && b.transitions.length > 0
        ? b.transitions
        : [
            {
              fromState: 'idle',
              toState: 'chase',
              condition: 'distance_to_player < 260',
              priority: 1
            },
            {
              fromState: 'chase',
              toState: 'attack',
              condition: 'distance_to_player <= 48',
              priority: 2
            },
            {
              fromState: 'attack',
              toState: 'chase',
              condition: 'distance_to_player > 56',
              priority: 1
            },
            {
              fromState: 'chase',
              toState: 'enrage',
              condition: 'hp_ratio <= 0.5',
              priority: 3
            }
          ]
  }))

  const mermaidLines: string[] = ['flowchart TD']
  for (const node of skillTree) {
    mermaidLines.push(`  ${node.id}["${node.name} (T${node.tier})"]`)
    for (const pre of node.prerequisiteIds) {
      mermaidLines.push(`  ${pre} --> ${node.id}`)
    }
  }
  for (const ai of aiBehaviors) {
    for (const tr of ai.transitions) {
      mermaidLines.push(
        `  ${ai.id}_${tr.fromState}["${ai.enemyName}:${tr.fromState}"] -->|${tr.condition}| ${ai.id}_${tr.toState}["${ai.enemyName}:${tr.toState}"]`
      )
    }
  }

  const mermaidDiagram = mermaidLines.join('\n')
  const payload = {
    schemaVersion: 1 as const,
    systemName,
    skillTree,
    skillTreeValidation,
    craftingRecipes,
    quests,
    aiBehaviors,
    mermaidDiagram
  }

  return {
    ...payload,
    jsonText: JSON.stringify(payload, null, 2)
  }
}
