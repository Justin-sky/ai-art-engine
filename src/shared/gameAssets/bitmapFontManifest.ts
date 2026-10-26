/**
 * 艺术暴击跳字位图字体（AngelCode BMFont `.fnt` + JSON 度量清单）生成器纯函数层。
 *
 * 面向动作（ACT）、RPG、肉鸽割草、卡牌与射击游戏的伤害跳字（`-9999! CRIT MISS +500`）：
 * 根据网格排布的透明位图字体整版图（如 4×4 共 16 格：`0123456789+-!%CM`），
 * 自动计算每个字符的裁剪坐标 `(x, y, width, height)`、水平步进 `xadvance` 与基线，
 * 输出标准 AngelCode BMFont 文本格式（`.fnt`），可直接导入 Godot 4 `FontFile`、Unity Custom Font 与 Phaser 3 `load.bitmapFont`。
 */

export interface BitmapFontGlyph {
  char: string
  charCode: number
  row: number
  col: number
  x: number
  y: number
  width: number
  height: number
  xoffset: number
  yoffset: number
  xadvance: number
}

export interface BitmapFontManifestOptions {
  fontName?: string
  textureFileName?: string
  atlasWidth?: number
  atlasHeight?: number
  rows?: number
  cols?: number
  /** 按网格从左到右、从上到下排列的字符序列（默认 '0123456789+-!%CM'） */
  charset?: string
  /** 字符紧缩比例（0.5 ~ 1.0，默认 0.78，让数字跳字排列更紧凑有力） */
  trackingRatio?: number
}

export interface BitmapFontManifestResult {
  schemaVersion: 1
  fontName: string
  textureFileName: string
  atlasWidth: number
  atlasHeight: number
  cellWidth: number
  cellHeight: number
  lineHeight: number
  base: number
  glyphs: BitmapFontGlyph[]
  /** 标准 AngelCode BMFont (.fnt) 文本内容 */
  fntText: string
  /** JSON 格式度量清单 */
  jsonText: string
}

export const DEFAULT_DAMAGE_FONT_CHARSET = '0123456789+-!%CM'

/**
 * 构建艺术跳字位图字体清单与标准 AngelCode `.fnt` 文件内容。
 */
export function buildBitmapFontManifest(
  options: BitmapFontManifestOptions = {}
): BitmapFontManifestResult {
  const fontName = (options.fontName || 'damage_crit_font').trim() || 'damage_crit_font'
  const textureFileName = (options.textureFileName || `${fontName}.png`).trim()
  const atlasWidth = Math.max(64, Math.round(options.atlasWidth ?? 1024))
  const atlasHeight = Math.max(64, Math.round(options.atlasHeight ?? 1024))
  const rows = Math.max(1, Math.round(options.rows ?? 4))
  const cols = Math.max(1, Math.round(options.cols ?? 4))
  const charset = options.charset || DEFAULT_DAMAGE_FONT_CHARSET
  const trackingRatio = Math.max(0.4, Math.min(1.1, options.trackingRatio ?? 0.78))

  const cellWidth = Math.floor(atlasWidth / cols)
  const cellHeight = Math.floor(atlasHeight / rows)
  const xadvance = Math.max(8, Math.round(cellWidth * trackingRatio))
  const lineHeight = cellHeight
  const base = Math.round(cellHeight * 0.82)

  const chars = Array.from(charset).slice(0, rows * cols)
  const glyphs: BitmapFontGlyph[] = chars.map((ch, idx) => {
    const row = Math.floor(idx / cols)
    const col = idx % cols
    return {
      char: ch,
      charCode: ch.codePointAt(0) ?? 48,
      row,
      col,
      x: col * cellWidth,
      y: row * cellHeight,
      width: cellWidth,
      height: cellHeight,
      xoffset: 0,
      yoffset: 0,
      xadvance
    }
  })

  const fntLines: string[] = [
    `info face="${fontName}" size=${cellHeight} bold=1 italic=0 charset="" unicode=1 stretchH=100 smooth=1 aa=1 padding=0,0,0,0 spacing=0,0 outline=0`,
    `common lineHeight=${lineHeight} base=${base} scaleW=${atlasWidth} scaleH=${atlasHeight} pages=1 packed=0 alphaChnl=0 redChnl=4 greenChnl=4 blueChnl=4`,
    `page id=0 file="${textureFileName}"`,
    `chars count=${glyphs.length}`
  ]

  for (const g of glyphs) {
    fntLines.push(
      `char id=${g.charCode}   x=${g.x}   y=${g.y}   width=${g.width}   height=${g.height}   xoffset=${g.xoffset}   yoffset=${g.yoffset}   xadvance=${g.xadvance}   page=0  chnl=15`
    )
  }

  const fntText = fntLines.join('\n') + '\n'
  const result = {
    schemaVersion: 1 as const,
    fontName,
    textureFileName,
    atlasWidth,
    atlasHeight,
    cellWidth,
    cellHeight,
    lineHeight,
    base,
    glyphs,
    fntText
  }

  return {
    ...result,
    jsonText: JSON.stringify(result, null, 2)
  }
}
