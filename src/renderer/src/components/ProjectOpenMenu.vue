<template>
  <div class="project-open-menu">
    <button
      ref="btnEl"
      type="button"
      class="brand"
      :aria-expanded="menuOpen"
      :aria-haspopup="true"
      :title="t('app.menu.openAria')"
      :aria-label="t('app.menu.openAria')"
      @click="toggleMenu"
    >
      <img class="brand-logo" :src="logoUrl" alt="" />
      <span class="brand-name">AI Art Engine</span>
    </button>

    <Teleport to="body">
      <div
        v-if="menuOpen"
        ref="panelEl"
        class="menu-panel"
        :style="menuStyle"
        role="menu"
        @mousedown.stop
        @click.stop
      >
        <button type="button" class="menu-item" role="menuitem" :disabled="busy" @click="onNew">
          {{ t('home.createProject') }}
        </button>
        <button type="button" class="menu-item" role="menuitem" :disabled="busy" @click="onOpen">
          {{ t('home.openProject') }}…
        </button>

        <div class="menu-sep" role="separator" />
        <div class="menu-section-label">{{ t('home.recentProjects') }}</div>
        <p v-if="!recent.length" class="menu-empty">{{ t('app.menu.recentEmpty') }}</p>
        <div v-for="path in recent" :key="path" class="recent-row">
          <button
            type="button"
            class="menu-item recent-open"
            role="menuitem"
            :title="path"
            :disabled="busy"
            @click="onOpenRecent(path)"
          >
            <span class="recent-name">{{ projectRecentLabel(path) }}</span>
            <span class="recent-path">{{ shortRecentPath(path) }}</span>
          </button>
          <button
            type="button"
            class="recent-remove"
            :title="t('home.removeRecent')"
            :aria-label="t('home.removeRecent')"
            :disabled="busy"
            @click.stop="onRemoveRecent(path)"
          >
            ×
          </button>
        </div>

        <template v-if="project.isOpen">
          <div class="menu-sep" role="separator" />
          <button type="button" class="menu-item" role="menuitem" @click="onGoHome">
            {{ t('studio.backHome') }}
          </button>
          <button
            type="button"
            class="menu-item"
            role="menuitem"
            :disabled="busy"
            @click="onCloseProject"
          >
            {{ t('app.menu.closeProject') }}
          </button>
        </template>

        <p v-if="error && error !== 'api-unavailable'" class="menu-error">{{ error }}</p>
        <p v-else-if="error === 'api-unavailable'" class="menu-error">
          {{ t('home.apiUnavailable') }}
        </p>
      </div>
    </Teleport>

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
      <form class="create-form" @submit.prevent="onConfirmCreate">
        <label>
          {{ t('home.dialog.projectName') }}
          <input
            ref="nameInputEl"
            v-model="newName"
            required
            placeholder="MyShortFilm"
            @keydown.esc.prevent="closeCreateDialog"
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
            <button type="button" @click="pickCreateDir">{{ t('common.browse') }}</button>
          </div>
        </label>
        <p v-if="createError" class="form-error">{{ createError }}</p>
      </form>

      <template #footer>
        <button type="button" @click="closeCreateDialog">{{ t('common.cancel') }}</button>
        <button
          type="button"
          class="primary"
          :disabled="!newName || !parentDir || busy"
          @click="onConfirmCreate"
        >
          {{ t('common.create') }}
        </button>
      </template>
    </StudioFloatingWindow>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import StudioFloatingWindow from './StudioFloatingWindow.vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import {
  projectRecentLabel,
  useProjectLifecycle
} from '../composables/useProjectLifecycle'
import { useProjectStore } from '../stores/project'
import { placeFixedMenu } from '../utils/clampFixedMenuPosition'
import logoUrl from '../assets/logo-mark.png'

const { t } = useStudioI18n()
const router = useRouter()
const project = useProjectStore()
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
  removeRecent,
  closeProject
} = useProjectLifecycle()

const menuOpen = ref(false)
const btnEl = ref<HTMLButtonElement | null>(null)
const panelEl = ref<HTMLElement | null>(null)
const nameInputEl = ref<HTMLInputElement | null>(null)
const menuPos = ref({ x: 0, y: 0 })

const menuStyle = computed(() => ({
  left: `${menuPos.value.x}px`,
  top: `${menuPos.value.y}px`
}))

function shortRecentPath(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  if (normalized.length <= 42) return normalized
  return `…${normalized.slice(-40)}`
}

async function placeMenu(): Promise<void> {
  await nextTick()
  const btn = btnEl.value
  const panel = panelEl.value
  if (!btn || !panel) return
  const rect = btn.getBoundingClientRect()
  menuPos.value = placeFixedMenu(panel, rect.left, rect.bottom + 4)
}

async function openMenu(): Promise<void> {
  menuOpen.value = true
  try {
    await refreshRecent()
  } catch {
    // refreshRecent 已写入 error
  }
  await placeMenu()
}

function closeMenu(): void {
  menuOpen.value = false
}

function toggleMenu(): void {
  if (menuOpen.value) closeMenu()
  else void openMenu()
}

function onNew(): void {
  closeMenu()
  openCreateDialog()
}

async function onOpen(): Promise<void> {
  closeMenu()
  await browseAndOpen()
}

async function onOpenRecent(path: string): Promise<void> {
  closeMenu()
  await openProjectPath(path)
}

async function onRemoveRecent(path: string): Promise<void> {
  await removeRecent(path)
}

function onGoHome(): void {
  closeMenu()
  void router.push('/')
}

async function onCloseProject(): Promise<void> {
  closeMenu()
  await closeProject()
}

async function onConfirmCreate(): Promise<void> {
  await confirmCreate()
}

function onDocPointerDown(event: PointerEvent): void {
  if (!menuOpen.value) return
  const target = event.target as Node | null
  if (btnEl.value?.contains(target) || panelEl.value?.contains(target)) return
  closeMenu()
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && menuOpen.value) {
    event.preventDefault()
    closeMenu()
  }
}

watch(createOpen, async (open) => {
  if (!open) return
  await nextTick()
  nameInputEl.value?.focus()
})

onMounted(() => {
  document.addEventListener('pointerdown', onDocPointerDown, true)
  window.addEventListener('keydown', onKeydown)
  void refreshRecent()
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocPointerDown, true)
  window.removeEventListener('keydown', onKeydown)
})
</script>

<style scoped>
.project-open-menu {
  position: relative;
  display: inline-flex;
  -webkit-app-region: no-drag;
  app-region: no-drag;
}

.brand {
  display: inline-flex;
  align-items: center;
  height: 28px;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  -webkit-app-region: no-drag;
  app-region: no-drag;
}

.brand:hover .brand-name {
  color: var(--text);
}

.brand-logo {
  display: block;
  height: 26px;
  width: 26px;
  object-fit: contain;
}

.brand-name {
  margin-left: 8px;
  color: var(--text);
  font-size: 14px;
  font-weight: 650;
  letter-spacing: -0.01em;
  white-space: nowrap;
}

.menu-panel {
  position: fixed;
  z-index: 5200;
  min-width: 240px;
  max-width: min(360px, calc(100vw - 16px));
  max-height: min(420px, calc(100vh - 16px));
  overflow: auto;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-elevated);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.menu-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  width: 100%;
  margin: 0;
  padding: 6px 10px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.menu-item:hover:not(:disabled) {
  background: var(--bg-hover);
}

.menu-item:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.menu-sep {
  height: 1px;
  margin: 4px 6px;
  background: var(--border);
}

.menu-section-label {
  padding: 6px 10px 2px;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 600;
}

.menu-empty {
  margin: 0;
  padding: 4px 10px 8px;
  color: var(--text-muted);
  font-size: 12px;
}

.menu-error {
  margin: 4px 6px 2px;
  padding: 6px 8px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--danger) 16%, transparent);
  color: var(--danger);
  font-size: 11px;
  line-height: 1.35;
}

.recent-row {
  display: flex;
  align-items: stretch;
  gap: 2px;
}

.recent-open {
  flex: 1;
  min-width: 0;
}

.recent-name {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}

.recent-path {
  color: var(--text-muted);
  font-family: var(--mono);
  font-size: 10px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}

.recent-remove {
  flex: 0 0 28px;
  margin: 0;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}

.recent-remove:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--danger);
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
