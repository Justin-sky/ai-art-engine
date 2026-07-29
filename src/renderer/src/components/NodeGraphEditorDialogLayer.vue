<template>
  <!-- 选取器 + 文本预览/记事本走浮动弹窗；图片编辑 / 多角度等由 Dive 内嵌 -->
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

  <GraphTextNotepadDialog
    v-if="api.notepad.open"
    :open="true"
    :title="api.notepad.title"
    :text="api.notepad.text"
    :editable="api.notepad.editable"
    @close="api.closeTextNotepad"
    @save="api.saveTextNotepad"
  />
</template>

<script setup lang="ts">
import { inject } from 'vue'
import { graphEditorDialogsKey } from '../features/graph/ui/graphEditorDialogsKey'
import GraphSelectImageDialog from './GraphSelectImageDialog.vue'
import GraphSelectVideoDialog from './GraphSelectVideoDialog.vue'
import GraphSelectVoiceDialog from './GraphSelectVoiceDialog.vue'
import GraphSelectTextDialog from './GraphSelectTextDialog.vue'
import GraphTextsPreviewDialog from './GraphTextsPreviewDialog.vue'
import GraphTextNotepadDialog from './GraphTextNotepadDialog.vue'

const api = inject(graphEditorDialogsKey)
if (!api) {
  throw new Error('NodeGraphEditorDialogLayer requires graphEditorDialogsKey')
}
</script>
