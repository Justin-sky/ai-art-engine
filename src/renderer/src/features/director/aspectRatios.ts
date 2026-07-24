import type { DirectorAspectRatio } from '@shared/domain'
import { DIRECTOR_ASPECT_RATIOS } from '@shared/domain'

export interface DirectorAspectRatioOption {
  id: DirectorAspectRatio
  icon: string
}

function frameIcon(width: number, height: number): string {
  const x = (24 - width) / 2
  const y = (24 - height) / 2
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="1.2"/></svg>`
}

const AUTO_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="4.5" width="15" height="15" rx="1.5"/><path d="M7 9.5V7h2.5M17 9.5V7h-2.5M7 14.5V17h2.5M17 14.5V17h-2.5"/></svg>`

/** 画幅比例选项（图标接近参考图） */
export const DIRECTOR_ASPECT_RATIO_OPTIONS: DirectorAspectRatioOption[] = [
  { id: 'auto', icon: AUTO_ICON },
  { id: '21:9', icon: frameIcon(18, 7.5) },
  { id: '16:9', icon: frameIcon(16, 9) },
  { id: '4:3', icon: frameIcon(14, 10.5) },
  { id: '1:1', icon: frameIcon(12, 12) },
  { id: '3:4', icon: frameIcon(10.5, 14) },
  { id: '9:16', icon: frameIcon(9, 16) }
]

export function isDirectorAspectRatio(value: string): value is DirectorAspectRatio {
  return (DIRECTOR_ASPECT_RATIOS as readonly string[]).includes(value)
}
