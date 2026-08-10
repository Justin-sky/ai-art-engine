import AssetInspector from '../components/AssetInspector.vue'
import GraphGroupInspector from '../components/GraphGroupInspector.vue'
import GraphOutputInspector from '../components/GraphOutputInspector.vue'
import MultiAngleInspector from '../components/MultiAngleInspector.vue'
import LightingInspector from '../components/LightingInspector.vue'
import PortraitTextureInspector from '../components/PortraitTextureInspector.vue'
import EmotionInspector from '../components/EmotionInspector.vue'
import UpscaleInspector from '../components/UpscaleInspector.vue'
import FramePullInspector from '../components/FramePullInspector.vue'
import ReshootInspector from '../components/ReshootInspector.vue'
import LipSyncInspector from '../components/LipSyncInspector.vue'
import ExpandInspector from '../components/ExpandInspector.vue'
import RedrawInspector from '../components/RedrawInspector.vue'
import EraseInspector from '../components/EraseInspector.vue'
import MatteInspector from '../components/MatteInspector.vue'
import CropInspector from '../components/CropInspector.vue'
import SelectNodeInspector from '../components/SelectNodeInspector.vue'
import EpisodeSelectInspector from '../components/EpisodeSelectInspector.vue'
import GridSplitInspector from '../components/GridSplitInspector.vue'
import PromptOptimizeInspector from '../components/PromptOptimizeInspector.vue'
import Anim2dInspector from '../components/Anim2dInspector.vue'
import FrameAnimGenInspector from '../components/FrameAnimGenInspector.vue'
import TablePassThroughInspector from '../components/TablePassThroughInspector.vue'
import BeatInspector from '../components/BeatInspector.vue'
import ProjectGlobalsInspector from '../components/ProjectGlobalsInspector.vue'
import ShotNodeInspector from '../components/ShotNodeInspector.vue'
import ShotNoteInspector from '../components/ShotNoteInspector.vue'
import DirectorCameraInspector from '../components/DirectorCameraInspector.vue'
import DirectorStageInspector from '../components/DirectorStageInspector.vue'
import GraphHostInspector from '../components/GraphHostInspector.vue'
import type { InspectorDefinition } from './types'
import type { ProjectConfig } from '@shared/domain'
import { readBoundBeatIdFromNodeParams, isAssetRefInputHostType, type GraphNode } from '@shared/graph'

function isStageInspectorTarget(kind: string): boolean {
  return (
    kind === 'stage.object' ||
    kind === 'stage.camera' ||
    kind === 'stage.scene' ||
    kind === 'stage.panorama'
  )
}

export const BUILTIN_INSPECTORS: InspectorDefinition[] = [
  {
    id: 'studio.project',
    component: ProjectGlobalsInspector,
    match: (target) => target.kind === 'project',
    props: (context) => ({
      config: (context.target.subject as ProjectConfig | null) ?? null
    })
  },
  {
    id: 'studio.beatUnit',
    component: BeatInspector,
    match: (target) => target.kind === 'beatUnit',
    props: (context) => ({
      beatAssetId:
        (context.target.meta?.beatAssetId as string | undefined) ?? undefined
    })
  },
  {
    id: 'studio.asset',
    component: AssetInspector,
    match: (target) => target.kind === 'asset'
  },
  {
    id: 'studio.stage',
    order: 10,
    component: DirectorStageInspector,
    match: (target) => isStageInspectorTarget(target.kind),
    props: () => ({ embedded: true })
  },
  {
    id: 'studio.graph.assetRef',
    order: 5,
    component: AssetInspector,
    nodeInspectorKind: 'asset',
    nodeAssetRef: true
  },
  {
    id: 'studio.graph.host',
    order: 4,
    component: GraphHostInspector,
    match: (target) => {
      if (target.kind !== 'graph.node') return false
      const node = target.subject as GraphNode | null
      return (
        !!node &&
        node.params?.assetHost === true &&
        isAssetRefInputHostType(node.assetType)
      )
    }
  },
  {
    id: 'studio.graph.asset',
    component: ShotNodeInspector,
    nodeInspectorKind: 'asset',
    nodeAssetRef: false
  },
  {
    id: 'studio.graph.output',
    component: GraphOutputInspector,
    nodeInspectorKind: 'output'
  },
  {
    id: 'studio.graph.note',
    component: ShotNoteInspector,
    nodeInspectorKind: 'note'
  },
  {
    id: 'studio.graph.promptOptimize',
    component: PromptOptimizeInspector,
    nodeTypeId: 'prompt.optimize'
  },
  {
    id: 'studio.graph.imageToPrompt',
    component: PromptOptimizeInspector,
    nodeTypeId: 'image.toPrompt'
  },
  {
    id: 'studio.graph.worldExtract',
    component: PromptOptimizeInspector,
    nodeTypeId: 'world.extract'
  },
  {
    id: 'studio.graph.beatSplit',
    component: PromptOptimizeInspector,
    nodeTypeId: 'beat.split'
  },
  {
    id: 'studio.graph.uiSplit',
    component: PromptOptimizeInspector,
    nodeTypeId: 'ui.split'
  },
  {
    id: 'studio.graph.anim2d',
    component: Anim2dInspector,
    nodeTypeId: 'anim.2d'
  },
  {
    id: 'studio.graph.frameAnimGen',
    component: FrameAnimGenInspector,
    nodeTypeId: 'frame.animGen'
  },
  {
    id: 'studio.graph.beatUnitGen',
    component: PromptOptimizeInspector,
    nodeTypeId: 'beat.unitGen'
  },
  {
    id: 'studio.graph.beatTable',
    component: TablePassThroughInspector,
    nodeTypeId: 'beat.table'
  },
  {
    id: 'studio.graph.beatGen',
    component: TablePassThroughInspector,
    nodeTypeId: 'beat.gen'
  },
  {
    id: 'studio.graph.beatUnitRef',
    component: BeatInspector,
    nodeTypeId: 'beat.unitRef',
    props: (context) => {
      const node = context.target.subject as GraphNode | null
      return {
        beatId: readBoundBeatIdFromNodeParams(node?.params)
      }
    }
  },
  {
    id: 'studio.graph.worldTable',
    component: TablePassThroughInspector,
    nodeTypeId: 'world.table'
  },
  {
    id: 'studio.graph.worldGen',
    component: TablePassThroughInspector,
    nodeTypeId: 'world.gen'
  },
  {
    id: 'studio.graph.multiAngle',
    component: MultiAngleInspector,
    nodeTypeId: 'image.multiAngle'
  },
  {
    id: 'studio.graph.lighting',
    component: LightingInspector,
    nodeTypeId: 'image.lighting'
  },
  {
    id: 'studio.graph.portraitTexture',
    component: PortraitTextureInspector,
    nodeTypeId: 'image.portraitTexture'
  },
  {
    id: 'studio.graph.emotion',
    component: EmotionInspector,
    nodeTypeId: 'image.emotion'
  },
  {
    id: 'studio.graph.upscale',
    component: UpscaleInspector,
    nodeTypeId: 'image.upscale'
  },
  {
    id: 'studio.graph.framePull',
    component: FramePullInspector,
    nodeTypeId: 'video.framePull'
  },
  {
    id: 'studio.graph.reshoot',
    component: ReshootInspector,
    nodeTypeId: 'video.reshoot'
  },
  {
    id: 'studio.graph.lipSync',
    component: LipSyncInspector,
    nodeTypeId: 'video.lipSync'
  },
  {
    id: 'studio.graph.expand',
    component: ExpandInspector,
    nodeTypeId: 'image.expand'
  },
  {
    id: 'studio.graph.redraw',
    component: RedrawInspector,
    nodeTypeId: 'image.redraw'
  },
  {
    id: 'studio.graph.erase',
    component: EraseInspector,
    nodeTypeId: 'image.erase'
  },
  {
    id: 'studio.graph.matte',
    component: MatteInspector,
    nodeTypeId: 'image.matte'
  },
  {
    id: 'studio.graph.crop',
    component: CropInspector,
    nodeTypeId: 'image.crop'
  },
  {
    id: 'studio.graph.select',
    component: SelectNodeInspector,
    match: (target) => {
      if (target.kind !== 'graph.node') return false
      const typeId = (target.subject as GraphNode | null)?.typeId
      return (
        typeId === 'image.select' ||
        typeId === 'video.select' ||
        typeId === 'voice.select' ||
        typeId === 'text.select' ||
        typeId === 'beat.select'
      )
    }
  },
  {
    id: 'studio.graph.episodeAnchorSelect',
    component: EpisodeSelectInspector,
    nodeTypeId: 'episode.anchorSelect'
  },
  {
    id: 'studio.graph.episodeCellSelect',
    component: EpisodeSelectInspector,
    nodeTypeId: 'episode.cellSelect'
  },
  {
    id: 'studio.graph.gridSplit',
    component: GridSplitInspector,
    nodeTypeId: 'image.gridSplit'
  },
  {
    id: 'studio.graph.camera',
    component: DirectorCameraInspector,
    nodeInspectorKind: 'camera'
  },
  {
    id: 'studio.graph.group',
    component: GraphGroupInspector,
    match: (target) => target.kind === 'graph.group'
  }
]
