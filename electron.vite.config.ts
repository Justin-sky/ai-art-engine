import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  main: {
    // chokidar 特意不外置：Assets 目录 watchdog 在主进程里 import 它，而 electron-builder.yml
    // 的 asar 排除清单（按 dsh 依赖闭包审计生成）把 chokidar / readdirp 排除在 asar 之外
    // （dsh 运行时自带一份），外置时打包版会在 asar 内 require 不到 → 启动即
    // "Cannot find module 'chokidar'"，主进程弹错误框、窗口永不出现（CI 冒烟只报「未就绪」）。
    // 它是纯 ESM（type: module）、无顶层 await，直接打进 bundle 最稳，与 asar 规则解耦。
    plugins: [externalizeDepsPlugin({ exclude: ['chokidar'] })],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          // YOLO 推理子进程（utilityProcess）独立入口，产物 out/main/yoloWorker.js
          yoloWorker: resolve('src/main/yolo/yoloWorker.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [vue()]
  }
})
