/** 一键工作流预设模板（文案走 i18n `aiWorkflow.presets.<id>.*`） */
export const AI_WORKFLOW_PRESET_IDS = [
  'gameUaVideo',
  'characterSheet',
  'storyboardVideo',
  'productAd',
  'shortDrama',
  'custom'
] as const

export type AiWorkflowPresetId = (typeof AI_WORKFLOW_PRESET_IDS)[number]

export const AI_WORKFLOW_MODEL_KEY = 'ai-art-engine.aiWorkflow.modelKey'
