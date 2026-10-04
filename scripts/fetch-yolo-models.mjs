/**
 * 拉取随包内置的本地视觉模型：
 *   - Ultralytics yolo11n 系（detect / segment / pose）-> resources/yolo-models/
 *   - 人脸两段式（face-detect / face-landmark）        -> resources/face-models/
 * 模型体积较大，不进 git；构建/打包前执行：
 *   npm run fetch:yolo-models
 *
 * 人脸两个模型托管在本仓 GitHub Release（tag face-models-v1），与 @shared/yoloCatalog 的
 * YOLO_FACE_CATALOG_BASE_URL 同源；先把资产上传到该 Release：
 *   npm run sync:face-models -- --dir <含两个 onnx 的目录> --upload
 * 否则这里会报 404。也可以手动把两个 onnx 放进 resources/face-models/ 跳过这一步。
 */
import { mkdir, stat, writeFile } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const YOLO_DIR = join(PROJECT_ROOT, 'resources', 'yolo-models')
const FACE_DIR = join(PROJECT_ROOT, 'resources', 'face-models')
const BASE = 'https://github.com/ultralytics/assets/releases/download/v8.3.0'
const MIN_SIZE = 1024 * 1024 // 小于 1MB 视为下载失败（Ultralytics fp32 ONNX 都在 10MB 以上）
const FACE_BASE = 'https://github.com/Justin-sky/ai-art-engine/releases/download/face-models-v1'

/** 人脸两段式模型：另一套上游 + 本仓 Release，阈值按实测体积给（比 YOLO 小得多） */
const FACE_MODELS = [
  { file: 'face-detect.onnx', kind: 'face', base: FACE_BASE, minBytes: 256 * 1024 },
  { file: 'face-landmark.onnx', kind: 'face', base: FACE_BASE, minBytes: 256 * 1024 }
]

const MODELS = [
  { file: 'yolo11n.onnx', kind: 'detect', base: BASE, minBytes: MIN_SIZE, dir: YOLO_DIR },
  { file: 'yolo11n-seg.onnx', kind: 'segment', base: BASE, minBytes: MIN_SIZE, dir: YOLO_DIR },
  { file: 'yolo11n-pose.onnx', kind: 'pose', base: BASE, minBytes: MIN_SIZE, dir: YOLO_DIR },
  ...FACE_MODELS.map((m) => ({ ...m, dir: FACE_DIR }))
]

async function download(model) {
  const url = `${model.base}/${model.file}`
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) {
    const hint =
      model.kind === 'face'
        ? `\n      hint: upload the face assets first -> npm run sync:face-models -- --dir <dir> --upload` +
          `\n      or drop ${model.file} into resources/face-models/ by hand`
        : ''
    throw new Error(`HTTP ${res.status} for ${url}${hint}`)
  }
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length < model.minBytes) {
    throw new Error(`${model.file} looks truncated (${buf.length} bytes)`)
  }
  await writeFile(join(model.dir, model.file), buf)
  console.log(
    `  + ${model.file.padEnd(20)} ${(buf.length / 1024 / 1024).toFixed(1)} MB (${model.kind})`
  )
}

const main = async () => {
  await mkdir(YOLO_DIR, { recursive: true })
  await mkdir(FACE_DIR, { recursive: true })
  console.log(`Fetching local vision models -> ${YOLO_DIR} / ${FACE_DIR}`)
  for (const model of MODELS) {
    try {
      const s = await stat(join(model.dir, model.file))
      if (s.size >= model.minBytes) {
        console.log(`  = ${model.file.padEnd(20)} already present`)
        continue
      }
    } catch {
      /* not downloaded yet */
    }
    await download(model)
  }
  console.log('Done.')
}

main().catch((err) => {
  console.error(`Failed: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
