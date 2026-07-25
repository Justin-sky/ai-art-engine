/**
 * 将 website/ 静态站点上传到阿里云 OSS。
 *
 * 配置优先级：环境变量 > oss-website.local.json > oss-website.json
 *
 * 必填：
 *   OSS_ACCESS_KEY_ID / accessKeyId
 *   OSS_ACCESS_KEY_SECRET / accessKeySecret
 *   OSS_BUCKET / bucket
 *   OSS_REGION / region（如 oss-cn-hangzhou）
 * 可选：
 *   OSS_ENDPOINT / endpoint（默认按 region 推导）
 *   OSS_PUBLIC_BASE_URL / publicBaseUrl  自定义域名或 CDN 前缀
 *   OSS_PREFIX / prefix                 对象前缀（默认空，上传到桶根）
 *   OSS_SKIP_WEBSITE / skipWebsite      设为 1/true 时不调用 putBucketWebsite
 *
 * 用法：
 *   npm run site:deploy
 */
import { promises as fs } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const OSS = require('ali-oss')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const websiteDir = path.join(root, 'website')

const SKIP_NAMES = new Set(['README.md', 'optimize-assets.mjs', '.DS_Store', 'Thumbs.db'])

function truthy(value) {
  if (value === true) return true
  const text = String(value ?? '')
    .trim()
    .toLowerCase()
  return text === '1' || text === 'true' || text === 'yes'
}

async function readJsonIfExists(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    return JSON.parse(raw)
  } catch (err) {
    if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) return null
    throw err
  }
}

function normalizeEndpoint(endpoint) {
  return String(endpoint || '')
    .trim()
    .replace(/\/$/, '')
}

function normalizeRegion(region) {
  const value = String(region || '')
    .trim()
    .toLowerCase()
  if (!value) return ''
  if (value.startsWith('oss-')) return value
  return `oss-${value}`
}

function normalizePrefix(prefix) {
  return String(prefix || '')
    .trim()
    .replace(/^\/+|\/+$/g, '')
}

function endpointHostFromRegion(region) {
  const r = normalizeRegion(region)
  return r ? `${r}.aliyuncs.com` : ''
}

async function loadConfig() {
  const local = (await readJsonIfExists(path.join(root, 'oss-website.local.json'))) || {}
  const shared = (await readJsonIfExists(path.join(root, 'oss-website.json'))) || {}
  const file = { ...shared, ...local }

  const region = normalizeRegion(process.env.OSS_REGION || file.region || 'oss-cn-hangzhou')
  const endpoint =
    normalizeEndpoint(process.env.OSS_ENDPOINT || file.endpoint) ||
    (region ? `https://${endpointHostFromRegion(region)}` : '')

  return {
    accessKeyId: String(process.env.OSS_ACCESS_KEY_ID || file.accessKeyId || '').trim(),
    accessKeySecret: String(
      process.env.OSS_ACCESS_KEY_SECRET || file.accessKeySecret || ''
    ).trim(),
    region,
    endpoint,
    bucket: String(process.env.OSS_BUCKET || file.bucket || '').trim(),
    publicBaseUrl: String(
      process.env.OSS_PUBLIC_BASE_URL || file.publicBaseUrl || ''
    )
      .trim()
      .replace(/\/$/, ''),
    prefix: normalizePrefix(process.env.OSS_PREFIX || file.prefix || ''),
    skipWebsite: truthy(process.env.OSS_SKIP_WEBSITE || file.skipWebsite)
  }
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  switch (ext) {
    case '.html':
    case '.htm':
      return 'text/html; charset=utf-8'
    case '.css':
      return 'text/css; charset=utf-8'
    case '.js':
    case '.mjs':
      return 'text/javascript; charset=utf-8'
    case '.json':
      return 'application/json; charset=utf-8'
    case '.svg':
      return 'image/svg+xml'
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.webp':
      return 'image/webp'
    case '.gif':
      return 'image/gif'
    case '.mp4':
      return 'video/mp4'
    case '.webm':
      return 'video/webm'
    case '.ico':
      return 'image/x-icon'
    case '.txt':
    case '.md':
      return 'text/plain; charset=utf-8'
    default:
      return 'application/octet-stream'
  }
}

function cacheControlFor(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.html' || ext === '.htm') return 'public, max-age=60'
  if (ext === '.css' || ext === '.js' || ext === '.mjs') return 'public, max-age=3600'
  return 'public, max-age=604800'
}

async function walkFiles(dir) {
  const out = []
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    if (SKIP_NAMES.has(entry.name)) continue
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...(await walkFiles(abs)))
    } else if (entry.isFile()) {
      out.push(abs)
    }
  }
  return out
}

function toObjectKey(absPath, prefix) {
  const rel = path.relative(websiteDir, absPath).split(path.sep).join('/')
  return prefix ? `${prefix}/${rel}` : rel
}

function publicUrl(config, objectKey) {
  if (config.publicBaseUrl) return `${config.publicBaseUrl}/${objectKey}`
  const host =
    normalizeEndpoint(config.endpoint)
      .replace(/^https?:\/\//i, '')
      .replace(/\/$/, '') || endpointHostFromRegion(config.region)
  return `https://${config.bucket}.${host}/${objectKey}`
}

async function main() {
  const config = await loadConfig()
  const missing = []
  if (!config.accessKeyId) missing.push('accessKeyId / OSS_ACCESS_KEY_ID')
  if (!config.accessKeySecret) missing.push('accessKeySecret / OSS_ACCESS_KEY_SECRET')
  if (!config.bucket) missing.push('bucket / OSS_BUCKET')
  if (!config.region) missing.push('region / OSS_REGION')
  if (missing.length) {
    console.error('缺少 OSS 配置：' + missing.join(', '))
    console.error(
      '请复制 oss-website.example.json 为 oss-website.local.json 并填写，或设置对应环境变量。'
    )
    process.exit(1)
  }

  const files = await walkFiles(websiteDir)
  if (!files.length) {
    console.error(`未找到可上传文件：${websiteDir}`)
    process.exit(1)
  }

  const clientOptions = {
    accessKeyId: config.accessKeyId,
    accessKeySecret: config.accessKeySecret,
    bucket: config.bucket,
    region: config.region
  }
  if (config.endpoint) {
    clientOptions.endpoint = config.endpoint
  }

  const client = new OSS(clientOptions)

  console.log(
    `上传 website/ → oss://${config.bucket}${config.prefix ? '/' + config.prefix : ''} （${files.length} 个文件）`
  )

  let ok = 0
  for (const abs of files) {
    const key = toObjectKey(abs, config.prefix)
    const body = await fs.readFile(abs)
    const contentType = contentTypeFor(abs)
    const isHtml = contentType.startsWith('text/html')
    const headers = {
      'Content-Type': contentType,
      'Cache-Control': cacheControlFor(abs),
      'x-oss-object-acl': 'public-read'
    }
    if (isHtml) headers['Content-Disposition'] = 'inline'

    await client.put(key, body, { headers })
    ok += 1
    console.log(`  √ ${key} (${contentType})`)
  }

  if (!config.skipWebsite) {
    try {
      await client.putBucketWebsite(config.bucket, {
        index: 'index.html',
        supportSubDir: true
      })
      console.log('√ 已配置桶静态网站首页：index.html')
    } catch (err) {
      console.warn(
        `⚠ 设置静态网站规则失败（文件已上传）：${err instanceof Error ? err.message : String(err)}`
      )
      console.warn('  可在 OSS 控制台 → 基础设置 → 静态页面 中手动设置默认首页为 index.html')
    }
  }

  const homeKey = config.prefix ? `${config.prefix}/index.html` : 'index.html'
  const homeUrl = publicUrl(config, homeKey)
  console.log(`\n完成：已上传 ${ok}/${files.length} 个文件`)
  console.log(`访问：${homeUrl}`)
  if (!config.publicBaseUrl) {
    console.log(
      '提示：默认域名访问 HTML 可能被强制下载；建议绑定自定义域名 / CDN，并在配置里填写 publicBaseUrl。'
    )
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : String(err))
  process.exit(1)
})
