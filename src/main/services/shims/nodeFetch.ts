/**
 * `node-fetch` 的打包期替身（见 `electron.vite.config.ts` 的主进程 `resolve.alias`）。
 *
 * 为什么需要它：`@elevenlabs/elevenlabs-js` 的 `getFetchFn` 里有
 *
 *     if (RUNTIME.type === 'node' && RUNTIME.parsedVersion >= 18) return fetch
 *     if (RUNTIME.type === 'node') return require('node-fetch').default
 *
 * 前半段在 Electron 主进程**永远成立**（`parsedVersion` 取 `process.versions.node`
 * 的主版本号，Node 20+），所以 `require('node-fetch')` 是**死分支**。
 * 但它是一句静态 require，会被 `scripts/check-pack-externals.mjs` 算进依赖闭包。
 *
 * 而依赖树里 `node-fetch` 是 dsh 带的 **v3.3.2（纯 ESM）**、又被
 * `electron-builder.yml` 排除在 asar 之外（dsh 运行时自带一份，避免重复打包）——
 * 于是检查会报 6 个包冲突。第三方 SDK 不能改（Fern 生成，重生成即丢），
 * 所以在这里把该引用指向全局 fetch：**零新增打包体积，也不动 dsh 的排除清单**。
 *
 * 形状对齐 node-fetch v2 的默认导出（CJS `module.exports = fetch` + `__esModule`），
 * 因为调用方走的是 `__importStar(require('node-fetch')).default`。
 */
const fetchImpl = globalThis.fetch

export default fetchImpl
export { fetchImpl as fetch }
