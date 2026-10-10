/**
 * 加载官方 / 已安装的 Semantic Pack（仅 JSON）。
 */
import { existsSync, readdirSync, readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import {
  parseSemanticPack,
  validateSemanticPack,
  type SemanticPack
} from '@shared/semanticTimeline'

function bundledPacksDir(): string {
  // 源码树：src/shared/semanticTimeline/marketPacks
  // 编译后可能在 out/...；优先相对本文件上溯
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    const candidates = [
      // 开发态：与引擎并列的官方工作流仓库
      join(
        process.cwd(),
        '../ai-art-engine-workflow/workflows/commerce-semantic-variants/semanticPacks'
      ),
      join(
        here,
        '../../../../ai-art-engine-workflow/workflows/commerce-semantic-variants/semanticPacks'
      ),
      // 兼容旧路径（若仍有本地副本）
      join(here, '../../../shared/semanticTimeline/marketPacks'),
      join(process.cwd(), 'src/shared/semanticTimeline/marketPacks')
    ]
    for (const c of candidates) {
      if (existsSync(c)) return c
    }
  } catch {
    /* cjs */
  }
  return join(process.cwd(), 'src/shared/semanticTimeline/marketPacks')
}

export function loadBundledSemanticPacks(): SemanticPack[] {
  const dir = bundledPacksDir()
  if (!existsSync(dir)) return []
  const packs: SemanticPack[] = []
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue
    // 工作流清单与数据包共存于 marketPacks/，跳过非 pack
    if (name.startsWith('workflow-')) continue
    try {
      const raw = JSON.parse(readFileSync(join(dir, name), 'utf8')) as unknown
      const pack = parseSemanticPack(raw)
      if (pack) packs.push(pack)
    } catch {
      /* skip bad file */
    }
  }
  return packs
}

export function loadInstalledSemanticPacks(installDir: string): SemanticPack[] {
  if (!existsSync(installDir)) return []
  const packs: SemanticPack[] = []
  for (const name of readdirSync(installDir)) {
    const file = join(installDir, name, 'pack.json')
    if (!existsSync(file)) continue
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as unknown
      const v = validateSemanticPack(raw)
      if (!v.ok) continue
      const pack = parseSemanticPack(raw)
      if (pack) packs.push(pack)
    } catch {
      /* skip */
    }
  }
  return packs
}

export function listAllSemanticPacks(userDataWorkflowsDir?: string): SemanticPack[] {
  const bundled = loadBundledSemanticPacks()
  const fromFlat = userDataWorkflowsDir
    ? loadInstalledSemanticPacks(join(userDataWorkflowsDir, 'semanticPacks'))
    : []
  // 已安装工作流：每个 workflows/<id>/semanticPacks/
  const fromWorkflows: SemanticPack[] = []
  if (userDataWorkflowsDir && existsSync(userDataWorkflowsDir)) {
    try {
      for (const name of readdirSync(userDataWorkflowsDir)) {
        const packs = loadSemanticPacksFromWorkflowDir(join(userDataWorkflowsDir, name))
        fromWorkflows.push(...packs)
      }
    } catch {
      /* ignore */
    }
  }
  const byId = new Map<string, SemanticPack>()
  for (const p of [...bundled, ...fromFlat, ...fromWorkflows]) byId.set(p.id, p)
  return [...byId.values()]
}

/**
 * 从已安装工作流目录收集 semanticPacks/*.json（WorkflowBundle.semanticPacks）。
 * 只接受 JSON；校验失败则跳过。
 */
export function loadSemanticPacksFromWorkflowDir(workflowInstallDir: string): SemanticPack[] {
  const dir = join(workflowInstallDir, 'semanticPacks')
  if (!existsSync(dir)) return []
  const packs: SemanticPack[] = []
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue
    try {
      const raw = JSON.parse(readFileSync(join(dir, name), 'utf8')) as unknown
      const pack = parseSemanticPack(raw)
      if (pack) packs.push(pack)
    } catch {
      /* skip */
    }
  }
  return packs
}

/** 官方工作流清单（优先读并列的 ai-art-engine-workflow 仓库） */
export function loadBuiltinCommerceWorkflowManifest(): unknown | null {
  const candidates = [
    join(
      process.cwd(),
      '../ai-art-engine-workflow/workflows/commerce-semantic-variants/workflow.json'
    ),
    join(
      process.cwd(),
      '../../ai-art-engine-workflow/workflows/commerce-semantic-variants/workflow.json'
    )
  ]
  for (const c of candidates) {
    if (!existsSync(c)) continue
    try {
      return JSON.parse(readFileSync(c, 'utf8')) as unknown
    } catch {
      return null
    }
  }
  return null
}
