/**
 * 影视/小品名场面与网络视频检索下载服务（运行于 Electron 主进程）。
 *
 * 核心能力：
 * 1. 按电影名 / 角色名 / 台词梗（如「让子弹飞 什么叫惊喜」「赵本山 昨天今天明天」「三国演义 诸葛亮骂王朗」）
 *    自动检索 B 站高能原片名场面片段，智能优选 20s~300s 的无水印/原版高能切片（避开数小时整片或解说杂音）；
 * 2. 支持直接传入 B 站视频链接（`https://www.bilibili.com/video/BV...`）、裸 `BV` 号（支持 `?p=N` 分 P）或直链 `.mp4` URL；
 * 3. 自动携带源站防盗链 `Referer` 与访客 `buvid3` 下载 MP4 视频流至当前工程 `Cache/imports/`，
 *    并在指定 `startSec` / `maxDurationSec` 时用 FFmpeg 无损快速截取目标区间，返回工程相对路径 `relativePath`，
 *    可直接用于 `transcribe_audio`、`detect_video_keyframes`、`grab_video_frames` 与 `timeline_edit` 鬼畜自动剪辑。
 */
import { existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { normalizePathSegment } from '@shared/assetPackage/pathname'
import { resolveCacheOutputRoot } from '@shared/domain'
import { runFfmpeg } from './ffmpegRunner'
import { projectService } from './projectService'
import { findFfmpegBin } from './videoFrameService'
import { validatePublicHttpUrl } from './webArticleExtractService'

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

const API_TIMEOUT_MS = 12_000
const DOWNLOAD_TIMEOUT_MS = 60_000
const MAX_VIDEO_DOWNLOAD_BYTES = 85 * 1024 * 1024 // 85 MB 安全上限
const DEFAULT_MIN_DURATION_SEC = 12
const DEFAULT_MAX_DURATION_SEC = 240
const HARD_MAX_DURATION_SEC = 600
const HARD_MAX_COUNT = 4

export interface WebVideoSearchCandidate {
  bvid: string
  title: string
  author: string
  durationSec: number
  playCount: number
  description: string
  sourceUrl: string
  score: number
}

export interface DownloadedWebVideoClip {
  index: number
  bvid?: string
  page?: number
  title: string
  author: string
  description: string
  durationSec: number
  sourceUrl: string
  /** 工程内相对路径（如 `Cache/imports/20261025_video_BV1WS4y147DA.mp4`） */
  relativePath: string
  sizeBytes: number
}

export interface WebVideoFetchOptions {
  /** 电影名、小品名、角色名或名场面搜索关键词（与 url 二选一） */
  query?: string
  /** B 站视频 URL、裸 BV 号（如 BV1yt4y1Q7SS）或直链 MP4 URL（与 query 二选一） */
  url?: string
  /** 多 P 视频的分 P 序号（从 1 开始，默认 1） */
  page?: number
  /** 最多下载几条名场面视频片段（默认 1，上限 4） */
  count?: number
  /** 搜索时偏好的最短时长（秒，默认 12） */
  minDurationSec?: number
  /** 截取/搜索的最大时长（秒，默认 240，上限 600） */
  maxDurationSec?: number
  /** 从视频第几秒开始截取（默认 0） */
  startSec?: number
  /** 按关键词搜索时是否优先挑选干净的「名场面/原片/素材」片段（默认 true） */
  preferOriginalMaterial?: boolean
  /** 单测或外部指定工程根目录 */
  projectRootOverride?: string
  /** 单测或外部指定缓存目录名 */
  cacheOutputDirOverride?: string
}

export interface WebVideoFetchResult {
  query?: string
  videos: DownloadedWebVideoClip[]
  candidates: WebVideoSearchCandidate[]
}

function stripHtmlTags(html: string): string {
  return String(html ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

/** 解析形如 `"3:27"` 或 `"1:05:12"` 的时长字符串为秒数 */
export function parseDurationTextToSec(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.max(0, Math.round(raw))
  const text = String(raw ?? '').trim()
  if (!text) return 0
  const parts = text.split(':').map((p) => Number(p.trim()))
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return 0
  if (parts.length === 2) return parts[0]! * 60 + parts[1]!
  if (parts.length === 3) return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!
  if (parts.length === 1) return parts[0]!
  return 0
}

/** 从输入字符串提取 B 站 BV 号与可选分 P 序号 */
export function parseBilibiliTarget(input: string): { bvid: string; page?: number } | null {
  const trimmed = String(input ?? '').trim()
  if (!trimmed) return null
  const bvMatch = /\b(BV[0-9A-Za-z]{10})\b/.exec(trimmed)
  if (!bvMatch) return null
  const bvid = bvMatch[1]!
  const pageMatch = /[?&]p=(\d+)/i.exec(trimmed)
  const page = pageMatch ? Math.max(1, Number(pageMatch[1])) : undefined
  return { bvid, ...(page ? { page } : {}) }
}

async function fetchJsonWithTimeout<T>(
  url: string,
  headers: Record<string, string>,
  timeoutMs = API_TIMEOUT_MS
): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': DEFAULT_USER_AGENT,
        Accept: 'application/json, text/plain, */*',
        ...headers
      },
      redirect: 'follow',
      signal: controller.signal
    })
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} (${url})`)
    }
    return (await res.json()) as T
  } finally {
    clearTimeout(timer)
  }
}

/** 获取 B 站匿名访客 buvid3 Cookie（免登录调用搜索接口） */
async function fetchBilibiliBuvid3(): Promise<string> {
  try {
    const spi = await fetchJsonWithTimeout<{
      code?: number
      data?: { b_3?: string }
    }>('https://api.bilibili.com/x/frontend/finger/spi', {
      Referer: 'https://www.bilibili.com/'
    })
    return spi?.data?.b_3?.trim() || 'XY0000000000000000000000000000000000'
  } catch {
    return 'XY0000000000000000000000000000000000'
  }
}

/** 对搜索候选视频打分，优先命中时长适中、画面干净的原片名场面切片 */
export function scoreSearchCandidate(
  item: {
    title: string
    description: string
    durationSec: number
    playCount: number
  },
  options: {
    minDurationSec: number
    maxDurationSec: number
    preferOriginalMaterial: boolean
  }
): number {
  const { durationSec, playCount, title, description } = item
  const { minDurationSec, maxDurationSec, preferOriginalMaterial } = options
  if (durationSec > 0 && durationSec < minDurationSec) return -1000
  // 超过 45 分钟的长视频下载慢且不便快速切鬼畜，大幅降权
  if (durationSec > 2700) return -500

  let score = 0
  // 黄金时长区间：25 秒 ~ maxDurationSec（默认 240 秒）
  if (durationSec >= 25 && durationSec <= maxDurationSec) {
    score += 55
  } else if (durationSec > maxDurationSec && durationSec <= 600) {
    score += 25
  } else if (durationSec >= minDurationSec && durationSec < 25) {
    score += 18
  } else {
    score -= 20
  }

  const combined = `${title} ${description}`
  if (preferOriginalMaterial) {
    if (/(?:原片|原版|素材|提纯|无水印|名场面|经典片段|台词|高清|合集)/i.test(combined)) {
      score += 35
    }
    if (/(?:无字幕|纯享|1080P|4K)/i.test(combined)) {
      score += 15
    }
    if (/(?:解说|一口气看完|盘点|吐槽|reaction|反应|幕后|采访|新闻)/i.test(combined)) {
      score -= 40
    }
    if (/(?:鬼畜|混剪|MAD|YTPMV|电音|念诗)/i.test(title)) {
      score -= 18
    }
  }

  // 播放量对数加分（最高约 +25）
  if (playCount > 0) {
    score += Math.min(25, Math.log10(playCount + 1) * 4.2)
  }

  return Math.round(score * 10) / 10
}

/** 在 B 站按关键词搜索影视/小品名场面候选列表 */
export async function searchBilibiliVideoCandidates(
  rawQuery: string,
  options: {
    minDurationSec?: number
    maxDurationSec?: number
    preferOriginalMaterial?: boolean
  } = {}
): Promise<WebVideoSearchCandidate[]> {
  const cleanQuery = rawQuery.trim()
  if (!cleanQuery) return []

  const preferOriginalMaterial = options.preferOriginalMaterial !== false
  const minDurationSec = Math.max(5, Number(options.minDurationSec ?? DEFAULT_MIN_DURATION_SEC))
  const maxDurationSec = Math.max(
    30,
    Math.min(HARD_MAX_DURATION_SEC, Number(options.maxDurationSec ?? DEFAULT_MAX_DURATION_SEC))
  )

  const buvid3 = await fetchBilibiliBuvid3()
  const hasMaterialHint = /(?:原片|原版|素材|名场面|片段)/i.test(cleanQuery)
  const queries =
    preferOriginalMaterial && !hasMaterialHint
      ? [`${cleanQuery} 名场面 原片`, cleanQuery]
      : [cleanQuery]

  const seenBvids = new Set<string>()
  const candidates: WebVideoSearchCandidate[] = []

  for (const q of queries) {
    const searchUrl = `https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=${encodeURIComponent(q)}&page=1`
    try {
      const resp = await fetchJsonWithTimeout<{
        code?: number
        data?: {
          result?: Array<{
            bvid?: string
            title?: string
            author?: string
            duration?: string | number
            play?: number
            description?: string
          }>
        }
      }>(searchUrl, {
        Referer: 'https://search.bilibili.com/',
        Cookie: `buvid3=${buvid3}`
      })

      for (const row of resp?.data?.result ?? []) {
        const bvid = String(row.bvid ?? '').trim()
        if (!bvid || seenBvids.has(bvid)) continue
        seenBvids.add(bvid)

        const title = stripHtmlTags(row.title ?? '')
        const description = stripHtmlTags(row.description ?? '')
        const durationSec = parseDurationTextToSec(row.duration)
        const playCount = Number(row.play ?? 0) || 0
        const score = scoreSearchCandidate(
          { title, description, durationSec, playCount },
          { minDurationSec, maxDurationSec, preferOriginalMaterial }
        )

        candidates.push({
          bvid,
          title: title || bvid,
          author: String(row.author ?? '').trim(),
          durationSec,
          playCount,
          description,
          sourceUrl: `https://www.bilibili.com/video/${bvid}`,
          score
        })
      }
      if (candidates.filter((c) => c.score > 20).length >= 6) break
    } catch {
      /* 单次搜索失败继续尝试备选词 */
    }
  }

  return candidates.sort((a, b) => b.score - a.score)
}

async function downloadStreamToFile(
  streamUrl: string,
  refererUrl: string,
  targetAbsPath: string
): Promise<number> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS)
  try {
    const res = await fetch(streamUrl, {
      headers: {
        'User-Agent': DEFAULT_USER_AGENT,
        Referer: refererUrl,
        Accept: '*/*'
      },
      redirect: 'follow',
      signal: controller.signal
    })
    if (!res.ok) {
      throw new Error(`视频流下载失败（HTTP ${res.status}）`) // cjk-ok
    }
    const contentLength = Number(res.headers.get('content-length') ?? 0)
    if (contentLength > MAX_VIDEO_DOWNLOAD_BYTES) {
      throw new Error(
        `视频体积过大（${Math.round(contentLength / 1024 / 1024)}MB > 85MB 上限），请改用更短的名场面片段` // cjk-ok
      )
    }
    const arrayBuffer = await res.arrayBuffer()
    const buf = Buffer.from(arrayBuffer)
    if (buf.byteLength < 1024) {
      throw new Error('下载到的视频数据异常过小') // cjk-ok
    }
    if (buf.byteLength > MAX_VIDEO_DOWNLOAD_BYTES) {
      throw new Error('下载到的视频体积超过 85MB 安全上限') // cjk-ok
    }
    writeFileSync(targetAbsPath, buf)
    return buf.byteLength
  } finally {
    clearTimeout(timer)
  }
}

/** 若指定了截取起点或视频超过最大时长，使用本地 FFmpeg 快速无损裁剪目标区间 */
async function maybeTrimDownloadedVideo(
  fileAbsPath: string,
  nativeDurationSec: number,
  startSec: number,
  maxDurationSec: number
): Promise<{ durationSec: number; sizeBytes: number }> {
  const safeStart = Math.max(0, Number(startSec) || 0)
  const needsTrim =
    safeStart > 0.2 || (nativeDurationSec > 0 && nativeDurationSec > maxDurationSec + 2)
  if (!needsTrim) {
    return {
      durationSec: nativeDurationSec,
      sizeBytes: existsSync(fileAbsPath) ? statSync(fileAbsPath).size : 0
    }
  }

  let ffmpegBin: string
  try {
    ffmpegBin = findFfmpegBin()
  } catch {
    return {
      durationSec: nativeDurationSec,
      sizeBytes: existsSync(fileAbsPath) ? statSync(fileAbsPath).size : 0
    }
  }

  const trimmedAbsPath = `${fileAbsPath}.trim.mp4`
  const effectiveDur = Math.max(
    5,
    nativeDurationSec > safeStart
      ? Math.min(maxDurationSec, nativeDurationSec - safeStart)
      : maxDurationSec
  )

  try {
    await runFfmpeg(
      ffmpegBin,
      [
        '-y',
        ...(safeStart > 0 ? ['-ss', String(safeStart)] : []),
        '-i',
        fileAbsPath,
        '-t',
        String(effectiveDur),
        '-c',
        'copy',
        '-movflags',
        '+faststart',
        trimmedAbsPath
      ],
      undefined,
      { timeoutMs: 25_000 }
    )
    if (existsSync(trimmedAbsPath) && statSync(trimmedAbsPath).size > 1024) {
      rmSync(fileAbsPath, { force: true })
      renameSync(trimmedAbsPath, fileAbsPath)
      return {
        durationSec: Math.round(effectiveDur),
        sizeBytes: statSync(fileAbsPath).size
      }
    }
  } catch {
    try {
      rmSync(trimmedAbsPath, { force: true })
    } catch {
      /* ignore */
    }
  }

  return {
    durationSec: nativeDurationSec,
    sizeBytes: existsSync(fileAbsPath) ? statSync(fileAbsPath).size : 0
  }
}

async function downloadBilibiliClipByBvid(input: {
  bvid: string
  page?: number
  index: number
  startSec: number
  maxDurationSec: number
  importsDirAbs: string
  projectRootAbs: string
  stamp: string
}): Promise<DownloadedWebVideoClip> {
  const { bvid, index, startSec, maxDurationSec, importsDirAbs, projectRootAbs, stamp } = input
  const buvid3 = await fetchBilibiliBuvid3()
  const viewResp = await fetchJsonWithTimeout<{
    code?: number
    message?: string
    data?: {
      bvid?: string
      cid?: number
      title?: string
      desc?: string
      duration?: number
      owner?: { name?: string }
      pages?: Array<{ page?: number; cid?: number; part?: string; duration?: number }>
    }
  }>(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`, {
    Referer: `https://www.bilibili.com/video/${bvid}`,
    Cookie: `buvid3=${buvid3}`
  })

  const viewData = viewResp?.data
  if (!viewData?.cid) {
    throw new Error(`无法解析 B 站视频信息（${bvid}：${viewResp?.message || '无 cid'}）`) // cjk-ok
  }

  const pages = Array.isArray(viewData.pages) ? viewData.pages : []
  let chosenPage = 1
  let targetCid = viewData.cid
  let partTitle = ''
  let nativeDurationSec = Number(viewData.duration ?? 0) || 0

  if (pages.length > 1) {
    const requestedPage = input.page && input.page >= 1 ? Math.min(pages.length, input.page) : null
    if (requestedPage) {
      const matched = pages.find((p) => p.page === requestedPage) ?? pages[requestedPage - 1]
      if (matched?.cid) {
        chosenPage = matched.page ?? requestedPage
        targetCid = matched.cid
        partTitle = String(matched.part ?? '').trim()
        nativeDurationSec = Number(matched.duration ?? nativeDurationSec) || nativeDurationSec
      }
    } else {
      // 未指定分 P 时，优先挑时长在 [15s, maxDurationSec] 内的分 P
      const idealPart =
        pages.find((p) => (p.duration ?? 0) >= 15 && (p.duration ?? 0) <= maxDurationSec) ??
        pages[0]
      if (idealPart?.cid) {
        chosenPage = idealPart.page ?? 1
        targetCid = idealPart.cid
        partTitle = String(idealPart.part ?? '').trim()
        nativeDurationSec = Number(idealPart.duration ?? nativeDurationSec) || nativeDurationSec
      }
    }
  }

  const playResp = await fetchJsonWithTimeout<{
    code?: number
    message?: string
    data?: {
      durl?: Array<{ url?: string; size?: number; length?: number }>
    }
  }>(
    `https://api.bilibili.com/x/player/playurl?bvid=${encodeURIComponent(bvid)}&cid=${targetCid}&qn=64&fnval=1&platform=html5&high_quality=1`,
    {
      Referer: `https://www.bilibili.com/video/${bvid}`,
      Cookie: `buvid3=${buvid3}`
    }
  )

  const streamUrl = playResp?.data?.durl?.[0]?.url?.trim()
  if (!streamUrl) {
    throw new Error(`未获取到可下载的 MP4 视频流（${bvid} cid=${targetCid}）`) // cjk-ok
  }

  const safeSlug = bvid.replace(/[^0-9A-Za-z_-]/g, '') || `clip_${index}`
  const fileName = `${stamp}_video_${safeSlug}_p${chosenPage}.mp4`
  const fileAbsPath = join(importsDirAbs, fileName)

  await downloadStreamToFile(streamUrl, `https://www.bilibili.com/video/${bvid}`, fileAbsPath)
  const trimmed = await maybeTrimDownloadedVideo(
    fileAbsPath,
    nativeDurationSec,
    startSec,
    maxDurationSec
  )

  const relPath = normalizePathSegment(relative(projectRootAbs, fileAbsPath))
  const fullTitle =
    partTitle && partTitle !== viewData.title
      ? `${stripHtmlTags(viewData.title ?? bvid)} · ${partTitle}`
      : stripHtmlTags(viewData.title ?? bvid)

  return {
    index,
    bvid,
    page: chosenPage,
    title: fullTitle,
    author: String(viewData.owner?.name ?? '').trim(),
    description: stripHtmlTags(viewData.desc ?? ''),
    durationSec: trimmed.durationSec,
    sourceUrl:
      chosenPage > 1
        ? `https://www.bilibili.com/video/${bvid}?p=${chosenPage}`
        : `https://www.bilibili.com/video/${bvid}`,
    relativePath: relPath,
    sizeBytes: trimmed.sizeBytes
  }
}

/**
 * 主入口：根据电影/小品名关键词或视频 URL 自动搜索并下载名场面 MP4 视频到当前工程 `Cache/imports/`。
 */
export async function fetchWebVideoClipsToImports(
  options: WebVideoFetchOptions
): Promise<WebVideoFetchResult> {
  const query = String(options.query ?? '').trim()
  const rawUrl = String(options.url ?? '').trim()
  if (!query && !rawUrl) {
    throw new Error('请至少提供 query（电影名/名场面关键词）或 url（B 站链接 / BV 号 / MP4 直链）') // cjk-ok
  }

  const count = Math.max(1, Math.min(HARD_MAX_COUNT, Math.round(Number(options.count ?? 1) || 1)))
  const startSec = Math.max(0, Number(options.startSec ?? 0) || 0)
  const minDurationSec = Math.max(
    5,
    Number(options.minDurationSec ?? DEFAULT_MIN_DURATION_SEC) || DEFAULT_MIN_DURATION_SEC
  )
  const maxDurationSec = Math.max(
    20,
    Math.min(
      HARD_MAX_DURATION_SEC,
      Number(options.maxDurationSec ?? DEFAULT_MAX_DURATION_SEC) || DEFAULT_MAX_DURATION_SEC
    )
  )
  const preferOriginalMaterial = options.preferOriginalMaterial !== false

  const projectRoot = options.projectRootOverride?.trim() || projectService.getRoot()
  const cacheRoot = resolveCacheOutputRoot(
    options.cacheOutputDirOverride ?? projectService.getConfig().cacheOutputDir
  )
  const importsDirAbs = join(projectRoot, cacheRoot, 'imports')
  mkdirSync(importsDirAbs, { recursive: true })

  const stamp = new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, '')
    .slice(0, 15)

  // 情形 1：直接传入了 URL 或 BV 号
  if (rawUrl) {
    const bvTarget = parseBilibiliTarget(rawUrl) ?? parseBilibiliTarget(query)
    if (bvTarget) {
      const clip = await downloadBilibiliClipByBvid({
        bvid: bvTarget.bvid,
        page: options.page ?? bvTarget.page,
        index: 1,
        startSec,
        maxDurationSec,
        importsDirAbs,
        projectRootAbs: projectRoot,
        stamp
      })
      return {
        ...(query ? { query } : {}),
        videos: [clip],
        candidates: [
          {
            bvid: bvTarget.bvid,
            title: clip.title,
            author: clip.author,
            durationSec: clip.durationSec,
            playCount: 0,
            description: clip.description,
            sourceUrl: clip.sourceUrl,
            score: 100
          }
        ]
      }
    }

    // 普通 HTTP/HTTPS MP4 直链
    const parsedUrl = validatePublicHttpUrl(rawUrl)
    const fileName = `${stamp}_video_direct_1.mp4`
    const fileAbsPath = join(importsDirAbs, fileName)
    await downloadStreamToFile(parsedUrl.href, parsedUrl.origin, fileAbsPath)
    const trimmed = await maybeTrimDownloadedVideo(fileAbsPath, 0, startSec, maxDurationSec)
    const relPath = normalizePathSegment(relative(projectRoot, fileAbsPath))
    return {
      ...(query ? { query } : {}),
      videos: [
        {
          index: 1,
          title: query || parsedUrl.pathname.split('/').pop() || 'Web Video',
          author: parsedUrl.hostname,
          description: '',
          durationSec: trimmed.durationSec,
          sourceUrl: parsedUrl.href,
          relativePath: relPath,
          sizeBytes: trimmed.sizeBytes
        }
      ],
      candidates: []
    }
  }

  // 情形 2：query 本身包含 BV 号
  const queryBvTarget = parseBilibiliTarget(query)
  if (queryBvTarget) {
    const clip = await downloadBilibiliClipByBvid({
      bvid: queryBvTarget.bvid,
      page: options.page ?? queryBvTarget.page,
      index: 1,
      startSec,
      maxDurationSec,
      importsDirAbs,
      projectRootAbs: projectRoot,
      stamp
    })
    return {
      query,
      videos: [clip],
      candidates: []
    }
  }

  // 情形 3：按电影名 / 角色名 / 台词梗关键词自动去 B 站检索并下载排名前列的名场面原片
  const candidates = await searchBilibiliVideoCandidates(query, {
    minDurationSec,
    maxDurationSec,
    preferOriginalMaterial
  })

  if (!candidates.length) {
    throw new Error(`未检索到与「${query}」匹配的影视/名场面视频素材`) // cjk-ok
  }

  const downloaded: DownloadedWebVideoClip[] = []
  const errors: string[] = []

  for (const candidate of candidates.slice(0, Math.max(count + 3, 5))) {
    if (downloaded.length >= count) break
    try {
      const clip = await downloadBilibiliClipByBvid({
        bvid: candidate.bvid,
        page: options.page,
        index: downloaded.length + 1,
        startSec,
        maxDurationSec,
        importsDirAbs,
        projectRootAbs: projectRoot,
        stamp
      })
      downloaded.push(clip)
    } catch (err) {
      errors.push(`${candidate.bvid}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  if (!downloaded.length) {
    throw new Error(
      `检索到「${query}」相关视频但下载失败：${errors.slice(0, 2).join('；') || '未知错误'}` // cjk-ok
    )
  }

  return {
    query,
    videos: downloaded,
    candidates: candidates.slice(0, 8)
  }
}
