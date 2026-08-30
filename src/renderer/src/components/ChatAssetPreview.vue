<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import ModelPreview from './ModelPreview.vue'
import {
  resolveAssetFileUrl,
  resolveAssetPreviewUrl
} from '../features/media/assetUrlCache'
import { openFullImagePreview } from '../features/media/openFullImagePreview'

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'])
const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'mkv', 'm4v'])
const AUDIO_EXTS = new Set(['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'])
const MODEL_EXTS = new Set(['glb', 'gltf'])

type PreviewKind = 'image' | 'video' | 'audio' | 'model' | 'file'

const props = defineProps<{ relativePath: string }>()

/** 按文件扩展名推断预览类型；未知类型降级为纯文本路径 */
const kind = computed<PreviewKind>(() => {
  const ext = (props.relativePath.split('.').pop() ?? '').toLowerCase()
  if (IMAGE_EXTS.has(ext)) return 'image'
  if (VIDEO_EXTS.has(ext)) return 'video'
  if (AUDIO_EXTS.has(ext)) return 'audio'
  if (MODEL_EXTS.has(ext)) return 'model'
  return 'file'
})

const fileUrl = ref('')
const previewUrl = ref('')
/** 是否已完成 URL 解析尝试（无论成败），用于区分「解析中」与「解析失败」 */
const resolved = ref(false)
let disposed = false

onMounted(async () => {
  // 3D 模型由 ModelPreview 自行加载；未知类型不需要媒体 URL
  if (kind.value === 'model' || kind.value === 'file') return
  try {
    fileUrl.value = await resolveAssetFileUrl(props.relativePath)
    if (disposed) return
    if (kind.value === 'image' || kind.value === 'video') {
      previewUrl.value = await resolveAssetPreviewUrl(props.relativePath)
    }
  } catch {
    // 解析失败：fileUrl / previewUrl 保持空串，模板降级为路径文本
  } finally {
    if (!disposed) resolved.value = true
  }
})

onBeforeUnmount(() => {
  disposed = true
})

/** 图片点击：复用资产全图预览弹窗 */
async function onImageClick(): Promise<void> {
  await openFullImagePreview({
    relativePath: props.relativePath,
    title: props.relativePath
  })
}
</script>

<template>
  <div class="chat-asset-preview">
    <template v-if="kind === 'image'">
      <img
        v-if="fileUrl"
        class="chat-asset-media"
        :src="previewUrl || fileUrl"
        alt=""
        @click="onImageClick"
      />
      <span v-else-if="resolved" class="chat-asset-file">{{ props.relativePath }}</span>
    </template>
    <video
      v-else-if="kind === 'video'"
      class="chat-asset-media"
      :src="fileUrl"
      :poster="previewUrl || undefined"
      controls
    />
    <audio v-else-if="kind === 'audio'" class="chat-asset-audio" :src="fileUrl" controls />
    <ModelPreview v-else-if="kind === 'model'" :relative-path="props.relativePath" />
    <span v-else class="chat-asset-file">{{ props.relativePath }}</span>
  </div>
</template>

<style scoped>
.chat-asset-preview {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  min-width: 0;
}

.chat-asset-media {
  display: block;
  max-width: 100%;
  max-height: 260px;
  border-radius: 6px;
  background: var(--graph-preview-bg);
  user-select: none;
  -webkit-user-select: none;
}

/* 媒体 URL 尚未就绪时隐藏空元素，避免出现破图占位 */
.chat-asset-media[src=''] {
  display: none;
}

img.chat-asset-media {
  cursor: zoom-in;
}

.chat-asset-audio {
  width: 100%;
  height: 32px;
}

.chat-asset-file {
  font-size: 11px;
  color: var(--text-muted);
  word-break: break-all;
}
</style>
