#!/usr/bin/env node
/**
 * ai-art-engine-mcp — Zero-dependency stdio MCP bridge for AI Art Engine.
 *
 * Bridges stdio JSON-RPC 2.0 messages to the local AI Art Engine desktop MCP server:
 *   - Default endpoint: http://127.0.0.1:43110/mcp (93 studio & pipeline tools)
 *   - `--blender` flag: http://127.0.0.1:43110/mcp/blender (9 live Blender 3D tools)
 *
 * Configuration resolution order:
 *   1. AIAE_MCP_PORT + AIAE_MCP_TOKEN environment variables
 *   2. AIAE_MCP_CONFIG path to mcp.json
 *   3. Auto-discovered <appData>/AIArtEngine/mcp.json written by the desktop app
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const PKG_VERSION = '9.0.2'
const REQUEST_TIMEOUT_MS = 180_000

const argv = process.argv.slice(2)
if (argv.includes('--version') || argv.includes('-v')) {
  process.stdout.write(`${PKG_VERSION}\n`)
  process.exit(0)
}

if (argv.includes('--help') || argv.includes('-h')) {
  process.stdout.write(
    [
      `ai-art-engine-mcp v${PKG_VERSION}`,
      'Zero-dependency MCP stdio bridge for AI Art Engine (https://github.com/Justin-sky/ai-art-engine)',
      '',
      'Usage:',
      '  npx -y ai-art-engine-mcp             Bridge main studio MCP (/mcp, 93 tools)',
      '  npx -y ai-art-engine-mcp --blender   Bridge Blender 3D MCP (/mcp/blender, 9 tools)',
      '',
      'Environment variables (optional — auto-detected from local AIArtEngine appData by default):',
      '  AIAE_MCP_CONFIG    Explicit path to mcp.json',
      '  AIAE_MCP_PORT      Local MCP HTTP port (default: 43110)',
      '  AIAE_MCP_TOKEN     Bearer token from mcp.json',
      '  AIAE_MCP_ENDPOINT  Override path (/mcp or /mcp/blender)',
      ''
    ].join('\n')
  )
  process.exit(0)
}

const useBlender = argv.includes('--blender')
const endpointPath = process.env.AIAE_MCP_ENDPOINT || (useBlender ? '/mcp/blender' : '/mcp')

function log(...args) {
  console.error('[ai-art-engine-mcp]', ...args)
}

function defaultConfigPaths() {
  const names = ['AIArtEngine', 'aiartengine']
  const appData = process.env.APPDATA
  if (appData) return names.map((name) => join(appData, name, 'mcp.json'))
  if (process.platform === 'darwin') {
    return names.map((name) => join(homedir(), 'Library', 'Application Support', name, 'mcp.json'))
  }
  return names.map((name) => join(homedir(), '.config', name, 'mcp.json'))
}

function loadConfig() {
  if (process.env.AIAE_MCP_PORT) {
    return {
      port: Number(process.env.AIAE_MCP_PORT) || 43110,
      token: process.env.AIAE_MCP_TOKEN || ''
    }
  }
  const candidates = process.env.AIAE_MCP_CONFIG
    ? [process.env.AIAE_MCP_CONFIG]
    : defaultConfigPaths()
  for (const filePath of candidates) {
    if (!existsSync(filePath)) continue
    try {
      const parsed = JSON.parse(readFileSync(filePath, 'utf8'))
      if (typeof parsed.port === 'number' && typeof parsed.token === 'string') {
        return { port: parsed.port, token: parsed.token, path: filePath }
      }
    } catch (err) {
      log('Failed to parse mcp.json:', filePath, err.message)
    }
  }
  return null
}

let config = loadConfig() || {
  port: Number(process.env.AIAE_MCP_PORT) || 43110,
  token: process.env.AIAE_MCP_TOKEN || ''
}

function resolveEndpointUrl() {
  // Lazy refresh token if desktop app was launched after the MCP client started
  if (!config.token && !process.env.AIAE_MCP_PORT) {
    const refreshed = loadConfig()
    if (refreshed) config = refreshed
  }
  return `http://127.0.0.1:${config.port}${endpointPath}`
}

async function postToMcp(message) {
  const url = resolveEndpointUrl()
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream'
  }
  if (config.token) {
    headers.Authorization = `Bearer ${config.token}`
  }
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(message),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  })
  if (res.status === 401) {
    // Desktop app may have rotated/initialized token; reload once and retry
    const refreshed = loadConfig()
    if (refreshed && refreshed.token !== config.token) {
      config = refreshed
      return postToMcp(message)
    }
  }
  const text = await res.text()
  if (res.status === 202 || !text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

const OFFLINE_FALLBACK_TOOLS = [
  {
    name: 'studio_status',
    description:
      'Inspect local AI Art Engine workspace status, active DAG canvas, 30+ model providers, offline ONNX vision & 102 production tools (Editable TySh PSD, Unity/Godot UI, Spine 2D, Machinations Economy, Short-Drama CapCut, Blender 3D, Playable HTML5).',
    inputSchema: { type: 'object', properties: {} }
  }
]

function buildOfflineFallbackResponse(message) {
  const method = message?.method
  if (method === 'initialize') {
    const requestedProtocol = message?.params?.protocolVersion || '2024-11-05'
    return {
      jsonrpc: '2.0',
      id: message.id,
      result: {
        protocolVersion: requestedProtocol,
        capabilities: { tools: { listChanged: true } },
        serverInfo: {
          name: useBlender ? 'ai-art-engine-blender' : 'ai-art-engine',
          version: PKG_VERSION
        },
        instructions:
          'AI Art Engine local desktop server is currently offline. Launch the AI Art Engine desktop app (https://github.com/Justin-sky/ai-art-engine/releases) on this machine to unlock all 102 live production tools.'
      }
    }
  }
  if (method === 'ping') {
    return { jsonrpc: '2.0', id: message.id, result: {} }
  }
  if (method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id: message.id,
      result: { tools: OFFLINE_FALLBACK_TOOLS }
    }
  }
  if (method === 'tools/call') {
    return {
      jsonrpc: '2.0',
      id: message.id,
      result: {
        isError: true,
        content: [
          {
            type: 'text',
            text:
              'AI Art Engine desktop app is not running on 127.0.0.1:43110. ' +
              'Please launch AI Art Engine locally (free open-source download for Win/macOS/Linux: https://github.com/Justin-sky/ai-art-engine/releases) and retry.'
          }
        ]
      }
    }
  }
  return null
}

function isOfflineConnectionError(err) {
  if (!err) return false
  const cause = err.cause
  if (cause?.code === 'ECONNREFUSED') return true
  if (Array.isArray(cause?.errors) && cause.errors.some((e) => e?.code === 'ECONNREFUSED')) {
    return true
  }
  return /ECONNREFUSED/i.test(String(cause?.message || err.message || ''))
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
    const offline = isOfflineConnectionError(err)
    if (offline) {
      if (isNotification) return
      const fallback = buildOfflineFallbackResponse(message)
      if (fallback) {
        process.stdout.write(JSON.stringify(fallback) + '\n')
        return
      }
    }
    const detail = offline
      ? `Cannot connect to 127.0.0.1:${config.port}${endpointPath} — please launch the AI Art Engine desktop app.`
      : err instanceof Error
        ? err.message
        : String(err)
    if (isNotification) {
      log('Notification forward failed:', detail)
      return
    }
    response = rpcError(message.id, -32603, detail)
  }
  if (!response || isNotification) return
  process.stdout.write(JSON.stringify(response) + '\n')
}

let buffer = ''
let inFlight = 0
let stdinEnded = false

function maybeExit() {
  if (stdinEnded && inFlight === 0) {
    process.exit(0)
  }
}

function processLine(rawLine) {
  const line = rawLine.trim()
  if (!line) return
  let message
  try {
    message = JSON.parse(line)
  } catch (err) {
    log('Malformed JSON-RPC line:', err.message)
    return
  }
  inFlight += 1
  handleMessage(message)
    .catch((err) => {
      log('Message handler error:', err.message)
    })
    .finally(() => {
      inFlight -= 1
      maybeExit()
    })
}

process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let index
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index)
    buffer = buffer.slice(index + 1)
    processLine(line)
  }
})

process.stdin.on('end', () => {
  if (buffer.trim()) {
    processLine(buffer)
    buffer = ''
  }
  stdinEnded = true
  maybeExit()
})
