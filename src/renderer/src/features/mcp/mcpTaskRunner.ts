import type { GraphDocument } from '@shared/graph'
import { applyGraphEditOps, collectRunMediaPaths } from '@shared/graph'
import type { McpGraphEditPayload, McpGraphIconRefinePayload } from '@shared/ipc'
import { useGraphTaskStore } from '../../stores/graphTasks'
import { useProjectStore } from '../../stores/project'
import { persistAssetRecord } from '../../composables/useAssetRecord'
import { IconRefineError, runIconRefine } from '../graph/model/runIconRefine'
import { graphEditorHosts } from '../graph/model/graphEditorHosts'
import { isGraphEditorOpen } from './openGraphEditors'
import { openMcpWorkflowAssetEditor } from './mcpGraphLiveCanvas'

const GRAPH_EDITOR_OPEN_WAIT_MS = 8_000
const GRAPH_EDITOR_OPEN_POLL_MS = 50

async function waitForGraphEditorOpen(assetId: string): Promise<boolean> {
  for (let elapsed = 0; elapsed < GRAPH_EDITOR_OPEN_WAIT_MS; elapsed += GRAPH_EDITOR_OPEN_POLL_MS) {
    if (isGraphEditorOpen(assetId) && graphEditorHosts.getLiveAssetDocument(assetId)) return true
    await new Promise<void>((resolve) => window.setTimeout(resolve, GRAPH_EDITOR_OPEN_POLL_MS))
  }
  return isGraphEditorOpen(assetId) && !!graphEditorHosts.getLiveAssetDocument(assetId)
}

/**
 * MCP task_run 的渲染层执行入口：
 * 主进程经 broadcast 派发「运行宿主资产工作流」，这里从工程 store 读取
 * 落盘的图文档（genParams.graphJson），交任务 store 按拓扑序执行，
 * 受理与终态经 reportMcpTask 回报主进程（供 MCP task_status 轮询）。
 */

type ReportPhase = 'accepted' | 'finished' | 'failed'

function report(
  mcpTaskId: string,
  phase: ReportPhase,
  extra: {
    taskId?: string
    status?: 'done' | 'error' | 'stopped'
    error?: string
    /** 本轮产出的媒体相对路径（作品级优先）：主进程据此把活动收尾成可预览产物 */
    relativePaths?: string[]
  } = {}
): void {
  void window.studio?.reportMcpTask?.({ mcpTaskId, phase, ...extra })
}

/** 终态后等写回落盘的时长上限：产物 dataUrl 物化成相对路径后路径才齐全 */
const MEDIA_COLLECT_WRITE_BACK_TIMEOUT_MS = 30_000

/** 终态任务的本轮产物路径：先等写回完成，超时则按当前状态尽力收集 */
async function collectFinishedTaskMediaPaths(
  taskStore: ReturnType<typeof useGraphTaskStore>,
  taskId: string
): Promise<string[]> {
  await Promise.race([
    taskStore.waitForTaskIds([taskId]),
    new Promise<void>((resolve) => window.setTimeout(resolve, MEDIA_COLLECT_WRITE_BACK_TIMEOUT_MS))
  ])
  const snapshot = taskStore.getTaskRunSnapshot(taskId)
  if (!snapshot) return []
  return collectRunMediaPaths(snapshot.graph, snapshot.runStates)
}

async function handleTaskRun(payload: { mcpTaskId: string; assetId: string }): Promise<void> {
  const project = useProjectStore()
  const taskStore = useGraphTaskStore()
  const asset = project.assets.find((item) => item.id === payload.assetId)
  const graphJson = (asset?.genParams as Record<string, unknown> | undefined)?.graphJson as
    GraphDocument | undefined

  if (!asset || !graphJson || !Array.isArray(graphJson.nodes)) {
    report(payload.mcpTaskId, 'failed', {
      error: '资产不存在或不含图文档（task_run 仅支持宿主资产子图，如一键工作流产出的资产）'
    })
    return
  }

  openMcpWorkflowAssetEditor(payload.assetId)

  const result = taskStore.enqueueWorkflow({
    title: `${asset.name} · MCP`,
    graph: graphJson,
    target: { kind: 'asset', assetId: payload.assetId, hostId: `asset:${payload.assetId}` },
    priorNodeStates: graphJson.runStates,
    skipCompletedNodes: true,
    liveCanvasSync: true
  })

  if (!result.ok) {
    report(payload.mcpTaskId, 'failed', { error: '该图已有进行中的同目标任务' })
    return
  }

  report(payload.mcpTaskId, 'accepted', { taskId: result.id })

  // 轮询任务状态直到终态（任务数量有限，轮询开销可忽略）
  const timer = window.setInterval(() => {
    const task = taskStore.tasks.find((item) => item.id === result.id)
    if (!task) {
      window.clearInterval(timer)
      report(payload.mcpTaskId, 'finished', { taskId: result.id, status: 'stopped' })
      return
    }
    if (task.status === 'done' || task.status === 'error' || task.status === 'stopped') {
      const status = task.status
      const error = status === 'error' ? task.message || undefined : undefined
      window.clearInterval(timer)
      void (async () => {
        // 产物相对路径要等写回落盘后才齐全，收集完再回报终态
        const relativePaths = await collectFinishedTaskMediaPaths(taskStore, result.id)
        report(payload.mcpTaskId, 'finished', {
          taskId: result.id,
          status,
          error,
          ...(relativePaths.length ? { relativePaths } : {})
        })
      })()
    }
  }, 1500)
}

/** 图编辑操作批：读取落盘图 → 应用 ops → 持久化 + 同步界面 */
async function handleGraphEdit(payload: McpGraphEditPayload): Promise<void> {
  const reply = (
    ok: boolean,
    extra: { applied?: string[]; warnings?: string[]; error?: string } = {}
  ): void => {
    void window.studio?.reportMcpGraphEdit?.({ requestId: payload.requestId, ok, ...extra })
  }
  try {
    const project = useProjectStore()
    const asset = project.assets.find((item) => item.id === payload.assetId)

    // 教学录屏：先打开编辑器，保证后续改图拍进画面
    if (payload.openEditor && !isGraphEditorOpen(payload.assetId)) {
      openMcpWorkflowAssetEditor(payload.assetId)
      const opened = await waitForGraphEditorOpen(payload.assetId)
      if (!opened) {
        reply(false, { error: '无法打开图编辑器（openEditor），请确认资产可编辑' })
        return
      }
    }

    /**
     * 编辑器打开时**也能改**，但基准必须是编辑器里的**实时文档**。
     *
     * store 里那份 `graphJson` 可能落后于编辑器（用户刚拖过线 / 改过参数还没落盘）；
     * 在它上面套用 ops 再写回，就会把编辑器里那些改动抹掉 —— 那正是原先一律拒绝的原因。
     * 改用实时文档后不存在这个问题：改动叠加在编辑器当前状态之上，再由编辑器自己的落盘链路
     * 写回（`applyExternalGraph` → `commitAssetGraph` → `persistAssetRecord`）。
     *
     * 顺序上先判断「编辑器是否打开」、再取 store 副本：草稿资产的图只存在于编辑器里，
     * 先走 store 那条会误报「资产不存在或不含图文档」。
     */
    const editOptions =
      payload.autoLayout === true
        ? { autoLayout: true as const }
        : payload.autoLayout === false
          ? { autoLayout: false as const }
          : undefined

    if (isGraphEditorOpen(payload.assetId)) {
      const hostId = `asset:${payload.assetId}`
      const live = graphEditorHosts.getLiveAssetDocument(payload.assetId)
      if (!live) {
        reply(false, { error: '编辑器已打开但暂时取不到实时图，请稍后重试' })
        return
      }
      const liveResult = applyGraphEditOps(live, payload.ops, editOptions)
      if (!liveResult.applied.length && liveResult.warnings.length) {
        reply(false, { applied: [], warnings: liveResult.warnings, error: '全部操作未生效' })
        return
      }
      // 整图替换 + 编辑器自身落盘；自动布局后 fitView，避免节点移出视口被虚拟化卸掉
      const didAutoLayout = liveResult.applied.includes('自动布局')
      const onlySelect =
        liveResult.selectNodeIds?.length &&
        liveResult.applied.every((item) => item === '自动布局' || item.startsWith('选中节点'))
      if (!onlySelect) {
        graphEditorHosts.applyExternalGraph(
          hostId,
          liveResult.graph,
          didAutoLayout ? { fitView: true } : undefined
        )
      }
      // 教学录屏：选中必须落到画布高亮（toolbar 运行按钮依赖选中态）
      const selectId = liveResult.selectNodeIds?.at(-1)
      if (selectId) graphEditorHosts.selectNode(hostId, selectId)
      await graphEditorHosts.flush(hostId)
      reply(true, { applied: liveResult.applied, warnings: liveResult.warnings })
      return
    }

    const graphJson = (asset?.genParams as Record<string, unknown> | undefined)?.graphJson as
      GraphDocument | undefined
    if (!asset || !graphJson || !Array.isArray(graphJson.nodes)) {
      reply(false, { error: '资产不存在或不含图文档（graph_edit 仅支持宿主资产子图）' })
      return
    }
    const result = applyGraphEditOps(graphJson, payload.ops, editOptions)
    if (!result.applied.length && result.warnings.length) {
      reply(false, { applied: [], warnings: result.warnings, error: '全部操作未生效' })
      return
    }
    const updated = await persistAssetRecord(payload.assetId, {
      genParams: { ...(asset.genParams as Record<string, unknown>), graphJson: result.graph }
    })
    if (!updated) {
      reply(false, { error: '持久化失败：资产不存在' })
      return
    }
    reply(true, { applied: result.applied, warnings: result.warnings })
  } catch (err) {
    reply(false, { error: err instanceof Error ? err.message : String(err) })
  }
}

/** 重跑打包节点的等待上限（精修本身已耗时，这里给打包重跑留足） */
const ICON_REFINE_REPACK_TIMEOUT_MS = 6 * 60 * 1000

/** 等待任务进入终态；超时按 timeout 回报（任务仍在跑，不中断） */
function waitForTaskEnd(
  taskStore: ReturnType<typeof useGraphTaskStore>,
  taskId: string,
  timeoutMs: number
): Promise<'done' | 'error' | 'stopped' | 'timeout'> {
  return new Promise((resolve) => {
    const startedAt = Date.now()
    const timer = window.setInterval(() => {
      const task = taskStore.tasks.find((item) => item.id === taskId)
      if (!task) {
        window.clearInterval(timer)
        resolve('stopped')
        return
      }
      if (task.status === 'done' || task.status === 'error' || task.status === 'stopped') {
        window.clearInterval(timer)
        resolve(task.status)
        return
      }
      if (Date.now() - startedAt > timeoutMs) {
        window.clearInterval(timer)
        resolve('timeout')
      }
    }, 1500)
  })
}

/** 精修失败原因码 → 给外部 Agent 的提示（与弹窗文案各自维护措辞） */
const ICON_REFINE_FAILURE_TEXT: Record<string, string> = {
  unresolved:
    '未定位到该切分节点与格位：splitNodeId 需为 image.gridSplit 节点、cellKey 形如 1-1（graph_read 可核对）',
  'no-pack': '未找到与本格同源打包节点：需图标包节点与整版图同源连接后才能回炉写回',
  'no-source': '未解析到整版源图：请先运行整版图片节点生成 / 落盘整版图再精修',
  'no-result': '生图未返回本地图片'
}

function iconRefineErrorText(err: unknown): string {
  if (err instanceof IconRefineError) return ICON_REFINE_FAILURE_TEXT[err.code] ?? err.code
  return err instanceof Error ? err.message : String(err)
}

/**
 * 单枚图标精修回炉：重画某一格 → 写回同源 iconPack 的逐枚覆盖 → 重跑打包节点。
 * 执行口径与 dive 弹窗「精修回炉」按钮完全一致（同一个 runIconRefine）。
 */
async function handleGraphIconRefine(payload: McpGraphIconRefinePayload): Promise<void> {
  const reply = (
    ok: boolean,
    extra: {
      cellKey?: string
      name?: string
      packNodeId?: string
      prompt?: string
      repacked?: boolean
      warning?: string
      error?: string
    } = {}
  ): void => {
    void window.studio?.reportMcpGraphIconRefine?.({ requestId: payload.requestId, ok, ...extra })
  }
  try {
    const project = useProjectStore()
    const asset = project.assets.find((item) => item.id === payload.assetId)
    const graphJson = (asset?.genParams as Record<string, unknown> | undefined)?.graphJson as
      GraphDocument | undefined
    if (!asset || !graphJson || !Array.isArray(graphJson.nodes)) {
      reply(false, { error: '资产不存在或不含图文档（graph_icon_refine 仅支持宿主资产子图）' })
      return
    }
    if (isGraphEditorOpen(payload.assetId)) {
      reply(false, {
        error: '该资产的图编辑器正在界面中打开，为避免互相覆盖请先关闭编辑器再远程精修'
      })
      return
    }

    const result = await runIconRefine({
      document: graphJson,
      splitNodeId: payload.splitNodeId,
      cellKey: payload.cellKey,
      hint: payload.hint,
      prompt: payload.prompt,
      locale: payload.locale === 'en' ? 'en' : 'zh',
      assets: project.assets
    })

    const updated = await persistAssetRecord(payload.assetId, {
      genParams: { ...(asset.genParams as Record<string, unknown>), graphJson: result.document }
    })
    if (!updated) {
      reply(false, { error: '持久化失败：资产不存在' })
      return
    }

    const done = {
      cellKey: result.cellKey,
      name: result.name ?? undefined,
      packNodeId: result.packNodeId,
      prompt: result.prompt
    }
    if (payload.repack === false) {
      reply(true, {
        ...done,
        repacked: false,
        warning: '已写入精修结果，按请求未重跑打包节点（repack=false）'
      })
      return
    }

    openMcpWorkflowAssetEditor(payload.assetId)

    const taskStore = useGraphTaskStore()
    const enqueued = taskStore.enqueueWorkflow({
      title: `${asset.name} · MCP 精修回炉`,
      graph: result.document,
      target: { kind: 'asset', assetId: payload.assetId, hostId: `asset:${payload.assetId}` },
      priorNodeStates: result.document.runStates,
      skipCompletedNodes: true,
      liveCanvasSync: true,
      // 该节点旧 done 结果已失效（本格精修图要顶替成图），不得复用
      invalidatedNodeIds: [result.packNodeId]
    })
    if (!enqueued.ok) {
      reply(true, {
        ...done,
        repacked: false,
        warning: '该资产已有进行中的同目标工作流，精修结果已写入，稍后自行重跑打包即可生效'
      })
      return
    }

    const status = await waitForTaskEnd(taskStore, enqueued.id, ICON_REFINE_REPACK_TIMEOUT_MS)
    reply(true, {
      ...done,
      repacked: status === 'done',
      ...(status === 'done'
        ? {}
        : {
            warning: `精修结果已写入，重跑打包未在本轮完成（${status}），可在应用任务列表查看进度`
          })
    })
  } catch (err) {
    reply(false, { error: iconRefineErrorText(err) })
  }
}

let registered = false

export function registerMcpTaskRunner(): void {
  if (registered) return
  registered = true
  if (typeof window.studio?.onMcpWorkflowFocus === 'function') {
    window.studio.onMcpWorkflowFocus((payload) => {
      const assetId = payload.assetId?.trim()
      if (assetId) openMcpWorkflowAssetEditor(assetId)
    })
  }
  if (typeof window.studio?.onMcpTaskRun !== 'function') return
  window.studio.onMcpTaskRun((payload) => {
    void handleTaskRun(payload)
  })
  if (typeof window.studio?.onMcpGraphEdit === 'function') {
    window.studio.onMcpGraphEdit((payload) => {
      void handleGraphEdit(payload)
    })
  }
  if (typeof window.studio?.onMcpGraphIconRefine === 'function') {
    window.studio.onMcpGraphIconRefine((payload) => {
      void handleGraphIconRefine(payload)
    })
  }
}
