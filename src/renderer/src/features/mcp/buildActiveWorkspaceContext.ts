import type { AssetInfo } from '@shared/domain'
import {
  contentEndSecOfTimeline,
  parseComicPage,
  parseFilmStoryboard,
  readImageGenerateParamsFromNode,
  readScriptTimelineFromGenParams,
  readVideoGenerateParamsFromNode,
  type GraphDocument,
  type GraphNode
} from '@shared/graph'
import { formatNodeEditableSchemaSummary } from '../../editor/control/surfaceRegistry'
import { useEditorKernel } from '../../editor/kernel'
import { useProjectStore } from '../../stores/project'
import { useWorkspaceStore } from '../../stores/workspace'
import { resolveDirectorStageScene } from '../director/activeDirectorStageScene'
import { serializeDirectorStageSnapshot } from '../director/mcpDirectorStageOps'
import {
  isEditorDiveAssetFrame,
  isEditorDiveViewFrame,
  type EditorDiveFrame
} from '../graph/model/editorDive'
import { graphEditorHosts } from '../graph/model/graphEditorHosts'

function readAssetGraph(asset: AssetInfo | undefined): GraphDocument | null {
  const graphJson = (asset?.genParams as Record<string, unknown> | undefined)?.graphJson as
    GraphDocument | undefined
  return graphJson && Array.isArray(graphJson.nodes) ? graphJson : null
}

function sanitizeValueForContext(value: unknown, key = '', depth = 0): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === 'boolean' || typeof typeof value === 'number') return value
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    if (value.startsWith('data:')) return '[dataUrl omitted]'
    const maxLen =
      key === 'generateInstruction' || key === 'text' || key === 'notepadText' ? 1200 : 400
    return value.length > maxLen ? `${value.slice(0, maxLen)}...(truncated)` : value
  }
  if (depth >= 3) {
    if (Array.isArray(value)) return `[Array(${value.length})]`
    return '[Object]'
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeValueForContext(item, key, depth + 1))
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined || v === null || v === '') continue
      if (
        k === 'previewDataUrl' ||
        k === 'dataUrl' ||
        k === 'maskDataUrl' ||
        k === 'sourceDataUrl'
      ) {
        continue
      }
      out[k] = sanitizeValueForContext(v, k, depth + 1)
    }
    return out
  }
  return String(value)
}

export function sanitizeNodeParamsForContext(
  params: Record<string, unknown> | undefined
): Record<string, unknown> {
  if (!params || typeof params !== 'object') return {}
  const summary: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    if (
      key === 'previewDataUrl' ||
      key === 'dataUrl' ||
      key === 'maskDataUrl' ||
      key === 'sourceDataUrl'
    ) {
      continue
    }
    if (key === 'filmStoryboard' && typeof value === 'string') {
      const sb = parseFilmStoryboard(value)
      if (sb) {
        summary.filmStoryboardSummary = {
          sceneCount: sb.scenes.length,
          shotCount: sb.shots.length,
          scenes: sb.scenes.slice(0, 12).map((s) => ({
            id: s.id,
            heading: s.heading,
            location: s.location,
            time: s.time
          })),
          shots: sb.shots.slice(0, 25).map((sh) => ({
            id: sh.id,
            sceneId: sh.sceneId,
            title: sh.title,
            shotSize: sh.shotSize,
            angle: sh.angle,
            cameraMove: sh.cameraMove,
            durationSec: sh.durationSec,
            characters: sh.characters,
            props: sh.props,
            action: sh.action,
            dialogueCount: sh.dialogue?.length ?? 0
          }))
        }
        continue
      }
    }
    if (key === 'comicPage' && typeof value === 'string') {
      const page = parseComicPage(value)
      if (page) {
        summary.comicPageSummary = {
          title: page.title,
          width: page.width,
          height: page.height,
          columns: page.columns,
          rows: page.rows,
          backgroundColor: page.backgroundColor,
          panelCount: page.panels.length,
          panels: page.panels.slice(0, 20).map((p) => ({
            id: p.id,
            row: p.row,
            col: p.col,
            rowSpan: p.rowSpan,
            colSpan: p.colSpan,
            hasImage: Boolean(p.imageUrl),
            bubbles: p.bubbles.map((b) => ({
              id: b.id,
              text: b.text
            }))
          }))
        }
        continue
      }
    }
    summary[key] = sanitizeValueForContext(value, key, 0)
  }
  return summary
}

function formatStageSummaryLines(
  stageSnap: Record<string, unknown>,
  heading = 'Active 3D Director Stage in Left Window'
): string[] {
  const assetId = String(stageSnap.directorAssetId ?? '')
  const lines: string[] = []
  lines.push(
    `${heading}: directorAssetId="${assetId}", processingNodeId="${String(stageSnap.processingNodeId ?? '')}", live=${String(stageSnap.live)}, viewMode=${String(stageSnap.viewMode)}, shadingMode=${String(stageSnap.shadingMode)}, stageEditMode=${String(stageSnap.stageEditMode ?? 'scene')}, transformMode=${String(stageSnap.transformMode ?? 'translate')}, aspectRatio=${String(stageSnap.aspectRatio)}, compositionGuide=${String(stageSnap.compositionGuide)}, capturePass=${String(stageSnap.capturePass)}, activeCameraId="${String(stageSnap.activeCameraId ?? '')}", selectionKind="${String(stageSnap.selectionKind ?? '')}", selectedObjectId="${String(stageSnap.selectedObjectId ?? '')}", lightingPreset="${String(stageSnap.lightingPreset ?? '')}", skyColor="${String(stageSnap.skyColor ?? '')}"`
  )
  lines.push(
    `  [MANDATORY 3D STAGE EDIT PROTOCOL]: To execute ANY edit in the 3D Director Stage or its right-hand Inspector, call \`mcp__studio__graph_edit\` with \`assetId: "${assetId}"\` and \`ops: [...]\` immediately in 1 single tool call! (Do NOT use read/grep/edit/write on .canvas.asset.json files and do NOT call ui_click!)`
  )
  lines.push(
    `  Supported 3D Stage & Inspector \`ops\` in \`graph_edit({ assetId: "${assetId}", ops: [...] })\`:`,
    `    * Object show/hide/lock/rename/move/rotate/scale/color/parent/pose/light/material: \`{ "op": "object_update", "name": "物体名或objectId", "visible": false, "locked": false, "nameVisible": true, "newName": "...", "position": {"x":0,"y":0,"z":0}, "positionDelta": {"x":1,"y":0,"z":0}, "rotationDeg": {"x":0,"y":45,"z":0}, "rotationDeltaDeg": {"y":30}, "scale": 1.2, "color": "红色|#ef4444", "parentName": "父物体名或null", "posePreset": "idle|walk|run|sit|crouch|wave|point|think|fight|jump|bow|look_back|arms_crossed|hands_on_hips|kneel|phone|defeated|cheer", "resetPose": true, "poseEditMode": "fk|ik", "bonePose": {"RightArm":{"x":30,"y":0,"z":0}}, "light": {"type":"spot|point|directional","intensity":2,"distance":10,"angleDeg":35,"penumbra":0.3,"castShadow":true} }\``,
    `    * Add/delete/duplicate/select/focus object: \`{ "op": "object_add", "kind": "primitive|character|light|camera|empty|model", "primitive": "box|sphere|cylinder|cone|plane|capsule|torus", "mannequinPreset": "humanoid|chibi|quadruped", "lightType": "spot|point|directional", "name": "...", "color": "...", "position": {"x":0,"y":0,"z":0} }\`, \`{ "op": "object_delete", "name": "..." }\`, \`{ "op": "object_duplicate", "name": "...", "positionDelta": {"x":1} }\`, \`{ "op": "object_select", "name": "...", "focus": true }\``,
    `    * Camera & Cinemachine & Shake: \`{ "op": "camera_update", "cameraId": "${String(stageSnap.activeCameraId ?? '')}", "position": {"x":0,"y":2,"z":5}, "target": {"x":0,"y":1,"z":0}, "rotationDeg": {"x":-10,"y":0,"z":0}, "fov": 45, "focalLengthMm": 50, "aperture": 2.8, "focusDistance": 3.5, "dollyZoomLock": false, "handheldShake": {"enabled":true,"intensity":0.3,"frequency":1.2}, "cinemachine": {"bodyMode":"none|transposer|orbital|group","followTargetName":"...", "aimMode":"none|composer|groupComposer|hardLookAt","lookAtTargetName":"...","aimTargetPart":"head|chest|root","screenCompositionPreset":"center|leftThird|rightThird|heroLow","autoFocusPull":true,"noisePreset":"none|handheld"} }\``,
    `    * Scene Global, Lighting Preset, Panorama, Ground & Fog: \`{ "op": "environment_update", "lightingPreset": "rembrandt|butterfly|three_point|high_key|low_key|neon_cyber|golden_hour|moonlight|top_down|silhouette", "skyColor": "#1e293b", "panoramaVisible": true, "panoramaYaw": 45, "panoramaRadius": 500, "sceneWorld": {"scalePercent":100,"position":{"x":0,"y":0,"z":0},"rotationDeg":{"x":0,"y":0,"z":0}}, "ground": {"visible":true,"opacity":0.35,"offsetY":0}, "environment": {"fogEnabled":true,"fogDensity":0.02,"fogColor":"#0f172a","shadowCatcherEnabled":true,"shadowCatcherOpacity":0.36} }\``,
    `    * Viewport, View Orientation, Gizmos & Sensitivity: \`{ "op": "viewport_update", "viewMode": "director|camera", "stageEditMode": "scene|animation", "transformMode": "translate|rotate|scale", "shadingMode": "shaded|wireframe|shadedWireframe", "aspectRatio": "16:9|9:16|1:1|4:3|21:9", "compositionGuide": "none|thirds|center|diagonal|golden", "capturePass": "rgb|depth|normal|canny", "viewOrientation": "front|back|left|right|top|bottom", "moveToView": true, "alignWithView": true, "alignViewToSelected": true, "gizmoSize": 1, "sceneLabelsVisible": true, "cameraGizmosVisible": true, "lightGizmosVisible": true, "gridGizmoVisible": true, "selectionBoundsVisible": true }\``,
    `    * AI Blocking / Previz / Capture / Animation: \`{ "op": "ai_blocking", "prompt": "..." }\`, \`{ "op": "cinemachine_pack", "packId": "dialogue_ab|action_chase|hero_reveal|suspense_thriller" }\`, \`{ "op": "storyboard_previz", "captureAndWriteBack": true }\`, \`{ "op": "capture_shot", "allCameras": false }\`, \`{ "op": "anim_control", "action": "play|pause|stop|seek|add_track|add_keyframe|export_video", "time": 0, "duration": 5, "loop": true }\``
  )
  const objects = Array.isArray(stageSnap.objects)
    ? (stageSnap.objects as Array<Record<string, unknown>>)
    : []
  if (objects.length) {
    lines.push(`  3D Stage Objects (${objects.length}):`)
    for (const obj of objects.slice(0, 40)) {
      const pos = obj.position as { x: number; y: number; z: number } | undefined
      const rot = obj.rotationDeg as { x: number; y: number; z: number } | undefined
      const scl = obj.scale as { x: number; y: number; z: number } | undefined
      const posStr = pos ? `pos=(${pos.x},${pos.y},${pos.z})` : ''
      const rotStr = rot ? `rotDeg=(${rot.x},${rot.y},${rot.z})` : ''
      const sclStr = scl ? `scale=(${scl.x},${scl.y},${scl.z})` : ''
      const extra = [
        obj.primitive ? `primitive=${String(obj.primitive)}` : '',
        obj.mannequinPreset ? `preset=${String(obj.mannequinPreset)}` : '',
        obj.color ? `color=${String(obj.color)}` : '',
        `visible=${String(obj.visible)}`,
        obj.locked ? 'locked=true' : '',
        obj.parentId ? `parentId="${String(obj.parentId)}"` : '',
        posStr,
        rotStr,
        sclStr
      ]
        .filter(Boolean)
        .join(', ')
      lines.push(
        `    - id="${String(obj.id)}" name="${String(obj.name)}" [${String(obj.kind)}] (${extra})`
      )
    }
  } else {
    lines.push('  3D Stage Objects: (empty)')
  }

  const cameras = Array.isArray(stageSnap.cameras)
    ? (stageSnap.cameras as Array<Record<string, unknown>>)
    : []
  if (cameras.length) {
    lines.push(`  3D Stage Cameras (${cameras.length}):`)
    for (const cam of cameras.slice(0, 20)) {
      const viewer = cam.viewer as Record<string, unknown> | undefined
      const pos = viewer?.position as { x: number; y: number; z: number } | undefined
      const tgt = viewer?.target as { x: number; y: number; z: number } | undefined
      const rot = viewer?.rotationDeg as { x: number; y: number; z: number } | undefined
      lines.push(
        `    - id="${String(cam.id)}" name="${String(cam.name)}" active=${String(cam.isActive)} visible=${String(cam.visible)}${pos ? ` pos=(${pos.x},${pos.y},${pos.z})` : ''}${tgt ? ` target=(${tgt.x},${tgt.y},${tgt.z})` : ''}${rot ? ` rotDeg=(${rot.x},${rot.y},${rot.z})` : ''} fov=${String(viewer?.fov ?? '')}${viewer?.focalLengthMm ? ` focal=${String(viewer.focalLengthMm)}mm` : ''}`
      )
    }
  }
  if (stageSnap.selectedObjectInspector) {
    lines.push(
      `  Active 3D Stage Object Inspector: ${JSON.stringify(stageSnap.selectedObjectInspector)}`
    )
  }
  return lines
}

function describeDiveFrame(frame: EditorDiveFrame): string {
  if (isEditorDiveAssetFrame(frame)) {
    return `${frame.title} [asset:${frame.kind}, assetId="${frame.assetId}"]`
  }
  if (isEditorDiveViewFrame(frame)) {
    const meta = frame.meta
    if ('nodeId' in meta && meta.nodeId) {
      return `${frame.title} [view:${frame.viewId}, hostId="${'hostId' in meta ? meta.hostId : ''}", nodeId="${meta.nodeId}"]`
    }
    if (meta.viewId === 'director.stage') {
      return `${frame.title} [view:director.stage, directorAssetId="${meta.directorAssetId}", processingNodeId="${meta.processingNodeId ?? ''}"]`
    }
    if (meta.viewId === 'script.timeline') {
      return `${frame.title} [view:script.timeline, scriptAssetId="${meta.scriptAssetId}", timelineNodeId="${meta.timelineNodeId ?? ''}"]`
    }
    if (meta.viewId === 'world.editor') {
      return `${frame.title} [view:world.editor, worldAssetId="${meta.worldAssetId}", tab="${meta.tab ?? 'characters'}"]`
    }
    return `${frame.title} [view:${frame.viewId}]`
  }
  return ''
}

function resolveHostAssetIdFromHostId(hostId: string | undefined): string {
  if (!hostId) return ''
  const trimmed = hostId.trim()
  if (!trimmed.startsWith('asset:')) return ''
  const rest = trimmed.slice('asset:'.length)
  const colonIdx = rest.indexOf(':')
  return colonIdx >= 0 ? rest.slice(0, colonIdx) : rest
}

/**
 * 构建当前左侧主窗口与右侧检查器完整感知上下文（画布 + Dive 面包屑栈 + 栈顶打开的子图/工具/3D导演台/分镜台/时间线 + 右侧 Inspector 实时状态）。
 */
export function buildActiveWorkspaceContext(): string | undefined {
  const workspaceStore = useWorkspaceStore()
  const project = useProjectStore()
  const editor = useEditorKernel()
  const lines: string[] = []

  const hostFromSelection = resolveHostAssetIdFromHostId(
    workspaceStore.selectedGraphHostId ?? undefined
  )
  const lastOpenCanvas =
    workspaceStore.openCanvasEditorIds[workspaceStore.openCanvasEditorIds.length - 1] ?? null
  const lastOpenDirector =
    workspaceStore.openDirectorEditorIds[workspaceStore.openDirectorEditorIds.length - 1] ?? null
  const lastOpenWorld =
    workspaceStore.openWorldEditorIds[workspaceStore.openWorldEditorIds.length - 1] ?? null
  const lastOpenBeat =
    workspaceStore.openBeatEditorIds[workspaceStore.openBeatEditorIds.length - 1] ?? null
  const lastOpenScreenplay =
    workspaceStore.openScreenplayEditorIds[workspaceStore.openScreenplayEditorIds.length - 1] ??
    null
  const lastOpenAsset =
    workspaceStore.openAssetEditorIds[workspaceStore.openAssetEditorIds.length - 1] ?? null
  const liveEntries = graphEditorHosts.listLiveEntries()
  const lastLiveAssetId = (() => {
    for (let i = liveEntries.length - 1; i >= 0; i--) {
      const aid = resolveHostAssetIdFromHostId(liveEntries[i]?.hostId)
      if (aid) return aid
    }
    return null
  })()

  // Parse activeDiveRootKey (supports both UI "canvas-editor-<assetId>" and shorthand "canvas:<assetId>")
  const diveRootKey = workspaceStore.activeDiveRootKey
  const parsedDiveRoot = (() => {
    if (!diveRootKey) return { kind: '', assetId: null as string | null }
    const m = diveRootKey.match(/^(canvas|asset|screenplay|world|beat|director)-editor-(.+)$/)
    if (m) return { kind: m[1] ?? '', assetId: m[2] || null }
    const parts = diveRootKey.split(':')
    return { kind: parts[0] ?? '', assetId: parts.slice(1).join(':') || null }
  })()
  const diveRootKind = parsedDiveRoot.kind
  const diveRootAssetId = parsedDiveRoot.assetId
  const diveStack: EditorDiveFrame[] =
    (diveRootKey ? workspaceStore.editorDives[diveRootKey] : undefined) ?? []
  const diveTop = diveStack.length > 0 ? diveStack[diveStack.length - 1] : null

  const activeAssetId =
    diveRootAssetId ||
    hostFromSelection ||
    lastOpenCanvas ||
    lastOpenDirector ||
    lastOpenWorld ||
    lastOpenBeat ||
    lastOpenScreenplay ||
    lastLiveAssetId ||
    (workspaceStore.selectedAssetId &&
    project.assets.some(
      (a) =>
        a.id === workspaceStore.selectedAssetId &&
        (a.type === 'canvas' || (readAssetGraph(a)?.nodes?.length ?? 0) > 0)
    )
      ? workspaceStore.selectedAssetId
      : null) ||
    lastOpenAsset

  const rootAsset = activeAssetId ? project.assets.find((a) => a.id === activeAssetId) : undefined

  // 1. Left Window Breadcrumb & Active View Header
  if (diveStack.length > 0) {
    const rootLabel = rootAsset?.name || diveRootAssetId || diveRootKind || 'Root'
    const crumbs = [rootLabel, ...diveStack.map((f) => describeDiveFrame(f))].join(' > ')
    lines.push(`Left Window Dive Breadcrumb: ${crumbs}`)
  } else if (lastOpenDirector && activeAssetId === lastOpenDirector) {
    const dirAsset = project.assets.find((a) => a.id === lastOpenDirector)
    lines.push(
      `Left Window Active Editor: Director Editor (directorAssetId="${lastOpenDirector}", name="${dirAsset?.name ?? ''}")`
    )
  } else if (lastOpenWorld && activeAssetId === lastOpenWorld) {
    const wAsset = project.assets.find((a) => a.id === lastOpenWorld)
    lines.push(
      `Left Window Active Editor: World Element Editor (worldAssetId="${lastOpenWorld}", name="${wAsset?.name ?? ''}")`
    )
  }

  // 2. Live 3D Director Stage (if mounted in the left window)
  const liveDirectorScene = resolveDirectorStageScene(null)
  if (liveDirectorScene) {
    const snap = serializeDirectorStageSnapshot(liveDirectorScene.stage.value, {
      live: true,
      directorAssetId: liveDirectorScene.directorAssetId,
      processingNodeId:
        liveDirectorScene.processingNodeId ??
        liveDirectorScene.stage.value.ownerProcessingNodeId ??
        null,
      viewMode: liveDirectorScene.viewMode.value,
      shadingMode: liveDirectorScene.shadingMode.value,
      selectionKind: liveDirectorScene.selectionKind.value,
      selectedObjectId: liveDirectorScene.selectedObjectId.value,
      selectedCameraId: liveDirectorScene.selectedCameraId.value,
      animPlaying: liveDirectorScene.animPlaying.value,
      animTime: liveDirectorScene.animTime.value,
      liveScene: liveDirectorScene
    })
    lines.push(...formatStageSummaryLines(snap))
  }

  // 3. Detailed state of the frontmost Dive View (`diveTop`)
  if (diveTop && isEditorDiveViewFrame(diveTop)) {
    const meta = diveTop.meta
    lines.push(
      `Frontmost Dive View in Left Window: viewId="${diveTop.viewId}", title="${diveTop.title}"`
    )

    if ('hostId' in meta && 'nodeId' in meta && meta.hostId && meta.nodeId) {
      const hostAssetId = resolveHostAssetIdFromHostId(meta.hostId)
      const divedNode: GraphNode | null =
        graphEditorHosts.getNode(meta.hostId, meta.nodeId) ??
        (hostAssetId
          ? (readAssetGraph(project.assets.find((a) => a.id === hostAssetId))?.nodes.find(
              (n) => n.id === meta.nodeId
            ) ?? null)
          : null)

      if (divedNode) {
        const sanitizedParams = sanitizeNodeParamsForContext(
          divedNode.params as Record<string, unknown> | undefined
        )
        lines.push(
          `  Dived Node Target: assetId="${hostAssetId}", hostId="${meta.hostId}", nodeId="${divedNode.id}", typeId="${divedNode.typeId}", title="${divedNode.title || divedNode.typeId}" — use tool \`graph_edit\` with assetId="${hostAssetId}"${meta.hostId !== `asset:${hostAssetId}` ? `, hostId="${meta.hostId}"` : ''} and op="node_update", nodeId="${divedNode.id}" to modify its params`,
          `  Dived Node Current Params: ${JSON.stringify(sanitizedParams)}`,
          ...formatNodeEditableSchemaSummary(divedNode, '  ')
        )
      }
    }

    if (meta.viewId === 'script.timeline') {
      const tlAsset = project.assets.find((a) => a.id === meta.scriptAssetId)
      const doc = readScriptTimelineFromGenParams(
        tlAsset?.genParams as Record<string, unknown> | undefined,
        meta.timelineNodeId
      )
      lines.push(
        `  Active Script Timeline: scriptAssetId="${meta.scriptAssetId}", timelineNodeId="${meta.timelineNodeId ?? ''}", clipCount=${doc.clips.length}, durationSec=${contentEndSecOfTimeline(doc.clips)} — use tool \`timeline_edit\` or \`timeline_rough_cut\` with assetId="${meta.scriptAssetId}"${meta.timelineNodeId ? `, nodeId="${meta.timelineNodeId}"` : ''} to modify`
      )
      if (doc.clips.length) {
        const clipLines = doc.clips
          .slice(0, 25)
          .map(
            (c) =>
              `    - clipId="${c.id}" track=${c.track} [${c.startSec}s..${Number((c.startSec + c.durationSec).toFixed(2))}s] title="${c.title || ''}"`
          )
        lines.push('  Timeline Clips:', ...clipLines)
      }
    } else if (meta.viewId === /* view-id-keep */ 'semantic.timeline') {
      lines.push(
        `  Active Semantic Timeline: timelineId="${meta.timelineId}", sourceAssetId="${meta.sourceAssetId ?? ''}", graphHostId="${meta.hostId ?? ''}", graphNodeId="${meta.nodeId ?? ''}" — use tool \`semantic_timeline_read\` to inspect or \`graph_edit\` with op="semantic_timeline_edit", timelineId="${meta.timelineId}" to modify shots/utterances/entities`
      )
    } else if (meta.viewId === 'world.editor') {
      const worldPrefix = `asset:${meta.worldAssetId}:element:`
      const elementEntries = liveEntries.filter((e) => e.hostId.startsWith(worldPrefix))
      const activeWorldTab = meta.tab ?? 'characters'
      const activeElementHostId =
        meta.worldGenNodeId?.trim() && meta.worldGenNodeId.trim() !== 'world-gen'
          ? `asset:${meta.worldAssetId}:element:${activeWorldTab}:${meta.worldGenNodeId.trim()}`
          : `asset:${meta.worldAssetId}:element:${activeWorldTab}`
      lines.push(
        `  Active World Element Editor: worldAssetId="${meta.worldAssetId}", worldGenNodeId="${meta.worldGenNodeId ?? ''}", activeTab="${activeWorldTab}", activeHostId="${activeElementHostId}" — use \`graph_edit\` with assetId="${meta.worldAssetId}", hostId="${activeElementHostId}" to edit nodes in the active tab`
      )
      for (const entry of elementEntries) {
        const nodeList = entry.document.nodes
          .slice(0, 20)
          .map((n) => `${n.id} [${n.typeId}] "${n.title || n.typeId}"`)
          .join(', ')
        lines.push(
          `    - Element Subgraph hostId="${entry.hostId}" (${entry.document.nodes.length} nodes): ${nodeList}`
        )
      }
    } else if (meta.viewId === 'gamePlay.sandbox' && meta.gamePlayAssetId) {
      const gpAsset = project.assets.find((a) => a.id === meta.gamePlayAssetId)
      lines.push(
        `  Active GamePlay Sandbox Asset: gamePlayAssetId="${meta.gamePlayAssetId}", name="${gpAsset?.name ?? ''}" — use \`graph_edit\` with assetId="${meta.gamePlayAssetId}", op="asset_update" to modify`
      )
    } else if (meta.viewId === 'media.preview') {
      lines.push(
        `  Active Media Preview: mediaKind="${meta.mediaKind}", title="${meta.title ?? ''}", relativePath="${meta.relativePath ?? ''}"`
      )
    }
  } else if (diveTop && isEditorDiveAssetFrame(diveTop)) {
    const subAsset = project.assets.find((a) => a.id === diveTop.assetId)
    const subDoc =
      graphEditorHosts.getLiveAssetDocument(diveTop.assetId) ?? readAssetGraph(subAsset)
    lines.push(
      `Frontmost Dived Asset in Left Window: "${subAsset?.name ?? diveTop.title}" (assetId="${diveTop.assetId}", kind=${diveTop.kind})`
    )
    if (subDoc?.nodes?.length) {
      const subNodes = subDoc.nodes
        .slice(0, 30)
        .map((n) => `  * ${n.id} [${n.typeId}] "${n.title || n.typeId}"`)
      lines.push(`Nodes in dived asset "${diveTop.assetId}" (${subDoc.nodes.length}):`, ...subNodes)
    }
  }

  // 4. Active Right-Hand Inspector Panel Context
  const curSelection = editor.selection.current.value
  const fallbackEditAssetId =
    activeAssetId ||
    liveDirectorScene?.directorAssetId ||
    project.assets.find((a) => a.type === 'canvas')?.id ||
    ''
  if (curSelection.kind.startsWith('stage.') && liveDirectorScene) {
    lines.push(
      `[Active Inspector Panel State]: kind="${curSelection.kind}", id="${curSelection.id ?? ''}" — use \`graph_edit({ assetId: "${liveDirectorScene.directorAssetId}", ops: [{ op: "inspector_update", ... }] })\` or specific stage ops (\`object_update\`, \`camera_update\`, \`environment_update\`) to edit any Inspector field.`
    )
  } else if (curSelection.kind === 'graph.node' && curSelection.id) {
    const selHostId = curSelection.hostId ?? `asset:${fallbackEditAssetId}`
    const hostAssetId = resolveHostAssetIdFromHostId(selHostId) || fallbackEditAssetId
    const node = graphEditorHosts.getNode(selHostId, curSelection.id)
    if (node) {
      const imgParams =
        node.assetType === 'image' ? readImageGenerateParamsFromNode(node.params) : undefined
      const vidParams =
        node.assetType === 'video' ? readVideoGenerateParamsFromNode(node.params) : undefined
      lines.push(
        `[Active Inspector Panel State]: kind="graph.node", assetId="${hostAssetId}", hostId="${selHostId}", nodeId="${node.id}", typeId="${node.typeId}", title="${node.title || ''}", locked=${Boolean(node.locked)}${imgParams ? `, imageGenerateParams=${JSON.stringify(imgParams)}` : ''}${vidParams ? `, videoGenerateParams=${JSON.stringify(vidParams)}` : ''}`,
        `  To modify any field in the Node Inspector (title, locked, instruction/generateInstruction, systemPrompt/generateSystemPrompt, model/generateModel, aspectRatio, resolution/size, count, useGlobalStyle, styleImages, voiceCharacter, or any node.params field / dot-path / preset), call \`graph_edit({ assetId: "${hostAssetId}", ops: [{ op: "node_update", nodeId: "${node.id}", title: "...", locked: false, preset: "...", params: { ... } }] })\`.`,
        ...formatNodeEditableSchemaSummary(node, '  ')
      )
    }
  } else if (curSelection.kind === 'asset' && curSelection.id) {
    const selAsset = project.assets.find((a) => a.id === curSelection.id)
    if (selAsset) {
      lines.push(
        `[Active Inspector Panel State]: kind="asset", targetAssetId="${selAsset.id}", name="${selAsset.name}", type="${selAsset.type}", genParams=${JSON.stringify(sanitizeValueForContext(selAsset.genParams, '', 0))}`,
        `  To modify this Asset Inspector (name, color, transform, genParams), call \`graph_edit({ assetId: "${fallbackEditAssetId || selAsset.id}", ops: [{ op: "asset_update", targetAssetId: "${selAsset.id}", name: "...", color: "#...", transform: { ... } }] })\`.`
      )
    }
  } else {
    lines.push(
      `[Active Inspector Panel State]: kind="project" (Project Globals Inspector), generateSeed=${String(project.config?.generateSeed ?? 'random')}, cacheOutputDir="${String(project.config?.cacheOutputDir ?? 'Cache')}", styleImagesCount=${project.config?.styleImages?.length ?? 0}`,
      `  To modify Project Globals Inspector (generateSeed, cacheOutputDir, styleImages), call \`graph_edit({ assetId: "${fallbackEditAssetId}", ops: [{ op: "project_globals_update", generateSeed: 42, cacheOutputDir: "...", styleImages: [...] }] })\`.`
    )
  }

  // 5. Root / Active Canvas Graph & Selected Node
  const contextCanvasId = activeAssetId || fallbackEditAssetId
  if (contextCanvasId) {
    const asset = project.assets.find((a) => a.id === contextCanvasId)
    const liveDoc = graphEditorHosts.getLiveAssetDocument(contextCanvasId) ?? readAssetGraph(asset)
    if (asset || liveDoc) {
      lines.push(
        `Active canvas asset: "${asset?.name ?? contextCanvasId}" (assetId: "${contextCanvasId}", type: ${asset?.type ?? 'canvas'})`,
        `  [Canvas Node Generation & Execution Protocol]: To generate or process any image/video/audio/3D/world, call \`graph_edit({ assetId: "${contextCanvasId}", ops: [{ op: "node_upsert", nodeId: "...", typeId: "asset.image|asset.video|asset.voice|asset.dialogue|asset.sfx|asset.music|svg.gen|svg.anim|output.timeline|asset.model3d|asset.spatialWorld", title: "...", params: { prompt: "...", ... } }] })\` followed by \`task_run({ assetId: "${contextCanvasId}", nodeIds: ["..."] })\`. When the user says "根据下面文章生成科普视频" / "把这篇文档做成视频" (or gives any knowledge/popular-science document to turn into a video), automatically wire each section's \`asset.voice\` (narration) + visual node (\`svg.gen -> svg.anim\` 16:9 animated diagram, \`asset.image\`, or \`asset.video\`) + \`asset.music\` into \`output.timeline\` and run \`task_run({ assetId: "${contextCanvasId}", nodeIds: ["<timelineNodeId>"] })\`. When the user provides multiple photos and asks for a Music Photo Album / Slideshow (e.g. "给定几张照片帮我生成音乐相册" / "电子相册"), automatically wire locked \`asset.image\` photo nodes (\`locked: true, params: { sourceRelativePath }\`) + \`asset.music\` BGM node into \`output.timeline\` (\`nodeId: "timeline-out"\`) and run \`task_run({ assetId: "${contextCanvasId}", nodeIds: ["timeline-out"] })\` to synthesize the MP4 with Ken Burns camera motion and transitions.`
      )
      const selectedNodeId = workspaceStore.selectedGraphNodeId
      const selectedHostId = workspaceStore.selectedGraphHostId ?? `asset:${contextCanvasId}`
      const selNode =
        (selectedNodeId ? graphEditorHosts.getNode(selectedHostId, selectedNodeId) : null) ??
        (selectedNodeId && liveDoc?.nodes
          ? (liveDoc.nodes.find((n) => n.id === selectedNodeId) ?? null)
          : null)
      if (selNode) {
        if (
          liveDirectorScene &&
          (selNode.typeId === 'director.stage3d' ||
            selNode.id === liveDirectorScene.processingNodeId) &&
          (!diveTop || (isEditorDiveViewFrame(diveTop) && diveTop.viewId === 'director.stage'))
        ) {
          lines.push(
            `Selected node on canvas: id="${selNode.id}", hostId="${selectedHostId}", typeId="${selNode.typeId}", title="${selNode.title || selNode.typeId}" (Active 3D Director Stage — use 3D stage ops like \`object_update\`, \`hide_object\`, \`show_object\`, \`camera_update\`, \`environment_update\` in \`graph_edit({ assetId: "${contextCanvasId}", ops: [...] })\` instead of \`node_update\`)`
          )
        } else {
          const sanitizedSelParams = sanitizeNodeParamsForContext(
            selNode.params as Record<string, unknown> | undefined
          )
          lines.push(
            `Selected node on canvas: id="${selNode.id}", hostId="${selectedHostId}", typeId="${selNode.typeId}", title="${selNode.title || selNode.typeId}"`,
            `Selected node params: ${JSON.stringify(sanitizedSelParams)}`,
            ...formatNodeEditableSchemaSummary(selNode, '  ')
          )
        }
      }
      if (liveDoc?.nodes?.length) {
        const visibleNodes = liveDoc.nodes.slice(0, 30).map((n) => {
          const toolTag = n.params?.imageProcessTool
            ? `, imageProcessTool="${n.params.imageProcessTool}"`
            : n.params?.filmWorkbenchStage
              ? `, stage="${n.params.filmWorkbenchStage}"`
              : ''
          const hasOutput =
            liveDoc.runStates?.[n.id]?.status === 'done' ||
            Boolean(n.params?.previewRelativePath) ||
            Boolean(n.params?.previewDataUrl) ||
            (Array.isArray(n.params?.generatedImages) && n.params.generatedImages.length > 0) ||
            (Array.isArray(n.params?.generatedVideos) && n.params.generatedVideos.length > 0)
          const statusTag = hasOutput ? ' [done]' : ' [unexecuted]'
          return `  * ${n.id} [${n.typeId}] "${n.title || n.typeId}"${toolTag}${statusTag}`
        })
        lines.push(`Nodes on active canvas (${liveDoc.nodes.length}):`, ...visibleNodes)
      }
      if (liveDoc?.edges?.length) {
        const edgeSummary = liveDoc.edges
          .slice(0, 30)
          .map((e) => `${e.source}(${e.sourcePort || 'out'})->${e.target}(${e.targetPort || 'in'})`)
          .join(', ')
        lines.push(`Edges on active canvas (${liveDoc.edges.length}): ${edgeSummary}`)
      }
    }
  }

  // 6. Other Graph Assets in Project
  const otherCanvases = project.assets
    .filter(
      (a) =>
        a.id !== activeAssetId &&
        (a.type === 'canvas' || (readAssetGraph(a)?.nodes?.length ?? 0) > 0)
    )
    .slice(0, 10)
  if (otherCanvases.length) {
    lines.push(
      `Other graph assets in project: ${otherCanvases
        .map(
          (a) =>
            `"${a.name}" (assetId: "${a.id}", type: ${a.type}, nodes: ${readAssetGraph(a)?.nodes?.length ?? 0})`
        )
        .join('; ')}`
    )
  }

  return lines.length ? lines.join('\n') : undefined
}
