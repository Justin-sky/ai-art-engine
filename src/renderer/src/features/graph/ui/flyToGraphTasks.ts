/** 从起点飞入「任务列表」工具栏按钮的入队动画 */

const FLY_MS = 1500
const PULSE_MS = 480

function centerOf(el: DOMRectReadOnly): { x: number; y: number } {
  return { x: el.left + el.width / 2, y: el.top + el.height / 2 }
}

export async function playFlyToGraphTasks(
  from: HTMLElement | DOMRectReadOnly,
  label?: string
): Promise<void> {
  const anchor = document.querySelector<HTMLElement>('[data-graph-task-anchor]')
  if (!anchor || typeof document === 'undefined') return

  const fromRect = from instanceof HTMLElement ? from.getBoundingClientRect() : from
  const toRect = anchor.getBoundingClientRect()
  const start = centerOf(fromRect)
  const end = centerOf(toRect)

  const flyer = document.createElement('div')
  flyer.className = 'graph-task-flyer'
  flyer.setAttribute('aria-hidden', 'true')
  if (label?.trim()) {
    flyer.textContent = label.trim()
  } else {
    flyer.innerHTML =
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M3.5 6.5h10M3.5 12h10M3.5 17.5h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M15 9.5v9l7.5-4.5z"/></svg>'
  }

  const size = label?.trim() ? null : 28
  Object.assign(flyer.style, {
    position: 'fixed',
    left: `${start.x}px`,
    top: `${start.y}px`,
    transform: 'translate(-50%, -50%) scale(1)',
    zIndex: '4000',
    pointerEvents: 'none',
    ...(size
      ? {
          width: `${size}px`,
          height: `${size}px`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }
      : {})
  })
  document.body.appendChild(flyer)

  const dx = end.x - start.x
  const dy = end.y - start.y
  const midX = dx * 0.45
  const midY = dy * 0.45 - Math.min(120, Math.abs(dy) * 0.35 + 48)

  const animation = flyer.animate(
    [
      {
        transform: 'translate(-50%, -50%) scale(1)',
        opacity: 1,
        offset: 0
      },
      {
        transform: `translate(calc(-50% + ${midX}px), calc(-50% + ${midY}px)) scale(1.08)`,
        opacity: 1,
        offset: 0.45
      },
      {
        transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.35)`,
        opacity: 0.15,
        offset: 1
      }
    ],
    {
      duration: FLY_MS,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      fill: 'forwards'
    }
  )

  try {
    await animation.finished
  } catch {
    /* aborted */
  }
  flyer.remove()

  anchor.classList.remove('graph-task-anchor-pulse')
  // reflow so animation can replay
  void anchor.offsetWidth
  anchor.classList.add('graph-task-anchor-pulse')
  window.setTimeout(() => {
    anchor.classList.remove('graph-task-anchor-pulse')
  }, PULSE_MS)
}
