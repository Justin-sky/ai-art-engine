/**
 * 保真度量 — 纯函数侧：根据已测得的指标判定等级是否达标。
 * 实际 PSNR/SSIM 由主进程 ffmpeg 测得后传入。
 */
import type { BuildQcResult, FidelityLevel } from './types'

export const L1_PSNR_MIN = 45
export const L1_SSIM_MIN = 0.99

export interface MeasuredMetrics {
  psnrOutsideMask?: number
  ssimOutsideMask?: number
  frameDelta?: number
  audioSampleMatch?: boolean
  durationMatch?: boolean
  visualReviewPassed?: boolean
}

export function evaluateFidelity(
  target: FidelityLevel,
  metrics: MeasuredMetrics,
  failedShotIds: string[] = []
): BuildQcResult {
  const notes: string[] = []
  let passed = true

  if (target === 'L0' || target === 'L1' || target === 'L2' || target === 'L3') {
    if (metrics.durationMatch === false) {
      passed = false
      notes.push('duration mismatch')
    }
    if (typeof metrics.frameDelta === 'number' && metrics.frameDelta > 1) {
      passed = false
      notes.push(`frame delta ${metrics.frameDelta}`)
    }
  }

  if (target === 'L1') {
    if (typeof metrics.psnrOutsideMask === 'number' && metrics.psnrOutsideMask < L1_PSNR_MIN) {
      passed = false
      notes.push(`PSNR ${metrics.psnrOutsideMask} < ${L1_PSNR_MIN}`)
    }
    if (typeof metrics.ssimOutsideMask === 'number' && metrics.ssimOutsideMask < L1_SSIM_MIN) {
      passed = false
      notes.push(`SSIM ${metrics.ssimOutsideMask} < ${L1_SSIM_MIN}`)
    }
    if (metrics.audioSampleMatch === false) {
      passed = false
      notes.push('audio sample mismatch')
    }
  }

  if (target === 'L2' && metrics.visualReviewPassed === false) {
    passed = false
    notes.push('visual review failed')
  }

  if (failedShotIds.length > 0) {
    passed = false
    notes.push(`failed shots: ${failedShotIds.join(',')}`)
  }

  return {
    level: target,
    passed,
    metrics: {
      psnrOutsideMask: metrics.psnrOutsideMask,
      ssimOutsideMask: metrics.ssimOutsideMask,
      frameDelta: metrics.frameDelta,
      audioSampleMatch: metrics.audioSampleMatch,
      durationMatch: metrics.durationMatch
    },
    failedShotIds: failedShotIds.length ? failedShotIds : undefined,
    notes: notes.length ? notes : undefined
  }
}
