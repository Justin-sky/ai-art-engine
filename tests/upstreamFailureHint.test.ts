import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { setAppErrorLocaleResolver } from '../src/shared/errors/appError'
import {
  annotateProviderTarget,
  isGenericUpstreamGenerationFailure,
  providerHostOf,
  withGenericUpstreamFailureHint
} from '../src/shared/modelProviders/providerFailureDiagnostics'

/**
 * 上游「通用失败」文案的识别与提示。
 *
 * 这条链路线上踩过：人像处理把请求发到某个 OpenAI 兼容网关，上游回了一段
 * 「We're unable to generate a result… may be due to a content policy violation, invalid parameters,
 * or an unknown issue」+ 中文对照，用户只看到「可能因内容违规、参数错误或其他未知原因」，
 * 完全不知道下一步改什么。这里锁住三件事：
 *   1. 这一族文案要被认出来（且必须认全中英两段，用户看到的是两段拼在一起）；
 *   2. 认出来之后要附上能照做的排查清单；
 *   3. **不能误伤**自身已经说清楚的报错（鉴权 / 额度 / 超时 / 未返回图片），否则提示变成噪声。
 */

/** 线上真实报文（中英并列，与用户贴的运行日志逐字一致） */
const REAL_FAILURE =
  'Error: 图片生成失败: We’re unable to generate a result for this request at this time. This may be due to a ' +
  'content policy violation, invalid parameters, or an unknown issue. Please review your request and try again.\n' +
  '本次请求可能因内容违规、参数错误或其他未知原因，暂时无法生成结果。请检查请求内容和参数后重试。'

const ROOT = join(__dirname, '..')

afterEach(() => {
  setAppErrorLocaleResolver(() => 'zh-CN')
})

describe('上游通用失败文案识别', () => {
  it('认得出线上这条（中英并列）', () => {
    expect(isGenericUpstreamGenerationFailure(REAL_FAILURE)).toBe(true)
  })

  it('英文单独出现也认得出', () => {
    expect(
      isGenericUpstreamGenerationFailure(
        "We're unable to generate a result for this request at this time. This may be due to a content policy violation, invalid parameters, or an unknown issue."
      )
    ).toBe(true)
    expect(
      isGenericUpstreamGenerationFailure('The request could not generate an image: moderation')
    ).toBe(true)
  })

  it('中文单独出现也认得出', () => {
    expect(isGenericUpstreamGenerationFailure('本次请求可能因内容违规暂时无法生成结果')).toBe(true)
    expect(isGenericUpstreamGenerationFailure('生成失败：参数错误')).toBe(true)
  })

  it('不误伤自身已说清的报错', () => {
    for (const message of [
      'Unauthorized',
      'invalid api key',
      'Missing Authentication header',
      '429 Too Many Requests: quota exceeded',
      '图片生成超时：任务仍未完成',
      '模型未返回图片',
      'insufficient balance',
      'code=ECONNRESET | socket hang up',
      ''
    ]) {
      expect(isGenericUpstreamGenerationFailure(message), message).toBe(false)
    }
  })

  it('只说「生成失败」但没给原因词时不动它', () => {
    expect(isGenericUpstreamGenerationFailure('图片生成失败')).toBe(false)
    expect(isGenericUpstreamGenerationFailure('image generation failed')).toBe(false)
  })
})

describe('提示文案', () => {
  it('命中时原文保留，并附上可照做的清单', () => {
    const text = withGenericUpstreamFailureHint(REAL_FAILURE)
    expect(text).toContain('We’re unable to generate a result')
    expect(text).toContain('本次请求可能因内容违规')
    expect(text).toContain('参考图或提示词触发了上游内容策略')
    expect(text).toContain('把分辨率档位调低一档')
    expect(text).toContain('换个模型就成功')
  })

  it('英文界面给英文提示', () => {
    setAppErrorLocaleResolver(() => 'en-US')
    const text = withGenericUpstreamFailureHint(REAL_FAILURE)
    expect(text).toContain('generic failure text')
    expect(text).toContain('If switching models works')
    expect(text).not.toContain('参考图或提示词触发了上游内容策略')
  })

  it('没命中时原样返回（不改变已有报错）', () => {
    expect(withGenericUpstreamFailureHint('Unauthorized')).toBe('Unauthorized')
    expect(withGenericUpstreamFailureHint('')).toBe('')
  })
})

describe('网关与端点标注', () => {
  it('只留主机名：协议、账号密码、路径、查询串都不进日志', () => {
    expect(providerHostOf('https://user:secret@api.example.com/v1?key=abc')).toBe('api.example.com')
    expect(providerHostOf('http://127.0.0.1:8080/v1')).toBe('127.0.0.1:8080')
    expect(providerHostOf('api.example.com/v1')).toBe('api.example.com')
    expect(providerHostOf('')).toBe('')
    expect(providerHostOf('not a url at all')).toBe('')
  })

  it('把主机与端点缀在报错后（同一张图换模型时用来判断是不是同一个网关）', () => {
    const text = annotateProviderTarget(
      '图片生成失败: unable to generate a result',
      'https://user:secret@api.example.com/v1',
      '/images/edits'
    )
    expect(text).toContain('api.example.com · /images/edits')
    expect(text).not.toContain('secret')
    expect(text).not.toContain('/v1')
  })

  it('重复注解不会叠加，缺信息时原样返回', () => {
    const once = annotateProviderTarget('boom', 'https://api.example.com', '/images/generations')
    expect(annotateProviderTarget(once, 'https://api.example.com', '/images/generations')).toBe(
      once
    )
    expect(annotateProviderTarget('boom', '', '')).toBe('boom')
    expect(annotateProviderTarget('boom', 'https://api.example.com', '')).toContain(
      'provider: api.example.com'
    )
  })
})

describe('接线', () => {
  it('所有读上游错误的地方都过一遍提示（读 HTTP 错误的唯一入口）', () => {
    const http = readFileSync(join(ROOT, 'src/main/services/modelProviders/http.ts'), 'utf8')
    expect(http).toContain("from '@shared/modelProviders/providerFailureDiagnostics'")
    // readHttpError 的出口：网络错分支走 annotateAxiosNetworkError（自带诊断串，不再叠提示），
    // 其余一律经 withGenericUpstreamFailureHint —— 出口是收口的，就没有「漏加提示」的可能。
    // 这里不用「等于若干个」断言：上游错误体形状（error / message / detail / msg）会随网关增加，
    // 按数量钉会把测试本身变成改代码的阻碍。
    const readFn = /export async function readHttpError\([\s\S]*?\n\}/.exec(http)?.[0] ?? ''
    expect(readFn).toBeTruthy()
    expect(readFn).toContain('annotateAxiosNetworkError(err)')
    expect(readFn).toContain('withGenericUpstreamFailureHint(')
    // 归一化放在独立函数里，出口只剩一条：调用它就够了
    expect(readFn).toContain('normalizeUpstreamErrorBody(')
    expect(http).toContain('function normalizeUpstreamErrorBody(')
  })

  it('OpenAI 兼容出图失败带上网关与端点（自定义 / NewAPI / OpenAI / 本地都走这一条）', () => {
    const compat = readFileSync(
      join(ROOT, 'src/main/services/modelProviders/openaiCompat.ts'),
      'utf8'
    )
    expect(compat).toContain(
      "import { annotateProviderTarget } from '@shared/modelProviders/providerFailureDiagnostics'"
    )
    const generateFn =
      /export async function generateOpenAiCompatibleImage\([\s\S]*?\n\}\n/.exec(compat)?.[0] ?? ''
    expect(generateFn).toBeTruthy()
    expect(generateFn).toContain('annotateProviderTarget(')
    expect(generateFn).toContain("'/images/edits'")
    expect(generateFn).toContain("'/images/generations'")
  })
})
