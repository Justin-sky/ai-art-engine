import { shallowRef, ref } from 'vue'
import type { GraphPlan } from '@shared/graph'
import {
  AI_WORKFLOW_IMAGE_MODEL_KEY,
  AI_WORKFLOW_MODEL_KEY,
  AI_WORKFLOW_PRESET_IDS,
  AI_WORKFLOW_VIDEO_MODEL_KEY,
  getAiWorkflowPresetPlan,
  hasAiWorkflowPresetPlan,
  type AiWorkflowPresetId
} from '../features/aiWorkflow/presets'
import {
  loadGenerateModelOptions,
  parseModelKey,
  type GenerateModelOption
} from '../features/graph/model/generateModelOptions'
import { toPlain } from '../utils/toPlain'
import { useGraphRunLogsStore } from '../stores/graphRunLogs'
import { useProjectStore } from '../stores/project'
import { useAssetCreation } from './useAssetCreation'
import { promptAlert } from './useStudioPrompt'
import { useStudioI18n } from './useStudioI18n'

const AI_WORKFLOW_PLAN_LOG_NODE_ID = 'aiWorkflow.plan'

export interface AiWorkflowPreview {
  title: string
  nodes: Array<{ key: string; typeId: string; title: string }>
  edges: Array<{ from: string; to: string }>
}

function readStoredKey(storageKey: string): string {
  try {
    return localStorage.getItem(storageKey) || ''
  } catch {
    return ''
  }
}

function writeStoredKey(storageKey: string, value: string): void {
  try {
    if (value) localStorage.setItem(storageKey, value)
  } catch {
    /* ignore */
  }
}

export function useAiCreateWorkflow() {
  const project = useProjectStore()
  const runLogs = useGraphRunLogsStore()
  const { openAssetEditor } = useAssetCreation()
  const { t } = useStudioI18n()
  const dialogOpen = ref(false)
  const generating = ref(false)
  const committing = ref(false)
  const error = ref('')
  const draftPrompt = ref('')
  const selectedPresetId = ref<AiWorkflowPresetId | null>(null)
  const textModelOptions = ref<GenerateModelOption[]>([])
  const imageModelOptions = ref<GenerateModelOption[]>([])
  const videoModelOptions = ref<GenerateModelOption[]>([])
  const textModelKey = ref('')
  const imageModelKey = ref('')
  const videoModelKey = ref('')
  /** shallow：避免 Vue Proxy 经 IPC structuredClone 失败 */
  const pendingPlan = shallowRef<GraphPlan | null>(null)
  const preview = ref<AiWorkflowPreview | null>(null)
  const previewWarnings = ref<string[]>([])
  const saveDialogOpen = ref(false)
  const saveDefaultName = ref('')
  const saveDefaultFolderId = ref<string | null>(null)

  async function loadModelOptions(): Promise<void> {
    const [text, image, video] = await Promise.all([
      loadGenerateModelOptions('text', readStoredKey(AI_WORKFLOW_MODEL_KEY) || undefined),
      loadGenerateModelOptions('image', readStoredKey(AI_WORKFLOW_IMAGE_MODEL_KEY) || undefined),
      loadGenerateModelOptions('video', readStoredKey(AI_WORKFLOW_VIDEO_MODEL_KEY) || undefined)
    ])
    textModelOptions.value = text.options
    textModelKey.value = text.selectedKey
    imageModelOptions.value = image.options
    imageModelKey.value = image.selectedKey
    videoModelOptions.value = video.options
    videoModelKey.value = video.selectedKey
  }

  function persistModelKeys(): void {
    writeStoredKey(AI_WORKFLOW_MODEL_KEY, textModelKey.value)
    writeStoredKey(AI_WORKFLOW_IMAGE_MODEL_KEY, imageModelKey.value)
    writeStoredKey(AI_WORKFLOW_VIDEO_MODEL_KEY, videoModelKey.value)
  }

  function setTextModelKey(key: string): void {
    textModelKey.value = key
    writeStoredKey(AI_WORKFLOW_MODEL_KEY, key)
  }

  function setImageModelKey(key: string): void {
    imageModelKey.value = key
    writeStoredKey(AI_WORKFLOW_IMAGE_MODEL_KEY, key)
  }

  function setVideoModelKey(key: string): void {
    videoModelKey.value = key
    writeStoredKey(AI_WORKFLOW_VIDEO_MODEL_KEY, key)
  }

  function clearPreview(): void {
    pendingPlan.value = null
    preview.value = null
    previewWarnings.value = []
  }

  function applyPreset(id: AiWorkflowPresetId): void {
    selectedPresetId.value = id
    clearPreview()
    if (id === 'custom') {
      draftPrompt.value = ''
      return
    }
    draftPrompt.value = t(`aiWorkflow.presets.${id}.prompt`)
  }

  function mediaModelPayload() {
    const image = parseModelKey(imageModelKey.value)
    const video = parseModelKey(videoModelKey.value)
    return {
      imageModel: image?.model,
      imageProviderInstanceId: image?.providerInstanceId,
      videoModel: video?.model,
      videoProviderInstanceId: video?.providerInstanceId
    }
  }

  function openDialog(initialPrompt = ''): void {
    draftPrompt.value = initialPrompt
    selectedPresetId.value = null
    error.value = ''
    saveDialogOpen.value = false
    clearPreview()
    dialogOpen.value = true
    void loadModelOptions()
  }

  function closeDialog(): void {
    if (generating.value || committing.value || saveDialogOpen.value) return
    dialogOpen.value = false
    error.value = ''
    clearPreview()
  }

  async function planPreview(mode: 'ai' | 'seed'): Promise<boolean> {
    if (!project.isOpen) {
      error.value = t('aiWorkflow.needProject')
      return false
    }
    const prompt = draftPrompt.value.trim()
    const presetId = selectedPresetId.value
    const hasSeed = presetId != null && hasAiWorkflowPresetPlan(presetId)

    if (mode === 'seed') {
      if (!hasSeed) {
        error.value = t('aiWorkflow.needPresetForSeed')
        return false
      }
    } else {
      if (!prompt && !hasSeed) {
        error.value = t('aiWorkflow.emptyPrompt')
        return false
      }
      if (!parseModelKey(textModelKey.value)) {
        error.value = t('aiWorkflow.needModel')
        return false
      }
    }

    generating.value = true
    error.value = ''
    clearPreview()

    const logAiCalls = mode === 'ai'
    const runId = logAiCalls ? `ai-workflow-plan-${crypto.randomUUID()}` : null
    const logTitle =
      hasSeed && presetId
        ? t('aiWorkflow.planLog.titlePreset', {
            name: t(`aiWorkflow.presets.${presetId}.title`)
          })
        : t('aiWorkflow.planLog.title')
    const nodeTitle = t('aiWorkflow.title')

    if (runId) {
      runLogs.beginRun({
        runId,
        title: logTitle,
        mode: 'task',
        targetNodeId: AI_WORKFLOW_PLAN_LOG_NODE_ID,
        targetNodeTitle: nodeTitle,
        message: t('aiWorkflow.planLog.start')
      })
    }

    const logMessage = (message: string, level: 'info' | 'warn' | 'error' = 'info'): void => {
      if (!runId) return
      runLogs.append({
        runId,
        level,
        kind: 'run_message',
        mode: 'task',
        nodeId: AI_WORKFLOW_PLAN_LOG_NODE_ID,
        nodeTitle,
        message,
        status: level === 'error' ? 'error' : 'done'
      })
    }

    try {
      persistModelKeys()
      const text = parseModelKey(textModelKey.value)
      const seedPlan = hasSeed && presetId ? getAiWorkflowPresetPlan(presetId) : null
      const result = await window.studio.planAiWorkflow(
        toPlain({
          prompt,
          presetId: hasSeed && presetId ? presetId : undefined,
          seedPlan: seedPlan ?? undefined,
          useSeedOnly: mode === 'seed',
          model: text?.model,
          providerInstanceId: text?.providerInstanceId,
          ...mediaModelPayload()
        })
      )

      const apiCalls = result.apiCalls ?? []
      for (let i = 0; i < apiCalls.length; i++) {
        const call = apiCalls[i]
        if (!runId || !call) continue
        logMessage(
          t('aiWorkflow.planLog.llmStart', {
            model: call.model || text?.model || '—',
            n: i + 1
          })
        )
        runLogs.appendApiCall(runId, {
          kind: 'generateText',
          nodeId: AI_WORKFLOW_PLAN_LOG_NODE_ID,
          durationMs: call.durationMs,
          ts: call.startedAt,
          request: {
            prompt: call.request.prompt,
            system: call.request.system,
            model: call.request.model || call.model,
            providerInstanceId: call.request.providerInstanceId
          },
          response: call.response
            ? {
                text: call.response.text,
                model: call.response.model || call.model
              }
            : undefined,
          error: call.error
        })
        if (call.error) {
          logMessage(t('aiWorkflow.planLog.llmError', { error: call.error }), 'error')
        } else {
          logMessage(
            t('aiWorkflow.planLog.llmDone', {
              chars: call.response?.text?.length ?? 0,
              model: call.response?.model || call.model
            })
          )
        }
      }

      if (!result.ok || !result.plan) {
        const msg = result.error || t('aiWorkflow.planFailed')
        error.value = msg
        if (runId) {
          logMessage(t('aiWorkflow.planLog.failed', { error: msg }), 'error')
          runLogs.endRun({ runId, status: 'error', message: msg })
        }
        return false
      }
      pendingPlan.value = toPlain(result.plan as GraphPlan)
      preview.value = result.preview
        ? {
            title: result.preview.title,
            nodes: result.preview.nodes,
            edges: result.preview.edges.map((e) => ({ from: e.from, to: e.to }))
          }
        : {
            title: result.title || 'AI Workflow',
            nodes: (result.plan.nodes || []).map((n) => ({
              key: n.key,
              typeId: n.typeId,
              title: n.title || n.key
            })),
            edges: (result.plan.edges || []).map((e) => ({ from: e.from, to: e.to }))
          }
      previewWarnings.value = result.warnings || []
      if (runId) {
        const doneMsg = t('aiWorkflow.planLog.done', {
          nodes: preview.value.nodes.length,
          edges: preview.value.edges.length
        })
        logMessage(doneMsg)
        runLogs.endRun({ runId, status: 'done', message: doneMsg })
      }
      return true
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      error.value = msg
      if (runId) {
        logMessage(t('aiWorkflow.planLog.failed', { error: msg }), 'error')
        runLogs.endRun({ runId, status: 'error', message: msg })
      }
      return false
    } finally {
      generating.value = false
    }
  }

  /** 创建前先弹出保存路径/名称对话框 */
  function requestCommit(): boolean {
    if (!pendingPlan.value) {
      error.value = t('aiWorkflow.needPreview')
      return false
    }
    if (!project.isOpen) {
      error.value = t('aiWorkflow.needProject')
      return false
    }
    error.value = ''
    saveDefaultName.value =
      preview.value?.title?.trim() ||
      pendingPlan.value.title?.trim() ||
      t('aiWorkflow.defaultName')
    saveDefaultFolderId.value = null
    saveDialogOpen.value = true
    return true
  }

  function closeSaveDialog(): void {
    if (committing.value) return
    saveDialogOpen.value = false
  }

  async function confirmCommit(payload: {
    name: string
    folderId: string | null
  }): Promise<boolean> {
    if (!pendingPlan.value) {
      error.value = t('aiWorkflow.needPreview')
      return false
    }
    if (!project.isOpen) {
      error.value = t('aiWorkflow.needProject')
      return false
    }
    const name = payload.name.trim()
    if (!name) {
      error.value = t('validation.nameRequired')
      return false
    }
    committing.value = true
    error.value = ''
    try {
      persistModelKeys()
      const result = await window.studio.commitAiWorkflow(
        toPlain({
          plan: pendingPlan.value,
          folderId: payload.folderId,
          name,
          ...mediaModelPayload()
        })
      )
      if (!result.ok || !result.assetId) {
        error.value = result.error || t('aiWorkflow.failed')
        return false
      }
      saveDialogOpen.value = false
      await project.refreshAssets()
      const asset = project.assets.find((item) => item.id === result.assetId)
      if (asset) openAssetEditor(asset)
      dialogOpen.value = false
      draftPrompt.value = ''
      selectedPresetId.value = null
      clearPreview()
      const warnings = [...previewWarnings.value, ...result.warnings]
      if (warnings.length) {
        void promptAlert({
          title: t('aiWorkflow.createdWithWarnings'),
          message: warnings.slice(0, 8).join('\n')
        })
      }
      return true
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      return false
    } finally {
      committing.value = false
    }
  }

  return {
    dialogOpen,
    generating,
    committing,
    error,
    draftPrompt,
    selectedPresetId,
    textModelOptions,
    imageModelOptions,
    videoModelOptions,
    textModelKey,
    imageModelKey,
    videoModelKey,
    pendingPlan,
    preview,
    previewWarnings,
    saveDialogOpen,
    saveDefaultName,
    saveDefaultFolderId,
    presetIds: AI_WORKFLOW_PRESET_IDS,
    applyPreset,
    setTextModelKey,
    setImageModelKey,
    setVideoModelKey,
    openDialog,
    closeDialog,
    planPreview,
    requestCommit,
    closeSaveDialog,
    confirmCommit
  }
}
