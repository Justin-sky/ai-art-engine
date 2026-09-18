import { ref } from 'vue'
import { cacheAssetStem, isLibraryRelativePath, normalizeOutputPathKey } from '@shared/outputScan'
import { useProjectStore } from '../stores/project'
import { useStudioI18n } from './useStudioI18n'

export function useSaveCacheAsset() {
  const { t } = useStudioI18n()
  const project = useProjectStore()
  const dialogOpen = ref(false)
  const defaultName = ref('')
  const defaultFolderId = ref<string | null>(null)
  const dialogRef = ref<{
    setSaving: (v: boolean) => void
    setError: (m: string) => void
    setSourceMissing: (relativePath: string | null) => void
  } | null>(null)
  const savingPath = ref('')
  const savedPaths = ref(new Set<string>())
  let pendingPath = ''

  function pathKey(relativePath: string | null | undefined): string {
    return normalizeOutputPathKey(relativePath ?? '')
  }

  function canSave(relativePath: string | null | undefined): boolean {
    const key = pathKey(relativePath)
    return !!key && !isLibraryRelativePath(key)
  }

  function isSaved(relativePath: string | null | undefined): boolean {
    return savedPaths.value.has(pathKey(relativePath))
  }

  function isSaving(relativePath: string | null | undefined): boolean {
    return !!savingPath.value && savingPath.value === pathKey(relativePath)
  }

  function openSave(relativePath: string): void {
    const key = pathKey(relativePath)
    if (!canSave(key) || isSaved(key) || savingPath.value) return
    pendingPath = key
    defaultName.value = cacheAssetStem(key)
    defaultFolderId.value = null
    dialogOpen.value = true
    void window.studio
      .projectFileExists(key)
      .then((exists) => {
        if (pendingPath !== key) return
        dialogRef.value?.setSourceMissing(exists ? null : key)
      })
      .catch(() => {
        if (pendingPath !== key) return
        dialogRef.value?.setSourceMissing(null)
      })
  }

  function closeDialog(): void {
    if (savingPath.value) return
    dialogOpen.value = false
  }

  async function confirmSave(payload: { name: string; folderId: string | null }): Promise<void> {
    const path = pendingPath
    if (!path || savingPath.value) return
    savingPath.value = path
    dialogRef.value?.setSaving(true)
    try {
      const exists = await window.studio.projectFileExists(path)
      if (!exists) {
        dialogRef.value?.setError(
          t('dialog.saveAsset.sourceMissing', { name: path.split('/').pop() || path })
        )
        dialogRef.value?.setSourceMissing(path)
        return
      }
      await window.studio.saveProjectAsset({
        relativePath: path,
        name: payload.name,
        folderId: payload.folderId
      })
      savedPaths.value = new Set([...savedPaths.value, path])
      dialogOpen.value = false
      await project.scheduleRefreshLibrary()
    } catch (error) {
      dialogRef.value?.setError(error instanceof Error ? error.message : String(error))
    } finally {
      savingPath.value = ''
      dialogRef.value?.setSaving(false)
    }
  }

  return {
    dialogOpen,
    defaultName,
    defaultFolderId,
    dialogRef,
    savingPath,
    canSave,
    isSaved,
    isSaving,
    openSave,
    closeDialog,
    confirmSave
  }
}
