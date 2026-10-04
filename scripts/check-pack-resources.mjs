#!/usr/bin/env node
/**
 * 打包资源自检：`electron-builder.yml` 的 `extraResources` 里那些**由构建步骤生成**
 * 的资源，打包前必须真的存在。
 *
 * 背景（6.10.0 发布时踩到）：`extraResources` 有一条 `from: resources/yolo-models`，
 * 而 models 不进 git、由 `npm run fetch:yolo-models` 在构建时拉取。npm 脚本 `pack` /
 * `dist` / `dist:win` 都带了这一步，但 CI 直接调 `npx electron-builder --win`，漏了它 ——
 * 结果 electron-builder 只打印一行
 *
 *   • file source doesn't exist  from=…/resources/yolo-models
 *
 * 就继续打了：安装包悄悄少了内置模型，用户在「设置 → 模型 → YOLO」看到未就绪，
 * 得自己往 <userData>/yolo-models 放 .onnx（运行期 bundledModelDir() 找不到源目录时
 * 只是 return，不会有任何提示）。这种「日志里一行、产物少一块」的问题最难发现，
 * 所以这里让它变成硬失败。
 *
 * 用法：
 *   node scripts/check-pack-resources.mjs          # 打包前自检（缺文件即退出码 1）
 *   node scripts/check-pack-resources.mjs --warn   # 只告警不失败（开发期可选）
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const warnOnly = process.argv.includes('--warn')

/** 必须由构建步骤生成、不进 git 的打包资源 */
const REQUIRED = [
  {
    /** 对应 electron-builder.yml 的 `- from: resources/yolo-models` */
    dir: join(root, 'resources', 'yolo-models'),
    label: '资源/yolo-models（内置 YOLO 模型）',
    files: [
      { name: 'yolo11n.onnx', minBytes: 1024 * 1024 },
      { name: 'yolo11n-seg.onnx', minBytes: 1024 * 1024 },
      { name: 'yolo11n-pose.onnx', minBytes: 1024 * 1024 }
    ],
    howToFix: 'npm run fetch:yolo-models'
  },
  {
    /**
     * 对应 electron-builder.yml 的 `- from: resources/face-models`。
     *
     * 逐文件给下限而不是统一 1MB：人脸检测器只有 1MB 量级，统一门槛会把正常模型误判成
     * 「下载未完成」；这两个文件缺失时人像编辑的五官 / 妆容 / 证件照裁切会静默降级，
     * 所以打包前必须硬失败。
     */
    dir: join(root, 'resources', 'face-models'),
    label: '资源/face-models（内置人脸两段式模型）',
    files: [
      { name: 'face-detect.onnx', minBytes: 256 * 1024 },
      { name: 'face-landmark.onnx', minBytes: 256 * 1024 }
    ],
    howToFix:
      'npm run fetch:yolo-models（人脸两个模型需先把资产传到本仓 Release：' +
      'npm run sync:face-models -- --dir <含两个 onnx 的目录> --upload；' +
      '或手动把两个 .onnx 放进 resources/face-models/）'
  }
]

const problems = []

for (const entry of REQUIRED) {
  if (!existsSync(entry.dir)) {
    problems.push(`${entry.label}：目录不存在（${entry.dir}）`)
    continue
  }
  const present = new Set(readdirSync(entry.dir).map((f) => f.toLowerCase()))
  for (const file of entry.files) {
    if (!present.has(file.name.toLowerCase())) {
      problems.push(`${entry.label}：缺少 ${file.name}`)
      continue
    }
    const size = statSync(join(entry.dir, file.name)).size
    if (size < file.minBytes) {
      problems.push(
        `${entry.label}：${file.name} 只有 ${(size / 1024).toFixed(0)} KB，疑似下载未完成（应 ≥ ${Math.round(file.minBytes / 1024)} KB）`
      )
    }
  }
}

if (problems.length === 0) {
  const summary = REQUIRED.map((e) => `${e.label} ${e.files.length} 个文件`).join('、')
  console.log(`[check-pack-resources] OK：${summary} 均齐备`)
  process.exit(0)
}

console.error('[check-pack-resources] 打包资源缺失，安装包会悄悄少东西：')
for (const p of problems) console.error(`  - ${p}`)
console.error('修：')
for (const entry of REQUIRED) console.error(`  ${entry.howToFix}`)
console.error('提示：CI 里请确认 `npm run fetch:yolo-models` 步骤在 electron-builder 之前执行。')

process.exit(warnOnly ? 0 : 1)
