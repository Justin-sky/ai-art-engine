import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useProjectStore } from '../stores/project'

/** 从 project.json 路径取工程文件夹名，供菜单短标签 */
export function projectRecentLabel(projectJsonPath: string): string {
  const normalized = projectJsonPath.replace(/\\/g, '/').replace(/\/+$/, '')
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length >= 2 && parts[parts.length - 1]!.toLowerCase() === 'project.json') {
    return parts[parts.length - 2]!
  }
  return parts[parts.length - 1] || projectJsonPath
}

/**
 * 新建 / 打开 / 最近工程 / 关闭：首页与顶栏「打开」菜单共用。
 */
export function useProjectLifecycle() {
  const router = useRouter()
  const project = useProjectStore()
  const recent = ref<string[]>([])
  const error = ref('')
  const createError = ref('')
  const createOpen = ref(false)
  const newName = ref('')
  const parentDir = ref('')
  const busy = ref(false)

  async function refreshRecent(): Promise<void> {
    if (typeof window.studio?.getRecentProjects !== 'function') {
      error.value = 'api-unavailable'
      return
    }
    recent.value = await window.studio.getRecentProjects()
  }

  function openCreateDialog(): void {
    error.value = ''
    createError.value = ''
    newName.value = ''
    parentDir.value = ''
    createOpen.value = true
  }

  function closeCreateDialog(): void {
    createOpen.value = false
    createError.value = ''
  }

  async function pickCreateDir(): Promise<void> {
    const dir = await window.studio.selectDirectory()
    if (dir) parentDir.value = dir
  }

  async function goStudioAfterOpen(): Promise<void> {
    await router.push('/studio')
  }

  async function confirmCreate(): Promise<boolean> {
    if (!newName.value.trim() || !parentDir.value || busy.value) return false
    try {
      busy.value = true
      createError.value = ''
      const result = await window.studio.createProject({
        name: newName.value.trim(),
        parentDir: parentDir.value
      })
      project.loadFromResult(result)
      await project.recoverAutosaves()
      closeCreateDialog()
      await refreshRecent()
      await goStudioAfterOpen()
      return true
    } catch (e) {
      createError.value = e instanceof Error ? e.message : String(e)
      return false
    } finally {
      busy.value = false
    }
  }

  async function openProjectPath(path: string): Promise<boolean> {
    if (!path.trim() || busy.value) return false
    try {
      busy.value = true
      error.value = ''
      const result = await window.studio.openProject(path)
      project.loadFromResult(result)
      await project.recoverAutosaves()
      await refreshRecent()
      await goStudioAfterOpen()
      return true
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      return false
    } finally {
      busy.value = false
    }
  }

  async function browseAndOpen(): Promise<boolean> {
    try {
      error.value = ''
      const path = await window.studio.selectProject()
      if (!path) return false
      return await openProjectPath(path)
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      return false
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

  async function closeProject(): Promise<void> {
    try {
      busy.value = true
      error.value = ''
      if (typeof window.studio?.closeProject === 'function') {
        await window.studio.closeProject()
      }
      project.reset()
      await router.push('/')
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      busy.value = false
    }
  }

  return {
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
  }
}
