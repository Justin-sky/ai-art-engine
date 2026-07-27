<template>
  <!-- 独立渲染层：只在 Dialog 状态变化时更新，不牵连节点图画布 -->
  <GraphTextNotepadDialog
    v-if="api.notepad.open"
    :open="true"
    :title="api.notepad.title"
    :text="api.notepad.text"
    :editable="api.notepad.editable"
    @close="api.closeTextNotepad"
    @save="api.saveTextNotepad"
  />

  <GraphSelectImageDialog
    v-if="api.selectImage.open"
    :open="true"
    :title="api.selectImage.title"
    :items="api.selectImage.items as never"
    :selected-image-id="api.selectImage.selectedImageId"
    @close="api.closeSelectImage"
    @save="api.saveSelectImage"
  />

  <GraphSelectVideoDialog
    v-if="api.selectVideo.open"
    :open="true"
    :title="api.selectVideo.title"
    :items="api.selectVideo.items as never"
    :selected-video-id="api.selectVideo.selectedVideoId"
    @close="api.closeSelectVideo"
    @save="api.saveSelectVideo"
  />

  <GraphSelectVoiceDialog
    v-if="api.selectVoice.open"
    :open="true"
    :title="api.selectVoice.title"
    :items="api.selectVoice.items as never"
    :selected-voice-id="api.selectVoice.selectedVoiceId"
    @close="api.closeSelectVoice"
    @save="api.saveSelectVoice"
  />

  <GraphSelectTextDialog
    v-if="api.selectText.open"
    :open="true"
    :title="api.selectText.title"
    :items="api.selectText.items as never"
    :selected-text-id="api.selectText.selectedTextId"
    @close="api.closeSelectText"
    @save="api.saveSelectText"
  />

  <GraphTextsPreviewDialog
    v-if="api.textsPreview.open"
    :open="true"
    :title="api.textsPreview.title"
    :items="api.textsPreview.items as never"
    @close="api.closeTextsPreview"
  />

  <MultiAngleEditorDialog
    v-if="api.multiAngle.open"
    :open="true"
    :preview-url="api.multiAngle.previewUrl"
    :camera="api.multiAngle.camera"
    :panel-prompt="api.multiAngle.panelPrompt"
    @close="api.closeMultiAngle"
    @save="api.saveMultiAngle as never"
  />

  <LightingEditorDialog
    v-if="api.lighting.open"
    :open="true"
    :preview-url="api.lighting.previewUrl"
    :setup="api.lighting.setup"
    @close="api.closeLighting"
    @save="api.saveLighting as never"
  />

  <PortraitTextureEditorDialog
    v-if="api.portraitTexture.open"
    :open="true"
    :setup="api.portraitTexture.setup"
    @close="api.closePortraitTexture"
    @save="api.savePortraitTexture as never"
  />

  <EmotionEditorDialog
    v-if="api.emotion.open"
    :open="true"
    :preview-url="api.emotion.previewUrl"
    :setup="api.emotion.setup"
    @close="api.closeEmotion"
    @save="api.saveEmotion as never"
  />

  <UpscaleEditorDialog
    v-if="api.upscale.open"
    :open="true"
    :setup="api.upscale.setup"
    :generate-model="api.upscale.generateModel"
    :generate-provider-instance-id="api.upscale.generateProviderInstanceId"
    @close="api.closeUpscale"
    @save="api.saveUpscale as never"
  />

  <ExpandEditorDialog
    v-if="api.expand.open"
    :open="true"
    :setup="api.expand.setup"
    :source-url="api.expand.sourceUrl"
    :source-loading="api.expand.sourceLoading"
    :generate-model="api.expand.generateModel"
    :generate-provider-instance-id="api.expand.generateProviderInstanceId"
    @close="api.closeExpand"
    @save="api.saveExpand as never"
  />

  <RedrawEditorDialog
    v-if="api.redraw.open"
    :open="true"
    mode="redraw"
    :setup="api.redraw.setup"
    :source-url="api.redraw.sourceUrl"
    :source-loading="api.redraw.sourceLoading"
    :generate-model="api.redraw.generateModel"
    :generate-provider-instance-id="api.redraw.generateProviderInstanceId"
    @close="api.closeRedraw"
    @save="api.saveRedraw as never"
  />

  <RedrawEditorDialog
    v-if="api.erase.open"
    :open="true"
    mode="erase"
    :setup="api.erase.setup"
    :source-url="api.erase.sourceUrl"
    :source-loading="api.erase.sourceLoading"
    :generate-model="api.erase.generateModel"
    :generate-provider-instance-id="api.erase.generateProviderInstanceId"
    @close="api.closeErase"
    @save="api.saveErase as never"
  />

  <RedrawEditorDialog
    v-if="api.matte.open"
    :open="true"
    mode="matte"
    :setup="api.matte.setup"
    :source-url="api.matte.sourceUrl"
    :source-loading="api.matte.sourceLoading"
    :generate-model="api.matte.generateModel"
    :generate-provider-instance-id="api.matte.generateProviderInstanceId"
    @close="api.closeMatte"
    @save="api.saveMatte as never"
  />

  <CropEditorDialog
    v-if="api.crop.open"
    :open="true"
    :setup="api.crop.setup"
    :source-url="api.crop.sourceUrl"
    :source-loading="api.crop.sourceLoading"
    @close="api.closeCrop"
    @save="api.saveCrop as never"
  />

  <GridSplitEditorDialog
    v-if="api.gridSplit.open"
    :open="true"
    :setup="api.gridSplit.setup"
    :source-url="api.gridSplit.sourceUrl"
    :source-loading="api.gridSplit.sourceLoading"
    :generate-model="api.gridSplit.generateModel"
    :generate-provider-instance-id="api.gridSplit.generateProviderInstanceId"
    @close="api.closeGridSplit"
    @save="api.saveGridSplit as never"
  />
</template>

<script setup lang="ts">
import { inject } from 'vue'
import { graphEditorDialogsKey } from '../features/graph/ui/graphEditorDialogsKey'
import GraphTextNotepadDialog from './GraphTextNotepadDialog.vue'
import GraphSelectImageDialog from './GraphSelectImageDialog.vue'
import GraphSelectVideoDialog from './GraphSelectVideoDialog.vue'
import GraphSelectVoiceDialog from './GraphSelectVoiceDialog.vue'
import GraphSelectTextDialog from './GraphSelectTextDialog.vue'
import GraphTextsPreviewDialog from './GraphTextsPreviewDialog.vue'
import MultiAngleEditorDialog from './MultiAngleEditorDialog.vue'
import LightingEditorDialog from './LightingEditorDialog.vue'
import PortraitTextureEditorDialog from './PortraitTextureEditorDialog.vue'
import EmotionEditorDialog from './EmotionEditorDialog.vue'
import UpscaleEditorDialog from './UpscaleEditorDialog.vue'
import ExpandEditorDialog from './ExpandEditorDialog.vue'
import RedrawEditorDialog from './RedrawEditorDialog.vue'
import CropEditorDialog from './CropEditorDialog.vue'
import GridSplitEditorDialog from './GridSplitEditorDialog.vue'

const api = inject(graphEditorDialogsKey)
if (!api) {
  throw new Error('NodeGraphEditorDialogLayer requires graphEditorDialogsKey')
}
</script>
