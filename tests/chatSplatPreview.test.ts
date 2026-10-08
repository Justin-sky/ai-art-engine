import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SPLAT_EXTENSIONS } from '../src/renderer/src/features/director/splatMesh'
import {
  chatPreviewAssetType,
  chatPreviewKind,
  isSplatPreviewPath
} from '../src/renderer/src/features/media/chatPreviewKind'

/**
 * 「AI 对话流里没有预览生成的 splat 结果」的回归。
 *
 * 根因：对话产物卡按扩展名决定渲染方式，而 `MODEL_EXTS` 只写了 `['glb','gltf']`，
 * 于是 `.ply` / `.spz` 落成 `file` 分支 —— 卡片上只显示**一行路径文本**。
 * 但它们其实**能预览**：`ChatAssetPreview` → `ModelPreview` → `loadModelScene`
 * 内部按 `isSplatPath` 把泼溅交给 Spark 渲染。
 *
 * 现在扩展名清单从 `SPLAT_EXTENSIONS` 推导（单一来源），并抽成纯函数以便测试 ——
 * 组件本身依赖 three.js，测不了。
 */
const SRC = readFileSync(resolve('src/renderer/src/components/ChatAssetPreview.vue'), 'utf8')

describe('chatPreviewKind：3D 格式（含泼溅）都走 model 预览', () => {
  it('泼溅 .ply / .spz 判为 model（原缺口）', () => {
    expect(chatPreviewKind('Cache/Models/world.ply')).toBe('model')
    expect(chatPreviewKind('Cache/Models/world.spz')).toBe('model')
  })

  it('对每一个 SPLAT_EXTENSIONS 取值都成立（防两处清单漂移）', () => {
    for (const ext of SPLAT_EXTENSIONS) {
      expect(chatPreviewKind(`Cache/Models/x${ext}`)).toBe('model')
    }
  })

  it('网格格式照旧判为 model', () => {
    for (const name of ['a.glb', 'a.GLB', 'a.gltf', 'a.fbx']) {
      expect(chatPreviewKind(`Cache/Models/${name}`)).toBe('model')
    }
  })

  it('图片 / 视频 / 音频不受影响', () => {
    expect(chatPreviewKind('Assets/a.png')).toBe('image')
    expect(chatPreviewKind('Assets/a.webp')).toBe('image')
    expect(chatPreviewKind('Cache/Videos/a.mp4')).toBe('video')
    expect(chatPreviewKind('Cache/Voices/a.mp3')).toBe('audio')
  })

  it('未知类型仍降级为 file（不会把 .txt 当模型）', () => {
    expect(chatPreviewKind('notes/readme.txt')).toBe('file')
    expect(chatPreviewKind('Assets/graph.json')).toBe('file')
    expect(chatPreviewKind('')).toBe('file')
    expect(chatPreviewKind('noext')).toBe('file')
  })

  it('带查询串 / 大小写 / 多后缀路径都能正确判定', () => {
    expect(chatPreviewKind('Cache/Models/world.ply?v=2')).toBe('model')
    expect(chatPreviewKind('Cache/Models/world.PLY')).toBe('model')
    expect(chatPreviewKind('Cache/Models/world.pano.png')).toBe('image')
    expect(chatPreviewKind('/abs/path/Cache/Models/world.spz')).toBe('model')
  })

  it('isSplatPreviewPath 只认泼溅，不认普通网格（供将来分口使用）', () => {
    expect(isSplatPreviewPath('x.ply')).toBe(true)
    expect(isSplatPreviewPath('x.spz')).toBe(true)
    expect(isSplatPreviewPath('x.glb')).toBe(false)
    expect(isSplatPreviewPath('x.fbx')).toBe(false)
  })
})

describe('ChatAssetPreview 组件接线', () => {
  it('扩展名判据来自共享纯函数，而不是内联一份清单', () => {
    expect(SRC).toContain('chatPreviewKind(props.relativePath)')
    // 内联清单就是这次的根因，不该再出现
    expect(SRC).not.toMatch(/const (IMAGE|VIDEO|AUDIO|MODEL)_EXTS\s*=/)
  })

  it('model 分支仍然交给 ModelPreview（泼溅由它内部交给 Spark）', () => {
    expect(SRC).toMatch(/<ModelPreview\s+v-else-if="kind === 'model'"/)
  })
})

/**
 * 产物卡左上角的类型徽标。
 *
 * 判据同样从扩展名派生（`ChatMsg` 的 asset 分支没有 `assetType` 字段，旧会话
 * 历史也没存），所以刷新后的历史卡也能显示徽标。
 */
describe('chatPreviewAssetType：徽标用资产类型', () => {
  it('图片 / 视频 / 声音 / 模型各自映射', () => {
    expect(chatPreviewAssetType('Assets/a.png')).toBe('image')
    expect(chatPreviewAssetType('Cache/Videos/a.mp4')).toBe('video')
    expect(chatPreviewAssetType('Cache/Voices/a.mp3')).toBe('voice')
    expect(chatPreviewAssetType('Cache/Models/a.glb')).toBe('model')
    expect(chatPreviewAssetType('Cache/Models/a.fbx')).toBe('model')
  })

  it('泼溅单独成一个类型，不混进「模型」', () => {
    // 两者登记的都是 model 资产，但一个是可进 DCC 的网格、一个只能在 Spark 里看；
    // 用同一个标签会让人以为拿到的是能直接用的网格
    for (const withDot of SPLAT_EXTENSIONS) {
      expect(chatPreviewAssetType(`Cache/Models/world${withDot}`)).toBe('splat')
    }
  })

  it('未知类型返回 null（卡上不显示徽标，而不是显示没意义的词）', () => {
    expect(chatPreviewAssetType('notes/readme.txt')).toBeNull()
    expect(chatPreviewAssetType('')).toBeNull()
    expect(chatPreviewAssetType('noext')).toBeNull()
    expect(chatPreviewAssetType('Assets/graph.json')).toBeNull()
  })

  it('带查询串 / 大小写照样判定（与 chatPreviewKind 同口径）', () => {
    expect(chatPreviewAssetType('Cache/Models/world.PLY?v=2')).toBe('splat')
    expect(chatPreviewAssetType('Cache/Models/a.GLB')).toBe('model')
  })
})

describe('徽标接线与文案', () => {
  it('组件渲染徽标，且文案走 assetTypeLabel（不硬编码中文）', () => {
    expect(SRC).toContain('chatPreviewAssetType(props.relativePath)')
    expect(SRC).toContain('assetTypeLabel(assetType)')
    expect(SRC).toMatch(/v-if="typeBadge && kind !== 'audio'" class="chat-asset-type"/)
  })

  it('徽标压在预览左上角（容器需是定位上下文）', () => {
    expect(SRC).toMatch(/\.chat-asset-preview \{[\s\S]{0,220}position: relative;/)
    expect(SRC).toMatch(/\.chat-asset-type \{[\s\S]{0,160}position: absolute;/)
    expect(SRC).toMatch(/\.chat-asset-type \{[\s\S]{0,260}left: 6px;/)
    expect(SRC).toMatch(/\.chat-asset-type \{[\s\S]{0,320}pointer-events: none;/)
  })

  it('i18n 有 splat 标签，中英都有（assetTypeLabel 靠它出文案）', () => {
    const zh = readFileSync(resolve('src/renderer/src/i18n/locales/zh-CN.ts'), 'utf8')
    const en = readFileSync(resolve('src/renderer/src/i18n/locales/en-US.ts'), 'utf8')
    expect(zh).toMatch(/motion: '导演台',\s*\n\s*model: '模型',\s*\n\s*splat: '[^']+'/)
    expect(en).toMatch(/model: 'Model',\s*\n\s*splat: '[^']+'/)
  })
})
