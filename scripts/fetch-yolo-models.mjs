/**
 * 随包内置的本地视觉模型：**已随仓库提交**（`resources/yolo-models/` 三个 + `resources/face-models/`
 * 两个，合计约 36MB，见 .gitignore 里的说明），因此本地与 CI 构建都不需要联网 —— 本脚本现在只是
 * **恢复路径**：某份文件缺失或被截断（误删、检出异常、换模型前的空目录）时把它拉回来，
 * 否则 `npm run check:pack` 会硬失败。
 *   - Ultralytics yolo11n 系（detect / segment / pose）-> resources/yolo-models/
 *   - 人脸两段式（face-detect / face-landmark）        -> resources/face-models/
 * 模型中已存在且体积达标时会直接跳过（打印 `= … already present`）：
 *   npm run fetch:yolo-models
 *
 * 人脸两个模型另有一条对外分发通路：本仓 GitHub Release（tag face-models-v1，prerelease），
 * 与 @shared/yoloCatalog 的 YOLO_FACE_CATALOG_BASE_URL 同源 —— 应用内「设置 → 模型」
 * 的兜底下载也走它。换模型时的流程：
 *   npm run sync:face-models -- --dir <含两个 onnx 的目录> --upload   # 上传资产 + 打印新 sha256
 *   把新 sha256 填进 src/shared/yoloCatalog.ts，并把新 .onnx 提交进 resources/face-models/
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
