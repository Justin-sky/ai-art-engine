import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 问答卡的**自定义回答**：模型给的选项只有 2–6 条，覆盖不到用户意图时不该被迫二选一。
 *
 * 本仓库没有 jsdom / @vue/test-utils（组件挂不起来），所以这里盯的是接线本身：
 * 输入框在不在、回车与按钮是否走**同一条**回传路径、`fromCustom` 有没有一路穿到主进程。
 * 最后一条尤其要紧 —— 标志没穿过去，主进程就仍用宽松口径判断「是否取消」，
 * 用户在输入框里写「不要正面」就会被当成取消，而界面上看不出任何异样。
 */

const ROOT = resolve(__dirname, '..')
const read = (p: string): string => readFileSync(resolve(ROOT, p), 'utf8')

const CHAT = read('src/renderer/src/components/ChatPanel.vue')
const HISTORY = read('src/renderer/src/composables/useChatHistory.ts')
const IPC = read('src/shared/ipc.ts')
const HARNESS = read('src/main/services/deepseekHarnessService.ts')
const ZH = read('src/renderer/src/i18n/locales/zh-CN.ts')
const EN = read('src/renderer/src/i18n/locales/en-US.ts')

describe('问答卡：自定义回答', () => {
  it('提问卡里有可输入的输入框，且绑定到消息的 draft', () => {
    expect(CHAT).toContain('class="prompt-custom-input"')
    expect(CHAT).toContain('v-model="msg.draft"')
    // 输入框必须拦住键盘事件：面板上还有斜杠菜单 / 快捷键等全局处理，
    // 回车与方向键在输入框里被截走就没法正常打字
    expect(CHAT).toContain('@keydown.stop')
  })

  it('回车与按钮走同一条回传路径（另写一条就会分叉出「能重复提交」之类的差别）', () => {
    expect(CHAT).toContain('@keydown.enter.prevent="submitPromptDraft(msg)"')
    expect(CHAT).toContain('@click="submitPromptDraft(msg)"')

    const at = CHAT.indexOf('async function submitPromptDraft')
    expect(at).toBeGreaterThan(-1)
    const body = CHAT.slice(at, CHAT.indexOf('\n}', at))
    // 必须复用 answerPrompt（那里有「未答才回传」的守卫），并标记来自自定义输入
    expect(body).toContain('answerPrompt(msg, text, true)')
    expect(body, '空回答不该回传').toContain('if (!text) return')
  })

  it('回答只在未答时出现（答过之后卡片锁定）', () => {
    const at = CHAT.indexOf('class="prompt-custom"')
    const before = CHAT.slice(CHAT.lastIndexOf('<div', at), at)
    expect(before).toContain('msg.answered === null || msg.answered === undefined')
  })

  it('fromCustom 一路穿到主进程，并改变取消判定口径', () => {
    // 渲染层发出
    expect(CHAT).toContain('...(fromCustom ? { fromCustom: true } : {})')
    // 契约里有这个字段
    expect(IPC).toMatch(/interface AskUserAnswer[\s\S]{0,400}fromCustom\?: boolean/)
    // 主进程真的用它（只是定义不传，等于白加）
    expect(HARNESS).toContain('isCancelAnswer(payload.answer, payload.fromCustom === true)')
  })

  it('消息类型与两套文案都补齐了', () => {
    expect(HISTORY).toMatch(/kind: 'prompt'[\s\S]{0,400}draft\?: string/)
    for (const [name, locale] of [
      ['zh-CN', ZH],
      ['en-US', EN]
    ] as const) {
      expect(locale, `${name} 缺 promptCustomPlaceholder`).toContain('promptCustomPlaceholder:')
      expect(locale, `${name} 缺 promptCustomSend`).toContain('promptCustomSend:')
    }
  })
})
