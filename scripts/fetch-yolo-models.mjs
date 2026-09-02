/**
 * 拉取随包内置的 YOLO 模型到 resources/yolo-models/。
 * 模型体积较大（约 33MB），不进 git；构建/打包前执行：
 *   npm run fetch:yolo-models
 */
import { mkdir, stat, writeFile } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(PROJECT_ROOT, 'resources', 'yolo-models')
const BASE = 'https://github.com/ultralytics/assets/releases/download/v8.3.0'
const MIN_SIZE = 1024 * 1024 // 小于 1MB 视为下载失败

const MODELS = [
  { file: 'yolo11n.onnx', kind: 'detect' },
  { file: 'yolo11n-seg.onnx', kind: 'segment' },
  { file: 'yolo11n-pose.onnx', kind: 'pose' }
]

async function download(file) {
  const url = `${BASE}/${file}`
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length < MIN_SIZE) throw new Error(`${file} looks truncated (${buf.length} bytes)`)
  await writeFile(join(OUT_DIR, file), buf)
  console.log(`  + ${file.padEnd(20)} ${(buf.length / 1024 / 1024).toFixed(1)} MB (${MODELS.find((m) => m.file === file).kind})`)
}

const main = async () => {
  await mkdir(OUT_DIR, { recursive: true })
  console.log(`Fetching YOLO models -> ${OUT_DIR}`)
  for (const { file } of MODELS) {
    try {
      const s = await stat(join(OUT_DIR, file))
      if (s.size >= MIN_SIZE) {
        console.log(`  = ${file.padEnd(20)} already present`)
        continue
      }
    } catch {
      /* not downloaded yet */
    }
    await download(file)
  }
  console.log('Done.')
}

main().catch((err) => {
  console.error(`Failed: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
