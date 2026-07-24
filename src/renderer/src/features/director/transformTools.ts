import type { TransformMode } from '@shared/domain'

export interface DirectorTransformTool {
  mode: TransformMode
  labelKey: string
  icon: string
}

/** Unity 场景视图风格的变换工具图标 */
export const DIRECTOR_TRANSFORM_TOOLS: DirectorTransformTool[] = [
  {
    mode: 'translate',
    labelKey: 'director.transform.translate',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18M3 12h18"/><path d="M12 3l-2.4 2.6M12 3l2.4 2.6M12 21l-2.4-2.6M12 21l2.4-2.6M3 12l2.6-2.4M3 12l2.6 2.4M21 12l-2.6-2.4M21 12l-2.6 2.4"/></svg>`
  },
  {
    mode: 'rotate',
    labelKey: 'director.transform.rotate',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v3.2h-3.2"/></svg>`
  },
  {
    mode: 'scale',
    labelKey: 'director.transform.scale',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 18L18 6"/><rect x="3.4" y="15.4" width="4.2" height="4.2" rx="0.6" fill="currentColor" stroke="none"/><rect x="16.4" y="4.4" width="4.2" height="4.2" rx="0.6" fill="currentColor" stroke="none"/></svg>`
  }
]
