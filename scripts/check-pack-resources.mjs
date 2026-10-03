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
    /** 至少要有这些文件，且每个不小于 minBytes（半截文件也算未就绪） */
    minBytes: 1024 * 1024,
    files: ['yolo11n.onnx', 'yolo11n-seg.onnx', 'yolo11n-pose.onnx'],
    howToFix: 'npm run fetch:yolo-models'
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
    if (!present.has(file.toLowerCase())) {
      problems.push(`${entry.label}：缺少 ${file}`)
      continue
    }
    const size = statSync(join(entry.dir, file)).size
    if (size < entry.minBytes) {
      problems.push(
        `${entry.label}：${file} 只有 ${(size / 1024).toFixed(0)} KB，疑似下载未完成（应 ≥ ${entry.minBytes / 1024 / 1024} MB）`
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
