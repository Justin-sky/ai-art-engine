<template>
  <div class="ui-split-dive">
    <div v-if="loading" class="hint">
      {{ t('divePipeline.uiSplit.loading') }}
    </div>
    <div v-else-if="awaitingModeChoice" class="mode-choice-overlay">
      <div class="mode-choice-card">
        <div class="mode-choice-title">{{ modeUi.title }}</div>
        <p class="mode-choice-desc">{{ modeUi.desc }}</p>
        <div class="mode-choice-grid">
          <button type="button" class="mode-choice-btn" @click="confirmComposeMode('ai_generate')">
            <span class="mode-icon">✨</span>
            <span class="mode-name">{{ modeUi.aiTitle }}</span>
            <span class="mode-sub">{{ modeUi.aiSub }}</span>
          </button>
          <button
            type="button"
            class="mode-choice-btn"
            @click="confirmComposeMode('atlas_compose')"
          >
            <span class="mode-icon">🧱</span>
            <span class="mode-name">{{ modeUi.atlasTitle }}</span>
            <span class="mode-sub">{{ modeUi.atlasSub }}</span>
          </button>
        </div>
      </div>
    </div>
    <template v-else-if="innerAssetId">
      <div class="ui-mode-switch-bar">
        <span class="switch-label">{{ modeUi.currentModeLabel }}</span>
        <button
          type="button"
          class="switch-chip"
          :class="{ active: activeComposeMode === 'ai_generate' }"
          @click="switchComposeMode('ai_generate')"
        >
          ✨ {{ modeUi.aiShort }}
        </button>
        <button
          type="button"
          class="switch-chip"
          :class="{ active: activeComposeMode === 'atlas_compose' }"
          @click="switchComposeMode('atlas_compose')"
        >
          🧱 {{ modeUi.atlasShort }}
        </button>
      </div>
      <AssetEditor
        :key="`${innerAssetId}:${activeComposeMode}`"
        :asset-id="innerAssetId"
        embedded
      />
    </template>
    <div v-else class="hint">
      {{ errorText }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref } from 'vue'
import {
  buildUiSplitHostInterface,
  buildUiSplitInnerGraph,
  normalizeStoredUiScreens,
  screensFromUiGenIncoming,
  softResolveSourceOutput,
  UI_SPLIT_INNER_GRAPH_VERSION,
  type ResolveHostInputSlotsOptions,
  type UiScreenPromptItem
} from '@shared/graph'
import { graphEditorHosts } from '../../features/graph/model/graphEditorHosts'
import { useStudioI18n } from '../../composables/useStudioI18n'
import { useProjectStore } from '../../stores/project'
import { toPlain } from '../../utils/toPlain'

const AssetEditor = defineAsyncComponent(() => import('../AssetEditor.vue'))

const props = defineProps<{
  frameKey: string
  hostId: string
  nodeId: string
}>()

const project = useProjectStore()
const { locale, t } = useStudioI18n()
const innerAssetId = ref('')
const loading = ref(true)
const errorText = ref('')
const awaitingModeChoice = ref(false)
const activeComposeMode = ref<'ai_generate' | 'atlas_compose'>('ai_generate')
const resolvedScreensCache = ref<UiScreenPromptItem[]>([])

const isEn = computed(() =>
  String(locale.value || '')
    .toLowerCase()
    .startsWith('en')
)
const modeUi = computed(() => {
  if (isEn.value) {
    return {
      title: 'Choose UI Generation Mode',
      desc: 'Select how each UI screen in this workflow should be built. We will wire the corresponding nodes automatically:',
      aiTitle: 'Full AI Generate (asset.image)',
      aiSub: 'Directly generate full UI screen art & clean textless plates from prompts.',
      atlasTitle: 'Compose from Existing Atlas (ui.atlasCompose)',
      atlasSub:
        'Assemble screens from existing UI atlas/components on separate layers (double-click for PS-like editor & direct .psd export).',
      currentModeLabel: 'UI Build Mode:',
      aiShort: 'Full AI Generate',
      atlasShort: 'Existing Atlas Compose'
    }
  }
  return {
    title: '请选择 UI 界面生成方式', // cjk-ok
    desc: '请根据项目需求选择生成模式，系统将自动在子图中铺设对应的节点管线：', // cjk-ok
    aiTitle: '完全 AI 生成（图像生成节点）', // cjk-ok
    aiSub: '根据界面描述直接 AI 绘制完整 UI 画面与无字底图，适合从零概念设计。', // cjk-ok
    atlasTitle: '使用已有图集拼装（图集拼装 UI 节点）', // cjk-ok
    atlasSub: '接入项目已有图集/组件库分层排布组装界面，双击打开类 PS 分层界面并可直接导出 .psd。', // cjk-ok
    currentModeLabel: '当前 UI 生成模式：', // cjk-ok
    aiShort: '完全 AI 生成', // cjk-ok
    atlasShort: '使用已有图集拼装' // cjk-ok
  }
})

/** 从输入端口（上游 texts 数组）直接软解析界面列表，无需先 cook */
function resolveScreensFromIncomingPort(nodeId: string): UiScreenPromptItem[] {
  const doc = graphEditorHosts.getDocument(props.hostId)
  if (!doc) return []
  const incoming = graphEditorHosts.listIncomingEdges(props.hostId, nodeId, 'in')
  if (!incoming.length) return []
  const options: ResolveHostInputSlotsOptions = {
    resolveLiveAssetGraph: (id) => graphEditorHosts.getLiveAssetDocument(id) ?? undefined,
    resolveAssetGenParams: (id) => project.assets.find((a) => a.id === id)?.genParams
  }
  const values = incoming.map((edge) =>
    softResolveSourceOutput(doc, edge.sourceNodeId, edge.sourcePort ?? 'out', options)
  )
  return screensFromUiGenIncoming(values)
}

async function buildAndSaveInnerGraph(
  screens: UiScreenPromptItem[],
  composeMode: 'ai_generate' | 'atlas_compose'
): Promise<void> {
  loading.value = true
  awaitingModeChoice.value = false
  try {
    const node = graphEditorHosts.getNode(props.hostId, props.nodeId)
    activeComposeMode.value = composeMode
    const plainGraphJson = toPlain(
      buildUiSplitInnerGraph(toPlain(screens), locale.value, {
        generateModel: node?.params?.generateModel,
        generateProviderInstanceId: node?.params?.generateProviderInstanceId,
        defaultAspectRatio: node?.params?.generateAspectRatio as never,
        generateTransparentBg: node?.params?.generateTransparentBg !== false,
        stylePreset: node?.params?.uiGenStylePreset as never,
        styleImagesUseGlobal: node?.params?.styleImagesUseGlobal !== false,
        composeMode,
        generatedImages: toPlain(node?.params?.generatedImages)
      })
    )
    const plainHostInterface = toPlain(buildUiSplitHostInterface(toPlain(screens)))
    const created = await window.studio.createAsset({
      type: 'subgraph',
      name: `UI拆分·${node?.title?.trim() || props.nodeId}`, // cjk-ok 持久化资产名前缀（存的是名字不是标签）
      folderId: null,
      genParams: {
        graphJson: plainGraphJson,
        hostInterface: plainHostInterface,
        uiComposeMode: composeMode
      } as never
    })
    innerAssetId.value = created.id
    graphEditorHosts.updateNode(props.hostId, props.nodeId, {
      uiSplitAssetId: created.id,
      uiSplitGraphVersion: UI_SPLIT_INNER_GRAPH_VERSION
    })
    await graphEditorHosts.flush(props.hostId)
    await project.refreshLibrary()
  } catch (err) {
    errorText.value = err instanceof Error ? err.message : String(err)
  } finally {
    loading.value = false
  }
}

async function confirmComposeMode(mode: 'ai_generate' | 'atlas_compose'): Promise<void> {
  await buildAndSaveInnerGraph(resolvedScreensCache.value, mode)
}

async function switchComposeMode(mode: 'ai_generate' | 'atlas_compose'): Promise<void> {
  if (mode === activeComposeMode.value && innerAssetId.value) return
  if (!resolvedScreensCache.value.length) return
  await buildAndSaveInnerGraph(resolvedScreensCache.value, mode)
}

onMounted(async () => {
  try {
    const node = graphEditorHosts.getNode(props.hostId, props.nodeId)
    const hostAssetId = props.hostId.startsWith('asset:') ? props.hostId.slice('asset:'.length) : ''
    // 直接按输入端口数组展开（无需先 cook）；端口无输出时回退已存提示词
    let screens = resolveScreensFromIncomingPort(props.nodeId)
    const storedScreens = normalizeStoredUiScreens(node?.params?.uiScreens)
    if (!screens.length) {
      screens = storedScreens
    } else if (storedScreens.length) {
      screens = screens.map((item) => {
        const prev = storedScreens.find(
          (p) => (p.id && p.id === item.id) || (p.title && p.title === item.title)
        )
        return prev && prev.enabled === false ? { ...item, enabled: false } : item
      })
    }
    resolvedScreensCache.value = screens
    const existing = node?.params?.uiSplitAssetId?.trim() || ''
    const existingSubgraphAsset = existing
      ? project.assets.find(
          (asset) => asset.id === existing && asset.type === 'subgraph' && asset.id !== hostAssetId
        )
      : undefined
    const sameScreens =
      screens.length > 0 &&
      JSON.stringify(screens) === JSON.stringify(node?.params?.uiScreens ?? [])
    const sameVersion = node?.params?.uiSplitGraphVersion === UI_SPLIT_INNER_GRAPH_VERSION
    if (screens.length && node && !sameScreens) {
      const summary = screens.map((s, i) => `${i + 1}. ${s.title}`).join('\n')
      graphEditorHosts.updateNode(props.hostId, props.nodeId, {
        uiScreens: toPlain(screens),
        text: summary
      })
    }
    if (existingSubgraphAsset && sameScreens && sameVersion) {
      const savedMode = (existingSubgraphAsset.genParams as { uiComposeMode?: string } | undefined)
        ?.uiComposeMode
      activeComposeMode.value = savedMode === 'atlas_compose' ? 'atlas_compose' : 'ai_generate'
      innerAssetId.value = existingSubgraphAsset.id
      return
    }
    if (!screens.length) {
      errorText.value = t('divePipeline.uiSplit.error.noScreens')
      return
    }
    // 首次进入或界面变更重建时，提示用户选择「完全 AI 生成」还是「使用已有图集拼装」
    awaitingModeChoice.value = true
  } catch (err) {
    errorText.value = err instanceof Error ? err.message : String(err)
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.ui-split-dive {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.hint {
  color: var(--text-muted);
  padding: 16px;
  font-size: 13px;
}
.mode-choice-overlay {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.mode-choice-card {
  max-width: 640px;
  width: 100%;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.mode-choice-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--text);
}
.mode-choice-desc {
  margin: 0;
  font-size: 13px;
  color: var(--text-muted);
  line-height: 1.5;
}
.mode-choice-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 4px;
}
.mode-choice-btn {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  padding: 16px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--input-bg);
  color: var(--text);
  text-align: left;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    transform 0.15s ease;
}
.mode-choice-btn:hover {
  border-color: var(--accent);
  transform: translateY(-1px);
}
.mode-icon {
  font-size: 20px;
}
.mode-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}
.mode-sub {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.45;
}
.ui-mode-switch-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  background: var(--bg-elevated);
  border-bottom: 1px solid var(--border);
  font-size: 12px;
}
.switch-label {
  color: var(--text-muted);
  font-weight: 500;
}
.switch-chip {
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--input-bg);
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
}
.switch-chip.active {
  border-color: var(--accent);
  color: var(--text);
  font-weight: 600;
}
</style>
