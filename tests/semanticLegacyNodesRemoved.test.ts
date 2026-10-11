import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 零残留守卫：四个旧节点（`semantic.timeline` 语义时间线 / `semantic.event` 语义事件 /
 * `semantic.edit` 语义编辑 / `semantic.variant` 语义变体）删除后，`src` 与 `tests` 的
 * 源码文本里不该再出现它们的 **typeId token** —— 注释也算，防止"节点删了、指路文案还留着"
 * （用户照着文案找不到节点，比没有文案更糟）。
 *
 * 例外只有一个：与节点类型**同名但属于另一个命名空间**的 dive **视图 id**
 * `'semantic.timeline'`（视图注册表 / 帧 key / 视图元信息），节点删除不影响它，
 * 必须保留。这类用法在源码里显式标注 `// view-id-keep`（或写成 `viewId: '…'`），
 * 守卫命中就跳过该行 —— 白名单是**行内**的，将来新增同类字面量必须显式写出理由，
 * 不能靠整个文件 / 目录豁免（那样守卫会在重构后悄悄失效）。
 */
const SCAN_ROOTS = ['src', 'tests'] as const
const SCAN_EXT = /\.(ts|mts|vue)$/
/** 守卫自己当然要写出这些字面量 */
const SELF_PATH = 'tests/semanticLegacyNodesRemoved.test.ts'
const ALLOW_MARKER = 'view-id-keep'
const VIEW_ID_LINE = /viewId:\s*'semantic\.(timeline|event|edit|variant)'/

/**
 * 匹配**裸 token**（带引号、或写在注释 / 文案里都算）。
 *
 * 为什么不用 `'semantic.edit'` 这种带引号的精确匹配：指路文案常常写成
 * `// 双击 semantic.edit 节点…`（不带引号），只匹配带引号的写法抓不到它
 * —— 变异验证时实测：加一行裸 token 注释，带引号的断言照样是绿的。
 * `\b` 保证 `semantic.editXxx` 这类更长标识符不会误伤。
 */
const RESIDUE_RE = /\bsemantic\.(timeline|event|edit|variant)\b/

function toPosix(path: string): string {
  return path.split(sep).join('/')
}

function listSourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name)
    if (statSync(abs).isDirectory()) listSourceFiles(abs, out)
    else if (SCAN_EXT.test(name)) out.push(abs)
  }
  return out
}

function findResidue(): string[] {
  const hits: string[] = []
  for (const root of SCAN_ROOTS) {
    for (const abs of listSourceFiles(join(process.cwd(), root))) {
      const rel = toPosix(relative(process.cwd(), abs))
      if (rel === SELF_PATH) continue
      const lines = readFileSync(abs, 'utf8').split(/\r?\n/)
      lines.forEach((line, index) => {
        if (line.includes(ALLOW_MARKER) || VIEW_ID_LINE.test(line)) return
        if (RESIDUE_RE.test(line)) hits.push(`${rel}:${index + 1} ${line.trim()}`)
      })
    }
  }
  return hits
}

describe('旧语义节点零残留', () => {
  it('src 与 tests 里不再出现四个旧节点的 typeId（注释也算）', () => {
    const hits = findResidue()
    expect(hits, `以下位置还留着旧节点 typeId：\n${hits.join('\n')}`).toEqual([])
  })

  /**
   * 守卫自检：扫描必须**真的读到**源码。
   * 否则 walk 挂掉 / 根目录写错时，`findResidue()` 返回空数组，测试一样是绿的（恒真）。
   * 这里同时验证**豁免规则本身在生效**（已知的视图 id 行确实带着标记）。
   */
  it('扫描确实覆盖到源码，且白名单行确实存在（防止守卫恒真）', () => {
    const files = listSourceFiles(join(process.cwd(), 'src'))
    expect(files.length).toBeGreaterThan(100)

    const nodes = readFileSync(
      join(process.cwd(), 'src/shared/graph/semanticTimelineNodes.ts'),
      'utf8'
    )
    expect(nodes).toContain("'semantic.compile'")

    const dive = readFileSync(
      join(process.cwd(), 'src/renderer/src/features/graph/model/editorDive.ts'),
      'utf8'
    )
    // 视图 id 是保留项：必须带着白名单标记，说明豁免是"逐行声明"而不是文件级放宽
    expect(dive).toContain(ALLOW_MARKER)
    expect(dive).toContain("viewId: 'semantic.timeline'")
  })
})
