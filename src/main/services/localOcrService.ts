import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { promisify } from 'node:util'
import { normalizeOcrDetectedText, type LocalOcrTextBox } from '../../shared/graph/uiControlSpec'

const execFileAsync = promisify(execFile)

interface RawOcrWord {
  text: string
  left: number
  top: number
  width: number
  height: number
}

interface RawOcrLine {
  text: string
  words: RawOcrWord[]
}

const OCR_CACHE_MAX = 24
const ocrResultCache = new Map<string, LocalOcrTextBox[]>()

function decodeDataUrlToImageBuffer(dataUrl: string): { buffer: Buffer; ext: string } | null {
  const trimmed = dataUrl?.trim() || ''
  const match = /^data:image\/([a-zA-Z0-9+.-]+);base64,([\s\S]+)$/.exec(trimmed)
  if (!match) return null
  const mimeSub = match[1]!.toLowerCase()
  const base64Data = match[2]!.trim()
  if (!base64Data) return null
  const ext =
    mimeSub === 'jpeg' || mimeSub === 'jpg'
      ? 'jpg'
      : mimeSub === 'webp'
        ? 'webp'
        : mimeSub === 'bmp'
          ? 'bmp'
          : 'png'
  return {
    buffer: Buffer.from(base64Data, 'base64'),
    ext
  }
}

/**
 * 将同一行的 OCR 单词/字块按水平间距聚类为独立的控件短语框：
 * - 解决 Windows.Media.Ocr 将同一水平线上的左右两个按钮文字合并为单行的问题；
 * - 同一按钮内部的紧凑字符（间距 <= 字高 * 1.45 或 24px）自动聚合为一个完整短语并剔除中文分词空格。
 */
export function clusterOcrLineWordsIntoBoxes(lines: ReadonlyArray<RawOcrLine>): LocalOcrTextBox[] {
  const boxes: LocalOcrTextBox[] = []
  for (const line of lines) {
    const words = (line.words ?? []).filter(
      (w) => typeof w.text === 'string' && w.text.trim().length > 0 && w.width > 0 && w.height > 0
    )
    if (!words.length) continue

    const sorted = [...words].sort((a, b) => a.left - b.left)
    let curTexts: string[] = [sorted[0]!.text.trim()]
    let curLeft = sorted[0]!.left
    let curTop = sorted[0]!.top
    let curRight = sorted[0]!.left + sorted[0]!.width
    let curBottom = sorted[0]!.top + sorted[0]!.height

    for (let i = 1; i < sorted.length; i++) {
      const w = sorted[i]!
      const curHeight = Math.max(8, curBottom - curTop)
      const gapX = w.left - curRight
      const maxGap = Math.max(curHeight * 1.45, w.height * 1.45, 24)
      if (gapX <= maxGap) {
        curTexts.push(w.text.trim())
        curLeft = Math.min(curLeft, w.left)
        curTop = Math.min(curTop, w.top)
        curRight = Math.max(curRight, w.left + w.width)
        curBottom = Math.max(curBottom, w.top + w.height)
      } else {
        const text = normalizeOcrDetectedText(curTexts.join(' '))
        if (text) {
          boxes.push({
            text,
            left: Math.round(curLeft),
            top: Math.round(curTop),
            width: Math.max(1, Math.round(curRight - curLeft)),
            height: Math.max(1, Math.round(curBottom - curTop)),
            confidence: 0.92
          })
        }
        curTexts = [w.text.trim()]
        curLeft = w.left
        curTop = w.top
        curRight = w.left + w.width
        curBottom = w.top + w.height
      }
    }

    const finalText = normalizeOcrDetectedText(curTexts.join(' '))
    if (finalText) {
      boxes.push({
        text: finalText,
        left: Math.round(curLeft),
        top: Math.round(curTop),
        width: Math.max(1, Math.round(curRight - curLeft)),
        height: Math.max(1, Math.round(curBottom - curTop)),
        confidence: 0.92
      })
    }
  }
  return boxes
}

async function runWindowsNativeOcr(imagePath: string): Promise<LocalOcrTextBox[]> {
  const psScript = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1'
})[0]
Function Await($WinRtTask, $ResultType) {
  $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
  $netTask = $asTask.Invoke($null, @($WinRtTask))
  $netTask.Wait(-1) | Out-Null
  $netTask.Result
}

$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($env:STUDIO_OCR_IMAGE_PATH)) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])

$lang = New-Object Windows.Globalization.Language('zh-Hans-CN')
if (-not [Windows.Media.Ocr.OcrEngine]::IsLanguageSupported($lang)) {
  $lang = New-Object Windows.Globalization.Language('zh-CN')
}
if ([Windows.Media.Ocr.OcrEngine]::IsLanguageSupported($lang)) {
  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($lang)
} else {
  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
}
if ($null -eq $engine) {
  Write-Output '[]'
  exit 0
}

$result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
$lines = @()
foreach ($line in $result.Lines) {
  $words = @()
  foreach ($w in $line.Words) {
    $r = $w.BoundingRect
    $words += [PSCustomObject]@{
      text = $w.Text
      left = [int][Math]::Round($r.X)
      top = [int][Math]::Round($r.Y)
      width = [int][Math]::Round($r.Width)
      height = [int][Math]::Round($r.Height)
    }
  }
  $lines += [PSCustomObject]@{
    text = $line.Text
    words = $words
  }
}
ConvertTo-Json -InputObject @($lines) -Depth 5 -Compress
`

  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', psScript],
    {
      env: { ...process.env, STUDIO_OCR_IMAGE_PATH: imagePath },
      timeout: 12000,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true
    }
  )

  const trimmed = stdout?.trim() || ''
  if (!trimmed) return []
  const startIdx = trimmed.indexOf('[')
  const startObjIdx = trimmed.indexOf('{')
  const jsonSlice =
    startIdx >= 0 && (startObjIdx < 0 || startIdx < startObjIdx)
      ? trimmed.slice(startIdx)
      : startObjIdx >= 0
        ? `[${trimmed.slice(startObjIdx)}]`
        : '[]'

  const parsed = JSON.parse(jsonSlice) as unknown
  const rawLines: RawOcrLine[] = Array.isArray(parsed)
    ? (parsed as RawOcrLine[])
    : parsed && typeof parsed === 'object'
      ? [parsed as RawOcrLine]
      : []

  return clusterOcrLineWordsIntoBoxes(rawLines)
}

/**
 * 解析 Tesseract CLI `tsv` 输出格式为统一的 `RawOcrLine[]` 行与字块结构（供 Linux / 跨平台回退使用）。
 */
export function parseTesseractTsvToOcrLines(tsvText: string): RawOcrLine[] {
  const rows = (tsvText ?? '').split(/\r?\n/)
  const lineMap = new Map<string, RawOcrWord[]>()

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]?.trim()
    if (!row) continue
    const cols = row.split('\t')
    if (cols.length < 12) continue
    const level = Number(cols[0])
    // level 5 代表具体 word 词块
    if (level !== 5) continue
    const pageNum = cols[1]
    const blockNum = cols[2]
    const parNum = cols[3]
    const lineNum = cols[4]
    const left = Number(cols[6])
    const top = Number(cols[7])
    const width = Number(cols[8])
    const height = Number(cols[9])
    const conf = Number(cols[10])
    const text = cols.slice(11).join('\t').trim()
    if (!text || width <= 0 || height <= 0 || (Number.isFinite(conf) && conf < 15)) continue

    const key = `${pageNum}:${blockNum}:${parNum}:${lineNum}`
    const list = lineMap.get(key) ?? []
    list.push({ text, left, top, width, height })
    lineMap.set(key, list)
  }

  const lines: RawOcrLine[] = []
  for (const words of lineMap.values()) {
    lines.push({
      text: words.map((w) => w.text).join(' '),
      words
    })
  }
  return lines
}

async function runMacOsVisionOcr(imagePath: string): Promise<LocalOcrTextBox[]> {
  const swiftScript = `
import Foundation
import Vision
import AppKit

guard let imgPath = ProcessInfo.processInfo.environment["STUDIO_OCR_IMAGE_PATH"],
      let nsImage = NSImage(contentsOfFile: imgPath),
      let cgImage = nsImage.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
  print("[]")
  exit(0)
}

let imgW = Double(cgImage.width)
let imgH = Double(cgImage.height)
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true
request.recognitionLanguages = ["zh-Hans", "zh-Hant", "en-US"]

let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
try? handler.perform([request])

var out: [[String: Any]] = []
for obs in request.results ?? [] {
  guard let topCandidate = obs.topCandidates(1).first else { continue }
  let text = topCandidate.string.trimmingCharacters(in: .whitespacesAndNewlines)
  if text.isEmpty { continue }
  let box = obs.boundingBox
  let left = Int((box.origin.x * imgW).rounded())
  let top = Int(((1.0 - box.origin.y - box.size.height) * imgH).rounded())
  let width = max(1, Int((box.size.width * imgW).rounded()))
  let height = max(1, Int((box.size.height * imgH).rounded()))
  out.append([
    "text": text,
    "left": left,
    "top": top,
    "width": width,
    "height": height,
    "confidence": Double(topCandidate.confidence)
  ])
}

if let data = try? JSONSerialization.data(withJSONObject: out, options: []),
   let jsonStr = String(data: data, encoding: .utf8) {
  print(jsonStr)
} else {
  print("[]")
}
`
  const { stdout } = await execFileAsync('/usr/bin/swift', ['-e', swiftScript], {
    env: { ...process.env, STUDIO_OCR_IMAGE_PATH: imagePath },
    timeout: 15000,
    maxBuffer: 4 * 1024 * 1024
  })
  const trimmed = stdout?.trim() || ''
  const startIdx = trimmed.indexOf('[')
  if (startIdx < 0) return []
  const parsed = JSON.parse(trimmed.slice(startIdx)) as Array<LocalOcrTextBox>
  if (!Array.isArray(parsed)) return []
  return parsed
    .map((b) => ({
      text: normalizeOcrDetectedText(b.text ?? ''),
      left: Math.round(Number(b.left) || 0),
      top: Math.round(Number(b.top) || 0),
      width: Math.max(1, Math.round(Number(b.width) || 1)),
      height: Math.max(1, Math.round(Number(b.height) || 1)),
      confidence: Number.isFinite(Number(b.confidence)) ? Number(b.confidence) : 0.9
    }))
    .filter((b) => b.text.length > 0)
}

async function runTesseractCliOcr(imagePath: string): Promise<LocalOcrTextBox[]> {
  for (const lang of ['chi_sim+eng', 'eng']) {
    try {
      const { stdout } = await execFileAsync(
        'tesseract',
        [imagePath, 'stdout', '-l', lang, '--psm', '11', 'tsv'],
        {
          timeout: 12000,
          maxBuffer: 4 * 1024 * 1024,
          windowsHide: true
        }
      )
      const lines = parseTesseractTsvToOcrLines(stdout)
      const boxes = clusterOcrLineWordsIntoBoxes(lines)
      if (boxes.length > 0) return boxes
    } catch {
      // 继续尝试下一个语言包或静默回退
    }
  }
  return []
}

/**
 * 跨平台本地离线 OCR 图像文字识别服务：
 * - Windows (`win32`)：直接调用系统原生 WinRT `Windows.Media.Ocr.OcrEngine`（优先 `zh-Hans-CN`，回退 `tesseract` CLI）；
 * - macOS (`darwin`)：直接调用系统原生 `Vision.framework` (`VNRecognizeTextRequest`，支持 `zh-Hans` / `zh-Hant` / `en-US`，回退 `tesseract` CLI)；
 * - Linux (`linux`)：调用本机 `tesseract` CLI (`chi_sim+eng` TSV 词块模式)。
 * 无需联网或配置外部 VLM，即可直接识别 UI 截图中的中英文按钮、标题、数值及其精确像素坐标框。
 */
export async function recognizeImageTextFromDataUrl(input: {
  dataUrl: string
}): Promise<LocalOcrTextBox[]> {
  const decoded = decodeDataUrlToImageBuffer(input.dataUrl)
  if (!decoded || decoded.buffer.length < 24) return []

  const cacheKey = createHash('sha1').update(decoded.buffer).digest('hex')
  const cached = ocrResultCache.get(cacheKey)
  if (cached) return cached

  const tmpPath = path.join(
    os.tmpdir(),
    `ai-art-ocr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${decoded.ext}`
  )
  try {
    await fs.writeFile(tmpPath, decoded.buffer)
    let boxes: LocalOcrTextBox[] = []
    if (process.platform === 'win32') {
      try {
        boxes = await runWindowsNativeOcr(tmpPath)
      } catch {
        boxes = []
      }
      if (!boxes.length) {
        boxes = await runTesseractCliOcr(tmpPath)
      }
    } else if (process.platform === 'darwin') {
      try {
        boxes = await runMacOsVisionOcr(tmpPath)
      } catch {
        boxes = []
      }
      if (!boxes.length) {
        boxes = await runTesseractCliOcr(tmpPath)
      }
    } else {
      boxes = await runTesseractCliOcr(tmpPath)
    }

    if (ocrResultCache.size >= OCR_CACHE_MAX) {
      const oldestKey = ocrResultCache.keys().next().value
      if (oldestKey) ocrResultCache.delete(oldestKey)
    }
    ocrResultCache.set(cacheKey, boxes)
    return boxes
  } catch {
    return []
  } finally {
    await fs.unlink(tmpPath).catch(() => {})
  }
}
