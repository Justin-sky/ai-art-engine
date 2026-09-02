/**
 * Agent 编排器（模式 C：自主协作 DAG）。
 *
 * 用户在 Orchestrator 面板提交「总目标 + 一组节点（agentId / instruction / dependsOn）」，
 * 主进程据此构造 DAG，串行调度执行：
 *
 * - 节点幂等：每个节点使用独立 dsh 会话（`orch-<jobId>-<nodeId>-a<attempt>`），
 *   输入 = 总目标 + 角色指令 + 依赖节点最终文本（文件即协议的文本层）；
 * - 顺序推进：按依赖就绪顺序一次执行一个节点；依赖失败/被跳过 → 依赖方整体跳过；
 * - 失败策略：节点出错（异常退出 / 未产出文本）重试 1 次，仍失败标记 failed；
 * - 中止：运行中的节点 kill，其余节点置 skipped，job 置 aborted；
 * - 静默执行：节点任务走 runHarnessTask 的 silent=true，不向 HARNESS_EVENT 广播，
 *   避免污染用户在各 agent 标签上的会话 UI；进度仅经 ORCHESTRATOR_EVENT 推送。
 *
 * 事件归属：每个 job 变更即广播完整 job 快照（OrchestratorJobEvent），渲染层实时刷新。
 * 本服务模块被 main/ipc.ts 引入即完成 settle 订阅注册（与 agentBridge 同模式）。
 */
import {
  IpcChannels,
  type OrchestratorJob,
  type OrchestratorJobEvent,
  type OrchestratorNodeState,
  type OrchestratorRunInput,
  type OrchestratorRunResult
} from '@shared/ipc'
import { broadcastToAllWindows } from '../broadcast'
import { agentRegistry } from './agentRegistry'
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
  const runningNode = job.nodes.find((n) => n.state === 'running')
  // kill 运行中的 dsh 子进程 → close → settle → runNodeAttempt 返回 aborted 收尾
  if (runningNode) void abortHarnessTask(runningNode.agentId)
  publish(job)
  // 立即把未开始/运行中的节点置 skipped（kill 触发的 settle 到来前 UI 即可看到中止态）
  finalizeAborted(job)
  return true
}

/** 主循环：按依赖就绪顺序逐个执行节点，直到终态 */
async function runJob(job: JobRecord): Promise<void> {
  try {
    while (job.state === 'running') {
      const node = pickNextNode(job)
      if (!node) break
      await executeNode(job, node)
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

/**
 * 扫描出下一个可执行节点；顺带把「依赖已失败/跳过」的节点标记为 skipped。
 * 返回 null 表示无节点可推进（全部终态，或防御性检测到死锁）。
 */
function pickNextNode(job: JobRecord): OrchestratorNodeState | null {
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
      continue
    }
    if (deps.length && !deps.every((d) => d.state === 'done')) continue // 依赖尚未完成
    return node
  }
  if (changed) publish(job)
  return null
}

/** 执行一个节点：running →（重试至多 1 次）→ done / failed / skipped(abort) */
async function executeNode(job: JobRecord, node: OrchestratorNodeState): Promise<void> {
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
