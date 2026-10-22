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
      const prevToken = curTexts[curTexts.length - 1] ?? ''
      const endsWithPlusPill = /\+$/.test(prevToken)
      const maxGap = endsWithPlusPill
        ? 10
        : curHeight >= 48
          ? Math.max(curHeight * 1.65, w.height * 1.65, 28)
          : Math.max(curHeight * 1.45, w.height * 1.45, 24)
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
Add-Type -AssemblyName System.Drawing
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Foundation.IAsyncOperation\`1, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1'
})[0]
Function Await($WinRtTask, $ResultType) {
  $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
  $netTask = $asTask.Invoke($null, @($WinRtTask))
  $netTask.Wait(-1) | Out-Null
  $netTask.Result
}

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
  Write-Output '{"pass1":[],"pass2":[]}'
  exit 0
}

Function Convert-OcrLines($ocrRes) {
  $arr = @()
  foreach ($line in $ocrRes.Lines) {
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
    $arr += [PSCustomObject]@{
      text = $line.Text
      words = $words
    }
  }
  return $arr
}

Function Run-OcrOnFile($p) {
  $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($p)) ([Windows.Storage.StorageFile])
  $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $res = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
  $stream.Dispose()
  return (Convert-OcrLines $res)
}

$srcPath = $env:STUDIO_OCR_IMAGE_PATH
$pass1 = Run-OcrOnFile $srcPath
$pass2 = @()
$boostPath = $srcPath + '.boost.png'
try {
  $srcBmp = [System.Drawing.Bitmap]::FromFile($srcPath)
  $dstBmp = New-Object System.Drawing.Bitmap($srcBmp.Width, $srcBmp.Height)
  $g = [System.Drawing.Graphics]::FromImage($dstBmp)
  $cm = New-Object System.Drawing.Imaging.ColorMatrix
  $cm.Matrix00 = 3.8
  $cm.Matrix11 = 3.8
  $cm.Matrix22 = 3.8
  $ia = New-Object System.Drawing.Imaging.ImageAttributes
  $ia.SetColorMatrix($cm)
  $rect = New-Object System.Drawing.Rectangle(0, 0, $srcBmp.Width, $srcBmp.Height)
  $g.DrawImage($srcBmp, $rect, 0, 0, $srcBmp.Width, $srcBmp.Height, [System.Drawing.GraphicsUnit]::Pixel, $ia)
  $g.Dispose()
  $srcBmp.Dispose()
  $dstBmp.Save($boostPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $dstBmp.Dispose()
  $pass2 = Run-OcrOnFile $boostPath
} catch {
  $pass2 = @()
} finally {
  if (Test-Path $boostPath) { Remove-Item $boostPath -Force -ErrorAction SilentlyContinue }
}

ConvertTo-Json -InputObject ([PSCustomObject]@{ pass1 = @($pass1); pass2 = @($pass2) }) -Depth 6 -Compress
`

  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', psScript],
    {
      env: { ...process.env, STUDIO_OCR_IMAGE_PATH: imagePath },
      timeout: 15000,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true
    }
  )

  const trimmed = stdout?.trim() || ''
  if (!trimmed) return []
  const startObjIdx = trimmed.indexOf('{')
  const startArrIdx = trimmed.indexOf('[')
  if (startObjIdx >= 0 && (startArrIdx < 0 || startObjIdx < startArrIdx)) {
    const parsedObj = JSON.parse(trimmed.slice(startObjIdx)) as {
      pass1?: RawOcrLine[]
      pass2?: RawOcrLine[]
    }
    const boxes1 = clusterOcrLineWordsIntoBoxes(
      Array.isArray(parsedObj.pass1) ? parsedObj.pass1 : []
    )
    const boxes2 = clusterOcrLineWordsIntoBoxes(
      Array.isArray(parsedObj.pass2) ? parsedObj.pass2 : []
    )
    const merged = [...boxes1]
    for (const b2 of boxes2) {
      if (b2.text.length === 1 && (b2.width >= 32 || b2.height >= 32)) continue
      const overlaps = merged.some((b1) => {
        const ix0 = Math.max(b1.left, b2.left)
        const iy0 = Math.max(b1.top, b2.top)
        const ix1 = Math.min(b1.left + b1.width, b2.left + b2.width)
        const iy1 = Math.min(b1.top + b1.height, b2.top + b2.height)
        if (ix1 <= ix0 || iy1 <= iy0) return false
        const inter = (ix1 - ix0) * (iy1 - iy0)
        const minArea = Math.min(b1.width * b1.height, b2.width * b2.height)
        return inter >= Math.max(1, minArea) * 0.35
      })
      if (!overlaps) {
        merged.push({ ...b2, confidence: 0.86 })
      }
    }
    return merged
  }

  const jsonSlice = startArrIdx >= 0 ? trimmed.slice(startArrIdx) : '[]'

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
