import { describe, expect, it } from 'vitest'
import { resolveModel3dDownloadName } from '../src/main/services/videoJobService'

/**
 * 3D 产物落盘名：上游可能回 FBX（Tripo 绑骨 / 重定向传 out_format: fbx），
 * 一律写 .glb 会让资产库与预览按 GLB 解析失败。
 */
describe('resolveModel3dDownloadName', () => {
  it('keeps the real format from the CDN url', () => {
    expect(resolveModel3dDownloadName('https://cdn.tripo3d.ai/output/rigged.glb')).toBe(
      'output.glb'
    )
    expect(resolveModel3dDownloadName('https://cdn.tripo3d.ai/output/rigged.fbx')).toBe(
      'output.fbx'
    )
    expect(resolveModel3dDownloadName('https://cdn.meshy.ai/x/y.GLB?sig=abc')).toBe('output.glb')
    expect(resolveModel3dDownloadName('https://cdn.example/model.obj#frag')).toBe('output.obj')
  })

  it('falls back to glb when the url carries no known extension', () => {
    expect(resolveModel3dDownloadName('https://cdn.example/download?id=42')).toBe('output.glb')
    expect(resolveModel3dDownloadName('')).toBe('output.glb')
    expect(resolveModel3dDownloadName('https://cdn.example/model.glb.tmp')).toBe('output.glb')
  })
})
