/**
 * 卡牌设计实验室 Web Worker 客户端：把重计算投递到后台线程；
 * Worker 不可用（测试环境 / 构建失败 / 运行异常）时自动回退为主线程同步计算。
 */
import {
  measureMxCardMarginalValues,
  simulateMxRunEconomyLoop,
  solveMxTierHpForClearRate,
  suggestMxCardRebalance,
  type MxCardDesignLabConfig,
  type MxCardMarginalValueResult,
  type MxCardRebalanceSuggestion,
  type MxDeckCardSpec,
  type MxNumericalWorkbench,
  type MxRunEconomyResult,
  type MxTierHpSolveResult
} from '@shared/gameAssets'

interface Base {
  id: number
  wb: MxNumericalWorkbench
  lab: MxCardDesignLabConfig
}

export type CardLabWorkerRequest =
  | (Base & { kind: 'economy' })
  | (Base & { kind: 'solveHp'; opts: Parameters<typeof solveMxTierHpForClearRate>[2] })
  | (Base & { kind: 'marginal'; opts: Parameters<typeof measureMxCardMarginalValues>[2] })
  | (Base & {
      kind: 'rebalance'
      card: MxDeckCardSpec
      opts: Parameters<typeof suggestMxCardRebalance>[3]
    })

export type CardLabWorkerResponse =
  { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string }

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
type Payload = DistributiveOmit<CardLabWorkerRequest, 'id'>

let worker: Worker | null = null
let workerBroken = false
let seq = 0
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()

async function getWorker(): Promise<Worker | null> {
  if (workerBroken || typeof Worker === 'undefined') return null
  if (worker) return worker
  try {
    const mod = await import('./cardLabCompute.worker?worker')
    const w: Worker = new mod.default()
    w.onmessage = (e: MessageEvent<CardLabWorkerResponse>) => {
      const p = pending.get(e.data.id)
      if (!p) return
      pending.delete(e.data.id)
      if (e.data.ok) p.resolve(e.data.result)
      else p.reject(new Error(e.data.error))
    }
    w.onerror = () => {
      workerBroken = true
      for (const p of pending.values()) p.reject(new Error('worker crashed'))
      pending.clear()
      w.terminate()
      worker = null
    }
    worker = w
    return w
  } catch {
    workerBroken = true
    return null
  }
}

/** 响应式代理不能被结构化克隆：统一转为纯 JSON 数据 */
function plain<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

function runSync(p: Payload): unknown {
  switch (p.kind) {
    case 'economy':
      return simulateMxRunEconomyLoop(p.wb, p.lab)
    case 'solveHp':
      return solveMxTierHpForClearRate(p.wb, p.lab, p.opts)
    case 'marginal':
      return measureMxCardMarginalValues(p.wb, p.lab, p.opts)
    case 'rebalance':
      return suggestMxCardRebalance(p.wb, p.lab, p.card, p.opts)
  }
}

async function run(p: Payload): Promise<unknown> {
  const data = plain(p)
  const w = await getWorker()
  if (!w) return runSync(data)
  const id = ++seq
  try {
    return await new Promise<unknown>((resolve, reject) => {
      pending.set(id, { resolve, reject })
      w.postMessage({ ...data, id })
    })
  } catch (err) {
    // Worker 崩溃时回退主线程；业务异常（ok:false）照常抛出
    if (workerBroken) return runSync(data)
    throw err
  }
}

/** 当前是否在后台线程计算（用于界面提示） */
export function isCardLabWorkerActive(): boolean {
  return Boolean(worker) && !workerBroken
}

export const cardLabCompute = {
  economy: (wb: MxNumericalWorkbench, lab: MxCardDesignLabConfig) =>
    run({ kind: 'economy', wb, lab }) as Promise<MxRunEconomyResult>,
  solveHp: (
    wb: MxNumericalWorkbench,
    lab: MxCardDesignLabConfig,
    opts: Parameters<typeof solveMxTierHpForClearRate>[2]
  ) => run({ kind: 'solveHp', wb, lab, opts }) as Promise<MxTierHpSolveResult>,
  marginal: (
    wb: MxNumericalWorkbench,
    lab: MxCardDesignLabConfig,
    opts: Parameters<typeof measureMxCardMarginalValues>[2]
  ) => run({ kind: 'marginal', wb, lab, opts }) as Promise<MxCardMarginalValueResult>,
  rebalance: (
    wb: MxNumericalWorkbench,
    lab: MxCardDesignLabConfig,
    card: MxDeckCardSpec,
    opts: Parameters<typeof suggestMxCardRebalance>[3]
  ) => run({ kind: 'rebalance', wb, lab, card, opts }) as Promise<MxCardRebalanceSuggestion>
}
