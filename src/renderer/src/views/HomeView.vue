<template>
  <div class="home">
    <section class="hero">
      <img class="hero-logo" :src="logoUrl" alt="AIArtEngine" />
      <p>{{ t('home.tagline') }}</p>
      <div class="actions">
        <button class="primary" @click="onCreate">{{ t('home.createProject') }}</button>
        <button @click="onOpen">{{ t('home.openProject') }}</button>
      </div>
      <p v-if="error" class="error">{{ error }}</p>
    </section>

    <section class="recent" v-if="recent.length">
      <h2>{{ t('home.recentProjects') }}</h2>
      <ul>
        <li v-for="path in recent" :key="path" class="recent-row">
          <button type="button" class="linkish" @click="openPath(path)">{{ path }}</button>
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
      @close="closeDialog"
    >
      <form class="create-form" @submit.prevent="confirmCreate">
        <label>
          {{ t('home.dialog.projectName') }}
          <input
            ref="nameInputEl"
            v-model="newName"
            required
            placeholder="MyShortFilm"
            @keydown.esc.prevent="closeDialog"
          />
        </label>
        <label>
          {{ t('home.dialog.storageDir') }}
          <div class="row">
            <input
              v-model="parentDir"
              readonly
              :placeholder="t('home.dialog.selectDirPlaceholder')"
            />
            <button type="button" @click="pickDir">{{ t('common.browse') }}</button>
          </div>
        </label>
        <p v-if="createError" class="form-error">{{ createError }}</p>
      </form>

      <template #footer>
        <button type="button" @click="closeDialog">{{ t('common.cancel') }}</button>
        <button
          type="button"
          class="primary"
          :disabled="!newName || !parentDir"
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
import { nextTick, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useProjectStore } from '../stores/project'
import { useStudioI18n } from '../composables/useStudioI18n'
import StudioFloatingWindow from '../components/StudioFloatingWindow.vue'
import logoUrl from '../assets/logo.png'

const { t } = useStudioI18n()
const router = useRouter()
const project = useProjectStore()
const recent = ref<string[]>([])
const error = ref('')
const createError = ref('')
const createOpen = ref(false)
const newName = ref('')
const parentDir = ref('')
const nameInputEl = ref<HTMLInputElement | null>(null)

onMounted(async () => {
  try {
    if (typeof window.studio?.getRecentProjects !== 'function') {
      error.value = t('home.apiUnavailable')
      return
    }
    recent.value = await window.studio.getRecentProjects()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
})

watch(createOpen, async (open) => {
  if (!open) return
  await nextTick()
  nameInputEl.value?.focus()
})

function onCreate(): void {
  error.value = ''
  createError.value = ''
  newName.value = ''
  parentDir.value = ''
  createOpen.value = true
}

function closeDialog(): void {
  createOpen.value = false
  createError.value = ''
}

async function pickDir(): Promise<void> {
  const dir = await window.studio.selectDirectory()
  if (dir) parentDir.value = dir
}

async function confirmCreate(): Promise<void> {
  if (!newName.value || !parentDir.value) return
  try {
    createError.value = ''
    const result = await window.studio.createProject({
      name: newName.value,
      parentDir: parentDir.value
    })
    project.loadFromResult(result)
    await project.recoverAutosaves()
    closeDialog()
    router.push('/studio')
  } catch (e) {
    createError.value = e instanceof Error ? e.message : String(e)
  }
}

async function onOpen(): Promise<void> {
  try {
    error.value = ''
    const path = await window.studio.selectProject()
    if (!path) return
    await openPath(path)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function openPath(path: string): Promise<void> {
  try {
    error.value = ''
    const result = await window.studio.openProject(path)
    project.loadFromResult(result)
    await project.recoverAutosaves()
    router.push('/studio')
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function removeRecent(path: string): Promise<void> {
  try {
    error.value = ''
    recent.value = await window.studio.removeRecentProject(path)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
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

.hero-logo {
  display: block;
  width: min(260px, 70vw);
  height: auto;
  margin: 0 auto 20px;
  object-fit: contain;
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
  margin-bottom: 10px;
  font-weight: 600;
}

.recent ul {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.recent-row {
  display: flex;
  align-items: stretch;
  gap: 4px;
}

.linkish {
  flex: 1;
  min-width: 0;
  text-align: left;
  font-family: var(--mono);
  font-size: 12px;
  background: var(--bg-panel);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.recent-remove {
  flex-shrink: 0;
  width: 32px;
  padding: 0;
  font-size: 16px;
  line-height: 1;
  color: var(--text-muted);
  background: var(--bg-panel);
}

.recent-remove:hover {
  color: var(--danger);
}

.create-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.create-form label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--text-muted);
  font-size: 12px;
}

.create-form input {
  width: 100%;
  box-sizing: border-box;
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
  font-size: 12px;
  color: var(--danger);
  white-space: pre-wrap;
}
</style>
