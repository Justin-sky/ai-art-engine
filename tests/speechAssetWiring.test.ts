import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..')

/**
 * 语音适配器不得自己登记资产。
 *
 * 契约：适配器只写临时文件并返回 `filePath`；落盘目录与资产登记由
 * facade 的 `generateSpeechAsset` 统一负责（这样 `outputDir` 才会经过
 * resolveMediaOutputDir，也不会出现同一个文件两条资产）。
 *
 * 踩过的坑：openaiCompat 原本自己 attach，修掉后 **ComfyUI / 火山方舟
 * openspeech / MiniMax 音色设计** 三处还留着同样的写法 —— 只修一处就会
 * 留下三条同类路径。这条测试按「所有读 input.input 的语音实现」逐个扫，
 * 免得以后再漏。
 *
 * 这是源码级守卫（主进程适配器在 environment: node 下不便整链挂载），
 * 与 upstreamFailureHint.test.ts / genSpeechWiring.test.ts 同一手法。
 */
describe('语音适配器不自己登记资产', () => {
  const speechSources = [
    'src/main/services/modelProviders/openaiCompat.ts',
    'src/main/services/modelProviders/comfyui/adapter.ts',
    'src/main/services/modelProviders/volcengineArk/openspeech.ts',
    'src/main/services/modelProviders/minimax/voiceDesign.ts'
  ]

  for (const rel of speechSources) {
    it(`${rel} 不调用资产登记（attachExternalGeneratedFile）`, () => {
      const text = readFileSync(join(ROOT, rel), 'utf8')
      // 只看**调用**：注释里提到这个函数名是允许的（本仓库惯例是写清"为什么不要这样写"）。
      // 也不用「不许导入 projectService」——openspeech 读工程内参考音频是合法用途。
      expect(text).not.toMatch(/\.attachExternalGeneratedFile\s*\(/)
    })
  }

  it('这些实现都返回 filePath（交给 facade 落盘）', () => {
    for (const rel of speechSources) {
      const text = readFileSync(join(ROOT, rel), 'utf8')
      expect(text, rel).toContain('filePath')
    }
  })

  it('facade 的 generateSpeechAsset 是唯一登记点', () => {
    const facade = readFileSync(join(ROOT, 'src/main/services/modelProviders/facade.ts'), 'utf8')
    expect(facade).toContain('async generateSpeechAsset(')
    // 落盘目录必须经过统一解析，否则各处落点不一致
    expect(facade).toMatch(/generateSpeechAsset[\s\S]*?resolveMediaOutputDir/)
  })
})
