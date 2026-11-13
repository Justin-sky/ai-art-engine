import { app, dialog, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, resolve as resolvePath } from 'node:path'
import { Agent, type AgentEvent, type AgentMessage } from '@earendil-works/pi-agent-core'
import type { ImageContent } from '@earendil-works/pi-ai'
import { parseClaudeSkillMarkdown, parseGitHubSkillSourceUrl } from '@shared/claudeSkill'
import type { ApprovalAnswer, ApprovalRequestView } from '@shared/dshApproval'
import {
  IpcChannels,
  type AskUserAnswer,
  type AskUserQuestion,
  type ChatMode,
  type ControlHarnessGoalInput,
  type DeleteHarnessScheduleInput,
  type DshSkillsFile,
  type DshSkillsInfo,
  type DshSkillsTemplateResult,
  type ExportHarnessSessionInput,
  type ExportHarnessSessionResult,
  type HarnessCanvasEventInput,
  type HarnessCanvasEventResult,
  type HarnessCanvasEventView,
  type HarnessEvent,
  type HarnessEventCore,
  type HarnessFileViewerKind,
  type HarnessGoalView,
  type HarnessJobWaitInput,
  type HarnessJobWaitResult,
  type HarnessPresentFile,
  type HarnessRunInput,
  type HarnessRunResult,
  type HarnessSandboxMode,
  type HarnessScheduleView,
  type HarnessStatus,
  type HarnessSubagentView,
  type HarnessTodoItem,
  type OpenHarnessFileInput,
  type OpenHarnessFileResult,
  type RewindHarnessSessionInput,
  type RewindHarnessSessionResult,
  type SearchHarnessSessionsInput,
  type SearchHarnessSessionsResult,
  type SessionSkill,
  type SetHarnessSandboxModeInput,
  type SteerHarnessTurnInput,
  type SteerHarnessTurnResult
} from '@shared/ipc'
import { normalizeChatMode } from '@shared/mcpModeAccess'
import { stripMcpToolPrefix, summarizeMcpToolOperation } from '@shared/mcpToolOperationSummary'
import { sniffImageMimeFromBytes } from '@shared/media/imageMimeSniff'
import { PROJECT_MEMORY_INJECT_LIMIT, PROJECT_MEMORY_RELATIVE_PATH } from '@shared/projectMemory'
import { broadcastToAllWindows } from '../broadcast'
import {
  buildStudioNodeCapabilitiesBridge,
  cleanupLegacyDshSkills,
  discoverInstalledClaudeSkills,
  preprocessSkillInvocation,
  runSkillLifecycleHooks,
  type ActiveSkillTurnContext
} from '../services/claudeSkillRuntime'
import { dshHome, dshSkillsDir } from '../services/dshPaths'
import {
  installGitHubSkills,
  listInstalledGitHubSkillRecords,
  searchOnlineSkills
} from '../services/githubSkillInstaller'
import {
  abortActiveMcpCanvasRuns,
  callInProcessMcpTool,
  clearActiveHarnessRun,
  clearWorkerSlotActiveHarnessRun,
  confirmHarnessRunAccess,
  getMcpServerInfo,
  listConfiguredExternalMcpServers,
  listInProcessExternalMcpTools,
  listInProcessStudioAndBlenderTools,
  registerHarnessRunAccess,
  releaseHarnessRunAccess,
  setActiveHarnessRun,
  setCanvasTaskSettledHook,
  setHarnessScheduleHandlers,
  setMcpToolSettledHook,
  setWorkerSlotActiveHarnessRun,
  syncActiveCanvasFromWorkspaceContext
} from '../services/mcpServerService'
import { projectService } from '../services/projectService'
import { settingsService } from '../services/settingsService'
import { extractWebArticleWithHeadlessBrowser } from '../services/webArticleExtractService'
import { McpLazyToolsetManager, type LazyMcpBackend } from './mcpLazyToolsets'
import {
  PiApprovalBroker,
  PiAskUserBroker,
  PiTurnGovernance,
  isPathInsideRoot,
  normalizeSandboxMode
} from './piGovernance'
import {
  enforceOpenAiToolsLimitPayload,
  isPiQuotaError,
  piMultiApiStreamFn,
  prepareLooseToolArguments,
  resolvePiModelFromProviders,
  type RuntimeAgentTool
} from './piModelResolver'
import {
  STUDIO_DOMAIN_SUBAGENTS,
  buildPiSystemPrompt,
  listStudioDomainSubagents
} from './piPersona'
import {
  buildPiSessionExportZip,
  deletePiSession,
  loadPiSession,
  rewindPiSession,
  savePiSession,
  searchPiSessions,
  stripRuntimeSystemMessages
} from './piSessionStore'
import { createPiWorkspaceTools } from './piWorkspaceTools'

export { listStudioDomainSubagents }

const MAX_PARALLEL_SESSIONS = 6
const DSH_SKILLS_TEMPLATE_FILE = 'my-skill.example'

interface QueuedRunItem {
  input: HarnessRunInput
  waiter?: {
    resolve: (res: HarnessJobWaitResult) => void
    timeoutTimer?: ReturnType<typeof setTimeout>
  }
}

interface ActiveSubagentRuntime {
  view: HarnessSubagentView
  agent: Agent
}

interface SessionRunnerState {
  sessionId: string
  slotId: string
  running: boolean
  runId: string
  mode: ChatMode
  sandboxMode: HarnessSandboxMode
  workspace: string
  agent: Agent | null
  governance: PiTurnGovernance | null
  lazyManager: McpLazyToolsetManager | null
  activeSkill: ActiveSkillTurnContext | null
  todos: HarnessTodoItem[]
  goal: HarnessGoalView | null
  subagents: Map<string, ActiveSubagentRuntime>
  queue: QueuedRunItem[]
  activeWaiter?: QueuedRunItem['waiter']
  turnSeq: number
  abortRequested: boolean
}

interface ScheduleTimerEntry {
  view: HarnessScheduleView
  sessionId?: string
  timer: ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>
  recurring: boolean
}

let runCounter = 0
let slotCounter = 0
let activeWorkspaceOverride = ''
let defaultSandboxMode: HarnessSandboxMode = 'workspace-write'

const sessionRunners = new Map<string, SessionRunnerState>()
const overflowQueue: QueuedRunItem[] = []
const activeSchedules = new Map<string, ScheduleTimerEntry>()
const latestMcpToolExecution = new Map<string, { detail: string; steps: string[]; at: number }>()

function emitHarnessEvent(
  sessionId: string | undefined,
  runId: string | undefined,
  event: HarnessEventCore
): void {
  const payload: HarnessEvent = {
    ...event,
    ...(sessionId ? { sessionId } : {}),
    ...(runId ? { runId } : {})
  }
  broadcastToAllWindows(IpcChannels.HARNESS_EVENT, payload)
}

const askUserBroker = new PiAskUserBroker({
  emitQuestion: (question: AskUserQuestion) => {
    broadcastToAllWindows(IpcChannels.MCP_ASK_USER, question)
  }
})

const approvalBroker = new PiApprovalBroker({
  emitApproval: (view: ApprovalRequestView) => {
    broadcastToAllWindows(IpcChannels.MCP_APPROVAL_REQUEST, view)
  }
})

function resolveWorkspace(preferredWorkspace?: string): string {
  if (typeof preferredWorkspace === 'string') {
    const trimmed = preferredWorkspace.trim()
    if (trimmed && existsSync(trimmed)) return trimmed
  }
  const explicit = activeWorkspaceOverride.trim()
  if (explicit && existsSync(explicit)) return explicit
  const root = projectService.getOpenProjectState()?.rootPath?.trim()
  if (root && existsSync(root)) return root
  return app.getPath('userData')
}

async function readProjectMemoryForWorkspace(workspace: string): Promise<string | null> {
  const memFile = join(workspace, PROJECT_MEMORY_RELATIVE_PATH)
  if (existsSync(memFile)) {
    try {
      const raw = readFileSync(memFile, 'utf8')
      return raw ? raw.slice(0, PROJECT_MEMORY_INJECT_LIMIT) : null
    } catch {
      return null
    }
  }
  if (projectService.isOpen()) {
    try {
      const raw = await projectService.readProjectFile(PROJECT_MEMORY_RELATIVE_PATH)
      return raw ? raw.slice(0, PROJECT_MEMORY_INJECT_LIMIT) : null
    } catch {
      return null
    }
  }
  return null
}

function createInProcessLazyBackend(): LazyMcpBackend {
  return {
    listStudioAndBlenderTools: () => listInProcessStudioAndBlenderTools(),
    listExternalServers: () =>
      listConfiguredExternalMcpServers().map((s) => ({ id: s.id, name: s.name })),
    listExternalTools: (serverId) => listInProcessExternalMcpTools(serverId),
    callMcpTool: (name, args, ctx) => callInProcessMcpTool(name, args, ctx)
  }
}

const PROMPT_IMAGE_EXTS: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
}

function extractPromptReferencedImages(
  taskText: string,
  workspaceRoot: string,
  supportsImages: boolean
): ImageContent[] {
  if (!supportsImages) return []
  const matches = taskText.match(/@([^\s"'`<>|*?]+\.(?:png|jpe?g|webp|gif))/gi) ?? []
  const uniquePaths = Array.from(new Set(matches.map((m) => m.slice(1))))
  const images: ImageContent[] = []

  for (const rawRel of uniquePaths.slice(0, 8)) {
    const abs = isAbsolute(rawRel) ? resolvePath(rawRel) : resolvePath(workspaceRoot, rawRel)
    if (!existsSync(abs)) continue
    try {
      const st = statSync(abs)
      if (!st.isFile() || st.size > 12 * 1024 * 1024) continue
      const bytes = readFileSync(abs)
      const ext = extname(abs).toLowerCase()
      const mimeType = sniffImageMimeFromBytes(bytes) ?? PROMPT_IMAGE_EXTS[ext] ?? 'image/png'
      images.push({
        type: 'image',
        data: bytes.toString('base64'),
        mimeType
      })
    } catch {
      /* ignore unreadable reference */
    }
  }
  return images
}

function getOrCreateRunner(sessionId: string): SessionRunnerState {
  const key = sessionId || '__default__'
  let runner = sessionRunners.get(key)
  if (!runner) {
    runner = {
      sessionId: key,
      slotId: `pi-slot-${++slotCounter}`,
      running: false,
      runId: '',
      mode: 'craft',
      sandboxMode: defaultSandboxMode,
      workspace: resolveWorkspace(),
      agent: null,
      governance: null,
      lazyManager: null,
      activeSkill: null,
      todos: [],
      goal: null,
      subagents: new Map(),
      queue: [],
      turnSeq: 0,
      abortRequested: false
    }
    sessionRunners.set(key, runner)
  }
  return runner
}

function countRunningSessions(): number {
  let count = 0
  for (const runner of sessionRunners.values()) {
    if (runner.running) count += 1
  }
  return count
}

function syncGlobalActiveHarnessRun(): void {
  for (const runner of sessionRunners.values()) {
    if (runner.running && runner.runId) {
      setActiveHarnessRun(
        runner.runId,
        runner.mode,
        runner.sessionId === '__default__' ? undefined : runner.sessionId
      )
      return
    }
  }
  clearActiveHarnessRun()
}

async function preprocessOnlineSkillAndArticleIntent(opts: {
  taskText: string
  mode: ChatMode
  workspaceRoot: string
  sessionId?: string
}): Promise<string> {
  const { taskText, mode, workspaceRoot, sessionId } = opts
  if (mode === 'ask') return taskText

  const urlTokens =
    taskText
      .match(/https?:\/\/[^\s，。；！？"',)>]+/gi)
      ?.map((u) => u.replace(/[.,;:!?)'"`]+$/, '')) ?? []
  const ghCandidates = Array.from(
    new Set(urlTokens.filter((u) => Boolean(parseGitHubSkillSourceUrl(u))))
  )

  if (ghCandidates.length > 0 && mode === 'craft') {
    const installedBlocks: string[] = []
    for (const url of ghCandidates.slice(0, 2)) {
      const callId = `host-skill-install:${Date.now()}`
      emitHarnessEvent(sessionId, undefined, {
        type: 'tool',
        id: callId,
        name: 'skill_install',
        state: 'start',
        detail: `正在安装 GitHub 技能：${url}`
      })
      try {
        const res = await installGitHubSkills({ url, skillScriptsConsent: false })
        if (res.ok && res.installed.length > 0) {
          emitHarnessEvent(sessionId, undefined, {
            type: 'tool',
            id: callId,
            name: 'skill_install',
            state: 'done',
            detail: `已安装技能：${res.installed.map((n) => `/${n}`).join('、')}`
          })
          const allSkills = discoverInstalledClaudeSkills({
            personalSkillsDir: dshSkillsDir(),
            workspaceRoot
          })
          for (const name of res.installed) {
            const entry = allSkills.find((s) => s.name === name)
            if (entry) {
              installedBlocks.push(
                [
                  `Installed Skill: /${entry.name} (${url})`,
                  `Skill Directory: ${entry.dirPath}`,
                  `<skill name="${entry.name}" dir="${entry.dirPath}">`,
                  entry.body,
                  '</skill>'
                ].join('\n')
              )
            }
          }
        } else {
          emitHarnessEvent(sessionId, undefined, {
            type: 'tool',
            id: callId,
            name: 'skill_install',
            state: 'done',
            detail: res.error ?? '未发现可安装的 SKILL.md'
          })
        }
      } catch (err) {
        emitHarnessEvent(sessionId, undefined, {
          type: 'tool',
          id: callId,
          name: 'skill_install',
          state: 'done',
          detail: err instanceof Error ? err.message : String(err)
        })
      }
    }

    if (installedBlocks.length > 0) {
      return [
        taskText,
        '',
        '[Studio Host Pre-Installed GitHub Skill(s)]',
        ...installedBlocks,
        '',
        buildStudioNodeCapabilitiesBridge()
      ].join('\n')
    }
  }

  const asksOnlineSkillSearch =
    ghCandidates.length === 0 &&
    /(?:技能|skill|skills)/i.test(taskText) &&
    /(?:搜索|搜一下|搜|上网|联网|在线|查找|安装|install|导入|添加|search|github)/i.test(taskText)

  if (asksOnlineSkillSearch) {
    const searchCallId = `host-skill-search:${Date.now()}`
    emitHarnessEvent(sessionId, undefined, {
      type: 'tool',
      id: searchCallId,
      name: 'skill_search',
      state: 'start',
      detail: '正在联网检索匹配的技能…'
    })
    try {
      const searchRes = await searchOnlineSkills({ query: taskText, limit: 8 })
      emitHarnessEvent(sessionId, undefined, {
        type: 'tool',
        id: searchCallId,
        name: 'skill_search',
        state: 'done',
        detail: `找到 ${searchRes.items.length} 个候选技能`
      })
      if (searchRes.items.length > 0) {
        const list = searchRes.items
          .map(
            (item, idx) =>
              `${idx + 1}. /${item.name} — ${item.title}: ${item.description} (url: ${item.url ?? 'N/A'}, installed: ${item.installed})`
          )
          .join('\n')
        return `${taskText}\n\n[Online Skill Search Results]\n${list}`
      }
    } catch {
      emitHarnessEvent(sessionId, undefined, {
        type: 'tool',
        id: searchCallId,
        name: 'skill_search',
        state: 'done',
        detail: '在线技能检索完成'
      })
    }
  }

  const articleUrls = Array.from(
    new Set(
      urlTokens.filter(
        (u) =>
          !ghCandidates.includes(u) &&
          !/^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)/i.test(u) &&
          !/^https?:\/\/(?:[\w.-]+\.)?(?:bilibili\.com\/video\/|b23\.tv\/)/i.test(u) &&
          !/\.(?:png|jpe?g|webp|gif|mp4|webm|mp3|wav|glb|gltf|zip)(?:$|[?#])/i.test(u)
      )
    )
  )
  const asksArticleExtract =
    articleUrls.length > 0 &&
    mode === 'craft' &&
    /(?:视频|短视频|成片|解说|科普|分镜|动画|教程|文章|网页|链接|内容|总结|生成|制作|转成|做成|video|short|article|explainer)/i.test(
      taskText
    )

  if (asksArticleExtract) {
    const targetUrl = articleUrls[0]!
    const extractCallId = `host-web-extract:${Date.now()}`
    emitHarnessEvent(sessionId, undefined, {
      type: 'tool',
      id: extractCallId,
      name: 'web_extract_article',
      state: 'start',
      detail: `正在启动本地无头浏览器抓取图文：${targetUrl}`
    })
    try {
      const extracted = await extractWebArticleWithHeadlessBrowser({
        url: targetUrl,
        maxImages: 8,
        projectRootOverride: workspaceRoot
      })
      emitHarnessEvent(sessionId, undefined, {
        type: 'tool',
        id: extractCallId,
        name: 'web_extract_article',
        state: 'done',
        detail: `已提取《${extracted.title}》正文及 ${extracted.images.length} 张文章配图`
      })
      const imagesManifest =
        extracted.images.length > 0
          ? extracted.images
              .map(
                (img) =>
                  `- 图${img.index}: relativePath="${img.relativePath}" | 章节="${img.sectionHeading}" | 图注="${img.caption || img.alt || '无'}"`
              )
              .join('\n')
          : '（无独立内容配图）'
      return [
        taskText,
        '',
        '[Studio Host Pre-Extracted Web Article]',
        `Title: ${extracted.title}`,
        `Source URL: ${extracted.url}`,
        'Downloaded Article Figures in Cache/imports/:',
        imagesManifest,
        '',
        'Extracted Article Markdown:',
        extracted.markdown
      ].join('\n')
    } catch (err) {
      emitHarnessEvent(sessionId, undefined, {
        type: 'tool',
        id: extractCallId,
        name: 'web_extract_article',
        state: 'done',
        detail: `网页提取提示：${err instanceof Error ? err.message : String(err)}`
      })
    }
  }

  return taskText
}

function buildNativeCoordinationTools(opts: {
  runner: SessionRunnerState
  publicSessionId?: string
  resolvedModel: NonNullable<ReturnType<typeof resolvePiModelFromProviders>>
  projectMemory: string | null
  interactive: boolean
}): RuntimeAgentTool[] {
  const { runner, publicSessionId, resolvedModel, projectMemory, interactive } = opts

  const todoWriteTool: RuntimeAgentTool = {
    name: 'todo_write',
    label: '更新待办看板 (Todo Board)',
    description:
      'Create or update the structured task checklist shown live in the chat panel for multi-step production tasks.',
    parameters: {
      type: 'object',
      properties: {
        todos: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              content: { type: 'string' },
              status: {
                type: 'string',
                enum: ['pending', 'in_progress', 'completed', 'cancelled']
              },
              priority: {
                type: 'string',
                enum: ['high', 'medium', 'low']
              }
            },
            required: ['content', 'status']
          }
        }
      },
      required: ['todos']
    },
    prepareArguments: (raw) => prepareLooseToolArguments(raw),
    execute: async (_callId, params: Record<string, unknown>) => {
      const rawTodos = Array.isArray(params.todos) ? params.todos : []
      const normalized: HarnessTodoItem[] = []
      for (let idx = 0; idx < rawTodos.length; idx += 1) {
        const item = rawTodos[idx]
        if (!item || typeof item !== 'object') continue
        const rec = item as Record<string, unknown>
        const content = String(rec.content ?? '').trim()
        if (!content) continue
        const status: HarnessTodoItem['status'] =
          rec.status === 'in_progress' || rec.status === 'completed' || rec.status === 'cancelled'
            ? rec.status
            : 'pending'
        const priority: HarnessTodoItem['priority'] =
          rec.priority === 'high' || rec.priority === 'medium' || rec.priority === 'low'
            ? rec.priority
            : undefined
        normalized.push({
          id: typeof rec.id === 'string' && rec.id ? rec.id : `todo-${idx + 1}`,
          content,
          status,
          ...(priority ? { priority } : {})
        })
      }

      runner.todos = normalized
      emitHarnessEvent(publicSessionId, runner.runId, { type: 'todo', todos: normalized })
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: true, count: normalized.length }) }],
        details: { todos: normalized }
      }
    }
  }

  const presentFilesTool: RuntimeAgentTool = {
    name: 'present_files',
    label: '交付产物卡片 (Present Deliverables)',
    description:
      'Present generated or exported deliverable files (images, videos, audio, documents, archives, HTML builds) as interactive cards in the chat panel.',
    parameters: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Workspace-relative or absolute file path.' },
              title: { type: 'string' },
              description: { type: 'string' }
            },
            required: ['path']
          }
        }
      },
      required: ['files']
    },
    prepareArguments: (raw) => prepareLooseToolArguments(raw),
    execute: async (callId, params: Record<string, unknown>) => {
      const rawFiles = Array.isArray(params.files) ? params.files : []
      const files: HarnessPresentFile[] = []
      for (const item of rawFiles) {
        if (!item || typeof item !== 'object') continue
        const rec = item as Record<string, unknown>
        const rawPath = String(rec.path ?? '').trim()
        if (!rawPath) continue
        const abs = isAbsolute(rawPath)
          ? resolvePath(rawPath)
          : resolvePath(runner.workspace, rawPath)
        files.push({
          path: abs,
          title: typeof rec.title === 'string' && rec.title ? rec.title : basename(abs),
          ...(typeof rec.description === 'string' && rec.description
            ? { description: rec.description }
            : {})
        })
      }

      if (files.length > 0) {
        emitHarnessEvent(publicSessionId, runner.runId, {
          type: 'present',
          callId,
          turn: runner.turnSeq,
          files
        })
      }
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: true, presented: files.length }) }],
        details: { files }
      }
    }
  }

  const goalManageTool: RuntimeAgentTool = {
    name: 'goal_manage',
    label: '多轮目标管理 (Autonomous Goal)',
    description:
      'Start, update, pause, or complete a multi-round autonomous objective. Active goals automatically continue across turns until marked complete or maxRounds is reached.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['start', 'update', 'pause', 'resume', 'complete', 'clear']
        },
        objective: { type: 'string' },
        summary: { type: 'string' },
        maxRounds: { type: 'integer' }
      },
      required: ['action']
    },
    prepareArguments: (raw) => prepareLooseToolArguments(raw),
    execute: async (_callId, params: Record<string, unknown>) => {
      const action = String(params.action ?? 'update')
      const maxRounds = Math.min(24, Math.max(1, Math.trunc(Number(params.maxRounds ?? 8) || 8)))

      if (action === 'clear') {
        runner.goal = null
      } else if (action === 'start') {
        const objective = String(params.objective ?? '').trim() || '自主目标执行'
        runner.goal = {
          id: `goal-${Date.now()}`,
          objective,
          phase: 'active',
          activation: 'armed',
          round: 1,
          maxRounds,
          ...(typeof params.summary === 'string' ? { summary: params.summary } : {})
        }
      } else if (runner.goal) {
        if (action === 'pause') {
          runner.goal = { ...runner.goal, phase: 'paused', activation: 'paused' }
        } else if (action === 'resume') {
          runner.goal = { ...runner.goal, phase: 'active', activation: 'armed' }
        } else if (action === 'complete') {
          runner.goal = {
            ...runner.goal,
            phase: 'completed',
            activation: 'disarmed',
            ...(typeof params.summary === 'string' ? { summary: params.summary } : {})
          }
        } else {
          runner.goal = {
            ...runner.goal,
            ...(typeof params.objective === 'string' && params.objective
              ? { objective: params.objective }
              : {}),
            ...(typeof params.summary === 'string' ? { summary: params.summary } : {})
          }
        }
      }

      emitHarnessEvent(publicSessionId, runner.runId, { type: 'goal', goal: runner.goal })
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: true, goal: runner.goal }) }],
        details: { goal: runner.goal }
      }
    }
  }

  const scheduleManageTool: RuntimeAgentTool = {
    name: 'schedule_manage',
    label: '会话定时任务 (Schedule)',
    description:
      'Create, list, or delete delayed or recurring session reminders/tasks within AIArtEngine.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'list', 'delete']
        },
        prompt: {
          type: 'string',
          description: 'Follow-up prompt to execute when the schedule fires (for action="create").'
        },
        afterSeconds: {
          type: 'integer',
          description: 'One-shot delay in seconds.'
        },
        everySeconds: {
          type: 'integer',
          description: 'Recurring interval in seconds (minimum 30s).'
        },
        scheduleId: {
          type: 'string',
          description: 'Target schedule ID for action="delete".'
        }
      },
      required: ['action']
    },
    prepareArguments: (raw) => prepareLooseToolArguments(raw),
    execute: async (_callId, params: Record<string, unknown>) => {
      const action = String(params.action ?? 'list')
      if (action === 'delete' && typeof params.scheduleId === 'string') {
        await deleteHarnessSchedule({
          sessionId: publicSessionId,
          scheduleId: params.scheduleId
        })
      } else if (action === 'create') {
        const prompt = String(params.prompt ?? '').trim()
        if (!prompt) {
          return {
            content: [{ type: 'text', text: '创建定时任务必须提供非空 prompt' }],
            details: null,
            isError: true
          }
        }
        const everySec = Number(params.everySeconds ?? 0)
        const afterSec = Number(params.afterSeconds ?? 60)
        const id = `sched-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
        const recurring = Number.isFinite(everySec) && everySec >= 30
        const delaySec = recurring
          ? Math.trunc(everySec)
          : Math.max(5, Math.trunc(Number.isFinite(afterSec) ? afterSec : 60))
        const nextIso = new Date(Date.now() + delaySec * 1000).toISOString()

        const view: HarnessScheduleView = {
          id,
          prompt,
          scheduledAt: nextIso,
          nextRunAt: nextIso,
          state: 'scheduled',
          status: 'active',
          kind: recurring ? 'every' : 'after',
          ...(recurring ? { everySeconds: delaySec } : { afterSeconds: delaySec }),
          summary: prompt.slice(0, 80)
        }

        const fire = (): void => {
          if (!recurring) {
            activeSchedules.delete(id)
            broadcastSchedules(publicSessionId, runner.runId)
          } else {
            const entry = activeSchedules.get(id)
            if (entry) {
              const updatedNext = new Date(Date.now() + delaySec * 1000).toISOString()
              entry.view.nextRunAt = updatedNext
              entry.view.scheduledAt = updatedNext
              broadcastSchedules(publicSessionId, runner.runId)
            }
          }
          void runHarnessTask({
            task: `[Scheduled Task Triggered]\n${prompt}`,
            sessionId: publicSessionId,
            mode: 'craft',
            workspace: runner.workspace
          })
        }

        const timer = recurring
          ? setInterval(fire, delaySec * 1000)
          : setTimeout(fire, delaySec * 1000)
        activeSchedules.set(id, { view, sessionId: publicSessionId, timer, recurring })
        broadcastSchedules(publicSessionId, runner.runId)
      }

      const list = listHarnessSchedules()
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: true, schedules: list }) }],
        details: { schedules: list }
      }
    }
  }

  const spawnSubagentTool: RuntimeAgentTool = {
    name: 'spawn_subagent',
    label: '并发领域子代理 (Subagent)',
    description:
      'Spawn or continue a specialized studio subagent (`storyboard-director`, `visual-asset-artist`, `blender-3d-director`, `timeline-audio-editor`, or `general`) in its own isolated Pi Agent context.',
    parameters: {
      type: 'object',
      properties: {
        role: {
          type: 'string',
          description:
            'Domain role ID (`storyboard-director`, `visual-asset-artist`, `blender-3d-director`, `timeline-audio-editor`, or custom label).'
        },
        prompt: {
          type: 'string',
          description: 'Self-contained actionable brief for the subagent.'
        },
        subagentSessionId: {
          type: 'string',
          description:
            'Optional existing subagent sessionId to continue talking to an earlier subagent.'
        }
      },
      required: ['prompt']
    },
    prepareArguments: (raw) => prepareLooseToolArguments(raw),
    execute: async (anchorCallId, params: Record<string, unknown>, signal) => {
      const prompt = String(params.prompt ?? '').trim()
      if (!prompt) {
        return {
          content: [{ type: 'text', text: 'spawn_subagent 需要非空 prompt' }],
          details: null,
          isError: true
        }
      }

      const roleId = String(params.role ?? 'general').trim()
      const domainProfile = STUDIO_DOMAIN_SUBAGENTS.find((p) => p.id === roleId)
      const subId =
        (typeof params.subagentSessionId === 'string' && params.subagentSessionId.trim()) ||
        `sub-${roleId}-${randomUUID().slice(0, 8)}`

      let existing = runner.subagents.get(subId)
      let childText = ''

      if (!existing) {
        const subGovernance = new PiTurnGovernance({
          sessionId: publicSessionId,
          mode: 'craft',
          sandboxMode: runner.sandboxMode,
          workspaceRoot: runner.workspace,
          skillsRoot: dshSkillsDir(),
          interactive,
          askUserBroker,
          approvalBroker,
          onSandboxBlocked: (tName, detail) => {
            emitHarnessEvent(publicSessionId, runner.runId, {
              type: 'sandbox_blocked',
              toolName: tName,
              detail
            })
          }
        })

        let childAgentRef: Agent | null = null
        const subLazy = new McpLazyToolsetManager({
          backend: createInProcessLazyBackend(),
          getRequestContext: () => ({
            mode: 'craft',
            runId: runner.runId,
            sessionId: publicSessionId,
            workerSlot: runner.slotId
          }),
          getAccessView: () => ({ mode: 'craft', planConfirmed: true }),
          onToolsChanged: () => {
            if (childAgentRef) {
              childAgentRef.state.tools = subLazy.buildActiveTools()
            }
          }
        })

        const subWorkspaceTools = createPiWorkspaceTools({
          getWorkspaceRoot: () => runner.workspace
        })
        const subLoadTool = subLazy.createLoadToolsetTool()
        subLazy.setNativeToolsProvider(() => [...subWorkspaceTools, subLoadTool])
        await subLazy.prewarmForPrompt(`${roleId} ${prompt}`)

        const subSystemPrompt = [
          buildPiSystemPrompt({
            mode: 'craft',
            sandboxMode: runner.sandboxMode,
            workspaceRoot: runner.workspace,
            projectMemory,
            toolsetDirectory: subLazy.getDirectorySummaries()
          }),
          ...(domainProfile
            ? ['', `# Active Subagent Role: ${domainProfile.title}`, ...domainProfile.instructions]
            : [])
        ].join('\n')

        const view: HarnessSubagentView = {
          sessionId: subId,
          parentSessionId: publicSessionId,
          anchorCallId,
          label: domainProfile?.title ?? roleId,
          role: roleId,
          agentType: roleId,
          description: prompt.slice(0, 120),
          status: 'running',
          toolCount: 0,
          updatedAt: Date.now()
        }

        const childAgent = new Agent({
          initialState: {
            systemPrompt: subSystemPrompt,
            model: resolvedModel.model,
            tools: subLazy.buildActiveTools()
          },
          streamFn: piMultiApiStreamFn,
          getApiKey: () => resolvedModel.apiKey,
          onPayload: (payload) => enforceOpenAiToolsLimitPayload(payload),
          beforeToolCall: (ctx, sig) => subGovernance.beforeToolCall(ctx, sig),
          prepareNextTurnWithContext: (turn) => ({
            context: {
              messages: turn.context.messages,
              tools: subLazy.buildActiveTools()
            }
          })
        })
        childAgentRef = childAgent

        childAgent.subscribe((ev) => {
          if (ev.type === 'message_update' && ev.assistantMessageEvent.type === 'text_delta') {
            childText += ev.assistantMessageEvent.delta
          } else if (ev.type === 'tool_execution_start') {
            view.toolCount += 1
            view.activeTool = ev.toolName
            view.updatedAt = Date.now()
            emitSubagentTree(runner, publicSessionId)
            emitHarnessEvent(publicSessionId, runner.runId, {
              type: 'tool',
              id: ev.toolCallId,
              parentId: anchorCallId,
              name: ev.toolName,
              state: 'start',
              args: JSON.stringify(ev.args ?? {})
            })
          } else if (ev.type === 'tool_execution_end') {
            view.activeTool = undefined
            view.updatedAt = Date.now()
            emitSubagentTree(runner, publicSessionId)
            emitHarnessEvent(publicSessionId, runner.runId, {
              type: 'tool',
              id: ev.toolCallId,
              parentId: anchorCallId,
              name: ev.toolName,
              state: ev.isError ? 'error' : 'done'
            })
          }
        })

        existing = { view, agent: childAgent }
        runner.subagents.set(subId, existing)
      } else {
        existing.view.status = 'running'
        existing.view.anchorCallId = anchorCallId
        existing.view.updatedAt = Date.now()
      }

      emitSubagentTree(runner, publicSessionId)
      const onParentAbort = (): void => existing?.agent.abort()
      if (signal) signal.addEventListener('abort', onParentAbort, { once: true })

      try {
        await existing.agent.prompt(prompt)
        existing.view.status = existing.agent.state.errorMessage ? 'error' : 'completed'
        existing.view.updatedAt = Date.now()
        emitSubagentTree(runner, publicSessionId)

        if (existing.agent.state.errorMessage) {
          return {
            content: [
              { type: 'text', text: `子代理执行出错：${existing.agent.state.errorMessage}` }
            ],
            details: { subagentSessionId: subId },
            isError: true
          }
        }

        const lastAssistant = [...existing.agent.state.messages]
          .reverse()
          .find((m) => m.role === 'assistant')
        const summaryText =
          childText.trim() ||
          (lastAssistant && lastAssistant.role === 'assistant'
            ? lastAssistant.content
                .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
                .map((b) => b.text)
                .join('\n')
            : '') ||
          '子代理已完成任务。'

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                subagentSessionId: subId,
                role: roleId,
                result: summaryText
              })
            }
          ],
          details: { subagentSessionId: subId, role: roleId }
        }
      } finally {
        if (signal) signal.removeEventListener('abort', onParentAbort)
      }
    }
  }

  return [todoWriteTool, presentFilesTool, goalManageTool, scheduleManageTool, spawnSubagentTool]
}

function emitSubagentTree(runner: SessionRunnerState, publicSessionId?: string): void {
  const views = Array.from(runner.subagents.values()).map((s) => ({ ...s.view }))
  emitHarnessEvent(publicSessionId, runner.runId, {
    type: 'subagent',
    subagents: views
  })
}

function broadcastSchedules(sessionId?: string, runId?: string): void {
  emitHarnessEvent(sessionId, runId, {
    type: 'schedule',
    schedules: listHarnessSchedules()
  })
}

async function executeRunOnRunner(runner: SessionRunnerState, item: QueuedRunItem): Promise<void> {
  const { input, waiter } = item
  const rawTask = String(input.task ?? '').trim()
  const publicSessionId = input.sessionId?.trim() || undefined
  const runId = String(++runCounter)

  runner.running = true
  runner.runId = runId
  runner.abortRequested = false
  runner.activeWaiter = waiter
  runner.turnSeq = 0

  if (typeof input.workspace === 'string') {
    const candidate = input.workspace.trim()
    activeWorkspaceOverride = candidate && existsSync(candidate) ? candidate : ''
  }
  const workspace = resolveWorkspace(input.workspace)
  runner.workspace = workspace

  const mode = normalizeChatMode(input.mode) ?? 'craft'
  const sandboxMode = input.sandboxMode
    ? normalizeSandboxMode(input.sandboxMode)
    : runner.sandboxMode
  runner.mode = mode
  runner.sandboxMode = sandboxMode

  const settleWaiter = (res: HarnessJobWaitResult): void => {
    const w = runner.activeWaiter
    runner.activeWaiter = undefined
    if (w) {
      if (w.timeoutTimer) clearTimeout(w.timeoutTimer)
      w.resolve(res)
    }
  }

  const cleanupAndPump = (): void => {
    runner.running = false
    runner.agent = null
    runner.governance = null
    runner.activeSkill = null
    clearWorkerSlotActiveHarnessRun(runner.slotId)
    releaseHarnessRunAccess(runId)
    syncGlobalActiveHarnessRun()
    abortActiveMcpCanvasRuns('会话已结束', publicSessionId, { skipDetached: true })
    pumpQueues()
  }

  // 1) 原生斜杠指令：/export
  if (/^\/export(?=$|\s)/i.test(rawTask)) {
    emitHarnessEvent(publicSessionId, runId, { type: 'tool', name: 'pi-agent', state: 'start' })
    const exportCallId = `session-export:${Date.now()}`
    emitHarnessEvent(publicSessionId, runId, {
      type: 'tool',
      id: exportCallId,
      name: 'session_export',
      state: 'start',
      detail: '正在导出当前会话日志 (.zip)…'
    })
    try {
      const res = await exportHarnessSession({ sessionId: publicSessionId || runner.sessionId })
      emitHarnessEvent(publicSessionId, runId, {
        type: 'tool',
        id: exportCallId,
        name: 'session_export',
        state: 'done',
        detail: res.ok ? `已导出到 ${res.archivePath}` : (res.error ?? '当前会话尚无记录')
      })
      const finalText =
        res.ok && res.archivePath
          ? `已导出当前会话日志：\`${res.archivePath}\``
          : `导出失败：${res.error ?? '当前会话尚无持久化记录'}`
      if (res.ok && res.archivePath) {
        emitHarnessEvent(publicSessionId, runId, {
          type: 'present',
          callId: exportCallId,
          turn: 0,
          files: [{ path: res.archivePath, title: basename(res.archivePath) }]
        })
      }
      emitHarnessEvent(publicSessionId, runId, { type: 'assistant', text: finalText })
      emitHarnessEvent(publicSessionId, runId, { type: 'tool', name: 'pi-agent', state: 'done' })
      emitHarnessEvent(publicSessionId, runId, { type: 'done', runId })
      emitHarnessEvent(publicSessionId, runId, { type: 'final', text: finalText })
      settleWaiter({ ok: res.ok, finalText, ...(res.ok ? {} : { error: finalText }) })
    } finally {
      cleanupAndPump()
    }
    return
  }

  // 2) 原生斜杠指令：/feedback
  if (/^\/feedback(?=$|\s)/i.test(rawTask)) {
    emitHarnessEvent(publicSessionId, runId, { type: 'tool', name: 'pi-agent', state: 'start' })
    const comment = rawTask.replace(/^\/feedback\s*/i, '').trim() || '(无备注)'
    const feedbackDir = join(dshHome(), 'feedback')
    mkdirSync(feedbackDir, { recursive: true })
    writeFileSync(
      join(feedbackDir, `feedback-${Date.now()}.json`),
      JSON.stringify(
        {
          sessionId: publicSessionId,
          workspace,
          comment,
          createdAt: new Date().toISOString()
        },
        null,
        2
      ),
      'utf8'
    )
    const ack = '已记录您对本次会话的反馈，感谢支持！'
    emitHarnessEvent(publicSessionId, runId, { type: 'assistant', text: ack })
    emitHarnessEvent(publicSessionId, runId, { type: 'tool', name: 'pi-agent', state: 'done' })
    emitHarnessEvent(publicSessionId, runId, { type: 'done', runId })
    emitHarnessEvent(publicSessionId, runId, { type: 'final', text: ack })
    settleWaiter({ ok: true, finalText: ack })
    cleanupAndPump()
    return
  }

  // 3) 原生斜杠指令：/compact（裁剪较早历史轮次，保留最近 6 条核心消息，释放上下文窗口）
  if (/^\/compact(?=$|\s)/i.test(rawTask)) {
    emitHarnessEvent(publicSessionId, runId, { type: 'tool', name: 'pi-agent', state: 'start' })
    const persisted = publicSessionId ? loadPiSession(dshHome(), publicSessionId) : null
    if (persisted && publicSessionId && persisted.messages.length > 6) {
      const kept = persisted.messages.slice(-6)
      savePiSession(dshHome(), {
        sessionId: publicSessionId,
        cwd: workspace,
        loadedToolsets: persisted.loadedToolsets,
        todos: persisted.todos,
        goal: persisted.goal,
        messages: kept
      })
    }
    const ack = '已压缩当前会话历史上下文，释放 Token 空间并保留近期关键上下文。'
    emitHarnessEvent(publicSessionId, runId, { type: 'assistant', text: ack })
    emitHarnessEvent(publicSessionId, runId, { type: 'tool', name: 'pi-agent', state: 'done' })
    emitHarnessEvent(publicSessionId, runId, { type: 'done', runId })
    emitHarnessEvent(publicSessionId, runId, { type: 'final', text: ack })
    settleWaiter({ ok: true, finalText: ack })
    cleanupAndPump()
    return
  }

  // 4) 原生斜杠指令：/goal status | pause | resume | end | <objective>
  let effectiveRawTask = rawTask
  if (/^\/goal(?=$|\s)/i.test(rawTask)) {
    const arg = rawTask.replace(/^\/goal\s*/i, '').trim()
    if (!arg || /^status$/i.test(arg)) {
      emitHarnessEvent(publicSessionId, runId, { type: 'tool', name: 'pi-agent', state: 'start' })
      const text = runner.goal
        ? `当前目标：${runner.goal.objective}（状态：${runner.goal.phase}，第 ${runner.goal.round ?? 1}/${runner.goal.maxRounds ?? 8} 轮）`
        : '当前会话没有运行中的自主目标。可通过 `/goal <目标内容>` 启动。'
      emitHarnessEvent(publicSessionId, runId, { type: 'assistant', text })
      emitHarnessEvent(publicSessionId, runId, { type: 'tool', name: 'pi-agent', state: 'done' })
      emitHarnessEvent(publicSessionId, runId, { type: 'done', runId })
      emitHarnessEvent(publicSessionId, runId, { type: 'final', text })
      settleWaiter({ ok: true, finalText: text })
      cleanupAndPump()
      return
    }
    if (/^(pause|resume|end|complete|clear)$/i.test(arg)) {
      await controlHarnessGoal({
        sessionId: publicSessionId,
        action: arg.toLowerCase() as ControlHarnessGoalInput['action']
      })
      const text = `已更新自主目标状态：${arg}`
      emitHarnessEvent(publicSessionId, runId, { type: 'tool', name: 'pi-agent', state: 'start' })
      emitHarnessEvent(publicSessionId, runId, { type: 'assistant', text })
      emitHarnessEvent(publicSessionId, runId, { type: 'tool', name: 'pi-agent', state: 'done' })
      emitHarnessEvent(publicSessionId, runId, { type: 'done', runId })
      emitHarnessEvent(publicSessionId, runId, { type: 'final', text })
      settleWaiter({ ok: true, finalText: text })
      cleanupAndPump()
      return
    }
    runner.goal = {
      id: `goal-${Date.now()}`,
      objective: arg,
      phase: 'active',
      activation: 'armed',
      round: 1,
      maxRounds: 8
    }
    emitHarnessEvent(publicSessionId, runId, { type: 'goal', goal: runner.goal })
    effectiveRawTask = `[Autonomous Multi-Round Goal Activated]\nObjective: ${arg}\nBreak this objective down via todo_write, execute each step thoroughly, verify outputs, and call goal_manage({ action: "complete", summary: "..." }) once every requirement is verified.`
  }

  // 5) 解析模型与供应商（支持 OpenAI / Anthropic / DeepSeek / Google / OpenRouter / 自定义中转）
  cleanupLegacyDshSkills()
  const skillPreprocessed = preprocessSkillInvocation({
    taskText: effectiveRawTask,
    sessionId: publicSessionId,
    workspaceRoot: workspace
  })
  runner.activeSkill = skillPreprocessed.activeSkill ?? null
  const persistenceSessionId = skillPreprocessed.activeSkill?.isolatedSessionId ?? publicSessionId

  const providers = settingsService.get().models?.providers ?? []
  const preferredModelId =
    skillPreprocessed.activeSkill?.modelOverride?.trim() || input.model?.trim()
  const resolvedModel = resolvePiModelFromProviders(providers, {
    providerId: input.providerId,
    modelId: preferredModelId
  })

  if (!resolvedModel) {
    const errMsg = '未配置可用文本模型或密钥，请先在「设置 → 模型接入」中启用并填写 API Key。'
    emitHarnessEvent(publicSessionId, runId, { type: 'error', message: errMsg })
    settleWaiter({ ok: false, error: errMsg })
    cleanupAndPump()
    return
  }

  registerHarnessRunAccess(runId, mode)
  setWorkerSlotActiveHarnessRun(runner.slotId, {
    runId,
    mode,
    sessionId: publicSessionId,
    workspace
  })
  syncGlobalActiveHarnessRun()

  emitHarnessEvent(publicSessionId, runId, { type: 'tool', name: 'pi-agent', state: 'start' })

  let enrichedTask = skillPreprocessed.taskText
  try {
    enrichedTask = await preprocessOnlineSkillAndArticleIntent({
      taskText: skillPreprocessed.taskText,
      mode,
      workspaceRoot: workspace,
      sessionId: publicSessionId
    })
  } catch {
    enrichedTask = skillPreprocessed.taskText
  }

  if (runner.abortRequested) {
    emitHarnessEvent(publicSessionId, runId, { type: 'tool', name: 'pi-agent', state: 'done' })
    emitHarnessEvent(publicSessionId, runId, { type: 'done', runId })
    settleWaiter({ ok: false, error: '已中止' })
    cleanupAndPump()
    return
  }

  syncActiveCanvasFromWorkspaceContext(input.canvasContext)
  const canvasCtx = String(input.canvasContext ?? '').trim()
  const finalPromptText = canvasCtx
    ? `${enrichedTask}\n\n[Workspace Canvas & Node Context]\n${canvasCtx}`
    : enrichedTask

  const persisted = persistenceSessionId ? loadPiSession(dshHome(), persistenceSessionId) : null
  if (persisted) {
    runner.todos = persisted.todos
    if (!runner.goal && persisted.goal) runner.goal = persisted.goal
  }

  const projectMemory = await readProjectMemoryForWorkspace(workspace)
  const interactive = !waiter

  let agentRef: Agent | null = null

  const governance = new PiTurnGovernance({
    sessionId: publicSessionId,
    mode,
    sandboxMode,
    workspaceRoot: workspace,
    skillsRoot: dshSkillsDir(),
    allowedSkillTools: skillPreprocessed.activeSkill?.allowedTools ?? [],
    interactive,
    askUserBroker,
    approvalBroker,
    onPlanConfirmed: () => {
      confirmHarnessRunAccess(runId)
      if (agentRef && runner.lazyManager) {
        agentRef.state.tools = runner.lazyManager.buildActiveTools()
      }
    },
    onSandboxBlocked: (toolName, detail) => {
      emitHarnessEvent(publicSessionId, runId, {
        type: 'sandbox_blocked',
        toolName,
        detail
      })
    }
  })
  runner.governance = governance

  const lazyManager = new McpLazyToolsetManager({
    backend: createInProcessLazyBackend(),
    getRequestContext: () => ({
      mode: governance.getAccessView().mode,
      runId,
      sessionId: publicSessionId,
      workerSlot: runner.slotId
    }),
    getAccessView: () => governance.getAccessView(),
    onToolsChanged: () => {
      if (agentRef) {
        agentRef.state.tools = lazyManager.buildActiveTools()
      }
    },
    initialToolsetIds: persisted?.loadedToolsets ?? []
  })
  runner.lazyManager = lazyManager

  const workspaceTools = createPiWorkspaceTools({
    getWorkspaceRoot: () => runner.workspace
  })
  const loadToolsetTool = lazyManager.createLoadToolsetTool()
  const askUserTool = governance.createAskUserTool('ask_user')
  const coordinationTools = buildNativeCoordinationTools({
    runner,
    publicSessionId,
    resolvedModel,
    projectMemory,
    interactive
  })
  const allNativeTools: RuntimeAgentTool[] = [
    ...workspaceTools,
    loadToolsetTool,
    askUserTool,
    ...coordinationTools
  ]

  lazyManager.setNativeToolsProvider(() => governance.filterNativeTools(allNativeTools))

  // 首轮零延迟意图预热（自动挂载 Blender / 时间线 / 游戏 / 网页提取 / 外部逆向工具包）
  if (mode !== 'ask') {
    await lazyManager.prewarmForPrompt(finalPromptText)
  }

  const systemPrompt = buildPiSystemPrompt({
    mode,
    sandboxMode,
    workspaceRoot: workspace,
    projectMemory,
    toolsetDirectory: lazyManager.getDirectorySummaries()
  })

  const priorMessages: AgentMessage[] = persisted?.messages
    ? stripRuntimeSystemMessages(persisted.messages)
    : []

  const agent = new Agent({
    initialState: {
      systemPrompt,
      model: resolvedModel.model,
      tools: lazyManager.buildActiveTools(),
      messages: priorMessages
    },
    sessionId: persistenceSessionId,
    streamFn: piMultiApiStreamFn,
    getApiKey: () => resolvedModel.apiKey,
    onPayload: (payload) => enforceOpenAiToolsLimitPayload(payload),
    beforeToolCall: async (ctx, sig) => {
      // Claude Skill PreToolUse Hook
      if (runner.activeSkill?.hooks) {
        runSkillLifecycleHooks(runner.activeSkill, 'PreToolUse', {
          toolName: ctx.toolCall.name,
          toolArgs: JSON.stringify(prepareLooseToolArguments(ctx.args)),
          workspaceRoot: runner.workspace
        })
      }
      return governance.beforeToolCall(ctx, sig)
    },
    prepareNextTurnWithContext: (turn) => ({
      context: {
        messages: turn.context.messages,
        tools: lazyManager.buildActiveTools()
      }
    }),
    finishTurn: (turn) => {
      runner.turnSeq += 1
      // 多轮自主目标续跑（当 goal 仍处于 active 且本轮无待执行 toolCall 时自动推进下一轮）
      if (
        runner.goal &&
        runner.goal.phase === 'active' &&
        runner.goal.activation === 'armed' &&
        turn.toolResults.length === 0
      ) {
        const currentRound = runner.goal.round ?? 1
        const maxRounds = runner.goal.maxRounds ?? 8
        if (currentRound < maxRounds) {
          runner.goal = { ...runner.goal, round: currentRound + 1 }
          emitHarnessEvent(publicSessionId, runId, { type: 'goal', goal: runner.goal })
          agent.steer({
            role: 'user',
            content: `[Autonomous Goal Round ${currentRound + 1}/${maxRounds}] Continue executing objective "${runner.goal.objective}". Verify completed deliverables; once all criteria are satisfied, call goal_manage({ action: "complete", summary: "..." }).`,
            timestamp: Date.now()
          })
          return { action: 'continue' }
        }
        runner.goal = { ...runner.goal, phase: 'ended', activation: 'disarmed' }
        emitHarnessEvent(publicSessionId, runId, { type: 'goal', goal: runner.goal })
      }
      return undefined
    }
  })
  agentRef = agent
  runner.agent = agent

  let accumulatedText = ''
  const toolArgsByCallId = new Map<string, Record<string, unknown>>()

  agent.subscribe((ev: AgentEvent) => {
    switch (ev.type) {
      case 'message_update': {
        const sub = ev.assistantMessageEvent
        if (sub.type === 'text_delta' && sub.delta) {
          accumulatedText += sub.delta
          emitHarnessEvent(publicSessionId, runId, {
            type: 'assistant',
            text: sub.delta
          })
        } else if (sub.type === 'thinking_delta' && sub.delta) {
          emitHarnessEvent(publicSessionId, runId, {
            type: 'reasoning',
            text: sub.delta
          })
        }
        break
      }
      case 'tool_execution_start': {
        const argsObj = prepareLooseToolArguments(ev.args)
        toolArgsByCallId.set(ev.toolCallId, argsObj)
        const bareName = stripMcpToolPrefix(ev.toolName)
        const preSummary = summarizeMcpToolOperation(bareName, argsObj, undefined)
        emitHarnessEvent(publicSessionId, runId, {
          type: 'tool',
          id: ev.toolCallId,
          name: ev.toolName,
          state: 'start',
          ...(preSummary.detail ? { detail: preSummary.detail } : {}),
          ...(preSummary.steps.length ? { steps: preSummary.steps } : {}),
          args: JSON.stringify(argsObj)
        })
        break
      }
      case 'tool_execution_end': {
        const argsObj = toolArgsByCallId.get(ev.toolCallId) ?? {}
        toolArgsByCallId.delete(ev.toolCallId)
        const bareName = stripMcpToolPrefix(ev.toolName)
        const settledKey = `${publicSessionId || ''}::${bareName}`
        const mcpRecord =
          latestMcpToolExecution.get(settledKey) ?? latestMcpToolExecution.get(bareName)
        const fallbackSummary = summarizeMcpToolOperation(
          bareName,
          argsObj,
          ev.result?.details ?? undefined
        )
        const detail = ev.isError
          ? ev.result?.content?.[0]?.text?.slice(0, 240) || fallbackSummary.detail
          : mcpRecord?.detail || fallbackSummary.detail
        const steps =
          mcpRecord && Date.now() - mcpRecord.at < 15_000 && mcpRecord.steps.length > 0
            ? mcpRecord.steps
            : fallbackSummary.steps

        emitHarnessEvent(publicSessionId, runId, {
          type: 'tool',
          id: ev.toolCallId,
          name: ev.toolName,
          state: ev.isError ? 'error' : 'done',
          ...(detail ? { detail } : {}),
          ...(steps.length ? { steps } : {})
        })

        if (runner.activeSkill?.hooks && !ev.isError) {
          runSkillLifecycleHooks(runner.activeSkill, 'PostToolUse', {
            toolName: ev.toolName,
            toolArgs: JSON.stringify(argsObj),
            workspaceRoot: runner.workspace
          })
        }
        break
      }
      case 'turn_end': {
        if (ev.message.role === 'assistant') {
          const used =
            (ev.message.usage?.input ?? 0) +
            (ev.message.usage?.cacheRead ?? 0) +
            (ev.message.usage?.cacheWrite ?? 0) +
            (ev.message.usage?.output ?? 0)
          if (used > 0) {
            emitHarnessEvent(publicSessionId, runId, {
              type: 'context',
              used
            })
          }
        }
        break
      }
    }
  })

  const attachedImages = extractPromptReferencedImages(
    rawTask,
    workspace,
    resolvedModel.model.input.includes('image')
  )

  try {
    await agent.prompt(finalPromptText, attachedImages.length > 0 ? attachedImages : undefined)

    if (runner.activeSkill?.hooks) {
      runSkillLifecycleHooks(runner.activeSkill, 'Stop', {
        workspaceRoot: workspace
      })
    }

    // 持久化无锁落盘
    if (persistenceSessionId) {
      savePiSession(dshHome(), {
        sessionId: persistenceSessionId,
        cwd: workspace,
        loadedToolsets: lazyManager.getLoadedToolsetIds(),
        todos: runner.todos,
        goal: runner.goal,
        messages: agent.state.messages
      })
    }

    const errMessage = agent.state.errorMessage
    emitHarnessEvent(publicSessionId, runId, { type: 'tool', name: 'pi-agent', state: 'done' })

    if (errMessage && !runner.abortRequested) {
      const formattedErr = isPiQuotaError(errMessage)
        ? `${errMessage}（模型账户余额或配额不足，请充值或在「设置 → 模型接入」中切换服务商）`
        : errMessage
      emitHarnessEvent(publicSessionId, runId, { type: 'error', message: formattedErr })
      settleWaiter({ ok: false, error: formattedErr, finalText: accumulatedText })
    } else {
      emitHarnessEvent(publicSessionId, runId, { type: 'done', runId })
      emitHarnessEvent(publicSessionId, runId, { type: 'final', text: accumulatedText })
      settleWaiter({ ok: true, finalText: accumulatedText })
    }
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : String(err)
    emitHarnessEvent(publicSessionId, runId, { type: 'tool', name: 'pi-agent', state: 'done' })
    if (!runner.abortRequested) {
      emitHarnessEvent(publicSessionId, runId, { type: 'error', message: rawMsg })
    } else {
      emitHarnessEvent(publicSessionId, runId, { type: 'done', runId })
    }
    settleWaiter({ ok: false, error: rawMsg, finalText: accumulatedText })
  } finally {
    cleanupAndPump()
  }
}

function pumpQueues(): void {
  // 1) 先推进已有会话队列中处于空闲态的会话
  for (const runner of sessionRunners.values()) {
    if (runner.running || runner.queue.length === 0) continue
    if (countRunningSessions() >= MAX_PARALLEL_SESSIONS) return
    const next = runner.queue.shift()!
    void executeRunOnRunner(runner, next)
  }

  // 2) 再消化全局溢出队列
  while (overflowQueue.length > 0 && countRunningSessions() < MAX_PARALLEL_SESSIONS) {
    const next = overflowQueue.shift()!
    const runner = getOrCreateRunner(next.input.sessionId?.trim() || '__default__')
    if (runner.running) {
      runner.queue.push(next)
      continue
    }
    void executeRunOnRunner(runner, next)
  }
}

export async function getHarnessStatus(): Promise<HarnessStatus> {
  const mcp = getMcpServerInfo()
  const providers = settingsService.get().models?.providers ?? []
  const resolved = resolvePiModelFromProviders(providers)
  const workspace = projectService.getOpenProjectState()?.rootPath?.trim() || undefined
  const runningIds: string[] = []
  for (const runner of sessionRunners.values()) {
    if (runner.running && runner.sessionId !== '__default__') {
      runningIds.push(runner.sessionId)
    }
  }
  const runningCount = countRunningSessions()

  let message: string | undefined
  if (!mcp?.running) {
    message = 'MCP 工具服务尚未启动'
  } else if (!resolved) {
    message = '请先在「设置 → 模型接入」中配置任意文本模型 API Key'
  }

  return {
    nodeVersion: `v${process.versions.node ?? ''} (Pi In-Process)`,
    nodeOk: true,
    dshReady: true,
    mcpRunning: Boolean(mcp?.running),
    mcpEndpoint: mcp?.endpoint,
    hasDeepseekKey: Boolean(resolved),
    ...(message ? { message } : {}),
    ...(workspace ? { workspace } : {}),
    running: runningCount > 0,
    runningSessionIds: runningIds,
    runningCount
  }
}

export async function prewarmHarness(): Promise<{ ok: boolean; message?: string }> {
  // Pi Agent 运行于 Electron 主进程内部，零子进程冷启动，天然即时就绪
  cleanupLegacyDshSkills()
  return { ok: true }
}

export async function runHarnessTask(input: HarnessRunInput): Promise<HarnessRunResult> {
  const task = String(input?.task ?? '').trim()
  if (!task) return { started: false, message: '任务内容为空' }

  const key = input.sessionId?.trim() || '__default__'
  const runner = getOrCreateRunner(key)
  const item: QueuedRunItem = { input }

  if (runner.running) {
    runner.queue.push(item)
    return { started: true }
  }
  if (countRunningSessions() >= MAX_PARALLEL_SESSIONS) {
    overflowQueue.push(item)
    return { started: true }
  }

  void executeRunOnRunner(runner, item)
  return { started: true }
}

export async function runHarnessJobWait(input: HarnessJobWaitInput): Promise<HarnessJobWaitResult> {
  const task = String(input?.task ?? '').trim()
  if (!task) return { ok: false, error: '任务内容为空' }

  const timeoutMs = Math.max(5_000, Math.trunc(Number(input.timeoutMs ?? 600_000) || 600_000))
  const sessionKey = input.sessionId?.trim() || `job-${randomUUID()}`
  const runner = getOrCreateRunner(sessionKey)

  return await new Promise<HarnessJobWaitResult>((resolve) => {
    let settled = false
    const finish = (res: HarnessJobWaitResult): void => {
      if (settled) return
      settled = true
      resolve(res)
    }
    const timeoutTimer = setTimeout(() => {
      abortHarnessTask(sessionKey)
      finish({ ok: false, error: `Agent 任务等待超时（>${Math.round(timeoutMs / 1000)}s）` })
    }, timeoutMs)

    const item: QueuedRunItem = {
      input: { ...input, sessionId: sessionKey },
      waiter: { resolve: finish, timeoutTimer }
    }

    if (runner.running) {
      runner.queue.push(item)
    } else if (countRunningSessions() >= MAX_PARALLEL_SESSIONS) {
      overflowQueue.push(item)
    } else {
      void executeRunOnRunner(runner, item)
    }
  })
}

export function abortHarnessTask(sessionId?: string): void {
  const cleanId = sessionId?.trim()
  if (cleanId) {
    const runner = sessionRunners.get(cleanId)
    if (runner) {
      runner.abortRequested = true
      runner.queue.length = 0
      askUserBroker.cancelSession(cleanId)
      approvalBroker.cancelSession(cleanId)
      for (const sub of runner.subagents.values()) {
        sub.agent.abort()
      }
      runner.agent?.abort()
    }
    abortActiveMcpCanvasRuns('已中止', cleanId)
    return
  }

  overflowQueue.length = 0
  askUserBroker.cancelSession()
  approvalBroker.cancelSession()
  for (const runner of sessionRunners.values()) {
    runner.abortRequested = true
    runner.queue.length = 0
    for (const sub of runner.subagents.values()) {
      sub.agent.abort()
    }
    runner.agent?.abort()
  }
  abortActiveMcpCanvasRuns('已中止')
}

export function handleAskUserResponse(payload: AskUserAnswer): void {
  askUserBroker.handleResponse(payload)
}

export function handleApprovalResponse(payload: ApprovalAnswer): boolean {
  return approvalBroker.handleResponse(payload)
}

export async function steerHarnessTurn(
  input: SteerHarnessTurnInput
): Promise<SteerHarnessTurnResult> {
  const text = String(input?.text ?? '').trim()
  if (!text) return { ok: false, steered: false, error: '转向指令为空' }

  const key = input.sessionId?.trim() || '__default__'
  const runner =
    sessionRunners.get(key) ?? Array.from(sessionRunners.values()).find((r) => r.running)

  if (!runner || !runner.running || !runner.agent) {
    return { ok: false, steered: false, error: '当前无运行中的 Agent 轮次' }
  }

  if (input.subagentSessionId) {
    const sub = runner.subagents.get(input.subagentSessionId.trim())
    if (!sub) {
      return { ok: false, steered: false, error: `未找到子代理会话：${input.subagentSessionId}` }
    }
    sub.agent.steer({
      role: 'user',
      content: `[Live User Steering]\n${text}`,
      timestamp: Date.now()
    })
  } else {
    runner.agent.steer({
      role: 'user',
      content: `[Live User Steering]\n${text}`,
      timestamp: Date.now()
    })
  }

  const pubSid = runner.sessionId === '__default__' ? undefined : runner.sessionId
  emitHarnessEvent(pubSid, runner.runId, {
    type: 'steered',
    text,
    ...(input.subagentSessionId ? { targetSessionId: input.subagentSessionId } : {})
  })
  emitHarnessEvent(pubSid, runner.runId, {
    type: 'status',
    text: input.subagentSessionId
      ? `⚡ 已向子代理（${input.subagentSessionId.slice(0, 8)}）注入实时转向指令`
      : '⚡ 已注入盘中实时转向指令（将在当前工具步完成后立即生效）'
  })
  return { ok: true, steered: true }
}

export function setHarnessSandboxMode(input: SetHarnessSandboxModeInput): { ok: boolean } {
  const nextMode = normalizeSandboxMode(input?.sandboxMode)
  const targetSid = input?.sessionId?.trim()

  const applyToRunner = (runner: SessionRunnerState): void => {
    runner.sandboxMode = nextMode
    runner.governance?.setSandboxMode(nextMode)
    if (input?.steerLiveTurn && runner.running && runner.agent) {
      runner.agent.steer({
        role: 'user',
        content:
          nextMode === 'danger-full-access'
            ? '[System Notice] User switched sandbox policy to Full Access (danger-full-access) for this session. Previously restricted external paths or CLI tools may now proceed.'
            : '[System Notice] User switched sandbox policy to Restricted Workspace Mode (workspace-write).',
        timestamp: Date.now()
      })
    }
  }

  if (targetSid) {
    const runner = getOrCreateRunner(targetSid)
    applyToRunner(runner)
    return { ok: true }
  }

  defaultSandboxMode = nextMode
  for (const runner of sessionRunners.values()) {
    applyToRunner(runner)
  }
  return { ok: true }
}

export async function deleteHarnessSession(sessionId: string): Promise<void> {
  const clean = String(sessionId ?? '').trim()
  if (!clean) return
  abortHarnessTask(clean)
  sessionRunners.delete(clean)
  deletePiSession(dshHome(), clean)
}

export async function exportHarnessSession(
  input: ExportHarnessSessionInput
): Promise<ExportHarnessSessionResult> {
  const sessionId = String(input?.sessionId ?? '').trim()
  if (!sessionId) return { ok: false, error: 'sessionId 不能为空' }

  const built = await buildPiSessionExportZip(dshHome(), sessionId)
  if (!built) {
    return { ok: false, error: '当前会话尚无持久化记录，请先发送消息后再导出。' }
  }

  let archivePath = input.outputPath?.trim() || ''
  if (!archivePath) {
    const exportsDir = join(dshHome(), 'exports')
    mkdirSync(exportsDir, { recursive: true })
    if (input.outputPath === undefined) {
      // 若从 UI 按钮显式调用但未指定路径，默认导出到 exports 目录以便直接生成交付卡片
      archivePath = join(exportsDir, `session-${sessionId.slice(0, 24)}-${Date.now()}.zip`)
    } else {
      const saveRes = await dialog.showSaveDialog({
        title: '导出对话会话日志',
        defaultPath: join(exportsDir, `session-${sessionId.slice(0, 24)}.zip`),
        filters: [{ name: 'ZIP Archive', extensions: ['zip'] }]
      })
      if (saveRes.canceled || !saveRes.filePath) {
        return { ok: false, canceled: true }
      }
      archivePath = saveRes.filePath
    }
  }

  mkdirSync(dirname(archivePath), { recursive: true })
  writeFileSync(archivePath, built.buffer)
  return {
    ok: true,
    path: archivePath,
    archivePath,
    filePath: archivePath,
    sessionIds: [sessionId],
    fileCount: built.fileCount,
    bytes: built.buffer.byteLength
  }
}

export async function rewindHarnessSession(
  input: RewindHarnessSessionInput
): Promise<RewindHarnessSessionResult> {
  return rewindPiSession(dshHome(), input)
}

export async function searchHarnessSessions(
  input: SearchHarnessSessionsInput
): Promise<SearchHarnessSessionsResult> {
  return searchPiSessions(dshHome(), input)
}

export async function controlHarnessGoal(
  input: ControlHarnessGoalInput
): Promise<{ ok: boolean; goal: HarnessGoalView | null }> {
  const sid = input?.sessionId?.trim() || '__default__'
  const runner = getOrCreateRunner(sid)
  const pubSid = sid === '__default__' ? undefined : sid

  if (input.action === 'clear') {
    runner.goal = null
  } else if (runner.goal) {
    if (input.action === 'pause') {
      runner.goal = { ...runner.goal, phase: 'paused', activation: 'paused' }
    } else if (input.action === 'resume') {
      runner.goal = { ...runner.goal, phase: 'active', activation: 'armed' }
    } else if (input.action === 'complete') {
      runner.goal = {
        ...runner.goal,
        phase: 'completed',
        activation: 'disarmed',
        ...(input.summary ? { summary: input.summary } : {})
      }
    } else if (input.action === 'end') {
      runner.goal = {
        ...runner.goal,
        phase: 'ended',
        activation: 'disarmed',
        ...(input.summary ? { endedReason: input.summary } : {})
      }
    }
  }

  if (pubSid) {
    const existing = loadPiSession(dshHome(), pubSid)
    if (existing) {
      savePiSession(dshHome(), {
        sessionId: pubSid,
        cwd: existing.cwd,
        loadedToolsets: existing.loadedToolsets,
        todos: existing.todos,
        goal: runner.goal,
        messages: existing.messages
      })
    }
  }

  emitHarnessEvent(pubSid, runner.runId || undefined, { type: 'goal', goal: runner.goal })
  return { ok: true, goal: runner.goal }
}

export function listHarnessSchedules(): HarnessScheduleView[] {
  return Array.from(activeSchedules.values()).map((entry) => ({ ...entry.view }))
}

export async function deleteHarnessSchedule(
  input: DeleteHarnessScheduleInput
): Promise<{ ok: boolean }> {
  const id = String(input?.scheduleId ?? '').trim()
  if (!id) return { ok: false }
  const entry = activeSchedules.get(id)
  if (!entry) return { ok: false }
  if (entry.recurring) {
    clearInterval(entry.timer as ReturnType<typeof setInterval>)
  } else {
    clearTimeout(entry.timer as ReturnType<typeof setTimeout>)
  }
  activeSchedules.delete(id)
  broadcastSchedules(input.sessionId ?? entry.sessionId)
  return { ok: true }
}

export function classifyHarnessFileKind(ext: string): HarnessFileViewerKind {
  const lower = ext.toLowerCase()
  if (lower === '.md' || lower === '.mdx') return 'markdown'
  if (lower === '.html' || lower === '.htm') return 'html'
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.svg'].includes(lower)) return 'image'
  if (['.mp4', '.webm', '.mov', '.mkv', '.avi'].includes(lower)) return 'video'
  if (['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac'].includes(lower)) return 'audio'
  if (
    [
      '.txt',
      '.json',
      '.jsonl',
      '.yaml',
      '.yml',
      '.toml',
      '.xml',
      '.csv',
      '.ts',
      '.tsx',
      '.js',
      '.mjs',
      '.cjs',
      '.vue',
      '.css',
      '.scss',
      '.py',
      '.cs',
      '.cpp',
      '.h',
      '.glsl',
      '.shader',
      '.lua',
      '.sh',
      '.ps1',
      '.ini',
      '.cfg'
    ].includes(lower)
  ) {
    return 'text'
  }
  return 'binary'
}

function resolveAllowedHarnessFilePath(
  rawPath: string,
  opts?: {
    workspace?: string
    extraWorkspaces?: string[]
    forWrite?: boolean
  }
): string | null {
  const trimmed = String(rawPath ?? '')
    .trim()
    .replace(/^file:\/\//i, '')
  if (!trimmed) return null

  const primaryWorkspace = resolveWorkspace(opts?.workspace)
  const candidateAbs = isAbsolute(trimmed)
    ? resolvePath(trimmed)
    : resolvePath(primaryWorkspace, trimmed)

  const allowedRoots = [
    primaryWorkspace,
    dshHome(),
    app.getPath('temp'),
    ...(projectService.getOpenProjectState()?.rootPath
      ? [projectService.getOpenProjectState()!.rootPath]
      : []),
    ...(opts?.extraWorkspaces ?? []).filter(Boolean)
  ]

  if (allowedRoots.some((root) => isPathInsideRoot(candidateAbs, root))) {
    return candidateAbs
  }
  if (!opts?.forWrite && existsSync(candidateAbs)) {
    return candidateAbs
  }
  return null
}

export async function readHarnessTextFile(rawPath: string): Promise<string | null> {
  try {
    const absPath = resolveAllowedHarnessFilePath(rawPath)
    if (!absPath || !existsSync(absPath) || statSync(absPath).isDirectory()) return null
    return readFileSync(absPath, 'utf8')
  } catch {
    return null
  }
}

export async function writeHarnessTextFile(rawPath: string, content: string): Promise<boolean> {
  try {
    const absPath = resolveAllowedHarnessFilePath(rawPath, { forWrite: true })
    if (!absPath) return false
    mkdirSync(dirname(absPath), { recursive: true })
    writeFileSync(absPath, String(content ?? ''), 'utf8')
    return true
  } catch {
    return false
  }
}

export async function openHarnessFile(input: OpenHarnessFileInput): Promise<OpenHarnessFileResult> {
  const rawPath = String(input?.path ?? input?.filePath ?? '').trim()
  if (!rawPath) return { ok: false, error: '文件路径为空' }
  const isWrite = input?.mode === 'write'
  const absPath = resolveAllowedHarnessFilePath(rawPath, {
    workspace: input?.workspace,
    extraWorkspaces: input?.extraWorkspaces,
    forWrite: isWrite
  })
  if (!absPath) {
    return { ok: false, error: '仅允许打开工作区或 Harness 目录下的文件' }
  }
  if (isWrite) {
    try {
      mkdirSync(dirname(absPath), { recursive: true })
      writeFileSync(absPath, String(input?.writeContent ?? ''), 'utf8')
      const ext = extname(absPath).toLowerCase()
      return {
        ok: true,
        absPath,
        fileName: basename(absPath),
        ext,
        kind: classifyHarnessFileKind(ext)
      }
    } catch (error) {
      return {
        ok: false,
        absPath,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }
  if (!existsSync(absPath)) {
    return { ok: false, absPath, error: `文件不存在：${absPath}` }
  }
  try {
    const stat = statSync(absPath)
    const fileName = basename(absPath)
    const ext = extname(absPath).toLowerCase()
    const kind = classifyHarnessFileKind(ext)
    const shouldReveal = Boolean(input.revealInFolder || input.reveal || input.mode === 'reveal')
    if (shouldReveal) {
      shell.showItemInFolder(absPath)
      return { ok: true, absPath, fileName, ext, kind }
    }
    if (stat.isDirectory()) {
      if (input.mode === 'read') {
        return { ok: false, absPath, error: `无法直接读取文件夹文本：${absPath}` }
      }
      const err = await shell.openPath(absPath)
      if (err) shell.showItemInFolder(absPath)
      return { ok: true, absPath, fileName, ext, kind: 'binary' }
    }
    if (input.mode === 'read') {
      const mediaUrl = `studio-media://asset?path=${encodeURIComponent(absPath)}`
      const isTextLike = kind === 'markdown' || kind === 'text' || kind === 'html' || ext === '.svg'
      const content =
        isTextLike && stat.size <= 4 * 1024 * 1024 ? readFileSync(absPath, 'utf8') : undefined
      return {
        ok: true,
        absPath,
        fileName,
        ext,
        kind,
        content,
        mediaUrl,
        sizeBytes: stat.size
      }
    }
    const err = await shell.openPath(absPath)
    if (err) return { ok: false, absPath, error: err }
    return { ok: true, absPath, fileName, ext, kind }
  } catch (error) {
    return { ok: false, absPath, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function notifyHarnessCanvasEvent(
  input: HarnessCanvasEventInput
): Promise<HarnessCanvasEventResult> {
  const title = input?.title || input?.summary || ''
  if (!input || !input.kind || !title) {
    return { ok: false, error: '画布事件缺少必要字段' }
  }
  const summary =
    input.summary ||
    (input.detail
      ? `${title} · ${input.detail}`
      : input.errorMessage
        ? `${title} · ${input.errorMessage}`
        : title)
  const outputPaths = input.outputPaths ?? input.relativePaths
  const view: HarnessCanvasEventView = {
    id: `canvas-ev-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    kind: input.kind,
    title,
    summary,
    timestamp: Date.now(),
    ...(input.detail ? { detail: input.detail } : {}),
    ...(input.workflowId ? { workflowId: input.workflowId } : {}),
    ...(input.nodeId ? { nodeId: input.nodeId } : {}),
    ...(input.nodeTitle ? { nodeTitle: input.nodeTitle } : {}),
    ...(input.nodeType ? { nodeType: input.nodeType } : {}),
    ...(input.errorMessage ? { errorMessage: input.errorMessage } : {}),
    ...(input.error || input.errorMessage ? { error: input.error || input.errorMessage } : {}),
    ...(Array.isArray(outputPaths) && outputPaths.length ? { outputPaths } : {}),
    createdAt: new Date().toISOString(),
    autoTriggered: Boolean(input.autoTrigger)
  }

  emitHarnessEvent(input.sessionId, undefined, { type: 'canvas-event', event: view })
  broadcastToAllWindows(IpcChannels.HARNESS_CANVAS_EVENT, view)

  if (input.autoTrigger) {
    const prompt =
      input.kind === 'node_error'
        ? `[Reactive Canvas Event: 节点执行报错]\n节点：${input.nodeTitle || input.nodeId || '未知节点'}${input.nodeType ? ` (${input.nodeType})` : ''}\n错误信息：${input.errorMessage || input.detail || input.title}\n请立即定位报错原因，检查节点参数或上游连线并给出修复方案（必要时直接调用画布工具修复）。`
        : `[Reactive Canvas Event: 画布工作流执行完成]\n${input.title}${input.detail ? `\n详情：${input.detail}` : ''}${outputPaths?.length ? `\n产物路径：${outputPaths.join(', ')}` : ''}\n请审阅本次工作流产出，检查是否需要进一步合成、剪辑或调用 present_files 交付。`

    const activeRunner = input.sessionId
      ? sessionRunners.get(input.sessionId)
      : Array.from(sessionRunners.values()).find((r) => r.running)

    if (activeRunner?.running) {
      await steerHarnessTurn({
        text: prompt,
        sessionId:
          input.sessionId ||
          (activeRunner.sessionId === '__default__' ? undefined : activeRunner.sessionId)
      })
    } else {
      await runHarnessTask({
        task: prompt,
        sessionId: input.sessionId,
        mode: 'craft'
      })
    }
  }
  return { ok: true, event: view }
}

const BUILTIN_HARNESS_SLASH_COMMANDS: SessionSkill[] = [
  {
    name: 'compact',
    kind: 'builtin',
    description: '压缩当前会话上下文，释放 Token 空间并保留关键创作摘要',
    argumentHint: '[focus]',
    userInvocable: true
  },
  {
    name: 'goal',
    kind: 'builtin',
    description: '启动或管理多轮自主目标执行器（/goal <目标> | status | pause | resume | end）',
    argumentHint: '<objective | status | pause | resume | end>',
    userInvocable: true
  },
  {
    name: 'feedback',
    kind: 'builtin',
    description: '记录对当前会话或 Agent 表现的反馈日志',
    argumentHint: '<comment>',
    userInvocable: true
  },
  {
    name: 'export',
    kind: 'builtin',
    description: '将当前会话完整日志导出为 .zip 压缩包并生成交付卡片',
    userInvocable: true
  }
]

function renderDshSkillsTemplate(): string {
  return [
    '---',
    'name: my-skill',
    'description: 示例 Claude Code 技能：说明本技能的作用以及何时应当调用它。',
    'argument-hint: "[subject] [style]"',
    'user-invocable: true',
    'disable-model-invocation: false',
    'allowed-tools: Read, Grep, Glob',
    'context: inline',
    '---',
    '',
    '# 技能执行指南',
    '',
    '当用户通过 `/my-skill $ARGUMENTS` 调用或模型自动匹配本技能时，按以下步骤执行：',
    '',
    '- 首个参数（主体）：`$0`',
    '- 第二个参数（风格）：`$1`',
    '- 技能目录路径：`${CLAUDE_SKILL_DIR}`',
    '',
    '## 步骤',
    '1. 明确创作或开发目标',
    '2. 调用合适的工具完成任务',
    '3. 检查产出并向用户汇报结果',
    ''
  ].join('\n')
}

export function getDshSkillsInfo(): DshSkillsInfo {
  cleanupLegacyDshSkills()
  const skillsDir = dshSkillsDir()
  const discovered = discoverInstalledClaudeSkills({
    personalSkillsDir: skillsDir,
    workspaceRoot: resolveWorkspace()
  })
  const githubRecordsByName = new Map(
    listInstalledGitHubSkillRecords(skillsDir).map((rec) => [rec.name, rec])
  )
  const files: DshSkillsFile[] = discovered.map((item) => {
    let githubRepo: string | undefined
    let githubRef: string | undefined
    if (item.layout === 'bundle') {
      try {
        const metaPath = join(dirname(item.skillFilePath), '.aiart-github-skill.json')
        if (existsSync(metaPath)) {
          const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as {
            owner?: string
            repo?: string
            resolvedRef?: string
          }
          if (meta.owner && meta.repo) githubRepo = `${meta.owner}/${meta.repo}`
          if (meta.resolvedRef) githubRef = meta.resolvedRef
        }
      } catch {
        /* ignore */
      }
      if (!githubRepo && item.scope === 'personal') {
        const rec = githubRecordsByName.get(item.name)
        if (rec?.owner && rec?.repo) {
          githubRepo = `${rec.owner}/${rec.repo}`
          if (rec.ref) githubRef = rec.ref
        }
      }
    }
    return {
      fileName: item.layout === 'bundle' ? item.name : basename(item.skillFilePath),
      kind:
        item.scope === 'project'
          ? 'project'
          : githubRepo
            ? 'github'
            : item.layout === 'bundle'
              ? 'bundle'
              : 'custom',
      title: item.frontmatter.name,
      description: item.frontmatter.description,
      hasScripts: item.hasScripts,
      hasWorkflow: item.hasWorkflow,
      extraFileCount: item.extraFileCount,
      scope: item.scope,
      argumentHint: item.frontmatter.argumentHint,
      userInvocable: item.frontmatter.userInvocable,
      disableModelInvocation: item.frontmatter.disableModelInvocation,
      allowedTools: item.frontmatter.allowedTools,
      model: item.frontmatter.model,
      context: item.frontmatter.context,
      agent: item.frontmatter.agent,
      whenToUse: item.frontmatter.whenToUse,
      ...(githubRepo ? { githubRepo } : {}),
      ...(githubRef ? { githubRef } : {}),
      version: item.frontmatter.version,
      author: item.frontmatter.author,
      license: item.frontmatter.license
    }
  })

  if (existsSync(skillsDir)) {
    try {
      for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
        if (!entry.isFile() || entry.name.startsWith('.') || entry.name.endsWith('.md')) continue
        let content: string | undefined
        try {
          content = readFileSync(join(skillsDir, entry.name), 'utf8')
        } catch {
          content = undefined
        }
        const parsed = content ? parseClaudeSkillMarkdown(content, entry.name) : null
        files.push({
          fileName: entry.name,
          kind: 'template',
          title: parsed?.frontmatter.name ?? entry.name,
          ...(parsed?.frontmatter.description
            ? { description: parsed.frontmatter.description }
            : {})
        })
      }
    } catch {
      /* ignore */
    }
  }

  files.sort((a, b) => a.fileName.localeCompare(b.fileName))
  return {
    dirPath: skillsDir,
    builtinCount: 0,
    files
  }
}

export async function openDshSkillsDir(): Promise<void> {
  const skillsDir = dshSkillsDir()
  mkdirSync(skillsDir, { recursive: true })
  const error = await shell.openPath(skillsDir)
  if (error) throw new Error(error)
}

export function writeDshSkillsTemplate(): DshSkillsTemplateResult {
  const skillsDir = dshSkillsDir()
  mkdirSync(skillsDir, { recursive: true })
  const filePath = join(skillsDir, DSH_SKILLS_TEMPLATE_FILE)
  if (existsSync(filePath)) return { filePath, skipped: true }
  writeFileSync(filePath, renderDshSkillsTemplate(), 'utf8')
  return { filePath, skipped: false }
}

export function getSessionSkills(): SessionSkill[] {
  const discovered = discoverInstalledClaudeSkills({
    personalSkillsDir: dshSkillsDir(),
    workspaceRoot: resolveWorkspace()
  })
  const customSkills: SessionSkill[] = discovered.map((item) => ({
    name: item.name,
    kind: 'custom',
    description: item.frontmatter.description,
    argumentHint: item.frontmatter.argumentHint,
    userInvocable: item.frontmatter.userInvocable,
    disableModelInvocation: item.frontmatter.disableModelInvocation,
    allowedTools: item.frontmatter.allowedTools,
    model: item.frontmatter.model,
    context: item.frontmatter.context,
    agent: item.frontmatter.agent,
    hasScripts: item.hasScripts,
    hasWorkflow: item.hasWorkflow,
    scope: item.scope
  }))
  const customNames = new Set(customSkills.map((s) => s.name))
  return [
    ...BUILTIN_HARNESS_SLASH_COMMANDS.filter((b) => !customNames.has(b.name)),
    ...customSkills
  ]
}

// 挂载 MCP 工具完成摘要钩子与画布任务终态事件钩子
setMcpToolSettledHook((ev) => {
  const summary = summarizeMcpToolOperation(ev.tool, ev.args, ev.result)
  if (summary.steps.length > 0 || summary.detail) {
    const record = {
      detail: summary.detail,
      steps: summary.steps,
      at: Date.now()
    }
    latestMcpToolExecution.set(`${ev.sessionId || ''}::${ev.tool}`, record)
    latestMcpToolExecution.set(ev.tool, record)
  }
})

setHarnessScheduleHandlers({
  list: () => listHarnessSchedules(),
  delete: (input) => deleteHarnessSchedule(input)
})

setCanvasTaskSettledHook((report) => {
  const ok = report.phase === 'finished' && report.status === 'done'
  if (ok) {
    void notifyHarnessCanvasEvent({
      kind: 'workflow_finished',
      title: '画布工作流执行完成',
      detail: report.relativePaths?.length
        ? `共生成 ${report.relativePaths.length} 个产物文件`
        : undefined,
      outputPaths: report.relativePaths,
      ...(report.sessionId ? { sessionId: report.sessionId } : {})
    })
  } else if (report.phase === 'failed' || report.status === 'error') {
    void notifyHarnessCanvasEvent({
      kind: 'node_error',
      title: '画布工作流执行报错',
      errorMessage: report.error || '节点执行异常',
      ...(report.sessionId ? { sessionId: report.sessionId } : {})
    })
  }
})

app.on('will-quit', () => {
  abortHarnessTask()
  for (const entry of activeSchedules.values()) {
    if (entry.recurring) {
      clearInterval(entry.timer as ReturnType<typeof setInterval>)
    } else {
      clearTimeout(entry.timer as ReturnType<typeof setTimeout>)
    }
  }
  activeSchedules.clear()
})
