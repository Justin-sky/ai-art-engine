/**
 * GPU 着色器磁盘缓存策略。
 *
 * 背景：Windows 上 Electron 的 GPU 进程带沙箱启动，它属于某个应用容器身份，而
 * `<userData>/GPUCache`、`DawnGraphiteCache`、`DawnWebGPUCache` 这些目录的权限里只有
 * 标准 ACE（System/Administrators/当前用户），**没有那个容器身份**（同一份 userData 下的
 * `Network`、`Cache` 有，所以它们不受影响）。
 *
 * 结果就是 GPU 进程每次启动都建不了自己的缓存目录、也移不动上一代遗留的缓存：
 *
 *   ERROR:net\disk_cache\cache_util_win.cc:25] Unable to move the cache: 拒绝访问。(0x5)
 *   ERROR:net\disk_cache\disk_cache.cc:290] Unable to create cache
 *   ERROR:gpu\ipc\host\gpu_disk_cache.cc:737] Gpu Cache Creation failed: -2
 *
 * 去改那几个目录的权限治不了本：GPU 进程下次重建目录时权限照样只按父目录继承。
 * 关掉着色器磁盘缓存才是对症的——着色器缓存只是启动加速，进程内仍会缓存，
 * 代价仅限于下次启动重新编译一次着色器。
 *
 * 需要找回这项加速时，设 `AIART_GPU_SHADER_CACHE=1` 即可（见 isGpuShaderDiskCacheDisabled）。
 */

/** 显式重新打开 GPU 着色器磁盘缓存的开关（值 `1` 生效，其余值视为关闭策略） */
export const GPU_SHADER_CACHE_ENV = 'AIART_GPU_SHADER_CACHE'

/** 关掉 GPU 着色器磁盘缓存所需的 Chromium 开关 */
export const DISABLE_GPU_SHADER_DISK_CACHE_SWITCH = 'disable-gpu-shader-disk-cache'

/**
 * 是否应关闭 GPU 着色器磁盘缓存：默认关闭，只有显式设 `AIART_GPU_SHADER_CACHE=1` 才恢复。
 * 判定只看「值是否恰好为 1」，避免 `=0`、`=false` 这类写法被误读成开启。
 */
export function isGpuShaderDiskCacheDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[GPU_SHADER_CACHE_ENV] !== '1'
}

/** 启动时要追加的 Chromium 开关（默认关闭 GPU 着色器磁盘缓存时返回一项，否则返回空数组） */
export function gpuShaderCacheSwitches(env: NodeJS.ProcessEnv = process.env): string[] {
  return isGpuShaderDiskCacheDisabled(env) ? [DISABLE_GPU_SHADER_DISK_CACHE_SWITCH] : []
}
