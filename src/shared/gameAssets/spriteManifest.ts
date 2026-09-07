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
