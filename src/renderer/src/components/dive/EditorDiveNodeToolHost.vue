<template>
  <div v-if="api" class="dive-node-tool">
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

    <PortraitTextureEditorDialog
      v-else-if="viewId === 'node.portraitTexture' && api.portraitTexture.open"
      :open="true"
      :setup="api.portraitTexture.setup"
      :generate-model="api.portraitTexture.generateModel"
      :generate-provider-instance-id="api.portraitTexture.generateProviderInstanceId"
      @close="onClose(api.closePortraitTexture)"
      @update="api.previewPortraitTexture as never"
      @save="api.savePortraitTexture as never"
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

    <ExpandEditorDialog
      v-else-if="viewId === 'node.expand' && api.expand.open"
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
      v-else-if="viewId === 'node.redraw' && api.redraw.open"
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
      v-else-if="viewId === 'node.erase' && api.erase.open"
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
      v-else-if="viewId === 'node.matte' && api.matte.open"
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
      v-else-if="viewId === 'node.crop' && api.crop.open"
      :open="true"
      :setup="api.crop.setup"
      :source-url="api.crop.sourceUrl"
      :source-loading="api.crop.sourceLoading"
      @close="onClose(api.closeCrop)"
      @update="api.previewCrop as never"
      @save="api.saveCrop as never"
    />

    <GridSplitEditorDialog
      v-else-if="viewId === 'node.gridSplit' && api.gridSplit.open"
      :open="true"
      :setup="api.gridSplit.setup"
      :source-url="api.gridSplit.sourceUrl"
      :source-loading="api.gridSplit.sourceLoading"
      @close="onClose(api.closeGridSplit)"
      @update="api.previewGridSplit as never"
      @save="api.saveGridSplit as never"
    />

    <p v-else-if="ready" class="missing">{{ t('studio.dive.toolMissing') }}</p>
  </div>
  <p v-else-if="ready" class="missing">{{ t('studio.dive.toolMissing') }}</p>
</template>

<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import {
  editorDiveKey,
  type EditorDiveNodeToolViewId
} from '../../features/graph/model/editorDive'
import { editorDiveEmbeddedKey } from '../../features/graph/ui/editorDiveEmbeddedKey'
import { graphEditorNodeTools } from '../../features/graph/ui/graphEditorNodeTools'
import { useStudioI18n } from '../../composables/useStudioI18n'
import GraphTextNotepadDialog from '../GraphTextNotepadDialog.vue'
import GraphSelectImageDialog from '../GraphSelectImageDialog.vue'
import GraphSelectVideoDialog from '../GraphSelectVideoDialog.vue'
import GraphSelectVoiceDialog from '../GraphSelectVoiceDialog.vue'
import GraphSelectTextDialog from '../GraphSelectTextDialog.vue'
import GraphTextsPreviewDialog from '../GraphTextsPreviewDialog.vue'
import MultiAngleEditorDialog from '../MultiAngleEditorDialog.vue'
import LightingEditorDialog from '../LightingEditorDialog.vue'
import FramePullEditorDialog from '../FramePullEditorDialog.vue'
import PortraitTextureEditorDialog from '../PortraitTextureEditorDialog.vue'
import EmotionEditorDialog from '../EmotionEditorDialog.vue'
import ExpandEditorDialog from '../ExpandEditorDialog.vue'
import RedrawEditorDialog from '../RedrawEditorDialog.vue'
import CropEditorDialog from '../CropEditorDialog.vue'
import GridSplitEditorDialog from '../GridSplitEditorDialog.vue'

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

const ready = ref(false)
const host = computed(() => {
  // 宿主编辑器可能在工具视图之后才挂载（子图 dive 场景），订阅版本号保证重新读取
  void graphEditorNodeTools.revision.value
  return graphEditorNodeTools.get(props.hostId)
})
const api = computed(() => host.value?.api ?? null)

let closing = false

const toolOpen = computed(() => {
  const current = api.value
  if (!current) return false
  switch (props.viewId) {
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
    case 'node.lighting':
      return current.lighting.open
    case 'node.framePull':
      return current.framePull.open
    case 'node.portraitTexture':
      return current.portraitTexture.open
    case 'node.emotion':
      return current.emotion.open
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
    case 'node.gridSplit':
      return current.gridSplit.open
    default:
      return false
  }
})

onMounted(async () => {
  // 节点卡已预先打开工具状态时，只需等待宿主注册即可直接展示
  if (toolOpen.value) {
    ready.value = true
    return
  }
  const opened = await graphEditorNodeTools.open(
    props.hostId,
    props.viewId,
    props.nodeId,
    props.mode
  )
  if (!opened) {
    console.warn('[dive-node-tool] opener missing', props.viewId, props.hostId, props.nodeId)
  }
  ready.value = true
})

watch(toolOpen, (open) => {
  if (!ready.value || open || closing) return
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
  switch (props.viewId) {
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
    case 'node.lighting':
      current.closeLighting()
      break
    case 'node.framePull':
      current.closeFramePull()
      break
    case 'node.portraitTexture':
      current.closePortraitTexture()
      break
    case 'node.emotion':
      current.closeEmotion()
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
    case 'node.gridSplit':
      current.closeGridSplit()
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
.missing {
  margin: 24px;
  color: var(--text-muted);
  font-size: 13px;
}
</style>
