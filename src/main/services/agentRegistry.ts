/**
 * Agent 注册表：维护全部 agent 的静态配置（内置预设 + 用户自定义）与运行时状态。
 *
 * - 内置预设（planner / painter / critic）不可删除，随应用分发；
 * - 用户自定义 agent 持久化到 electron-store（aiartengine-agents），随设置保存；
 * - 运行时状态（running）由 deepseekHarnessService 上报，这里只做只读聚合。
 */
import Store from 'electron-store'
import type { AgentConfig, AgentRuntimeStatus } from '@shared/ipc'

/** 缺省 agent id：所有未显式指定 agentId 的调用落在这里（保持历史行为） */
export const DEFAULT_AGENT_ID = 'default'

/** 内置预设：id 规则 `^[A-Za-z0-9._-]{1,32}$`，name 为 UI 显示名（随 i18n 可在面板覆盖） */
export const BUILTIN_AGENTS: readonly AgentConfig[] = [
  {
    agentId: 'planner',
    name: '策划', // cjk-ok 内置 agent 显示名（落盘数据，面板直接展示；与模型提供商 label 同理，不走 i18n）
    profile: 'craft',
    color: '#4f9cf9',
    builtin: true,
    systemPrompt:
      '你是创作策划 agent：负责把用户意图拆解为可执行的创作方案（分镜、剧本、画面描述、prompt 清单），生成的结构化内容供其他 agent 消费。' // cjk-ok 内置角色描述（落盘数据，写入 dsh persona 供模型消费，属用户内容而非界面文案）
  },
  {
    agentId: 'painter',
    name: '绘图', // cjk-ok 内置 agent 显示名（落盘数据）
    profile: 'craft',
    color: '#8b6cf0',
    builtin: true,
    systemPrompt:
      '你是绘图 agent：根据描述生成高质量图像。优先使用 generate_image 等工具完成画面产出，生成后说明产物路径与设计思路。' // cjk-ok 内置角色描述（落盘数据，写入 dsh persona 供模型消费）
  },
  {
    agentId: 'critic',
    name: '审核', // cjk-ok 内置 agent 显示名（落盘数据）
    profile: 'ask',
    color: '#f0a14f',
    builtin: true,
    systemPrompt:
      '你是审核 agent：对输入的脚本、画面或生成结果做专业评审，指出问题并给出可执行的修改意见；以 ask 模式只评审、不直接产出资产。' // cjk-ok 内置角色描述（落盘数据，写入 dsh persona 供模型消费）
  }
]

/** 各内置 profile 的默认标识色（自定义 agent 未指定 color 时使用） */
const PROFILE_COLORS: Record<AgentConfig['profile'], string> = {
  craft: '#4f9cf9',
  ask: '#37b26c',
  plan: '#f0a14f',
  custom: '#8b6cf0'
}

/** agentId 合法性：文件系统安全（用于 $DSH_HOME/agents/<id> 目录名） */
export const AGENT_ID_RE = /^[A-Za-z0-9._-]{1,32}$/

type StoreSchema = {
  agents: AgentConfig[]
}

class AgentRegistry {
  private store: Store<StoreSchema> | null = null

  private ensure(): Store<StoreSchema> {
    if (!this.store) {
      this.store = new Store<StoreSchema>({
        name: 'aiartengine-agents',
        defaults: { agents: [] as AgentConfig[] }
      })
    }
    return this.store
  }

  /** 全部 agent：内置预设（default + builtin）在前，用户自定义在后 */
  list(): AgentConfig[] {
    const custom = this.ensure().get('agents') as AgentConfig[]
    return [
      { agentId: DEFAULT_AGENT_ID, name: '助手', profile: 'craft', color: '#37b26c' }, // cjk-ok 缺省 agent 显示名（落盘数据）
      ...BUILTIN_AGENTS,
      ...(Array.isArray(custom) ? custom : [])
    ]
  }

  /** 按 id 取配置；未知 id 返回 null */
  get(agentId: string): AgentConfig | null {
    return this.list().find((a) => a.agentId === agentId) ?? null
  }

  /** 新增 / 更新自定义 agent（内置预设与 default 不可修改、不可删除） */
  save(config: AgentConfig): AgentConfig[] {
    const id = String(config?.agentId ?? '').trim()
    if (!id || !AGENT_ID_RE.test(id) || id === DEFAULT_AGENT_ID) {
      throw new Error(`invalid agentId: ${JSON.stringify(id)}`)
    }
    if (BUILTIN_AGENTS.some((a) => a.agentId === id)) {
      throw new Error(`builtin agent cannot be modified: ${id}`)
    }
    const name = String(config.name ?? '').trim() || id
    const normalized: AgentConfig = {
      agentId: id,
      name,
      profile: config.profile === 'ask' || config.profile === 'plan' ? config.profile : 'craft',
      ...(config.systemPrompt?.trim() ? { systemPrompt: config.systemPrompt.trim() } : {}),
      ...(config.model?.trim() ? { model: config.model.trim() } : {}),
      ...(config.providerId?.trim() ? { providerId: config.providerId.trim() } : {}),
      ...(config.color?.trim() ? { color: config.color.trim() } : {}),
      ...(config.profile === 'custom' || !config.profile ? { profile: 'custom' as const } : {})
    }
    if (!normalized.color) normalized.color = PROFILE_COLORS[normalized.profile] ?? PROFILE_COLORS.custom
    const store = this.ensure()
    const rest = (store.get('agents') as AgentConfig[]).filter((a) => a.agentId !== id)
    const next = [...rest, normalized]
    store.set('agents', next)
    return this.list()
  }

  /** 删除自定义 agent；内置预设与 default 拒绝 */
  remove(agentId: string): AgentConfig[] {
    const id = String(agentId ?? '').trim()
    if (!id || id === DEFAULT_AGENT_ID || BUILTIN_AGENTS.some((a) => a.agentId === id)) {
      return this.list()
    }
    const store = this.ensure()
    store.set(
      'agents',
      (store.get('agents') as AgentConfig[]).filter((a) => a.agentId !== id)
    )
    return this.list()
  }
}

export const agentRegistry = new AgentRegistry()

/** 把配置列表聚合成运行时状态（running 由 harness 服务注册的回调查询） */
export function toAgentRuntimeStatus(
  configs: AgentConfig[],
  isRunning: (agentId: string) => boolean
): AgentRuntimeStatus[] {
  return configs.map((a) => ({
    agentId: a.agentId,
    name: a.name,
    profile: a.profile,
    color: a.color,
    builtin: a.builtin,
    running: isRunning(a.agentId)
  }))
}
