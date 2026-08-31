import { app, shell } from 'electron'
import { createHash } from 'node:crypto'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { readdir, rm } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  IpcChannels,
  type AskUserAnswer,
  type ChatMode,
  type DshSkillsFile,
  type DshSkillsInfo,
  type DshSkillsTemplateResult,
  type HarnessEvent,
  type HarnessRunInput,
  type HarnessRunResult,
  type HarnessStatus
} from '@shared/ipc'
import { listGraphSkills, type GraphSkill } from '@shared/graph/graphSkills'
import { modalityConfig, type ModelProviderInstance } from '@shared/modelProvider'
import { broadcastToAllWindows } from '../broadcast'
import { getMcpServerInfo } from './mcpServerService'
import { projectService } from './projectService'
import { settingsService } from './settingsService'

/**
 * DeepSeek Harness (dsh) 接入服务。
 *
 * dsh 是 DeepSeek 2026-08 开源的 agent 运行时（开发者预览 v0.1，API 会快速迭代）。
 * 本服务把它作为子进程拉起（headless profile），并注入 dsh-mcp-client 插件配置，
 * 让 agent 通过 Streamable HTTP 调用本应用自带的 MCP 工具服务——即「聊天窗口里调用 MCP」。
 *
 * 流程：
 *   Chat 面板 → HARNESS_RUN → spawn dsh `--profile headless <task>`
 *     → dsh 内嵌 mcp-client → GET/POST http://127.0.0.1:<port>/mcp (Bearer token)
 *     → 工具执行（generate_image 等）→ MCP 活动广播给渲染层做工具卡
 *   dsh stdout / stderr 按行转发为 HARNESS_EVENT（assistant / status / done / error）。
 *
 * dsh 运行体来源（按优先级）：
 *   1. 安装包内置：构建时由 scripts/bundle-dsh.mjs 产出，随 extraResources 打入
 *      `<resources>/dsh`，开箱即用，无需联网下载；
 *   2. 工程本地安装：开发模式下 `node_modules/@deepseek-ai/dsh`；
 *   3. npx 现场拉包（回退）：无内置且未安装时 `npx --yes @deepseek-ai/dsh`，耗时较长。
 * dsh 由系统 Node ^22.19 或 24+ 执行（与应用内 Electron 内置 Node 无关）。
 */

const DSH_PACKAGE = '@deepseek-ai/dsh'
const MIN_NODE_MAJOR = 22
const MIN_NODE_MINOR = 19
const NPX_TIMEOUT_MS = 120_000
/** npx 现场拉包期间的进度提醒间隔：下载可能长时间无输出，避免界面看起来卡死 */
const NPX_PROGRESS_HINT_MS = 20_000

let child: ChildProcess | null = null
let runSeq = 0
/** 最近一次下发的 status 文本，用于合并连续重复行，避免同文刷屏 */
let lastStatusText = ''
/** 已提示过的工作区路径：仅在切换时提示，避免每条消息都重复输出 */
let workspaceNotified = ''
/**
 * 待回传的 ask_user_question 提问：requestId（harness: 前缀）→ 回答文件与题号。
 * 渲染层选择经 MCP_ASK_USER_RESPONSE 回传 → handleAskUserResponse 写 answerFile，
 * runner 侧 provider 轮询读到后 resolve 给 agent。
 */
const harnessAskUserRequests = new Map<string, { runId: string; answerFile: string; questionId: string }>()

function emit(event: HarnessEvent): void {
  broadcastToAllWindows(IpcChannels.HARNESS_EVENT, event)
}

/** 下发一条状态行；与上一行完全相同的文本会被合并，只保留一次 */
function emitStatus(text: string): void {
  if (!text) return
  if (text === lastStatusText) return
  lastStatusText = text
  emit({ type: 'status', text })
}

/** 剥离 ANSI 颜色码 / 控制字符，保留可读文本 */
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;]*m/g, '').replace(/\r/g, '')
}

/** dsh 配置根目录（userData 下，避免污染工程目录） */
function dshHome(): string {
  return join(app.getPath('userData'), 'dsh-harness')
}

/**
 * dsh 工作区：优先当前打开的工程根目录（agent 在工程内读写资产），
 * 未打开工程时回退应用数据目录（仅可做纯对话）。
 */
function resolveWorkspace(): string {
  const root = projectService.getOpenProjectState()?.rootPath?.trim()
  if (root && existsSync(root)) return root
  return app.getPath('userData')
}

/**
 * 解析 dsh 使用的文本 provider（含密钥）。
 * 优先指定 providerId；未指定时取 DeepSeek 官方，其次任意已配置文本模型的 provider。
 * 任一 provider 的文本模型都可作为 agent 模型（OpenAI 兼容端点经 DEEPSEEK_BASE_URL 透传）。
 */
function resolveTextProvider(providerId?: string): {
  apiKey: string
  baseUrl?: string
  modelId: string
} | null {
  const settings = settingsService.get()
  const providers = settings.models?.providers ?? []
  const hasTextModels = (p: ModelProviderInstance): boolean =>
    (modalityConfig(p, 'text').selectedModelIds?.length ?? 0) > 0
  const pick = (p: ModelProviderInstance): ReturnType<typeof resolveTextProvider> => {
    const text = modalityConfig(p, 'text')
    const modelId =
      (text.defaultModelId?.trim() && text.selectedModelIds.includes(text.defaultModelId)
        ? text.defaultModelId.trim()
        : undefined) ?? text.selectedModelIds[0]?.trim()
    if (!modelId) return null
    const baseUrl = p.baseUrl?.trim()
    return { apiKey: p.apiKey.trim(), modelId, ...(baseUrl ? { baseUrl } : {}) }
  }
  if (providerId) {
    const candidate = providers.find(
      (p) => p.id === providerId && p.enabled && p.apiKey?.trim() && hasTextModels(p)
    )
    return candidate ? pick(candidate) : null
  }
  const pool = providers.filter((p) => p.enabled && p.apiKey?.trim() && hasTextModels(p))
  const provider = pool.find((p) => p.providerKind === 'deepseek') ?? pool[0]
  return provider ? pick(provider) : null
}

/** 检测系统 Node 版本（dsh 走系统 node，与应用内置版本无关） */
function detectSystemNode(): string {
  const res = spawnSync('node', ['--version'], { timeout: 5_000, encoding: 'utf8' })
  return res.status === 0 && res.stdout ? res.stdout.trim() : ''
}

function parseNodeVersion(version: string): { major: number; minor: number } | null {
  const m = /^v?(\d+)\.(\d+)\.\d+/.exec(version.trim())
  if (!m) return null
  return { major: Number(m[1]), minor: Number(m[2]) }
}

function isNodeVersionOk(version: string): boolean {
  const parsed = parseNodeVersion(version)
  if (!parsed) return false
  if (parsed.major < MIN_NODE_MAJOR) return false
  if (parsed.major === MIN_NODE_MAJOR && parsed.minor < MIN_NODE_MINOR) return false
  return true
}

/** npm 缓存目录（用于判断 dsh 是否已缓存、免现场下载） */
function npmCacheDir(): string {
  const res = spawnSync('npm', ['config', 'get', 'cache'], { timeout: 5_000, encoding: 'utf8' })
  return res.status === 0 && res.stdout ? res.stdout.trim() : ''
}

/** dsh 是否已存在于 npx 缓存（`npm exec` 命名的 `_npx` 目录） */
function detectDshCached(): boolean {
  const cache = npmCacheDir()
  if (!cache) return false
  const npxDir = join(cache, '_npx')
  if (!existsSync(npxDir)) return false
  return existsSync(join(npxDir, 'node_modules', DSH_PACKAGE))
}

/** dsh 包根目录的候选位置：安装包内置 resources → 工程本地 node_modules（开发模式） */
function dshPackageRoots(): string[] {
  const roots: string[] = []
  if (process.resourcesPath) roots.push(join(process.resourcesPath, 'dsh', 'node_modules', DSH_PACKAGE))
  roots.push(join(app.getAppPath(), 'node_modules', DSH_PACKAGE))
  return roots
}

/** 读取包 package.json 的 bin 入口（bin 为字符串或对象，对象取首个值） */
function readBinEntry(packageRoot: string): string | null {
  try {
    const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
      bin?: string | Record<string, string>
    }
    if (typeof pkg.bin === 'string') return join(packageRoot, pkg.bin)
    const first = pkg.bin ? Object.values(pkg.bin)[0] : ''
    return first ? join(packageRoot, first) : null
  } catch {
    return null
  }
}

/** 定位可用的 dsh 运行入口（内置优先，其次本地安装）；无可用返回 null */
function resolveDshEntry(): string | null {
  for (const root of dshPackageRoots()) {
    if (!existsSync(root)) continue
    const entry = readBinEntry(root)
    if (entry && existsSync(entry)) return entry
  }
  return null
}

export async function getHarnessStatus(): Promise<HarnessStatus> {
  const nodeVersion = detectSystemNode()
  const nodeOk = isNodeVersionOk(nodeVersion)
  const mcp = getMcpServerInfo()
  const provider = resolveTextProvider()
  const dshEntry = resolveDshEntry()
  const dshReady = nodeOk && (!!dshEntry || detectDshCached())

  const hints: string[] = []
  if (!nodeVersion) hints.push('未检测到系统 Node，请先安装 Node.js 22.19+ 或 24+')
  else if (!nodeOk) hints.push(`系统 Node ${nodeVersion}，dsh 建议 ^22.19 或 24+`)
  if (!dshEntry && !detectDshCached()) {
    hints.push('首次发送消息时会自动下载 dsh（需联网，约 1–2 分钟）')
  }
  if (!provider) hints.push('尚未配置文本模型或 API Key（模型设置中添加）')
  if (!mcp?.running) hints.push('MCP 工具服务未启动（设置中开启）')

  // 仅打开工程时上报工作区（agent 以工程为工作区）；否则 UI 提示未打开工程
  const projectRoot = projectService.getOpenProjectState()?.rootPath?.trim()
  const workspace = projectRoot && existsSync(projectRoot) ? projectRoot : undefined
  if (!workspace) hints.push('未打开工程：AI 工作区将回退为应用数据目录')

  return {
    nodeVersion: nodeVersion || '未知',
    nodeOk,
    dshReady,
    mcpRunning: !!mcp?.running,
    mcpEndpoint: mcp?.endpoint,
    hasDeepseekKey: !!provider,
    message: hints.join('；') || undefined,
    workspace
  }
}

/** 生成 dsh 的 home 级配置：注册 mcp-client 插件，指向本应用 MCP 工具服务 */
function writeDshConfig(endpoint: string): void {
  const home = dshHome()
  mkdirSync(home, { recursive: true })
  // !!js 为 dsh 的 YAML 特殊语法：标签值必须是「合法 JS 表达式」，由 cordis-plugin-loader
  // 在加载配置时 eval 求值。环境变量在 spawn 时注入（token 不进命令行，也不落盘）。
  // 注意：YAML 引号只是 YAML 层语法，解析后交给 eval 的是引号内原文——
  // 因此不能写 !!js 'Bearer ${...}'（裸字符串不是 JS 表达式，eval 报 Unexpected identifier）。
  // 正确写法是把 JS 模板字符串（反引号）包进 YAML 引号：!!js "`Bearer ${...}`"。
  const patch = [
    '# AIArtEngine 生成的 dsh 配置，请勿手改。',
    '# dsh 的 patch 语义：`- id` 只能修补已有条目，新增插件必须用 `- insert:`',
    '- insert:',
    '  - id: mcp-studio',
    "    name: '@deepseek-ai/dsh-mcp-client'",
    '    config:',
    '      serverName: studio',
    '      transport: streamable-http',
    `      url: ${endpoint}`,
    // dsh-mcp-client 默认单次工具调用超时 60s；generate_model3d / generate_video 等
    // 是「提交后阻塞轮询到生成完成」的调用，Lux3D/视频生成常需数分钟，60s 必超时，
    // 导致 Agent 误以为提交失败而重复提交。调到 120 分钟与 LONG_GENERATE_TIMEOUT_MS 对齐。
    '      toolCallTimeoutMs: 7200000',
    '      headers:',
    '        Authorization: !!js "`Bearer ${process.env.STUDIO_MCP_TOKEN}`"'
  ]
  writeFileSync(join(home, 'cordis.patch.yml'), patch.join('\n') + '\n', 'utf8')
}

/** YAML 双引号标量：JSON 字符串字面量对 YAML 兼容，且天然处理转义 */
function yamlScalar(value: string): string {
  return JSON.stringify(value)
}

/**
 * 写入 dsh 的 settings 文档（`$DSH_HOME/settings.yaml`），覆盖默认模型与端点。
 *
 * 背景：dsh 的模型选择不读取 `DSH_MODEL` 环境变量——`agentDefaultModel.currentSelection()`
 * 只从 settings 的 `agent-default-model` 一节读取；未设置时回落到 dsh-base 插件配置里的
 * 默认值 `deepseek-v4-flash`（provider `deepseek-official`）。该模型 ID 在 DeepSeek 官方
 * 以外的 OpenAI 兼容端点（或前缀裁剪后）多不存在，导致每次对话都报 HTTP_404，且与用户
 * 在面板里选中的模型无关。这里在每次任务前把用户选择的模型/端点写入 settings，覆盖默认值；
 * API Key 仍经 `DEEPSEEK_API_KEY` 环境变量透传（dsh 的 llm-deepseek 默认读它）。
 */
function writeDshSettings(provider: { baseUrl?: string; modelId: string }): void {
  const home = dshHome()
  mkdirSync(home, { recursive: true })
  const lines = [
    '# AIArtEngine 生成的 dsh 设置（模型选择/端点），请勿手改。',
    'agent-default-model:',
    '  provider: deepseek-official',
    `  model: ${yamlScalar(provider.modelId)}`
  ]
  if (provider.baseUrl?.trim()) {
    lines.push('llm-deepseek:')
    lines.push(`  baseURL: ${yamlScalar(provider.baseUrl.trim())}`)
  }
  writeFileSync(join(home, 'settings.yaml'), lines.join('\n') + '\n', 'utf8')
}

/** dsh 的 skill 快照清单文件：记录上次生成的文件，下次写入前清理，避免残留失效技能 */
const DSH_SKILLS_MANIFEST = '.aiart-skill-manifest.json'

/** GraphSkill id → dsh 合法 skill 名（kebab-case，`/^[a-z0-9]+(?:-[a-z0-9]+)*$/`） */
function toDshSkillName(id: string): string {
  const kebab = id
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return kebab
}

/** 把一条 GraphSkill 渲染为 dsh 的 SKILL.md（frontmatter + 中英双语正文） */
function renderDshSkillMd(skill: GraphSkill): string {
  const name = toDshSkillName(skill.id)
  const zhTitle = skill.titleZh || skill.id
  const enTitle = skill.titleEn || skill.id
  const description = `${enTitle} — ${zhTitle}`
  const sections: string[] = []
  if (skill.systemPromptZh) sections.push(`### 系统提示（中文）\n\n${skill.systemPromptZh}`)
  if (skill.systemPromptEn) sections.push(`### System prompt (English)\n\n${skill.systemPromptEn}`)
  if (skill.instructionZh) sections.push(`### 生成指令（中文）\n\n${skill.instructionZh}`)
  if (skill.instructionEn) sections.push(`### Instruction (English)\n\n${skill.instructionEn}`)
  const body = sections.length ? sections.join('\n\n') : `> 技能 ${name}：${description}`
  return [
    '---',
    `name: ${name}`,
    `description: ${JSON.stringify(description.replace(/[\r\n]+/g, ' '))}`,
    '---',
    '',
    `# ${enTitle}`,
    '',
    body,
    ''
  ].join('\n')
}

/**
 * 把应用内置 GraphSkill 目录快照成 dsh 的 SKILL.md 文件（`$DSH_HOME/skills`）。
 *
 * dsh 的 `skill-filesystem` 插件默认挂载且 `includeDefaultRoots: true`，会扫描
 * `$DSH_HOME/skills` 目录下的 `*.md`（rank 400），并由 `tool-skill` 把技能清单
 * 注入模型可见的 `<available_skills>` 目录、提供 `skill` 加载工具——即 AI 对话里
 * 的 agent 能感知并加载应用内置技能（分镜拆解、9宫格、动态提示词等）。
 *
 * 带签名指纹：覆盖栈可能被插件 `registerGraphSkill` 动态增删，但多数对话之间
 * 技能并无变化。先算当前清单的 SHA-1 签名，与 manifest 记录的签名一致且上次
 * 生成的文件都在时直接跳过，避免每次对话都做无谓的删写；变化才按 manifest
 * 清理上次生成的文件再全量重写，避免残留失效技能。
 */
function writeDshSkills(): void {
  try {
    const home = dshHome()
    mkdirSync(home, { recursive: true })
    const skillsDir = join(home, 'skills')
    mkdirSync(skillsDir, { recursive: true })
    const manifestPath = join(skillsDir, DSH_SKILLS_MANIFEST)
    const { previous, signature: lastSignature } = readDshSkillsManifest()
    const signature = dshSkillsSignature()
    // 技能没变且上次生成的文件都还在 → 跳过写盘，复用现有快照
    if (
      lastSignature === signature &&
      previous.every((file) => existsSync(join(skillsDir, file)))
    ) {
      return
    }
    // 只清理上次由本函数生成的文件，用户自行放入的自定义技能不受影响
    for (const file of previous) {
      const target = join(skillsDir, file)
      if (existsSync(target)) rmSync(target, { force: true })
    }
    const generated: string[] = []
    for (const skill of listGraphSkills()) {
      const name = toDshSkillName(skill.id)
      if (!name) continue
      const file = `${name}.md`
      generated.push(file)
      writeFileSync(join(skillsDir, file), renderDshSkillMd(skill), 'utf8')
    }
    writeFileSync(manifestPath, JSON.stringify({ files: generated, signature }), 'utf8')
  } catch (error) {
    // 技能快照失败不阻塞主流程（dsh 无技能也能对话）
    console.warn('[aiart] writeDshSkills failed:', error)
  }
}

/** 当前技能清单的指纹：任何技能 id / 渲染内容变化都会改变，用于跳过无谓写盘 */
function dshSkillsSignature(): string {
  const hash = createHash('sha1')
  for (const skill of listGraphSkills()) {
    hash.update(`${skill.id}\u0000${renderDshSkillMd(skill)}\u0000`)
  }
  return hash.digest('hex')
}

/** 读 dsh 技能 manifest（旧格式 string[] / 新格式 { files, signature } 均兼容） */
function readDshSkillsManifest(): { previous: string[]; signature: string } {
  try {
    const raw = JSON.parse(
      readFileSync(join(dshHome(), 'skills', DSH_SKILLS_MANIFEST), 'utf8') || '[]'
    ) as string[] | { files?: unknown; signature?: unknown }
    if (Array.isArray(raw)) return { previous: raw, signature: '' }
    return {
      previous: Array.isArray(raw.files) ? (raw.files as string[]) : [],
      signature: typeof raw.signature === 'string' ? raw.signature : ''
    }
  } catch {
    return { previous: [], signature: '' }
  }
}

/** dsh 示例技能模板文件名：不带 .md 后缀，避免被 dsh 的 skill-filesystem 扫描成真技能 */
const DSH_SKILLS_TEMPLATE_FILE = 'my-skill.example'

/** 查询 dsh 技能目录信息（渲染层设置页展示用） */
export function getDshSkillsInfo(): DshSkillsInfo {
  const skillsDir = join(dshHome(), 'skills')
  const files: DshSkillsFile[] = []
  if (existsSync(skillsDir)) {
    const builtin = new Set(readDshSkillsManifest().previous)
    for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
      if (!entry.isFile() || entry.name === DSH_SKILLS_MANIFEST) continue
      files.push({
        fileName: entry.name,
        kind: builtin.has(entry.name)
          ? 'builtin'
          : entry.name.endsWith('.md')
            ? 'custom'
            : 'template'
      })
    }
  }
  files.sort((a, b) => a.fileName.localeCompare(b.fileName))
  return {
    dirPath: skillsDir,
    builtinCount: listGraphSkills().filter((skill) => !!toDshSkillName(skill.id)).length,
    files
  }
}

/** 在系统文件管理器中打开 dsh 技能目录（不存在则先创建） */
export async function openDshSkillsDir(): Promise<void> {
  const skillsDir = join(dshHome(), 'skills')
  mkdirSync(skillsDir, { recursive: true })
  const error = await shell.openPath(skillsDir)
  if (error) throw new Error(error)
}

/** 写入一个示例 SKILL.md 模板；同名文件已存在时跳过（不覆盖用户可能改动过的内容） */
export function writeDshSkillsTemplate(): DshSkillsTemplateResult {
  const skillsDir = join(dshHome(), 'skills')
  mkdirSync(skillsDir, { recursive: true })
  const filePath = join(skillsDir, DSH_SKILLS_TEMPLATE_FILE)
  if (existsSync(filePath)) return { filePath, skipped: true }
  writeFileSync(filePath, renderDshSkillsTemplate(), 'utf8')
  return { filePath, skipped: false }
}

/** 示例 SKILL.md 模板：dsh 格式（frontmatter name/description + 正文），复制重命名为 .md 即生效 */
function renderDshSkillsTemplate(): string {
  return [
    '---',
    'name: my-skill',
    'description: 示例技能：演示 dsh 技能的写法。请根据实际用途改写技能名与描述。',
    '---',
    '',
    '# 技能正文',
    '',
    '在这里编写技能的执行说明。模型调用本技能时，本文件会作为指令注入上下文。',
    '',
    '## 步骤',
    '1. 明确技能目标',
    '2. 列出执行步骤',
    '3. 说明输出要求',
    '',
    '## 注意事项',
    '- 描述要具体，避免模糊指令',
    '- 需要遵守的约束写在这里',
    '',
    '---',
    '提示：把本文件复制并重命名为「你的技能名.md」（小写字母 + 连字符）即生效；',
    'frontmatter 的 name / description（文件开头两行）用于模型判断何时调用本技能。',
    ''
  ].join('\n')
}

/** 思考过程在 dsh stdout 中的包裹标记：自定义 runner 输出，主进程据此切分事件 */
const REASONING_BEGIN = '===BEGIN_REASONING==='
const REASONING_END = '===END_REASONING==='
/** 工具调用标记：runner 在 skill/MCP 工具开始与结束时各输出一行（JSON 载荷） */
const TOOL_BEGIN = '===BEGIN_TOOL==='
const TOOL_END = '===END_TOOL==='
/** ask_user_question 提问标记：runner 把原生 userQuestions 提问转发给主进程（单行 JSON 载荷） */
const ASK_USER_BEGIN = '===BEGIN_ASK_USER==='
/** 上下文用量标记：runner 每轮 LLM 请求完成后输出（单行 JSON 载荷，provider usage） */
const CONTEXT_BEGIN = '===BEGIN_CONTEXT==='

/**
 * 自定义 headless runner 模板（ESM）。dsh 自带的 headless-runner 只打印最终
 * assistant 文本，把消息里的 `reasoning` 块（DeepSeek 思考内容）丢弃了；
 * 我们注入一个等价 runner，额外把 reasoning 包在 `REASONING_BEGIN/END` 之间
 * 输出到 stdout，主进程转发为 `reasoning` 事件，渲染层折叠展示思考过程。
 *
 * 该文件写到 userData 下（不污染 dsh 包），依赖通过 `createRequire` 锚定到
 * dsh 安装目录的 node_modules 解析（`__DSH_NODE_MODULES_JSON__` 运行时填充）。
 */
const AIART_RUNNER_TEMPLATE = String.raw`// Generated by AIArtEngine. Based on @deepseek-ai/dsh-headless (one-shot driver).
// Outputs the final assistant text plus any model reasoning blocks, delimited by markers.
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const PKG_ROOT = __DSH_NODE_MODULES_JSON__
const require = createRequire(pathToFileURL(join(PKG_ROOT, 'aiart-anchor.js')).href)
const imp = (id) => import(pathToFileURL(require.resolve(id)).href)

const { default: z } = await imp('@deepseek-ai/schemastery')
const { installModelSelection } = await imp('@deepseek-ai/dsh-agent')
const { createUserMessage } = await imp('@deepseek-ai/dsh-llm')
const { SessionId } = await imp('@deepseek-ai/dsh-session')
const { defineTool } = await imp('@deepseek-ai/dsh-tools')

const name = 'aiart-headless-runner'
const inject = ['agentDefaultModel', 'agents', 'sessions']
const Config = z.object({ task: z.string().required() })

const REASONING_BEGIN = '===BEGIN_REASONING==='
const REASONING_END = '===END_REASONING==='
const TOOL_BEGIN = '===BEGIN_TOOL==='
const TOOL_END = '===END_TOOL==='
const ASK_USER_BEGIN = '===BEGIN_ASK_USER==='
const CONTEXT_BEGIN = '===BEGIN_CONTEXT==='

/** 从模型产出的原始参数 JSON 里提取一行可读摘要（取首个字符串字段值，失败则截断原文） */
function summarizeToolArgs(raw) {
  if (typeof raw !== 'string' || raw === '') return ''
  try {
    const parsed = JSON.parse(raw)
    for (const value of Object.values(parsed)) {
      if (typeof value === 'string' && value !== '') return value
    }
    return JSON.stringify(parsed)
  } catch {
    return raw.length > 40 ? raw.slice(0, 40) + '…' : raw
  }
}

function summarize(events, firstSeq) {
  let started = false
  let text = ''
  let reason
  const reasoning = []
  for (const event of events) {
    if (event.seq < firstSeq) continue
    if (event.type === 'turn/start') {
      started = true
      continue
    }
    if (!started) continue
    if (event.type === 'assistant/message') {
      const content = event.data?.message?.content ?? []
      const joined = content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('')
      if (joined !== '') text = joined
      for (const block of content) {
        if (block.type === 'reasoning' && typeof block.text === 'string' && block.text !== '') {
          reasoning.push(block.text)
        }
      }
    }
    if (event.type === 'turn/end') reason = event.data.reason
  }
  return { text, reason, reasoning: reasoning.join('\n') }
}

async function run(ctx, task, io) {
  // userQuestions 是 dsh-base 注册的「用户提问」能力接口；headless profile 没有 UI provider
  // 也没加载 dsh-tool-ask-user。这里补齐两件事（与官方实现等价）：
  //   1. 注册 ask_user_question 工具（schema / execute 与 @deepseek-ai/dsh-tool-ask-user 一致）
  //   2. 注册 UI provider：把问题经 stdout marker 转发给主进程 → 渲染层选项列表；
  //      用户选择后主进程写 answerFile，这里轮询读取并返回给 agent。
  const userQuestions = ctx.get('userQuestions')
  const toolsRegistry = ctx.get('tools')
  // Ask 模式是纯问答：不注册 ask_user_question，从工具面彻底禁掉（persona 只是提示，模型可能不遵守）
  const aiartMode = (process.env.AIART_MODE || 'craft').trim()
  if (toolsRegistry?.register && aiartMode !== 'ask') {
    toolsRegistry.register(
      defineTool({
        name: 'ask_user_question',
        description:
          'Ask the user a concise question when you need confirmation, a choice, or missing information before proceeding. Send one or more questions, each with a stable id that will be echoed in the answer.',
        parameters: {
          questions: {
            type: 'array',
            required: true,
            description: 'Questions to ask the user before continuing.',
            items: {
              type: 'object',
              additionalProperties: true,
              properties: {
                id: {
                  type: 'string',
                  required: true,
                  description: 'Stable id for this question; echoed in the answer.'
                },
                question: {
                  type: 'string',
                  required: true,
                  description: 'The specific question to ask the user.'
                },
                header: {
                  type: 'string',
                  description: 'Optional short heading for the question, such as "Confirm" or "Choose Mode".'
                },
                options: {
                  type: 'array',
                  description:
                    'Optional choices to show the user. If you recommend one, put it first and append "(Recommended)" to that label.',
                  items: {
                    type: 'object',
                    additionalProperties: true,
                    properties: {
                      label: {
                        type: 'string',
                        required: true,
                        description: 'Short user-facing option label.'
                      },
                      description: {
                        type: 'string',
                        description: 'One sentence explaining the tradeoff or impact.'
                      }
                    }
                  }
                },
                multi_select: {
                  type: 'boolean',
                  description: 'Whether the user may select more than one option. Defaults to false.'
                }
              }
            }
          }
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              answers: {
                type: 'array',
                required: true,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    id: { type: 'string', required: true },
                    selected: { type: 'array', required: true, items: { type: 'string' } },
                    custom: { type: 'string' }
                  }
                }
              }
            }
          },
          // 官方 dsh-tool-ask-user 自带 render；缺它时 defineTool 会把 undefined 包进 render()
          // 导致工具结果渲染抛 TypeError（agent 报「渲染错误」），必须与官方保持一致
          render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }]
        },
        async execute(args, exec) {
          if (!userQuestions) throw new Error('userQuestions service is unavailable')
          const response = await userQuestions.ask({
            questions: args.questions.map((question) => ({
              id: question.id,
              question: question.question,
              ...(question.header !== undefined ? { header: question.header } : {}),
              ...(question.options !== undefined ? { options: question.options } : {}),
              ...(question.multi_select !== undefined ? { multiSelect: question.multi_select } : {})
            })),
            ...(exec.agent !== undefined ? { agent: exec.agent } : {}),
            signal: exec.signal
          })
          return {
            answers: response.answers.map((answer) => ({
              id: answer.id,
              selected: [...answer.selected],
              ...(answer.custom !== undefined ? { custom: answer.custom } : {})
            }))
          }
        }
      })
    )
  }
  if (userQuestions?.registerProvider) {
    userQuestions.registerProvider({
      async ask(request) {
        // 兜底：provider 内部任何异常都不向 agent 抛「工具出问题」，而是记录到 stderr 并返回空答案，
        // 便于主进程日志/状态栏定位（[aiart-runner] 错误行会透传显示）。
        try {
          const first = request.questions?.[0]
          if (!first) return { answers: [] }
          const runId = process.env.AIART_RUN_ID || 'run'
          const requestId = 'harness:' + runId + ':' + randomUUID()
          const answerFile = join(
            process.env.AIART_ASK_DIR || '',
            'aiart-ask-' + requestId.replace(/[^a-zA-Z0-9_-]/g, '-') + '.json'
          )
          io.stdout.write(
            ASK_USER_BEGIN +
              JSON.stringify({
                requestId,
                questionId: first.id,
                question: first.question,
                ...(first.header ? { hint: first.header } : {}),
                options: (first.options ?? []).map((option) => option.label),
                answerFile
              }) +
              '\n'
          )
          const deadline = Date.now() + 5 * 60 * 1000
          while (Date.now() < deadline) {
            try {
              const raw = readFileSync(answerFile, 'utf8')
              return JSON.parse(raw)
            } catch {
              // 回答文件尚未写入，继续等待
            }
            await new Promise((resolve) => setTimeout(resolve, 250))
          }
          return { answers: [{ id: first.id, selected: [] }] }
        } catch (error) {
          io.stderr.write(
            '[aiart-runner] ask-user provider error: ' +
              (error instanceof Error ? error.message : String(error)) +
              '\n'
          )
          const first = request.questions?.[0]
          return { answers: first ? [{ id: first.id, selected: [] }] : [] }
        }
      }
    })
  }
  await ctx.get('loader')?.await()
  const agents = ctx.get('agents')
  const defaultModel = ctx.get('agentDefaultModel')
  const sessions = ctx.get('sessions')
  if (agents === void 0 || defaultModel === void 0 || sessions === void 0) return
  const selection = defaultModel.currentSelection()
  // 原生持久化 session：外部传入固定会话 id 时「有则恢复、无则创建」，
  // 多轮对话是真实消息序列（含工具调用历史），模型通过会话恢复记住之前的聊天内容。
  // 未传 id（回退）时仍按一次性会话处理，避免意外污染历史。
  const sessionId = (process.env.AIART_SESSION_ID || '').trim() || 'session-' + randomUUID()
  const agentOptions = { provider: selection.provider, model: selection.model }
  const setup = (agentCtx) => {
    installModelSelection(agentCtx, {
      current: selection,
      assembled: void 0
    })
  }
  let agent
  const persistence = ctx.get('sessionPersistence')
  if (persistence !== void 0 && process.env.AIART_SESSION_ID?.trim()) {
    try {
      const resumed = await agents.resume({ resumeSessionId: sessionId, agentOptions, setup })
      agent = resumed.agent
      io.stderr.write('[aiart-runner] resumed session: ' + sessionId + '\n')
    } catch (error) {
      io.stderr.write(
        '[aiart-runner] resume failed: ' + (error instanceof Error ? error.message : String(error)) + '\n'
      )
      // 记录确实存在却恢复失败 = 会话数据损坏，直接失败（不可回退为同 id 新建，否则与旧日志冲突）
      if ((await persistence.list()).some((h) => h.id === sessionId)) throw error
    }
  }
  if (agent === void 0) {
    const created = await agents.create({
      sessionId: SessionId(sessionId),
      meta: { cwd: process.cwd() },
      agentOptions,
      setup
    })
    agent = created.agent
  }
  await agent.whenIdle()
  const firstSeq = agent.session.seq

  // 流式驱动：轮询事件日志，把 text-delta / reasoning-delta 实时写 stdout，
  // 思考内容包在 REASONING_BEGIN/END 标记之间（marker 独占一行，正文不换行）。
  // 工具调用（skill / MCP 等）包在 TOOL_BEGIN/END 标记之间，每行一个 JSON 描述。
  let lastSeq = firstSeq
  let inReasoning = false
  let streamedText = false
  const pendingTools = new Map() // callId -> name
  const flushEvents = () => {
    const events = agent.session.events
    for (; lastSeq < events.length; lastSeq++) {
      const event = events[lastSeq]
      if (event.type === 'tool/call') {
        const callId = event.data?.callId
        if (typeof callId === 'string' && !pendingTools.has(callId)) {
          const name = event.data?.name || 'tool'
          pendingTools.set(callId, name)
          io.stdout.write(TOOL_BEGIN + JSON.stringify({ name, callId, detail: summarizeToolArgs(event.data?.arguments) }) + '\n')
        }
        continue
      }
      if (event.type === 'tool/result') {
        const callId = event.data?.message?.source?.callId
        if (typeof callId === 'string') {
          const name = pendingTools.get(callId) || 'tool'
          pendingTools.delete(callId)
          io.stdout.write(TOOL_END + JSON.stringify({ name, callId }) + '\n')
        }
        continue
      }
      // provider 精确上下文用量：每轮 LLM 请求完成后 assistant/message 事件携带 usage，
      // 通过 marker 转发给主进程 → 渲染层显示真实上下文占用
      if (event.type === 'assistant/message' && event.data?.usage) {
        const usage = event.data.usage
        if (typeof usage.inputTokens === 'number' && usage.inputTokens >= 0) {
          io.stdout.write(CONTEXT_BEGIN + JSON.stringify(usage) + '\n')
        }
        continue
      }
      if (event.type !== 'assistant/chunk') continue
      const chunk = event.data?.chunk
      if (!chunk) continue
      if (chunk.type === 'reasoning-delta' && typeof chunk.text === 'string' && chunk.text !== '') {
        if (!inReasoning) {
          inReasoning = true
          io.stdout.write(REASONING_BEGIN + '\n')
        }
        io.stdout.write(chunk.text)
      } else if (chunk.type === 'text-delta' && typeof chunk.text === 'string' && chunk.text !== '') {
        streamedText = true
        io.stdout.write(chunk.text)
      }
    }
  }

  const timer = setInterval(flushEvents, 30)
  try {
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: task }],
      source: { kind: 'user' }
    }))
    await agent.whenIdle()
  } finally {
    clearInterval(timer)
  }
  flushEvents()
  if (inReasoning) io.stdout.write('\n' + REASONING_END + '\n')
  const outcome = summarize(agent.session.events, firstSeq)
  // 兜底：没有任何 text delta 时（异常/纯工具轮次），用最终消息补齐一次
  if (!streamedText && outcome.text) io.stdout.write(outcome.text + '\n')
  if (outcome.reason?.kind === 'error') {
    io.stderr.write('dsh: ' + outcome.reason.error.code + ': ' + outcome.reason.error.message + '\n')
  }
  io.exit(outcome.reason?.kind === 'completed' ? 0 : 1)
}

function apply(ctx, config) {
  const exit = ctx.get('appExit')
  if (exit === void 0) {
    throw new Error('aiart-headless-runner: the launcher must provide ctx.appExit before the tree mounts')
  }
  const io = { stdout: process.stdout, stderr: process.stderr, exit }
  run(ctx, config.task, io).catch((error) => {
    io.stderr.write('dsh: ' + (error instanceof Error ? error.message : String(error)) + '\n')
    io.exit(1)
  })
}

export { Config, apply, inject, name }
`

/**
 * 从 dsh 运行入口向上定位其 node_modules 根（依赖 @deepseek-ai/* 都在同一棵树下）。
 * 返回绝对路径；向上 8 层仍找不到则返回 null（视为无法解析依赖，跳过注入）。
 */
function locateNodeModules(entry: string): string | null {
  let dir = dirname(entry)
  for (let i = 0; i < 8; i++) {
    if (basename(dir) === 'node_modules') return dir
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
  return null
}

/**
 * 按 Chat 面板模式生成 dsh system-prompt persona（YAML 折叠块延续行，缩进 6 空格）。
 * - craft：完整 agent，优先用 MCP 工具；需要用户选择/确认时用 ask_user 工具
 * - ask：纯问答，禁止调用工具与改动任何文件
 * - plan：先输出执行计划，用 ask_user 请求用户确认，确认后才允许执行工具
 */
function buildPersona(mode: ChatMode): string[] {
  const base = [
    'You are a helpful assistant in AIArtEngine. You have access to MCP tools provided by the studio.',
    'Prefer using the available MCP tools to complete the user request.',
    'Only write code when no suitable tool is available.',
    'The user may reference project assets by writing @ followed by a workspace-relative path (e.g. @Assets/Images/foo.png).',
    'When you see such references, confirm the paths with asset_list if needed, then pass the relative path directly',
    'to the appropriate generate_* tool argument (referenceImageUrls / firstFrameImageUrl / inputReferences),',
    'and mention the reference with @n or a clear label in the prompt text so the model aligns with it.'
  ]
  if (mode === 'ask') {
    return [
      ...base,
      'You are currently running in Ask mode: answer the user question directly and concisely using your knowledge.',
      'Do NOT call any MCP tool, do NOT modify any file, and do NOT generate any asset.',
      'If the request requires actions, briefly explain what you would do and suggest switching to Craft or Plan mode.'
    ]
  }
  if (mode === 'plan') {
    return [
      ...base,
      'You are currently running in Plan mode: before doing anything, first present a clear step-by-step execution plan.',
      'After presenting the plan, call the ask_user_question tool to ask the user whether to proceed,',
      'offering self-contained options such as "Proceed", "Adjust", and "Cancel".',
      'Only after the user confirms may you call other MCP tools to execute the plan.',
      'Do NOT modify files or generate assets before the user confirms the plan.'
    ]
  }
  return [
    ...base,
    'When you need the user to choose or confirm (e.g. picking between options, approving an action before it runs),',
    'call the ask_user_question tool with a concise question and 2-6 self-contained options, and wait for the user answer before proceeding.'
  ]
}

/**
 * 写自定义 runner 与 overlay patch（禁用原 headless-runner、注入 aiart-runner）。
 * 返回 patch 文件路径；任何一步失败返回 null（回退原 headless 行为，不影响主流程）。
 */
function writeAiartHarness(dshNodeModules: string, mode: ChatMode = 'craft'): string | null {
  try {
    const home = dshHome()
    mkdirSync(home, { recursive: true })
    const runnerPath = join(home, 'aiart-headless-runner.mjs')
    writeFileSync(
      runnerPath,
      AIART_RUNNER_TEMPLATE.replace('__DSH_NODE_MODULES_JSON__', JSON.stringify(resolve(dshNodeModules))),
      'utf8'
    )
    const runnerUrl = pathToFileURL(runnerPath).href
    const patch = [
      '# AIArtEngine 生成的 headless overlay：输出思考过程，请勿手改。',
      '- id: headless-runner',
      "  name: '@deepseek-ai/dsh-headless'",
      '  disabled: true',
      '- insert:',
      '    - id: aiart-runner',
      `      name: '${runnerUrl}'`,
      '      inject: [headlessStartup]',
      '      config:',
      '        task: !!js ctx.headlessStartup.task',
      '- id: system-prompt',
      '  config:',
      '    persona: >-',
      ...buildPersona(mode).map((line) => `      ${line}`)
    ]
    const patchPath = join(home, 'aiart.patch.yml')
    writeFileSync(patchPath, patch.join('\n') + '\n', 'utf8')
    return patchPath
  } catch {
    return null
  }
}

/**
 * 拉起一次 dsh 进程：spawn、按行转发输出、处理结束。
 *
 * dsh 的 headless profile 是一次性的（跑完即退），所以每条任务必然一个新进程；
 * 任务本身执行失败不重试——那会重复消耗 token，且用户意图已经明确失败。
 */
function launchDsh(opts: {
  command: string
  args: string[]
  workspace: string
  env: NodeJS.ProcessEnv
  runId: string
  dshEntry: string | null
}): void {
  const { command, args, workspace, env, runId, dshEntry } = opts
  const proc = spawn(command, args, { cwd: workspace, windowsHide: true, shell: false, env })
  child = proc
  const startedAt = Date.now()

  let sawOutput = false
  let finalText = ''
  let errBuf = ''
  // 自定义 runner 流式输出：fullOut 累积 stdout，parsedLen 标记已解析位置。
  // 增量文本可能不换行，marker（BEGIN/END）独占一行，也可能被 chunk 切断，
  // 因此每次 data 事件都重新扫描「新增区段」，残段是 marker 前缀时留待补齐。
  let fullOut = ''
  let parsedLen = 0
  let inReasoning = false
  let reasoningBuf = ''

  const isMarkerPrefix = (s: string): boolean =>
    s.length > 0 &&
    (REASONING_BEGIN.startsWith(s) ||
      REASONING_END.startsWith(s) ||
      s.startsWith(TOOL_BEGIN) ||
      s.startsWith(TOOL_END) ||
      s.startsWith(ASK_USER_BEGIN) ||
      s.startsWith(CONTEXT_BEGIN))

  const emitAssistantDelta = (delta: string): void => {
    if (!delta) return
    sawOutput = true
    finalText += delta
    emit({ type: 'assistant', text: delta })
  }

  /** 解析 runner 输出的工具调用标记行（===BEGIN/END_TOOL=== 前缀 + JSON 载荷） */
  const emitToolFromLine = (line: string, state: 'start' | 'done'): void => {
    const marker = state === 'start' ? TOOL_BEGIN : TOOL_END
    const payload = line.slice(marker.length).trim()
    let name = 'tool'
    let detail: string | undefined
    let id: string | undefined
    try {
      const parsed = JSON.parse(payload)
      if (typeof parsed.name === 'string' && parsed.name) name = parsed.name
      if (typeof parsed.detail === 'string' && parsed.detail) detail = parsed.detail
      // callId 作为任务实例 ID 透传给渲染层，使同一工具多次调用可以区分并各自更新状态
      if (typeof parsed.callId === 'string' && parsed.callId) id = parsed.callId
    } catch {
      // 载荷非 JSON 时退回通用工具名（不阻塞对话）
    }
    emit({ type: 'tool', ...(id ? { id } : {}), name, state, ...(detail ? { detail } : {}) })
    sawOutput = true
  }

  /** 解析 runner 输出的 ask_user_question 提问标记（===BEGIN_ASK_USER=== + JSON 载荷），转发渲染层 */
  const emitAskUserFromLine = (line: string): void => {
    const payload = line.slice(ASK_USER_BEGIN.length).trim()
    try {
      const parsed = JSON.parse(payload)
      if (typeof parsed.requestId !== 'string' || typeof parsed.question !== 'string') return
      harnessAskUserRequests.set(parsed.requestId, {
        runId,
        answerFile: typeof parsed.answerFile === 'string' ? parsed.answerFile : '',
        questionId: typeof parsed.questionId === 'string' ? parsed.questionId : 'q1'
      })
      broadcastToAllWindows(IpcChannels.MCP_ASK_USER, {
        requestId: parsed.requestId,
        question: parsed.question,
        ...(typeof parsed.hint === 'string' && parsed.hint ? { hint: parsed.hint } : {}),
        ...(Array.isArray(parsed.options) && parsed.options.length
          ? { options: parsed.options }
          : {})
      })
      sawOutput = true
    } catch {
      // 载荷非 JSON：忽略，不阻塞对话
    }
  }

  /** 解析 runner 输出的上下文用量标记（===BEGIN_CONTEXT=== + provider usage JSON），转发渲染层 */
  const emitContextFromLine = (line: string): void => {
    const payload = line.slice(CONTEXT_BEGIN.length).trim()
    try {
      const parsed = JSON.parse(payload)
      if (typeof parsed.inputTokens !== 'number' || parsed.inputTokens < 0) return
      const cacheRead =
        typeof parsed.cacheReadTokens === 'number' && parsed.cacheReadTokens > 0 ? parsed.cacheReadTokens : 0
      const cacheWrite =
        typeof parsed.cacheWriteTokens === 'number' && parsed.cacheWriteTokens > 0 ? parsed.cacheWriteTokens : 0
      emit({ type: 'context', used: Math.round(parsed.inputTokens + cacheRead + cacheWrite) })
      sawOutput = true
    } catch {
      // 载荷非 JSON：忽略，不阻塞对话
    }
  }

  const parseStdout = (until: number): void => {
    let i = parsedLen
    let start = i
    while (i < until) {
      if (fullOut[i] === '\n') {
        const line = stripAnsi(fullOut.slice(start, i)).trim()
        start = i + 1
        if (line) {
          if (line === REASONING_BEGIN) {
            inReasoning = true
            reasoningBuf = ''
            sawOutput = true
          } else if (inReasoning && line === REASONING_END) {
            inReasoning = false
            emit({ type: 'reasoning', text: reasoningBuf })
          } else if (inReasoning) {
            reasoningBuf = reasoningBuf ? reasoningBuf + '\n' + line : line
            emit({ type: 'reasoning', text: reasoningBuf })
          } else if (line.startsWith(TOOL_BEGIN)) {
            emitToolFromLine(line, 'start')
          } else if (line.startsWith(TOOL_END)) {
            emitToolFromLine(line, 'done')
          } else if (line.startsWith(ASK_USER_BEGIN)) {
            emitAskUserFromLine(line)
          } else if (line.startsWith(CONTEXT_BEGIN)) {
            emitContextFromLine(line)
          } else {
            emitAssistantDelta(line + '\n')
          }
        }
      }
      i++
    }
    // 未换行的残段：流式文本/思考内容立即转发（若是 marker 前缀则留待补齐）
    if (start < until) {
      const tail = stripAnsi(fullOut.slice(start, until))
      if (tail) {
        if (isMarkerPrefix(tail)) {
          // 可能是 BEGIN/END/TOOL 的半截，保留在 fullOut 等待后续数据
        } else if (inReasoning) {
          reasoningBuf += tail
          emit({ type: 'reasoning', text: reasoningBuf })
        } else {
          emitAssistantDelta(tail)
        }
      }
    }
    parsedLen = until
  }

  const onData = (chunk: Buffer | string, source: 'out' | 'err'): void => {
    if (source === 'err') {
      errBuf += String(chunk)
      const lines = errBuf.split('\n')
      errBuf = lines.pop() ?? ''
      for (const raw of lines) {
        const line = stripAnsi(raw).trim()
        if (!line) continue
        // 过滤 runner 的调试输出（tools 列表等），避免每次任务刷屏进聊天面板；
        // 但 error/fail 级别行（如 ask-user provider 异常）要透传状态栏，便于定位问题
        if (line.startsWith('[aiart-runner]')) {
          if (/error|fail|abort/i.test(line)) emitStatus(line)
          continue
        }
        emitStatus(line)
      }
      return
    }
    fullOut += String(chunk)
    parseStdout(fullOut.length)
  }

  proc.stdout?.on('data', (chunk) => onData(chunk, 'out'))
  proc.stderr?.on('data', (chunk) => onData(chunk, 'err'))
  proc.on('error', (err) => {
    if (child === proc) child = null
    emit({ type: 'error', message: `dsh 启动失败：${err.message}` })
  })
  proc.on('close', (code) => {
    if (child === proc) child = null
    // 清理本次运行的待回传提问（任务结束，agent 侧等待会走超时分支返回空答案）
    for (const [id, entry] of harnessAskUserRequests) {
      if (entry.runId === runId) harnessAskUserRequests.delete(id)
    }
    // 末尾未换行的残段最后解析一次；若思考段因异常未闭合，补发一次
    if (parsedLen < fullOut.length) parseStdout(fullOut.length)
    if (inReasoning) emit({ type: 'reasoning', text: reasoningBuf })
    const failed = code !== 0 && !sawOutput
    emit({ type: 'tool', name: 'dsh-agent', state: 'done' })
    if (failed) {
      const hint = dshEntry
        ? '请重试或查看上方状态信息'
        : '若为首次运行，请等待包下载完成后重试'
      emit({ type: 'error', message: `dsh 异常退出（code ${code}）。${hint}。` })
    } else {
      emit({ type: 'done', runId })
      // 流式期间已把文本通过 assistant 事件实时下发，final 仅标记「回答已完成」
      if (finalText) emit({ type: 'final', text: finalText })
    }
  })

  // 仅 npx 现场拉包时保留超时兜底（下载可能悬挂）；内置运行体执行时长不可预测，交给用户手动中止
  if (!dshEntry) {
    const timeout = setTimeout(() => {
      if (child !== proc) return
      emitStatus('dsh 响应超时，正在中止（可重试）')
      proc.kill()
    }, NPX_TIMEOUT_MS)
    // 文本带等待秒数：emitStatus 会合并完全相同的相邻行，固定文案只会出现一次
    const progress = setInterval(() => {
      if (child !== proc) return
      const waited = Math.round((Date.now() - startedAt) / 1000)
      emitStatus(`仍在准备 dsh 运行体（首次运行需联网下载，已等待 ${waited}s）…`)
    }, NPX_PROGRESS_HINT_MS)
    const stopTimers = (): void => {
      clearTimeout(timeout)
      clearInterval(progress)
    }
    proc.once('close', stopTimers)
    proc.once('error', stopTimers)
  }
}

export async function runHarnessTask(input: HarnessRunInput): Promise<HarnessRunResult> {
  const rawTask = String(input?.task ?? '').trim()
  if (!rawTask) return { started: false, message: '任务内容为空' }
  if (child) return { started: false, message: '已有任务正在运行' }
  // 历史由 dsh 原生持久化 session 恢复（见 runner 模板），任务文本直接透传用户原文
  const task = rawTask

  const mcp = getMcpServerInfo()
  if (!mcp?.running) {
    return { started: false, message: 'MCP 工具服务未运行，请先在设置中启动' }
  }
  const provider = resolveTextProvider(input?.providerId)
  if (!provider) {
    return { started: false, message: '未配置可用文本模型，请先在模型设置中添加' }
  }
  writeDshConfig(mcp.endpoint)
  // dsh 不读 DSH_MODEL 环境变量，模型必须写进 settings.yaml，否则始终用内置默认
  // deepseek-v4-flash（多数端点不存在 → HTTP_404），与面板选择无关。
  writeDshSettings({
    baseUrl: provider.baseUrl,
    modelId: input.model?.trim() || provider.modelId
  })
  // 把应用内置 GraphSkill 快照为 dsh 的 SKILL.md（$DSH_HOME/skills），
  // 让 AI 对话里的 agent 能发现并加载应用技能（skill-filesystem 默认扫描该目录）。
  writeDshSkills()
  const workspace = resolveWorkspace()
  const runId = String(++runSeq)
  lastStatusText = ''
  const dshEntry = resolveDshEntry()
  emitStatus(
    dshEntry
      ? '正在启动 DeepSeek Harness…'
      : '首次运行：正在准备 dsh 运行体（需联网，约 1–2 分钟）'
  )
  // 工作区只在切换时提示一次，避免每条消息都重复输出同一行
  if (workspaceNotified !== workspace) {
    workspaceNotified = workspace
    emitStatus(
      workspace === app.getPath('userData')
        ? '未打开工程：AI 工作区为应用数据目录（建议先打开工程）'
        : `工作区：${workspace}`
    )
  }
  emit({ type: 'tool', name: 'dsh-agent', state: 'start' })

  const command = dshEntry ? 'node' : process.platform === 'win32' ? 'npx.cmd' : 'npx'
  // 本地/内置 dsh 时可注入自定义 runner 输出思考过程；npx 现场拉包时无法预知
  // 依赖树位置，保持原 headless 行为（无 reasoning，不影响主流程）。
  const dshModules = dshEntry ? locateNodeModules(dshEntry) : null
  const patchPath = dshModules ? writeAiartHarness(dshModules, input.mode ?? 'craft') : null
  const args = dshEntry
    ? [
        dshEntry,
        '--profile',
        'headless',
        ...(patchPath ? ['--patch', patchPath] : []),
        task
      ]
    : ['--yes', DSH_PACKAGE, '--profile', 'headless', task]
  launchDsh({
    command,
    args,
    workspace,
    env: {
      ...process.env,
      DSH_HOME: dshHome(),
      DEEPSEEK_API_KEY: provider.apiKey,
      // 注意：dsh v0.1 不读取 DSH_MODEL（模型只走 settings.yaml 的 agent-default-model）。
      // 保留该变量仅作兼容占位，实际选择见上方 writeDshSettings。
      DSH_MODEL: input.model?.trim() || provider.modelId,
      ...(provider.baseUrl ? { DEEPSEEK_BASE_URL: provider.baseUrl } : {}),
      // MCP 插件配置里的 header 由该变量展开；name 为 /TOKEN/ 会被 dsh 清洗，故用 STUDIO_ 前缀
      STUDIO_MCP_TOKEN: mcp.token,
      // 原生持久化 session：runner 据此「有则恢复、无则创建」（见 AIART_RUNNER_TEMPLATE）
      ...(input.sessionId?.trim() ? { AIART_SESSION_ID: input.sessionId.trim() } : {}),
      // ask_user_question 提问的临时目录与本次运行 id：runner 经 answerFile 与主进程交换用户选择
      AIART_ASK_DIR: join(app.getPath('temp'), 'aiart-harness-ask'),
      AIART_RUN_ID: runId,
      // 当前模式：Ask 模式下 runner 不注册 ask_user_question 工具（persona 只禁 MCP 工具，拦不住原生工具）
      AIART_MODE: input.mode ?? 'craft'
    } as NodeJS.ProcessEnv,
    runId,
    dshEntry
  })

  return { started: true }
}

export function abortHarnessTask(): void {
  if (!child) return
  emit({ type: 'status', text: '已请求中止' })
  child.kill()
  child = null
}

/**
 * 渲染层回传 ask_user_question 的用户选择（经 main/ipc.ts 分发，requestId 以 harness: 开头）：
 * 把选择写入 answerFile，runner 侧 provider 轮询读到后把答案返回给 agent。
 */
export function handleAskUserResponse(payload: AskUserAnswer): void {
  const entry = harnessAskUserRequests.get(payload.requestId)
  if (!entry || !entry.answerFile) return
  harnessAskUserRequests.delete(payload.requestId)
  try {
    mkdirSync(dirname(entry.answerFile), { recursive: true })
    writeFileSync(
      entry.answerFile,
      JSON.stringify({
        answers: [
          {
            id: entry.questionId,
            selected:
              typeof payload.answer === 'string' && payload.answer !== ''
                ? [payload.answer]
                : []
          }
        ]
      }),
      'utf8'
    )
  } catch {
    // 写文件失败：runner 侧 5 分钟超时返回空答案，agent 正常继续
  }
}

/**
 * 删除会话在磁盘上的持久化记录（`$DSH_HOME/sessions/<project>/<id>/`）。
 *
 * 前端删除会话后调用：否则 localStorage 里的会话没了，但 dsh 的 JSONL 日志仍在，
 * 下次同 id 发消息会被「幽灵恢复」成已删除的对话。路径布局与
 * dsh-session-persistence-jsonl 保持一致（root = dshHomePath('sessions')，按项目分目录）。
 */
export async function deleteHarnessSession(sessionId: string): Promise<void> {
  const id = String(sessionId ?? '').trim()
  // 只放行安全字符，防止把删除目标带出 sessions 目录
  if (!id || !/^[A-Za-z0-9._-]+$/.test(id)) return
  const sessionsRoot = join(dshHome(), 'sessions')
  let entries
  try {
    entries = await readdir(sessionsRoot, { withFileTypes: true })
  } catch {
    return // 尚无任何会话记录
  }
  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        try {
          await rm(join(sessionsRoot, entry.name, id), { recursive: true, force: true })
        } catch {
          // 单个项目目录清理失败不阻塞整体删除
        }
      })
  )
}

/** 应用退出时清理子进程，避免残留 npx 拉起的 dsh */
app.on('will-quit', () => {
  if (child) {
    child.kill()
    child = null
  }
})
