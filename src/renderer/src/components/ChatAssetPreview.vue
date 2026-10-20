<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import ModelPreview from './ModelPreview.vue'
import {
  isAnimatedPlaybackPath,
  observeInView,
  pickChatImageSrc
} from '../features/media/animatedImagePlayback'
import { resolveAssetFileUrl, resolveAssetPreviewUrl } from '../features/media/assetUrlCache'
import { openFullImagePreview } from '../features/media/openFullImagePreview'
import {
  chatPreviewAssetType,
  chatPreviewKind,
  deliverableFormatBadge,
  type ChatPreviewKind
} from '../features/media/chatPreviewKind'
import { readGraphRunText } from '../features/graph/readGraphRunText'
import { useStudioI18n } from '../composables/useStudioI18n'

const props = defineProps<{ relativePath: string }>()

const { assetTypeLabel, locale } = useStudioI18n()
const isEn = computed(() => /^en/i.test(locale.value))

/**
 * 按文件扩展名推断预览类型（未知类型降级为纯文本路径）。
 *
 * 判据抽在 `features/media/chatPreviewKind.ts` 里，因为它踩过一个坑：
 * 原先这里只认 `['glb', 'gltf']`，而**泼溅（`.ply` / `.spz`）也能预览**
 * （`ModelPreview` → `loadModelScene` 内部按 `isSplatPath` 交给 Spark），
 * 结果泼溅产物在对话里只显示一行路径文本。所有 3D 格式都走同一个
 * `ModelPreview`，所以扩展名清单必须与它支持的格式保持一致。
 */
const kind = computed<ChatPreviewKind>(() => chatPreviewKind(props.relativePath))
const deliverableMeta = computed(() => deliverableFormatBadge(props.relativePath))
const fileShortName = computed(() => {
  const norm = (props.relativePath ?? '').replace(/\\/g, '/')
  return norm.split('/').pop() || props.relativePath
})

async function openDeliverableWithDefaultApp(): Promise<void> {
  try {
    await window.studio?.openAssetWithDefaultApp?.(props.relativePath)
  } catch {
    // ignore
  }
}

/**
 * 左上角类型徽标文案（图片 / 视频 / 声音 / 3D 模型 / 高斯泼溅 …）。
 *
 * 从扩展名派生而不是读资产记录：`ChatMsg`（`kind: 'asset'`）本就没有 `assetType` 字段，
 * 且旧会话历史也没存 —— 走扩展名才能让**刷新后的历史卡也显示徽标**。
 * 未知类型返回空串，此时模板不渲染徽标（而不是显示一个没意义的词）。
 */
const typeBadge = computed(() => {
  const assetType = chatPreviewAssetType(props.relativePath)
  return assetType ? assetTypeLabel(assetType) : ''
})

const fileUrl = ref('')
const previewUrl = ref('')
const htmlDocUrl = ref('')
/** 是否已完成 URL 解析尝试（无论成败），用于区分「解析中」与「解析失败」 */
const resolved = ref(false)
let disposed = false
let loadSeq = 0

function releaseHtmlDoc(): void {
  const url = htmlDocUrl.value
  htmlDocUrl.value = ''
  if (!url || typeof window.studio?.releaseGameplayDocument !== 'function') return
  void window.studio.releaseGameplayDocument(url).catch(() => {})
}

/** 动图（GIF）：缩略图只剩首帧，进入视口后才换原文件播动画 */
const animated = computed(() => isAnimatedPlaybackPath(props.relativePath))
const animatedVisible = ref(false)
const imageRef = ref<HTMLImageElement>()
let stopObservingView: (() => void) | null = null

/** 动图取原文件，其余仍是缩略图优先（非动图行为与改动前一致） */
const imageSrc = computed(() =>
  pickChatImageSrc({
    relativePath: props.relativePath,
    previewUrl: previewUrl.value,
    fileUrl: fileUrl.value,
    playback: animatedVisible.value
  })
)

/** 元素挂载后再观察视口，避免一屏多张动图同时解码原文件 */
function observePlayback(el: HTMLElement | null | undefined): void {
  stopObservingView?.()
  stopObservingView = null
  animatedVisible.value = false
  if (!el || !animated.value) return
  stopObservingView = observeInView(el, (visible) => {
    animatedVisible.value = visible
  })
}

watch(imageRef, observePlayback, { flush: 'post' })

async function loadPreview(): Promise<void> {
  const seq = ++loadSeq
  resolved.value = false
  releaseHtmlDoc()
  // 3D 模型由 ModelPreview 自行加载；专业交付物与未知类型不需要媒体 URL
  if (kind.value === 'model' || kind.value === 'deliverable' || kind.value === 'file') {
    resolved.value = true
    return
  }
  if (kind.value === 'html') {
    try {
      const html = await readGraphRunText(props.relativePath)
      if (disposed || seq !== loadSeq) return
      if (html.trim() && typeof window.studio?.openGameplayDocument === 'function') {
        const docUrl = await window.studio.openGameplayDocument(html)
        if (disposed || seq !== loadSeq) {
          void window.studio.releaseGameplayDocument?.(docUrl).catch(() => {})
          return
        }
        htmlDocUrl.value = docUrl
      }
    } catch {
      // 解析失败：htmlDocUrl 保持空串，模板降级为路径文本
    } finally {
      if (!disposed && seq === loadSeq) resolved.value = true
    }
    return
  }
  try {
    fileUrl.value = await resolveAssetFileUrl(props.relativePath)
    if (disposed || seq !== loadSeq) return
    if (kind.value === 'image' || kind.value === 'video') {
      previewUrl.value = await resolveAssetPreviewUrl(props.relativePath)
    }
  } catch {
    // 解析失败：fileUrl / previewUrl 保持空串，模板降级为路径文本
  } finally {
    if (!disposed && seq === loadSeq) resolved.value = true
  }
}

onMounted(() => {
  void loadPreview()
})

watch(
  () => props.relativePath,
  () => {
    void loadPreview()
  }
)

onBeforeUnmount(() => {
  disposed = true
  stopObservingView?.()
  stopObservingView = null
  releaseHtmlDoc()
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
    <!--
      左上角类型徽标：产物卡只看画面时不容易分清拿到的是网格、泼溅还是图。
      声音走原生 <audio controls>，条很矮，叠徽标会挡住播放键 —— 声音控件本身已够辨认，不贴徽标。
    -->
    <span v-if="typeBadge && kind !== 'audio'" class="chat-asset-type">{{ typeBadge }}</span>
    <template v-if="kind === 'image'">
      <img
        v-if="fileUrl"
        ref="imageRef"
        class="chat-asset-media"
        :src="imageSrc"
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
    <template v-else-if="kind === 'html'">
      <iframe
        v-if="htmlDocUrl"
        class="chat-asset-html"
        :title="props.relativePath"
        sandbox="allow-scripts allow-pointer-lock"
        :src="htmlDocUrl"
      />
      <span v-else-if="resolved" class="chat-asset-file">{{ props.relativePath }}</span>
    </template>
    <div v-else-if="kind === 'deliverable'" class="deliverable-hero-card">
      <div class="deliverable-hero-head">
        <span class="deliverable-icon" aria-hidden="true">{{ deliverableMeta.icon }}</span>
        <div class="deliverable-meta">
          <div class="deliverable-title-row">
            <span class="deliverable-code">{{ deliverableMeta.code }}</span>
            <span class="deliverable-label">
              {{ isEn ? deliverableMeta.labelEn : deliverableMeta.labelZh }}
            </span>
          </div>
          <div class="deliverable-desc">
            {{ isEn ? deliverableMeta.descEn : deliverableMeta.descZh }}
          </div>
          <div class="deliverable-filename" :title="props.relativePath">
            {{ fileShortName }}
          </div>
        </div>
      </div>
      <div class="deliverable-actions">
        <button
          type="button"
          class="deliverable-open-btn"
          @click.stop="openDeliverableWithDefaultApp"
        >
          🚀 {{ isEn ? 'Open File' : '一键打开文件' }}
        </button>
      </div>
    </div>
    <span v-else class="chat-asset-file">{{ props.relativePath }}</span>
  </div>
</template>

<style scoped>
.chat-asset-preview {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  width: 100%;
  min-width: 0;
  /* 徽标要贴在预览图左上角，所以这里做定位上下文 */
  position: relative;
}

/**
 * 类型徽标：压在预览左上角。
 *
 * 用半透明深底 + 白字，保证在亮图 / 暗图上都可读（不依赖主题变量，
 * 因为它叠在**用户生成的内容**上，而主题只保证应用自身的对比度）。
 */
.chat-asset-type {
  position: absolute;
  top: 6px;
  left: 6px;
  z-index: 1;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 10px;
  line-height: 16px;
  color: #fff;
  background: rgba(0, 0, 0, 0.55);
  pointer-events: none;
  user-select: none;
  -webkit-user-select: none;
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

.chat-asset-html {
  display: block;
  width: 100%;
  height: 280px;
  border: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
  border-radius: 6px;
  background: var(--graph-preview-bg);
}

.chat-asset-file {
  font-size: 11px;
  color: var(--text-muted);
  word-break: break-all;
}

.deliverable-hero-card {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--accent) 14%, var(--bg-elevated)),
    color-mix(in srgb, var(--bg-panel) 92%, transparent)
  );
  border: 1px solid color-mix(in srgb, var(--accent) 42%, var(--border));
}

.deliverable-hero-head {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-width: 0;
  flex: 1;
}

.deliverable-icon {
  font-size: 24px;
  line-height: 1;
  flex-shrink: 0;
  margin-top: 2px;
}

.deliverable-meta {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.deliverable-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.deliverable-code {
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 700;
  color: #fff;
  background: var(--accent);
}

.deliverable-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
}

.deliverable-desc {
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.35;
}

.deliverable-filename {
  font-size: 10px;
  color: var(--text-muted);
  opacity: 0.85;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.deliverable-actions {
  flex-shrink: 0;
}

.deliverable-open-btn {
  padding: 5px 10px;
  border-radius: 6px;
  border: 1px solid color-mix(in srgb, var(--accent) 55%, var(--border));
  background: var(--accent);
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}

.deliverable-open-btn:hover {
  filter: brightness(1.08);
}
</style>
