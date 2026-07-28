<template>
  <div
    ref="rootEl"
    class="asset-browser"
    :class="{ embedded }"
    @pointerenter="pointerInside = true"
    @pointerleave="pointerInside = false"
    @dragenter.prevent="onBrowserDragEnter"
    @dragover.prevent="onBrowserDragOver"
    @dragleave="onBrowserDragLeave"
    @drop.prevent="onBrowserDrop"
  >
    <div v-if="!embedded" class="toolbar">
      <span class="title">{{ t('asset.browser.title') }}</span>
      <span class="import-hint">
        {{
          selectedAssetCount > 0
            ? t('asset.browser.selectedCount', { count: selectedAssetCount })
            : t('asset.browser.refreshHint')
        }}
      </span>
      <div class="toolbar-actions">
        <button
          type="button"
          :disabled="refreshing || !project.isOpen"
          :title="t('asset.browser.refreshTitle')"
          :aria-label="t('asset.browser.refresh')"
          @click="onRefresh"
        >
          <RefreshIcon :size="14" :spinning="refreshing" />
        </button>
      </div>
    </div>

    <div class="filters">
      <input v-model="query" :placeholder="t('common.search')" />
      <select v-model="typeFilter">
        <option value="all">{{ t('common.all') }}</option>
        <option v-for="type in filterTypes" :key="type" :value="type">{{ assetTypeLabel(type) }}</option>
      </select>
    </div>

    <div ref="splitEl" class="split">
      <aside
        class="tree-pane"
        :style="{ width: `${treePaneWidth}px` }"
        @click="onTreePaneClick"
        @contextmenu.prevent="onTreeBlankContextMenu"
      >
        <div
          v-for="row in visibleTreeRows"
          :key="row.id"
          class="tree-row"
          :class="{ active: isTreeRowActive(row), 'drop-over': isTreeRowDropOver(row) }"
          :style="{ paddingLeft: `${4 + row.depth * 14}px` }"
          @click="selectFolder(folderIdFromTreeRow(row.id))"
          @contextmenu.prevent.stop="onTreeRowContextMenu($event, row.id)"
          @dragover.prevent="onFolderDragOver($event, folderIdFromTreeRow(row.id))"
          @dragleave="onFolderDragLeave(folderIdFromTreeRow(row.id))"
          @drop.prevent="onDropToFolder($event, folderIdFromTreeRow(row.id))"
        >
          <span
            class="twist"
            :class="{
              open: isTreeTwistOpen(row),
              hidden: !isTreeTwistVisible(row)
            }"
            @click.stop="toggleExpanded(row.id)"
          />
          <FolderTreeIcon :open="isFolderIconOpen(row)" />
          <span class="tree-label">{{ row.name }}</span>
        </div>
      </aside>

      <div
        class="splitter"
        :class="{ dragging: isSplitterDragging }"
        :title="t('asset.browser.resizeFolderPane')"
        @mousedown.prevent="onSplitterDown"
      />

      <section
        class="content-pane"
        @dragover.prevent="onCurrentFolderDragOver"
        @dragleave="onCurrentFolderDragLeave"
        @drop.prevent="onDropToFolder($event, currentFolderId)"
      >
        <div class="crumbs">
          <div class="crumb-trail">
            <button type="button" class="crumb" @click="selectFolder(null)">
              {{ t('asset.browser.assetsRoot') }}
            </button>
            <template v-for="crumb in breadcrumbs" :key="crumb.id">
              <span class="sep" aria-hidden="true">&gt;</span>
              <button type="button" class="crumb" @click="selectFolder(crumb.id)">
                {{ crumb.name }}
              </button>
            </template>
          </div>
        </div>

        <div
          ref="gridEl"
          class="grid"
          :class="{ list: !showThumbs, 'drop-over': dropTargetId === CURRENT_DROP, selecting: !!selectionBox }"
          :style="gridStyle"
          @pointerdown="onGridPointerDown"
          @dragover.prevent="onCurrentFolderDragOver"
          @dragleave="onCurrentFolderDragLeave"
          @drop.prevent="onDropToFolder($event, currentFolderId)"
          @contextmenu.prevent="onBlankContextMenu"
        >
          <div
            v-if="selectionBox"
            class="selection-marquee"
            :style="{
              left: `${selectionBox.x}px`,
              top: `${selectionBox.y}px`,
              width: `${selectionBox.w}px`,
              height: `${selectionBox.h}px`
            }"
          />
          <div
            v-for="folder in visibleFolders"
            :key="folder.id"
            class="card folder"
            :class="{ 'drop-over': dropTargetId === folder.id }"
            @click="selectFolder(folder.id)"
            @dblclick="selectFolder(folder.id)"
            @contextmenu.prevent.stop="onFolderContextMenu($event, folder.id)"
            @dragover.prevent.stop="onFolderDragOver($event, folder.id)"
            @dragleave.stop="onFolderDragLeave(folder.id)"
            @drop.prevent.stop="onDropToFolder($event, folder.id)"
            :title="folder.name"
          >
            <div v-if="showThumbs" class="thumb folder-thumb">
              <FolderTreeIcon :open="false" />
            </div>
            <span v-else class="list-row-icon"><FolderTreeIcon :open="false" /></span>
            <div class="name">{{ folder.name }}</div>
          </div>

          <div
            v-for="asset in visibleAssets"
            :key="asset.id"
            class="card"
            :class="{
              selected: isAssetSelected(asset.id),
              'is-media-ref': isImportedMediaRefAsset(asset)
            }"
            :data-asset-id="asset.id"
            draggable="true"
            @click.stop="onAssetClick(asset.id, $event)"
            @dragstart="onDragStart($event, asset)"
            @dragend="onDragEnd"
            @dblclick="onAssetDblClick(asset.id)"
            @contextmenu.prevent.stop="onAssetContextMenu($event, asset.id)"
            :title="asset.name"
          >
            <div v-if="showThumbs" class="thumb">
              <img v-if="thumbUrls[asset.id]" :src="thumbUrls[asset.id]" alt="" />
              <span v-else class="badge">{{ assetLabel(asset) }}</span>
              <span
                v-if="isImportedMediaRefAsset(asset)"
                class="ref-mark"
                :title="assetLabel(asset)"
              >{{ t('asset.browser.refMark') }}</span>
            </div>
            <span
              v-else-if="thumbUrls[asset.id]"
              class="list-icon list-thumb"
              :title="assetLabel(asset)"
            >
              <img :src="thumbUrls[asset.id]" alt="" />
            </span>
            <span
              v-else
              class="list-icon"
              :title="assetLabel(asset)"
            >{{ assetIcon(asset) }}</span>
            <div class="name">{{ asset.name }}</div>
            <button type="button" class="del" @click.stop="deleteAssets([asset.id])" :title="t('common.delete')">×</button>
          </div>

          <p v-if="!visibleFolders.length && !visibleAssets.length" class="empty">
            {{ t('asset.browser.dropHint') }}
          </p>
        </div>
      </section>
    </div>

    <footer class="bottom-bar" :class="{ compact: embedded }">
      <div v-if="!embedded" class="status-bar" :title="footerPath">{{ footerPath }}</div>
      <label class="view-size" :title="t('asset.browser.viewSizeHint')">
        <span class="view-size-label">{{ viewSize === 0 ? t('asset.browser.viewList') : t('asset.browser.viewIcon') }}</span>
        <input
          :value="viewSize"
          type="range"
          min="0"
          max="120"
          step="1"
          @input="onViewSizeInput"
        />
      </label>
    </footer>

    <div v-if="externalImportHover" class="import-overlay" aria-hidden="true">
      <div class="import-panel">
        <div class="import-icon">⬇</div>
        <div class="import-title">{{ t('asset.browser.dropRelease') }}</div>
        <div class="import-target">{{ importTargetLabel }}</div>
        <div class="import-types">{{ t('asset.import.extensionsLabel') }}</div>
      </div>
    </div>

    <Teleport to="body">
      <div
        v-if="menu"
        ref="ctxMenuEl"
        class="ctx-menu"
        :style="{ left: menu.x + 'px', top: menu.y + 'px' }"
        @mousedown.stop
        @click.stop
      >
      <template v-if="menu.kind === 'blank' || menu.kind === 'folder' || menu.kind === 'tree-root'">
        <button
          v-for="item in toolbarCreateItems"
          :key="item.id"
          type="button"
          @click="createToolbarItemHere(item)"
        >
          {{ toolbarCreateLabel(item.id, item.assetType) }}
        </button>
        <div class="ctx-sep" />
        <button type="button" @click="startCreateFolder">{{ t('asset.folder.new') }}</button>
        <button type="button" @click="onImportPackageMenu">{{ t('asset.browser.importPackage') }}</button>
        <template v-if="menu.kind === 'folder'">
          <div class="ctx-sep" />
          <button type="button" @click="onReimportFolder">{{ t('asset.browser.context.reimport') }}</button>
          <button type="button" @click="onExportFolderPackage">{{ t('asset.browser.exportPackage') }}</button>
          <button type="button" @click="startRenameFolder">{{ t('asset.folder.rename') }}</button>
          <button type="button" class="danger" @click="deleteFolderTarget('hoist')">
            {{ t('asset.folder.delete') }}
          </button>
          <button type="button" class="danger" @click="deleteFolderTarget('deleteContents')">
            {{ t('asset.folder.deleteWithContents') }}
          </button>
        </template>
        <template v-else-if="menu.kind === 'blank' || menu.kind === 'tree-root'">
          <div class="ctx-sep" />
          <button type="button" @click="onExportLibraryPackage">{{ t('asset.browser.exportPackage') }}</button>
        </template>
      </template>
      <template v-else-if="menu.kind === 'asset'">
        <button
          v-if="contextMenuAssetCount === 1 && contextMenuCanOpenEditor"
          type="button"
          @click="openEditor(menu.targetId!)"
        >
          {{ t('asset.browser.context.openEditor') }}
        </button>
        <button
          v-if="contextMenuAssetCount === 1 && contextMenuCanRevealInFolder"
          type="button"
          @click="showContextAssetInFolder"
        >
          {{ t('asset.browser.context.showInFolder') }}
        </button>
        <button type="button" @click="copyContextMenuOriginalFiles">
          {{ t('asset.browser.context.copyOriginal') }}
        </button>
        <button type="button" @click="onReimportSelectedAssets">
          {{ t('asset.browser.context.reimport') }}
        </button>
        <button type="button" @click="onExportSelectedPackage">{{ t('asset.browser.exportPackage') }}</button>
        <button
          v-if="contextMenuAssetCount === 1"
          type="button"
          @click="startRenameAsset"
        >
          {{ t('asset.browser.context.rename') }}
        </button>
        <button type="button" @click="findContextMenuReferences">
          {{ t('asset.browser.context.findReferences') }}
        </button>
        <button type="button" class="danger" @click="deleteContextMenuAssets">
          {{
            contextMenuAssetCount > 1
              ? t('asset.browser.context.deleteSelected', { count: contextMenuAssetCount })
              : t('asset.browser.context.delete')
          }}
        </button>
      </template>
      </div>
    </Teleport>

    <StudioFloatingWindow
      :open="!!nameDialog"
      :title="nameDialog?.title ?? ''"
      :show-close="false"
      :default-width="360"
      :default-height="240"
      @close="closeNameDialog"
    >
      <input
        v-if="nameDialog && nameDialog.mode !== 'alert'"
        ref="nameInputEl"
        v-model="nameDialog.value"
        @keydown.enter.prevent="confirmNameDialog"
        @keydown.esc.prevent="closeNameDialog"
      />
      <p v-if="nameDialog?.message" class="msg">{{ nameDialog.message }}</p>
      <p v-if="nameDialog?.error" class="err">{{ nameDialog.error }}</p>

      <template #footer>
        <button v-if="nameDialog && nameDialog.mode !== 'alert'" type="button" @click="closeNameDialog">
          {{ t('common.cancel') }}
        </button>
        <button type="button" class="primary" @click="confirmNameDialog">
          {{ nameDialog?.mode === 'alert' ? t('common.gotIt') : t('common.confirm') }}
        </button>
      </template>
    </StudioFloatingWindow>

    <AssetPackageTreeDialog
      :open="packageDialog.open"
      :title="packageDialog.title"
      :subtitle="packageDialog.subtitle"
      :confirm-label="packageDialog.confirmLabel"
      :rows="packageDialog.rows"
      :initial-selected="packageDialog.initialSelected"
      :initial-include-dependencies="packageDialog.includeDependencies"
      :busy="packageDialog.busy"
      :error="packageDialog.error"
      :tip="packageDialog.tip"
      @cancel="closePackageDialog"
      @confirm="onPackageDialogConfirm"
    />

    <GraphTextNotepadDialog
      :open="screenplayNotepad.open"
      :title="screenplayNotepad.title"
      :text="screenplayNotepad.text"
      :editable="true"
      @close="closeScreenplayNotepad"
      @save="saveScreenplayNotepad"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  assetDisplayIcon,
  isAnimationModelAsset,
  isDraftAssetId,
  isImportedMediaRefAsset,
  isPoseModelAsset,
  isScreenplayAsset,
  type AssetInfo,
  type AssetType
} from '@shared/domain'
import {
  ASSETS_ROOT_TREE_KEY,
  buildVisibleFlatFolderTree,
  collectFolderSubtreeIds,
  compareNames,
  folderChildren,
  normalizeFolders
} from '@shared/folderTree'
import type { ResolvedWorkspaceToolbarItem } from '@shared/workspaceToolbar'
import { useAssetCreation } from '../composables/useAssetCreation'
import { useSeriesCreation } from '../composables/useSeriesCreation'
import {
  listRegisteredToolbarItems
} from '../editor/extensions'
import { useEditorKernel } from '../editor/kernel'
import { useProjectStore } from '../stores/project'
import { useWorkspaceStore, STUDIO_ASSET_DRAG_MIME, STUDIO_ASSET_ID_DRAG_MIME, STUDIO_ASSET_IDS_DRAG_MIME } from '../stores/workspace'
import { useStudioI18n } from '../composables/useStudioI18n'
import { promptAlert, promptConfirm, promptText } from '../composables/useStudioPrompt'
import { toPlain } from '../utils/toPlain'
import { placeFixedMenu } from '../utils/clampFixedMenuPosition'
import {
  invalidateAssetUrlCache,
  resolveAssetPreviewUrl
} from '../features/media/assetUrlCache'
import { resolveAssetText } from '../features/media/resolveAssetText'
import { openImportedMediaRefPreview } from '../features/media/openFullImagePreview'
import { thumbRelativePathFor } from '@shared/media/thumbnailPath'
import FolderTreeIcon from './FolderTreeIcon.vue'
import RefreshIcon from './icons/RefreshIcon.vue'
import GraphTextNotepadDialog from './GraphTextNotepadDialog.vue'
import AssetPackageTreeDialog from './AssetPackageTreeDialog.vue'
import StudioFloatingWindow from './StudioFloatingWindow.vue'
import {
  summarizeReferenceSites,
  type AssetReferenceHit,
  type AssetReferenceSite
} from '@shared/assetReferences'
import {
  buildPreviewPackageTree,
  buildProjectPackageTree,
  collectDescendantGuids,
  selectionToExportIds,
  type AssetPackageTreeRow
} from '@shared/assetPackage/tree'

const props = withDefaults(
  defineProps<{
    /** 嵌入侧栏时隐藏顶部工具栏，压缩留白 */
    embedded?: boolean
  }>(),
  { embedded: false }
)

const toolbarCreateItems = computed(() => listRegisteredToolbarItems({ assetMenu: true }))

const ROOT_DROP = '__root__'
const CURRENT_DROP = '__current__'
const ASSET_MOVE_MIME = STUDIO_ASSET_ID_DRAG_MIME
const VIEW_SIZE_KEY = 'studio.assets.viewSize'
const TREE_WIDTH_KEY = 'studio.assets.treeWidth'
const DEFAULT_TREE_WIDTH = 180
const TREE_MIN_WIDTH = 120
const TREE_MAX_RATIO = 0.65

function clampViewSize(n: number): number {
  if (!Number.isFinite(n)) return 72
  return Math.min(120, Math.max(0, Math.round(n / 8) * 8))
}

function clampTreeWidth(n: number, maxWidth = Infinity): number {
  if (!Number.isFinite(n)) return DEFAULT_TREE_WIDTH
  return Math.round(Math.min(maxWidth, Math.max(TREE_MIN_WIDTH, n)))
}

function readTreeMaxWidth(): number {
  const total = splitEl.value?.clientWidth ?? 0
  if (total <= 0) return 480
  return Math.max(TREE_MIN_WIDTH + 80, Math.round(total * TREE_MAX_RATIO))
}

interface CtxMenu {
  kind: 'blank' | 'folder' | 'asset' | 'tree-root'
  x: number
  y: number
  targetId?: string
}

interface NameDialog {
  mode: 'create-folder' | 'rename-folder' | 'rename-asset' | 'alert'
  title: string
  value: string
  targetId?: string
  parentId: string | null
  /** 普通提示（非红色） */
  message?: string
  /** 真正的错误（红色） */
  error: string
}

const project = useProjectStore()
const workspace = useWorkspaceStore()
const editor = useEditorKernel()
const { createAsset, openAssetEditor } = useAssetCreation()
const { createSeriesWithStarter } = useSeriesCreation()
const { t, assetTypeLabel, toolbarCreateLabel } = useStudioI18n()

function assetIcon(asset: AssetInfo): string {
  return assetDisplayIcon(asset)
}

function assetLabel(asset: AssetInfo): string {
  if (isAnimationModelAsset(asset)) return t('asset.type.modelAnimation')
  if (isPoseModelAsset(asset)) return t('asset.type.modelPose')
  if (isImportedMediaRefAsset(asset)) {
    if (asset.type === 'image') return t('asset.type.imageRef')
    if (asset.type === 'video') return t('asset.type.videoRef')
    if (asset.type === 'voice') return t('asset.type.voiceRef')
    if (asset.type === 'screenplay') return t('asset.type.screenplayRef')
  }
  return assetTypeLabel(asset.type)
}

const query = ref('')
const refreshing = ref(false)
const typeFilter = ref('all')
const currentFolderId = ref<string | null>(null)
/** folderId -> expanded; default true */
const expandedMap = ref<Record<string, boolean>>({})
const thumbUrls = ref<Record<string, string>>({})
const menu = ref<CtxMenu | null>(null)
const ctxMenuEl = ref<HTMLElement | null>(null)
const nameDialog = ref<NameDialog | null>(null)
const nameInputEl = ref<HTMLInputElement | null>(null)

type PackageDialogState = {
  open: boolean
  mode: 'export' | 'import'
  title: string
  subtitle: string
  confirmLabel: string
  rows: AssetPackageTreeRow[]
  initialSelected: string[]
  includeDependencies: boolean
  busy: boolean
  error: string
  tip: string
  /** import only */
  packPath: string | null
  destinationFolderId: string | null
}

const packageDialog = ref<PackageDialogState>({
  open: false,
  mode: 'export',
  title: '',
  subtitle: '',
  confirmLabel: '',
  rows: [],
  initialSelected: [],
  includeDependencies: true,
  busy: false,
  error: '',
  tip: '',
  packPath: null,
  destinationFolderId: null
})

function closePackageDialog(): void {
  if (packageDialog.value.busy) return
  packageDialog.value = {
    ...packageDialog.value,
    open: false,
    busy: false,
    error: '',
    tip: '',
    packPath: null
  }
}

function openExportPackageDialog(initialSelected: string[]): void {
  const rows = buildProjectPackageTree(project.folders, project.assets)
  packageDialog.value = {
    open: true,
    mode: 'export',
    title: t('asset.package.exportTitle'),
    subtitle: t('asset.package.exportSubtitle'),
    confirmLabel: t('asset.package.exportConfirm'),
    rows,
    initialSelected,
    includeDependencies: true,
    busy: false,
    error: '',
    tip: '',
    packPath: null,
    destinationFolderId: null
  }
}

async function openImportPackageDialog(
  packPath: string | undefined,
  destinationFolderId: string | null
): Promise<void> {
  try {
    const preview = await window.studio.previewAssetPackage(packPath)
    if (!preview) return
    const rows = buildPreviewPackageTree(preview.entries)
    packageDialog.value = {
      open: true,
      mode: 'import',
      title: t('asset.package.importTitle'),
      subtitle: `${t('asset.package.importSubtitle')}\n${preview.name}`,
      confirmLabel: t('asset.package.importConfirm'),
      rows,
      initialSelected: rows.map((r) => r.guid),
      includeDependencies: true,
      busy: false,
      error: '',
      tip: '',
      packPath: preview.packPath,
      destinationFolderId
    }
  } catch (e) {
    await reportPackageError(t('asset.browser.importPackage'), e)
  }
}

async function onPackageDialogConfirm(payload: {
  selectedGuids: string[]
  includeDependencies: boolean
}): Promise<void> {
  const dialog = packageDialog.value
  if (!dialog.open || dialog.busy) return
  packageDialog.value = { ...dialog, busy: true, error: '', tip: '' }
  try {
    if (dialog.mode === 'export') {
      const { assetIds, folderIds } = selectionToExportIds(
        dialog.rows,
        new Set(payload.selectedGuids)
      )
      if (!assetIds.length && !folderIds.length) {
        packageDialog.value = {
          ...packageDialog.value,
          busy: false,
          tip: t('asset.browser.packageNeedSelection')
        }
        return
      }
      const result = await window.studio.exportAssetPackage({
        assetIds,
        folderIds,
        includeDependencies: payload.includeDependencies
      })
      packageDialog.value = { ...packageDialog.value, open: false, busy: false }
      if (!result.path) return
      await openNameDialog({
        mode: 'alert',
        title: t('asset.browser.exportPackage'),
        value: '',
        parentId: null,
        error: '',
        message: t('asset.browser.packageExportDone', {
          assets: result.exportedAssets,
          folders: result.exportedFolders,
          path: result.path
        })
      })
      return
    }

    if (!dialog.packPath) {
      packageDialog.value = {
        ...packageDialog.value,
        busy: false,
        tip: t('asset.package.emptyTree')
      }
      return
    }
    const result = await window.studio.importAssetPackage({
      packPath: dialog.packPath,
      destinationFolderId: dialog.destinationFolderId,
      selectedGuids: payload.selectedGuids,
      includeDependencies: payload.includeDependencies
    })
    packageDialog.value = { ...packageDialog.value, open: false, busy: false }
    if (result.canceled) return
    await project.refreshLibrary()
    await project.refreshShots()
    await openNameDialog({
      mode: 'alert',
      title: t('asset.browser.importPackage'),
      value: '',
      parentId: null,
      error: '',
      message: t('asset.browser.packageImportDone', {
        assets: result.importedAssets,
        folders: result.importedFolders,
        folderReuse: result.reusedFolders,
        reused: result.reused,
        remapped: result.remapped
      })
    })
  } catch (e) {
    packageDialog.value = {
      ...packageDialog.value,
      busy: false,
      error: e instanceof Error ? e.message : String(e)
    }
  }
}

const splitEl = ref<HTMLElement | null>(null)
const gridEl = ref<HTMLElement | null>(null)
const selectedAssetIds = ref<Set<string>>(new Set())
const anchorAssetId = ref<string | null>(null)
const selectionBox = ref<{ x: number; y: number; w: number; h: number } | null>(null)
const dropTargetId = ref<string | null>(null)
const draggingAssetIds = ref<string[]>([])
/** 拖动结束后可能仍会冒泡 click，用此跳过 Inspector 同步 */
let skipAssetClickSync = false
let skipAssetClickSyncTimer: ReturnType<typeof setTimeout> | null = null
const externalImportHover = ref(false)
let externalDragDepth = 0
const isSplitterDragging = ref(false)
const viewSize = ref(clampViewSize(Number(localStorage.getItem(VIEW_SIZE_KEY) || 0)))
const treePaneWidth = ref(
  clampTreeWidth(Number(localStorage.getItem(TREE_WIDTH_KEY) || DEFAULT_TREE_WIDTH))
)
const showThumbs = computed(() => viewSize.value > 0)
const gridStyle = computed(() => {
  if (viewSize.value <= 0) return {}
  const cell = Math.max(56, viewSize.value)
  return {
    gridTemplateColumns: `repeat(auto-fill, minmax(${cell}px, 1fr))`,
    '--folder-emoji': `${Math.round(cell * 0.32)}px`
  }
})

function persistViewSize(): void {
  localStorage.setItem(VIEW_SIZE_KEY, String(clampViewSize(viewSize.value)))
}

function onViewSizeInput(event: Event): void {
  const raw = Number((event.target as HTMLInputElement).value)
  viewSize.value = clampViewSize(raw)
  persistViewSize()
}

function persistTreeWidth(): void {
  localStorage.setItem(TREE_WIDTH_KEY, String(treePaneWidth.value))
}

function onSplitterDown(e: MouseEvent): void {
  if (e.button !== 0) return
  isSplitterDragging.value = true
  const startX = e.clientX
  const startWidth = treePaneWidth.value

  const onMove = (ev: MouseEvent): void => {
    const delta = ev.clientX - startX
    treePaneWidth.value = clampTreeWidth(startWidth + delta, readTreeMaxWidth())
  }

  const onUp = (): void => {
    isSplitterDragging.value = false
    persistTreeWidth()
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
  }

  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

const filterTypes: AssetType[] = [
  'canvas',
  'subgraph',
  'world',
  'narrative',
  'script',
  'screenplay',
  'image',
  'video',
  'voice',
  'motion',
  'model'
]

const normalizedFolders = computed(() => normalizeFolders(project.folders))

const visibleTreeRows = computed(() =>
  buildVisibleFlatFolderTree(
    project.folders,
    (id) => isExpanded(id),
    t('asset.browser.assetsRoot')
  )
)

const breadcrumbs = computed(() => {
  const trail: { id: string; name: string }[] = []
  const byId = new Map(normalizedFolders.value.map((f) => [f.id, f]))
  let id = currentFolderId.value
  while (id) {
    const folder = byId.get(id)
    if (!folder) break
    trail.unshift({ id: folder.id, name: folder.name })
    id = folder.parentId
  }
  return trail
})

const footerPath = computed(() => {
  const segments = [t('asset.browser.assetsRoot'), ...breadcrumbs.value.map((crumb) => crumb.name)]
  if (selectedAssetCount.value === 1) {
    const assetId = [...selectedAssetIds.value][0]
    const asset = project.assets.find((item) => item.id === assetId)
    if (asset && (asset.folderId ?? null) === currentFolderId.value) {
      segments.push(asset.name)
    }
  }
  return segments.join('/')
})

const importTargetLabel = computed(() => {
  const root = t('asset.browser.assetsRoot')
  const target = dropTargetId.value
  if (!target || target === CURRENT_DROP) {
    if (!currentFolderId.value) return root
    const folder = normalizedFolders.value.find((f) => f.id === currentFolderId.value)
    return folder ? `${root} / ${folder.name}` : root
  }
  if (target === ROOT_DROP) return root
  const folder = normalizedFolders.value.find((f) => f.id === target)
  return folder ? `${root} / ${folder.name}` : root
})

const visibleFolders = computed(() => folderChildren(project.folders, currentFolderId.value))

const visibleAssets = computed(() => {
  return project.assets
    .filter((a) => {
      if ((a.folderId ?? null) !== currentFolderId.value) return false
      if (typeFilter.value !== 'all' && a.type !== typeFilter.value) return false
      if (query.value && !a.name.toLowerCase().includes(query.value.toLowerCase())) return false
      return true
    })
    .sort((a, b) => compareNames(a.name, b.name))
})

const selectedAssetCount = computed(() => selectedAssetIds.value.size)

const contextMenuAssetCount = computed(() => {
  if (menu.value?.kind !== 'asset') return 0
  const targetId = menu.value.targetId
  if (!targetId) return 0
  if (selectedAssetIds.value.has(targetId) && selectedAssetIds.value.size > 1) {
    return selectedAssetIds.value.size
  }
  return 1
})

const contextMenuCanOpenEditor = computed(() => {
  if (menu.value?.kind !== 'asset' || !menu.value.targetId) return false
  return workspace.canOpenEditorForAssetId(menu.value.targetId)
})

const contextMenuCanRevealInFolder = computed(() => {
  if (menu.value?.kind !== 'asset' || !menu.value.targetId) return false
  if (isDraftAssetId(menu.value.targetId)) return false
  return project.assets.some((a) => a.id === menu.value!.targetId)
})

watch(
  () => visibleAssets.value.map((asset) => asset.id).join('\n'),
  () => {
    if (selectedAssetIds.value.size === 0) return
    const valid = new Set(visibleAssets.value.map((asset) => asset.id))
    const next = new Set([...selectedAssetIds.value].filter((id) => valid.has(id)))
    if (next.size !== selectedAssetIds.value.size) {
      setAssetSelection([...next])
    }
  }
)

watch(currentFolderId, () => {
  clearAssetSelectionLocal()
})

watch(
  () => project.sessionEpoch,
  () => {
    currentFolderId.value = null
    clearAssetSelectionLocal()
    query.value = ''
  }
)

async function loadAssetListThumb(asset: AssetInfo): Promise<void> {
  if ((asset.type !== 'image' && asset.type !== 'video') || !asset.relativePath) return
  try {
    thumbUrls.value[asset.id] = await resolveAssetPreviewUrl(asset.relativePath)
  } catch {
    /* 视频首帧提取失败时仍显示类型徽章 */
  }
}

watch(
  () => project.assets,
  async (list) => {
    for (const a of list) {
      if (thumbUrls.value[a.id]) continue
      await loadAssetListThumb(a)
    }
  },
  { immediate: true, deep: true }
)

watch(
  () => project.folders.map((f) => `${f.id}:${f.parentId ?? ''}`).join('|'),
  () => {
    // New folders default to expanded; keep existing expand state
    const next = { ...expandedMap.value }
    if (next[ASSETS_ROOT_TREE_KEY] === undefined) next[ASSETS_ROOT_TREE_KEY] = true
    for (const f of project.folders) {
      if (next[f.id] === undefined) next[f.id] = true
    }
    // Drop stale ids
    for (const id of Object.keys(next)) {
      if (id === ASSETS_ROOT_TREE_KEY) continue
      if (!project.folders.some((f) => f.id === id)) delete next[id]
    }
    expandedMap.value = next
  },
  { immediate: true }
)

function isExpanded(id: string): boolean {
  return expandedMap.value[id] !== false
}

function folderIdFromTreeRow(rowId: string): string | null {
  return rowId === ASSETS_ROOT_TREE_KEY ? null : rowId
}

function isTreeRowActive(row: { id: string }): boolean {
  if (row.id === ASSETS_ROOT_TREE_KEY) return currentFolderId.value === null
  return currentFolderId.value === row.id
}

function isTreeRowDropOver(row: { id: string }): boolean {
  return dropTargetId.value === dropKey(folderIdFromTreeRow(row.id))
}

function isFolderIconOpen(row: { id: string; hasChildren: boolean }): boolean {
  if (row.hasChildren) return isExpanded(row.id)
  return isTreeRowActive(row)
}

function isTreeTwistVisible(row: { id: string; hasChildren: boolean }): boolean {
  return row.hasChildren || isTreeRowActive(row)
}

function isTreeTwistOpen(row: { id: string; hasChildren: boolean }): boolean {
  if (row.hasChildren) return isExpanded(row.id)
  return isTreeRowActive(row)
}

function closeMenu(): void {
  menu.value = null
}

async function showCtxMenu(next: CtxMenu): Promise<void> {
  const preferredX = next.x
  const preferredY = next.y
  menu.value = next
  await nextTick()
  const el = ctxMenuEl.value
  if (!el || !menu.value) return
  const placed = placeFixedMenu(el, preferredX, preferredY)
  if (placed.x !== menu.value.x || placed.y !== menu.value.y) {
    menu.value = { ...menu.value, ...placed }
  }
}

function selectFolder(id: string | null): void {
  currentFolderId.value = id
  const next = { ...expandedMap.value, [ASSETS_ROOT_TREE_KEY]: true }
  if (id) {
    const byId = new Map(normalizedFolders.value.map((f) => [f.id, f]))
    let cursor: string | null = id
    while (cursor) {
      next[cursor] = true
      cursor = byId.get(cursor)?.parentId ?? null
    }
  }
  expandedMap.value = next
  closeMenu()
}

async function revealAssetInBrowser(assetId: string): Promise<void> {
  const asset = project.assets.find((a) => a.id === assetId)
  if (!asset) return
  query.value = ''
  typeFilter.value = 'all'
  selectFolder(asset.folderId ?? null)
  // 只高亮卡片；全局 Inspector 已由 openEditor/selectAsset 决定，避免这里再抢一次
  setAssetSelection([asset.id], { syncWorkspace: false })
  await nextTick()
  const card = gridEl.value?.querySelector<HTMLElement>(
    `.card[data-asset-id="${CSS.escape(asset.id)}"]`
  )
  card?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
}

watch(
  () => workspace.assetBrowserReveal,
  (req) => {
    if (!req?.assetId) return
    void revealAssetInBrowser(req.assetId)
  }
)

/**
 * 资产库高亮跟随全局选中，避免图节点选中后库卡片仍高亮造成 Inspector 错觉。
 */
watch(
  () => editor.selection.current.value,
  (selection) => {
    if (selection.kind === 'asset' && selection.id) {
      if (selectedAssetIds.value.size === 1 && selectedAssetIds.value.has(selection.id)) return
      setAssetSelection([selection.id], { syncWorkspace: false })
      return
    }
    if (selection.kind === 'asset.multi') return
    if (selectedAssetIds.value.size === 0) return
    selectedAssetIds.value = new Set()
    anchorAssetId.value = null
  }
)

function toggleExpanded(id: string): void {
  const open = expandedMap.value[id] !== false
  expandedMap.value = {
    ...expandedMap.value,
    [id]: !open
  }
}

function onBlankContextMenu(e: MouseEvent): void {
  void showCtxMenu({ kind: 'blank', x: e.clientX, y: e.clientY })
}

function onTreeBlankContextMenu(e: MouseEvent): void {
  void showCtxMenu({ kind: 'tree-root', x: e.clientX, y: e.clientY })
}

/** 目录树空白处点击 → 回到 Assets 顶层 */
function onTreePaneClick(e: MouseEvent): void {
  const target = e.target as HTMLElement | null
  if (target?.closest('.tree-row')) return
  selectFolder(null)
}

function onFolderContextMenu(e: MouseEvent, folderId: string): void {
  void showCtxMenu({ kind: 'folder', x: e.clientX, y: e.clientY, targetId: folderId })
}

function onTreeRowContextMenu(e: MouseEvent, rowId: string): void {
  if (rowId === ASSETS_ROOT_TREE_KEY) {
    void showCtxMenu({ kind: 'tree-root', x: e.clientX, y: e.clientY })
    return
  }
  onFolderContextMenu(e, rowId)
}

function isAssetSelected(assetId: string): boolean {
  return selectedAssetIds.value.has(assetId)
}

function syncWorkspaceSelection(): void {
  const size = selectedAssetIds.value.size
  if (size === 1) {
    workspace.selectAsset([...selectedAssetIds.value][0])
  } else if (size > 1) {
    editor.selection.select({
      kind: 'asset.multi',
      key: `asset:multi:${size}`,
      meta: { count: size }
    })
  } else {
    workspace.clearAssetSelection()
  }
}

function setAssetSelection(ids: string[], options?: { syncWorkspace?: boolean }): void {
  selectedAssetIds.value = new Set(ids)
  anchorAssetId.value = ids[ids.length - 1] ?? null
  if (options?.syncWorkspace !== false) syncWorkspaceSelection()
}

function clearAssetSelectionLocal(): void {
  selectedAssetIds.value = new Set()
  anchorAssetId.value = null
  workspace.clearAssetSelection()
}

function markSkipAssetClickSync(): void {
  skipAssetClickSync = true
  if (skipAssetClickSyncTimer) clearTimeout(skipAssetClickSyncTimer)
  // 覆盖 dragend 后可能延迟触发的 click
  skipAssetClickSyncTimer = setTimeout(() => {
    skipAssetClickSync = false
    skipAssetClickSyncTimer = null
  }, 100)
}

function onAssetClick(assetId: string, e: MouseEvent): void {
  if (skipAssetClickSync) {
    skipAssetClickSync = false
    if (skipAssetClickSyncTimer) {
      clearTimeout(skipAssetClickSyncTimer)
      skipAssetClickSyncTimer = null
    }
    return
  }
  const list = visibleAssets.value.map((asset) => asset.id)
  if (e.shiftKey && anchorAssetId.value) {
    const start = list.indexOf(anchorAssetId.value)
    const end = list.indexOf(assetId)
    if (start >= 0 && end >= 0) {
      const [lo, hi] = start < end ? [start, end] : [end, start]
      const range = list.slice(lo, hi + 1)
      if (e.ctrlKey || e.metaKey) {
        const next = new Set(selectedAssetIds.value)
        for (const id of range) next.add(id)
        setAssetSelection([...next])
      } else {
        setAssetSelection(range)
      }
      return
    }
  }
  if (e.ctrlKey || e.metaKey) {
    const next = new Set(selectedAssetIds.value)
    if (next.has(assetId)) next.delete(assetId)
    else next.add(assetId)
    setAssetSelection([...next])
    return
  }
  setAssetSelection([assetId])
}

function clientRectsIntersect(a: DOMRect, b: DOMRect): boolean {
  return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top
}

function collectMarqueeAssetIds(box: DOMRect): string[] {
  const host = gridEl.value
  if (!host) return []
  const ids: string[] = []
  for (const card of host.querySelectorAll<HTMLElement>('.card[data-asset-id]')) {
    if (!clientRectsIntersect(box, card.getBoundingClientRect())) continue
    const id = card.dataset.assetId
    if (id) ids.push(id)
  }
  return ids
}

function onGridPointerDown(e: PointerEvent): void {
  if (e.button !== 0) return
  if ((e.target as HTMLElement).closest('.card')) return
  const host = gridEl.value
  if (!host) return

  const rect = host.getBoundingClientRect()
  const startX = e.clientX - rect.left + host.scrollLeft
  const startY = e.clientY - rect.top + host.scrollTop
  selectionBox.value = { x: startX, y: startY, w: 0, h: 0 }

  const onMove = (ev: PointerEvent): void => {
    const x = ev.clientX - rect.left + host.scrollLeft
    const y = ev.clientY - rect.top + host.scrollTop
    selectionBox.value = {
      x: Math.min(startX, x),
      y: Math.min(startY, y),
      w: Math.abs(x - startX),
      h: Math.abs(y - startY)
    }
  }

  const onUp = (ev: PointerEvent): void => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onUp)
    const box = selectionBox.value
    selectionBox.value = null
    if (!box || (box.w < 4 && box.h < 4)) {
      // 空白单击只清浏览器高亮，不改 Inspector
      setAssetSelection([], { syncWorkspace: false })
      return
    }
    const marqueeRect = new DOMRect(
      rect.left + box.x - host.scrollLeft,
      rect.top + box.y - host.scrollTop,
      box.w,
      box.h
    )
    const ids = collectMarqueeAssetIds(marqueeRect)
    if (!ids.length) {
      setAssetSelection([], { syncWorkspace: false })
      return
    }
    if (ev.ctrlKey || ev.metaKey) {
      const next = new Set(selectedAssetIds.value)
      for (const id of ids) next.add(id)
      setAssetSelection([...next])
    } else {
      setAssetSelection(ids)
    }
  }

  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onUp)
}

function onAssetContextMenu(e: MouseEvent, assetId: string): void {
  if (!selectedAssetIds.value.has(assetId)) {
    setAssetSelection([assetId])
  }
  void showCtxMenu({ kind: 'asset', x: e.clientX, y: e.clientY, targetId: assetId })
}

function openEditor(assetId: string): void {
  const asset = project.assets.find((a) => a.id === assetId)
  if (asset && workspace.canOpenEditorForAssetId(assetId)) openAssetEditor(asset)
  closeMenu()
}

const screenplayNotepad = reactive({
  open: false,
  assetId: '' as string,
  title: '',
  text: ''
})

async function openScreenplayNotepad(asset: AssetInfo): Promise<void> {
  if (!asset.relativePath?.trim()) {
    await promptAlert({
      title: t('graph.notepad.appMark'),
      message: t('asset.browser.screenplayMissingFile')
    })
    return
  }
  setAssetSelection([asset.id])
  const text = (await resolveAssetText(asset.id)) ?? ''
  screenplayNotepad.assetId = asset.id
  screenplayNotepad.title = asset.name?.trim() || assetTypeLabel(asset.type)
  screenplayNotepad.text = text
  screenplayNotepad.open = true
}

function closeScreenplayNotepad(): void {
  screenplayNotepad.open = false
  screenplayNotepad.assetId = ''
  screenplayNotepad.text = ''
  screenplayNotepad.title = ''
}

async function saveScreenplayNotepad(text: string): Promise<void> {
  const assetId = screenplayNotepad.assetId
  if (!assetId) return
  const asset = project.assets.find((a) => a.id === assetId)
  if (!asset || !isScreenplayAsset(asset.type) || !asset.relativePath?.trim()) return

  try {
    const updated = await window.studio.writeAssetText({ assetId, content: text })
    invalidateAssetUrlCache(updated.relativePath)
    await project.refreshAssets()
    screenplayNotepad.text = text
  } catch (e) {
    await promptAlert({
      title: t('graph.notepad.appMark'),
      message: e instanceof Error ? e.message : String(e)
    })
  }
}

async function onAssetDblClick(assetId: string): Promise<void> {
  const asset = project.assets.find((a) => a.id === assetId)
  if (!asset) return
  // 导入的引用剧本：记事本；新建剧本：打开编辑器（对齐图片）
  if (isScreenplayAsset(asset.type) && isImportedMediaRefAsset(asset)) {
    await openScreenplayNotepad(asset)
    return
  }
  if (isImportedMediaRefAsset(asset)) {
    await openImportedMediaRefPreview(asset)
    return
  }
  openEditor(assetId)
}

async function showContextAssetInFolder(): Promise<void> {
  const assetId = menu.value?.kind === 'asset' ? menu.value.targetId : null
  closeMenu()
  if (!assetId || isDraftAssetId(assetId)) return
  try {
    await window.studio.showAssetInFolder(assetId)
  } catch (e) {
    await promptAlert({
      title: t('asset.browser.context.showInFolder'),
      message: e instanceof Error ? e.message : String(e)
    })
  }
}

async function copyOriginalFiles(assetIds: string[]): Promise<void> {
  const ids = assetIds.filter((id) => id && !isDraftAssetId(id))
  if (!ids.length) return
  try {
    await window.studio.copyAssetOriginalFiles(ids)
  } catch (e) {
    await promptAlert({
      title: t('asset.browser.context.copyOriginal'),
      message: e instanceof Error ? e.message : String(e)
    })
  }
}

function copyContextMenuOriginalFiles(): void {
  const targetId = menu.value?.targetId
  closeMenu()
  if (!targetId) return
  const ids =
    selectedAssetIds.value.has(targetId) && selectedAssetIds.value.size > 1
      ? [...selectedAssetIds.value]
      : [targetId]
  void copyOriginalFiles(ids)
}

async function openNameDialog(dialog: NameDialog): Promise<void> {
  closeMenu()
  nameDialog.value = dialog
  await nextTick()
  nameInputEl.value?.focus()
  nameInputEl.value?.select()
}

function closeNameDialog(): void {
  nameDialog.value = null
}

function resolveCreateParentId(): string | null {
  if (menu.value?.kind === 'folder' && menu.value.targetId) return menu.value.targetId
  if (menu.value?.kind === 'tree-root') return null
  return currentFolderId.value
}

function startCreateFolder(): void {
  const parentId = resolveCreateParentId()
  void openNameDialog({
    mode: 'create-folder',
    title: t('asset.folder.new'),
    value: t('asset.folder.new'),
    parentId,
    error: ''
  })
}

function startRenameFolder(): void {
  const id = menu.value?.targetId
  if (!id) return
  const folder = project.folders.find((f) => f.id === id)
  void openNameDialog({
    mode: 'rename-folder',
    title: t('asset.folder.rename'),
    value: folder?.name ?? t('asset.browser.folder'),
    targetId: id,
    parentId: null,
    error: ''
  })
}

function startRenameAsset(): void {
  const id = menu.value?.targetId
  if (!id) return
  const asset = project.assets.find((a) => a.id === id)
  void openNameDialog({
    mode: 'rename-asset',
    title: t('asset.browser.context.rename'),
    value: asset?.name ?? t('asset.generic'),
    targetId: id,
    parentId: null,
    error: ''
  })
}

async function confirmNameDialog(): Promise<void> {
  const dialog = nameDialog.value
  if (!dialog) return
  if (dialog.mode === 'alert') {
    closeNameDialog()
    return
  }
  const name = dialog.value.trim()
  if (!name) {
    dialog.error = t('validation.nameRequired')
    return
  }

  try {
    if (dialog.mode === 'create-folder') {
      const folder = await window.studio.createFolder({ name, parentId: dialog.parentId })
      await project.refreshFolders()
      if (dialog.parentId) {
        expandedMap.value = { ...expandedMap.value, [dialog.parentId]: true }
      }
      selectFolder(folder.id)
    } else if (dialog.mode === 'rename-folder' && dialog.targetId) {
      await window.studio.renameFolder(dialog.targetId, name)
      await project.refreshFolders()
    } else if (dialog.mode === 'rename-asset' && dialog.targetId) {
      await window.studio.renameAsset(dialog.targetId, name)
      await project.refreshAssets()
    }
    closeNameDialog()
  } catch (e) {
    dialog.error = e instanceof Error ? e.message : String(e)
  }
}

async function createToolbarItemHere(item: ResolvedWorkspaceToolbarItem): Promise<void> {
  const folderId = resolveCreateParentId()
  closeMenu()
  if (item.id === 'canvas') {
    await createSeriesWithStarter(folderId)
  } else if (item.id === 'freeCanvas') {
    const entered = await promptText({
      title: t('asset.create.freeCanvasNameTitle'),
      message: t('asset.create.freeCanvasNameMessage'),
      defaultValue: t('asset.create.freeCanvas'),
      placeholder: t('asset.create.freeCanvasNamePlaceholder')
    })
    if (entered == null) return
    const name = entered.trim()
    if (!name) {
      await promptAlert({
        title: t('asset.create.freeCanvasNameTitle'),
        message: t('validation.nameRequired')
      })
      return
    }
    await createAsset('canvas', folderId, { name })
  } else {
    await createAsset(item.assetType, folderId)
  }
  if (folderId !== currentFolderId.value) selectFolder(folderId)
}

async function deleteFolderTarget(mode: 'hoist' | 'deleteContents' = 'hoist'): Promise<void> {
  const id = menu.value?.targetId
  if (!id) return
  const folder = normalizedFolders.value.find((item) => item.id === id)
  const parentId = folder?.parentId ?? null
  const subtreeIds = new Set(collectFolderSubtreeIds(project.folders, id))
  const assetsInFolder = project.assets.filter(
    (asset) => asset.folderId != null && subtreeIds.has(asset.folderId)
  )
  const assetIds = assetsInFolder.map((asset) => asset.id)
  closeMenu()

  if (mode === 'deleteContents') {
    const closed = workspace.closeEditorsForAssetIds(assetIds)
    if (!closed.ok) {
      await promptAlert({
        title: t('common.tip'),
        message: t('studio.tabMenu.waitNodeRun')
      })
      return
    }
    let message = assetsInFolder.some((asset) => asset.type === 'script')
      ? t('asset.folder.deleteWithContentsConfirmScripts', {
          name: folder?.name ?? id,
          count: assetIds.length
        })
      : t('asset.folder.deleteWithContentsConfirm', {
          name: folder?.name ?? id,
          count: assetIds.length
        })
    try {
      const { hits } = await window.studio.findAssetReferences(assetIds)
      if (hits.length) {
        message = `${formatReferenceMessage(hits, true)}\n\n${message}`
      }
    } catch (e) {
      await promptAlert({
        title: t('common.tip'),
        message: e instanceof Error ? e.message : String(e)
      })
      return
    }
    const ok = await promptConfirm({
      title: t('asset.folder.deleteWithContents'),
      message,
      confirmLabel: t('common.delete')
    })
    if (!ok) return
  } else {
    const closed = workspace.closeEditorsForAssetIds(assetIds)
    if (!closed.ok) {
      await promptAlert({
        title: t('common.tip'),
        message: t('studio.tabMenu.waitNodeRun')
      })
      return
    }
  }

  try {
    await window.studio.deleteFolder({ folderId: id, mode })
    if (currentFolderId.value && subtreeIds.has(currentFolderId.value)) {
      currentFolderId.value = parentId
    }
    await project.refreshLibrary()
    if (mode === 'deleteContents') {
      await project.refreshShots()
    }
  } catch (e) {
    void openNameDialog({
      mode: 'alert',
      title: t('asset.folder.deleteFailed'),
      value: '',
      parentId: null,
      error: e instanceof Error ? e.message : String(e)
    })
  }
}

async function onRefresh(): Promise<void> {
  if (refreshing.value || !project.isOpen) return
  refreshing.value = true
  try {
    await project.refreshLibrary()
  } catch (e) {
    await openNameDialog({
      mode: 'alert',
      title: t('asset.browser.refresh'),
      value: '',
      parentId: null,
      error: e instanceof Error ? e.message : String(e)
    })
  } finally {
    refreshing.value = false
  }
}

async function reportPackageError(title: string, error: unknown): Promise<void> {
  await openNameDialog({
    mode: 'alert',
    title,
    value: '',
    parentId: null,
    error: error instanceof Error ? error.message : String(error)
  })
}

async function onExportSelectedPackage(): Promise<void> {
  const ids =
    menu.value?.kind === 'asset' && menu.value.targetId
      ? selectedAssetIds.value.has(menu.value.targetId) && selectedAssetIds.value.size > 1
        ? [...selectedAssetIds.value]
        : [menu.value.targetId]
      : [...selectedAssetIds.value]
  closeMenu()
  if (!ids.length) return
  openExportPackageDialog(ids)
}

async function onExportFolderPackage(): Promise<void> {
  const id = menu.value?.targetId
  closeMenu()
  if (!id) return
  const rows = buildProjectPackageTree(project.folders, project.assets)
  const initial = [id, ...collectDescendantGuids(rows, id)]
  openExportPackageDialog(initial)
}

function onExportLibraryPackage(): void {
  closeMenu()
  const rows = buildProjectPackageTree(project.folders, project.assets)
  openExportPackageDialog(rows.map((r) => r.guid))
}

function contextMenuAssetIds(): string[] {
  if (menu.value?.kind !== 'asset' || !menu.value.targetId) return []
  const targetId = menu.value.targetId
  if (selectedAssetIds.value.has(targetId) && selectedAssetIds.value.size > 1) {
    return [...selectedAssetIds.value]
  }
  return [targetId]
}

async function onReimportSelectedAssets(): Promise<void> {
  const ids = contextMenuAssetIds()
  closeMenu()
  await reimportAssetIds(ids)
}

async function onReimportFolder(): Promise<void> {
  const folderId = menu.value?.kind === 'folder' ? menu.value.targetId : null
  closeMenu()
  if (!folderId) return
  const subtree = new Set(collectFolderSubtreeIds(project.folders, folderId))
  const ids = project.assets
    .filter((asset) => asset.folderId != null && subtree.has(asset.folderId))
    .map((asset) => asset.id)
  await reimportAssetIds(ids, { folderId })
}

async function reimportAssetIds(
  assetIds: string[],
  options?: { folderId?: string | null }
): Promise<void> {
  if (!project.isOpen) {
    await promptAlert({
      title: t('asset.browser.context.reimport'),
      message: t('asset.import.needProject')
    })
    return
  }
  // 目录重新导入允许无媒体资产：仍会修复子树 `.folder.json`
  if (!assetIds.length && options?.folderId == null) {
    await promptAlert({
      title: t('asset.browser.context.reimport'),
      message: t('asset.browser.reimportNone')
    })
    return
  }

  try {
    const result = await window.studio.reimportAssets({
      assetIds,
      folderId: options?.folderId
    })
    const reimported = result?.reimported ?? []
    const skipped = result?.skipped ?? []
    // 重新导入会补登记孤儿媒体，整库刷新以免漏掉新资产
    await project.refreshLibrary()
    for (const asset of reimported) {
      delete thumbUrls.value[asset.id]
      invalidateAssetUrlCache(asset.relativePath)
      invalidateAssetUrlCache(asset.thumbnailPath)
    }
    // 强制重新拉取缩略图
    for (const asset of reimported) {
      await loadAssetListThumb(asset)
    }

    if (!reimported.length && options?.folderId == null) {
      const detail = skipped.map((s) => `${s.name}：${s.reason}`).join('\n')
      await promptAlert({
        title: t('asset.browser.context.reimport'),
        message: `${t('asset.browser.reimportNone')}${detail ? `\n\n${detail}` : ''}`
      })
      return
    }

    if (skipped.length) {
      const detail = skipped.map((s) => `${s.name}：${s.reason}`).join('\n')
      await promptAlert({
        title: t('asset.browser.context.reimport'),
        message: `${t('asset.browser.reimportPartial', {
          ok: reimported.length,
          skip: skipped.length
        })}\n\n${detail}`
      })
    }
  } catch (e) {
    await promptAlert({
      title: t('asset.browser.context.reimport'),
      message: e instanceof Error ? e.message : String(e)
    })
  }
}

function onImportPackageMenu(): void {
  const folderId =
    menu.value?.kind === 'folder' && menu.value.targetId
      ? menu.value.targetId
      : currentFolderId.value
  closeMenu()
  void openImportPackageDialog(undefined, folderId)
}

function isAipackagePath(filePath: string): boolean {
  return filePath.replace(/\\/g, '/').toLowerCase().endsWith('.aipackage')
}

async function importAssetPackages(packPaths: string[], folderId: string | null): Promise<void> {
  if (!project.isOpen) {
    await showImportAlert(t('asset.import.needProject'))
    return
  }
  if (!packPaths.length) return
  await openImportPackageDialog(packPaths[0], folderId)
  if (packPaths.length > 1) {
    await promptAlert({
      title: t('asset.browser.importPackage'),
      message: t('asset.package.oneAtATime', { count: packPaths.length - 1 })
    })
  }
}

function fileBaseName(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || path
}

function getDroppedFilePaths(e: DragEvent): string[] {
  const list = e.dataTransfer?.files
  if (!list?.length) return []
  const paths: string[] = []
  for (let i = 0; i < list.length; i++) {
    const file = list[i]
    const path = window.studio.getPathForFile(file)
    if (path) paths.push(path)
  }
  return paths
}

function hasExternalFiles(e: DragEvent): boolean {
  if (hasAssetMove(e)) return false
  const types = e.dataTransfer ? Array.from(e.dataTransfer.types) : []
  return types.includes('Files')
}

function resetExternalImportUi(): void {
  externalImportHover.value = false
  externalDragDepth = 0
  dropTargetId.value = null
}

async function showImportAlert(message: string, asError = false): Promise<void> {
  await openNameDialog({
    mode: 'alert',
    title: t('asset.browser.import'),
    value: '',
    parentId: null,
    error: asError ? message : '',
    message: asError ? undefined : message
  })
}

async function importFilePaths(filePaths: string[], folderId: string | null): Promise<void> {
  if (!project.isOpen) {
    await showImportAlert(t('asset.import.needProject'))
    return
  }
  if (!filePaths.length) return

  try {
    const result = await window.studio.importAssets({ filePaths, folderId })
    project.patchAssets(result.imported)

    if (!result.imported.length && result.skipped.length) {
      const detail = result.skipped
        .map((s) => `${fileBaseName(s.path)}：${s.reason}`)
        .join('\n')
      await showImportAlert(`${t('asset.import.noneImported')}\n\n${detail}`)
      return
    }

    if (result.skipped.length) {
      const detail = result.skipped
        .map((s) => `${fileBaseName(s.path)}：${s.reason}`)
        .join('\n')
      await showImportAlert(
        `${t('asset.import.partial', { ok: result.imported.length, skip: result.skipped.length })}\n\n${detail}`
      )
    }
  } catch (e) {
    await showImportAlert(e instanceof Error ? e.message : String(e), true)
  }
}

function onBrowserDragEnter(e: DragEvent): void {
  if (!hasExternalFiles(e)) return
  externalDragDepth++
  externalImportHover.value = true
  if (!dropTargetId.value) dropTargetId.value = CURRENT_DROP
}

function onBrowserDragOver(e: DragEvent): void {
  if (!hasExternalFiles(e)) return
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  if (!dropTargetId.value) dropTargetId.value = CURRENT_DROP
}

function onBrowserDragLeave(e: DragEvent): void {
  if (!hasExternalFiles(e)) return
  const related = e.relatedTarget as Node | null
  if (related && (e.currentTarget as HTMLElement).contains(related)) return
  externalDragDepth--
  if (externalDragDepth <= 0) resetExternalImportUi()
}

function resolveImportFolderId(target: string | null): string | null {
  if (!target || target === CURRENT_DROP) return currentFolderId.value
  if (target === ROOT_DROP) return null
  return target
}

async function onBrowserDrop(e: DragEvent): Promise<void> {
  if (!hasExternalFiles(e)) return
  e.stopPropagation()
  const folderId = resolveImportFolderId(dropTargetId.value)
  resetExternalImportUi()
  await importDroppedFiles(e, folderId)
}

async function importDroppedFiles(e: DragEvent, folderId: string | null): Promise<void> {
  const paths = getDroppedFilePaths(e)
  if (!paths.length) {
    await showImportAlert(t('asset.import.dropPathFailed'))
    return
  }
  const packages = paths.filter(isAipackagePath)
  const media = paths.filter((p) => !isAipackagePath(p))
  if (packages.length) {
    await importAssetPackages(packages, folderId)
  }
  if (media.length) {
    await importFilePaths(media, folderId)
  }
}

function onDragStart(e: DragEvent, asset: AssetInfo): void {
  markSkipAssetClickSync()
  let ids =
    selectedAssetIds.value.has(asset.id) && selectedAssetIds.value.size > 1
      ? [...selectedAssetIds.value]
      : [asset.id]
  if (!selectedAssetIds.value.has(asset.id)) {
    // 拖动发起的选中只做本地高亮，不切换 Inspector
    setAssetSelection([asset.id], { syncWorkspace: false })
    ids = [asset.id]
  }
  draggingAssetIds.value = ids
  workspace.setDraggingAsset(asset)
  e.dataTransfer?.setData(STUDIO_ASSET_DRAG_MIME, JSON.stringify(asset))
  e.dataTransfer?.setData(ASSET_MOVE_MIME, asset.id)
  e.dataTransfer?.setData(STUDIO_ASSET_IDS_DRAG_MIME, JSON.stringify(ids))
  e.dataTransfer?.setData('text/plain', asset.id)
  e.dataTransfer!.effectAllowed = 'copyMove'
}

function onDragEnd(): void {
  draggingAssetIds.value = []
  dropTargetId.value = null
  markSkipAssetClickSync()
  // drop 可能晚于 dragend；多留一帧，避免画布侧误判成系统文件拖入
  window.setTimeout(() => {
    workspace.setDraggingAsset(null)
  }, 50)
}

function dropKey(folderId: string | null): string {
  return folderId ?? ROOT_DROP
}

function hasAssetMove(e: DragEvent): boolean {
  if (draggingAssetIds.value.length > 0) return true
  const types = e.dataTransfer ? Array.from(e.dataTransfer.types) : []
  return (
    types.includes(ASSET_MOVE_MIME) ||
    types.includes(STUDIO_ASSET_IDS_DRAG_MIME) ||
    types.includes(STUDIO_ASSET_DRAG_MIME)
  )
}

function resolveDroppedAssetIds(e: DragEvent): string[] {
  const raw = e.dataTransfer?.getData(STUDIO_ASSET_IDS_DRAG_MIME)
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as string[]
      if (Array.isArray(parsed) && parsed.length) return parsed
    } catch {
      /* ignore */
    }
  }
  const single = e.dataTransfer?.getData(ASSET_MOVE_MIME) || draggingAssetIds.value[0]
  return single ? [single] : []
}

function onFolderDragOver(e: DragEvent, folderId: string | null): void {
  if (hasExternalFiles(e)) {
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    dropTargetId.value = dropKey(folderId)
    externalImportHover.value = true
    return
  }
  if (!hasAssetMove(e)) return
  e.dataTransfer!.dropEffect = 'move'
  dropTargetId.value = dropKey(folderId)
}

function onFolderDragLeave(folderId: string | null): void {
  if (dropTargetId.value === dropKey(folderId)) dropTargetId.value = null
}

function onCurrentFolderDragOver(e: DragEvent): void {
  if (hasExternalFiles(e)) {
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    dropTargetId.value = CURRENT_DROP
    externalImportHover.value = true
    return
  }
  if (!hasAssetMove(e)) return
  e.dataTransfer!.dropEffect = 'move'
  dropTargetId.value = CURRENT_DROP
}

function onCurrentFolderDragLeave(): void {
  if (dropTargetId.value === CURRENT_DROP) dropTargetId.value = null
}

async function moveAssetToFolder(assetId: string, folderId: string | null): Promise<void> {
  const asset = project.assets.find((a) => a.id === assetId)
  if (!asset) return
  if ((asset.folderId ?? null) === folderId) return
  try {
    const updated = await window.studio.updateAsset(toPlain({ ...asset, folderId }))
    const idx = project.assets.findIndex((a) => a.id === updated.id)
    if (idx >= 0) project.assets.splice(idx, 1, updated)
    else await project.refreshAssets()
  } catch (e) {
    await openNameDialog({
      mode: 'alert',
      title: t('asset.browser.title'),
      value: '',
      parentId: null,
      error: e instanceof Error ? e.message : String(e)
    })
    await project.refreshLibrary()
  }
}

async function onDropToFolder(e: DragEvent, folderId: string | null): Promise<void> {
  if (hasExternalFiles(e)) {
    e.stopPropagation()
    resetExternalImportUi()
    await importDroppedFiles(e, folderId)
    return
  }

  e.stopPropagation()
  dropTargetId.value = null
  const assetIds = resolveDroppedAssetIds(e)
  draggingAssetIds.value = []
  if (!assetIds.length) return
  for (const assetId of assetIds) {
    await moveAssetToFolder(assetId, folderId)
  }
}

async function deleteAssets(ids: string[]): Promise<void> {
  const unique = [...new Set(ids)]
  if (!unique.length) return
  closeMenu()
  const closed = workspace.closeEditorsForAssetIds(unique)
  if (!closed.ok) {
    await promptAlert({
      title: t('common.tip'),
      message: t('studio.tabMenu.waitNodeRun')
    })
    return
  }
  let message =
    unique.length === 1
      ? t('asset.browser.deleteConfirm', {
          name: project.assets.find((a) => a.id === unique[0])?.name ?? unique[0]
        })
      : t('asset.browser.deleteConfirmMany', { count: unique.length })
  try {
    const { hits } = await window.studio.findAssetReferences(unique)
    if (hits.length) {
      message = formatReferenceMessage(hits, true)
    }
  } catch (e) {
    await promptAlert({
      title: t('common.tip'),
      message: e instanceof Error ? e.message : String(e)
    })
    return
  }
  const ok = await promptConfirm({
    title: t('asset.browser.deleteConfirmTitle'),
    message,
    confirmLabel: t('common.delete')
  })
  if (!ok) return
  for (const id of unique) {
    const asset = project.assets.find((a) => a.id === id)
    if (asset?.relativePath) {
      invalidateAssetUrlCache(asset.relativePath)
      invalidateAssetUrlCache(thumbRelativePathFor(asset.relativePath))
      if (asset.thumbnailPath) invalidateAssetUrlCache(asset.thumbnailPath)
    }
    await window.studio.deleteAsset(id)
    delete thumbUrls.value[id]
  }
  clearAssetSelectionLocal()
  await project.refreshAssets()
}

function formatReferenceSite(site: AssetReferenceSite): string {
  if (site.kind === 'asset') {
    return t('asset.browser.referencesAsset', { name: site.assetName })
  }
  return t('asset.browser.referencesShot', { title: site.shotTitle })
}

function formatReferenceMessage(hits: AssetReferenceHit[], forDelete: boolean): string {
  const sites = summarizeReferenceSites(hits)
  const maxLines = 8
  const lines = sites.slice(0, maxLines).map((site) => `• ${formatReferenceSite(site)}`)
  if (sites.length > maxLines) {
    lines.push(t('asset.browser.referencesMore', { count: sites.length - maxLines }))
  }
  const head = t('asset.browser.referencesSummary', { count: sites.length })
  const body = [head, ...lines].join('\n')
  if (!forDelete) return body
  return `${body}\n\n${t('asset.browser.deleteReferencedConfirm')}`
}

async function findContextMenuReferences(): Promise<void> {
  const targetId = menu.value?.targetId
  if (!targetId) return
  const ids =
    selectedAssetIds.value.has(targetId) && selectedAssetIds.value.size > 1
      ? [...selectedAssetIds.value]
      : [targetId]
  closeMenu()
  try {
    const { hits } = await window.studio.findAssetReferences(ids)
    if (!hits.length) {
      await promptAlert({
        title: t('asset.browser.referencesTitle'),
        message: t('asset.browser.referencesNone')
      })
      return
    }
    await promptAlert({
      title: t('asset.browser.referencesTitle'),
      message: formatReferenceMessage(hits, false)
    })
  } catch (e) {
    await promptAlert({
      title: t('asset.browser.referencesTitle'),
      message: e instanceof Error ? e.message : String(e)
    })
  }
}

function deleteContextMenuAssets(): void {
  const targetId = menu.value?.targetId
  if (!targetId) return
  const ids =
    selectedAssetIds.value.has(targetId) && selectedAssetIds.value.size > 1
      ? [...selectedAssetIds.value]
      : [targetId]
  void deleteAssets(ids)
}

const rootEl = ref<HTMLElement | null>(null)
const pointerInside = ref(false)

function onKeyDown(e: KeyboardEvent): void {
  if (nameDialog.value) return
  if (!pointerInside.value) return
  const tag = (e.target as HTMLElement)?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (selectedAssetIds.value.size === 0) return
    e.preventDefault()
    void deleteAssets([...selectedAssetIds.value])
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
    const ids = visibleAssets.value.map((asset) => asset.id)
    if (!ids.length) return
    e.preventDefault()
    setAssetSelection(ids)
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
    if (selectedAssetIds.value.size === 0) return
    e.preventDefault()
    void copyOriginalFiles([...selectedAssetIds.value])
  }
}

function onGlobalPointerDown(e: MouseEvent): void {
  if (nameDialog.value) return
  const target = e.target as HTMLElement | null
  if (target?.closest('.ctx-menu')) return
  closeMenu()
}

onMounted(() => {
  const maxEmbeddedTree = 120
  treePaneWidth.value = clampTreeWidth(
    props.embedded ? Math.min(treePaneWidth.value, maxEmbeddedTree) : treePaneWidth.value,
    readTreeMaxWidth()
  )
  window.addEventListener('mousedown', onGlobalPointerDown)
  window.addEventListener('keydown', onKeyDown)
  if (project.isOpen) void project.refreshFolders()
})

onBeforeUnmount(() => {
  window.removeEventListener('mousedown', onGlobalPointerDown)
  window.removeEventListener('keydown', onKeyDown)
  isSplitterDragging.value = false
  if (skipAssetClickSyncTimer) {
    clearTimeout(skipAssetClickSyncTimer)
    skipAssetClickSyncTimer = null
  }
})
</script>

<style scoped>
.asset-browser {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--bg);
}

.asset-browser.embedded {
  background: transparent;
}

.asset-browser.embedded .filters {
  padding: 4px 8px;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.title {
  font-weight: 600;
}

.import-hint {
  flex: 1;
  font-size: 11px;
  color: var(--text-muted);
}

.toolbar-actions {
  display: flex;
  gap: 6px;
  margin-left: auto;
}

.toolbar-actions button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 26px;
  padding: 0;
  line-height: 0;
}

.filters {
  display: flex;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.filters input {
  flex: 1;
  min-width: 0;
  width: auto;
}

.filters select {
  width: auto;
  flex-shrink: 0;
  min-width: 88px;
}

.split {
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: row;
}

.tree-pane {
  flex-shrink: 0;
  overflow: auto;
  background: var(--bg-panel);
  padding: 2px 0;
  min-width: 0;
  border-right: 1px solid var(--border);
  font-family: inherit;
}

.splitter {
  flex-shrink: 0;
  width: 5px;
  margin: 0 -2px;
  cursor: col-resize;
  background: var(--border);
  position: relative;
  z-index: 1;
  touch-action: none;
}

.splitter:hover,
.splitter.dragging {
  background: var(--accent);
}

.content-pane {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-panel);
}

.crumbs {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 8px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  min-height: 22px;
  background: var(--bg-panel);
}

.crumb-trail {
  display: flex;
  align-items: center;
  gap: 0;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
}

.crumb {
  border: none;
  background: transparent;
  color: var(--text-muted);
  padding: 1px 2px;
  border-radius: 0;
  white-space: nowrap;
  font-size: 12px;
  line-height: 18px;
  cursor: pointer;
}

.crumb:hover {
  color: var(--text);
  text-decoration: underline;
}

.sep {
  color: var(--text-muted);
  opacity: 0.7;
  padding: 0 4px;
  font-size: 11px;
  user-select: none;
}

.bottom-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
  padding: 2px 8px;
  border-top: 1px solid var(--border);
  background: var(--bg);
  min-height: 22px;
}

.bottom-bar.compact {
  justify-content: flex-end;
  gap: 8px;
  padding: 2px 6px;
}

.status-bar {
  flex: 1;
  min-width: 0;
  color: var(--text-muted);
  font-size: 11px;
  line-height: 16px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.view-size {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  color: var(--text-muted);
  font-size: 11px;
  user-select: none;
}

.view-size-label {
  width: 28px;
  text-align: right;
}

.view-size input[type='range'] {
  width: 120px;
  height: 14px;
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
  accent-color: var(--text-muted);
  cursor: pointer;
  -webkit-appearance: none;
  appearance: none;
}

.view-size input[type='range']::-webkit-slider-runnable-track {
  height: 3px;
  background: var(--border);
  border-radius: 1px;
}

.view-size input[type='range']::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 10px;
  height: 10px;
  margin-top: -3.5px;
  border: 1px solid var(--slider-thumb-border);
  border-radius: 50%;
  background: var(--slider-thumb-bg);
  box-shadow: none;
}

.view-size input[type='range']::-moz-range-track {
  height: 3px;
  background: var(--border);
  border: none;
  border-radius: 1px;
}

.view-size input[type='range']::-moz-range-thumb {
  width: 10px;
  height: 10px;
  border: 1px solid var(--slider-thumb-border);
  border-radius: 50%;
  background: var(--slider-thumb-bg);
  box-shadow: none;
}

.grid {
  position: relative;
  flex: 1;
  overflow: auto;
  padding: 8px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: 8px;
  align-content: start;
}

.grid.selecting {
  cursor: crosshair;
}

.selection-marquee {
  position: absolute;
  z-index: 5;
  pointer-events: none;
  border: 1px solid var(--accent-90);
  background: var(--accent-12);
  box-shadow: 0 0 0 1px var(--accent-45) inset;
}

.grid.list {
  display: flex;
  flex-direction: column;
  gap: 0;
  padding: 0;
  background: var(--bg-panel);
}

.grid.list .card {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 6px;
  min-height: 20px;
  border-radius: 0;
  background: transparent;
  border: none;
  cursor: default;
}

.grid.list .card.folder {
  cursor: pointer;
}

.grid.list .card:hover {
  background: var(--bg-elevated);
}

.grid.list .card.selected {
  background: var(--accent-22);
  border: none;
  box-shadow: none;
}

.grid.list .card.selected .name {
  color: var(--text);
  font-weight: 400;
}

.grid.list .list-row-icon {
  display: inline-flex;
  flex-shrink: 0;
  margin-left: 2px;
}

.folder-thumb {
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
}

.folder-thumb :deep(.folder-tree-icon-img) {
  width: 28px;
  height: 28px;
}

.grid.drop-over {
  outline: 1px dashed var(--accent);
  outline-offset: -4px;
  background: var(--accent-06);
}

.tree-row {
  display: flex;
  align-items: center;
  gap: 2px;
  width: 100%;
  border: none;
  background: transparent;
  color: var(--text-muted);
  padding: 1px 6px 1px 4px;
  border-radius: 0;
  text-align: left;
  font-size: 12px;
  line-height: 18px;
  min-height: 20px;
  cursor: default;
  box-sizing: border-box;
  user-select: none;
}

.tree-row:hover {
  background: var(--bg-elevated);
}

.tree-row.active {
  background: var(--accent-22);
  color: var(--text);
}

.tree-row.active .tree-label {
  color: var(--text);
}

.tree-row.drop-over {
  background: var(--accent-28);
  outline: 1px solid var(--accent);
}

.twist {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.twist::before {
  content: '';
  display: block;
  width: 0;
  height: 0;
  border-top: 4px solid transparent;
  border-bottom: 4px solid transparent;
  border-left: 5px solid #8a8a8a;
  transform-origin: 25% 50%;
  transition: transform 0.1s ease;
}

.twist.open::before {
  transform: rotate(90deg);
}

.twist.hidden {
  visibility: hidden;
  pointer-events: none;
}

.tree-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  margin-left: 4px;
  padding-right: 4px;
}

.card {
  position: relative;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px;
  cursor: grab;
  min-width: 0;
}

.card.folder {
  cursor: pointer;
}

.card.drop-over {
  border-color: var(--accent);
  background: var(--accent-18);
}

.card.selected {
  border-color: var(--accent);
  background: var(--accent-18);
  box-shadow: 0 0 0 1px var(--accent-45);
}

.list-icon {
  flex-shrink: 0;
  width: 16px;
  text-align: center;
  font-size: 13px;
  line-height: 1;
  opacity: 0.9;
}

.list-icon.list-thumb {
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: 4px;
  background: var(--graph-preview-bg);
}

.list-icon.list-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

/* 导入引用媒体：不可编辑 — 弱化琥珀提示 */
.card.is-media-ref .list-icon:not(.list-thumb) {
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  background: var(--media-ref-wash);
  color: var(--media-ref);
  font-size: 12px;
  opacity: 1;
  box-shadow: inset 0 0 0 1px var(--media-ref-ring-soft);
}

.card.is-media-ref .name {
  color: var(--media-ref-name);
}

.card.is-media-ref .badge {
  color: var(--media-ref);
  font-weight: 500;
}

.card.is-media-ref .thumb {
  position: relative;
  box-shadow: inset 0 0 0 1px var(--media-ref-ring);
}

.ref-mark {
  position: absolute;
  left: 0;
  top: 0;
  z-index: 1;
  padding: 1px 4px;
  border-radius: 0 0 4px 0;
  background: var(--media-ref-mark-bg);
  color: var(--media-ref);
  font-size: 9px;
  font-weight: 600;
  line-height: 1.35;
  letter-spacing: 0.02em;
  pointer-events: none;
  box-shadow: inset 0 0 0 1px var(--media-ref-ring-soft);
}

.thumb {
  position: relative;
  aspect-ratio: 1;
  background: var(--graph-preview-bg);
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  margin-bottom: 4px;
}

.thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.badge {
  color: var(--text-muted);
  font-size: 11px;
  text-align: center;
  padding: 0 4px;
}

.name {
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: center;
}

.grid.list .card.drop-over {
  background: var(--accent-18);
  outline: 1px solid var(--accent);
}

.grid.list .name {
  flex: 1;
  text-align: left;
  font-size: 12px;
}

.del {
  position: absolute;
  top: 4px;
  right: 4px;
  padding: 0 5px;
  line-height: 1.2;
  opacity: 0;
  font-size: 14px;
}

.grid.list .del {
  position: static;
  flex-shrink: 0;
  margin-left: auto;
}

.card:hover .del {
  opacity: 1;
}

.empty {
  grid-column: 1 / -1;
  text-align: center;
  color: var(--text-muted);
  padding: 24px 8px;
}

.grid.list .empty {
  grid-column: auto;
}

.ctx-menu {
  position: fixed;
  z-index: 4000;
  min-width: 148px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ctx-menu button {
  text-align: left;
  border: none;
  background: transparent;
  color: var(--text);
  padding: 6px 10px;
  border-radius: 4px;
}

.ctx-menu button:hover {
  background: var(--bg-hover);
  border-color: transparent;
}

.ctx-menu button.danger {
  color: var(--danger);
}

.ctx-sep {
  height: 1px;
  background: var(--border);
  margin: 4px 0;
}

.import-overlay {
  position: absolute;
  inset: 0;
  z-index: 20;
  pointer-events: none;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--accent-12);
  border: 2px dashed var(--accent);
  border-radius: 4px;
}

.import-panel {
  text-align: center;
  padding: 20px 28px;
  background: var(--panel-glass);
  border: 1px solid var(--accent);
  border-radius: 10px;
  box-shadow: 0 8px 32px var(--shadow);
}

.import-icon {
  font-size: 28px;
  line-height: 1;
  margin-bottom: 8px;
}

.import-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
}

.import-target {
  margin-top: 6px;
  font-size: 12px;
  color: var(--accent);
}

.import-types {
  margin-top: 8px;
  font-size: 11px;
  color: var(--text-muted);
}

.err {
  color: var(--danger);
  font-size: 12px;
  white-space: pre-wrap;
}

.msg {
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.45;
  white-space: pre-wrap;
  margin: 0;
}
</style>
