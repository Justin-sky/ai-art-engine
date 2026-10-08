/**
 * 教学视频 UI 定位 / 点击：主进程在主窗口里查 `data-tutorial-id` 并派发指针事件。
 *
 * 坐标是相对窗口内容区的 CSS 像素，与 `screen_record_step.focus/cursor`、`capturePage` 同源。
 */
import type { BrowserWindow } from 'electron'
import { getMainWindowRef } from '../mainWindowRef'
import { TUTORIAL_UI_ATTR, type TutorialUiBounds } from '@shared/tutorialUi'

function assertMainWindow(): BrowserWindow {
  const win = getMainWindowRef()
  if (!win || win.isDestroyed()) {
    throw new Error('主窗口不可用：请确认应用界面已打开') // cjk-ok（面向 Agent 的 MCP 工具诊断文案，不进界面文案表）
  }
  return win
}

/** 在页面里挑可见、未被完全遮挡的教学控件（同 id 多份时优先「点得中」的） */
const PICK_VISIBLE_JS = `(attr, escaped) => {
  const nodes = Array.from(document.querySelectorAll('[' + attr + '="' + escaped + '"]'));
  if (!nodes.length) return null;
  const vw = window.innerWidth || 1;
  const vh = window.innerHeight || 1;
  let best = null;
  let bestScore = -1;
  for (const el of nodes) {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
      continue;
    }
    const r = el.getBoundingClientRect();
    if (!(r.width > 1) || !(r.height > 1)) continue;
    const visibleW = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
    const visibleH = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
    const visibleArea = visibleW * visibleH;
    if (visibleArea < 4) continue;
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    const top = document.elementFromPoint(cx, cy);
    const hit = top && (el === top || el.contains(top) || top.contains(el));
    // prefer the foreground control we actually hit; otherwise fall back to visible area
    const score = (hit ? 1e12 : 0) + visibleArea * 1e6 + r.width * r.height;
    if (score <= bestScore) continue;
    bestScore = score;
    best = el;
  }
  return best;
}`

/**
 * 按 tutorialId 取元素矩形；找不到返回 null。
 *
 * 同 id 可能有多份（dock 里后台面板也挂着 `data-tutorial-id`）：取**点得中且可见面积大**的，
 * 避免高亮框落到隐藏面板的错误坐标上（录屏里就像框漂在空白处）。
 */
export async function queryTutorialUiBounds(tutorialId: string): Promise<TutorialUiBounds | null> {
  const id = tutorialId.trim()
  if (!id) throw new Error('缺少 tutorialId') // cjk-ok（面向 Agent 的 MCP 工具诊断文案，不进界面文案表）
  const win = assertMainWindow()
  const attr = TUTORIAL_UI_ATTR
  const escaped = id.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  const raw = (await win.webContents.executeJavaScript(
    `(() => {
      const pickVisible = ${PICK_VISIBLE_JS};
      const el = pickVisible(${JSON.stringify(attr)}, ${JSON.stringify(escaped)});
      if (!el) return null;
      const vw = window.innerWidth || 1;
      const vh = window.innerHeight || 1;
      const pad = 8;
      const r = el.getBoundingClientRect();
      let x = r.x - pad;
      let y = r.y - pad;
      let width = r.width + pad * 2;
      let height = r.height + pad * 2;
      x = Math.max(0, Math.min(x, vw - 2));
      y = Math.max(0, Math.min(y, vh - 2));
      width = Math.max(2, Math.min(width, vw - x));
      height = Math.max(2, Math.min(height, vh - y));
      return {
        tutorialId: ${JSON.stringify(id)},
        x,
        y,
        width,
        height,
        centerX: r.x + r.width / 2,
        centerY: r.y + r.height / 2
      };
    })()`,
    true
  )) as TutorialUiBounds | null
  return raw
}

export type TutorialUiClickKind = 'click' | 'dblclick' | 'contextmenu'

export type TutorialUiClickOptions = {
  /** 默认 click；dblclick=双击开指令面板；contextmenu=右键开添加菜单 */
  kind?: TutorialUiClickKind
}

export type TutorialUiClickResult = {
  ok: boolean
  tutorialId: string
  x: number
  y: number
  reasonKey?: string
}

/**
 * 在控件中心派发真实指针事件。
 * 不滚动画布、不保证业务副作用——只是真实 DOM 交互。
 */
export async function clickTutorialUi(
  tutorialId: string,
  options: TutorialUiClickOptions = {}
): Promise<TutorialUiClickResult> {
  const bounds = await queryTutorialUiBounds(tutorialId)
  if (!bounds) {
    return { ok: false, tutorialId, x: 0, y: 0, reasonKey: 'notFound' }
  }
  const kind = options.kind ?? 'click'
  const win = assertMainWindow()
  const attr = TUTORIAL_UI_ATTR
  const escaped = tutorialId.trim().replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  const ok = (await win.webContents.executeJavaScript(
    `(() => {
      const pickVisible = ${PICK_VISIBLE_JS};
      const el = pickVisible(${JSON.stringify(attr)}, ${JSON.stringify(escaped)});
      if (!el) return false;
      const kind = ${JSON.stringify(kind)};
      // the double-click handler lives on .preview; hitting the card root never reaches it
      const target =
        kind === 'dblclick'
          ? (el.querySelector('.preview') || el)
          : kind === 'contextmenu'
            ? (el.querySelector('.graph-viewport, .viewport, .canvas') || el)
            : el;
      const r = target.getBoundingClientRect();
      const x = r.x + r.width / 2;
      const y = r.y + r.height / 2;
      const base = { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window };
      if (kind === 'contextmenu') {
        target.dispatchEvent(new PointerEvent('pointerdown', { ...base, button: 2, buttons: 2, pointerId: 1, pointerType: 'mouse' }));
        target.dispatchEvent(new MouseEvent('contextmenu', { ...base, button: 2, buttons: 2 }));
        target.dispatchEvent(new PointerEvent('pointerup', { ...base, button: 2, buttons: 0, pointerId: 1, pointerType: 'mouse' }));
        return true;
      }
      if (kind === 'dblclick') {
        const once = { ...base, button: 0, detail: 1 };
        target.dispatchEvent(new PointerEvent('pointerdown', { ...once, pointerId: 1, pointerType: 'mouse' }));
        target.dispatchEvent(new PointerEvent('pointerup', { ...once, pointerId: 1, pointerType: 'mouse' }));
        target.dispatchEvent(new MouseEvent('click', once));
        const twice = { ...base, button: 0, detail: 2 };
        target.dispatchEvent(new PointerEvent('pointerdown', { ...twice, pointerId: 1, pointerType: 'mouse' }));
        target.dispatchEvent(new PointerEvent('pointerup', { ...twice, pointerId: 1, pointerType: 'mouse' }));
        target.dispatchEvent(new MouseEvent('click', twice));
        target.dispatchEvent(new MouseEvent('dblclick', twice));
        return true;
      }
      target.dispatchEvent(new PointerEvent('pointerdown', { ...base, button: 0, pointerId: 1, pointerType: 'mouse' }));
      target.dispatchEvent(new PointerEvent('pointerup', { ...base, button: 0, pointerId: 1, pointerType: 'mouse' }));
      target.dispatchEvent(new MouseEvent('click', { ...base, button: 0 }));
      return true;
    })()`,
    true
  )) as boolean
  if (!ok) {
    return { ok: false, tutorialId, x: bounds.centerX, y: bounds.centerY, reasonKey: 'clickFailed' }
  }
  return { ok: true, tutorialId, x: bounds.centerX, y: bounds.centerY }
}

export type TutorialUiFillResult = {
  ok: boolean
  tutorialId: string
  reasonKey?: string
}

/**
 * 向教学控件内的 textarea / input / contenteditable 写入文本并派发 input/change，
 * 用于指令面板填提示词（画面上能看见字被写入）。
 */
export async function fillTutorialUi(
  tutorialId: string,
  text: string
): Promise<TutorialUiFillResult> {
  const id = tutorialId.trim()
  if (!id) throw new Error('缺少 tutorialId') // cjk-ok（面向 Agent 的 MCP 工具诊断文案，不进界面文案表）
  const win = assertMainWindow()
  const attr = TUTORIAL_UI_ATTR
  const escaped = id.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  const result = (await win.webContents.executeJavaScript(
    `(() => {
      const pickVisible = ${PICK_VISIBLE_JS};
      const root = pickVisible(${JSON.stringify(attr)}, ${JSON.stringify(escaped)});
      if (!root) return { ok: false, reasonKey: 'notFound' };
      const el =
        root.matches('textarea, input')
          ? root
          : root.querySelector('textarea, input, [contenteditable="true"]');
      if (!el) return { ok: false, reasonKey: 'noInput' };
      const value = ${JSON.stringify(text)};
      el.focus();
      if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
        const proto = el instanceof HTMLTextAreaElement
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
        const desc = Object.getOwnPropertyDescriptor(proto, 'value');
        if (desc && desc.set) desc.set.call(el, value);
        else el.value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true };
      }
      if (el.isContentEditable) {
        el.textContent = value;
        el.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));
        return { ok: true };
      }
      return { ok: false, reasonKey: 'noInput' };
    })()`,
    true
  )) as { ok: boolean; reasonKey?: string }
  return {
    ok: result.ok,
    tutorialId: id,
    ...(result.reasonKey ? { reasonKey: result.reasonKey } : {})
  }
}

/** 图是否仍在跑（工具栏停止钮 `.play-control.playing` 存在） */
export async function queryGraphIsRunning(): Promise<boolean> {
  const win = assertMainWindow()
  return (await win.webContents.executeJavaScript(
    `!!document.querySelector('.graph-toolbar .play-control.playing')`,
    true
  )) as boolean
}
