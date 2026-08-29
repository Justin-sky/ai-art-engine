/**
 * 简单异步信号量：限制同时进入临界区的任务数；超出租队的任务可被拒绝。
 * 纯实现、无环境依赖，供 MCP 生成类工具做并发闸门。
 */
export class AsyncSemaphore {
  private running = 0
  private queue: Array<{ resolve: () => void; reject: (err: Error) => void }> = []

  constructor(
    private readonly limit: number,
    /** 排队上限：超出时 acquire 直接拒绝，避免请求无限堆积 */
    private readonly maxQueue: number
  ) {
    if (!Number.isFinite(limit) || limit < 1) this.limit = 1
    if (!Number.isFinite(maxQueue) || maxQueue < 0) this.maxQueue = 0
  }

  /** 当前持有许可数 */
  get active(): number {
    return this.running
  }

  /** 当前排队数 */
  get waiting(): number {
    return this.queue.length
  }

  /**
   * 获取许可。返回 false 表示排队员额已满（调用方应直接返回限流错误）；
   * 返回 true 表示已获得许可，用完务必调用 release()。
   */
  async acquire(): Promise<boolean> {
    if (this.running < this.limit) {
      this.running += 1
      return true
    }
    if (this.queue.length >= this.maxQueue) return false
    return new Promise<boolean>((resolve) => {
      this.queue.push({
        resolve: () => {
          this.running += 1
          resolve(true)
        },
        reject: () => resolve(false)
      })
    })
  }

  release(): void {
    this.running -= 1
    const next = this.queue.shift()
    if (next) next.resolve()
  }

  /** 清空排队（全部以拒绝结束）；已持有的许可不受影响 */
  drain(): void {
    const queue = this.queue.splice(0)
    for (const item of queue) item.reject(new Error('队列已清空'))
  }
}
