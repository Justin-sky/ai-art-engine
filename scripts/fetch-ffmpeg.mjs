/**
 * Fetch static ffmpeg/ffprobe binaries bundled into the app.
 *
 * Layout produced: out/ffmpeg/<arch>/{ffmpeg[.exe], ffprobe[.exe]}
 *   (electron-builder extraResources copies `out/ffmpeg/${arch}` -> <resources>/ffmpeg)
 *
 * Sources per platform:
 *   win32  x64       Official essentials build (zip). Primary source is the
 *                    project's own GitHub mirror — GyanD/codexffmpeg releases,
 *                    latest version resolved via the GitHub API (fast & stable
 *                    from CN networks), with gyan.dev as automatic fallback.
 *                    No arm64 build exists there.
 *   linux  x64/arm64 John Van Sickle static builds (tar.xz, targeted at old
 *                    glibc so they run on most distros; requires a non-empty UA).
 *   darwin x64/arm64 Evermeet builds (zip). The latest release version is
 *                    resolved at fetch time from the Evermeet info JSON API, so
 *                    no version bumping is needed. Evermeet ships x86_64 builds
 *                    only: on Apple Silicon the binary runs under Rosetta 2
 *                    (fine for the short frame-grab / beat-tag jobs). To bundle
 *                    a native arm64 binary later, publish your own zip and point
 *                    FFMPEG_DARWIN_URL at it (ffprobe URL is derived from it).
 *
 * URL overrides (useful when a source is slow/unreachable from your network):
 *   FFMPEG_WIN_ZIP_URL    custom Windows zip (expects gyan layout or flat exe)
 *   FFMPEG_LINUX_URL      custom Linux archive (expects a bin layout)
 *   FFMPEG_DARWIN_URL     custom macOS ffmpeg zip (ffprobe URL derived from it)
 *
 * Usage:
 *   node scripts/fetch-ffmpeg.mjs [--platform win32|darwin|linux]
 *                                 [--arch x64] [--arch arm64] [--force]
 * Defaults: current process.platform / process.arch. Idempotent — skips files
 * already staged unless --force. Non-zero exit code on failure.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createWriteStream } from 'node:fs'
import { chmod, copyFile, mkdir, readdir, rm, stat } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(PROJECT_ROOT, 'out', 'ffmpeg')
const TMP_ROOT = join(PROJECT_ROOT, 'out', '.ffmpeg-tmp')
const UA = 'ai-art-engine-builder (app packaging)'
const EXE_SUFFIX = process.platform === 'win32' ? '.exe' : ''
/** Anything below this size is treated as a failed/truncated download. */
const MIN_EXE_BYTES = 20 * 1024 * 1024
const MIN_ARCHIVE_BYTES = 5 * 1024 * 1024
/** Downloads hang forever without a signal; give large archives a hard cap. */
const DOWNLOAD_TIMEOUT_MS = 20 * 60_000

const GYAN_ZIP = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip'
const LINUX_RELEASE = (arch) =>
  `https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-${arch === 'arm64' ? 'arm64' : 'amd64'}-static.tar.xz`

/** Resolve the current Evermeet release zip URL for ffmpeg / ffprobe. */
async function evermeetZipUrl(kind) {
  const infoUrl = `https://evermeet.cx/ffmpeg/info/${kind}/release`
  const text = await fetchText(infoUrl)
  const m = text.match(new RegExp(`${kind}-(\\d+\\.\\d+(?:\\.\\d+)?)\\.zip`))
  if (!m) throw new Error(`cannot resolve ${kind} release version from ${infoUrl}`)
  return `https://evermeet.cx/ffmpeg/${kind}-${m[1]}.zip`
}

function assertSupported(platform, arch) {
  if (platform === 'win32' && arch !== 'x64') {
    throw new Error(`gyan.dev has no ${arch} Windows build; supported: x64`)
  }
  if (platform === 'linux' && arch !== 'x64' && arch !== 'arm64') {
    throw new Error(`no Linux source for arch ${arch}`)
  }
  if (platform === 'darwin' && arch !== 'x64' && arch !== 'arm64') {
    throw new Error(`no macOS source for arch ${arch}`)
  }
}

async function fetchText(url) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'user-agent': UA },
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return res.text()
}

async function downloadTo(url, destAbs) {
  await mkdir(dirname(destAbs), { recursive: true })
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'user-agent': UA },
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)
  })
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url}`)
  const total = Number(res.headers.get('content-length')) || 0
  let loaded = 0
  const tick = setInterval(() => {
    if (total > 0)
      process.stdout.write(
        `\r    ${(loaded / 1024 / 1024).toFixed(1)}/${(total / 1024 / 1024).toFixed(1)} MB`
      )
  }, 800)
  try {
    await pipeline(
      Readable.fromWeb(res.body).map((chunk) => {
        loaded += chunk.length
        return chunk
      }),
      createWriteStream(destAbs)
    )
  } finally {
    clearInterval(tick)
    process.stdout.write('\n')
  }
}

async function extractArchive(archiveAbs, destDir) {
  const tar =
    process.platform === 'win32'
      ? join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
      : 'tar'
  try {
    await execFileAsync(tar, ['-xf', archiveAbs, '-C', destDir], {
      timeout: 10 * 60_000,
      maxBuffer: 1024 * 1024
    })
  } catch (err) {
    if (!archiveAbs.endsWith('.tar.xz')) throw err
    // GNU tar compiled without xz auto-detection: force the flag before giving up.
    await execFileAsync(tar, ['-xJf', archiveAbs, '-C', destDir], {
      timeout: 10 * 60_000,
      maxBuffer: 1024 * 1024
    })
  }
}

/** Depth-limited search for a file by name (gyan nests under a bin dir, johnvansickle under a build dir). */
async function findFileNamed(root, fileName, depth = 0) {
  if (depth > 4) return null
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const abs = join(root, entry.name)
    if (entry.isDirectory()) {
      const hit = await findFileNamed(abs, fileName, depth + 1)
      if (hit) return hit
    } else if (entry.isFile() && entry.name === fileName) {
      return abs
    }
  }
  return null
}

/** Download + extract one archive, staging needed executables into destDir. */
async function stageFromArchive({ url, archiveExt, wants, extractRoot, destDir }) {
  const archiveAbs = join(extractRoot, `bundle-${Date.now()}.${archiveExt}`)
  console.log(`    fetch ${url}`)
  await downloadTo(url, archiveAbs)
  const info = await stat(archiveAbs)
  if (info.size < MIN_ARCHIVE_BYTES) throw new Error(`archive looks truncated (${info.size} bytes)`)
  const payloadDir = join(extractRoot, `payload-${Date.now()}`)
  await mkdir(payloadDir, { recursive: true })
  try {
    await extractArchive(archiveAbs, payloadDir)
    for (const name of wants) {
      const found = await findFileNamed(payloadDir, `${name}${EXE_SUFFIX}`)
      if (!found) throw new Error(`${name}${EXE_SUFFIX} not found inside downloaded archive`)
      const srcInfo = await stat(found)
      if (srcInfo.size < MIN_EXE_BYTES)
        throw new Error(`${name} looks truncated (${srcInfo.size} bytes)`)
      const dest = join(destDir, `${name}${EXE_SUFFIX}`)
      await rm(dest, { force: true })
      await copyFile(found, dest)
      if (process.platform !== 'win32') await chmod(dest, 0o755)
      console.log(`    + ${dest}  ${(srcInfo.size / 1024 / 1024).toFixed(1)} MB`)
    }
  } finally {
    await rm(payloadDir, { recursive: true, force: true }).catch(() => undefined)
    await rm(archiveAbs, { force: true }).catch(() => undefined)
  }
}

async function alreadyStaged(destDir, force) {
  if (force) return false
  try {
    const ffmpeg = await stat(join(destDir, `ffmpeg${EXE_SUFFIX}`))
    const ffprobe = await stat(join(destDir, `ffprobe${EXE_SUFFIX}`))
    return ffmpeg.size >= MIN_EXE_BYTES && ffprobe.size >= MIN_EXE_BYTES
  } catch {
    return false
  }
}

/**
 * Windows sources in priority order: FFMPEG_WIN_ZIP_URL (if set, exclusive) →
 * GitHub official mirror (GyanD/codexffmpeg, resolved via API) → gyan.dev.
 * GitHub download is usually fast & stable from CN networks; the API call is
 * cheap and guarded, falling straight through to gyan.dev on any failure.
 */
async function resolveWindowsSources() {
  const env = process.env.FFMPEG_WIN_ZIP_URL?.trim()
  if (env) return [{ url: env, label: `FFMPEG_WIN_ZIP_URL` }]
  const githubUrl = await githubEssentialsZipUrl()
  const list = []
  if (githubUrl) list.push({ url: githubUrl, label: 'github.com/GyanD/codexffmpeg' })
  list.push({ url: GYAN_ZIP, label: 'gyan.dev (fallback)' })
  return list
}

async function githubEssentialsZipUrl() {
  try {
    const text = await fetchText('https://api.github.com/repos/GyanD/codexffmpeg/releases/latest')
    const release = JSON.parse(text)
    if (!release || !Array.isArray(release.assets)) return null
    const asset = release.assets.find((a) => {
      const u = typeof a.browser_download_url === 'string' ? a.browser_download_url : ''
      return u.includes('essentials_build') && u.endsWith('.zip')
    })
    return asset ? asset.browser_download_url : null
  } catch {
    return null
  }
}

/** Try candidate URLs in order; switch on failure, throw the last error when all fail. */
async function stageWithFallback({ candidates, archiveExt, wants, extractRoot, destDir }) {
  let lastErr = null
  for (const cand of candidates) {
    try {
      await stageFromArchive({
        url: cand.url,
        archiveExt,
        wants,
        extractRoot,
        destDir
      })
      return
    } catch (err) {
      lastErr = err
      console.warn(`    !! ${cand.label} failed: ${err.message}`)
    }
  }
  throw lastErr ?? new Error('no download source available')
}

async function fetchForArch(platform, arch, force) {
  assertSupported(platform, arch)
  const destDir = join(OUT_DIR, arch)
  if (await alreadyStaged(destDir, force)) {
    console.log(`  = ${arch.padEnd(6)} already staged (--force to re-fetch)`)
    return
  }
  await mkdir(destDir, { recursive: true })
  const extractRoot = join(TMP_ROOT, `${platform}-${arch}`)
  await mkdir(extractRoot, { recursive: true })

  // 每个 job = 一份归档（可能同时含 ffmpeg+ffprobe），带按序尝试的候选源列表。
  const jobs = [] // { candidates: [{url,label}], archiveExt, wants: string[] }
  if (platform === 'win32' || platform === 'linux') {
    const archiveExt = platform === 'win32' ? 'zip' : 'tar.xz'
    const candidates =
      platform === 'win32'
        ? await resolveWindowsSources()
        : [
            {
              url: process.env.FFMPEG_LINUX_URL || LINUX_RELEASE(arch),
              label: 'johnvansickle.com'
            }
          ]
    jobs.push({ candidates, archiveExt, wants: ['ffmpeg', 'ffprobe'] })
  } else {
    // darwin — 每个 kind 独立归档；默认解析 Evermeet 最新版（ffprobe 版本号异常时按 ffmpeg 推导）。
    const mkJob = (url, name) => ({
      candidates: [{ url, label: url }],
      archiveExt: 'zip',
      wants: [name]
    })
    const custom = process.env.FFMPEG_DARWIN_URL
    if (custom) {
      jobs.push(mkJob(custom, 'ffmpeg'))
      jobs.push(mkJob(custom.replace(/ffmpeg-?/, 'ffprobe-'), 'ffprobe'))
    } else {
      const ffmpegUrl = await evermeetZipUrl('ffmpeg')
      let ffprobeUrl = null
      try {
        ffprobeUrl = await evermeetZipUrl('ffprobe')
      } catch {
        ffprobeUrl = ffmpegUrl.replace(/ffmpeg-/, 'ffprobe-')
      }
      jobs.push(mkJob(ffmpegUrl, 'ffmpeg'))
      jobs.push(mkJob(ffprobeUrl, 'ffprobe'))
    }
  }

  console.log(`  * ${arch.padEnd(6)} -> ${destDir}`)
  try {
    for (const job of jobs) {
      await stageWithFallback({
        candidates: job.candidates,
        archiveExt: job.archiveExt,
        wants: job.wants,
        extractRoot,
        destDir
      })
    }
  } finally {
    await rm(extractRoot, { recursive: true, force: true }).catch(() => undefined)
  }
}

function parseArgs(argv) {
  const archs = new Set()
  let platform = process.platform
  let force = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--force') force = true
    else if (a === '--platform') platform = argv[++i]
    else if (a === '--arch') archs.add(argv[++i])
    else if (a.startsWith('--platform=')) platform = a.slice('--platform='.length)
    else if (a.startsWith('--arch=')) archs.add(a.slice('--arch='.length))
  }
  if (archs.size === 0) archs.add(process.arch)
  return { platform, archs: [...archs], force }
}

async function main() {
  const { platform, archs, force } = parseArgs(process.argv.slice(2))
  console.log(`Fetching ffmpeg/ffprobe for ${platform} ${archs.join(', ')} -> ${OUT_DIR}`)
  await mkdir(OUT_DIR, { recursive: true })
  for (const arch of archs) await fetchForArch(platform, arch, force)
  console.log('Done.')
}

main().catch((err) => {
  console.error(`Failed: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
