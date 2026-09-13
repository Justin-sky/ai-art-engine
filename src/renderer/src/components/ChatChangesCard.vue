<script setup lang="ts">
/**
 * 对话内的 Git 变更预览卡。
 *
 * 列出这一轮 agent 改动过的文件（状态 / 增删行数），点开才按需拉取该文件的统一
 * diff 并逐行染色（新增绿 / 删除红 / hunk 蓝）。
 *
 * 只读展示：不提供 stage / commit / 回滚等写操作——预览的职责是「让我看清改了什么」，
 * 是否落库仍由用户在 git 客户端决定。diff 不落 localStorage，展开一次缓存一份。
 */
import { computed, ref } from 'vue'
import {
  parseUnifiedDiff,
  type GitChangeFile,
  type GitDiffLine,
  type GitFileStatus
} from '@shared/git'
import { useStudioI18n } from '../composables/useStudioI18n'

/** 单个文件最多渲染的 diff 行数（超大 diff 只展示前若干行 + 截断提示） */
const MAX_DIFF_LINES = 600

const props = defineProps<{
  files: GitChangeFile[]
  at: number
  branch?: string
}>()

const emit = defineEmits<{ (event: 'refresh'): void }>()

const { t } = useStudioI18n()

interface DiffView {
  lines: GitDiffLine[]
  truncated: boolean
  binary: boolean
  loading: boolean
  error: string
}

const expanded = ref<Set<string>>(new Set())
const diffs = ref<Record<string, DiffView>>({})

const totalAdditions = computed(() => props.files.reduce((sum, file) => sum + file.additions, 0))
const totalDeletions = computed(() => props.files.reduce((sum, file) => sum + file.deletions, 0))
const updatedTime = computed(() => new Date(props.at).toLocaleTimeString())

const STATUS_KEYS: Record<GitFileStatus, string> = {
  added: 'studio.chat.gitChangeAdded',
  modified: 'studio.chat.gitChangeModified',
  deleted: 'studio.chat.gitChangeDeleted',
  renamed: 'studio.chat.gitChangeRenamed',
  copied: 'studio.chat.gitChangeCopied',
  untracked: 'studio.chat.gitChangeUntracked',
  conflicted: 'studio.chat.gitChangeConflicted'
}

function statusLabel(status: GitFileStatus): string {
  return t(STATUS_KEYS[status])
}

function isOpen(path: string): boolean {
  return expanded.value.has(path)
}

/** 展开 / 收起单个文件：首次展开拉取 diff，之后直接用缓存 */
async function toggleDiff(file: GitChangeFile): Promise<void> {
  const path = file.path
  const next = new Set(expanded.value)
  if (next.has(path)) {
    next.delete(path)
    expanded.value = next
    return
  }
  next.add(path)
  expanded.value = next
  const cached = diffs.value[path]
  if (cached && !cached.error && !cached.loading) return

  diffs.value = {
    ...diffs.value,
    [path]: { lines: [], truncated: false, binary: false, loading: true, error: '' }
  }
  try {
    const result = await window.studio.getGitFileDiff({ path })
    if (result.binary) {
      diffs.value = {
        ...diffs.value,
        [path]: { lines: [], truncated: false, binary: true, loading: false, error: '' }
      }
      return
    }
    const all = parseUnifiedDiff(result.diff)
    if (!all.length) {
      diffs.value = {
        ...diffs.value,
        [path]: {
          lines: [],
          truncated: false,
          binary: false,
          loading: false,
          error: t('studio.chat.gitChangesNoDiff')
        }
      }
      return
    }
    diffs.value = {
      ...diffs.value,
      [path]: {
        lines: all.slice(0, MAX_DIFF_LINES),
        truncated: result.truncated || all.length > MAX_DIFF_LINES,
        binary: false,
        loading: false,
        error: ''
      }
    }
  } catch {
    diffs.value = {
      ...diffs.value,
      [path]: {
        lines: [],
        truncated: false,
        binary: false,
        loading: false,
        error: t('studio.chat.gitChangesFailed')
      }
    }
  }
}
</script>

<template>
  <div class="changes-card">
    <div class="changes-head">
      <span class="changes-title">{{ t('studio.chat.gitChangesTitle') }}</span>
      <span class="changes-count">{{
        t('studio.chat.gitChangesCount', { count: files.length })
      }}</span>
      <span class="changes-delta add">+{{ totalAdditions }}</span>
      <span class="changes-delta del">-{{ totalDeletions }}</span>
      <button
        type="button"
        class="changes-refresh"
        :title="t('studio.chat.gitChangesRefreshTitle')"
        @click.stop="emit('refresh')"
      >
        {{ t('studio.chat.gitChangesRefresh') }}
      </button>
    </div>
    <div class="changes-sub">
      <span v-if="branch">{{ branch }}</span>
      <span class="changes-time">{{
        t('studio.chat.gitChangesUpdated', { time: updatedTime })
      }}</span>
    </div>
    <ul class="changes-list">
      <li v-for="file in files" :key="file.path" class="change-item">
        <button
          type="button"
          class="change-row"
          :title="file.oldPath ? `${file.oldPath} → ${file.path}` : file.path"
          @click="toggleDiff(file)"
        >
          <span class="change-badge" :class="file.status">{{ statusLabel(file.status) }}</span>
          <span class="change-path">{{ file.path }}</span>
          <span v-if="file.binary" class="change-note">{{
            t('studio.chat.gitChangesBinary')
          }}</span>
          <span v-else class="change-delta-inline">
            <i class="add">+{{ file.additions }}</i>
            <i class="del">-{{ file.deletions }}</i>
          </span>
          <span class="change-caret">{{ isOpen(file.path) ? '▾' : '▸' }}</span>
        </button>
        <div v-if="isOpen(file.path)" class="change-diff">
          <div v-if="diffs[file.path]?.loading" class="diff-hint">
            {{ t('studio.chat.gitChangesDiffLoading') }}
          </div>
          <div v-else-if="diffs[file.path]?.binary" class="diff-hint">
            {{ t('studio.chat.gitChangesBinary') }}
          </div>
          <div v-else-if="diffs[file.path]?.error" class="diff-hint">
            {{ diffs[file.path]?.error }}
          </div>
          <template v-else>
            <div class="diff-body">
              <!-- v-text：diff 行按 white-space: pre 渲染，内容不能带额外换行 / 缩进空白 -->
              <div
                v-for="(line, index) in diffs[file.path]?.lines ?? []"
                :key="index"
                class="diff-line"
                :class="line.type"
                v-text="line.text || ' '"
              />
            </div>
            <div v-if="diffs[file.path]?.truncated" class="diff-hint">
              {{ t('studio.chat.gitChangesTruncated') }}
            </div>
          </template>
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.changes-card {
  width: 100%;
  min-width: 0;
  padding: 8px 10px 6px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-panel);
  overflow: hidden;
}

.changes-head {
  display: flex;
  align-items: center;
  gap: 6px;
}

.changes-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  user-select: none;
  -webkit-user-select: none;
}

.changes-count {
  font-size: 11px;
  color: var(--text-muted);
}

.changes-delta {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.changes-delta.add {
  color: var(--success, #4ea672);
}

.changes-delta.del {
  color: var(--danger, #d9534f);
}

.changes-refresh {
  margin-left: auto;
  padding: 1px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-elevated);
  color: var(--text-muted);
  font-size: 11px;
  cursor: pointer;
}

.changes-refresh:hover {
  color: var(--text);
}

.changes-sub {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 2px 0 6px;
  font-size: 10px;
  color: var(--text-muted);
}

.changes-list {
  list-style: none;
  /* 一轮改动可能涉及很多文件：列表自身滚动，避免把对话撑长 */
  max-height: 260px;
  overflow: auto;
  margin: 0;
  padding: 0;
}

.change-item + .change-item {
  margin-top: 2px;
}

.change-row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 2px 4px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  font-size: 11px;
  text-align: left;
  cursor: pointer;
}

.change-row:hover {
  background: var(--bg-elevated);
}

.change-badge {
  flex: none;
  padding: 0 4px;
  border-radius: 3px;
  background: var(--bg-elevated);
  color: var(--text-muted);
  font-size: 10px;
}

.change-badge.added,
.change-badge.untracked {
  color: var(--success, #4ea672);
}

.change-badge.deleted {
  color: var(--danger, #d9534f);
}

.change-badge.conflicted {
  color: var(--warning, #d9a53f);
}

.change-path {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

.change-note {
  flex: none;
  font-size: 10px;
  color: var(--text-muted);
}

.change-delta-inline {
  flex: none;
  display: flex;
  gap: 4px;
  font-variant-numeric: tabular-nums;
}

.change-delta-inline .add {
  color: var(--success, #4ea672);
}

.change-delta-inline .del {
  color: var(--danger, #d9534f);
}

.change-caret {
  flex: none;
  width: 10px;
  color: var(--text-muted);
}

.change-diff {
  margin: 2px 0 4px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-elevated);
  overflow: hidden;
}

.diff-body {
  max-height: 300px;
  overflow: auto;
  padding: 4px 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  line-height: 1.45;
}

.diff-line {
  padding: 0 8px;
  white-space: pre;
}

.diff-line.add {
  background: rgb(78 166 114 / 14%);
  color: var(--success, #4ea672);
}

.diff-line.del {
  background: rgb(217 83 79 / 14%);
  color: var(--danger, #d9534f);
}

.diff-line.hunk {
  color: var(--accent, #7aa2f7);
}

.diff-line.meta {
  color: var(--text-muted);
}

.diff-hint {
  padding: 4px 8px;
  font-size: 11px;
  color: var(--text-muted);
}
</style>
