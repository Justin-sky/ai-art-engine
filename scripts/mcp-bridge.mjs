#!/usr/bin/env node
/**
 * AiArtEngine MCP 桥（stdio → 本地 HTTP 工具服务）。
 *
 * 由 MCP 客户端（Claude Code / Codex 等）以子进程方式拉起，在 stdin/stdout 上
 * 收发 MCP 协议（newline-delimited JSON-RPC 2.0），把 tools/call 转发到
 * AiArtEngine 应用内置的 127.0.0.1 工具服务。
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

const PROTOCOL_VERSION_FALLBACK = '2024-11-05'
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

async function upstream(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.token}`,
      ...(options.headers || {})
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  })
  const text = await res.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = { ok: false, error: `上游返回非 JSON（HTTP ${res.status}）` }
  }
  return { status: res.status, body }
}

async function listTools() {
  const { status, body } = await upstream('/tools')
  if (status !== 200 || !body?.tools) {
    throw new Error(`无法获取工具列表（HTTP ${status}）：请确认 AiArtEngine 应用已启动`)
  }
  return body.tools.map((tool) => ({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema
  }))
}

async function callTool(name, args) {
  const { status, body } = await upstream(`/tools/${encodeURIComponent(name)}`, {
    method: 'POST',
    body: JSON.stringify({ arguments: args ?? {} })
  })
  if (body && typeof body === 'object' && 'ok' in body) {
    const payload = {
      content: [
        {
          type: 'text',
          text: body.ok
            ? JSON.stringify(body.result, null, 2)
            : `调用失败：${body.error ?? '未知错误'}`
        }
      ]
    }
    if (!body.ok) payload.isError = true
    return payload
  }
  throw new Error(`工具调用失败（HTTP ${status}）`)
}

function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result }
}

function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

async function handleMessage(message) {
  const { id, method, params } = message
  switch (method) {
    case 'initialize':
      return rpcResult(id, {
        protocolVersion: params?.protocolVersion || PROTOCOL_VERSION_FALLBACK,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'aiartengine', title: 'AiArtEngine', version: '0.1.0' }
      })
    case 'ping':
      return rpcResult(id, {})
    case 'tools/list': {
      const tools = await listTools()
      return rpcResult(id, { tools })
    }
    case 'tools/call': {
      const name = params?.name
      if (!name) return rpcError(id, -32602, 'tools/call 缺少 name')
      const payload = await callTool(String(name), params.arguments)
      return rpcResult(id, payload)
    }
    case 'resources/list':
      return rpcResult(id, { resources: [] })
    case 'prompts/list':
      return rpcResult(id, { prompts: [] })
    default:
      if (id === undefined || id === null) return null // 通知无需应答
      return rpcError(id, -32601, `未知方法：${method}`)
  }
}

function writeMessage(message) {
  if (!message) return
  process.stdout.write(JSON.stringify(message) + '\n')
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
    handleMessage(message)
      .then(writeMessage)
      .catch((err) => {
        log('处理消息失败:', err.message)
        if (message && message.id !== undefined && message.id !== null) {
          writeMessage(rpcError(message.id, -32603, err.message))
        }
      })
  }
})

process.stdin.on('end', () => {
  process.exit(0)
})

log(`bridge ready → ${BASE_URL}`)
