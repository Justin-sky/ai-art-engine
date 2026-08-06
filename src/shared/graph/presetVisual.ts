/**
 * 提示词 / 调度预设的可视化元数据。
 * 文字仍是 SSOT；visual 仅用于选择器示意，可缺省并由 resolve* 推断。
 */

export type PresetShotSize =
  | 'extremeWide'
  | 'wide'
  | 'full'
  | 'medium'
  | 'mediumClose'
  | 'close'
  | 'extremeClose'

export type PresetCameraMotion =
  | 'dolly'
  | 'pan'
  | 'tilt'
  | 'orbit'
  | 'crane'
  | 'follow'
  | 'static'
  | 'dutch'
  | 'handheld'
  | 'combo'

export type PresetFacing =
  | 'front'
  | 'threeQuarter'
  | 'profile'
  | 'backThreeQuarter'
  | 'back'

export type PresetLighting =
  | 'top'
  | 'side'
  | 'rembrandt'
  | 'volumetric'
  | 'backlight'
  | 'practical'

export type PresetMood =
  | 'anger'
  | 'dazed'
  | 'manic'
  | 'relief'
  | 'anxiety'
  | 'grief'
  | 'confidence'
  | 'surprise'

export type PresetVisualKind =
  | 'shotSize'
  | 'camera'
  | 'facing'
  | 'lighting'
  | 'mood'
  | 'grid'
  | 'chips'
  | 'icon'

export interface PresetVisual {
  kind: PresetVisualKind
  shotSize?: PresetShotSize
  camera?: PresetCameraMotion
  facing?: PresetFacing
  lighting?: PresetLighting
  mood?: PresetMood
  grid?: { cols: number; rows: number }
  /** i18n keys or short plain labels */
  chips?: string[]
  icon?: string
}

const SHOT_SIZE_FROM_LABEL: Record<string, PresetShotSize> = {
  大远景: 'extremeWide',
  远景: 'wide',
  全景: 'full',
  中远景: 'medium',
  中景: 'medium',
  半身景: 'mediumClose',
  近景: 'close',
  特写: 'close',
  大特写: 'extremeClose'
}

export function shotSizeFromLabel(label?: string | null): PresetShotSize | undefined {
  if (!label) return undefined
  return SHOT_SIZE_FROM_LABEL[label.trim()]
}

export function resolveShotStagingVisual(input: {
  id: string
  group: string
  shotSize?: string
  visual?: PresetVisual
}): PresetVisual {
  if (input.visual) return input.visual

  const id = input.id
  if (id.startsWith('facing.')) {
    const facing = id.slice('facing.'.length) as PresetFacing
    return { kind: 'facing', facing, shotSize: shotSizeFromLabel(input.shotSize) }
  }
  if (id.startsWith('lighting.')) {
    const lighting = id.slice('lighting.'.length) as PresetLighting
    return { kind: 'lighting', lighting }
  }
  if (id.startsWith('performance.')) {
    const mood = id.slice('performance.'.length) as PresetMood
    return { kind: 'mood', mood }
  }
  if (id.startsWith('advertising.')) {
    const camera =
      id.includes('orbit') || id.includes('motion')
        ? 'orbit'
        : id.includes('dissolve') || id.includes('match')
          ? 'static'
          : id.includes('jump')
            ? 'static'
            : id.includes('flash')
              ? 'pan'
              : 'dolly'
    return {
      kind: 'camera',
      camera,
      shotSize: shotSizeFromLabel(input.shotSize),
      icon: id.includes('product') ? '📦' : undefined
    }
  }

  const camera: PresetCameraMotion =
    id.includes('dutch')
      ? 'dutch'
      : id.includes('overShoulder') || id.includes('twoShot')
        ? 'static'
        : id.includes('highEmotion')
          ? 'crane'
          : id.includes('backEmotion')
            ? 'follow'
            : id.includes('mysterious')
              ? 'handheld'
              : id.includes('hero')
                ? 'tilt'
                : 'dolly'

  return {
    kind: 'shotSize',
    shotSize: shotSizeFromLabel(input.shotSize) ?? 'medium',
    camera
  }
}

export function resolveInstructionVisual(input: {
  id: string
  visual?: PresetVisual
}): PresetVisual {
  if (input.visual) return input.visual
  const id = input.id

  if (id.includes('multiAngle9')) return { kind: 'grid', grid: { cols: 3, rows: 3 } }
  if (id.includes('styleTransfer')) return { kind: 'icon', icon: '🎨' }
  if (id.includes('story4')) return { kind: 'grid', grid: { cols: 2, rows: 2 } }
  if (id.includes('story25')) return { kind: 'grid', grid: { cols: 5, rows: 5 } }
  if (id.includes('Turnaround') || id.includes('turnaround')) {
    return { kind: 'chips', chips: ['正', '侧', '背'] }
  }
  if (id.includes('Sheet') || id.includes('sheet')) {
    return { kind: 'grid', grid: { cols: 3, rows: 2 } }
  }
  if (id.includes('panorama')) return { kind: 'icon', icon: '🌐' }
  if (id.includes('cinematicLighting')) return { kind: 'lighting', lighting: 'volumetric' }
  if (id.includes('physics')) return { kind: 'icon', icon: '⏱' }
  if (id.includes('shotDetail')) return { kind: 'shotSize', shotSize: 'extremeClose' }
  if (id.includes('shotEstablish')) return { kind: 'shotSize', shotSize: 'wide' }
  if (id.includes('shotConfrontation')) return { kind: 'shotSize', shotSize: 'full', camera: 'static' }

  if (id.includes('firstLastFrame')) return { kind: 'chips', chips: ['首', '尾'] }
  if (id.includes('cameraDolly')) return { kind: 'camera', camera: 'dolly' }
  if (id.includes('cameraPanTilt')) return { kind: 'camera', camera: 'pan' }
  if (id.includes('cameraOrbit')) return { kind: 'camera', camera: 'orbit' }
  if (id.includes('cameraCrane')) return { kind: 'camera', camera: 'crane' }
  if (id.includes('cameraFollow')) return { kind: 'camera', camera: 'follow' }
  if (id.includes('cameraCombo')) return { kind: 'camera', camera: 'combo' }
  if (id.includes('textToVideo')) return { kind: 'icon', icon: '✦' }
  if (id.includes('multimodal')) return { kind: 'icon', icon: '⧉' }
  if (id.includes('poseStandingFront')) return { kind: 'facing', facing: 'front', shotSize: 'mediumClose' }
  if (id.includes('poseThreeQuarter')) return { kind: 'facing', facing: 'threeQuarter', shotSize: 'mediumClose' }
  if (id.includes('poseProfile')) return { kind: 'facing', facing: 'profile', shotSize: 'close' }
  if (id.includes('poseBack')) return { kind: 'facing', facing: 'back', shotSize: 'medium' }
  if (id.includes('poseLookBack')) return { kind: 'facing', facing: 'backThreeQuarter', shotSize: 'mediumClose' }
  if (id.includes('poseWalk') || id.includes('poseRun')) {
    return { kind: 'camera', camera: 'follow', shotSize: 'medium' }
  }
  if (id.includes('poseSit') || id.includes('poseHandsOnHips')) {
    return { kind: 'shotSize', shotSize: 'mediumClose', camera: 'static' }
  }

  if (id.startsWith('screenplay.')) {
    return {
      kind: 'chips',
      chips: [
        'graph.inspector.generate.presets.visualChip.genre',
        'graph.inspector.generate.presets.visualChip.cast',
        'graph.inspector.generate.presets.visualChip.hook'
      ]
    }
  }
  if (id.startsWith('world.') || id.includes('worldExtract')) {
    return { kind: 'chips', chips: ['角', '景', '道'] }
  }
  if (id.startsWith('beat.') || id.includes('beat')) {
    return { kind: 'chips', chips: ['节', '拍', '钩'] }
  }
  if (id.includes('toPrompt.game')) {
    return { kind: 'icon', icon: '🎮' }
  }
  if (id.includes('toPrompt.film')) {
    return { kind: 'icon', icon: '🎬' }
  }
  if (id.includes('toPrompt')) {
    return { kind: 'icon', icon: '🔎' }
  }
  if (id.includes('optimize')) {
    return { kind: 'icon', icon: '✎' }
  }
  if (id.includes('lipSync')) return { kind: 'icon', icon: '👄' }

  return { kind: 'icon', icon: '✦' }
}
