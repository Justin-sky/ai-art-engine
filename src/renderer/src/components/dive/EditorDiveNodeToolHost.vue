<template>
  <div v-if="api" class="dive-node-tool" :data-tutorial-id="tutorialDiveViewId(activeViewId)">
    <div v-if="isImageProcessToolView" class="image-process-tool-bar" role="tablist">
      <button
        v-for="tab in IMAGE_PROCESS_TOOL_TABS"
        :key="tab.tool"
        type="button"
        role="tab"
        class="image-process-tool-tab"
        :class="{ active: activeViewId === tab.viewId }"
        :aria-selected="activeViewId === tab.viewId"
        @click="switchImageProcessTool(tab)"
      >
        {{ t(tab.labelKey) }}
      </button>
    </div>

    <div class="dive-node-tool-body">
      <GraphTextNotepadDialog
        v-if="viewId === 'node.notepad' && api.notepad.open"
        :open="true"
        :title="api.notepad.title"
        :text="api.notepad.text"
        :editable="api.notepad.editable"
        @close="onClose(api.closeTextNotepad)"
        @save="api.saveTextNotepad"
      />

      <GraphSelectImageDialog
        v-else-if="viewId === 'node.selectImage' && api.selectImage.open"
        :open="true"
        :title="api.selectImage.title"
        :items="api.selectImage.items as never"
        :selected-image-id="api.selectImage.selectedImageId"
        @close="onClose(api.closeSelectImage)"
        @save="api.saveSelectImage"
      />

      <GraphSelectVideoDialog
        v-else-if="viewId === 'node.selectVideo' && api.selectVideo.open"
        :open="true"
        :title="api.selectVideo.title"
        :items="api.selectVideo.items as never"
        :selected-video-id="api.selectVideo.selectedVideoId"
        @close="onClose(api.closeSelectVideo)"
        @save="api.saveSelectVideo"
      />

      <GraphSelectVoiceDialog
        v-else-if="viewId === 'node.selectVoice' && api.selectVoice.open"
        :open="true"
        :title="api.selectVoice.title"
        :items="api.selectVoice.items as never"
        :selected-voice-id="api.selectVoice.selectedVoiceId"
        @close="onClose(api.closeSelectVoice)"
        @save="api.saveSelectVoice"
      />

      <GraphSelectTextDialog
        v-else-if="viewId === 'node.selectText' && api.selectText.open"
        :open="true"
        :title="api.selectText.title"
        :items="api.selectText.items as never"
        :selected-text-id="api.selectText.selectedTextId"
        @close="onClose(api.closeSelectText)"
        @save="api.saveSelectText"
      />

      <GraphTextsPreviewDialog
        v-else-if="viewId === 'node.textsPreview' && api.textsPreview.open"
        :open="true"
        :title="api.textsPreview.title"
        :items="api.textsPreview.items as never"
        @close="onClose(api.closeTextsPreview)"
      />

      <MultiAngleEditorDialog
        v-else-if="viewId === 'node.multiAngle' && api.multiAngle.open"
        :open="true"
        :preview-url="api.multiAngle.previewUrl"
        :camera="api.multiAngle.camera"
        :panel-prompt="api.multiAngle.panelPrompt"
        :generate-model="api.multiAngle.generateModel"
        :generate-provider-instance-id="api.multiAngle.generateProviderInstanceId"
        @close="onClose(api.closeMultiAngle)"
        @update="api.previewMultiAngle as never"
        @save="api.saveMultiAngle as never"
      />

      <AdVariantsEditorDialog
        v-else-if="viewId === 'node.adVariants' && api.adVariants.open"
        :open="true"
        :host-id="hostId"
        :node-id="nodeId"
        :matrix="api.adVariants.matrix"
        :generate-model="api.adVariants.generateModel"
        :generate-provider-instance-id="api.adVariants.generateProviderInstanceId"
        @close="onClose(api.closeAdVariants)"
        @save="api.saveAdVariants as never"
      />

      <LightingEditorDialog
        v-else-if="viewId === 'node.lighting' && api.lighting.open"
        :open="true"
        :preview-url="api.lighting.previewUrl"
        :setup="api.lighting.setup"
        :generate-model="api.lighting.generateModel"
        :generate-provider-instance-id="api.lighting.generateProviderInstanceId"
        @close="onClose(api.closeLighting)"
        @update="api.previewLighting as never"
        @save="api.saveLighting as never"
      />

      <FramePullEditorDialog
        v-else-if="viewId === 'node.framePull' && api.framePull.open"
        :open="true"
        :host-id="api.framePull.hostId"
        :node-id="api.framePull.nodeId"
        @close="onClose(api.closeFramePull)"
      />

      <ReshootEditorDialog
        v-else-if="viewId === 'node.reshoot' && api.reshoot.open"
        :open="true"
        :host-id="api.reshoot.hostId"
        :node-id="api.reshoot.nodeId"
        @close="onClose(api.closeReshoot)"
      />

      <PortraitTextureEditorDialog
        v-else-if="viewId === 'node.portraitTexture' && api.portraitTexture.open"
        :open="true"
        :setup="api.portraitTexture.setup"
        :source-url="api.portraitTexture.sourceUrl"
        :source-loading="api.portraitTexture.sourceLoading"
        :generate-model="api.portraitTexture.generateModel"
        :generate-provider-instance-id="api.portraitTexture.generateProviderInstanceId"
        @close="onClose(api.closePortraitTexture)"
        @update="api.previewPortraitTexture as never"
        @save="api.savePortraitTexture as never"
      />

      <PortraitEditorDialog
        v-else-if="viewId === 'node.portrait' && api.portrait.open"
        :open="true"
        :host-id="hostId"
        :node-id="nodeId"
        :setup="api.portrait.setup"
        :regions="api.portrait.regions"
        :layers="api.portrait.layers"
        :base-layer-id="api.portrait.baseLayerId"
        :source-url="api.portrait.sourceUrl"
        :upstream-url="api.portrait.upstreamUrl"
        :source-loading="api.portrait.sourceLoading"
        :generate-model="api.portrait.generateModel"
        :generate-provider-instance-id="api.portrait.generateProviderInstanceId"
        :scope-mode="api.portrait.scopeMode"
        :chain-from-output="api.portrait.chainFromOutput"
        :ai-running="api.portrait.aiRunning"
        :ai-error="api.portrait.aiError"
        :run-running="api.portrait.runRunning"
        :run-error="api.portrait.runError"
        @close="onClose(api.closePortrait)"
        @update="api.previewPortrait as never"
        @save="api.savePortrait as never"
        @run="api.runPortrait as never"
        @ai-version="api.selectPortraitVersion"
        @chain-output="api.setPortraitChainFromOutput"
        @ai="api.runPortraitAi as never"
      />

      <EmotionEditorDialog
        v-else-if="viewId === 'node.emotion' && api.emotion.open"
        :open="true"
        :preview-url="api.emotion.previewUrl"
        :setup="api.emotion.setup"
        :generate-model="api.emotion.generateModel"
        :generate-provider-instance-id="api.emotion.generateProviderInstanceId"
        @close="onClose(api.closeEmotion)"
        @update="api.previewEmotion as never"
        @save="api.saveEmotion as never"
      />

      <UpscaleEditorDialog
        v-else-if="activeViewId === 'node.upscale' && api.upscale.open"
        :open="true"
        :setup="api.upscale.setup"
        :source-url="api.upscale.sourceUrl"
        :source-loading="api.upscale.sourceLoading"
        :generate-model="api.upscale.generateModel"
        :generate-provider-instance-id="api.upscale.generateProviderInstanceId"
        :generate-instruction="api.upscale.generateInstruction"
        @close="onClose(api.closeUpscale)"
        @update="api.previewUpscale as never"
        @save="api.saveUpscale as never"
      />

      <ExpandEditorDialog
        v-else-if="activeViewId === 'node.expand' && api.expand.open"
        :open="true"
        :setup="api.expand.setup"
        :source-url="api.expand.sourceUrl"
        :source-loading="api.expand.sourceLoading"
        :generate-model="api.expand.generateModel"
        :generate-provider-instance-id="api.expand.generateProviderInstanceId"
        @close="onClose(api.closeExpand)"
        @update="api.previewExpand as never"
        @save="api.saveExpand as never"
      />

      <RedrawEditorDialog
        v-else-if="activeViewId === 'node.redraw' && api.redraw.open"
        :open="true"
        mode="redraw"
        :setup="api.redraw.setup"
        :source-url="api.redraw.sourceUrl"
        :source-loading="api.redraw.sourceLoading"
        :generate-model="api.redraw.generateModel"
        :generate-provider-instance-id="api.redraw.generateProviderInstanceId"
        @close="onClose(api.closeRedraw)"
        @update="api.previewRedraw as never"
        @save="api.saveRedraw as never"
      />

      <RedrawEditorDialog
        v-else-if="activeViewId === 'node.erase' && api.erase.open"
        :open="true"
        mode="erase"
        :setup="api.erase.setup"
        :source-url="api.erase.sourceUrl"
        :source-loading="api.erase.sourceLoading"
        :generate-model="api.erase.generateModel"
        :generate-provider-instance-id="api.erase.generateProviderInstanceId"
        @close="onClose(api.closeErase)"
        @update="api.previewErase as never"
        @save="api.saveErase as never"
      />

      <RedrawEditorDialog
        v-else-if="activeViewId === 'node.matte' && api.matte.open"
        :open="true"
        mode="matte"
        :setup="api.matte.setup"
        :source-url="api.matte.sourceUrl"
        :source-loading="api.matte.sourceLoading"
        :generate-model="api.matte.generateModel"
        :generate-provider-instance-id="api.matte.generateProviderInstanceId"
        @close="onClose(api.closeMatte)"
        @update="api.previewMatte as never"
        @save="api.saveMatte as never"
      />

      <CropEditorDialog
        v-else-if="activeViewId === 'node.crop' && api.crop.open"
        :open="true"
        :setup="api.crop.setup"
        :source-url="api.crop.sourceUrl"
        :source-loading="api.crop.sourceLoading"
        @close="onClose(api.closeCrop)"
        @update="api.previewCrop as never"
        @save="api.saveCrop as never"
      />

      <ImageTransformEditorDialog
        v-else-if="activeViewId === 'node.transform' && api.transform.open"
        :open="true"
        :setup="api.transform.setup"
        :source-url="api.transform.sourceUrl"
        :source-loading="api.transform.sourceLoading"
        @close="onClose(api.closeTransform)"
        @update="api.previewTransform as never"
        @save="api.saveTransform as never"
      />

      <GridSplitEditorDialog
        v-else-if="activeViewId === 'node.gridSplit' && api.gridSplit.open"
        :open="true"
        :setup="api.gridSplit.setup"
        :source-url="api.gridSplit.sourceUrl"
        :source-loading="api.gridSplit.sourceLoading"
        :host-id="hostId"
        :node-id="nodeId"
        @close="onClose(api.closeGridSplit)"
        @update="api.previewGridSplit as never"
        @save="api.saveGridSplit as never"
      />

      <IconPackEditorDialog
        v-else-if="activeViewId === 'node.iconPack' && api.iconPack.open"
        :open="true"
        :setup="api.iconPack.setup"
        :source-url="api.iconPack.sourceUrl"
        :source-loading="api.iconPack.sourceLoading"
        @close="onClose(api.closeIconPack)"
        @update="api.previewIconPack as never"
        @save="api.saveIconPack as never"
      />

      <CutoutNodeToolDialog
        v-else-if="activeViewId === 'node.cutout' && api.cutout.open"
        :open="true"
        :setup="api.cutout.setup"
        :source-url="api.cutout.sourceUrl"
        :source-loading="api.cutout.sourceLoading"
        @close="onClose(api.closeCutout)"
        @save="api.saveCutout as never"
      />

      <ComposeNodeToolDialog
        v-else-if="activeViewId === 'node.compose' && api.compose.open"
        :open="true"
        :setup="api.compose.setup"
        :source-url="api.compose.sourceUrl"
        :source-loading="api.compose.sourceLoading"
        @close="onClose(api.closeCompose)"
        @save="api.saveCompose as never"
      />

      <AlignNodeToolDialog
        v-else-if="activeViewId === 'node.align' && api.align.open"
        :open="true"
        :setup="api.align.setup"
        :source-url="api.align.sourceUrl"
        :source-loading="api.align.sourceLoading"
        @close="onClose(api.closeAlign)"
        @save="api.saveAlign as never"
      />

      <Stage2dNodeToolDialog
        v-else-if="activeViewId === 'node.stage2d' && api.stage2d.open"
        :open="true"
        :setup="api.stage2d.setup"
        :setup-rig="api.stage2d.setupRig"
        :setup-pose="api.stage2d.setupPose"
        :setup-action="api.stage2d.setupAction"
        :setup-anim-fps="api.stage2d.setupAnimFps"
        :setup-anim-frame-count="api.stage2d.setupAnimFrameCount"
        :setup-anim-sheet-path="api.stage2d.setupAnimSheetPath"
        @close="onClose(api.closeStage2d)"
        @save="api.saveStage2d as never"
        @export-frames="api.exportStage2dFrames as never"
      />

      <LayerSplitEditorDialog
        v-else-if="activeViewId === 'node.layerSplit' && api.layerSplit.open"
        :open="true"
        :setup="api.layerSplit.setup"
        :source-url="api.layerSplit.sourceUrl"
        :source-loading="api.layerSplit.sourceLoading"
        :layer-urls="api.layerSplit.layerUrls"
        :generate-model="api.layerSplit.generateModel"
        :generate-provider-instance-id="api.layerSplit.generateProviderInstanceId"
        :splitting="api.layerSplit.splitting"
        :split-error="api.layerSplit.splitError"
        @close="onClose(api.closeLayerSplit)"
        @update="api.previewLayerSplit as never"
        @save="api.saveLayerSplit as never"
        @split-selected="api.splitSelectedLayerSplit as never"
      />

      <p v-else-if="ready" class="missing">
        {{ t('studio.dive.toolMissing') }}
      </p>
    </div>
  </div>
  <p v-else-if="ready" class="missing">
    {{ t('studio.dive.toolMissing') }}
  </p>
</template>

<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import type { ImageProcessToolId } from '@shared/graph'
import { editorDiveKey, type EditorDiveNodeToolViewId } from '../../features/graph/model/editorDive'
import { graphEditorHosts } from '../../features/graph/model/graphEditorHosts'
import { editorDiveEmbeddedKey } from '../../features/graph/ui/editorDiveEmbeddedKey'
import { tutorialDiveViewId, tutorialFloatingIdKey } from '@shared/tutorialUi'
import { graphEditorNodeTools } from '../../features/graph/ui/graphEditorNodeTools'
import { useEditorDiveFrameFlush } from '../../composables/useEditorDiveFrameFlush'
import { useStudioI18n } from '../../composables/useStudioI18n'
import GraphTextNotepadDialog from '../GraphTextNotepadDialog.vue'
import GraphSelectImageDialog from '../GraphSelectImageDialog.vue'
import GraphSelectVideoDialog from '../GraphSelectVideoDialog.vue'
import GraphSelectVoiceDialog from '../GraphSelectVoiceDialog.vue'
import GraphSelectTextDialog from '../GraphSelectTextDialog.vue'
import GraphTextsPreviewDialog from '../GraphTextsPreviewDialog.vue'
import MultiAngleEditorDialog from '../MultiAngleEditorDialog.vue'
import AdVariantsEditorDialog from '../AdVariantsEditorDialog.vue'
import LightingEditorDialog from '../LightingEditorDialog.vue'
import FramePullEditorDialog from '../FramePullEditorDialog.vue'
import ReshootEditorDialog from '../ReshootEditorDialog.vue'
import PortraitTextureEditorDialog from '../PortraitTextureEditorDialog.vue'
import PortraitEditorDialog from '../PortraitEditorDialog.vue'
import EmotionEditorDialog from '../EmotionEditorDialog.vue'
import UpscaleEditorDialog from '../UpscaleEditorDialog.vue'
import ExpandEditorDialog from '../ExpandEditorDialog.vue'
import RedrawEditorDialog from '../RedrawEditorDialog.vue'
import CropEditorDialog from '../CropEditorDialog.vue'
import ImageTransformEditorDialog from '../ImageTransformEditorDialog.vue'
import GridSplitEditorDialog from '../GridSplitEditorDialog.vue'
import IconPackEditorDialog from '../IconPackEditorDialog.vue'
import LayerSplitEditorDialog from '../LayerSplitEditorDialog.vue'
import CutoutNodeToolDialog from '../CutoutNodeToolDialog.vue'
import ComposeNodeToolDialog from '../ComposeNodeToolDialog.vue'
import AlignNodeToolDialog from '../AlignNodeToolDialog.vue'
import Stage2dNodeToolDialog from '../Stage2dNodeToolDialog.vue'

interface ImageProcessToolTab {
  tool: ImageProcessToolId
  viewId: EditorDiveNodeToolViewId
  labelKey: string
}

const IMAGE_PROCESS_TOOL_TABS: readonly ImageProcessToolTab[] = [
  { tool: 'crop', viewId: 'node.crop', labelKey: 'graph.types.image.crop' },
  { tool: 'transform', viewId: 'node.transform', labelKey: 'graph.types.image.transform' },
  { tool: 'compose', viewId: 'node.compose', labelKey: 'graph.types.image.compose' },
  { tool: 'gridSplit', viewId: 'node.gridSplit', labelKey: 'graph.types.image.gridSplit' },
  { tool: 'cutout', viewId: 'node.cutout', labelKey: 'graph.types.image.cutout' },
  { tool: 'matte', viewId: 'node.matte', labelKey: 'graph.types.image.matte' },
  { tool: 'erase', viewId: 'node.erase', labelKey: 'graph.types.image.erase' },
  { tool: 'redraw', viewId: 'node.redraw', labelKey: 'graph.types.image.redraw' },
  { tool: 'expand', viewId: 'node.expand', labelKey: 'graph.types.image.expand' },
  { tool: 'upscale', viewId: 'node.upscale', labelKey: 'graph.types.image.upscale' }
]

const IMAGE_PROCESS_VIEW_SET = new Set<EditorDiveNodeToolViewId>(
  IMAGE_PROCESS_TOOL_TABS.map((item) => item.viewId)
)

const props = defineProps<{
  frameKey: string
  viewId: EditorDiveNodeToolViewId
  hostId: string
  nodeId: string
  mode?: string
}>()

const { t } = useStudioI18n()
const editorDive = inject(editorDiveKey, null)
provide(editorDiveEmbeddedKey, true)

const activeViewId = ref<EditorDiveNodeToolViewId>(props.viewId)
watch(
  () => props.viewId,
  (next) => {
    activeViewId.value = next
  }
)

const isImageProcessToolView = computed(() => IMAGE_PROCESS_VIEW_SET.has(activeViewId.value))

/** Teleport 浮窗仍能 inject 到当前 dive 工具 view id */
const floatingTutorialId = computed(() => tutorialDiveViewId(activeViewId.value))
provide(tutorialFloatingIdKey, floatingTutorialId)

const ready = ref(false)
const host = computed(() => {
  // 宿主编辑器可能在工具视图之后才挂载（子图 dive 场景），订阅版本号保证重新读取
  void graphEditorNodeTools.revision.value
  return graphEditorNodeTools.get(props.hostId)
})
const api = computed(() => host.value?.api ?? null)

let closing = false
let switchingTool = false

const toolOpen = computed(() => {
  const current = api.value
  if (!current) return false
  switch (activeViewId.value) {
    case 'node.notepad':
      return current.notepad.open
    case 'node.selectImage':
      return current.selectImage.open
    case 'node.selectVideo':
      return current.selectVideo.open
    case 'node.selectVoice':
      return current.selectVoice.open
    case 'node.selectText':
      return current.selectText.open
    case 'node.textsPreview':
      return current.textsPreview.open
    case 'node.multiAngle':
      return current.multiAngle.open
    case 'node.adVariants':
      return current.adVariants.open
    case 'node.lighting':
      return current.lighting.open
    case 'node.framePull':
      return current.framePull.open
    case 'node.reshoot':
      return current.reshoot.open
    case 'node.portraitTexture':
      return current.portraitTexture.open
    case 'node.emotion':
      return current.emotion.open
    case 'node.upscale':
      return current.upscale.open
    case 'node.expand':
      return current.expand.open
    case 'node.redraw':
      return current.redraw.open
    case 'node.erase':
      return current.erase.open
    case 'node.matte':
      return current.matte.open
    case 'node.crop':
      return current.crop.open
    case 'node.transform':
      return current.transform.open
    case 'node.gridSplit':
      return current.gridSplit.open
    case 'node.iconPack':
      return current.iconPack.open
    case 'node.layerSplit':
      return current.layerSplit.open
    case 'node.cutout':
      return current.cutout.open
    case 'node.compose':
      return current.compose.open
    case 'node.align':
      return current.align.open
    case 'node.portrait':
      return current.portrait.open
    case 'node.stage2d':
      return current.stage2d.open
    default:
      return false
  }
})

function flushCurrent(): void {
  const current = api.value
  if (!current) return
  switch (activeViewId.value) {
    case 'node.layerSplit':
      current.flushLayerSplit()
      break
    case 'node.crop':
      current.flushCrop()
      break
    case 'node.transform':
      current.flushTransform()
      break
    case 'node.portrait':
      current.flushPortrait()
      break
    case 'node.gridSplit':
      current.flushGridSplit()
      break
    case 'node.iconPack':
      current.flushIconPack()
      break
    case 'node.cutout':
      current.flushCutout()
      break
    case 'node.compose':
      current.flushCompose()
      break
    case 'node.align':
      current.flushAlign()
      break
    case 'node.stage2d':
      current.flushStage2d()
      break
    default:
      break
  }
}

// 面包屑回退 / 下钻会先触发 flushTop：在宿主帧卸载前把实时预览的编辑提交进撤销栈。
// 图层拆分靠 previewLayerSplit 实时改写节点，但仅弹窗 onClose 才记录撤销命令，
// 而嵌入式（dive）下没有关闭按钮，回退时弹窗被直接卸载，命令因此丢失 → 主界面 undo/redo 失效。
useEditorDiveFrameFlush(
  () => props.frameKey,
  () => {
    flushCurrent()
  }
)

async function switchImageProcessTool(tab: ImageProcessToolTab): Promise<void> {
  if (tab.viewId === activeViewId.value || switchingTool) return
  switchingTool = true
  try {
    flushCurrent()
    closeCurrent()
    graphEditorHosts.updateNode(props.hostId, props.nodeId, {
      imageProcessTool: tab.tool
    })
    activeViewId.value = tab.viewId
    await graphEditorNodeTools.open(props.hostId, tab.viewId, props.nodeId)
  } finally {
    switchingTool = false
  }
}

onMounted(async () => {
  // 节点卡已预先打开工具状态时，只需等待宿主注册即可直接展示
  if (toolOpen.value) {
    ready.value = true
    return
  }
  const opened = await graphEditorNodeTools.open(
    props.hostId,
    activeViewId.value,
    props.nodeId,
    props.mode
  )
  if (!opened) {
    console.warn('[dive-node-tool] opener missing', activeViewId.value, props.hostId, props.nodeId)
  }
  ready.value = true
})

watch(toolOpen, (open) => {
  if (!ready.value || open || closing || switchingTool) return
  popSelf()
})

onBeforeUnmount(() => {
  if (closing) return
  closeCurrent()
})

function popSelf(): void {
  if (closing) return
  closing = true
  if (!editorDive) return
  const idx = editorDive.frames.findIndex((frame) => frame.key === props.frameKey)
  editorDive.popTo(idx < 0 ? -1 : idx - 1)
}

function closeCurrent(): void {
  const current = api.value
  if (!current) return
  switch (activeViewId.value) {
    case 'node.notepad':
      current.closeTextNotepad()
      break
    case 'node.selectImage':
      current.closeSelectImage()
      break
    case 'node.selectVideo':
      current.closeSelectVideo()
      break
    case 'node.selectVoice':
      current.closeSelectVoice()
      break
    case 'node.selectText':
      current.closeSelectText()
      break
    case 'node.textsPreview':
      current.closeTextsPreview()
      break
    case 'node.multiAngle':
      current.closeMultiAngle()
      break
    case 'node.adVariants':
      current.closeAdVariants()
      break
    case 'node.lighting':
      current.closeLighting()
      break
    case 'node.framePull':
      current.closeFramePull()
      break
    case 'node.reshoot':
      current.closeReshoot()
      break
    case 'node.portraitTexture':
      current.closePortraitTexture()
      break
    case 'node.portrait':
      current.closePortrait()
      break
    case 'node.emotion':
      current.closeEmotion()
      break
    case 'node.upscale':
      current.closeUpscale()
      break
    case 'node.expand':
      current.closeExpand()
      break
    case 'node.redraw':
      current.closeRedraw()
      break
    case 'node.erase':
      current.closeErase()
      break
    case 'node.matte':
      current.closeMatte()
      break
    case 'node.crop':
      current.closeCrop()
      break
    case 'node.transform':
      current.closeTransform()
      break
    case 'node.gridSplit':
      current.closeGridSplit()
      break
    case 'node.iconPack':
      current.closeIconPack()
      break
    case 'node.layerSplit':
      current.closeLayerSplit()
      break
    case 'node.cutout':
      current.closeCutout()
      break
    case 'node.compose':
      current.closeCompose()
      break
    case 'node.align':
      current.closeAlign()
      break
    case 'node.stage2d':
      current.closeStage2d()
      break
    default:
      break
  }
}

function onClose(closeFn: () => void): void {
  if (closing) {
    closeFn()
    return
  }
  closeFn()
  popSelf()
}
</script>

<style scoped>
.dive-node-tool {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.image-process-tool-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-panel);
  overflow-x: auto;
  flex-shrink: 0;
}

.image-process-tool-tab {
  height: 26px;
  padding: 0 10px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  white-space: nowrap;
  cursor: pointer;
  transition:
    background 0.14s ease,
    color 0.14s ease,
    border-color 0.14s ease;
}

.image-process-tool-tab:hover {
  color: var(--text);
  background: var(--bg-elevated);
}

.image-process-tool-tab.active {
  color: var(--text);
  background: var(--bg-elevated);
  border-color: var(--accent);
  font-weight: 600;
}

.dive-node-tool-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.dive-node-tool-body > :deep(*) {
  flex: 1;
  min-height: 0;
}

.missing {
  margin: 24px;
  color: var(--text-muted);
  font-size: 13px;
}
</style>
