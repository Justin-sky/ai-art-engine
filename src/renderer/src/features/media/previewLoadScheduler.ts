type PreviewTask<T> = {
  priority: number
  seq: number
  run: () => Promise<T>
  resolve: (value: T) => void
  reject: (err: unknown) => void
  cancelled: boolean
}

/**
 * 预览加载并发队列：限制同时 decode/IPC，优先高 priority（选中/视口中心）。
 */
export class PreviewLoadScheduler {
  private active = 0
  private seq = 0
  private queue: PreviewTask<unknown>[] = []

  constructor(private readonly maxConcurrent = 4) {}

  enqueue<T>(priority: number, run: () => Promise<T>): { promise: Promise<T>; cancel: () => void } {
    let task!: PreviewTask<T>
    const promise = new Promise<T>((resolve, reject) => {
      task = {
        priority,
        seq: ++this.seq,
        run,
        resolve,
        reject,
        cancelled: false
      }
      this.queue.push(task as PreviewTask<unknown>)
      this.queue.sort((a, b) => b.priority - a.priority || a.seq - b.seq)
      this.pump()
    })
    return {
      promise,
      cancel: () => {
        task.cancelled = true
      }
    }
  }

  private pump(): void {
    while (this.active < this.maxConcurrent && this.queue.length > 0) {
      const task = this.queue.shift()!
      if (task.cancelled) {
        task.reject(new DOMException('Aborted', 'AbortError'))
        continue
      }
      this.active += 1
      void task
        .run()
        .then((value) => {
          if (task.cancelled) task.reject(new DOMException('Aborted', 'AbortError'))
          else task.resolve(value)
        })
        .catch((err) => task.reject(err))
        .finally(() => {
          this.active -= 1
          this.pump()
        })
    }
  }
}

export const graphPreviewLoadScheduler = new PreviewLoadScheduler(4)
