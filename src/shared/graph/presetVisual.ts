/**
 * 提示词 / 调度预设的可视化元数据。
 * 文字仍是 SSOT；visual 仅用于选择器示意，可缺省并由 resolve* 推断。
 */

export type PresetShotSize =
  'extremeWide' | 'wide' | 'full' | 'medium' | 'mediumClose' | 'close' | 'extremeClose'

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

export type PresetFacing = 'front' | 'threeQuarter' | 'profile' | 'backThreeQuarter' | 'back'

export type PresetLighting = 'top' | 'side' | 'rembrandt' | 'volumetric' | 'backlight' | 'practical'

export type PresetMood =
  'anger' | 'dazed' | 'manic' | 'relief' | 'anxiety' | 'grief' | 'confidence' | 'surprise'

export type PresetVisualKind =
  'shotSize' | 'camera' | 'facing' | 'lighting' | 'mood' | 'grid' | 'chips' | 'icon'

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
  /** Optional schematic diagram key (e.g. preset id or kind.id) for SVG rendering */
  diagram?: string
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

  const camera: PresetCameraMotion = id.includes('dutch')
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
  presetKind?: string | null
  visual?: PresetVisual
}): PresetVisual {
  if (input.visual) return input.visual
  const id = input.id
  const kind = input.presetKind ?? ''

  if (id.includes('multiAngle9')) return { kind: 'grid', grid: { cols: 3, rows: 3 } }
  if (id.includes('styleTransfer')) return { kind: 'icon', icon: '🎨', diagram: id }
  if (id.includes('story4')) return { kind: 'grid', grid: { cols: 2, rows: 2 }, diagram: id }
  if (id.includes('story25')) return { kind: 'grid', grid: { cols: 5, rows: 5 }, diagram: id }
  if (id.includes('Turnaround') || id.includes('turnaround')) {
    return { kind: 'chips', chips: ['F', 'S', 'B'], diagram: id }
  }
  if (id.includes('Sheet') || id.includes('sheet')) {
    return { kind: 'grid', grid: { cols: 3, rows: 2 }, diagram: id }
  }
  if (id.includes('panorama')) return { kind: 'icon', icon: '🌐', diagram: id }
  if (id.includes('cinematicLighting'))
    return { kind: 'lighting', lighting: 'volumetric', diagram: id }
  if (id.includes('physics')) return { kind: 'icon', icon: '⏱', diagram: id }
  if (id.includes('shotDetail')) return { kind: 'shotSize', shotSize: 'extremeClose', diagram: id }
  if (id.includes('shotEstablish')) return { kind: 'shotSize', shotSize: 'wide', diagram: id }
  if (id.includes('shotConfrontation'))
    return { kind: 'shotSize', shotSize: 'full', camera: 'static', diagram: id }

  if (id.includes('firstLastFrame')) return { kind: 'chips', chips: ['A', 'B'], diagram: id }
  if (id.includes('cameraDolly')) return { kind: 'camera', camera: 'dolly', diagram: id }
  if (id.includes('cameraPanTilt')) return { kind: 'camera', camera: 'pan', diagram: id }
  if (id.includes('cameraOrbit')) return { kind: 'camera', camera: 'orbit', diagram: id }
  if (id.includes('cameraCrane')) return { kind: 'camera', camera: 'crane', diagram: id }
  if (id.includes('cameraFollow')) return { kind: 'camera', camera: 'follow', diagram: id }
  if (id.includes('cameraCombo')) return { kind: 'camera', camera: 'combo', diagram: id }
  if (id.includes('textToVideo')) return { kind: 'icon', icon: '🎬', diagram: id }
  if (id.includes('multimodal')) return { kind: 'icon', icon: '⧉', diagram: id }
  if (id.includes('heroEntrance'))
    return { kind: 'camera', camera: 'tilt', shotSize: 'full', diagram: id }
  if (id.includes('performanceRealism')) return { kind: 'mood', mood: 'confidence', diagram: id }
  if (id.includes('framePairContinuity'))
    return { kind: 'chips', chips: ['A', '→', 'B'], diagram: id }
  if (id.includes('framePairProduct'))
    return { kind: 'camera', camera: 'dolly', shotSize: 'close', diagram: id }
  if (id.includes('framePairTransition'))
    return { kind: 'chips', chips: ['A', '≈', 'B'], diagram: id }
  if (id.startsWith('video.transition')) return { kind: 'camera', camera: 'pan', diagram: id }

  if (id.includes('poseStandingFront'))
    return { kind: 'facing', facing: 'front', shotSize: 'mediumClose', diagram: id }
  if (id.includes('poseThreeQuarter'))
    return { kind: 'facing', facing: 'threeQuarter', shotSize: 'mediumClose', diagram: id }
  if (id.includes('poseProfile'))
    return { kind: 'facing', facing: 'profile', shotSize: 'close', diagram: id }
  if (id.includes('poseBack'))
    return { kind: 'facing', facing: 'back', shotSize: 'medium', diagram: id }
  if (id.includes('poseLookBack'))
    return { kind: 'facing', facing: 'backThreeQuarter', shotSize: 'mediumClose', diagram: id }
  if (id.includes('poseWalk') || id.includes('poseRun')) {
    return { kind: 'camera', camera: 'follow', shotSize: 'medium', diagram: id }
  }
  if (id.includes('poseSit') || id.includes('poseHandsOnHips')) {
    return { kind: 'shotSize', shotSize: 'mediumClose', camera: 'static', diagram: id }
  }

  if (id.startsWith('screenplay.')) {
    return {
      kind: 'chips',
      chips: [
        'graph.inspector.generate.presets.visualChip.genre',
        'graph.inspector.generate.presets.visualChip.cast',
        'graph.inspector.generate.presets.visualChip.hook'
      ],
      diagram: id
    }
  }
  if (id.startsWith('gameSystem.')) {
    return { kind: 'grid', grid: { cols: 2, rows: 2 }, diagram: id }
  }
  if (id.startsWith('reshoot.')) {
    return { kind: 'camera', camera: 'static', diagram: id }
  }
  if (id.startsWith('world.') || id.includes('spatialWorldExtract')) {
    return { kind: 'chips', chips: ['C', 'S', 'P'], diagram: id }
  }
  if (id.startsWith('beat.') || id.includes('beat')) {
    return { kind: 'chips', chips: ['B1', 'B2', 'B3'], diagram: id }
  }
  if (id.includes('toPrompt.game')) {
    return { kind: 'icon', icon: '🎮', diagram: id }
  }
  if (id.includes('toPrompt.film')) {
    return { kind: 'icon', icon: '🎬', diagram: id }
  }
  if (id.includes('toPrompt')) {
    return { kind: 'icon', icon: '🔎', diagram: id }
  }
  if (id.includes('optimize')) {
    return { kind: 'icon', icon: '✎', diagram: id }
  }
  if (id.includes('lipSync')) {
    return { kind: 'icon', icon: '👄', diagram: id }
  }
  if (id.startsWith('anim2d.')) {
    if (id === 'anim2d.dir4') return { kind: 'grid', grid: { cols: 4, rows: 1 }, diagram: id }
    if (id === 'anim2d.dir8') return { kind: 'grid', grid: { cols: 4, rows: 2 }, diagram: id }
    if (id === 'anim2d.walk4Dir') return { kind: 'grid', grid: { cols: 4, rows: 4 }, diagram: id }
    if (id === 'anim2d.expr6') return { kind: 'grid', grid: { cols: 3, rows: 2 }, diagram: id }
    if (id === 'anim2d.lipSync4' || id === 'anim2d.tileSeamless') {
      return { kind: 'grid', grid: { cols: 2, rows: 2 }, diagram: id }
    }
    if (id === 'anim2d.autotile3x3') {
      return { kind: 'grid', grid: { cols: 3, rows: 3 }, diagram: id }
    }
    return { kind: 'grid', grid: { cols: 4, rows: 1 }, diagram: id }
  }
  if (id.startsWith('wushu.')) {
    return { kind: 'camera', camera: 'follow', diagram: id }
  }
  if (id.startsWith('fx.')) {
    return { kind: 'lighting', lighting: 'volumetric', diagram: id }
  }
  if (
    kind === 'svgGen' ||
    id.startsWith('icon.') ||
    id.startsWith('ui.') ||
    id.startsWith('anim.') ||
    id.startsWith('illust.')
  ) {
    return { kind: 'icon', icon: '◈', diagram: `svgGen.${id}` }
  }
  if (kind === 'gameHtmlGen' || id.endsWith('.2d') || id.endsWith('.3d')) {
    return { kind: 'icon', icon: '🕹', diagram: `gameHtmlGen.${id}` }
  }
  if (kind === 'modelPose') {
    return { kind: 'facing', facing: 'front', diagram: `modelPose.${id}` }
  }
  if (kind === 'modelAnimation') {
    return { kind: 'camera', camera: 'follow', diagram: `modelAnimation.${id}` }
  }
  if (kind === 'modelSegment') {
    return { kind: 'grid', grid: { cols: 2, rows: 2 }, diagram: `modelSegment.${id}` }
  }
  if (kind === 'modelRetarget') {
    return { kind: 'camera', camera: 'follow', diagram: `modelRetarget.${id}` }
  }
  if (kind === 'modelTexture') {
    return { kind: 'lighting', lighting: 'rembrandt', diagram: `modelTexture.${id}` }
  }
  if (kind === 'modelRigSkin') {
    return { kind: 'facing', facing: 'front', diagram: `modelRigSkin.${id}` }
  }
  if (kind === 'spatialWorld') {
    return { kind: 'shotSize', shotSize: 'extremeWide', diagram: `spatialWorld.${id}` }
  }
  if (kind === 'semanticCompile') {
    return { kind: 'shotSize', shotSize: 'medium', diagram: `semanticCompile.${id}` }
  }

  return { kind: 'icon', icon: '✦', diagram: kind ? `${kind}.${id}` : id }
}
