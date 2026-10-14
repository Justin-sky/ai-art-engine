import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(import.meta.dirname, 'src/shared'),
      '@renderer': resolve(import.meta.dirname, 'src/renderer/src')
    }
  },
  test: {
    environment: 'node',
    /**
     * 默认 5000ms 对**满量并行**跑整套（500+ 文件、含 QuickJS WASM 沙箱与真·HTTP 服务端）
     * 偏紧：这些资源密集用例在被调度饿着时会偶发超时翻红，而隔离/重跑必过。放宽到 20s 吸收
     * 并行饥饿的抖动，不改变任何断言，也不放过真正的挂起（真卡死仍会在 20s 后被判超时）。
     */
    testTimeout: 20000
  }
})
