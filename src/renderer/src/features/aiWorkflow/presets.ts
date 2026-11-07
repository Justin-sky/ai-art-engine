import type { GraphPlan } from '@shared/graph'

export type AiWorkflowPresetId = string

export interface AiWorkflowPresetOption {
  id: AiWorkflowPresetId
  title: string
  desc: string
}

export const AI_WORKFLOW_MODEL_KEY = 'ai-art-engine.aiWorkflow.modelKey'
export const AI_WORKFLOW_IMAGE_MODEL_KEY = 'ai-art-engine.aiWorkflow.imageModelKey'
export const AI_WORKFLOW_VIDEO_MODEL_KEY = 'ai-art-engine.aiWorkflow.videoModelKey'
export const AI_WORKFLOW_ASPECT_RATIO_KEY = 'ai-art-engine.aiWorkflow.generateAspectRatio'

export const BUILTIN_VIDEO_BREAKDOWN_REMAKE_PRESET_ID = 'builtin.video-breakdown-remake'

export function buildVideoBreakdownRemakeSeedPlan(title: string): GraphPlan {
  return {
    title,
    nodes: [
      {
        key: 'breakdown',
        typeId: 'semantic.analyze',
        params: {
          semanticLlm: true,
          semanticTranscribe: true,
          semanticSeparateAudio: true,
          semanticDetectEntities: true
        }
      },
      {
        key: 'remake',
        typeId: 'semantic.rebuild',
        params: {
          remakeStrategy: 'fidelity',
          semanticExecute: true,
          rebuildMaxShots: 24,
          rebuildRenderCompare: true
        }
      }
    ],
    edges: [{ from: 'breakdown', fromPort: 'out', to: 'remake', toPort: 'in' }]
  }
}
