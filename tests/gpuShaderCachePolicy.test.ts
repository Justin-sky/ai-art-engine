import { describe, expect, it } from 'vitest'
import {
  DISABLE_GPU_SHADER_DISK_CACHE_SWITCH,
  GPU_SHADER_CACHE_ENV,
  gpuShaderCacheSwitches,
  isGpuShaderDiskCacheDisabled
} from '../src/main/services/gpuShaderCachePolicy'

/**
 * GPU 着色器磁盘缓存策略的契约。
 *
 * 背景：Windows 上 Electron 的 GPU 进程带沙箱启动，其应用容器身份不在
 * `<userData>/GPUCache` 等目录的权限里（`Network`、`Cache` 有，所以那两处不报错），
 * 于是每次启动都刷 `Unable to move the cache: 0x5` + `Gpu Cache Creation failed: -2`。
 * 默认关掉着色器磁盘缓存即可消除；改目录权限治不了本，因为 GPU 进程重建目录时
 * 权限仍按父目录继承。
 *
 * 这里只钉住判定规则本身（默认关、显式 `=1` 才开、且必须是精确的 "1"），
 * 不钉住它在 index.ts 里被调用的位置。
 */

function env(values: Record<string, string>): NodeJS.ProcessEnv {
  return values as NodeJS.ProcessEnv
}

describe('gpuShaderCachePolicy', () => {
  it('默认关闭 GPU 着色器磁盘缓存', () => {
    expect(isGpuShaderDiskCacheDisabled(env({}))).toBe(true)
    expect(gpuShaderCacheSwitches(env({}))).toEqual([DISABLE_GPU_SHADER_DISK_CACHE_SWITCH])
  })

  it('显式设 AIART_GPU_SHADER_CACHE=1 时不追加开关', () => {
    expect(isGpuShaderDiskCacheDisabled(env({ [GPU_SHADER_CACHE_ENV]: '1' }))).toBe(false)
    expect(gpuShaderCacheSwitches(env({ [GPU_SHADER_CACHE_ENV]: '1' }))).toEqual([])
  })

  it('只有精确的 "1" 才算开启，其余写法一律保持关闭策略', () => {
    for (const value of ['0', 'false', 'no', 'true', '', ' 1']) {
      expect(isGpuShaderDiskCacheDisabled(env({ [GPU_SHADER_CACHE_ENV]: value }))).toBe(true)
      expect(gpuShaderCacheSwitches(env({ [GPU_SHADER_CACHE_ENV]: value }))).toEqual([
        DISABLE_GPU_SHADER_DISK_CACHE_SWITCH
      ])
    }
  })

  it('开关名与 Chromium 约定一致', () => {
    expect(DISABLE_GPU_SHADER_DISK_CACHE_SWITCH).toBe('disable-gpu-shader-disk-cache')
  })
})
