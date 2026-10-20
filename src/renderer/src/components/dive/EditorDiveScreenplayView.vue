<template>
  <div v-if="node" class="dive-screenplay dive-view">
    <header class="workbench-header">
      <div class="header-left">
        <span class="kind-badge" :title="typeLabel" :aria-label="typeLabel">
          <WorkspaceItemIcon :icon="nodeIcon" :size="15" />
        </span>
        <input
          v-model="displayName"
          type="text"
          class="title-input"
          :placeholder="typeLabel"
          @change="persistTitle"
        />
      </div>

      <div class="header-telemetry">
        <span class="stat-pill stat-ep">{{
          t('graph.scriptNode.telemetry.episodes', { n: Math.max(1, generatedTexts.length) })
        }}</span>
        <span class="stat-pill">{{
          t('graph.scriptNode.telemetry.scenes', { n: screenplayAnalysis.sceneCount })
        }}</span>
        <span class="stat-pill">{{
          t('graph.scriptNode.telemetry.characters', {
            n: screenplayAnalysis.characters.length
          })
        }}</span>
        <span class="stat-pill">{{
          t('graph.scriptNode.telemetry.dialogues', { n: screenplayAnalysis.dialogueCount })
        }}</span>
        <span class="stat-pill">{{
          t('graph.scriptNode.telemetry.actions', { n: screenplayAnalysis.actionCount })
        }}</span>
        <span class="stat-pill">{{
          t('graph.scriptNode.telemetry.words', { n: screenplayAnalysis.charCount })
        }}</span>
        <span v-if="screenplayAnalysis.estimatedDurationSec > 0" class="stat-pill stat-accent">{{
          t('graph.scriptNode.telemetry.duration', {
            s: screenplayAnalysis.estimatedDurationSec
          })
        }}</span>
      </div>

      <div class="header-right">
        <GraphNodeRunControl
          v-if="hasInPort"
          :status="runStatus"
          :is-running="isGraphRunning"
          :blocked="blocked"
          @toggle="toggleRun"
        />
      </div>
    </header>

    <div class="workbench-body">
      <!-- 左栏：分集管理 + 一键智能分集 + 场次大纲 -->
      <aside class="episode-sidebar">
        <section class="sidebar-group episodes-group">
          <div class="group-head">
            <h3>{{ t('graph.scriptNode.workbench.episodesTitle') }}</h3>
            <span class="group-count">{{
              t('graph.scriptNode.workbench.episodeCount', {
                n: Math.max(1, generatedTexts.length)
              })
            }}</span>
          </div>

          <div class="episode-actions-bar">
            <button type="button" class="ep-action-btn" @click="addNewEpisode">
              {{ t('graph.scriptNode.workbench.addEpisode') }}
            </button>
            <button
              type="button"
              class="ep-action-btn ep-action-accent"
              :disabled="isGraphRunning || runStatus === 'running'"
              @click="triggerAiNextEpisode"
            >
              {{ t('graph.scriptNode.workbench.aiNextEpisode') }}
            </button>
          </div>

          <div v-if="!generatedTexts.length" class="episode-list">
            <div class="episode-card active">
              <div class="ep-card-main">
                <div class="ep-card-top">
                  <span class="ep-index">#1</span>
                  <span class="ep-title">{{
                    t('graph.scriptNode.workbench.unsplitDraftTitle')
                  }}</span>
                  <span class="ep-output-badge">{{
                    t('graph.scriptNode.workbench.activeOutputBadge')
                  }}</span>
                </div>
                <p class="ep-snippet">{{ localText.trim() || '…' }}</p>
                <div class="ep-meta">
                  <span>{{
                    t('graph.scriptNode.telemetry.scenes', { n: screenplayAnalysis.sceneCount })
                  }}</span>
                  <span>·</span>
                  <span>{{
                    t('graph.scriptNode.telemetry.words', { n: screenplayAnalysis.charCount })
                  }}</span>
                  <template v-if="screenplayAnalysis.estimatedDurationSec > 0">
                    <span>·</span>
                    <span>{{
                      t('graph.scriptNode.telemetry.duration', {
                        s: screenplayAnalysis.estimatedDurationSec
                      })
                    }}</span>
                  </template>
                </div>
              </div>
            </div>
          </div>

          <div v-else class="episode-list">
            <div
              v-for="(item, index) in generatedTexts"
              :key="item.id || `index:${index}`"
              class="episode-card"
              :class="{ active: isSelectedText(item.id || `index:${index}`) }"
              :title="t('graph.scriptNode.workbench.setAsOutput')"
              @click="selectEpisode(item.id || `index:${index}`)"
            >
              <div class="ep-card-main">
                <div class="ep-card-top">
                  <span class="ep-index">#{{ index + 1 }}</span>
                  <span class="ep-title">{{ episodeDisplayTitle(item, index) }}</span>
                  <span v-if="isSelectedText(item.id || `index:${index}`)" class="ep-output-badge">
                    {{ t('graph.scriptNode.workbench.activeOutputBadge') }}
                  </span>
                </div>
                <p class="ep-snippet">
                  {{ resolvedGeneratedText[item.id || `index:${index}`] || '…' }}
                </p>
                <div class="ep-meta">
                  <span>{{
                    t('graph.scriptNode.telemetry.scenes', {
                      n: episodeStats(item, index).sceneCount
                    })
                  }}</span>
                  <span>·</span>
                  <span>{{
                    t('graph.scriptNode.telemetry.words', {
                      n: episodeStats(item, index).charCount
                    })
                  }}</span>
                  <template v-if="episodeStats(item, index).estimatedDurationSec > 0">
                    <span>·</span>
                    <span>{{
                      t('graph.scriptNode.telemetry.duration', {
                        s: episodeStats(item, index).estimatedDurationSec
                      })
                    }}</span>
                  </template>
                </div>
              </div>

              <div class="ep-card-tools" @click.stop>
                <button
                  type="button"
                  class="ep-icon-btn"
                  :disabled="index === 0"
                  :title="t('graph.scriptNode.workbench.moveUp')"
                  @click="moveEpisode(index, -1)"
                >
                  ↑
                </button>
                <button
                  type="button"
                  class="ep-icon-btn"
                  :disabled="index === generatedTexts.length - 1"
                  :title="t('graph.scriptNode.workbench.moveDown')"
                  @click="moveEpisode(index, 1)"
                >
                  ↓
                </button>
                <button
                  type="button"
                  class="ep-icon-btn"
                  :title="t('graph.scriptNode.workbench.duplicateEpisode')"
                  @click="duplicateEpisode(index)"
                >
                  ⧉
                </button>
                <PreviewSaveToLibraryButton
                  v-if="canSave(item.relativePath)"
                  compact
                  class="ep-save-btn"
                  :can-save="true"
                  :saved="isSaved(item.relativePath)"
                  :saving="isSaving(item.relativePath)"
                  @save="openSave(item.relativePath!)"
                />
                <button
                  type="button"
                  class="ep-icon-btn ep-delete-btn"
                  :title="t('graph.scriptNode.workbench.deleteEpisode')"
                  @click="removeGeneratedText(item.id)"
                >
                  ×
                </button>
              </div>
            </div>
          </div>
        </section>

        <!-- 一键智能分集面板 -->
        <section class="sidebar-group split-group">
          <div class="group-head">
            <h3>{{ t('graph.scriptNode.workbench.splitBoxTitle') }}</h3>
          </div>

          <label class="split-field">
            <span>{{ t('graph.scriptNode.workbench.splitModeLabel') }}</span>
            <select v-model="splitMode">
              <option value="auto">{{ t('graph.scriptNode.workbench.splitModeAuto') }}</option>
              <option value="markers">
                {{ t('graph.scriptNode.workbench.splitModeMarkers') }}
              </option>
              <option value="scenes">{{ t('graph.scriptNode.workbench.splitModeScenes') }}</option>
            </select>
          </label>

          <div v-if="splitMode !== 'markers'" class="split-scenes-row">
            <span class="split-label">{{ t('graph.scriptNode.workbench.scenesPerEpisode') }}</span>
            <div class="scene-count-pills">
              <button
                v-for="num in [1, 2, 3, 4, 5]"
                :key="num"
                type="button"
                class="count-pill"
                :class="{ active: scenesPerEpisode === num }"
                @click="scenesPerEpisode = num"
              >
                {{ num }}
              </button>
            </div>
          </div>

          <label class="split-check">
            <input v-model="includeSharedBios" type="checkbox" />
            <span>{{ t('graph.scriptNode.workbench.includeSharedBios') }}</span>
          </label>

          <button
            type="button"
            class="split-submit-btn"
            :disabled="!localText.trim()"
            @click="handleSplitEpisodes"
          >
            {{
              splitDoneCount > 0
                ? t('graph.scriptNode.workbench.splitDoneToast', { n: splitDoneCount })
                : t('graph.scriptNode.workbench.splitNowBtn')
            }}
          </button>
        </section>

        <!-- 本集场次大纲导航 -->
        <section v-if="sceneOutlines.length" class="sidebar-group outline-group">
          <div class="group-head">
            <h3>{{ t('graph.scriptNode.workbench.sceneOutlineTitle') }}</h3>
            <span class="group-count">{{ sceneOutlines.length }}</span>
          </div>
          <div class="outline-list">
            <button
              v-for="scene in sceneOutlines"
              :key="scene.index"
              type="button"
              class="outline-item"
              :title="t('graph.scriptNode.workbench.sceneJumpHint')"
              @click="jumpToScene(scene)"
            >
              <span class="outline-title">{{ scene.title }}</span>
              <span v-if="scene.preview" class="outline-preview">{{ scene.preview }}</span>
            </button>
          </div>
        </section>
      </aside>

      <!-- 中栏：沉浸式剧本精修工作台 -->
      <main class="editor-main">
        <div class="studio-toolbar">
          <input
            v-model="currentEpisodeTitle"
            type="text"
            class="episode-title-input"
            :placeholder="t('graph.scriptNode.workbench.episodeTitlePlaceholder')"
            @change="persistEpisodeTitle"
          />

          <select class="tpl-select" value="" @change="onSelectScreenplayTemplate">
            <option value="" disabled>
              {{ t('graph.scriptNode.toolbar.templatePlaceholder') }}
            </option>
            <option v-for="tpl in screenplayTemplates" :key="tpl.id" :value="tpl.id">
              {{ t(`graph.scriptNode.templates.${tpl.id}`) }}
            </option>
          </select>

          <div class="tool-btns">
            <button type="button" class="tool-chip" @click="insertNextScene">
              {{ t('graph.scriptNode.toolbar.addScene') }}
            </button>
            <button type="button" class="tool-chip" @click="insertCharacterBio">
              {{ t('graph.scriptNode.toolbar.addBio') }}
            </button>
            <button type="button" class="tool-chip" @click="insertActionBeat">
              {{ t('graph.scriptNode.toolbar.addAction') }}
            </button>
            <button type="button" class="tool-chip" @click="insertVoiceover">
              {{ t('graph.scriptNode.toolbar.addVo') }}
            </button>
            <button type="button" class="tool-chip tool-chip-accent" @click="formatScreenplay">
              {{
                screenplayFormatFlash
                  ? t('graph.scriptNode.toolbar.formatDone')
                  : t('graph.scriptNode.toolbar.format')
              }}
            </button>
          </div>
        </div>

        <div v-if="screenplayAnalysis.characters.length" class="cast-bar">
          <span class="cast-label">{{ t('graph.scriptNode.characterList') }}</span>
          <div class="cast-chips">
            <button
              v-for="name in screenplayAnalysis.characters"
              :key="name"
              type="button"
              class="cast-chip"
              :title="t('graph.scriptNode.workbench.castJumpHint')"
              @click="insertSpeakerLine(name)"
            >
              {{ name }}
            </button>
          </div>
        </div>

        <div class="script-textarea-wrap">
          <textarea
            ref="editorTextareaRef"
            v-model="localText"
            class="script-textarea"
            :placeholder="t('graph.scriptNode.placeholder')"
            @input="onEditorInput"
            @change="persistScreenplayBody"
          />
        </div>
      </main>

      <!-- 右栏：AI 编剧助手与模型参数 -->
      <aside class="ai-sidebar">
        <section class="sidebar-group">
          <div class="group-head">
            <h3>{{ t('graph.scriptNode.workbench.modelSectionTitle') }}</h3>
          </div>
          <InstructionModelSelect
            v-if="modelOptions.length > 0"
            v-model="selectedModelKey"
            :options="modelOptions"
            :title="t('graph.inspector.generate.model')"
            :empty-label="t('graph.inspector.generate.noModels')"
            @change="persistGenerateConfig"
          />
          <p v-else class="hint">{{ t('graph.inspector.generate.noModels') }}</p>
        </section>

        <section class="sidebar-group ai-assistant-group">
          <div class="group-head">
            <h3>{{ t('graph.scriptNode.aiAssistant.title') }}</h3>
          </div>
          <div class="ai-presets">
            <button
              v-for="preset in screenplayAiPresets"
              :key="preset.key"
              type="button"
              class="preset-chip"
              @click="applyScreenplayAiPreset(preset.prompt)"
            >
              {{ preset.label }}
            </button>
          </div>
          <ExpandableTextarea
            :key="`${node.id}-dive-sp-inst`"
            v-model="instruction"
            :title="t('graph.scriptNode.aiAssistant.title')"
            :rows="6"
            :placeholder="t('graph.scriptNode.aiAssistant.placeholder')"
            @change="persistGenerateConfig"
          />
        </section>

        <section class="sidebar-group">
          <details class="sys-prompt-details">
            <summary>{{ t('graph.scriptNode.workbench.systemPromptToggle') }}</summary>
            <div class="sys-prompt-body">
              <ExpandableTextarea
                :key="`${node.id}-dive-sp-sys`"
                v-model="systemPrompt"
                :title="t('graph.inspector.generate.systemPrompt')"
                :rows="6"
                :placeholder="t('graph.inspector.generate.systemPromptPlaceholder')"
                @change="persistGenerateConfig"
              />
            </div>
          </details>
        </section>
      </aside>
    </div>

    <SaveAssetDialog
      ref="dialogRef"
      :open="dialogOpen"
      :default-name="defaultName"
      :default-folder-id="defaultFolderId"
      :title="t('studio.chat.saveToLibraryTitle')"
      :subtitle="t('studio.chat.saveToLibrarySubtitle')"
      @confirm="confirmSave"
      @cancel="closeDialog"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  analyzeScreenplay,
  buildCharacterBioSnippet,
  buildNextEpisodeInstruction,
  buildNextSceneSnippet,
  buildVoiceoverSnippet,
  DEFAULT_SCREENPLAY_SYSTEM_PROMPT_EN,
  DEFAULT_SCREENPLAY_SYSTEM_PROMPT_ZH,
  defaultScreenplaySystemPrompt,
  extractScreenplayScenes,
  extractSharedScreenplayHeader,
  formatScreenplayText,
  resolveNodeType,
  SCREENPLAY_TEMPLATES,
  splitScreenplayByExplicitEpisodeMarkers,
  splitScreenplayIntoEpisodes,
  type GraphNode,
  type ScreenplayAnalysis,
  type ScreenplaySceneOutline
} from '@shared/graph'
import ExpandableTextarea from '../ExpandableTextarea.vue'
import GraphNodeRunControl from '../GraphNodeRunControl.vue'
import InstructionModelSelect from '../InstructionModelSelect.vue'
import PreviewSaveToLibraryButton from '../PreviewSaveToLibraryButton.vue'
import SaveAssetDialog from '../SaveAssetDialog.vue'
import WorkspaceItemIcon from '../WorkspaceItemIcon.vue'
import { useStudioI18n } from '../../composables/useStudioI18n'
import { useGraphNodeRun } from '../../composables/useGraphNodeRun'
import { useSaveCacheAsset } from '../../composables/useSaveCacheAsset'
import { useEditorDiveFrameFlush } from '../../composables/useEditorDiveFrameFlush'
import { graphEditorHosts } from '../../features/graph/model/graphEditorHosts'
import { graphRunHosts } from '../../features/graph/model/graphRunHosts'
import { invalidateAssetUrlCache } from '../../features/media/assetUrlCache'
import {
  invalidateGenerateModelSettingsCache,
  loadGenerateModelOptions,
  parseModelKey,
  preferredModelKey,
  type GenerateModelOption
} from '../../features/graph/model/generateModelOptions'

type StoredGeneratedText = {
  id?: string
  title?: string
  text: string
  createdAt?: string
  relativePath?: string
}

const props = defineProps<{
  frameKey: string
  hostId: string
  nodeId: string
}>()

const { t, locale, graphTypeLabel } = useStudioI18n()
const {
  dialogOpen,
  defaultName,
  defaultFolderId,
  dialogRef,
  canSave,
  isSaved,
  isSaving,
  openSave,
  closeDialog,
  confirmSave
} = useSaveCacheAsset()

const node = computed((): GraphNode | null => {
  void graphEditorHosts.revision.value
  const current = graphEditorHosts.getNode(props.hostId, props.nodeId)
  return current?.typeId === 'asset.screenplay' ? current : null
})

const typeLabel = computed(() =>
  node.value?.typeId ? graphTypeLabel(node.value.typeId) : t('graph.defaultNode')
)
const nodeIcon = computed(() => {
  const current = node.value
  if (!current) return '📜'
  return resolveNodeType(current)?.icon?.trim() || '📜'
})

const { hasInPort, runStatus, isGraphRunning, blocked, toggleRun } = useGraphNodeRun(
  node,
  () => props.hostId
)

const displayName = ref('')
const localText = ref('')
const currentEpisodeTitle = ref('')
const instruction = ref('')
const systemPrompt = ref('')
const modelOptions = ref<GenerateModelOption[]>([])
const selectedModelKey = ref('')
const editorTextareaRef = ref<HTMLTextAreaElement | null>(null)

const splitMode = ref<'auto' | 'markers' | 'scenes'>('auto')
const scenesPerEpisode = ref(2)
const includeSharedBios = ref(true)
const splitDoneCount = ref(0)
const screenplayFormatFlash = ref(false)
const screenplayTemplates = SCREENPLAY_TEMPLATES

const generatedTexts = computed((): StoredGeneratedText[] => {
  void graphEditorHosts.revision.value
  const current = node.value
  if (!current) return []
  return (current.params.generatedTexts ?? []).filter(
    (item) => item.id && (item.text?.trim() || item.relativePath?.trim())
  )
})

const resolvedGeneratedText = ref<Record<string, string>>({})
const resolvedFullEpisodeText = ref<Record<string, string>>({})
let resolveTextToken = 0

async function loadGeneratedTextBody(item: StoredGeneratedText): Promise<string> {
  const inline = item.text?.trim()
  if (inline) return item.text
  const relativePath = item.relativePath?.trim()
  if (!relativePath) return ''
  try {
    const url = await window.studio.getAssetFileUrl(relativePath)
    if (!url) return ''
    const res = await fetch(url)
    if (!res.ok) return ''
    return await res.text()
  } catch {
    return ''
  }
}

async function resolveGeneratedTextPreviews(): Promise<void> {
  const token = ++resolveTextToken
  const nextSnippet: Record<string, string> = {}
  const nextFull: Record<string, string> = {}
  await Promise.all(
    generatedTexts.value.map(async (item, index) => {
      const key = item.id || `index:${index}`
      const body = await loadGeneratedTextBody(item)
      const trimmed = body.trim()
      nextFull[key] = trimmed
      nextSnippet[key] = trimmed
        ? trimmed.length > 100
          ? `${trimmed.slice(0, 100)}…`
          : trimmed
        : item.relativePath?.trim() || '…'
    })
  )
  if (token !== resolveTextToken) return
  resolvedGeneratedText.value = nextSnippet
  resolvedFullEpisodeText.value = nextFull
}

watch(generatedTexts, () => void resolveGeneratedTextPreviews(), { immediate: true, deep: true })

onBeforeUnmount(() => {
  resolveTextToken += 1
})

const screenplayAnalysis = computed(() => analyzeScreenplay(localText.value))
const sceneOutlines = computed(() => extractScreenplayScenes(localText.value))

function episodeStats(item: StoredGeneratedText, index: number): ScreenplayAnalysis {
  const key = item.id || `index:${index}`
  if (isSelectedText(key)) {
    return screenplayAnalysis.value
  }
  const full = resolvedFullEpisodeText.value[key] ?? item.text ?? ''
  return analyzeScreenplay(full)
}

function episodeDisplayTitle(item: StoredGeneratedText, index: number): string {
  const custom = item.title?.trim()
  if (custom) return custom
  return t('graph.scriptNode.workbench.episodeDefaultTitle', { n: index + 1 })
}

function isSelectedText(key: string): boolean {
  const current = node.value
  if (!current) return false
  const selected = current.params.selectedTextId?.trim()
  if (selected) return selected === key
  const list = generatedTexts.value
  const last = list[list.length - 1]
  return Boolean(last && (last.id || '') === key)
}

function activeEpisodeIndex(): number {
  const list = generatedTexts.value
  if (!list.length) return -1
  const idx = list.findIndex((item, i) => isSelectedText(item.id || `index:${i}`))
  return idx >= 0 ? idx : list.length - 1
}

function syncCurrentEpisodeTitleFromNode(): void {
  const list = generatedTexts.value
  const idx = activeEpisodeIndex()
  if (idx >= 0 && list[idx]) {
    currentEpisodeTitle.value =
      list[idx]!.title?.trim() ||
      t('graph.scriptNode.workbench.episodeDefaultTitle', { n: idx + 1 })
  } else {
    currentEpisodeTitle.value = ''
  }
}

async function loadModels(preferredKey: string): Promise<void> {
  const { options, selectedKey: resolved } = await loadGenerateModelOptions('text', preferredKey)
  modelOptions.value = options
  if (selectedModelKey.value !== resolved) {
    selectedModelKey.value = resolved
  }
}

function loadFromNode(): void {
  const current = node.value
  if (!current) return
  displayName.value = current.title?.trim() || ''
  const rawText = current.params.text ?? ''
  localText.value = rawText.trim() === '…' ? '' : rawText
  instruction.value = current.params.generateInstruction ?? ''
  const storedSys = current.params.generateSystemPrompt?.trim()
  systemPrompt.value = storedSys || defaultScreenplaySystemPrompt(String(locale.value))
  const preferred = preferredModelKey(
    current.params.generateProviderInstanceId,
    current.params.generateModel
  )
  selectedModelKey.value = preferred

  // 若单条草稿或单次生成正文中包含 >= 2 个显式「第X集」标记，自动展开为独立剧集列表
  const existingGallery = current.params.generatedTexts ?? []
  if (existingGallery.length <= 1 && localText.value.trim()) {
    const explicitEpisodes = splitScreenplayByExplicitEpisodeMarkers(localText.value, {
      includeSharedBios: true,
      locale: String(locale.value)
    })
    if (explicitEpisodes.length >= 2 && props.hostId) {
      const now = new Date().toISOString()
      const stamp = Date.now()
      const nextList: StoredGeneratedText[] = explicitEpisodes.map((ep, idx) => ({
        id: `ep:${stamp}:${idx + 1}`,
        title: ep.title,
        text: ep.text,
        createdAt: now
      }))
      const first = nextList[0]!
      localText.value = first.text
      currentEpisodeTitle.value = first.title || ''
      syncRunOutputsAfterGeneratedTextsChange(nextList, first.id)
      graphEditorHosts.updateNode(props.hostId, current.id, {
        generatedTexts: nextList,
        selectedTextId: first.id,
        text: first.text
      })
      graphEditorHosts.bumpRevision()
      void loadModels(preferred)
      return
    }
  }

  // 若当前选中集是落盘文件且 params.text 为空，异步回填编辑器正文
  if (!localText.value.trim() && existingGallery.length > 0) {
    const activeIdx = activeEpisodeIndex()
    const activeItem = activeIdx >= 0 ? existingGallery[activeIdx] : existingGallery[0]
    if (activeItem) {
      void loadGeneratedTextBody(activeItem).then((body) => {
        if (body.trim() && !localText.value.trim()) {
          localText.value = body.trim()
        }
      })
    }
  }

  syncCurrentEpisodeTitleFromNode()
  void loadModels(preferred)
}

watch(
  () => [props.hostId, props.nodeId] as const,
  () => loadFromNode(),
  { immediate: true }
)

// 当 AI 生成完成写回新文本或外部更新 params.text 时同步编辑器
watch(
  () =>
    [
      node.value?.params.text,
      node.value?.params.selectedTextId,
      generatedTexts.value.length
    ] as const,
  ([nextNodeText]) => {
    const normalized = (nextNodeText ?? '').trim() === '…' ? '' : (nextNodeText ?? '')
    if (normalized && normalized !== localText.value) {
      localText.value = normalized
    }
    syncCurrentEpisodeTitleFromNode()
  }
)

watch(locale, (next) => {
  const cur = systemPrompt.value.trim()
  if (
    !cur ||
    cur === DEFAULT_SCREENPLAY_SYSTEM_PROMPT_EN ||
    cur === DEFAULT_SCREENPLAY_SYSTEM_PROMPT_ZH
  ) {
    systemPrompt.value = defaultScreenplaySystemPrompt(String(next))
  }
})

function onSettingsChanged(): void {
  invalidateGenerateModelSettingsCache()
  if (node.value) void loadModels(selectedModelKey.value)
}

onMounted(() => {
  window.addEventListener('studio:settings-changed', onSettingsChanged)
})

onBeforeUnmount(() => {
  window.removeEventListener('studio:settings-changed', onSettingsChanged)
})

function persistTitle(): void {
  const current = node.value
  if (!current || !props.hostId) return
  graphEditorHosts.updateNode(props.hostId, current.id, {}, displayName.value.trim())
  graphEditorHosts.bumpRevision()
}

function persistGenerateConfig(): void {
  const current = node.value
  if (!current || !props.hostId) return
  const parsed = parseModelKey(selectedModelKey.value)
  graphEditorHosts.updateNode(props.hostId, current.id, {
    generateInstruction: instruction.value,
    generateSystemPrompt: systemPrompt.value,
    generateModel: parsed?.model ?? '',
    generateProviderInstanceId: parsed?.providerInstanceId ?? ''
  })
}

function syncRunOutputsAfterGeneratedTextsChange(
  items: StoredGeneratedText[],
  selectedTextId?: string
): void {
  const current = node.value
  if (!current || !props.hostId) return
  const host = graphRunHosts.get(props.hostId)
  if (!host) return
  const prev = host.runStates[current.id] ?? { status: 'done' as const }
  const selectedId =
    selectedTextId?.trim() ||
    current.params.selectedTextId?.trim() ||
    items[items.length - 1]?.id ||
    ''
  const picked = items.find((item) => item.id === selectedId) || items[items.length - 1]
  host.runStates[current.id] = {
    ...prev,
    status: prev.status === 'idle' ? 'done' : prev.status,
    outputs: {
      ...(prev.outputs ?? {}),
      out: {
        kind: 'text',
        text: picked?.text ?? '',
        id: picked?.id,
        ...(picked?.title ? { title: picked.title } : {}),
        ...(picked?.relativePath ? { relativePath: picked.relativePath } : {})
      },
      'out-all': {
        kind: 'texts',
        items: items.map((item) => ({
          id: item.id,
          ...(item.title ? { title: item.title } : {}),
          text: item.text,
          createdAt: item.createdAt,
          ...(item.relativePath ? { relativePath: item.relativePath } : {})
        }))
      }
    }
  }
}

let editorDebounceTimer: ReturnType<typeof setTimeout> | null = null

function onEditorInput(): void {
  if (editorDebounceTimer) clearTimeout(editorDebounceTimer)
  editorDebounceTimer = setTimeout(() => {
    persistScreenplayBody()
  }, 280)
}

function persistScreenplayBody(): void {
  if (editorDebounceTimer) {
    clearTimeout(editorDebounceTimer)
    editorDebounceTimer = null
  }
  const current = node.value
  if (!current || !props.hostId) return
  const nextText = localText.value
  const list = [...(current.params.generatedTexts ?? [])]
  const selectedId = current.params.selectedTextId?.trim() || list[list.length - 1]?.id || ''
  if (list.length > 0 && selectedId) {
    const idx = list.findIndex((item) => item.id === selectedId)
    if (idx >= 0) {
      const prevItem = list[idx]!
      const prevKnownText = (
        resolvedFullEpisodeText.value[selectedId] ??
        prevItem.text ??
        ''
      ).trim()
      const trimmedNext = nextText.trim()
      // 落盘条目在异步正文尚未加载完成前若 localText 为空，勿把 relativePath 抹空
      if (!trimmedNext && prevItem.relativePath?.trim() && !prevKnownText) {
        return
      }
      const textChanged = prevKnownText !== trimmedNext
      list[idx] = {
        ...prevItem,
        text: nextText,
        ...(textChanged ? { relativePath: undefined } : {})
      }
      resolvedFullEpisodeText.value = {
        ...resolvedFullEpisodeText.value,
        [selectedId]: trimmedNext
      }
    }
    syncRunOutputsAfterGeneratedTextsChange(list, selectedId)
    graphEditorHosts.updateNode(props.hostId, current.id, {
      text: nextText,
      generatedTexts: list
    })
  } else {
    const host = graphRunHosts.get(props.hostId)
    if (host) {
      const prev = host.runStates[current.id] ?? { status: 'done' as const }
      host.runStates[current.id] = {
        ...prev,
        status: prev.status === 'idle' ? 'done' : prev.status,
        outputs: {
          ...(prev.outputs ?? {}),
          out: { kind: 'text', text: nextText }
        }
      }
    }
    graphEditorHosts.updateNode(props.hostId, current.id, { text: nextText })
  }
  graphEditorHosts.bumpRevision()
}

function persistEpisodeTitle(): void {
  const current = node.value
  if (!current || !props.hostId) return
  const trimmedTitle = currentEpisodeTitle.value.trim()
  const list = [...(current.params.generatedTexts ?? [])]
  if (list.length === 0) {
    if (!trimmedTitle && !localText.value.trim()) return
    const id = `ep:${Date.now()}:1`
    const firstItem: StoredGeneratedText = {
      id,
      title: trimmedTitle || t('graph.scriptNode.workbench.episodeDefaultTitle', { n: 1 }),
      text: localText.value,
      createdAt: new Date().toISOString()
    }
    syncRunOutputsAfterGeneratedTextsChange([firstItem], id)
    graphEditorHosts.updateNode(props.hostId, current.id, {
      generatedTexts: [firstItem],
      selectedTextId: id,
      text: localText.value
    })
    graphEditorHosts.bumpRevision()
    return
  }
  const idx = activeEpisodeIndex()
  if (idx < 0 || !list[idx]) return
  list[idx] = {
    ...list[idx]!,
    title: trimmedTitle || t('graph.scriptNode.workbench.episodeDefaultTitle', { n: idx + 1 })
  }
  const selectedId = list[idx]!.id || ''
  syncRunOutputsAfterGeneratedTextsChange(list, selectedId)
  graphEditorHosts.updateNode(props.hostId, current.id, {
    generatedTexts: list
  })
  graphEditorHosts.bumpRevision()
}

async function selectEpisode(key: string): Promise<void> {
  persistScreenplayBody()
  const current = node.value
  if (!current || !props.hostId) return
  const list = generatedTexts.value
  const idx = list.findIndex((entry, i) => (entry.id || `index:${i}`) === key)
  const item = idx >= 0 ? list[idx] : undefined
  if (!item?.id) return
  const body = (await loadGeneratedTextBody(item)).trim()
  const nextText = body || item.text?.trim() || ''
  localText.value = nextText === '…' ? '' : nextText
  currentEpisodeTitle.value = episodeDisplayTitle(item, idx)
  syncRunOutputsAfterGeneratedTextsChange(list, item.id)
  graphEditorHosts.updateNode(props.hostId, current.id, {
    selectedTextId: item.id,
    text: localText.value
  })
  graphEditorHosts.bumpRevision()
}

function addNewEpisode(): void {
  persistScreenplayBody()
  const current = node.value
  if (!current || !props.hostId) return
  const now = new Date().toISOString()
  const baseStamp = Date.now()
  const list = [...generatedTexts.value]

  // 若此前处于未分集单草稿状态，先把第 1 集固化，确保点击「+ 新建分集」后立即拥有第 1 集与第 2 集
  if (list.length === 0) {
    const ep1Title =
      currentEpisodeTitle.value.trim() ||
      t('graph.scriptNode.workbench.episodeDefaultTitle', { n: 1 })
    const ep1DefaultBody = `${ep1Title}\n\n${buildNextSceneSnippet('', String(locale.value)).trim()}`
    list.push({
      id: `ep:${baseStamp}:1`,
      title: ep1Title,
      text: localText.value.trim() || ep1DefaultBody,
      createdAt: now
    })
  }

  const nextIndex = list.length + 1
  const { sharedHeader } = extractSharedScreenplayHeader(localText.value)
  const newScene = buildNextSceneSnippet('', String(locale.value)).trim()
  const newId = `ep:${baseStamp}:${nextIndex}`
  const newTitle = t('graph.scriptNode.workbench.episodeDefaultTitle', { n: nextIndex })
  const newEpBody = `${newTitle}\n\n${newScene}`
  const newEpText = sharedHeader ? `${sharedHeader}\n\n${newEpBody}` : newEpBody

  list.push({
    id: newId,
    title: newTitle,
    text: newEpText,
    createdAt: now
  })

  localText.value = newEpText
  currentEpisodeTitle.value = newTitle
  syncRunOutputsAfterGeneratedTextsChange(list, newId)
  graphEditorHosts.updateNode(props.hostId, current.id, {
    generatedTexts: list,
    selectedTextId: newId,
    text: newEpText
  })
  graphEditorHosts.bumpRevision()
}

function duplicateEpisode(index: number): void {
  persistScreenplayBody()
  const current = node.value
  if (!current || !props.hostId) return
  const list = [...generatedTexts.value]
  const source = list[index]
  if (!source) return
  const key = source.id || `index:${index}`
  const sourceBody = resolvedFullEpisodeText.value[key] || source.text || localText.value
  const newId = `ep:${Date.now()}:copy`
  const copyTitle = `${episodeDisplayTitle(source, index)} (Copy)`
  const copyItem: StoredGeneratedText = {
    id: newId,
    title: copyTitle,
    text: sourceBody,
    createdAt: new Date().toISOString()
  }
  list.splice(index + 1, 0, copyItem)
  localText.value = sourceBody
  currentEpisodeTitle.value = copyTitle
  syncRunOutputsAfterGeneratedTextsChange(list, newId)
  graphEditorHosts.updateNode(props.hostId, current.id, {
    generatedTexts: list,
    selectedTextId: newId,
    text: sourceBody
  })
  graphEditorHosts.bumpRevision()
}

function moveEpisode(index: number, delta: -1 | 1): void {
  const current = node.value
  if (!current || !props.hostId) return
  const list = [...generatedTexts.value]
  const targetIndex = index + delta
  if (targetIndex < 0 || targetIndex >= list.length) return
  const [moved] = list.splice(index, 1)
  if (!moved) return
  list.splice(targetIndex, 0, moved)
  const selectedId = current.params.selectedTextId || moved.id || ''
  syncRunOutputsAfterGeneratedTextsChange(list, selectedId)
  graphEditorHosts.updateNode(props.hostId, current.id, {
    generatedTexts: list
  })
  graphEditorHosts.bumpRevision()
}

function removeGeneratedText(textId: string | undefined): void {
  const current = node.value
  if (!current || !props.hostId || !textId) return
  const removed = (current.params.generatedTexts ?? []).find((item) => item.id === textId)
  const next = (current.params.generatedTexts ?? []).filter((item) => item.id !== textId)
  const nextSelected =
    current.params.selectedTextId === textId
      ? next[next.length - 1]?.id || ''
      : current.params.selectedTextId || next[next.length - 1]?.id || ''
  const latest = next.find((item) => item.id === nextSelected) || next[next.length - 1]
  const nextBody = latest?.text?.trim()
    ? latest.text
    : latest?.id
      ? resolvedFullEpisodeText.value[latest.id] || ''
      : ''
  localText.value = nextBody
  syncRunOutputsAfterGeneratedTextsChange(next, nextSelected)
  graphEditorHosts.updateNode(props.hostId, current.id, {
    generatedTexts: next,
    selectedTextId: nextSelected,
    text: nextBody
  })
  graphEditorHosts.bumpRevision()

  const relativePath = removed?.relativePath?.trim()
  if (relativePath) {
    invalidateAssetUrlCache(relativePath)
    void window.studio.deleteGraphRunMedia(relativePath).catch((err) => {
      console.warn('[EditorDiveScreenplayView] delete graph text failed', relativePath, err)
    })
  }
}

function handleSplitEpisodes(): void {
  const current = node.value
  if (!current || !props.hostId || !localText.value.trim()) return
  const episodes = splitScreenplayIntoEpisodes(localText.value, {
    mode: splitMode.value,
    scenesPerEpisode: scenesPerEpisode.value,
    includeSharedBios: includeSharedBios.value,
    locale: String(locale.value)
  })
  if (!episodes.length) return

  const now = new Date().toISOString()
  const stamp = Date.now()
  const nextList: StoredGeneratedText[] = episodes.map((ep, idx) => ({
    id: `ep:${stamp}:${idx + 1}`,
    title: ep.title,
    text: ep.text,
    createdAt: now
  }))

  const first = nextList[0]!
  localText.value = first.text
  currentEpisodeTitle.value = first.title || ''
  syncRunOutputsAfterGeneratedTextsChange(nextList, first.id)
  graphEditorHosts.updateNode(props.hostId, current.id, {
    generatedTexts: nextList,
    selectedTextId: first.id,
    text: first.text
  })
  graphEditorHosts.bumpRevision()

  splitDoneCount.value = nextList.length
  setTimeout(() => {
    splitDoneCount.value = 0
  }, 2200)
}

function triggerAiNextEpisode(): void {
  persistScreenplayBody()
  const current = node.value
  if (!current || !props.hostId) return

  // 若当前还未建集且有底稿，先固化为第 1 集，这样 AI 生成的新剧本会追加为第 2 集
  const list = [...generatedTexts.value]
  if (list.length === 0 && localText.value.trim()) {
    const firstId = `ep:${Date.now()}:1`
    const firstItem: StoredGeneratedText = {
      id: firstId,
      title:
        currentEpisodeTitle.value.trim() ||
        t('graph.scriptNode.workbench.episodeDefaultTitle', { n: 1 }),
      text: localText.value,
      createdAt: new Date().toISOString()
    }
    graphEditorHosts.updateNode(props.hostId, current.id, {
      generatedTexts: [firstItem],
      selectedTextId: firstId
    })
  }

  const nextEpNum = Math.max(1, generatedTexts.value.length) + 1
  const nextPrompt = buildNextEpisodeInstruction(
    currentEpisodeTitle.value,
    nextEpNum,
    String(locale.value)
  )
  instruction.value = nextPrompt
  persistGenerateConfig()
  if (hasInPort.value && !blocked.value && runStatus.value !== 'running') {
    toggleRun()
  }
}

const screenplayAiPresets = computed(() => {
  const isEn = String(locale.value).toLowerCase().startsWith('en')
  const nextEpNum = Math.max(1, generatedTexts.value.length) + 1
  return [
    {
      key: 'expand',
      label: t('graph.scriptNode.aiAssistant.presetExpand'),
      prompt: t('graph.scriptNode.aiAssistant.presetExpand')
    },
    {
      key: 'conflict',
      label: t('graph.scriptNode.aiAssistant.presetConflict'),
      prompt: t('graph.scriptNode.aiAssistant.presetConflict')
    },
    {
      key: 'format',
      label: t('graph.scriptNode.aiAssistant.presetFormat'),
      prompt: t('graph.scriptNode.aiAssistant.presetFormat')
    },
    {
      key: 'continue',
      label: t('graph.scriptNode.aiAssistant.presetContinue'),
      prompt: t('graph.scriptNode.aiAssistant.presetContinue')
    },
    {
      key: 'multiEpisode',
      label: t('graph.scriptNode.aiAssistant.presetMultiEpisode'),
      prompt: isEn
        ? 'Write a 3-episode high-conflict short drama screenplay: include a shared [Character Bios] block at the top, mark each episode clearly with "EPISODE 1", "EPISODE 2", "EPISODE 3", and write 2 scenes per episode with △ actions, dialogue, and episode-ending cliffhangers.'
        : '创作一部 3 集连载竖屏漫剧/短剧剧本：顶部包含共享【人物小传】，每集使用「第1集」「第2集」「第3集」明确分集标题，每集包含 2 场高冲突戏（含「第X场 【内/外景 · 地点 - 日/夜】」、「△ 动作描写」与角色台词），每集结尾留强悬念钩子。' // cjk-ok
    },
    {
      key: 'nextEpisode',
      label: t('graph.scriptNode.aiAssistant.presetNextEpisode'),
      prompt: buildNextEpisodeInstruction(
        currentEpisodeTitle.value,
        nextEpNum,
        String(locale.value)
      )
    }
  ]
})

function applyScreenplayAiPreset(promptText: string): void {
  instruction.value = promptText
  persistGenerateConfig()
}

function insertAtCursorOrAppend(snippet: string): void {
  const el = editorTextareaRef.value
  const base = localText.value
  if (!base.trim() || base.trim() === '…') {
    localText.value = snippet.trimStart()
    persistScreenplayBody()
    return
  }
  if (el && typeof el.selectionStart === 'number') {
    const start = el.selectionStart
    const end = el.selectionEnd ?? start
    const before = base.slice(0, start)
    const after = base.slice(end)
    const cleanSnippet = snippet.trim()
    const prefix = before.length > 0 && !before.endsWith('\n') ? '\n' : ''
    const suffix = after.length > 0 && !after.startsWith('\n') ? '\n' : ''
    const inserted = `${prefix}${cleanSnippet}${suffix}`
    localText.value = `${before}${inserted}${after}`
    persistScreenplayBody()
    void nextTick(() => {
      el.focus()
      const nextPos = start + inserted.length
      el.setSelectionRange(nextPos, nextPos)
    })
    return
  }
  localText.value = `${base.trimEnd()}\n\n${snippet.trimStart()}`
  persistScreenplayBody()
}

function insertNextScene(): void {
  const snippet = buildNextSceneSnippet(localText.value, String(locale.value))
  localText.value = !localText.value.trim()
    ? snippet.trimStart()
    : `${localText.value.trimEnd()}\n\n${snippet.trimStart()}`
  persistScreenplayBody()
}

function insertCharacterBio(): void {
  const snippet = buildCharacterBioSnippet(String(locale.value))
  if (!localText.value.trim()) {
    localText.value = snippet.trim()
  } else {
    localText.value = `${snippet.trim()}\n\n${localText.value.trimStart()}`
  }
  persistScreenplayBody()
}

function insertActionBeat(): void {
  const isEn = String(locale.value).toLowerCase().startsWith('en')
  insertAtCursorOrAppend(
    isEn ? '△ [Character / camera action beat]' : '△ 【人物动作 / 镜头画面描写】' // cjk-ok
  )
}

function insertVoiceover(): void {
  insertAtCursorOrAppend(
    buildVoiceoverSnippet(screenplayAnalysis.value.characters[0], String(locale.value))
  )
}

function insertSpeakerLine(name: string): void {
  const isEn = String(locale.value).toLowerCase().startsWith('en')
  insertAtCursorOrAppend(
    isEn ? `${name}: (emotion) [Dialogue line]` : `${name}：（情绪）[台词内容]` // cjk-ok
  )
}

function onSelectScreenplayTemplate(event: Event): void {
  const select = event.target as HTMLSelectElement
  const tplId = select.value
  select.value = ''
  if (!tplId) return
  const tpl = screenplayTemplates.find((item) => item.id === tplId)
  if (!tpl) return
  const isEn = String(locale.value).toLowerCase().startsWith('en')
  localText.value = isEn ? tpl.textEn : tpl.textZh
  persistScreenplayBody()
}

function formatScreenplay(): void {
  if (!localText.value.trim()) return
  localText.value = formatScreenplayText(localText.value)
  persistScreenplayBody()
  screenplayFormatFlash.value = true
  setTimeout(() => {
    screenplayFormatFlash.value = false
  }, 1400)
}

function jumpToScene(scene: ScreenplaySceneOutline): void {
  const el = editorTextareaRef.value
  if (!el) return
  el.focus()
  const pos = Math.max(0, Math.min(localText.value.length, scene.charOffset))
  el.setSelectionRange(pos, pos + scene.title.length)
  const totalLines = Math.max(1, localText.value.split(/\r?\n/).length)
  const ratio = scene.lineIndex / totalLines
  el.scrollTop = Math.max(0, Math.round(el.scrollHeight * ratio - 60))
}

function flushAll(): void {
  persistScreenplayBody()
  persistGenerateConfig()
}

useEditorDiveFrameFlush(() => props.frameKey, flushAll)
</script>

<style scoped>
.dive-screenplay {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--bg);
  color: var(--text);
}

.workbench-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elevated);
  flex-shrink: 0;
  flex-wrap: wrap;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 180px;
}

.kind-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--accent) 16%, var(--bg));
  color: var(--accent);
  flex-shrink: 0;
}

.title-input {
  padding: 5px 8px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
  min-width: 160px;
}

.title-input:hover,
.title-input:focus {
  border-color: var(--border);
  background: var(--bg);
  outline: none;
}

.header-telemetry {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.stat-pill {
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 500;
}

.stat-pill.stat-ep {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  background: color-mix(in srgb, var(--accent) 14%, var(--bg));
  color: var(--accent);
  font-weight: 600;
}

.stat-pill.stat-accent {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  color: var(--accent);
}

.header-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.header-right :deep(.node-run-btn) {
  width: auto;
  padding: 5px 14px;
}

.workbench-body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 290px minmax(0, 1fr) 300px;
  overflow: hidden;
}

.episode-sidebar,
.ai-sidebar {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  overflow-y: auto;
  background: var(--bg-elevated);
}

.episode-sidebar {
  border-right: 1px solid var(--border);
}

.ai-sidebar {
  border-left: 1px solid var(--border);
}

.sidebar-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg);
}

.group-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.group-head h3 {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
}

.group-count {
  font-size: 11px;
  color: var(--text-muted);
}

.episode-actions-bar {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.ep-action-btn {
  padding: 5px 8px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background 0.15s ease;
}

.ep-action-btn:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
}

.ep-action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ep-action-btn.ep-action-accent {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  background: color-mix(in srgb, var(--accent) 14%, var(--bg));
  color: var(--accent);
  font-weight: 600;
}

.episode-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 320px;
  overflow-y: auto;
}

.episode-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  border-radius: 7px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background 0.15s ease;
}

.episode-card:hover {
  border-color: color-mix(in srgb, var(--accent) 50%, var(--border));
}

.episode-card.active {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, var(--bg-elevated));
}

.ep-card-main {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ep-card-top {
  display: flex;
  align-items: center;
  gap: 6px;
}

.ep-index {
  font-size: 10px;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--bg);
  color: var(--text-muted);
}

.ep-title {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ep-output-badge {
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 20%, var(--bg));
  color: var(--accent);
  flex-shrink: 0;
}

.ep-snippet {
  margin: 0;
  font-size: 11px;
  line-height: 1.4;
  color: var(--text-muted);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.ep-meta {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  color: var(--text-muted);
}

.ep-card-tools {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  padding-top: 4px;
  border-top: 1px dashed var(--border);
}

.ep-icon-btn {
  width: 22px;
  height: 20px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.ep-icon-btn:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
}

.ep-icon-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.ep-delete-btn:hover:not(:disabled) {
  border-color: var(--danger);
  color: var(--danger);
}

.split-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  color: var(--text-muted);
}

.split-field select {
  padding: 5px 8px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text);
  font-size: 11px;
}

.split-scenes-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.split-label {
  font-size: 11px;
  color: var(--text-muted);
}

.scene-count-pills {
  display: flex;
  gap: 4px;
}

.count-pill {
  padding: 2px 8px;
  border-radius: 5px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text-muted);
  font-size: 11px;
  cursor: pointer;
}

.count-pill.active {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 16%, var(--bg));
  color: var(--accent);
  font-weight: 600;
}

.split-check {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--text);
  cursor: pointer;
}

.split-submit-btn {
  padding: 7px 10px;
  border-radius: 6px;
  border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--border));
  background: color-mix(in srgb, var(--accent) 15%, var(--bg));
  color: var(--accent);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease;
}

.split-submit-btn:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent) 24%, var(--bg));
}

.split-submit-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.outline-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 200px;
  overflow-y: auto;
}

.outline-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  text-align: left;
  cursor: pointer;
}

.outline-item:hover {
  border-color: var(--accent);
}

.outline-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text);
}

.outline-preview {
  font-size: 10px;
  color: var(--text-muted);
}

/* 中栏：剧本正文编辑器 */
.editor-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: var(--bg);
}

.studio-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elevated);
}

.episode-title-input {
  flex: 1 1 180px;
  min-width: 140px;
  padding: 5px 10px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  font-size: 12px;
  font-weight: 600;
}

.tpl-select {
  padding: 5px 8px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  font-size: 11px;
}

.tool-btns {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.tool-chip {
  padding: 4px 9px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  font-size: 11px;
  cursor: pointer;
}

.tool-chip:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.tool-chip-accent {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  background: color-mix(in srgb, var(--accent) 14%, var(--bg));
  color: var(--accent);
  font-weight: 600;
}

.cast-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--bg-elevated) 60%, var(--bg));
  flex-wrap: wrap;
}

.cast-label {
  font-size: 11px;
  color: var(--text-muted);
  font-weight: 600;
}

.cast-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.cast-chip {
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text);
  font-size: 11px;
  cursor: pointer;
}

.cast-chip:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.script-textarea-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  padding: 14px;
}

.script-textarea {
  width: 100%;
  height: 100%;
  resize: none;
  padding: 16px 20px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text);
  font-size: 13.5px;
  line-height: 1.75;
  font-family: inherit;
}

.script-textarea:focus {
  outline: none;
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
}

/* 右栏：AI 助手 */
.ai-presets {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.preset-chip {
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text-muted);
  font-size: 11px;
  text-align: left;
  cursor: pointer;
}

.preset-chip:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.sys-prompt-details summary {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  cursor: pointer;
  user-select: none;
}

.sys-prompt-body {
  margin-top: 8px;
}

.hint {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
}
</style>
