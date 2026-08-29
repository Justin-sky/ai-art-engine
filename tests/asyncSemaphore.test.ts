import { describe, expect, it } from 'vitest'
import { AsyncSemaphore } from '../src/shared/asyncSemaphore'

describe('AsyncSemaphore（并发闸门）', () => {
  it('限制同时持有的许可数', async () => {
    const gate = new AsyncSemaphore(2, 10)
    expect(await gate.acquire()).toBe(true)
    expect(await gate.acquire()).toBe(true)
    expect(gate.active).toBe(2)
    const third = gate.acquire()
    expect(gate.waiting).toBe(1)
    gate.release()
    expect(await third).toBe(true)
    gate.release()
    gate.release()
    expect(gate.active).toBe(0)
  })

  it('排队员额已满时 acquire 直接返回 false', async () => {
    const gate = new AsyncSemaphore(1, 1)
    expect(await gate.acquire()).toBe(true)
    void gate.acquire() // 占满唯一排队位
    expect(await gate.acquire()).toBe(false)
  })

  it('release 按 FIFO 顺序移交许可', async () => {
    const gate = new AsyncSemaphore(1, 5)
    await gate.acquire()
    const order: number[] = []
    const a = gate.acquire().then((ok) => (order.push(1), ok))
    const b = gate.acquire().then((ok) => (order.push(2), ok))
    gate.release()
    await a
    gate.release()
    await b
    expect(order).toEqual([1, 2])
  })

  it('drain 清空排队并拒绝等待者', async () => {
    const gate = new AsyncSemaphore(1, 5)
    await gate.acquire()
    const waiting = gate.acquire()
    gate.drain()
    expect(await waiting).toBe(false)
    gate.release()
    expect(await gate.acquire()).toBe(true)
  })
})
