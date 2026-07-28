import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { isDraftAssetId, isDraftShotId, shotScriptAssetId, type AssetFolder, type AssetInfo, type ProjectConfig, type Shot } from '@shared/domain'
import { normalizeFolders } from '@shared/folderTree'
import { toPlain } from '../utils/toPlain'
import { useDraftStore } from './drafts'
import { useEditorKernel } from '../editor/kernel'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'
import { graphRunHosts } from '../features/graph/model/graphRunHosts'
import { useWorkspaceStore } from './workspace'
import { useGraphTaskStore } from './graphTasks'
import { useGraphRunLogsStore } from './graphRunLogs'
import { clearAssetUrlCaches } from '../features/media/assetUrlCache'

export const useProjectStore = defineStore('project', () => {
  const editor = useEditorKernel()
  const rootPath = ref<string | null>(null)
  const config = ref<ProjectConfig | null>(null)
  const assets = ref<AssetInfo[]>([])
  const folders = ref<AssetFolder[]>([])
  const shots = ref<Shot[]>([])
  const activeShotId = ref<string | null>(null)
  const dirty = ref(false)
  const genProgress = ref<{ taskId: string; progress: number; status: string } | null>(null)
  /** 每次切换/关闭工程递增；用于丢弃旧编辑器异步写回 */
  const sessionEpoch = ref(0)

  const isOpen = computed(() => !!rootPath.value && !!config.value)
  const activeShot = computed(() => shots.value.find((s) => s.id === activeShotId.value) ?? null)

  function beginProjectSwitch(): void {
    // 先关面板（尽量在旧 rootPath 下完成卸载落盘），再递增会话并清空
    useWorkspaceStore().prepareProjectSwitch()
    sessionEpoch.value += 1
    useDraftStore().clearAll()
    useGraphTaskStore().clearForProjectSwitch()
    useGraphRunLogsStore().clearForProjectSwitch()
    graphEditorHosts.reset()
    graphRunHosts.reset()
    editor.reset()
    clearAssetUrlCaches()
  }

  function loadFromResult(result: {
    rootPath: string
    config: ProjectConfig
    assets: AssetInfo[]
    folders?: AssetFolder[]
    shots: Shot[]
  }): void {
    beginProjectSwitch()
    rootPath.value = result.rootPath
    config.value = result.config
    assets.value = result.assets
    folders.value = normalizeFolders(result.folders ?? [])
    shots.value = result.shots
    // 仅记住默认分镜，不自动切到镜头 Inspector（无编辑窗口时保持空态）
    activeShotId.value = result.shots[0]?.id ?? null
    dirty.value = false
    genProgress.value = null
  }

  function reset(): void {
    beginProjectSwitch()
    rootPath.value = null
    config.value = null
    assets.value = []
    folders.value = []
    shots.value = []
    activeShotId.value = null
    dirty.value = false
    genProgress.value = null
  }

  async function refreshAssets(): Promise<void> {
    assets.value = await window.studio.listAssets()
  }

  function patchAssets(nextAssets: AssetInfo[]): void {
    const byId = new Map(assets.value.map((asset) => [asset.id, asset]))
    for (const asset of nextAssets) byId.set(asset.id, asset)
    assets.value = [...byId.values()]
  }

  function removeAssetLocal(assetId: string): void {
    assets.value = assets.value.filter((asset) => asset.id !== assetId)
  }

  async function refreshFolders(): Promise<void> {
    folders.value = normalizeFolders(await window.studio.listFolders())
  }

  async function refreshLibrary(): Promise<void> {
    // 先目录后资产：避免并行 scan 时给同一孤儿目录写出不同 folder id
    await refreshFolders()
    await refreshAssets()
  }

  /** 合并短时间内的多次刷新（批量生图等） */
  let libraryRefreshTimer: ReturnType<typeof setTimeout> | null = null
  let libraryRefreshWaiters: Array<{ resolve: () => void; reject: (err: unknown) => void }> = []

  function scheduleRefreshLibrary(delayMs = 120): Promise<void> {
    return new Promise((resolve, reject) => {
      libraryRefreshWaiters.push({ resolve, reject })
      if (libraryRefreshTimer) clearTimeout(libraryRefreshTimer)
      libraryRefreshTimer = setTimeout(() => {
        libraryRefreshTimer = null
        const waiters = libraryRefreshWaiters
        libraryRefreshWaiters = []
        void refreshLibrary()
          .then(() => {
            for (const w of waiters) w.resolve()
          })
          .catch((err) => {
            for (const w of waiters) w.reject(err)
          })
      }, delayMs)
    })
  }

  async function refreshShots(): Promise<void> {
    shots.value = await window.studio.listShots()
  }

  /** 将崩溃前的影子文档恢复到内存；用户后续保存时再提升为正式文件。 */
  async function recoverAutosaves(): Promise<number> {
    // 当前自动保存语义为按间隔正式保存；清理旧版本遗留的影子文件，
    // 避免未保存内容在重新打开工程时被静默恢复。
    await window.studio.discardAutosave()
    return 0
  }

  async function selectShot(id: string): Promise<void> {
    activeShotId.value = id
    syncShotSelection(id)
  }

  function syncShotSelection(shotId: string | null): void {
    editor.selection.select({
      kind: 'shot',
      key: shotId ? `shot:${shotId}` : 'shot:none',
      id: shotId ?? undefined
    })
    editor.commands.setActiveScope(
      shotId
        ? `document:shot:${shotId}`
        : `selection:shot:${shotId ?? 'none'}`
    )
  }

  function replaceInShots(next: Shot): void {
    const idx = shots.value.findIndex((s) => s.id === next.id)
    if (idx >= 0) {
      shots.value = [...shots.value.slice(0, idx), next, ...shots.value.slice(idx + 1)]
      return
    }
    const ownerId = shotScriptAssetId(next)
    // 仅允许追加草稿；正式分镜若未在列表中则忽略（切换工程后旧编辑器卸载写回）
    if (isDraftShotId(next.id) || (ownerId && isDraftAssetId(ownerId))) {
      shots.value = [...shots.value, next]
    }
  }

  /** 仅更新内存（draft store + project.shots），切换分镜前必须同步调用 */
  function persistShotLocal(shot: Shot): void {
    const ownerId = shotScriptAssetId(shot)
    if (ownerId && isDraftAssetId(ownerId)) {
      useDraftStore().persistDraftShot(ownerId, shot)
      replaceInShots(shot)
      return
    }
    if (isDraftShotId(shot.id)) {
      if (ownerId && isDraftAssetId(ownerId)) {
        useDraftStore().persistDraftShot(ownerId, shot)
      }
      replaceInShots(shot)
      return
    }
    replaceInShots(shot)
  }

  async function persistShot(shot: Shot): Promise<void> {
    if (!shots.value.some((s) => s.id === shot.id) && !isDraftShotId(shot.id)) {
      const ownerId = shotScriptAssetId(shot)
      if (!(ownerId && isDraftAssetId(ownerId))) return
    }
    persistShotLocal(shot)
    const ownerId = shotScriptAssetId(shot)
    if (ownerId && isDraftAssetId(ownerId)) return
    if (isDraftShotId(shot.id)) return
    const updated = await window.studio.updateShot(toPlain(shot))
    replaceInShots(updated)
  }

  async function persistShotCommand(shot: Shot, label = 'Update shot'): Promise<void> {
    const before = shots.value.find((item) => item.id === shot.id)
    if (!before) {
      await persistShot(shot)
      return
    }
    const previous = toPlain(before)
    const next = toPlain(shot)
    const scope = `document:shot:${shot.id}`
    editor.commands.setActiveScope(scope)
    await editor.commands.execute({
      id: `shot.update.${shot.id}.${crypto.randomUUID()}`,
      label,
      scope,
      mergeKey: `shot.update.${shot.id}`,
      execute: () => persistShot(next),
      undo: () => persistShot(previous)
    })
  }

  async function persistAssetCommand(asset: AssetInfo, label = 'Update asset'): Promise<void> {
    const before = assets.value.find((item) => item.id === asset.id)
    if (!before) return
    const apply = async (value: AssetInfo): Promise<void> => {
      const updated = await window.studio.updateAsset(toPlain(value))
      const index = assets.value.findIndex((item) => item.id === updated.id)
      if (index >= 0) {
        assets.value = [
          ...assets.value.slice(0, index),
          updated,
          ...assets.value.slice(index + 1)
        ]
      }
    }
    const scope = `document:asset:${asset.id}`
    editor.commands.setActiveScope(scope)
    await editor.commands.execute({
      id: `asset.update.${asset.id}.${crypto.randomUUID()}`,
      label,
      scope,
      mergeKey: `asset.update.${asset.id}`,
      execute: () => apply(asset),
      undo: () => apply(before)
    })
  }

  async function updateConfig(
    partial: Partial<
      Pick<ProjectConfig, 'stylePreset' | 'styleImages' | 'name' | 'cacheOutputDir'>
    >
  ): Promise<void> {
    if (!config.value) return
    const next: ProjectConfig = {
      ...config.value,
      ...partial,
      updatedAt: new Date().toISOString()
    }
    config.value = next
    await window.studio.saveProject(toPlain(next))
  }

  return {
    rootPath,
    config,
    assets,
    folders,
    shots,
    activeShotId,
    dirty,
    genProgress,
    sessionEpoch,
    isOpen,
    activeShot,
    loadFromResult,
    reset,
    refreshAssets,
    patchAssets,
    removeAssetLocal,
    refreshFolders,
    refreshLibrary,
    scheduleRefreshLibrary,
    refreshShots,
    recoverAutosaves,
    selectShot,
    persistShot,
    persistShotLocal,
    persistShotCommand,
    persistAssetCommand,
    updateConfig
  }
})
