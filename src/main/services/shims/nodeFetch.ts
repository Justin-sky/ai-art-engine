/**
 * `node-fetch` 的打包期替身（见 `electron.vite.config.ts` 的主进程 `resolve.alias`）。
 *
 * Electron 主进程已有全局 `fetch`（Node 20+）。部分 CJS 依赖仍会静态
 * `require('node-fetch')`；依赖树里顶层 `node-fetch` 是 dsh 带的 **v3.3.2（纯 ESM）**、
 * 又被 `electron-builder.yml` 排除在 asar 之外 —— 静态 require 会被
 * `scripts/check-pack-externals.mjs` 算进冲突，打包版也可能 require 不到。
 *
 * 这里把该引用指向全局 fetch：**零新增打包体积，也不动 dsh 的排除清单**。
 *
 * 形状对齐 node-fetch v2 的默认导出（CJS `module.exports = fetch` + `__esModule`），
 * 因为调用方常走 `__importStar(require('node-fetch')).default`。
 */
const fetchImpl = globalThis.fetch

export default fetchImpl
export { fetchImpl as fetch }
