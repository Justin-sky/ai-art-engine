/**
 * 2D 游戏资产生成结果清单（manifest）纯构建器（5.4「2D 游戏资产版」）。
 *
 * 统一对齐 / 特效 sheet / 角色差分 / UI 部件批量导出后，把「每张 PNG
 * 的名字、像素尺寸、锚点」沉淀为一份机器可读清单，供引擎加载器直接
 * 消费——即 ROADMAP 里「带锚点的透明角色差分包 / 部件包」的交付载体。
 * 纯函数，无 IO，可单测。
 */

export const SPRITE_MANIFEST_VERSION = 1 as const

export type SpriteManifestAnchor = 'center' | 'ground'

export interface SpriteManifestEntry {
  /** 资产名（不含扩展名），如 hero-idle-0 */
  name: string
  /** 磁盘文件名（含扩展名），如 hero-idle-0.png */
  fileName: string
  /** 像素宽 / 高 */
  width: number
  height: number
  /** 锚点像素（相对图片左上角；引擎挂载基准） */
  anchorX: number
  anchorY: number
  /** 本条目锚点语义；缺省继承清单级 anchor */
  anchor?: SpriteManifestAnchor
}

export interface SpriteManifest {
  version: typeof SPRITE_MANIFEST_VERSION
  kind: 'sprite-batch'
  exportId: string
  createdAt: string
  /** 统一画布尺寸；条目尺寸通常等于画布尺寸（对齐导出） */
  canvasWidth: number
  canvasHeight: number
  /** 批量锚点语义（center / ground） */
  anchor: SpriteManifestAnchor
  sprites: SpriteManifestEntry[]
}

export interface BuildSpriteManifestInput {
  exportId?: string
  createdAt?: string
  canvasWidth: number
  canvasHeight: number
  anchor: SpriteManifestAnchor
  sprites: Array<
    Omit<SpriteManifestEntry, 'anchorX' | 'anchorY'> & {
      anchorX?: number
      anchorY?: number
    }
  >
}

function clampInt(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(Number.isFinite(n) ? n : 0)))
}

/**
 * 由条目（可省略逐条锚点，省略时按锚点语义取默认：
 * X = 画布中心；center 取图片中心、ground 取图片底边中点）
 * 构建清单。条目保持传入顺序；只做数值夹取，不查磁盘。
 */
export function buildSpriteManifest(input: BuildSpriteManifestInput): SpriteManifest {
  const canvasWidth = clampInt(input.canvasWidth, 1, 8192)
  const canvasHeight = clampInt(input.canvasHeight, 1, 8192)
  const anchor: SpriteManifestAnchor = input.anchor === 'center' ? 'center' : 'ground'
  const sprites: SpriteManifestEntry[] = (input.sprites ?? [])
    .filter((s) => s && s.name && s.fileName)
    .map((s) => {
      const width = clampInt(s.width, 1, 8192)
      const height = clampInt(s.height, 1, 8192)
      // 缺省锚点按图片自身取：center=图片中心；ground=底边中点
      const fallbackX = Math.round(width / 2)
      return {
        name: s.name,
        fileName: s.fileName,
        width,
        height,
        anchorX: clampInt(s.anchorX ?? fallbackX, 0, width),
        anchorY: clampInt(
          s.anchorY ?? (anchor === 'ground' ? height : Math.round(height / 2)),
          0,
          height
        ),
        anchor: s.anchor ?? anchor
      }
    })
  return {
    version: SPRITE_MANIFEST_VERSION,
    kind: 'sprite-batch',
    exportId: input.exportId || `sprites-${Date.now().toString(36)}`,
    createdAt: input.createdAt ?? new Date().toISOString(),
    canvasWidth,
    canvasHeight,
    anchor,
    sprites
  }
}

export interface EngineSpriteSheetFrame {
  frame: { x: number; y: number; w: number; h: number }
  rotated: boolean
  trimmed: boolean
  spriteSourceSize: { x: number; y: number; w: number; h: number }
  sourceSize: { w: number; h: number }
  /** 单帧持续毫秒（兼容 Aseprite / Phaser / Godot 帧时长） */
  duration: number
  /** 归一化枢轴 0..1（兼容 TexturePacker / Unity / Phaser） */
  pivot: { x: number; y: number }
}

export interface EngineSpriteSheetTag {
  name: string
  from: number
  to: number
  direction: 'forward' | 'pingpong'
}

export interface EngineSpriteSheetSlice {
  name: string
  color: string
  keys: Array<{
    frame: number
    bounds: { x: number; y: number; w: number; h: number }
    pivot?: { x: number; y: number }
  }>
}

export interface EngineSpriteSheetJson {
  frames: Record<string, EngineSpriteSheetFrame>
  meta: {
    app: string
    version: string
    image: string
    format: 'RGBA8888'
    size: { w: number; h: number }
    scale: string
    fps: number
    frameTags: EngineSpriteSheetTag[]
    slices: EngineSpriteSheetSlice[]
  }
}

/**
 * 构建通用游戏引擎 Sprite Sheet Atlas JSON（兼容 TexturePacker / Aseprite / Godot / Unity / Phaser）。
 * 包含逐帧裁剪矩形 `frame`、毫秒帧长 `duration`、归一化锚点 `pivot`、
 * 动画剪辑标签 `meta.frameTags` 以及受击框/挂点切片 `meta.slices`。
 */
export function buildEngineSpriteSheetJson(input: {
  imageFileName: string
  frameWidth: number
  frameHeight: number
  frameNames: string[]
  columns?: number
  fps?: number
  anchor?: SpriteManifestAnchor
  playMode?: 'loop' | 'once' | 'pingpong'
  tagName?: string
}): EngineSpriteSheetJson {
  const frameWidth = clampInt(input.frameWidth, 1, 8192)
  const frameHeight = clampInt(input.frameHeight, 1, 8192)
  const fps = clampInt(input.fps ?? 12, 1, 120)
  const durationMs = Math.max(8, Math.round(1000 / fps))
  const anchor: SpriteManifestAnchor = input.anchor === 'center' ? 'center' : 'ground'
  const pivot = anchor === 'ground' ? { x: 0.5, y: 1 } : { x: 0.5, y: 0.5 }
  const names = input.frameNames.length ? input.frameNames : ['frame-0']
  const columns = clampInt(input.columns ?? names.length, 1, Math.max(1, names.length))
  const rows = Math.max(1, Math.ceil(names.length / columns))
  const frames: Record<string, EngineSpriteSheetFrame> = {}

  names.forEach((rawName, idx) => {
    const key = rawName.trim() || `frame-${idx}`
    const col = idx % columns
    const row = Math.floor(idx / columns)
    frames[key] = {
      frame: { x: col * frameWidth, y: row * frameHeight, w: frameWidth, h: frameHeight },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: frameWidth, h: frameHeight },
      sourceSize: { w: frameWidth, h: frameHeight },
      duration: durationMs,
      pivot
    }
  })

  const tagName = (input.tagName ?? '').trim() || 'default'
  const direction: 'forward' | 'pingpong' = input.playMode === 'pingpong' ? 'pingpong' : 'forward'
  const hurtboxW = Math.max(1, Math.round(frameWidth * 0.6))
  const hurtboxH = Math.max(1, Math.round(frameHeight * 0.8))
  const hurtboxX = Math.round((frameWidth - hurtboxW) / 2)
  const hurtboxY =
    anchor === 'ground' ? frameHeight - hurtboxH : Math.round((frameHeight - hurtboxH) / 2)

  return {
    frames,
    meta: {
      app: 'ai-art-engine',
      version: '1.0',
      image: input.imageFileName.trim() || 'sheet.png',
      format: 'RGBA8888',
      size: { w: frameWidth * columns, h: frameHeight * rows },
      scale: '1',
      fps,
      frameTags: [
        {
          name: tagName,
          from: 0,
          to: Math.max(0, names.length - 1),
          direction
        }
      ],
      slices: [
        {
          name: 'hurtbox',
          color: '#0000ffff',
          keys: [
            {
              frame: 0,
              bounds: { x: hurtboxX, y: hurtboxY, w: hurtboxW, h: hurtboxH },
              pivot: {
                x: Math.round(frameWidth * pivot.x) - hurtboxX,
                y: Math.round(frameHeight * pivot.y) - hurtboxY
              }
            }
          ]
        }
      ]
    }
  }
}
