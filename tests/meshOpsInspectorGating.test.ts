import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 供应商感知的参数显隐：贴图 / 重拓扑节点的 Inspector 必须按能力矩阵决定
 * 哪些 Tripo 专有控件出现（Meshy 走 retexture / remesh，用不上这些参数）。
 */
const INSPECTOR = readFileSync(
  resolve('src/renderer/src/components/ModelPostProcessInspector.vue'),
  'utf8'
)
const PROVIDER_KIND_HOOK = readFileSync(
  resolve('src/renderer/src/features/graph/model/useMeshOpsNodeProviderKind.ts'),
  'utf8'
)

describe('3D 加工 Inspector 的供应商感知', () => {
  it('用统一 hook 解析当前供应商，再读能力位', () => {
    expect(INSPECTOR).toMatch(/useMeshOpsNodeProviderKind\(node\)/)
    expect(INSPECTOR).toMatch(/meshOpCaps\(providerKind\.value\)/)
    expect(PROVIDER_KIND_HOOK).toMatch(/loadGenerateModelOptions\('model3d'/)
  })

  it('Tripo 专有控件按能力位显隐（未知供应商时不隐藏）', () => {
    const gates: Array<[string, string]> = [
      ['showTextureVersion', 'textureModelVersion'],
      ['showTextureSeed', 'textureSeed'],
      ['showRetopologyTier', 'retopologyTier'],
      ['showRetopologyBake', 'retopologyBake'],
      ['showPartNames', 'partNames'],
      ['showConvertAdvanced', 'convertAdvanced']
    ]
    for (const [flag, cap] of gates) {
      expect(INSPECTOR, `${flag} 未按能力位计算`).toMatch(
        new RegExp(`const ${flag} = computed\\(\\(\\) => caps\\.value\\?\\.${cap} !== false\\)`)
      )
      expect(INSPECTOR, `${flag} 未用于模板显隐`).toMatch(new RegExp(`v-if="${flag}"`))
    }
  })

  it('动作库选择器只对 library 型供应商出现', () => {
    expect(INSPECTOR).toMatch(
      /const showAnimationLibrary = computed\(\(\) => caps\.value\?\.retargetIds === 'library'\)/
    )
    expect(INSPECTOR).toMatch(/v-if="showAnimationLibrary"/)
    expect(INSPECTOR).toMatch(/window\.studio\.listModel3dAnimations\(/)
    expect(INSPECTOR).toMatch(/retargetActionIds/)
  })

  it('四个按部件操作的节点都能从上游拆分结果点选部件', () => {
    for (const key of [
      'meshCompletePartNames',
      'retopologyPartNames',
      'convertPartNames',
      'texturePartNames'
    ]) {
      expect(INSPECTOR, `${key} 未接部件选择器`).toMatch(
        new RegExp(`onTogglePart\\('${key}', \\$event\\)`)
      )
    }
    expect(INSPECTOR).toMatch(/import MeshOpPartsPicker from '\.\/MeshOpPartsPicker\.vue'/)
    // 上游部件表沿 in-model 向上回溯，且点选结果同步回指令框文本
    expect(INSPECTOR).toMatch(/const upstreamParts = computed/)
    expect(INSPECTOR).toMatch(/listIncomingEdges\(hid, cursorId, 'in-model'\)/)
    expect(INSPECTOR).toMatch(/generateInstruction: joinPartNames\(next\)/)

    const picker = readFileSync(
      resolve('src/renderer/src/components/MeshOpPartsPicker.vue'),
      'utf8'
    )
    expect(picker).toMatch(/emit\('toggle', part\)/)
    expect(picker).toMatch(/graph\.inspector\.meshOpParts\.empty/)
  })

  it('非 Tripo 供应商给一行说明文案（中英都有）', () => {
    expect(INSPECTOR).toMatch(/graph\.inspector\.modelTexture\.providerNote/)
    expect(INSPECTOR).toMatch(/graph\.inspector\.modelRetopology\.providerNote/)
    for (const locale of ['zh-CN', 'en-US']) {
      const file = resolve(`src/renderer/src/i18n/locales/${locale}.ts`)
      expect(existsSync(file)).toBe(true)
      const src = readFileSync(file, 'utf8')
      expect(src, `${locale} 缺贴图说明`).toMatch(/providerNote:/)
    }
  })
})
