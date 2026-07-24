/** 比例按钮线框图标（与导演台画幅图标同风格） */

function frameIcon(width: number, height: number): string {
  const x = (24 - width) / 2
  const y = (24 - height) / 2
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="1.2"/></svg>`
}

const RATIO_ICON_MAP: Record<string, string> = {
  '1:1': frameIcon(12, 12),
  '1:2': frameIcon(8, 16),
  '2:1': frameIcon(16, 8),
  '9:16': frameIcon(9, 16),
  '16:9': frameIcon(16, 9),
  '3:4': frameIcon(10.5, 14),
  '4:3': frameIcon(14, 10.5),
  '3:2': frameIcon(15, 10),
  '2:3': frameIcon(10, 15),
  '5:4': frameIcon(13.5, 10.8),
  '4:5': frameIcon(10.8, 13.5),
  '21:9': frameIcon(18, 7.5),
  '9:21': frameIcon(7.5, 18)
}

export function imageAspectRatioIcon(ratio: string): string {
  return RATIO_ICON_MAP[ratio] ?? frameIcon(12, 12)
}
