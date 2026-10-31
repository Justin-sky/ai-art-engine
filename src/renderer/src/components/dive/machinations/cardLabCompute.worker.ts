/**
 * 卡牌设计实验室重计算 Web Worker：单局经济闭环 / 目标通关率反解 / 单卡边际价值 / 重配平求解
 * 在后台线程运行，避免数秒级蒙特卡洛阻塞界面。消息协议见 cardLabWorkerClient.ts。
 */
import {
  measureMxCardMarginalValues,
  simulateMxRunEconomyLoop,
  solveMxTierHpForClearRate,
  suggestMxCardRebalance
} from '@shared/gameAssets/cardDesignLab'
import type { CardLabWorkerRequest, CardLabWorkerResponse } from './cardLabWorkerClient'

function handle(req: CardLabWorkerRequest): unknown {
  switch (req.kind) {
    case 'economy':
      return simulateMxRunEconomyLoop(req.wb, req.lab)
    case 'solveHp':
      return solveMxTierHpForClearRate(req.wb, req.lab, req.opts)
    case 'marginal':
      return measureMxCardMarginalValues(req.wb, req.lab, req.opts)
    case 'rebalance':
      return suggestMxCardRebalance(req.wb, req.lab, req.card, req.opts)
  }
}

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<CardLabWorkerRequest>) => void) | null
  postMessage: (msg: CardLabWorkerResponse) => void
}

ctx.onmessage = (e) => {
  const req = e.data
  try {
    ctx.postMessage({ id: req.id, ok: true, result: handle(req) })
  } catch (err) {
    ctx.postMessage({
      id: req.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err)
    })
  }
}
