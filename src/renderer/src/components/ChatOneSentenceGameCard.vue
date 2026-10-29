<template>
  <div class="osgame-card">
    <div class="osgame-head">
      <span class="osgame-icon" aria-hidden="true">🎮</span>
      <span class="osgame-title" :title="info.title">{{ info.title }}</span>
      <span class="osgame-badge">{{ t('studio.chat.oneSentenceGame.badge') }}</span>
    </div>

    <div class="osgame-tags">
      <span class="osgame-tag">{{ genreLabel }}</span>
      <span class="osgame-tag">{{ cameraLabel }}</span>
      <span class="osgame-tag">{{ difficultyLabel }}</span>
      <span class="osgame-tag" :class="{ ai: info.audioSfx === 'ai' || info.audioBgm === 'ai' }">
        {{ audioLabel }}
      </span>
    </div>
    <div class="osgame-style" :title="info.artStyle">{{ info.artStyle }}</div>

    <div v-if="info.scopeNotes.length" class="osgame-scope">
      <div class="osgame-scope-title">{{ t('studio.chat.oneSentenceGame.scopeTitle') }}</div>
      <ul>
        <li v-for="note in info.scopeNotes" :key="note">{{ note }}</li>
      </ul>
    </div>

    <div class="osgame-actions">
      <button type="button" class="osgame-btn" @click.stop="void openCanvas()">
        {{ t('studio.chat.oneSentenceGame.openCanvas') }}
      </button>
      <button
        type="button"
        class="osgame-btn primary"
        :disabled="runDispatching"
        @click.stop="runGraph"
      >
        ▶ {{ t('studio.chat.oneSentenceGame.run') }}
      </button>
    </div>

    <div v-if="statusText" class="osgame-status" :class="{ error: statusIsError }">
      {{ statusText }}
    </div>

    <label class="osgame-autorun" :title="t('studio.chat.oneSentenceGame.autoRunHint')">
      <input
        type="checkbox"
        :checked="autoRunEnabled"
        :disabled="autoRunSaving"
        @change="onToggleAutoRun"
      />
      <span>{{ t('studio.chat.oneSentenceGame.autoRun') }}</span>
    </label>
    <div class="osgame-autorun-hint">{{ t('studio.chat.oneSentenceGame.autoRunHint') }}</div>
  </div>
</template>

<script setup lang="ts">
/**
 * 对话「一句话游戏卡」（MCP `game_one_sentence_create` 的产物卡）。
 *
 * - 「运行整张图」走主进程 `runOneSentenceGame` → 与 task_run 同一条执行 / 回报通道；
 * - 「试玩」在 game.playable 节点运行完、把单文件 HTML 物化成工程相对路径后可用；
 * - 「生成后自动运行」复选框默认不勾，写入 AppSettings.gameOneSentenceAutoRun，
 *   由主进程工具读取（Agent 无法通过参数绕过）。
 */
import { computed, onMounted, ref } from 'vue'
import type { OneSentenceGameCardInfo } from '@shared/ipc'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useProjectStore } from '../stores/project'
import { openMcpWorkflowAssetEditor } from '../features/mcp/mcpGraphLiveCanvas'

const props = defineProps<{ info: OneSentenceGameCardInfo }>()

const { t } = useStudioI18n()
const project = useProjectStore()

const runDispatching = ref(false)
const statusText = ref(props.info.autoRun ? t('studio.chat.oneSentenceGame.autoRunStarted') : '')
const statusIsError = ref(false)
const autoRunEnabled = ref(false)
const autoRunSaving = ref(false)

function labelOr(key: string, fallback: string): string {
  const text = t(key)
  return text && text !== key ? text : fallback
}

const genreLabel = computed(() =>
  labelOr(`studio.chat.oneSentenceGame.genres.${props.info.genre}`, props.info.genre)
)
const cameraLabel = computed(() =>
  labelOr(`studio.chat.oneSentenceGame.cameras.${props.info.camera}`, props.info.camera)
)
const difficultyLabel = computed(() =>
  labelOr(
    `studio.chat.oneSentenceGame.difficulties.${props.info.difficulty}`,
    props.info.difficulty
  )
)
const audioLabel = computed(() =>
  props.info.audioSfx === 'ai' || props.info.audioBgm === 'ai'
    ? t('studio.chat.oneSentenceGame.audioAi')
    : t('studio.chat.oneSentenceGame.audioProcedural')
)

/**
 * 资产列表里还没有这张图时先刷新一次（兜底：主进程建好资产但广播丢失 / 旧版本建的卡），
 * 否则打开画布与运行都会落到「资产不存在或已删除」。
 */
async function ensureAssetLoaded(): Promise<void> {
  if (project.assets.some((a) => a.id === props.info.assetId)) return
  try {
    await project.refreshAssets()
  } catch {
    /* 刷新失败交给后续打开 / 运行的错误提示 */
  }
}

async function openCanvas(): Promise<void> {
  await ensureAssetLoaded()
  openMcpWorkflowAssetEditor(props.info.assetId)
}

async function runGraph(): Promise<void> {
  if (runDispatching.value) return
  runDispatching.value = true
  statusIsError.value = false
  try {
    await ensureAssetLoaded()
    openMcpWorkflowAssetEditor(props.info.assetId)
    await window.studio.runOneSentenceGame(props.info.assetId)
    statusText.value = t('studio.chat.oneSentenceGame.running')
  } catch (err) {
    statusIsError.value = true
    statusText.value = t('studio.chat.oneSentenceGame.runFailed', {
      error: err instanceof Error ? err.message : String(err)
    })
  } finally {
    runDispatching.value = false
  }
}

async function onToggleAutoRun(event: Event): Promise<void> {
  const next = (event.target as HTMLInputElement).checked
  autoRunSaving.value = true
  try {
    // setSettings 是整体替换语义：必须先读当前设置再只改这一项
    const current = await window.studio.getSettings()
    const saved = await window.studio.setSettings({ ...current, gameOneSentenceAutoRun: next })
    autoRunEnabled.value = saved.gameOneSentenceAutoRun === true
  } catch {
    autoRunEnabled.value = !next
  } finally {
    autoRunSaving.value = false
  }
}

onMounted(async () => {
  try {
    const settings = await window.studio.getSettings()
    autoRunEnabled.value = settings.gameOneSentenceAutoRun === true
  } catch {
    autoRunEnabled.value = false
  }
})
</script>

<style scoped>
.osgame-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.osgame-head {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.osgame-icon {
  flex-shrink: 0;
  font-size: 13px;
  line-height: 1;
}

.osgame-title {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}

.osgame-badge {
  flex-shrink: 0;
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 10px;
  color: var(--accent);
  border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
}

.osgame-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.osgame-tag {
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 11px;
  color: var(--text-muted);
  background: var(--bg-elevated);
  border: 1px solid var(--border);
}

.osgame-tag.ai {
  color: var(--accent);
}

.osgame-style {
  font-size: 11px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.osgame-scope {
  padding: 6px 8px;
  border-radius: 6px;
  font-size: 11px;
  color: var(--warning);
  background: color-mix(in srgb, var(--warning) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--warning) 35%, transparent);
}

.osgame-scope ul {
  margin: 2px 0 0;
  padding-left: 16px;
}

.osgame-scope-title {
  font-weight: 600;
}

.osgame-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.osgame-btn {
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
}

.osgame-btn:hover:not(:disabled) {
  background: var(--bg-hover);
}

.osgame-btn.primary {
  border-color: var(--accent);
  color: var(--accent);
}

.osgame-btn.primary:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent) 16%, transparent);
}

.osgame-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.osgame-status {
  font-size: 11px;
  color: var(--text-muted);
}

.osgame-status.error {
  color: var(--danger);
}

.osgame-autorun {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text);
  cursor: pointer;
  user-select: none;
}

.osgame-autorun-hint {
  margin-top: -4px;
  padding-left: 20px;
  font-size: 10px;
  color: var(--text-muted);
}
</style>
