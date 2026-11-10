<template>
  <div class="workspace-file-editor" tabindex="0" @keydown="onEditorKeydown">
    <template v-if="file">
      <header class="wfe-header">
        <div class="wfe-header-left">
          <span class="wfe-kind-badge">{{ kindBadge }}</span>
          <span class="wfe-file-name" :title="file.absPath">{{ file.fileName }}</span>
          <span v-if="dirty" class="wfe-dirty-dot" :title="ui.unsavedHint">●</span>
          <span v-if="file.caption" class="wfe-caption" :title="file.caption">{{
            file.caption
          }}</span>
        </div>

        <div class="wfe-header-right">
          <div v-if="file.kind === 'markdown'" class="wfe-mode-tabs" role="tablist">
            <button
              type="button"
              class="wfe-mode-tab"
              :class="{ active: viewMode === 'preview' }"
              @click="viewMode = 'preview'"
            >
              📖 {{ ui.modePreview }}
            </button>
            <button
              type="button"
              class="wfe-mode-tab"
              :class="{ active: viewMode === 'split' }"
              @click="viewMode = 'split'"
            >
              🌗 {{ ui.modeSplit }}
            </button>
            <button
              type="button"
              class="wfe-mode-tab"
              :class="{ active: viewMode === 'edit' }"
              @click="viewMode = 'edit'"
            >
              ✏️ {{ ui.modeEdit }}
            </button>
          </div>

          <div v-else-if="file.kind === 'html'" class="wfe-mode-tabs" role="tablist">
            <button
              type="button"
              class="wfe-mode-tab"
              :class="{ active: viewMode === 'preview' }"
              @click="viewMode = 'preview'"
            >
              🌐 {{ ui.modePreview }}
            </button>
            <button
              type="button"
              class="wfe-mode-tab"
              :class="{ active: viewMode === 'edit' }"
              @click="viewMode = 'edit'"
            >
              ✏️ {{ ui.modeSource }}
            </button>
          </div>

          <button
            v-if="isEditableText"
            type="button"
            class="wfe-btn wfe-btn-primary"
            :disabled="saving || !dirty"
            :title="ui.saveShortcutHint"
            @click="saveFile"
          >
            💾 {{ saving ? ui.saving : ui.save }}
          </button>

          <button type="button" class="wfe-btn" @click="copyContentOrPath">
            📋 {{ copied ? ui.copied : ui.copy }}
          </button>

          <button type="button" class="wfe-btn" :disabled="reloading" @click="reloadFromDisk">
            🔄 {{ ui.reload }}
          </button>

          <button type="button" class="wfe-btn" @click="revealInExplorer">
            📂 {{ ui.revealInExplorer }}
          </button>
        </div>
      </header>

      <div class="wfe-subbar">
        <span class="wfe-path" :title="file.absPath">{{ file.absPath }}</span>
        <span v-if="statusText" class="wfe-status" :class="{ error: statusError }">{{
          statusText
        }}</span>
        <span v-else-if="isEditableText" class="wfe-stats">
          {{ lineCount }} {{ ui.linesUnit }} · {{ localText.length }} {{ ui.charsUnit }}
        </span>
      </div>

      <div class="wfe-body">
        <!-- Markdown Viewer / Split / Editor -->
        <div
          v-if="file.kind === 'markdown'"
          class="wfe-markdown-container"
          :class="`mode-${viewMode}`"
        >
          <textarea
            v-if="viewMode === 'edit' || viewMode === 'split'"
            v-model="localText"
            class="wfe-textarea"
            spellcheck="false"
            @input="onTextInput"
          />
          <div
            v-if="viewMode === 'preview' || viewMode === 'split'"
            class="wfe-markdown-preview"
            @click="onMarkdownClick"
            v-html="renderedMarkdown"
          />
        </div>

        <!-- HTML Preview / Source -->
        <div v-else-if="file.kind === 'html'" class="wfe-html-container">
          <iframe
            v-if="viewMode === 'preview'"
            class="wfe-html-iframe"
            sandbox="allow-scripts"
            :srcdoc="localText"
          />
          <textarea
            v-else
            v-model="localText"
            class="wfe-textarea"
            spellcheck="false"
            @input="onTextInput"
          />
        </div>

        <!-- Plain Text / Code Editor -->
        <div v-else-if="file.kind === 'text'" class="wfe-text-container">
          <textarea
            v-model="localText"
            class="wfe-textarea"
            spellcheck="false"
            @input="onTextInput"
          />
        </div>

        <!-- Image Preview -->
        <div v-else-if="file.kind === 'image'" class="wfe-media-container">
          <img
            v-if="file.mediaUrl"
            :src="file.mediaUrl"
            :alt="file.fileName"
            class="wfe-media-image"
          />
        </div>

        <!-- Video Preview -->
        <div v-else-if="file.kind === 'video'" class="wfe-media-container">
          <video
            v-if="file.mediaUrl"
            :src="file.mediaUrl"
            controls
            autoplay
            class="wfe-media-video"
          />
        </div>

        <!-- Audio Preview -->
        <div v-else-if="file.kind === 'audio'" class="wfe-media-container">
          <audio
            v-if="file.mediaUrl"
            :src="file.mediaUrl"
            controls
            autoplay
            class="wfe-media-audio"
          />
        </div>

        <!-- Binary / External File Fallback -->
        <div v-else class="wfe-binary-card">
          <div class="wfe-binary-icon">📦</div>
          <div class="wfe-binary-title">{{ file.fileName }}</div>
          <div class="wfe-binary-path">{{ file.absPath }}</div>
          <div class="wfe-binary-actions">
            <button type="button" class="wfe-btn wfe-btn-primary" @click="openWithSystemApp">
              {{ ui.openWithSystemApp }}
            </button>
            <button type="button" class="wfe-btn" @click="revealInExplorer">
              📂 {{ ui.revealInExplorer }}
            </button>
          </div>
        </div>
      </div>
    </template>

    <div v-else class="wfe-empty">
      {{ ui.emptyFile }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { renderChatMarkdown } from '@shared/chatMarkdown'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useWorkspaceStore } from '../stores/workspace'

const props = defineProps<{
  fileId: string
}>()

const workspace = useWorkspaceStore()
const { locale, t } = useStudioI18n()

const isEn = computed(() => String(locale.value || '').startsWith('en'))

const ui = computed(() =>
  isEn.value
    ? {
        modePreview: 'Preview',
        modeSplit: 'Split',
        modeEdit: 'Edit',
        modeSource: 'Source',
        save: 'Save',
        saving: 'Saving...',
        saveShortcutHint: 'Save (Ctrl+S)',
        unsavedHint: 'Unsaved changes',
        copy: 'Copy',
        copied: 'Copied',
        reload: 'Reload',
        revealInExplorer: 'Reveal in Explorer',
        openWithSystemApp: 'Open with System Default App',
        linesUnit: 'lines',
        charsUnit: 'chars',
        savedBanner: 'Saved to disk',
        reloadedBanner: 'Reloaded from disk',
        emptyFile: 'File session closed or unavailable.'
      }
    : {
        modePreview: '预览', // cjk-ok
        modeSplit: '分栏', // cjk-ok
        modeEdit: '编辑', // cjk-ok
        modeSource: '源码', // cjk-ok
        save: '保存', // cjk-ok
        saving: '保存中...', // cjk-ok
        saveShortcutHint: '保存文件 (Ctrl+S)', // cjk-ok
        unsavedHint: '有未保存的修改', // cjk-ok
        copy: '复制', // cjk-ok
        copied: '已复制', // cjk-ok
        reload: '刷新', // cjk-ok
        revealInExplorer: '定位文件', // cjk-ok
        openWithSystemApp: '用系统默认应用打开', // cjk-ok
        linesUnit: '行', // cjk-ok
        charsUnit: '字符', // cjk-ok
        savedBanner: '已保存到磁盘', // cjk-ok
        reloadedBanner: '已从磁盘重新加载', // cjk-ok
        emptyFile: '文件会话已关闭或不可用。' // cjk-ok
      }
)

const file = computed(() => workspace.resolveWorkspaceFileById(props.fileId))

const viewMode = ref<'preview' | 'split' | 'edit'>('preview')
const localText = ref('')
const dirty = ref(false)
const saving = ref(false)
const reloading = ref(false)
const copied = ref(false)
const statusText = ref('')
const statusError = ref(false)

const isEditableText = computed(() => {
  const k = file.value?.kind
  return k === 'markdown' || k === 'text' || k === 'html'
})

const kindBadge = computed(() => {
  const f = file.value
  if (!f) return 'FILE'
  const extUpper = f.ext.replace(/^\./, '').toUpperCase()
  if (extUpper) return extUpper
  return f.kind.toUpperCase()
})

const lineCount = computed(() => {
  if (!localText.value) return 0
  return localText.value.split('\n').length
})

const renderedMarkdown = computed(() => {
  if (file.value?.kind !== 'markdown') return ''
  return renderChatMarkdown(localText.value || '', {
    copyCode: t('studio.chat.copyCode')
  })
})

watch(
  () => [file.value?.id, file.value?.nonce] as const,
  () => {
    const f = file.value
    if (!f) return
    localText.value = f.content ?? ''
    dirty.value = Boolean(f.dirty)
    if (f.kind === 'markdown' || f.kind === 'html') {
      viewMode.value = 'preview'
    } else {
      viewMode.value = 'edit'
    }
  },
  { immediate: true }
)

function showStatus(msg: string, isErr = false): void {
  statusText.value = msg
  statusError.value = isErr
  window.setTimeout(() => {
    if (statusText.value === msg) {
      statusText.value = ''
      statusError.value = false
    }
  }, 2600)
}

function onTextInput(): void {
  dirty.value = true
  if (file.value) {
    workspace.updateWorkspaceFile(file.value.id, {
      content: localText.value,
      dirty: true
    })
  }
}

async function saveFile(): Promise<void> {
  const f = file.value
  if (!f || !isEditableText.value || saving.value) return
  if (typeof window.studio?.openHarnessFile !== 'function') return
  saving.value = true
  try {
    const res = await window.studio.openHarnessFile({
      path: f.absPath,
      mode: 'write',
      writeContent: localText.value
    })
    if (res?.ok) {
      dirty.value = false
      workspace.updateWorkspaceFile(f.id, {
        content: localText.value,
        dirty: false
      })
      showStatus(ui.value.savedBanner, false)
    } else {
      showStatus(res?.error || 'Save failed', true)
    }
  } catch (err) {
    showStatus(err instanceof Error ? err.message : String(err), true)
  } finally {
    saving.value = false
  }
}

async function reloadFromDisk(): Promise<void> {
  const f = file.value
  if (!f || reloading.value || typeof window.studio?.openHarnessFile !== 'function') return
  reloading.value = true
  try {
    const res = await window.studio.openHarnessFile({
      path: f.absPath,
      mode: 'read'
    })
    if (res?.ok) {
      localText.value = res.content ?? ''
      dirty.value = false
      workspace.updateWorkspaceFile(f.id, {
        content: res.content,
        mediaUrl: res.mediaUrl ?? f.mediaUrl,
        sizeBytes: res.sizeBytes ?? f.sizeBytes,
        dirty: false
      })
      showStatus(ui.value.reloadedBanner, false)
    } else {
      showStatus(res?.error || 'Reload failed', true)
    }
  } catch (err) {
    showStatus(err instanceof Error ? err.message : String(err), true)
  } finally {
    reloading.value = false
  }
}

async function revealInExplorer(): Promise<void> {
  const f = file.value
  if (!f || typeof window.studio?.openHarnessFile !== 'function') return
  const res = await window.studio
    .openHarnessFile({
      path: f.absPath,
      revealInFolder: true
    })
    .catch(() => ({ ok: false, error: 'Reveal failed' }))
  if (!res?.ok && res?.error) {
    showStatus(res.error, true)
  }
}

async function openWithSystemApp(): Promise<void> {
  const f = file.value
  if (!f || typeof window.studio?.openHarnessFile !== 'function') return
  const res = await window.studio
    .openHarnessFile({
      path: f.absPath,
      mode: 'open'
    })
    .catch(() => ({ ok: false, error: 'Open failed' }))
  if (!res?.ok && res?.error) {
    showStatus(res.error, true)
  }
}

async function copyContentOrPath(): Promise<void> {
  const f = file.value
  if (!f) return
  const textToCopy = isEditableText.value ? localText.value : f.absPath
  try {
    await navigator.clipboard.writeText(textToCopy)
    copied.value = true
    window.setTimeout(() => {
      copied.value = false
    }, 1500)
  } catch {
    // ignore
  }
}

async function onMarkdownClick(event: MouseEvent): Promise<void> {
  const button = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-copy-code]')
  if (!button) return
  const code = button.closest('.md-code')?.querySelector('code')?.textContent ?? ''
  if (!code) return
  try {
    await navigator.clipboard.writeText(code)
    button.classList.add('copied')
    window.setTimeout(() => button.classList.remove('copied'), 1200)
  } catch {
    // ignore
  }
}

function onEditorKeydown(event: KeyboardEvent): void {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    if (isEditableText.value) {
      event.preventDefault()
      void saveFile()
    }
  }
}
</script>

<style scoped>
.workspace-file-editor {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: var(--bg);
  color: var(--text);
  outline: none;
  overflow: hidden;
}

.wfe-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 14px;
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.wfe-header-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
}

.wfe-kind-badge {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  color: var(--accent);
  flex-shrink: 0;
}

.wfe-file-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.wfe-dirty-dot {
  color: var(--accent);
  font-size: 12px;
  flex-shrink: 0;
}

.wfe-caption {
  font-size: 12px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.wfe-header-right {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.wfe-mode-tabs {
  display: inline-flex;
  align-items: center;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 2px;
  gap: 2px;
}

.wfe-mode-tab {
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  padding: 3px 9px;
  border-radius: 4px;
  cursor: pointer;
}

.wfe-mode-tab:hover {
  color: var(--text);
}

.wfe-mode-tab.active {
  background: var(--bg-hover);
  color: var(--text);
  font-weight: 600;
}

.wfe-btn {
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text);
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 6px;
  cursor: pointer;
  white-space: nowrap;
}

.wfe-btn:hover:not(:disabled) {
  background: var(--bg-hover);
}

.wfe-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.wfe-btn-primary {
  border-color: var(--accent);
}

.wfe-subbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 4px 14px;
  background: var(--bg-elevated);
  border-bottom: 1px solid var(--border);
  font-size: 11px;
  color: var(--text-muted);
  flex-shrink: 0;
}

.wfe-path {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.wfe-status {
  color: var(--accent);
  font-weight: 500;
  flex-shrink: 0;
}

.wfe-status.error {
  color: #f87171;
}

.wfe-stats {
  flex-shrink: 0;
}

.wfe-body {
  flex: 1;
  min-height: 0;
  display: flex;
  overflow: hidden;
}

.wfe-markdown-container {
  flex: 1;
  min-height: 0;
  display: grid;
  width: 100%;
  height: 100%;
}

.wfe-markdown-container.mode-preview,
.wfe-markdown-container.mode-edit {
  grid-template-columns: minmax(0, 1fr);
}

.wfe-markdown-container.mode-split {
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
}

.wfe-markdown-container.mode-split .wfe-textarea {
  border-right: 1px solid var(--border);
}

.wfe-text-container,
.wfe-html-container {
  flex: 1;
  min-height: 0;
  display: flex;
  width: 100%;
  height: 100%;
}

.wfe-textarea {
  flex: 1;
  width: 100%;
  height: 100%;
  border: none;
  outline: none;
  resize: none;
  padding: 16px 20px;
  background: var(--bg);
  color: var(--text);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 13px;
  line-height: 1.65;
  overflow-y: auto;
}

.wfe-markdown-preview {
  padding: 20px 28px 40px;
  overflow-y: auto;
  font-size: 14px;
  line-height: 1.75;
  color: var(--text);
}

.wfe-markdown-preview :deep(h1),
.wfe-markdown-preview :deep(h2),
.wfe-markdown-preview :deep(h3),
.wfe-markdown-preview :deep(h4) {
  margin-top: 1.2em;
  margin-bottom: 0.5em;
  font-weight: 700;
  color: var(--text);
}

.wfe-markdown-preview :deep(h1) {
  font-size: 1.55em;
  padding-bottom: 0.3em;
  border-bottom: 1px solid var(--border);
}

.wfe-markdown-preview :deep(h2) {
  font-size: 1.3em;
  padding-bottom: 0.25em;
  border-bottom: 1px solid var(--border);
}

.wfe-markdown-preview :deep(p),
.wfe-markdown-preview :deep(ul),
.wfe-markdown-preview :deep(ol),
.wfe-markdown-preview :deep(blockquote) {
  margin: 0.65em 0;
}

.wfe-markdown-preview :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 12px 0;
  font-size: 13px;
}

.wfe-markdown-preview :deep(th),
.wfe-markdown-preview :deep(td) {
  border: 1px solid var(--border);
  padding: 6px 10px;
  text-align: left;
}

.wfe-markdown-preview :deep(th) {
  background: var(--bg-panel);
  font-weight: 600;
}

.wfe-markdown-preview :deep(.md-code) {
  margin: 10px 0;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-panel);
  overflow: hidden;
}

.wfe-markdown-preview :deep(.md-code-bar) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 10px;
  background: var(--bg-elevated);
  border-bottom: 1px solid var(--border);
  font-size: 11px;
  color: var(--text-muted);
}

.wfe-markdown-preview :deep(.md-code-copy) {
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  padding: 2px 4px;
}

.wfe-markdown-preview :deep(.md-code-copy .md-icon-done) {
  display: none;
}

.wfe-markdown-preview :deep(.md-code-copy.copied .md-icon-copy) {
  display: none;
}

.wfe-markdown-preview :deep(.md-code-copy.copied .md-icon-done) {
  display: inline;
}

.wfe-markdown-preview :deep(.md-pre) {
  margin: 0;
  padding: 12px 14px;
  overflow-x: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12.5px;
  line-height: 1.55;
}

.wfe-markdown-preview :deep(.md-code-inline) {
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.9em;
}

.wfe-html-iframe {
  flex: 1;
  width: 100%;
  height: 100%;
  border: none;
  background: #ffffff;
}

.wfe-media-container {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  overflow: auto;
}

.wfe-media-image,
.wfe-media-video {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: 6px;
}

.wfe-media-audio {
  width: min(480px, 90%);
}

.wfe-binary-card {
  margin: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 28px 36px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-panel);
  max-width: 520px;
  text-align: center;
}

.wfe-binary-icon {
  font-size: 32px;
}

.wfe-binary-title {
  font-size: 15px;
  font-weight: 600;
}

.wfe-binary-path {
  font-size: 12px;
  color: var(--text-muted);
  word-break: break-all;
}

.wfe-binary-actions {
  display: flex;
  gap: 8px;
  margin-top: 6px;
}

.wfe-empty {
  margin: auto;
  color: var(--text-muted);
  font-size: 13px;
}
</style>
