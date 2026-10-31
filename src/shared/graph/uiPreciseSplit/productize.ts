/**
 * 产品化输出（UI 精准拆层 v2 · P4）：
 * - **alpha bleed**：透明像素的 RGB 用邻近不透明像素颜色外扩填充（alpha 仍为 0）。
 *   引擎做双线性过滤 / mipmap 时会采样到透明像素的 RGB，不外扩就会出现黑边 / 白边；
 * - **引擎安全导出名**：按游戏 UI 惯例 `类型前缀_语义_序号`（Btn_Confirm_01 / Slot_Reward_02 / Txt_Title_01），
 *   只含 ASCII 字母数字下划线，可直接作为切图文件名、Unity GameObject / Godot 节点名。
 */

/** 透明像素 RGB 外扩（多轮 3×3 邻域 alpha 加权平均），只改 alpha = 0 的像素的 RGB */
export function bleedTransparentRgb(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  radius = 4
): number {
  const n = width * height
  const filled = new Uint8Array(n)
  for (let p = 0; p < n; p++) if (rgba[p * 4 + 3]! > 0) filled[p] = 1
  let changed = 0
  for (let r = 0; r < radius; r++) {
    const next: number[] = []
    const colors: number[] = []
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = y * width + x
        if (filled[p]) continue
        let sr = 0
        let sg = 0
        let sb = 0
        let sw = 0
        for (let dy = -1; dy <= 1; dy++) {
          const ny = y + dy
          if (ny < 0 || ny >= height) continue
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx
            if (nx < 0 || nx >= width || (!dx && !dy)) continue
            const np = ny * width + nx
            if (!filled[np]) continue
            // 已外扩的像素权重低于真实像素，避免多轮后颜色漂移
            const w = rgba[np * 4 + 3]! > 0 ? rgba[np * 4 + 3]! / 255 : 0.25
            sr += rgba[np * 4]! * w
            sg += rgba[np * 4 + 1]! * w
            sb += rgba[np * 4 + 2]! * w
            sw += w
          }
        }
        if (sw <= 0) continue
        next.push(p)
        colors.push(sr / sw, sg / sw, sb / sw)
      }
    }
    if (!next.length) break
    for (let k = 0; k < next.length; k++) {
      const p = next[k]!
      rgba[p * 4] = colors[k * 3]!
      rgba[p * 4 + 1] = colors[k * 3 + 1]!
      rgba[p * 4 + 2] = colors[k * 3 + 2]!
      filled[p] = 1
      changed++
    }
  }
  return changed
}

const KIND_PREFIX: Record<string, string> = {
  panel: 'Panel',
  frame: 'Frame',
  banner: 'Banner',
  button: 'Btn',
  'close-button': 'BtnClose',
  arrow: 'BtnArrow',
  tab: 'Tab',
  'item-slot': 'Slot',
  icon: 'Icon',
  badge: 'Badge',
  avatar: 'Avatar',
  illustration: 'Img',
  'progress-bar': 'Bar',
  divider: 'Line',
  decoration: 'Deco',
  effect: 'Fx',
  text: 'Txt',
  'art-text': 'ArtTxt',
  other: 'Img'
}

/** 显示名 → ASCII 语义片段（Confirm Button → Confirm；纯中文名返回空串） */
export function asciiSlug(name: string, prefix: string): string {
  const words = (name.match(/[A-Za-z][A-Za-z0-9]*|[0-9]+/g) ?? [])
    .map((w) => w.toLowerCase())
    // 去掉与类型前缀重复的通用词
    .filter(
      (w) =>
        ![
          'button',
          'btn',
          'icon',
          'panel',
          'slot',
          'image',
          'img',
          'layer',
          'text',
          'label'
        ].includes(w) && w !== prefix.toLowerCase()
    )
  const slug = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('')
  return slug.slice(0, 24)
}

/** 为一组图层生成唯一的引擎安全导出名（同前缀 + 语义按出现顺序编号） */
export function buildUiExportNames(
  layers: ReadonlyArray<{ id: string; kind: string; name: string; text?: string }>
): Map<string, string> {
  const counters = new Map<string, number>()
  const out = new Map<string, string>()
  for (const l of layers) {
    const prefix = KIND_PREFIX[l.kind] ?? 'Img'
    const slug = asciiSlug(l.name, prefix) || (l.text ? asciiSlug(l.text, prefix) : '')
    const key = `${prefix}_${slug}`
    const n = (counters.get(key) ?? 0) + 1
    counters.set(key, n)
    const idx = String(n).padStart(2, '0')
    out.set(l.id, slug ? `${prefix}_${slug}_${idx}` : `${prefix}_${idx}`)
  }
  return out
}
