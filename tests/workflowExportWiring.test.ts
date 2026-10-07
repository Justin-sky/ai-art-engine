import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { scanText } from '../scripts/check-hardcoded-cjk.mjs'
import zhCN from '../src/renderer/src/i18n/locales/zh-CN'
import enUS from '../src/renderer/src/i18n/locales/en-US'

/**
 * 「导出为市场工作流」的接线守卫。
 *
 * 这条链路横跨「画布右键菜单 → 元数据表单 → IPC → 主进程写盘 → 市场仓库 CI」，
 * 没有单一类型能整体约束，且**坏掉的形态全是静默的**：
 *
 * - 菜单项没接上：功能等于不存在，但没有任何报错；
 * - 表单不先落盘就导出：导出的图比用户看到的旧一版（`graph_read` 读的是磁盘）；
 * - 主进程自己拼文案：中文被写进主进程（check:cjk 之外的第二来源）；
 * - 导出侧另抄一份参数白名单 / 节点类型清单：市场 CI 会过，装出来的图却不一样；
 * - 少写 nextSteps：用户直接 validate 会被「索引与磁盘不一致」拒，白跑一轮。
 *
 * 所以这里既钉接线，也钉「没有第二份口径」。
 */

const ROOT = resolve(__dirname, '..')
const read = (path: string): string => readFileSync(resolve(ROOT, path), 'utf8')

const EDITOR = read('src/renderer/src/components/NodeGraphEditor.vue')
const DIALOG = read('src/renderer/src/components/WorkflowExportDialog.vue')
const SHARED = read('src/shared/workflowExport.ts')
const GRAPH_PLAN = read('src/shared/graph/graphPlan.ts')
const SERVICE = read('src/main/services/workflowExportService.ts')
const MAIN_IPC = read('src/main/ipc.ts')
const IPC = read('src/shared/ipc.ts')
const PRELOAD = read('src/preload/index.ts')
const DIALOG_SERVICE = read('src/main/services/dialogService.ts')

type NoteSpace = Record<string, unknown>
const zhExport = zhCN.workflowExport as {
  reason: NoteSpace
  warn: NoteSpace
  nextStep: NoteSpace
}
const enExport = enUS.workflowExport as {
  reason: NoteSpace
  warn: NoteSpace
  nextStep: NoteSpace
}

describe('右键菜单：根画布动作（与节点分组分开）', () => {
  it('入口存在，且挂在根「添加节点」面板里（不在节点分组子面板内）', () => {
    expect(EDITOR).toContain("t('workflowExport.menu.export')")
    expect(EDITOR).toContain('@click="runCtxAction(() => openWorkflowExport())"')
    expect(EDITOR).toContain('<WorkflowExportDialog')

    const groupsAt = EDITOR.indexOf('v-for="group in resourceAddableMenuGroups"')
    const entryAt = EDITOR.indexOf('workflowExport.menu.export')
    expect(groupsAt, '节点分组清单不见了？').toBeGreaterThan(-1)
    expect(entryAt, '菜单入口不存在').toBeGreaterThan(-1)
    // 分组之后 = 与分组平级的根动作，而不是被塞进某个节点分组
    expect(entryAt).toBeGreaterThan(groupsAt)
  })

  it('只在「已落盘的资产图」上出现（草稿 id 在主进程里查不到图）', () => {
    expect(EDITOR).toMatch(/v-if="canExportWorkflow"/)
    expect(EDITOR).toMatch(/const canExportWorkflow = computed\(/)
    expect(EDITOR).toMatch(/isAssetGraph\.value[\s\S]{0,80}isDraftAssetId\(/)
  })

  it('导出前先落盘：表单在调 IPC 之前 await 编辑器暴露的落盘钩子', () => {
    expect(EDITOR).toMatch(
      /async function prepareWorkflowExport\(\): Promise<void> \{\s*await persistGraph\(\)/
    )
    expect(DIALOG).toContain('await props.prepare?.()')
  })
})

describe('元数据表单：校验与 IPC 调用', () => {
  it('校验走共享层函数（与主进程同一路径），不自己另写一套规则', () => {
    expect(DIALOG).toContain("from '@shared/workflowExport'")
    expect(DIALOG).toContain('normalizeWorkflowExportMeta')
  })

  it('调用导出 IPC，并把 id / 封面 / 覆盖标志 / 目录标题都传下去', () => {
    expect(DIALOG).toContain('window.studio.exportWorkflowToMarket({')
    for (const needle of [
      'assetId: props.assetId',
      'meta: draft.value',
      'coverPath: coverPath.value',
      'overwrite,',
      "directoryTitle: t('workflowExport.dialog.pickDirectoryTitle')"
    ]) {
      expect(DIALOG, `表单未传 ${needle}`).toContain(needle)
    }
  })

  it('失败原因按 reasonKey 出文案（主进程不产出成品句子）', () => {
    expect(DIALOG).toContain('workflowExport.reason.${note.reasonKey}')
  })

  it('成功后给出下一步（重建索引 / 提交），不是只显示「完成」', () => {
    expect(DIALOG).toContain("t('workflowExport.dialog.nextSteps')")
    expect(DIALOG).toContain('workflowExport.nextStep.${note.reasonKey}')
    expect(zhCN.workflowExport.dialog.nextSteps.length).toBeGreaterThan(0)
  })

  it('覆盖是「这一次」的显式选择，不是表单里的常驻开关', () => {
    expect(DIALOG).toContain('canOverwrite')
    expect(DIALOG).toMatch(/response\.reasonKey === 'targetExists'/)
  })
})

describe('IPC / preload / 主进程 handler 齐备', () => {
  it('通道声明、转发与 handler 三处都有', () => {
    expect(IPC).toContain("WORKFLOW_EXPORT_TO_MARKET: 'workflow-export:to-market'")
    expect(IPC).toContain('exportWorkflowToMarket: (')
    // 两处都带上「后面的实参」，否则把 `_X` 缀在常量名尾部也能蒙混过关（子串匹配）
    expect(PRELOAD).toContain('IpcChannels.WORKFLOW_EXPORT_TO_MARKET, input')
    expect(MAIN_IPC).toMatch(
      /handle\(IpcChannels\.WORKFLOW_EXPORT_TO_MARKET,[\s\S]{0,120}exportWorkflowToMarket\(input\)/
    )
  })

  it('目录选择器扩展了 title / defaultPath（标题由渲染层按语言给）', () => {
    // 折掉换行/缩进再匹配：prettier（semi:false）会把类型字面量的成员拆行并去掉分隔符，
    // 绑在精确排版上的守卫会在下一次格式化之后无声失效。
    const compact = (text: string): string => text.replace(/\s+/g, ' ')
    expect(compact(DIALOG_SERVICE)).toMatch(
      /selectDirectory\(options\?: \{ title\?: string;? defaultPath\?: string;? \}\): Promise<string \| null> \{/
    )
    expect(SERVICE).toContain('dialogService.selectDirectory(')
  })
})

describe('主进程：读图口径与写盘约束', () => {
  it('按 assetId 读工程里的落盘图（与 MCP graph_read 同一个访问器）', () => {
    expect(SERVICE).toContain('projectService.listAssets()')
    expect(SERVICE).toMatch(/genParams[\s\S]{0,80}graphJson/)
  })

  it('所选目录必须有 workflows/，且同名目录默认拒写（除非显式 overwrite）', () => {
    expect(SERVICE).toContain("join(repoRoot, 'workflows')")
    expect(SERVICE).toMatch(/if \(!isDirectory\(workflowsRoot\)\)/)
    expect(SERVICE).toContain("fail('repoMissing'")
    expect(SERVICE).toContain('input?.overwrite !== true')
    expect(SERVICE).toContain("fail('targetExists'")
  })

  it('写入落在所选目录内（越界即拒），且只写 workflow.json + cover.png', () => {
    expect(SERVICE).toContain('isInside(')
    expect(SERVICE).toContain("join(targetDir, 'workflow.json')")
    expect(SERVICE).toContain('WORKFLOW_EXPORT_COVER_FILE_NAME')
    expect(SERVICE).toContain('mkdirSync(targetDir, { recursive: true })')
    // 目录是选出来的，不是渲染层传下来的路径（渲染层无法指定写哪儿）
    expect(SERVICE).not.toMatch(/input\??\.(directory|dir)\b/)
  })

  it('封面必填且必须是 PNG（校验器要求包里有 cover.png）', () => {
    expect(SERVICE).toContain("reasonKey: 'coverRequired'")
    expect(SERVICE).toContain("extname(target).toLowerCase() !== '.png'")
    expect(SERVICE).toContain('WORKFLOW_EXPORT_LIMITS.coverMaxBytes')
    expect(SHARED).toContain('cover: WORKFLOW_EXPORT_COVER_FILE_NAME')
  })

  it('主进程不产出用户可见文案（本仓的中文守卫在这里必须零违例）', () => {
    expect(scanText(SERVICE)).toEqual([])
    expect(scanText(SHARED)).toEqual([])
  })
})

describe('没有第二份口径（市场 CI 会过、装出来却不是同一张图的那类错）', () => {
  it('可建节点类型与参数白名单复用既有实现，不在导出侧另抄一份', () => {
    expect(SHARED).toContain('listAddableNodeTypes')
    expect(SHARED).toContain('MCP_GRAPH_EDIT_SCOPE')
    expect(SHARED).toContain('declaredParamKeys')
    expect(SHARED).toContain('isAllowedPlanParamKey')
    expect(SHARED).toContain("from './graph/graphPlan'")
    expect(GRAPH_PLAN).toContain('export function declaredParamKeys')
    expect(GRAPH_PLAN).toContain('export function isAllowedPlanParamKey')
    // 导出与物化必须同一判定处
    expect(GRAPH_PLAN).toMatch(/isAllowedPlanParamKey\(key, declaredKeys\)/)
  })

  it('requires.nodeTypes 用共享的 nodeTypesOfPlan 派生（与市场校验器同口径）', () => {
    const compact = (text: string): string => text.replace(/\s+/g, ' ')
    expect(compact(SHARED)).toContain('const nodeTypes = nodeTypesOfPlan(plan)')
    expect(SHARED).toContain("from './workflowMarket'")
    // 另抄一份派生实现（只要名字还在 import 里就能蒙过「包含」检查，所以上面钉的是调用处）
    expect(SHARED).not.toMatch(/function nodeTypesOfPlan/)
    expect(SERVICE).toContain('buildMarketWorkflowBundle')
  })

  it('预设撞名清单从 AI_WORKFLOW_PRESET_IDS 派生，不手抄那 15 个 id', () => {
    expect(SHARED).toContain('AI_WORKFLOW_PRESET_IDS')
    expect(SHARED).toContain("from './graph/aiWorkflowPresets'")
    expect(SHARED).toContain("id !== 'custom'")
    // 手抄清单的痕迹：任何一个官方市场 id 字面量出现在导出模块里
    for (const marketId of ['game-ua-video', 'character-sheet', 'anim2d-gif', 'short-drama9']) {
      expect(SHARED, `导出模块里不该出现手抄的官方 id：${marketId}`).not.toContain(marketId)
    }
  })

  it('官方那 15 条的导出脚本与平价守卫未被改动（本功能是另一条路径）', () => {
    const script = read('scripts/export-market-workflows.mjs')
    expect(script).toContain("findTopLevelValue(raw, 'plan')")
    expect(script).not.toContain('workflowExport')
  })
})

describe('i18n：主进程/共享层返回的每个键都有两套文案', () => {
  /** 收集三份源码里字面量写下的 reasonKey（动态拼接的那类由 render 时兜底） */
  function literalReasonKeys(): string[] {
    const keys = new Set<string>()
    for (const source of [SHARED, SERVICE, DIALOG]) {
      for (const match of source.matchAll(/reasonKey: '([A-Za-z][\w.]*)'/g)) keys.add(match[1]!)
      for (const match of source.matchAll(/fail\('([A-Za-z][\w.]*)'/g)) keys.add(match[1]!)
    }
    return [...keys].sort()
  }

  it('扫到了实际用到的键（守卫本身没失效）', () => {
    const keys = literalReasonKeys()
    expect(keys.length).toBeGreaterThan(10)
    expect(keys).toContain('idPresetReserved')
    expect(keys).toContain('targetExists')
    expect(keys).toContain('coverRequired')
  })

  it('每个键在 zh-CN / en-US 的 reason|warn|nextStep 三处之一里都能解析', () => {
    const missing: string[] = []
    for (const key of literalReasonKeys()) {
      for (const [label, pack] of [
        ['zh', zhExport],
        ['en', enExport]
      ] as const) {
        const resolved =
          key in pack.reason || key in pack.warn || key in pack.nextStep || key === 'unknown'
        if (!resolved) missing.push(`${label}:${key}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('下一步文案里真的写了那两条命令（用户照着做才不会被索引不一致拒）', () => {
    for (const [label, source] of [
      ['zh', read('src/renderer/src/i18n/locales/zh-CN.ts')],
      ['en', read('src/renderer/src/i18n/locales/en-US.ts')]
    ] as const) {
      expect(source, label).toContain('node scripts/build-index.mjs && node scripts/validate.mjs')
      expect(source, label).toContain('workflows/{id}/')
    }
  })
})
