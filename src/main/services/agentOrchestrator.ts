/**
 * Agent 编排器（模式 C：自主协作 DAG）。
 *
 * 用户在 Orchestrator 面板提交「总目标 + 一组节点（agentId / instruction / dependsOn）」，
 * 主进程据此构造 DAG，按「依赖就绪即派发」的并行策略调度执行：
 *
 * - 节点幂等：每个节点使用独立 dsh 会话（`orch-<jobId>-<nodeId>-a<attempt>`），
 *   输入 = 总目标 + 角色指令 + 依赖节点最终文本（文件即协议的文本层）；
 * - 并行推进：每轮收集全部依赖已就绪的节点并发派发（跨 agent 真并行，全局并行上限
 *   见 MAX_PARALLEL）；同一 agent 经模块级队列锁串行（dsh 单任务，多 job 并发派发到
 *   同一 agent 也不会互相覆盖），等待 agent 空闲时才真正启动；
 *   依赖失败/被跳过 → 依赖方整体跳过；
 * - 失败策略：节点出错（异常退出 / 未产出文本）重试 1 次，仍失败标记 failed；
 * - 中止：所有运行中的节点 kill，其余节点置 skipped，job 置 aborted；
 * - 静默执行：节点任务走 runHarnessTask 的 silent=true，不向 HARNESS_EVENT 广播，
 *   避免污染用户在各 agent 标签上的会话 UI；进度仅经 ORCHESTRATOR_EVENT 推送。
 *
 * 自动拆解（planOrchestrator）：把「一句话总目标」交给策划 Agent 拆解为 DAG 节点草案，
 * 返回渲染层可编辑的节点列表（id 归一为 n1..nk、依赖重映射）；该调用走策划 agent 的
 * dsh 运行体，复用静默运行与 settle 订阅，但不创建 job。
 *
 * 事件归属：每个 job 变更即广播完整 job 快照（OrchestratorJobEvent），渲染层实时刷新。
 * 本服务模块被 main/ipc.ts 引入即完成 settle 订阅注册（与 agentBridge 同模式）。
 */
import {
  IpcChannels,
  type OrchestratorJob,
  type OrchestratorJobEvent,
  type OrchestratorNodeSpec,
  type OrchestratorNodeState,
  type OrchestratorPlanInput,
  type OrchestratorPlanResult,
  type OrchestratorRunInput,
  type OrchestratorRunResult
} from '@shared/ipc'
import { broadcastToAllWindows } from '../broadcast'
import { agentRegistry, DEFAULT_AGENT_ID } from './agentRegistry'
import {
  abortHarnessTask,
  deleteHarnessSession,
  onAgentRuntimeSettled,
  runHarnessTask,
  runtimeIsRunning
} from './deepseekHarnessService'

/** 节点 id 合法性：与会话 id 拼接要求文件系统安全 */
const NODE_ID_RE = /^[A-Za-z0-9._-]{1,32}$/
/** 单个 job 的节点数上限（防手滑超长） */
const MAX_NODES = 16
/** 节点失败重试次数上限（含首次；即失败后最多重试 1 次） */
const MAX_ATTEMPTS = 2
/** 内存保留的 job 历史条数（仅清理已终态的旧 job） */
const JOB_KEEP = 20
/** 等待目标 agent 空闲的轮询间隔 */
const POLL_IDLE_MS = 400
/** 失败重试前的短暂冷却（让瞬时占用/环境抖动消退） */
const RETRY_COOL_DOWN_MS = 1500
/** 汇总/最终文本同步到渲染层的长度上限（防超大文本卡 IPC） */
const SUMMARY_LIMIT = 20000
/** 同一时刻并发派发的节点上限（防同时拉起过多 dsh 进程挤爆慢机器；不同 agent 才真并行） */
const MAX_PARALLEL = 4
/** 自动拆解返回的节点数上限（保持可编辑、单轮可跑完） */
const MAX_PLAN_NODES = 8
/** 策划拆解会话 id 前缀（与节点会话区分，便于识别与清理） */
const PLAN_SESSION_PREFIX = 'orch-plan'

/** 内部 job 实体：共享层字段 + 中止标记 */
type JobRecord = OrchestratorJob & { aborted: boolean }

/** 一次节点派发的终态（settle 后由 runNodeAttempt 归一化） */
type AttemptOutcome =
  { kind: 'ok'; finalText: string } | { kind: 'failed'; error: string } | { kind: 'aborted' }

const jobs = new Map<string, JobRecord>()
let jobSeq = 0

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 取 agent 显示名（找不到时回退 id） */
function agentName(agentId: string): string {
  return agentRegistry.get(agentId)?.name ?? agentId
}

/** 深拷贝快照（IPC 传输 / 事件载荷用，避免调用方拿到内部可变引用） */
function snapshot(job: JobRecord): OrchestratorJob {
  return {
    jobId: job.jobId,
    title: job.title,
    goal: job.goal,
    state: job.state,
    createdAt: job.createdAt,
    ...(job.finishedAt ? { finishedAt: job.finishedAt } : {}),
    nodes: job.nodes.map((n) => ({ ...n })),
    ...(job.error ? { error: job.error } : {}),
    ...(job.summary ? { summary: job.summary } : {})
  }
}

/** 广播 job 快照给全部窗口（渲染层 Orchestrator 面板据此刷新） */
function publish(job: JobRecord): void {
  const payload: OrchestratorJobEvent = { job: snapshot(job) }
  broadcastToAllWindows(IpcChannels.ORCHESTRATOR_EVENT, payload)
}

/* ── 静默运行终结（settle）订阅：Orchestrator 据此收尾自己的 node 派发 ── */

/** 等待中的 node 派发：agentId → resolve；一次只有一个 job 在等某 agent，天然互斥 */
const pendingSettles = new Map<
  string,
  (info: { ok: boolean; finalText?: string; error?: string; sessionId?: string }) => void
>()

onAgentRuntimeSettled((info) => {
  const resolve = pendingSettles.get(info.agentId)
  if (!resolve) return
  pendingSettles.delete(info.agentId)
  resolve(info)
})

function expectSettle(agentId: string): Promise<{
  ok: boolean
  finalText?: string
  error?: string
  sessionId?: string
}> {
  return new Promise((resolve) => {
    pendingSettles.set(agentId, resolve)
  })
}

function cancelExpectation(agentId: string): void {
  pendingSettles.delete(agentId)
}

/* ── job 生命周期 ── */

/** 提交一个多 agent 编排任务；同步校验，通过后异步执行并立即返回 jobId */
export function runOrchestrator(input: OrchestratorRunInput): OrchestratorRunResult {
  const goal = String(input?.goal ?? '').trim()
  if (!goal) {
    return { ok: false, message: '总目标不能为空，请描述这次创作/评审希望达成的结果。' } // cjk-ok 运行时错误文本（沿用 harness 服务的既有文案风格）
  }
  const title = String(input?.title ?? '').trim() || goal.slice(0, 24)
  const specs = Array.isArray(input?.nodes) ? input.nodes : []
  if (!specs.length) {
    return { ok: false, message: '请至少添加一个执行节点（选择角色并填写环节说明）。' } // cjk-ok 运行时错误文本（沿用 harness 服务的既有文案风格）
  }
  if (specs.length > MAX_NODES) {
    return { ok: false, message: `节点数超出上限（最多 ${MAX_NODES} 个）。` } // cjk-ok 运行时错误文本（沿用 harness 服务的既有文案风格）
  }
  const ids = new Map<string, string>()
  for (const spec of specs) {
    const id = String(spec?.id ?? '').trim()
    if (!id || !NODE_ID_RE.test(id)) {
      return { ok: false, message: '节点 id 非法：仅支持字母、数字与 . _ -，且不超过 32 位。' } // cjk-ok 运行时错误文本（沿用 harness 服务的既有文案风格）
    }
    if (ids.has(id)) {
      return { ok: false, message: `节点 id 重复：${id}` } // cjk-ok 运行时错误文本（沿用 harness 服务的既有文案风格）
    }
    ids.set(id, id)
    const agentId = String(spec?.agentId ?? '').trim()
    if (!agentId || !agentRegistry.get(agentId)) {
      return { ok: false, message: `节点「${id}」的 Agent 不存在：${agentId}。` } // cjk-ok 运行时错误文本（沿用 harness 服务的既有文案风格）
    }
    if (agentId === 'default') {
      const msg = '编排节点不能使用缺省 Agent，请选择策划/绘图/审核等角色' // cjk-ok 运行时错误文本（沿用 harness 服务文案风格）
      return { ok: false, message: msg }
    }
  }
  // 依赖引用校验（允许引用任意位置已声明的节点，两遍校验）
  for (const spec of specs) {
    const id = String(spec.id).trim()
    for (const dep of spec.dependsOn ?? []) {
      const depId = String(dep ?? '').trim()
      if (depId === id) {
        return { ok: false, message: `节点「${id}」不能依赖自身。` } // cjk-ok 运行时错误文本（沿用 harness 服务的既有文案风格）
      }
      if (!ids.has(depId)) {
        return { ok: false, message: `节点「${id}」依赖了未定义的节点：${depId}。` } // cjk-ok 运行时错误文本（沿用 harness 服务的既有文案风格）
      }
    }
  }
  // DAG 无环校验（简单拓扑计数：源节点 = 无依赖者，逐层剥离）
  const indegree = new Map<string, number>()
  const dependents = new Map<string, string[]>()
  for (const spec of specs) {
    indegree.set(spec.id, (spec.dependsOn ?? []).length)
    for (const dep of spec.dependsOn ?? []) {
      const list = dependents.get(dep) ?? []
      list.push(spec.id)
      dependents.set(dep, list)
    }
  }
  const queue = [...indegree.entries()].filter(([, n]) => n === 0).map(([id]) => id)
  let peeled = 0
  while (queue.length) {
    const id = queue.shift()!
    peeled += 1
    for (const next of dependents.get(id) ?? []) {
      const left = (indegree.get(next) ?? 1) - 1
      indegree.set(next, left)
      if (left === 0) queue.push(next)
    }
  }
  if (peeled < specs.length) {
    return { ok: false, message: '节点依赖存在循环，请先调整依赖关系。' } // cjk-ok 运行时错误文本（沿用 harness 服务的既有文案风格）
  }

  const now = Date.now()
  const jobId = `job-${now.toString(36)}-${(++jobSeq).toString(36)}`
  const job: JobRecord = {
    jobId,
    title,
    goal,
    state: 'running',
    createdAt: now,
    nodes: specs.map((spec) => ({
      id: String(spec.id).trim(),
      agentId: String(spec.agentId).trim(),
      instruction: String(spec.instruction ?? '').trim() || String(spec.id).trim(), // cjk-ok 任务文本（发送给模型的内容，缺省回退节点 id）
      dependsOn: (spec.dependsOn ?? []).map((d) => String(d).trim()),
      state: 'pending',
      attempts: 0
    })),
    aborted: false
  }
  jobs.set(jobId, job)
  // 超出内存上限时优先淘汰最早的已终态 job（运行中的 job 保留）
  if (jobs.size > JOB_KEEP) {
    const finished = [...jobs.values()]
      .filter((j) => j.state !== 'running')
      .sort((a, b) => a.createdAt - b.createdAt)
    if (finished.length) jobs.delete(finished[0].jobId)
  }
  publish(job)
  void runJob(job)
  return { ok: true, jobId }
}

/* ── 自动拆解（planOrchestrator）：总目标 → 策划 Agent → DAG 节点草案 ── */

let planSeq = 0

/** 供拆解用的可选 agent 行（id / 显示名 / 职责简介），约束模型按真实角色选角 */
function planAgentLines(): string {
  return agentRegistry
    .list()
    .filter((a) => a.agentId !== DEFAULT_AGENT_ID)
    .map((a) => {
      const role = a.systemPrompt ? a.systemPrompt.replace(/\s+/g, ' ').slice(0, 80) : a.profile
      return `- ${a.agentId} (${a.name}): ${role}`
    })
    .join('\n')
}

/** 组装拆解任务文本：输出格式约束严格，便于后端 JSON 解析 */
function composePlanTask(goal: string): string {
  const lines: string[] = []
  lines.push('[编排拆解任务] 请把一个创作协作的「总目标」拆解成可执行的 Agent 分工 DAG。') // cjk-ok 任务文本（发送给策划 Agent 的拆解指令）
  lines.push(`总目标：${goal}`) // cjk-ok 拆解指令文本（运行时拼入用户总目标）
  lines.push('可选执行 Agent（id (显示名): 职责）：') // cjk-ok 拆解指令文本
  lines.push(planAgentLines())
  lines.push('要求：') // cjk-ok 拆解指令文本
  lines.push('- 只输出一个 JSON 数组，禁止输出数组之外的任何文字、解释或代码块标记；') // cjk-ok 拆解指令文本
  lines.push(
    '- 数组每个元素是一个节点：{"id":"n1","agentId":"planner","instruction":"环节说明","dependsOn":[]}；' // cjk-ok 拆解指令文本
  )
  lines.push('- id 用 n1/n2/n3… 依次编号；agentId 必须是上面可选 Agent 中的 id；') // cjk-ok 拆解指令文本
  lines.push('- instruction 用中文写清该环节要做什么、产出什么，具体可执行；') // cjk-ok 拆解指令文本
  lines.push(
    '- dependsOn 填本节点依赖的节点 id（首个节点通常为空数组），保证可并行分支与先后次序；' // cjk-ok 拆解指令文本
  )
  lines.push('- 拆 2~8 个节点，覆盖从策划到产出/审核的完整闭环；避免冗余环节。') // cjk-ok 任务文本（发送给策划 Agent 的拆解指令）
  return lines.join('\n')
}

/** 从模型最终文本中抽取 JSON 数组（容忍 ```json 围栏与前后废话），解析失败抛错 */
function extractPlanArray(raw: string): unknown {
  let text = String(raw ?? '').trim()
  const fence = text.match(/```[a-zA-Z]*\s*([\s\S]*?)```/)
  if (fence) text = fence[1].trim()
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start >= 0 && end > start) text = text.slice(start, end + 1)
  return JSON.parse(text)
}

/**
 * 归一化拆解结果：id 一律重排为 n1..nk（模型输出 id 可能重复/非法），
 * dependsOn 按「条目自身原始 id → 新 id」映射重建；非法 agent 或缺失说明的条目丢弃。
 */
function sanitizePlan(items: unknown): OrchestratorNodeSpec[] {
  if (!Array.isArray(items)) return []
  const agents = new Map(agentRegistry.list().map((a) => [a.agentId, a]))
  const rawIds: string[] = []
  const entries: Array<{ id: string; agentId: string; instruction: string }> = []
  const count = Math.min(MAX_PLAN_NODES, items.length)
  for (let i = 0; i < count; i++) {
    const item = items[i]
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const rawAgent = String(record.agentId ?? '').trim()
    const agent =
      agents.get(rawAgent) ?? [...agents.values()].find((a) => a.name === rawAgent) ?? null
    if (!agent || agent.agentId === DEFAULT_AGENT_ID) continue
    const instruction = String(record.instruction ?? '')
      .trim()
      .slice(0, 2000)
    if (!instruction) continue
    rawIds.push(String(record.id ?? '').trim())
    entries.push({ id: `n${entries.length + 1}`, agentId: agent.agentId, instruction })
  }
  const rawToNew = new Map<string, string>()
  for (let i = 0; i < entries.length; i++) {
    if (rawIds[i]) rawToNew.set(rawIds[i], entries[i].id)
  }
  const nodes: OrchestratorNodeSpec[] = entries.map((e, i) => {
    const rawItem = items[i] as Record<string, unknown> | undefined
    const deps = Array.isArray(rawItem?.dependsOn) ? (rawItem.dependsOn as unknown[]) : []
    const dependsOn: string[] = []
    for (const dep of deps) {
      const target = rawToNew.get(String(dep).trim())
      if (target && target !== e.id) dependsOn.push(target)
    }
    return { ...e, dependsOn: [...new Set(dependsOn)] }
  })
  return nodes
}

/** 在目标 agent 上跑一次静默任务并等待 settle（planning 专用，不占用 pendingSettles 槽） */
async function runPlanTask(
  agentId: string,
  task: string
): Promise<{ ok: boolean; finalText?: string; error?: string }> {
  const sessionId = `${PLAN_SESSION_PREFIX}-${Date.now().toString(36)}-${(++planSeq).toString(36)}`
  return new Promise((resolve) => {
    let settled = false
    const finish = (r: { ok: boolean; finalText?: string; error?: string }): void => {
      if (settled) return
      settled = true
      resolve(r)
    }
    const off = onAgentRuntimeSettled((info) => {
      if (info.agentId !== agentId) return
      off()
      // 清理本次拆解会话，避免孤儿会话在磁盘上堆积
      void deleteHarnessSession(sessionId, agentId).catch(() => undefined)
      const finalText = info.finalText?.trim()
      if (info.ok && finalText) finish({ ok: true, finalText })
      else finish({ ok: false, error: info.error ?? '拆解任务未产出有效文本' }) // cjk-ok 运行时错误文本（沿用 harness 服务的既有文案风格）
    })
    runHarnessTask({ agentId, task, sessionId, mode: 'craft', silent: true })
      .then((res) => {
        if (!res.started) {
          off()
          finish({ ok: false, error: res.message ?? '拆解任务启动失败' }) // cjk-ok 运行时错误文本（沿用 harness 服务的既有文案风格）
        }
      })
      .catch((err) => {
        off()
        finish({ ok: false, error: err instanceof Error ? err.message : String(err) })
      })
  })
}

/**
 * 自动拆解：把总目标交给策划 Agent（缺省为内置 planner）拆成节点 DAG 草案。
 * 与 runOrchestrator 同步校验不同：本函数需等模型返回，故为 async 并直接回传结果。
 */
export async function planOrchestrator(
  input: OrchestratorPlanInput
): Promise<OrchestratorPlanResult> {
  const goal = String(input?.goal ?? '').trim()
  if (!goal) {
    return { ok: false, message: '总目标不能为空，请描述这次协作想达成的结果。' } // cjk-ok 运行时错误文本（沿用 harness 服务的既有文案风格）
  }
  const agents = agentRegistry.list().filter((a) => a.agentId !== DEFAULT_AGENT_ID)
  const planner = agentRegistry.get('planner') ?? agents[0] ?? null
  if (!planner) {
    return { ok: false, message: '当前没有可用的非缺省 Agent，无法自动拆解。' } // cjk-ok 运行时错误文本（沿用 harness 服务的既有文案风格）
  }
  if (runtimeIsRunning(planner.agentId)) {
    return { ok: false, message: `「${agentName(planner.agentId)}」Agent 正忙，请稍后再试。` } // cjk-ok 运行时错误文本（沿用 harness 服务的既有文案风格）
  }
  const run = await runPlanTask(planner.agentId, composePlanTask(goal))
  if (!run.ok) {
    return { ok: false, message: run.error ?? '自动拆解失败，请稍后重试。' } // cjk-ok 运行时错误文本（沿用 harness 服务的既有文案风格）
  }
  let parsed: unknown
  try {
    parsed = extractPlanArray(run.finalText ?? '')
  } catch (err) {
    return {
      ok: false,
      message: `自动拆解结果无法解析为节点列表：${err instanceof Error ? err.message : String(err)}` // cjk-ok 运行时错误文本（沿用 harness 服务的既有文案风格）
    }
  }
  const nodes = sanitizePlan(parsed)
  if (!nodes.length) {
    return {
      ok: false,
      message: '拆解结果未包含可用节点（Agent 不在可选列表或缺少环节说明），请调整总目标后重试。' // cjk-ok 运行时错误文本（沿用 harness 服务的既有文案风格）
    }
  }
  return { ok: true, nodes }
}

/** 全部 job（最新在前），返回只读快照 */
export function listOrchestratorJobs(): OrchestratorJob[] {
  return [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt).map((job) => snapshot(job))
}

/** 中止一个运行中的编排 job：运行中的节点 kill，其余节点置 skipped */
export function abortOrchestratorJob(jobId: string): boolean {
  const job = jobs.get(String(jobId ?? ''))
  if (!job || job.state !== 'running') return false
  job.aborted = true
  job.state = 'aborted'
  const runningNodes = job.nodes.filter((n) => n.state === 'running')
  // kill 所有运行中的 dsh 子进程 → close → settle → runNodeAttempt 返回 aborted 收尾
  for (const node of runningNodes) void abortHarnessTask(node.agentId)
  publish(job)
  // 立即把未开始/运行中的节点置 skipped（kill 触发的 settle 到来前 UI 即可看到中止态）
  finalizeAborted(job)
  return true
}

/* ── 并发闸门：agent 队列锁（同一 agent 的编排派发严格串行）+ 并行上限执行器 ── */
const agentTails = new Map<string, Promise<void>>()

/** 把 fn 排到指定 agent 的队列尾部：不同 agent 并行，同一 agent（含跨 job）严格串行 */
async function withAgentLock<T>(agentId: string, fn: () => Promise<T>): Promise<T> {
  const prev = agentTails.get(agentId) ?? Promise.resolve()
  const run = prev.then(fn, fn)
  agentTails.set(
    agentId,
    run.then(
      () => undefined,
      () => undefined
    )
  )
  return run
}

/** 以固定并发上限执行一批任务（少于上限则全部并行，超出按入队顺序排队） */
async function runBatched<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<void> {
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (cursor < tasks.length) {
      const task = tasks[cursor]
      cursor += 1
      await task()
    }
  })
  await Promise.all(workers)
}

/** 主循环：反复「剔除失效依赖 → 并发执行全部就绪节点」，直到终态 */
async function runJob(job: JobRecord): Promise<void> {
  try {
    while (job.state === 'running') {
      if (cascadeSkips(job)) continue
      const ready = collectReady(job)
      if (!ready.length) break
      await runBatched(
        ready.map((node) => () => withAgentLock(node.agentId, () => executeNode(job, node))),
        MAX_PARALLEL
      )
    }
    if (job.state === 'running') finalize(job)
    else finalizeAborted(job)
  } catch (err) {
    job.state = 'failed'
    job.error = err instanceof Error ? err.message : String(err)
    job.finishedAt = Date.now()
    publish(job)
  }
}

/** 把「依赖已失败/被跳过」的 pending 节点级联标记为 skipped；返回是否有变化 */
function cascadeSkips(job: JobRecord): boolean {
  const byId = new Map(job.nodes.map((n) => [n.id, n]))
  const now = Date.now()
  let changed = false
  for (const node of job.nodes) {
    if (node.state !== 'pending') continue
    const deps = node.dependsOn.map((id) => byId.get(id)).filter((d) => d != null)
    if (deps.length && deps.some((d) => d.state === 'failed' || d.state === 'skipped')) {
      node.state = 'skipped'
      node.finishedAt = now
      changed = true
    }
  }
  if (changed) publish(job)
  return changed
}

/** 收集当前依赖已全部完成的 pending 节点（同一轮全部并发派发） */
function collectReady(job: JobRecord): OrchestratorNodeState[] {
  const byId = new Map(job.nodes.map((n) => [n.id, n]))
  const ready: OrchestratorNodeState[] = []
  for (const node of job.nodes) {
    if (node.state !== 'pending') continue
    const deps = node.dependsOn.map((id) => byId.get(id)).filter((d) => d != null)
    if (!deps.length || deps.every((d) => d.state === 'done')) ready.push(node)
  }
  return ready
}

/** 执行一个节点：running →（重试至多 1 次）→ done / failed / skipped(abort) */
async function executeNode(job: JobRecord, node: OrchestratorNodeState): Promise<void> {
  // 排队等待 agent 锁期间 job 可能已被中止并置 skipped：直接退出，避免把终态节点拉回 running
  if (job.state !== 'running') return
  node.state = 'running'
  node.startedAt = Date.now()
  node.attempts = Math.max(1, node.attempts)
  publish(job)
  let outcome: AttemptOutcome | null = null
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) {
      // 重试冷却：给瞬时占用/环境抖动留出恢复时间；期间 job 被中止则直接退出
      for (let waited = 0; waited < RETRY_COOL_DOWN_MS; waited += POLL_IDLE_MS) {
        if (job.state !== 'running') return
        await sleep(POLL_IDLE_MS)
      }
      node.attempts = attempt
      node.error = undefined
      publish(job)
    }
    outcome = await runNodeAttempt(job, node, attempt)
    if (job.state !== 'running') return // 已中止：收尾交给 finalizeAborted
    if (outcome.kind !== 'failed' || attempt >= MAX_ATTEMPTS) break
  }
  const last: AttemptOutcome = outcome ?? { kind: 'failed', error: '节点执行异常' } // cjk-ok 运行时错误文本（沿用 harness 服务的既有文案风格）
  if (last.kind === 'aborted') return // 防御：中止路径已在循环内提前返回
  if (last.kind === 'ok') {
    node.state = 'done'
    node.finalText = last.finalText
    delete node.error
  } else {
    node.state = 'failed'
    node.error = last.error ?? '节点执行失败' // cjk-ok 运行时错误文本（沿用 harness 服务的既有文案风格）
  }
  node.finishedAt = Date.now()
  publish(job)
}

/**
 * 派发一个节点到目标 agent 并等待其终结（settle）。
 * 节点任务 = 总目标 + 环节说明 + 已完成依赖节点的产出文本，用独立会话保证幂等。
 */
async function runNodeAttempt(
  job: JobRecord,
  node: OrchestratorNodeState,
  attempt: number
): Promise<AttemptOutcome> {
  const agentId = node.agentId
  // 等待目标 agent 空闲：用户在面板手动跑的任务优先完成，编排器不抢占
  while (runtimeIsRunning(agentId)) {
    if (job.state !== 'running') return { kind: 'aborted' }
    await sleep(POLL_IDLE_MS)
  }
  if (job.state !== 'running') return { kind: 'aborted' }

  const sessionId = `orch-${job.jobId}-${node.id}-a${attempt}`
  const task = composeNodeTask(job, node)
  // 先登记 settle 期待再派发，避免进程过快结束时漏掉事件
  const expectation = expectSettle(agentId)
  let result: Awaited<ReturnType<typeof runHarnessTask>>
  try {
    result = await runHarnessTask({
      agentId,
      task,
      sessionId,
      mode: 'craft',
      silent: true
    })
  } catch (err) {
    cancelExpectation(agentId)
    return { kind: 'failed', error: err instanceof Error ? err.message : String(err) }
  }
  if (!result.started) {
    cancelExpectation(agentId)
    return { kind: 'failed', error: result.message ?? '任务启动失败' } // cjk-ok 运行时错误文本（沿用 harness 服务的既有文案风格）
  }
  const settle = await expectation
  // 尽力清理本次编排会话，避免孤儿会话在磁盘上堆积（Orchestrator 会话不进 UI 会话列表）
  void deleteHarnessSession(sessionId, agentId).catch(() => undefined)
  if (job.state !== 'running') return { kind: 'aborted' }
  const finalText = settle.finalText?.trim()
  if (settle.ok && finalText) return { kind: 'ok', finalText }
  return { kind: 'failed', error: settle.error ?? '节点未产出有效文本（结果为空）' } // cjk-ok 运行时错误文本（沿用 harness 服务的既有文案风格）
}

/** 组装派发给节点的任务文本：总目标 + 环节说明 + 已完成依赖节点的产出 */
function composeNodeTask(job: JobRecord, node: OrchestratorNodeState): string {
  const byId = new Map(job.nodes.map((n) => [n.id, n]))
  const deps = node.dependsOn
    .map((id) => byId.get(id))
    .filter(
      (d): d is OrchestratorNodeState => d != null && d.state === 'done' && Boolean(d.finalText)
    )
  const lines: string[] = []
  lines.push(`[多 Agent 编排任务] 总目标：${job.goal}`) // cjk-ok 任务文本（发送给模型的内容）
  lines.push(`本轮由你（${agentName(node.agentId)}）执行：${node.instruction}`) // cjk-ok 任务文本（发送给模型的内容）
  if (deps.length) {
    lines.push('以下是已完成环节的产出，请直接基于这些内容继续推进，不要重复已完成的工作：') // cjk-ok 任务文本（发送给模型的内容）
    for (const dep of deps) {
      lines.push(`\n【${dep.id} · ${agentName(dep.agentId)} 的产出】\n${dep.finalText}`) // cjk-ok 任务文本（发送给模型的内容）
    }
  }
  lines.push('现在开始执行你的环节。若需要调用工具或生成文件，请直接操作。') // cjk-ok 任务文本（发送给模型的内容）
  lines.push('完成时请用最终回答说明结果，并列出产出的工程内相对路径。') // cjk-ok 任务文本（发送给模型的内容）
  return lines.join('\n\n')
}

/** 组装 job 级失败文案（截断过长的节点错误，避免撑爆 IPC） */
function jobFailureError(node: OrchestratorNodeState): string {
  const detail = (node.error ?? '').slice(0, 500)
  return `节点「${node.id}」（${agentName(node.agentId)}）失败：${detail}` // cjk-ok 编排失败文案（显示于编排记录）
}

/** job 自然走到终态：有失败节点 → failed；否则全部完成 → done 并生成汇总 */
function finalize(job: JobRecord): void {
  const now = Date.now()
  const failed = job.nodes.find((n) => n.state === 'failed')
  if (failed) {
    job.state = 'failed'
    job.error = jobFailureError(failed)
    for (const node of job.nodes) {
      if (node.state === 'pending') {
        node.state = 'skipped'
        node.finishedAt = now
      }
    }
  } else {
    job.state = 'done'
    job.summary = buildSummary(job)
  }
  job.finishedAt = now
  publish(job)
}

/** 中止后的收尾：运行中/未开始的节点全部置 skipped（幂等，可重复调用） */
function finalizeAborted(job: JobRecord): void {
  if (job.finishedAt) return
  const now = Date.now()
  for (const node of job.nodes) {
    if (node.state === 'pending' || node.state === 'running') {
      node.state = 'skipped'
      node.finishedAt = now
    }
  }
  job.finishedAt = now
  publish(job)
}

/**
 * 汇总文本：取定义顺序最后一个「无后继依赖」的已完成节点产出（典型是用户定义的汇总节点）；
 * 无该节点时退化为全部成功节点产出的拼接。
 */
function buildSummary(job: JobRecord): string | undefined {
  const doneNodes = job.nodes.filter((n) => n.state === 'done' && n.finalText)
  if (!doneNodes.length) return undefined
  const hasDependents = new Set<string>()
  for (const n of job.nodes) for (const dep of n.dependsOn) hasDependents.add(dep)
  const terminals = doneNodes.filter((n) => !hasDependents.has(n.id))
  const finalNode = terminals.length
    ? terminals[terminals.length - 1]
    : doneNodes[doneNodes.length - 1]
  if (terminals.length <= 1 || !finalNode) return finalNode?.finalText?.slice(0, SUMMARY_LIMIT)
  // 多个终端节点（如并行产出后无汇总节点）：按完成顺序拼接，便于 UI 展示总览
  return doneNodes
    .map((n) => `## ${agentName(n.agentId)}（${n.id}）\n${n.finalText ?? ''}`)
    .join('\n\n')
    .slice(0, SUMMARY_LIMIT)
}
