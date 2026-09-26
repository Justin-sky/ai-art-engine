import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 「一句话游戏」在对话里的落地口径：**cook 成功后只给一个「试玩」按钮，点击直接开试玩窗口**。
 *
 * 这条约定横跨四处（MCP 活动 → 对话卡片 → 沙盒入口 → 试玩视图），没有类型能约束，
 * 所以按源码扫描把结构钉住；改任何一处破坏约定时这里会红。
 */
function readSrc(...parts: string[]): string {
  return readFileSync(resolve('src', ...parts), 'utf8')
}

const chatPanel = (): string => readSrc('renderer', 'src', 'components', 'ChatPanel.vue')
const sandboxDialogState = (): string =>
  readSrc('renderer', 'src', 'features', 'media', 'gamePlaySandboxDialog.ts')

describe('对话里的可玩 HTML 卡片', () => {
  it('gameplay_build 活动走独立游戏卡，不再落通用资产卡', () => {
    const src = chatPanel()
    // 分支必须存在且在通用 pushAsset 之前 return（否则会多出一张带「保存到资产库」的资产卡）
    const branch = src.indexOf("activity.tool === 'gameplay_build'")
    const generic = src.indexOf('void pushAsset(index === 0 ?')
    expect(branch).toBeGreaterThan(-1)
    expect(generic).toBeGreaterThan(-1)
    expect(branch).toBeLessThan(generic)
    expect(src.slice(branch, generic)).toMatch(/upsertGameCard\(/)
    expect(src.slice(branch, generic)).toMatch(/return\b/)
  })

  it('游戏卡按资产 id 原地更新（迭代不刷屏）', () => {
    const src = chatPanel()
    const fn = src.slice(src.indexOf('function upsertGameCard'))
    expect(fn).toMatch(/const key = `game:\$\{activity\.assetId \|\| activity\.id\}`/)
    expect(fn).toMatch(/kind: 'game'/)
    // 同一 key 命中时改字段而不是再 push 一条
    expect(fn).toMatch(/if \(prev\) \{[\s\S]*?prev\.htmlPath = htmlPath[\s\S]*?return/)
  })

  it('卡片只渲染一个「试玩」按钮，且按钮直接开试玩窗口', () => {
    const src = chatPanel()
    const start = src.indexOf('v-else-if="msg.kind === \'game\'"')
    const end = src.indexOf('v-else-if="msg.kind === \'asset\'"')
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const block = src.slice(start, end)
    expect(block.match(/<button/g) ?? []).toHaveLength(1)
    expect(block).toMatch(/class="play-btn"/)
    expect(block).toMatch(/@click\.stop="playGame\(msg\)"/)
    // 不许出现通用资产卡 / 入库按钮 / 同批次折叠
    expect(block).not.toMatch(/ChatAssetPreview/)
    expect(block).not.toMatch(/save-btn|openSaveAsset|saveToLibrary/)
    expect(block).not.toMatch(/toggleAssetGroup/)

    const play = src.slice(src.indexOf('function playGame'))
    expect(play).toMatch(
      /openGamePlaySandboxDialog\(\{ htmlPath: msg\.htmlPath, title: msg\.title \}\)/
    )
  })

  it('试玩窗口支持按单文件路径直接打开（第三种入口）', () => {
    const state = sandboxDialogState()
    expect(state).toMatch(/htmlPath: string/)
    expect(state).toMatch(/state\.htmlPath = htmlPath/)
    expect(state).toMatch(/!htmlPath &&/)

    const view = readSrc('renderer', 'src', 'components', 'dive', 'EditorDiveGamePlayView.vue')
    expect(view).toMatch(/htmlPath\?: string/)
    // 直接给路径时先读盘再走既有 prepareGameHtml 管线，不进节点 / 资产解析
    const resolveFn = view.slice(view.indexOf('async function readRawHtml'))
    expect(resolveFn).toMatch(/props\.htmlPath\?\.trim\(\)/)
    expect(resolveFn).toMatch(/hydrateFromPath\(directPath\)/)
    expect(view).toMatch(/props\.htmlPath,/)

    const dialog = readSrc('renderer', 'src', 'components', 'GamePlaySandboxDialog.vue')
    expect(dialog).toMatch(/:html-path="state\.htmlPath \|\| undefined"/)
  })

  it('MCP 层 cook 成功后自动登记 gamePlay 资产并收尾活动', () => {
    const src = readSrc('main', 'services', 'mcpServerService.ts')
    const handler = src.slice(src.indexOf("name: 'gameplay_build'"))
    expect(handler).toMatch(/mcpActivityService\.begin\(\{[\s\S]*?tool: 'gameplay_build'/)
    expect(handler).toMatch(/onSettled: \(job\) =>/)
    expect(handler).toMatch(/ensureGamePlayAsset\(/)
    expect(handler).toMatch(/setGamePlayJobAsset\(job\.jobId, assetId\)/)
    expect(handler).toMatch(
      /mcpActivityService\.end\(activityId,[\s\S]*?relativePaths: \[job\.buildHtmlRelativePath\]/
    )

    // 去重：同一工程只更新既有资产，不新建（否则每轮迭代都在资产库多一条）
    const helper = src.slice(src.indexOf('function ensureGamePlayAsset'))
    expect(helper).toMatch(/findGamePlayAssetByProject\(assets, input\.projectRelativeDir\)/)
    expect(helper).toMatch(/projectService\.updateAsset\(/)
    expect(helper).toMatch(/projectService\.createAsset\(\{[\s\S]*?type: 'gamePlay'/)
  })
})
