<template>
  <div class="home">
    <section class="hero">
      <div class="hero-brand">
        <img
          class="hero-mark"
          :src="iconUrl"
          alt=""
        >
        <h1 class="hero-title">
          AI Art Engine
        </h1>
      </div>
      <p>{{ t('home.tagline') }}</p>
      <div class="actions">
        <button
          class="primary"
          @click="openCreateDialog"
        >
          {{ t('home.createProject') }}
        </button>
        <button @click="onOpen">
          {{ t('home.openProject') }}
        </button>
      </div>
      <p
        v-if="errorMessage"
        class="error"
      >
        {{ errorMessage }}
      </p>
    </section>

    <section
      v-if="recent.length"
      class="recent"
    >
      <h2>{{ t('home.recentProjects') }}</h2>
      <ul>
        <li
          v-for="path in recent"
          :key="path"
          class="recent-row"
        >
          <button
            type="button"
            class="linkish"
            @click="openProjectPath(path)"
          >
            {{ path }}
          </button>
          <button
            type="button"
            class="recent-remove"
            :title="t('home.removeRecent')"
            :aria-label="t('home.removeRecent')"
            @click.stop="removeRecent(path)"
          >
            ×
          </button>
        </li>
      </ul>
    </section>

    <StudioFloatingWindow
      :open="createOpen"
      :title="t('home.dialog.title')"
      :show-close="false"
      :default-width="440"
      :default-height="280"
      :min-width="360"
      :min-height="240"
      @close="closeCreateDialog"
    >
      <form
        class="create-form"
        @submit.prevent="confirmCreate"
      >
        <label>
          {{ t('home.dialog.projectName') }}
          <input
            ref="nameInputEl"
            v-model="newName"
            required
            placeholder="MyShortFilm"
            @keydown.esc.prevent="closeCreateDialog"
          >
        </label>
        <label>
          {{ t('home.dialog.storageDir') }}
          <div class="row">
            <input
              v-model="parentDir"
              readonly
              :placeholder="t('home.dialog.selectDirPlaceholder')"
            >
            <button
              type="button"
              @click="pickCreateDir"
            >{{ t('common.browse') }}</button>
          </div>
        </label>
        <p
          v-if="createError"
          class="form-error"
        >
          {{ createError }}
        </p>
      </form>

      <template #footer>
        <button
          type="button"
          @click="closeCreateDialog"
        >
          {{ t('common.cancel') }}
        </button>
        <button
          type="button"
          class="primary"
          :disabled="!newName || !parentDir || busy"
          @click="confirmCreate"
        >
          {{ t('common.create') }}
        </button>
      </template>
    </StudioFloatingWindow>
  </div>
</template>

<script setup lang="ts">
defineOptions({ name: 'HomeView' })
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useProjectLifecycle } from '../composables/useProjectLifecycle'
import StudioFloatingWindow from '../components/StudioFloatingWindow.vue'
import iconUrl from '../assets/logo-mark.png'

const { t } = useStudioI18n()
const {
  recent,
  error,
  createError,
  createOpen,
  newName,
  parentDir,
  busy,
  refreshRecent,
  openCreateDialog,
  closeCreateDialog,
  pickCreateDir,
  confirmCreate,
  openProjectPath,
  browseAndOpen,
  removeRecent
} = useProjectLifecycle()

const nameInputEl = ref<HTMLInputElement | null>(null)

const errorMessage = computed(() => {
  if (error.value === 'api-unavailable') return t('home.apiUnavailable')
  return error.value
})

onMounted(async () => {
  try {
    await refreshRecent()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
})

watch(createOpen, async (open) => {
  if (!open) return
  await nextTick()
  nameInputEl.value?.focus()
})

async function onOpen(): Promise<void> {
  await browseAndOpen()
}
</script>

<style scoped>
.home {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 40px;
  background:
    radial-gradient(ellipse at 30% 20%, #1e2a3a 0%, transparent 50%),
    radial-gradient(ellipse at 70% 80%, #1a2420 0%, transparent 45%),
    var(--bg);
  padding: 40px;
}

.hero {
  text-align: center;
}

.hero-brand {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 18px;
  margin-bottom: 20px;
}

.hero-mark {
  display: block;
  width: 96px;
  height: 96px;
  object-fit: contain;
}

.hero-title {
  margin: 0;
  color: var(--text);
  font-size: clamp(34px, 5vw, 54px);
  font-weight: 750;
  letter-spacing: -0.04em;
  line-height: 1;
}

.hero p {
  color: var(--text-muted);
  margin-bottom: 24px;
}

.actions {
  display: flex;
  gap: 12px;
  justify-content: center;
}

.error {
  color: var(--danger);
  margin-top: 16px;
}

.recent {
  width: min(640px, 100%);
}

.recent h2 {
  font-size: 14px;
  color: var(--text-muted);
  margin-bottom: 12px;
  font-weight: 500;
}

.recent ul {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.recent-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.linkish {
  flex: 1;
  min-width: 0;
  text-align: left;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  color: var(--text);
  padding: 10px 14px;
  border-radius: 6px;
  cursor: pointer;
  font-family: var(--mono);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.linkish:hover {
  border-color: var(--accent);
  background: var(--bg-hover);
}

.recent-remove {
  flex: 0 0 32px;
  height: 36px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}

.recent-remove:hover {
  color: var(--danger);
  background: var(--bg-hover);
  border-color: var(--border);
}

.create-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 4px 2px;
}

.create-form label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: var(--text-muted);
}

.create-form input {
  width: 100%;
}

.row {
  display: flex;
  gap: 8px;
}

.row input {
  flex: 1;
  min-width: 0;
}

.form-error {
  margin: 0;
  color: var(--danger);
  font-size: 12px;
}
</style>
