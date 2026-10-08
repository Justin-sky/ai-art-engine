import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `asset:get-file-url` 的「文件缺失」降级契约。
 *
 * 现场症状：资产文件被删/移走（或工程拷贝时没带 Cache）后，`projectService.getAssetFileUrl`
 * 直接 `throw fail(E_ASSET_FILE_MISSING)`，异常穿过 src/main/ipc.ts 的 handler 包装后变成
 * `Error occurred in handler for 'asset:get-file-url': Error: 文件不存在`，反复刷日志，
 * 调用方也拿不到任何可降级的结果。
 *
 * 缺失文件是**预期状态**，现在的契约是返回 `null`（不是空串、更不是伪造 URL）：
 * 调用方在类型上就分得清「没有文件」与「这是一条路径」。这里的用例真开一个临时工程、
 * 真读写磁盘文件，测的就是 handler 委托的那个方法。
 *
 * 为什么不直接 import src/main/ipc.ts 调注册好的 handler：它会连带 electron-vite 注入的
 * `virtual:aiart-headless-runner-template` 等虚拟模块（src/main/services/deepseekHarnessService.ts），
 * vitest 解析不了；把那一整片服务 mock 掉，测到的就不是真实 handler 了。
 * handler 里只有一行 `projectService.getAssetFileUrl(relativePath)` 透传，因此按行为测这一行。
 */

vi.mock('electron', () => ({
  app: {
    getPath: () => 'C:\\tmp\\aiart-asset-file-url-test',
    isPackaged: false,
    getName: () => 'aiart-test',
    getVersion: () => '0.0.0',
    on: () => undefined
  },
  shell: { showItemInFolder: () => undefined, openPath: async () => '' },
  nativeImage: { createFromPath: () => ({ isEmpty: () => true }) },
  dialog: {}
}))

// 侧写依赖：文件监听会留下常驻句柄、settings 会碰 electron-store，都与本用例无关
vi.mock('../src/main/services/assetWatchService', () => ({
  assetWatchService: {
    start: () => undefined,
    stop: () => undefined,
    resume: () => undefined,
    suspend: async () => undefined
  }
}))

vi.mock('../src/main/services/settingsService', () => ({
  settingsService: {
    get: () => ({ language: 'zh-CN' }),
    addRecent: () => undefined
  }
}))

let dir = ''

/** 开一个真的临时工程：scaffold + project.json + openProject（走 getRoot 的唯一正路） */
async function openTempProject() {
  const { projectRepository } = await import('../src/main/repositories/projectRepository')
  projectRepository.ensureScaffold(dir)
  projectRepository.write(dir, {
    id: 'test-project',
    name: 'test-project',
    version: 1,
    resolution: { w: 1280, h: 720 },
    fps: 24,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  })
  const { projectService } = await import('../src/main/services/projectService')
  projectService.openProject(join(dir, 'project.json'))
  return projectService
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aiart-asset-url-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  vi.resetModules()
})

describe('projectService.getAssetFileUrl（asset:get-file-url 的委托方法）', () => {
  it('文件存在：媒体文件返回 studio-media URL（带 mtime 做缓存失效）', async () => {
    const service = await openTempProject()
    writeFileSync(join(dir, 'Assets', 'ok.png'), 'png-bytes')

    const url = service.getAssetFileUrl('Assets/ok.png')

    expect(typeof url).toBe('string')
    expect(url).toMatch(/^studio-media:\/\/local\/\?path=/)
    expect(url).toContain(encodeURIComponent(join(dir, 'Assets', 'ok.png')))
    expect(url).toMatch(/&t=\d/)
  })

  it('文件存在：非媒体扩展名回退 file:// URL', async () => {
    const service = await openTempProject()
    writeFileSync(join(dir, 'Assets', 'readme.bin'), 'x')

    const url = service.getAssetFileUrl('Assets/readme.bin')

    expect(url).toMatch(/^file:\/\//)
    expect(url).toContain('readme.bin')
  })

  it('文件缺失：不抛错，返回 null（调用方据此走占位/破图分支）', async () => {
    const service = await openTempProject()

    let url: string | null = 'sentinel'
    expect(() => {
      url = service.getAssetFileUrl('Assets/deleted.png')
    }).not.toThrow()
    expect(url).toBeNull()
  })

  it('文件缺失：已删除的资产路径与从未存在的路径都是 null', async () => {
    const service = await openTempProject()
    writeFileSync(join(dir, 'Assets', 'gone.png'), 'png-bytes')
    rmSync(join(dir, 'Assets', 'gone.png'))

    expect(service.getAssetFileUrl('Assets/gone.png')).toBeNull()
    expect(service.getAssetFileUrl('Assets/never-existed.mp4')).toBeNull()
  })

  it('缺失结果不是空串、不是伪造 URL：null 与「这是一条路径」必须分得开', async () => {
    const service = await openTempProject()
    writeFileSync(join(dir, 'Assets', 'ok.png'), 'png-bytes')

    const missing = service.getAssetFileUrl('Assets/deleted.png')
    const present = service.getAssetFileUrl('Assets/ok.png')

    expect(missing).not.toBe('')
    expect(missing).toBeNull()
    expect(present).not.toBeNull()
  })

  it('路径越界仍然抛错：那条不是预期降级，是调用方 bug', async () => {
    const service = await openTempProject()

    expect(() => service.getAssetFileUrl('../outside.png')).toThrow()
  })

  it('预览层保持既有约定：源文件缺失时 getAssetPreviewUrl 返回空串，不返回 null', async () => {
    const service = await openTempProject()

    await expect(service.getAssetPreviewUrl('Assets/deleted.png')).resolves.toBe('')
  })
})
