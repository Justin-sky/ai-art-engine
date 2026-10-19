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
