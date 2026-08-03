import { watch, type ShallowRef } from 'vue'
import type { DockviewApi } from 'dockview-vue'
import { isDraftAssetId, type AssetInfo } from '@shared/domain'
import { useStudioI18n } from '../../composables/useStudioI18n'
import { useEditorKernel } from '../kernel'
import { draftToAssetInfo, useDraftStore } from '../../stores/drafts'
import { useProjectStore } from '../../stores/project'

export type EditorPanelKind =
  | 'asset'
  | 'screenplay'
  | 'script'
  | 'canvas'
  | 'world'
  | 'beat'
  | 'director'

export function usePanelTitles(dockApi: ShallowRef<DockviewApi | null>) {
  const project = useProjectStore()
  const editor = useEditorKernel()
  const { t, locale, assetTypeLabel } = useStudioI18n()

  function resolveEditorAsset(assetId: string): AssetInfo | null {
    const asset = project.assets.find((item) => item.id === assetId)
    if (asset) return asset
    if (!isDraftAssetId(assetId)) return null
    const draft = useDraftStore().getDraft(assetId)
    return draft ? draftToAssetInfo(draft) : null
  }

  function baseTitle(kind: EditorPanelKind, assetId: string): string {
    const asset = resolveEditorAsset(assetId)
    const prefix =
      kind === 'asset'
        ? asset ? assetTypeLabel(asset.type) : t('asset.generic')
        : t(`studio.editor.${kind}`)
    const title =
      kind === 'screenplay'
        ? prefix
        : asset
          ? `${prefix} · ${asset.name}`
          : prefix
    return isDraftAssetId(assetId) ? `${title} *` : title
  }

  function documentIds(kind: EditorPanelKind, assetId: string): string[] {
    switch (kind) {
      case 'asset':
      case 'screenplay':
        return [`asset:${assetId}`, `graph:asset:${assetId}`]
      case 'script':
        return [`editor:script:${assetId}`, `graph:script:${assetId}`]
      case 'canvas':
      case 'world':
      case 'beat':
      case 'director':
        return [`asset:${assetId}`, `graph:asset:${assetId}`]
    }
  }

  function title(kind: EditorPanelKind, assetId: string): string {
    const base = baseTitle(kind, assetId)
    const dirty = documentIds(kind, assetId).some(
      (id) =>
        editor.documents.isDirty(id, true) ||
        editor.documents.sessions.value.some(
          (session) =>
            (session.id === id || session.id.startsWith(`${id}:`)) &&
            session.dirty
        )
    )
    return dirty && !base.endsWith(' *') ? `${base} *` : base
  }

  function apply(): void {
    const api = dockApi.value
    if (!api) return
    for (const panel of api.panels) {
      const definitions: Array<[string, EditorPanelKind]> = [
        ['asset-editor-', 'asset'],
        ['screenplay-editor-', 'screenplay'],
        ['script-editor-', 'script'],
        ['canvas-editor-', 'canvas'],
        ['world-editor-', 'world'],
        ['beat-editor-', 'beat'],
        ['director-editor-', 'director']
      ]
      const match = definitions.find(([prefix]) => panel.id.startsWith(prefix))
      if (!match) continue
      panel.api.setTitle(title(match[1], panel.id.slice(match[0].length)))
    }
  }

  watch(locale, apply)
  watch(
    () =>
      editor.documents.sessions.value
        .map((session) => `${session.id}:${session.status}`)
        .join('|'),
    apply
  )

  return { title, apply }
}
