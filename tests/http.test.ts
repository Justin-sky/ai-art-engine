import { describe, expect, it } from 'vitest'
import { annotateAxiosNetworkError, readHttpError } from '../src/main/services/modelProviders/http'

/** 构造一个像 axios 错误的对象（无需 import axios，因为 readHttpError 内部 axios.isAxiosError 通过 shape 判断） */
function asAxiosError(
  opts: {
    isAxiosError?: boolean
    message?: string
    code?: string
    cause?: { code?: string; message?: string }
    response?: { data?: unknown }
  } = {}
): unknown {
  const { isAxiosError = true, message, code, cause, response } = opts
  // 这里借一下 isAxiosError flag；readHttpError 用的是真的 axios.isAxiosError，
  // 所以这条测试通过 source 文件直接 import axios 后再 mock（见下面各 it 的对象构造）。
  return {
    isAxiosError,
    name: 'AxiosError',
    message,
    code,
    cause,
    response
  } as unknown
}

describe('annotateAxiosNetworkError', () => {
  it('拼接 code + message', () => {
    const err = asAxiosError({
      message: 'Client network socket disconnected before secure TLS connection was established',
      code: 'ECONNRESET'
    }) as import('axios').AxiosError
    expect(annotateAxiosNetworkError(err)).toBe(
      'code=ECONNRESET | Client network socket disconnected before secure TLS connection was established'
    )
  })

  it('补上 cause.code / cause.message，去掉与 message 重复的部分', () => {
    const err = asAxiosError({
      message: 'TLS handshake',
      code: 'ECONNRESET',
      cause: { code: 'UND_ERR_SOCKET', message: 'socket hang up' }
    }) as import('axios').AxiosError
    expect(annotateAxiosNetworkError(err)).toBe(
      'code=ECONNRESET | TLS handshake | cause.code=UND_ERR_SOCKET | cause=socket hang up'
    )
  })

  it('cause 与顶层 message 重复时不打印 cause.message', () => {
    const err = asAxiosError({
      message: 'same message',
      code: 'EAI_AGAIN',
      cause: { message: 'same message' }
    }) as import('axios').AxiosError
    expect(annotateAxiosNetworkError(err)).toBe('code=EAI_AGAIN | same message')
  })

  it('cause.code 与 err.code 相同时不重复', () => {
    const err = asAxiosError({
      message: 'msg',
      code: 'ECONNRESET',
      cause: { code: 'ECONNRESET' }
    }) as import('axios').AxiosError
    expect(annotateAxiosNetworkError(err)).toBe('code=ECONNRESET | msg')
  })

  it('没有任何诊断信息时返回空串（罕见兜底）', () => {
    const err = asAxiosError({}) as import('axios').AxiosError
    expect(annotateAxiosNetworkError(err)).toBe('')
  })
})

describe('readHttpError', () => {
  // 注意：本测试用真实 axios.isAxiosError，因此需要构造真的 axios 错误对象。
  // 在 vitest 环境（node + 没有真实请求）下，直接 import axios 后用它的内置工厂最稳。
  // 退而求其次：直接给一个 shape-like 对象，把 isAxiosError 设为 true，
  // 真实 axios.isAxiosError 通过 instanceof + isAxiosError flag 双重判断，所以这里
  // 用 `axios.AxiosError` 构造最干净。

  it('axios 错有 response.data.error 字符串时优先用它', async () => {
    const axios = (await import('axios')).default
    const err = new axios.AxiosError('ignored', 'ERR_BAD_REQUEST', undefined, undefined, {
      status: 400,
      data: { error: 'rate limit exceeded' }
    } as never)
    await expect(readHttpError(err)).resolves.toBe('rate limit exceeded')
  })

  it('axios 错有 response.data.error.message 时优先用它', async () => {
    const axios = (await import('axios')).default
    const err = new axios.AxiosError('ignored', 'ERR_BAD_REQUEST', undefined, undefined, {
      status: 400,
      data: { error: { message: 'quota exceeded' } }
    } as never)
    await expect(readHttpError(err)).resolves.toBe('quota exceeded')
  })

  it('axios 错有 response.data.message 时用它', async () => {
    const axios = (await import('axios')).default
    const err = new axios.AxiosError('ignored', 'ERR_BAD_REQUEST', undefined, undefined, {
      status: 400,
      data: { message: 'upstream said no' }
    } as never)
    await expect(readHttpError(err)).resolves.toBe('upstream said no')
  })

  it('axios 网络错（ECONNRESET + cause）走 annotateAxiosNetworkError 诊断路径', async () => {
    const axios = (await import('axios')).default
    const err = new axios.AxiosError(
      'Client network socket disconnected before secure TLS connection was established',
      'ECONNRESET',
      undefined,
      undefined
    )
    // axios 的 cause 在浏览器/Node 运行时一般没有，但为了模拟 undici 的 TLS-handshake 前的诊断信息，
    // 我们手动挂一个 cause。
    ;(err as unknown as { cause: { code: string; message: string } }).cause = {
      code: 'UND_ERR_SOCKET',
      message: 'socket hang up'
    }
    const msg = await readHttpError(err)
    expect(msg).toMatch(/^code=ECONNRESET/)
    expect(msg).toMatch(/Client network socket disconnected/)
    expect(msg).toMatch(/cause\.code=UND_ERR_SOCKET/)
    expect(msg).toMatch(/cause=socket hang up/)
  })

  it('axios 错无 code 无 cause 时回退到 err.message', async () => {
    const axios = (await import('axios')).default
    const err = new axios.AxiosError('something vague', undefined, undefined, undefined)
    await expect(readHttpError(err)).resolves.toBe('something vague')
  })

  it('非 axios 的 Error 透传 err.message', async () => {
    await expect(readHttpError(new Error('boom'))).resolves.toBe('boom')
  })

  it('非 Error 对象走 String(err) 兜底', async () => {
    await expect(readHttpError('plain string')).resolves.toBe('plain string')
    await expect(readHttpError(42)).resolves.toBe('42')
  })
})
