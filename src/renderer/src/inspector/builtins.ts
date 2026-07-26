import AssetInspector from '../components/AssetInspector.vue'
import GraphGroupInspector from '../components/GraphGroupInspector.vue'
import GraphOutputInspector from '../components/GraphOutputInspector.vue'
import MultiAngleInspector from '../components/MultiAngleInspector.vue'
import LightingInspector from '../components/LightingInspector.vue'
import PortraitTextureInspector from '../components/PortraitTextureInspector.vue'
import EmotionInspector from '../components/EmotionInspector.vue'
import UpscaleInspector from '../components/UpscaleInspector.vue'
import LipSyncInspector from '../components/LipSyncInspector.vue'
import ExpandInspector from '../components/ExpandInspector.vue'
import RedrawInspector from '../components/RedrawInspector.vue'
import EraseInspector from '../components/EraseInspector.vue'
import MatteInspector from '../components/MatteInspector.vue'
import CropInspector from '../components/CropInspector.vue'
import GridSplitInspector from '../components/GridSplitInspector.vue'
import PromptOptimizeInspector from '../components/PromptOptimizeInspector.vue'
import TablePassThroughInspector from '../components/TablePassThroughInspector.vue'
import NarrativeOutputInspector from '../components/NarrativeOutputInspector.vue'
import ProjectGlobalsInspector from '../components/ProjectGlobalsInspector.vue'
import ShotParamsInspector from '../components/ShotParamsInspector.vue'
import ShotInspector from '../components/ShotInspector.vue'
import ShotNodeInspector from '../components/ShotNodeInspector.vue'
import ShotNoteInspector from '../components/ShotNoteInspector.vue'
import DirectorCameraInspector from '../components/DirectorCameraInspector.vue'
import DirectorStageInspector from '../components/DirectorStageInspector.vue'
import type { InspectorDefinition } from './types'
import type { ProjectConfig } from '@shared/domain'

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
    id: 'studio.shot',
    component: ShotInspector,
    match: (target) => target.kind === 'shot',
    props: (context) => ({
      exportCanvas: context.exportCanvas,
      compact: context.useGraphRefs
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
    id: 'studio.graph.shotSplit',
    component: PromptOptimizeInspector,
    nodeTypeId: 'script.shotSplit'
  },
  {
    id: 'studio.graph.worldExtract',
    component: PromptOptimizeInspector,
    nodeTypeId: 'world.extract'
  },
  {
    id: 'studio.graph.narrativeSplit',
    component: PromptOptimizeInspector,
    nodeTypeId: 'narrative.split'
  },
  {
    id: 'studio.graph.narrativeTable',
    component: TablePassThroughInspector,
    nodeTypeId: 'narrative.table'
  },
  {
    id: 'studio.graph.narrativeOutput',
    component: NarrativeOutputInspector,
    nodeTypeId: 'output.narrative'
  },
  {
    id: 'studio.graph.shotTable',
    component: TablePassThroughInspector,
    nodeTypeId: 'script.shotTable'
  },
  {
    id: 'studio.graph.shotImageGen',
    component: TablePassThroughInspector,
    nodeTypeId: 'script.shotImageGen'
  },
  {
    id: 'studio.graph.shotVideoGen',
    component: TablePassThroughInspector,
    nodeTypeId: 'script.shotVideoGen'
  },
  {
    id: 'studio.graph.worldTable',
    component: TablePassThroughInspector,
    nodeTypeId: 'world.table'
  },
  {
    id: 'studio.graph.shotParams',
    component: ShotParamsInspector,
    nodeTypeId: 'script.shotParams'
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
