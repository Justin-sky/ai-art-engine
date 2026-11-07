/**
 * Container & metadata provenance extractor (`rea-video` `probe.py` equivalent).
 *
 * Inspects both `ffprobe` format/stream tags and binary MP4/MOV header/trailer boxes
 * (first/last 2 MB) to detect:
 * - GB 45438-2025 Chinese mandatory AIGC implicit metadata (`aigc` box / JSON tag)
 * - C2PA / JUMBF provenance manifests (`c2pa`, `jumb`, `c2ma`)
 * - AI video generator signatures (Kling, Seedance/Jimeng, Hailuo/MiniMax, Veo, Sora, Wan, Runway, Pika, PixVerse, Vidu, Luma, Hunyuan)
 * - NLE / Code / 3D renderer signatures (CapCut/Jianying, Premiere, DaVinci, Final Cut, Remotion, Blender, After Effects, OBS)
 * - Camera hardware metadata (`make` / `model`)
 * - Social platform re-encode signatures (WeChat, Douyin, Xiaohongshu, Bilibili, YouTube)
 */
import { execFile } from 'child_process'
import { closeSync, openSync, readSync, statSync } from 'fs'
import { promisify } from 'util'
import type { AigcImplicitLabel, ContainerProvenance } from '@shared/semanticTimeline'
import { resolveFfprobeForSemantic } from '../resolveFfmpeg'

const execFileAsync = promisify(execFile)
const SCAN_WINDOW_BYTES = 2 * 1024 * 1024

interface FfprobeRaw {
  format?: {
    format_name?: string
    tags?: Record<string, string>
  }
  streams?: Array<{
    codec_type?: string
    codec_name?: string
    tags?: Record<string, string>
  }>
}

const GENERATOR_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'Kling (可灵)', re: /\bkling\b|klingai|kwai_aigc|kuaishou.*aigc/i }, // cjk-ok
  {
    name: 'Seedance / Jimeng (即梦/豆包)', // cjk-ok
    re: /\bseedance\b|\bjimeng\b|\bdreamina\b|volcengine.*aigc|\bdoubao\b|bytedance.*aigc/i
  },
  { name: 'Hailuo / MiniMax (海螺)', re: /\bhailuo\b|\bminimax\b|conch_video/i }, // cjk-ok
  { name: 'Google Veo', re: /\bveo[\s_-]?[23]?\b|deepmind.*video|synthid/i },
  { name: 'OpenAI Sora', re: /\bsora\b|openai.*video/i },
  { name: 'Wan / Tongyi (通义万相)', re: /\bwanx?\b|\bwan2\.\d\b|tongyi.*video|alibaba.*aigc/i }, // cjk-ok
  { name: 'Runway Gen', re: /\brunway\b|\bgen-[234]\b/i },
  { name: 'Vidu (生数)', re: /\bvidu\b|shengshu/i }, // cjk-ok
  { name: 'PixVerse', re: /\bpixverse\b/i },
  { name: 'Pika', re: /\bpika\.art\b|\bpikalabs\b/i },
  { name: 'Luma Dream Machine', re: /\bluma\s*ai\b|dream\s*machine/i },
  { name: 'HunyuanVideo (混元)', re: /\bhunyuan\b|tencent.*aigc/i } // cjk-ok
]

const EDITOR_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'Remotion', re: /\bremotion\b/i },
  { name: 'Blender', re: /\bblender\b/i },
  { name: 'Cinema 4D', re: /cinema\s*4d|\bc4d\b/i },
  { name: 'Unreal Engine', re: /unreal\s*engine/i },
  { name: 'Houdini', re: /\bhoudini\b/i },
  { name: 'CapCut / 剪映', re: /\bcapcut\b|\bjianying\b|\blveffect\b|\bbcut\b/i }, // cjk-ok
  { name: 'Adobe Premiere', re: /premiere\s*pro|adobe\s*premiere/i },
  { name: 'After Effects', re: /after\s*effects/i },
  { name: 'DaVinci Resolve', re: /davinci\s*resolve|blackmagic/i },
  { name: 'Final Cut Pro', re: /final\s*cut|apple\s*proapps/i },
  {
    name: 'OBS / Screen Recorder',
    re: /\bobs\s*studio\b|replaykit|screenflow|camtasia|quicktime\s*screen/i
  }
]

const PLATFORM_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'WeChat (微信视频号/聊天压缩)', re: /\bmmvideo\b|wechat|weixin/i }, // cjk-ok
  { name: 'Douyin (抖音重编码)', re: /\baweme\b|\bttvideo\b|\bies_|\bvid:v0[0-9a-z]+/i }, // cjk-ok
  { name: 'Xiaohongshu (小红书重编码)', re: /xiaohongshu|\brednote\b|\bxhs_/i }, // cjk-ok
  { name: 'Bilibili (B站重编码)', re: /\bbilibili\b|\bbili_xcode\b/i }, // cjk-ok
  { name: 'YouTube', re: /iso media file produced by google/i }
]

/** Try to parse a GB 45438-2025 AIGC implicit metadata JSON object from string or binary text. */
export function parseAigcImplicitJson(text: string): AigcImplicitLabel | undefined {
  if (!text) return undefined
  const idx = text.search(/"(?:ContentProducer|ProduceID|ContentPropagator|PropagateID)"/i)
  const labelIdx = idx >= 0 ? idx : text.search(/"Label"\s*:\s*"?[123]"?/)
  if (labelIdx < 0) return undefined

  const start = text.lastIndexOf('{', labelIdx)
  const end = text.indexOf('}', labelIdx)
  if (start < 0 || end <= start || end - start > 4096) return undefined
  const candidate = text.slice(start, end + 1)
  try {
    const obj = JSON.parse(candidate) as Record<string, unknown>
    const pick = (...keys: string[]): string | undefined => {
      for (const k of keys) {
        const val = obj[k]
        if (typeof val === 'string' && val.trim()) return val.trim()
        if (typeof val === 'number') return String(val)
      }
      return undefined
    }
    const label = pick('Label', 'label')
    const contentProducer = pick('ContentProducer', 'contentProducer', 'content_producer')
    const produceId = pick('ProduceID', 'produceId', 'produce_id')
    const reservedCode1 = pick('ReservedCode1', 'reservedCode1')
    const contentPropagator = pick('ContentPropagator', 'contentPropagator')
    const propagateId = pick('PropagateID', 'propagateId')
    if (!label && !contentProducer && !produceId) return undefined
    return {
      ...(label ? { label } : {}),
      ...(contentProducer ? { contentProducer } : {}),
      ...(produceId ? { produceId } : {}),
      ...(reservedCode1 ? { reservedCode1 } : {}),
      ...(contentPropagator ? { contentPropagator } : {}),
      ...(propagateId ? { propagateId } : {}),
      rawJson: candidate
    }
  } catch {
    return undefined
  }
}

function scanBinarySlices(fileAbs: string): {
  aigc?: AigcImplicitLabel
  hasC2pa: boolean
  asciiSnippets: string
} {
  let fd: number | null = null
  try {
    const st = statSync(fileAbs)
    if (!st.isFile() || st.size <= 0) {
      return { hasC2pa: false, asciiSnippets: '' }
    }
    fd = openSync(fileAbs, 'r')
    const headLen = Math.min(st.size, SCAN_WINDOW_BYTES)
    const head = Buffer.allocUnsafe(headLen)
    readSync(fd, head, 0, headLen, 0)

    let tail = Buffer.alloc(0)
    if (st.size > headLen) {
      const tailOffset = Math.max(headLen, st.size - SCAN_WINDOW_BYTES)
      const tailLen = st.size - tailOffset
      tail = Buffer.allocUnsafe(tailLen)
      readSync(fd, tail, 0, tailLen, tailOffset)
    }

    const combined = tail.length > 0 ? Buffer.concat([head, tail]) : head
    const latin = combined.toString('latin1')
    const utf8 = combined.toString('utf8')

    const hasC2pa =
      latin.includes('c2pa') ||
      latin.includes('urn:c2pa') ||
      (latin.includes('jumb') && (latin.includes('c2ma') || latin.includes('c2cl')))

    const aigc = parseAigcImplicitJson(utf8) ?? parseAigcImplicitJson(latin)

    // Keep printable ASCII runs >= 5 chars for lightweight signature matching
    const runs = utf8.match(/[\x20-\x7E]{5,120}/g) ?? []
    const asciiSnippets = runs.slice(0, 600).join(' | ')
    return { aigc, hasC2pa, asciiSnippets }
  } catch {
    return { hasC2pa: false, asciiSnippets: '' }
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd)
      } catch {
        /* ignore */
      }
    }
  }
}

/** Extract container provenance, GB 45438 AIGC tags, C2PA presence, and tool signatures. */
export async function probeContainerProvenance(videoAbs: string): Promise<ContainerProvenance> {
  const evidence: string[] = []
  const tagMap: Record<string, string> = {}
  let containerFormat: string | undefined

  try {
    const bin = resolveFfprobeForSemantic()
    const { stdout } = await execFileAsync(
      bin,
      ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', videoAbs],
      { timeout: 20_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true }
    )
    const parsed = JSON.parse(stdout) as FfprobeRaw
    containerFormat = parsed.format?.format_name
    for (const [k, v] of Object.entries(parsed.format?.tags ?? {})) {
      if (typeof v === 'string' && v.trim()) tagMap[k.toLowerCase()] = v.trim()
    }
    for (const stream of parsed.streams ?? []) {
      for (const [k, v] of Object.entries(stream.tags ?? {})) {
        const key = `${stream.codec_type ?? 'stream'}.${k.toLowerCase()}`
        if (typeof v === 'string' && v.trim()) tagMap[key] = v.trim()
      }
    }
  } catch {
    /* ffprobe failure does not block binary scan */
  }

  const binary = scanBinarySlices(videoAbs)
  const tagValuesJoined = Object.entries(tagMap)
    .map(([k, v]) => `${k}=${v}`)
    .join(' | ')

  let aigcImplicitLabel = binary.aigc
  if (!aigcImplicitLabel) {
    for (const v of Object.values(tagMap)) {
      const parsed = parseAigcImplicitJson(v)
      if (parsed) {
        aigcImplicitLabel = parsed
        break
      }
    }
  }

  const searchCorpus = [
    tagValuesJoined,
    aigcImplicitLabel?.rawJson ?? '',
    binary.asciiSnippets
  ].join(' || ')

  const encoder =
    tagMap['encoder'] || tagMap['video.encoder'] || tagMap['software'] || tagMap['handler_name']
  const make =
    tagMap['com.apple.quicktime.make'] || tagMap['make'] || tagMap['manufacturer'] || undefined
  const model =
    tagMap['com.apple.quicktime.model'] || tagMap['model'] || tagMap['device_name'] || undefined
  const creationTime = tagMap['creation_time'] || tagMap['video.creation_time'] || undefined

  let generatorHint: string | undefined
  for (const pat of GENERATOR_PATTERNS) {
    if (pat.re.test(searchCorpus)) {
      generatorHint = pat.name
      break
    }
  }

  let editorHint: string | undefined
  for (const pat of EDITOR_PATTERNS) {
    if (pat.re.test(searchCorpus)) {
      editorHint = pat.name
      break
    }
  }

  let platformTranscode: string | undefined
  for (const pat of PLATFORM_PATTERNS) {
    if (pat.re.test(searchCorpus)) {
      platformTranscode = pat.name
      break
    }
  }

  if (aigcImplicitLabel) {
    evidence.push(
      `AIGC 隐式标识 Label=${aigcImplicitLabel.label ?? '?'} (${aigcImplicitLabel.contentProducer ?? 'unknown'})` // cjk-ok
    )
  }
  if (binary.hasC2pa) {
    evidence.push('检测到 C2PA 内容溯源签名盒 (JUMBF/c2pa)') // cjk-ok
  }
  if (generatorHint) {
    evidence.push(`容器元数据命中生成模型签名：${generatorHint}`) // cjk-ok
  }
  if (editorHint) {
    evidence.push(`容器元数据命中剪辑/渲染工具：${editorHint}`) // cjk-ok
  }
  if (make || model) {
    evidence.push(`拍摄设备元数据：${[make, model].filter(Boolean).join(' ')}`) // cjk-ok
  }
  if (platformTranscode) {
    evidence.push(`社交平台转码特征：${platformTranscode}`) // cjk-ok
  }

  return {
    ...(containerFormat ? { containerFormat } : {}),
    ...(encoder ? { encoder } : {}),
    ...(make ? { make } : {}),
    ...(model ? { model } : {}),
    ...(creationTime ? { creationTime } : {}),
    ...(aigcImplicitLabel ? { aigcImplicitLabel } : {}),
    ...(binary.hasC2pa ? { hasC2pa: true } : {}),
    ...(generatorHint ? { generatorHint } : {}),
    ...(editorHint ? { editorHint } : {}),
    ...(platformTranscode ? { platformTranscode } : {}),
    evidence
  }
}
