<template>
  <div class="workspace-main">
    <div class="workspace-home">
      <header class="home-header">
        <h1 class="home-title">
          {{ t('workspace.empty.title') }}
        </h1>
        <p class="home-hint">
          {{ t('workspace.empty.hint') }}
        </p>
        <p class="home-pipeline">
          {{ t('workspace.empty.pipeline') }}
        </p>
      </header>

      <section
        class="home-section"
        aria-labelledby="workspace-create-heading"
      >
        <h2
          id="workspace-create-heading"
          class="section-label"
        >
          {{ t('workspace.empty.createTitle') }}
        </h2>
        <div class="create-grid">
          <button
            v-for="item in createItems"
            :key="item.id"
            type="button"
            class="create-btn"
            :disabled="busyId === item.id"
            @click="onCreate(item)"
          >
            <span
              class="create-icon"
              aria-hidden="true"
            >
              <WorkspaceItemIcon
                :icon="item.icon"
                :item-id="item.id"
                :size="18"
              />
            </span>
            <span class="create-label">{{ createItemLabel(item) }}</span>
          </button>
        </div>
      </section>

      <section
        class="home-section"
        aria-labelledby="workspace-recent-heading"
      >
        <h2
          id="workspace-recent-heading"
          class="section-label"
        >
          {{ t('workspace.empty.recentTitle') }}
        </h2>
        <ul
          v-if="recentAssets.length"
          class="recent-list"
        >
          <li
            v-for="asset in recentAssets"
            :key="asset.id"
          >
            <button
              type="button"
              class="recent-item"
              @click="openAsset(asset)"
            >
              <span
                class="recent-icon"
                aria-hidden="true"
              >
                <WorkspaceItemIcon
                  :icon="assetDisplayIcon(asset)"
                  :size="18"
                />
              </span>
              <span class="recent-meta">
                <span class="recent-name">{{ asset.name }}</span>
                <span class="recent-type">{{ recentTypeLabel(asset) }}</span>
              </span>
            </button>
          </li>
        </ul>
        <p
          v-else
          class="recent-empty"
        >
          {{ t('workspace.empty.recentEmpty') }}
        </p>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  assetDisplayIcon,
  isAnimationModelAsset,
  isFreeCanvasAsset,
  type AssetInfo
} from '@shared/domain'
import type { ResolvedWorkspaceToolbarItem } from '@shared/workspaceToolbar'
import { buildCanvasStarterGraph } from '@shared/graph'
import { useAssetCreation } from '../composables/useAssetCreation'
import { useDraftSave } from '../composables/useDraftSave'
import { useStudioI18n } from '../composables/useStudioI18n'
import { promptAlert, promptText } from '../composables/useStudioPrompt'
import { listRegisteredToolbarItems } from '../editor/extensions'
import { useProjectStore } from '../stores/project'
import WorkspaceItemIcon from './WorkspaceItemIcon.vue'

/** 空工作区优先展示的创作入口（与左侧工具栏一致，但只保留核心项） */
const CREATE_IDS = new Set(['freeCanvas', 'subgraph', 'screenplay', 'motion'])
const RECENT_LIMIT = 8

const project = useProjectStore()
const { openAssetEditor } = useAssetCreation()
const { createDraftAndOpen } = useDraftSave()
const { t, assetTypeLabel, assetCreateName, toolbarCreateLabel } = useStudioI18n()
const busyId = ref<string | null>(null)

const createItems = computed(() =>
  listRegisteredToolbarItems({ toolbar: true }).filter((item) => CREATE_IDS.has(item.id))
)

const recentAssets = computed(() => {
  return [...project.assets]
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, RECENT_LIMIT)
})

function recentTypeLabel(asset: AssetInfo): string {
  if (isAnimationModelAsset(asset)) return t('asset.type.modelAnimation')
  if (isFreeCanvasAsset(asset)) return t('asset.type.freeCanvas')
  return assetTypeLabel(asset.type)
}

function createItemLabel(item: ResolvedWorkspaceToolbarItem): string {
  return toolbarCreateLabel(item.id, item.assetType)
}

async function promptCreateName(options: {
  title: string
  message?: string
  defaultValue: string
  placeholder?: string
}): Promise<string | null> {
  const entered = await promptText({
    title: options.title,
    message: options.message ?? t('asset.create.nameMessage'),
    defaultValue: options.defaultValue,
    placeholder: options.placeholder ?? t('asset.create.namePlaceholder')
  })
  if (entered == null) return null
  const name = entered.trim()
  if (!name) {
    await promptAlert({
      title: options.title,
      message: t('validation.nameRequired')
    })
    return null
  }
  return name
}

async function onCreate(item: ResolvedWorkspaceToolbarItem): Promise<void> {
  if (busyId.value) return
  busyId.value = item.id
  try {
    if (item.id === 'freeCanvas') {
      const name = await promptCreateName({
        title: t('asset.create.freeCanvasNameTitle'),
        message: t('asset.create.freeCanvasNameMessage'),
        defaultValue: t('asset.create.freeCanvas'),
        placeholder: t('asset.create.freeCanvasNamePlaceholder')
      })
      if (!name) return
      createDraftAndOpen('canvas', {
        name,
        genParams: { canvasKind: 'free', graphJson: buildCanvasStarterGraph() }
      })
      return
    }
    const title = toolbarCreateLabel(item.id, item.assetType)
    const name = await promptCreateName({
      title,
      defaultValue: assetCreateName(item.assetType),
      placeholder: assetTypeLabel(item.assetType)
    })
    if (!name) return
    createDraftAndOpen(item.assetType, { name })
  } finally {
    busyId.value = null
  }
}

function openAsset(asset: AssetInfo): void {
  openAssetEditor(asset)
}
</script>

<style scoped>
.workspace-main {
  height: 100%;
  min-height: 0;
  overflow: auto;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  background:
    radial-gradient(ellipse at 50% 28%, var(--accent-06), transparent 52%),
    var(--bg-panel);
}

.workspace-home {
  width: min(520px, 100%);
  padding: 48px 28px 40px;
  box-sizing: border-box;
}

.home-header {
  margin-bottom: 28px;
}

.home-title {
  margin: 0 0 8px;
  font-size: 22px;
  font-weight: 650;
  letter-spacing: -0.02em;
  color: var(--text);
}

.home-hint {
  margin: 0 0 10px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-muted);
}

.home-pipeline {
  margin: 0;
  font-size: 12px;
  line-height: 1.4;
  color: rgba(196, 202, 211, 0.72);
  letter-spacing: 0.01em;
}

.home-section + .home-section {
  margin-top: 28px;
}

.section-label {
  margin: 0 0 10px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.create-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.create-btn {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: transparent;
  color: var(--text);
  text-align: left;
  cursor: pointer;
}

.create-btn:hover:not(:disabled),
.create-btn:focus-visible:not(:disabled) {
  background: var(--wash-04);
  border-color: var(--wash-22);
}

.create-btn:disabled {
  opacity: 0.55;
  cursor: wait;
}

.create-icon {
  font-size: 18px;
  line-height: 1;
  width: 22px;
  text-align: center;
  flex-shrink: 0;
}

.create-label {
  font-size: 13px;
  line-height: 1.2;
}

.recent-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.recent-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 40px;
  padding: 8px 10px;
  border: 1px solid transparent;
  border-radius: var(--radius);
  background: transparent;
  color: var(--text);
  text-align: left;
  cursor: pointer;
}

.recent-item:hover,
.recent-item:focus-visible {
  background: var(--wash-04);
  border-color: var(--border);
}

.recent-icon {
  font-size: 16px;
  width: 22px;
  text-align: center;
  flex-shrink: 0;
  opacity: 0.9;
}

.recent-meta {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.recent-name {
  font-size: 13px;
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.recent-type {
  font-size: 11px;
  color: var(--text-muted);
}

.recent-empty {
  margin: 0;
  font-size: 13px;
  color: var(--text-muted);
}
</style>
