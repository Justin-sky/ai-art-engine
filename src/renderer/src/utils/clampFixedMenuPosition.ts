/** 将固定定位菜单钳制在视口内，避免贴边时被裁切 */
export function clampFixedMenuPosition(
  preferredX: number,
  preferredY: number,
  width: number,
  height: number,
  margin = 8
): { x: number; y: number } {
  const maxX = Math.max(margin, window.innerWidth - width - margin)
  const maxY = Math.max(margin, window.innerHeight - height - margin)
  return {
    x: Math.min(Math.max(margin, preferredX), maxX),
    y: Math.min(Math.max(margin, preferredY), maxY)
  }
}

/** 测量已渲染菜单后，按点击锚点钳制到视口 */
export function placeFixedMenu(
  el: HTMLElement,
  preferredX: number,
  preferredY: number,
  margin = 8
): { x: number; y: number } {
  const rect = el.getBoundingClientRect()
  return clampFixedMenuPosition(preferredX, preferredY, rect.width, rect.height, margin)
}
