import { describe, expect, it } from 'vitest'
import {
  TUTORIAL_POST_DBLCLICK_FOCUS_IDS,
  TUTORIAL_UI_IDS,
  tutorialCtxGroupId,
  tutorialCtxTypeId,
  tutorialDiveViewId,
  tutorialIdSlug
} from '../src/shared/tutorialUi'

describe('教学 id 派生规则', () => {
  it('typeId 点改横杠，覆盖任意可添加节点', () => {
    expect(tutorialCtxTypeId('asset.image')).toBe('graph-ctx-type-asset-image')
    expect(tutorialCtxTypeId('asset.video')).toBe('graph-ctx-type-asset-video')
    expect(tutorialCtxTypeId('generate.speech')).toBe('graph-ctx-type-generate-speech')
    expect(tutorialCtxGroupId('image')).toBe('graph-ctx-group-image')
    expect(tutorialCtxGroupId('video')).toBe('graph-ctx-group-video')
  })

  it('dive viewId 派生覆盖漫画页与节点工具', () => {
    expect(tutorialDiveViewId('comic.page')).toBe('graph-dive-view-comic-page')
    expect(tutorialDiveViewId('node.multiAngle')).toBe('graph-dive-view-node-multiAngle')
    expect(tutorialDiveViewId('node.notepad')).toBe('graph-dive-view-node-notepad')
    expect(tutorialDiveViewId('gamePlay.sandbox')).toBe('graph-dive-view-gamePlay-sandbox')
  })

  it('固定 id 含 dive / 记事本；双击后焦点候选齐全', () => {
    for (const id of [
      'graph-dive',
      'graph-dive-bar',
      'graph-dive-up',
      'graph-notepad',
      'graph-notepad-input'
    ] as const) {
      expect(TUTORIAL_UI_IDS).toContain(id)
    }
    expect([...TUTORIAL_POST_DBLCLICK_FOCUS_IDS]).toEqual([
      'graph-instruction-panel',
      'graph-notepad',
      'graph-dive'
    ])
  })

  it('slug 去掉非法字符', () => {
    expect(tutorialIdSlug('a.b/c')).toBe('a-b-c')
  })
})
