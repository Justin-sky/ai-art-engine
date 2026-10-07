import { readFileSync } from 'fs'
import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import type { Plugin } from 'vite'

/**
 * 跳过 Vite 内置的 `vite:esbuild-transpile`（renderChunk 阶段）。
 *
 * 起因：esbuild 对「大于 1MB 的 transform 输入」会把内容先落盘成
 * %TEMP%\esbuild-<64位hex>、由子进程读走后再删除（见 esbuild/lib/main.js:774）。
 * 本机有程序会偶发扣住新建文件，删除失败时 esbuild 直接以
 * `remove <path>: Access is denied` 硬崩整个构建（实测偶发，同一输入连跑 10 次成功 10 次）。
 * 主进程 bundle 已超 1MB，正好每次都走这条临时文件路径。
 *
 * 这里的构建目标本来就是 node（electron-vite 校验 build.target 必须以 "node" 开头）、
 * 运行时是 Node 20+，这层 downlevel 转译没有实际收益；跳过即可从源头避免临时文件。
 * 若将来确需按目标降级语法，删掉本插件，或改成只对超大 chunk 跳过。
 */
function skipEsbuildTranspile(): Plugin {
  return {
    name: 'aiart-skip-esbuild-transpile',
    renderChunk(_code, _chunk, opts) {
      // __vite_skip_esbuild__ 是 Vite 内部约定，未出现在 NormalizedOutputOptions 类型里
      ;(opts as { __vite_skip_esbuild__?: boolean }).__vite_skip_esbuild__ = true
      return null
    }
  }
}

/**
 * 忽略代码编辑器「原子写」留下的临时目录。
 *
 * 症状：`npm run dev` 会在保存某些文件后整个崩掉，日志是
 *   Error: EBUSY: resource busy or locked, watch '…\.<file>.ts.<pid>.<uuid>.tmpdir\<file>.ts.tmp'
 * 起因：写入方（实测 Cursor / VS Code 一类）先写 `.<name>.ts.<pid>.<uuid>.tmpdir/<name>.ts.tmp`
 * 再 rename 覆盖目标文件。chokidar 跟到了这个临时文件，而它随即被删除/仍被占用，
 * 于是 `fs.watch` 抛 EBUSY，Vite 的 FSWatcher 把它当致命错误直接结束进程 —— 与源码无关。
 *
 * 这些临时目录永远不会是需要参与构建的源码，直接不进监听即可。
 */
const WATCH_IGNORE = ['**/.*.tmpdir/**', '**/*.tmpdir/**', '**/.*.tmp']

/** 三个构建都监听同一棵源码树，统一应用同一份忽略规则 */
function watchIgnore() {
  return { server: { watch: { ignored: WATCH_IGNORE } } }
}

/** 沙盒 iframe 注入用：绕过 three package exports，提供 module + core 源码（r163+ 拆包） */
function threeModuleRawPlugin(): Plugin {
  const virtualModuleId = 'virtual:three-module-source'
  const virtualCoreId = 'virtual:three-core-source'
  const resolvedModuleId = '\0' + virtualModuleId
  const resolvedCoreId = '\0' + virtualCoreId
  return {
    name: 'three-module-raw',
    resolveId(id) {
      if (id === virtualModuleId) return resolvedModuleId
      if (id === virtualCoreId) return resolvedCoreId
      return null
    },
    load(id) {
      if (id === resolvedModuleId) {
        const abs = resolve('node_modules/three/build/three.module.js')
        const source = readFileSync(abs, 'utf-8')
        return `export default ${JSON.stringify(source)}`
      }
      if (id === resolvedCoreId) {
        const abs = resolve('node_modules/three/build/three.core.js')
        const source = readFileSync(abs, 'utf-8')
        return `export default ${JSON.stringify(source)}`
      }
      return null
    }
  }
}

/** 主进程：把常驻 dsh runner 模板打进 bundle，避免运行时再找散落的 .mjs */
function aiartRunnerTemplatePlugin(): Plugin {
  const virtualId = 'virtual:aiart-headless-runner-template'
  const resolvedId = '\0' + virtualId
  return {
    name: 'aiart-runner-template',
    resolveId(id) {
      if (id === virtualId) return resolvedId
      return null
    },
    load(id) {
      if (id !== resolvedId) return null
      const abs = resolve('src/main/services/aiartHeadlessRunner.template.mjs')
      const source = readFileSync(abs, 'utf-8')
      return `export default ${JSON.stringify(source)}`
    }
  }
}

/**
 * 主进程：把 dsh 审批应答插件模板同样打进 bundle。
 *
 * 与 runner 模板分开一个虚拟模块（而不是拼进同一份字符串）：应答器是安全关键的一小块，
 * 单独成文件才能在测试里当普通模块导入、用假 deps 驱动真实实现。
 */
function aiartApprovalAnswererTemplatePlugin(): Plugin {
  const virtualId = 'virtual:aiart-approval-answerer-template'
  const resolvedId = '\0' + virtualId
  return {
    name: 'aiart-approval-answerer-template',
    resolveId(id) {
      if (id === virtualId) return resolvedId
      return null
    },
    load(id) {
      if (id !== resolvedId) return null
      const abs = resolve('src/main/services/aiartApprovalAnswerer.template.mjs')
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
    ...watchIgnore(),
    plugins: [
      externalizeDepsPlugin({ exclude: ['chokidar'] }),
      aiartRunnerTemplatePlugin(),
      aiartApprovalAnswererTemplatePlugin(),
      skipEsbuildTranspile()
    ],
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        /**
         * `node-fetch` → 全局 fetch 的替身。
         *
         * `@elevenlabs/elevenlabs-js` 是外置依赖，它的 `getFetchFn` 里有一句静态
         * `require('node-fetch')`，只在 Node ≤ 17 的分支执行 —— 而 `RUNTIME.parsedVersion`
         * 取 `process.versions.node` 的主版本号，Electron 主进程恒为 Node 20+，
         * **那条分支永远不执行**。但静态 require 会被 scripts/check-pack-externals.mjs
         * 算进依赖闭包，而依赖树里的顶层 `node-fetch` 是 dsh 带的 v3.3.2（纯 ESM）、
         * 又被 electron-builder.yml 排除在 asar 之外（dsh 自带一份，避免重复打包），
         * 于是检查会报 6 个包冲突、打包版会在启动时 require 不到。
         *
         * 第三方 SDK 不能改（Fern 生成，重生成即丢），所以在这里把该引用换成替身：
         * 零新增打包体积，也不动 dsh 的排除清单。详见 shims/nodeFetch.ts。
         */
        'node-fetch': resolve('src/main/services/shims/nodeFetch.ts')
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
    ...watchIgnore(),
    plugins: [externalizeDepsPlugin(), skipEsbuildTranspile()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  renderer: {
    ...watchIgnore(),
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [vue(), threeModuleRawPlugin()]
  }
})
