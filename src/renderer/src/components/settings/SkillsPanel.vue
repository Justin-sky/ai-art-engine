<template>
  <div class="skills-panel">
    <p class="hint">
      {{ t('settings.skills.hint') }}
    </p>

    <label>
      {{ t('settings.skills.dirPath') }}
      <div class="dir-row">
        <code class="dir-value">{{ info?.dirPath || '…' }}</code>
        <button
          type="button"
          class="about-btn"
          :disabled="busy"
          @click="openDir"
        >
          {{ t('settings.skills.openDir') }}
        </button>
        <button
          type="button"
          class="about-btn primary"
          :disabled="busy"
          @click="writeTemplate"
        >
          {{ t('settings.skills.writeTemplate') }}
        </button>
      </div>
    </label>

    <p class="hint count-line">
      {{ t('settings.skills.builtinCount', { count: info?.builtinCount ?? 0 }) }}
    </p>

    <ul
      v-if="info && info.files.length > 0"
      class="file-list"
    >
      <li
        v-for="file in info.files"
        :key="file.fileName"
        class="file-row"
      >
        <code class="file-name">{{ file.fileName }}</code>
        <span
          class="file-kind"
          :class="file.kind"
        >
          {{ t(`settings.skills.kind.${file.kind}`) }}
        </span>
      </li>
    </ul>
    <p
      v-else
      class="hint"
    >
      {{ t('settings.skills.empty') }}
    </p>

    <p
      v-if="message"
      class="msg"
      :class="{ error: isError }"
    >
      {{ message }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { DshSkillsInfo } from '@shared/ipc'
import { useStudioI18n } from '../../composables/useStudioI18n'

const { t } = useStudioI18n()
const info = ref<DshSkillsInfo | null>(null)
const busy = ref(false)
const message = ref('')
const isError = ref(false)

async function refresh(): Promise<void> {
  try {
    info.value = await window.studio.getDshSkillsInfo()
  } catch (e) {
    isError.value = true
    message.value = e instanceof Error ? e.message : String(e)
  }
}

async function openDir(): Promise<void> {
  busy.value = true
  isError.value = false
  message.value = ''
  try {
    await window.studio.openDshSkillsDir()
  } catch (e) {
    isError.value = true
    message.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
    await refresh()
  }
}

async function writeTemplate(): Promise<void> {
  busy.value = true
  isError.value = false
  try {
    const result = await window.studio.writeDshSkillsTemplate()
    message.value = result.skipped
      ? t('settings.skills.templateSkipped', { file: result.filePath })
      : t('settings.skills.templateWritten', { file: result.filePath })
  } catch (e) {
    isError.value = true
    message.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
    await refresh()
  }
}

onMounted(() => {
  void refresh()
})
</script>

<style scoped>
.skills-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.hint {
  color: var(--text-muted);
  line-height: 1.5;
  font-size: 12px;
}

label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: var(--text-muted);
}

.dir-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.dir-value {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  padding: 6px 10px;
  border-radius: 6px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  overflow-wrap: anywhere;
  flex: 1 1 220px;
  min-width: 0;
}

.count-line {
  margin: 0;
}

.file-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.file-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
  border-top: 1px solid var(--border);
}

.file-name {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  color: var(--text);
}

.file-kind {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid var(--border);
  color: var(--text-muted);
}

.file-kind.builtin {
  color: var(--success);
  border-color: rgba(58, 164, 91, 0.45);
}

.file-kind.custom {
  color: var(--accent);
  border-color: rgba(47, 107, 255, 0.45);
}

.file-kind.template {
  color: var(--warning);
  border-color: rgba(210, 153, 34, 0.45);
}

.about-btn {
  padding: 7px 12px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text);
  cursor: pointer;
}

.about-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.about-btn.primary {
  background: rgba(47, 107, 255, 0.22);
  border-color: rgba(47, 107, 255, 0.45);
}

.msg {
  color: var(--success);
  font-size: 12px;
  margin: 0;
}

.msg.error {
  color: var(--danger-muted);
}
</style>
