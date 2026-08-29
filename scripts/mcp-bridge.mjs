#!/usr/bin/env node
/**
 * AiArtEngine MCP 桥（stdio ↔ 应用内置 /mcp 端点）。
 *
 * 本桥不做协议处理：stdin 上每一行 JSON-RPC 消息原样转发到应用的 /mcp
 * 端点（streamable HTTP POST），响应（200 + JSON）写回 stdout；
 * 通知（202 空体）不产生输出。协议语义（initialize / tools / ping /
 * notifications/cancelled 等）全部由应用内的 src/shared/mcpProtocol.ts
 * 统一实现，避免双份实现漂移（版本号 / capabilities / 错误码等天然一致）。
 *
 * 配置解析顺序：
 *   1. 环境变量 AIAE_MCP_CONFIG：mcp.json 的绝对路径
 *   2. 环境变量 AIAE_MCP_PORT / AIAE_MCP_TOKEN：直连配置（优先于文件）
 *   3. 默认路径：<appData>/aiartengine/mcp.json（由应用在启动工具服务时写入）
 *
 * 所有日志走 stderr，stdout 只输出协议消息。
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const REQUEST_TIMEOUT_MS = 180000 // 工作流规划走 LLM，放宽超时

function log(...args) {
  console.error('[aiartengine-mcp]', ...args)
}

function defaultConfigPaths() {
  // 开发态 userData 叫 aiartengine；打包后随 productName 变为 AIArtEngine
  const names = ['aiartengine', 'AIArtEngine']
  const appData = process.env.APPDATA
  if (appData) return names.map((name) => join(appData, name, 'mcp.json'))
  if (process.platform === 'darwin') {
    return names.map((name) =>
      join(homedir(), 'Library', 'Application Support', name, 'mcp.json')
    )
  }
  return names.map((name) => join(homedir(), '.config', name, 'mcp.json'))
}

function loadConfig() {
  if (process.env.AIAE_MCP_PORT && process.env.AIAE_MCP_TOKEN) {
    return {
      port: Number(process.env.AIAE_MCP_PORT),
      token: process.env.AIAE_MCP_TOKEN
    }
  }
  const candidates = process.env.AIAE_MCP_CONFIG
    ? [process.env.AIAE_MCP_CONFIG]
    : defaultConfigPaths()
  for (const path of candidates) {
    if (!existsSync(path)) continue
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8'))
      if (typeof parsed.port === 'number' && typeof parsed.token === 'string') {
        return { port: parsed.port, token: parsed.token, path }
      }
    } catch (err) {
      log('读取配置失败:', path, err.message)
    }
  }
  return null
}

let config = loadConfig()
if (!config) {
  log(
    '未找到 mcp.json（请先启动 AiArtEngine 应用，或用 AIAE_MCP_CONFIG / AIAE_MCP_PORT + AIAE_MCP_TOKEN 指定）。' +
      '将尝试使用默认端口。'
  )
  config = { port: 43110, token: '' }
}

const BASE_URL = `http://127.0.0.1:${config.port}`

/** POST 一条 JSON-RPC 消息到应用 /mcp 端点；通知（202 空体）返回 null */
async function postToMcp(message) {
  const res = await fetch(`${BASE_URL}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${config.token}`
    },
    body: JSON.stringify(message),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  })
  const text = await res.text()
  if (res.status === 202 || !text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** 探测服务是否在线：mcp.json 可能残留于应用异常退出，尽量给出明确提示 */
async function probeHealth() {
  try {
    const res = await fetch(`${BASE_URL}/health`, {
      signal: AbortSignal.timeout(3000)
    })
    return res.status === 200
  } catch {
    return false
  }
}

function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

async function handleMessage(message) {
  const isNotification = message.id === undefined || message.id === null
  let response = null
  try {
    response = await postToMcp(message)
  } catch (err) {
    const causeCode = err?.cause?.code
    const detail =
      causeCode === 'ECONNREFUSED'
        ? `无法连接 ${BASE_URL}（请确认 AiArtEngine 应用已启动）`
        : err instanceof Error
          ? err.message
          : String(err)
    if (isNotification) {
      log('转发通知失败:', detail)
      return
    }
    response = rpcError(message.id, -32603, detail)
  }
  if (!response || isNotification) return
  // 应用返回的 JSON-RPC 响应原样转发（含 error 对象）
  process.stdout.write(JSON.stringify(response) + '\n')
}

let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let index
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index).trim()
    buffer = buffer.slice(index + 1)
    if (!line) continue
    let message
    try {
      message = JSON.parse(line)
    } catch (err) {
      log('无法解析的协议行:', err.message)
      continue
    }
    handleMessage(message).catch((err) => {
      log('处理消息失败:', err.message)
    })
  }
})

process.stdin.on('end', () => {
  process.exit(0)
})

const online = await probeHealth()
if (online) {
  log(`bridge ready → ${BASE_URL}`)
} else {
  log(`警告：${BASE_URL} 暂无响应，请确认 AiArtEngine 应用已启动；请求到达时会重试`)
}
