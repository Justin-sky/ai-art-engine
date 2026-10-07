#!/usr/bin/env node
/**
 * 把应用内置预设的 plan **导出**到工作流市场仓库。
 *
 * 为什么需要这个脚本：官方那 15 条市场工作流的 `plan` 与应用 `getAiWorkflowPresetPlan()`
 * 是**同一张图的拷贝**（应用构建期一份、市场下载一份）。实测两份逐字段相同 —— 说明是人手
 * 同步过来的，而**两侧都没有任何守卫**：应用测试读不到市场仓库，市场校验器不认识应用预设。
 * 一旦只改一边，内置「一键工作流」与市场装出来的工作流就会**同名同版本却生成不同的图**，
 * 两边都不报错。
 *
 * 所以这里把"人手同步"换成"生成 + 校验"：
 *   node scripts/export-market-workflows.mjs            # 生成（写回市场仓库）
 *   node scripts/export-market-workflows.mjs --check    # 只校验，有差异则退出码 1（给 CI 用）
 *
 * 只动两个字段：`plan` 与 `requires.nodeTypes`（后者是 plan 的派生值，市场校验器要求两者一致）。
 * 元数据、封面、`skill/` 全部保持手写、不碰。
 *
 * 生成后到市场仓库里跑（索引与派生字段由那个仓库自己的脚本负责）：
 *   node scripts/build-index.mjs && node scripts/validate.mjs
 *
 * 用法：
 *   --dir <path>   市场仓库根目录（默认 ../ai-art-engine-workflow，可用 AAE_WORKFLOW_MARKET_DIR）
 *   --check        只检查不写盘；存在差异时退出码 1
 *   --only <id>    只处理一条（预设 id `anim2dGif` 或市场 id `anim2d-gif`）
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 预设 id（camelCase）→ 市场 id / 目录名（kebab-case） */
function kebab(id) {
  return id.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
}

/**
 * 载入应用侧的预设定义。
 *
 * 预设与派生子都在 `.ts` 里，而本仓库的脚本都是 `.mjs`（没有 tsx / ts-node）。
 * 好在 esbuild 本就是 vite 的依赖：用它在内存里打成一份 ESM 落到临时文件再 import，
 * 这样用的就是**应用真正在用的那一份数据**，而不是脚本里再抄一遍。
 */
async function loadAppData() {
  const { build } = await import('esbuild')
  const dir = mkdtempSync(join(tmpdir(), 'aae-presets-'))
  try {
    const result = await build({
      stdin: {
        contents: `
          export { AI_WORKFLOW_PRESET_IDS, getAiWorkflowPresetPlan } from './src/shared/graph/aiWorkflowPresets'
          export { nodeTypesOfPlan } from './src/shared/workflowMarket'
        `,
        resolveDir: ROOT,
        loader: 'ts',
        sourcefile: 'aae-preset-entry.ts'
      },
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'node',
      target: 'node20',
      // 应用用 `@shared/*` 路径别名（见 tsconfig 与 electron.vite.config.ts），esbuild 不认
      alias: { '@shared': join(ROOT, 'src', 'shared') },
      logLevel: 'silent'
    })
    const out = join(dir, 'presets.mjs')
    writeFileSync(out, result.outputFiles[0].text, 'utf8')
    return await import(pathToFileURL(out).href)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** 定位顶层 `"key": <value>` 的值区间（按缩进锚定，避免匹配到字符串里的同名文本） */
function findTopLevelValue(raw, key) {
  const m = new RegExp(`^ {2}"${key}":`, 'm').exec(raw)
  if (!m) return null
  let i = raw.indexOf(':', m.index) + 1
  while (i < raw.length && /\s/.test(raw[i])) i += 1
  const start = i
  const open = raw[i]
  if (open !== '{' && open !== '[') return null
  const close = open === '{' ? '}' : ']'
  let depth = 0
  let inStr = false
  let esc = false
  for (; i < raw.length; i += 1) {
    const c = raw[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === open) depth += 1
    else if (c === close) {
      depth -= 1
      if (depth === 0) return { start, end: i + 1 }
    }
  }
  return null
}

/** 序列化并缩进到顶层键的值位置（顶层键缩进 2 格，所以内容整体再缩进 2 格） */
function serializeAtIndent(value, indent) {
  const pad = ' '.repeat(indent)
  return JSON.stringify(value, null, 2)
    .split('\n')
    .map((line, i) => (i === 0 ? line : pad + line))
    .join('\n')
}

/** 只替换 plan 与 requires.nodeTypes，其余一个字节都不动 */
function rewrite(raw, plan, nodeTypes) {
  const planSpan = findTopLevelValue(raw, 'plan')
  if (!planSpan) throw new Error('找不到顶层 plan 字段')
  let next = raw.slice(0, planSpan.start) + serializeAtIndent(plan, 2) + raw.slice(planSpan.end)

  const reqSpan = findTopLevelValue(next, 'requires')
  if (reqSpan) {
    const before = next.slice(0, reqSpan.start)
    const body = next.slice(reqSpan.start, reqSpan.end)
    const after = next.slice(reqSpan.end)
    // 沿用 `"nodeTypes"` 那一行自身的缩进：市场上这些数组是 prettier 排过的多行形式，
    // 压成一行虽然内容一样，但会制造一个纯粹是排版的巨大 diff。
    const m = /( *)"nodeTypes"\s*:\s*\[[^\]]*\]/.exec(body)
    if (!m) throw new Error('requires 里没有 nodeTypes')
    const keyIndent = m[1].length
    const patched = body.replace(
      /( *)"nodeTypes"\s*:\s*\[[^\]]*\]/,
      `${m[1]}"nodeTypes": ${serializeAtIndent(nodeTypes, keyIndent)}`
    )
    next = before + patched + after
  }
  return next
}

function parseArgs(argv) {
  const opts = {
    dir: process.env.AAE_WORKFLOW_MARKET_DIR ?? resolve(ROOT, '..', 'ai-art-engine-workflow'),
    check: false,
    only: null
  }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--check') opts.check = true
    else if (a === '--dir') opts.dir = argv[++i]
    else if (a === '--only') opts.only = argv[++i]
    else if (a === '--help' || a === '-h') opts.help = true
    else throw new Error(`未知参数：${a}`)
  }
  return opts
}

const opts = parseArgs(process.argv.slice(2))
if (opts.help) {
  console.log(
    readFileSync(fileURLToPath(import.meta.url), 'utf8')
      .split('*/')[0]
      .replace(/^\/\*\*?/, '')
  )
  process.exit(0)
}

const dir = resolve(opts.dir)
if (!existsSync(join(dir, 'workflows'))) {
  console.error(`✗ 市场仓库目录不对（没有 workflows/）：${dir}`)
  console.error('  用 --dir 指定，或设 AAE_WORKFLOW_MARKET_DIR。')
  process.exit(2)
}

const { AI_WORKFLOW_PRESET_IDS, getAiWorkflowPresetPlan, nodeTypesOfPlan } = await loadAppData()

/**
 * 市场索引里"已发布"的 id 集合。
 *
 * 用来区分两种"找不到目录"：**从没发布过**（合法，跳过）与**发布过但现在没了**
 * （目录被改名/删除 —— 那内置预设与市场条目就悄悄对不上了，必须报错）。
 */
const publishedIds = new Set()
const indexPath = join(dir, 'index.json')
if (existsSync(indexPath)) {
  try {
    const index = JSON.parse(readFileSync(indexPath, 'utf8'))
    for (const w of index.workflows ?? []) if (w?.id) publishedIds.add(w.id)
  } catch {
    console.warn('  ⚠ index.json 无法解析，跳过"曾发布过"的判断')
  }
}

/** 只处理预设 id（`custom` 不是一条具体工作流） */
let targets = AI_WORKFLOW_PRESET_IDS.filter((id) => id !== 'custom')
if (opts.only) {
  const want = opts.only
  targets = targets.filter((id) => id === want || kebab(id) === want)
  if (!targets.length) {
    console.error(`✗ --only ${want} 没匹配到任何预设`)
    process.exit(2)
  }
}

const rows = []
let changed = 0
let unpublished = 0
let vanished = 0

for (const presetId of targets) {
  const marketId = kebab(presetId)
  const file = join(dir, 'workflows', marketId, 'workflow.json')
  if (!existsSync(file)) {
    if (publishedIds.has(marketId)) {
      rows.push(
        `  ✗ ${marketId.padEnd(16)} 索引里有这条，但 workflows/${marketId}/workflow.json 不在了`
      )
      vanished += 1
    } else {
      rows.push(`  – ${marketId.padEnd(16)} 市场里没有这条（未发布，跳过）`)
      unpublished += 1
    }
    continue
  }

  const raw = readFileSync(file, 'utf8')
  const plan = JSON.parse(JSON.stringify(getAiWorkflowPresetPlan(presetId)))
  const nodeTypes = nodeTypesOfPlan(plan)
  const next = rewrite(raw, plan, nodeTypes)
  if (next === raw) {
    rows.push(`  ✓ ${marketId.padEnd(16)} 已是最新`)
    continue
  }

  // 说清**差在哪**，而不是只说"不一致"
  const why = []
  try {
    const before = JSON.parse(raw)
    if (JSON.stringify(before.plan) !== JSON.stringify(plan)) {
      const bt = nodeTypesOfPlan(before.plan)
      if (JSON.stringify(bt) !== JSON.stringify(nodeTypes)) {
        why.push(`节点类型 ${JSON.stringify(bt)} → ${JSON.stringify(nodeTypes)}`)
      } else {
        why.push('plan 内容有变（节点类型没变，多半是参数变了）')
      }
    }
    if (
      JSON.stringify([...(before.requires?.nodeTypes ?? [])].sort()) !== JSON.stringify(nodeTypes)
    ) {
      why.push('requires.nodeTypes 与 plan 不一致')
    }
  } catch {
    why.push('原文件无法解析')
  }
  rows.push(`  ${opts.check ? '✗' : '✎'} ${marketId.padEnd(16)} ${why.join('；')}`)
  if (!opts.check) writeFileSync(file, next, 'utf8')
  changed += 1
}

console.log(`\n市场仓库：${dir}\n${rows.join('\n')}\n`)
console.log(
  `  合计 ${targets.length} 条：需更新 ${changed}、已最新 ${targets.length - changed - unpublished - vanished}、未发布 ${unpublished}、缺失 ${vanished}`
)

if (vanished > 0) {
  console.log('\n✗ 有官方工作流在市场索引里、目录却没了 —— 改名或删除都要同步内置预设。')
  process.exit(1)
}

if (changed > 0) {
  if (opts.check) {
    console.log(
      '\n✗ 有工作流与内置预设不一致 —— 跑 `npm run export:market` 重新生成，然后提交市场仓库。'
    )
    process.exit(1)
  }
  console.log(
    '\n下一步（在市场仓库里执行）：node scripts/build-index.mjs && node scripts/validate.mjs'
  )
} else {
  console.log('\n✓ 官方工作流与内置预设一致。')
}
