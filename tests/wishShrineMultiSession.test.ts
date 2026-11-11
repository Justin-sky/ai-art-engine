import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  completeWishShrineSession,
  reconcileWishShrineRunningSessions,
  resetWishShrineBridgeForTests,
  setWishShrineFocusedSession,
  startWishShrineSession,
  wishShrineChatBridge
} from '../src/renderer/src/features/graph/model/wishShrineBridge'
import {
  setWeatherBgmEnabled,
  setWeatherSfxEnabled,
  setWeatherSystemEnabled
} from '../src/renderer/src/editor/preferences'
import {
  ACTIVE_WEATHER_POOL,
  SUNNY_COMPLETE_DURATION_MS,
  canvasWeatherState,
  notifyWeatherTaskComplete,
  notifyWeatherTaskStart,
  setWeatherManualMode
} from '../src/renderer/src/graph/vfx/canvasWeatherEngine'

describe('多会话并行执行先后结束：画布祈福仙子与元素天气调度状态机', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetWishShrineBridgeForTests()
    setWeatherSystemEnabled(true)
    setWeatherSfxEnabled(false)
    setWeatherBgmEnabled(false)
    setWeatherManualMode('auto')
    notifyWeatherTaskComplete('ai-chat')
    notifyWeatherTaskComplete('ai-chat:sess-a')
    notifyWeatherTaskComplete('ai-chat:sess-b')
    notifyWeatherTaskComplete('ai-chat:sess-c')
    vi.advanceTimersByTime(5000)
  })

  afterEach(() => {
    resetWishShrineBridgeForTests()
    notifyWeatherTaskComplete('ai-chat:sess-a')
    notifyWeatherTaskComplete('ai-chat:sess-b')
    notifyWeatherTaskComplete('ai-chat:sess-c')
    vi.useRealTimers()
  })

  it('1. 后台会话运行中切换到新建空白会话时，仙子绝不误触发提前谢幕，自动由后台会话护法领衔', () => {
    setWishShrineFocusedSession('sess-a', {
      sessionTitle: '生图海报任务',
      promptText: '帮我生成赛博朋克竖版海报'
    })
    startWishShrineSession({
      sessionId: 'sess-a',
      sessionTitle: '生图海报任务',
      promptText: '帮我生成赛博朋克竖版海报'
    })

    expect(wishShrineChatBridge.running).toBe(true)
    expect(wishShrineChatBridge.activeCount).toBe(1)
    expect(wishShrineChatBridge.sessionId).toBe('sess-a')

    // 用户点击 + New Conversation 切到空闲新会话 sess-idle 准备输入第二条任务
    setWishShrineFocusedSession('sess-idle', {
      sessionTitle: '',
      promptText: '',
      activityText: ''
    })

    // 仙子必须保持在场，且继续由后台仍在运行的 sess-a 领衔，不能提前报“许愿灵验”消失
    expect(wishShrineChatBridge.running).toBe(true)
    expect(wishShrineChatBridge.activeCount).toBe(1)
    expect(wishShrineChatBridge.sessionId).toBe('sess-a')
    expect(wishShrineChatBridge.sessionTitle).toBe('生图海报任务')
    expect(wishShrineChatBridge.companionSessions).toEqual([])
  })

  it('2. 多会话并行执行与先后结束（Staggered Completion）：阶段庆典接力 -> 最终全部圆满谢幕', () => {
    // 会话 A 先启动（生成漫剧分镜视频）
    startWishShrineSession({
      sessionId: 'sess-a',
      sessionTitle: '第一集漫剧视频合成',
      promptText: '把分镜合成为成片视频并加转场'
    })
    // 会话 B 后启动（修复 3D 绑定脚本），且用户当前正在查看会话 B
    setWishShrineFocusedSession('sess-b', {
      sessionTitle: '修复角色骨骼脚本',
      promptText: '修复 Blender 骨骼绑定报错'
    })
    startWishShrineSession({
      sessionId: 'sess-b',
      sessionTitle: '修复角色骨骼脚本',
      promptText: '修复 Blender 骨骼绑定报错'
    })
    // 会话 C 在后台工程同时启动
    startWishShrineSession({
      sessionId: 'sess-c',
      sessionTitle: '解包 XAPK 资源分析',
      promptText: '对这个 xapk 进行解包梳理'
    })

    expect(wishShrineChatBridge.running).toBe(true)
    expect(wishShrineChatBridge.activeCount).toBe(3)
    // 当前焦点在运行中的 sess-b，因此 sess-b 担任主领衔仙子，其余两路作为协力星轨展示
    expect(wishShrineChatBridge.sessionId).toBe('sess-b')
    expect(wishShrineChatBridge.companionSessions.map((c) => c.sessionId).sort()).toEqual([
      'sess-a',
      'sess-c'
    ])

    // 【阶段 1】用户正在看的前台会话 B 率先跑完，而后台 A、C 仍在执行！
    completeWishShrineSession('sess-b', 'success', '修复角色骨骼脚本')

    // 仙子绝不退场，触发第 1 次阶段完成里程碑，并将领衔权自动接力给仍在运行的后台会话（最新启动的 sess-c）
    expect(wishShrineChatBridge.running).toBe(true)
    expect(wishShrineChatBridge.activeCount).toBe(2)
    expect(wishShrineChatBridge.waveCompletedCount).toBe(1)
    expect(wishShrineChatBridge.latestMilestone).toMatchObject({
      seq: 1,
      sessionId: 'sess-b',
      sessionTitle: '修复角色骨骼脚本',
      outcome: 'success',
      remainingCount: 2
    })
    expect(wishShrineChatBridge.sessionId).toBe('sess-c')
    expect(wishShrineChatBridge.companionSessions.map((c) => c.sessionId)).toEqual(['sess-a'])

    // 用户切到会话 A 查看进度：领衔仙子平滑切换到 sess-a，sess-c 退居协力护法位
    setWishShrineFocusedSession('sess-a', {
      sessionTitle: '第一集漫剧视频合成',
      promptText: '把分镜合成为成片视频并加转场'
    })
    expect(wishShrineChatBridge.sessionId).toBe('sess-a')
    expect(wishShrineChatBridge.companionSessions.map((c) => c.sessionId)).toEqual(['sess-c'])

    // 【阶段 2】后台会话 C 第二个跑完，前台会话 A 仍在跑最后一步
    completeWishShrineSession('sess-c', 'success', '解包 XAPK 资源分析')
    expect(wishShrineChatBridge.running).toBe(true)
    expect(wishShrineChatBridge.activeCount).toBe(1)
    expect(wishShrineChatBridge.waveCompletedCount).toBe(2)
    expect(wishShrineChatBridge.latestMilestone).toMatchObject({
      seq: 2,
      sessionId: 'sess-c',
      sessionTitle: '解包 XAPK 资源分析',
      outcome: 'success',
      remainingCount: 1
    })
    expect(wishShrineChatBridge.sessionId).toBe('sess-a')
    expect(wishShrineChatBridge.companionSessions).toEqual([])

    // 【阶段 3：大满贯收官】最后一个运行中的会话 A 完成！此时才进入最终圆满谢幕态
    completeWishShrineSession('sess-a', 'success', '第一集漫剧视频合成')
    expect(wishShrineChatBridge.running).toBe(false)
    expect(wishShrineChatBridge.activeCount).toBe(0)
    expect(wishShrineChatBridge.waveCompletedCount).toBe(3)
    expect(wishShrineChatBridge.outcome).toBe('success')
    expect(wishShrineChatBridge.sessionId).toBe('sess-a')
  })

  it('3. 中途手动停止某一路会话（aborted）不影响其它并行会话，且对账逻辑保护本地预检中的会话', () => {
    startWishShrineSession({ sessionId: 'sess-a', sessionTitle: '任务 A' })
    startWishShrineSession({ sessionId: 'sess-b', sessionTitle: '任务 B' })

    // 用户手动停止任务 B：不计入完成数、不触发里程碑烟花，任务 A 继续稳健运行
    completeWishShrineSession('sess-b', 'aborted')
    expect(wishShrineChatBridge.running).toBe(true)
    expect(wishShrineChatBridge.activeCount).toBe(1)
    expect(wishShrineChatBridge.waveCompletedCount).toBe(0)
    expect(wishShrineChatBridge.latestMilestone).toBeNull()
    expect(wishShrineChatBridge.sessionId).toBe('sess-a')

    // 新会话 sess-c 正在本地预检（尚未落入主进程 runningSessionIds），对账时必须保留
    startWishShrineSession({ sessionId: 'sess-c', sessionTitle: '预检中的任务 C' })
    reconcileWishShrineRunningSessions(['sess-a'], ['sess-c'])
    expect(wishShrineChatBridge.activeCount).toBe(2)

    // 当主进程确认全部结束且无预检任务时，对账自动收敛防泄漏
    reconcileWishShrineRunningSessions([], [])
    expect(wishShrineChatBridge.running).toBe(false)
    expect(wishShrineChatBridge.outcome).toBe('success')
  })

  it('4. 元素天气按会话独立 sourceKey 计数：先结束的会话不会提前打断天气，最后一路结束才触发雨过天晴彩虹', () => {
    expect(canvasWeatherState.currentWeather.value).toBe('idle')

    notifyWeatherTaskStart('ai-chat:sess-a')
    notifyWeatherTaskStart('ai-chat:sess-b')
    expect(canvasWeatherState.isWeatherActive.value).toBe(true)
    expect(ACTIVE_WEATHER_POOL).toContain(canvasWeatherState.currentWeather.value)

    // 会话 B 先完成：由于会话 A 仍在运行，画布元素天气必须持续护航，不能提前放晴
    notifyWeatherTaskComplete('ai-chat:sess-b')
    expect(canvasWeatherState.isWeatherActive.value).toBe(true)
    expect(ACTIVE_WEATHER_POOL).toContain(canvasWeatherState.currentWeather.value)

    // 最后一个会话 A 完成：此时才触发 2 秒雨过天晴彩虹庆典，随后回归晴空 idle
    notifyWeatherTaskComplete('ai-chat:sess-a')
    expect(canvasWeatherState.currentWeather.value).toBe('sunny')

    vi.advanceTimersByTime(SUNNY_COMPLETE_DURATION_MS + 50)
    expect(canvasWeatherState.currentWeather.value).toBe('idle')
  })
})
