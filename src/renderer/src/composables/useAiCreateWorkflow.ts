import { ref } from 'vue'
import {
  AI_WORKFLOW_MODEL_KEY,
  AI_WORKFLOW_PRESET_IDS,
  type AiWorkflowPresetId
} from '../features/aiWorkflow/presets'
import {
  loadGenerateModelOptions,
  parseModelKey,
  type GenerateModelOption
} from '../features/graph/model/generateModelOptions'
import { useProjectStore } from '../stores/project'
import { useAssetCreation } from './useAssetCreation'
import { promptAlert } from './useStudioPrompt'
import { useStudioI18n } from './useStudioI18n'

export function useAiCreateWorkflow() {
  const project = useProjectStore()
  const { openAssetEditor } = useAssetCreation()
  const { t } = useStudioI18n()
  const dialogOpen = ref(false)
  const generating = ref(false)
  const error = ref('')
  const draftPrompt = ref('')
  const selectedPresetId = ref<AiWorkflowPresetId | null>(null)
  const modelOptions = ref<GenerateModelOption[]>([])
  const modelKey = ref('')

  async function loadModelOptions(): Promise<void> {
    let preferred = ''
    try {
      preferred = localStorage.getItem(AI_WORKFLOW_MODEL_KEY) || ''
    } catch {
      preferred = ''
    }
    const loaded = await loadGenerateModelOptions('text', preferred || undefined)
    modelOptions.value = loaded.options
    modelKey.value = loaded.selectedKey
  }

  function persistModelKey(key: string): void {
    modelKey.value = key
    try {
      if (key) localStorage.setItem(AI_WORKFLOW_MODEL_KEY, key)
    } catch {
      /* ignore */
    }
  }

  function applyPreset(id: AiWorkflowPresetId): void {
    selectedPresetId.value = id
    if (id === 'custom') {
      draftPrompt.value = ''
      return
    }
    draftPrompt.value = t(`aiWorkflow.presets.${id}.prompt`)
  }

  function openDialog(initialPrompt = ''): void {
    draftPrompt.value = initialPrompt
    selectedPresetId.value = null
    error.value = ''
    dialogOpen.value = true
    void loadModelOptions()
  }

  function closeDialog(): void {
    if (generating.value) return
    dialogOpen.value = false
    error.value = ''
  }

  async function generate(folderId: string | null): Promise<boolean> {
    const prompt = draftPrompt.value.trim()
    if (!prompt) {
      error.value = t('aiWorkflow.emptyPrompt')
      return false
    }
    if (!project.isOpen) {
      error.value = t('aiWorkflow.needProject')
      return false
    }
    const parsed = parseModelKey(modelKey.value)
    if (!parsed) {
      error.value = t('aiWorkflow.needModel')
      return false
    }
    generating.value = true
    error.value = ''
    try {
      persistModelKey(modelKey.value)
      const result = await window.studio.generateAiWorkflow({
        prompt,
        folderId,
        model: parsed.model,
        providerInstanceId: parsed.providerInstanceId
      })
      if (!result.ok || !result.assetId) {
        error.value = result.error || t('aiWorkflow.failed')
        return false
      }
      await project.refreshAssets()
      const asset = project.assets.find((item) => item.id === result.assetId)
      if (asset) openAssetEditor(asset)
      dialogOpen.value = false
      draftPrompt.value = ''
      selectedPresetId.value = null
      if (result.warnings.length) {
        void promptAlert({
          title: t('aiWorkflow.createdWithWarnings'),
          message: result.warnings.slice(0, 8).join('\n')
        })
      }
      return true
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      return false
    } finally {
      generating.value = false
    }
  }

  return {
    dialogOpen,
    generating,
    error,
    draftPrompt,
    selectedPresetId,
    modelOptions,
    modelKey,
    presetIds: AI_WORKFLOW_PRESET_IDS,
    applyPreset,
    persistModelKey,
    openDialog,
    closeDialog,
    generate
  }
}
