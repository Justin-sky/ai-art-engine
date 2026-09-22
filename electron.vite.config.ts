import { readFileSync } from 'fs'
import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import type { Plugin } from 'vite'

/** 沙盒 iframe 注入用：绕过 three package exports，提供 min 源码字符串 */
function threeModuleRawPlugin(): Plugin {
  const virtualId = 'virtual:three-module-source'
  const resolvedId = '\0' + virtualId
  return {
    name: 'three-module-raw',
    resolveId(id) {
      if (id === virtualId) return resolvedId
      return null
    },
    load(id) {
      if (id !== resolvedId) return null
      const abs = resolve('node_modules/three/build/three.module.min.js')
      const source = readFileSync(abs, 'utf-8')
      return `export default ${JSON.stringify(source)}`
    }
  }
}

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
        },
        onwarn(warning, defaultHandler) {
          // chokidar 被打进 bundle（见上方 exclude 说明）时，其未使用的
          // `import { Stats } from 'node:fs'` 会触发 UNUSED_EXTERNAL_IMPORT，
          // 属无害警告，过滤掉以免干扰日志
          if (warning.code === 'UNUSED_EXTERNAL_IMPORT' && warning.message.includes('chokidar'))
            return
          defaultHandler(warning)
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
    plugins: [vue(), threeModuleRawPlugin()]
  }
})
