import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { build as esbuild } from 'esbuild'
import { describe, expect, it } from 'vitest'
import { writeNodeGamePlayScaffold } from '../src/main/services/gamePlayScaffold'

/**
 * 脚手架 = 程序化资产生成的「示范 + 契约」：模型照着 `src/core/*` 与 `src/assets/*` 的结构写，
 * 所以这里守住四件事，避免改脚手架时把示范改坏：
 *
 * 1. 资产层文件齐全（3D 有几何 / 材质 / 关卡，2D 不带只服务 three 的模块）；
 * 2. `src/core/*` 不得 import three —— 2D 工程没有 three 依赖，一旦引了 2D 直接构建失败；
 * 3. 样例源码能被 esbuild 解析并解析出本地 import（把 `three` 标 external）；
 * 4. 不留 `Math.random` —— 同种子必须同资产，否则「可复现」是空话。
 */

function scaffoldFiles(mode: '2d' | '3d'): { root: string; files: string[] } {
  const root = mkdtempSync(join(tmpdir(), `gp-scaffold-${mode}-`))
  const projectAbs = join(root, 'project')
  writeNodeGamePlayScaffold(projectAbs, mode)
  const files: string[] = []
  const walk = (dir: string, prefix: string): void => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name)
      const rel = prefix ? `${prefix}/${name}` : name
      if (statSync(abs).isDirectory()) walk(abs, rel)
      else files.push(rel)
    }
  }
  walk(projectAbs, '')
  return { root, files: files.sort() }
}

function readSource(root: string, rel: string): string {
  return readFileSync(join(root, 'project', ...rel.split('/')), 'utf8')
}

async function bundleSample(root: string): Promise<void> {
  await esbuild({
    entryPoints: [join(root, 'project', 'src', 'main.js')],
    bundle: true,
    format: 'iife',
    write: false,
    target: ['es2020'],
    external: ['three'],
    logLevel: 'silent'
  })
}

describe('可玩 HTML 脚手架：资产层', () => {
  it('3D 脚手架带齐 core 与 assets（几何 / 材质 / 关卡 / 贴图 / 音效）', () => {
    const { root, files } = scaffoldFiles('3d')
    try {
      expect(files).toEqual(
        expect.arrayContaining([
          'package.json',
          'build.mjs',
          'index.template.html',
          'src/main.js',
          'src/core/rng.js',
          'src/core/palette.js',
          'src/core/registry.js',
          'src/assets/geometry/crystal.js',
          'src/assets/material/metal.js',
          'src/assets/level/ring.js',
          'src/assets/texture/panel.js',
          'src/assets/audio/sfx.js'
        ])
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('2D 脚手架不带 three 专属模块，且 core 不 import three', () => {
    const { root, files } = scaffoldFiles('2d')
    try {
      expect(files.some((file) => /assets\/(geometry|material|level)\//.test(file))).toBe(false)
      expect(files).toContain('src/assets/texture/panel.js')
      expect(files).toContain('src/assets/audio/sfx.js')
      for (const file of files.filter((f) => f.startsWith('src/core/'))) {
        expect(readSource(root, file), `${file} 不得依赖 three`).not.toMatch(/from\s+['"]three['"]/)
      }
      const pkg = JSON.parse(readSource(root, 'package.json')) as {
        dependencies: Record<string, string>
      }
      expect(pkg.dependencies.three).toBeUndefined()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('两个模式的样例都能被 esbuild 解析（含本地 import 解析）', async () => {
    for (const mode of ['2d', '3d'] as const) {
      const { root } = scaffoldFiles(mode)
      try {
        await expect(bundleSample(root)).resolves.toBeUndefined()
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    }
  })

  it('样例里没有 Math.random，且走资产注册表', () => {
    const { root, files } = scaffoldFiles('3d')
    try {
      for (const file of files.filter((f) => f.endsWith('.js'))) {
        expect(
          readSource(root, file),
          `${file} 不得用 Math.random（同种子必须同资产）`
        ).not.toMatch(/Math\.random\(/)
      }
      const main = readSource(root, 'src/main.js')
      expect(main).toMatch(/defineAsset\(/)
      expect(main).toMatch(/buildAsset\(/)
      const registry = readSource(root, 'src/core/registry.js')
      expect(registry).toMatch(/duplicate id/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
