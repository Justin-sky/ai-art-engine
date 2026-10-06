import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SPLAT_EXTENSIONS } from '../src/renderer/src/features/director/splatMesh'
import {
  ANY_FILE_EXTENSIONS,
  MODEL_FILE_EXTENSIONS,
  MOTION_FILE_EXTENSIONS,
  modelFileExtensions
} from '../src/shared/mediaFileExtensions'

/**
 * 媒体扩展名清单的**单一来源**守卫。
 *
 * 收这份清单的原因是同一个格式在不同入口被当成不同东西，已经出过两次：
 *
 * 1. 对话产物卡只认 `['glb','gltf']` → 泼溅落成纯文本路径（`chatPreviewKind`）
 * 2. 资产编辑器的文件选择器里**一个模型格式都没有**（`model` 落到 `default`，
 *    拿到的是 `['png','jpg','mp4','mp3','txt','md']`）
 *
 * 组件依赖 three.js / Vue，测不了，所以这里做**源码级接线断言**：
 * 各处必须是引用共享清单，而不是自己再写一份 —— 那正是复发的路径。
 */
const ASSET_EDITOR = readFileSync(resolve('src/renderer/src/components/AssetEditor.vue'), 'utf8')
const EDITOR_BUILTINS = readFileSync(
  resolve('src/renderer/src/editor/extensions/builtins.ts'),
  'utf8'
)
const CHAT_PREVIEW = readFileSync(
  resolve('src/renderer/src/features/media/chatPreviewKind.ts'),
  'utf8'
)

describe('MODEL_FILE_EXTENSIONS 覆盖全部模型格式', () => {
  it('含网格格式与每一个泼溅扩展名', () => {
    for (const ext of ['glb', 'gltf', 'fbx']) {
      expect(MODEL_FILE_EXTENSIONS).toContain(ext)
    }
    // 泼溅扩展名以 SPLAT_EXTENSIONS 为源，两边不能各写一份
    for (const withDot of SPLAT_EXTENSIONS) {
      expect(MODEL_FILE_EXTENSIONS).toContain(withDot.slice(1))
    }
  })

  it('不含明显的非模型格式（防把图片 / 音频混进来）', () => {
    for (const ext of ['png', 'jpg', 'mp3', 'mp4', 'txt']) {
      expect(MODEL_FILE_EXTENSIONS).not.toContain(ext)
    }
  })

  it('modelFileExtensions() 返回可变副本（调用方不会污染常量）', () => {
    const list = modelFileExtensions()
    list.push('hacked')
    expect(MODEL_FILE_EXTENSIONS).not.toContain('hacked')
  })
})

describe('MOTION_FILE_EXTENSIONS 保留既有行为', () => {
  it('含视频扩展名，也含 glb / gltf / 图片（动作可由模型 + 站位图产生）', () => {
    for (const ext of ['mp4', 'mov', 'webm', 'glb', 'gltf', 'png', 'jpg']) {
      expect(MOTION_FILE_EXTENSIONS).toContain(ext)
    }
  })
})

describe('两处消费方都改成引用共享清单', () => {
  it('编辑器的模型导入器不再内联扩展名数组', () => {
    expect(EDITOR_BUILTINS).toContain('modelFileExtensions()')
    expect(EDITOR_BUILTINS).not.toMatch(/extensions: \['glb', 'gltf'/)
  })

  it('AssetEditor 补上了 model 分支（原先没有，落到 default）', () => {
    expect(ASSET_EDITOR).toMatch(/case 'model':/)
    expect(ASSET_EDITOR).toContain('modelFileExtensions()')
    // 各分支都不该再各写一份字面量数组
    expect(ASSET_EDITOR).not.toMatch(/extensions: \['png', 'jpg'/)
    expect(ASSET_EDITOR).not.toMatch(/extensions: \['mp4', 'mov'/)
    expect(ASSET_EDITOR).not.toMatch(/extensions: \['mp3', 'wav'/)
  })

  it('AssetEditor 的 default 分支走 ANY_FILE_EXTENSIONS', () => {
    expect(ASSET_EDITOR).toContain('[...ANY_FILE_EXTENSIONS]')
    expect(ANY_FILE_EXTENSIONS).toContain('txt')
  })

  it('对话预览的扩展名清单也来自共享常量', () => {
    expect(CHAT_PREVIEW).toContain('MODEL_FILE_EXTENSIONS')
    expect(CHAT_PREVIEW).toContain('IMAGE_FILE_EXTENSIONS')
    expect(CHAT_PREVIEW).toContain('VIDEO_FILE_EXTENSIONS')
    expect(CHAT_PREVIEW).toContain('AUDIO_FILE_EXTENSIONS')
    // 不该再出现内联的模型扩展名清单
    expect(CHAT_PREVIEW).not.toMatch(/new Set<string>\(\['glb'/)
  })
})

describe('i18n：新增的模型过滤标签中英都有', () => {
  it('zh-CN / en-US 都有 asset.fileFilter.model', () => {
    const zh = readFileSync(resolve('src/renderer/src/i18n/locales/zh-CN.ts'), 'utf8')
    const en = readFileSync(resolve('src/renderer/src/i18n/locales/en-US.ts'), 'utf8')
    expect(zh).toMatch(/fileFilter: \{[^}]*model: '[^']+'/s)
    expect(en).toMatch(/fileFilter: \{[^}]*model: '[^']+'/s)
  })
})
